import {
  MAX_COUNTED_CANONICAL_BYTES,
  MAX_INLINE_PUBLICATION_CONTENT_BYTES,
  MAX_PENDING_PUBLICATIONS,
  MAX_REFERENCE_QUERIES,
  MAX_RETAINED_PUBLICATION_CONTENT_BYTES,
  buildQuerySyncState,
  canonicalBase64UrlEncodedLength,
  canonicalPublicationContentDecodedLength,
  captureQueryAuthorityWitness,
  captureQueryDescriptor,
  captureQueryEvaluationEvidence,
  captureQueryGeneration,
  captureQueryPublicationArtifact,
  captureQueryResultDigest,
  captureQuerySnapshot,
  createEmptyQuerySyncState,
  makePendingQueryPublication,
  makeQueryPublicationIdentity,
  pendingPublicationDisposition,
  type CanonicalPublicationContent,
  type GenerationRefreshEvidence,
  type NamespaceCursor,
  type PendingQueryPublication,
  type QueryEvaluationAttempt,
  type QueryEvaluationEvidence,
  type QueryPublicationArtifact,
  type QueryState,
  type QuerySyncState,
  type QuerySyncWorkRevision,
} from "@flarex/query-sync/internal/kernel";
import {
  deriveGenerationRefreshEvidence,
} from "@flarex/query-sync/testing/reference-model";
import { Encoding, Result } from "effect";

import type {
  DeploymentQuerySyncSqlStorage,
  DeploymentQuerySyncStorage,
} from "../src/deploymentSync/StorageContract";
import {
  buildCountedCanonicalMaximumEvaluationPopulation,
} from "./deploymentSyncEvaluationPopulationTestSupport";

const MAXIMUM_CONTENT_ROW_COUNT =
  MAX_RETAINED_PUBLICATION_CONTENT_BYTES
  / MAX_INLINE_PUBLICATION_CONTENT_BYTES;
const MAXIMUM_CONTENT_CHARACTERS = canonicalBase64UrlEncodedLength(
  MAX_INLINE_PUBLICATION_CONTENT_BYTES,
);

export interface PublicationLimitPopulation {
  readonly state: QuerySyncState;
  readonly selectedQuery: QueryState;
  readonly selectedPending: PendingQueryPublication;
}

export function buildMaximumPublicationPopulation(input: {
  readonly cursor: NamespaceCursor;
  readonly registrationCursor: NamespaceCursor;
  readonly evaluationWorkRevision: QuerySyncWorkRevision;
}): PublicationLimitPopulation {
  if (
    MAX_PENDING_PUBLICATIONS !== MAX_REFERENCE_QUERIES
    || !Number.isSafeInteger(MAXIMUM_CONTENT_ROW_COUNT)
    || MAXIMUM_CONTENT_ROW_COUNT < 1
    || MAXIMUM_CONTENT_ROW_COUNT > MAX_PENDING_PUBLICATIONS
  ) {
    throw new Error("Maximum publication fixture limits cannot be aligned.");
  }
  const maximumContent = canonicalContent(
    MAX_INLINE_PUBLICATION_CONTENT_BYTES,
    0x70,
  );
  const emptyContent = canonicalContent(0, 0);
  const queryIdentity = canonicalData(16, 0x69);
  const selectedIndex = lowestIndexedKeyIndex(MAX_PENDING_PUBLICATIONS);
  const maximumContentIndices = maximumContentIndexes(selectedIndex);
  const completed = Array.from(
    { length: MAX_PENDING_PUBLICATIONS },
    (_value, index) => completedPendingQuery({
      cursor: input.cursor,
      registrationCursor: input.registrationCursor,
      index,
      queryIdentity,
      content: maximumContentIndices.has(index)
        ? maximumContent
        : emptyContent,
      successorReady: index === selectedIndex,
    }),
  );
  const state = buildPopulation({
    cursor: input.cursor,
    evaluationWorkRevision: input.evaluationWorkRevision,
    queries: completed.map(entry => entry.query),
    pending: completed.map(entry => entry.pending),
  });
  if (
    state.metrics.queryCount !== MAX_REFERENCE_QUERIES
    || state.metrics.pendingPublicationCount !== MAX_PENDING_PUBLICATIONS
    || state.metrics.retainedPublicationContentBytes
      !== MAX_RETAINED_PUBLICATION_CONTENT_BYTES
  ) {
    throw new Error("Maximum publication fixture metrics are not exact.");
  }
  const selectedPending = requiredAt(state.publicationWork.pending, 0);
  const selectedQuery = state.queries.find(query =>
    query.descriptor.queryKey === selectedPending.identity.queryKey
  );
  if (selectedQuery === undefined || selectedQuery.provisional === null) {
    throw new Error("Maximum publication fixture has no ready successor.");
  }
  return Object.freeze({ state, selectedQuery, selectedPending });
}

