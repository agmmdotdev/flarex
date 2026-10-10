import { LogicalParticipantAdmissionError } from "./participantErrors";
import { Effect, Exit, Result } from "effect";
import { readPreparedPublicationDefinitions } from "../../../commit/publication/definitionPreparation";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { AdmittedParticipantOperation, SourceContribution } from "flarex-protocol/commit-protocol";
import type { CommitSeq, ScopeId } from "flarex-protocol/storage-authority";
import type { TransactionAttemptFence, TransactionSessionIdV1 } from "flarex-protocol/transaction-session";
import type { CanonicalFlarexValueV1 } from "flarex-protocol/value";
import type {
  AcceptedApplicationBinding,
  ApplicationBindingInput,
} from "../../../application/activation/contracts";
import {
  withValidatedApplicationBindingBasisInTransaction,
} from "../../../application/activation/bindingAcceptance";
import type { LocatedAppIndexDefinitionV1 } from "../../indexes/appIndexDefinitions";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "../../unique/appUniqueConstraintDefinitions";
import type { DataBindingHeadToken } from "../../../installation/frameworkSchema/binding/model";
import type { FlarexMetadataTransaction } from "../../../database/metadataTransaction";
import {
  withSharedLogicalSourceBindingChecks,
  type FiniteAttemptMetadata,
  type FiniteMetadataEntry,
} from "./sourceAdmission";
import { type ScopeClockRecord } from "../../../scope/scopeClock";
import type {
  SessionJournalAttempt,
} from "../../../execution/journal/contracts";
import type { TrustedScopeAuthority } from "../../../scope/scopeAuthorityResolution";
import type { PointMutationExecutionProfile } from "../../../execution/transactionSessionActivation";
import type { LogicalSearchDefinition } from "./searchEntries";
import type { LogicalStorageReadDemand } from "./model";
import type {
  PreparedFiniteMetadataProjection,
  FiniteMetadataComparisonExpected,
  FiniteMetadataError,
} from "../../../execution/finiteMetadataDependencies";
import type { FiniteStorageCaptureError } from "../../../execution/finiteStorageCapture";
import type { PreparedHostPreparationLifetime } from "../../../execution/preparation/preparedHostRuntime";

export function projectFiniteStorageCaptureFailure(cause: FiniteStorageCaptureError): LogicalParticipantAdmissionError {
  const reason = cause.reason === "notReady" || cause.reason === "storedCorruption" ||
    cause.reason === "resourceFailure" || cause.reason === "invalidInput" ? cause.reason : "invalidAuthority";
  return new LogicalParticipantAdmissionError({ reason, cause });
}

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
    observation: ScopeClockRecord) => Effect.Effect<Value, Failure>,
) => Effect.Effect<Value, Failure | LogicalParticipantAdmissionError>;
export interface FiniteParticipantStorageDemand {
  readonly admission: LogicalParticipantAttemptAdmission;
  readonly attempt: SessionJournalAttempt;
  readonly method: string;
  readonly demand: LogicalStorageReadDemand;
}
export interface LogicalParticipantSelection {
  readonly bindAttemptEffect: (application: ApplicationBindingInput, attempt: SessionJournalAttempt,
    root: LogicalParticipantAttemptRoot, readTransaction: LogicalParticipantAttemptReadTransaction,
    methods: readonly string[],
    entry?: Readonly<{ tx: FlarexMetadataTransaction; authority: TrustedScopeAuthority; clock: ScopeClockRecord;
      finiteMetadata?: FiniteMetadataEntry;
      applicationBinding?: Readonly<{ selection: LogicalParticipantSelection; binding: AcceptedApplicationBinding }> }>) =>
      Effect.Effect<LogicalParticipantAttemptAdmission, LogicalParticipantAdmissionError>;
}

export type LogicalParticipantDocumentValidator = (tableId: CatalogTableId, document: CanonicalFlarexValueV1) =>
  Result.Result<unknown, LogicalParticipantAdmissionError>;

declare const attemptBrand: unique symbol;
export interface LogicalParticipantAttemptAdmission { readonly [attemptBrand]: true }

