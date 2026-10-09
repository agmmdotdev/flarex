/** Package-internal finite entry lifecycle. Only the activation owner confirms these facts. */
import { Effect, Result } from "effect";
import { getTableColumns } from "drizzle-orm";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { isJson, type Json } from "flarex-protocol/json";
import { fxSystemTransactionSessions } from "./schema";
import type { CanonicalApplicationMutationExecutionAuthorityV1 } from "flarex-protocol/internal/application-mutation-authority-v1";
import type { AppRowTransaction } from "./appRows";
import { withPreparedFiniteReplacementApplicationInTransaction, withPreparedRecoveredFiniteApplicationInTransaction, requirePreparedFiniteApplicationSelection,
  type PreparedFiniteActiveApplication, type AcceptedApplicationBinding, type ApplicationActiveSelection,
  type ApplicationActivationError } from "./applicationActivation";
import { ApplicationMutationAdmissionError, requireFiniteReplacementApplicationExecutionAuthority } from "./applicationMutationAdmission";
import { captureFiniteReplacementAttemptInTransactionEffect, acceptFiniteEntryForContinuationInTransactionEffect } from "./transactionSessionActivation";
import { closeProtectedMetadataFinalGuardScope, flushProtectedMetadataFinalGuards,
  openProtectedMetadataFinalGuardScope, registerManagedMetadataSnapshotFinalGuard } from "./preparedMetadataEpoch";
import { readAdmittedCoLocatedInstallationPair } from "./installationLifecycle";
import { LogicalParticipantAdmissionError, type LogicalParticipantAdmissionBundle } from "./logicalDocuments/participantAdmission";
import type { TrustedScopeAuthority } from "./scopeAuthorityResolution";
import { captureAppSchemaCandidateWriteGuardPlanningHeadInTransactionEffect } from "./appSchemaCandidateValidation";
import type { FiniteEntryAttemptKernelContext, ExactRunningAttemptKernelInputV1 } from "./transactionSessionAttemptKernel";
import { prepareFiniteTerminalControlEffect, type PreparedFiniteTerminalControl, type StoredCommitAuthorityEvidenceLoaderPortsV1 } from "./storedCommitAuthority/postgresLoader";
import type { SchemaManifestAppSchemaV1 } from "flarex-protocol/schema-manifest";
import type { materializeFiniteExecutionSchema } from "./storedCommitAuthority/materialization";
import type { FiniteApplicationExecutionEvidence } from "./storedCommitAuthority/model";
import type { StoredOccExecutionEvidenceAuthorityV1 } from "./storedOccExecution/model";
import { getFiniteAttemptMetadataProjection } from "./logicalDocuments/sourceAdmission";
import type { FiniteEntryObservation } from "./finiteEntryObservation";
import type { CapturedFiniteAttemptAnchor } from "./finiteAttemptAnchor";
import { SessionJournalPersistenceV1Error, type SessionJournalAttempt, type SessionJournalAttemptStateV1,
  type SessionJournalStorePersistence, type SessionJournalParticipantSelection, type FiniteRootAttemptState,
  type ResolvedJournalTargetV1 } from "./sessionJournalStore";
export const preparedFiniteSessionJournalEntryBrand: unique symbol = Symbol("Flarex/PreparedFiniteSessionJournalEntry");
const confirmedFiniteRootEntryCaptureBrand: unique symbol = Symbol("Flarex/ConfirmedFiniteRootEntryCapture");
export interface PreparedFiniteSessionJournalEntry { readonly [preparedFiniteSessionJournalEntryBrand]: true }
export interface ConfirmedFiniteRootEntryCapture { readonly [confirmedFiniteRootEntryCaptureBrand]: true }
export type OriginalFiniteExecutionEntry = Readonly<{ capture: ConfirmedFiniteRootEntryCapture;
  preparation: PreparedFiniteSessionJournalEntry }>;
