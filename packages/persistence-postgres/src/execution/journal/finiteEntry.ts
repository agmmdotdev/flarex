/** Process-local finite entry authority and lifecycle. SQL accepting owners consume these operations. */
import { Effect, Result } from "effect";
import {
  LogicalParticipantAdmissionError,
} from "../../storage/documents/logicalDocuments/participantErrors";
import type {
  LogicalParticipantAdmissionBundle,
} from "../../storage/documents/logicalDocuments/participantAdmission";
import type {
  CanonicalApplicationMutationExecutionAuthorityV1,
} from "flarex-protocol/internal/application-mutation-authority-v1";
import type { AppRowTransaction } from "../../storage/documents/appRows";
import type {
  PreparedFiniteActiveApplication,
  AcceptedApplicationBinding,
  ApplicationActiveSelection,
} from "../../application/activation/contracts";
import type { TrustedScopeAuthority } from "../../scope/scopeAuthorityResolution";
import type { FiniteEntryAttemptKernelContext } from "../transactionSessionAttemptKernel";
import type {
  PreparedFiniteTerminalControl,
  StoredCommitAuthorityEvidenceLoaderPortsV1,
} from "../../commit/authority/postgresLoader";
import type { SchemaManifestAppSchemaV1 } from "flarex-protocol/schema-manifest";
import type { materializeFiniteExecutionSchema } from "../../commit/authority/materialization";
import type { FiniteApplicationExecutionEvidence } from "../../commit/authority/model";
import type { FiniteEntryObservation } from "../finiteEntryObservation";
import type { CapturedFiniteAttemptAnchor } from "../finiteAttemptAnchor";
import type { SessionJournalPersistenceV1Error } from "./errors";
import type {
  SessionJournalAttempt,
  SessionJournalStorePersistence,
  SessionJournalParticipantSelection,
} from "./contracts";
import type { SessionJournalAttemptStateV1, ResolvedJournalTargetV1 } from "./state";
import type { FiniteRootAttemptState } from "./finiteRoot";
const preparedFiniteSessionJournalEntryBrand: unique symbol = Symbol("Flarex/PreparedFiniteSessionJournalEntry");
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
export interface FiniteEntryTransactionCapture {
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
const preparedFiniteEntries = new WeakMap<PreparedFiniteSessionJournalEntry, PreparedFiniteEntryState>();
const confirmedFiniteEntries = new WeakMap<ConfirmedFiniteRootEntryCapture, ConfirmedFiniteEntryState>();

export type FiniteEntryRun = PreparedFiniteEntryState["run"];
export interface PreparedFiniteEntryInput {
  readonly issuer: StoredCommitAuthorityEvidenceLoaderPortsV1;
  readonly attempt: SessionJournalAttempt;
  readonly run: FiniteEntryRun;
  readonly install: PreparedFiniteEntryState["install"];
  readonly discard: PreparedFiniteEntryState["discard"];
  readonly release: () => void;
}

/** Called within the Store's synchronous capacity acquisition. */
export function issuePreparedFiniteSessionJournalEntry(input: PreparedFiniteEntryInput): PreparedFiniteSessionJournalEntry {
  const entry = Object.freeze({ [preparedFiniteSessionJournalEntryBrand]: true as const });
  preparedFiniteEntries.set(entry, { issuer: input.issuer, handle: input.attempt, run: input.run,
    install: input.install, discard: input.discard, release: input.release, status: "prepared" });
  return entry;
}

/** Observation conveys no mutable registry, callback or capture. */
export function inspectPreparedFiniteSessionJournalEntry(entry: PreparedFiniteSessionJournalEntry) {
  const state = preparedFiniteEntries.get(entry);
  return state === undefined ? undefined : Object.freeze({ status: state.status,
    hasCapture: state.capture !== undefined, attempt: state.handle,
    ...(state.capture === undefined ? {} : {
      context: structuredClone(state.capture.context), finiteStatus: state.capture.finite.status,
    }) });
}

export function readPreparedFiniteEntryIssuer(entry: PreparedFiniteSessionJournalEntry):
  Result.Result<StoredCommitAuthorityEvidenceLoaderPortsV1, LogicalParticipantAdmissionError> {
  const state = preparedFiniteEntries.get(entry);
  return state?.status === "prepared" ? Result.succeed(state.issuer)
    : Result.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
}

export function retainPreparedFiniteEntryControl(entry: PreparedFiniteSessionJournalEntry,
  application: PreparedFiniteActiveApplication, projection: PreparedFiniteTerminalControl):
  Result.Result<PreparedFiniteTerminalControl, LogicalParticipantAdmissionError> {
  const state = preparedFiniteEntries.get(entry);
  if (state?.status !== "prepared") return Result.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
  state.control = Object.freeze({ application, projection });
  return Result.succeed(projection);
}

export function readRunningFiniteEntryControl(entry: PreparedFiniteSessionJournalEntry, projection: PreparedFiniteTerminalControl):
  Result.Result<PreparedFiniteActiveApplication, LogicalParticipantAdmissionError> {
  const state = preparedFiniteEntries.get(entry);
  const control = state?.control;
  return state?.status === "running" && control !== undefined && control.projection === projection
    ? Result.succeed(control.application) : Result.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
}

export const runPreparedFiniteEntryCaptureEffect = Effect.fn(
  function* (entry: PreparedFiniteSessionJournalEntry, ...args: Parameters<FiniteEntryRun>) {
    const state = preparedFiniteEntries.get(entry);
    if (state?.status !== "prepared") return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    state.status = "running";
    const capture = yield* state.run(...args);
    // Record tentative ownership before the activation owner can perform any later SQL.
    state.capture = capture;
    return Object.freeze({ capture, issuer: state.issuer });
  });

export function claimRunningFiniteEntryCapture(entry: PreparedFiniteSessionJournalEntry, capture: FiniteEntryTransactionCapture):
  Result.Result<Readonly<{ issuer: StoredCommitAuthorityEvidenceLoaderPortsV1; attempt: SessionJournalAttempt }>, LogicalParticipantAdmissionError> {
  const state = preparedFiniteEntries.get(entry);
  return state?.status === "running" && state.capture === capture
    ? Result.succeed(Object.freeze({ issuer: state.issuer, attempt: state.handle }))
    : Result.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
}

/** The continuation owner already authenticated running status before its accepting SQL.
 * Updating that exact capture does not add a second status check after the SQL await. */
export function replaceFiniteEntryContinuationCapture(entry: PreparedFiniteSessionJournalEntry,
  capture: FiniteEntryTransactionCapture, context: FiniteEntryAttemptKernelContext):
  Result.Result<FiniteEntryTransactionCapture, LogicalParticipantAdmissionError> {
  const state = preparedFiniteEntries.get(entry);
  if (state === undefined || state.capture !== capture)
    return Result.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
  const accepted = Object.freeze({ ...capture, context });
  capture.finite.initialContext = context;
  state.capture = accepted;
  return Result.succeed(accepted);
}

export function claimConfirmedFiniteEntryAttempt(capture: ConfirmedFiniteRootEntryCapture,
  preparation: PreparedFiniteSessionJournalEntry, issuer: StoredCommitAuthorityEvidenceLoaderPortsV1):
  ReturnType<SessionJournalStorePersistence["confirmedFiniteEntryAttempt"]> {
  const state = confirmedFiniteEntries.get(capture);
  return state?.issuer === issuer && state.preparation === preparation && preparedFiniteEntries.get(preparation)?.status === "confirmed"
    ? Result.succeed(Object.freeze({ attempt: state.attempt, context: structuredClone(state.context), admissions: new Map(state.admissions),
      applicationSelection: state.applicationSelection, schemaManifest: structuredClone(state.schemaManifest),
      stableBindings: structuredClone(state.stableBindings), applicationEvidence: structuredClone(state.applicationEvidence) }))
    : Result.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
}

export function readOriginalFinitePublicationSession(original: OriginalFiniteExecutionEntry,
  issuer: StoredCommitAuthorityEvidenceLoaderPortsV1):
  Result.Result<FiniteEntryAttemptKernelContext["session"], LogicalParticipantAdmissionError> {
  const state = confirmedFiniteEntries.get(original.capture);
  return state?.issuer === issuer && state.preparation === original.preparation
    ? Result.succeed(structuredClone(state.context.session))
    : Result.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
}

export function abandonPreparedFiniteSessionJournalEntry(entry: PreparedFiniteSessionJournalEntry): void {
  const state = preparedFiniteEntries.get(entry);
  if (state !== undefined && (state.status === "prepared" || state.status === "running")) {
    state.status = "abandoned";
    if (state.capture !== undefined) state.discard(state.capture);
    state.release();
  }
}

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

export function readConfirmedFiniteRootEntryCapture(handle: ConfirmedFiniteRootEntryCapture,
  issuer: StoredCommitAuthorityEvidenceLoaderPortsV1) {
  const state = typeof handle === "object" && handle !== null ? confirmedFiniteEntries.get(handle) : undefined;
  return state?.issuer === issuer ? Object.freeze({ preliminaryAuthority: structuredClone(state.preliminaryAuthority),
    context: structuredClone(state.context), schemaManifest: structuredClone(state.schemaManifest),
    stableBindings: structuredClone(state.stableBindings), applicationEvidence: structuredClone(state.applicationEvidence) }) : undefined;
}
