import { Cause, Effect, Option, Result } from "effect";
import { and, eq, inArray } from "drizzle-orm";
import { projectScopeIdUuidV1Result, type ScopeId } from "flarex-protocol/storage-authority";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import {
  prepareLogicalStorageReadiness,
  prepareLogicalStorageMetadataProjection,
} from "../../../storage/catalog/logicalStorageReadiness";
import { readUniqueMaintenanceRequirements } from "../../../storage/unique/appUniqueConstraintSetBuildV1";
import { readBindingMaintenanceRequirements, selectBindingMaintenanceRequirements,
  type BindingMaintenanceRequirements } from "../../../storage/indexes/bindingMaintenance";
import {
  loadPublishedPhysicalRequirementSnapshotV1,
  IndexBuildReconciliationCatalogV1Error,
} from "../../../storage/indexes/indexBuildReconciliation";
import { SchemaVersionArtifactPersistenceError } from "../../../storage/catalog/schemaVersionArtifacts";
import {
  AppIndexDefinitionReadPersistenceError,
  AppSchemaVersionIndexBindingPersistenceError,
} from "../../../storage/indexes/appIndexDefinitions";
import {
  inspectFiniteMetadataProjection,
  type FiniteMetadataOwner,
} from "../../../execution/finiteMetadataDependencies";
import type {
  AppUniqueConstraintSetEligibilityPortV1,
} from "../../../storage/unique/appUniqueConstraintSetBuildV1";
import type { ScopeClockRecord } from "../../../scope/scopeClock";
import type { FlarexMetadataDatabase } from "../../../application/deployments";
import type { FlarexMetadataTransaction } from "../../../database/metadataTransaction";
import {
  hasApplicationBindingComposition,
  readApplicationActivationRepositoryState,
} from "../../../application/activation/repositoryIdentity";
import { selectApplicationActivationTargetResult } from "../../../application/readiness/activationTarget";
import {
  type ApplicationBindingSelectionReader,
} from "../../../application/activation/contracts";
import {
  readApplicationBindingProjectionInTransaction,
  readApplicationBindingEvidenceInTransaction,
} from "../../../application/applicationBindingProjection";
import { verifyLogicalSchemaBindingInTransaction, verifyBindingApplicationReference,
  type BindingApplicationAcceptance, type PreparedLogicalStorage } from "./logicalSchema";
import {
  captureExactTrustedScopeAuthorityResolutionPorts,
  resolveLocatedTrustedScopeAuthorityByIdEffect,
  type ExactTrustedScopeAuthorityResolutionPorts,
  type TrustedScopeSelection,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityResolutionPorts,
} from "../../../scope/scopeAuthorityResolution";
import { lockScopeClockForUpdateInTransactionEffect } from "../../../scope/scopeClock";
import { runLocatedReadCommittedEffect } from "../../../database/locatedReadCommittedEffect";
import {
  hasLocatedReadCommittedTargetDatabaseV1,
  type LocatedReadCommittedAttemptTargetV1,
} from "../../../database/locatedTransactionIdentity";
import {
  LocatedReadCommittedTransactionFailureV1,
} from "../../../execution/readCommittedTransactionFailure";
import {
  frameworkSchemaTargetSnapshot,
  hasFrameworkSchemaTargetDatabase,
  type FrameworkSchemaTarget,
} from "../target";
import { bindingError, type DataBindingError } from "./errors";
import {
  captureBindingValue,
  isDataBindingActivationRequest,
  isDataBindingSetFrame,
  sameBindingValue,
} from "./canonical";
import type {
  DataBindingActivationRequest,
  DataBindingActivationFrame,
  DataBindingHeadToken,
} from "./model";
import {
  readBindingCandidate,
  storeBindingCandidate,
  readBindingActivation,
  readBindingHead,
  readRetainedBindingActivation,
  readBindingActiveReferenceProjection,
  writeBindingActivation,
  type StoredBindingValue,
} from "./repository";
import { captureCommerceBindingProfiles, verifyBindingLanes } from "./evidence";
import { admitSyntheticBindingInTransaction, captureSyntheticBindingReference } from "./syntheticAdmission";
import {
  withAdmittedDataBinding,
  readAdmittedDataBinding,
  withSyntheticTestSelection,
  type AdmittedDataBinding,
  type SyntheticTestSelection,
} from "./selection";
import type { DataBindingTestProfiles } from "./profiles";
import { scopePhysicalLocatorsEqual } from "../../../scope/scopePhysicalLocator";
import { fxAppRowCurrent } from "../../../database/schema";
import type { ApplicationBindingReference, DataBindingSetFrame } from "./model";
import type { PayloadContentProfiles } from "../../../frameworks/payloadPreferences/binding";
import type { StrongReferenceActivationProjection } from "./strongReferenceProjection";

