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
import { Result } from "effect";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { admitFrameworkSchemaArtifactEffect } from
  "../src/frameworkSchema/artifact/admission";
import { prepareFrameworkSchemaArtifactAdmission } from
  "../src/frameworkSchema/artifact/repository";
import {
  executeNextFrameworkMigrationStepEffect,
  finalizeFrameworkMigrationClaimEffect,
  readFrameworkMigrationClaimProgressEffect,
  runFreshFrameworkMigrationCoordinatorEffect,
  type FrameworkMigrationClaim,
  type RunFreshFrameworkMigrationCoordinatorInput,
} from "../src/migrationCoordination/freshCoordinator";
import { makePGliteFrameworkMigrationTargetEffect } from
  "./frameworkMigrationPGliteTarget";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import { makePGliteFrameworkSchemaArtifactAdmissionFixture } from
  "./frameworkSchemaArtifactAdmissionTestSupport";
import {
  currencyArtifact,
  FRAMEWORK_VALUE_LOCATOR,
  syntheticSystemArtifact,
} from "./frameworkMigrationValueFixtures";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import { waitForFrameworkLeaseExpiry } from "./frameworkCoordinatorLeaseTestSupport";

const TEST_TIMEOUT = 180_000;

type PublicFreshCoordinatorExport = Extract<
  keyof typeof import("../src"),
  `${string}FreshFrameworkMigrationCoordinator${string}` |
    `${string}FrameworkMigrationClaim${string}`
>;

