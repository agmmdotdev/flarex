import { it } from "vitest";
import { createRelationalPGliteFixture } from "./relationalPGliteWorkerTestSupport";
import { payloadScalarScenario } from "./payloadScalarScenario";
it("proves supported Payload Local API and deletion rollback on PGlite", async () => {
  const fixture = await createRelationalPGliteFixture();
  await payloadScalarScenario(fixture.persistence, fixture.session);
}, 180_000);