/** Called under the activation scope lock. A new policy cannot inherit an
 * invariant for rows committed before that policy existed. */
export const requireSafeStrongReferenceActivation = Effect.fn("DataBindingHost.requireSafeReferences")(
  function* (tx: FlarexMetadataTransaction, scopeId: ScopeId,
    previouslyEnforced: readonly StrongReferenceActivationProjection[],
    proposedReferences: readonly StrongReferenceActivationProjection[]) {
    const newlyReferencedTables = [...new Set(proposedReferences.filter(reference =>
      !previouslyEnforced.some(previous => previous.name === reference.name &&
        sameBindingValue(previous, reference))).map(reference => reference.sourceTableId))];
    if (newlyReferencedTables.length === 0) return;
    const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(scopeId))
      .pipe(Effect.mapError(cause => bindingError("storedCorruption", cause)));
    // A bounded existence probe refuses existing rows. A resumable validation
    // certificate is needed before a populated table can gain a new policy.
    const query = tx.select({ tableId: fxAppRowCurrent.tableId })
      .from(fxAppRowCurrent).where(and(eq(fxAppRowCurrent.scopeUuid, scope.scopeUuid),
        inArray(fxAppRowCurrent.tableId, newlyReferencedTables))).limit(1);
    const existing = yield* Effect.tryPromise({ try: () => query,
    catch: cause => bindingError("resourceFailure", cause) });
    if (existing.length > 0) return yield* Effect.fail(bindingError("unsupportedProfile",
      "new strong reference requires a validated existing-source backfill"));
  },
);

type LogicalStoragePreparationFailure = Effect.Error<ReturnType<typeof prepareLogicalStorageReadiness>>;

export type DataBindingFailure<ApplicationFailure> =
  | ApplicationFailure
  | DataBindingError
  | Effect.Error<ReturnType<typeof resolveLocatedTrustedScopeAuthorityByIdEffect>>
  | Effect.Error<ReturnType<typeof lockScopeClockForUpdateInTransactionEffect>>
  | Effect.Error<
      ReturnType<typeof readApplicationBindingProjectionInTransaction>
    >
  | Effect.Error<ReturnType<typeof verifyBindingLanes>>
  | LogicalStoragePreparationFailure
  | Effect.Error<ReturnType<PreparedLogicalStorage["advanceEmptySearch"]>>
  | Effect.Error<ReturnType<PreparedLogicalStorage["inspect"]>>;
export interface DataBindingActivationReport<ApplicationFailure> {
  readonly receipt: StoredBindingValue<DataBindingActivationFrame>;
  readonly current: Result.Result<
    Readonly<{ selected: boolean; head: DataBindingHeadToken }>,
    DataBindingFailure<ApplicationFailure>
  >;
}
export interface DataBindingHost<ApplicationFailure> {
  readonly readApplicationReference: () => Effect.Effect<
    ApplicationBindingReference,
    DataBindingFailure<ApplicationFailure>
  >;
  readonly prepare: (
    input: unknown,
  ) => Effect.Effect<
    StoredBindingValue<DataBindingSetFrame>,
    DataBindingFailure<ApplicationFailure>
  >;
  readonly activate: (
    input: unknown,
  ) => Effect.Effect<
    DataBindingActivationReport<ApplicationFailure>,
    DataBindingFailure<ApplicationFailure>
  >;
  readonly recover: DataBindingHost<ApplicationFailure>["activate"];
  readonly withCurrent: <Value, Failure>(
    work: (selection: AdmittedDataBinding) => Effect.Effect<Value, Failure>,
  ) => Effect.Effect<Value, Failure | DataBindingFailure<ApplicationFailure>>;
  readonly withSynthetic: <Value, Failure>(
    input: unknown,
    work: (selection: SyntheticTestSelection) => Effect.Effect<Value, Failure>,
  ) => Effect.Effect<Value, Failure | DataBindingFailure<ApplicationFailure>>;
}

