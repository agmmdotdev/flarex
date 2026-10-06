import { describe, it } from "vitest";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import { materializationCompositionCases } from "./materializationCompositionScenario";

describe("Application materialization composition on PGlite", () => {
  it.each(materializationCompositionCases)("$name", async scenario => {
    const persistence = await createMigratedPGlitePersistence();
    await scenario.run(persistence);
  }, 120_000);
});
