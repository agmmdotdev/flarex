import { it } from "vitest";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createPGlitePersistence } from "../../../src/database/pglite";
import { newTestPGlite } from "../../support/pgliteSearchExtensions";
import { orderedCatalogCapacityUpgrade, withOrderedCatalogPredecessor } from "./orderedCatalogCapacityMigrationScenario";

it("upgrades the authentic 152 catalog on PGlite with rollback, preserved grants/data and replay", () =>
  withOrderedCatalogPredecessor(async fixture => {
    const db = newTestPGlite();
    const persistence = await createPGlitePersistence({ db, migrationsFolder: fixture.migrationsFolder });
    try {
      await migrate(persistence.drizzle, { migrationsFolder: fixture.migrationsFolder });
      await orderedCatalogCapacityUpgrade(persistence, fixture, "drizzle", () => persistence.migrate());
    } finally { await db.close(); }
  }), 240_000);