export interface DataBindingHostInput<ApplicationFailure> {
  readonly logicalStorage?: Readonly<{
    controlDb: FlarexMetadataDatabase;
    schemaVersionId: CatalogSchemaVersionId;
    unique: AppUniqueConstraintSetEligibilityPortV1;
  }>;
  readonly commerceProfiles?: readonly import("../../../frameworks/commerceTransaction/profile").CommerceProfile[];
  readonly payloadProfiles?: PayloadContentProfiles;
  readonly database: FlarexMetadataDatabase;
  readonly selection: TrustedScopeSelection;
  readonly target: FrameworkSchemaTarget;
  readonly authority: ExactTrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1> &
    TrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1>;
  readonly application: ApplicationBindingSelectionReader<ApplicationFailure>;
  readonly testOnly?: Readonly<{
    profiles?: DataBindingTestProfiles;
    syntheticSelection?: true;
    afterAcceptance?: () => Effect.Effect<void, DataBindingError>;
  }>;
}

/** Dynamically repeated per deployment/target; owns no pool or singleton service lifecycle. */
export const makeDataBindingHost = Effect.fn("DataBindingHost.make")(function* <
  ApplicationFailure,
>(
  input: DataBindingHostInput<ApplicationFailure>,
): Effect.fn.Return<DataBindingHost<ApplicationFailure>, DataBindingError> {
  if (
    !hasApplicationBindingComposition(input.application, input.authority) ||
    !hasFrameworkSchemaTargetDatabase(input.target, input.database)
  )
    return yield* Effect.fail(bindingError("invalidAuthority"));
  const selection = Object.freeze({ ...input.selection });
  const snapshot = frameworkSchemaTargetSnapshot(input.target);
  if (
    snapshot === undefined ||
    snapshot.namespace.frame.deploymentId !== selection.deploymentId
  )
    return yield* Effect.fail(bindingError("placementMismatch"));
  const database = input.database;
  const logicalInput = input.logicalStorage === undefined ? null : Object.freeze({ ...input.logicalStorage });
  const logicalAuthority = input.authority;
  const target = input.target;
  const commerceProfiles = yield* captureCommerceBindingProfiles(input.commerceProfiles ?? []);
  const payloadProfiles = input.payloadProfiles;
  const deploymentId = selection.deploymentId;
  const authorityPorts = captureExactTrustedScopeAuthorityResolutionPorts(
    input.authority,
  );
  const application = input.application;
  const profiles = input.testOnly?.profiles;
  const syntheticEnabled = input.testOnly?.syntheticSelection === true;
  const afterAcceptance = input.testOnly?.afterAcceptance;

  const resolve = Effect.fn("DataBindingHost.resolve")(function* () {
    const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
      selection,
      authorityPorts,
    );
    if (
      !hasLocatedReadCommittedTargetDatabaseV1(located.target, database) ||
      !scopePhysicalLocatorsEqual(
        located.authority.physicalLocator,
        snapshot.physicalLocator,
      )
    )
      return yield* Effect.fail(bindingError("placementMismatch"));
    return located;
  });
  const run = Effect.fn("DataBindingHost.transaction")(
    <Value, Failure>(
      located: Awaited<Effect.Success<ReturnType<typeof resolve>>>,
      work: (
        tx: FlarexMetadataTransaction,
        authority: TrustedScopeAuthority,
      ) => Effect.Effect<Value, Failure>,
      activation = false,
    ) =>
      Effect.gen(function* () {
        const owner = readApplicationActivationRepositoryState(application);
        const executionTarget = activation
          ? owner === undefined
            ? yield* Effect.fail(bindingError("invalidAuthority"))
            : (yield* Effect.fromResult(selectApplicationActivationTargetResult(owner.activation,
              located.target, located.authority.physicalLocator)).pipe(
                Effect.mapError(cause => bindingError("invalidAuthority", cause)))).target
          : located.target;
        return yield* runLocatedReadCommittedEffect(
        executionTarget,
        {
          rollbackMessage: "Data binding transaction rollback",
          cleanupDefect: (cause) => bindingError("resourceFailure", cause),
        },
        (tx) => work(tx, located.authority),
      ).pipe(
        Effect.catchCause(cause => Effect.failCause(Cause.map(cause, (error: Failure | LocatedReadCommittedTransactionFailureV1): Failure | DataBindingError =>
          error instanceof LocatedReadCommittedTransactionFailureV1
            ? bindingError(
                error.issue.kind === "decisionUncertain"
                  ? "decisionUncertain"
                  : "resourceFailure",
                error,
              )
            : error,
        ))),
      );
      }),
  );
  const lockScope = Effect.fn("DataBindingHost.lockScope")(function* (
    tx: FlarexMetadataTransaction,
    authority: TrustedScopeAuthority,
  ) {
    const clock = yield* lockScopeClockForUpdateInTransactionEffect(
      tx,
      authority.scopeId,
    );
    if (
      clock.scopeId !== authority.scopeId ||
      clock.storageGeneration !== authority.storageGeneration ||
      clock.storageGenerationFence !== authority.storageGenerationFence ||
      clock.epoch !== authority.epoch
    ) {
      return yield* Effect.fail(bindingError("staleScope"));
    }
    return clock;
  });
  let preparedLogicalStorage: PreparedLogicalStorage | undefined;
  // Immutable success may be reused. Failure is not cached: build/catalog
  // availability can recover, and receipt recovery precedes this preparation.
  const prepareLogicalStorage = Effect.fn("DataBindingHost.prepareLogicalStorage")(function* (authority: TrustedScopeAuthority) {
    if (logicalInput === null) return null;
    if (preparedLogicalStorage !== undefined) return preparedLogicalStorage;
    const prepared = yield* prepareLogicalStorageReadiness(
      { controlDb: logicalInput.controlDb, authority: logicalAuthority }, logicalInput.unique,
      { deploymentId, scopeId: authority.scopeId, schemaVersionId: logicalInput.schemaVersionId },
    );
    if (prepared.status === "not_ready") return yield* Effect.fail(bindingError("logicalSchemaNotReady"));
    preparedLogicalStorage = prepared;
    return prepared;
  });

  // Projection acceptance immediately precedes this check under the same clock.
  // The immutable analysis correlation grants no native execution capability.
  const verifyLogicalStorage = Effect.fn("DataBindingHost.verifyLogicalStorage")(function* (
    frame: DataBindingSetFrame, evidence: Effect.Success<ReturnType<typeof readApplicationBindingEvidenceInTransaction>>,
    tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    logicalStorage: PreparedLogicalStorage | null,
    acceptance: BindingApplicationAcceptance,
  ) {
    if (logicalStorage === null) {
      if (frame.logicalSchema !== null) return yield* Effect.fail(bindingError("logicalSchemaMismatch"));
      yield* Effect.fromResult(verifyBindingApplicationReference(frame.application, evidence.projection, acceptance));
      return;
    }
    yield* verifyLogicalSchemaBindingInTransaction(logicalStorage, frame, evidence, tx, authority, clock, acceptance);
  });

  const readApplicationReference = Effect.fn(
    "DataBindingHost.readApplicationReference",
  )(function* () {
    const located = yield* resolve();
    const active = yield* application.readActive();
    return yield* run(located, (tx, authority) =>
      Effect.gen(function* () {
        const clock = yield* lockScope(tx, authority);
        return yield* readApplicationBindingProjectionInTransaction(
          active.selection,
          tx,
          clock,
        );
      }),
    );
  });
  const prepare = Effect.fn("DataBindingHost.prepare")(function* (
    inputFrame: unknown,
  ) {
    const candidate = yield* captureBindingValue(
      inputFrame,
      isDataBindingSetFrame,
    );
    const located = yield* resolve();
    const logicalStorage = yield* prepareLogicalStorage(located.authority);
    const active = yield* application.readActive();
    return yield* run(located, (tx, authority) =>
      Effect.gen(function* () {
        const clock = yield* lockScope(tx, authority);
        const evidence = yield* readApplicationBindingEvidenceInTransaction(
          active.selection,
          tx,
          clock,
        );
        if (logicalStorage !== null) {
          const searchBuild = yield* logicalStorage.advanceEmptySearch(tx, authority);
          if (searchBuild.status !== "ready")
            return yield* Effect.fail(bindingError("logicalSchemaNotReady", searchBuild));
        }
        yield* verifyLogicalStorage(candidate.frame, evidence, tx, authority, clock, logicalStorage, { kind: "proposal" });
        const verified = yield* verifyBindingLanes(
          tx,
          candidate.frame,
          database,
          target,
          snapshot,
          profiles,
          active.selection,
          payloadProfiles,
          commerceProfiles,
          logicalStorage?.source("payload"),
        );
        return yield* storeBindingCandidate(tx, candidate, verified);
      }),
    );
  });
  const withCurrent = Effect.fn("DataBindingHost.withCurrent")(function* <
    Value,
    Failure,
  >(work: (selection: AdmittedDataBinding) => Effect.Effect<Value, Failure>) {
    const located = yield* resolve();
    const hint = yield* run(located, (tx, authority) =>
      readBindingHead(tx, authority, "none"),
    );
    if (Option.isNone(hint))
      return yield* Effect.fail(bindingError("missingDependency"));
    const logicalStorage = yield* prepareLogicalStorage(located.authority);
    const active = yield* application.readActive();
    return yield* run(located, (tx, authority) =>
      Effect.gen(function* () {
        const clock = yield* lockScope(tx, authority);
        const evidence = yield* readApplicationBindingEvidenceInTransaction(
          active.selection,
          tx,
          clock,
        );
        const candidate = yield* readBindingCandidate(
          tx,
          authority,
          hint.value.frame.candidateSha256,
        );
        if (Option.isNone(candidate))
          return yield* Effect.fail(bindingError("storedCorruption"));
        const activation = yield* readRetainedBindingActivation(tx, authority, {
          sequence: hint.value.frame.sequence, sha256: hint.value.frame.activationSha256,
          candidateSha256: hint.value.frame.candidateSha256, headSha256: hint.value.sha256,
        });
        if (Option.isNone(activation)) return yield* Effect.fail(bindingError("storedCorruption"));
        yield* verifyLogicalStorage(candidate.value.frame, evidence, tx, authority, clock, logicalStorage,
          { kind: "activated", activation: activation.value });
        yield* verifyBindingLanes(
          tx,
          candidate.value.frame,
          database,
          target,
          snapshot,
          profiles,
          active.selection,
          payloadProfiles,
          commerceProfiles,
          logicalStorage?.source("payload"),
        );
        const current = yield* readBindingHead(tx, authority, "update");
        if (
          Option.isNone(current) ||
          current.value.sha256 !== hint.value.sha256
        )
          return yield* Effect.fail(bindingError("concurrentHead"));
        if (afterAcceptance !== undefined) yield* afterAcceptance();
        return yield* withAdmittedDataBinding(
          tx,
          target,
          authority,
          candidate.value.frame,
          Object.freeze({
            sequence: current.value.frame.sequence,
            sha256: current.value.sha256,
          }),
          work,
        );
      }),
    );
  });
  const report = Effect.fn("DataBindingHost.reportActivation")(function* (
    receipt: StoredBindingValue<DataBindingActivationFrame>,
  ) {
    const current = yield* withCurrent(readAdmittedDataBinding).pipe(
      Effect.result,
    );
    return Object.freeze({
      receipt,
      current: Result.map(current, (value) =>
        Object.freeze({
          selected:
            value.head.sequence === receipt.frame.sequence &&
            value.frame.application.scopeId === receipt.frame.request.scopeId &&
            value.frame.application.storageGeneration ===
              receipt.frame.request.storageGeneration,
          head: value.head,
        }),
      ),
    });
  });
  const activate = Effect.fn("DataBindingHost.activate")(function* (
    requestInput: unknown,
  ) {
    const request = (yield* captureBindingValue(
      requestInput,
      isDataBindingActivationRequest,
    )).frame;
    const located = yield* resolve();
    if (request.scopeId !== located.authority.scopeId)
      return yield* Effect.fail(bindingError("staleScope"));
    const previous = yield* run(located, (tx) =>
      readBindingActivation(tx, request.scopeId, request.requestId),
    );
    if (Option.isSome(previous)) {
      if (!sameBindingValue(previous.value.frame.request, request))
        return yield* Effect.fail(bindingError("requestConflict"));
      return yield* report(previous.value);
    }
    const logicalStorage = yield* prepareLogicalStorage(located.authority);
    const active = yield* application.readActive();
    const receipt = yield* run(located, (tx, authority) =>
      Effect.gen(function* () {
        const clock = yield* lockScope(tx, authority);
        if (request.storageGeneration !== authority.storageGeneration)
          return yield* Effect.fail(bindingError("staleScope"));
        const raced = yield* readBindingActivation(
          tx,
          request.scopeId,
          request.requestId,
        );
        if (Option.isSome(raced)) {
          if (!sameBindingValue(raced.value.frame.request, request))
            return yield* Effect.fail(bindingError("requestConflict"));
          return raced.value;
        }
        const evidence = yield* readApplicationBindingEvidenceInTransaction(
          active.selection,
          tx,
          clock,
        );
        const candidate = yield* readBindingCandidate(
          tx,
          authority,
          request.candidateSha256,
        );
        if (Option.isNone(candidate))
          return yield* Effect.fail(bindingError("missingDependency"));
        yield* verifyLogicalStorage(candidate.value.frame, evidence, tx, authority, clock, logicalStorage, { kind: "proposal" });
        yield* verifyBindingLanes(
          tx,
          candidate.value.frame,
          database,
          target,
          snapshot,
          profiles,
          active.selection,
          payloadProfiles,
          commerceProfiles,
          logicalStorage?.source("payload"),
        );
        const current = yield* readBindingHead(tx, authority, "update");
        const matches = Option.isNone(current)
          ? request.expectedHead === null
          : request.expectedHead !== null &&
            current.value.sha256 === request.expectedHead.sha256 &&
            current.value.frame.sequence === request.expectedHead.sequence;
        if (!matches) return yield* Effect.fail(bindingError("concurrentHead"));
        const proposedReferences = logicalStorage?.strongReferences ?? [];
        if (proposedReferences.length > 0) {
          const previouslyEnforced = Option.isSome(current)
            ? yield* readBindingActiveReferenceProjection(tx, authority, current.value)
            : [];
          yield* requireSafeStrongReferenceActivation(tx, clock.scopeId, previouslyEnforced, proposedReferences);
        }
        const preparedMaintenance = logicalStorage === null || logicalInput === null ? null : yield* Effect.gen(function* () {
          const unique = yield* readUniqueMaintenanceRequirements(logicalInput.controlDb, deploymentId,
            logicalStorage.reference.schemaVersionId, hasLocatedReadCommittedTargetDatabaseV1(located.target, logicalInput.controlDb) ? tx : undefined)
            .pipe(Effect.mapError(cause => bindingError(cause.reason === "resourceFailure" ? "resourceFailure" : "storedCorruption", cause)));
          const projection = yield* prepareLogicalStorageMetadataProjection(
            { deploymentId, schemaVersionId: logicalStorage.reference.schemaVersionId, profile: "binding" }, logicalStorage.snapshot, unique.members);
          const maintenance = yield* Effect.fromResult(selectBindingMaintenanceRequirements(logicalStorage.snapshot,unique));
          return { projection,maintenance };
        });
        const projection = preparedMaintenance?.projection ?? null;
        const owners: FiniteMetadataOwner[] = [...(projection === null ? [] : inspectFiniteMetadataProjection(projection)?.owners ?? [])];
        const maintenanceControl = logicalInput?.controlDb ?? readApplicationActivationRepositoryState(application)?.controlDatabase;
        const incomingMaintenance: BindingMaintenanceRequirements = preparedMaintenance?.maintenance ??
          { deploymentId, schemaVersionId: null, manifestSha256: null, indexes: [], unique: [] };
        let outgoingMaintenance: BindingMaintenanceRequirements | null = null;
        let withdrawsPermission = false;
        if (Option.isSome(current)) {
          const old = yield* readBindingCandidate(tx, authority, current.value.frame.candidateSha256);
          if (Option.isNone(old)) return yield* Effect.fail(bindingError("storedCorruption"));
          const previousFrame = old.value.frame;
          outgoingMaintenance = previousFrame.logicalSchema === null
            ? { deploymentId: previousFrame.application.deploymentId, schemaVersionId: null, manifestSha256: null, indexes: [], unique: [] }
            : maintenanceControl === undefined
              ? yield* Effect.fail(bindingError("invalidAuthority"))
              : yield* readBindingMaintenanceRequirements(maintenanceControl,previousFrame.application.deploymentId,
                previousFrame.logicalSchema,hasLocatedReadCommittedTargetDatabaseV1(located.target,maintenanceControl) ? tx : undefined);
          const incomingProfiles = new Set(profileIds(candidate.value.frame));
          withdrawsPermission = profileIds(previousFrame).some(profile => !incomingProfiles.has(profile)) ||
            (previousFrame.payloadContent !== null && candidate.value.frame.payloadContent === null);
          if (previousFrame.logicalSchema !== null && logicalInput !== null) {
            const previousRequirements = yield* loadPublishedPhysicalRequirementSnapshotV1(logicalInput.controlDb,
              { deploymentId, schemaVersionId: previousFrame.logicalSchema.schemaVersionId }).pipe(Effect.mapError(cause =>
                bindingError(cause instanceof SchemaVersionArtifactPersistenceError || cause instanceof AppIndexDefinitionReadPersistenceError ||
                  cause instanceof AppSchemaVersionIndexBindingPersistenceError ||
                  (cause instanceof IndexBuildReconciliationCatalogV1Error && cause.reason === "resourceFailure")
                  ? "resourceFailure" : "storedCorruption", cause)));
            if (previousRequirements === null) return yield* Effect.fail(bindingError("storedCorruption"));
            for (const source of previousRequirements.logicalRequirements?.evidence.candidate.sources ?? []) {
              const owner: FiniteMetadataOwner = { namespace: "binding", ownerKey: source.key };
              if (!owners.some(member => member.namespace === owner.namespace && member.ownerKey === owner.ownerKey)) owners.push(owner);
              const next = logicalStorage?.requirements.evidence.candidate.sources.find(member => member.key === source.key && member.owner === source.owner);
              if (next === undefined || next.writeProfile !== source.writeProfile) withdrawsPermission = true;
            }
          }
        }
        const written = yield* writeBindingActivation(tx, request, proposedReferences,
          { projection, owners, withdrawsPermission, maintenance: { outgoing: outgoingMaintenance, incoming: incomingMaintenance } });
        if (afterAcceptance !== undefined) yield* afterAcceptance();
        return written;
      }), true,
    );
    return yield* report(receipt);
  });
  const recover = Effect.fn("DataBindingHost.recover")((request: unknown) =>
    activate(request),
  );
  const withSynthetic = Effect.fn("DataBindingHost.withSyntheticTestSelection")(
    function* <Value, Failure>(
      referenceInput: unknown,
      work: (
        selection: SyntheticTestSelection,
      ) => Effect.Effect<Value, Failure>,
    ) {
      if (!syntheticEnabled)
        return yield* Effect.fail(bindingError("invalidAuthority"));
      const reference = yield* captureSyntheticBindingReference(referenceInput);
      if (reference.installation.artifact.owner !== "system")
        return yield* Effect.fail(bindingError("invalidAuthority"));
      const located = yield* resolve();
      return yield* run(located, (tx, authority) =>
        Effect.gen(function* () {
          yield* admitSyntheticBindingInTransaction(tx, authority, snapshot, reference);
          return yield* withSyntheticTestSelection(
            tx,
            target,
            authority,
            reference,
            work,
          );
        }),
      );
    },
  );
  return Object.freeze({
    readApplicationReference,
    prepare,
    activate,
    recover,
    withCurrent,
    withSynthetic,
  });
});

export function dataBindingActivationRequest(
  scopeId: string,
  storageGeneration: string,
  requestId: string,
  candidateSha256: string,
  expectedHead: DataBindingHeadToken | null,
): DataBindingActivationRequest {
  return {
    format: "flarex.data-binding-activation-request",
    version: 1,
    scopeId,
    storageGeneration,
    requestId,
    candidateSha256,
    expectedHead,
  };
}

function profileIds(frame: DataBindingSetFrame): readonly string[] {
  return [
    ...(frame.payloadLifecycle?.profiles.map(profile => `${profile.kind}:${profile.profileId}`) ?? []),
    ...frame.commerce.flatMap(binding => binding.profiles.map(profile => `commerce:${profile.profileId}`)),
  ];
}
