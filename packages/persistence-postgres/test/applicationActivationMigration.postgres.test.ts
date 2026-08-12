import { describe, expect, it } from "vitest";

import { createPostgresPersistence } from "../src/postgres";
import {
  injectApplicationActivationMigrationFailure,
  makeApplicationActivationMigrationFixture,
  restoreApplicationActivationMigration,
  writeApplicationActivationJournalThrough,
} from "./applicationActivationMigrationSupport";
import { postgresUrl, withTemporaryPostgresSchema } from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("Application activation migration - PostgreSQL", () => {
  it("upgrades atomically in a non-public schema and replays", async () => {
    const fixture = await makeApplicationActivationMigrationFixture("postgres");
    try {
      await writeApplicationActivationJournalThrough(
        fixture.currentJournal,
        fixture.temporaryJournal,
        58,
      );
      await withTemporaryPostgresSchema(async databaseOptions => {
        const persistence = await createPostgresPersistence({
          ...databaseOptions,
          migrationsFolder: fixture.migrationsFolder,
        });
        try {
          await persistence.migrate();
          await persistence.insertDeploymentMetadata({
            deploymentId: "deployment_aa_r7_migration",
            projectId: "project_aa_r7_migration",
          });
          expect(await inventory(persistence, databaseOptions.migrationsSchema))
            .toEqual({ deployments: 1, receipts: 59, tables: 0 });
          await writeApplicationActivationJournalThrough(
            fixture.currentJournal,
            fixture.temporaryJournal,
            59,
          );
          await injectApplicationActivationMigrationFailure(fixture.migrationPath);
          await expect(persistence.migrate()).rejects.toThrow();
          expect(await inventory(persistence, databaseOptions.migrationsSchema))
            .toEqual({ deployments: 1, receipts: 59, tables: 0 });
          await restoreApplicationActivationMigration(
            fixture.migrationPath,
            fixture.currentMigrationsFolder,
          );
          await expect(persistence.migrate()).resolves.toBeUndefined();
          await expect(persistence.migrate()).resolves.toBeUndefined();
          expect(await inventory(persistence, databaseOptions.migrationsSchema))
            .toEqual({ deployments: 1, receipts: 60, tables: 2 });
        } finally {
          await persistence.close();
        }
      });
    } finally {
      await fixture.cleanup();
    }
  }, 480_000);
});

async function inventory(
  persistence: Awaited<ReturnType<typeof createPostgresPersistence>>,
  migrationsSchema: string,
) {
  const quotedSchema = `"${migrationsSchema.replaceAll('"', '""')}"`;
  const result = await persistence.query<{
    deployments: number;
    receipts: number;
    tables: number;
  }>(`
    select
      (select count(*)::int from deployments) as deployments,
      (select count(*)::int from ${quotedSchema}.__drizzle_migrations) as receipts,
      (select count(*)::int from information_schema.tables
        where table_schema = current_schema()
          and table_name in (
            'fx_system_application_activation_v1',
            'fx_system_application_active_head_v1'
          )) as tables
  `);
  return result.rows[0];
}
