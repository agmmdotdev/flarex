import { Result } from "effect";

import {
  canonicalBase64UrlDecodedLength,
  captureCanonicalDependencyKey,
  captureCanonicalQueryIdentity,
  captureCanonicalQueryKey,
  captureQueryAuthorityWitness,
  captureQueryGeneration,
  captureQueryResultDigest,
  captureQuerySnapshot,
  captureSyncEpoch,
  captureSyncModelId,
  captureSyncNamespaceId,
  captureSyncSequence,
  compareCanonicalBase64Url,
  QUERY_AUTHORITY_WITNESS_BYTES,
  QUERY_KEY_BYTES,
  QUERY_RESULT_DIGEST_BYTES,
  wellFormedUtf8ByteLength,
} from "./CanonicalValue.js";
import type {
  CanonicalDependencyKey,
  CanonicalQueryIdentity,
  CanonicalQueryKey,
  QueryAuthorityWitness,
  QueryGeneration,
  QueryResultDigest,
  QuerySnapshot,
  SyncEpoch,
  SyncModelId,
  SyncNamespaceId,
  SyncSequence,
} from "./CanonicalValue.js";
import {
  QueryDependencyLimitError,
  QueryKeyCollisionError,
  QuerySyncCanonicalValueError,
  QuerySyncInvariantDefect,
  QuerySyncStateLimitError,
} from "./Errors.js";
import type {
  QueryDependencyLimitOperation,
} from "./Errors.js";

export const MAX_QUERY_DEPENDENCY_KEYS = 8_192;
export const MAX_INVALIDATION_KEYS = 65_536;
export const MAX_QUERY_DEPENDENCY_BYTES = 4 * 1_024 * 1_024;
export const MAX_INVALIDATION_BATCH_BYTES = 16 * 1_024 * 1_024;
export const MAX_REFERENCE_QUERIES = 4_096;
export const MAX_AGGREGATE_DEPENDENCY_MEMBERSHIPS = 262_144;
export const MAX_RETAINED_QUERY_IDENTITY_BYTES = 32 * 1_024 * 1_024;
export const MAX_COUNTED_CANONICAL_BYTES = 64 * 1_024 * 1_024;
export const MAX_INVALIDATION_DEPENDENCY_LOOKUPS = 65_536;
export const MAX_INVALIDATION_AFFECTED_QUERIES = 4_096;
export const MAX_REFRESH_BATCHES = 65_536;
export const MAX_REFRESH_KEY_EXAMINATIONS = 65_536;
export const MAX_REFRESH_CANONICAL_BYTES = 16 * 1_024 * 1_024;

const FIXED_WIDTH_INTEGER_BYTES = 8;
const SLOT_PRESENCE_BYTES = 1;

export interface NamespaceCursor {
  readonly namespaceId: SyncNamespaceId;
  readonly syncModelId: SyncModelId;
  readonly sourceEpoch: SyncEpoch;
  readonly appliedThroughSequence: SyncSequence;
}

export interface NamespaceCursorInput {
  readonly namespaceId: unknown;
  readonly syncModelId: unknown;
  readonly sourceEpoch: unknown;
  readonly appliedThroughSequence: unknown;
}

export interface QueryDescriptor {
  readonly queryKey: CanonicalQueryKey;
  readonly queryIdentity: CanonicalQueryIdentity;
}

export interface QueryDescriptorInput {
  readonly queryKey: unknown;
  readonly queryIdentity: unknown;
}

export interface QueryOperationTarget {
  readonly namespaceId: SyncNamespaceId;
  readonly syncModelId: SyncModelId;
  readonly sourceEpoch: SyncEpoch;
  readonly descriptor: QueryDescriptor;
}

export interface QueryOperationTargetInput {
  readonly namespaceId: unknown;
  readonly syncModelId: unknown;
  readonly sourceEpoch: unknown;
  readonly descriptor: QueryDescriptorInput;
}

export interface AdmittedInvalidationBatch {
  readonly namespaceId: SyncNamespaceId;
  readonly syncModelId: SyncModelId;
  readonly sourceEpoch: SyncEpoch;
  readonly sourceSequence: SyncSequence;
  readonly dependencyKeys: readonly CanonicalDependencyKey[];
}

