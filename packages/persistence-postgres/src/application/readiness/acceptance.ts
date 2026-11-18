import {
  Effect,
  Cause,
} from "effect";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { UniqueMaintenanceError } from "../../storage/indexes/indexMaintenanceModel";
import {
  readUniqueMaintenanceRequirements,
  lendPreparedAppUniqueConstraintDefinitions,
} from "../../storage/unique/appUniqueConstraintSetBuildV1";
import type {
  ApplicationReadinessResult,
  PreparedApplicationReadinessActivation,
  ApplicationReadinessActivationValidation,
  ApplicationReadinessProtection,
  StoredApplicationReadinessActivationValidation,
} from "./contracts";
import {
  readApplicationReadinessIssuerState,
  readIssuedApplicationReadinessState,
  readApplicationReadinessActivationState,
  activationBasis,
  type ApplicationReadinessIssuerState,
  type StoredIssuedApplicationReadinessState,
  type StoredReadinessAuthority,
  readinessProtectionMatches,
} from "./identity";
import {
  type LocatedReadCommittedAttemptTargetV1,
  hasLocatedReadCommittedTargetDatabaseV1,
} from "../../database/locatedTransactionIdentity";
import type { AppRowTransaction } from "../../storage/documents/appRows";
import type {
  ScopeClockRecord,
  LockScopeClockForShareError,
  LockScopeClockForUpdateError,
} from "../../scope/scopeClock";
import type { ApplicationTaskCatalogSnapshotError } from "../tasks/applicationTaskBindings";
import type {
  ValidateAppSchemaCandidateReadinessError,
} from "../../storage/catalog/appSchemaCandidateValidation";
import type { ValidatePointCommitUniqueConstraintEligibilityV1Error } from "../../commit/point/errors";
import {
  type ValidatePhysicalDefinitionLifecycleReadinessError,
  validatePhysicalDefinitionLifecycleReadinessCatalogEffect,
} from "../../installation/physicalDefinitionLifecycle";
import { isManagedInstallationTransaction } from "../../installation/installationLifecycle";
import { bytesEqualFullScan } from "@flarex/utils/bytes";
import {
  type ApplicationReadinessError,
  readinessFailure,
  type StoredApplicationReadinessValidationError,
  readinessFailureValue,
} from "./errors";
import { settleReadiness } from "./persistence";
import type { CheckedApplicationActiveHead } from "../activeHead/contracts";
import {
  requireExactAuthority,
  type StoredBundle,
  reserveBundle,
  storedBundlesEqual,
} from "./bundle";
import {
  hasProtectedMetadataFinalGuardScope,
  authenticateProtectedTargetMetadataSnapshot,
  registerProtectedMetadataFinalGuard,
  guardProtectedMetadataEpoch,
  authenticateProtectedReadinessMetadataPair,
} from "../../execution/preparation/preparedMetadataEpoch";
import { observeExecution } from "../../execution/diagnostics/operation";
import type { ApplicationSchemaAuthority } from "../applicationSchemaAuthority";
import type { FlarexMetadataDatabase } from "../deployments";
import {
  preparePointCommitUniqueConstraintSet,
  acceptPreparedPointCommitUniqueConstraintSet,
} from "../../commit/point/uniqueEligibility";
import {
  readSchemaBinding,
  requireSchemaCorrelation,
  applicationSchemaBindingBytes,
} from "./controlSchema";
import { loadStoredReadinessAuthority } from "./storedAuthority";
import { loadPhysicalReadiness } from "./physicalCoverage";
import {
  loadPublishedPhysicalRequirementSnapshotV1,
  publishedPhysicalDefinitionMatchesLocated,
} from "../../storage/indexes/indexBuildReconciliation";

