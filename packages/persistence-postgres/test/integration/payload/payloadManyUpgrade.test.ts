import { it } from "vitest";
import { createRelationalPGliteFixture } from "../../database/relationalPGliteWorkerTestSupport";
import { payloadPreferenceBindingScenario } from "../../frameworks/payloadPreferences/payloadPreferenceBindingScenario";

it("refuses scalar and optional-one many upgrades even after posts become empty", async () => {
  const fixture = await createRelationalPGliteFixture();
  await payloadPreferenceBindingScenario(fixture.persistence, fixture.session, "many-upgrade");
}, 180000);
