import {
  MAX_AGGREGATE_DEPENDENCY_MEMBERSHIPS,
  MAX_REFERENCE_QUERIES,
  QUERY_AUTHORITY_WITNESS_BYTES,
  QUERY_KEY_BYTES,
  QUERY_RESULT_DIGEST_BYTES,
  canonicalBase64UrlDecodedLength,
} from "@flarex/query-sync/internal/kernel";
import {
  QuerySyncStoredStateCorruptError,
  QuerySyncStoredStateIncompatibleError,
} from "@flarex/query-sync/internal/state";
import { makeEmptyQuerySyncScopeFacts } from "@flarex/query-sync/internal/transition-plan";
import { Data, Result } from "effect";

import type { DeploymentQuerySyncBinding } from "./Binding";
import {
  decodeDeploymentQuerySyncGeneration2DependencyRowResult,
} from "./DependencyRowCodec";
import {
  decodeDeploymentQuerySyncGeneration2ContractRowResult,
  decodeDeploymentQuerySyncQueryRowResult,
  decodeDeploymentQuerySyncScopeRowResult,
  type DeploymentQuerySyncGeneration2ContractState,
  type DeploymentQuerySyncStoredScopeState,
} from "./RowCodec";
import type {
  DeploymentQuerySyncSqlStorage,
  DeploymentQuerySyncStorageCatalogDefinition,
} from "./StorageContract";

const STORAGE_READINESS_OPERATION = "initializeOrInspectNamespace" as const;
const CONTRACT_TABLE = "deployment_sync_contract_state";
const SCOPE_TABLE = "deployment_sync_scope_state";
const QUERY_TABLE = "deployment_sync_queries";
const DEPENDENCY_TABLE = "deployment_sync_query_dependencies";
const DEPENDENCY_REVERSE_INDEX =
  "deployment_sync_query_dependencies_reverse";

export const GENERATION_2_CONTRACT_TABLE_DDL =
  `CREATE TABLE deployment_sync_contract_state (
  singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
  local_contract_generation INTEGER NOT NULL
    CHECK (local_contract_generation = 2),
  durable_initialized_history INTEGER NOT NULL
    CHECK (durable_initialized_history IN (0, 1))
) STRICT, WITHOUT ROWID`;

export const GENERATION_2_SCOPE_TABLE_DDL =
  `CREATE TABLE deployment_sync_scope_state (
  singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
  scope_uuid TEXT NOT NULL,
  epoch_uuid TEXT NOT NULL,
  storage_generation TEXT NOT NULL
    CHECK (storage_generation = 'flarexdb_v1'),
  storage_generation_fence TEXT NOT NULL,
  sync_model_id TEXT NOT NULL,
  applied_through_sequence TEXT NOT NULL,
  evaluation_work_revision TEXT NOT NULL,
  fairness_anchor TEXT COLLATE BINARY
    CHECK (fairness_anchor IS NULL OR length(fairness_anchor) = 43),
  query_count INTEGER NOT NULL
    CHECK (query_count BETWEEN 0 AND 4096),
  retained_identity_bytes INTEGER NOT NULL
    CHECK (retained_identity_bytes BETWEEN 0 AND 33554432),
  dependency_memberships INTEGER NOT NULL
    CHECK (dependency_memberships BETWEEN 0 AND 262144),
  pending_publication_count INTEGER NOT NULL
    CHECK (pending_publication_count BETWEEN 0 AND 4096),
  in_flight_publication_count INTEGER NOT NULL
    CHECK (in_flight_publication_count BETWEEN 0 AND 1),
  retained_publication_content_bytes INTEGER NOT NULL
    CHECK (retained_publication_content_bytes BETWEEN 0 AND 33554432),
  settlement_envelope_bytes INTEGER NOT NULL
    CHECK (settlement_envelope_bytes BETWEEN 0 AND 190),
  counted_canonical_bytes INTEGER NOT NULL
    CHECK (counted_canonical_bytes BETWEEN 0 AND 67108864)
) STRICT, WITHOUT ROWID`;

