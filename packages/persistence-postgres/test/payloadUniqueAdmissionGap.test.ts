import { it } from "vitest";
import { createRelationalPGliteFixture } from "./relationalPGliteWorkerTestSupport";
import { payloadUniqueAdmissionCases, payloadUniqueAdmissionGapScenario } from "./payloadUniqueAdmissionGapScenario";

it.each(payloadUniqueAdmissionCases)("checks Payload unique admission: %s (PGlite)", async mode => {
  const fixture = await createRelationalPGliteFixture();
  await payloadUniqueAdmissionGapScenario(fixture.persistence, mode);
}, 180_000);
