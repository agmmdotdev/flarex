import { describe, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { flarexSchema } from "../../src/database/schema";
import { finiteMetadataDependenciesScenario } from "./finiteMetadataDependenciesScenario";
import { finiteMetadataPolicyScenario } from "./finiteMetadataPolicyScenario";
import { postgresUrl, useFileScopedPostgresPersistence } from "../support/postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;
describePostgres("finite consumed metadata OCC PostgreSQL", { concurrent: false }, () => {
  const withPersistence = useFileScopedPostgresPersistence();
  it("keeps issued policy keys through rollback and rejects both parallel stale settlements and ABA", async () => {
    await withPersistence(persistence => finiteMetadataPolicyScenario(persistence.drizzle));
  }, 180_000);
  it("retains unchanged semantics and rejects ABA, lazy stale use and negative changes atomically", async () => {
    await withPersistence(async persistence => {
      let comparatorCount = 0;
      const observed = drizzle({ client: persistence.pool, schema: flarexSchema, logger: { logQuery(query) {
        if (query.includes("fx_compare_finite_metadata(")) comparatorCount++;
      } } });
      await finiteMetadataDependenciesScenario(observed, () => comparatorCount);
    });
  }, 180_000);
});
