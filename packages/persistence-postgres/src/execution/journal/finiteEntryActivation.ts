/** Package-internal finite entry lifecycle. Only the activation owner confirms these facts. */
import { Effect, Result } from "effect";
import type {
  CanonicalApplicationMutationExecutionAuthorityV1,
} from "flarex-protocol/internal/application-mutation-authority-v1";
import type { AppRowTransaction } from "../../storage/documents/appRows";
import {
  withPreparedFiniteReplacementApplicationInTransaction,
  withPreparedRecoveredFiniteApplicationInTransaction,
} from "../../application/activation/finitePreparation";
import {
  requirePreparedFiniteApplicationSelection,
} from "../../application/activation/finiteIdentity";
import {
  type PreparedFiniteActiveApplication,
  type AcceptedApplicationBinding,
  type ApplicationActiveSelection,
} from "../../application/activation/contracts";
import {
  type ApplicationActivationError,
} from "../../application/activation/errors";
import {
  ApplicationMutationAdmissionError,
  requireFiniteReplacementApplicationExecutionAuthority,
} from "../../application/applicationMutationAdmission";
import {
  captureFiniteReplacementAttemptInTransactionEffect,
  acceptFiniteEntryForContinuationInTransactionEffect,
} from "../transactionSessionActivation";
import {
  closeProtectedMetadataFinalGuardScope,
  flushProtectedMetadataFinalGuards,
  openProtectedMetadataFinalGuardScope,
  registerManagedMetadataSnapshotFinalGuard,
} from "../preparation/preparedMetadataEpoch";
import { readAdmittedCoLocatedInstallationPair } from "../../installation/installationLifecycle";
import {
  LogicalParticipantAdmissionError,
} from "../../storage/documents/logicalDocuments/participantErrors";
import {
  captureAppSchemaCandidateWriteGuardPlanningHeadInTransactionEffect,
} from "../../storage/catalog/appSchemaCandidateValidation";
import type {
  FiniteEntryAttemptKernelContext,
  ExactRunningAttemptKernelInputV1,
} from "../transactionSessionAttemptKernel";
import {
  prepareFiniteTerminalControlEffect,
  type PreparedFiniteTerminalControl,
} from "../../commit/authority/postgresLoader";
import type { StoredOccExecutionEvidenceAuthorityV1 } from "../occ/model";
import {
  getFiniteAttemptMetadataProjection,
} from "../../storage/documents/logicalDocuments/sourceAdmission";
import type { FiniteEntryObservation } from "../finiteEntryObservation";
import { SessionJournalPersistenceV1Error } from "./errors";
import type { ResolvedJournalTargetV1 } from "./state";
import {
  readPreparedFiniteEntryIssuer,
  retainPreparedFiniteEntryControl,
  readRunningFiniteEntryControl,
  runPreparedFiniteEntryCaptureEffect,
  claimRunningFiniteEntryCapture,
  replaceFiniteEntryContinuationCapture,
  readOriginalFiniteExecutionAuthority,
  type PreparedFiniteSessionJournalEntry,
  type FiniteEntryTransactionCapture,
  type FiniteReplacementOrigin,
} from "./finiteEntry";

export const prepareFiniteSessionJournalEntryControlEffect = Effect.fn("SessionJournalStore.prepareFiniteEntryControl")(
  function* (entry: PreparedFiniteSessionJournalEntry, authority: StoredOccExecutionEvidenceAuthorityV1,
    session: Parameters<typeof prepareFiniteTerminalControlEffect>[2], application: PreparedFiniteActiveApplication) {
    const issuer = yield* Effect.fromResult(readPreparedFiniteEntryIssuer(entry));
    const projection = yield* prepareFiniteTerminalControlEffect(issuer, authority, session, application).pipe(Effect.mapError(cause =>
      new SessionJournalPersistenceV1Error({ operation: "openAttempt", cause })));
    return yield* Effect.fromResult(retainPreparedFiniteEntryControl(entry, application, projection));
  });

/** The journal consumes only the exact control lent to its original preparation.
 * It checks this at the former schema-read boundary after participant admission,
 * preserving refusal order and open Application lifetime. */
export function readPreparedFiniteSessionJournalEntrySchema(entry: PreparedFiniteSessionJournalEntry,
  application: ApplicationActiveSelection, control: PreparedFiniteTerminalControl): Result.Result<PreparedFiniteTerminalControl,
    LogicalParticipantAdmissionError | ApplicationActivationError> {
  return readRunningFiniteEntryControl(entry, control).pipe(Result.flatMap(original =>
    requirePreparedFiniteApplicationSelection(original, application)), Result.map(() => control));
}

export const runPreparedFiniteSessionJournalEntryEffect = Effect.fn("SessionJournalStore.enterFiniteInActivation")(
  function* (entry: PreparedFiniteSessionJournalEntry, tx: AppRowTransaction,
    context: FiniteEntryAttemptKernelContext, resolved: ResolvedJournalTargetV1,
    application: ApplicationActiveSelection, binding: AcceptedApplicationBinding, control: PreparedFiniteTerminalControl | undefined,
    canonicalExecutionAuthority: CanonicalApplicationMutationExecutionAuthorityV1,
    verifyFinalRows: Effect.Effect<void, SessionJournalPersistenceV1Error>, observation?: FiniteEntryObservation) {
    const { capture, issuer } = yield* runPreparedFiniteEntryCaptureEffect(entry, tx, context, resolved,
      application, binding, control, canonicalExecutionAuthority, verifyFinalRows, observation);
    const candidatePlanningHead = yield* captureAppSchemaCandidateWriteGuardPlanningHeadInTransactionEffect(tx,
      resolved.authority, issuer, observation).pipe(Effect.mapError(cause => new SessionJournalPersistenceV1Error({ operation: "openAttempt", cause })));
    capture.finite.candidatePlanningHead = candidatePlanningHead;
    return capture;
  });