export interface AdmittedInvalidationBatchInput {
  readonly namespaceId: unknown;
  readonly syncModelId: unknown;
  readonly sourceEpoch: unknown;
  readonly sourceSequence: unknown;
  readonly dependencyKeys: unknown;
}

export interface QueryEvaluationEvidence {
  readonly namespaceId: SyncNamespaceId;
  readonly syncModelId: SyncModelId;
  readonly sourceEpoch: SyncEpoch;
  readonly descriptor: QueryDescriptor;
  readonly generation: QueryGeneration;
  readonly snapshotSequence: QuerySnapshot;
  readonly resultDigest: QueryResultDigest;
  readonly authorityWitness: QueryAuthorityWitness;
  readonly dependencyKeys: readonly CanonicalDependencyKey[];
}

export interface QueryEvaluationEvidenceInput {
  readonly namespaceId: unknown;
  readonly syncModelId: unknown;
  readonly sourceEpoch: unknown;
  readonly descriptor: QueryDescriptorInput;
  readonly generation: unknown;
  readonly snapshotSequence: unknown;
  readonly resultDigest: unknown;
  readonly authorityWitness: unknown;
  readonly dependencyKeys: unknown;
}

interface GenerationRefreshEvidenceFields {
  readonly namespaceId: SyncNamespaceId;
  readonly syncModelId: SyncModelId;
  readonly sourceEpoch: SyncEpoch;
  readonly descriptor: QueryDescriptor;
  readonly generation: QueryGeneration;
  readonly evaluationSnapshotSequence: QuerySnapshot;
  readonly evaluationDependencyKeys: readonly CanonicalDependencyKey[];
  readonly refreshedThroughSequence: SyncSequence;
  readonly relevantThroughSequence: SyncSequence | null;
  readonly authorityWitness: QueryAuthorityWitness;
}

class AdmittedGenerationRefreshEvidence
  implements GenerationRefreshEvidenceFields
{
  declare private readonly admittedGenerationRefreshEvidence: void;

  readonly namespaceId: SyncNamespaceId;
  readonly syncModelId: SyncModelId;
  readonly sourceEpoch: SyncEpoch;
  readonly descriptor: QueryDescriptor;
  readonly generation: QueryGeneration;
  readonly evaluationSnapshotSequence: QuerySnapshot;
  readonly evaluationDependencyKeys: readonly CanonicalDependencyKey[];
  readonly refreshedThroughSequence: SyncSequence;
  readonly relevantThroughSequence: SyncSequence | null;
  readonly authorityWitness: QueryAuthorityWitness;

  constructor(input: GenerationRefreshEvidenceFields) {
    this.namespaceId = input.namespaceId;
    this.syncModelId = input.syncModelId;
    this.sourceEpoch = input.sourceEpoch;
    this.descriptor = freezeQueryDescriptor(input.descriptor);
    this.generation = input.generation;
    this.evaluationSnapshotSequence = input.evaluationSnapshotSequence;
    this.evaluationDependencyKeys = freezeDependencyKeys(
      input.evaluationDependencyKeys,
    );
    this.refreshedThroughSequence = input.refreshedThroughSequence;
    this.relevantThroughSequence = input.relevantThroughSequence;
    this.authorityWitness = input.authorityWitness;
    Object.freeze(this);
  }
}

export type GenerationRefreshEvidence = AdmittedGenerationRefreshEvidence;

export interface ProvisionalQueryState {
  readonly generation: QueryGeneration;
  readonly registrationCursor: NamespaceCursor;
}

export interface ActiveQueryState {
  readonly generation: QueryGeneration;
  readonly evaluationSnapshotSequence: QuerySnapshot;
  readonly freshThroughSequence: SyncSequence;
  readonly dirtyThroughSequence: SyncSequence | null;
  readonly resultDigest: QueryResultDigest;
  readonly authorityWitness: QueryAuthorityWitness;
  readonly dependencyKeys: readonly CanonicalDependencyKey[];
}

