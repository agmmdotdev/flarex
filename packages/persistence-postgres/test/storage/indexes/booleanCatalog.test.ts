import { describe, it } from "vitest";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { booleanCatalogScenario } from "./booleanCatalogScenario";

describe("Boolean partial catalog CHECKs on PGlite", () => {
  it("admits exact new definitions and upgrades the predecessor CHECKs without loosening malformed JSON", async () => {
    await booleanCatalogScenario(await createMigratedPGlitePersistence());
  }, 180_000);
});
