import { describe, it } from "vitest";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { committedUniqueRowScenario } from "./committedUniqueRowScenario";

describe("committed unique slot and separate row acceptance", () => {
  it("authenticates the body-free slot before bounded point decoding", async () => {
    const persistence = await createMigratedPGlitePersistence();
    await committedUniqueRowScenario(persistence.drizzle);
  }, 120_000);
});
