import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import { createPGlitePersistence } from "../src/pglite";
import {
  injectIndexRangeOccMigrationFailureV1,
  makeIndexRangeOccMigrationFixtureV1,
  restoreIndexRangeOccMigrationV1,
  writeIndexRangeOccJournalThroughV1,
} from "./indexRangeOccMigrationSupport";

describe("O10-B index-range OCC migration - PGlite", () => {
  it("upgrades 0051 atomically, rejects partial installation, and replays", async () => {
    const fixture = await makeIndexRangeOccMigrationFixtureV1("pglite");
    const db = new PGlite();
    try {
      await writeIndexRangeOccJournalThroughV1(
        fixture.currentJournal,
        fixture.temporaryJournal,
        51,
      );
      const previous = await createPGlitePersistence({
        db,
        migrationsFolder: fixture.migrationsFolder,
      });
      await previous.migrate();
      expect(await inventory(previous)).toEqual({ indexes: 0, receipts: 52 });

      await writeIndexRangeOccJournalThroughV1(
        fixture.currentJournal,
        fixture.temporaryJournal,
        52,
      );
      await injectIndexRangeOccMigrationFailureV1(fixture.migrationPath);
      const failing = await createPGlitePersistence({
        db,
        migrationsFolder: fixture.migrationsFolder,
      });
      await expect(failing.migrate()).rejects.toThrow();
      expect(await inventory(failing)).toEqual({ indexes: 0, receipts: 52 });

      await restoreIndexRangeOccMigrationV1(
        fixture.migrationPath,
        fixture.currentMigrationsFolder,
      );
      const current = await createPGlitePersistence({
        db,
        migrationsFolder: fixture.migrationsFolder,
      });
      await expect(current.migrate()).resolves.toBeUndefined();
      await expect(current.migrate()).resolves.toBeUndefined();
      expect(await inventory(current)).toEqual({ indexes: 1, receipts: 53 });
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
    indexes: string;
    receipts: string;
  }>(`
    select
      (select count(*)::text
         from pg_indexes
        where schemaname = current_schema()
          and tablename = 'fx_app_index_entry_rev'
          and indexname = 'fx_app_index_entry_rev_commit_range_idx') as indexes,
      (select count(*)::text from drizzle.__drizzle_migrations) as receipts
  `);
  const row = result.rows[0];
  return {
    indexes: Number(row?.indexes ?? "-1"),
    receipts: Number(row?.receipts ?? "-1"),
  };
}
