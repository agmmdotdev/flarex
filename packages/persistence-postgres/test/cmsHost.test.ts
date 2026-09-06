import { it } from "vitest";
import { createRelationalPGliteFixture } from "./relationalPGliteWorkerTestSupport";
import { cmsHostScenario } from "./cmsHostScenario";

it("proves CMS pending documents and Application publication on one PGlite instance", async () => {
  const fixture = await createRelationalPGliteFixture();
  await cmsHostScenario(fixture.persistence, fixture.session);
}, 180_000);
