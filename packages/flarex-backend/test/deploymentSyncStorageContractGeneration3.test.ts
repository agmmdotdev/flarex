import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import {
  beginQueryEvaluation,
  captureQueryDescriptor,
  captureQueryOperationTarget,
  createEmptyQuerySyncState,
} from "@flarex/query-sync/internal/kernel";
import { Encoding, Result } from "effect";
import { describe, expect, it } from "vitest";

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
import {
  ensureDeploymentQuerySyncStorageReady,
  type DeploymentQuerySyncSqlStorage,
  type DeploymentQuerySyncStorage,
} from "../src/deploymentSync/StorageContract";
import {
  GENERATION_2_CONTRACT_TABLE_DDL,
  GENERATION_2_DEPENDENCY_REVERSE_INDEX_DDL,
  GENERATION_2_DEPENDENCY_TABLE_DDL,
  GENERATION_2_QUERY_TABLE_DDL,
  GENERATION_2_SCOPE_TABLE_DDL,
} from "../src/deploymentSync/StorageContractGeneration2";

const scopeUuid = ScopeUuidV1Schema.make(
  "00000000-0000-4000-8000-000000000031",
);
const epochUuid = ScopeEpochUuidV1Schema.make(
  "00000000-0000-4000-8000-000000000032",
);

interface SqliteHarness {
  readonly database: DatabaseSync;
  readonly storage: DeploymentQuerySyncStorage;
}

function emptyRawRows<Row extends SqlStorageValue[]>(): IterableIterator<Row> {
  return (function* () {})();
}

function cursorFor<T extends Record<string, SqlStorageValue>>(
  rows: T[],
): SqlStorageCursor<T> {
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
    [Symbol.iterator]: () => [...rows][Symbol.iterator](),
  };
}