/** Retained table membership exposes the immutable view, never its private Set. */
export interface LogicalParticipantTableMembership {
  readonly size: number;
  has(value: CatalogTableId): boolean;
  entries(): IterableIterator<[CatalogTableId, CatalogTableId]>;
  keys(): IterableIterator<CatalogTableId>;
  values(): IterableIterator<CatalogTableId>;
  [Symbol.iterator](): IterableIterator<CatalogTableId>;
  forEach(
    callback: (
      value: CatalogTableId,
      key: CatalogTableId,
      membership: LogicalParticipantTableMembership,
    ) => void,
    thisArg?: unknown,
  ): void;
}

interface AttemptState {
  readonly preparedSource: object;
  readonly attempt: SessionJournalAttempt;
  readonly root: LogicalParticipantAttemptRoot;
  readonly methods: ReadonlySet<string>;
  readonly readTransaction: LogicalParticipantAttemptReadTransaction;
  readonly metadata?: FiniteAttemptMetadata;
  readonly verifyBinding: (tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority,
    clock: ScopeClockRecord) => Effect.Effect<void, LogicalParticipantAdmissionError>;
  readonly sourceKey: string;
  readonly sourceSha256: string;
  readonly head: DataBindingHeadToken;
  readonly tableIds: LogicalParticipantTableMembership;
  readonly indexes: readonly LocatedAppIndexDefinitionV1[];
  readonly unique: readonly LocatedAppUniqueConstraintDefinitionV1[];
}
const attempts = new WeakMap<object, AttemptState>();
/** The existing source issuer authenticates the exact demand before the kernel
 * acquires its requested build lock. This lends no transaction or live verdict. */
