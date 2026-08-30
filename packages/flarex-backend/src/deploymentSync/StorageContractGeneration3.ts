import {
  QuerySyncStoredStateCorruptError,
  QuerySyncStoredStateIncompatibleError,
} from "@flarex/query-sync/internal/state";
import { Data, Result } from "effect";

import type { DeploymentQuerySyncBinding } from "./Binding";
import {
  decodeDeploymentQuerySyncContractRowResult,
  decodeDeploymentQuerySyncScopeRowResult,
  type DeploymentQuerySyncContractState,
} from "./RowCodec";
import type {
  DeploymentQuerySyncSqlStorage,
  DeploymentQuerySyncStateOperation,
  DeploymentQuerySyncStorageCatalogDefinition,
  DeploymentQuerySyncStorageContractError,
} from "./StorageContract";
import type { DeploymentQuerySyncGeneration1ScopeState } from "./StorageContractGeneration1";
import {
  generation2ContractColumns,
  generation2DependencyColumns,
  generation2QueryColumns,
  generation2ScopeColumns,
} from "./StorageContractGeneration2";

const STORAGE_READINESS_OPERATION = "initializeOrInspectNamespace" as const;
const CONTRACT_TABLE = "deployment_sync_contract_state";
const SCOPE_TABLE = "deployment_sync_scope_state";
const QUERY_TABLE = "deployment_sync_queries";
const DEPENDENCY_TABLE = "deployment_sync_query_dependencies";
const PENDING_TABLE = "deployment_sync_pending_publications";
const DEPENDENCY_REVERSE_INDEX =
  "deployment_sync_query_dependencies_reverse";
const GENERATION_1_SCOPE_TABLE =
  "deployment_sync_scope_state_generation_1";
const GENERATION_2_CONTRACT_TABLE =
  "deployment_sync_contract_state_generation_2";
const GENERATION_2_QUERY_TABLE =
  "deployment_sync_queries_generation_2";
const GENERATION_2_DEPENDENCY_TABLE =
  "deployment_sync_query_dependencies_generation_2";

export const GENERATION_3_CONTRACT_TABLE_DDL =
  `CREATE TABLE deployment_sync_contract_state (
  singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
  local_contract_generation INTEGER NOT NULL
    CHECK (local_contract_generation = 3),
  durable_initialized_history INTEGER NOT NULL
    CHECK (durable_initialized_history IN (0, 1))
) STRICT, WITHOUT ROWID`;

export const GENERATION_3_SCOPE_TABLE_DDL =
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