describe("private fresh framework migration coordinator", () => {
  it.each([0, 2, 4])("accounts for installation work by phase with %i extra tables", async extraTables => {
    const fixture = await createCoordinatorFixture({ extraTables });
    await assertInstallationWorkPhases(fixture.persistence.drizzle, fixture.input, "pglite");
  }, 180_000);

  it.each([0, 4])("keeps normal command work proportional to steps and edges with %i extra tables", async extraTables => {
    const fixture = await createCoordinatorFixture({ extraTables });
    await assertNormalCommandWorkingSet(fixture.input);
  }, TEST_TIMEOUT);

  it.each(normalCommandAlterations)("rolls back the normal command after an altered %s result", async alteration => {
    const fixture = await createCoordinatorFixture();
    await assertNormalCommandRollback(fixture.input, alteration);
  }, TEST_TIMEOUT);

  it.each([0, 4])("reopens the live claim without receipt or event replay with %i extra tables", async extraTables => {
    const fixture = await createCoordinatorFixture({ extraTables });
    await assertLiveClaimRestart(fixture.input);
  }, TEST_TIMEOUT);

  it("bounds continuation time and awaits cancellation cleanup", async () => {
    const fixture = await createCoordinatorFixture();
    await assertInstallerDeadline(fixture.input);
  }, 180_000);
  it("installs through the bounded installer and resumes durable state", async () => {
    const fixture = await createCoordinatorFixture();
    await assertInstallerResume(fixture.input);
  }, 180_000);

  it("explicitly verifies absent, partial and settled state without advancing it", async () => {
    const fixture = await createCoordinatorFixture();
    await assertExplicitFrameworkVerification(fixture.persistence.drizzle, fixture.input, fixture.captured.artifact);
  }, TEST_TIMEOUT);
  it("explicit verification refuses unreceipted physical structure", async () => {
    const fixture = await createCoordinatorFixture();
    await assertVerificationRefusesUnreceiptedDdl(fixture.input, fixture.captured.artifact);

  }, 180_000);

  it("keeps claims source-private and rejects forged authority", async () => {
    expectTypeOf<PublicFreshCoordinatorExport>().toEqualTypeOf<never>();
    const packageJson = await import("../package.json", {
      with: { type: "json" },
    });
    expect(Object.values(packageJson.default.exports)).not.toContain(
      "./src/migrationCoordination/freshCoordinator.ts",
    );

    // SAFETY: this deliberately bypasses the compile-time brand to exercise
    // the WeakMap-backed runtime capability boundary.
    const forged = Object.freeze({}) as FrameworkMigrationClaim;
    expect(await runEffectFailure(
      readFrameworkMigrationClaimProgressEffect(forged),
    )).toMatchObject({ reason: "invalidInput" });
    expect(await runEffectFailure(
      executeNextFrameworkMigrationStepEffect(forged),
    )).toMatchObject({ reason: "invalidInput" });
    expect(await runEffectFailure(
      finalizeFrameworkMigrationClaimEffect(forged),
    )).toMatchObject({ reason: "invalidInput" });
  });

  it("reads the exact admitted artifact before opening target state", async () => {
    const fixture = await createCoordinatorFixture({ admitArtifact: false });
    expect(await runEffectFailure(
      runFreshFrameworkMigrationCoordinatorEffect(fixture.input),
    )).toMatchObject({
      operation: "prepare",
      reason: "artifactMissing",
    });
    expect(await countRows(
      fixture.persistence,
      "fx_system_framework_schema_target_namespace",
    )).toBe(0);
    expect(await generatedTableNames(fixture.persistence)).toEqual([]);
  }, TEST_TIMEOUT);

  it("installs and replays a fifteen-step plan within the default run budget", async () => {
    const fixture = await createCoordinatorFixture({ extraTables: 4 });
    const preparation = vi.spyOn(structuralRunner, "issueRelationalStructuralRunnerTokenEffect");
    try {
      expect(await runEffect(runFreshFrameworkMigrationCoordinatorEffect(fixture.input)))
        .toMatchObject({ kind: "ready", replayed: false });
      expect(preparation).toHaveBeenCalledTimes(1);
    } finally { preparation.mockRestore(); }
    const counts = await coordinatorRootCounts(fixture.persistence);
    expect(counts.receipts).toBe(15);
    expect(await generatedTableNames(fixture.persistence)).toHaveLength(6);
    expect(await runEffect(runFreshFrameworkMigrationCoordinatorEffect(fixture.input)))
      .toMatchObject({ kind: "ready", replayed: true });
    expect(await coordinatorRootCounts(fixture.persistence)).toEqual(counts);
  }, TEST_TIMEOUT);

  it("installs a fresh relational plan and exactly replays readiness", async () => {
    const fixture = await createCoordinatorFixture();
    const ready = await runEffect(
      runFreshFrameworkMigrationCoordinatorEffect(fixture.input),
    );
    expect(ready.kind).toBe("ready");
    if (ready.kind !== "ready") throw new Error("Expected readiness");
    expect(ready.replayed).toBe(false);
    expect(ready.availability.head.frame.status).toBe("ready");
    const createdCounts = await coordinatorRootCounts(fixture.persistence);
    expect(createdCounts).toEqual({
      attempts: 1,
      availabilityHeads: 1,
      availabilityHistory: 1,
      collisions: 1,
      events: 12,
      heads: 1,
      installations: 1,
      plans: 1,
      readiness: 1,
      receipts: 7,
      targets: 1,
      terminals: 1,
    });
    expect(await generatedTableNames(fixture.persistence)).toHaveLength(2);

    const replay = await runEffect(runFreshFrameworkMigrationCoordinatorEffect({
      ...fixture.input,
      attemptId: "attempt-replay",
      leaseOwnerId: "worker-replay",
    }));
    expect(replay.kind).toBe("ready");
    if (replay.kind !== "ready") throw new Error("Expected ready replay");
    expect(replay.replayed).toBe(true);
    expect(replay.readiness.readiness.sha256).toBe(
      ready.readiness.readiness.sha256,
    );
    expect(await coordinatorRootCounts(fixture.persistence)).toEqual(
      createdCounts,
    );
  }, TEST_TIMEOUT);

  it("returns bounded progress and resumes the exact stored attempt", async () => {
    const fixture = await createCoordinatorFixture();
    const interrupted = await runEffect(
      runFreshFrameworkMigrationCoordinatorEffect({
        ...fixture.input,
        maximumStepsPerRun: 2,
      }),
    );
    expect(interrupted.kind).toBe("pending");
    if (interrupted.kind !== "pending") throw new Error("Expected progress");
    expect(interrupted.completedStepCount).toBe(2);
    expect(interrupted.requiredStepCount).toBe(7);
    await assertPersistedHeadProgress(fixture.persistence.drizzle, 2);
    await assertHeadProgressMigration(fixture.persistence.drizzle);
    await assertHeadProgressCorruption(fixture.persistence.drizzle, () => runEffect(readFrameworkMigrationClaimProgressEffect(interrupted.claim)));
    expect(await runEffect(readFrameworkMigrationClaimProgressEffect(
      interrupted.claim,
    ))).toEqual({ completedStepCount: 2, requiredStepCount: 7 });

    const third = await runEffect(
      executeNextFrameworkMigrationStepEffect(interrupted.claim),
    );
    expect(third.kind).toBe("step");
    if (third.kind !== "step") throw new Error("Expected a step receipt");
    expect(third.completedStepCount).toBe(3);
    await assertPersistedHeadProgress(fixture.persistence.drizzle, 3);

    const completed = await runEffect(
      runFreshFrameworkMigrationCoordinatorEffect(fixture.input),
    );
    expect(completed.kind).toBe("ready");
    expect(await countRows(
      fixture.persistence,
      "fx_system_framework_migration_step_receipt",
    )).toBe(7);
  }, TEST_TIMEOUT);

  it("reports a live owner as busy", async () => {
    const fixture = await createCoordinatorFixture();
    const held = await runEffect(runFreshFrameworkMigrationCoordinatorEffect({
      ...fixture.input,
      maximumStepsPerRun: 0,
    }));
    expect(held.kind).toBe("pending");
    const competing = await runEffect(
      runFreshFrameworkMigrationCoordinatorEffect({
        ...fixture.input,
        attemptId: "attempt-b",
        leaseOwnerId: "worker-b",
        maximumStepsPerRun: 0,
      }),
    );
    expect(competing).toMatchObject({
      kind: "busy",
      attemptId: "attempt-a",
      leaseOwnerId: "worker-a",
    });
  }, TEST_TIMEOUT);

  it("takes over committed partial progress and fences the expired claim", async () => {
    const fixture = await createCoordinatorFixture();
    const first = await runEffect(runFreshFrameworkMigrationCoordinatorEffect({
      ...fixture.input,
      leaseDurationMilliseconds: 10_000,
      maximumStepsPerRun: 3,
    }));
    expect(first.kind).toBe("pending");
    if (first.kind !== "pending") throw new Error("Expected first claim");
    expect(first.completedStepCount).toBe(3);
    const originals = await fixture.persistence.query("select receipt_storage_id::text, encode(canonical_bytes, 'hex') as bytes from fx_system_framework_migration_step_receipt order by receipt_storage_id");
    await waitForFrameworkLeaseExpiry(fixture.persistence, fixture.input.attemptId);

    const idleSuccessor = await runEffect(runFreshFrameworkMigrationCoordinatorEffect({
      ...fixture.input, attemptId: "attempt-b", leaseOwnerId: "worker-b",
      leaseDurationMilliseconds: 10_000, maximumStepsPerRun: 0,
    }));
    expect(idleSuccessor).toMatchObject({ kind: "pending", completedStepCount: 3 });
    expect(await countRows(fixture.persistence, "fx_system_framework_migration_step_receipt")).toBe(3);
    await waitForFrameworkLeaseExpiry(fixture.persistence, "attempt-b");
    const takeover = await runEffect(
      runFreshFrameworkMigrationCoordinatorEffect({
        ...fixture.input,
        attemptId: "attempt-c",
        leaseOwnerId: "worker-c",
      }),
    );
    expect(takeover.kind).toBe("ready");
    if (takeover.kind !== "ready") throw new Error("Expected completed takeover");
    const reference = installationBindingReference(takeover.availability);
    const prepared = await runEffect(prepareInstallationRuntime(fixture.persistence.drizzle, fixture.input.target.schema, reference));
    const accepted = await fixture.persistence.drizzle.transaction(tx => runEffect(
      acceptPreparedInstallation(prepared, fixture.input.target.schema, reference, tx),
    ));
    expect(accepted.readiness).toEqual(takeover.readiness.readiness.frame);
    const completed = await fixture.persistence.query("select receipt_storage_id::text, encode(canonical_bytes, 'hex') as bytes from fx_system_framework_migration_step_receipt order by receipt_storage_id");
    expect(completed.rows.slice(0, 3)).toEqual(originals.rows);
    const events = await fixture.persistence.query("select subject_sha256 from fx_system_framework_migration_event where event_kind = 'stepCompleted'");
    expect(events.rows).toHaveLength(7);
    expect(await countRows(
      fixture.persistence,
      "fx_system_framework_migration_step_receipt",
    )).toBe(7);
    expect(await runEffectFailure(
      executeNextFrameworkMigrationStepEffect(first.claim),
    )).toMatchObject({ reason: "staleFence" });
    const attempts = await fixture.persistence.query<{
      attempt_fence: string;
      attempt_id: string;
    }>(`
      select attempt_id, attempt_fence::text
      from fx_system_framework_migration_attempt_start
      order by attempt_fence
    `);
    expect(attempts.rows).toEqual([
      { attempt_id: "attempt-a", attempt_fence: "1" },
      { attempt_id: "attempt-b", attempt_fence: "2" },
      { attempt_id: "attempt-c", attempt_fence: "3" },
    ]);
    const terminals = await fixture.persistence.query<{
      outcome_kind: string;
      failure_reason: string | null;
    }>(`
      select outcome_kind, failure_reason
      from fx_system_framework_migration_attempt_terminal
      order by terminal_storage_id
    `);
    expect(terminals.rows).toEqual([
      { outcome_kind: "failed", failure_reason: "leaseLost" },
      { outcome_kind: "failed", failure_reason: "leaseLost" },
      { outcome_kind: "succeeded", failure_reason: null },
    ]);
  }, TEST_TIMEOUT);

  it("returns stable not_ready without publication after validation drift", async () => {
    const fixture = await createCoordinatorFixture();
    const structural = await runEffect(
      runFreshFrameworkMigrationCoordinatorEffect({
        ...fixture.input,
        maximumStepsPerRun: 6,
      }),
    );
    expect(structural.kind).toBe("pending");
    const indexes = await fixture.persistence.query<{
      indexdef: string;
      indexname: string;
    }>(`
      select indexname, indexdef
      from pg_indexes
      where schemaname = 'flarex_shared'
        and indexdef not like 'CREATE UNIQUE INDEX%'
    `);
    const ordinaryIndex = indexes.rows[0];
    if (ordinaryIndex === undefined) throw new Error("Expected ordinary index");
    await fixture.persistence.query(
      `drop index "flarex_shared".${identifier(ordinaryIndex.indexname)}`,
    );

    const refused = await runEffect(
      runFreshFrameworkMigrationCoordinatorEffect(fixture.input),
    );
    expect(refused).toEqual({
      kind: "not_ready",
      reason: "structureMismatch",
    });
    expect(await coordinatorPublicationCounts(fixture.persistence)).toEqual({
      availabilityHeads: 0,
      availabilityHistory: 0,
      installations: 0,
      readiness: 0,
      terminals: 0,
    });
    expect(await countRows(
      fixture.persistence,
      "fx_system_framework_migration_step_receipt",
    )).toBe(6);
  }, TEST_TIMEOUT);

  it("fails closed on a corrupt stored receipt", async () => {
    const fixture = await createCoordinatorFixture();
    const first = await runEffect(runFreshFrameworkMigrationCoordinatorEffect({
      ...fixture.input,
      maximumStepsPerRun: 1,
    }));
    expect(first.kind).toBe("pending");
    await administrativelyRepairFrameworkMetadata(fixture.persistence.drizzle, ["fx_system_framework_migration_step_receipt"], async repairTransaction => repairTransaction.execute(sql.raw(`
      update fx_system_framework_migration_step_receipt
      set canonical_bytes = set_byte(
        canonical_bytes,
        0,
        (get_byte(canonical_bytes, 0) + 1) % 256
      )
    `)));
    expect(await runEffectFailure(
      runFreshFrameworkMigrationCoordinatorEffect(fixture.input),
    )).toMatchObject({ reason: "storedCorruption" });
    expect(await coordinatorPublicationCounts(fixture.persistence)).toEqual({
      availabilityHeads: 0,
      availabilityHistory: 0,
      installations: 0,
      readiness: 0,
      terminals: 0,
    });
  }, TEST_TIMEOUT);

  it("reissues exact stored relational authority for capability-rich artifacts", async () => {
    const fixture = await createCoordinatorFixture({ artifact: "currency" });
    const ready = await runEffect(
      runFreshFrameworkMigrationCoordinatorEffect(fixture.input),
    );
    expect(ready.kind).toBe("ready");
    expect(await generatedTableNames(fixture.persistence)).toHaveLength(1);
  }, TEST_TIMEOUT);

  it.each([
    ["preparation", 1],
    ["readiness reread", 2],
    ["claim", 3],
  ] as const)(
    "recovers a committed-but-unacknowledged %s transaction",
    async (_phase, transactionCall) => {
      const fixture = await createCoordinatorFixture({ targetFaults: true });
      if (fixture.faults === null) throw new Error("Expected fault control");
      fixture.faults.armAtCall(transactionCall, "committed");
      const claimed = await runEffect(
        runFreshFrameworkMigrationCoordinatorEffect({
          ...fixture.input,
          maximumStepsPerRun: 0,
        }),
      );
      expect(claimed.kind).toBe("pending");
      expect(await countRows(
        fixture.persistence,
        "fx_system_framework_migration_attempt_start",
      )).toBe(1);
      expect(await countRows(
        fixture.persistence,
        "fx_system_framework_migration_event",
      )).toBe(2);
    },
    TEST_TIMEOUT,
  );

  it("recovers rolled-back step, complete-prefix, and finalization settlements", async () => {
    const fixture = await createCoordinatorFixture({ targetFaults: true });
    if (fixture.faults === null) throw new Error("Expected fault control");
    const claimed = await runEffect(runFreshFrameworkMigrationCoordinatorEffect({
      ...fixture.input,
      maximumStepsPerRun: 0,
    }));
    if (claimed.kind !== "pending") throw new Error("Expected claim");
    const nextStep = executeNextFrameworkMigrationStepEffect(claimed.claim);

    fixture.faults.armNext("rollback");
    const recoveredStep = await runEffect(
      nextStep,
    );
    expect(recoveredStep.kind).toBe("step");
    expect(await countRows(
      fixture.persistence,
      "fx_system_framework_migration_step_receipt",
    )).toBe(1);

    fixture.faults.armNext("committed");
    const committedStep = await runEffect(
      nextStep,
    );
    expect(committedStep.kind).toBe("step");
    if (committedStep.kind !== "step") throw new Error("Expected committed step");
    expect(committedStep.completedStepCount).toBe(2);
    expect(await countRows(
      fixture.persistence,
      "fx_system_framework_migration_step_receipt",
    )).toBe(2);

    for (let completed = 2; completed < 7; completed += 1) {
      const progress = await runEffect(
        nextStep,
      );
      expect(progress.kind).toBe("step");
    }
    fixture.faults.armNext("committed");
    expect(await runEffect(
      nextStep,
    )).toEqual({
      kind: "complete",
      completedStepCount: 7,
      requiredStepCount: 7,
    });

    fixture.faults.armNext("committed");
    const ready = await runEffect(
      finalizeFrameworkMigrationClaimEffect(claimed.claim),
    );
    expect(ready.kind).toBe("ready");
    expect(await coordinatorPublicationCounts(fixture.persistence)).toEqual({
      availabilityHeads: 1,
      availabilityHistory: 1,
      installations: 1,
      readiness: 1,
      terminals: 1,
    });
  }, TEST_TIMEOUT);
});