export interface QueryState {
  readonly descriptor: QueryDescriptor;
  readonly active: ActiveQueryState | null;
  readonly provisional: ProvisionalQueryState | null;
}

export interface DependencyDirectoryEntry {
  readonly dependencyKey: CanonicalDependencyKey;
  readonly queryKeys: readonly CanonicalQueryKey[];
}

export interface QuerySyncStateMetrics {
  readonly queryCount: number;
  readonly retainedIdentityBytes: number;
  readonly dependencyMemberships: number;
  readonly countedCanonicalBytes: number;
}

export interface QuerySyncState {
  readonly cursor: NamespaceCursor;
  readonly queries: readonly QueryState[];
  readonly dependencyDirectory: readonly DependencyDirectoryEntry[];
  readonly metrics: QuerySyncStateMetrics;
}

export type SequenceDecision =
  | Readonly<{
    readonly _tag: "duplicate";
    readonly observedSequence: SyncSequence;
  }>
  | Readonly<{
    readonly _tag: "exactNext";
    readonly nextSequence: SyncSequence;
  }>
  | Readonly<{
    readonly _tag: "gap";
    readonly expectedSequence: SyncSequence;
    readonly observedSequence: SyncSequence;
  }>
  | Readonly<{
    readonly _tag: "resetRequired";
    readonly expectedSourceEpoch: SyncEpoch;
    readonly observedSourceEpoch: SyncEpoch;
  }>;

export type BeginQueryGenerationDecision =
  | Readonly<{
    readonly _tag: "created";
    readonly state: QuerySyncState;
    readonly descriptor: QueryDescriptor;
    readonly generation: QueryGeneration;
    readonly registrationCursor: NamespaceCursor;
  }>
  | Readonly<{
    readonly _tag: "replayed";
    readonly state: QuerySyncState;
    readonly descriptor: QueryDescriptor;
    readonly generation: QueryGeneration;
    readonly registrationCursor: NamespaceCursor;
  }>;

export type ApplyInvalidationsDecision =
  | Readonly<{
    readonly _tag: "duplicate";
    readonly state: QuerySyncState;
    readonly observedSequence: SyncSequence;
  }>
  | Readonly<{
    readonly _tag: "gap";
    readonly state: QuerySyncState;
    readonly expectedSequence: SyncSequence;
    readonly observedSequence: SyncSequence;
  }>
  | Readonly<{
    readonly _tag: "resetRequired";
    readonly state: QuerySyncState;
    readonly expectedSourceEpoch: SyncEpoch;
    readonly observedSourceEpoch: SyncEpoch;
  }>
  | Readonly<{
    readonly _tag: "applied";
    readonly state: QuerySyncState;
    readonly appliedSequence: SyncSequence;
    readonly affectedQueryKeys: readonly CanonicalQueryKey[];
  }>;

export type CompleteQueryGenerationDecision =
  | Readonly<{
    readonly _tag: "refreshRequired";
    readonly state: QuerySyncState;
    readonly refreshedThroughSequence: SyncSequence;
    readonly requiredThroughSequence: SyncSequence;
  }>
  | Readonly<{
    readonly _tag: "resnapshotRequired";
    readonly state: QuerySyncState;
    readonly generation: QueryGeneration;
  }>
  | Readonly<{
    readonly _tag: "rerunRequired";
    readonly state: QuerySyncState;
    readonly generation: QueryGeneration;
    readonly relevantThroughSequence: SyncSequence;
  }>
  | Readonly<{
    readonly _tag: "completed";
    readonly state: QuerySyncState;
    readonly generation: QueryGeneration;
    readonly publicationRequired: boolean;
  }>;

export type CaptureNamespaceCursorError = QuerySyncCanonicalValueError;
export type CaptureQueryDescriptorError = QuerySyncCanonicalValueError;
export type CaptureInvalidationBatchError =
  | QuerySyncCanonicalValueError
  | QueryDependencyLimitError<"captureInvalidationBatch">;
export type CaptureEvaluationEvidenceError =
  | QuerySyncCanonicalValueError
  | QueryDependencyLimitError<"captureEvaluationEvidence">;
