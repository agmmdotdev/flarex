import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import {
  beginQueryEvaluation,
  captureQueryDescriptor,
  captureQueryOperationTarget,
  createEmptyQuerySyncState,
} from "@flarex/query-sync/internal/kernel";
import { Encoding, Result } from "effect";

import {
  ApplicationActivationSequenceV1Schema,
  ApplicationActiveHeadSha256HexV1Schema,
} from "flarex-protocol/commit-protocol";
import {
  SCOPE_SYNC_ACTIVE_HEAD_OBSERVATION_FORMAT_V1,
  SCOPE_SYNC_PROTOCOL_VERSION_V1,
  captureScopeSyncActiveHeadObservationV1,
} from "flarex-protocol/internal/scope-sync-v1";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  ScopeEpochUuidV1Schema,
  ScopeUuidV1Schema,
  StorageGenerationFenceSchema,
} from "flarex-protocol/storage-authority";

import {
  captureDeploymentQuerySyncBinding,
  type DeploymentQuerySyncBinding,
} from "../src/deploymentSync/Binding";
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
import {
  migrateDeploymentQuerySyncGeneration2ToGeneration3,
} from "../src/deploymentSync/StorageContractGeneration3";

const scopeUuid = ScopeUuidV1Schema.make(
  "00000000-0000-4000-8000-000000000031",
);
const epochUuid = ScopeEpochUuidV1Schema.make(
  "00000000-0000-4000-8000-000000000032",
);

export interface Generation2MigrationStreamEvidence {
  readonly queryScansOpened: number;
  readonly queryRowsRead: number;
  readonly dependencyScansOpened: number;
  readonly dependencyRowsRead: number;
  readonly queryCopyWrites: number;
  readonly forbiddenAggregateReadAttempts: number;
}

interface MutableGeneration2MigrationStreamEvidence {
  queryScansOpened: number;
  queryRowsRead: number;
  dependencyScansOpened: number;
  dependencyRowsRead: number;
  queryCopyWrites: number;
  forbiddenAggregateReadAttempts: number;
}

export interface SqliteHarness {
  readonly database: DatabaseSync;
  readonly storage: DeploymentQuerySyncStorage;
  readonly migrationStreamEvidence: Generation2MigrationStreamEvidence;
}

export interface SqliteHarnessOptions {
  readonly streamGeneration2MigrationRows?: boolean;
}

function emptyRawRows<Row extends SqlStorageValue[]>(): IterableIterator<Row> {
  return (function* () {})();
}

function cursorFor<Row extends Record<string, SqlStorageValue>>(
  rows: Row[],
): SqlStorageCursor<Row> {
  let nextIndex = 0;
  return {
    next() {
      const value = rows[nextIndex];
      if (value === undefined) return { done: true };
      nextIndex += 1;
      return { done: false, value };
    },
    toArray: () => [...rows],
    one() {
      if (rows.length !== 1 || rows[0] === undefined) {
        throw new Error("Expected exactly one SQLite test row.");
      }
      return rows[0];
    },
    raw: emptyRawRows,
    columnNames: rows[0] === undefined ? [] : Object.keys(rows[0]),
    get rowsRead() {
      return rows.length;
    },
    get rowsWritten() {
      return 0;
    },
    [Symbol.iterator]: () => rows[Symbol.iterator](),
  };
}

type Generation2MigrationScanKind = "query" | "dependency";

function normalizeGeneration2MigrationSql(query: string): string {
  return query.trim().replaceAll(/\s+/g, " ").toLowerCase();
}

function generation2MigrationScanKind(
  query: string,
): Generation2MigrationScanKind | null {
  const normalized = normalizeGeneration2MigrationSql(query);
  if (
    normalized.startsWith("select query_key, query_identity,")
    && normalized.includes("from main.deployment_sync_queries")
    && normalized.endsWith("order by query_key collate binary")
  ) {
    return "query";
  }
  if (
    normalized.startsWith("select role, query_key, generation, dependency_key")
    && normalized.includes("from main.deployment_sync_query_dependencies")
    && normalized.endsWith(
      "order by query_key collate binary, role, generation, dependency_key collate binary",
    )
  ) {
    return "dependency";
  }
  return null;
}

