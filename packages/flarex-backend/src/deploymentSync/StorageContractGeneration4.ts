import {
  QuerySyncStoredStateCorruptError,
  QuerySyncStoredStateIncompatibleError,
} from "@flarex/query-sync/internal/state";
import { Data, Result } from "effect";

import type { DeploymentQuerySyncBinding } from "./Binding";
import {
  readDeploymentQuerySyncPublicationLifecycle,
} from "./PublicationStorage";
import {
  decodeDeploymentQuerySyncContractRowResult,
  type DeploymentQuerySyncContractState,
} from "./RowCodec";
import {
  readDeploymentQuerySyncScope,
} from "./StateStorage";
import type {
  DeploymentQuerySyncSqlStorage,
  DeploymentQuerySyncStateOperation,
  DeploymentQuerySyncStorageCatalogDefinition,
  DeploymentQuerySyncStorageContractError,
} from "./StorageContract";
import {
  GENERATION_3_DEPENDENCY_REVERSE_INDEX_DDL,
  deploymentQuerySyncGeneration3Catalog,
} from "./StorageContractGeneration3";

const STORAGE_READINESS_OPERATION = "initializeOrInspectNamespace" as const;
const CONTRACT_TABLE = "deployment_sync_contract_state";
const SCOPE_TABLE = "deployment_sync_scope_state";
const QUERY_TABLE = "deployment_sync_queries";
const DEPENDENCY_TABLE = "deployment_sync_query_dependencies";
const PENDING_TABLE = "deployment_sync_pending_publications";
const IN_FLIGHT_TABLE = "deployment_sync_in_flight_publication";
const PUBLICATION_STATE_TABLE = "deployment_sync_publication_state";
const GENERATION_3_CONTRACT_TABLE =
  "deployment_sync_contract_state_generation_3";

export const GENERATION_4_CONTRACT_TABLE_DDL =
  `CREATE TABLE deployment_sync_contract_state (
  singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
  local_contract_generation INTEGER NOT NULL
    CHECK (local_contract_generation = 4),
  durable_initialized_history INTEGER NOT NULL
    CHECK (durable_initialized_history IN (0, 1))
) STRICT, WITHOUT ROWID`;

export const GENERATION_4_IN_FLIGHT_PUBLICATION_TABLE_DDL =
  `CREATE TABLE deployment_sync_in_flight_publication (
  singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
  query_key TEXT NOT NULL COLLATE BINARY
    CHECK (length(query_key) = 43),
  generation TEXT NOT NULL,
  query_identity TEXT NOT NULL,
  completed_through_sequence TEXT NOT NULL,
  result_digest TEXT NOT NULL
    CHECK (length(result_digest) = 43),
  content TEXT NOT NULL
) STRICT, WITHOUT ROWID`;