export type BuildQuerySyncStateError =
  | QueryKeyCollisionError<"buildQuerySyncState">
  | QuerySyncStateLimitError;

function freezeNamespaceCursor(cursor: NamespaceCursor): NamespaceCursor {
  return Object.freeze({
    namespaceId: cursor.namespaceId,
    syncModelId: cursor.syncModelId,
    sourceEpoch: cursor.sourceEpoch,
    appliedThroughSequence: cursor.appliedThroughSequence,
  });
}

function freezeQueryDescriptor(descriptor: QueryDescriptor): QueryDescriptor {
  return Object.freeze({
    queryKey: descriptor.queryKey,
    queryIdentity: descriptor.queryIdentity,
  });
}

function freezeDependencyKeys(
  dependencyKeys: readonly CanonicalDependencyKey[],
): readonly CanonicalDependencyKey[] {
  return Object.freeze([...dependencyKeys]);
}

function freezeProvisionalQueryState(
  provisional: ProvisionalQueryState,
): ProvisionalQueryState {
  return Object.freeze({
    generation: provisional.generation,
    registrationCursor: freezeNamespaceCursor(provisional.registrationCursor),
  });
}

function freezeActiveQueryState(active: ActiveQueryState): ActiveQueryState {
  return Object.freeze({
    generation: active.generation,
    evaluationSnapshotSequence: active.evaluationSnapshotSequence,
    freshThroughSequence: active.freshThroughSequence,
    dirtyThroughSequence: active.dirtyThroughSequence,
    resultDigest: active.resultDigest,
    authorityWitness: active.authorityWitness,
    dependencyKeys: freezeDependencyKeys(active.dependencyKeys),
  });
}

function freezeQueryState(query: QueryState): QueryState {
  return Object.freeze({
    descriptor: freezeQueryDescriptor(query.descriptor),
    active: query.active === null ? null : freezeActiveQueryState(query.active),
    provisional: query.provisional === null
      ? null
      : freezeProvisionalQueryState(query.provisional),
  });
}

function dependencyLimitError<Operation extends QueryDependencyLimitOperation>(
  operation: Operation,
  dimension: QueryDependencyLimitError["dimension"],
  maximum: number,
  observed: number,
): QueryDependencyLimitError<Operation> {
  return new QueryDependencyLimitError<Operation>({
    operation,
    dimension,
    maximum,
    observed,
  });
}

function stateLimitError(
  dimension: QuerySyncStateLimitError["dimension"],
  maximum: number,
  observed: number,
): QuerySyncStateLimitError {
  return new QuerySyncStateLimitError({
    operation: "buildQuerySyncState",
    dimension,
    maximum,
    observed,
  });
}

function normalizeDependencyKeys<
  Operation extends QueryDependencyLimitOperation,
>(
  input: unknown,
  operation: Operation,
  maximumEntries: number,
  maximumDecodedBytes: number,
): Result.Result<
  readonly CanonicalDependencyKey[],
  QuerySyncCanonicalValueError | QueryDependencyLimitError<Operation>
> {
  if (!Array.isArray(input)) {
    return Result.fail(new QuerySyncCanonicalValueError({
      field: "dependencyKey",
      reason: "invalidType",
      maximum: null,
      observed: null,
    }));
  }
  const dependencyInputs: readonly unknown[] = input;
  const inputLength = dependencyInputs.length;
  if (inputLength > maximumEntries) {
    return Result.fail(dependencyLimitError(
      operation,
      "rawEntries",
      maximumEntries,
      inputLength,
    ));
  }

  return Result.gen(function* () {
    const captured = new Set<CanonicalDependencyKey>();
    const admittedSpellings = new Set<string>();
    let decodedBytes = 0;
    for (let index = 0; index < inputLength; index += 1) {
      const rawDependencyKey = dependencyInputs[index];
      if (
        typeof rawDependencyKey === "string"
        && admittedSpellings.has(rawDependencyKey)
      ) {
        continue;
      }
      const dependencyKey = yield* captureCanonicalDependencyKey(
        rawDependencyKey,
      );
      admittedSpellings.add(dependencyKey);
      decodedBytes += canonicalBase64UrlDecodedLength(dependencyKey);
      if (decodedBytes > maximumDecodedBytes) {
        return yield* Result.fail(dependencyLimitError(
          operation,
          "decodedBytes",
          maximumDecodedBytes,
          decodedBytes,
        ));
      }
      captured.add(dependencyKey);
      if (captured.size > maximumEntries) {
        return yield* Result.fail(dependencyLimitError(
          operation,
          "distinctEntries",
          maximumEntries,
          captured.size,
        ));
      }
    }
    const normalized = [...captured];
    normalized.sort(compareCanonicalBase64Url);
    return freezeDependencyKeys(normalized);
  });
}

