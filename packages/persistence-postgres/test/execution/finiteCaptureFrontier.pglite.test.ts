import { describe, it } from "vitest";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createPGlitePersistence } from "../../src/database/pglite";
import { finiteAcceptingReadinessScenario } from "./finiteAcceptingReadinessScenario";
import { finiteCaptureFrontierScenario } from "./finiteCaptureFrontierScenario";
import { newTestPGlite } from "../support/pgliteSearchExtensions";
import { finiteFrontierPopulatedMigration, withFiniteFrontierPredecessor } from "./finiteCaptureFrontierMigrationScenario";

describe("finite scalar frontier PGlite installation", () => {
  it.each([140, 141, 142, 143] as const)("replaces populated predecessor %i through actual maintenance without changing sessions or history", async through => {
    await withFiniteFrontierPredecessor(async (migrationsFolder, restoreCurrentJournal) => {
      const db = newTestPGlite();
      const persistence = await createPGlitePersistence({ db, migrationsFolder });
      try {
        await migrate(persistence.drizzle, { migrationsFolder });
        await restoreCurrentJournal();
        await finiteFrontierPopulatedMigration(persistence, () => persistence.migrate(),through===143);
      } finally { await db.close(); }
    }, through);
  }, 180_000);
  it("accepts complete fresh native build and maintenance evidence in original refusal order", async () => {
    const db = newTestPGlite();
    const persistence = await createPGlitePersistence({ db });
    try {
      await persistence.migrate();
      await finiteAcceptingReadinessScenario(persistence, persistence.drizzle, "public");
    } finally { await db.close(); }
  }, 180_000);
  it("refuses actual scalar routine, privilege and identity/result type faults before reopening", async () => {
    const db = newTestPGlite();
    const persistence = await createPGlitePersistence({ db });
    try { await finiteCaptureFrontierScenario(persistence, "public", () => persistence.migrate()); }
    finally { await db.close(); }
  }, 180_000);
});