/** Immutable closed membership from the exact retained readiness issuer. */
export const readApplicationMetadataUniqueRequirements = Effect.fn("ApplicationReadiness.readMetadataUniqueRequirements")(
  function* (repository: unknown, issued: ApplicationReadinessResult, schemaVersionId: CatalogSchemaVersionId) {
    const state = typeof repository === "object" && repository !== null ? readApplicationReadinessIssuerState(repository) : undefined;
    const ready = issued.status === "ready" ? readIssuedApplicationReadinessState(issued) : undefined;
    if (state === undefined || ready === undefined || ready.issuer !== state.issuer)
      return yield* Effect.fail(new UniqueMaintenanceError({ reason: "storedState" }));
    const retained = ready.kind === "prepared" ? ready.prepared : ready.stored;
    if (retained.requirements.schemaVersionId !== schemaVersionId)
      return yield* Effect.fail(new UniqueMaintenanceError({ reason: "storedState" }));
    return yield* readUniqueMaintenanceRequirements(state.context.controlDb, retained.bundle.deploymentId, schemaVersionId);
  },
);

export const readApplicationActivationUniqueRequirements = Effect.fn("ApplicationReadiness.readActivationUniqueRequirements")(
  function* (repository: unknown, issued: ApplicationReadinessResult, schemaVersionId: string,
    target: LocatedReadCommittedAttemptTargetV1, tx: AppRowTransaction) {
    const state = typeof repository === "object" && repository !== null ? readApplicationReadinessIssuerState(repository) : undefined;
    const ready = issued.status === "ready" ? readIssuedApplicationReadinessState(issued) : undefined;
    if (state === undefined || ready === undefined || ready.issuer !== state.issuer) {
      return yield* Effect.fail(new UniqueMaintenanceError({ reason: "storedState" }));
    }
    const bundle = ready.kind === "prepared" ? ready.prepared.bundle : ready.stored.bundle;
    const db = state.context.controlDb;
    return yield* readUniqueMaintenanceRequirements(db, bundle.deploymentId, schemaVersionId,
      hasLocatedReadCommittedTargetDatabaseV1(target, db) ? tx : undefined);
  },
);

export const validateApplicationReadinessForActivationInTransaction =
  Effect.fn("ApplicationReadiness.validateForActivationInTransaction")(
    function* (
      repository: unknown,
      issued: ApplicationReadinessResult,
      tx: AppRowTransaction,
      currentClock: ScopeClockRecord,
      activationPreparation?: PreparedApplicationReadinessActivation,
    ): Effect.fn.Return<
      ApplicationReadinessActivationValidation,
      | ApplicationReadinessError
      | ApplicationTaskCatalogSnapshotError
      | ValidateAppSchemaCandidateReadinessError
      | ValidatePointCommitUniqueConstraintEligibilityV1Error
      | ValidatePhysicalDefinitionLifecycleReadinessError
      | LockScopeClockForShareError
      | LockScopeClockForUpdateError
    > {
      if (typeof repository !== "object" || repository === null ||
        issued.status !== "ready") {
        return yield* readinessFailure("invalidComposition");
      }
      const repositoryState = readApplicationReadinessIssuerState(repository);
      const issuedState = readIssuedApplicationReadinessState(issued);
      if (repositoryState === undefined || issuedState === undefined ||
        issuedState.kind !== "prepared" ||
        issuedState.issuer !== repositoryState.issuer ||
        issuedState.prepared.bundle.authority.scopeId !== currentClock.scopeId) {
        return yield* readinessFailure("invalidComposition");
      }
      if (activationPreparation !== undefined) {
        const activation = readApplicationReadinessActivationState(activationPreparation);
        if (activation === undefined || activation.owner !== repositoryState || activation.issued !== issued ||
          (activation.target.installed !== undefined && !isManagedInstallationTransaction(tx,
            activation.target.installed.database, activation.target.installed.installation)))
          return yield* readinessFailure("invalidComposition");
      }
      const replay = yield* settleReadiness(
        tx,
        issuedState.prepared,
        repositoryState.context,
        repositoryState.issuer,
        "validate",
      );
      if (replay.status !== "ready") return replay;
      const replayState = readIssuedApplicationReadinessState(replay);
      if (replayState === undefined ||
        !bytesEqualFullScan(
          replayState.readinessSha256,
          issuedState.readinessSha256,
        ) || !bytesEqualFullScan(
          replayState.readinessBytes,
          issuedState.readinessBytes,
        )) return yield* readinessFailure("authorityChanged");
      return Object.freeze({
        status: "ready",
        basis: activationBasis(issuedState),
      });
    },
  );

