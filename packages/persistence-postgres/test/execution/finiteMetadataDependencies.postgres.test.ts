import { describe, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { flarexSchema } from "../../src/database/schema";
import { finiteMetadataDependenciesScenario } from "./finiteMetadataDependenciesScenario";
import { postgresUrl, withTemporaryPostgresPersistence } from "../support/postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;
describePostgres("finite consumed metadata OCC PostgreSQL", () => {
  it("retains unchanged semantics and rejects ABA, lazy stale use and negative changes atomically", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      let comparatorCount = 0;
      const observed = drizzle({ client: persistence.pool, schema: flarexSchema, logger: { logQuery(query) {
        if (query.includes("fx_compare_finite_metadata(")) comparatorCount++;
      } } });
      await finiteMetadataDependenciesScenario(observed, () => comparatorCount);
    });
  }, 180_000);
});
