import { sql } from "drizzle-orm";
import { Cause, Effect, Exit } from "effect";
import type { ScopeId } from "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import type { AppRowTransaction } from "../src/appRows";
import {
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import {
  TaskRepairSchedulerConfirmedRollbackV1Error,
  TaskRepairSchedulerDecisionUncertainV1Error,
  TaskRepairSchedulerInputV1Error,
  TaskRepairSchedulerStaleV1Error,
  createTaskRepairSchedulerCheckpointV1,
  type TaskRepairSchedulerCheckpointV1,
} from "../src/taskRepairSchedulerCheckpointV1";
import { TASK_REPAIR_SCHEDULER_KEY_V1 } from
  "../src/taskRepairSchedulerModelV1";
import type { SharedDatabaseScopePhysicalLocator } from
  "../src/scopeMetadataTypes";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  isLocatedReadCommittedAttemptTargetV1,
  type LocatedReadCommittedAttemptTargetV1,
} from "../src/transactionSessionAttemptKernel";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";

const locator = Object.freeze({
  kind: "shared_database",
  databaseKey: "task-repair-scheduler-checkpoint-test",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

const OWNER_ONE = "79000000-0000-4000-8000-000000000001";
const OWNER_TWO = "79000000-0000-4000-8000-000000000002";

describe("DTE05-E2B Task repair scheduler checkpoint protocol", () => {
  it("acquires, checkpoints owned evidence, renews, releases, and reloads only the Task row", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const first = repository(persistence, [OWNER_ONE]);
    const acquired = await acquire(first);
    const input = new Uint8Array([1, 2, 3, 4]);
    const evidence = await continuationEvidence(input);

    await expect(runEffect(
      first.checkpointEffect(acquired.run, evidence),
    )).resolves.toMatchObject({ checkpointSequence: 1n });
    input.fill(99);
    evidence.canonicalBytes.fill(88);

    await expect(runEffect(first.renewEffect(acquired.run))).resolves
      .toMatchObject({ kind: "renewed" });
    await expect(runEffect(first.releaseEffect(acquired.run))).resolves
      .toMatchObject({ kind: "released" });
    expect(await runEffectFailure(first.releaseEffect(acquired.run)))
      .toBeInstanceOf(TaskRepairSchedulerInputV1Error);

    const restarted = repository(persistence, [OWNER_TWO]);
    const reloaded = await acquire(restarted);
    expect([...reloaded.continuation!.canonicalBytes]).toEqual([1, 2, 3, 4]);
    reloaded.continuation!.canonicalBytes.fill(77);
    expect([...reloaded.continuation!.canonicalBytes]).toEqual([1, 2, 3, 4]);
    expect(reloaded.run).not.toBe(acquired.run);

    expect((await taskRows(persistence))[0]).toMatchObject({
      scheduler_state: "claimed",
      run_fence: 2,
      checkpoint_sequence: 0,
    });
    const pointRows = await persistence.query<{
      readonly run_fence: number | bigint;
      readonly checkpoint_sequence: number | bigint;
    }>(
      "select run_fence, checkpoint_sequence " +
        "from fx_system_point_mutation_redelivery_scheduler",
    );
    expect(pointRows.rows[0]).toMatchObject({
      run_fence: 0,
      checkpoint_sequence: 0,
    });
  });

  it("keeps Task run handles process-local and rejects stale checkpoint state", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const first = repository(persistence, [OWNER_ONE]);
    const acquired = await acquire(first);
    const forged = Object.freeze({ _tag: "TaskRepairSchedulerRunV1" as const });

    expect(await runEffectFailure(first.renewEffect(forged))).toMatchObject({
      reason: "invalidRun",
    });
    expect(await runEffectFailure(
      repository(persistence, [OWNER_TWO]).renewEffect(acquired.run),
    )).toMatchObject({ reason: "invalidRun" });
    expect(await runEffectFailure(first.checkpointEffect(acquired.run, {
      codecVersion: 1,
      canonicalBytes: new Uint8Array([1]),
      sha256: new Uint8Array(32),
    }))).toMatchObject({ reason: "invalidContinuation" });

    await persistence.drizzle.execute(sql`
      update fx_system_durable_task_repair_scheduler_v1
      set checkpoint_sequence = 1
      where scheduler_key = ${TASK_REPAIR_SCHEDULER_KEY_V1}
    `);
    expect(await runEffectFailure(
      first.checkpointEffect(acquired.run, null),
    )).toBeInstanceOf(TaskRepairSchedulerStaleV1Error);
  });

  it("permits one exact confirmed-rollback retry and closes on command mismatch", async () => {
    const persistence = await createMigratedPGlitePersistence();
    let rejectStatements = false;
    const cause = new Error("confirmed Task checkpoint rollback");
    const repo = createTaskRepairSchedulerCheckpointV1(
      switchableStatementTarget(
        locatedTarget(persistence),
        () => rejectStatements,
        cause,
      ),
      { claimDurationMilliseconds: 60_000, randomUuid: () => OWNER_ONE },
    );
    const acquired = await acquire(repo);
    rejectStatements = true;

    expect(await runEffectFailure(repo.checkpointEffect(
      acquired.run,
      await continuationEvidence(new Uint8Array([1])),
    ))).toBeInstanceOf(TaskRepairSchedulerConfirmedRollbackV1Error);
    expect(await runEffectFailure(repo.checkpointEffect(
      acquired.run,
      await continuationEvidence(new Uint8Array([2])),
    ))).toMatchObject({ reason: "retryCommandMismatch" });
    expect(await runEffectFailure(repo.renewEffect(acquired.run)))
      .toMatchObject({ reason: "runClosed" });
    expect((await taskRows(persistence))[0]).toMatchObject({
      scheduler_state: "claimed",
      checkpoint_sequence: 0,
      continuation_bytes: null,
    });
  });

  it("distinguishes a committed but uncertain renewal and permanently closes that run", async () => {
    const persistence = await createMigratedPGlitePersistence();
    let uncertain = false;
    const repo = createTaskRepairSchedulerCheckpointV1(
      committedThenUncertainTarget(locatedTarget(persistence), () => uncertain),
      { claimDurationMilliseconds: 60_000, randomUuid: () => OWNER_ONE },
    );
    const acquired = await acquire(repo);
    uncertain = true;

    expect(await runEffectFailure(repo.renewEffect(acquired.run)))
      .toBeInstanceOf(TaskRepairSchedulerDecisionUncertainV1Error);
    expect(await runEffectFailure(repo.checkpointEffect(acquired.run, null)))
      .toMatchObject({ reason: "runClosed" });
    expect((await taskRows(persistence))[0]).toMatchObject({
      scheduler_state: "claimed",
      run_fence: 1,
    });
  });

  it("preserves unexpected callback failure as a defect and never mints a run", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const defect = new Error("unexpected Task scheduler callback defect");
    const repo = createTaskRepairSchedulerCheckpointV1(
      failingTarget(locatedTarget(persistence), Object.freeze({
        kind: "callbackRolledBack" as const,
        callbackCause: defect,
      })),
      { claimDurationMilliseconds: 60_000, randomUuid: () => OWNER_ONE },
    );
    const exit = await Effect.runPromiseExit(repo.acquireEffect());
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
    }
    expect((await taskRows(persistence))[0]).toMatchObject({
      scheduler_state: "idle",
      run_fence: 0,
    });
  });
});