export const validateStoredApplicationReadinessForActivationInTransaction =
  Effect.fn("ApplicationReadiness.validateStoredForActivationInTransaction")(
    function* (
      repository: unknown,
      issued: ApplicationReadinessResult,
      tx: AppRowTransaction,
      currentClock: ScopeClockRecord,
      checkedActive?: CheckedApplicationActiveHead,
      pairedProtection?: ApplicationReadinessProtection,
    ): Effect.fn.Return<
      StoredApplicationReadinessActivationValidation,
      StoredApplicationReadinessValidationError
    > {
      if (typeof repository !== "object" || repository === null ||
        issued.status !== "ready") {
        return yield* readinessFailure("invalidComposition");
      }
      const repositoryState = readApplicationReadinessIssuerState(repository);
      const issuedState = readIssuedApplicationReadinessState(issued);
      if (repositoryState === undefined || issuedState === undefined ||
        issuedState.kind !== "stored" ||
        issuedState.stored.preparationProfile === "finiteEntry" ||
        issuedState.issuer !== repositoryState.issuer ||
        issuedState.stored.bundle.authority.scopeId !== currentClock.scopeId) {
        return yield* readinessFailure("invalidComposition");
      }
      return yield* validateStoredIssuedReadiness(
        repositoryState,
        issuedState,
        tx,
        currentClock,
        checkedActive,
        undefined,
        pairedProtection,
      );
    },
  );

/** Finite entry authenticates immutable publication under fresh head and scope
 * authority; demanded reads and final touched maintenance own build coverage. */
export const validateFiniteApplicationReadinessInTransaction = Effect.fn("ApplicationReadiness.validateFiniteEntry")(
  function* (repository: unknown, issued: ApplicationReadinessResult, tx: AppRowTransaction,
    currentClock: ScopeClockRecord, checkedActive?: CheckedApplicationActiveHead) {
    const owner = typeof repository === "object" && repository !== null ? readApplicationReadinessIssuerState(repository) : undefined;
    const state = issued.status === "ready" ? readIssuedApplicationReadinessState(issued) : undefined;
    if (owner === undefined || state?.kind !== "stored" || state.issuer !== owner.issuer ||
      state.stored.preparationProfile !== "finiteEntry" || state.stored.bundle.authority.scopeId !== currentClock.scopeId)
      return yield* readinessFailure("invalidComposition");
    yield* requireExactAuthority(state.stored.bundle.authority, currentClock);
    return yield* validateStoredIssuedReadiness(owner, state, tx, currentClock, checkedActive);
  },
);

/** Only the Application request owner calls this after its live head/activation
 * read. The original issuer's canonical projection stays inside this callback;
 * all physical checks are fresh and successful work must pass the final guard. */