export function buildCountedCanonicalClaimPopulation(input: {
  readonly cursor: NamespaceCursor;
  readonly evaluationWorkRevision: QuerySyncWorkRevision;
  readonly preClaimCountedCanonicalBytes: number;
}): PublicationLimitPopulation {
  const target = input.preClaimCountedCanonicalBytes;
  if (
    !Number.isSafeInteger(target)
    || target < 0
    || target > MAX_COUNTED_CANONICAL_BYTES
  ) {
    throw new Error("Invalid pre-claim counted-canonical target.");
  }
  const maximum = buildCountedCanonicalMaximumEvaluationPopulation({
    cursor: input.cursor,
    evaluationWorkRevision: input.evaluationWorkRevision,
  });
  const selectedPending = requiredAt(
    maximum.state.publicationWork.pending,
    0,
  );
  const reduction = MAX_COUNTED_CANONICAL_BYTES - target;
  const selectedContentBytes = canonicalPublicationContentDecodedLength(
    selectedPending.content,
  );
  if (reduction > selectedContentBytes) {
    throw new Error(
      "Pre-claim counted-canonical target exceeds fixture padding capacity.",
    );
  }
  const replacement = makePendingQueryPublication({
    ...selectedPending,
    content: canonicalContent(selectedContentBytes - reduction, 0x70),
  });
  const state = resultSuccess(buildQuerySyncState({
    cursor: maximum.state.cursor,
    queries: maximum.state.queries,
    evaluationWork: maximum.state.evaluationWork,
    publicationWork: Object.freeze({
      ...maximum.state.publicationWork,
      pending: Object.freeze([
        replacement,
        ...maximum.state.publicationWork.pending.slice(1),
      ]),
    }),
  }));
  if (state.metrics.countedCanonicalBytes !== target) {
    throw new Error("Counted-canonical claim fixture target is not exact.");
  }
  const selectedQuery = state.queries.find(query =>
    query.descriptor.queryKey === replacement.identity.queryKey
  );
  if (selectedQuery === undefined) {
    throw new Error("Counted-canonical claim fixture owner is missing.");
  }
  return Object.freeze({
    state,
    selectedQuery,
    selectedPending: replacement,
  });
}

export function makePublicationSuccessorMaterial(
  cursor: NamespaceCursor,
  attempt: QueryEvaluationAttempt,
): Readonly<{
  readonly evaluation: QueryEvaluationEvidence;
  readonly refresh: GenerationRefreshEvidence;
  readonly publication: QueryPublicationArtifact;
}> {
  const authorityWitness = resultSuccess(captureQueryAuthorityWitness(
    canonicalData(32, 0x7e),
  ));
  const evaluation = resultSuccess(captureQueryEvaluationEvidence({
    namespaceId: cursor.namespaceId,
    syncModelId: cursor.syncModelId,
    sourceEpoch: cursor.sourceEpoch,
    descriptor: attempt.descriptor,
    generation: attempt.generation,
    snapshotSequence: attempt.registrationCursor.appliedThroughSequence,
    resultDigest: canonicalData(32, 0x6e),
    authorityWitness,
    dependencyKeys: [],
  }));
  const refresh = resultSuccess(deriveGenerationRefreshEvidence(
    evaluation,
    cursor,
    [],
    authorityWitness,
  ));
  const publication = resultSuccess(captureQueryPublicationArtifact({
    content: canonicalData(0, 0),
  }));
  return Object.freeze({ evaluation, refresh, publication });
}

