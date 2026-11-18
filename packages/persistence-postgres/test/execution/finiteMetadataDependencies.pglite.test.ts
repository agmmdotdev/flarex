import { beforeAll, describe, it } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import { migratedPGliteDataDir } from "../support/pgliteTestFixture";
import { flarexSchema } from "../../src/database/schema";
import { createFileScopedReadinessTargetFixture } from "../application/support/readinessFixture";
import { useFileScopedPersistence } from "../support/fileScopedPersistenceFixture";
import { finiteMetadataDependenciesScenario } from "./finiteMetadataDependenciesScenario";
import { finiteMetadataPolicyScenario } from "./finiteMetadataPolicyScenario";

beforeAll(async () => { await migratedPGliteDataDir(); }, 120_000);

describe("finite consumed metadata OCC PGlite", { concurrent: false }, () => {
  const withTarget = useFileScopedPersistence(createFileScopedReadinessTargetFixture, false);
  it("keeps issued policy keys through rollback and rejects both stale settlements and ABA", async () => {
    await withTarget(({ persistence }) => finiteMetadataPolicyScenario(persistence.drizzle));
  }, 180_000);
  it("retains unchanged semantics and rejects ABA, lazy stale use and negative changes atomically", async () => {
    await withTarget(async ({ driver }) => {
      let comparatorCount = 0;
      const observed = drizzle({ client: driver, schema: flarexSchema, logger: { logQuery(query) {
        if (query.includes("fx_compare_finite_metadata(")) comparatorCount++;
      } } });
      await finiteMetadataDependenciesScenario(observed, () => comparatorCount);
    });
  }, 180_000);
});
