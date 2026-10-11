import { describe, it } from "vitest";
import { postgresUrl, withTemporaryPostgresPersistence } from "../../support/postgresHelpers";
import { logicalWorkingSetReadTransactionsScenario, logicalWorkingSetNativeWriteTimeScenario, logicalWorkingSetCurrentIndexBudgetScenario, logicalWorkingSetCurrentUniqueBudgetScenario } from "./logicalWorkingSetReadTransactionsScenario";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("ordinary PostgreSQL logical working-set checked reads", { timeout: 60_000 }, () => {
  it("keeps unique-owner bodies behind fresh point budgets and original failure order", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      await logicalWorkingSetCurrentUniqueBudgetScenario(persistence.drizzle);
    });
  });
  it("shares protected native time across full write working sets and refuses ended or malformed issuers", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      await logicalWorkingSetNativeWriteTimeScenario(persistence.drizzle);
    });
  });
  it("groups neutral multitable historical reads and rechecks the next read", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      await logicalWorkingSetReadTransactionsScenario(persistence.drizzle);
    });
  });
  it("keeps current-index bodies behind fresh packet budgets and whole-packet decoding", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      await logicalWorkingSetCurrentIndexBudgetScenario(persistence.drizzle);
    });
  });
});
