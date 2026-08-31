import {
  MAX_CANONICAL_QUERY_IDENTITY_BYTES,
  MAX_INLINE_PUBLICATION_CONTENT_BYTES,
  MAX_REFERENCE_QUERIES,
  MAX_RETAINED_QUERY_IDENTITY_BYTES,
  captureCanonicalDependencyKey,
  captureQueryDescriptor,
  captureQueryEvaluationEvidence,
  captureQueryOperationTarget,
  captureQueryPublicationArtifact,
} from "@flarex/query-sync/internal/kernel";
import type {
  CanonicalDependencyKey,
  GenerationRefreshEvidence,
  NamespaceCursor,
  QueryDescriptor,
  QueryEvaluationAttempt,
  QueryEvaluationEvidence,
  QueryPublicationArtifact,
} from "@flarex/query-sync/internal/kernel";
import {
  makeEmptyQuerySyncScopeFacts,
  planBeginQueryEvaluation,
} from "@flarex/query-sync/internal/transition-plan";
import {
  deriveGenerationRefreshEvidence,
} from "@flarex/query-sync/testing/reference-model";
import { Encoding, Result } from "effect";

import type { DeploymentQuerySyncBinding } from "../src/deploymentSync/Binding";
import {
  encodeDeploymentQuerySyncQueryRow,
  encodeDeploymentQuerySyncScopeRow,
  type EncodedDeploymentQuerySyncQueryRow,
  type EncodedDeploymentQuerySyncScopeRow,
} from "../src/deploymentSync/RowCodec";
import type {
  DeploymentQuerySyncSqlStorage,
  DeploymentQuerySyncStorage,
} from "../src/deploymentSync/StorageContract";
import {
  GENERATION_2_CONTRACT_TABLE_DDL,
  GENERATION_2_DEPENDENCY_REVERSE_INDEX_DDL,
  GENERATION_2_DEPENDENCY_TABLE_DDL,
  GENERATION_2_QUERY_TABLE_DDL,
  GENERATION_2_SCOPE_TABLE_DDL,
} from "../src/deploymentSync/StorageContractGeneration2";

export function makeMaximumCompletionMaterial(
  cursor: NamespaceCursor,
  descriptor: QueryDescriptor,
  attempt: QueryEvaluationAttempt,
): Readonly<{
  readonly dependencyKeys: readonly CanonicalDependencyKey[];
  readonly evaluation: QueryEvaluationEvidence;
  readonly refresh: GenerationRefreshEvidence;
  readonly publication: QueryPublicationArtifact;
}> {
  const dependencyKeys = maximumDependencyKeys();
  const authorityWitness = encodedDigest(0x79);
  const evaluation = Result.getOrThrow(captureQueryEvaluationEvidence({
    namespaceId: cursor.namespaceId,
    syncModelId: cursor.syncModelId,
    sourceEpoch: cursor.sourceEpoch,
    descriptor,
    generation: attempt.generation,
    snapshotSequence: cursor.appliedThroughSequence,
    resultDigest: encodedDigest(0x89),
    authorityWitness,
    dependencyKeys,
  }));
  const refresh = Result.getOrThrow(deriveGenerationRefreshEvidence(
    evaluation,
    cursor,
    [],
    evaluation.authorityWitness,
  ));
  const publication = Result.getOrThrow(captureQueryPublicationArtifact({
    content: canonicalData(MAX_INLINE_PUBLICATION_CONTENT_BYTES, 0x70),
  }));
  return Object.freeze({ dependencyKeys, evaluation, refresh, publication });
}

export function maximumQueryDescriptor(seed: number): QueryDescriptor {
  return Result.getOrThrow(captureQueryDescriptor({
    queryKey: indexedCanonicalData(32, seed, 0x51),
    queryIdentity: canonicalData(MAX_CANONICAL_QUERY_IDENTITY_BYTES, 0x69),
  }));
}

export function encodedDigest(byte: number): string {
  return Encoding.encodeBase64Url(
    Uint8Array.from({ length: 32 }, () => byte),
  );
}

