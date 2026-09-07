import { it } from "vitest";
import { createRelationalPGliteFixture } from "./relationalPGliteWorkerTestSupport";
import { payloadPreferenceBindingScenario } from "./payloadPreferenceBindingScenario";

it("refuses scalar and optional-one many upgrades even after posts become empty", async () => {
  const fixture = await createRelationalPGliteFixture();
  await payloadPreferenceBindingScenario(fixture.persistence, fixture.session, "many-upgrade");
}, 180000);
