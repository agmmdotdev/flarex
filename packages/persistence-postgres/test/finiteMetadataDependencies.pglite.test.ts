import { describe, it } from "vitest";
import { createPGlitePersistence } from "../src/pglite";
import { newTestPGlite } from "./pgliteSearchExtensions";
import { finiteMetadataDependenciesScenario } from "./finiteMetadataDependenciesScenario";

describe("finite consumed metadata OCC PGlite", () => {
  it("retains unchanged semantics and rejects ABA, lazy stale use and negative changes atomically", async () => {
    const db = newTestPGlite();
    const persistence = await createPGlitePersistence({ db });
    try {
      await persistence.migrate();
      await finiteMetadataDependenciesScenario(persistence.drizzle);
    } finally { await db.close(); }
  }, 180_000);
});
