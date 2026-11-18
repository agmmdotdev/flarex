import {
  createMigratedPGlitePersistence,
  migratedPGliteDataDir,
} from "../../support/pgliteTestFixture";
import { beforeAll, describe, it } from "vitest";
import { verifyPublicationSlotFinalState } from "./uniquePublicationSlotScenario";
import { lockInstallationForCurrentTransaction, closeInstallationAdmission } from "../../../src/installation/installationLifecycle";
import { closeExactAttemptScopeClockObservation } from "../../../src/scope/scopeClock";
import { runEffect } from "../../support/effectTestRuntime";

beforeAll(() => migratedPGliteDataDir(), 120_000);

describe("publication-local unique slot - PGlite", () => {
  it("requires the exact pending row fact while leaving committed lookups closed", async () => {
    const persistence = await createMigratedPGlitePersistence();
    await persistence.drizzle.transaction(async tx => {
      await runEffect(lockInstallationForCurrentTransaction(tx));
      try { await verifyPublicationSlotFinalState(tx); }
      finally {
        closeExactAttemptScopeClockObservation(tx);
        closeInstallationAdmission(tx);
      }
    });
  }, 60_000);
});