export function captureNamespaceCursor(
  input: NamespaceCursorInput,
): Result.Result<NamespaceCursor, CaptureNamespaceCursorError> {
  return Result.gen(function* () {
    const namespaceId = yield* captureSyncNamespaceId(input.namespaceId);
    const syncModelId = yield* captureSyncModelId(input.syncModelId);
    const sourceEpoch = yield* captureSyncEpoch(input.sourceEpoch);
    const appliedThroughSequence = yield* captureSyncSequence(
      input.appliedThroughSequence,
    );
    return freezeNamespaceCursor({
      namespaceId,
      syncModelId,
      sourceEpoch,
      appliedThroughSequence,
    });
  });
}

export function captureQueryDescriptor(
  input: QueryDescriptorInput,
): Result.Result<QueryDescriptor, CaptureQueryDescriptorError> {
  return Result.gen(function* () {
    const queryKey = yield* captureCanonicalQueryKey(input.queryKey);
    const queryIdentity = yield* captureCanonicalQueryIdentity(
      input.queryIdentity,
    );
    return freezeQueryDescriptor({ queryKey, queryIdentity });
  });
}

export function captureQueryOperationTarget(
  input: QueryOperationTargetInput,
): Result.Result<QueryOperationTarget, QuerySyncCanonicalValueError> {
  return Result.gen(function* () {
    const capturedNamespaceId = yield* captureSyncNamespaceId(
      input.namespaceId,
    );
    const capturedSyncModelId = yield* captureSyncModelId(input.syncModelId);
    const capturedSourceEpoch = yield* captureSyncEpoch(input.sourceEpoch);
    const capturedDescriptor = yield* captureQueryDescriptor(input.descriptor);
    return Object.freeze({
      namespaceId: capturedNamespaceId,
      syncModelId: capturedSyncModelId,
      sourceEpoch: capturedSourceEpoch,
      descriptor: capturedDescriptor,
    });
  });
}

export function captureAdmittedInvalidationBatch(
  input: AdmittedInvalidationBatchInput,
): Result.Result<AdmittedInvalidationBatch, CaptureInvalidationBatchError> {
  return Result.gen(function* () {
    const namespaceId = yield* captureSyncNamespaceId(input.namespaceId);
    const syncModelId = yield* captureSyncModelId(input.syncModelId);
    const sourceEpoch = yield* captureSyncEpoch(input.sourceEpoch);
    const sourceSequence = yield* captureSyncSequence(input.sourceSequence);
    const dependencyKeys = yield* normalizeDependencyKeys(
      input.dependencyKeys,
      "captureInvalidationBatch",
      MAX_INVALIDATION_KEYS,
      MAX_INVALIDATION_BATCH_BYTES,
    );
    return Object.freeze({
      namespaceId,
      syncModelId,
      sourceEpoch,
      sourceSequence,
      dependencyKeys,
    });
  });
}

