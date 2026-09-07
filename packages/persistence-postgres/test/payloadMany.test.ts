import { it } from "vitest";
import { createRelationalPGliteFixture } from "./relationalPGliteWorkerTestSupport";
import { payloadPreferenceBindingScenario } from "./payloadPreferenceBindingScenario";

it("proves fresh Payload many CRUD and population through native owners", async () => {
  const fixture = await createRelationalPGliteFixture({ fileBacked: true });
  await payloadPreferenceBindingScenario(fixture.persistence, fixture.session, "many", fixture.reopen);
}, 180000);
