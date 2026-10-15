import type { Client } from "pg";
import { deployments } from "../../src/database/schema";
import { createPostgresClientLocatedReadCommittedTransactionRunnerV1 } from "../../src/database/postgresLocatedReadCommitted";
import { LocatedReadCommittedTransactionFailureV1 } from "../../src/execution/readCommittedTransactionFailure";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  sql,
  type FlarexRuntimePersistence,
  type QueryResult,
} from "../../src";
import {
  createPostgresClientPersistence,
  createPostgresClientSharedScopeAuthorityProvisioner,
  type PostgresClientFlarexPersistence,
} from "../../src/database/postgresClient";
import {
  postgresUrl,
  withTemporaryPostgresClientPersistence,
} from "../support/postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("createPostgresClientPersistence boundary", () => {
  it("accepts one Client synchronously and exposes runtime persistence only", () => {
    expectTypeOf<Parameters<typeof createPostgresClientPersistence>>()
      .toEqualTypeOf<[client: Client]>();
    expectTypeOf<ReturnType<typeof createPostgresClientPersistence>>()
      .toEqualTypeOf<PostgresClientFlarexPersistence>();
    expectTypeOf<PostgresClientFlarexPersistence>()
      .toMatchTypeOf<FlarexRuntimePersistence>();

    type ForbiddenLifecycleKey = Extract<
      keyof PostgresClientFlarexPersistence,
      "client" | "close" | "connect" | "drizzle" | "end" | "migrate" | "pool"
    >;
    expectTypeOf<ForbiddenLifecycleKey>().toEqualTypeOf<never>();
  });
});

describePostgres("real Postgres request-scoped Client persistence", () => {
  it("uses one caller-owned connection for repositories and transactions", async () => {
    await withTemporaryPostgresClientPersistence(async (persistence, client) => {
      expect(await persistence.check()).toEqual({ status: "ok" });
      for (const forbidden of [
        "client",
        "close",
        "connect",
        "drizzle",
        "end",
        "migrate",
        "pool",
      ]) {
        expect(forbidden in persistence).toBe(false);
      }

      const executeResult = await persistence.execute<{ value: number }>(
        sql`select ${7}::integer as value`,
      );
      expect(onlyRow(executeResult)).toEqual({ value: 7 });
      await persistence.exec(
        "create temporary table flarex_client_probe (value integer not null)",
      );
      await persistence.query(
        "insert into flarex_client_probe (value) values ($1)",
        [11],
      );
      expect(
        onlyRow(
          await persistence.query<{ value: number }>(
            "select value from flarex_client_probe",
          ),
        ),
      ).toEqual({ value: 11 });

      await persistence.insertDeploymentMetadata({
        deploymentId: "deployment_client_repository",
        projectId: "project_client_repository",
      });
      await expect(
        persistence.getDeploymentMetadata("deployment_client_repository"),
      ).resolves.toMatchObject({
        deploymentId: "deployment_client_repository",
        projectId: "project_client_repository",
      });

      const authority = createPostgresClientSharedScopeAuthorityProvisioner(
        client,
        {
          physicalLocator: {
            kind: "shared_database",
            databaseKey: "primary",
            schemaName: "public",
          },
          randomUuid: uuidSequence(
            "20000000-0000-4000-8000-000000000001",
            "20000000-0000-4000-8000-000000000002",
          ),
        },
      );
      await expect(
        authority.ensure({
          deploymentId: "deployment_client_authority",
          projectId: "project_client_authority",
        }),
      ).resolves.toMatchObject({
        status: "created",
        scope: { deploymentId: "deployment_client_authority" },
        clock: { storageGeneration: "legacy_v1" },
      });

      const outsidePid = onlyRow(
        await persistence.query<{ pid: number }>(
          "select pg_backend_pid()::integer as pid",
        ),
      ).pid;
      const committedPid = await persistence.transaction(async (tx) => {
        const pid = onlyRow(
          await tx.query<{ pid: number }>(
            "select pg_backend_pid()::integer as pid",
          ),
        ).pid;
        await tx.query(
          "insert into deployments (deployment_id, project_id) values ($1, $2)",
          ["deployment_client_committed", "project_client_committed"],
        );
        return pid;
      });
      expect(committedPid).toBe(outsidePid);
      await expect(
        persistence.getDeploymentMetadata("deployment_client_committed"),
      ).resolves.toMatchObject({
        deploymentId: "deployment_client_committed",
      });

      const rollbackMarker = new Error("client transaction rollback marker");
      await expect(
        persistence.transaction(async (tx) => {
          await tx.query(
            "insert into deployments (deployment_id, project_id) values ($1, $2)",
            ["deployment_client_rolled_back", "project_client_rolled_back"],
          );
          throw rollbackMarker;
        }),
      ).rejects.toBe(rollbackMarker);
      await expect(
        persistence.getDeploymentMetadata("deployment_client_rolled_back"),
      ).resolves.toBeNull();

      const quarantine: Error[] = [];
      const run = createPostgresClientLocatedReadCommittedTransactionRunnerV1(client, {
        quarantine: cause => { quarantine.push(cause); },
      });
      const marker = new Error("serialized Client rollback");
      const observed = await observeTransactionDepth(client, async () => {
        let enterFirst: (() => void) | undefined;
        const entered = new Promise<void>(resolve => { enterFirst = resolve; });
        let releaseFirst: (() => void) | undefined;
        const released = new Promise<void>(resolve => { releaseFirst = resolve; });
        const first = run(async tx => {
          await tx.insert(deployments).values({
            deploymentId: "deployment_client_concurrent_rollback", projectId: "project",
          });
          enterFirst?.();
          await released;
          throw marker;
        });
        const firstSettlement = Promise.allSettled([first]);
        let second: Promise<void> | undefined;
        try {
          await Promise.race([entered, first]);
          second = run(async tx => {
            await tx.insert(deployments).values({
              deploymentId: "deployment_client_concurrent_commit", projectId: "project",
            });
          });
          const settlements = Promise.allSettled([first, second]);
          releaseFirst?.();
          return await settlements;
        } finally {
          releaseFirst?.();
          await firstSettlement;
          if (second !== undefined) await Promise.allSettled([second]);
        }
      });
      expect(observed.maximumDepth).toBe(1);
      const [rolledBack, committed] = observed.value;
      expect(rolledBack?.status).toBe("rejected");
      if (rolledBack?.status !== "rejected") throw new Error("Expected rollback");
      expect(rolledBack.reason).toBeInstanceOf(LocatedReadCommittedTransactionFailureV1);
      if (!(rolledBack.reason instanceof LocatedReadCommittedTransactionFailureV1)) throw new Error("Expected transaction failure");
      expect(rolledBack.reason.issue).toEqual({ kind: "callbackRolledBack", callbackCause: marker });
      expect(rolledBack.reason.issue.kind === "callbackRolledBack" && rolledBack.reason.issue.callbackCause).toBe(marker);
      expect(committed?.status).toBe("fulfilled");
      await expect(persistence.getDeploymentMetadata("deployment_client_concurrent_rollback")).resolves.toBeNull();
      await expect(persistence.getDeploymentMetadata("deployment_client_concurrent_commit")).resolves.toMatchObject({
        deploymentId: "deployment_client_concurrent_commit",
      });
      expect(quarantine).toEqual([]);

      const clientPid = onlyRow(
        await client.query<{ pid: number }>(
          "select pg_backend_pid()::integer as pid",
        ),
      ).pid;
      expect(clientPid).toBe(outsidePid);
      await expect(persistence.query("select 1 as ok")).resolves.toMatchObject({
        rows: [{ ok: 1 }],
      });
    });
  });
});

