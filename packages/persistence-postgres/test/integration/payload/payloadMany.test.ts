import { it } from "vitest";
import { createRelationalPGliteFixture } from "../../database/relationalPGliteWorkerTestSupport";
import { payloadPreferenceBindingScenario } from "../../frameworks/payloadPreferences/payloadPreferenceBindingScenario";

it("proves fresh Payload many CRUD and population through native owners", async () => {
  const fixture = await createRelationalPGliteFixture({ fileBacked: true });
  await payloadPreferenceBindingScenario(fixture.persistence, fixture.session, "many", fixture.reopen);
}, 180000);