export function seedGeneration2Maximum(
  storage: DeploymentQuerySyncStorage,
  binding: DeploymentQuerySyncBinding,
) {
  const identityBytes = MAX_RETAINED_QUERY_IDENTITY_BYTES
    / MAX_REFERENCE_QUERIES;
  if (
    !Number.isSafeInteger(identityBytes)
    || identityBytes > MAX_CANONICAL_QUERY_IDENTITY_BYTES
  ) {
    throw new Error("Invalid maximum-population identity fixture size.");
  }
  const queryIdentity = canonicalData(identityBytes, 0x69);
  let scope = makeEmptyQuerySyncScopeFacts(binding.bootstrapCursor);
  storage.transactionSync(() => {
    createGeneration2Catalog(storage.sql);
    storage.sql.exec(
      "INSERT INTO deployment_sync_contract_state VALUES (1, 2, 1)",
    );
    for (let index = 0; index < MAX_REFERENCE_QUERIES; index += 1) {
      const descriptor = Result.getOrThrow(captureQueryDescriptor({
        queryKey: indexedCanonicalData(32, index, 0x4b),
        queryIdentity,
      }));
      const target = Result.getOrThrow(captureQueryOperationTarget({
        namespaceId: binding.namespaceId,
        syncModelId: binding.syncModelId,
        sourceEpoch: binding.sourceEpoch,
        descriptor,
      }));
      const plan = Result.getOrThrow(planBeginQueryEvaluation({
        scope,
        query: null,
        request: Object.freeze({
          target,
          expectedActiveGeneration: null,
          requestedDirtyThroughSequence: null,
        }),
      }));
      if (plan._tag !== "write" || plan.receipt._tag !== "created") {
        throw new Error(
          `Expected a created maximum fixture row at index ${index}.`,
        );
      }
      insertGeneration2QueryRow(
        storage.sql,
        encodeDeploymentQuerySyncQueryRow({
          descriptor: plan.change.descriptor,
          active: null,
          provisional: plan.change.provisional,
        }),
      );
      scope = plan.nextScope;
    }
    insertGeneration2ScopeRow(storage.sql, encodeDeploymentQuerySyncScopeRow({
      scopeUuid: binding.scopeUuid,
      epochUuid: binding.epochUuid,
      storageGeneration: binding.storageGeneration,
      storageGenerationFence: binding.storageGenerationFence,
      syncModelId: binding.syncModelId,
      facts: scope,
    }));
  });
  if (
    scope.metrics.queryCount !== MAX_REFERENCE_QUERIES
    || scope.metrics.retainedIdentityBytes
      !== MAX_RETAINED_QUERY_IDENTITY_BYTES
  ) {
    throw new Error("Maximum generation-2 fixture counters diverged.");
  }
  return Object.freeze({
    queryCount: scope.metrics.queryCount,
    retainedIdentityBytes: scope.metrics.retainedIdentityBytes,
    queryIdentityCharacters: queryIdentity.length,
    scopeMetrics: scope.metrics,
  });
}

export function createGeneration2Catalog(
  sql: DeploymentQuerySyncSqlStorage,
): void {
  sql.exec(GENERATION_2_CONTRACT_TABLE_DDL);
  sql.exec(GENERATION_2_SCOPE_TABLE_DDL);
  sql.exec(GENERATION_2_QUERY_TABLE_DDL);
  sql.exec(GENERATION_2_DEPENDENCY_TABLE_DDL);
  sql.exec(GENERATION_2_DEPENDENCY_REVERSE_INDEX_DDL);
}