export const withStoredApplicationReadinessForBindingInTransaction = Effect.fnUntraced(function* <Value, Failure, Requirements>(
  repository: unknown, issued: ApplicationReadinessResult, tx: AppRowTransaction,
  currentClock: ScopeClockRecord, checkedActive: CheckedApplicationActiveHead | undefined,
  work: (validated: StoredApplicationReadinessActivationValidation) => Effect.Effect<Value, Failure, Requirements>,
  pairedProtection?: ApplicationReadinessProtection,
) {
  if (typeof repository !== "object" || repository === null || issued.status !== "ready")
    return yield* readinessFailure("invalidComposition");
  const repositoryState = readApplicationReadinessIssuerState(repository);
  const issuedState = readIssuedApplicationReadinessState(issued);
  if (repositoryState === undefined || issuedState === undefined || issuedState.kind !== "stored" ||
    issuedState.stored.preparationProfile === "finiteEntry" ||
    issuedState.issuer !== repositoryState.issuer || issuedState.stored.bundle.authority.scopeId !== currentClock.scopeId)
    return yield* readinessFailure("invalidComposition");
  const protection = issuedState.stored.protectedMetadata;
  const deferredGuard = hasProtectedMetadataFinalGuardScope(tx);
  if (protection !== undefined) yield* authenticateProtectedTargetMetadataSnapshot(protection, tx).pipe(
    Effect.mapError(cause => readinessFailureValue("resourceFailure", false, cause)));
  if (protection !== undefined && deferredGuard) yield* registerProtectedMetadataFinalGuard(
    tx, protection.token, protection.database, protection.epoch,
  ).pipe(Effect.mapError(cause => readinessFailureValue("resourceFailure", false, cause)));
  const validated = yield* validateStoredIssuedReadiness(repositoryState, issuedState, tx, currentClock,
    checkedActive, protection, pairedProtection);
  const value = yield* Effect.suspend(() => work(validated));
  // This remains the last metadata acquisition. Body failures, defects and
  // interruption bypass this success tail and retain the owning rollback Cause.
  // A genuine installed relational entry owns the existing transaction guard
  // scope and flushes it after all business work. Other callers keep this tail.
  if (protection !== undefined && !deferredGuard) yield* guardProtectedMetadataEpoch(
    protection.token, protection.database, protection.epoch, tx,
  ).pipe(Effect.mapError(cause => readinessFailureValue("resourceFailure", false, cause)));
  return value;
}, work => observeExecution("ApplicationReadiness.withStoredForBindingInTransaction", work));

