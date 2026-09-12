import { it } from "vitest";
import { createRelationalPGliteFixture } from "./relationalPGliteWorkerTestSupport";
import { payloadCollectionsScenario } from "./payloadCollectionsScenario";

it("routes compiler-owned collections through analysis, admission, Local API and atomic cleanup", async () => {
  const fixture = await createRelationalPGliteFixture();
  await payloadCollectionsScenario(fixture.persistence, fixture.session);
}, 180000);
