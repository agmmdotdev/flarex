import { describe, it } from "vitest";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { nonNullCatalogScenario } from "./nonNullCatalogScenario";

describe("non-null partial ordered catalog CHECKs on PGlite", () => {
  it("upgrades the predecessor and refuses malformed and unique predicates", async () => {
    await nonNullCatalogScenario(await createMigratedPGlitePersistence());
  }, 180_000);
});