const validateStoredIssuedReadiness = Effect.fnUntraced(function* (
  repositoryState: ApplicationReadinessIssuerState,
  issuedState: StoredIssuedApplicationReadinessState,
  tx: AppRowTransaction,
  clock: ScopeClockRecord,
  checkedActive?: CheckedApplicationActiveHead,
  requestProjection?: StoredReadinessAuthority["protectedMetadata"],
  pairedProtection?: ApplicationReadinessProtection,
): Effect.fn.Return<
  StoredApplicationReadinessActivationValidation,
  StoredApplicationReadinessValidationError
> {
  const protection = issuedState.stored.protectedMetadata;
  const catalogReader = issuedState.stored.target !== undefined &&
    hasLocatedReadCommittedTargetDatabaseV1(issuedState.stored.target, repositoryState.context.controlDb) ? tx : undefined;
  if (requestProjection !== undefined && requestProjection !== protection)
    return yield* readinessFailure("invalidComposition");
  if (pairedProtection !== undefined) {
    const expected = issuedState.stored.controlIdentity;
    const original = issuedState.stored.generationProtection;
    if (issuedState.stored.target === undefined ||
      !hasLocatedReadCommittedTargetDatabaseV1(issuedState.stored.target, pairedProtection.target.database) ||
      expected === undefined || expected.databaseName !== pairedProtection.control.epoch.databaseName ||
      expected.namespaceOid !== pairedProtection.control.epoch.namespaceOid.toString() ||
      original === undefined || !readinessProtectionMatches(original, pairedProtection))
      return yield* readinessFailure("invalidComposition");
    yield* Effect.fromResult(authenticateProtectedReadinessMetadataPair(tx, original.target, original.control)).pipe(Effect.mapError(cause =>
      readinessFailureValue(cause.reason === "changed" ? "authorityChanged" : "invalidComposition", false, cause)));
  }
  let currentBundle: StoredBundle;
  let freshCatalog: Readonly<{ schema: ApplicationSchemaAuthority; reader: AppRowTransaction | FlarexMetadataDatabase }> | undefined;
  const useProtectedProjection = (pairedProtection !== undefined || issuedState.stored.preparationProfile === "finiteEntry") &&
    (requestProjection !== undefined || (protection !== undefined && hasProtectedMetadataFinalGuardScope(tx)));
  if (useProtectedProjection) {
    if (requestProjection === undefined && protection !== undefined)
      yield* registerProtectedMetadataFinalGuard(tx, protection.token, protection.database, protection.epoch)
        .pipe(Effect.mapError(cause => readinessFailureValue("resourceFailure", false, cause)));
    currentBundle = issuedState.stored.bundle;
  } else {
    const loaded = yield* reserveBundle(
      tx,
      issuedState.stored.bundle.authority,
      Object.freeze({
        deploymentId: issuedState.stored.bundle.deploymentId,
        revisionId: issuedState.stored.bundle.revision.revisionId,
      }),
      repositoryState.context.taskCatalog,
      "share",
      clock,
    );
    if ("status" in loaded || !storedBundlesEqual(loaded, issuedState.stored.bundle))
      return yield* readinessFailure("authorityChanged");
    currentBundle = loaded;
    freshCatalog = yield* validateStoredReadinessControlCatalog(repositoryState, issuedState.stored, currentBundle, tx);
  }
  if (issuedState.stored.preparationProfile !== "finiteEntry") {
    const preparedUnique = !useProtectedProjection || issuedState.stored.uniquePreparation === undefined
      ? yield* preparePointCommitUniqueConstraintSet(repositoryState.context.pointCommit,
          { deploymentId: currentBundle.deploymentId, scopeId: currentBundle.authority.scopeId,
            schemaVersionId: issuedState.stored.schema.schemaVersionId },
          repositoryState.context.controlDb, repositoryState.context.authority, catalogReader)
      : { status: "prepared" as const, preparation: issuedState.stored.uniquePreparation };
    if (preparedUnique.status !== "prepared") return yield* readinessFailure("authorityChanged");
    if (!useProtectedProjection && issuedState.stored.uniquePreparation !== undefined) {
      const original = yield* lendPreparedAppUniqueConstraintDefinitions(issuedState.stored.uniquePreparation, repositoryState.context.controlDb);
      const current = yield* lendPreparedAppUniqueConstraintDefinitions(preparedUnique.preparation, repositoryState.context.controlDb);
      if (current.length !== original.length || current.some((definition, index) => {
        const expected = original[index];
        return expected === undefined || definition.deploymentId !== expected.deploymentId ||
          definition.uniqueConstraintDefinitionId !== expected.uniqueConstraintDefinitionId ||
          definition.logicalUniqueConstraintId !== expected.logicalUniqueConstraintId || definition.tableId !== expected.tableId ||
          definition.physicalSpecCodecVersion !== expected.physicalSpecCodecVersion ||
          definition.physicalSpecBytesHex !== expected.physicalSpecBytesHex || definition.physicalSpecSha256Hex !== expected.physicalSpecSha256Hex;
      })) return yield* readinessFailure("authorityChanged");
    }
    const unique = yield* acceptPreparedPointCommitUniqueConstraintSet(repositoryState.context.pointCommit,
      preparedUnique.preparation, tx, currentBundle.authority, clock);
    if (unique.status === "not_ready") return yield* readinessFailure("authorityChanged");
  }
  if (freshCatalog !== undefined) {
    yield* validatePhysicalDefinitionLifecycleReadinessCatalogEffect(repositoryState.context.physicalDefinitionLifecycle,
      issuedState.stored.physicalDefinitionLifecycle, tx);
    const binding = yield* readSchemaBinding(freshCatalog.reader, currentBundle, issuedState.stored.schemaVersion, freshCatalog.schema);
    if (!bytesEqualFullScan(binding.sha256, issuedState.stored.schemaBindingSha256)) return yield* readinessFailure("schemaBinding");
  }
  if (issuedState.stored.preparationProfile === "finiteEntry") {
    if (repositoryState.context.cold.runtimeHostIdentity !== issuedState.stored.cold.runtimeHostIdentity ||
      repositoryState.context.cold.compatibilityDate !== issuedState.stored.cold.compatibilityDate)
      return yield* readinessFailure("authorityChanged");
    if (!useProtectedProjection) {
      const replay = yield* loadStoredReadinessAuthority(tx, currentBundle, issuedState.stored.schemaVersion,
        issuedState.stored.schema, issuedState.stored.schemaBindingSha256, issuedState.stored.requirements,
        issuedState.stored.physicalDefinitionLifecycle, issuedState.stored.physicalReadinessSha256,
        repositoryState.context.cold, clock);
      if (replay === null || !bytesEqualFullScan(replay.readinessSha256, issuedState.readinessSha256) ||
        !bytesEqualFullScan(replay.readinessBytes, issuedState.readinessBytes)) return yield* readinessFailure("authorityChanged");
    }
    return Object.freeze({ status: "ready" as const, basis: activationBasis(issuedState) });
  }
  const physical = yield* loadPhysicalReadiness(
    tx,
    currentBundle.authority,
    issuedState.stored.requirements,
    repositoryState.context.physicalDefinitionLifecycle,
    issuedState.stored.physicalDefinitionLifecycle,
    clock,
    checkedActive,
  );
  if (physical.status === "not_ready") {
    return yield* readinessFailure("authorityChanged");
  }
  if (useProtectedProjection) {
    if (repositoryState.context.cold.runtimeHostIdentity !== issuedState.stored.cold.runtimeHostIdentity ||
      repositoryState.context.cold.compatibilityDate !== issuedState.stored.cold.compatibilityDate ||
      !bytesEqualFullScan(physical.physicalReadinessSha256, issuedState.stored.physicalReadinessSha256))
      return yield* readinessFailure("authorityChanged");
    return Object.freeze({ status: "ready", basis: activationBasis(issuedState) });
  }
  const replay = yield* loadStoredReadinessAuthority(
    tx,
    currentBundle,
    issuedState.stored.schemaVersion,
    issuedState.stored.schema,
    issuedState.stored.schemaBindingSha256,
    issuedState.stored.requirements,
    issuedState.stored.physicalDefinitionLifecycle,
    physical.physicalReadinessSha256,
    repositoryState.context.cold,
    clock,
  );
  if (replay === null ||
    !bytesEqualFullScan(
      replay.readinessSha256,
      issuedState.readinessSha256,
    ) || !bytesEqualFullScan(
      replay.readinessBytes,
      issuedState.readinessBytes,
    )) return yield* readinessFailure("authorityChanged");
  return Object.freeze({
    status: "ready",
    basis: activationBasis(issuedState),
  });
}, work => observeExecution("ApplicationReadiness.validateStoredIssuedReadiness", work));

