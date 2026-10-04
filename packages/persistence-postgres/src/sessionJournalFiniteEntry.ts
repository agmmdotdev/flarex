/** Package-internal finite entry lifecycle. Only the activation owner confirms these facts. */
import { Effect } from "effect";
import type { AppRowTransaction } from "./appRows";
import { withPreparedFiniteActiveApplicationInTransaction,
  type PreparedFiniteActiveApplication, type AcceptedApplicationBinding, type ApplicationActiveSelection } from "./applicationActivation";
import { requireFiniteReplacementApplicationExecutionAuthority } from "./applicationMutationAdmission";
import { captureFiniteReplacementAttemptInTransactionEffect } from "./transactionSessionActivation";
import { closeProtectedMetadataFinalGuardScope, flushProtectedMetadataFinalGuards,
  openProtectedMetadataFinalGuardScope } from "./preparedMetadataEpoch";
import { LogicalParticipantAdmissionError, type LogicalParticipantAdmissionBundle } from "./logicalDocuments/participantAdmission";
import type { TrustedScopeAuthority } from "./scopeAuthorityResolution";
import type { ExactRunningAttemptKernelContextV1, ExactRunningAttemptKernelInputV1 } from "./transactionSessionAttemptKernel";
import { prepareFiniteTerminalControlEffect, type PreparedTerminalControl, type StoredCommitAuthorityEvidenceLoaderPortsV1 } from "./storedCommitAuthority/postgresLoader";
import type { CapturedRowsV1 } from "./storedCommitAuthority/materialization";
import type { StoredOccExecutionEvidenceAuthorityV1 } from "./storedOccExecution/model";
import { SessionJournalPersistenceV1Error, type SessionJournalAttempt, type SessionJournalAttemptStateV1,
  type SessionJournalStorePersistence, type SessionJournalParticipantSelection, type FiniteRootAttemptState,
  type ResolvedJournalTargetV1 } from "./sessionJournalStore";
export const preparedFiniteSessionJournalEntryBrand: unique symbol = Symbol("Flarex/PreparedFiniteSessionJournalEntry");
const confirmedFiniteRootEntryCaptureBrand: unique symbol = Symbol("Flarex/ConfirmedFiniteRootEntryCapture");
export interface PreparedFiniteSessionJournalEntry { readonly [preparedFiniteSessionJournalEntryBrand]: true }
export interface ConfirmedFiniteRootEntryCapture { readonly [confirmedFiniteRootEntryCaptureBrand]: true }
export type FiniteSessionJournalParticipantSelection = Omit<SessionJournalParticipantSelection, "sources"> & {
  readonly sources: readonly Omit<SessionJournalParticipantSelection["sources"][number], "application">[];
};
export type FiniteEntryFailure = Effect.Error<ReturnType<SessionJournalStorePersistence["openAttemptEffect"]>>;
interface FiniteEntryTransactionCapture {
  readonly applicationSelection: ApplicationActiveSelection;
  readonly issuedAdmissions: ReadonlyMap<string, LogicalParticipantAdmissionBundle>;
  readonly finiteKey: string;
  readonly preliminaryAuthority: TrustedScopeAuthority;
  readonly state: SessionJournalAttemptStateV1;
  readonly context: ExactRunningAttemptKernelContextV1;
  readonly rows: CapturedRowsV1;
  readonly finite: FiniteRootAttemptState;
}
interface PreparedFiniteEntryState {
  readonly issuer: StoredCommitAuthorityEvidenceLoaderPortsV1;
  readonly handle: SessionJournalAttempt;
  status: "prepared" | "running" | "confirmed" | "abandoned";
  capture?: FiniteEntryTransactionCapture;
  readonly run: (tx: AppRowTransaction, context: ExactRunningAttemptKernelContextV1,
    resolved: ResolvedJournalTargetV1, application: ApplicationActiveSelection, binding: AcceptedApplicationBinding,
    control: PreparedTerminalControl | undefined, verifyFinalRows: Effect.Effect<void, SessionJournalPersistenceV1Error>) =>
    Effect.Effect<FiniteEntryTransactionCapture, FiniteEntryFailure>;
  readonly install: (capture: FiniteEntryTransactionCapture) => void;
  readonly discard: (capture: FiniteEntryTransactionCapture) => void;
  readonly release: () => void;
}
interface ConfirmedFiniteEntryState {
  readonly applicationSelection: ApplicationActiveSelection;
  readonly preliminaryAuthority: TrustedScopeAuthority;
  readonly issuer: StoredCommitAuthorityEvidenceLoaderPortsV1;
  readonly preparation: PreparedFiniteSessionJournalEntry;
  readonly attempt: SessionJournalAttempt;
  readonly context: ExactRunningAttemptKernelContextV1;
  readonly rows: CapturedRowsV1;
  readonly admissions: ReadonlyMap<string, LogicalParticipantAdmissionBundle>;
}
export const preparedFiniteEntries = new WeakMap<PreparedFiniteSessionJournalEntry, PreparedFiniteEntryState>();
export const confirmedFiniteEntries = new WeakMap<ConfirmedFiniteRootEntryCapture, ConfirmedFiniteEntryState>();

export function abandonPreparedFiniteSessionJournalEntry(entry: PreparedFiniteSessionJournalEntry): void {
  const state = preparedFiniteEntries.get(entry);
  if (state !== undefined && (state.status === "prepared" || state.status === "running")) {
    state.status = "abandoned";
    if (state.capture !== undefined) state.discard(state.capture);
    state.release();
  }
}

