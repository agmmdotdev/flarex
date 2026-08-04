import { describe, expect, it } from "vitest";

import { createPostgresPersistence } from "../src/postgres";
import {
  injectApplicationActionMigrationFailureV1,
  makeApplicationActionMigrationFixtureV1,
  restoreApplicationActionMigrationV1,
  writeApplicationActionJournalThroughV1,
} from "./applicationActionAuthorityV1MigrationSupport";
import {
  postgresUrl,
  withTemporaryPostgresSchema,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("AAV-A1 migration - PostgreSQL", () => {
  it("upgrades 0044 atomically in a non-public schema and replays", async () => {
    const fixture = await makeApplicationActionMigrationFixtureV1("postgres");
    try {
      await writeApplicationActionJournalThroughV1(
        fixture.currentJournal,
        fixture.temporaryJournal,
        44,
      );
      await withTemporaryPostgresSchema(async databaseOptions => {
        const previous = await createPostgresPersistence({
          ...databaseOptions,
          migrationsFolder: fixture.migrationsFolder,
        });
        let current: Awaited<ReturnType<typeof createPostgresPersistence>> |
          undefined;
        try {
          await previous.migrate();
          expect(await inventory(previous, databaseOptions.migrationsSchema))
            .toEqual({ tables: 0, receipts: 45 });

          await writeApplicationActionJournalThroughV1(
            fixture.currentJournal,
            fixture.temporaryJournal,
            45,
          );
          await injectApplicationActionMigrationFailureV1(fixture.migrationPath);
          current = await createPostgresPersistence({
            ...databaseOptions,
            migrationsFolder: fixture.migrationsFolder,
          });
          await expect(current.migrate()).rejects.toThrow();
          expect(await inventory(current, databaseOptions.migrationsSchema))
            .toEqual({ tables: 0, receipts: 45 });

          await restoreApplicationActionMigrationV1(
            fixture.migrationPath,
            fixture.currentMigrationsFolder,
          );
          await expect(current.migrate()).resolves.toBeUndefined();
          await expect(current.migrate()).resolves.toBeUndefined();
          expect(await inventory(current, databaseOptions.migrationsSchema))
            .toEqual({ tables: 2, receipts: 46 });
          const schema = await current.query<{ name: string }>(
            "select current_schema() as name",
          );
          expect(schema.rows[0]?.name).not.toBe("public");
        } finally {
          await current?.close();
          await previous.close();
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
  const result = await persistence.query<{ tables: number; receipts: number }>(`
    select
      (select count(*)::int
       from information_schema.tables
       where table_schema = current_schema()
         and table_name in (
           'fx_system_application_action_invocation_v1',
           'fx_system_external_effect_attempt_v1'
         )) as tables,
      (select count(*)::int from ${quotedSchema}.__drizzle_migrations) as receipts
  `);
  return result.rows[0];
}