/** Retention never replaces an unprotected catalog proof. Reuse the original
 * catalog owners and the actual accepting client for colocated metadata; a
 * separate control catalog keeps its established bounded reader. */
const validateStoredReadinessControlCatalog = Effect.fn(function* (
  repository: ApplicationReadinessIssuerState, stored: StoredReadinessAuthority,
  bundle: StoredBundle, tx: AppRowTransaction,
) {
  const control = repository.context.controlDb;
  const catalog = stored.target !== undefined && hasLocatedReadCommittedTargetDatabaseV1(stored.target, control) ? tx : undefined;
  const { schema } = yield* repository.context.schema.readPublished({
    deploymentId: bundle.deploymentId, manifest: bundle.manifest,
  }, catalog).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause,
    error => readinessFailureValue("schemaBinding", false, error)))));
  yield* requireSchemaCorrelation(bundle, stored.schemaVersion, schema);
  if (!bytesEqualFullScan(applicationSchemaBindingBytes(schema), applicationSchemaBindingBytes(stored.schema)))
    return yield* readinessFailure("schemaBinding");
  const requirements = yield* loadPublishedPhysicalRequirementSnapshotV1(control,
    { deploymentId: bundle.deploymentId, schemaVersionId: schema.schemaVersionId }, catalog);
  if (requirements === null || !bytesEqualFullScan(requirements.manifestSha256, stored.requirements.manifestSha256) ||
    requirements.definitions.length !== stored.requirements.definitions.length ||
    requirements.definitions.some((definition, index) => {
      const expected = stored.requirements.definitions[index];
      return expected === undefined || definition.tableId !== expected.tableId ||
        !publishedPhysicalDefinitionMatchesLocated(expected, definition);
    })) return yield* readinessFailure("authorityChanged");
  return Object.freeze({ schema, reader: catalog ?? control });
});
