import { describe, expect, it } from "vitest";

import { createPostgresPersistence } from "../src/postgres";
import {
  injectIndexedRangeJournalMigrationFailureV1,
  makeIndexedRangeJournalMigrationFixtureV1,
  restoreIndexedRangeJournalMigrationV1,
  writeIndexedRangeJournalThroughV1,
} from "./indexedRangeJournalMigrationSupport";
import { postgresUrl, withTemporaryPostgresSchema } from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("O10-A indexed-range journal migration - PostgreSQL", () => {
  it("upgrades 0050 atomically in a non-public schema and replays", async () => {
    const fixture = await makeIndexedRangeJournalMigrationFixtureV1("postgres");
    try {
      await writeIndexedRangeJournalThroughV1(
        fixture.currentJournal,
        fixture.temporaryJournal,
        50,
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
            .toEqual({ columns: 0, constraints: 0, receipts: 51, tables: 0 });

          await writeIndexedRangeJournalThroughV1(
            fixture.currentJournal,
            fixture.temporaryJournal,
            51,
          );
          await injectIndexedRangeJournalMigrationFailureV1(
            fixture.migrationPath,
          );
          current = await createPostgresPersistence({
            ...databaseOptions,
            migrationsFolder: fixture.migrationsFolder,
          });
          await expect(current.migrate()).rejects.toThrow();
          expect(await inventory(current, databaseOptions.migrationsSchema))
            .toEqual({ columns: 0, constraints: 0, receipts: 51, tables: 0 });

          await restoreIndexedRangeJournalMigrationV1(
            fixture.migrationPath,
            fixture.currentMigrationsFolder,
          );
          await expect(current.migrate()).resolves.toBeUndefined();
          await expect(current.migrate()).resolves.toBeUndefined();
          expect(await inventory(current, databaseOptions.migrationsSchema))
            .toEqual({ columns: 3, constraints: 6, receipts: 52, tables: 1 });
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
    columns: number;
    constraints: number;
    receipts: number;
    tables: number;
  }>(`
    select
      (select count(*)::int
         from information_schema.tables
        where table_schema = current_schema()
          and table_name = 'fx_system_tx_journal_index_range') as tables,
      (select count(*)::int
         from information_schema.columns
        where table_schema = current_schema()
          and table_name = 'fx_system_tx_journal'
          and column_name in (
            'indexed_query_syscalls',
            'index_range_dependency_count',
            'index_range_dependency_evidence_bytes'
          )) as columns,
      (select count(*)::int
         from pg_constraint
        where conrelid = to_regclass(
          current_schema() || '.fx_system_tx_journal_index_range'
        )
          and conname in (
            'fx_system_tx_journal_index_range_pk',
            'fx_system_tx_journal_index_range_identity_check',
            'fx_system_tx_journal_index_range_lower_check',
            'fx_system_tx_journal_index_range_upper_check',
            'fx_system_tx_journal_index_range_timestamp_check',
            'fx_system_tx_journal_index_range_root_fk'
          )) as constraints,
      (select count(*)::int from ${quotedSchema}.__drizzle_migrations) as receipts
  `);
  return result.rows[0];
}