interface ScopeMetricsRow {
  readonly [key: string]: SqlStorageValue;
  readonly query_count: number;
  readonly retained_identity_bytes: number;
  readonly dependency_memberships: number;
  readonly pending_publication_count: number;
  readonly in_flight_publication_count: number;
  readonly retained_publication_content_bytes: number;
  readonly settlement_envelope_bytes: number;
  readonly counted_canonical_bytes: number;
}

interface PublicationAggregateRow {
  readonly [key: string]: SqlStorageValue;
  readonly query_row_count: number;
  readonly pending_row_count: number;
  readonly in_flight_row_count: number;
  readonly maximum_content_pending_row_count: number;
}

interface SelectedQueryRow {
  readonly [key: string]: SqlStorageValue;
  readonly active_generation: string | null;
  readonly provisional_generation: string | null;
  readonly completion_generation: string | null;
  readonly completion_publication_disposition: string | null;
}

interface SelectedPublicationRow {
  readonly [key: string]: SqlStorageValue;
  readonly generation: string;
  readonly content_characters: number;
}

export function publicationLimitsSummary(
  sql: DeploymentQuerySyncSqlStorage,
  selectedQueryKey: string,
) {
  const scope = sql.exec<ScopeMetricsRow>(`SELECT
    query_count,
    retained_identity_bytes,
    dependency_memberships,
    pending_publication_count,
    in_flight_publication_count,
    retained_publication_content_bytes,
    settlement_envelope_bytes,
    counted_canonical_bytes
    FROM main.deployment_sync_scope_state
    WHERE singleton = 1`).one();
  const aggregate = sql.exec<PublicationAggregateRow>(`SELECT
    (SELECT count(*) FROM main.deployment_sync_queries) AS query_row_count,
    (SELECT count(*) FROM main.deployment_sync_pending_publications)
      AS pending_row_count,
    (SELECT count(*) FROM main.deployment_sync_in_flight_publication)
      AS in_flight_row_count,
    (SELECT count(*) FROM main.deployment_sync_pending_publications
      WHERE length(content) = ?) AS maximum_content_pending_row_count`,
  MAXIMUM_CONTENT_CHARACTERS).one();
  const selectedQuery = sql.exec<SelectedQueryRow>(`SELECT
    active_generation,
    provisional_generation,
    completion_generation,
    completion_publication_disposition
    FROM main.deployment_sync_queries
    WHERE query_key = ?`, selectedQueryKey).one();
  const selectedPending = sql.exec<SelectedPublicationRow>(`SELECT
    generation,
    length(content) AS content_characters
    FROM main.deployment_sync_pending_publications
    WHERE query_key = ?`, selectedQueryKey).toArray()[0] ?? null;
  const selectedInFlight = sql.exec<SelectedPublicationRow>(`SELECT
    generation,
    length(content) AS content_characters
    FROM main.deployment_sync_in_flight_publication
    WHERE query_key = ?`, selectedQueryKey).toArray()[0] ?? null;
  return Object.freeze({
    physical: Object.freeze({
      queryRowCount: aggregate.query_row_count,
      pendingRowCount: aggregate.pending_row_count,
      inFlightRowCount: aggregate.in_flight_row_count,
      maximumContentPendingRowCount:
        aggregate.maximum_content_pending_row_count,
    }),
    scopeMetrics: scopeMetrics(scope),
    selected: Object.freeze({
      activeGeneration: selectedQuery.active_generation,
      provisionalGeneration: selectedQuery.provisional_generation,
      completionGeneration: selectedQuery.completion_generation,
      completionPublicationDisposition:
        selectedQuery.completion_publication_disposition,
      pending: selectedPending === null
        ? null
        : Object.freeze({
            generation: selectedPending.generation,
            contentCharacters: selectedPending.content_characters,
          }),
      inFlight: selectedInFlight === null
        ? null
        : Object.freeze({
            generation: selectedInFlight.generation,
            contentCharacters: selectedInFlight.content_characters,
          }),
    }),
  });
}

interface PendingSelectionCapture {
  readonly query: string;
  readonly bindings: readonly SqlStorageValue[];
}

interface QueryPlanRow {
  readonly [key: string]: SqlStorageValue;
  readonly id: number;
  readonly parent: number;
  readonly detail: string;
}

