import { Effect } from "effect";
import { expect, it } from "vitest";
import { createPostgresPersistence } from "../../../src/database/postgres";
import { bootstrapInstallationMigrations } from "../../../src/database/postgresInstallationMaintenance";
import { INDEX_CATALOG_CAPACITY_MIGRATION_SQL } from "../../../src/storage/indexes/indexMaintenanceInstallation";
import { postgresUrl, withTemporaryPostgresSchema } from "../../support/postgresHelpers";
import { orderedCatalogCapacityUpgrade, withOrderedCatalogPredecessor } from "./orderedCatalogCapacityMigrationScenario";

it.skipIf(postgresUrl === null)("upgrades the authentic 152 catalog as an ordinary PostgreSQL role with rollback, grants/data and replay", () =>
  withOrderedCatalogPredecessor(fixture => withTemporaryPostgresSchema(async options => {
    const persistence = await createPostgresPersistence({ ...options, migrationsFolder: fixture.migrationsFolder });
    try {
      expect((await persistence.query("select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=current_user")).rows)
        .toEqual([{ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false }]);
      const namespace = (await persistence.query<{ name: string }>("select current_schema() as name")).rows[0]?.name;
      if (namespace === undefined) throw new Error("Missing actual predecessor namespace");
      await Effect.runPromise(bootstrapInstallationMigrations(persistence.pool.options, namespace,
        { migrationsFolder: fixture.migrationsFolder, migrationsSchema: options.migrationsSchema }));
      const blocker = await persistence.pool.connect();
      try {
        await blocker.query("select pg_advisory_lock(2147483002,(namespace_oid-2147483648)::integer) from fx_system_installation where singleton_id=1");
        const gate = INDEX_CATALOG_CAPACITY_MIGRATION_SQL.split("--> statement-breakpoint")[0];
        if (gate === undefined) throw new Error("Missing genuine capacity migration gate");
        await expect(persistence.query(gate)).rejects.toMatchObject({ code: "55P03" });
      } finally {
        try { await blocker.query("select pg_advisory_unlock(2147483002,(namespace_oid-2147483648)::integer) from fx_system_installation where singleton_id=1"); }
        finally { blocker.release(); }
      }
      await orderedCatalogCapacityUpgrade(persistence, fixture, options.migrationsSchema, () => persistence.migrate());
    } finally { await persistence.close(); }
  })), 240_000);
