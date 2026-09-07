import { it } from "vitest";
import { createRelationalPGliteFixture } from "./relationalPGliteWorkerTestSupport";
import { payloadPreferenceBindingScenario } from "./payloadPreferenceBindingScenario";
it("upgrades scalar content and publishes a private Payload relation atomically", async () => {
  const fixture = await createRelationalPGliteFixture();
  await payloadPreferenceBindingScenario(fixture.persistence, fixture.session, true);
}, 180000);
