import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { Result } from "effect";
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
  ensureDeploymentQuerySyncStorageReady,
  tokenizeDeploymentQuerySyncSqlDefinitionForTest,
  type DeploymentQuerySyncSqlStorage,
  type DeploymentQuerySyncStorage,
} from "../src/deploymentSync/StorageContract";

const scopeUuid = ScopeUuidV1Schema.make(
  "00000000-0000-4000-8000-000000000001",
);
const otherScopeUuid = ScopeUuidV1Schema.make(
  "00000000-0000-4000-8000-000000000002",
);
const epochUuid = ScopeEpochUuidV1Schema.make(
  "00000000-0000-4000-8000-000000000003",
);
const staleEpochUuid = ScopeEpochUuidV1Schema.make(
  "00000000-0000-4000-8000-000000000004",
);

const LEGACY_DDL = `CREATE TABLE deployment_sync_scope_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  local_schema_revision INTEGER NOT NULL,
  scope_uuid TEXT NOT NULL,
  epoch_uuid TEXT NOT NULL,
  storage_generation TEXT NOT NULL,
  storage_generation_fence TEXT NOT NULL,
  applied_through_commit_seq TEXT NOT NULL
)`;

interface SqliteHarness {
  readonly database: DatabaseSync;
  readonly storage: DeploymentQuerySyncStorage;
}

function emptyRawRows<
  Row extends SqlStorageValue[],
