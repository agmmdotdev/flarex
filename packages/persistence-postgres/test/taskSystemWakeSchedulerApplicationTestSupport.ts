import { setTimeout as delay } from "node:timers/promises";

import {
  TaskSystemRunAttemptTerminalStoreError,
  decodeTaskDurationMsV1,
  decodeTaskRetryJitterV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import {
  decodeApplicationTaskRunCreationRequestV1,
  makeTaskExecutionPrincipalReferenceV1,
  makeTaskInputReferenceV1,
} from "@flarex/durable-task/internal/run-creation-v1";
import {
  makeFixedTaskRetryJitterSourceV1,
} from "@flarex/durable-task/internal/scheduling-testing-v1";
import {
  makeStandardApplicationTaskSha256V1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import { Result } from "effect";
import { expect } from "vitest";

import {
  makeApplicationTaskSystemRunCreationStore,
} from "../src/applicationTaskSystemRunCreation";
import {
  selectApplicationTask,
  type SelectedApplicationTask,
} from "../src/applicationTaskSelection";
import type { LocatedTrustedScopeAuthority } from
  "../src/scopeAuthorityResolution";
import {
  makeApplicationTaskSystemRunAttemptStoreV1,
  type LocatedTaskSystemRunAttemptTargetV1,
} from "../src/taskSystemRunAttemptStoreV1";
import {
  makeApplicationTaskSystemWakeSchedulerPartitionV1,
} from "../src/taskSystemWakeSchedulerPartitionV1";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import type {
  ApplicationNativeMutationFixture,
  ApplicationNativeMutationPersistence,
} from "./fixtures/applicationNativeMutationTestFixture";

const LEASE_DURATION_MS = 2_000;
const RETRY_DELAY_MS = 1_000;
const retryJitter = Result.getOrThrow(decodeTaskRetryJitterV1(0));

export const APPLICATION_SCHEDULER_FIXTURE_OPTIONS = Object.freeze({
  runtimeHostIdentity: "flarex.test/dte05-c3-application-scheduler",
  compatibilityDate: "2026-08-22",
  includeTask: true,
  taskRetryMinimumTimeoutInMs: RETRY_DELAY_MS,
});

export async function exerciseApplicationSchedulerParity<
  Persistence extends ApplicationNativeMutationPersistence,
>(
  fixture: ApplicationNativeMutationFixture<Persistence>,
  located: LocatedTrustedScopeAuthority<LocatedTaskSystemRunAttemptTargetV1>,
): Promise<void> {
  const selected = await runEffect(selectApplicationTask(
    fixture.active.selection,
    "tasks.users.task",
    {
      deploymentId: fixture.deploymentId,
      runtimeHostIdentity: APPLICATION_SCHEDULER_FIXTURE_OPTIONS.runtimeHostIdentity,
      compatibilityDate: APPLICATION_SCHEDULER_FIXTURE_OPTIONS.compatibilityDate,
      authority: fixture.authorityPorts,
    },
  ));
  const creation = makeApplicationTaskSystemRunCreationStore(located, {
    sha256: makeStandardApplicationTaskSha256V1(input =>
      globalThis.crypto.subtle.digest("SHA-256", input)
    ),
    leaseDurationMs: Result.getOrThrow(
      decodeTaskDurationMsV1(LEASE_DURATION_MS),
    ),
    immediateRetryThresholdMs: Result.getOrThrow(
      decodeTaskDurationMsV1(100),
    ),
    randomUuid: uuidSequence(100),
  });
  const created = await createRun(creation, selected, "primary", 0x71);
  const inspectStore = makeApplicationTaskSystemRunAttemptStoreV1(located);
  const firstScheduler = scheduler(located, uuidSequence(200));

  const started = await runEffect(firstScheduler.run({
    dueKind: "start_attempt",
    cursor: null,
  }));
  expect(started).toMatchObject({
    stopReason: "source_exhausted",
    candidatesHandled: 1,
    handled: [{
      runId: created.runId,
      disposition: "accepted",
      outcomeKind: "attempt_granted",
    }],
  });
  const granted = await runEffect(inspectStore.inspectRunAttempt({
    operation: "inspect_current_attempt",
    runId: created.runId,
  }));
  if (granted.current.phase !== "attempt_granted") {
    throw new Error("Expected the Application attempt to be granted.");
  }
  const countsAfterGrant = await taskCounts(fixture.target);

  const premature = await runEffect(firstScheduler.run({
    dueKind: "handle_lease_expiry",
    cursor: null,
  }));
  expect(premature).toMatchObject({
    stopReason: "source_exhausted",
    candidatesHandled: 0,
  });
  await expect(taskCounts(fixture.target)).resolves.toEqual(countsAfterGrant);

  await waitPast(granted.current.currentAttempt.lease.expiresAtMs);
  const expiryRuns = await Promise.all([
    runEffect(scheduler(located, uuidSequence(300)).run({
      dueKind: "handle_lease_expiry",
      cursor: null,
    })),
    runEffect(scheduler(located, uuidSequence(400)).run({
      dueKind: "handle_lease_expiry",
      cursor: null,
    })),
  ]);
  expect(expiryRuns.flatMap(run => run.handled).filter(
    receipt => receipt.disposition === "accepted",
  )).toHaveLength(1);
  const retryWaiting = await runEffect(inspectStore.inspectRunAttempt({
    operation: "inspect_current_attempt",
    runId: created.runId,
  }));
  expect(retryWaiting.current).toMatchObject({
    phase: "retry_waiting",
    runVersion: 3n,
  });
  if (retryWaiting.current.phase !== "retry_waiting") {
    throw new Error("Expected the Application run to wait for retry.");
  }

  const prematureRetry = await runEffect(firstScheduler.run({
    dueKind: "start_attempt",
    cursor: null,
  }));
  expect(prematureRetry.candidatesHandled).toBe(0);
  await waitPast(retryWaiting.current.retry.notBeforeMs);
  const reconstructed = scheduler(located, uuidSequence(500));
  const retried = await runEffect(reconstructed.run({
    dueKind: "start_attempt",
    cursor: null,
  }));
  expect(retried).toMatchObject({
    candidatesHandled: 1,
    handled: [{
      runId: created.runId,
      disposition: "accepted",
      outcomeKind: "attempt_granted",
    }],
  });
  const secondGrant = await runEffect(inspectStore.inspectRunAttempt({
    operation: "inspect_current_attempt",
    runId: created.runId,
  }));
  expect(secondGrant.current).toMatchObject({
    phase: "attempt_granted",
    runVersion: 4n,
    currentAttempt: { attemptNumber: 2 },
  });
  await expect(taskCounts(fixture.target)).resolves.toEqual({
    runs: 1,
    attempts: 2,
    effects: 12,
  });

  const firstFailed = await createRun(creation, selected, "rollback-a", 0x81);
  const secondFailed = await createRun(creation, selected, "rollback-b", 0x82);
  const injected = new Error("injected Application attempt allocation failure");
  const failedScheduler = scheduler(located, () => {
    throw injected;
  });
  const failure = await runEffectFailure(failedScheduler.run({
    dueKind: "start_attempt",
    cursor: null,
  }));
  expect(failure).toBeInstanceOf(TaskSystemRunAttemptTerminalStoreError);
  expect(failure).toMatchObject({
    operation: "start_attempt",
    runId: firstFailed.runId,
    reason: "identity_allocation_exhausted",
    cause: injected,
  });
  const [firstAfterFailure, secondAfterFailure] = await Promise.all([
    runEffect(inspectStore.inspectRunAttempt({
      operation: "inspect_current_attempt",
      runId: firstFailed.runId,
    })),
    runEffect(inspectStore.inspectRunAttempt({
      operation: "inspect_current_attempt",
      runId: secondFailed.runId,
    })),
  ]);
  expect(firstAfterFailure.current).toMatchObject({ phase: "ready", runVersion: 1n });
  expect(secondAfterFailure.current).toMatchObject({ phase: "ready", runVersion: 1n });
  await expect(taskCounts(fixture.target)).resolves.toEqual({
    runs: 3,
    attempts: 2,
    effects: 12,
  });

  let collidingAllocations = 0;
  const rollbackScheduler = scheduler(located, () => {
    collidingAllocations += 1;
    return "72000000-0000-4000-8000-000000000200";
  });
  const rollbackFailure = await runEffectFailure(rollbackScheduler.run({
    dueKind: "start_attempt",
    cursor: null,
  }));
  expect(rollbackFailure).toBeInstanceOf(TaskSystemRunAttemptTerminalStoreError);
  expect(rollbackFailure).toMatchObject({
    operation: "start_attempt",
    runId: firstFailed.runId,
    reason: "identity_allocation_exhausted",
  });
  expect(collidingAllocations).toBe(3);
  const [firstAfterRollback, secondAfterRollback] = await Promise.all([
    runEffect(inspectStore.inspectRunAttempt({
      operation: "inspect_current_attempt",
      runId: firstFailed.runId,
    })),
    runEffect(inspectStore.inspectRunAttempt({
      operation: "inspect_current_attempt",
      runId: secondFailed.runId,
    })),
  ]);
  expect(firstAfterRollback.current).toMatchObject({ phase: "ready", runVersion: 1n });
  expect(secondAfterRollback.current).toMatchObject({ phase: "ready", runVersion: 1n });
  await expect(taskCounts(fixture.target)).resolves.toEqual({
    runs: 3,
    attempts: 2,
    effects: 12,
  });

  await fixture.target.query(
    `update fx_system_scope_clock set epoch = $1 where scope_id = $2`,
    ["epoch_72000000-0000-4000-8000-000000000099", fixture.active.basis.authority.scopeId],
  );
  await expect(runEffectFailure(firstScheduler.run({
    dueKind: "start_attempt",
    cursor: null,
  }))).resolves.toMatchObject({
    _tag: "TaskSystemRunReadStaleScopeAuthorityError",
    authority: "epoch",
  });
  await expect(taskCounts(fixture.target)).resolves.toEqual({
    runs: 3,
    attempts: 2,
    effects: 12,
  });
}

function scheduler(
  located: LocatedTrustedScopeAuthority<LocatedTaskSystemRunAttemptTargetV1>,
  randomUuid: () => string,
) {
  return Result.getOrThrow(
    makeApplicationTaskSystemWakeSchedulerPartitionV1(located, {
      scheduler: {
        pageSize: 10,
        maximumPages: 2,
        maximumCandidates: 10,
      },
      retryJitter: makeFixedTaskRetryJitterSourceV1(retryJitter),
      runAttemptStore: { randomUuid },
    }),
  );
}

async function createRun(
  creation: ReturnType<typeof makeApplicationTaskSystemRunCreationStore>,
  selected: SelectedApplicationTask,
  suffix: string,
  seed: number,
) {
  return runEffect(creation.createRun(
    selected.selection,
    Result.getOrThrow(decodeApplicationTaskRunCreationRequestV1({
      version: 1,
      requestKey: `dte05-c3-${suffix}`,
      applicationTaskRuntimeTargetSha256: selected.metadata.runtimeTargetSha256,
      input: Result.getOrThrow(makeTaskInputReferenceV1(digest(seed), 19)),
      principal: Result.getOrThrow(
        makeTaskExecutionPrincipalReferenceV1(digest(seed + 1), 23),
      ),
    })),
  ));
}

async function taskCounts(persistence: ApplicationNativeMutationPersistence) {
  const result = await persistence.query<{
    runs: string | number;
    attempts: string | number;
    effects: string | number;
  }>(`
    select
      (select count(*) from fx_system_durable_task_run_v1) as runs,
      (select count(*) from fx_system_durable_task_attempt_identity_v1) as attempts,
      (select count(*) from fx_system_durable_task_requested_effect_v1) as effects
  `);
  const counts = result.rows[0];
  if (counts === undefined) throw new Error("Task counts returned no row.");
  return Object.freeze({
    runs: Number(counts.runs),
    attempts: Number(counts.attempts),
    effects: Number(counts.effects),
  });
}

async function waitPast(databaseTimeMs: number): Promise<void> {
  const remaining = databaseTimeMs - Date.now() + 100;
  if (remaining > 0) await delay(remaining);
}

function uuidSequence(start: number): () => string {
  let ordinal = start;
  return () =>
    `72000000-0000-4000-8000-${String(ordinal++).padStart(12, "0")}`;
}

function digest(value: number): Uint8Array {
  return new Uint8Array(32).fill(value);
}
