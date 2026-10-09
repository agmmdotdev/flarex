import { it } from "vitest";
import { createRelationalPGliteFixture } from "../../database/relationalPGliteWorkerTestSupport";
import { cmsExecutionMeasurementFixture } from "./cmsExecutionMeasurementFixture";
import { nativeCmsPublicationCorrectness } from "./nativeCmsPublicationScenario";

it("preserves native publication, replay and CMS phantom refusal (PGlite)", async () => {
  const { persistence, session } = await createRelationalPGliteFixture();
  await nativeCmsPublicationCorrectness(await cmsExecutionMeasurementFixture(persistence, session));
}, 120_000);
