import { it } from "vitest";
import { createRelationalPGliteFixture } from "./relationalPGliteWorkerTestSupport";
import { ce0CmsPendingUniqueScenario } from "./ce0CmsPendingUniqueScenario";

it("matches eager pending uniqueness and list request identity (PGlite)", async () => {
  const { persistence, session } = await createRelationalPGliteFixture();
  await ce0CmsPendingUniqueScenario(persistence, session);
}, 180_000);
