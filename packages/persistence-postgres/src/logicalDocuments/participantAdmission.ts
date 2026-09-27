import { Data, Effect, Result } from "effect";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { AdmittedParticipantOperationV1 } from "flarex-protocol/commit-protocol";
import type { CommitSeq, ScopeId } from "flarex-protocol/storage-authority";
import type { TransactionAttemptFence, TransactionSessionIdV1 } from "flarex-protocol/transaction-session";
import type { CanonicalFlarexValueV1 } from "flarex-protocol/value";
import type { ApplicationBindingInput } from "../applicationActivation";
import type { LocatedAppIndexDefinitionV1 } from "../appIndexDefinitions";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "../appUniqueConstraintDefinitions";
import type { DataBindingHeadToken } from "../frameworkSchema/binding/model";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { ScopeClockRecord } from "../scopeClock";
import type { SessionJournalAttemptV1 } from "../sessionJournalStore";
import type { TrustedScopeAuthority } from "../scopeAuthorityResolution";
import type { LogicalSearchDefinition } from "./searchEntries";

export class LogicalParticipantAdmissionError extends Data.TaggedError("LogicalParticipantAdmissionError")<{
  readonly reason: "invalidInput" | "sourceMismatch" | "notReady" | "bindingMissing" | "invalidAuthority" |
    "unsupportedProfile" | "resourceFailure" | "storedCorruption" | "documentInvalid";
  readonly cause?: unknown;
}> {}

/** The framework adapter classifies only its known native failures. Defects
 * and interruption remain in the Effect Cause, outside this typed channel. */
export class LogicalParticipantInvocationError extends Data.TaggedError("LogicalParticipantInvocationError")<{
  readonly kind: "rejection" | "infrastructure";
  readonly cause: unknown;
}> {}

export interface LogicalParticipantAttemptRoot {
  readonly scopeId: ScopeId;
  readonly sessionId: TransactionSessionIdV1;
  readonly attemptFence: TransactionAttemptFence;
  readonly principalDigest: string;
  readonly snapshotCommitSeq: CommitSeq;
  readonly schemaVersionId: CatalogSchemaVersionId;
}
export type LogicalParticipantAttemptReadTransaction = <Value, Failure>(
  work: (tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority,
    clock: ScopeClockRecord) => Effect.Effect<Value, Failure>,
) => Effect.Effect<Value, Failure | LogicalParticipantAdmissionError>;
export interface LogicalParticipantSelection {
  readonly bindAttemptEffect: (application: ApplicationBindingInput, attempt: SessionJournalAttemptV1,
    root: LogicalParticipantAttemptRoot, readTransaction: LogicalParticipantAttemptReadTransaction,
    methods: readonly string[]) => Effect.Effect<LogicalParticipantAttemptAdmission, LogicalParticipantAdmissionError>;
}

export type LogicalParticipantDocumentValidator = (tableId: CatalogTableId, document: CanonicalFlarexValueV1) =>
  Result.Result<unknown, LogicalParticipantAdmissionError>;

declare const attemptBrand: unique symbol;
export interface LogicalParticipantAttemptAdmission { readonly [attemptBrand]: true }
interface AttemptState {
  readonly attempt: SessionJournalAttemptV1;
  readonly root: LogicalParticipantAttemptRoot;
  readonly methods: ReadonlySet<string>;
  readonly readTransaction: LogicalParticipantAttemptReadTransaction;
  readonly verifyBinding: (tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority,
    clock: ScopeClockRecord) => Effect.Effect<void, LogicalParticipantAdmissionError>;
  readonly sourceKey: string;
  readonly sourceSha256: string;
  readonly head: DataBindingHeadToken;
  readonly tableIds: ReadonlySet<CatalogTableId>;
}
const attempts = new WeakMap<object, AttemptState>();