function makeSqliteHarness(): SqliteHarness {
  const database = new DatabaseSync(":memory:");
  const exec: DeploymentQuerySyncSqlStorage["exec"] = <
    T extends Record<string, SqlStorageValue>,
  >(
    query: string,
    ...bindings: SQLInputValue[]
  ): SqlStorageCursor<T> => {
    // SAFETY: production codecs validate every row. This test adapter only
    // restores the caller-selected generic over Node SQLite's unknown rows.
    const rows = database.prepare(query).all(...bindings) as T[];
    return cursorFor(rows);
  };
  return {
    database,
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

function success<A, E>(result: Result.Result<A, E>): A {
  return Result.match(result, {
    onFailure: failure => {
      throw failure;
    },
    onSuccess: value => value,
  });
}

function makeBinding(): DeploymentQuerySyncBinding {
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

function createGeneration2Catalog(
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

function insertScopeRow(
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

function insertQueryRow(
  database: DatabaseSync,
  row: EncodedDeploymentQuerySyncQueryRow,
): void {
  database.prepare(`INSERT INTO deployment_sync_queries (
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
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
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
}

function seedProvisionalOnlyGeneration2(
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
  insertScopeRow(database, scopeRow);
  insertQueryRow(database, queryRow);
  return queryRow;
}

function seedActiveGeneration2(
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

function seedActiveOnlyGeneration2(
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

function applicationSchema(database: DatabaseSync): readonly unknown[] {
  return database.prepare(`SELECT type, name, tbl_name, sql
    FROM main.sqlite_schema
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type, name`).all();
}

describe("deployment query-sync generation-3 storage contract", () => {
  it("creates the exact five-table generation-3 catalog and reopens without writes", () => {
    const harness = makeSqliteHarness();
    try {
      const binding = makeBinding();
      const first = success(ensureDeploymentQuerySyncStorageReady(
        harness.storage,
        binding,
      ));
      const changes = harness.database.prepare(
        "SELECT total_changes() AS value",
      ).get()?.value;
      const second = success(ensureDeploymentQuerySyncStorageReady(
        harness.storage,
        binding,
      ));

      expect(first).toEqual({
        localContractGeneration: 3,
        durableInitializedHistory: false,
      });
      expect(second).toEqual(first);
      expect(harness.database.prepare(
        "SELECT total_changes() AS value",
      ).get()?.value).toBe(changes);
      expect(harness.database.prepare("PRAGMA table_list").all()
        .filter(row => String(row.name).startsWith("deployment_sync_"))
        .map(row => ({
          name: row.name,
          strict: row.strict,
          wr: row.wr,
        })).toSorted((left, right) => String(left.name).localeCompare(
          String(right.name),
        ))).toEqual([
        { name: "deployment_sync_contract_state", strict: 1, wr: 1 },
        { name: "deployment_sync_pending_publications", strict: 1, wr: 1 },
        { name: "deployment_sync_queries", strict: 1, wr: 1 },
        { name: "deployment_sync_query_dependencies", strict: 1, wr: 1 },
        { name: "deployment_sync_scope_state", strict: 1, wr: 1 },
      ]);
    } finally {
      harness.database.close();
    }
  });

  it("preserves the exact Cloudflare provider-table allowlist", () => {
    const harness = makeSqliteHarness();
    try {
      harness.database.exec(`CREATE TABLE _cf_KV (
        key TEXT PRIMARY KEY,
        value BLOB
      )`);
      harness.database.exec(`CREATE TABLE __cf_kv (
        key TEXT PRIMARY KEY,
        value BLOB
      )`);

      const ready = success(ensureDeploymentQuerySyncStorageReady(
        harness.storage,
        makeBinding(),
      ));

      expect(ready.localContractGeneration).toBe(3);
      expect(harness.database.prepare(
        "SELECT count(*) AS value FROM _cf_KV",
      ).get()?.value).toBe(0);
      expect(harness.database.prepare(
        "SELECT count(*) AS value FROM __cf_kv",
      ).get()?.value).toBe(0);
    } finally {
      harness.database.close();
    }
  });

  it("migrates empty and populated provisional-only generation 2 in place", () => {
    const emptyHarness = makeSqliteHarness();
    const populatedHarness = makeSqliteHarness();
    try {
      const binding = makeBinding();
      createGeneration2Catalog(emptyHarness.database, false);
      const emptyReady = success(ensureDeploymentQuerySyncStorageReady(
        emptyHarness.storage,
        binding,
      ));
      const queryBefore = seedProvisionalOnlyGeneration2(
        populatedHarness.database,
        binding,
      );
      const populatedReady = success(ensureDeploymentQuerySyncStorageReady(
        populatedHarness.storage,
        binding,
      ));
      const queryAfter = populatedHarness.database.prepare(`SELECT
        query_key,
        provisional_generation,
        completion_generation,
        preceding_completion_generation
      FROM deployment_sync_queries`).get();

      expect(emptyReady).toEqual({
        localContractGeneration: 3,
        durableInitializedHistory: false,
      });
      expect(populatedReady).toEqual({
        localContractGeneration: 3,
        durableInitializedHistory: true,
      });
      expect(queryAfter).toEqual({
        query_key: queryBefore.query_key,
        provisional_generation: queryBefore.provisional_generation,
        completion_generation: null,
        preceding_completion_generation: null,
      });
      expect(populatedHarness.database.prepare(
        "SELECT count(*) AS value FROM deployment_sync_pending_publications",
      ).get()?.value).toBe(0);
    } finally {
      emptyHarness.database.close();
      populatedHarness.database.close();
    }
  });

  it("refuses a valid active generation-2 fixture before DDL", () => {
    const harness = makeSqliteHarness();
    try {
      const binding = makeBinding();
      seedActiveGeneration2(harness.database, binding);
      const schemaBefore = applicationSchema(harness.database);

      const result = ensureDeploymentQuerySyncStorageReady(
        harness.storage,
        binding,
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toMatchObject({
          _tag: "QuerySyncStoredStateIncompatibleError",
          operation: "initializeOrInspectNamespace",
          reason: "unsupportedStoredContract",
          cause: {
            _tag: "DeploymentQuerySyncStorageContractIssue",
            reason: "generation2StateUnsupported",
          },
        });
      }
      expect(applicationSchema(harness.database)).toEqual(schemaBefore);
      expect(harness.database.prepare(`SELECT local_contract_generation
        FROM deployment_sync_contract_state`).get()?.local_contract_generation)
        .toBe(2);
    } finally {
      harness.database.close();
    }
  });

  it("classifies valid active-only generation 2 as incompatible before DDL", () => {
    const harness = makeSqliteHarness();
    try {
      const binding = makeBinding();
      seedActiveOnlyGeneration2(harness.database, binding);
      const schemaBefore = applicationSchema(harness.database);

      const result = ensureDeploymentQuerySyncStorageReady(
        harness.storage,
        binding,
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toMatchObject({
          _tag: "QuerySyncStoredStateIncompatibleError",
          operation: "initializeOrInspectNamespace",
          reason: "unsupportedStoredContract",
          cause: {
            _tag: "DeploymentQuerySyncStorageContractIssue",
            reason: "generation2StateUnsupported",
          },
        });
      }
      expect(applicationSchema(harness.database)).toEqual(schemaBefore);
    } finally {
      harness.database.close();
    }
  });

  it("refuses valid generation-2 dependency state before DDL", () => {
    const harness = makeSqliteHarness();
    try {
      const binding = makeBinding();
      const query = seedActiveGeneration2(harness.database, binding);
      const dependencyKey = Encoding.encodeBase64Url(new Uint8Array([1]));
      harness.database.prepare(`INSERT INTO
        deployment_sync_query_dependencies (
          role,
          query_key,
          generation,
          dependency_key
        ) VALUES ('active', ?, '1', ?)`).run(
        query.query_key,
        dependencyKey,
      );
      harness.database.exec(`UPDATE deployment_sync_scope_state SET
        dependency_memberships = 1,
        counted_canonical_bytes = counted_canonical_bytes + 1`);
      const schemaBefore = applicationSchema(harness.database);

      const result = ensureDeploymentQuerySyncStorageReady(
        harness.storage,
        binding,
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toMatchObject({
          _tag: "QuerySyncStoredStateIncompatibleError",
          reason: "unsupportedStoredContract",
          cause: {
            _tag: "DeploymentQuerySyncStorageContractIssue",
            reason: "generation2StateUnsupported",
          },
        });
      }
      expect(applicationSchema(harness.database)).toEqual(schemaBefore);
    } finally {
      harness.database.close();
    }
  });

  it("refuses generation-2 publication accounting before DDL", () => {
    const harness = makeSqliteHarness();
    try {
      const binding = makeBinding();
      seedProvisionalOnlyGeneration2(harness.database, binding);
      harness.database.exec(`UPDATE deployment_sync_scope_state SET
        pending_publication_count = 1,
        retained_publication_content_bytes = 1,
        counted_canonical_bytes = counted_canonical_bytes + 1`);
      const schemaBefore = applicationSchema(harness.database);

      const result = ensureDeploymentQuerySyncStorageReady(
        harness.storage,
        binding,
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toMatchObject({
          _tag: "QuerySyncStoredStateIncompatibleError",
          reason: "unsupportedStoredContract",
          cause: {
            _tag: "DeploymentQuerySyncStorageContractIssue",
            reason: "generation2StateUnsupported",
          },
        });
      }
      expect(applicationSchema(harness.database)).toEqual(schemaBefore);
    } finally {
      harness.database.close();
    }
  });

  it("rolls back generation-2 DDL when post-migration authentication fails", () => {
    const harness = makeSqliteHarness();
    try {
      const binding = makeBinding();
      createGeneration2Catalog(harness.database, false);
      const schemaBefore = applicationSchema(harness.database);
      let migrationWriteSeen = false;
      const faultingStorage: DeploymentQuerySyncStorage = {
        transactionSync: harness.storage.transactionSync,
        sql: {
          exec: <T extends Record<string, SqlStorageValue>>(
            query: string,
            ...bindings: SQLInputValue[]
          ): SqlStorageCursor<T> => {
            if (query.startsWith("DROP INDEX main.")) {
              migrationWriteSeen = true;
            }
            if (migrationWriteSeen && query === "PRAGMA table_list") {
              return harness.storage.sql.exec<T>(`SELECT
                'main' AS schema,
                'unexpected' AS name,
                'table' AS type,
                1 AS ncol,
                0 AS wr,
                0 AS strict`);
            }
            return harness.storage.sql.exec<T>(query, ...bindings);
          },
        },
      };

      const result = ensureDeploymentQuerySyncStorageReady(
        faultingStorage,
        binding,
      );

      expect(migrationWriteSeen).toBe(true);
      expect(Result.isFailure(result)).toBe(true);
      expect(applicationSchema(harness.database)).toEqual(schemaBefore);
      expect(harness.database.prepare(`SELECT local_contract_generation
        FROM deployment_sync_contract_state`).get()?.local_contract_generation)
        .toBe(2);
    } finally {
      harness.database.close();
    }
  });
});
