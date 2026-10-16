import { beforeAll, describe, it } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import { createMigratedPGlitePersistence, migratedPGliteDataDir } from "../support/pgliteTestFixture";
import { flarexSchema } from "../../src/database/schema";
import { newTestPGlite } from "../support/pgliteSearchExtensions";
import { finiteMetadataDependenciesScenario } from "./finiteMetadataDependenciesScenario";
import { finiteMetadataPolicyScenario } from "./finiteMetadataPolicyScenario";

beforeAll(async () => { await migratedPGliteDataDir(); }, 120_000);

describe("finite consumed metadata OCC PGlite", () => {
  it("keeps issued policy keys through rollback and rejects both stale settlements and ABA", async () => {
    const persistence = await createMigratedPGlitePersistence();
    await finiteMetadataPolicyScenario(persistence.drizzle);
  }, 180_000);
  it("retains unchanged semantics and rejects ABA, lazy stale use and negative changes atomically", async () => {
    const db = newTestPGlite({ loadDataDir: await migratedPGliteDataDir() });
    try {
      let comparatorCount = 0;
      const observed = drizzle({ client: db, schema: flarexSchema, logger: { logQuery(query) {
        if (query.includes("fx_compare_finite_metadata(")) comparatorCount++;
      } } });
      await finiteMetadataDependenciesScenario(observed, () => comparatorCount);
    } finally { await db.close(); }
  }, 180_000);
});
