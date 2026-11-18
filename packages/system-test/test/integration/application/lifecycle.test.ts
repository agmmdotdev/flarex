import { createApplicationNativeMutationPGliteFixtureWithPersistence } from "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import { describe, expect, it } from "vitest";
import { APPLICATION_LIFECYCLE_OPTIONS, proveApplicationLifecycle } from "../../../support/application/lifecycleScenario";
import { createMigratedSplitPGlitePersistence } from "../../support/databaseFixturesV1";

describe("Current Application lifecycle - PGlite", () => {
  it("readies an analyzed candidate without activation, then atomically CAS activates and cold replays", async () => {
    const persistence = await createMigratedSplitPGlitePersistence();
    const proof = await proveApplicationLifecycle(() => createApplicationNativeMutationPGliteFixtureWithPersistence(APPLICATION_LIFECYCLE_OPTIONS, persistence));
    expect(proof.analysisWorkerLoads).toBe(4);
    expect(proof.faultCauses).toHaveLength(2);
    expect(proof.finalActive.basis.activationSequence).toBe(3n);
    expect(proof.afterRecovery.history).toHaveLength(3);
  }, 120_000);
});