function streamingCursorFor<Row extends Record<string, SqlStorageValue>>(
  database: DatabaseSync,
  query: string,
  bindings: readonly SQLInputValue[],
  kind: Generation2MigrationScanKind,
  evidence: MutableGeneration2MigrationStreamEvidence,
): SqlStorageCursor<Row> {
  const iterable = database.prepare(query).iterate(...bindings);
  // SAFETY: production codecs validate every row. This test adapter restores
  // the caller-selected generic only at the Node SQLite iterator boundary.
  const iterator = iterable[Symbol.iterator]() as Iterator<Row>;
  let rowsRead = 0;
  const cursor: SqlStorageCursor<Row> = {
    next() {
      const next = iterator.next();
      if (next.done === true) return { done: true };
      rowsRead += 1;
      if (kind === "query") evidence.queryRowsRead += 1;
      else evidence.dependencyRowsRead += 1;
      return { done: false, value: next.value };
    },
    toArray() {
      evidence.forbiddenAggregateReadAttempts += 1;
      throw new Error(
        "Generation-2 migration rows must be consumed through the SQLite iterator.",
      );
    },
    one() {
      throw new Error(
        "Generation-2 migration row scans do not support singleton reads.",
      );
    },
    raw: emptyRawRows,
    columnNames: [],
    get rowsRead() {
      return rowsRead;
    },
    get rowsWritten() {
      return 0;
    },
    [Symbol.iterator]: () => (function* () {
      while (true) {
        const next = cursor.next();
        if (next.done === true) return;
        yield next.value;
      }
    })(),
  };
  return cursor;
}

export function makeSqliteHarness(
  options: SqliteHarnessOptions = {},
): SqliteHarness {
  const database = new DatabaseSync(":memory:");
  const evidence: MutableGeneration2MigrationStreamEvidence = {
    queryScansOpened: 0,
    queryRowsRead: 0,
    dependencyScansOpened: 0,
    dependencyRowsRead: 0,
    queryCopyWrites: 0,
    forbiddenAggregateReadAttempts: 0,
  };
  const exec: DeploymentQuerySyncSqlStorage["exec"] = <
    Row extends Record<string, SqlStorageValue>,
  >(
    query: string,
    ...bindings: SQLInputValue[]
  ): SqlStorageCursor<Row> => {
    const scanKind = options.streamGeneration2MigrationRows === true
      ? generation2MigrationScanKind(query)
      : null;
    if (scanKind !== null) {
      if (scanKind === "query") evidence.queryScansOpened += 1;
      else evidence.dependencyScansOpened += 1;
      return streamingCursorFor(database, query, bindings, scanKind, evidence);
    }
    if (
      options.streamGeneration2MigrationRows === true
      && normalizeGeneration2MigrationSql(query).startsWith(
        "insert into main.deployment_sync_queries",
      )
    ) {
      evidence.queryCopyWrites += 1;
    }
    // SAFETY: production codecs validate every row. This test adapter only
    // restores the caller-selected generic over Node SQLite's unknown rows.
    const rows = database.prepare(query).all(...bindings) as Row[];
    return cursorFor(rows);
  };
  return {
    database,
    migrationStreamEvidence: evidence,
    storage: {
      sql: { exec },
      transactionSync: <A>(closure: () => A): A => {
        database.exec("BEGIN IMMEDIATE");
        try {
          const value = closure();
          database.exec("COMMIT");
          return value;
        } catch (cause) {
          database.exec("ROLLBACK");
          throw cause;
        }
      },
    },
  };
}

export function success<A, E>(result: Result.Result<A, E>): A {
  return Result.match(result, {
    onFailure: failure => {
      throw failure;
    },
    onSuccess: value => value,
  });
}

export function makeBinding(): DeploymentQuerySyncBinding {
  const observation = captureScopeSyncActiveHeadObservationV1({
    format: SCOPE_SYNC_ACTIVE_HEAD_OBSERVATION_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    scopeUuid,
    epochUuid,
    storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
    storageGenerationFence: StorageGenerationFenceSchema.make(13n),
    observedAtCommitSeq: CommitSeqSchema.make(21n),
    activationSequence: ApplicationActivationSequenceV1Schema.make(1n),
    activeHeadSha256Hex: ApplicationActiveHeadSha256HexV1Schema.make(
      "bc".repeat(32),
    ),
  });
  return success(captureDeploymentQuerySyncBinding({
    objectId: { name: `deployment-sync:${scopeUuid}` },
    observation,
  }));
}