export const GENERATION_2_QUERY_TABLE_DDL =
  `CREATE TABLE deployment_sync_queries (
  query_key TEXT NOT NULL COLLATE BINARY PRIMARY KEY
    CHECK (length(query_key) = 43),
  query_identity TEXT NOT NULL,
  active_generation TEXT,
  active_evaluation_snapshot_sequence TEXT,
  active_fresh_through_sequence TEXT,
  active_dirty_through_sequence TEXT,
  active_result_digest TEXT
    CHECK (active_result_digest IS NULL OR length(active_result_digest) = 43),
  active_authority_witness TEXT
    CHECK (
      active_authority_witness IS NULL
      OR length(active_authority_witness) = 43
    ),
  provisional_generation TEXT,
  provisional_expected_active_generation TEXT,
  provisional_registration_sequence TEXT,
  provisional_requested_dirty_through_sequence TEXT,
  provisional_disposition TEXT
    CHECK (
      provisional_disposition IS NULL
      OR provisional_disposition IN ('ready', 'blocked')
    ),
  CHECK (
    (
      active_generation IS NULL
      AND active_evaluation_snapshot_sequence IS NULL
      AND active_fresh_through_sequence IS NULL
      AND active_dirty_through_sequence IS NULL
      AND active_result_digest IS NULL
      AND active_authority_witness IS NULL
    )
    OR
    (
      active_generation IS NOT NULL
      AND active_evaluation_snapshot_sequence IS NOT NULL
      AND active_fresh_through_sequence IS NOT NULL
      AND active_result_digest IS NOT NULL
      AND active_authority_witness IS NOT NULL
    )
  ),
  CHECK (
    (
      provisional_generation IS NULL
      AND provisional_expected_active_generation IS NULL
      AND provisional_registration_sequence IS NULL
      AND provisional_requested_dirty_through_sequence IS NULL
      AND provisional_disposition IS NULL
    )
    OR
    (
      provisional_generation IS NOT NULL
      AND provisional_registration_sequence IS NOT NULL
      AND provisional_disposition IS NOT NULL
    )
  )
) STRICT, WITHOUT ROWID`;

export const GENERATION_2_DEPENDENCY_TABLE_DDL =
  `CREATE TABLE deployment_sync_query_dependencies (
  role TEXT NOT NULL CHECK (role = 'active'),
  query_key TEXT NOT NULL COLLATE BINARY
    CHECK (length(query_key) = 43),
  generation TEXT NOT NULL,
  dependency_key TEXT NOT NULL COLLATE BINARY,
  PRIMARY KEY (query_key, role, generation, dependency_key)
) STRICT, WITHOUT ROWID`;

export const GENERATION_2_DEPENDENCY_REVERSE_INDEX_DDL =
  `CREATE INDEX deployment_sync_query_dependencies_reverse
ON deployment_sync_query_dependencies (
  role,
  dependency_key,
  query_key,
  generation
)`;

export const generation2ContractColumns = Object.freeze([
  Object.freeze({ name: "singleton", type: "INTEGER", notnull: 1, pk: 1 }),
  Object.freeze({
    name: "local_contract_generation",
    type: "INTEGER",
    notnull: 1,
    pk: 0,
  }),
  Object.freeze({
    name: "durable_initialized_history",
    type: "INTEGER",
    notnull: 1,
    pk: 0,
  }),
] as const);

export const generation2ScopeColumns = Object.freeze([
  Object.freeze({ name: "singleton", type: "INTEGER", notnull: 1, pk: 1 }),
  Object.freeze({ name: "scope_uuid", type: "TEXT", notnull: 1, pk: 0 }),
  Object.freeze({ name: "epoch_uuid", type: "TEXT", notnull: 1, pk: 0 }),
  Object.freeze({
    name: "storage_generation", type: "TEXT", notnull: 1, pk: 0,
  }),
  Object.freeze({
    name: "storage_generation_fence", type: "TEXT", notnull: 1, pk: 0,
  }),
  Object.freeze({ name: "sync_model_id", type: "TEXT", notnull: 1, pk: 0 }),
  Object.freeze({
    name: "applied_through_sequence", type: "TEXT", notnull: 1, pk: 0,
  }),
  Object.freeze({
    name: "evaluation_work_revision", type: "TEXT", notnull: 1, pk: 0,
  }),
  Object.freeze({
    name: "fairness_anchor", type: "TEXT", notnull: 0, pk: 0,
  }),
  Object.freeze({ name: "query_count", type: "INTEGER", notnull: 1, pk: 0 }),
  Object.freeze({
    name: "retained_identity_bytes", type: "INTEGER", notnull: 1, pk: 0,
  }),
  Object.freeze({
    name: "dependency_memberships", type: "INTEGER", notnull: 1, pk: 0,
  }),
  Object.freeze({
    name: "pending_publication_count", type: "INTEGER", notnull: 1, pk: 0,
  }),
  Object.freeze({
    name: "in_flight_publication_count", type: "INTEGER", notnull: 1, pk: 0,
  }),
  Object.freeze({
    name: "retained_publication_content_bytes",
    type: "INTEGER",
    notnull: 1,
    pk: 0,
  }),
  Object.freeze({
    name: "settlement_envelope_bytes", type: "INTEGER", notnull: 1, pk: 0,
  }),
  Object.freeze({
    name: "counted_canonical_bytes", type: "INTEGER", notnull: 1, pk: 0,
  }),
] as const);

