import { Data, Effect, Result } from "effect";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { AdmittedParticipantOperation, SourceContribution } from "flarex-protocol/commit-protocol";
import type { CommitSeq, ScopeId } from "flarex-protocol/storage-authority";
import type { TransactionAttemptFence, TransactionSessionIdV1 } from "flarex-protocol/transaction-session";
import type { CanonicalFlarexValueV1 } from "flarex-protocol/value";
import type { ApplicationBindingInput } from "../applicationActivation";
import type { LocatedAppIndexDefinitionV1 } from "../appIndexDefinitions";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "../appUniqueConstraintDefinitions";
import type { DataBindingHeadToken } from "../frameworkSchema/binding/model";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import { withSharedLogicalSourceBindingChecks, withSharedLogicalSourceReadBindingChecks } from "./sourceAdmission";
import type { ScopeClockRecord } from "../scopeClock";
import type { SessionJournalAttempt } from "../sessionJournalStore";
import type { TrustedScopeAuthority } from "../scopeAuthorityResolution";
import type { PointMutationExecutionProfile } from "../transactionSessionActivation";
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
  readonly executionProfile: PointMutationExecutionProfile;
  readonly snapshotCommitSeq: CommitSeq;
  readonly schemaVersionId: CatalogSchemaVersionId;
}
export type LogicalParticipantAttemptReadTransaction = <Value, Failure>(
  work: (tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority,
    clock: ScopeClockRecord) => Effect.Effect<Value, Failure>,
) => Effect.Effect<Value, Failure | LogicalParticipantAdmissionError>;
export interface LogicalParticipantSelection {
  readonly bindAttemptEffect: (application: ApplicationBindingInput, attempt: SessionJournalAttempt,
    root: LogicalParticipantAttemptRoot, readTransaction: LogicalParticipantAttemptReadTransaction,
    methods: readonly string[],
    entry?: Readonly<{ tx: FlarexMetadataTransaction; authority: TrustedScopeAuthority; clock: ScopeClockRecord }>) =>
      Effect.Effect<LogicalParticipantAttemptAdmission, LogicalParticipantAdmissionError>;
}

export type LogicalParticipantDocumentValidator = (tableId: CatalogTableId, document: CanonicalFlarexValueV1) =>
  Result.Result<unknown, LogicalParticipantAdmissionError>;

declare const attemptBrand: unique symbol;
export interface LogicalParticipantAttemptAdmission { readonly [attemptBrand]: true }
interface AttemptState {
  readonly preparedSource: object;
  readonly attempt: SessionJournalAttempt;
  readonly root: LogicalParticipantAttemptRoot;
  readonly methods: ReadonlySet<string>;
  readonly readTransaction: LogicalParticipantAttemptReadTransaction;
  readonly verifyBinding: (tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority,
    clock: ScopeClockRecord) => Effect.Effect<void, LogicalParticipantAdmissionError>;
  readonly verifyReadBinding: AttemptState["verifyBinding"];
  readonly sourceKey: string;
  readonly sourceSha256: string;
  readonly head: DataBindingHeadToken;
  readonly tableIds: ReadonlySet<CatalogTableId>;
  readonly indexes: readonly LocatedAppIndexDefinitionV1[];
  readonly unique: readonly LocatedAppUniqueConstraintDefinitionV1[];
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
    indexes: Object.freeze([...state.indexes]), unique: Object.freeze([...state.unique]),
    head: Object.freeze({ ...state.head }) }));
  return token;
};

export const hasLogicalParticipantAttemptAdmission = (
  admission: LogicalParticipantAttemptAdmission, attempt: SessionJournalAttempt, method: string,
): boolean => {
  const state = typeof admission === "object" && admission !== null ? attempts.get(admission) : undefined;
  return state !== undefined && state.attempt === attempt && state.methods.has(method);
};

export const inspectLogicalParticipantAttemptAdmission = (
  admission: LogicalParticipantAttemptAdmission, attempt: SessionJournalAttempt, method: string,
): Readonly<{ root: LogicalParticipantAttemptRoot; sourceKey: string; sourceSha256: string;
  preparedSource: object;
  bindingHead: DataBindingHeadToken; tableIds: ReadonlySet<CatalogTableId>;
  indexes: readonly LocatedAppIndexDefinitionV1[];
  unique: readonly LocatedAppUniqueConstraintDefinitionV1[] }> | null => {
  const state = typeof admission === "object" && admission !== null ? attempts.get(admission) : undefined;
  return state === undefined || state.attempt !== attempt || !state.methods.has(method) ? null : Object.freeze({
    root: state.root, sourceKey: state.sourceKey, sourceSha256: state.sourceSha256, preparedSource: state.preparedSource,
    bindingHead: state.head, tableIds: new Set(state.tableIds),
    indexes: state.indexes, unique: state.unique,
  });
};

