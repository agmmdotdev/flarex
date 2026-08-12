import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import { createPGlitePersistence } from "../src/pglite";
import {
  injectApplicationReadinessMigrationFailure,
  makeApplicationReadinessMigrationFixture,
  restoreApplicationReadinessMigration,
  writeApplicationReadinessJournalThrough,
} from "./applicationReadinessMigrationSupport";

describe("Application readiness migration - PGlite", () => {
  it("upgrades atomically, preserves prior data, rolls back failure, and replays", async () => {
    const fixture = await makeApplicationReadinessMigrationFixture("pglite");
    try {
      await writeApplicationReadinessJournalThrough(
        fixture.currentJournal,
        fixture.temporaryJournal,
        57,
      );
      const persistence = await createPGlitePersistence({
        migrationsFolder: fixture.migrationsFolder,
      });
      await persistence.migrate();
      await persistence.insertDeploymentMetadata({
        deploymentId: "deployment_before_application_readiness",
        projectId: "project_before_application_readiness",
      });
      expect(await inventory(persistence)).toEqual({
        deployments: 1,
        receipts: 58,
        tables: 0,
      });

      await writeApplicationReadinessJournalThrough(
        fixture.currentJournal,
        fixture.temporaryJournal,
        58,
      );
      await injectApplicationReadinessMigrationFailure(fixture.migrationPath);
      await expect(persistence.migrate()).rejects.toThrow();
      expect(await inventory(persistence)).toEqual({
        deployments: 1,
        receipts: 58,
        tables: 0,
      });

      await restoreApplicationReadinessMigration(
        fixture.migrationPath,
        fixture.currentMigrationsFolder,
      );
      await expect(persistence.migrate()).resolves.toBeUndefined();
      await expect(persistence.migrate()).resolves.toBeUndefined();
      expect(await inventory(persistence)).toEqual({
        deployments: 1,
        receipts: 59,
        tables: 4,
      });
    } finally {
      await fixture.cleanup();
    }
  }, 180_000);

  it("installs all foreign keys inside a non-public active schema", async () => {
    const fixture = await makeApplicationReadinessMigrationFixture(
      "pglite-non-public",
    );
    const db = new PGlite();
    try {
      await db.exec(
        `create schema fx_application_readiness; ` +
          `set search_path to fx_application_readiness`,
      );
      const persistence = await createPGlitePersistence({
        db,
        migrationsFolder: fixture.migrationsFolder,
      });
      await persistence.migrate();
      expect(await inventory(persistence)).toEqual({
        deployments: 0,
        receipts: 59,
        tables: 4,
      });
      const constraints = await persistence.query<{ count: number }>(`
        select count(*)::int as count
          from information_schema.table_constraints
         where constraint_schema = current_schema()
           and constraint_name = any(array[
             'fx_application_schema_authority_v1_deployment_fk',
             'fx_application_revision_schema_v1_revision_fk',
             'fx_application_readiness_v1_publication_fk',
             'fx_application_readiness_v1_schema_fk',
             'fx_application_readiness_v1_task_fk',
             'fx_application_readiness_function_v1_readiness_fk',
             'fx_application_readiness_function_v1_function_fk'
           ])
      `);
      expect(constraints.rows[0]?.count).toBe(7);
    } finally {
      try {
        await db.close();
      } finally {
        await fixture.cleanup();
      }
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
      (select count(*)::int
         from information_schema.tables
        where table_schema = current_schema()
          and table_name in (
            'fx_control_application_schema_authority_v1',
            'fx_system_application_revision_schema_v1',
            'fx_system_application_readiness_v1',
            'fx_system_application_readiness_function_v1'
          )) as tables
  `);
  return result.rows[0];
}
