import { it } from "vitest";
import { createRelationalPGliteFixture } from "./relationalPGliteWorkerTestSupport";
import { cmsExecutionMeasurementCorrectness } from "./cmsExecutionMeasurementFixture";

it("proves the active CMS measurement workload, replay and conflict rollback (PGlite)", async () => {
  const { persistence, session } = await createRelationalPGliteFixture();
  await cmsExecutionMeasurementCorrectness(persistence, session);
}, 120_000);
