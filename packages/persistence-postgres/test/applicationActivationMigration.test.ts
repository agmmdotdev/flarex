import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import { createPGlitePersistence } from "../src/pglite";
import {
  injectApplicationActivationMigrationFailure,
  makeApplicationActivationMigrationFixture,
  restoreApplicationActivationMigration,
  writeApplicationActivationJournalThrough,
} from "./applicationActivationMigrationSupport";

describe("Application activation migration - PGlite", () => {
  it("upgrades atomically, preserves prior data, rolls back failure, and replays", async () => {
    const fixture = await makeApplicationActivationMigrationFixture("pglite");
    try {
      await writeApplicationActivationJournalThrough(
        fixture.currentJournal,
        fixture.temporaryJournal,
        58,
      );
      const persistence = await createPGlitePersistence({
        migrationsFolder: fixture.migrationsFolder,
      });
      await persistence.migrate();
      await persistence.insertDeploymentMetadata({
        deploymentId: "deployment_before_application_activation",
        projectId: "project_before_application_activation",
      });
      expect(await inventory(persistence)).toEqual({
        deployments: 1,
        receipts: 59,
        tables: 0,
      });
      await writeApplicationActivationJournalThrough(
        fixture.currentJournal,
        fixture.temporaryJournal,
        59,
      );
      await injectApplicationActivationMigrationFailure(fixture.migrationPath);
      await expect(persistence.migrate()).rejects.toThrow();
      expect(await inventory(persistence)).toEqual({
        deployments: 1,
        receipts: 59,
        tables: 0,
      });
      await restoreApplicationActivationMigration(
        fixture.migrationPath,
        fixture.currentMigrationsFolder,
      );
      await expect(persistence.migrate()).resolves.toBeUndefined();
      await expect(persistence.migrate()).resolves.toBeUndefined();
      expect(await inventory(persistence)).toEqual({
        deployments: 1,
        receipts: 60,
        tables: 2,
      });
    } finally {
      await fixture.cleanup();
    }
  }, 180_000);

  it("installs both foreign keys in a non-public active schema", async () => {
    const fixture = await makeApplicationActivationMigrationFixture("schema");
    const db = new PGlite();
    try {
      await db.exec("create schema fx_application_activation; set search_path to fx_application_activation");
      const persistence = await createPGlitePersistence({
        db,
        migrationsFolder: fixture.migrationsFolder,
      });
      await persistence.migrate();
      const result = await persistence.query<{ count: number }>(`
        select count(*)::int as count
          from information_schema.table_constraints
         where constraint_schema = current_schema()
           and constraint_name = any(array[
             'fx_application_activation_v1_readiness_fk',
             'fx_application_active_head_v1_activation_fk'
           ])
      `);
      expect(result.rows[0]?.count).toBe(2);
    } finally {
      try { await db.close(); } finally { await fixture.cleanup(); }
    }
  }, 180_000);
});

async function inventory(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
) {
  const result = await persistence.query<{
    deployments: number;
    receipts: number;
    tables: number;
  }>(`
    select
      (select count(*)::int from deployments) as deployments,
      (select count(*)::int from drizzle.__drizzle_migrations) as receipts,
      (select count(*)::int from information_schema.tables
        where table_schema = current_schema()
          and table_name in (
            'fx_system_application_activation_v1',
            'fx_system_application_active_head_v1'
          )) as tables
  `);
  return result.rows[0];
}
