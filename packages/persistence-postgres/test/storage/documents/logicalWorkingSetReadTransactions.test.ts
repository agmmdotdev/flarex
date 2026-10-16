import { afterAll, beforeAll, describe, it } from "vitest";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { logicalWorkingSetReadTransactionsScenario, logicalWorkingSetNativeWriteTimeScenario, logicalWorkingSetCurrentIndexBudgetScenario, logicalWorkingSetCurrentUniqueBudgetScenario } from "./logicalWorkingSetReadTransactionsScenario";

describe("logical working-set checked reads", { timeout: 60_000, concurrent: false }, () => {
  let persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>;
  let dispose: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    persistence = await createMigratedPGlitePersistence(cleanup => { dispose = cleanup; });
  }, 120_000);

  afterAll(async () => { await dispose?.(); }, 120_000);

  it("keeps unique-owner bodies behind fresh point budgets and original failure order", async () => {
    const persistence = await createMigratedPGlitePersistence();
    await logicalWorkingSetCurrentUniqueBudgetScenario(persistence.drizzle);
  });
  it("shares protected native time across full write working sets and refuses ended or malformed issuers", async () => {
    await logicalWorkingSetNativeWriteTimeScenario(persistence.drizzle);
  });
  it("groups neutral multitable historical reads and rechecks the next read", async () => {
    await logicalWorkingSetReadTransactionsScenario(persistence.drizzle);
  });
  it("keeps current-index bodies behind fresh packet budgets and whole-packet decoding", async () => {
    const persistence = await createMigratedPGlitePersistence();
    await logicalWorkingSetCurrentIndexBudgetScenario(persistence.drizzle);
  });
});