export const issueLogicalParticipantAttemptAdmission = (state: AttemptState): LogicalParticipantAttemptAdmission => {
  // SAFETY: this inert token carries no authority itself; only membership in
  // the private WeakMap grants access to the checked source and exact attempt.
  const token = Object.freeze({}) as LogicalParticipantAttemptAdmission;
  if (state.methods.size === 0 || [...state.methods].some(method => method.length === 0) ||
    state.tableIds.size === 0 || state.root.principalDigest.length === 0) return token;
  attempts.set(token, Object.freeze({ ...state, root: Object.freeze({ ...state.root }),
    methods: new Set(state.methods), tableIds: new Set(state.tableIds),
    head: Object.freeze({ ...state.head }) }));
  return token;
};

export const hasLogicalParticipantAttemptAdmission = (
  admission: LogicalParticipantAttemptAdmission, attempt: SessionJournalAttemptV1, method: string,
): boolean => {
  const state = typeof admission === "object" && admission !== null ? attempts.get(admission) : undefined;
  return state !== undefined && state.attempt === attempt && state.methods.has(method);
};

export const inspectLogicalParticipantAttemptAdmission = (
  admission: LogicalParticipantAttemptAdmission, attempt: SessionJournalAttemptV1, method: string,
): Readonly<{ root: LogicalParticipantAttemptRoot; sourceKey: string; sourceSha256: string;
  bindingHead: DataBindingHeadToken; tableIds: ReadonlySet<CatalogTableId> }> | null => {
  const state = typeof admission === "object" && admission !== null ? attempts.get(admission) : undefined;
  return state === undefined || state.attempt !== attempt || !state.methods.has(method) ? null : Object.freeze({
    root: state.root, sourceKey: state.sourceKey, sourceSha256: state.sourceSha256,
    bindingHead: state.head, tableIds: new Set(state.tableIds),
  });
};

export const requireLogicalParticipantAttemptAdmissionInTransactionEffect = Effect.fn("LogicalParticipantAttemptAdmission.require")(
  function* (admission: LogicalParticipantAttemptAdmission, attempt: SessionJournalAttemptV1, method: string,
    tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord) {
    const state = typeof admission === "object" && admission !== null ? attempts.get(admission) : undefined;
    if (state === undefined || state.attempt !== attempt || !state.methods.has(method) ||
      state.root.scopeId !== authority.scopeId || state.root.scopeId !== clock.scopeId ||
      state.root.snapshotCommitSeq > clock.lastCommitSeq ||
      authority.epoch !== clock.epoch || authority.storageGeneration !== clock.storageGeneration ||
      authority.storageGenerationFence !== clock.storageGenerationFence)
      return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    yield* state.verifyBinding(tx, authority, clock);
    return Object.freeze({ ...state, methods: new Set(state.methods), tableIds: new Set(state.tableIds) });
  });

/** Every evaluator read borrows another checked short transaction. */
export const withLogicalParticipantAttemptAdmissionEffect = Effect.fn("LogicalParticipantAttemptAdmission.with")(
  function* <Value, Failure, Requirements>(admission: LogicalParticipantAttemptAdmission,
    attempt: SessionJournalAttemptV1, method: string,
    work: (state: Readonly<{ root: LogicalParticipantAttemptRoot; tableIds: ReadonlySet<CatalogTableId> }>,
      readTransaction: <A, E>(read: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>) =>
        Effect.Effect<A, E | LogicalParticipantAdmissionError>) => Effect.Effect<Value, Failure, Requirements>) {
    const state = typeof admission === "object" && admission !== null ? attempts.get(admission) : undefined;
    if (state === undefined || state.attempt !== attempt || !state.methods.has(method))
      return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    const checkedRead = <A, E>(read: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>) =>
      state.readTransaction((tx, authority, clock) =>
        requireLogicalParticipantAttemptAdmissionInTransactionEffect(admission, attempt, method, tx, authority, clock)
          .pipe(Effect.flatMap(() => read(tx))));
    yield* checkedRead(() => Effect.void);
    return yield* work(Object.freeze({ root: state.root, tableIds: new Set(state.tableIds) }), checkedRead);
  });