/** This operation consumes only the current uncommitted capture of the entry's
 * original issuer. Confirmation still belongs after acknowledged COMMIT. */
export const acceptPreparedFiniteSessionJournalEntryForContinuationEffect = Effect.fn("SessionJournalStore.acceptFiniteContinuation")(
  function* (entry: PreparedFiniteSessionJournalEntry, tx: AppRowTransaction, capture: FiniteEntryTransactionCapture) {
    const claim = yield* Effect.fromResult(claimRunningFiniteEntryCapture(entry, capture));
    const projection = getFiniteAttemptMetadataProjection(capture.finite.metadata, claim.attempt);
    if (projection === null) return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    const context = yield* acceptFiniteEntryForContinuationInTransactionEffect(tx, capture.context, capture.finite.anchorCapture, projection).pipe(
      Effect.mapError(cause => new SessionJournalPersistenceV1Error({ operation: "openAttempt", cause })));
    // The issued attempt state owns the native read closures and finite-root
    // registration. Its claim pin contains only immutable owner/fence; renewed
    // deadlines belong to the accepted context, not another state identity.
    return yield* Effect.fromResult(replaceFiniteEntryContinuationCapture(entry, capture, context));
  });

/** Replacement uses the original entry issuer in the transaction creating its fresh claim. */
export const runPreparedFiniteReplacementSessionJournalEntryEffect = Effect.fn(
  "SessionJournalStore.enterFiniteReplacementInTransaction",
)(function* (entry: PreparedFiniteSessionJournalEntry, application: PreparedFiniteActiveApplication,
  tx: AppRowTransaction, input: ExactRunningAttemptKernelInputV1, resolved: ResolvedJournalTargetV1,
  origin: FiniteReplacementOrigin,
  observeAdmissionRefusal?: (failure: ApplicationMutationAdmissionError) => void) {
  openProtectedMetadataFinalGuardScope(tx);
  return yield* Effect.gen(function* () {
    const issuer = yield* Effect.fromResult(readPreparedFiniteEntryIssuer(entry));
    const original = origin.kind === "frozen" ? readOriginalFiniteExecutionAuthority(origin.originalEntry, issuer) : undefined;
    if (origin.kind === "frozen" && original === undefined)
      return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    const pair = yield* Effect.fromResult(readAdmittedCoLocatedInstallationPair(tx));
    if (pair !== null) {
      yield* registerManagedMetadataSnapshotFinalGuard(tx, pair.database, pair.target);
      yield* registerManagedMetadataSnapshotFinalGuard(tx, pair.database, pair.control);
    }
    const fresh = yield* captureFiniteReplacementAttemptInTransactionEffect(tx, input, original);
    const accept = (accepted: Readonly<{ selection: ApplicationActiveSelection; basis: import("../../application/activation/contracts").ApplicationActiveSelectionBasis }>,
      binding: AcceptedApplicationBinding) => Effect.gen(function* () {
        yield* requireFiniteReplacementApplicationExecutionAuthority(accepted.basis, fresh.executionAuthority).pipe(
          Effect.tapError(failure => failure instanceof ApplicationMutationAdmissionError
            ? Effect.sync(() => observeAdmissionRefusal?.(failure)) : Effect.void));
        const { anchor, executionPin } = fresh.context;
        const control = yield* prepareFiniteSessionJournalEntryControlEffect(entry, {
          kind: "claimedAttempt", deploymentId: anchor.deploymentId, scopeId: anchor.scopeId,
          scopeUuid: fresh.context.scopeUuid, sessionId: anchor.sessionId, attemptFence: anchor.attemptFence,
          storageGeneration: anchor.storageGeneration, storageGenerationFence: anchor.storageGenerationFence,
          snapshotToken: anchor.snapshotToken, schemaVersionId: executionPin.schemaVersionId,
          executionClaim: input.executionClaim,
        }, fresh.applicationSelector, application);
        const capture = yield* runPreparedFiniteSessionJournalEntryEffect(entry, tx, fresh.context,
          resolved, accepted.selection, binding, control, fresh.canonicalExecutionAuthority, fresh.verifyFinalRows.pipe(Effect.mapError(cause =>
            new SessionJournalPersistenceV1Error({ operation: "openAttempt", cause }))));
        yield* fresh.verifyFinalRows;
        yield* flushProtectedMetadataFinalGuards(tx);
        return yield* acceptPreparedFiniteSessionJournalEntryForContinuationEffect(entry, tx, capture);
      });
    return yield* (origin.kind === "frozen"
      ? withPreparedFiniteReplacementApplicationInTransaction(application, tx, fresh.context.scopeClock, origin.originalEntry, issuer, accept)
      : withPreparedRecoveredFiniteApplicationInTransaction(application, tx, fresh.context.scopeClock, accept))
      .pipe(Effect.ensuring(Effect.sync(fresh.close)));
  }).pipe(Effect.ensuring(Effect.sync(() => closeProtectedMetadataFinalGuardScope(tx))));
});
