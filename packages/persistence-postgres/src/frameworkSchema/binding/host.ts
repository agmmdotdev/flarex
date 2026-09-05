import { Effect, Option, Result } from "effect";
import type { FlarexMetadataDatabase } from "../../deployments";
import type { FlarexMetadataTransaction } from "../../metadataTransaction";
import {
  hasApplicationBindingComposition,
  type ApplicationBindingSelectionReader,
} from "../../applicationActivation";
import { readApplicationBindingProjectionInTransaction } from "../../applicationBindingProjection";
import {
  captureTrustedScopeAuthorityResolutionPorts,
  resolveLocatedTrustedScopeAuthorityEffect,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityResolutionPorts,
} from "../../scopeAuthorityResolution";
import { lockScopeClockForUpdateInTransactionEffect } from "../../scopeClock";
import { runLocatedReadCommittedEffect } from "../../locatedReadCommittedEffect";
import {
  hasLocatedReadCommittedTargetDatabaseV1,
  LocatedReadCommittedTransactionFailureV1,
  type LocatedReadCommittedAttemptTargetV1,
} from "../../transactionSessionAttemptKernel";
import {
  frameworkMigrationTargetSnapshot,
  hasFrameworkMigrationTargetDatabase,
  type FrameworkMigrationTarget,
} from "../../migrationCoordination/targetSession";
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
  writeBindingActivation,
  type StoredBindingValue,
} from "./repository";
import { verifyBindingLanes } from "./evidence";
import { admitSyntheticBindingInTransaction, captureSyntheticBindingReference } from "./syntheticAdmission";
import {
  withAdmittedDataBinding,
  readAdmittedDataBinding,
  withSyntheticTestSelection,
  type AdmittedDataBinding,
  type SyntheticTestSelection,
} from "./selection";
import type { DataBindingTestProfiles } from "./profiles";
import { scopePhysicalLocatorsEqual } from "../../scopePhysicalLocator";
import type { ApplicationBindingReference, DataBindingSetFrame } from "./model";

export type DataBindingFailure<ApplicationFailure> =
  | ApplicationFailure
  | DataBindingError
  | Effect.Error<ReturnType<typeof resolveLocatedTrustedScopeAuthorityEffect>>
  | Effect.Error<ReturnType<typeof lockScopeClockForUpdateInTransactionEffect>>
  | Effect.Error<
      ReturnType<typeof readApplicationBindingProjectionInTransaction>
    >
  | Effect.Error<ReturnType<typeof verifyBindingLanes>>;
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
  readonly database: FlarexMetadataDatabase;
  readonly deploymentId: string;
  readonly target: FrameworkMigrationTarget;
  readonly authority: TrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1>;
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
    !hasFrameworkMigrationTargetDatabase(input.target, input.database)
  )
    return yield* Effect.fail(bindingError("invalidAuthority"));
  const snapshot = frameworkMigrationTargetSnapshot(input.target);
  if (
    snapshot === undefined ||
    snapshot.namespace.frame.deploymentId !== input.deploymentId
  )
    return yield* Effect.fail(bindingError("placementMismatch"));
  const database = input.database;
  const target = input.target;
  const deploymentId = input.deploymentId;
  const authorityPorts = captureTrustedScopeAuthorityResolutionPorts(
    input.authority,
  );
  const application = input.application;
  const profiles = input.testOnly?.profiles;
  const syntheticEnabled = input.testOnly?.syntheticSelection === true;
  const afterAcceptance = input.testOnly?.afterAcceptance;

  const resolve = Effect.fn("DataBindingHost.resolve")(function* () {
    const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
      deploymentId,
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
    ) =>
      runLocatedReadCommittedEffect(
        located.target,
        {
          rollbackMessage: "Data binding transaction rollback",
          cleanupDefect: (cause) => bindingError("resourceFailure", cause),
        },
        (tx) => work(tx, located.authority),
      ).pipe(
        Effect.mapError((error): Failure | DataBindingError =>
          error instanceof LocatedReadCommittedTransactionFailureV1
            ? bindingError(
                error.issue.kind === "decisionUncertain"
                  ? "decisionUncertain"
                  : "resourceFailure",
                error,
              )
            : error,
        ),
      ),
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
    const active = yield* application.readActive();
    return yield* run(located, (tx, authority) =>
      Effect.gen(function* () {
        const clock = yield* lockScope(tx, authority);
        const projection = yield* readApplicationBindingProjectionInTransaction(
          active.selection,
          tx,
          clock,
        );
        if (!sameBindingValue(projection, candidate.frame.application))
          return yield* Effect.fail(bindingError("staleApplication"));
        const verified = yield* verifyBindingLanes(
          tx,
          candidate.frame,
          database,
          target,
          snapshot,
          profiles,
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
      readBindingHead(tx, authority, false),
    );
    if (Option.isNone(hint))
      return yield* Effect.fail(bindingError("missingDependency"));
    const active = yield* application.readActive();
    return yield* run(located, (tx, authority) =>
      Effect.gen(function* () {
        const clock = yield* lockScope(tx, authority);
        const projection = yield* readApplicationBindingProjectionInTransaction(
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
        if (!sameBindingValue(projection, candidate.value.frame.application))
          return yield* Effect.fail(bindingError("staleApplication"));
        yield* verifyBindingLanes(
          tx,
          candidate.value.frame,
          database,
          target,
          snapshot,
          profiles,
        );
        const current = yield* readBindingHead(tx, authority, true);
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
        const projection = yield* readApplicationBindingProjectionInTransaction(
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
        if (!sameBindingValue(candidate.value.frame.application, projection))
          return yield* Effect.fail(bindingError("staleApplication"));
        yield* verifyBindingLanes(
          tx,
          candidate.value.frame,
          database,
          target,
          snapshot,
          profiles,
        );
        const current = yield* readBindingHead(tx, authority, true);
        const matches = Option.isNone(current)
          ? request.expectedHead === null
          : request.expectedHead !== null &&
            current.value.sha256 === request.expectedHead.sha256 &&
            current.value.frame.sequence === request.expectedHead.sequence;
        if (!matches) return yield* Effect.fail(bindingError("concurrentHead"));
        const written = yield* writeBindingActivation(tx, request);
        if (afterAcceptance !== undefined) yield* afterAcceptance();
        return written;
      }),
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