async function createCoordinatorFixture(
  options: Readonly<{
    readonly admitArtifact?: boolean;
    readonly artifact?: "synthetic" | "currency";
    readonly targetFaults?: boolean;
    readonly extraTables?: number;
  }> = {},
) {
  const persistence = await createMigratedPGlitePersistence();
  await persistence.query(`
    insert into deployments (deployment_id, project_id)
    values ('deployment-a', 'project-a')
  `);
  const captured = options.artifact === "currency"
    ? await currencyArtifact()
    : await syntheticSystemArtifact(options.extraTables);
  const artifactFixture =
    makePGliteFrameworkSchemaArtifactAdmissionFixture(persistence);
  const prepared = prepareFrameworkSchemaArtifactAdmission(captured.artifact);
  if (Result.isFailure(prepared)) throw prepared.failure;
  if (options.admitArtifact !== false) {
    await runEffect(admitFrameworkSchemaArtifactEffect(
      artifactFixture.repository,
      prepared.success,
    ));
  }
  await persistence.query(`create schema "flarex_shared"`);
  await persistence.query(`
    create table "flarex_shared"."fx_system_scope_clock" (
      scope_uuid uuid not null,
      constraint "fx_system_scope_clock_scope_uuid_unique"
        unique (scope_uuid)
    )
  `);
  const faults = options.targetFaults === true
    ? makeTargetTransactionFaultController(persistence.drizzle)
    : null;
  const target = await runEffect(makePGliteFrameworkMigrationTargetEffect({
    persistence: { drizzle: faults?.database ?? persistence.drizzle },
    deploymentId: "deployment-a",
    canonicalPhysicalDatabaseIdentity: "pglite://fresh-coordinator",
    physicalLocator: FRAMEWORK_VALUE_LOCATOR,
  }));
  const input = Object.freeze({
    artifactRepository: artifactFixture.repository,
    artifactIdentity: captured.artifact.identity,
    target,
    attemptId: "attempt-a",
    leaseOwnerId: "worker-a",
    leaseDurationMilliseconds: 120_000,
    lockTimeoutMilliseconds: 5_000,
    statementTimeoutMilliseconds: 30_000,
  } satisfies RunFreshFrameworkMigrationCoordinatorInput);
  return Object.freeze({
    persistence,
    captured,
    artifactFixture,
    target,
    input,
    faults,
  });
}

