import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isNonArrayRecord } from "@flarex/utils/records";
import { sql } from "drizzle-orm";
import { Cause, Deferred, Effect, Exit, Fiber, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  createTaskRepairSchedulerRunV1,
  type TaskRepairSchedulerCheckpointPortV1,
} from "../../executor/src/taskRepairSchedulerRunV1";
import {
  type TaskRepairSweepReceiptV1,
  type TaskRepairSweepV1,
} from "../../executor/src/taskRepairSweepV1";
import {
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  createPostgresPersistence,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import {
  TaskRepairSchedulerConfirmedRollbackV1Error,
  createTaskRepairSchedulerCheckpointV1,
  isTaskRepairSchedulerAcquireConfirmedRollbackV1Error,
  isTaskRepairSchedulerCheckpointConfirmedRollbackV1Error,
  isTaskRepairSchedulerReleaseConfirmedRollbackV1Error,
  type TaskRepairSchedulerAcquireV1Error,
  type TaskRepairSchedulerCheckpointV1,
  type TaskRepairSchedulerCheckpointV1Error,
  type TaskRepairSchedulerConfigurationV1Error,
  type TaskRepairSchedulerReleaseV1Error,
  type TaskRepairSchedulerRunV1,
} from "../src/taskRepairSchedulerCheckpointV1";
import { TASK_REPAIR_SCHEDULER_KEY_V1 } from
  "../src/taskRepairSchedulerModelV1";
import type { SharedDatabaseScopePhysicalLocator } from
  "../src/scopeMetadataTypes";
import {
  isLocatedReadCommittedAttemptTargetV1,
} from "../src/transactionSessionAttemptKernel";
import { runEffect } from "./effectTestRuntime";
import {
  postgresUrl,
  withTemporaryPostgresSchema,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const OWNER_ONE = "7a000000-0000-4000-8000-000000000001";
const OWNER_TWO = "7a000000-0000-4000-8000-000000000002";
const locator = Object.freeze({
  kind: "shared_database",
  databaseKey: "task-repair-connected-runner-postgres",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

describe("DTE05-E2C1 PostgreSQL acceptance environment", () => {
  it("requires an authenticated PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting DTE05-E2C1.",
    ).not.toBeNull();
  });
});

describePostgres("real Postgres DTE05-E2C1 connected Task repair runner", () => {
  it("admits one claimed host and reports a duplicate host as busy", async () => {
    await withTaskRepairPostgresPersistence(async (persistence) => {
      const entered = await runEffect(Deferred.make<void>());
      const continueSweep = await runEffect(Deferred.make<void>());
      let sweeps = 0;
      const left = runner(repository(persistence, OWNER_ONE), sweep(() =>
        Effect.gen(function* () {
          sweeps += 1;
          yield* Deferred.succeed(entered, undefined);
          yield* Deferred.await(continueSweep);
          return repairReceipt(null);
        })
      ));
      const leftFiber = Effect.runFork(left.runEffect());
      await runEffect(Deferred.await(entered));

      const right = runner(
        repository(persistence, OWNER_TWO),
        sweep(() => {
          sweeps += 1;
          return Effect.succeed(repairReceipt(null));
        }),
      );
      await expect(runEffect(right.runEffect())).resolves.toMatchObject({
        kind: "busy",
      });
      await runEffect(Deferred.succeed(continueSweep, undefined));
      await expect(runEffect(Fiber.join(leftFiber))).resolves.toMatchObject({
        kind: "completed",
        reason: "sweep_completed",
      });
      expect(sweeps).toBe(1);
      expect(await row(persistence)).toMatchObject({
        scheduler_state: "idle",
        run_fence: "1",
      });
    });
  }, 60_000);

  it("keeps the old checkpoint after a pre-dispatch crash and resumes only after database expiry", async () => {
    await withTaskRepairPostgresPersistence(async (persistence) => {
      const repositoryBeforeCrash = repository(persistence, OWNER_ONE);
      const dispatched = await runEffect(Deferred.make<void>());
      const blockedPort = Object.freeze({
        ...checkpointPort(repositoryBeforeCrash),
        checkpointEffect: (_run: TaskRepairSchedulerRunV1) =>
          Deferred.succeed(dispatched, undefined).pipe(
            Effect.andThen(Effect.never),
          ),
      });
      const crashing = Result.getOrThrow(createTaskRepairSchedulerRunV1(
        blockedPort,
        sweep(() => Effect.succeed(repairReceipt(null))),
      ));
      const fiber = Effect.runFork(crashing.runEffect());
      await runEffect(Deferred.await(dispatched));
      await runEffect(Fiber.interrupt(fiber));
      const interrupted = await runEffect(Fiber.await(fiber));
      expect(Exit.isFailure(interrupted)).toBe(true);
      if (Exit.isFailure(interrupted)) {
        expect(Cause.hasInterruptsOnly(interrupted.cause)).toBe(true);
      }
      expect(await row(persistence)).toMatchObject({
        scheduler_state: "claimed",
        run_fence: "1",
        checkpoint_sequence: "0",
        continuation_bytes: null,
      });

      const takeover = runner(
        repository(persistence, OWNER_TWO),
        sweep((continuation) => {
          expect(continuation).toBeNull();
          return Effect.succeed(repairReceipt(null));
        }),
      );
      await expect(runEffect(takeover.runEffect())).resolves.toMatchObject({
        kind: "busy",
      });
      await persistence.drizzle.execute(sql`
        update fx_system_durable_task_repair_scheduler_v1
        set
          claimed_at = clock_timestamp() - interval '2 seconds',
          claim_expires_at = clock_timestamp() - interval '1 second'
        where scheduler_key = ${TASK_REPAIR_SCHEDULER_KEY_V1}
      `);
      await expect(runEffect(takeover.runEffect())).resolves.toMatchObject({
        kind: "completed",
        reason: "sweep_completed",
      });
      expect(await row(persistence)).toMatchObject({
        scheduler_state: "idle",
        run_fence: "2",
        checkpoint_sequence: "1",
      });
    });
  }, 60_000);
});

function repository(
  persistence: PostgresFlarexPersistence,
  owner: string,
): TaskRepairSchedulerCheckpointV1 {
  const target = createPostgresLocatedPointMutationSessionActivationTargetV1(
    persistence,
    locator,
  );
  if (!isLocatedReadCommittedAttemptTargetV1(target)) {
    throw new Error("Expected a located READ COMMITTED Postgres target.");
  }
  return createTaskRepairSchedulerCheckpointV1(target, {
    claimDurationMilliseconds: 60_000,
    randomUuid: () => owner,
  });
}

function checkpointPort(
  checkpoint: TaskRepairSchedulerCheckpointV1,
): TaskRepairSchedulerCheckpointPortV1<
  TaskRepairSchedulerRunV1,
  TaskRepairSchedulerConfigurationV1Error,
  TaskRepairSchedulerAcquireV1Error,
  TaskRepairSchedulerCheckpointV1Error,
  TaskRepairSchedulerReleaseV1Error,
  TaskRepairSchedulerConfirmedRollbackV1Error,
  TaskRepairSchedulerConfirmedRollbackV1Error,
  TaskRepairSchedulerConfirmedRollbackV1Error
> {
  return Object.freeze({
    ...checkpoint,
    isAcquireConfirmedRollback:
      isTaskRepairSchedulerAcquireConfirmedRollbackV1Error,
    isCheckpointConfirmedRollback:
      isTaskRepairSchedulerCheckpointConfirmedRollbackV1Error,
    isReleaseConfirmedRollback:
      isTaskRepairSchedulerReleaseConfirmedRollbackV1Error,
  });
}

function runner(
  checkpoint: TaskRepairSchedulerCheckpointV1,
  taskSweep: TaskRepairSweepV1<never>,
) {
  return Result.getOrThrow(createTaskRepairSchedulerRunV1(
    checkpointPort(checkpoint),
    taskSweep,
  ));
}

function sweep(
  runEffect: TaskRepairSweepV1<never>["runEffect"],
): TaskRepairSweepV1<never> {
  return Object.freeze({
    configuration: Object.freeze({
      maximumRunMilliseconds: 10_000,
      settlementReserveMilliseconds: 1_000,
    }),
    runEffect,
  });
}

function repairReceipt(
  continuation: TaskRepairSweepReceiptV1["continuation"],
): TaskRepairSweepReceiptV1 {
  return Object.freeze({
    version: "flarex.task-repair-sweep-receipt.v1",
    stopReason: "cycle_exhausted",
    directoryPagesRead: 1,
    partitionVisits: 1,
    partitionsFailed: 0,
    schedulerRuns: 1,
    taskPagesCharged: 1,
    candidatesCharged: 1,
    confirmedTaskPagesRead: 1,
    confirmedCandidatesHandled: 1,
    continuation,
  });
}

async function row(persistence: PostgresFlarexPersistence) {
  const result = await persistence.query<{
    readonly scheduler_state: string;
    readonly run_fence: string;
    readonly checkpoint_sequence: string;
    readonly continuation_bytes: Uint8Array | null;
  }>(
    "select scheduler_state, run_fence::text, checkpoint_sequence::text, " +
      "continuation_bytes " +
      "from fx_system_durable_task_repair_scheduler_v1",
  );
  return result.rows[0];
}

async function withTaskRepairPostgresPersistence(
  operation: (persistence: PostgresFlarexPersistence) => Promise<void>,
): Promise<void> {
  const fixture = await makeTaskRepairMigrationFixture();
  try {
    await withTemporaryPostgresSchema(async (databaseOptions) => {
      const persistence = await createPostgresPersistence({
        ...databaseOptions,
        migrationsFolder: fixture.migrationsFolder,
      });
      try {
        await persistence.migrate();
        await operation(persistence);
      } finally {
        await persistence.close();
      }
    });
  } finally {
    await fixture.cleanup();
  }
}

async function makeTaskRepairMigrationFixture() {
  const root = await mkdtemp(resolve(tmpdir(), "flarex-dte05-e2c1-pg-"));
  const migrationsFolder = resolve(root, "drizzle");
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const source = resolve(packageRoot, "drizzle");
  const journalPath = resolve(migrationsFolder, "meta/_journal.json");
  await cp(source, migrationsFolder, { recursive: true });
  const parsed: unknown = JSON.parse(await readFile(journalPath, "utf8"));
  if (!isNonArrayRecord(parsed) || !Array.isArray(parsed.entries)) {
    throw new Error("Drizzle journal must contain an entries array.");
  }
  const entries = parsed.entries.filter((entry) =>
    isNonArrayRecord(entry) && entry.idx === 48
  );
  if (entries.length !== 1) {
    throw new Error("Expected exactly one DTE05-E2A migration entry.");
  }
  await writeFile(journalPath, JSON.stringify({
    ...parsed,
    entries,
  }, null, 2), "utf8");
  return Object.freeze({
    migrationsFolder,
    cleanup: () => rm(root, { recursive: true, force: true }),
  });
}