export function createGeneration2Catalog(
  database: DatabaseSync,
  initialized: boolean,
): void {
  database.exec(GENERATION_2_CONTRACT_TABLE_DDL);
  database.exec(GENERATION_2_SCOPE_TABLE_DDL);
  database.exec(GENERATION_2_QUERY_TABLE_DDL);
  database.exec(GENERATION_2_DEPENDENCY_TABLE_DDL);
  database.exec(GENERATION_2_DEPENDENCY_REVERSE_INDEX_DDL);
  database.prepare(`INSERT INTO deployment_sync_contract_state (
    singleton,
    local_contract_generation,
    durable_initialized_history
  ) VALUES (1, 2, ?)`).run(initialized ? 1 : 0);
}

export function insertGeneration2ScopeRow(
  database: DatabaseSync,
  row: EncodedDeploymentQuerySyncScopeRow,
): void {
  database.prepare(`INSERT INTO deployment_sync_scope_state (
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
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
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
  );
}

const generation2QueryInsertSql = `INSERT INTO deployment_sync_queries (
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
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export function prepareGeneration2QueryRowInsert(
  database: DatabaseSync,
): (row: EncodedDeploymentQuerySyncQueryRow) => void {
  const statement = database.prepare(generation2QueryInsertSql);
  return row => {
    statement.run(
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
    );
  };
}

export function insertGeneration2QueryRow(
  database: DatabaseSync,
  row: EncodedDeploymentQuerySyncQueryRow,
): void {
  prepareGeneration2QueryRowInsert(database)(row);
}

export function seedProvisionalOnlyGeneration2(
  database: DatabaseSync,
  binding: DeploymentQuerySyncBinding,
): EncodedDeploymentQuerySyncQueryRow {
  createGeneration2Catalog(database, true);
  const empty = success(createEmptyQuerySyncState(binding.bootstrapCursor));
  const descriptor = success(captureQueryDescriptor({
    queryKey: Encoding.encodeBase64Url(new Uint8Array(32).fill(7)),
    queryIdentity: Encoding.encodeBase64Url("generation-two-query"),
  }));
  const target = success(captureQueryOperationTarget({
    namespaceId: binding.namespaceId,
    syncModelId: binding.syncModelId,
    sourceEpoch: binding.sourceEpoch,
    descriptor,
  }));
  const begun = success(beginQueryEvaluation(empty, {
    target,
    expectedActiveGeneration: null,
    requestedDirtyThroughSequence: null,
  }));
  if (begun._tag !== "created" || begun.state.queries[0] === undefined) {
    throw new Error("Expected a created provisional query fixture.");
  }
  const query = begun.state.queries[0];
  const scopeRow = encodeDeploymentQuerySyncScopeRow({
    scopeUuid: binding.scopeUuid,
    epochUuid: binding.epochUuid,
    storageGeneration: binding.storageGeneration,
    storageGenerationFence: binding.storageGenerationFence,
    syncModelId: binding.syncModelId,
    facts: Object.freeze({
      cursor: begun.state.cursor,
      evaluationWork: begun.state.evaluationWork,
      metrics: begun.state.metrics,
    }),
  });
  const queryRow = encodeDeploymentQuerySyncQueryRow({
    descriptor: query.descriptor,
    active: query.active,
    provisional: query.provisional,
  });
  insertGeneration2ScopeRow(database, scopeRow);
  insertGeneration2QueryRow(database, queryRow);
  return queryRow;
}

export function seedActiveGeneration2(
  database: DatabaseSync,
  binding: DeploymentQuerySyncBinding,
): EncodedDeploymentQuerySyncQueryRow {
  const query = seedProvisionalOnlyGeneration2(database, binding);
  const digest = Encoding.encodeBase64Url(new Uint8Array(32).fill(19));
  const witness = Encoding.encodeBase64Url(new Uint8Array(32).fill(23));
  database.prepare(`UPDATE deployment_sync_queries SET
    active_generation = '1',
    active_evaluation_snapshot_sequence = '20',
    active_fresh_through_sequence = '20',
    active_dirty_through_sequence = '21',
    active_result_digest = ?,
    active_authority_witness = ?,
    provisional_generation = '2',
    provisional_expected_active_generation = '1',
    provisional_requested_dirty_through_sequence = '21'
  WHERE query_key = ?`).run(digest, witness, query.query_key);
  database.exec(`UPDATE deployment_sync_scope_state
    SET counted_canonical_bytes = counted_canonical_bytes + 113`);
  return query;
}

export function seedActiveOnlyGeneration2(
  database: DatabaseSync,
  binding: DeploymentQuerySyncBinding,
): EncodedDeploymentQuerySyncQueryRow {
  const query = seedActiveGeneration2(database, binding);
  database.prepare(`UPDATE deployment_sync_queries SET
    provisional_generation = NULL,
    provisional_expected_active_generation = NULL,
    provisional_registration_sequence = NULL,
    provisional_requested_dirty_through_sequence = NULL,
    provisional_disposition = NULL
  WHERE query_key = ?`).run(query.query_key);
  database.exec(`UPDATE deployment_sync_scope_state
    SET counted_canonical_bytes = counted_canonical_bytes - 35`);
  return query;
}

export function applicationSchema(database: DatabaseSync): readonly unknown[] {
  return database.prepare(`SELECT type, name, tbl_name, sql
    FROM main.sqlite_schema
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type, name`).all();
}

export function migrateSqliteHarnessToGeneration3(
  harness: SqliteHarness,
): void {
  harness.storage.transactionSync(() => {
    migrateDeploymentQuerySyncGeneration2ToGeneration3(harness.storage.sql);
  });
}

export function snapshotGeneration3Predecessor(database: DatabaseSync) {
  return Object.freeze({
    schema: applicationSchema(database),
    contract: rowsIfTablePresent(
      database,
      "deployment_sync_contract_state",
      `SELECT * FROM deployment_sync_contract_state ORDER BY singleton`,
    ),
    scope: rowsIfTablePresent(
      database,
      "deployment_sync_scope_state",
      `SELECT * FROM deployment_sync_scope_state ORDER BY singleton`,
    ),
    queries: rowsIfTablePresent(
      database,
      "deployment_sync_queries",
      `SELECT * FROM deployment_sync_queries
        ORDER BY query_key COLLATE BINARY`,
    ),
    dependencies: rowsIfTablePresent(
      database,
      "deployment_sync_query_dependencies",
      `SELECT * FROM deployment_sync_query_dependencies
        ORDER BY query_key COLLATE BINARY, role, generation,
          dependency_key COLLATE BINARY`,
    ),
    pending: rowsIfTablePresent(
      database,
      "deployment_sync_pending_publications",
      `SELECT * FROM deployment_sync_pending_publications
        ORDER BY query_key COLLATE BINARY`,
    ),
  });
}

function rowsIfTablePresent(
  database: DatabaseSync,
  tableName: string,
  query: string,
): readonly unknown[] | null {
  const exists = database.prepare(`SELECT 1 AS present
    FROM main.sqlite_schema
    WHERE type = 'table' AND name = ?`).get(tableName);
  return exists === undefined ? null : database.prepare(query).all();
}

export function storageWithMutationObserver(
  storage: DeploymentQuerySyncStorage,
  onMutation: (query: string) => void,
): DeploymentQuerySyncStorage {
  const exec: DeploymentQuerySyncSqlStorage["exec"] = <
    Row extends Record<string, SqlStorageValue>,
  >(
    query: string,
    ...bindings: SQLInputValue[]
  ): SqlStorageCursor<Row> => {
    if (/^(?:alter|create|delete|drop|insert|replace|update)\b/iu.test(
      query.trimStart(),
    )) {
      onMutation(query);
    }
    return storage.sql.exec<Row>(query, ...bindings);
  };
  return Object.freeze({
    transactionSync: storage.transactionSync,
    sql: Object.freeze({ exec }),
  });
}

export interface Generation2StateSnapshot {
  readonly schema: readonly unknown[];
  readonly contractRows: readonly unknown[];
  readonly scopeRows: readonly unknown[];
  readonly queryRows: readonly unknown[];
  readonly dependencyRows: readonly unknown[];
}

export function snapshotGeneration2State(
  database: DatabaseSync,
): Generation2StateSnapshot {
  return Object.freeze({
    schema: applicationSchema(database),
    contractRows: database.prepare(`SELECT *
      FROM deployment_sync_contract_state ORDER BY singleton`).all(),
    scopeRows: database.prepare(`SELECT *
      FROM deployment_sync_scope_state ORDER BY singleton`).all(),
    queryRows: database.prepare(`SELECT *
      FROM deployment_sync_queries ORDER BY query_key COLLATE BINARY`).all(),
    dependencyRows: database.prepare(`SELECT *
      FROM deployment_sync_query_dependencies
      ORDER BY query_key COLLATE BINARY, role, generation,
        dependency_key COLLATE BINARY`).all(),
  });
}