declare const bundleBrand: unique symbol;
export interface LogicalParticipantAdmissionBundle { readonly [bundleBrand]: true }
interface BundleState {
  readonly attempt: SessionJournalAttempt;
  readonly participant: string;
  readonly operationMethods: ReadonlySet<string>;
  readonly profileRevision: string;
  readonly admissions: readonly LogicalParticipantAttemptAdmission[];
  readonly sourceMethods: readonly (readonly string[])[];
}
const bundles = new WeakMap<object, BundleState>();
const digestPattern = /^[0-9a-f]{64}$/;

/** Trusted selector construction pins the complete ordered source grant. */
export const issueLogicalParticipantAdmissionBundle = (
  attempt: SessionJournalAttempt,
  input: Readonly<{ participant: string; operationMethods: readonly string[];
    profileRevision: string; sources: readonly Readonly<{
      admission: LogicalParticipantAttemptAdmission; methods: readonly string[]
    }>[] }>,
): Result.Result<LogicalParticipantAdmissionBundle, LogicalParticipantAdmissionError> => {
  const sourceKeys = new Set<string>();
  const tableIds = new Set<CatalogTableId>();
  if (input.participant.length === 0 || !digestPattern.test(input.profileRevision) ||
    input.operationMethods.length === 0 || new Set(input.operationMethods).size !== input.operationMethods.length ||
    input.sources.length === 0 || input.sources.length > 3) {
    return Result.fail(new LogicalParticipantAdmissionError({ reason: "invalidInput" }));
  }
  const firstRoot = attempts.get(input.sources[0]!.admission)?.root;
  if (firstRoot === undefined) return Result.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
  for (const source of input.sources) {
    const state = attempts.get(source.admission);
    if (state === undefined || state.attempt !== attempt || state.root.scopeId !== firstRoot.scopeId ||
      state.root.sessionId !== firstRoot.sessionId || state.root.attemptFence !== firstRoot.attemptFence ||
      state.root.snapshotCommitSeq !== firstRoot.snapshotCommitSeq ||
      state.root.schemaVersionId !== firstRoot.schemaVersionId ||
      state.root.principalDigest !== firstRoot.principalDigest ||
      state.root.executionProfile !== firstRoot.executionProfile ||
      source.methods.length === 0 || new Set(source.methods).size !== source.methods.length ||
      source.methods.some(method => !state.methods.has(method)) || sourceKeys.has(state.sourceKey) ||
      [...state.tableIds].some(tableId => tableIds.has(tableId))) {
      return Result.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    }
    sourceKeys.add(state.sourceKey);
    for (const tableId of state.tableIds) tableIds.add(tableId);
  }
  // SAFETY: only this issuer registers the inert token in the private bundle map.
  const token = Object.freeze({}) as LogicalParticipantAdmissionBundle;
  bundles.set(token, Object.freeze({ attempt, participant: input.participant,
    operationMethods: new Set(input.operationMethods), profileRevision: input.profileRevision,
    admissions: Object.freeze(input.sources.map(source => source.admission)),
    sourceMethods: Object.freeze(input.sources.map(source => Object.freeze([...source.methods]))) }));
  return Result.succeed(token);
};

export const inspectLogicalParticipantAdmissionBundle = (
  token: LogicalParticipantAdmissionBundle, attempt: SessionJournalAttempt,
  participant: string, method: string, profileRevision: string,
): Readonly<{ admissions: readonly LogicalParticipantAttemptAdmission[];
  sourceMethods: readonly (readonly string[])[]; profileRevision: string }> | null => {
  const state = typeof token === "object" && token !== null ? bundles.get(token) : undefined;
  return state === undefined || state.attempt !== attempt || state.participant !== participant ||
    !state.operationMethods.has(method) || state.profileRevision !== profileRevision ? null :
    Object.freeze({ admissions: state.admissions, sourceMethods: state.sourceMethods,
      profileRevision: state.profileRevision });
};

