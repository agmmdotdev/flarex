import { describe, it } from "vitest";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { publicationTransportCases } from "./domainPublicationTransportScenario";

describe("Application publication typed array transport on PGlite", () => {
  it.each(publicationTransportCases)("$name", async scenario => {
    const persistence = await createMigratedPGlitePersistence();
    await scenario.run(persistence.drizzle);
  }, 120_000);
});
