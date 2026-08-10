import { describe, expect, it } from "vitest";

import { createPostgresPersistence } from "../src/postgres";
import {
  injectIndexRangeOccMigrationFailureV1,
  makeIndexRangeOccMigrationFixtureV1,
  restoreIndexRangeOccMigrationV1,
  writeIndexRangeOccJournalThroughV1,
} from "./indexRangeOccMigrationSupport";
import { postgresUrl, withTemporaryPostgresSchema } from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("O10-B index-range OCC migration - PostgreSQL", () => {
  it("upgrades 0051 atomically in a non-public schema and replays", async () => {
    const fixture = await makeIndexRangeOccMigrationFixtureV1("postgres");
    try {
      await writeIndexRangeOccJournalThroughV1(
        fixture.currentJournal,
        fixture.temporaryJournal,
        51,
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
            .toEqual({ indexes: 0, receipts: 52 });

          await writeIndexRangeOccJournalThroughV1(
            fixture.currentJournal,
            fixture.temporaryJournal,
            52,
          );
          await injectIndexRangeOccMigrationFailureV1(fixture.migrationPath);
          current = await createPostgresPersistence({
            ...databaseOptions,
            migrationsFolder: fixture.migrationsFolder,
          });
          await expect(current.migrate()).rejects.toThrow();
          expect(await inventory(current, databaseOptions.migrationsSchema))
            .toEqual({ indexes: 0, receipts: 52 });

          await restoreIndexRangeOccMigrationV1(
            fixture.migrationPath,
            fixture.currentMigrationsFolder,
          );
          await expect(current.migrate()).resolves.toBeUndefined();
          await expect(current.migrate()).resolves.toBeUndefined();
          expect(await inventory(current, databaseOptions.migrationsSchema))
            .toEqual({ indexes: 1, receipts: 53 });
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
  const result = await persistence.query<{
    indexes: number;
    receipts: number;
  }>(`
    select
      (select count(*)::int
         from pg_indexes
        where schemaname = current_schema()
          and tablename = 'fx_app_index_entry_rev'
          and indexname = 'fx_app_index_entry_rev_commit_range_idx') as indexes,
      (select count(*)::int from ${quotedSchema}.__drizzle_migrations) as receipts
  `);
  return result.rows[0];
}