/** One short read transaction rechecks every source head before historical IO. */
export const withLogicalParticipantAdmissionBundleEffect = Effect.fn("LogicalParticipantAdmissionBundle.with")(
  function* <Value, Failure, Requirements>(bundle: LogicalParticipantAdmissionBundle,
    attempt: SessionJournalAttempt, participant: string, method: string, profileRevision: string,
    work: (input: Readonly<{ admissions: readonly LogicalParticipantAttemptAdmission[];
      readTransaction: <A, E>(read: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>) =>
        Effect.Effect<A, E | LogicalParticipantAdmissionError> }>) => Effect.Effect<Value, Failure, Requirements>) {
    const state = inspectLogicalParticipantAdmissionBundle(bundle, attempt, participant, method, profileRevision);
    if (state === null) return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    const first = attempts.get(state.admissions[0]!);
    if (first === undefined) return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    const sourceKeys: string[] = [];
    for (const admission of state.admissions) {
      const issued = attempts.get(admission);
      if (issued === undefined || issued.attempt !== attempt)
        return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
      sourceKeys.push(issued.sourceKey);
    }
    const shareChecks = first.root.executionProfile === "finiteRoot"
      ? <A, E, R>(tx: FlarexMetadataTransaction, check: () => Effect.Effect<A, E, R>) =>
        withSharedLogicalSourceReadBindingChecks(tx, sourceKeys, check)
      : withSharedLogicalSourceBindingChecks;
    const readTransaction = <A, E>(read: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>) =>
      first.readTransaction((tx, authority, clock) => shareChecks(tx, () => Effect.gen(function* () {
        for (const [ordinal, admission] of state.admissions.entries()) {
          yield* requireLogicalParticipantAttemptReadAdmissionInTransactionEffect(
            admission, attempt, state.sourceMethods[ordinal]![0]!, tx, authority, clock);
        }
        return yield* read(tx);
      })));
    if (first.root.executionProfile !== "finiteRoot") yield* readTransaction(() => Effect.void);
    return yield* work(Object.freeze({ admissions: state.admissions, readTransaction }));
  });

const requireAttemptState = (admission: LogicalParticipantAttemptAdmission, attempt: SessionJournalAttempt, method: string,
    authority: TrustedScopeAuthority, clock: ScopeClockRecord): Result.Result<AttemptState, LogicalParticipantAdmissionError> => {
    const state = typeof admission === "object" && admission !== null ? attempts.get(admission) : undefined;
    if (state === undefined || state.attempt !== attempt || !state.methods.has(method) ||
      state.root.scopeId !== authority.scopeId || state.root.scopeId !== clock.scopeId ||
      state.root.snapshotCommitSeq > clock.lastCommitSeq ||
      authority.epoch !== clock.epoch || authority.storageGeneration !== clock.storageGeneration ||
      authority.storageGenerationFence !== clock.storageGenerationFence)
      return Result.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    return Result.succeed(state);
  };

/** Full readiness remains mandatory at aggregate entry, seal and publication.
 * Durable operations also recheck it at each operation entry. */
export const requireLogicalParticipantAttemptAdmissionInTransactionEffect = Effect.fn("LogicalParticipantAttemptAdmission.require")(
  function* (admission: LogicalParticipantAttemptAdmission, attempt: SessionJournalAttempt, method: string,
    tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord) {
    const state = yield* Effect.fromResult(requireAttemptState(admission, attempt, method, authority, clock));
    yield* state.verifyBinding(tx, authority, clock);
    return Object.freeze({ ...state, methods: new Set(state.methods), tableIds: new Set(state.tableIds) });
  });

/** Only the issued finite profile may use source-complete readiness for tentative reads. */
const requireLogicalParticipantAttemptReadAdmissionInTransactionEffect = Effect.fn("LogicalParticipantAttemptAdmission.requireRead")(
  function* (admission: LogicalParticipantAttemptAdmission, attempt: SessionJournalAttempt, method: string,
    tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord) {
    const state = yield* Effect.fromResult(requireAttemptState(admission, attempt, method, authority, clock));
    yield* (state.root.executionProfile === "finiteRoot" ? state.verifyReadBinding : state.verifyBinding)(tx, authority, clock);
  });

