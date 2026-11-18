import { afterAll, beforeAll, it } from "vitest";
import { createRelationalPGliteFixture } from "../../database/relationalPGliteWorkerTestSupport";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { payloadUniqueAdmissionCases, payloadUniqueAdmissionGapScenario } from "./payloadUniqueAdmissionGapScenario";

let fixture: Awaited<ReturnType<typeof createRelationalPGliteFixture>>;
let control: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>;
const cleanup: Array<() => Promise<void>> = [];

beforeAll(async () => {
  control = await createMigratedPGlitePersistence(close => { cleanup.push(close); });
  fixture = await createRelationalPGliteFixture({ registerCleanup: close => { cleanup.push(close); } });
}, 120_000);

afterAll(async () => {
  const failures: unknown[] = [];
  for (const close of cleanup.toReversed()) {
    try { await close(); } catch (cause) { failures.push(cause); }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Payload unique admission fixture cleanup failed");
}, 120_000);

it.each(payloadUniqueAdmissionCases)("checks Payload unique admission: %s (PGlite)",
  { concurrent: false, timeout: 180_000 }, async mode => {
    await payloadUniqueAdmissionGapScenario(fixture.persistence, mode, {
      controlPersistence: control,
      fixtureIdentity: {
        deploymentId: `deployment_payload_unique_admission_${mode}`,
        projectId: `project_payload_unique_admission_${mode}`,
        uuidOffset: (payloadUniqueAdmissionCases.indexOf(mode) + 1) * 1000,
      },
    });
  });