function repository(
  persistence: PGliteFlarexPersistence,
  owners: readonly string[],
): TaskRepairSchedulerCheckpointV1 {
  let index = 0;
  return createTaskRepairSchedulerCheckpointV1(locatedTarget(persistence), {
    claimDurationMilliseconds: 60_000,
    randomUuid: () => owners[index++] ?? OWNER_TWO,
  });
}

function locatedTarget(
  persistence: PGliteFlarexPersistence,
): LocatedReadCommittedAttemptTargetV1 {
  const target = createPGliteLocatedPointMutationSessionActivationTargetV1(
    persistence,
    locator,
  );
  if (!isLocatedReadCommittedAttemptTargetV1(target)) {
    throw new Error("Expected a located READ COMMITTED PGlite target.");
  }
  return target;
}

async function acquire(repo: TaskRepairSchedulerCheckpointV1) {
  const result = await runEffect(repo.acquireEffect());
  if (result.kind !== "acquired") {
    throw new Error(`Expected acquisition, observed ${result.kind}.`);
  }
  return result;
}

function switchableStatementTarget(
  target: LocatedReadCommittedAttemptTargetV1,
  shouldReject: () => boolean,
  cause: unknown,
): LocatedReadCommittedAttemptTargetV1 {
  return Object.freeze({
    physicalLocator: target.physicalLocator,
    getCurrentClock: (scopeId: ScopeId) => target.getCurrentClock(scopeId),
    [RUN_LOCATED_READ_COMMITTED_V1]: <Result>(
      work: (tx: AppRowTransaction) => Promise<Result>,
    ): Promise<Result> => target[RUN_LOCATED_READ_COMMITTED_V1]((tx) =>
      work(new Proxy(tx, {
        get(inner, property, receiver) {
          if (property === "execute") {
            return (statement: Parameters<AppRowTransaction["execute"]>[0]) =>
              shouldReject()
                ? Promise.reject(cause)
                : inner.execute(statement);
          }
          return Reflect.get(inner, property, receiver);
        },
      }))
    ),
  });
}

