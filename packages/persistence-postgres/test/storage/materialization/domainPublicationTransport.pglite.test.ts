import { afterAll, beforeAll, describe, it } from "vitest";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { publicationTransportCases } from "./domainPublicationTransportScenario";

describe("Application publication typed array transport on PGlite", { concurrent: false }, () => {
  let persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>;
  let dispose: (() => Promise<void>) | undefined;
  beforeAll(async () => {
    persistence = await createMigratedPGlitePersistence(cleanup => { dispose = cleanup; });
  }, 120_000);
  afterAll(async () => { await dispose?.(); }, 120_000);

  it.each(publicationTransportCases)("$name", async scenario => {
    await scenario.run(persistence.drizzle);
  }, 120_000);
});
