import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import { createPGlitePersistence } from "../src/pglite";
import {
  makePhysicalDefinitionRetirementMigrationFixture,
  retirementMigrationInventory,
  retirementMigrationWasRolledBack,
  seedApplicationTaskRunBeforeRetirementMigration,
  writePhysicalDefinitionRetirementJournalThrough,
} from "./physicalDefinitionRetirementMigrationSupport";

describe("M05-B3 physical-definition retirement migration - PGlite", () => {
  it("backfills populated Application tasks, replays, and refuses malformed authority", async () => {
    const fixture = await makePhysicalDefinitionRetirementMigrationFixture(
      "pglite",
    );
    const validDb = new PGlite();
    const invalidDb = new PGlite();
    try {
      await writePhysicalDefinitionRetirementJournalThrough(
        fixture.currentJournal,
        fixture.temporaryJournal,
        67,
      );
      const valid = await createPGlitePersistence({
        db: validDb,
        migrationsFolder: fixture.migrationsFolder,
      });
      await valid.migrate();
      await seedApplicationTaskRunBeforeRetirementMigration(
        valid,
        "apprev_m05_b3",
      );
      await writePhysicalDefinitionRetirementJournalThrough(
        fixture.currentJournal,
        fixture.temporaryJournal,
        68,
      );
      await expect(valid.migrate()).resolves.toBeUndefined();
      await expect(valid.migrate()).resolves.toBeUndefined();
      expect(await retirementMigrationInventory(valid)).toEqual({
        application_revision_id: "apprev_m05_b3",
        column_count: 1,
        foreign_key_count: 1,
        index_count: 4,
        receipts: 69,
      });
      await expect(valid.query(
        `update fx_system_durable_task_run_v1
            set application_revision_id = 'apprev_missing_m05_b3'`,
      )).rejects.toThrow();
      expect((await retirementMigrationInventory(valid)).application_revision_id)
        .toBe("apprev_m05_b3");

      await writePhysicalDefinitionRetirementJournalThrough(
        fixture.currentJournal,
        fixture.temporaryJournal,
        67,
      );
      const invalid = await createPGlitePersistence({
        db: invalidDb,
        migrationsFolder: fixture.migrationsFolder,
      });
      await invalid.migrate();
      await seedApplicationTaskRunBeforeRetirementMigration(invalid, null);
      await writePhysicalDefinitionRetirementJournalThrough(
        fixture.currentJournal,
        fixture.temporaryJournal,
        68,
      );
      await expect(invalid.migrate()).rejects.toThrow();
      expect(await retirementMigrationWasRolledBack(invalid)).toEqual({
        column_count: 0,
        receipts: 68,
        row_count: 1,
      });
    } finally {
      await validDb.close();
      await invalidDb.close();
      await fixture.cleanup();
    }
  }, 480_000);
});
