import { it } from "vitest";
import { createRelationalPGliteFixture } from "../../database/relationalPGliteWorkerTestSupport";
import { payloadCollectionsScenario } from "./payloadCollectionsScenario";
import { payloadManyCollectionsScenario } from "./payloadManyCollectionsScenario";

it("routes compiler-owned collections through analysis, admission, Local API and atomic cleanup", async () => {
  const fixture = await createRelationalPGliteFixture();
  await payloadCollectionsScenario(fixture.persistence, fixture.session);
}, 180000);
it("prepares read-only queries independently of the per-command mutation budget", async () => {
  const fixture = await createRelationalPGliteFixture();
  await payloadManyCollectionsScenario(fixture.persistence, fixture.session);
}, 180000);
