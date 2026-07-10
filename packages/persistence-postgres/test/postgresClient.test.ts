import type { Client } from "pg";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  sql,
  type FlarexRuntimePersistence,
  type QueryResult,
} from "../src";
import {
  createPostgresClientPersistence,
  createPostgresClientSharedScopeAuthorityProvisioner,
  type PostgresClientFlarexPersistence,
} from "../src/postgresClient";
import {
  postgresUrl,
  withTemporaryPostgresClientPersistence,
} from "./postgresHelpers";

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