export const GENERATION_3_QUERY_TABLE_DDL =
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
  completion_generation TEXT,
  completion_expected_active_generation TEXT,
  completion_registration_sequence TEXT,
  completion_requested_dirty_through_sequence TEXT,
  completion_evaluation_snapshot_sequence TEXT,
  completion_evaluation_authority_witness TEXT
    CHECK (
      completion_evaluation_authority_witness IS NULL
      OR length(completion_evaluation_authority_witness) = 43
    ),
  completion_refreshed_through_sequence TEXT,
  completion_relevant_through_sequence TEXT
    CHECK (completion_relevant_through_sequence IS NULL),
  completion_refresh_authority_witness TEXT
    CHECK (
      completion_refresh_authority_witness IS NULL
      OR length(completion_refresh_authority_witness) = 43
    ),
  completion_result_digest TEXT
    CHECK (
      completion_result_digest IS NULL
      OR length(completion_result_digest) = 43
    ),
  completion_publication_disposition TEXT
    CHECK (
      completion_publication_disposition IS NULL
      OR completion_publication_disposition IN ('unchanged', 'pending')
    ),
  preceding_completion_generation TEXT,
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
  ),
  CHECK (
    (
      completion_generation IS NULL
      AND completion_expected_active_generation IS NULL
      AND completion_registration_sequence IS NULL
      AND completion_requested_dirty_through_sequence IS NULL
      AND completion_evaluation_snapshot_sequence IS NULL
      AND completion_evaluation_authority_witness IS NULL
      AND completion_refreshed_through_sequence IS NULL
      AND completion_relevant_through_sequence IS NULL
      AND completion_refresh_authority_witness IS NULL
      AND completion_result_digest IS NULL
      AND completion_publication_disposition IS NULL
      AND preceding_completion_generation IS NULL
    )
    OR
    (
      completion_generation IS NOT NULL
      AND completion_registration_sequence IS NOT NULL
      AND completion_evaluation_snapshot_sequence IS NOT NULL
      AND completion_evaluation_authority_witness IS NOT NULL
      AND completion_refreshed_through_sequence IS NOT NULL
      AND completion_relevant_through_sequence IS NULL
      AND completion_refresh_authority_witness IS NOT NULL
      AND completion_result_digest IS NOT NULL
      AND completion_publication_disposition IS NOT NULL
    )
  ),
  CHECK (completion_generation IS active_generation),
  CHECK (
    completion_evaluation_snapshot_sequence
      IS active_evaluation_snapshot_sequence
  ),
  CHECK (
    completion_refreshed_through_sequence IS active_fresh_through_sequence
  ),
  CHECK (
    completion_evaluation_authority_witness IS active_authority_witness
  ),
  CHECK (completion_refresh_authority_witness IS active_authority_witness),
  CHECK (completion_result_digest IS active_result_digest)
) STRICT, WITHOUT ROWID`;

export const GENERATION_3_DEPENDENCY_TABLE_DDL =
  `CREATE TABLE deployment_sync_query_dependencies (
  role TEXT NOT NULL CHECK (role IN ('active', 'completion')),
  query_key TEXT NOT NULL COLLATE BINARY
    CHECK (length(query_key) = 43),
  generation TEXT NOT NULL,
  dependency_key TEXT NOT NULL COLLATE BINARY,
  PRIMARY KEY (query_key, role, generation, dependency_key)
) STRICT, WITHOUT ROWID`;

export const GENERATION_3_PENDING_TABLE_DDL =
  `CREATE TABLE deployment_sync_pending_publications (
  query_key TEXT NOT NULL COLLATE BINARY PRIMARY KEY
    CHECK (length(query_key) = 43),
  generation TEXT NOT NULL,
  query_identity TEXT NOT NULL,
  completed_through_sequence TEXT NOT NULL,
  result_digest TEXT NOT NULL
    CHECK (length(result_digest) = 43),
  content TEXT NOT NULL
) STRICT, WITHOUT ROWID`;

export const GENERATION_3_DEPENDENCY_REVERSE_INDEX_DDL =
  `CREATE INDEX deployment_sync_query_dependencies_reverse