export interface PendingSelectionPlanProbe {
  readonly storage: DeploymentQuerySyncStorage;
  readonly captureCount: () => number;
  readonly explain: () => readonly Readonly<{
    readonly id: number;
    readonly parent: number;
    readonly detail: string;
  }>[];
}

export function makePendingSelectionPlanProbe(
  storage: DeploymentQuerySyncStorage,
): PendingSelectionPlanProbe {
  let captures: PendingSelectionCapture[] = [];
  const exec: DeploymentQuerySyncSqlStorage["exec"] = <
    Row extends Record<string, SqlStorageValue>,
  >(
    query: string,
    ...bindings: SqlStorageValue[]
  ): SqlStorageCursor<Row> => {
    if (isLowestPendingSelection(query)) {
      captures = [...captures, Object.freeze({
        query,
        bindings: Object.freeze([...bindings]),
      })];
    }
    return storage.sql.exec<Row>(query, ...bindings);
  };
  return Object.freeze({
    storage: Object.freeze({
      sql: Object.freeze({ exec }),
      transactionSync: <A>(closure: () => A): A =>
        storage.transactionSync(closure),
    }),
    captureCount: () => captures.length,
    explain: () => {
      const capture = captures.at(-1);
      if (capture === undefined) {
        throw new Error("No lowest-pending selection SQL was captured.");
      }
      return Object.freeze(storage.sql.exec<QueryPlanRow>(
        `EXPLAIN QUERY PLAN ${capture.query}`,
        ...capture.bindings,
      ).toArray().map(row => Object.freeze({
        id: row.id,
        parent: row.parent,
        detail: row.detail,
      })));
    },
  });
}

function completedPendingQuery(input: {
  readonly cursor: NamespaceCursor;
  readonly registrationCursor: NamespaceCursor;
  readonly index: number;
  readonly queryIdentity: string;
  readonly content: CanonicalPublicationContent;
  readonly successorReady: boolean;
}): Readonly<{
  readonly query: QueryState;
  readonly pending: PendingQueryPublication;
}> {
  const descriptor = resultSuccess(captureQueryDescriptor({
    queryKey: indexedCanonicalData(32, input.index, 0x4b),
    queryIdentity: input.queryIdentity,
  }));
  const generation = resultSuccess(captureQueryGeneration(1n));
  const evaluationSnapshotSequence = resultSuccess(captureQuerySnapshot(
    input.registrationCursor.appliedThroughSequence,
  ));
  const resultDigest = resultSuccess(captureQueryResultDigest(
    indexedCanonicalData(32, input.index, 0x5d),
  ));
  const authorityWitness = resultSuccess(captureQueryAuthorityWitness(
    indexedCanonicalData(32, input.index, 0x7d),
  ));
  const identity = makeQueryPublicationIdentity({
    namespaceId: input.cursor.namespaceId,
    syncModelId: input.cursor.syncModelId,
    sourceEpoch: input.cursor.sourceEpoch,
    queryKey: descriptor.queryKey,
    generation,
  });
  const pending = makePendingQueryPublication({
    identity,
    queryIdentity: descriptor.queryIdentity,
    completedThroughSequence:
      input.registrationCursor.appliedThroughSequence,
    resultDigest,
    content: input.content,
  });
  const query = Object.freeze({
    descriptor,
    active: Object.freeze({
      generation,
      evaluationSnapshotSequence,
      freshThroughSequence: input.registrationCursor.appliedThroughSequence,
      dirtyThroughSequence: input.successorReady
        ? input.cursor.appliedThroughSequence
        : null,
      resultDigest,
      authorityWitness,
      dependencyKeys: Object.freeze([]),
    }),
    provisional: input.successorReady
      ? Object.freeze({
          generation: resultSuccess(captureQueryGeneration(2n)),
          expectedActiveGeneration: generation,
          registrationCursor: input.cursor,
          requestedDirtyThroughSequence: input.cursor.appliedThroughSequence,
          evaluationDisposition: Object.freeze({ _tag: "ready" as const }),
        })
      : null,
    currentCompletion: Object.freeze({
      identity,
      queryIdentity: descriptor.queryIdentity,
      expectedActiveGeneration: null,
      registrationCursor: input.registrationCursor,
      requestedDirtyThroughSequence: null,
      evaluationSnapshotSequence,
      evaluationDependencyKeys: Object.freeze([]),
      evaluationAuthorityWitness: authorityWitness,
      refreshedThroughSequence:
        input.registrationCursor.appliedThroughSequence,
      relevantThroughSequence: null,
      refreshAuthorityWitness: authorityWitness,
      resultDigest,
      publicationDisposition: pendingPublicationDisposition(identity),
    }),
    precedingCompletionIdentity: null,
  } satisfies QueryState);
  return Object.freeze({ query, pending });
}

