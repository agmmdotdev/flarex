import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import { createPGlitePersistence } from "../src/pglite";
import {
  injectApplicationActionMigrationFailureV1,
  makeApplicationActionMigrationFixtureV1,
  restoreApplicationActionMigrationV1,
  writeApplicationActionJournalThroughV1,
} from "./applicationActionAuthorityV1MigrationSupport";

describe("AAV-A1 migration - PGlite", () => {
  it("upgrades 0044 atomically, refuses partial installation, and replays", async () => {
    const fixture = await makeApplicationActionMigrationFixtureV1("pglite");
    const db = new PGlite();
    try {
      await writeApplicationActionJournalThroughV1(
        fixture.currentJournal,
        fixture.temporaryJournal,
        44,
      );
      const previous = await createPGlitePersistence({
        db,
        migrationsFolder: fixture.migrationsFolder,
      });
      await previous.migrate();
      expect(await inventory(previous)).toEqual({ tables: 0, receipts: 45 });

      await writeApplicationActionJournalThroughV1(
        fixture.currentJournal,
        fixture.temporaryJournal,
        45,
      );
      await injectApplicationActionMigrationFailureV1(fixture.migrationPath);
      const failing = await createPGlitePersistence({
        db,
        migrationsFolder: fixture.migrationsFolder,
      });
      await expect(failing.migrate()).rejects.toThrow();
      expect(await inventory(failing)).toEqual({ tables: 0, receipts: 45 });

      await restoreApplicationActionMigrationV1(
        fixture.migrationPath,
        fixture.currentMigrationsFolder,
      );
      const current = await createPGlitePersistence({
        db,
        migrationsFolder: fixture.migrationsFolder,
      });
      await expect(current.migrate()).resolves.toBeUndefined();
      await expect(current.migrate()).resolves.toBeUndefined();
      expect(await inventory(current)).toEqual({ tables: 2, receipts: 46 });
    } finally {
      await db.close();
      await fixture.cleanup();
    }
  }, 480_000);
});

async function inventory(persistence: Awaited<ReturnType<typeof createPGlitePersistence>>) {
  const result = await persistence.query<{ tables: string; receipts: string }>(`
    select
      (select count(*)::text
       from information_schema.tables
       where table_schema = current_schema()
         and table_name in (
           'fx_system_application_action_invocation_v1',
           'fx_system_external_effect_attempt_v1'
         )) as tables,
      (select count(*)::text from drizzle.__drizzle_migrations) as receipts
  `);
  return {
    tables: Number(result.rows[0]?.tables ?? "-1"),
    receipts: Number(result.rows[0]?.receipts ?? "-1"),
  };
}
