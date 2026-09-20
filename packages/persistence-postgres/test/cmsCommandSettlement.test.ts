import { it } from "vitest";
import { createRelationalPGliteFixture } from "./relationalPGliteWorkerTestSupport";
import { cmsCommandSettlementScenario } from "./cmsCommandSettlementScenario";
it("settles complete CMS decisions and bounds absent reads (PGlite)", async () => {
  const { persistence, session } = await createRelationalPGliteFixture();
  await cmsCommandSettlementScenario(persistence, session);
}, 120_000);
