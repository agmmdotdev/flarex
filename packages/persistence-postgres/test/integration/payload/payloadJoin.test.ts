import { it } from "vitest";
import { createRelationalPGliteFixture } from "../../database/relationalPGliteWorkerTestSupport";
import { payloadPreferenceBindingScenario } from "../../frameworks/payloadPreferences/payloadPreferenceBindingScenario";

it("proves fresh Payload reverse join CRUD and population through native owners", async () => {
  const fixture = await createRelationalPGliteFixture({ fileBacked: true });
  await payloadPreferenceBindingScenario(fixture.persistence, fixture.session, "joins", fixture.reopen);
}, 180000);
