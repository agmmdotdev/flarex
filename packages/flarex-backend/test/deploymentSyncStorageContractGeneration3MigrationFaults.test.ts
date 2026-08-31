import type { SQLInputValue } from "node:sqlite";

import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  ensureDeploymentQuerySyncStorageReady,
  type DeploymentQuerySyncSqlStorage,
  type DeploymentQuerySyncStorage,
} from "../src/deploymentSync/StorageContract";
import {
  migrateDeploymentQuerySyncGeneration2ToGeneration3,
} from "../src/deploymentSync/StorageContractGeneration3";
import {
  makeBinding,
  makeSqliteHarness,
  seedProvisionalOnlyGeneration2,
  snapshotGeneration2State,
  success,
} from "./deploymentSyncStorageContractGeneration3TestSupport";

const migrationSteps = Object.freeze([
  "drop dependency reverse index",
  "rename generation-2 contract table",
  "rename generation-2 query table",
  "rename generation-2 dependency table",
  "create generation-3 contract table",
  "create generation-3 query table",
  "create generation-3 dependency table",
  "create generation-3 pending table",
  "copy contract row",
  "copy query rows",
  "copy dependency rows",
  "drop generation-2 contract table",
  "drop generation-2 query table",
  "drop generation-2 dependency table",
  "create dependency reverse index",
  "rename generation-3 contract table",
  "create generation-4 contract table",
  "copy generation-4 contract row",
  "drop generation-3 contract table",
  "create in-flight publication table",
  "create publication state table",
  "insert empty publication state",
] as const);

type MigrationStep = (typeof migrationSteps)[number];

const generation4Steps = Object.freeze([
  "rename generation-3 contract table",
  "create generation-4 contract table",
  "copy generation-4 contract row",
  "drop generation-3 contract table",
  "create in-flight publication table",
  "create publication state table",
  "insert empty publication state",
] as const satisfies readonly MigrationStep[]);

function normalizeSql(query: string): string {
  return query.trim().replaceAll(/\s+/g, " ").toLowerCase();
}

function migrationStepFor(query: string): MigrationStep | null {
  const sql = normalizeSql(query);
  if (
    sql === "drop index main.deployment_sync_query_dependencies_reverse"
  ) {
    return "drop dependency reverse index";
  }
  if (sql === "alter table main.deployment_sync_contract_state rename to deployment_sync_contract_state_generation_2") {
    return "rename generation-2 contract table";
  }
  if (sql === "alter table main.deployment_sync_contract_state rename to deployment_sync_contract_state_generation_3") {
    return "rename generation-3 contract table";
  }
  if (
    sql.startsWith("alter table main.deployment_sync_queries rename to")
  ) {
    return "rename generation-2 query table";
  }
  if (
    sql.startsWith(
      "alter table main.deployment_sync_query_dependencies rename to",
    )
  ) {
    return "rename generation-2 dependency table";
  }
  if (
    sql.startsWith("create table deployment_sync_contract_state")
    && sql.includes("check (local_contract_generation = 3)")
  ) {
    return "create generation-3 contract table";
  }
  if (
    sql.startsWith("create table deployment_sync_contract_state")
    && sql.includes("check (local_contract_generation = 4)")
  ) {
    return "create generation-4 contract table";
  }
  if (sql.startsWith("create table deployment_sync_queries")) {
    return "create generation-3 query table";
  }
  if (
    sql.startsWith("create table deployment_sync_query_dependencies")
  ) {
    return "create generation-3 dependency table";
  }
  if (
    sql.startsWith("create table deployment_sync_pending_publications")
  ) {
    return "create generation-3 pending table";
  }
  if (
    sql.startsWith("insert into main.deployment_sync_contract_state")
    && sql.includes("select singleton, 3, durable_initialized_history")
  ) {
    return "copy contract row";
  }
  if (
    sql.startsWith("insert into main.deployment_sync_contract_state")
    && sql.includes("select singleton, 4, durable_initialized_history")
  ) {
    return "copy generation-4 contract row";
  }
  if (sql.startsWith("insert into main.deployment_sync_queries")) {
    return "copy query rows";
  }
  if (
    sql.startsWith("insert into main.deployment_sync_query_dependencies")
  ) {
    return "copy dependency rows";
  }
  if (
    sql === "drop table main.deployment_sync_contract_state_generation_2"
  ) {
    return "drop generation-2 contract table";
  }
  if (sql === "drop table main.deployment_sync_queries_generation_2") {
    return "drop generation-2 query table";
  }
  if (
    sql === "drop table main.deployment_sync_query_dependencies_generation_2"
  ) {
    return "drop generation-2 dependency table";
  }
  if (
    sql.startsWith(
      "create index deployment_sync_query_dependencies_reverse",
    )
  ) {
    return "create dependency reverse index";
  }
  if (
    sql === "drop table main.deployment_sync_contract_state_generation_3"
  ) {
    return "drop generation-3 contract table";
  }
  if (
    sql.startsWith(
      "create table deployment_sync_in_flight_publication",
    )
  ) {
    return "create in-flight publication table";
  }
  if (
    sql.startsWith("create table deployment_sync_publication_state")
  ) {
    return "create publication state table";
  }
  if (
    sql.startsWith("insert into main.deployment_sync_publication_state")
  ) {
    return "insert empty publication state";
  }
  if (sql.startsWith("select ") || sql.startsWith("pragma ")) return null;
  throw new Error(`Unrecognized migration statement: ${sql}`);
}

