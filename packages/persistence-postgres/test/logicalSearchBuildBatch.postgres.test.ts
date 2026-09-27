import { describe, it } from "vitest";
import { verifyLogicalSearchBuildBatch } from "./logicalSearchBuildBatchScenario";
import { postgresUrl } from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("ordinary-role PostgreSQL search readiness batching", () => {
  it("checks fresh physical identity and coverage with one query per batched category", async () => {
    const { withTemporaryPostgresPersistence } = await import("./postgresHelpers");
    await withTemporaryPostgresPersistence(async persistence => {
      await verifyLogicalSearchBuildBatch(persistence, persistence.drizzle);
    });
  }, 180_000);
});
