import { describe, it } from "vitest";
import { finiteMetadataDependenciesScenario } from "./finiteMetadataDependenciesScenario";
import { postgresUrl, withTemporaryPostgresPersistence } from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;
describePostgres("finite consumed metadata OCC PostgreSQL", () => {
  it("retains unchanged semantics and rejects ABA, lazy stale use and negative changes atomically", async () => {
    await withTemporaryPostgresPersistence(persistence => finiteMetadataDependenciesScenario(persistence.drizzle));
  }, 180_000);
});