function onlyRow<Row extends Record<string, unknown>>(
  result: QueryResult<Row>,
): Row {
  const row = result.rows[0];
  if (row === undefined || result.rows.length !== 1) {
    throw new Error(`Expected exactly one row, received ${result.rows.length}.`);
  }
  return row;
}

function uuidSequence(...values: readonly string[]): () => string {
  let index = 0;
  return () => {
    const value = values[index];
    if (value === undefined) {
      throw new Error("UUID test sequence was exhausted.");
    }
    index += 1;
    return value;
  };
}

async function observeTransactionDepth<Value>(
  client: import("pg").Client,
  run: () => Promise<Value>,
): Promise<Readonly<{ readonly maximumDepth: number; readonly value: Value }>> {
  const originalQuery = client.query;
  let depth = 0;
  let maximumDepth = 0;
  Object.defineProperty(client, "query", {
    configurable: true,
    value: async function (this: unknown, ...args: readonly unknown[]) {
      expect(this).toBe(client);
      const text = queryText(args[0]);
      if (text === "begin") {
        depth += 1;
        maximumDepth = Math.max(maximumDepth, depth);
      }
      try {
        return await Reflect.apply(originalQuery, client, args);
      } finally {
        if (text === "commit" || text === "rollback") depth -= 1;
      }
    },
  });
  try {
    const value = await run();
    return Object.freeze({ maximumDepth, value });
  } finally {
    Object.defineProperty(client, "query", {
      configurable: true,
      value: originalQuery,
    });
  }
}

function queryText(query: unknown): string {
  if (typeof query === "string") return normalizeSql(query);
  if (typeof query !== "object" || query === null) return "";
  const descriptor = Object.getOwnPropertyDescriptor(query, "text");
  return descriptor !== undefined && "value" in descriptor &&
      typeof descriptor.value === "string"
    ? normalizeSql(descriptor.value)
    : "";
}

function normalizeSql(sql: string): string {
  return sql.trim().replaceAll(/\s+/g, " ").toLowerCase();
}
