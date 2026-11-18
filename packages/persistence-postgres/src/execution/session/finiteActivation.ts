import {
  readPreparedFiniteApplicationMutationActivationInputs,
  withPreparedFiniteApplicationMutationAdmissionInTransaction,
} from "../../application/applicationMutationAdmission";
import type { FlarexMetadataDatabase } from "../../application/deployments";
import { runPointCommitPromiseEffect } from "../../commit/point/promiseBoundary";
import {
  INSTALLED_SCOPE_AUTHORITY_TARGET,
  type PreparedInstalledAttemptScopeAuthority,
} from "../../scope/scopeAuthorityControlRead";
import {
  resolveLocatedTrustedScopeAuthorityByIdEffect,
} from "../../scope/scopeAuthorityResolution";
import {
  closeExactAttemptScopeClockObservation,
  closeFiniteExecutionAuthorityObservation,
  openExactAttemptScopeClockObservation,
} from "../../scope/scopeClock";
import type { AppRowTransaction } from "../../storage/documents/appRows";
import {
  captureFiniteEntryObservationInTransactionEffect,
  closeFiniteEntryObservation,
  type FiniteEntryObservation,
} from "../finiteEntryObservation";
import { SessionJournalPersistenceV1Error } from "../journal/errors";
import {
  abandonPreparedFiniteSessionJournalEntry,
  confirmPreparedFiniteSessionJournalEntry,
  type PreparedFiniteSessionJournalEntry,
} from "../journal/finiteEntry";
import {
  acceptPreparedFiniteSessionJournalEntryForContinuationEffect,
  prepareFiniteSessionJournalEntryControlEffect,
  runPreparedFiniteSessionJournalEntryEffect,
} from "../journal/finiteEntryActivation";
import {
  closeProtectedMetadataFinalGuardScope,
  openProtectedMetadataFinalGuardScope,
  registerProtectedMetadataTransactionFinalGuard,
  type ProtectedMetadataPreparation,
} from "../preparation/preparedMetadataEpoch";
import {
  decodeLockedPointMutationSessionClock,
  lockPointMutationSessionClock,
  requireStableAuthority,
} from "./attemptAuthority";
import {
  ACTIVATE_FINITE_APPLICATION_MUTATION_SESSION_EFFECT,
  requireActivationTarget,
  type LocatedPointMutationSessionActivationInputV1,
  type LocatedPointMutationSessionActivationTargetOptionsV1,
  type PointMutationSessionActivationResolutionPortsV1,
} from "./constructionContracts";
import type {
  ApplicationMutationSessionActivationPersistenceV1,
  PreparedFiniteApplicationMutationSessionActivation,
} from "./contracts";
import { replayExistingSession } from "./durableActivation";
import {
  activationError,
  corruptionError,
} from "./errors";
import {
  mapActivationAuthorityError,
  mapActivationTransactionError,
  mapApplicationActivationTransactionError,
} from "./errorProjections";
import {
  closeFiniteEntryAnchorExpectation,
  prepareProvisionalFiniteSessionEffect,
  requireCorrelatedFiniteEntryEffect,
} from "./finiteSession";
import {
  activationResult,
  capturePreparedApplicationActivationFromBasis,
  generateExecutionClaimOwnerEffect,
  generateSessionIdEffect,
} from "./inputCapture";
import type { LocatedExactRunningAttemptKernelV1 } from "./kernelContracts";
import { Effect } from "effect";