function committedThenUncertainTarget(
  target: LocatedReadCommittedAttemptTargetV1,
  shouldBecomeUncertain: () => boolean,
): LocatedReadCommittedAttemptTargetV1 {
  return Object.freeze({
    physicalLocator: target.physicalLocator,
    getCurrentClock: (scopeId: ScopeId) => target.getCurrentClock(scopeId),
    [RUN_LOCATED_READ_COMMITTED_V1]: async <Result>(
      work: (tx: AppRowTransaction) => Promise<Result>,
    ): Promise<Result> => {
      const result = await target[RUN_LOCATED_READ_COMMITTED_V1](work);
      if (shouldBecomeUncertain()) {
        throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
          kind: "decisionUncertain",
          settlementCause: new Error("simulated lost settlement response"),
        }));
      }
      return result;
    },
  });
}

function failingTarget(
  target: LocatedReadCommittedAttemptTargetV1,
  issue: ConstructorParameters<
    typeof LocatedReadCommittedTransactionFailureV1
  >[0],
): LocatedReadCommittedAttemptTargetV1 {
  return Object.freeze({
    physicalLocator: target.physicalLocator,
    getCurrentClock: (scopeId: ScopeId) => target.getCurrentClock(scopeId),
    [RUN_LOCATED_READ_COMMITTED_V1]: async <Result>(): Promise<Result> => {
      throw new LocatedReadCommittedTransactionFailureV1(issue);
    },
  });
}

async function taskRows(persistence: PGliteFlarexPersistence) {
  return persistence.query<{
    readonly scheduler_state: string;
    readonly run_fence: number | bigint;
    readonly checkpoint_sequence: number | bigint;
    readonly continuation_bytes: Uint8Array | null;
  }>(
    "select scheduler_state, run_fence, checkpoint_sequence, " +
      "continuation_bytes " +
      "from fx_system_durable_task_repair_scheduler_v1",
  ).then((result) => result.rows);
}

async function continuationEvidence(bytes: Uint8Array) {
  const input = new Uint8Array(bytes);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", input),
  );
  return Object.freeze({
    codecVersion: 1 as const,
    canonicalBytes: input,
    sha256: digest,
  });
}
