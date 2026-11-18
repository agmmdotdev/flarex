import { describe, it } from "vitest";
import { createPGlitePersistence } from "../../src/database/pglite";
import { newTestPGlite } from "../support/pgliteSearchExtensions";
import { assertMigration117Cutover, withMigration117Folder } from "./migration117CutoverScenario";

describe("mixed attempt journal migration 0117 on PGlite", () => {
  it("refuses open and sealed legacy evidence, then preserves committed results during the empty cutover", async () => {
    await withMigration117Folder(async (folder, restoreCurrentJournal) => {
      const db = newTestPGlite();
      try {
        const previous = await createPGlitePersistence({ db, migrationsFolder: folder });
        await previous.migrate();
        await restoreCurrentJournal();
        const current = await createPGlitePersistence({ db, migrationsFolder: folder });
        await assertMigration117Cutover(previous, current, "drizzle");
      } finally {
        await db.close();
      }
    });
  }, 120_000);
});
