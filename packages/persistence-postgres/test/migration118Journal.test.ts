import { describe, it } from "vitest";
import { createPGlitePersistence } from "../src/pglite";
import { newTestPGlite } from "./pgliteSearchExtensions";
import { assertMigration118JournalCutover, withMigration118Folder } from "./migration118JournalScenario";

describe("admitted operation journal migration 0118 on PGlite", () => {
  it("refuses old sessions transactionally and installs exact new format checks after disposition", async () => {
    await withMigration118Folder(async (folder, enableCurrent) => {
      const db = newTestPGlite();
      try {
        const previous = await createPGlitePersistence({ db, migrationsFolder: folder });
        await previous.migrate();
        await enableCurrent();
        const current = await createPGlitePersistence({ db, migrationsFolder: folder });
        await assertMigration118JournalCutover(previous, current, "drizzle");
      } finally {
        await db.close();
      }
    });
  }, 120_000);
});
