import { describe, it } from "vitest";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createPGlitePersistence } from "../src/pglite";
import { finiteCaptureFrontierScenario } from "./finiteCaptureFrontierScenario";
import { newTestPGlite } from "./pgliteSearchExtensions";
import { finiteFrontierPopulatedMigration, withFiniteFrontierPredecessor } from "./finiteCaptureFrontierMigrationScenario";

describe("finite scalar frontier PGlite installation", () => {
  it("replaces the populated predecessor through actual maintenance without changing sessions or history", async () => {
    await withFiniteFrontierPredecessor(async (migrationsFolder, restoreCurrentJournal) => {
      const db = newTestPGlite();
      const persistence = await createPGlitePersistence({ db, migrationsFolder });
      try {
        await migrate(persistence.drizzle, { migrationsFolder });
        await restoreCurrentJournal();
        await finiteFrontierPopulatedMigration(persistence, () => persistence.migrate());
      } finally { await db.close(); }
    });
  }, 180_000);
  it("refuses actual scalar routine, privilege and identity/result type faults before reopening", async () => {
    const db = newTestPGlite();
    const persistence = await createPGlitePersistence({ db });
    try { await finiteCaptureFrontierScenario(persistence, "public", () => persistence.migrate()); }
    finally { await db.close(); }
  }, 180_000);
});