export const generation2QueryColumns = Object.freeze([
  Object.freeze({ name: "query_key", type: "TEXT", notnull: 1, pk: 1 }),
  Object.freeze({ name: "query_identity", type: "TEXT", notnull: 1, pk: 0 }),
  ...[
    "active_generation",
    "active_evaluation_snapshot_sequence",
    "active_fresh_through_sequence",
    "active_dirty_through_sequence",
    "active_result_digest",
    "active_authority_witness",
    "provisional_generation",
    "provisional_expected_active_generation",
    "provisional_registration_sequence",
    "provisional_requested_dirty_through_sequence",
    "provisional_disposition",
  ].map(name => Object.freeze({
    name,
    type: "TEXT" as const,
    notnull: 0 as const,
    pk: 0 as const,
  })),
]);

export const generation2DependencyColumns = Object.freeze([
  Object.freeze({ name: "role", type: "TEXT", notnull: 1, pk: 2 }),
  Object.freeze({ name: "query_key", type: "TEXT", notnull: 1, pk: 1 }),
  Object.freeze({ name: "generation", type: "TEXT", notnull: 1, pk: 3 }),
  Object.freeze({
    name: "dependency_key", type: "TEXT", notnull: 1, pk: 4,
  }),
] as const);

export const deploymentQuerySyncGeneration2Catalog = Object.freeze({
  generation: 2,
  tables: Object.freeze([
    Object.freeze({
      name: CONTRACT_TABLE,
      ddl: GENERATION_2_CONTRACT_TABLE_DDL,
      withoutRowId: 1,
      strict: 1,
      columns: generation2ContractColumns,
    }),
    Object.freeze({
      name: SCOPE_TABLE,
      ddl: GENERATION_2_SCOPE_TABLE_DDL,
      withoutRowId: 1,
      strict: 1,
      columns: generation2ScopeColumns,
    }),
    Object.freeze({
      name: QUERY_TABLE,
      ddl: GENERATION_2_QUERY_TABLE_DDL,
      withoutRowId: 1,
      strict: 1,
      columns: generation2QueryColumns,
    }),
    Object.freeze({
      name: DEPENDENCY_TABLE,
      ddl: GENERATION_2_DEPENDENCY_TABLE_DDL,
      withoutRowId: 1,
      strict: 1,
      columns: generation2DependencyColumns,
    }),
  ]),
  indexes: Object.freeze([
    Object.freeze({
      name: DEPENDENCY_REVERSE_INDEX,
      tableName: DEPENDENCY_TABLE,
      ddl: GENERATION_2_DEPENDENCY_REVERSE_INDEX_DDL,
      columns: Object.freeze([
        Object.freeze({ cid: 0, name: "role", key: 1 }),
        Object.freeze({ cid: 3, name: "dependency_key", key: 1 }),
        Object.freeze({ cid: 1, name: "query_key", key: 1 }),
        Object.freeze({ cid: 2, name: "generation", key: 1 }),
      ]),
    }),
  ]),
} as const satisfies DeploymentQuerySyncStorageCatalogDefinition);

type EncodedContractRow = Readonly<{
  readonly [key: string]: SqlStorageValue;
  readonly singleton: number;
  readonly local_contract_generation: number;
  readonly durable_initialized_history: number;
}>;