ON deployment_sync_query_dependencies (
  role,
  dependency_key,
  query_key,
  generation
)`;

const completionColumns = Object.freeze([
  "completion_generation",
  "completion_expected_active_generation",
  "completion_registration_sequence",
  "completion_requested_dirty_through_sequence",
  "completion_evaluation_snapshot_sequence",
  "completion_evaluation_authority_witness",
  "completion_refreshed_through_sequence",
  "completion_relevant_through_sequence",
  "completion_refresh_authority_witness",
  "completion_result_digest",
  "completion_publication_disposition",
  "preceding_completion_generation",
].map(name => Object.freeze({
  name,
  type: "TEXT" as const,
  notnull: 0 as const,
  pk: 0 as const,
})));

const generation3QueryColumns = Object.freeze([
  ...generation2QueryColumns,
  ...completionColumns,
]);

const generation3PendingColumns = Object.freeze([
  Object.freeze({ name: "query_key", type: "TEXT", notnull: 1, pk: 1 }),
  Object.freeze({ name: "generation", type: "TEXT", notnull: 1, pk: 0 }),
  Object.freeze({ name: "query_identity", type: "TEXT", notnull: 1, pk: 0 }),
  Object.freeze({
    name: "completed_through_sequence", type: "TEXT", notnull: 1, pk: 0,
  }),
  Object.freeze({ name: "result_digest", type: "TEXT", notnull: 1, pk: 0 }),
  Object.freeze({ name: "content", type: "TEXT", notnull: 1, pk: 0 }),
] as const);

export const deploymentQuerySyncGeneration3Catalog = Object.freeze({
  generation: 3,
  tables: Object.freeze([
    Object.freeze({
      name: CONTRACT_TABLE,
      ddl: GENERATION_3_CONTRACT_TABLE_DDL,
      withoutRowId: 1,
      strict: 1,
      columns: generation2ContractColumns,
    }),
    Object.freeze({
      name: SCOPE_TABLE,
      ddl: GENERATION_3_SCOPE_TABLE_DDL,
      withoutRowId: 1,
      strict: 1,
      columns: generation2ScopeColumns,
    }),
    Object.freeze({
      name: QUERY_TABLE,
      ddl: GENERATION_3_QUERY_TABLE_DDL,
      withoutRowId: 1,
      strict: 1,
      columns: generation3QueryColumns,
    }),
    Object.freeze({
      name: DEPENDENCY_TABLE,
      ddl: GENERATION_3_DEPENDENCY_TABLE_DDL,
      withoutRowId: 1,
      strict: 1,
      columns: generation2DependencyColumns,
    }),
    Object.freeze({
      name: PENDING_TABLE,
      ddl: GENERATION_3_PENDING_TABLE_DDL,
      withoutRowId: 1,
      strict: 1,
      columns: generation3PendingColumns,
    }),
  ]),
  indexes: Object.freeze([
    Object.freeze({
      name: DEPENDENCY_REVERSE_INDEX,
      tableName: DEPENDENCY_TABLE,
      ddl: GENERATION_3_DEPENDENCY_REVERSE_INDEX_DDL,
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
    | "generation3ScopeInvalid"
    | "generation3BindingMismatch"
    | "generation3LifecycleStatePresent";
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

function corrupt<Operation extends DeploymentQuerySyncStateOperation>(
  operation: Operation,
  reason: QuerySyncStoredStateCorruptError<Operation>["reason"],
  cause: unknown,
): QuerySyncStoredStateCorruptError<Operation> {
  return new QuerySyncStoredStateCorruptError({
    operation,
    commitCertainty: "notCommitted",
    reason,
    cause,
  });
}

function incompatible<Operation extends DeploymentQuerySyncStateOperation>(
  operation: Operation,
  reason: "unsupportedStoredContract" | "bootstrapBindingMismatch",
  cause: unknown,
): QuerySyncStoredStateIncompatibleError<Operation> {
  return new QuerySyncStoredStateIncompatibleError({
    operation,
    commitCertainty: "notCommitted",
    reason,
    cause,
  });
}

export function readDeploymentQuerySyncGeneration3Contract<
  Operation extends DeploymentQuerySyncStateOperation,
>(
  sql: DeploymentQuerySyncSqlStorage,
  operation: Operation,
): Result.Result<
  DeploymentQuerySyncContractState,
  DeploymentQuerySyncStorageContractError<Operation>
> {
  const rows = sql.exec<EncodedContractRow>(`SELECT
    singleton,
    local_contract_generation,
    durable_initialized_history
  FROM main.deployment_sync_contract_state
  ORDER BY singleton
  LIMIT 2`).toArray();
  if (rows.length === 0) {
    return Result.fail(corrupt(
      operation,
      "storedAggregateInvalid",
      issue("contractRowMissing"),
    ));
  }
  if (rows.length !== 1) {
    return Result.fail(corrupt(
      operation,
      "storedAggregateInvalid",
      issue("contractRowDuplicate", { observed: rows.length }),
    ));
  }
  return decodeDeploymentQuerySyncContractRowResult(rows[0]).pipe(
    Result.mapError(cause => cause.reason === "unsupportedContractGeneration"
      ? incompatible(
        operation,
        "unsupportedStoredContract",
        issue("contractGenerationUnsupported", { cause }),
      )
      : corrupt(
        operation,
        "storedAggregateInvalid",
        issue("contractRowInvalid", { cause }),
      )),
  );
}

export function readReadyDeploymentQuerySyncGeneration3(
  sql: DeploymentQuerySyncSqlStorage,
  binding: DeploymentQuerySyncBinding,
): Result.Result<
  DeploymentQuerySyncContractState,
  DeploymentQuerySyncStorageContractError<
    typeof STORAGE_READINESS_OPERATION
  >
> {
  return Result.gen(function* () {
    const contract = yield* readDeploymentQuerySyncGeneration3Contract(
      sql,
      STORAGE_READINESS_OPERATION,
    );
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
        STORAGE_READINESS_OPERATION,
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
          STORAGE_READINESS_OPERATION,
          "storedAggregateInvalid",
          issue("generation3ScopeInvalid", { cause }),
        )),
      );
    if (contract.durableInitializedHistory !== (scope !== null)) {
      return yield* Result.fail(corrupt(
        STORAGE_READINESS_OPERATION,
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
      const dependentRowsPresent = [
        QUERY_TABLE,
        DEPENDENCY_TABLE,
        PENDING_TABLE,
      ].some(table => sql.exec<{ readonly present: number }>(
        `SELECT 1 AS present FROM main.${table} LIMIT 1`,
      ).toArray().length !== 0);
      if (dependentRowsPresent) {
        return yield* Result.fail(corrupt(
          STORAGE_READINESS_OPERATION,
          "storedAggregateInvalid",
          issue("historyDependentRowsPresent"),
        ));
      }
      return contract;
    }
    if (scope.scopeUuid !== binding.scopeUuid) {
      return yield* Result.fail(corrupt(
        STORAGE_READINESS_OPERATION,
        "namespaceBindingMismatch",
        issue("generation3BindingMismatch", {
          expected: binding.scopeUuid,
          observed: scope.scopeUuid,
        }),
      ));
    }
    if (
      scope.storageGeneration !== binding.storageGeneration
      || scope.storageGenerationFence !== binding.storageGenerationFence
    ) {
      return yield* Result.fail(incompatible(
        STORAGE_READINESS_OPERATION,
        "bootstrapBindingMismatch",
        issue("generation3BindingMismatch", {
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
    if (
      scope.facts.metrics.inFlightPublicationCount !== 0
      || scope.facts.metrics.settlementEnvelopeBytes !== 0
    ) {
      return yield* Result.fail(corrupt(
        STORAGE_READINESS_OPERATION,
        "storedAggregateInvalid",
        issue("generation3LifecycleStatePresent", {
          expected: Object.freeze({
            inFlightPublicationCount: 0,
            settlementEnvelopeBytes: 0,
          }),
          observed: Object.freeze({
            inFlightPublicationCount:
              scope.facts.metrics.inFlightPublicationCount,
            settlementEnvelopeBytes:
              scope.facts.metrics.settlementEnvelopeBytes,
          }),
        }),
      ));
    }
    return contract;
  });
}

function createGeneration3Tables(sql: DeploymentQuerySyncSqlStorage): void {
  sql.exec(GENERATION_3_CONTRACT_TABLE_DDL);
  sql.exec(GENERATION_3_SCOPE_TABLE_DDL);
  sql.exec(GENERATION_3_QUERY_TABLE_DDL);
  sql.exec(GENERATION_3_DEPENDENCY_TABLE_DDL);
  sql.exec(GENERATION_3_PENDING_TABLE_DDL);
}

function insertGeneration3Contract(
  sql: DeploymentQuerySyncSqlStorage,
  durableInitializedHistory: boolean,
): void {
  sql.exec(`INSERT INTO main.deployment_sync_contract_state (
    singleton,
    local_contract_generation,
    durable_initialized_history
  ) VALUES (1, 3, ?)`, durableInitializedHistory ? 1 : 0);
}

export function createFreshDeploymentQuerySyncGeneration3(
  sql: DeploymentQuerySyncSqlStorage,
): void {
  createGeneration3Tables(sql);
  insertGeneration3Contract(sql, false);
  sql.exec(GENERATION_3_DEPENDENCY_REVERSE_INDEX_DDL);
}

export function migrateDeploymentQuerySyncGeneration1ToGeneration3(
  sql: DeploymentQuerySyncSqlStorage,
  legacy: DeploymentQuerySyncGeneration1ScopeState | null,
  binding: DeploymentQuerySyncBinding,
  emptyScope: ReturnType<
    typeof import("@flarex/query-sync/internal/transition-plan").makeEmptyQuerySyncScopeFacts
  > | null,
): void {
  sql.exec(`ALTER TABLE main.${SCOPE_TABLE}
    RENAME TO ${GENERATION_1_SCOPE_TABLE}`);
  createGeneration3Tables(sql);
  insertGeneration3Contract(sql, legacy !== null);
  if (legacy !== null && emptyScope !== null) {
    sql.exec(`INSERT INTO main.${SCOPE_TABLE} (
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
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    legacy.scopeUuid,
    legacy.epochUuid,
    legacy.storageGeneration,
    legacy.storageGenerationFence.toString(),
    binding.syncModelId,
    emptyScope.cursor.appliedThroughSequence.toString(),
    emptyScope.evaluationWork.revision.toString(),
    emptyScope.evaluationWork.fairnessAnchor,
    emptyScope.metrics.queryCount,
    emptyScope.metrics.retainedIdentityBytes,
    emptyScope.metrics.dependencyMemberships,
    emptyScope.metrics.pendingPublicationCount,
    emptyScope.metrics.inFlightPublicationCount,
    emptyScope.metrics.retainedPublicationContentBytes,
    emptyScope.metrics.settlementEnvelopeBytes,
    emptyScope.metrics.countedCanonicalBytes);
  }
  sql.exec(`DROP TABLE main.${GENERATION_1_SCOPE_TABLE}`);
  sql.exec(GENERATION_3_DEPENDENCY_REVERSE_INDEX_DDL);
}

