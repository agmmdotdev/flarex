import type { SQLInputValue } from "node:sqlite";

import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  ensureDeploymentQuerySyncStorageReady,
  type DeploymentQuerySyncSqlStorage,
  type DeploymentQuerySyncStorage,
} from "../src/deploymentSync/StorageContract";
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
] as const);

type MigrationStep = (typeof migrationSteps)[number];

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
  if (
    sql.startsWith("alter table main.deployment_sync_contract_state rename to")
  ) {
    return "rename generation-2 contract table";
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
  if (sql.startsWith("create table deployment_sync_contract_state")) {
    return "create generation-3 contract table";
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
  if (sql.startsWith("insert into main.deployment_sync_contract_state")) {
    return "copy contract row";
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

describe("generation-2 to generation-3 migration fault proof", () => {
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
      let migrationWriteSeen = false;
      const exec: DeploymentQuerySyncSqlStorage["exec"] = <
        Row extends Record<string, SqlStorageValue>,
      >(
        query: string,
        ...bindings: SQLInputValue[]
      ): SqlStorageCursor<Row> => {
        if (migrationStepFor(query) !== null) migrationWriteSeen = true;
        if (migrationWriteSeen && query === "PRAGMA table_list") {
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
        localContractGeneration: 3,
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
          localContractGeneration: 3,
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
});