type EncodedScopeRow = Readonly<{
  readonly [key: string]: SqlStorageValue;
  readonly singleton: number;
  readonly scope_uuid: string;
  readonly epoch_uuid: string;
  readonly storage_generation: string;
  readonly storage_generation_fence: string;
  readonly sync_model_id: string;
  readonly applied_through_sequence: string;
  readonly evaluation_work_revision: string;
  readonly fairness_anchor: string | null;
  readonly query_count: number;
  readonly retained_identity_bytes: number;
  readonly dependency_memberships: number;
  readonly pending_publication_count: number;
  readonly in_flight_publication_count: number;
  readonly retained_publication_content_bytes: number;
  readonly settlement_envelope_bytes: number;
  readonly counted_canonical_bytes: number;
}>;

type EncodedQueryRow = Readonly<{
  readonly [key: string]: SqlStorageValue;
  readonly query_key: string;
  readonly query_identity: string;
  readonly active_generation: string | null;
  readonly active_evaluation_snapshot_sequence: string | null;
  readonly active_fresh_through_sequence: string | null;
  readonly active_dirty_through_sequence: string | null;
  readonly active_result_digest: string | null;
  readonly active_authority_witness: string | null;
  readonly provisional_generation: string | null;
  readonly provisional_expected_active_generation: string | null;
  readonly provisional_registration_sequence: string | null;
  readonly provisional_requested_dirty_through_sequence: string | null;
  readonly provisional_disposition: string | null;
}>;

type EncodedDependencyRow = Readonly<{
  readonly [key: string]: SqlStorageValue;
  readonly role: string;
  readonly query_key: string;
  readonly generation: string;
  readonly dependency_key: string;
}>;

class DeploymentQuerySyncStorageContractIssue extends Data.TaggedError(
  "DeploymentQuerySyncStorageContractIssue",
)<{
  readonly reason:
    | "contractRowMissing"
    | "contractRowDuplicate"
    | "contractGenerationUnsupported"
    | "contractRowInvalid"
    | "historyScopePresenceMismatch"
    | "historyDependentRowsPresent"
    | "generation2ScopeInvalid"
    | "generation2BindingMismatch"
    | "generation2QueryInvalid"
    | "generation2DependencyInvalid"
    | "generation2MetricsMismatch"
    | "generation2StateUnsupported";
  readonly expected: unknown;
  readonly observed: unknown;
  readonly cause: unknown | null;
}> {}

function issue(
  reason: DeploymentQuerySyncStorageContractIssue["reason"],
  input: Readonly<{
    readonly expected?: unknown;
    readonly observed?: unknown;
    readonly cause?: unknown;
  }> = {},
): DeploymentQuerySyncStorageContractIssue {
  return new DeploymentQuerySyncStorageContractIssue({
    reason,
    expected: input.expected ?? null,
    observed: input.observed ?? null,
    cause: input.cause ?? null,
  });
}

function corrupt(
  reason: QuerySyncStoredStateCorruptError<
    typeof STORAGE_READINESS_OPERATION
  >["reason"],
  cause: unknown,
): QuerySyncStoredStateCorruptError<typeof STORAGE_READINESS_OPERATION> {
  return new QuerySyncStoredStateCorruptError({
    operation: STORAGE_READINESS_OPERATION,
    commitCertainty: "notCommitted",
    reason,
    cause,
  });
}

function incompatible(
  reason: "unsupportedStoredContract" | "bootstrapBindingMismatch",
  cause: unknown,
): QuerySyncStoredStateIncompatibleError<
  typeof STORAGE_READINESS_OPERATION
> {
  return new QuerySyncStoredStateIncompatibleError({
    operation: STORAGE_READINESS_OPERATION,
    commitCertainty: "notCommitted",
    reason,
    cause,
  });
}

function singletonRow<A extends Record<string, SqlStorageValue>>(
  rows: readonly A[],
  missingReason: DeploymentQuerySyncStorageContractIssue["reason"],
  duplicateReason: DeploymentQuerySyncStorageContractIssue["reason"],
): Result.Result<A, QuerySyncStoredStateCorruptError<
  typeof STORAGE_READINESS_OPERATION
