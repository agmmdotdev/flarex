import { frameworkWorkMeasurement } from "./frameworkWorkMeasurement";
import { waitForFrameworkLeaseExpiry } from "./frameworkCoordinatorLeaseTestSupport";
import { describe, expect, it } from "vitest";
import { executeNextFrameworkMigrationStepEffect, finalizeFrameworkMigrationClaimEffect,
  readFrameworkMigrationClaimProgressEffect, runFreshFrameworkMigrationCoordinatorEffect } from "../src/migrationCoordination/freshCoordinator";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import { withNativeCoordinator } from "./frameworkCoordinatorPostgresFixture";
import { postgresUrl } from "./postgresHelpers";

const native = postgresUrl === null ? describe.skip : describe;
native("native fresh migration work budget", () => {
  it.each([0, 1, 2, 4])("records acquisition, claim, step, reconstruction, takeover and finalize work with %i extra tables", async extra => {
    const work = frameworkWorkMeasurement();
    const { measure, measurements } = work;
    await withNativeCoordinator(async fixture => {
      const pending = await measure("prepareAndClaim", () => runEffect(runFreshFrameworkMigrationCoordinatorEffect({
        // This is a real lease; wait only for its remaining database time
        // after the first measured transaction and reconstruction.
        ...fixture.input, maximumStepsPerRun: 0, leaseDurationMilliseconds: 15_000,
      })));
      if (pending.kind !== "pending") throw new Error("Expected claim");
      await measure("firstStep", () => runEffect(executeNextFrameworkMigrationStepEffect(pending.claim)));
      await measure("reconstruction", () => runEffect(readFrameworkMigrationClaimProgressEffect(pending.claim)));
      await waitForFrameworkLeaseExpiry(fixture.persistence, fixture.input.attemptId);
      const takeover = await measure("takeover", () => runEffect(runFreshFrameworkMigrationCoordinatorEffect({
        ...fixture.input, attemptId: "attempt-b", leaseOwnerId: "worker-b", maximumStepsPerRun: 0,
      })));
      if (takeover.kind !== "pending") throw new Error("Expected takeover claim");
      let complete = false;
      for (let index = 0; index < 16; index += 1) {
        const step = await measure(`step-${index}`, () => runEffect(executeNextFrameworkMigrationStepEffect(takeover.claim)));
        if (step.kind === "complete") { complete = true; break; }
        expect(step.kind).toBe("step");
      }
      expect(complete).toBe(true);
      expect(await measure("finalize", () => runEffect(finalizeFrameworkMigrationClaimEffect(takeover.claim))))
        .toMatchObject({ kind: "ready" });
      const { maximumTransactionStatements, totalStatements: statements, acquisitionMilliseconds } = work.totals();
      expect(maximumTransactionStatements).toBeLessThanOrEqual(8_192);
      expect(statements).toBeLessThanOrEqual(50_000);
      const priorStatements = new Map([[7, 9_848], [9, 12_563], [11, 16_786]]).get(pending.requiredStepCount);
      if (priorStatements !== undefined) expect(statements).toBeLessThan(priorStatements * 0.7);
      // Seven-step pre-optimization profile: 5,910 statements, 1,918 in finalization.
      if (pending.requiredStepCount === 7) {
        expect(statements).toBeLessThan(5_500);
        expect(measurements.find(item => item.phase === "finalize")?.statements).toBeLessThan(1_600);
      }
      expect(measurements.every(item => item.milliseconds < 60_000)).toBe(true);
      console.log(JSON.stringify({ profile: "native-fresh", planSteps: pending.requiredStepCount,
        acquisitionMilliseconds: Math.round(acquisitionMilliseconds), maximumTransactionStatements,
        totalStatements: statements, measurements }));
    }, { observe: work.observe }, extra);
  }, 300_000);

  it("refuses a call above the execution step limit and enforces its whole-run deadline", async () => {
    await withNativeCoordinator(async fixture => {
      expect(await runEffectFailure(runFreshFrameworkMigrationCoordinatorEffect({ ...fixture.input, maximumStepsPerRun: 17 })))
        .toMatchObject({ reason: "invalidInput" });
      expect(await runEffectFailure(runFreshFrameworkMigrationCoordinatorEffect({ ...fixture.input, runTimeoutMilliseconds: 1 })))
        .toMatchObject({ reason: "resourceFailure" });
      // A cancelled call can be resumed from its durable state.
      expect(await runEffect(runFreshFrameworkMigrationCoordinatorEffect(fixture.input))).toMatchObject({ kind: "ready" });
    });
  }, 180_000);

  it("refuses a seventeen-step plan before target metadata or DDL work", async () => {
    let acquisitions = 0;
    await withNativeCoordinator(async fixture => {
      expect(await runEffectFailure(runFreshFrameworkMigrationCoordinatorEffect(fixture.input)))
        .toMatchObject({ reason: "invalidInput", message: "Fresh coordinator execution supports at most 15 plan steps" });
      expect(acquisitions).toBe(0);
      expect((await fixture.persistence.query<{ count: number }>(
        "select count(*)::int as count from fx_system_framework_migration_collision_domain")).rows[0]?.count).toBe(0);
    }, { observe: event => { if (event.phase === "acquire") acquisitions += 1; } }, 5);
  }, 180_000);
});
