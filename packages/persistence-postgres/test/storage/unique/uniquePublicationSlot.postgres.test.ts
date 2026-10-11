import { describe, it } from "vitest";
import { postgresUrl, withTemporaryPostgresPersistence } from "../../support/postgresHelpers";
import { verifyPublicationSlotFinalState } from "./uniquePublicationSlotScenario";
import { lockInstallationForCurrentTransaction, closeInstallationAdmission } from "../../../src/installation/installationLifecycle";
import { closeExactAttemptScopeClockObservation } from "../../../src/scope/scopeClock";
import { runEffect } from "../../support/effectTestRuntime";

describe.skipIf(postgresUrl === null)("publication-local unique slot - PostgreSQL", () => {
  it("requires the exact pending row fact while leaving committed lookups closed", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      await persistence.drizzle.transaction(async tx => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try { await verifyPublicationSlotFinalState(tx); }
        finally {
          closeExactAttemptScopeClockObservation(tx);
          closeInstallationAdmission(tx);
        }
      });
    });
  }, 60_000);
});