export type FiniteReplacementOrigin = Readonly<{ kind: "frozen"; originalEntry: OriginalFiniteExecutionEntry }>
  | Readonly<{ kind: "recovered" }>;
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
  readonly context: FiniteEntryAttemptKernelContext;
  readonly schemaManifest: SchemaManifestAppSchemaV1;
  readonly stableBindings: Effect.Success<ReturnType<typeof materializeFiniteExecutionSchema>>["stableBindings"];
  readonly applicationEvidence: FiniteApplicationExecutionEvidence;
  readonly canonicalExecutionAuthority: CanonicalApplicationMutationExecutionAuthorityV1;
  readonly finite: FiniteRootAttemptState;
}
interface PreparedFiniteEntryState {
  readonly issuer: StoredCommitAuthorityEvidenceLoaderPortsV1;
  readonly handle: SessionJournalAttempt;
  status: "prepared" | "running" | "confirmed" | "abandoned";
  capture?: FiniteEntryTransactionCapture;
  control?: Readonly<{ application: PreparedFiniteActiveApplication; projection: PreparedFiniteTerminalControl }>;
  readonly run: (tx: AppRowTransaction, context: FiniteEntryAttemptKernelContext,
    resolved: ResolvedJournalTargetV1, application: ApplicationActiveSelection, binding: AcceptedApplicationBinding,
    control: PreparedFiniteTerminalControl | undefined, canonicalExecutionAuthority: CanonicalApplicationMutationExecutionAuthorityV1,
    verifyFinalRows: Effect.Effect<void, SessionJournalPersistenceV1Error>, observation?: FiniteEntryObservation) =>
    Effect.Effect<FiniteEntryTransactionCapture, FiniteEntryFailure>;
  readonly install: (capture: FiniteEntryTransactionCapture) => void;
  readonly discard: (capture: FiniteEntryTransactionCapture) => void;
  readonly release: () => void;
}
interface ConfirmedFiniteEntryState {
  readonly anchorCapture: CapturedFiniteAttemptAnchor;
  readonly applicationSelection: ApplicationActiveSelection;
  readonly preliminaryAuthority: TrustedScopeAuthority;
  readonly issuer: StoredCommitAuthorityEvidenceLoaderPortsV1;
  readonly preparation: PreparedFiniteSessionJournalEntry;
  readonly attempt: SessionJournalAttempt;
  readonly context: FiniteEntryAttemptKernelContext;
  readonly schemaManifest: SchemaManifestAppSchemaV1;
  readonly stableBindings: Effect.Success<ReturnType<typeof materializeFiniteExecutionSchema>>["stableBindings"];
  readonly applicationEvidence: FiniteApplicationExecutionEvidence;
  readonly canonicalExecutionAuthority: CanonicalApplicationMutationExecutionAuthorityV1;
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
    const projection = yield* prepareFiniteTerminalControlEffect(state.issuer, authority, session, application).pipe(Effect.mapError(cause =>
      new SessionJournalPersistenceV1Error({ operation: "openAttempt", cause })));
    if (state.status !== "prepared") return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    state.control = Object.freeze({ application, projection });
    return projection;
  });

/** The journal consumes only the exact control lent to its original preparation.
 * It checks this at the former schema-read boundary after participant admission,
 * preserving refusal order and open Application lifetime. */
export function readPreparedFiniteSessionJournalEntrySchema(entry: PreparedFiniteSessionJournalEntry,
  application: ApplicationActiveSelection, control: PreparedFiniteTerminalControl): Result.Result<PreparedFiniteTerminalControl,
    LogicalParticipantAdmissionError | ApplicationActivationError> {
  const state = preparedFiniteEntries.get(entry);
  const original = state?.control;
  if (state?.status !== "running" || original === undefined || original.projection !== control)
    return Result.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
  return requirePreparedFiniteApplicationSelection(original.application, application).pipe(Result.map(() => control));
}

export const runPreparedFiniteSessionJournalEntryEffect = Effect.fn("SessionJournalStore.enterFiniteInActivation")(
  function* (entry: PreparedFiniteSessionJournalEntry, tx: AppRowTransaction,
    context: FiniteEntryAttemptKernelContext, resolved: ResolvedJournalTargetV1,
    application: ApplicationActiveSelection, binding: AcceptedApplicationBinding, control: PreparedFiniteTerminalControl | undefined,
    canonicalExecutionAuthority: CanonicalApplicationMutationExecutionAuthorityV1,
    verifyFinalRows: Effect.Effect<void, SessionJournalPersistenceV1Error>, observation?: FiniteEntryObservation) {
    const state = preparedFiniteEntries.get(entry);
    if (state?.status !== "prepared") return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    state.status = "running";
    const capture = yield* state.run(tx, context, resolved, application, binding, control, canonicalExecutionAuthority, verifyFinalRows, observation);
    // Any later SQL refusal/interruption must discard this already prepared
    // local work through the original entry lifecycle owner.
    state.capture = capture;
    const candidatePlanningHead = yield* captureAppSchemaCandidateWriteGuardPlanningHeadInTransactionEffect(tx,
      resolved.authority, state.issuer, observation).pipe(Effect.mapError(cause => new SessionJournalPersistenceV1Error({ operation: "openAttempt", cause })));
    capture.finite.candidatePlanningHead = candidatePlanningHead;
    return capture;
  });

/** This operation consumes only the current uncommitted capture of the entry's
 * original issuer. Confirmation still belongs after acknowledged COMMIT. */
