import { describe, expect, it } from "vitest";

import { createPostgresPersistence } from "../src/postgres";
import {
  injectApplicationReadinessMigrationFailure,
  makeApplicationReadinessMigrationFixture,
  restoreApplicationReadinessMigration,
  writeApplicationReadinessJournalThrough,
} from "./applicationReadinessMigrationSupport";
import { postgresUrl, withTemporaryPostgresSchema } from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("AA-R6 Application readiness migration - PostgreSQL", () => {
  it("upgrades atomically in a non-public schema and replays", async () => {
    const fixture = await makeApplicationReadinessMigrationFixture("postgres");
    try {
      await writeApplicationReadinessJournalThrough(
        fixture.currentJournal,
        fixture.temporaryJournal,
        57,
      );
      await withTemporaryPostgresSchema(async databaseOptions => {
        const persistence = await createPostgresPersistence({
          ...databaseOptions,
          migrationsFolder: fixture.migrationsFolder,
        });
        try {
          await persistence.migrate();
          await persistence.insertDeploymentMetadata({
            deploymentId: "deployment_aa_r6_migration",
            projectId: "project_aa_r6_migration",
          });
          expect(await inventory(persistence, databaseOptions.migrationsSchema))
            .toEqual({ deployments: 1, receipts: 58, tables: 0 });

          await writeApplicationReadinessJournalThrough(
            fixture.currentJournal,
            fixture.temporaryJournal,
            58,
          );
          await injectApplicationReadinessMigrationFailure(fixture.migrationPath);
          await expect(persistence.migrate()).rejects.toThrow();
          expect(await inventory(persistence, databaseOptions.migrationsSchema))
            .toEqual({ deployments: 1, receipts: 58, tables: 0 });

          await restoreApplicationReadinessMigration(
            fixture.migrationPath,
            fixture.currentMigrationsFolder,
          );
          await expect(persistence.migrate()).resolves.toBeUndefined();
          await expect(persistence.migrate()).resolves.toBeUndefined();
          expect(await inventory(persistence, databaseOptions.migrationsSchema))
            .toEqual({ deployments: 1, receipts: 59, tables: 4 });
          const schema = await persistence.query<{ name: string }>(
            "select current_schema() as name",
          );
          expect(schema.rows[0]?.name).not.toBe("public");
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