export const finiteApplicationActivationOperation = Effect.fn("ApplicationMutationSessionActivation.enterFiniteInTransaction")(function* (
    tx: AppRowTransaction, operationInput: Readonly<{
      input: LocatedPointMutationSessionActivationInputV1;
      prepared: PreparedFiniteApplicationMutationSessionActivation;
      entry: PreparedFiniteSessionJournalEntry;
      target: LocatedExactRunningAttemptKernelV1;
      afterWrite: LocatedPointMutationSessionActivationTargetOptionsV1["afterWrite"];
      managedControlProtection?: ProtectedMetadataPreparation;
      database: FlarexMetadataDatabase;
      installedAuthority?: PreparedInstalledAttemptScopeAuthority;
    }>) {
    const { input, prepared, entry, target, afterWrite } = operationInput;
    const clock = operationInput.installedAuthority === undefined ? yield* Effect.tryPromise({
      try: () => lockPointMutationSessionClock(tx, input.prepared.scopeId), catch: mapActivationTransactionError,
    }) : decodeLockedPointMutationSessionClock((yield* operationInput.installedAuthority.lock(tx, {
      deploymentId: input.prepared.deploymentId, scopeId: input.prepared.scopeId }, "attempt").pipe(
        Effect.mapError(mapApplicationActivationTransactionError))).row);
    yield* Effect.fromResult(requireStableAuthority(clock, input));
    openExactAttemptScopeClockObservation(tx, clock.record, clock.authorizationRevocationEpoch, "attempt");
    let observation: FiniteEntryObservation | null = null;
    return yield* Effect.gen(function* () {
    const observed = yield* captureFiniteEntryObservationInTransactionEffect(tx,
      input.preliminaryAuthority.physicalLocator.schemaName, clock.record, clock.scopeUuid,
      clock.record.storageGeneration, input.prepared.evidence.requestKey).pipe(Effect.mapError(mapApplicationActivationTransactionError));
    observation = observed.observation;
    if (observed.sessions.length > 1) return yield* Effect.fail(corruptionError(input.prepared.scopeId, "duplicateRequestAnchors"));
    const historical = observed.sessions[0];
    if (historical !== undefined) {
      const replay = yield* runPointCommitPromiseEffect(
        () => replayExistingSession(tx, input.prepared, clock, historical, observed.databaseNow), mapActivationTransactionError);
      return Object.freeze({ activation: replay });
    }
    if (observation === null) return yield* Effect.fail(corruptionError(input.prepared.scopeId, "sessionRecordInvalid"));
    const finiteEntry = observation;
    openProtectedMetadataFinalGuardScope(tx);
    return yield* Effect.gen(function* () {
    if (operationInput.installedAuthority !== undefined)
      yield* operationInput.installedAuthority.registerFinalGuards(tx,
        { deploymentId: input.prepared.deploymentId, scopeId: input.prepared.scopeId }, "attempt")
        .pipe(Effect.mapError(mapApplicationActivationTransactionError));
    return yield* withPreparedFiniteApplicationMutationAdmissionInTransaction(
      prepared.preparedAdmission, prepared.admissionContext, tx, clock.record, (accepted, binding) => Effect.gen(function* () {
      if (operationInput.managedControlProtection !== undefined)
        yield* registerProtectedMetadataTransactionFinalGuard(operationInput.managedControlProtection, operationInput.database, tx)
          .pipe(Effect.mapError(mapApplicationActivationTransactionError));
      if (operationInput.installedAuthority === undefined && clock.record.lastCommitSeq !== input.preliminaryAuthority.lastCommitSeq)
        return yield* Effect.fail(activationError({ reason: "snapshotCommitSeqChanged" }));
      const created = yield* prepareProvisionalFiniteSessionEffect(tx, input, clock, afterWrite,
        operationInput.installedAuthority !== undefined, observed.databaseNow);
      const { context } = created;
      const inputs = yield* Effect.fromResult(readPreparedFiniteApplicationMutationActivationInputs(prepared.preparedAdmission, prepared.admissionContext));
      const authority = inputs.executionAuthority.authority;
      const entryControl = yield* prepareFiniteSessionJournalEntryControlEffect(entry, {
        kind: "claimedAttempt", deploymentId: input.prepared.deploymentId, scopeId: input.prepared.scopeId,
        scopeUuid: context.scopeUuid, sessionId: context.anchor.sessionId, attemptFence: context.anchor.attemptFence,
        storageGeneration: context.anchor.storageGeneration, storageGenerationFence: context.anchor.storageGenerationFence,
        snapshotToken: context.anchor.snapshotToken, schemaVersionId: context.executionPin.schemaVersionId,
        executionClaim: context.executionClaim,
      }, { executionAuthorityGeneration: "application_v1", applicationExecutionAuthorityFormat: authority.format,
        applicationExecutionAuthorityVersionText: String(authority.version), applicationExecutionAuthorityActivationSequence: authority.activationSequence,
        applicationExecutionAuthorityRevisionId: authority.runtimeTarget.revisionId,
        applicationExecutionAuthorityFunctionPath: authority.runtimeTarget.function.path,
        applicationExecutionAuthoritySchemaSha256: authority.runtimeTarget.schemaSha256 }, inputs.application);
      let capture = yield* runPreparedFiniteSessionJournalEntryEffect(entry, tx, context,
        { authority: { ...input.preliminaryAuthority, ...clock.record }, target }, accepted.selection, binding, entryControl,
        inputs.executionAuthority,
        requireCorrelatedFiniteEntryEffect(tx, input.prepared.scopeId).pipe(Effect.mapError(cause =>
          new SessionJournalPersistenceV1Error({ operation: "openAttempt", cause }))), finiteEntry);
      capture = yield* acceptPreparedFiniteSessionJournalEntryForContinuationEffect(entry, tx, capture);
      return Object.freeze({ activation: activationResult("created", capture.context.anchor, capture.context.executionClaim), capture });
    }), finiteEntry, prepared.currentEntry);
    }).pipe(Effect.ensuring(Effect.sync(() => {
      closeProtectedMetadataFinalGuardScope(tx);
      closeFiniteExecutionAuthorityObservation(tx);
      closeFiniteEntryAnchorExpectation(tx);
    })));
    }).pipe(Effect.ensuring(Effect.sync(() => {
      closeFiniteEntryObservation(observation);
      closeExactAttemptScopeClockObservation(tx);
    })));
  });

