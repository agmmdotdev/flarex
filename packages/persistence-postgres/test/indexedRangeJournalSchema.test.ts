import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import { createPGlitePersistence } from "../src/pglite";
import {
  injectIndexedRangeJournalMigrationFailureV1,
  makeIndexedRangeJournalMigrationFixtureV1,
  restoreIndexedRangeJournalMigrationV1,
  writeIndexedRangeJournalThroughV1,
} from "./indexedRangeJournalMigrationSupport";

describe("O10-A indexed-range journal migration - PGlite", () => {
  it("upgrades 0050 atomically, rejects partial installation, and replays", async () => {
    const fixture = await makeIndexedRangeJournalMigrationFixtureV1("pglite");
    const db = new PGlite();
    try {
      await writeIndexedRangeJournalThroughV1(
        fixture.currentJournal,
        fixture.temporaryJournal,
        50,
      );
      const previous = await createPGlitePersistence({
        db,
        migrationsFolder: fixture.migrationsFolder,
      });
      await previous.migrate();
      expect(await inventory(previous)).toEqual({
        columns: 0,
        constraints: 0,
        receipts: 51,
        tables: 0,
      });

      await writeIndexedRangeJournalThroughV1(
        fixture.currentJournal,
        fixture.temporaryJournal,
        51,
      );
      await injectIndexedRangeJournalMigrationFailureV1(fixture.migrationPath);
      const failing = await createPGlitePersistence({
        db,
        migrationsFolder: fixture.migrationsFolder,
      });
      await expect(failing.migrate()).rejects.toThrow();
      expect(await inventory(failing)).toEqual({
        columns: 0,
        constraints: 0,
        receipts: 51,
        tables: 0,
      });

      await restoreIndexedRangeJournalMigrationV1(
        fixture.migrationPath,
        fixture.currentMigrationsFolder,
      );
      const current = await createPGlitePersistence({
        db,
        migrationsFolder: fixture.migrationsFolder,
      });
      await expect(current.migrate()).resolves.toBeUndefined();
      await expect(current.migrate()).resolves.toBeUndefined();
      expect(await inventory(current)).toEqual({
        columns: 3,
        constraints: 6,
        receipts: 52,
        tables: 1,
      });
      const defaults = await current.query<{
        column_default: string | null;
        column_name: string;
        is_nullable: string;
      }>(`
        select column_name, column_default, is_nullable
          from information_schema.columns
         where table_schema = current_schema()
           and table_name = 'fx_system_tx_journal'
           and column_name in (
             'indexed_query_syscalls',
             'index_range_dependency_count',
             'index_range_dependency_evidence_bytes'
           )
         order by column_name
      `);
      expect(defaults.rows).toEqual([
        {
          column_default: "0",
          column_name: "index_range_dependency_count",
          is_nullable: "NO",
        },
        {
          column_default: "0",
          column_name: "index_range_dependency_evidence_bytes",
          is_nullable: "NO",
        },
        {
          column_default: "0",
          column_name: "indexed_query_syscalls",
          is_nullable: "NO",
        },
      ]);
    } finally {
      await db.close();
      await fixture.cleanup();
    }
  }, 480_000);
});

async function inventory(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
) {
  const result = await persistence.query<{
    columns: string;
    constraints: string;
    receipts: string;
    tables: string;
  }>(`
    select
      (select count(*)::text
         from information_schema.tables
        where table_schema = current_schema()
          and table_name = 'fx_system_tx_journal_index_range') as tables,
      (select count(*)::text
         from information_schema.columns
        where table_schema = current_schema()
          and table_name = 'fx_system_tx_journal'
          and column_name in (
            'indexed_query_syscalls',
            'index_range_dependency_count',
            'index_range_dependency_evidence_bytes'
          )) as columns,
      (select count(*)::text
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
      (select count(*)::text from drizzle.__drizzle_migrations) as receipts
  `);
  const row = result.rows[0];
  return {
    columns: Number(row?.columns ?? "-1"),
    constraints: Number(row?.constraints ?? "-1"),
    receipts: Number(row?.receipts ?? "-1"),
    tables: Number(row?.tables ?? "-1"),
  };
}
