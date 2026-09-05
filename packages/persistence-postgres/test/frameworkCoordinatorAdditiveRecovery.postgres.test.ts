import { setTimeout as delay } from "node:timers/promises";
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
    let statements = 0, transactionStatements = 0, maximumTransactionStatements = 0;
    const measurements: { phase: string; statements: number; milliseconds: number }[] = [];
    const measure = async <Value>(phase: string, work: () => Promise<Value>) => {
      const before = statements, start = performance.now();
      const result = await work();
      measurements.push({ phase, statements: statements - before, milliseconds: Math.round(performance.now() - start) });
      return result;
    };
    await withNativeCoordinator(async fixture => {
      const input = await measure("base", () => prepareUpgrade(fixture));
      const first = await measure("admission", () => runEffect(runAdditiveFrameworkMigrationCoordinatorEffect({ ...input,
        maximumStepsPerRun: 0, leaseDurationMilliseconds: 60_000 })));
      if (first.kind !== "pending") throw new Error("Expected first claim");
      await measure("verifyBase", () => runEffect(executeNextFrameworkMigrationStepEffect(first.claim)));
      await measure("reconstruction", () => runEffect(readFrameworkMigrationClaimProgressEffect(first.claim)));
      await delay(60_100);
      const takeover = await measure("takeover", () => runEffect(runAdditiveFrameworkMigrationCoordinatorEffect({ ...input,
        maximumStepsPerRun: 0, attemptId: "takeover-attempt", leaseOwnerId: "takeover-worker" })));
      if (takeover.kind !== "pending") throw new Error("Expected takeover");
      expect(await runEffectFailure(executeNextFrameworkMigrationStepEffect(first.claim))).toMatchObject({ reason: "staleFence" });
      for (let step = 1; step < 6; step++) await measure(`step-${step}`, () => runEffect(executeNextFrameworkMigrationStepEffect(takeover.claim)));
      expect(await measure("finalize", () => runEffect(finalizeFrameworkMigrationClaimEffect(takeover.claim)))).toMatchObject({ kind: "ready" });
      expect(maximumTransactionStatements).toBeLessThanOrEqual(8_192);
      expect(measurements.filter(m => m.phase !== "base").every(m => m.milliseconds < 60_000)).toBe(true);
      console.log(JSON.stringify({ profile: "native-additive", baseSteps: 7, candidateSteps: 6, maximumTransactionStatements, measurements }));
    }, { observe: event => {
      if (event.phase === "begin" && event.edge === "before") transactionStatements = 0;
      if (event.phase === "work" && event.edge === "before") { statements++; transactionStatements++; }
      if (event.phase === "release" && event.edge === "before") maximumTransactionStatements = Math.max(maximumTransactionStatements, transactionStatements);
    } });
  }, 300_000);
});