export const prepareFiniteSessionJournalEntryControlEffect = Effect.fn("SessionJournalStore.prepareFiniteEntryControl")(
  function* (entry: PreparedFiniteSessionJournalEntry, authority: StoredOccExecutionEvidenceAuthorityV1,
    session: Parameters<typeof prepareFiniteTerminalControlEffect>[2], application: PreparedFiniteActiveApplication) {
    const state = preparedFiniteEntries.get(entry);
    if (state?.status !== "prepared") return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    return yield* prepareFiniteTerminalControlEffect(state.issuer, authority, session, application).pipe(Effect.mapError(cause =>
      new SessionJournalPersistenceV1Error({ operation: "openAttempt", cause })));
  });

export const runPreparedFiniteSessionJournalEntryEffect = Effect.fn("SessionJournalStore.enterFiniteInActivation")(
  function* (entry: PreparedFiniteSessionJournalEntry, tx: AppRowTransaction,
    context: ExactRunningAttemptKernelContextV1, resolved: ResolvedJournalTargetV1,
    application: ApplicationActiveSelection, binding: AcceptedApplicationBinding, control: PreparedTerminalControl | undefined,
    verifyFinalRows: Effect.Effect<void, SessionJournalPersistenceV1Error>) {
    const state = preparedFiniteEntries.get(entry);
    if (state?.status !== "prepared") return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    state.status = "running";
    const capture = yield* state.run(tx, context, resolved, application, binding, control, verifyFinalRows);
    state.capture = capture;
    return capture;
  });

/** Replacement uses the original entry issuer in the transaction creating its fresh claim. */
export const runPreparedFiniteReplacementSessionJournalEntryEffect = Effect.fn(
  "SessionJournalStore.enterFiniteReplacementInTransaction",
)(function* (entry: PreparedFiniteSessionJournalEntry, application: PreparedFiniteActiveApplication,
  tx: AppRowTransaction, input: ExactRunningAttemptKernelInputV1, resolved: ResolvedJournalTargetV1) {
  openProtectedMetadataFinalGuardScope(tx);
  return yield* Effect.gen(function* () {
    const fresh = yield* captureFiniteReplacementAttemptInTransactionEffect(tx, input);
    return yield* withPreparedFiniteActiveApplicationInTransaction(application, tx, fresh.context.scopeClock,
      (accepted, binding) => Effect.gen(function* () {
        yield* requireFiniteReplacementApplicationExecutionAuthority(accepted.basis, fresh.executionAuthority);
        const { anchor, executionPin } = fresh.context;
        const control = yield* prepareFiniteSessionJournalEntryControlEffect(entry, {
          kind: "claimedAttempt", deploymentId: anchor.deploymentId, scopeId: anchor.scopeId,
          scopeUuid: fresh.context.scopeUuid, sessionId: anchor.sessionId, attemptFence: anchor.attemptFence,
          storageGeneration: anchor.storageGeneration, storageGenerationFence: anchor.storageGenerationFence,
          snapshotToken: anchor.snapshotToken, schemaVersionId: executionPin.schemaVersionId,
          executionClaim: input.executionClaim,
        }, fresh.applicationSelector, application);
        const capture = yield* runPreparedFiniteSessionJournalEntryEffect(entry, tx, fresh.context,
          resolved, accepted.selection, binding, control, fresh.verifyFinalRows.pipe(Effect.mapError(cause =>
            new SessionJournalPersistenceV1Error({ operation: "openAttempt", cause }))));
        yield* fresh.verifyFinalRows;
        yield* flushProtectedMetadataFinalGuards(tx);
        return capture;
      })).pipe(Effect.ensuring(Effect.sync(fresh.close)));
  }).pipe(Effect.ensuring(Effect.sync(() => closeProtectedMetadataFinalGuardScope(tx))));
});

/** The activation owner calls this only after its transaction has confirmed COMMIT. */
export function confirmPreparedFiniteSessionJournalEntry(entry: PreparedFiniteSessionJournalEntry,
  capture: FiniteEntryTransactionCapture): ConfirmedFiniteRootEntryCapture {
  const state = preparedFiniteEntries.get(entry);
  if (state?.status !== "running" || state.capture !== capture) throw new Error("Finite entry confirmation requires its original preparation and captured transaction.");
  state.install(capture);
  state.status = "confirmed";
  state.release();
  const handle = Object.freeze({ [confirmedFiniteRootEntryCaptureBrand]: true as const });
  confirmedFiniteEntries.set(handle, Object.freeze({ issuer: state.issuer, preparation: entry,
    attempt: state.handle, preliminaryAuthority: capture.preliminaryAuthority, context: capture.context, rows: capture.rows,
    admissions: capture.issuedAdmissions, applicationSelection: capture.applicationSelection }));
  return handle;
}

export function readConfirmedFiniteRootEntryCapture(handle: ConfirmedFiniteRootEntryCapture,
  issuer: StoredCommitAuthorityEvidenceLoaderPortsV1) {
  const state = typeof handle === "object" && handle !== null ? confirmedFiniteEntries.get(handle) : undefined;
  return state?.issuer === issuer ? Object.freeze({ preliminaryAuthority: structuredClone(state.preliminaryAuthority),
    context: structuredClone(state.context), rows: structuredClone(state.rows) }) : undefined;
}