export const acceptPreparedFiniteSessionJournalEntryForContinuationEffect = Effect.fn("SessionJournalStore.acceptFiniteContinuation")(
  function* (entry: PreparedFiniteSessionJournalEntry, tx: AppRowTransaction, capture: FiniteEntryTransactionCapture) {
    const state = preparedFiniteEntries.get(entry);
    if (state?.status !== "running" || state.capture !== capture)
      return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    const projection = getFiniteAttemptMetadataProjection(capture.finite.metadata, state.handle);
    if (projection === null) return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    const context = yield* acceptFiniteEntryForContinuationInTransactionEffect(tx, capture.context, capture.finite.anchorCapture, projection).pipe(
      Effect.mapError(cause => new SessionJournalPersistenceV1Error({ operation: "openAttempt", cause })));
    // The issued attempt state owns the native read closures and finite-root
    // registration. Its claim pin contains only immutable owner/fence; renewed
    // deadlines belong to the accepted context, not another state identity.
    const accepted = Object.freeze({ ...capture, context });
    capture.finite.initialContext = context;
    state.capture = accepted;
    return accepted;
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
    const state = preparedFiniteEntries.get(entry);
    if (state?.status !== "prepared") return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    const original = origin.kind === "frozen" ? readOriginalFiniteExecutionAuthority(origin.originalEntry, state.issuer) : undefined;
    if (origin.kind === "frozen" && original === undefined)
      return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    const pair = yield* Effect.fromResult(readAdmittedCoLocatedInstallationPair(tx));
    if (pair !== null) {
      yield* registerManagedMetadataSnapshotFinalGuard(tx, pair.database, pair.target);
      yield* registerManagedMetadataSnapshotFinalGuard(tx, pair.database, pair.control);
    }
    const fresh = yield* captureFiniteReplacementAttemptInTransactionEffect(tx, input, original);
    const accept = (accepted: Readonly<{ selection: ApplicationActiveSelection; basis: import("./applicationActivation").ApplicationActiveSelectionBasis }>,
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
      ? withPreparedFiniteReplacementApplicationInTransaction(application, tx, fresh.context.scopeClock, origin.originalEntry, state.issuer, accept)
      : withPreparedRecoveredFiniteApplicationInTransaction(application, tx, fresh.context.scopeClock, accept))
      .pipe(Effect.ensuring(Effect.sync(fresh.close)));
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
  capture.finite.originalEntry = Object.freeze({ capture: handle, preparation: entry });
  confirmedFiniteEntries.set(handle, Object.freeze({ issuer: state.issuer, preparation: entry,
    anchorCapture: capture.finite.anchorCapture,
    attempt: state.handle, preliminaryAuthority: capture.preliminaryAuthority, context: capture.context, schemaManifest: capture.schemaManifest, stableBindings: capture.stableBindings, applicationEvidence: capture.applicationEvidence,
    canonicalExecutionAuthority: capture.canonicalExecutionAuthority,
    admissions: capture.issuedAdmissions, applicationSelection: capture.applicationSelection }));
  return handle;
}

/** Existing confirmed-entry provenance lends only the original signed program. */
export function readOriginalFiniteExecutionAuthority(original: OriginalFiniteExecutionEntry,
  issuer: StoredCommitAuthorityEvidenceLoaderPortsV1) {
  const state = confirmedFiniteEntries.get(original.capture);
  return state?.issuer === issuer && state.preparation === original.preparation
    ? Object.freeze({ canonicalExecutionAuthority: state.canonicalExecutionAuthority, context: state.context,
      anchorCapture: state.anchorCapture }) : undefined;
}

/** Publication expectations come from this exact confirmed-entry issuer.
 * Caller-authored rows with matching digest/scalar pins cannot substitute any
 * original JSON, canonical bytes, null or immutable session column. */
export function projectOriginalFinitePublicationSession(original: OriginalFiniteExecutionEntry,
  issuer: StoredCommitAuthorityEvidenceLoaderPortsV1) {
  return Result.gen(function* () {
    const state = confirmedFiniteEntries.get(original.capture);
    if (state?.issuer !== issuer || state.preparation !== original.preparation)
      return yield* Result.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    const encoded: Record<string, Json> = {};
    for (const [key, column] of Object.entries(getTableColumns(fxSystemTransactionSessions))) {
      const value: unknown = Reflect.get(state.context.session, key);
      if (value instanceof Uint8Array) encoded[column.name] = `\\x${encodeBytesToLowercaseHex(value)}`;
      else if (value instanceof Date) {
        if (!Number.isSafeInteger(value.getTime()))
          return yield* Result.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
        encoded[column.name] = value.toISOString();
      } else if (typeof value === "bigint") encoded[column.name] = value.toString();
      else if (isJson(value)) encoded[column.name] = value;
      else return yield* Result.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    }
    return JSON.stringify(encoded);
  });
}

export function readConfirmedFiniteRootEntryCapture(handle: ConfirmedFiniteRootEntryCapture,
  issuer: StoredCommitAuthorityEvidenceLoaderPortsV1) {
  const state = typeof handle === "object" && handle !== null ? confirmedFiniteEntries.get(handle) : undefined;
  return state?.issuer === issuer ? Object.freeze({ preliminaryAuthority: structuredClone(state.preliminaryAuthority),
    context: structuredClone(state.context), schemaManifest: structuredClone(state.schemaManifest),
    stableBindings: structuredClone(state.stableBindings), applicationEvidence: structuredClone(state.applicationEvidence) }) : undefined;
}