export const GENERATION_4_PUBLICATION_STATE_TABLE_DDL =
  `CREATE TABLE deployment_sync_publication_state (
  singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
  attempt_ordinal INTEGER
    CHECK (attempt_ordinal BETWEEN 1 AND 128),
  first_attempt_at TEXT,
  last_attempt_at TEXT,
  attempt_disposition TEXT
    CHECK (
      attempt_disposition IS NULL
      OR attempt_disposition IN ('ready', 'uncertain', 'blocked')
    ),
  attempt_block_reason TEXT
    CHECK (
      attempt_block_reason IS NULL
      OR attempt_block_reason IN (
        'terminalPublisherRefusal',
        'attemptLimitReached',
        'ageLimitReached'
      )
    ),
  latest_delivered_query_key TEXT COLLATE BINARY
    CHECK (
      latest_delivered_query_key IS NULL
      OR length(latest_delivered_query_key) = 43
    ),
  latest_delivered_generation TEXT,
  latest_delivered_result_digest TEXT
    CHECK (
      latest_delivered_result_digest IS NULL
      OR length(latest_delivered_result_digest) = 43
    ),
  preceding_query_key TEXT COLLATE BINARY
    CHECK (preceding_query_key IS NULL OR length(preceding_query_key) = 43),
  preceding_generation TEXT,
  preceding_result_digest TEXT
    CHECK (
      preceding_result_digest IS NULL
      OR length(preceding_result_digest) = 43
    ),
  preceding_attempt_ordinal INTEGER
    CHECK (preceding_attempt_ordinal BETWEEN 1 AND 128),
  preceding_outcome TEXT
    CHECK (
      preceding_outcome IS NULL
      OR preceding_outcome IN (
        'knownNotAppended',
        'outcomeUnknown',
        'terminalRefusal'
      )
    ),
  preceding_receipt_tag TEXT
    CHECK (
      preceding_receipt_tag IS NULL
      OR preceding_receipt_tag IN ('recorded', 'blocked')
    ),
  preceding_next_attempt_ordinal INTEGER
    CHECK (preceding_next_attempt_ordinal BETWEEN 1 AND 128),
  preceding_next_disposition TEXT
    CHECK (
      preceding_next_disposition IS NULL
      OR preceding_next_disposition IN ('ready', 'uncertain')
    ),
  preceding_block_reason TEXT
    CHECK (
      preceding_block_reason IS NULL
      OR preceding_block_reason IN (
        'terminalPublisherRefusal',
        'attemptLimitReached',
        'ageLimitReached'
      )
    ),
  CHECK (
    (
      attempt_ordinal IS NULL
      AND first_attempt_at IS NULL
      AND last_attempt_at IS NULL
      AND attempt_disposition IS NULL
      AND attempt_block_reason IS NULL
    )
    OR
    (
      attempt_ordinal IS NOT NULL
      AND first_attempt_at IS NOT NULL
      AND last_attempt_at IS NOT NULL
      AND attempt_disposition IS NOT NULL
      AND (
        (
          attempt_disposition IN ('ready', 'uncertain')
          AND attempt_block_reason IS NULL
        )
        OR
        (
          attempt_disposition = 'blocked'
          AND attempt_block_reason IS NOT NULL
        )
      )
    )
  ),
  CHECK (
    (
      latest_delivered_query_key IS NULL
      AND latest_delivered_generation IS NULL
      AND latest_delivered_result_digest IS NULL
    )
    OR
    (
      latest_delivered_query_key IS NOT NULL
      AND latest_delivered_generation IS NOT NULL
      AND latest_delivered_result_digest IS NOT NULL
    )
  ),
  CHECK (
    (
      preceding_query_key IS NULL
      AND preceding_generation IS NULL
      AND preceding_result_digest IS NULL
      AND preceding_attempt_ordinal IS NULL
      AND preceding_outcome IS NULL
      AND preceding_receipt_tag IS NULL
      AND preceding_next_attempt_ordinal IS NULL
      AND preceding_next_disposition IS NULL
      AND preceding_block_reason IS NULL
    )
    OR
    (
      preceding_query_key IS NOT NULL
      AND preceding_generation IS NOT NULL
      AND preceding_result_digest IS NOT NULL
      AND preceding_attempt_ordinal IS NOT NULL
      AND preceding_outcome IS NOT NULL
      AND preceding_receipt_tag IS NOT NULL
      AND (
        (
          preceding_receipt_tag = 'recorded'
          AND preceding_next_attempt_ordinal IS NOT NULL
          AND preceding_next_disposition IS NOT NULL
          AND preceding_block_reason IS NULL
        )
        OR
        (
          preceding_receipt_tag = 'blocked'
          AND preceding_next_attempt_ordinal IS NULL
          AND preceding_next_disposition IS NULL
          AND preceding_block_reason IS NOT NULL
        )
      )
    )
  )
) STRICT, WITHOUT ROWID`;

const inFlightColumns = Object.freeze([
  Object.freeze({ name: "singleton", type: "INTEGER", notnull: 1, pk: 1 }),
  Object.freeze({ name: "query_key", type: "TEXT", notnull: 1, pk: 0 }),
  Object.freeze({ name: "generation", type: "TEXT", notnull: 1, pk: 0 }),
  Object.freeze({ name: "query_identity", type: "TEXT", notnull: 1, pk: 0 }),
  Object.freeze({
    name: "completed_through_sequence", type: "TEXT", notnull: 1, pk: 0,
  }),
  Object.freeze({ name: "result_digest", type: "TEXT", notnull: 1, pk: 0 }),
  Object.freeze({ name: "content", type: "TEXT", notnull: 1, pk: 0 }),
] as const);

