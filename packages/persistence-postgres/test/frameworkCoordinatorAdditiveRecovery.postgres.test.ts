import { frameworkWorkMeasurement } from "./frameworkWorkMeasurement";
import { waitForFrameworkLeaseExpiry } from "./frameworkCoordinatorLeaseTestSupport";
import { describe, expect, it } from "vitest";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import { withNativeCoordinator } from "./frameworkCoordinatorPostgresFixture";
import { prepareUpgrade } from "./frameworkCoordinatorAdditivePostgresTestSupport";
import { runWorker } from "./frameworkCoordinatorRestartTestSupport";
import { postgresUrl } from "./postgresHelpers";
import { executeNextFrameworkMigrationStepEffect, finalizeFrameworkMigrationClaimEffect,
  readFrameworkMigrationClaimProgressEffect, runAdditiveFrameworkMigrationCoordinatorEffect } from "../src/migrationCoordination/freshCoordinator";

const native = postgresUrl === null ? describe.skip : describe;
native("native additive restart and bounded work", () => {
  it("reconstructs a partially committed successor in a separate process", async () => {
    await withNativeCoordinator(async fixture => {
      const input = await prepareUpgrade(fixture);
      const schema = (await fixture.persistence.query<{ schema: string }>("select current_schema() as schema")).rows[0]?.schema;
      if (schema === undefined) throw new Error("Missing metadata schema");
      const deadline = performance.now() + 240_000;
      const stopped = await runWorker(schema, fixture.physicalSchema, "partial", deadline, input.baseInstallation);
      expect(stopped.code, stopped.output).not.toBe(0);
      expect((await fixture.persistence.query("select * from fx_system_framework_migration_step_receipt")).rows).toHaveLength(9);
      expect((await fixture.persistence.query("select * from fx_system_framework_schema_installation")).rows).toHaveLength(1);
      const resumed = await runWorker(schema, fixture.physicalSchema, "resume", deadline, input.baseInstallation);
      expect(resumed.code, resumed.output).toBe(0);
      expect((await fixture.persistence.query("select * from fx_system_framework_migration_step_receipt")).rows).toHaveLength(13);
      expect((await fixture.persistence.query("select * from fx_system_framework_schema_installation")).rows).toHaveLength(2);
    });
  }, 300_000);

  it("measures admission, every step, takeover and finalization inside unchanged transaction budgets", async () => {
    const work = frameworkWorkMeasurement();
    const { measure, measurements } = work;
    await withNativeCoordinator(async fixture => {
      const input = await measure("base", () => prepareUpgrade(fixture));
      const first = await measure("admission", () => runEffect(runAdditiveFrameworkMigrationCoordinatorEffect({ ...input,
        maximumStepsPerRun: 0, leaseDurationMilliseconds: 15_000 })));
      if (first.kind !== "pending") throw new Error("Expected first claim");
      await measure("verifyBase", () => runEffect(executeNextFrameworkMigrationStepEffect(first.claim)));
      await measure("reconstruction", () => runEffect(readFrameworkMigrationClaimProgressEffect(first.claim)));
      await waitForFrameworkLeaseExpiry(fixture.persistence, input.attemptId);
      const takeover = await measure("takeover", () => runEffect(runAdditiveFrameworkMigrationCoordinatorEffect({ ...input,
        maximumStepsPerRun: 0, attemptId: "takeover-attempt", leaseOwnerId: "takeover-worker" })));
      if (takeover.kind !== "pending") throw new Error("Expected takeover");
      expect(await runEffectFailure(executeNextFrameworkMigrationStepEffect(first.claim))).toMatchObject({ reason: "staleFence" });
      for (let step = 1; step < 6; step++) await measure(`step-${step}`, () => runEffect(executeNextFrameworkMigrationStepEffect(takeover.claim)));
      expect(await measure("finalize", () => runEffect(finalizeFrameworkMigrationClaimEffect(takeover.claim)))).toMatchObject({ kind: "ready" });
      const { maximumTransactionStatements } = work.totals();
      expect(maximumTransactionStatements).toBeLessThanOrEqual(8_192);
      // The same base/takeover profile previously needed 3,746 finalization statements.
      expect(measurements.find(item => item.phase === "finalize")?.statements).toBeLessThan(3_000);
      expect(measurements.filter(m => m.phase !== "base").every(m => m.milliseconds < 60_000)).toBe(true);
      console.log(JSON.stringify({ profile: "native-additive", baseSteps: 7, candidateSteps: 6, maximumTransactionStatements, measurements }));
    }, { observe: work.observe });
  }, 300_000);
});