>> {
  if (rows.length === 0) {
    return Result.fail(corrupt(
      "storedAggregateInvalid",
      issue(missingReason),
    ));
  }
  return rows.length === 1 && rows[0] !== undefined
    ? Result.succeed(rows[0])
    : Result.fail(corrupt(
      "storedAggregateInvalid",
      issue(duplicateReason, { observed: rows.length }),
    ));
}

function authenticateBinding(
  scope: DeploymentQuerySyncStoredScopeState,
  binding: DeploymentQuerySyncBinding,
): Result.Result<
  void,
  | QuerySyncStoredStateCorruptError<typeof STORAGE_READINESS_OPERATION>
  | QuerySyncStoredStateIncompatibleError<typeof STORAGE_READINESS_OPERATION>
> {
  if (scope.scopeUuid !== binding.scopeUuid) {
    return Result.fail(corrupt(
      "namespaceBindingMismatch",
      issue("generation2BindingMismatch", {
        expected: binding.scopeUuid,
        observed: scope.scopeUuid,
      }),
    ));
  }
  if (
    scope.storageGeneration !== binding.storageGeneration
    || scope.storageGenerationFence !== binding.storageGenerationFence
  ) {
    return Result.fail(incompatible(
      "bootstrapBindingMismatch",
      issue("generation2BindingMismatch", {
        expected: Object.freeze({
          storageGeneration: binding.storageGeneration,
          storageGenerationFence: binding.storageGenerationFence.toString(),
        }),
        observed: Object.freeze({
          storageGeneration: scope.storageGeneration,
          storageGenerationFence: scope.storageGenerationFence.toString(),
        }),
      }),
    ));
  }
  return Result.succeed(undefined);
}

interface MutableMetrics {
  queryCount: number;
  retainedIdentityBytes: number;
  dependencyMemberships: number;
  pendingPublicationCount: number;
  inFlightPublicationCount: number;
  retainedPublicationContentBytes: number;
  settlementEnvelopeBytes: number;
  countedCanonicalBytes: number;
}

function initialMetrics(
  scope: DeploymentQuerySyncStoredScopeState,
): MutableMetrics {
  const empty = makeEmptyQuerySyncScopeFacts({
    namespaceId: scope.facts.cursor.namespaceId,
    syncModelId: scope.facts.cursor.syncModelId,
    sourceEpoch: scope.facts.cursor.sourceEpoch,
    appliedThroughSequence: scope.facts.cursor.appliedThroughSequence,
  });
  return {
    ...empty.metrics,
    countedCanonicalBytes: empty.metrics.countedCanonicalBytes
      + (scope.facts.evaluationWork.fairnessAnchor === null
        ? 0
        : QUERY_KEY_BYTES),
  };
}

function metricsEqual(
  left: Readonly<MutableMetrics>,
  right: Readonly<MutableMetrics>,
): boolean {
  return left.queryCount === right.queryCount
    && left.retainedIdentityBytes === right.retainedIdentityBytes
    && left.dependencyMemberships === right.dependencyMemberships
    && left.pendingPublicationCount === right.pendingPublicationCount
    && left.inFlightPublicationCount === right.inFlightPublicationCount
    && left.retainedPublicationContentBytes
      === right.retainedPublicationContentBytes
    && left.settlementEnvelopeBytes === right.settlementEnvelopeBytes
    && left.countedCanonicalBytes === right.countedCanonicalBytes;
}

export interface DeploymentQuerySyncGeneration2MigrationState {
  readonly contract: DeploymentQuerySyncGeneration2ContractState;
  readonly scope: DeploymentQuerySyncStoredScopeState | null;
}

export function readDeploymentQuerySyncGeneration2MigrationState(
  sql: DeploymentQuerySyncSqlStorage,
  binding: DeploymentQuerySyncBinding,
): Result.Result<
  DeploymentQuerySyncGeneration2MigrationState,
  | QuerySyncStoredStateCorruptError<typeof STORAGE_READINESS_OPERATION>
  | QuerySyncStoredStateIncompatibleError<typeof STORAGE_READINESS_OPERATION>