export function inspectFiniteParticipantStorageDemand(input: FiniteParticipantStorageDemand) {
  const state = attempts.get(input.admission);
  const demand = input.demand;
  if (state === undefined || state.root.executionProfile !== "finiteRoot" || state.attempt !== input.attempt ||
    !state.methods.has(input.method) || (demand.kind !== "clock" && !state.tableIds.has(demand.tableId)))
    return Result.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
  if (demand.kind === "search") return Result.fail(new LogicalParticipantAdmissionError({ reason: "unsupportedProfile",
    cause: "finiteHistoricalSearchUnsupported" }));
  const definition = demand.kind === "index" ? state.indexes.find(member =>
    member.indexDefinitionId === demand.indexDefinitionId && member.access.tableId === demand.tableId) : undefined;
  if (demand.kind === "index" && definition === undefined)
    return Result.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
  const uniqueDefinition = demand.kind === "unique" ? state.unique.find(member =>
    member.uniqueConstraintDefinitionId === demand.uniqueConstraintDefinitionId && member.tableId === demand.tableId) : undefined;
  if (demand.kind === "unique" && uniqueDefinition === undefined)
    return Result.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
  return Result.succeed(Object.freeze({ root: state.root, demand, definition, uniqueDefinition,
    metadata: state.metadata }));
}
const tableMembershipView = (input: LogicalParticipantTableMembership): LogicalParticipantTableMembership => {
  const members = new Set(input);
  const view: LogicalParticipantTableMembership = Object.freeze({ size: members.size,
    has: (value: CatalogTableId) => members.has(value),
    entries: () => members.entries(), keys: () => members.keys(), values: () => members.values(),
    [Symbol.iterator]: () => members[Symbol.iterator](),
    forEach: (callback: (value: CatalogTableId, key: CatalogTableId, set: LogicalParticipantTableMembership) => void, thisArg?: unknown) =>
      members.forEach(value => callback.call(thisArg, value, value, view)),
  });
  return view;
};
export const issueLogicalParticipantAttemptAdmission = (state: AttemptState): LogicalParticipantAttemptAdmission => {
  // SAFETY: this inert token carries no authority itself; only membership in
  // the private WeakMap grants access to the checked source and exact attempt.
  const token = Object.freeze({}) as LogicalParticipantAttemptAdmission;
  if (state.methods.size === 0 || [...state.methods].some(method => method.length === 0) ||
    state.tableIds.size === 0 || state.root.principalDigest.length === 0) return token;
  attempts.set(token, Object.freeze({ ...state, root: Object.freeze({ ...state.root }),
    methods: new Set(state.methods), tableIds: tableMembershipView(state.tableIds),
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
  metadata?: FiniteAttemptMetadata;
  bindingHead: DataBindingHeadToken; tableIds: LogicalParticipantTableMembership;
  indexes: readonly LocatedAppIndexDefinitionV1[];
  unique: readonly LocatedAppUniqueConstraintDefinitionV1[] }> | null => {
  const state = typeof admission === "object" && admission !== null ? attempts.get(admission) : undefined;
  return state === undefined || state.attempt !== attempt || !state.methods.has(method) ? null : Object.freeze({
    root: state.root, sourceKey: state.sourceKey, sourceSha256: state.sourceSha256, preparedSource: state.preparedSource,
    bindingHead: state.head, tableIds: state.tableIds,
    ...(state.metadata === undefined ? {} : { metadata: state.metadata }),
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

/** Each read borrows a checked short transaction. Durable sources recheck their
 * heads; finite sources authenticate retained pins and demanded serving state. */
export const withLogicalParticipantAdmissionBundleEffect = Effect.fn("LogicalParticipantAdmissionBundle.with")(
  function* <Value, Failure, Requirements>(bundle: LogicalParticipantAdmissionBundle,
    attempt: SessionJournalAttempt, participant: string, method: string, profileRevision: string,
    work: (input: Readonly<{ admissions: readonly LogicalParticipantAttemptAdmission[];
      readTransaction: <A, E>(read: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>, demand?: LogicalStorageReadDemand) =>
        Effect.Effect<A, E | LogicalParticipantAdmissionError> }>) => Effect.Effect<Value, Failure, Requirements>) {
    const state = inspectLogicalParticipantAdmissionBundle(bundle, attempt, participant, method, profileRevision);
    if (state === null) return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    const first = attempts.get(state.admissions[0]!);
    if (first === undefined) return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    const shareChecks = withSharedLogicalSourceBindingChecks;
    const readTransaction = <A, E>(read: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>, demand?: LogicalStorageReadDemand) => {
      if (first.root.executionProfile === "finiteRoot") return Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
      return first.readTransaction((tx, authority, clock) => shareChecks(tx, () => Effect.gen(function* () {
        for (const [ordinal, admission] of state.admissions.entries()) yield* requireLogicalParticipantAttemptReadAdmissionInTransactionEffect(
          admission, attempt, state.sourceMethods[ordinal]![0]!, tx, authority, clock, demand);
        return yield* read(tx);
      })));
    };
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

/** Full admission remains the aggregate-entry and durable-operation contract.
 * Reserved finite seal and publication use their explicit retained-pin paths. */
export const requireLogicalParticipantAttemptAdmissionInTransactionEffect = Effect.fn("LogicalParticipantAttemptAdmission.require")(
  function* (admission: LogicalParticipantAttemptAdmission, attempt: SessionJournalAttempt, method: string,
    tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord) {
    const state = yield* Effect.fromResult(requireAttemptState(admission, attempt, method, authority, clock));
    yield* state.verifyBinding(tx, authority, clock);
    return Object.freeze({ ...state, methods: new Set(state.methods), tableIds: new Set(state.tableIds) });
  });

/** Ordinary and durable reads keep their complete source admission. */
const requireLogicalParticipantAttemptReadAdmissionInTransactionEffect = Effect.fn("LogicalParticipantAttemptAdmission.requireRead")(
  function* (admission: LogicalParticipantAttemptAdmission, attempt: SessionJournalAttempt, method: string,
    tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord, _demand?: LogicalStorageReadDemand) {
    const state = yield* Effect.fromResult(requireAttemptState(admission, attempt, method, authority, clock));
    if (state.root.executionProfile === "finiteRoot")
      return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    yield* state.verifyBinding(tx, authority, clock);
  });

/** Every evaluator read borrows another checked short transaction. */
export const withLogicalParticipantAttemptAdmissionEffect = Effect.fn("LogicalParticipantAttemptAdmission.with")(
  function* <Prepared, Value, PreparationFailure, Failure, Requirements>(admission: LogicalParticipantAttemptAdmission,
    attempt: SessionJournalAttempt, method: string,
    prepare: (state: Readonly<{ root: LogicalParticipantAttemptRoot; tableIds: LogicalParticipantTableMembership }>,
      tx: FlarexMetadataTransaction | undefined,
      readTransaction: <A, E>(read: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>, demand?: LogicalStorageReadDemand) =>
        Effect.Effect<A, E | LogicalParticipantAdmissionError>) => Effect.Effect<Prepared, PreparationFailure>,
    work: (state: Readonly<{ root: LogicalParticipantAttemptRoot; tableIds: LogicalParticipantTableMembership }>,
      readTransaction: <A, E>(read: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>, demand?: LogicalStorageReadDemand) =>
        Effect.Effect<A, E | LogicalParticipantAdmissionError>, prepared: Prepared) => Effect.Effect<Value, Failure, Requirements>) {
    const state = typeof admission === "object" && admission !== null ? attempts.get(admission) : undefined;
    if (state === undefined || state.attempt !== attempt || !state.methods.has(method))
      return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    const checkedRead = <A, E>(read: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>, demand?: LogicalStorageReadDemand) =>
      state.root.executionProfile === "finiteRoot" ? Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" })) :
        state.readTransaction((tx, authority, clock) => requireLogicalParticipantAttemptReadAdmissionInTransactionEffect(
          admission, attempt, method, tx, authority, clock, demand).pipe(Effect.flatMap(() => read(tx))));
    const publicState = Object.freeze({ root: state.root, tableIds: state.tableIds });
    const prepared = yield* (state.root.executionProfile === "finiteRoot"
      ? prepare(publicState, undefined, checkedRead)
      : checkedRead(tx => prepare(publicState, tx, checkedRead)));
    return yield* work(publicState, checkedRead, prepared);
  });

declare const commitBrand: unique symbol;
export interface LogicalParticipantCommitAuthority { readonly [commitBrand]: true }
interface CommitState {
  readonly publicationDefinitions: import("../../../commit/publication/definitionPreparation").PreparedPublicationDefinitions;
  readonly application?: ApplicationBindingInput;
  readonly projectApplicationFailure?: (cause: unknown) => LogicalParticipantAdmissionError;
  readonly metadataProjection?: PreparedFiniteMetadataProjection;
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
  readonly prepareFiniteTables?: (tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    tableIds: readonly CatalogTableId[]) => Result.Result<Readonly<{
      pages: readonly (readonly FiniteMetadataComparisonExpected[])[];
      accept: (observation: unknown) => Effect.Effect<Readonly<{
        indexes: readonly LocatedAppIndexDefinitionV1[]; unique: readonly LocatedAppUniqueConstraintDefinitionV1[];
      }>, LogicalParticipantAdmissionError>;
    }>, FiniteMetadataError>;
  readonly verifyFinite?: (operation: AdmittedParticipantOperation, contribution: SourceContribution,
    tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord) =>
    Effect.Effect<Readonly<{ indexes: readonly LocatedAppIndexDefinitionV1[]; unique: readonly LocatedAppUniqueConstraintDefinitionV1[] }>, LogicalParticipantAdmissionError>;
  readonly verify: (operation: AdmittedParticipantOperation, contribution: SourceContribution,
    tx: FlarexMetadataTransaction,
    authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    borrowed?: AcceptedApplicationBinding) => Effect.Effect<void, LogicalParticipantAdmissionError>;
}
const commits = new WeakMap<object, CommitState>();

/** The publication root keeps this genuine source's Application acceptance
 * alive while checking all ordinary source contributions. Application owns
 * acquisition tracing; this lifetime boundary restores work without adding
 * stack annotations to its original Cause. */
export const withLogicalParticipantCommitApplicationBindingInTransaction = Effect.fnUntraced(
  function* <A, E, R>(token: LogicalParticipantCommitAuthority, tx: FlarexMetadataTransaction,
    clock: ScopeClockRecord, work: (binding: AcceptedApplicationBinding) => Effect.Effect<A, E, R>) {
    const state = commits.get(token);
    if (state?.application === undefined || state.projectApplicationFailure === undefined)
      return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    // This actual callback-lifetime boundary owns the complete work outcome.
    // Only acquisition failures cross the source's existing projection; work
    // failures, defects and interruption retain their original complete Cause.
    const outcome = yield* withValidatedApplicationBindingBasisInTransaction(state.application, tx, clock,
      (_validated, _checked, binding) => Effect.exit(work(binding))).pipe(Effect.mapError(state.projectApplicationFailure));
    if (Exit.isFailure(outcome)) return yield* Effect.failCause(outcome.cause);
    return outcome.value;
  });

export function prepareFiniteOperationCommitObservation(token: LogicalParticipantCommitAuthority,
  admission: LogicalParticipantAttemptAdmission, attempt: SessionJournalAttempt, participant: string, methods: readonly string[],
  tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord, touchedTables: readonly CatalogTableId[]) {
  const state = commits.get(token);
  return Result.gen(function* () {
    if (state?.prepareFiniteTables === undefined) return yield* Result.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    const prepared = yield* state.prepareFiniteTables(tx, authority, clock, touchedTables);
    return Object.freeze({ pages: prepared.pages, accept: (observation: unknown) => Effect.gen(function* () {
      const selected = inspectFiniteOperationCommitAuthority(token, admission, attempt, participant, methods);
      if (selected === null || touchedTables.some(tableId => !selected.tableIds.has(tableId)))
        return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
      // Current closure agreement authenticates the original issuer's selected
      // validator and definitions. It does not reconstruct publication inputs.
      yield* prepared.accept(observation);
    }) });
  });
}

/** Match the operation's genuine borrowed source view to publisher composition.
 * The frozen graph supplies effects once; no exported per-child global graph or
 * canonical contribution is required to authenticate its source authority. */
export const inspectFiniteOperationCommitAuthority = (
  token: LogicalParticipantCommitAuthority, admission: LogicalParticipantAttemptAdmission,
  attempt: SessionJournalAttempt, participant: string, methods: readonly string[],
) => {
  const state = commits.get(token), issued = attempts.get(admission);
  return state === undefined || issued === undefined || issued.attempt !== attempt || issued.root.executionProfile !== "finiteRoot" ||
    state.participant !== participant || state.sourceKey !== issued.sourceKey || state.sourceSha256 !== issued.sourceSha256 ||
    methods.length === 0 ||
    methods.some(method => !state.methods.has(method) || !issued.methods.has(method)) ||
    state.tableIds.size !== issued.tableIds.size || [...state.tableIds].some(tableId => !issued.tableIds.has(tableId)) ||
    state.metadataProjection === undefined || state.prepareFiniteTables === undefined ? null : Object.freeze({
      tableIds: new Set(state.tableIds), schemaVersionId: state.schemaVersionId,
      indexes: state.indexes, unique: state.unique, search: state.search, publicationDefinitions: state.publicationDefinitions,
      metadataProjection: state.metadataProjection, validateDocument: state.validateDocument,
      root: issued.root, sourceKey: state.sourceKey, sourceSha256: state.sourceSha256, head: issued.head,
    });
};

export const inspectLogicalParticipantCommitMetadataProjection = (token: LogicalParticipantCommitAuthority,
  operation: AdmittedParticipantOperation, contribution: SourceContribution): PreparedFiniteMetadataProjection | null => {
  const state = commits.get(token);
  return state === undefined || !hasLogicalParticipantCommitAuthority(token, operation.participant, contribution) ||
    state.sourceSha256 !== contribution.sourceSha256Hex || contribution.effects.some(effect => !state.tableIds.has(effect.tableId))
    ? null : state.metadataProjection ?? null;
};

// Cleanup captures only the inert key, rather than retaining the issuing
// source's state through the lifetime's disposal callback.
const disposeCommitAuthority = (token: LogicalParticipantCommitAuthority) => () => { commits.delete(token); };

export const issueLogicalParticipantCommitAuthority = (state: Omit<CommitState, "indexes" | "unique">,
  preparationLifetime?: PreparedHostPreparationLifetime): LogicalParticipantCommitAuthority => {
  // SAFETY: this inert token carries no authority itself; only membership in
  // the private WeakMap authenticates the selected source at final commit.
  const token = Object.freeze({}) as LogicalParticipantCommitAuthority;
  if (state.participant.length === 0 || state.methods.size === 0 || state.tableIds.size === 0 ||
    [...state.methods].some(method => method.length === 0)) return token;
  const definitions = readPreparedPublicationDefinitions(state.publicationDefinitions);
  if (definitions === null) return token;
  // Source factories lend their original allocation explicitly: commit tokens
  // are commonly issued after ambient preparation has already completed.
  // Actual reclamation waits for retired borrowers and frozen roots to drain.
  if (preparationLifetime !== undefined && Result.isFailure(preparationLifetime.onDispose(disposeCommitAuthority(token))))
    return token;
  commits.set(token, Object.freeze({ ...state, ...definitions, methods: new Set(state.methods), tableIds: new Set(state.tableIds),
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
  applicationBindingAvailable: boolean;
  schemaVersionId: CatalogSchemaVersionId; tableIds: ReadonlySet<CatalogTableId>;
  methods: readonly string[] }> | null => {
  const state = typeof token === "object" && token !== null ? commits.get(token) : undefined;
  return state === undefined ? null : Object.freeze({ sourceKey: state.sourceKey,
    applicationBindingAvailable: state.application !== undefined && state.projectApplicationFailure !== undefined,
    sourceSha256: state.sourceSha256, schemaVersionId: state.schemaVersionId,
    tableIds: new Set(state.tableIds), methods: Object.freeze([...state.methods]) });
};

export const inspectLogicalParticipantCommitAuthority = (
  token: LogicalParticipantCommitAuthority, operation: AdmittedParticipantOperation,
  contribution: SourceContribution,
): Readonly<{ schemaVersionId: CatalogSchemaVersionId; tableIds: ReadonlySet<CatalogTableId>;
  indexes: readonly LocatedAppIndexDefinitionV1[]; unique: readonly LocatedAppUniqueConstraintDefinitionV1[];
  validateDocument: LogicalParticipantDocumentValidator;
  publicationDefinitions: import("../../../commit/publication/definitionPreparation").PreparedPublicationDefinitions }> | null => {
  const state = typeof token === "object" && token !== null ? commits.get(token) : undefined;
  return state === undefined || !hasLogicalParticipantCommitAuthority(token, operation.participant, contribution) ||
    state.sourceSha256 !== contribution.sourceSha256Hex ||
    contribution.effects.some(effect => !state.tableIds.has(effect.tableId)) ? null : Object.freeze({
      schemaVersionId: state.schemaVersionId, tableIds: new Set(state.tableIds), indexes: state.indexes, unique: state.unique,
      validateDocument: state.validateDocument, publicationDefinitions: state.publicationDefinitions,
    });
};

export const requireLogicalParticipantCommitAuthorityEffect = Effect.fn("LogicalParticipantCommitAuthority.require")(
  function* (token: LogicalParticipantCommitAuthority, operation: AdmittedParticipantOperation,
    contribution: SourceContribution,
    tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    borrowed?: AcceptedApplicationBinding) {
    const state = typeof token === "object" && token !== null ? commits.get(token) : undefined;
    if (state === undefined || !hasLogicalParticipantCommitAuthority(token, operation.participant, contribution) ||
      state.sourceSha256 !== contribution.sourceSha256Hex ||
      contribution.effects.some(effect => !state.tableIds.has(effect.tableId)))
      return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    yield* state.verify(operation, contribution, tx, authority, clock, borrowed);
    return Object.freeze({ tableIds: new Set(state.tableIds), indexes: state.indexes, unique: state.unique,
      readDefinitions: Object.freeze({ indexes: state.indexes, unique: state.unique }),
      search: state.search, validateDocument: state.validateDocument });
  });

/** Reservation/dependency validation precedes this retained semantic authority.
 * Publication still loads current complete maintenance for every touched table. */
export const requireFiniteLogicalParticipantCommitAuthorityEffect = Effect.fn("LogicalParticipantCommitAuthority.requireFinite")(
  function* (token: LogicalParticipantCommitAuthority, operation: AdmittedParticipantOperation,
    contribution: SourceContribution, tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord) {
    const state = typeof token === "object" && token !== null ? commits.get(token) : undefined;
    if (state === undefined || state.verifyFinite === undefined || !hasLogicalParticipantCommitAuthority(token, operation.participant, contribution) ||
      state.sourceSha256 !== contribution.sourceSha256Hex || contribution.effects.some(effect => !state.tableIds.has(effect.tableId)))
      return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    const current = yield* state.verifyFinite(operation, contribution, tx, authority, clock);
    return Object.freeze({ tableIds: new Set(state.tableIds), indexes: current.indexes, unique: current.unique,
      readDefinitions: Object.freeze({ indexes: state.indexes, unique: state.unique }),
      search: state.search, validateDocument: state.validateDocument });
  });