/** Every evaluator read borrows another checked short transaction. */
export const withLogicalParticipantAttemptAdmissionEffect = Effect.fn("LogicalParticipantAttemptAdmission.with")(
  function* <Prepared, Value, PreparationFailure, Failure, Requirements>(admission: LogicalParticipantAttemptAdmission,
    attempt: SessionJournalAttempt, method: string,
    prepare: (state: Readonly<{ root: LogicalParticipantAttemptRoot; tableIds: ReadonlySet<CatalogTableId> }>,
      tx: FlarexMetadataTransaction | undefined,
      readTransaction: <A, E>(read: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>) =>
        Effect.Effect<A, E | LogicalParticipantAdmissionError>) => Effect.Effect<Prepared, PreparationFailure>,
    work: (state: Readonly<{ root: LogicalParticipantAttemptRoot; tableIds: ReadonlySet<CatalogTableId> }>,
      readTransaction: <A, E>(read: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>) =>
        Effect.Effect<A, E | LogicalParticipantAdmissionError>, prepared: Prepared) => Effect.Effect<Value, Failure, Requirements>) {
    const state = typeof admission === "object" && admission !== null ? attempts.get(admission) : undefined;
    if (state === undefined || state.attempt !== attempt || !state.methods.has(method))
      return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    const checkedRead = <A, E>(read: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>) =>
      state.readTransaction((tx, authority, clock) =>
        requireLogicalParticipantAttemptReadAdmissionInTransactionEffect(admission, attempt, method, tx, authority, clock)
          .pipe(Effect.flatMap(() => read(tx))));
    const publicState = Object.freeze({ root: state.root, tableIds: new Set(state.tableIds) });
    const prepared = yield* (state.root.executionProfile === "finiteRoot"
      ? prepare(publicState, undefined, checkedRead)
      : checkedRead(tx => prepare(publicState, tx, checkedRead)));
    return yield* work(publicState, checkedRead, prepared);
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
  readonly verify: (operation: AdmittedParticipantOperation, contribution: SourceContribution,
    tx: FlarexMetadataTransaction,
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
  token: LogicalParticipantCommitAuthority, participant: string,
  contribution: SourceContribution,
): boolean => {
  const state = typeof token === "object" && token !== null ? commits.get(token) : undefined;
  return state !== undefined && state.participant === participant &&
    state.sourceKey === contribution.sourceKey &&
    state.methods.size === contribution.methods.length &&
    contribution.methods.every(method => state.methods.has(method));
};

/** Repeated use of one source in separate root operations may have distinct
 * method grants while referring to the same exact compiled source. */
export const inspectLogicalParticipantCommitAuthoritySource = (
  token: LogicalParticipantCommitAuthority,
): Readonly<{ sourceKey: string; sourceSha256: string;
  schemaVersionId: CatalogSchemaVersionId; tableIds: ReadonlySet<CatalogTableId>;
  methods: readonly string[] }> | null => {
  const state = typeof token === "object" && token !== null ? commits.get(token) : undefined;
  return state === undefined ? null : Object.freeze({ sourceKey: state.sourceKey,
    sourceSha256: state.sourceSha256, schemaVersionId: state.schemaVersionId,
    tableIds: new Set(state.tableIds), methods: Object.freeze([...state.methods]) });
};

export const inspectLogicalParticipantCommitAuthority = (
  token: LogicalParticipantCommitAuthority, operation: AdmittedParticipantOperation,
  contribution: SourceContribution,
): Readonly<{ schemaVersionId: CatalogSchemaVersionId; tableIds: ReadonlySet<CatalogTableId>;
  indexes: readonly LocatedAppIndexDefinitionV1[]; unique: readonly LocatedAppUniqueConstraintDefinitionV1[];
  validateDocument: LogicalParticipantDocumentValidator }> | null => {
  const state = typeof token === "object" && token !== null ? commits.get(token) : undefined;
  return state === undefined || !hasLogicalParticipantCommitAuthority(token, operation.participant, contribution) ||
    state.sourceSha256 !== contribution.sourceSha256Hex ||
    contribution.effects.some(effect => !state.tableIds.has(effect.tableId)) ? null : Object.freeze({
      schemaVersionId: state.schemaVersionId, tableIds: new Set(state.tableIds), indexes: state.indexes, unique: state.unique,
      validateDocument: state.validateDocument,
    });
};

export const requireLogicalParticipantCommitAuthorityEffect = Effect.fn("LogicalParticipantCommitAuthority.require")(
  function* (token: LogicalParticipantCommitAuthority, operation: AdmittedParticipantOperation,
    contribution: SourceContribution,
    tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord) {
    const state = typeof token === "object" && token !== null ? commits.get(token) : undefined;
    if (state === undefined || !hasLogicalParticipantCommitAuthority(token, operation.participant, contribution) ||
      state.sourceSha256 !== contribution.sourceSha256Hex ||
      contribution.effects.some(effect => !state.tableIds.has(effect.tableId)))
      return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    yield* state.verify(operation, contribution, tx, authority, clock);
    return Object.freeze({ tableIds: new Set(state.tableIds), indexes: state.indexes, unique: state.unique,
      search: state.search, validateDocument: state.validateDocument });
  });
