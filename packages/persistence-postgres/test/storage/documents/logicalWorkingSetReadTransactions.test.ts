import { describe, it } from "vitest";
import { createPGlitePersistence } from "../../../src/database/pglite";
import { logicalWorkingSetReadTransactionsScenario, logicalWorkingSetNativeWriteTimeScenario, logicalWorkingSetCurrentIndexBudgetScenario, logicalWorkingSetCurrentUniqueBudgetScenario } from "./logicalWorkingSetReadTransactionsScenario";
import { newTestPGlite } from "../../support/pgliteSearchExtensions";

describe("logical working-set checked reads", { timeout: 60_000 }, () => {
  it("keeps unique-owner bodies behind fresh point budgets and original failure order", async () => {
    const db = newTestPGlite();
    try {
      const persistence = await createPGlitePersistence({ db });
      await persistence.migrate();
      await logicalWorkingSetCurrentUniqueBudgetScenario(persistence.drizzle);
    } finally { await db.close(); }
  });
  it("shares protected native time across full write working sets and refuses ended or malformed issuers", async () => {
    const db = newTestPGlite();
    try {
      const persistence = await createPGlitePersistence({ db });
      await persistence.migrate();
      await logicalWorkingSetNativeWriteTimeScenario(persistence.drizzle);
    } finally { await db.close(); }
  });
  it("groups neutral multitable historical reads and rechecks the next read", async () => {
    const db = newTestPGlite();
    try {
      const persistence = await createPGlitePersistence({ db });
      await persistence.migrate();
      await logicalWorkingSetReadTransactionsScenario(persistence.drizzle);
    } finally { await db.close(); }
  });
  it("keeps current-index bodies behind fresh packet budgets and whole-packet decoding", async () => {
    const db = newTestPGlite();
    try {
      const persistence = await createPGlitePersistence({ db });
      await persistence.migrate();
      await logicalWorkingSetCurrentIndexBudgetScenario(persistence.drizzle);
    } finally { await db.close(); }
  });
});
