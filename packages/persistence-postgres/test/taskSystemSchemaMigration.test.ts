import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { createPGlitePersistence } from "../src/pglite";
import {
  assertTaskSystemSchemaContractV1,
  injectTaskSystemSchemaMigrationFailureV1,
  makeTaskSystemSchemaMigrationFixtureV1,
  restoreTaskSystemSchemaMigrationV1,
  seedTaskSystemSchemaContractParentForPGliteV1,
  writeTaskSystemSchemaJournalThroughV1,
} from "./taskSystemSchemaMigrationSupport";

describe("DTE04-A3 Task System migration - PGlite", () => {
  it("upgrades 0045 atomically, refuses partial installation, and replays", async () => {
    const fixture = await makeTaskSystemSchemaMigrationFixtureV1("pglite");
    const db = new PGlite();
    try {
      expect(await readFile(fixture.migrationPath, "utf8"))
        .not.toContain('REFERENCES "public".');
      await writeTaskSystemSchemaJournalThroughV1(
        fixture.currentJournal,
        fixture.temporaryJournal,
        45,
      );
      const previous = await createPGlitePersistence({
        db,
        migrationsFolder: fixture.migrationsFolder,
      });
      await previous.migrate();
      expect(await inventory(previous)).toMatchObject({
        tables: 0,
        receipts: 46,
      });

      await writeTaskSystemSchemaJournalThroughV1(
        fixture.currentJournal,
        fixture.temporaryJournal,
        46,
      );
      await injectTaskSystemSchemaMigrationFailureV1(fixture.migrationPath);
      const failing = await createPGlitePersistence({
        db,
        migrationsFolder: fixture.migrationsFolder,
      });
      await expect(failing.migrate()).rejects.toThrow();
      expect(await inventory(failing)).toMatchObject({
        tables: 0,
        receipts: 46,
      });

      await restoreTaskSystemSchemaMigrationV1(
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
        tables: 5,
        checks: 15,
        foreignKeys: 6,
        indexes: 2,
        primaryKeys: 5,
        receipts: 47,
        uniques: 5,
      });
      const parent =
        await seedTaskSystemSchemaContractParentForPGliteV1(current);
      await assertTaskSystemSchemaContractV1(current, parent);
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
    tables: string;
    checks: string;
    foreign_keys: string;
    indexes: string;
    primary_keys: string;
    receipts: string;
    uniques: string;
  }>(`
    select
      (select count(*)::text
       from information_schema.tables
       where table_schema = current_schema()
         and table_name like 'fx_system_durable_task_%_v1') as tables,
      (select count(*)::text
       from pg_constraint
       where contype = 'c'
         and conname like 'fx_task_%') as checks,
      (select count(*)::text
       from pg_constraint
       where contype = 'f'
         and conname like 'fx_task_%') as foreign_keys,
      (select count(*)::text
       from pg_indexes
       where schemaname = current_schema()
         and indexname in (
           'fx_task_run_v1_due_discovery_idx',
           'fx_task_requested_effect_v1_kind_idx'
         )) as indexes,
      (select count(*)::text
       from pg_constraint
       where contype = 'p'
         and conname like 'fx_task_%') as primary_keys,
      (select count(*)::text
       from pg_constraint
       where contype = 'u'
         and conname like 'fx_task_%') as uniques,
      (select count(*)::text from drizzle.__drizzle_migrations) as receipts
  `);
  const row = result.rows[0];
  return {
    tables: Number(row?.tables ?? "-1"),
    checks: Number(row?.checks ?? "-1"),
    foreignKeys: Number(row?.foreign_keys ?? "-1"),
    indexes: Number(row?.indexes ?? "-1"),
    primaryKeys: Number(row?.primary_keys ?? "-1"),
    receipts: Number(row?.receipts ?? "-1"),
    uniques: Number(row?.uniques ?? "-1"),
  };
}