declare const commitBrand: unique symbol;
export interface LogicalParticipantCommitAuthority { readonly [commitBrand]: true }
interface CommitState {
  readonly participant: string;
  readonly methods: ReadonlySet<string>;
  readonly sourceKey: string;
  readonly sourceSha256: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly tableIds: ReadonlySet<CatalogTableId>;
  readonly indexes: readonly LocatedAppIndexDefinitionV1[];
  readonly unique: readonly LocatedAppUniqueConstraintDefinitionV1[];
  readonly search: readonly LogicalSearchDefinition[];
  readonly validateDocument: LogicalParticipantDocumentValidator;
  readonly verify: (operation: AdmittedParticipantOperationV1, tx: FlarexMetadataTransaction,
    authority: TrustedScopeAuthority, clock: ScopeClockRecord) => Effect.Effect<void, LogicalParticipantAdmissionError>;
}
const commits = new WeakMap<object, CommitState>();

export const issueLogicalParticipantCommitAuthority = (state: CommitState): LogicalParticipantCommitAuthority => {
  // SAFETY: this inert token carries no authority itself; only membership in
  // the private WeakMap authenticates the selected source at final commit.
  const token = Object.freeze({}) as LogicalParticipantCommitAuthority;
  if (state.participant.length === 0 || state.methods.size === 0 || state.tableIds.size === 0 ||
    [...state.methods].some(method => method.length === 0)) return token;
  commits.set(token, Object.freeze({ ...state, methods: new Set(state.methods), tableIds: new Set(state.tableIds),
    indexes: Object.freeze([...state.indexes]), unique: Object.freeze([...state.unique]),
    search: Object.freeze([...state.search]) }));
  return token;
};

export const hasLogicalParticipantCommitAuthority = (
  token: LogicalParticipantCommitAuthority, participant: string, method: string,
): boolean => {
  const state = typeof token === "object" && token !== null ? commits.get(token) : undefined;
  return state !== undefined && state.participant === participant && state.methods.has(method);
};

export const inspectLogicalParticipantCommitAuthority = (
  token: LogicalParticipantCommitAuthority, operation: AdmittedParticipantOperationV1,
): Readonly<{ schemaVersionId: CatalogSchemaVersionId; tableIds: ReadonlySet<CatalogTableId>;
  indexes: readonly LocatedAppIndexDefinitionV1[]; unique: readonly LocatedAppUniqueConstraintDefinitionV1[];
  validateDocument: LogicalParticipantDocumentValidator }> | null => {
  const state = typeof token === "object" && token !== null ? commits.get(token) : undefined;
  return state === undefined || state.participant !== operation.participant || !state.methods.has(operation.method) ||
    state.sourceKey !== operation.sourceKey || state.sourceSha256 !== operation.sourceSha256Hex ||
    operation.effects.some(effect => !state.tableIds.has(effect.tableId)) ? null : Object.freeze({
      schemaVersionId: state.schemaVersionId, tableIds: new Set(state.tableIds), indexes: state.indexes, unique: state.unique,
      validateDocument: state.validateDocument,
    });
};

export const requireLogicalParticipantCommitAuthorityEffect = Effect.fn("LogicalParticipantCommitAuthority.require")(
  function* (token: LogicalParticipantCommitAuthority, operation: AdmittedParticipantOperationV1,
    tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord) {
    const state = typeof token === "object" && token !== null ? commits.get(token) : undefined;
    if (state === undefined || state.participant !== operation.participant || !state.methods.has(operation.method) ||
      state.sourceKey !== operation.sourceKey || state.sourceSha256 !== operation.sourceSha256Hex ||
      operation.effects.some(effect => !state.tableIds.has(effect.tableId)))
      return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    yield* state.verify(operation, tx, authority, clock);
    return Object.freeze({ tableIds: new Set(state.tableIds), indexes: state.indexes, unique: state.unique,
      search: state.search, validateDocument: state.validateDocument });
  });
