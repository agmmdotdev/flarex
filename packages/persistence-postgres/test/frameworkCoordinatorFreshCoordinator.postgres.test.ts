import { assertPublicationRollback, publicationAlterations, assertSettledReadinessRefusal, settledReadinessAlterations } from "./frameworkPublicationTestSupport";
import { assertInstallationWorkPhases } from "./frameworkInstallationWorkTestSupport";
import { assertNormalCommandWorkingSet, assertNormalCommandRollback, assertLiveClaimRestart, normalCommandAlterations } from "./frameworkNormalCommandTestSupport";
import { assertInstallerResume, assertInstallerDeadline } from "./frameworkInstallerTestSupport";
import { assertExplicitFrameworkVerification, assertVerificationRefusesUnreceiptedDdl } from "./frameworkMigrationVerificationTestSupport";
import * as structuralRunner from "../src/migrationCoordination/relationalStructuralRunner";
import { assertHeadProgressCorruption, assertHeadProgressMigration, assertPersistedHeadProgress } from "./frameworkHeadProgressTestSupport";
import { prepareInstallationRuntime, acceptPreparedInstallation } from "../src/frameworkSchema/installation/runtime";
import { installationBindingReference } from "./frameworkDataBindingPhysicalTestSupport";
import { administrativelyRepairFrameworkMetadata } from "./frameworkMetadataRepairTestSupport";
import { sql } from "drizzle-orm";
import { setTimeout as delay } from "node:timers/promises";
import { waitForFrameworkLeaseExpiry } from "./frameworkCoordinatorLeaseTestSupport";
import { Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";

import { executeNextFrameworkMigrationStepEffect, finalizeFrameworkMigrationClaimEffect,
  readFrameworkMigrationClaimProgressEffect, runFreshFrameworkMigrationCoordinatorEffect } from "../src/migrationCoordination/freshCoordinator";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import { countNativeRows, createNativeCoordinatorFixture, withNativeCoordinator,
  type NativeCoordinatorFixture } from "./frameworkCoordinatorPostgresFixture";
import { postgresUrl } from "./postgresHelpers";
import { captureFreshRelationalMigrationPlan } from "../src/migrationCoordination/canonical";
import { captureRelationalPhysicalLayout } from "../src/relationalSchema/physical/canonical";
import { frameworkMigrationTargetSnapshot } from "../src/migrationCoordination/targetSession";
import { ensureFrameworkMigrationCollisionDomainInTransactionEffect,
  ensureFrameworkSchemaTargetNamespaceInTransactionEffect } from "../src/migrationCoordination/targetCollisionRepository";

const native = postgresUrl === null ? describe.skip : describe;

native("native fresh framework migration coordinator", () => {
  it.each(settledReadinessAlterations)("refuses settled readiness after an altered %s", async alteration => {
    await withNativeCoordinator(fixture => assertSettledReadinessRefusal(fixture.persistence.drizzle, fixture.input, alteration));
  }, 180_000);

  it.each(publicationAlterations)("rolls back final publication after an altered %s", async alteration => {
    await withNativeCoordinator(fixture => assertPublicationRollback(fixture.persistence.drizzle, fixture.input, alteration));
  }, 180_000);

  it.each([0, 2, 4])("accounts for installation work by phase with %i extra tables", async extraTables => {
    await withNativeCoordinator(fixture => assertInstallationWorkPhases(fixture.persistence.drizzle, fixture.input, "postgres"), {}, extraTables);
  }, 180_000);

  it.each([0, 4])("keeps normal command work proportional to steps and edges with %i extra tables", async extraTables => {
    await withNativeCoordinator(fixture => assertNormalCommandWorkingSet(fixture.input), {}, extraTables);
  }, 180_000);

  it.each(normalCommandAlterations)("rolls back the normal command after an altered %s result", async alteration => {
    await withNativeCoordinator(fixture => assertNormalCommandRollback(fixture.input, alteration));
  }, 180_000);

  it.each([0, 4])("reopens the live claim without receipt or event replay with %i extra tables", async extraTables => {
    await withNativeCoordinator(fixture => assertLiveClaimRestart(fixture.input), {}, extraTables);
  }, 180_000);

  it("bounds continuation time and awaits cancellation cleanup", async () => {
    await withNativeCoordinator(fixture => assertInstallerDeadline(fixture.input));
  }, 180_000);
  it("installs through the bounded installer and resumes durable state", async () => {
    await withNativeCoordinator(fixture => assertInstallerResume(fixture.input));
  }, 180_000);

  it("explicitly verifies absent, partial and settled state without advancing it", async () => {
    await withNativeCoordinator(async fixture => {
      await assertExplicitFrameworkVerification(fixture.persistence.drizzle, fixture.input, fixture.captured.artifact);
    });
  }, 180_000);
  it("explicit verification refuses unreceipted physical structure", async () => {
    await withNativeCoordinator(async fixture => {
      await assertVerificationRefusesUnreceiptedDdl(fixture.input, fixture.captured.artifact);
    });
  }, 180_000);

  it("installs and replays a fifteen-step plan within the default run budget", async () => {
    await withNativeCoordinator(async fixture => {
      const preparation = vi.spyOn(structuralRunner, "issueRelationalStructuralRunnerTokenEffect");
      try {
        expect(await runEffect(runFreshFrameworkMigrationCoordinatorEffect(fixture.input)))
          .toMatchObject({ kind: "ready", replayed: false });
        expect(preparation).toHaveBeenCalledTimes(1);
      } finally { preparation.mockRestore(); }
      expect(await countNativeRows(fixture, "fx_system_framework_migration_step_receipt")).toBe(15);
      expect(await publicationCounts(fixture)).toEqual([1, 1, 1, 1]);
      expect(await runEffect(runFreshFrameworkMigrationCoordinatorEffect(fixture.input)))
        .toMatchObject({ kind: "ready", replayed: true });
      expect(await publicationCounts(fixture)).toEqual([1, 1, 1, 1]);
    }, {}, 4);
  }, 180_000);

  it("refuses corrupt operational progress without changing the claim", async () => {
    await withNativeCoordinator(async fixture => {
      const pending = await runEffect(runFreshFrameworkMigrationCoordinatorEffect({ ...fixture.input, maximumStepsPerRun: 2 }));
      if (pending.kind !== "pending") throw new Error("Expected partial progress");
      await assertHeadProgressCorruption(fixture.persistence.drizzle, () => runEffect(readFrameworkMigrationClaimProgressEffect(pending.claim)));
      await assertHeadProgressMigration(fixture.persistence.drizzle);
      expect(await runEffect(runFreshFrameworkMigrationCoordinatorEffect(fixture.input))).toMatchObject({ kind: "ready" });
    });
  }, 180_000);

  it("installs and exactly replays one durable readiness result", async () => {
    await withNativeCoordinator(async fixture => {
      const ready = await runEffect(runFreshFrameworkMigrationCoordinatorEffect(fixture.input));
      expect(ready).toMatchObject({ kind: "ready", replayed: false });
      expect(await publicationCounts(fixture)).toEqual([1, 1, 1, 1]);
      await assertPersistedHeadProgress(fixture.persistence.drizzle, 7);
      await assertHeadProgressMigration(fixture.persistence.drizzle);
      const replay = await runEffect(runFreshFrameworkMigrationCoordinatorEffect(fixture.input));
      expect(replay).toMatchObject({ kind: "ready", replayed: true });
      expect(await publicationCounts(fixture)).toEqual([1, 1, 1, 1]);
      expect(await countNativeRows(fixture, "fx_system_framework_migration_step_receipt")).toBe(7);
    });
  }, 180_000);

  it.each(["before", "after"] as const)("recovers %s-COMMIT response loss for steps and finalization on distinct backends", async edge => {
    let armed = false;
    let uncertainClient: unknown;
    const begins: unknown[] = [];
    await withNativeCoordinator(async fixture => {
      const pending = await runEffect(runFreshFrameworkMigrationCoordinatorEffect({ ...fixture.input, maximumStepsPerRun: 0 }));
      if (pending.kind !== "pending") throw new Error("Expected claim");
      await assertPersistedHeadProgress(fixture.persistence.drizzle, 0);
      for (let index = 0; index < 7; index += 1) {
        begins.length = 0;
        armed = true;
        const result = await runEffect(executeNextFrameworkMigrationStepEffect(pending.claim));
        expect(result).toMatchObject({ kind: "step", completedStepCount: index + 1 });
        await assertPersistedHeadProgress(fixture.persistence.drizzle, index + 1);
        expect(begins.length).toBeGreaterThanOrEqual(2);
        expect(begins[1]).not.toBe(uncertainClient);
        expect(await countNativeRows(fixture, "fx_system_framework_migration_step_receipt")).toBe(index + 1);
      }
      begins.length = 0;
      armed = true;
      expect(await runEffect(finalizeFrameworkMigrationClaimEffect(pending.claim))).toMatchObject({ kind: "ready" });
      expect(begins[1]).not.toBe(uncertainClient);
      expect(await publicationCounts(fixture)).toEqual([1, 1, 1, 1]);
    }, { observe: event => {
      if (event.phase === "begin" && event.edge === "before") begins.push(event.client);
      if (armed && event.phase === "commit" && event.edge === edge) {
        armed = false;
        uncertainClient = event.client;
        throw new Error(`injected ${edge}-COMMIT response loss`);
      }
    } });
  }, 180_000);

  it("rolls back DDL, receipt, event and head together on an injected publication failure", async () => {
    let armed = false;
    await withNativeCoordinator(async fixture => {
      const pending = await runEffect(runFreshFrameworkMigrationCoordinatorEffect({ ...fixture.input, maximumStepsPerRun: 0 }));
      if (pending.kind !== "pending") throw new Error("Expected claim");
      const before = await ledger(fixture);
      armed = true;
      const failed = await Effect.runPromiseExit(executeNextFrameworkMigrationStepEffect(pending.claim));
      expect(Exit.isFailure(failed)).toBe(true);
      expect(await ledger(fixture)).toEqual(before);
      const physical = await fixture.persistence.query<{ count: number }>(
        "select count(*)::int as count from pg_tables where schemaname=$1 and tablename <> 'fx_system_scope_clock'", [fixture.physicalSchema]);
      expect(physical.rows[0]?.count).toBe(0);
      expect(await runEffect(executeNextFrameworkMigrationStepEffect(pending.claim))).toMatchObject({ kind: "step", completedStepCount: 1 });
    }, { observe: event => {
      if (armed && event.phase === "work" && event.edge === "after" &&
        event.text?.startsWith('insert into "fx_system_framework_migration_step_receipt"')) {
        armed = false;
        throw new Error("injected after receipt before event/head");
      }
    } });
  }, 180_000);

  it("serializes concurrent first-head creation and admits exactly one live owner", async () => {
    await withNativeCoordinator(async fixture => {
      const blocker = await fixture.persistence.pool.connect();
      await blocker.query("begin");
      await blocker.query("lock table fx_system_framework_migration_collision_domain in share mode");
      try {
        const first = runEffect(runFreshFrameworkMigrationCoordinatorEffect({ ...fixture.input, maximumStepsPerRun: 0, lockTimeoutMilliseconds: 10_000 }));
        await waitForNative(fixture, "select count(*)::int as count from pg_stat_activity where wait_event_type = 'Lock' and application_name=current_setting('application_name')", 1);
        const second = runEffect(runFreshFrameworkMigrationCoordinatorEffect({ ...fixture.input,
          attemptId: "attempt-b", leaseOwnerId: "worker-b", maximumStepsPerRun: 0, lockTimeoutMilliseconds: 10_000 }));
        await waitForNative(fixture, `select count(*)::int as count from pg_stat_activity
          where wait_event_type = 'Lock' and wait_event <> 'advisory' and datname = current_database()
            and application_name=current_setting('application_name')`, 2);
        await blocker.query("commit");
        const results = await Promise.all([first, second]);
        expect(results.map(result => result.kind).sort()).toEqual(["busy", "pending"]);
        expect(await countNativeRows(fixture, "fx_system_framework_migration_collision_head")).toBe(1);
        expect(await countNativeRows(fixture, "fx_system_framework_migration_attempt_start")).toBe(1);
      } finally { await blocker.query("rollback"); blocker.release(); }
    });
  }, 180_000);

  it("times out a locked collision head while an independent domain progresses", async () => {
    await withNativeCoordinator(async fixture => {
      const pending = await runEffect(runFreshFrameworkMigrationCoordinatorEffect({ ...fixture.input, maximumStepsPerRun: 0, lockTimeoutMilliseconds: 100 }));
      if (pending.kind !== "pending") throw new Error("Expected claim");
      const blocker = await fixture.persistence.pool.connect();
      await blocker.query("begin");
      await blocker.query("select * from fx_system_framework_migration_collision_head for update");
      const otherSchema = `${fixture.physicalSchema}_b`;
      await fixture.persistence.query(`create schema "${otherSchema}"`);
      try {
        await fixture.persistence.query(`create table "${otherSchema}".fx_system_scope_clock (
          scope_uuid uuid not null, constraint fx_system_scope_clock_scope_uuid_unique unique(scope_uuid))`);
        const other = await createNativeCoordinatorFixture(fixture.persistence, otherSchema);
        const failed = Effect.runPromiseExit(executeNextFrameworkMigrationStepEffect(pending.claim));
        expect(await runEffect(runFreshFrameworkMigrationCoordinatorEffect(other.input))).toMatchObject({ kind: "ready" });
        expect(Exit.isFailure(await failed)).toBe(true);
      } finally {
        await blocker.query("rollback"); blocker.release();
        await fixture.persistence.query(`drop schema "${otherSchema}" cascade`);
      }
      expect(await runEffect(executeNextFrameworkMigrationStepEffect(pending.claim))).toMatchObject({ kind: "step" });
    });
  }, 180_000);

  it("locks the stable collision root when target metadata exists but no mutable head exists", async () => {
    await withNativeCoordinator(async fixture => {
      const snapshot = frameworkMigrationTargetSnapshot(fixture.target);
      if (snapshot === undefined) throw new Error("Expected target snapshot");
      const physicalLayout = await runEffect(captureRelationalPhysicalLayout({
        artifact: fixture.captured.artifact, physicalLocator: snapshot.physicalLocator, targetNamespace: snapshot.namespace,
      }));
      const plan = await runEffect(captureFreshRelationalMigrationPlan({ artifact: fixture.captured.artifact, physicalLayout }));
      await fixture.persistence.drizzle.transaction(async tx => {
        const target = await runEffect(ensureFrameworkSchemaTargetNamespaceInTransactionEffect(tx, snapshot.namespace));
        await runEffect(ensureFrameworkMigrationCollisionDomainInTransactionEffect(tx, target, plan));
      });
      expect(await countNativeRows(fixture, "fx_system_framework_migration_collision_head")).toBe(0);
      const blocker = await fixture.persistence.pool.connect();
      await blocker.query("begin");
      await blocker.query("select * from fx_system_framework_migration_collision_domain for update");
      try {
        const first = runEffect(runFreshFrameworkMigrationCoordinatorEffect({ ...fixture.input, maximumStepsPerRun: 0, lockTimeoutMilliseconds: 10_000 }));
        const second = runEffect(runFreshFrameworkMigrationCoordinatorEffect({ ...fixture.input,
          attemptId: "attempt-b", leaseOwnerId: "worker-b", maximumStepsPerRun: 0, lockTimeoutMilliseconds: 10_000 }));
        await waitForNative(fixture, `select count(*)::int as count from pg_stat_activity
          where wait_event_type = 'Lock' and query ilike '%fx_system_framework_migration_collision_domain%'
            and query ilike '%for no key update%' and datname = current_database()
            and application_name=current_setting('application_name')`, 2);
        expect(await countNativeRows(fixture, "fx_system_framework_migration_collision_head")).toBe(0);
        await blocker.query("commit");
        expect((await Promise.all([first, second])).map(result => result.kind).sort()).toEqual(["busy", "pending"]);
        expect(await countNativeRows(fixture, "fx_system_framework_migration_collision_head")).toBe(1);
      } finally { await blocker.query("rollback"); blocker.release(); }
    });
  }, 180_000);

  it("takes over an expired committed prefix and rejects the old fence", async () => {
    await withNativeCoordinator(async fixture => {
      const pending = await runEffect(runFreshFrameworkMigrationCoordinatorEffect({ ...fixture.input,
        maximumStepsPerRun: 2, leaseDurationMilliseconds: 10_000 }));
      if (pending.kind !== "pending") throw new Error("Expected claim");
      const originals = await fixture.persistence.query("select receipt_storage_id::text, encode(canonical_bytes, 'hex') as bytes from fx_system_framework_migration_step_receipt order by receipt_storage_id");
      await waitForFrameworkLeaseExpiry(fixture.persistence, fixture.input.attemptId);
      expect(await runEffect(runFreshFrameworkMigrationCoordinatorEffect({ ...fixture.input,
        attemptId: "attempt-b", leaseOwnerId: "worker-b", maximumStepsPerRun: 0, leaseDurationMilliseconds: 10_000 })))
        .toMatchObject({ kind: "pending", completedStepCount: 2 });
      expect(await countNativeRows(fixture, "fx_system_framework_migration_step_receipt")).toBe(2);
      await waitForFrameworkLeaseExpiry(fixture.persistence, "attempt-b");
      const ready = await runEffect(runFreshFrameworkMigrationCoordinatorEffect({ ...fixture.input,
        attemptId: "attempt-c", leaseOwnerId: "worker-c" }));
      expect(ready).toMatchObject({ kind: "ready" });
      if (ready.kind !== "ready") throw new Error("Expected completed takeover");
      const reference = installationBindingReference(ready.availability);
      const prepared = await runEffect(prepareInstallationRuntime(fixture.persistence.drizzle, fixture.target.schema, reference));
      const accepted = await fixture.persistence.drizzle.transaction(tx => runEffect(
        acceptPreparedInstallation(prepared, fixture.target.schema, reference, tx),
      ));
      expect(accepted.readiness).toEqual(ready.readiness.readiness.frame);
      expect(await runEffectFailure(executeNextFrameworkMigrationStepEffect(pending.claim))).toMatchObject({ reason: "staleFence" });
      expect(await countNativeRows(fixture, "fx_system_framework_migration_step_receipt")).toBe(7);
      const completed = await fixture.persistence.query("select receipt_storage_id::text, encode(canonical_bytes, 'hex') as bytes from fx_system_framework_migration_step_receipt order by receipt_storage_id");
      expect(completed.rows.slice(0, 2)).toEqual(originals.rows);
      const events = await fixture.persistence.query("select subject_sha256 from fx_system_framework_migration_event where event_kind = 'stepCompleted'");
      expect(events.rows).toHaveLength(7);
      await administrativelyRepairFrameworkMetadata(fixture.persistence.drizzle,
        ["fx_system_framework_migration_step_receipt"], tx => tx.execute(sql`
          update fx_system_framework_migration_step_receipt
          set canonical_bytes = overlay(canonical_bytes placing decode('20', 'hex') from 1 for 1)
          where receipt_storage_id = (select min(receipt_storage_id) from fx_system_framework_migration_step_receipt)
        `));
      await expect(fixture.persistence.drizzle.transaction(tx => runEffect(
        acceptPreparedInstallation(prepared, fixture.target.schema, reference, tx),
      ))).rejects.toMatchObject({ reason: "storedCorruption" });
    });
  }, 180_000);

  it("allows event foreign-key locks while preparation holds the root and waits for a head", async () => {
    await withNativeCoordinator(async fixture => {
      await runEffect(runFreshFrameworkMigrationCoordinatorEffect({ ...fixture.input, maximumStepsPerRun: 0 }));
      await fixture.persistence.query(`create table "${fixture.physicalSchema}".event_fk_probe (
        collision_storage_id bigint references fx_system_framework_migration_collision_domain(collision_storage_id))`);
      const owner = await fixture.persistence.pool.connect();
      await owner.query("begin");
      await owner.query("select * from fx_system_framework_migration_collision_head for update");
      const preparation = Effect.runPromiseExit(runFreshFrameworkMigrationCoordinatorEffect({
        ...fixture.input, attemptId: "attempt-b", leaseOwnerId: "worker-b", maximumStepsPerRun: 0,
        lockTimeoutMilliseconds: 10_000,
      }));
      try {
        await waitForNative(fixture, `select count(*)::int as count from pg_stat_activity
          where wait_event_type = 'Lock' and query ilike '%fx_system_framework_migration_collision_head%'
            and query ilike '%for update%' and datname = current_database()
            and application_name=current_setting('application_name')`, 1);
        // The FK asks for KEY SHARE on exactly the root held by preparation.
        // FOR UPDATE here creates root -> head -> root deadlock; NO KEY UPDATE
        // retains the preparation mutex while permitting this immutable FK.
        await owner.query(`insert into "${fixture.physicalSchema}".event_fk_probe
          select collision_storage_id from fx_system_framework_migration_collision_head`);
        await owner.query("commit");
        expect(await preparation).toMatchObject({ _tag: "Success", value: { kind: "busy" } });
      } finally {
        await owner.query("rollback"); owner.release();
        await preparation;
      }
    });
  }, 180_000);

  it.each(["receipt", "structure"] as const)("refuses corrupted %s without readiness publication", async kind => {
    await withNativeCoordinator(async fixture => {
      const pending = await runEffect(runFreshFrameworkMigrationCoordinatorEffect({ ...fixture.input, maximumStepsPerRun: kind === "receipt" ? 1 : 6 }));
      expect(pending.kind).toBe("pending");
      if (kind === "receipt") {
        await administrativelyRepairFrameworkMetadata(fixture.persistence.drizzle, ["fx_system_framework_migration_step_receipt"], async repairTransaction => repairTransaction.execute(sql.raw(`update fx_system_framework_migration_step_receipt
          set canonical_bytes = set_byte(canonical_bytes, 0, (get_byte(canonical_bytes, 0) + 1) % 256)`)));
        expect(await runEffectFailure(runFreshFrameworkMigrationCoordinatorEffect(fixture.input))).toMatchObject({ reason: "storedCorruption" });
      } else {
        const indexes = await fixture.persistence.query<{ indexname: string }>(
          "select indexname from pg_indexes where schemaname=$1 and indexdef not like 'CREATE UNIQUE INDEX%'", [fixture.physicalSchema]);
        const index = indexes.rows[0]?.indexname;
        if (index === undefined) throw new Error("Expected ordinary index");
        await fixture.migrationPool.query(`drop index "${fixture.physicalSchema}"."${index.replaceAll('"', '""')}"`);
        expect(await runEffect(runFreshFrameworkMigrationCoordinatorEffect(fixture.input))).toEqual({ kind: "not_ready", reason: "structureMismatch" });
      }
      expect(await publicationCounts(fixture)).toEqual([0, 0, 0, 0]);
    });
  }, 180_000);
});

async function publicationCounts(fixture: NativeCoordinatorFixture) {
  return Promise.all(["schema_installation", "schema_readiness", "schema_availability_history", "schema_availability_head"]
    .map(suffix => countNativeRows(fixture, `fx_system_framework_${suffix}`)));
}
async function ledger(fixture: NativeCoordinatorFixture) {
  return Promise.all(["step_receipt", "event", "collision_head"].map(async suffix =>
    (await fixture.persistence.query(`select row_to_json(t) as row from fx_system_framework_migration_${suffix} t`)).rows));
}
async function waitForNative(fixture: NativeCoordinatorFixture, query: string, count: number) {
  const expires = Date.now() + 5_000;
  while (Date.now() < expires) {
    const result = await fixture.migrationPool.query<{ count: number }>(query);
    if ((result.rows[0]?.count ?? 0) >= count) return;
    await delay(20);
  }
  throw new Error("Native PostgreSQL lock barrier was not reached.");
}