type CoordinatorPersistence = Awaited<
  ReturnType<typeof createMigratedPGlitePersistence>
>;

async function countRows(
  persistence: CoordinatorPersistence,
  table: string,
): Promise<number> {
  const result = await persistence.query<{ count: string }>(
    `select count(*)::text as count from ${table}`,
  );
  return Number(result.rows[0]?.count ?? Number.NaN);
}

async function generatedTableNames(
  persistence: CoordinatorPersistence,
): Promise<readonly string[]> {
  const result = await persistence.query<{ table_name: string }>(`
    select table_name
    from information_schema.tables
    where table_schema = 'flarex_shared'
      and table_name <> 'fx_system_scope_clock'
    order by table_name
  `);
  return result.rows.map(row => row.table_name);
}

async function coordinatorRootCounts(persistence: CoordinatorPersistence) {
  return {
    attempts: await countRows(
      persistence,
      "fx_system_framework_migration_attempt_start",
    ),
    availabilityHeads: await countRows(
      persistence,
      "fx_system_framework_schema_availability_head",
    ),
    availabilityHistory: await countRows(
      persistence,
      "fx_system_framework_schema_availability_history",
    ),
    collisions: await countRows(
      persistence,
      "fx_system_framework_migration_collision_domain",
    ),
    events: await countRows(
      persistence,
      "fx_system_framework_migration_event",
    ),
    heads: await countRows(
      persistence,
      "fx_system_framework_migration_collision_head",
    ),
    installations: await countRows(
      persistence,
      "fx_system_framework_schema_installation",
    ),
    plans: await countRows(
      persistence,
      "fx_system_framework_migration_plan",
    ),
    readiness: await countRows(
      persistence,
      "fx_system_framework_schema_readiness",
    ),
    receipts: await countRows(
      persistence,
      "fx_system_framework_migration_step_receipt",
    ),
    targets: await countRows(
      persistence,
      "fx_system_framework_schema_target_namespace",
    ),
    terminals: await countRows(
      persistence,
      "fx_system_framework_migration_attempt_terminal",
    ),
  };
}