export function createFiniteApplicationMutationSessionActivationOperation(
  ports: PointMutationSessionActivationResolutionPortsV1,
  leaseDurationMilliseconds: number,
  executionClaimDurationMilliseconds: number,
  randomUuid: () => string,
  randomExecutionClaimOwner: () => string,
): ApplicationMutationSessionActivationPersistenceV1["activateFiniteEffect"] {
  const activateFiniteEffect: ApplicationMutationSessionActivationPersistenceV1["activateFiniteEffect"] =
    Effect.fn(function* (input, entry) {
      return yield* Effect.gen(function* () {
        const inputs = yield* Effect.fromResult(readPreparedFiniteApplicationMutationActivationInputs(input.preparedAdmission, input.admissionContext));
        const prepared = yield* capturePreparedApplicationActivationFromBasis({ ...input, executionProfile: "finiteRoot" }, inputs.basis,
          inputs.executionAuthority);
        const candidateSessionId = yield* generateSessionIdEffect(randomUuid);
        const executionClaimOwner = yield* generateExecutionClaimOwnerEffect(randomExecutionClaimOwner);
        const preparedTarget = yield* Effect.tryPromise({ try: () => ports.scopeSessionTargets.resolve(inputs.basis.authority.physicalLocator),
          catch: mapActivationTransactionError });
        const located = Reflect.get(preparedTarget, INSTALLED_SCOPE_AUTHORITY_TARGET) === true
          ? { target: preparedTarget, authority: inputs.basis.authority }
          : yield* resolveLocatedTrustedScopeAuthorityByIdEffect({ deploymentId: input.deploymentId, scopeId: input.scopeId }, {
          scopeMetadata: ports.scopeMetadata, provisioningReceipts: ports.provisioningReceipts, scopeClockTargets: ports.scopeSessionTargets,
        }).pipe(Effect.mapError(mapActivationAuthorityError));
        const target = yield* Effect.fromResult(requireActivationTarget(located.target, input.scopeId));
        const result = yield* target[ACTIVATE_FINITE_APPLICATION_MUTATION_SESSION_EFFECT]({ prepared: prepared.activation,
          preliminaryAuthority: located.authority, candidateSessionId, leaseDurationMilliseconds,
          executionClaimDurationMilliseconds, executionClaimOwner }, input, entry);
        if (result.capture === undefined) {
          abandonPreparedFiniteSessionJournalEntry(entry);
          return Object.freeze({ activation: result.activation });
        }
        return Object.freeze({ activation: result.activation,
          entry: confirmPreparedFiniteSessionJournalEntry(entry, result.capture) });
      }).pipe(Effect.onError(() => Effect.sync(() => abandonPreparedFiniteSessionJournalEntry(entry))));
    });
  return activateFiniteEffect;
}
