import { describe, it } from "vitest";
import { nativeProtectedSaveRaceWorkerScenarios, nativeProtectedReverseRaceWorkerScenarios,
  nativeProtectedHeldWorkerScenario, nativeProtectedReverseRecoveryWorkerScenario,
  nativeProtectedScopeWorkerScenario } from "./support/nativeProtectedRaceWorkerScenarios";

const drivers = process.env.FLAREX_POSTGRES_DATABASE_URL === undefined ? ["pglite" as const] : ["pglite" as const, "postgres" as const];
describe.each(drivers)("protected native Worker winner and recovery obligations on %s", driver => {
  it("orders permission revocation and Product deletion against new native saves", () => nativeProtectedSaveRaceWorkerScenarios(driver), 240_000);
  it("orders genuine page consumption against permission, source, target, membership and selection changes", () => nativeProtectedReverseRaceWorkerScenarios(driver), 240_000);
  it.each(["cancel", "deadline"] as const)("drains held native work on %s without business publication", mode =>
    nativeProtectedHeldWorkerScenario(driver, mode), 120_000);
  it("recovers a durable reverse result before current selection and explicitly restores serving", () => nativeProtectedReverseRecoveryWorkerScenario(driver), 240_000);
  it("confines equal native keys and signed grants across two real scope partitions", () => nativeProtectedScopeWorkerScenario(driver), 240_000);
});