const publicationStateColumns = Object.freeze([
  Object.freeze({ name: "singleton", type: "INTEGER", notnull: 1, pk: 1 }),
  Object.freeze({ name: "attempt_ordinal", type: "INTEGER", notnull: 0, pk: 0 }),
  Object.freeze({ name: "first_attempt_at", type: "TEXT", notnull: 0, pk: 0 }),
  Object.freeze({ name: "last_attempt_at", type: "TEXT", notnull: 0, pk: 0 }),
  Object.freeze({ name: "attempt_disposition", type: "TEXT", notnull: 0, pk: 0 }),
  Object.freeze({ name: "attempt_block_reason", type: "TEXT", notnull: 0, pk: 0 }),
  Object.freeze({ name: "latest_delivered_query_key", type: "TEXT", notnull: 0, pk: 0 }),
  Object.freeze({ name: "latest_delivered_generation", type: "TEXT", notnull: 0, pk: 0 }),
  Object.freeze({ name: "latest_delivered_result_digest", type: "TEXT", notnull: 0, pk: 0 }),
  Object.freeze({ name: "preceding_query_key", type: "TEXT", notnull: 0, pk: 0 }),
  Object.freeze({ name: "preceding_generation", type: "TEXT", notnull: 0, pk: 0 }),
  Object.freeze({ name: "preceding_result_digest", type: "TEXT", notnull: 0, pk: 0 }),
  Object.freeze({ name: "preceding_attempt_ordinal", type: "INTEGER", notnull: 0, pk: 0 }),
  Object.freeze({ name: "preceding_outcome", type: "TEXT", notnull: 0, pk: 0 }),
  Object.freeze({ name: "preceding_receipt_tag", type: "TEXT", notnull: 0, pk: 0 }),
  Object.freeze({ name: "preceding_next_attempt_ordinal", type: "INTEGER", notnull: 0, pk: 0 }),
  Object.freeze({ name: "preceding_next_disposition", type: "TEXT", notnull: 0, pk: 0 }),
  Object.freeze({ name: "preceding_block_reason", type: "TEXT", notnull: 0, pk: 0 }),
] as const);

const generation4BaseTables = deploymentQuerySyncGeneration3Catalog.tables.map(
  table => table.name === CONTRACT_TABLE
    ? Object.freeze({ ...table, ddl: GENERATION_4_CONTRACT_TABLE_DDL })
    : table,
);

export const deploymentQuerySyncGeneration4Catalog = Object.freeze({
  generation: 4,
  tables: Object.freeze([
    ...generation4BaseTables,
    Object.freeze({
      name: IN_FLIGHT_TABLE,
      ddl: GENERATION_4_IN_FLIGHT_PUBLICATION_TABLE_DDL,
      withoutRowId: 1,
      strict: 1,
      columns: inFlightColumns,
    }),
    Object.freeze({
      name: PUBLICATION_STATE_TABLE,
      ddl: GENERATION_4_PUBLICATION_STATE_TABLE_DDL,
      withoutRowId: 1,
      strict: 1,
      columns: publicationStateColumns,
    }),
  ]),
  indexes: deploymentQuerySyncGeneration3Catalog.indexes,
} as const satisfies DeploymentQuerySyncStorageCatalogDefinition);

type EncodedContractRow = Readonly<{
  readonly [key: string]: SqlStorageValue;
  readonly singleton: number;
  readonly local_contract_generation: number;
  readonly durable_initialized_history: number;
}>;

class DeploymentQuerySyncGeneration4ContractIssue extends Data.TaggedError(
  "DeploymentQuerySyncGeneration4ContractIssue",
)<{
  readonly reason:
    | "contractRowMissing"
    | "contractRowDuplicate"
    | "contractGenerationUnsupported"
    | "contractRowInvalid"
    | "historyDependentRowsPresent"
    | "publicationStateRowMissing"
    | "publicationStateRowDuplicate"
    | "inFlightRowDuplicate"
    | "publicationLifecycleInvalid";
  readonly expected: unknown;
  readonly observed: unknown;
  readonly cause: unknown | null;
}> {}

