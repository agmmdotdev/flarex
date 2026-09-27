import { describe, it } from "vitest";
import { createPGlitePersistence } from "../src/pglite";
import { logicalWorkingSetReadTransactionsScenario } from "./logicalWorkingSetReadTransactionsScenario";

describe("logical working-set checked reads", { timeout: 60_000 }, () => {
  it("groups neutral multitable historical reads and rechecks the next read", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    await logicalWorkingSetReadTransactionsScenario(persistence.drizzle);
  });
});
