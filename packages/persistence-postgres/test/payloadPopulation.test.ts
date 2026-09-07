import { it } from "vitest";
import { createRelationalPGliteFixture } from "./relationalPGliteWorkerTestSupport";
import { payloadPreferenceBindingScenario } from "./payloadPreferenceBindingScenario";

it("populates bounded Payload reads in the original CMS request", async () => {
  const fixture = await createRelationalPGliteFixture();
  await payloadPreferenceBindingScenario(fixture.persistence, fixture.session, "population");
}, 180000);