function insertGeneration2QueryRow(
  sql: DeploymentQuerySyncSqlStorage,
  row: EncodedDeploymentQuerySyncQueryRow,
): void {
  sql.exec(`INSERT INTO deployment_sync_queries (
    query_key,
    query_identity,
    active_generation,
    active_evaluation_snapshot_sequence,
    active_fresh_through_sequence,
    active_dirty_through_sequence,
    active_result_digest,
    active_authority_witness,
    provisional_generation,
    provisional_expected_active_generation,
    provisional_registration_sequence,
    provisional_requested_dirty_through_sequence,
    provisional_disposition
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ...generation2QueryValues(row));
}

function generation2QueryValues(
  row: EncodedDeploymentQuerySyncQueryRow,
): SqlStorageValue[] {
  return [
    row.query_key,
    row.query_identity,
    row.active_generation,
    row.active_evaluation_snapshot_sequence,
    row.active_fresh_through_sequence,
    row.active_dirty_through_sequence,
    row.active_result_digest,
    row.active_authority_witness,
    row.provisional_generation,
    row.provisional_expected_active_generation,
    row.provisional_registration_sequence,
    row.provisional_requested_dirty_through_sequence,
    row.provisional_disposition,
  ];
}

function insertGeneration2ScopeRow(
  sql: DeploymentQuerySyncSqlStorage,
  row: EncodedDeploymentQuerySyncScopeRow,
): void {
  sql.exec(`INSERT INTO deployment_sync_scope_state (
    singleton,
    scope_uuid,
    epoch_uuid,
    storage_generation,
    storage_generation_fence,
    sync_model_id,
    applied_through_sequence,
    evaluation_work_revision,
    fairness_anchor,
    query_count,
    retained_identity_bytes,
    dependency_memberships,
    pending_publication_count,
    in_flight_publication_count,
    retained_publication_content_bytes,
    settlement_envelope_bytes,
    counted_canonical_bytes
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ...generation2ScopeValues(row));
}

function generation2ScopeValues(
  row: EncodedDeploymentQuerySyncScopeRow,
): SqlStorageValue[] {
  return [
    row.singleton,
    row.scope_uuid,
    row.epoch_uuid,
    row.storage_generation,
    row.storage_generation_fence,
    row.sync_model_id,
    row.applied_through_sequence,
    row.evaluation_work_revision,
    row.fairness_anchor,
    row.query_count,
    row.retained_identity_bytes,
    row.dependency_memberships,
    row.pending_publication_count,
    row.in_flight_publication_count,
    row.retained_publication_content_bytes,
    row.settlement_envelope_bytes,
    row.counted_canonical_bytes,
  ];
}

interface MaximumPopulationAggregateRow {
  readonly [key: string]: SqlStorageValue;
  readonly query_count: number;
  readonly ready_query_count: number;
  readonly minimum_identity_characters: number;
  readonly maximum_identity_characters: number;
}

interface MaximumPopulationEdgeRow {
  readonly [key: string]: SqlStorageValue;
  readonly query_key: string;
  readonly query_identity: string;
  readonly provisional_generation: string;
  readonly provisional_disposition: string;
}

interface MaximumScopeRow {
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

export function maximumPopulationSummary(
  sql: DeploymentQuerySyncSqlStorage,
) {
  const aggregate = sql.exec<MaximumPopulationAggregateRow>(`SELECT
    count(*) AS query_count,
    sum(CASE WHEN provisional_disposition = 'ready' THEN 1 ELSE 0 END)
      AS ready_query_count,
    min(length(query_identity)) AS minimum_identity_characters,
    max(length(query_identity)) AS maximum_identity_characters
    FROM main.deployment_sync_queries`).one();
  const scope = sql.exec<MaximumScopeRow>(`SELECT
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
  const firstKey = indexedCanonicalData(32, 0, 0x4b);
  const lastKey = indexedCanonicalData(
    32,
    MAX_REFERENCE_QUERIES - 1,
    0x4b,
  );
  const expectedIdentity = canonicalData(
    MAX_RETAINED_QUERY_IDENTITY_BYTES / MAX_REFERENCE_QUERIES,
    0x69,
  );
  const edges = sql.exec<MaximumPopulationEdgeRow>(`SELECT
    query_key,
    query_identity,
    provisional_generation,
    provisional_disposition
    FROM main.deployment_sync_queries
    WHERE query_key IN (?, ?)
    ORDER BY query_key COLLATE BINARY`, firstKey, lastKey).toArray();
  const contract = sql.exec<{
    readonly [key: string]: SqlStorageValue;
    readonly local_contract_generation: number;
  }>(`SELECT local_contract_generation
    FROM main.deployment_sync_contract_state
    WHERE singleton = 1`).one();
  return Object.freeze({
    localContractGeneration: contract.local_contract_generation,
    queryCount: aggregate.query_count,
    readyQueryCount: aggregate.ready_query_count,
    minimumIdentityCharacters: aggregate.minimum_identity_characters,
    maximumIdentityCharacters: aggregate.maximum_identity_characters,
    scopeMetrics: scopeMetrics(scope),
    firstEdgeExact: edges[0]?.query_key === firstKey
      && edges[0].query_identity === expectedIdentity
      && edges[0].provisional_generation === "1"
      && edges[0].provisional_disposition === "ready",
    lastEdgeExact: edges[1]?.query_key === lastKey
      && edges[1].query_identity === expectedIdentity
      && edges[1].provisional_generation === "1"
      && edges[1].provisional_disposition === "ready",
  });
}

interface MaximumQueryRow {
  readonly [key: string]: SqlStorageValue;
  readonly query_identity: string;
  readonly active_generation: string;
  readonly active_dirty_through_sequence: string;
  readonly completion_generation: string;
  readonly completion_publication_disposition: string;
}

interface MaximumPendingRow {
  readonly [key: string]: SqlStorageValue;
  readonly generation: string;
  readonly query_identity: string;
  readonly content: string;
}

interface MaximumDependencyCountRow {
  readonly [key: string]: SqlStorageValue;
  readonly role: string;
  readonly member_count: number;
}

export function maximumRowSummary(
  sql: DeploymentQuerySyncSqlStorage,
  descriptor: QueryDescriptor,
) {
  const query = sql.exec<MaximumQueryRow>(`SELECT
    query_identity,
    active_generation,
    active_dirty_through_sequence,
    completion_generation,
    completion_publication_disposition
    FROM main.deployment_sync_queries
    WHERE query_key = ?`, descriptor.queryKey).one();
  const pending = sql.exec<MaximumPendingRow>(`SELECT
    generation,
    query_identity,
    content
    FROM main.deployment_sync_pending_publications
    WHERE query_key = ?`, descriptor.queryKey).one();
  const dependencies = sql.exec<MaximumDependencyCountRow>(`SELECT
    role,
    count(*) AS member_count
    FROM main.deployment_sync_query_dependencies
    WHERE query_key = ?
    GROUP BY role
    ORDER BY role`, descriptor.queryKey).toArray();
  const scope = sql.exec<MaximumScopeRow>(`SELECT
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
  const expectedContent = canonicalData(
    MAX_INLINE_PUBLICATION_CONTENT_BYTES,
    0x70,
  );
  return Object.freeze({
    queryIdentityExact: query.query_identity === descriptor.queryIdentity,
    pendingQueryIdentityExact:
      pending.query_identity === descriptor.queryIdentity,
    publicationContentExact: pending.content === expectedContent,
    queryIdentityCharacters: query.query_identity.length,
    publicationContentCharacters: pending.content.length,
    combinedPendingPayloadCharacters:
      pending.query_identity.length + pending.content.length,
    activeDependencyCount: dependencyCount(dependencies, "active"),
    completionDependencyCount: dependencyCount(dependencies, "completion"),
    scopeMetrics: scopeMetrics(scope),
    activeGeneration: query.active_generation,
    activeDirtyThroughSequence: query.active_dirty_through_sequence,
    completionGeneration: query.completion_generation,
    completionPublicationDisposition:
      query.completion_publication_disposition,
    pendingGeneration: pending.generation,
  });
}

function scopeMetrics(row: MaximumScopeRow) {
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

function dependencyCount(
  rows: readonly MaximumDependencyCountRow[],
  role: "active" | "completion",
): number {
  return rows.find(row => row.role === role)?.member_count ?? 0;
}

export function storageWithBindingTrace(
  storage: DeploymentQuerySyncStorage,
  bindingCounts: number[],
): DeploymentQuerySyncStorage {
  const exec: DeploymentQuerySyncSqlStorage["exec"] = <
    Row extends Record<string, SqlStorageValue>,
  >(
    query: string,
    ...bindings: SqlStorageValue[]
  ): SqlStorageCursor<Row> => {
    const normalized = query.replaceAll(/\s+/g, " ").trim();
    if (
      normalized.includes("FROM main.deployment_sync_query_dependencies")
      && normalized.includes("dependency_key IN (")
    ) {
      bindingCounts.push(bindings.length);
    }
    return storage.sql.exec<Row>(query, ...bindings);
  };
  return Object.freeze({
    sql: Object.freeze({ exec }),
    transactionSync: <A>(closure: () => A): A =>
      storage.transactionSync(closure),
  });
}

export function exactBindingBudget(sql: DeploymentQuerySyncSqlStorage) {
  const bindings = Array.from({ length: 100 }, (_, index) => index);
  const expression = bindings.map(() => "?").join(" + ");
  const row = sql.exec<{
    readonly [key: string]: SqlStorageValue;
    readonly total: number;
  }>(`SELECT ${expression} AS total`, ...bindings).one();
  return Object.freeze({ bindings: bindings.length, total: row.total });
}

function maximumDependencyKeys() {
  return Object.freeze(Array.from({ length: 97 }, (_, index) =>
    Result.getOrThrow(captureCanonicalDependencyKey(
      indexedCanonicalData(32, index, 0x64),
    ))
  ));
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
