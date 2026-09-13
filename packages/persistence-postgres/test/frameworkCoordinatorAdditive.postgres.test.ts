import { prepareUpgrade, admitCandidate } from "./frameworkCoordinatorAdditivePostgresTestSupport";
import { setTimeout as delay } from "node:timers/promises";
import { Effect, Result } from "effect";
import { prepareBaseAvailabilityChange } from "./frameworkCoordinatorAdditiveAvailabilityTestSupport";
import { describe, expect, it } from "vitest";
import { runAdditiveFrameworkMigrationCoordinatorEffect,
  executeNextFrameworkMigrationStepEffect, finalizeFrameworkMigrationClaimEffect } from "../src/migrationCoordination/freshCoordinator";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import { withNativeCoordinator, type NativeCoordinatorFixture } from "./frameworkCoordinatorPostgresFixture";
import { postgresUrl } from "./postgresHelpers";

const native = postgresUrl === null ? describe.skip : describe;
native("native additive framework migration coordinator", () => {
  it("holds base availability against a concurrent status CAS through step commit", async () => {
    await withNativeCoordinator(async fixture => {
      const input = await prepareUpgrade(fixture);
      const pending = await runEffect(runAdditiveFrameworkMigrationCoordinatorEffect({ ...input, maximumStepsPerRun: 0 }));
      if (pending.kind !== "pending") throw new Error("Expected claim");
      const change = await fixture.persistence.drizzle.transaction(tx => runEffect(prepareBaseAvailabilityChange(tx, input.baseReadiness.installation, "withdrawn")));
      const blocker = await fixture.persistence.pool.connect();
      const writer = await fixture.persistence.pool.connect();
      let advancing: Promise<unknown> | undefined;
      let changing: Promise<unknown> | undefined;
      try {
        await blocker.query("begin");
        await blocker.query("lock table fx_system_framework_migration_step_receipt in share mode");
        const progress = runEffect(Effect.result(executeNextFrameworkMigrationStepEffect(pending.claim)));
        advancing = progress;
        // A real table lock stalls the receipt INSERT after A's availability
        // lock, without replacing the protected catalog with a fixture trigger.
        await waitForLock(fixture, "wait_event_type='Lock' and query like '%insert into%fx_system_framework_migration_step_receipt%'");
        const pid = (await writer.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]?.pid;
        if (pid === undefined) throw new Error("Missing writer pid");
        const canonical = Buffer.from(change.head.canonicalJson);
        changing = writer.query(
          "update fx_system_framework_schema_availability_head set availability_history_storage_id=$1, availability_sequence=$2, status='withdrawn', history_sha256=$3, availability_head_sha256=$4, canonical_byte_length=$5, canonical_bytes=$6 where installation_storage_id=$7 and availability_head_sha256=$8 returning installation_storage_id",
          [change.stored.storageId.toString(), change.head.frame.availabilitySequence, Buffer.from(change.stored.history.sha256, "hex"),
            Buffer.from(change.head.sha256, "hex"), canonical.byteLength, canonical, change.current.installation.storageId.toString(),
            Buffer.from(change.current.head.sha256, "hex")]);
        await waitForLock(fixture, "pid=" + pid + " and wait_event_type='Lock'", fixture.persistence.pool);
        await blocker.query("commit");
        expect(Result.getOrThrow(await progress)).toMatchObject({ kind: "step", completedStepCount: 1 });
        await changing;
        expect(await runEffectFailure(executeNextFrameworkMigrationStepEffect(pending.claim))).toMatchObject({ reason: "planConflict" });
      } finally {
        await blocker.query("rollback");
        await Promise.allSettled([advancing, changing]);
        blocker.release(); writer.release();
      }
    });
  }, 240_000);
  it("upgrades a seven-step base and replays within unchanged native budgets", async () => {
    await withNativeCoordinator(async fixture => {
      const input = await prepareUpgrade(fixture);
      const baseObjects = await fixture.persistence.query("select oid::text from pg_class where relnamespace = $1::regnamespace order by oid", [fixture.physicalSchema]);
      expect(await runEffect(runAdditiveFrameworkMigrationCoordinatorEffect(input))).toMatchObject({ kind: "ready", replayed: false });
      expect(await runEffect(runAdditiveFrameworkMigrationCoordinatorEffect(input))).toMatchObject({ kind: "ready", replayed: true });
      const objects = await fixture.persistence.query("select oid::text from pg_class where relnamespace = $1::regnamespace order by oid", [fixture.physicalSchema]);
      expect(objects.rows).toEqual(expect.arrayContaining(baseObjects.rows));
    });
  }, 240_000);

  it("serializes the same candidate and refuses a competing successor before and after readiness", async () => {
    await withNativeCoordinator(async fixture => {
      const input = await prepareUpgrade(fixture);
      const contenders = [{ ...input, maximumStepsPerRun: 0 }, { ...input, maximumStepsPerRun: 0,
        attemptId: "other-attempt", leaseOwnerId: "other-worker" }];
      const settled = await Promise.allSettled(contenders.map(request => runEffect(runAdditiveFrameworkMigrationCoordinatorEffect(request))));
      const results = [];
      for (const [index, outcome] of settled.entries()) {
        if (outcome.status === "fulfilled") results.push(outcome.value);
        else {
          // The unchanged two-second lock budget may expire while the winner
          // authenticates its graph. A new request must observe that winner.
          expect(outcome.reason).toMatchObject({ reason: "resourceFailure", cause: { cause: { code: "55P03" } } });
          const request = contenders[index];
          if (request === undefined) throw new Error("Missing contender");
          results.push(await runEffect(runAdditiveFrameworkMigrationCoordinatorEffect(request)));
        }
      }
      expect(results.map(r => r.kind).sort()).toEqual(["busy", "pending"]);
      const competing = await admitCandidate(fixture, "competing");
      const other = { ...input, artifactIdentity: competing.artifact.identity };
      expect(await runEffectFailure(runAdditiveFrameworkMigrationCoordinatorEffect(other)))
        .toMatchObject({ reason: "planConflict" });
      const pending = results.find(r => r.kind === "pending");
      if (pending?.kind !== "pending") throw new Error("Missing winning claim");
      for (let step = 0; step < 6; step++) await runEffect(executeNextFrameworkMigrationStepEffect(pending.claim));
      expect(await runEffect(finalizeFrameworkMigrationClaimEffect(pending.claim))).toMatchObject({ kind: "ready" });
      expect(await runEffectFailure(runAdditiveFrameworkMigrationCoordinatorEffect(other))).toMatchObject({ reason: "planConflict" });
      expect((await fixture.persistence.query("select * from fx_system_framework_migration_plan")).rows).toHaveLength(2);
    });
  }, 300_000);

  it("rolls back a new-to-retained foreign key on real lock timeout and resumes committed additions", async () => {
    await withNativeCoordinator(async fixture => {
      const input = await prepareUpgrade(fixture);
      const pending = await runEffect(runAdditiveFrameworkMigrationCoordinatorEffect({ ...input, maximumStepsPerRun: 4 }));
      if (pending.kind !== "pending") throw new Error("Expected prefix before retained foreign key");
      const tables = (await fixture.persistence.query<{ name: string }>(
        "select c.relname as name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=$1 and c.relkind='r' and c.relname like 'fxrt_%' order by c.oid limit 2",
        [fixture.physicalSchema])).rows;
      const blocker = await fixture.persistence.pool.connect();
      try {
        await blocker.query("begin");
        for (const table of tables) await blocker.query(`lock table "${fixture.physicalSchema}"."${table.name}" in row exclusive mode`);
        await runEffectFailure(executeNextFrameworkMigrationStepEffect(pending.claim));
        expect((await fixture.persistence.query("select * from fx_system_framework_migration_step_receipt")).rows).toHaveLength(11);
        expect((await fixture.persistence.query("select * from fx_system_framework_schema_installation")).rows).toHaveLength(1);
      } finally { await blocker.query("rollback"); blocker.release(); }
      expect(await runEffect(runAdditiveFrameworkMigrationCoordinatorEffect(input))).toMatchObject({ kind: "ready" });
    });
  }, 240_000);

  it.each(["before", "after"] as const)("recovers %s-COMMIT response loss for every additive step and finalization", async edge => {
    let armed = false;
    let uncertainClient: unknown;
    const begins: unknown[] = [];
    await withNativeCoordinator(async fixture => {
      const input = await prepareUpgrade(fixture);
      const pending = await runEffect(runAdditiveFrameworkMigrationCoordinatorEffect({ ...input, maximumStepsPerRun: 0 }));
      if (pending.kind !== "pending") throw new Error("Expected additive claim");
      for (let index = 0; index < 6; index++) {
        begins.length = 0; armed = true;
        expect(await runEffect(executeNextFrameworkMigrationStepEffect(pending.claim)))
          .toMatchObject({ kind: "step", completedStepCount: index + 1 });
        expect(begins.length).toBeGreaterThanOrEqual(2);
        expect(begins[1]).not.toBe(uncertainClient);
      }
      begins.length = 0; armed = true;
      expect(await runEffect(finalizeFrameworkMigrationClaimEffect(pending.claim))).toMatchObject({ kind: "ready" });
      expect(begins[1]).not.toBe(uncertainClient);
    }, { observe: event => {
      if (event.phase === "begin" && event.edge === "before") begins.push(event.client);
      if (armed && event.phase === "commit" && event.edge === edge) {
        armed = false; uncertainClient = event.client; throw new Error("Injected additive COMMIT response loss");
      }
    } });
  }, 300_000);
});

async function waitForLock(fixture: NativeCoordinatorFixture, predicate: string, pool = fixture.migrationPool) {
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) {
    const found = await pool.query("select 1 from pg_stat_activity where datname=current_database() and application_name=current_setting('application_name') and " + predicate);
    if (found.rows.length > 0) return;
    await delay(10);
  }
  throw new Error("Native additive fixture did not reach its SQL lock barrier");
}
