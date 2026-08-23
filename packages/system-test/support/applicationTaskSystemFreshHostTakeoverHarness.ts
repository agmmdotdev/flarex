import {
  encodeApplicationTaskRunAttemptAggregateJsonV1,
  type ApplicationTaskSystemRunAttemptStoreShape,
  type TaskResultCommitmentV1,
  type TaskRunIdV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import type {
  ApplicationTaskAttemptLifecycleCapability,
} from "@flarex/persistence-postgres/internal/task-attempt-lifecycle-gateway";
import type {
  ApplicationTaskSystemWakeSchedulerPartitionV1,
} from "@flarex/persistence-postgres/internal/task-wake-scheduler-partition-v1";
import type {
  ApplicationTaskDeliveryEventHost,
} from
  "@flarex/standard-application-invocation/internal/system-test/application-task-delivery-event-host";
import type {
  StoredTaskResult,
  TaskResultStoreError,
} from "flarex-backend/internal/task-result-store";
import { Clock, Duration, Effect, Fiber, Result } from "effect";
import { expect } from "vitest";

interface FreshHostWorkerProbe {
  readonly loads: number;
  readonly starts: number;
  readonly workerInputReads: number;
  readonly workerSettlements: number;
  readonly generations: readonly string[];
  readonly payloads: readonly unknown[];
  readonly awaitAcceptedStart: () => Promise<void>;
  readonly releaseSettlement: () => void;
}

export interface ApplicationTaskSystemFreshHostTakeoverContext {
  readonly runId: TaskRunIdV1;
  readonly expectedInput: unknown;
  readonly expectedResult: unknown;
  readonly hostA: ApplicationTaskDeliveryEventHost;
  readonly hostB: ApplicationTaskDeliveryEventHost;
  readonly loaderA: FreshHostWorkerProbe;
  readonly loaderB: FreshHostWorkerProbe;
  readonly lifecycle: ApplicationTaskSystemRunAttemptStoreShape;
  readonly scheduler: ApplicationTaskSystemWakeSchedulerPartitionV1;
  readonly hostALifecycle: Effect.Effect<
    ApplicationTaskAttemptLifecycleCapability
  >;
  readonly readResult: (
    reference: TaskResultCommitmentV1,
  ) => Effect.Effect<StoredTaskResult, TaskResultStoreError>;
}

export const proveApplicationTaskSystemFreshHostTakeoverEffect: (
  context: ApplicationTaskSystemFreshHostTakeoverContext,
) => Effect.Effect<void> = Effect.fn(
  "SystemTest.proveApplicationTaskSystemFreshHostTakeover",
)(function* (context: ApplicationTaskSystemFreshHostTakeoverContext) {
  const hostARun = yield* context.hostA.run(null).pipe(Effect.forkChild);
  yield* Effect.promise(() => context.loaderA.awaitAcceptedStart()).pipe(
    Effect.timeout("10 seconds"),
  );
  const executingA = yield* waitForPhase(
    context.lifecycle,
    context.runId,
    "executing",
  );
  if (executingA.current.phase !== "executing") {
    return yield* Effect.die(
      new Error("Host A executing-state refinement was lost."),
    );
  }
  const oldLifecycle = yield* context.hostALifecycle.pipe(
    Effect.timeout("10 seconds"),
  );

  yield* Fiber.interrupt(hostARun);
  expect(context.loaderA.loads).toBe(1);
  expect(context.loaderA.starts).toBe(1);
  expect(context.loaderA.workerSettlements).toBe(0);

  const beforeExpiry = yield* context.hostB.run(null);
  expect(beforeExpiry.receipt).toMatchObject({
    runner: {
      confirmedDispatchCandidatesHandled: 0,
      confirmedDispatchProviderCalls: 0,
      candidateFailures: 0,
    },
    supervision: { expected: 0, observed: 0 },
  });
  expect(context.loaderB.loads).toBe(0);
  expect(context.loaderB.starts).toBe(0);

  const prematureExpiry = yield* context.scheduler.run({
    dueKind: "handle_lease_expiry",
    cursor: null,
  });
  expect(prematureExpiry.candidatesHandled).toBe(0);

  const expired = yield* waitForSchedulerAcceptance(
    context.scheduler,
    "handle_lease_expiry",
  );
  expect(expired).toMatchObject({
    candidatesHandled: 1,
    handled: [{
      runId: context.runId,
      disposition: "accepted",
      outcomeKind: "retry_scheduled",
    }],
  });
  const retryWaiting = yield* context.lifecycle.inspectRunAttempt({
    operation: "inspect_current_attempt",
    runId: context.runId,
  });
  if (retryWaiting.current.phase !== "retry_waiting") {
    return yield* Effect.die(
      new Error("Fresh-host takeover did not enter durable retry waiting."),
    );
  }

  const prematureRetry = yield* context.scheduler.run({
    dueKind: "start_attempt",
    cursor: null,
  });
  expect(prematureRetry.candidatesHandled).toBe(0);
  const restarted = yield* waitForSchedulerAcceptance(
    context.scheduler,
    "start_attempt",
  );
  expect(restarted).toMatchObject({
    candidatesHandled: 1,
    handled: [{
      runId: context.runId,
      disposition: "accepted",
      outcomeKind: "attempt_granted",
    }],
  });
  const grantedB = yield* context.lifecycle.inspectRunAttempt({
    operation: "inspect_current_attempt",
    runId: context.runId,
  });
  expect(grantedB.current).toMatchObject({
    phase: "attempt_granted",
    currentAttempt: { attemptNumber: 2 },
  });

  const hostBRun = yield* context.hostB.run(null).pipe(Effect.forkChild);
  yield* Effect.promise(() => context.loaderB.awaitAcceptedStart()).pipe(
    Effect.timeout("10 seconds"),
  );
  const executingB = yield* waitForPhase(
    context.lifecycle,
    context.runId,
    "executing",
  );
  const beforeStaleEvidence = Result.getOrThrow(
    encodeApplicationTaskRunAttemptAggregateJsonV1(executingB.current),
  );

  const staleHeartbeat = yield* oldLifecycle.heartbeat(99);
  expect(staleHeartbeat).toMatchObject({
    disposition: "current",
    outcome: { kind: "current", reason: "stale_attempt" },
  });
  const staleCompletion = yield* oldLifecycle.complete({
    kind: "failed",
    failure: {
      kind: "task_failure",
      code: "handler_failed",
      message: null,
    },
    retry: { kind: "do_not_retry" },
    executionDurationMs: null,
  });
  expect(staleCompletion).toMatchObject({
    disposition: "current",
    outcome: { kind: "current", reason: "stale_attempt" },
  });
  const afterStaleEvidence = yield* context.lifecycle.inspectRunAttempt({
    operation: "inspect_current_attempt",
    runId: context.runId,
  });
  expect(Result.getOrThrow(
    encodeApplicationTaskRunAttemptAggregateJsonV1(afterStaleEvidence.current),
  )).toEqual(beforeStaleEvidence);

  context.loaderB.releaseSettlement();
  const hostedB = yield* Fiber.join(hostBRun);
  expect(hostedB.receipt).toMatchObject({
    runner: {
      confirmedDispatchCandidatesHandled: 1,
      confirmedDispatchProviderCalls: 1,
      candidateFailures: 0,
    },
    supervision: {
      expected: 1,
      observed: 1,
      succeeded: 1,
      failed: 0,
    },
  });
  const terminal = yield* context.lifecycle.inspectRunAttempt({
    operation: "inspect_current_attempt",
    runId: context.runId,
  });
  if (
    terminal.current.phase !== "terminal" ||
    terminal.current.terminal.kind !== "succeeded" ||
    terminal.current.terminal.result === null
  ) {
    return yield* Effect.die(
      new Error("Fresh host B did not settle the replacement attempt."),
    );
  }
  const stored = yield* context.readResult(terminal.current.terminal.result);
  expect(stored.value).toEqual(context.expectedResult);
  expect(context.loaderB.loads).toBe(1);
  expect(context.loaderB.starts).toBe(1);
  expect(context.loaderB.workerInputReads).toBe(1);
  expect(context.loaderB.workerSettlements).toBe(1);
  expect(context.loaderB.generations).toEqual(["application_v1"]);
  expect(context.loaderB.payloads).toEqual([context.expectedInput]);
}, Effect.orDie);

const waitForPhase = Effect.fn("SystemTest.waitForTaskAttemptPhase")(
  function* (
    lifecycle: ApplicationTaskSystemRunAttemptStoreShape,
    runId: TaskRunIdV1,
    phase: "executing",
  ) {
    const deadline = (yield* Clock.currentTimeMillis) + 10_000;
    while (true) {
      const snapshot = yield* lifecycle.inspectRunAttempt({
        operation: "inspect_current_attempt",
        runId,
      });
      if (snapshot.current.phase === phase) return snapshot;
      if ((yield* Clock.currentTimeMillis) >= deadline) {
        return yield* Effect.die(
          new Error(
            `Task attempt did not reach ${phase} before the proof deadline.`,
          ),
        );
      }
      yield* Effect.sleep(Duration.millis(20));
    }
  },
);

const waitForSchedulerAcceptance = Effect.fn(
  "SystemTest.waitForTaskSchedulerAcceptance",
)(function* (
  scheduler: ApplicationTaskSystemWakeSchedulerPartitionV1,
  dueKind: "handle_lease_expiry" | "start_attempt",
) {
  const deadline = (yield* Clock.currentTimeMillis) + 45_000;
  while (true) {
    const receipt = yield* scheduler.run({ dueKind, cursor: null });
    if (receipt.candidatesHandled > 0) return receipt;
    if ((yield* Clock.currentTimeMillis) >= deadline) {
      return yield* Effect.die(
        new Error(
          `Task scheduler did not accept ${dueKind} before the proof deadline.`,
        ),
      );
    }
    yield* Effect.sleep(Duration.millis(50));
  }
});