export function captureQueryEvaluationEvidence(
  input: QueryEvaluationEvidenceInput,
): Result.Result<QueryEvaluationEvidence, CaptureEvaluationEvidenceError> {
  return Result.gen(function* () {
    const namespaceId = yield* captureSyncNamespaceId(input.namespaceId);
    const syncModelId = yield* captureSyncModelId(input.syncModelId);
    const sourceEpoch = yield* captureSyncEpoch(input.sourceEpoch);
    const descriptor = yield* captureQueryDescriptor(input.descriptor);
    const generation = yield* captureQueryGeneration(input.generation);
    const snapshotSequence = yield* captureQuerySnapshot(
      input.snapshotSequence,
    );
    const resultDigest = yield* captureQueryResultDigest(input.resultDigest);
    const authorityWitness = yield* captureQueryAuthorityWitness(
      input.authorityWitness,
    );
    const dependencyKeys = yield* normalizeDependencyKeys(
      input.dependencyKeys,
      "captureEvaluationEvidence",
      MAX_QUERY_DEPENDENCY_KEYS,
      MAX_QUERY_DEPENDENCY_BYTES,
    );
    return Object.freeze({
      namespaceId,
      syncModelId,
      sourceEpoch,
      descriptor,
      generation,
      snapshotSequence,
      resultDigest,
      authorityWitness,
      dependencyKeys,
    });
  });
}

export function createEmptyQuerySyncState(
  cursor: NamespaceCursor,
): Result.Result<QuerySyncState, BuildQuerySyncStateError> {
  return buildQuerySyncState(cursor, []);
}

function stateInvariantDefect(
  invariant: QuerySyncInvariantDefect["invariant"],
): QuerySyncInvariantDefect {
  return new QuerySyncInvariantDefect({
    operation: "buildQuerySyncState",
    invariant,
  });
}

function assertQueryStateInvariants(
  cursor: NamespaceCursor,
  query: QueryState,
): void {
  if (query.active === null && query.provisional === null) {
    throw stateInvariantDefect("emptyQuerySlots");
  }
  if (query.provisional !== null) {
    const registration = query.provisional.registrationCursor;
    if (
      registration.namespaceId !== cursor.namespaceId
      || registration.syncModelId !== cursor.syncModelId
      || registration.sourceEpoch !== cursor.sourceEpoch
    ) {
      throw stateInvariantDefect("provisionalRegistrationAuthorityMismatch");
    }
    if (registration.appliedThroughSequence > cursor.appliedThroughSequence) {
      throw stateInvariantDefect("provisionalRegistrationAheadOfCursor");
    }
    if (query.active === null && query.provisional.generation !== 1n) {
      throw stateInvariantDefect("initialProvisionalGenerationNotOne");
    }
    if (
      query.active !== null
      && query.provisional.generation <= query.active.generation
    ) {
      throw stateInvariantDefect("provisionalGenerationNotAfterActive");
    }
  }
  if (query.active === null) return;
  if (
    query.active.evaluationSnapshotSequence
    > query.active.freshThroughSequence
  ) {
    throw stateInvariantDefect("activeSnapshotAfterFreshness");
  }
  if (query.active.freshThroughSequence > cursor.appliedThroughSequence) {
    throw stateInvariantDefect("activeFreshnessAheadOfCursor");
  }
  if (query.active.dirtyThroughSequence !== null) {
    if (
      query.active.dirtyThroughSequence <= query.active.freshThroughSequence
    ) {
      throw stateInvariantDefect("activeDirtyNotAfterFreshness");
    }
    if (
      query.active.dirtyThroughSequence > cursor.appliedThroughSequence
    ) {
      throw stateInvariantDefect("activeDirtyAheadOfCursor");
    }
  }
  if (query.active.dependencyKeys.length > MAX_QUERY_DEPENDENCY_KEYS) {
    throw stateInvariantDefect("activeDependencyCountExceeded");
  }

  let dependencyBytes = 0;
  let previousDependencyKey: CanonicalDependencyKey | undefined;
  for (const dependencyKey of query.active.dependencyKeys) {
    if (
      previousDependencyKey !== undefined
      && compareCanonicalBase64Url(previousDependencyKey, dependencyKey) >= 0
    ) {
      throw stateInvariantDefect("activeDependenciesNotCanonicalSet");
    }
    previousDependencyKey = dependencyKey;
    dependencyBytes += canonicalBase64UrlDecodedLength(dependencyKey);
    if (dependencyBytes > MAX_QUERY_DEPENDENCY_BYTES) {
      throw stateInvariantDefect("activeDependencyBytesExceeded");
    }
  }
}

