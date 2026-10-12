import { describe, it } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import { createPGlitePersistence } from "../../src/database/pglite";
import { flarexSchema } from "../../src/database/schema";
import { newTestPGlite } from "../support/pgliteSearchExtensions";
import { finiteMetadataDependenciesScenario } from "./finiteMetadataDependenciesScenario";
import { finiteMetadataPolicyScenario } from "./finiteMetadataPolicyScenario";

describe("finite consumed metadata OCC PGlite", () => {
  it("keeps issued policy keys through rollback and rejects both stale settlements and ABA", async () => {
    const db = newTestPGlite();
    const persistence = await createPGlitePersistence({ db });
    try { await persistence.migrate(); await finiteMetadataPolicyScenario(persistence.drizzle); }
    finally { await db.close(); }
  }, 180_000);
  it("retains unchanged semantics and rejects ABA, lazy stale use and negative changes atomically", async () => {
    const db = newTestPGlite();
    const persistence = await createPGlitePersistence({ db });
    try {
      await persistence.migrate();
      let comparatorCount = 0;
      const observed = drizzle({ client: db, schema: flarexSchema, logger: { logQuery(query) {
        if (query.includes("fx_compare_finite_metadata(")) comparatorCount++;
      } } });
      await finiteMetadataDependenciesScenario(observed, () => comparatorCount);
    } finally { await db.close(); }
  }, 180_000);
});
