import { it } from "vitest";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { logicalWorkingSetScanObservationsScenario } from "./logicalWorkingSetScanObservationsScenario";

it("keeps scan-backed key, prefix and unchanged lifecycle observations call-local", { timeout: 60_000 }, async () => {
  const persistence = await createMigratedPGlitePersistence();
  await logicalWorkingSetScanObservationsScenario(persistence.drizzle);
});
