import { it } from "vitest";
import { createRelationalPGliteFixture } from "../../database/relationalPGliteWorkerTestSupport";
import { payloadScalarScenario } from "./payloadScalarScenario";
import { payloadSelectiveLookupScenario } from "./payloadSelectiveLookupScenario";
it("proves supported Payload Local API and deletion rollback on PGlite", async () => {
  const fixture = await createRelationalPGliteFixture();
  await payloadScalarScenario(fixture.persistence, fixture.session, payloadSelectiveLookupScenario);
}, 180_000);