function buildPopulation(input: {
  readonly cursor: NamespaceCursor;
  readonly evaluationWorkRevision: QuerySyncWorkRevision;
  readonly queries: readonly QueryState[];
  readonly pending: readonly PendingQueryPublication[];
}): QuerySyncState {
  const empty = resultSuccess(createEmptyQuerySyncState(input.cursor));
  return resultSuccess(buildQuerySyncState({
    cursor: input.cursor,
    queries: input.queries,
    evaluationWork: Object.freeze({
      revision: input.evaluationWorkRevision,
      fairnessAnchor: null,
    }),
    publicationWork: Object.freeze({
      pending: input.pending,
      inFlight: empty.publicationWork.inFlight,
      latestDelivered: empty.publicationWork.latestDelivered,
      precedingAttemptOutcome:
        empty.publicationWork.precedingAttemptOutcome,
    }),
  }));
}

function scopeMetrics(row: ScopeMetricsRow) {
  return Object.freeze({
    queryCount: row.query_count,
    retainedIdentityBytes: row.retained_identity_bytes,
    dependencyMemberships: row.dependency_memberships,
    pendingPublicationCount: row.pending_publication_count,
    inFlightPublicationCount: row.in_flight_publication_count,
    retainedPublicationContentBytes:
      row.retained_publication_content_bytes,
    settlementEnvelopeBytes: row.settlement_envelope_bytes,
    countedCanonicalBytes: row.counted_canonical_bytes,
  });
}

function isLowestPendingSelection(query: string): boolean {
  const normalized = query.replace(/\s+/gu, " ").trim().toLowerCase();
  return normalized.startsWith("select query_key, generation, query_identity,")
    && normalized.includes(
      "from main.deployment_sync_pending_publications",
    )
    && normalized.endsWith(
      "order by query_key collate binary limit 1",
    );
}

function canonicalContent(
  byteLength: number,
  fill: number,
): CanonicalPublicationContent {
  return resultSuccess(captureQueryPublicationArtifact({
    content: canonicalData(byteLength, fill),
  })).content;
}

function canonicalData(byteLength: number, fill: number): string {
  return Encoding.encodeBase64Url(new Uint8Array(byteLength).fill(fill));
}

function indexedCanonicalData(
  byteLength: number,
  index: number,
  fill: number,
): string {
  const bytes = new Uint8Array(byteLength).fill(fill);
  new DataView(bytes.buffer).setUint32(0, index, false);
  return Encoding.encodeBase64Url(bytes);
}

function lowestIndexedKeyIndex(count: number): number {
  let selectedIndex = 0;
  let selectedKey = indexedCanonicalData(32, selectedIndex, 0x4b);
  for (let index = 1; index < count; index += 1) {
    const key = indexedCanonicalData(32, index, 0x4b);
    if (key < selectedKey) {
      selectedIndex = index;
      selectedKey = key;
    }
  }
  return selectedIndex;
}

function maximumContentIndexes(selectedIndex: number): ReadonlySet<number> {
  const indexes = new Set<number>([selectedIndex]);
  for (
    let index = 0;
    indexes.size < MAXIMUM_CONTENT_ROW_COUNT;
    index += 1
  ) {
    indexes.add(index);
  }
  return indexes;
}

function requiredAt<A>(values: readonly A[], index: number): A {
  const value = values[index];
  if (value === undefined) throw new Error(`Missing fixture value ${index}.`);
  return value;
}

function resultSuccess<A, E>(result: Result.Result<A, E>): A {
  return Result.match(result, {
    onFailure: failure => {
      throw failure;
    },
    onSuccess: value => value,
  });
}