function issue(
  reason: DeploymentQuerySyncGeneration4ContractIssue["reason"],
  input: Readonly<{
    readonly expected?: unknown;
    readonly observed?: unknown;
    readonly cause?: unknown;
  }> = {},
): DeploymentQuerySyncGeneration4ContractIssue {
  return new DeploymentQuerySyncGeneration4ContractIssue({
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
  cause: unknown,
): QuerySyncStoredStateIncompatibleError<Operation> {
  return new QuerySyncStoredStateIncompatibleError({
    operation,
    commitCertainty: "notCommitted",
    reason: "unsupportedStoredContract",
    cause,
  });
}

export function readDeploymentQuerySyncGeneration4Contract<
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
        issue("contractGenerationUnsupported", { cause }),
      )
      : corrupt(
        operation,
        "storedAggregateInvalid",
        issue("contractRowInvalid", { cause }),
      )),
  );
}

export function readReadyDeploymentQuerySyncGeneration4(
  sql: DeploymentQuerySyncSqlStorage,
  binding: DeploymentQuerySyncBinding,
): Result.Result<
  DeploymentQuerySyncContractState,
  DeploymentQuerySyncStorageContractError<
    typeof STORAGE_READINESS_OPERATION
  >
> {
  return Result.gen(function* () {
    const contract = yield* readDeploymentQuerySyncGeneration4Contract(
      sql,
      STORAGE_READINESS_OPERATION,
    );
    const scope = yield* readDeploymentQuerySyncScope(
      sql,
      binding,
      contract,
      STORAGE_READINESS_OPERATION,
      false,
    );
    if (scope === null) {
      const dependentRowsPresent = [
        QUERY_TABLE,
        DEPENDENCY_TABLE,
        PENDING_TABLE,
        IN_FLIGHT_TABLE,
        PUBLICATION_STATE_TABLE,
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
    yield* readDeploymentQuerySyncPublicationLifecycle(
      sql,
      scope,
      STORAGE_READINESS_OPERATION,
    );
    return contract;
  });
}

function createGeneration4Tables(sql: DeploymentQuerySyncSqlStorage): void {
  for (const table of deploymentQuerySyncGeneration4Catalog.tables) {
    sql.exec(table.ddl);
  }
}

function insertGeneration4Contract(
  sql: DeploymentQuerySyncSqlStorage,
  durableInitializedHistory: boolean,
): void {
  sql.exec(`INSERT INTO main.${CONTRACT_TABLE} (
    singleton,
    local_contract_generation,
    durable_initialized_history
  ) VALUES (1, 4, ?)`, durableInitializedHistory ? 1 : 0);
}

export function createFreshDeploymentQuerySyncGeneration4(
  sql: DeploymentQuerySyncSqlStorage,
): void {
  createGeneration4Tables(sql);
  insertGeneration4Contract(sql, false);
  sql.exec(GENERATION_3_DEPENDENCY_REVERSE_INDEX_DDL);
}

export function migrateDeploymentQuerySyncGeneration3ToGeneration4(
  sql: DeploymentQuerySyncSqlStorage,
  durableInitializedHistory: boolean,
): void {
  sql.exec(`ALTER TABLE main.${CONTRACT_TABLE}
    RENAME TO ${GENERATION_3_CONTRACT_TABLE}`);
  sql.exec(GENERATION_4_CONTRACT_TABLE_DDL);
  sql.exec(`INSERT INTO main.${CONTRACT_TABLE} (
    singleton,
    local_contract_generation,
    durable_initialized_history
  ) SELECT singleton, 4, durable_initialized_history
  FROM main.${GENERATION_3_CONTRACT_TABLE}`);
  sql.exec(`DROP TABLE main.${GENERATION_3_CONTRACT_TABLE}`);
  sql.exec(GENERATION_4_IN_FLIGHT_PUBLICATION_TABLE_DDL);
  sql.exec(GENERATION_4_PUBLICATION_STATE_TABLE_DDL);
  if (durableInitializedHistory) {
    sql.exec(`INSERT INTO main.${PUBLICATION_STATE_TABLE} (singleton)
      VALUES (1)`);
  }
}