export function buildQuerySyncState(
  cursor: NamespaceCursor,
  queryStates: readonly QueryState[],
): Result.Result<QuerySyncState, BuildQuerySyncStateError> {
  if (queryStates.length > MAX_REFERENCE_QUERIES) {
    return Result.fail(stateLimitError(
      "queryCount",
      MAX_REFERENCE_QUERIES,
      queryStates.length,
    ));
  }

  let retainedIdentityBytes = 0;
  let dependencyMemberships = 0;
  let countedCanonicalBytes = wellFormedUtf8ByteLength(cursor.namespaceId)
    + wellFormedUtf8ByteLength(cursor.syncModelId)
    + wellFormedUtf8ByteLength(cursor.sourceEpoch)
    + FIXED_WIDTH_INTEGER_BYTES;
  const observedQueryKeys = new Set<CanonicalQueryKey>();

  for (const query of queryStates) {
    assertQueryStateInvariants(cursor, query);
    if (observedQueryKeys.has(query.descriptor.queryKey)) {
      return Result.fail(new QueryKeyCollisionError<"buildQuerySyncState">({
        operation: "buildQuerySyncState",
        queryKey: query.descriptor.queryKey,
      }));
    }
    observedQueryKeys.add(query.descriptor.queryKey);

    const identityBytes = canonicalBase64UrlDecodedLength(
      query.descriptor.queryIdentity,
    );
    retainedIdentityBytes += identityBytes;
    countedCanonicalBytes += QUERY_KEY_BYTES
      + identityBytes
      + (2 * SLOT_PRESENCE_BYTES);

    if (query.provisional !== null) {
      countedCanonicalBytes += 2 * FIXED_WIDTH_INTEGER_BYTES;
    }
    if (query.active !== null) {
      countedCanonicalBytes += (3 * FIXED_WIDTH_INTEGER_BYTES)
        + QUERY_RESULT_DIGEST_BYTES
        + QUERY_AUTHORITY_WITNESS_BYTES
        + SLOT_PRESENCE_BYTES;
      if (query.active.dirtyThroughSequence !== null) {
        countedCanonicalBytes += FIXED_WIDTH_INTEGER_BYTES;
      }
      for (const dependencyKey of query.active.dependencyKeys) {
        dependencyMemberships += 1;
        countedCanonicalBytes += canonicalBase64UrlDecodedLength(
          dependencyKey,
        );
      }
    }

    if (retainedIdentityBytes > MAX_RETAINED_QUERY_IDENTITY_BYTES) {
      return Result.fail(stateLimitError(
        "retainedIdentityBytes",
        MAX_RETAINED_QUERY_IDENTITY_BYTES,
        retainedIdentityBytes,
      ));
    }
    if (
      dependencyMemberships > MAX_AGGREGATE_DEPENDENCY_MEMBERSHIPS
    ) {
      return Result.fail(stateLimitError(
        "dependencyMemberships",
        MAX_AGGREGATE_DEPENDENCY_MEMBERSHIPS,
        dependencyMemberships,
      ));
    }
    if (countedCanonicalBytes > MAX_COUNTED_CANONICAL_BYTES) {
      return Result.fail(stateLimitError(
        "countedCanonicalBytes",
        MAX_COUNTED_CANONICAL_BYTES,
        countedCanonicalBytes,
      ));
    }
  }

  const queries = queryStates.map(freezeQueryState);
  queries.sort((left, right) => compareCanonicalBase64Url(
    left.descriptor.queryKey,
    right.descriptor.queryKey,
  ));
  const dependencyDirectory = new Map<
    CanonicalDependencyKey,
    CanonicalQueryKey[]
  >();
  for (const query of queries) {
    if (query.active === null) continue;
    for (const dependencyKey of query.active.dependencyKeys) {
      const existing = dependencyDirectory.get(dependencyKey);
      if (existing === undefined) {
        dependencyDirectory.set(dependencyKey, [query.descriptor.queryKey]);
      } else {
        existing.push(query.descriptor.queryKey);
      }
    }
  }

  const orderedDirectoryEntries = [...dependencyDirectory.entries()];
  orderedDirectoryEntries.sort(([left], [right]) => (
    compareCanonicalBase64Url(left, right)
  ));
  const directory = orderedDirectoryEntries
    .map(([dependencyKey, queryKeys]): DependencyDirectoryEntry => (
      Object.freeze({
        dependencyKey,
        queryKeys: Object.freeze([...queryKeys]),
      })
    ));
  const metrics = Object.freeze({
    queryCount: queries.length,
    retainedIdentityBytes,
    dependencyMemberships,
    countedCanonicalBytes,
  });

  return Result.succeed(Object.freeze({
    cursor: freezeNamespaceCursor(cursor),
    queries: Object.freeze(queries),
    dependencyDirectory: Object.freeze(directory),
    metrics,
  }));
}

