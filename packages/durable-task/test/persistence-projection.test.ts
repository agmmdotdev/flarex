import { describe, expect, it } from "vitest";
import {
  decideCompleteAttemptV1,
} from "../src/runAttempt/Layers/RunAttemptLifecycleLive.js";
import type { TaskRunAttemptAggregateV1 } from "../src/runAttempt/Model.js";
import { projectTaskRunAttemptPersistenceV1 } from "../src/runAttempt/PersistenceProjection.js";
import {
  ATTEMPT_ID,
  FENCE_1,
  LEASE_VERSION_1,
  NOW,
  RUN_ID,
  activeAggregate,
  committedDecision,
  duration,
  executingAggregate,
  readyAggregate,
} from "./support.js";

function failedCompletion(
  delayMs: number,
): TaskRunAttemptAggregateV1 {
  return committedDecision(decideCompleteAttemptV1({
    type: "complete_attempt",
    runId: RUN_ID,
    attemptId: ATTEMPT_ID,
    executionFence: FENCE_1,
    completion: {
      kind: "failed",
      failure: { kind: "task_failure", code: "handler_failed", message: null },
      retry: { kind: "override_delay", delayMs: duration(delayMs) },
      executionDurationMs: null,
    },
  }, {
    databaseNowMs: NOW,
    current: executingAggregate({ effectCursor: 8n }),
    attemptGrantCandidate: null,
  })).next;
}

function succeededCompletion(): TaskRunAttemptAggregateV1 {
  return committedDecision(decideCompleteAttemptV1({
    type: "complete_attempt",
    runId: RUN_ID,
    attemptId: ATTEMPT_ID,
    executionFence: FENCE_1,
    completion: {
      kind: "succeeded",
      result: null,
      executionDurationMs: null,
    },
  }, {
    databaseNowMs: NOW,
    current: executingAggregate({ effectCursor: 8n }),
    attemptGrantCandidate: null,
  })).next;
}

describe("DTE04-A1 run-attempt persistence projection", () => {
  it("projects each lifecycle phase through one domain-only mapping", () => {
    const initial = readyAggregate();
    const granted = activeAggregate({ phase: "attempt_granted", effectCursor: 2n });
    const executing = activeAggregate({
      phase: "executing",
      cancellation: "requested",
      effectCursor: 4n,
    });
    const retryWaiting = failedCompletion(6_000);
    const terminal = succeededCompletion();
    if (initial.phase !== "ready") {
      throw new Error("expected initial ready aggregate");
    }

    const initialProjection = projectTaskRunAttemptPersistenceV1(initial);
    expect(initialProjection).toMatchObject({
      version: "flarex.task-run-attempt-persistence-projection.v1",
      runId: initial.runId,
      taskDefinitionRevisionId: initial.taskDefinitionRevisionId,
      runVersion: initial.runVersion,
      phase: "ready",
      dueKind: "start_attempt",
      dueAtMs: initial.ready.eligibleAtMs,
      currentAttemptId: null,
      executionFenceBasis: null,
      currentLeaseVersion: null,
      currentLeaseExpiresAtMs: null,
      cancellationGeneration: 0n,
      requestedEffectSequence: 0n,
    });

    const grantedProjection = projectTaskRunAttemptPersistenceV1(granted);
    expect(grantedProjection).toMatchObject({
      phase: "attempt_granted",
      dueKind: "handle_lease_expiry",
      currentAttemptId: ATTEMPT_ID,
      executionFenceBasis: FENCE_1,
      currentLeaseVersion: LEASE_VERSION_1,
      requestedEffectSequence: 2n,
    });
    expect(grantedProjection.dueAtMs).toBe(grantedProjection.currentLeaseExpiresAtMs);

    const executingProjection = projectTaskRunAttemptPersistenceV1(executing);
    expect(executingProjection).toMatchObject({
      phase: "executing",
      dueKind: "handle_lease_expiry",
      currentAttemptId: ATTEMPT_ID,
      executionFenceBasis: FENCE_1,
      currentLeaseVersion: LEASE_VERSION_1,
      cancellationGeneration: 1n,
      requestedEffectSequence: 4n,
    });
    expect(executingProjection.dueAtMs).toBe(executingProjection.currentLeaseExpiresAtMs);

    if (retryWaiting.phase !== "retry_waiting") {
      throw new Error("expected durable retry waiting aggregate");
    }
    expect(projectTaskRunAttemptPersistenceV1(retryWaiting)).toMatchObject({
      phase: "retry_waiting",
      dueKind: "start_attempt",
      dueAtMs: retryWaiting.retry.notBeforeMs,
      currentAttemptId: null,
      executionFenceBasis: retryWaiting.retry.previousAttempt.executionFence,
      currentLeaseVersion: null,
      currentLeaseExpiresAtMs: null,
    });

    expect(projectTaskRunAttemptPersistenceV1(terminal)).toMatchObject({
      phase: "terminal",
      dueKind: null,
      dueAtMs: null,
      currentAttemptId: null,
      executionFenceBasis: null,
      currentLeaseVersion: null,
      currentLeaseExpiresAtMs: null,
    });
  });

  it("retains the previous fence for an immediate-retry ready state", () => {
    const immediateRetry = failedCompletion(1_000);
    if (immediateRetry.phase !== "ready" || immediateRetry.ready.kind !== "immediate_retry") {
      throw new Error("expected immediate-retry ready aggregate");
    }
    const projection = projectTaskRunAttemptPersistenceV1(immediateRetry);
    expect(projection).toMatchObject({
      phase: "ready",
      dueKind: "start_attempt",
      dueAtMs: immediateRetry.ready.eligibleAtMs,
      currentAttemptId: null,
      executionFenceBasis: immediateRetry.ready.acceptedRetry.previousAttempt.executionFence,
      currentLeaseVersion: null,
      currentLeaseExpiresAtMs: null,
    });
    expect(Object.isFrozen(projection)).toBe(true);
  });
});
