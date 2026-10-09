import { describe, it } from "vitest";
import { createPGlitePersistence } from "../../src/database/pglite";
import { finiteEntryInstallationScenario } from "./finiteEntryInstallationScenario";
import { newTestPGlite } from "../support/pgliteSearchExtensions";

describe("finite entry installed owner PGlite", () => {
  it("refuses actual function and private expected-type faults before reopening", async () => {
    const db = newTestPGlite();
    const persistence = await createPGlitePersistence({ db });
    try { await finiteEntryInstallationScenario(persistence, "public", () => persistence.migrate()); }
    finally { await db.close(); }
  }, 180_000);
});