> {
  return Result.gen(function* () {
    const contractRow = yield* singletonRow(
      sql.exec<EncodedContractRow>(`SELECT
        singleton,
        local_contract_generation,
        durable_initialized_history
      FROM main.deployment_sync_contract_state
      ORDER BY singleton
      LIMIT 2`).toArray(),
      "contractRowMissing",
      "contractRowDuplicate",
    );
    const contract = yield* decodeDeploymentQuerySyncGeneration2ContractRowResult(
      contractRow,
    ).pipe(Result.mapError(cause => cause.reason
      === "unsupportedContractGeneration"
      ? incompatible(
        "unsupportedStoredContract",
        issue("contractGenerationUnsupported", { cause }),
      )
      : corrupt(
        "storedAggregateInvalid",
        issue("contractRowInvalid", { cause }),
      )));

    const scopeRows = sql.exec<EncodedScopeRow>(`SELECT
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
    FROM main.deployment_sync_scope_state
    ORDER BY singleton
    LIMIT 2`).toArray();
    if (scopeRows.length > 1) {
      return yield* Result.fail(corrupt(
        "storedAggregateInvalid",
        issue("historyScopePresenceMismatch", {
          expected: "zeroOrOneScopeRow",
          observed: scopeRows.length,
        }),
      ));
    }
    const scope = scopeRows[0] === undefined
      ? null
      : yield* decodeDeploymentQuerySyncScopeRowResult(scopeRows[0]).pipe(
        Result.mapError(cause => corrupt(
          "storedAggregateInvalid",
          issue("generation2ScopeInvalid", { cause }),
        )),
      );
    if (contract.durableInitializedHistory !== (scope !== null)) {
      return yield* Result.fail(corrupt(
        contract.durableInitializedHistory
          ? "aggregateMissing"
          : "storedAggregateInvalid",
        issue("historyScopePresenceMismatch", {
          expected: contract.durableInitializedHistory
            ? "scopePresent"
            : "scopeAbsent",
          observed: scope === null ? "scopeAbsent" : "scopePresent",
        }),
      ));
    }
    if (scope === null) {
      const dependentRowsPresent = [QUERY_TABLE, DEPENDENCY_TABLE].some(
        table => sql.exec<{ readonly present: number }>(`SELECT 1 AS present
          FROM main.${table}
          LIMIT 1`).toArray().length !== 0,
      );
      if (dependentRowsPresent) {
        return yield* Result.fail(corrupt(
          "storedAggregateInvalid",
          issue("historyDependentRowsPresent"),
        ));
      }
      return Object.freeze({ contract, scope: null });
    }

    yield* authenticateBinding(scope, binding);
    const metrics = initialMetrics(scope);
    const activeGenerations = new Map<string, string>();
    let unsupportedActive = false;
    const queryCursor = sql.exec<EncodedQueryRow>(`SELECT
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
    FROM main.deployment_sync_queries
    ORDER BY query_key COLLATE BINARY`);
    for (const row of queryCursor) {
      const query = yield* decodeDeploymentQuerySyncQueryRowResult(
        row,
        scope.facts,
      ).pipe(Result.mapError(cause => corrupt(
        "storedAggregateInvalid",
        issue("generation2QueryInvalid", { cause }),
      )));
      if (query.provisional === null && query.active === null) {
        return yield* Result.fail(corrupt(
          "storedAggregateInvalid",
          issue("generation2QueryInvalid", {
            expected: "generation2QueryHasActiveOrProvisionalState",
            observed: query.descriptor.queryKey,
          }),
        ));
      }
      metrics.queryCount += 1;
      if (metrics.queryCount > MAX_REFERENCE_QUERIES) {
        return yield* Result.fail(corrupt(
          "storedAggregateInvalid",
          issue("generation2MetricsMismatch", {
            expected: { maximumQueryCount: MAX_REFERENCE_QUERIES },
            observed: metrics.queryCount,
          }),
        ));
      }
      const identityBytes = canonicalBase64UrlDecodedLength(
        query.descriptor.queryIdentity,
      );
      metrics.retainedIdentityBytes += identityBytes;
      metrics.countedCanonicalBytes += QUERY_KEY_BYTES + identityBytes + 4;
      if (query.provisional !== null) {
        metrics.countedCanonicalBytes += 19
          + (query.provisional.evaluationDisposition._tag === "blocked" ? 2 : 0)
          + (query.provisional.expectedActiveGeneration === null ? 0 : 8)
          + (query.provisional.requestedDirtyThroughSequence === null ? 0 : 8);
      }
      if (query.active !== null) {
        unsupportedActive = true;
        activeGenerations.set(
          query.descriptor.queryKey,
          query.active.generation.toString(),
        );
        metrics.countedCanonicalBytes += 3 * 8
          + QUERY_RESULT_DIGEST_BYTES
          + QUERY_AUTHORITY_WITNESS_BYTES
          + 1
          + (query.active.dirtyThroughSequence === null ? 0 : 8);
      }
    }

    let dependencyRowsPresent = false;
    const dependencyCursor = sql.exec<EncodedDependencyRow>(`SELECT
      role,
      query_key,
      generation,
      dependency_key
    FROM main.deployment_sync_query_dependencies
    ORDER BY query_key COLLATE BINARY, role, generation,
      dependency_key COLLATE BINARY`);
    for (const row of dependencyCursor) {
      dependencyRowsPresent = true;
      const dependency = yield*
        decodeDeploymentQuerySyncGeneration2DependencyRowResult(row).pipe(
          Result.mapError(cause => corrupt(
            "storedAggregateInvalid",
            issue("generation2DependencyInvalid", { cause }),
          )),
        );
      const activeGeneration = activeGenerations.get(dependency.queryKey);
      if (
        activeGeneration === undefined
        || activeGeneration !== dependency.generation.toString()
      ) {
        return yield* Result.fail(corrupt(
          "storedAggregateInvalid",
          issue("generation2DependencyInvalid", {
            expected: "matchingActiveQueryGeneration",
            observed: dependency,
          }),
        ));
      }
      metrics.dependencyMemberships += 1;
      if (
        metrics.dependencyMemberships
          > MAX_AGGREGATE_DEPENDENCY_MEMBERSHIPS
      ) {
        return yield* Result.fail(corrupt(
          "storedAggregateInvalid",
          issue("generation2MetricsMismatch", {
            expected: {
              maximumDependencyMemberships:
                MAX_AGGREGATE_DEPENDENCY_MEMBERSHIPS,
            },
            observed: metrics.dependencyMemberships,
          }),
        ));
      }
      metrics.countedCanonicalBytes += canonicalBase64UrlDecodedLength(
        dependency.dependencyKey,
      );
    }

    if (
      scope.facts.metrics.pendingPublicationCount !== 0
      || scope.facts.metrics.inFlightPublicationCount !== 0
      || scope.facts.metrics.retainedPublicationContentBytes !== 0
      || scope.facts.metrics.settlementEnvelopeBytes !== 0
    ) {
      return yield* Result.fail(incompatible(
        "unsupportedStoredContract",
        issue("generation2StateUnsupported", {
          expected: "zeroPublicationAccounting",
          observed: scope.facts.metrics,
        }),
      ));
    }
    if (!metricsEqual(metrics, scope.facts.metrics)) {
      return yield* Result.fail(corrupt(
        "storedAggregateInvalid",
        issue("generation2MetricsMismatch", {
          expected: metrics,
          observed: scope.facts.metrics,
        }),
      ));
    }
    if (
      scope.facts.evaluationWork.fairnessAnchor !== null
      && !sql.exec<{ readonly present: number }>(`SELECT 1 AS present
        FROM main.deployment_sync_queries
        WHERE query_key = ?
        LIMIT 1`, scope.facts.evaluationWork.fairnessAnchor).toArray().length
    ) {
      return yield* Result.fail(corrupt(
        "storedAggregateInvalid",
        issue("generation2QueryInvalid", {
          expected: "fairnessAnchorNamesExistingQuery",
          observed: scope.facts.evaluationWork.fairnessAnchor,
        }),
      ));
    }
    if (unsupportedActive || dependencyRowsPresent) {
      return yield* Result.fail(incompatible(
        "unsupportedStoredContract",
        issue("generation2StateUnsupported", {
          expected: "provisionalOnlyGeneration2State",
          observed: Object.freeze({
            activeRowsPresent: unsupportedActive,
            dependencyRowsPresent,
          }),
        }),
      ));
    }
    return Object.freeze({ contract, scope });
  });
}
