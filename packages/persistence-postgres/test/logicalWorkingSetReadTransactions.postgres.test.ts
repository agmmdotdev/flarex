import { describe, it } from "vitest";
import { postgresUrl, withTemporaryPostgresPersistence } from "./postgresHelpers";
import { logicalWorkingSetReadTransactionsScenario } from "./logicalWorkingSetReadTransactionsScenario";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("ordinary PostgreSQL logical working-set checked reads", { timeout: 60_000 }, () => {
  it("groups neutral multitable historical reads and rechecks the next read", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      await logicalWorkingSetReadTransactionsScenario(persistence.drizzle);
    });
  });
});