>(): IterableIterator<Row> {
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

function getSuccess<A, E>(result: Result.Result<A, E>): A {
  return Result.match(result, {
    onFailure: failure => {
      throw failure;
    },
    onSuccess: success => success,
  });
}

function makeSqliteHarness(): SqliteHarness {
  const database = new DatabaseSync(":memory:");
  const exec: DeploymentQuerySyncSqlStorage["exec"] = <
    T extends Record<string, SqlStorageValue>,
  >(
    query: string,
    ...bindings: SQLInputValue[]
  ): SqlStorageCursor<T> => {
    // SAFETY: production decoders validate every row; this adapter only restores
    // the caller-selected generic over Node SQLite's structurally unknown rows.
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

function makeBinding(input: {
  readonly scope?: typeof scopeUuid;
  readonly epoch?: typeof epochUuid;
  readonly fence?: bigint;
  readonly observed?: bigint;
} = {}): DeploymentQuerySyncBinding {
  const selectedScope = input.scope ?? scopeUuid;
  const observation = captureScopeSyncActiveHeadObservationV1({
    format: SCOPE_SYNC_ACTIVE_HEAD_OBSERVATION_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    scopeUuid: selectedScope,
    epochUuid: input.epoch ?? epochUuid,
    storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
    storageGenerationFence: StorageGenerationFenceSchema.make(
      input.fence ?? 7n,
    ),
    observedAtCommitSeq: CommitSeqSchema.make(input.observed ?? 11n),
    activationSequence: ApplicationActivationSequenceV1Schema.make(1n),
    activeHeadSha256Hex: ApplicationActiveHeadSha256HexV1Schema.make(
      "ab".repeat(32),
    ),
  });
  return getSuccess(captureDeploymentQuerySyncBinding({
    objectId: { name: `deployment-sync:${selectedScope}` },
    observation,
  }));
}

function createLegacyRow(
  harness: SqliteHarness,
  input: {
    readonly scope?: string;
    readonly epoch?: string;
    readonly fence?: string;
    readonly commit?: string;
  } = {},
): void {
  harness.database.exec(LEGACY_DDL);
  harness.database.prepare(`INSERT INTO deployment_sync_scope_state (
    singleton,
    local_schema_revision,
    scope_uuid,
    epoch_uuid,
    storage_generation,
    storage_generation_fence,
    applied_through_commit_seq
  ) VALUES (1, 1, ?, ?, 'flarexdb_v1', ?, ?)`).run(
    input.scope ?? scopeUuid,
    input.epoch ?? epochUuid,
    input.fence ?? "7",
    input.commit ?? "11",
  );
}

function applicationSchemaNames(database: DatabaseSync): string[] {
  return database.prepare(`SELECT name FROM main.sqlite_schema
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY name`).all().map(row => String(row.name));
}

function applicationSchemaRows(database: DatabaseSync): readonly unknown[] {
  return database.prepare(`SELECT type, name, tbl_name, sql
    FROM main.sqlite_schema
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type, name`).all();
}

function legacyScopeRows(database: DatabaseSync): readonly unknown[] {
  return database.prepare(`SELECT
    singleton,
    local_schema_revision,
    scope_uuid,
    epoch_uuid,
    storage_generation,
    storage_generation_fence,
    applied_through_commit_seq
  FROM main.deployment_sync_scope_state
  ORDER BY singleton`).all();
}

describe("deployment query-sync SQLite storage contract", () => {
  it("tokenizes whitespace-equivalent SQL and rejects comments and quoted identifiers", () => {
    const compact = tokenizeDeploymentQuerySyncSqlDefinitionForTest(
      "CREATE TABLE t (value TEXT CHECK (value = 'it''s'));",
    );
    const spaced = tokenizeDeploymentQuerySyncSqlDefinitionForTest(
      "\n CREATE\tTABLE t( value TEXT CHECK(value='it''s') ) \r\n",
    );

    expect(getSuccess(compact)).toEqual(getSuccess(spaced));
    expect(Result.isFailure(tokenizeDeploymentQuerySyncSqlDefinitionForTest(
      "CREATE TABLE t (value TEXT) -- comment",
    ))).toBe(true);
    expect(Result.isFailure(tokenizeDeploymentQuerySyncSqlDefinitionForTest(
      "CREATE TABLE \"t\" (value TEXT)",
    ))).toBe(true);
  });

  it("creates exact generation 3 once for a truly fresh database", () => {
    const harness = makeSqliteHarness();
    try {
      const binding = makeBinding();
      const first = getSuccess(ensureDeploymentQuerySyncStorageReady(
        harness.storage,
        binding,
      ));
      const changesAfterFirst = harness.database.prepare(
        "SELECT total_changes() AS value",
      ).get()?.value;
      const second = getSuccess(ensureDeploymentQuerySyncStorageReady(
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
      ).get()?.value).toBe(changesAfterFirst);
      expect(applicationSchemaNames(harness.database)).toEqual([
        "deployment_sync_contract_state",
        "deployment_sync_pending_publications",
        "deployment_sync_queries",
        "deployment_sync_query_dependencies",
        "deployment_sync_query_dependencies_reverse",
        "deployment_sync_scope_state",
      ]);
    } finally {
      harness.database.close();
    }
  });

  it.each([
    [
      "query",
      "deployment_sync_queries",
      (database: DatabaseSync) => database.prepare(`INSERT INTO
        deployment_sync_queries (query_key, query_identity)
        VALUES (?, 'orphan-query')`).run("A".repeat(43)),
    ],
    [
      "dependency",
      "deployment_sync_query_dependencies",
      (database: DatabaseSync) => database.prepare(`INSERT INTO
        deployment_sync_query_dependencies (
          role,
          query_key,
          generation,
          dependency_key
        ) VALUES ('active', ?, '1', 'orphan-dependency')`).run(
        "B".repeat(43),
      ),
    ],
  ] as const)(
    "rejects an abandoned %s row while initialized history and scope are absent",
    (_kind, table, seed) => {
      const harness = makeSqliteHarness();
      try {
        const binding = makeBinding();
        getSuccess(ensureDeploymentQuerySyncStorageReady(
          harness.storage,
          binding,
        ));
        seed(harness.database);

        const result = ensureDeploymentQuerySyncStorageReady(
          harness.storage,
          binding,
        );

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure).toMatchObject({
            _tag: "QuerySyncStoredStateCorruptError",
            operation: "initializeOrInspectNamespace",
            reason: "storedAggregateInvalid",
            cause: {
              _tag: "DeploymentQuerySyncStorageContractIssue",
              reason: "historyDependentRowsPresent",
            },
          });
        }
        expect(harness.database.prepare(
          `SELECT count(*) AS value FROM ${table}`,
        ).get()?.value).toBe(1);
      } finally {
        harness.database.close();
      }
    },
  );

  it("migrates an empty exact generation-1 catalog atomically", () => {
    const harness = makeSqliteHarness();
    try {
      harness.database.exec(LEGACY_DDL);
      const ready = getSuccess(ensureDeploymentQuerySyncStorageReady(
        harness.storage,
        makeBinding(),
      ));

      expect(ready.durableInitializedHistory).toBe(false);
      expect(harness.database.prepare(
        "SELECT count(*) AS value FROM deployment_sync_scope_state",
      ).get()?.value).toBe(0);
      expect(applicationSchemaNames(harness.database)).not.toContain(
        "deployment_sync_scope_state_generation_1",
      );
    } finally {
      harness.database.close();
    }
  });

  it("preserves a lower cursor and stale epoch during populated generation-1 migration", () => {
    const harness = makeSqliteHarness();
    try {
      createLegacyRow(harness, {
        epoch: staleEpochUuid,
        commit: "5",
      });
      const ready = getSuccess(ensureDeploymentQuerySyncStorageReady(
        harness.storage,
        makeBinding(),
      ));
      const row = harness.database.prepare(`SELECT
        epoch_uuid,
        applied_through_sequence,
        evaluation_work_revision,
        query_count,
        counted_canonical_bytes
      FROM deployment_sync_scope_state`).get();

      expect(ready.durableInitializedHistory).toBe(true);
      expect(row).toMatchObject({
        epoch_uuid: staleEpochUuid,
        applied_through_sequence: "5",
        evaluation_work_revision: "0",
        query_count: 0,
      });
      expect(Number(row?.counted_canonical_bytes)).toBeGreaterThan(0);
    } finally {
      harness.database.close();
    }
  });

  it("rolls back the exact generation-1 schema and row after a migration exec defect", () => {
    const harness = makeSqliteHarness();
    try {
      createLegacyRow(harness, {
        epoch: staleEpochUuid,
        commit: "5",
      });
      const schemaBefore = applicationSchemaRows(harness.database);
      const rowsBefore = legacyScopeRows(harness.database);
      let legacyRenameExecuted = false;
      let defectInjected = false;
      const faultingStorage: DeploymentQuerySyncStorage = {
        sql: {
          exec: <T extends Record<string, SqlStorageValue>>(
            query: string,
            ...bindings: SQLInputValue[]
          ): SqlStorageCursor<T> => {
            if (query.startsWith(
              "ALTER TABLE main.deployment_sync_scope_state",
            )) {
              legacyRenameExecuted = true;
            }
            if (
              legacyRenameExecuted
              && query.startsWith(
                "CREATE TABLE deployment_sync_contract_state",
              )
            ) {
              defectInjected = true;
              throw new Error("injected migration exec defect");
            }
            return harness.storage.sql.exec<T>(query, ...bindings);
          },
        },
        transactionSync: harness.storage.transactionSync,
      };

      expect(() => ensureDeploymentQuerySyncStorageReady(
        faultingStorage,
        makeBinding(),
      )).toThrow("injected migration exec defect");

      expect(legacyRenameExecuted).toBe(true);
      expect(defectInjected).toBe(true);
      expect(applicationSchemaRows(harness.database)).toEqual(schemaBefore);
      expect(legacyScopeRows(harness.database)).toEqual(rowsBefore);
      expect(applicationSchemaNames(harness.database)).toEqual([
        "deployment_sync_scope_state",
      ]);
    } finally {
      harness.database.close();
    }
  });

  it.each([
    ["route scope", { scope: otherScopeUuid }],
    ["storage fence", { fence: "8" }],
    ["cursor ahead", { commit: "12" }],
  ] as const)(
    "refuses a generation-1 %s mismatch before any DDL",
    (_case, legacyInput) => {
      const harness = makeSqliteHarness();
      try {
        createLegacyRow(harness, legacyInput);
        const beforeSql = harness.database.prepare(`SELECT sql
          FROM sqlite_schema
          WHERE name = 'deployment_sync_scope_state'`).get()?.sql;
        const result = ensureDeploymentQuerySyncStorageReady(
          harness.storage,
          makeBinding(),
        );

        expect(Result.isFailure(result)).toBe(true);
        expect(harness.database.prepare(`SELECT sql
          FROM sqlite_schema
          WHERE name = 'deployment_sync_scope_state'`).get()?.sql).toBe(
            beforeSql,
          );
        expect(applicationSchemaNames(harness.database)).toEqual([
          "deployment_sync_scope_state",
        ]);
      } finally {
        harness.database.close();
      }
    },
  );

  it("rejects an altered generation-1 CHECK and a non-system temp object", () => {
    const altered = makeSqliteHarness();
    const temporary = makeSqliteHarness();
    try {
      altered.database.exec(LEGACY_DDL.replace(
        "CHECK (singleton = 1)",
        "CHECK (singleton > 0)",
      ));
      temporary.database.exec("CREATE TEMP TABLE unexpected (value INTEGER)");

      expect(Result.isFailure(ensureDeploymentQuerySyncStorageReady(
        altered.storage,
        makeBinding(),
      ))).toBe(true);
      expect(Result.isFailure(ensureDeploymentQuerySyncStorageReady(
        temporary.storage,
        makeBinding(),
      ))).toBe(true);
    } finally {
      altered.database.close();
      temporary.database.close();
    }
  });

  it("rejects an extra generation-3 index without repairing the catalog", () => {
    const harness = makeSqliteHarness();
    try {
      const binding = makeBinding();
      getSuccess(ensureDeploymentQuerySyncStorageReady(
        harness.storage,
        binding,
      ));
      harness.database.exec(`CREATE INDEX unexpected_query_identity_index
        ON deployment_sync_queries (query_identity)`);
      const schemaBefore = applicationSchemaRows(harness.database);

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
        });
      }
      expect(applicationSchemaRows(harness.database)).toEqual(schemaBefore);
      expect(applicationSchemaNames(harness.database)).toContain(
        "unexpected_query_identity_index",
      );
    } finally {
      harness.database.close();
    }
  });

  it("rejects a generation-3 reverse index with the wrong column order without repair", () => {
    const harness = makeSqliteHarness();
    try {
      const binding = makeBinding();
      getSuccess(ensureDeploymentQuerySyncStorageReady(
        harness.storage,
        binding,
      ));
      harness.database.exec(`DROP INDEX
        deployment_sync_query_dependencies_reverse`);
      harness.database.exec(`CREATE INDEX
        deployment_sync_query_dependencies_reverse
        ON deployment_sync_query_dependencies (
          dependency_key,
          role,
          query_key,
          generation
        )`);
      const schemaBefore = applicationSchemaRows(harness.database);
      const reverseIndexBefore = harness.database.prepare(
        "PRAGMA main.index_xinfo('deployment_sync_query_dependencies_reverse')",
      ).all();

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
        });
      }
      expect(applicationSchemaRows(harness.database)).toEqual(schemaBefore);
      expect(harness.database.prepare(
        "PRAGMA main.index_xinfo('deployment_sync_query_dependencies_reverse')",
      ).all()).toEqual(reverseIndexBefore);
    } finally {
      harness.database.close();
    }
  });

  it("classifies history without scope as corruption on constructor re-entry", () => {
    const harness = makeSqliteHarness();
    try {
      const binding = makeBinding();
      getSuccess(ensureDeploymentQuerySyncStorageReady(
        harness.storage,
        binding,
      ));
      harness.database.exec(`UPDATE deployment_sync_contract_state
        SET durable_initialized_history = 1
        WHERE singleton = 1`);
      const result = ensureDeploymentQuerySyncStorageReady(
        harness.storage,
        binding,
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toMatchObject({
          _tag: "QuerySyncStoredStateCorruptError",
          operation: "initializeOrInspectNamespace",
          reason: "aggregateMissing",
        });
      }
    } finally {
      harness.database.close();
    }
  });
});
