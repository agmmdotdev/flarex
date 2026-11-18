import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, it } from "vitest";
import { createPGlitePersistence } from "../../src/database/pglite";
import { newTestPGlite } from "../support/pgliteSearchExtensions";
import { assertMigration154SnapshotIndexCuts, withMigration154Folder } from "./migration154SnapshotIndexCutsScenario";

describe("snapshot-index tuple-cut migration 0154 on PGlite", () => {
  it("preserves populated predecessor history while replacing the reader through managed maintenance", async () => {
    await withMigration154Folder(async (folder, enableCurrent) => {
      const db = newTestPGlite();
      try {
        const previous = await createPGlitePersistence({ db, migrationsFolder: folder });
        // Current attestation expects the new signature; bootstrap the exact
        // predecessor without issuing a current serving capability.
        await migrate(previous.drizzle, { migrationsFolder: folder });
        await previous.query("update fx_system_installation set state='active' where singleton_id=1");
        await enableCurrent();
        const current = await createPGlitePersistence({ db, migrationsFolder: folder });
        await assertMigration154SnapshotIndexCuts(previous, current);
      } finally { await db.close(); }
    });
  }, 180_000);
});
