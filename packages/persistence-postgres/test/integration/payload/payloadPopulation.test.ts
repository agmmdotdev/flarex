import { it } from "vitest";
import { createRelationalPGliteFixture } from "../../database/relationalPGliteWorkerTestSupport";
import { payloadPreferenceBindingScenario } from "../../frameworks/payloadPreferences/payloadPreferenceBindingScenario";

it("populates bounded Payload reads in the original CMS request", async () => {
  const fixture = await createRelationalPGliteFixture();
  await payloadPreferenceBindingScenario(fixture.persistence, fixture.session, "population");
}, 180000);
