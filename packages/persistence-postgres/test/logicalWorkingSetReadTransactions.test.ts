import { describe, it } from "vitest";
import { createPGlitePersistence } from "../src/pglite";
import { logicalWorkingSetReadTransactionsScenario } from "./logicalWorkingSetReadTransactionsScenario";
import { newTestPGlite } from "./pgliteSearchExtensions";

describe("logical working-set checked reads", { timeout: 60_000 }, () => {
  it("groups neutral multitable historical reads and rechecks the next read", async () => {
    const db = newTestPGlite();
    try {
      const persistence = await createPGlitePersistence({ db });
      await persistence.migrate();
      await logicalWorkingSetReadTransactionsScenario(persistence.drizzle);
    } finally { await db.close(); }
  });
});
