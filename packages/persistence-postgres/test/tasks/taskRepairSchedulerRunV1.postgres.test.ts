import { sql } from "drizzle-orm";
import { Cause, Deferred, Effect, Exit, Fiber, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  createTaskRepairSchedulerRunV1,
  type TaskRepairSchedulerCheckpointPortV1,
} from "../../../executor/src/tasks/taskRepairSchedulerRunV1";
import {
  type TaskRepairSweepReceiptV1,
  type TaskRepairSweepV1,
} from "../../../executor/src/tasks/taskRepairSweepV1";
import {
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  type PostgresFlarexPersistence,
} from "../../src/database/postgres";
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
} from "../../src/tasks/taskRepairSchedulerCheckpointV1";
import { TASK_REPAIR_SCHEDULER_KEY_V1 } from
  "../../src/tasks/taskRepairSchedulerModelV1";
import { fxSystemDurableTaskRepairSchedulerV1 } from "../../src/database/schema";
import type { SharedDatabaseScopePhysicalLocator } from
  "../../src/scope/scopeMetadataTypes";
import {
  isLocatedReadCommittedAttemptTargetV1,
} from "../../src/database/locatedTransactionIdentity";
import { runEffect } from "../support/effectTestRuntime";
import {
  postgresUrl,
  useFileScopedPostgresSchedulerPersistence,
} from "../support/postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const withPersistence = useFileScopedPostgresSchedulerPersistence();
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

describePostgres("real Postgres DTE05-E2C1 connected Task repair runner", { concurrent: false }, () => {
  it("admits one claimed host and reports a duplicate host as busy", async () => {
    await withPersistence(async (persistence) => {
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
      try {
        await runEffect(Effect.raceFirst(
          Deferred.await(entered),
          Fiber.join(leftFiber).pipe(Effect.andThen(
            Effect.die("Task repair runner exited before entering its sweep"),
          )),
        ));

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
      } finally {
        await runEffect(Deferred.succeed(continueSweep, undefined));
        await runEffect(Fiber.interrupt(leftFiber));
      }
    });
  }, 60_000);

  it("keeps the old checkpoint after a pre-dispatch crash and resumes only after database expiry", async () => {
    await withPersistence(async (persistence) => {
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
      try {
        await runEffect(Effect.raceFirst(
          Deferred.await(dispatched),
          Fiber.join(fiber).pipe(Effect.andThen(
            Effect.die("Task repair runner exited before dispatching its checkpoint"),
          )),
        ));
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
      } finally {
        await runEffect(Fiber.interrupt(fiber));
      }
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
  const [result] = await persistence.drizzle.select({
    schedulerState: fxSystemDurableTaskRepairSchedulerV1.schedulerState,
    runFence: fxSystemDurableTaskRepairSchedulerV1.runFence,
    checkpointSequence:
      fxSystemDurableTaskRepairSchedulerV1.checkpointSequence,
    continuationBytes:
      fxSystemDurableTaskRepairSchedulerV1.continuationBytes,
  }).from(fxSystemDurableTaskRepairSchedulerV1);
  return result === undefined
    ? undefined
    : {
      scheduler_state: result.schedulerState,
      run_fence: String(result.runFence),
      checkpoint_sequence: String(result.checkpointSequence),
      continuation_bytes: result.continuationBytes,
    };
}