export function migrateDeploymentQuerySyncGeneration2ToGeneration3(
  sql: DeploymentQuerySyncSqlStorage,
): void {
  sql.exec(`DROP INDEX main.${DEPENDENCY_REVERSE_INDEX}`);
  sql.exec(`ALTER TABLE main.${CONTRACT_TABLE}
    RENAME TO ${GENERATION_2_CONTRACT_TABLE}`);
  sql.exec(`ALTER TABLE main.${QUERY_TABLE}
    RENAME TO ${GENERATION_2_QUERY_TABLE}`);
  sql.exec(`ALTER TABLE main.${DEPENDENCY_TABLE}
    RENAME TO ${GENERATION_2_DEPENDENCY_TABLE}`);
  sql.exec(GENERATION_3_CONTRACT_TABLE_DDL);
  sql.exec(GENERATION_3_QUERY_TABLE_DDL);
  sql.exec(GENERATION_3_DEPENDENCY_TABLE_DDL);
  sql.exec(GENERATION_3_PENDING_TABLE_DDL);
  sql.exec(`INSERT INTO main.${CONTRACT_TABLE} (
    singleton,
    local_contract_generation,
    durable_initialized_history
  ) SELECT singleton, 3, durable_initialized_history
  FROM main.${GENERATION_2_CONTRACT_TABLE}`);
  sql.exec(`INSERT INTO main.${QUERY_TABLE} (
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
    provisional_disposition,
    completion_generation,
    completion_expected_active_generation,
    completion_registration_sequence,
    completion_requested_dirty_through_sequence,
    completion_evaluation_snapshot_sequence,
    completion_evaluation_authority_witness,
    completion_refreshed_through_sequence,
    completion_relevant_through_sequence,
    completion_refresh_authority_witness,
    completion_result_digest,
    completion_publication_disposition,
    preceding_completion_generation
  ) SELECT
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
    provisional_disposition,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
  FROM main.${GENERATION_2_QUERY_TABLE}`);
  sql.exec(`INSERT INTO main.${DEPENDENCY_TABLE} (
    role,
    query_key,
    generation,
    dependency_key
  ) SELECT role, query_key, generation, dependency_key
  FROM main.${GENERATION_2_DEPENDENCY_TABLE}`);
  sql.exec(`DROP TABLE main.${GENERATION_2_CONTRACT_TABLE}`);
  sql.exec(`DROP TABLE main.${GENERATION_2_QUERY_TABLE}`);
  sql.exec(`DROP TABLE main.${GENERATION_2_DEPENDENCY_TABLE}`);
  sql.exec(GENERATION_3_DEPENDENCY_REVERSE_INDEX_DDL);
}
