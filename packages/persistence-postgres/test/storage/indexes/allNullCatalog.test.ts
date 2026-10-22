import { describe, it } from "vitest";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { allNullCatalogScenario } from "./allNullCatalogScenario";

describe("two-null partial catalog CHECKs on PGlite", () => {
  it("admits genuine definitions and upgrades the predecessor without accepting malformed predicates", async () => {
    await allNullCatalogScenario(await createMigratedPGlitePersistence());
  }, 180_000);
});
