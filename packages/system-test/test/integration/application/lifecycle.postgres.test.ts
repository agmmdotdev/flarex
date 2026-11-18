import { createApplicationNativeMutationPostgresFixture } from "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import { describe, expect, it } from "vitest";
import { APPLICATION_LIFECYCLE_OPTIONS, proveApplicationLifecycle } from "../../../support/application/lifecycleScenario";
import { postgresUrl, withTemporarySplitPostgresPersistence } from "../../support/databaseFixturesV1";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("Current Application lifecycle - PostgreSQL", () => {
  it("preserves serving authority through readiness, native rollback, uncertainty and exact replay", async () => {
    await withTemporarySplitPostgresPersistence(async persistence => {
      const proof = await proveApplicationLifecycle(() => createApplicationNativeMutationPostgresFixture(APPLICATION_LIFECYCLE_OPTIONS, persistence));
      expect(proof.analysisWorkerLoads).toBe(4);
      expect(proof.faultCauses).toHaveLength(2);
      expect(proof.finalActive.basis.activationSequence).toBe(3n);
      expect(proof.afterRecovery.history).toHaveLength(3);
    });
  }, 120_000);
});
