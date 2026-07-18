import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import { describe, expect, it } from "vitest";

import type { EnsureStableTableIdentityInput } from "../src";
import type { PostgresFlarexPersistence } from "../src/postgres";
import {
  ensureStableTableIdentityInTransaction,
  getStableTableIdentityByIdEffect,
  getStableTableIdentityByNameEffect,
} from "../src/stableTableCatalog";
import { runEffect } from "./effectTestRuntime";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("real Postgres stable table catalog", () => {
  it("reads stable table identities by deployment-qualified ID", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const deploymentId = "deployment_catalog_id_read";
      await persistence.insertDeploymentMetadata({
        deploymentId,
        projectId: "project_catalog_id_read",
      });
      const created = await ensure(persistence, {
        deploymentId,
        namespace: "app",
        logicalName: "users",
      });

      await expect(runEffect(getStableTableIdentityByIdEffect(
        persistence.drizzle,
        deploymentId,
        created.table.tableId,
      ))).resolves.toEqual(created.table);
      await expect(runEffect(getStableTableIdentityByIdEffect(
        persistence.drizzle,
        deploymentId,
        CatalogTableIdSchema.make(2),
      ))).resolves.toBeNull();
      await expect(runEffect(getStableTableIdentityByNameEffect(
        persistence.drizzle,
        {
          deploymentId,
          namespace: "app",
          logicalName: "users",
        },
      ))).resolves.toEqual(created.table);
      await expect(runEffect(getStableTableIdentityByNameEffect(
        persistence.drizzle,
        {
          deploymentId,
          namespace: "app",
          logicalName: "missing",
        },
      ))).resolves.toBeNull();
    });
  }, 30_000);

  it("serializes concurrent replays on the owning deployment", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await persistence.insertDeploymentMetadata({
        deploymentId: "deployment_catalog_concurrent",
        projectId: "project_catalog_concurrent",
      });
      const input = {
        deploymentId: "deployment_catalog_concurrent",
        namespace: "app",
        logicalName: "users",
      } as const satisfies EnsureStableTableIdentityInput;

      const results = await Promise.all(
        Array.from({ length: 8 }, () => ensure(persistence, input)),
      );

      expect(results.filter((result) => result.status === "created")).toHaveLength(1);
      expect(results.filter((result) => result.status === "existing")).toHaveLength(7);
      expect(new Set(results.map((result) => result.table.tableId))).toEqual(
        new Set([1]),
      );
      expect(new Set(results.map((result) => result.table.createdAt.getTime())).size)
        .toBe(1);
      const rows = await persistence.query<{ count: string }>(
        `select count(*)::text as count from fx_control_table`,
      );
      expect(rows.rows).toEqual([{ count: "1" }]);
    });
  }, 30_000);

  it("serializes concurrent distinct-name ID allocation", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const deploymentId = "deployment_catalog_distinct_names";
      await persistence.insertDeploymentMetadata({
        deploymentId,
        projectId: "project_catalog_distinct_names",
      });
      await persistence.query(`
        create function fx_catalog_insert_delay() returns trigger
        language plpgsql
        as $$
        begin
          perform pg_sleep(0.05);
          return new;
        end
        $$
      `);
      await persistence.query(`
        create trigger fx_catalog_insert_delay
        before insert on fx_control_table
        for each row execute function fx_catalog_insert_delay()
      `);
      const inputs = Array.from(
        { length: 8 },
        (_, index) =>
          ({
            deploymentId,
            namespace: "app",
            logicalName: `table_${index}`,
          }) satisfies EnsureStableTableIdentityInput,
      );

      const results = await Promise.all(
        inputs.map((input) => ensure(persistence, input)),
      );

      expect(results.every((result) => result.status === "created")).toBe(true);
      expect(
        results.map((result) => result.table.tableId).sort((a, b) => a - b),
      ).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      const rows = await persistence.query<{ count: string }>(
        `select count(*)::text as count from fx_control_table`,
      );
      expect(rows.rows).toEqual([{ count: "8" }]);
    });
  }, 30_000);
});

function ensure(
  persistence: PostgresFlarexPersistence,
  input: EnsureStableTableIdentityInput,
) {
  return persistence.drizzle.transaction((tx) =>
    ensureStableTableIdentityInTransaction(tx, input),
  );
}
