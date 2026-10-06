import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, it } from "vitest";
import { createPGlitePersistence } from "../src/pglite";
import { finiteExecutionAuthorityMigrationScenario } from "./finiteExecutionAuthorityMigrationScenario";
import { makeDrizzleCopyFixture } from "./migrationFixtureSupport";
import { newTestPGlite } from "./pgliteSearchExtensions";

describe("finite execution authority forward migration (PGlite)", () => {
  it("refuses undrained finite roots and preserves legacy and direct owners", async () => {
    const fixture = await makeDrizzleCopyFixture("flarex-finite-authority", "pglite", "0126_finite_execution_authority.sql");
    const db = newTestPGlite();
    const persistence = await createPGlitePersistence({ db, migrationsFolder: fixture.migrationsFolder });
    try {
      await finiteExecutionAuthorityMigrationScenario(persistence, fixture,
        () => migrate(persistence.drizzle, { migrationsFolder: fixture.migrationsFolder }),
        () => persistence.migrate());
    } finally { await db.close(); await fixture.cleanup(); }
  }, 120_000);
});