export function findQueryState(
  state: QuerySyncState,
  queryKey: CanonicalQueryKey,
): QueryState | undefined {
  let lower = 0;
  let upper = state.queries.length - 1;
  while (lower <= upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    const query = state.queries[middle];
    if (query === undefined) return undefined;
    const comparison = compareCanonicalBase64Url(
      query.descriptor.queryKey,
      queryKey,
    );
    if (comparison === 0) return query;
    if (comparison < 0) lower = middle + 1;
    else upper = middle - 1;
  }
  return undefined;
}

export function findDependencyDirectoryEntry(
  state: QuerySyncState,
  dependencyKey: CanonicalDependencyKey,
): DependencyDirectoryEntry | undefined {
  let lower = 0;
  let upper = state.dependencyDirectory.length - 1;
  while (lower <= upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    const entry = state.dependencyDirectory[middle];
    if (entry === undefined) return undefined;
    const comparison = compareCanonicalBase64Url(
      entry.dependencyKey,
      dependencyKey,
    );
    if (comparison === 0) return entry;
    if (comparison < 0) lower = middle + 1;
    else upper = middle - 1;
  }
  return undefined;
}

export function makeGenerationRefreshEvidence(input: {
  readonly namespaceId: SyncNamespaceId;
  readonly syncModelId: SyncModelId;
  readonly sourceEpoch: SyncEpoch;
  readonly descriptor: QueryDescriptor;
  readonly generation: QueryGeneration;
  readonly evaluationSnapshotSequence: QuerySnapshot;
  readonly evaluationDependencyKeys: readonly CanonicalDependencyKey[];
  readonly refreshedThroughSequence: SyncSequence;
  readonly relevantThroughSequence: SyncSequence | null;
  readonly authorityWitness: QueryAuthorityWitness;
}): GenerationRefreshEvidence {
  return new AdmittedGenerationRefreshEvidence({
    namespaceId: input.namespaceId,
    syncModelId: input.syncModelId,
    sourceEpoch: input.sourceEpoch,
    descriptor: input.descriptor,
    generation: input.generation,
    evaluationSnapshotSequence: input.evaluationSnapshotSequence,
    evaluationDependencyKeys: input.evaluationDependencyKeys,
    refreshedThroughSequence: input.refreshedThroughSequence,
    relevantThroughSequence: input.relevantThroughSequence,
    authorityWitness: input.authorityWitness,
  });
}

export function replaceQueryState(
  state: QuerySyncState,
  replacement: QueryState,
): Result.Result<QuerySyncState, BuildQuerySyncStateError> {
  const nextQueries: QueryState[] = [];
  let replaced = false;
  for (const query of state.queries) {
    if (query.descriptor.queryKey === replacement.descriptor.queryKey) {
      nextQueries.push(replacement);
      replaced = true;
    } else {
      nextQueries.push(query);
    }
  }
  if (!replaced) nextQueries.push(replacement);
  return buildQuerySyncState(state.cursor, nextQueries);
}

export function replaceQueryStatesAndCursor(
  state: QuerySyncState,
  cursor: NamespaceCursor,
  replacements: ReadonlyMap<CanonicalQueryKey, QueryState>,
): Result.Result<QuerySyncState, BuildQuerySyncStateError> {
  const queries = state.queries.map((query) => (
    replacements.get(query.descriptor.queryKey) ?? query
  ));
  return buildQuerySyncState(cursor, queries);
}