async function coordinatorPublicationCounts(
  persistence: CoordinatorPersistence,
) {
  return {
    availabilityHeads: await countRows(
      persistence,
      "fx_system_framework_schema_availability_head",
    ),
    availabilityHistory: await countRows(
      persistence,
      "fx_system_framework_schema_availability_history",
    ),
    installations: await countRows(
      persistence,
      "fx_system_framework_schema_installation",
    ),
    readiness: await countRows(
      persistence,
      "fx_system_framework_schema_readiness",
    ),
    terminals: await countRows(
      persistence,
      "fx_system_framework_migration_attempt_terminal",
    ),
  };
}

function identifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

type TargetTransactionFaultMode = "rollback" | "committed";

function makeTargetTransactionFaultController<Database extends object>(
  database: Database,
) {
  let transactionCalls = 0;
  let armed:
    | Readonly<{ readonly call: number; readonly mode: TargetTransactionFaultMode }>
    | undefined;
  const injected = new Error("Injected migration transaction settlement loss");
  const proxy = new Proxy(database, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property !== "transaction" || typeof value !== "function") {
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (...args: readonly unknown[]) => {
        transactionCalls += 1;
        const fault = armed?.call === transactionCalls ? armed : undefined;
        if (fault !== undefined) armed = undefined;
        if (fault?.mode === "rollback") {
          const callback = args[0];
          if (typeof callback !== "function") {
            throw new Error("Expected a transaction callback");
          }
          const wrapped = async (transaction: unknown) => {
            await Reflect.apply(callback, undefined, [transaction]);
            throw injected;
          };
          return Reflect.apply(value, target, [wrapped, ...args.slice(1)]);
        }
        const result = Reflect.apply(value, target, args);
        return fault?.mode === "committed"
          ? Promise.resolve(result).then(() => Promise.reject(injected))
          : result;
      };
    },
  });
  return Object.freeze({
    database: proxy,
    armAtCall(call: number, mode: TargetTransactionFaultMode): void {
      armed = Object.freeze({ call, mode });
    },
    armNext(mode: TargetTransactionFaultMode): void {
      armed = Object.freeze({ call: transactionCalls + 1, mode });
    },
  });
}
