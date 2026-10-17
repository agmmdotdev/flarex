import { describe, it } from "vitest";
import { createPGlitePersistence } from "../../src/database/pglite";
import { newTestPGlite } from "../support/pgliteSearchExtensions";
import { migrate } from "drizzle-orm/pglite/migrator";
import { assertMigration149InsertionOrder, withMigration149Folder } from "./migration149InsertionOrderScenario";

describe("insertion-generation migration 0149 on PGlite", () => {
  it("preserves populated history and extends the real row publisher without backfill", async () => {
    await withMigration149Folder(async (folder, enableCurrent) => {
      const db = newTestPGlite();
      try {
        const previous = await createPGlitePersistence({ db, migrationsFolder: folder });
        // Exact predecessor bootstrap does not issue current serving capabilities.
        await migrate(previous.drizzle, { migrationsFolder: folder });
        await previous.query("update fx_system_installation set state='active' where singleton_id=1");
        await enableCurrent();
        const current = await createPGlitePersistence({ db, migrationsFolder: folder });
        await assertMigration149InsertionOrder(previous, current);
      } finally { await db.close(); }
    });
  }, 120_000);
});