function storageWithExec(
  storage: DeploymentQuerySyncStorage,
  exec: DeploymentQuerySyncSqlStorage["exec"],
): DeploymentQuerySyncStorage {
  return {
    transactionSync: storage.transactionSync,
    sql: { exec },
  };
}

const faultCases = migrationSteps.flatMap((step, index) =>
  (["before", "after"] as const).map(timing => ({ index, step, timing }))
);

const generation4FaultCases = generation4Steps.flatMap((step, index) =>
  (["before", "after"] as const).map(timing => ({ index, step, timing }))
);

describe("generation-2 through generation-4 migration fault proof", () => {
  it("pins the complete ordered migration write program", () => {
    const harness = makeSqliteHarness();
    try {
      const binding = makeBinding();
      seedProvisionalOnlyGeneration2(harness.database, binding);
      const observed: MigrationStep[] = [];
      const exec: DeploymentQuerySyncSqlStorage["exec"] = <
        Row extends Record<string, SqlStorageValue>,
      >(
        query: string,
        ...bindings: SQLInputValue[]
      ): SqlStorageCursor<Row> => {
        const step = migrationStepFor(query);
        if (step !== null) observed.push(step);
        return harness.storage.sql.exec<Row>(query, ...bindings);
      };

      success(ensureDeploymentQuerySyncStorageReady(
        storageWithExec(harness.storage, exec),
        binding,
      ));

      expect(observed).toEqual(migrationSteps);
    } finally {
      harness.database.close();
    }
  });

  it("rolls back a typed post-migration authentication failure", () => {
    const harness = makeSqliteHarness();
    try {
      const binding = makeBinding();
      seedProvisionalOnlyGeneration2(harness.database, binding);
      const stateBefore = snapshotGeneration2State(harness.database);
      let generation4WriteSeen = false;
      const exec: DeploymentQuerySyncSqlStorage["exec"] = <
        Row extends Record<string, SqlStorageValue>,
      >(
        query: string,
        ...bindings: SQLInputValue[]
      ): SqlStorageCursor<Row> => {
        if (migrationStepFor(query) === "insert empty publication state") {
          generation4WriteSeen = true;
        }
        if (generation4WriteSeen && query === "PRAGMA table_list") {
          return harness.storage.sql.exec<Row>(`SELECT
            'main' AS schema,
            'unexpected' AS name,
            'table' AS type,
            1 AS ncol,
            0 AS wr,
            0 AS strict`);
        }
        return harness.storage.sql.exec<Row>(query, ...bindings);
      };

      const result = ensureDeploymentQuerySyncStorageReady(
        storageWithExec(harness.storage, exec),
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
      expect(snapshotGeneration2State(harness.database)).toEqual(stateBefore);
      expect(success(ensureDeploymentQuerySyncStorageReady(
        harness.storage,
        binding,
      ))).toEqual({
        localContractGeneration: 4,
        durableInitializedHistory: true,
      });
    } finally {
      harness.database.close();
    }
  });

  it.each(faultCases)(
    "rolls back and retries a $timing fault at $step",
    ({ index: faultIndex, step: expectedStep, timing }) => {
      const harness = makeSqliteHarness();
      try {
        const binding = makeBinding();
        const queryBefore = seedProvisionalOnlyGeneration2(
          harness.database,
          binding,
        );
        const stateBefore = snapshotGeneration2State(harness.database);
        const fault = new Error(
          `migration fault ${timing} write ${faultIndex + 1}`,
        );
        const attempted: MigrationStep[] = [];
        let migrationWriteIndex = 0;
        const exec: DeploymentQuerySyncSqlStorage["exec"] = <
          Row extends Record<string, SqlStorageValue>,
        >(
          query: string,
          ...bindings: SQLInputValue[]
        ): SqlStorageCursor<Row> => {
          const step = migrationStepFor(query);
          if (step === null) {
            return harness.storage.sql.exec<Row>(query, ...bindings);
          }
          const currentIndex = migrationWriteIndex;
          migrationWriteIndex += 1;
          attempted.push(step);
          if (currentIndex === faultIndex && timing === "before") throw fault;
          const cursor = harness.storage.sql.exec<Row>(query, ...bindings);
          if (currentIndex === faultIndex && timing === "after") throw fault;
          return cursor;
        };
        let caught: unknown;

        try {
          ensureDeploymentQuerySyncStorageReady(
            storageWithExec(harness.storage, exec),
            binding,
          );
        } catch (cause) {
          caught = cause;
        }

        expect(attempted.at(-1)).toBe(expectedStep);
        expect(caught).toBe(fault);
        expect(snapshotGeneration2State(harness.database)).toEqual(stateBefore);
        expect(harness.database.prepare(`SELECT count(*) AS value
          FROM sqlite_schema
          WHERE name LIKE '%_generation_2'`).get()?.value).toBe(0);

        const ready = success(ensureDeploymentQuerySyncStorageReady(
          harness.storage,
          binding,
        ));
        expect(ready).toEqual({
          localContractGeneration: 4,
          durableInitializedHistory: true,
        });
        expect(harness.database.prepare(`SELECT
          query_key,
          provisional_generation,
          completion_generation,
          preceding_completion_generation
          FROM deployment_sync_queries`).get()).toEqual({
          query_key: queryBefore.query_key,
          provisional_generation: queryBefore.provisional_generation,
          completion_generation: null,
          preceding_completion_generation: null,
        });

        let postCommitWrites = 0;
        const reentryExec: DeploymentQuerySyncSqlStorage["exec"] = <
          Row extends Record<string, SqlStorageValue>,
        >(
          query: string,
          ...bindings: SQLInputValue[]
        ): SqlStorageCursor<Row> => {
          if (/^(?:alter|create|delete|drop|insert|replace|update)\b/i.test(
            query.trimStart(),
          )) {
            postCommitWrites += 1;
          }
          return harness.storage.sql.exec<Row>(query, ...bindings);
        };
        expect(success(ensureDeploymentQuerySyncStorageReady(
          storageWithExec(harness.storage, reentryExec),
          binding,
        ))).toEqual(ready);
        expect(postCommitWrites).toBe(0);
      } finally {
        harness.database.close();
      }
    },
  );

  it.each(generation4FaultCases)(
    "restores exact generation 3 after a $timing fault at $step",
    ({ index: faultIndex, step: expectedStep, timing }) => {
      const harness = makeSqliteHarness();
      try {
        const binding = makeBinding();
        seedProvisionalOnlyGeneration2(harness.database, binding);
        harness.storage.transactionSync(() => {
          migrateDeploymentQuerySyncGeneration2ToGeneration3(
            harness.storage.sql,
          );
        });
        const stateBefore = Object.freeze({
          ...snapshotGeneration2State(harness.database),
          pendingRows: harness.database.prepare(`SELECT *
            FROM deployment_sync_pending_publications
            ORDER BY query_key COLLATE BINARY`).all(),
        });
        const fault = new Error(
          `generation-4 fault ${timing} write ${faultIndex + 1}`,
        );
        const attempted: MigrationStep[] = [];
        let generation4WriteIndex = 0;
        const exec: DeploymentQuerySyncSqlStorage["exec"] = <
          Row extends Record<string, SqlStorageValue>,
        >(
          query: string,
          ...bindings: SQLInputValue[]
        ): SqlStorageCursor<Row> => {
          const step = migrationStepFor(query);
          if (step === null) {
            return harness.storage.sql.exec<Row>(query, ...bindings);
          }
          const currentIndex = generation4WriteIndex;
          generation4WriteIndex += 1;
          attempted.push(step);
          if (currentIndex === faultIndex && timing === "before") throw fault;
          const cursor = harness.storage.sql.exec<Row>(query, ...bindings);
          if (currentIndex === faultIndex && timing === "after") throw fault;
          return cursor;
        };
        let caught: unknown;

        try {
          ensureDeploymentQuerySyncStorageReady(
            storageWithExec(harness.storage, exec),
            binding,
          );
        } catch (cause) {
          caught = cause;
        }

        expect(attempted.at(-1)).toBe(expectedStep);
        expect(caught).toBe(fault);
        expect(Object.freeze({
          ...snapshotGeneration2State(harness.database),
          pendingRows: harness.database.prepare(`SELECT *
            FROM deployment_sync_pending_publications
            ORDER BY query_key COLLATE BINARY`).all(),
        })).toEqual(stateBefore);
        expect(harness.database.prepare(`SELECT local_contract_generation
          FROM deployment_sync_contract_state`).get()?.local_contract_generation)
          .toBe(3);

        expect(success(ensureDeploymentQuerySyncStorageReady(
          harness.storage,
          binding,
        ))).toEqual({
          localContractGeneration: 4,
          durableInitializedHistory: true,
        });
      } finally {
        harness.database.close();
      }
    },
  );
});
