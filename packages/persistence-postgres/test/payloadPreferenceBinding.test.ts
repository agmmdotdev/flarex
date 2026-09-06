import { it } from "vitest";
import { createRelationalPGliteFixture } from "./relationalPGliteWorkerTestSupport";
import { payloadPreferenceBindingScenario } from "./payloadPreferenceBindingScenario";
it("installs and admits only the pinned preference binding", async () => {
  const fixture = await createRelationalPGliteFixture();
  await payloadPreferenceBindingScenario(fixture.persistence, fixture.session);
}, 180000);
