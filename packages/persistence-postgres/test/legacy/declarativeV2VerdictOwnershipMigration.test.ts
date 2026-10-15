import { describe } from "vitest";
import { createPGlitePersistence } from "../../src/database/pglite";
import { newTestPGlite } from "../support/pgliteSearchExtensions";
import { registerVerdictOwnershipMigrationTests } from "./declarativeV2VerdictOwnershipMigrationScenario";

describe("Declarative V2 verdict ownership migration - PGlite", () => {
  registerVerdictOwnershipMigrationTests(async (migrationsFolder, run) => {
    const db = newTestPGlite();
    try {
      await run(await createPGlitePersistence({ db, migrationsFolder }), "drizzle");
    } finally { await db.close(); }
  });
});
