import {
  TASK_COMPUTE_DISPATCH_REQUEST_VERSION_V1,
  validateTaskComputeDispatchRequestV1,
  type CurrentTaskComputeDispatchRequestV1,
} from "@flarex/durable-task/internal/compute-provider-v1";
import {
  decodeTaskResultCommitmentV1,
  decodeTaskAttemptCompletionV1,
  decodeTaskHeartbeatSequenceV1,
  TaskSystemRunAttemptTransientStoreError,
  type CompleteAttemptOutcomeV1,
  type HeartbeatAttemptOutcomeV1,
  type TaskAttemptCompletionV1,
  type TaskSystemRunAttemptTransactionReceiptV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import type {
  LegacyTaskAttemptLifecycleCapability,
} from "@flarex/persistence-postgres/internal/task-attempt-lifecycle-gateway";
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Result,
} from "effect";
import { TestClock } from "effect/testing";
import {
  LEGACY_TASK_WORKER_RESULT_FORMAT_V1,
  LEGACY_TASK_WORKER_RESULT_VERSION_V1,
} from "flarex-protocol/internal/legacy-task-worker-v1";
import {
  TASK_WORKER_SESSION_ACCEPTANCE_FORMAT_V1,
  TASK_WORKER_SESSION_ACCEPTANCE_VERSION_V1,
  TASK_WORKER_SESSION_SETTLEMENT_FORMAT_V1,
  TASK_WORKER_SESSION_SETTLEMENT_VERSION_V1,
  decodeTaskWorkerSessionAcceptanceV1,
  decodeTaskWorkerSessionSettlementV1,
  type TaskWorkerSessionSettlementV1,
} from "flarex-protocol/internal/task-worker-session-v1";
import { describe, expect, it } from "vitest";

import type {
  TaskExecutionSession,
  TaskExecutionSessionSettlement,
} from "../src/taskComputeDelivery/TaskExecutionSession.js";
import { adaptWorkerLoaderTaskExecutionSession } from
  "../src/taskComputeDelivery/WorkerLoaderTaskExecutionSession.js";
import type { TaskResultStore } from
  "../src/taskResult/TaskResultStore.js";
import {
  makeTaskAttemptSupervisor,
  TaskAttemptSupervisorConfigurationError,
  TaskAttemptSupervisorContractError,
  TaskAttemptSupervisorOperationTimeoutError,
} from "../src/taskComputeDelivery/TaskAttemptSupervisor.js";

describe("DTE06-E4 TaskAttemptSupervisor", () => {
  it("runs immediate and periodic heartbeats beside terminal publication", async () => {
    const dispatch = legacyDispatch();
    const completionGate = Deferred.makeUnsafe<TaskWorkerSessionSettlementV1>();
    const firstHeartbeat = Deferred.makeUnsafe<void>();
    const secondHeartbeat = Deferred.makeUnsafe<void>();
    const heartbeatSequences: number[] = [];
    const completions: TaskAttemptCompletionV1[] = [];
    let closeCount = 0;
    const lifecycle = legacyLifecycle(dispatch, {
      heartbeat: sequence => Effect.sync(() => {
        const decoded = Result.getOrThrow(
          decodeTaskHeartbeatSequenceV1(sequence),
        );
        heartbeatSequences.push(decoded);
        if (decoded === 1) {
          Deferred.doneUnsafe(firstHeartbeat, Effect.void);
        }
        if (decoded === 2) {
          Deferred.doneUnsafe(secondHeartbeat, Effect.void);
        }
        return heartbeatReceipt(decoded, 1_000 + decoded * 1_000);
      }),
      complete: completion => Effect.sync(() => {
        const decoded = Result.getOrThrow(
          decodeTaskAttemptCompletionV1(completion),
        );
        completions.push(decoded);
        return completionReceipt(decoded);
      }),
    });
    const store = resultStore();
    const session = taskSession(
      dispatch,
      Deferred.await(completionGate),
      () => { closeCount += 1; },
    );
    const supervisor = Result.getOrThrow(makeTaskAttemptSupervisor(
      { resolve: () => Effect.succeed(lifecycle) },
      store,
      policy(),
    ));

    const outcome = await Effect.runPromise(Effect.gen(function* () {
      const fiber = yield* supervisor.supervise({ dispatch, session }).pipe(
        Effect.forkChild,
      );
      yield* Deferred.await(firstHeartbeat);
      yield* TestClock.adjust(1_000);
      yield* Deferred.await(secondHeartbeat);
      Deferred.doneUnsafe(
        completionGate,
        Effect.succeed(successfulSettlement(dispatch)),
      );
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.layer())));

    expect(outcome).toMatchObject({
      kind: "completed",
      completionKind: "succeeded",
      lifecycleOutcome: "terminal_succeeded",
    });
    expect(heartbeatSequences).toEqual([1, 2]);
    expect(completions).toHaveLength(1);
    expect(completions[0]).toMatchObject({
      kind: "succeeded",
      result: { codec: "flarex.task-result.v1", byteLength: 1 },
    });
    expect(closeCount).toBe(1);
  });

  it("stops heartbeats as soon as terminal evidence arrives before publication", async () => {
    const dispatch = legacyDispatch();
    const settlementGate = Deferred.makeUnsafe<TaskWorkerSessionSettlementV1>();
    const publicationEntered = Deferred.makeUnsafe<void>();
    const releasePublication = Deferred.makeUnsafe<void>();
    const heartbeatSequences: number[] = [];
    const lifecycle = legacyLifecycle(dispatch, {
      heartbeat: sequence => Effect.sync(() => {
        const decoded = Result.getOrThrow(
          decodeTaskHeartbeatSequenceV1(sequence),
        );
        heartbeatSequences.push(decoded);
        return heartbeatReceipt(decoded, 1_000 + decoded * 1_000);
      }),
      complete: completion => Effect.sync(() => completionReceipt(
        Result.getOrThrow(decodeTaskAttemptCompletionV1(completion)),
      )),
    });
    const baseStore = resultStore();
    const store: TaskResultStore = Object.freeze({
      ...baseStore,
      publish: (value: unknown) =>
        Deferred.succeed(publicationEntered, undefined).pipe(
        Effect.andThen(Deferred.await(releasePublication)),
        Effect.andThen(baseStore.publish(value)),
      ),
    });
    const supervisor = Result.getOrThrow(makeTaskAttemptSupervisor(
      { resolve: () => Effect.succeed(lifecycle) },
      store,
      policy(),
    ));
    const session = taskSession(
      dispatch,
      Deferred.await(settlementGate),
      () => {},
    );

    const outcome = await Effect.runPromise(Effect.gen(function* () {
      const fiber = yield* supervisor.supervise({ dispatch, session }).pipe(
        Effect.forkChild,
      );
      while (heartbeatSequences.length === 0) yield* Effect.yieldNow;
      Deferred.doneUnsafe(
        settlementGate,
        Effect.succeed(successfulSettlement(dispatch)),
      );
      yield* Deferred.await(publicationEntered);
      yield* TestClock.adjust(1_500);
      expect(heartbeatSequences).toEqual([1]);
      yield* Deferred.succeed(releasePublication, undefined);
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.layer())));

    expect(outcome.kind).toBe("completed");
    expect(heartbeatSequences).toEqual([1]);
  });

  it("bounds a hung heartbeat and closes without fabricating completion", async () => {
    const dispatch = legacyDispatch();
    const heartbeatEntered = Deferred.makeUnsafe<void>();
    let completionCalls = 0;
    let closeCount = 0;
    const lifecycle = legacyLifecycle(dispatch, {
      heartbeat: () => Deferred.succeed(heartbeatEntered, undefined).pipe(
        Effect.andThen(Effect.never),
      ),
      complete: () => Effect.sync(() => {
        completionCalls += 1;
        return completionReceipt({
          kind: "failed",
          failure: { kind: "system_failure", code: "internal_invariant", message: null },
          retry: { kind: "do_not_retry" },
          executionDurationMs: null,
        });
      }),
    });
    const supervisor = Result.getOrThrow(makeTaskAttemptSupervisor(
      { resolve: () => Effect.succeed(lifecycle) },
      resultStore(),
      policy(),
    ));
    const session = taskSession(
      dispatch,
      Effect.never,
      () => { closeCount += 1; },
    );

    const failure = await Effect.runPromise(Effect.gen(function* () {
      const fiber = yield* supervisor.supervise({ dispatch, session }).pipe(
        Effect.forkChild,
      );
      yield* Deferred.await(heartbeatEntered);
      yield* TestClock.adjust(500);
      return yield* Fiber.join(fiber).pipe(Effect.flip);
    }).pipe(Effect.provide(TestClock.layer())));

    expect(failure).toBeInstanceOf(TaskAttemptSupervisorOperationTimeoutError);
    expect(failure).toMatchObject({ operation: "heartbeat" });
    expect(completionCalls).toBe(0);
    expect(closeCount).toBe(1);
  });

  it("bounds hung result publication and closes without lifecycle completion", async () => {
    const dispatch = legacyDispatch();
    const publicationEntered = Deferred.makeUnsafe<void>();
    let completionCalls = 0;
    let closeCount = 0;
    const lifecycle = legacyLifecycle(dispatch, {
      heartbeat: () => Effect.never,
      complete: completion => Effect.sync(() => {
        completionCalls += 1;
        return completionReceipt(Result.getOrThrow(
          decodeTaskAttemptCompletionV1(completion),
        ));
      }),
    });
    const baseStore = resultStore();
    const store: TaskResultStore = Object.freeze({
      ...baseStore,
      publish: () => Deferred.succeed(publicationEntered, undefined).pipe(
        Effect.andThen(Effect.never),
      ),
    });
    const supervisor = Result.getOrThrow(makeTaskAttemptSupervisor(
      { resolve: () => Effect.succeed(lifecycle) },
      store,
      policy(),
    ));
    const session = taskSession(
      dispatch,
      Effect.succeed(successfulSettlement(dispatch)),
      () => { closeCount += 1; },
    );

    const failure = await Effect.runPromise(Effect.gen(function* () {
      const fiber = yield* supervisor.supervise({ dispatch, session }).pipe(
        Effect.forkChild,
      );
      yield* Deferred.await(publicationEntered);
      yield* TestClock.adjust(2_000);
      return yield* Fiber.join(fiber).pipe(Effect.flip);
    }).pipe(Effect.provide(TestClock.layer())));

    expect(failure).toBeInstanceOf(TaskAttemptSupervisorOperationTimeoutError);
    expect(failure).toMatchObject({ operation: "publish_result" });
    expect(completionCalls).toBe(0);
    expect(closeCount).toBe(1);
  });

  it("bounds a hung completion attempt and closes without retrying new evidence", async () => {
    const dispatch = legacyDispatch();
    const completionEntered = Deferred.makeUnsafe<void>();
    let completionCalls = 0;
    let closeCount = 0;
    const lifecycle = legacyLifecycle(dispatch, {
      heartbeat: () => Effect.never,
      complete: () => Effect.sync(() => {
        completionCalls += 1;
      }).pipe(
        Effect.andThen(Deferred.succeed(completionEntered, undefined)),
        Effect.andThen(Effect.never),
      ),
    });
    const supervisor = Result.getOrThrow(makeTaskAttemptSupervisor(
      { resolve: () => Effect.succeed(lifecycle) },
      resultStore(),
      { ...policy(), maximumCompletionReplays: 0 },
    ));
    const session = taskSession(
      dispatch,
      Effect.succeed(failedSettlement(dispatch)),
      () => { closeCount += 1; },
    );

    const failure = await Effect.runPromise(Effect.gen(function* () {
      const fiber = yield* supervisor.supervise({ dispatch, session }).pipe(
        Effect.forkChild,
      );
      yield* Deferred.await(completionEntered);
      yield* TestClock.adjust(1_000);
      return yield* Fiber.join(fiber).pipe(Effect.flip);
    }).pipe(Effect.provide(TestClock.layer())));

    expect(failure).toBeInstanceOf(TaskAttemptSupervisorOperationTimeoutError);
    expect(failure).toMatchObject({ operation: "complete_attempt" });
    expect(completionCalls).toBe(1);
    expect(closeCount).toBe(1);
  });

  it("bounds session cleanup after an authoritative current outcome", async () => {
    const dispatch = legacyDispatch();
    const closeEntered = Deferred.makeUnsafe<void>();
    const lifecycle = legacyLifecycle(dispatch, {
      heartbeat: () => Effect.succeed(currentHeartbeatReceipt()),
      complete: () => Effect.die("completion must remain unreachable"),
    });
    const supervisor = Result.getOrThrow(makeTaskAttemptSupervisor(
      { resolve: () => Effect.succeed(lifecycle) },
      resultStore(),
      policy(),
    ));
    const baseSession = taskSession(dispatch, Effect.never, () => {});
    const session: TaskExecutionSession = Object.freeze({
      ...baseSession,
      close: Deferred.succeed(closeEntered, undefined).pipe(
        Effect.andThen(Effect.never),
      ),
    });

    const failure = await Effect.runPromise(Effect.gen(function* () {
      const fiber = yield* supervisor.supervise({ dispatch, session }).pipe(
        Effect.forkChild,
      );
      yield* Deferred.await(closeEntered);
      yield* TestClock.adjust(500);
      return yield* Fiber.join(fiber).pipe(Effect.flip);
    }).pipe(Effect.provide(TestClock.layer())));

    expect(failure).toBeInstanceOf(TaskAttemptSupervisorOperationTimeoutError);
    expect(failure).toMatchObject({ operation: "close_session" });
  });

  it("replays identical completion after one transient store failure", async () => {
    const dispatch = legacyDispatch();
    const attempted: TaskAttemptCompletionV1[] = [];
    const suppliedAttempts: unknown[] = [];
    const firstCompletion = Deferred.makeUnsafe<void>();
    const lifecycle = legacyLifecycle(dispatch, {
      heartbeat: sequence => Effect.succeed(heartbeatReceipt(
        Result.getOrThrow(decodeTaskHeartbeatSequenceV1(sequence)),
        1_000,
      )),
      complete: completion => Effect.suspend(() => {
        suppliedAttempts.push(completion);
        const decoded = Result.getOrThrow(
          decodeTaskAttemptCompletionV1(completion),
        );
        attempted.push(decoded);
        if (attempted.length === 1) {
          Deferred.doneUnsafe(firstCompletion, Effect.void);
          return Effect.fail(new TaskSystemRunAttemptTransientStoreError({
            operation: "complete_attempt",
            runId: dispatch.identity.runId,
            reason: "connection_unavailable",
            cause: new Error("lost completion response"),
          }));
        }
        return Effect.succeed(completionReceipt(decoded));
      }),
    });
    const supervisor = Result.getOrThrow(makeTaskAttemptSupervisor(
      { resolve: () => Effect.succeed(lifecycle) },
      resultStore(),
      policy(),
    ));
    const session = taskSession(
      dispatch,
      Effect.succeed(failedSettlement(dispatch)),
      () => {},
    );

    const outcome = await Effect.runPromise(Effect.gen(function* () {
      const fiber = yield* supervisor.supervise({ dispatch, session }).pipe(
        Effect.forkChild,
      );
      yield* Deferred.await(firstCompletion);
      yield* TestClock.adjust(10);
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.layer())));

    expect(outcome).toMatchObject({
      kind: "completed",
      completionKind: "failed",
    });
    expect(attempted).toHaveLength(2);
    expect(suppliedAttempts[1]).toBe(suppliedAttempts[0]);
  });

  it("stops without completion when heartbeat loses current authority", async () => {
    const dispatch = legacyDispatch();
    let closeCount = 0;
    let completionCalls = 0;
    const lifecycle = legacyLifecycle(dispatch, {
      heartbeat: () => Effect.succeed(currentHeartbeatReceipt()),
      complete: completion => Effect.sync(() => {
        completionCalls += 1;
        return completionReceipt(Result.getOrThrow(
          decodeTaskAttemptCompletionV1(completion),
        ));
      }),
    });
    const supervisor = Result.getOrThrow(makeTaskAttemptSupervisor(
      { resolve: () => Effect.succeed(lifecycle) },
      resultStore(),
      policy(),
    ));
    const session = taskSession(
      dispatch,
      Effect.never,
      () => { closeCount += 1; },
    );

    await expect(Effect.runPromise(supervisor.supervise({ dispatch, session })))
      .resolves.toMatchObject({
        kind: "current",
        stage: "heartbeat",
        reason: "stale_fence",
      });
    expect(completionCalls).toBe(0);
    expect(closeCount).toBe(1);
  });

  it("acknowledges only the exact cancellation generation settled by the session", async () => {
    const dispatch = legacyDispatch({
      kind: "requested",
      generation: 2n,
    });
    const firstHeartbeat = Deferred.makeUnsafe<void>();
    const settlementGate = Deferred.makeUnsafe<TaskWorkerSessionSettlementV1>();
    const completions: TaskAttemptCompletionV1[] = [];
    const lifecycle = legacyLifecycle(dispatch, {
      heartbeat: () => Deferred.succeed(firstHeartbeat, undefined).pipe(
        Effect.andThen(Effect.never),
      ),
      complete: completion => Effect.sync(() => {
        const decoded = Result.getOrThrow(
          decodeTaskAttemptCompletionV1(completion),
        );
        completions.push(decoded);
        return completionReceipt(decoded);
      }),
    });
    const supervisor = Result.getOrThrow(makeTaskAttemptSupervisor(
      { resolve: () => Effect.succeed(lifecycle) },
      resultStore(),
      policy(),
    ));
    const session = taskSession(
      dispatch,
      Deferred.await(settlementGate),
      () => {},
    );

    const outcome = await Effect.runPromise(Effect.gen(function* () {
      const fiber = yield* supervisor.supervise({ dispatch, session }).pipe(
        Effect.forkChild,
      );
      yield* Deferred.await(firstHeartbeat);
      Deferred.doneUnsafe(
        settlementGate,
        Effect.succeed(interruptedSettlement(dispatch, 2n)),
      );
      return yield* Fiber.join(fiber);
    }));

    expect(outcome).toMatchObject({
      kind: "completed",
      completionKind: "cancellation_acknowledged",
      lifecycleOutcome: "terminal_cancelled",
    });
    expect(completions).toEqual([{
      kind: "cancellation_acknowledged",
      cancellationGeneration: 2n,
      executionDurationMs: null,
    }]);
  });

  it("preserves external interruption and still closes the owned session", async () => {
    const dispatch = legacyDispatch();
    const firstHeartbeat = Deferred.makeUnsafe<void>();
    let closeCount = 0;
    const lifecycle = legacyLifecycle(dispatch, {
      heartbeat: () => Deferred.succeed(firstHeartbeat, undefined).pipe(
        Effect.andThen(Effect.never),
      ),
      complete: () => Effect.die("completion must remain unreachable"),
    });
    const supervisor = Result.getOrThrow(makeTaskAttemptSupervisor(
      { resolve: () => Effect.succeed(lifecycle) },
      resultStore(),
      policy(),
    ));
    const session = taskSession(
      dispatch,
      Effect.never,
      () => { closeCount += 1; },
    );

    const exit = await Effect.runPromise(Effect.gen(function* () {
      const fiber = yield* supervisor.supervise({ dispatch, session }).pipe(
        Effect.forkChild,
      );
      yield* Deferred.await(firstHeartbeat);
      yield* Fiber.interrupt(fiber);
      return yield* Fiber.await(fiber);
    }));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }
    expect(closeCount).toBe(1);
  });

  it("rejects a session whose internal close bound exceeds the reserve", async () => {
    const dispatch = legacyDispatch();
    let resolveCalls = 0;
    let closeCount = 0;
    const supervisor = Result.getOrThrow(makeTaskAttemptSupervisor(
      {
        resolve: () => {
          resolveCalls += 1;
          return Effect.die("lifecycle resolution must remain unreachable");
        },
      },
      resultStore(),
      policy(),
    ));
    const session: TaskExecutionSession = Object.freeze({
      ...taskSession(dispatch, Effect.never, () => { closeCount += 1; }),
      maximumCloseMilliseconds: 501,
    });

    const failure = await Effect.runPromise(
      supervisor.supervise({ dispatch, session }).pipe(Effect.flip),
    );

    expect(failure).toBeInstanceOf(TaskAttemptSupervisorContractError);
    expect(failure).toMatchObject({ reason: "session_close_budget_mismatch" });
    expect(resolveCalls).toBe(0);
    expect(closeCount).toBe(1);
  });

  it("rejects settlement evidence that does not match the accepted execution", async () => {
    const dispatch = legacyDispatch();
    const lifecycle = legacyLifecycle(dispatch, {
      heartbeat: sequence => Effect.succeed(heartbeatReceipt(
        Result.getOrThrow(decodeTaskHeartbeatSequenceV1(sequence)),
        1_000,
      )),
      complete: () => Effect.die("mismatched settlement must not complete"),
    });
    const supervisor = Result.getOrThrow(makeTaskAttemptSupervisor(
      { resolve: () => Effect.succeed(lifecycle) },
      resultStore(),
      policy(),
    ));
    const baseSession = taskSession(
      dispatch,
      Effect.succeed(successfulSettlement(dispatch)),
      () => {},
    );
    const settlement = await Effect.runPromise(baseSession.settlement);
    const otherExecutionId = taskSession(
      dispatch,
      Effect.never,
      () => {},
      "execution-task-supervisor-2",
    ).acceptance.executionId;
    const mismatches: ReadonlyArray<Readonly<{
      readonly label: string;
      readonly settlement: TaskExecutionSessionSettlement;
    }>> = [
      Object.freeze({
        label: "generation",
        settlement: Object.freeze({
          ...settlement,
          generation: "application_v1" as const,
        }),
      }),
      Object.freeze({
        label: "execution ID",
        settlement: Object.freeze({
          ...settlement,
          executionId: otherExecutionId,
        }),
      }),
      Object.freeze({
        label: "identity fence",
        settlement: Object.freeze({
          ...settlement,
          identity: legacyDispatch(undefined, 2n).identity,
        }),
      }),
    ];

    for (const mismatch of mismatches) {
      const session: TaskExecutionSession = Object.freeze({
        ...baseSession,
        settlement: Effect.succeed(mismatch.settlement),
      });
      const failure = await Effect.runPromise(
        supervisor.supervise({ dispatch, session }).pipe(Effect.flip),
      );
      expect(failure, mismatch.label).toBeInstanceOf(
        TaskAttemptSupervisorContractError,
      );
      expect(failure, mismatch.label).toMatchObject({
        reason: "session_settlement_mismatch",
      });
    }
  });

  it("rejects invalid cadence composition before supervision", () => {
    const invalid = makeTaskAttemptSupervisor(
      { resolve: () => Effect.die("unused") },
      resultStore(),
      { ...policy(), heartbeatIntervalMilliseconds: 9_500 },
    );
    if (Result.isSuccess(invalid)) {
      throw new Error("Expected invalid cadence composition to fail.");
    }
    expect(invalid.failure).toBeInstanceOf(
      TaskAttemptSupervisorConfigurationError,
    );
  });

  it("rejects cleanup deadlines that exceed the reserved lease margin", () => {
    const invalid = makeTaskAttemptSupervisor(
      { resolve: () => Effect.die("unused") },
      resultStore(),
      { ...policy(), maximumSessionCloseMilliseconds: 1_000 },
    );
    if (Result.isSuccess(invalid)) {
      throw new Error("Expected an oversized cleanup deadline to fail.");
    }
    expect(invalid.failure).toBeInstanceOf(
      TaskAttemptSupervisorConfigurationError,
    );
  });

  it("reserves both heartbeat response and next-call latency", () => {
    const invalid = makeTaskAttemptSupervisor(
      { resolve: () => Effect.die("unused") },
      resultStore(),
      { ...policy(), maximumHeartbeatOperationMilliseconds: 2_500 },
    );
    if (Result.isSuccess(invalid)) {
      throw new Error("Expected an unsafe heartbeat latency budget to fail.");
    }
    expect(invalid.failure).toBeInstanceOf(
      TaskAttemptSupervisorConfigurationError,
    );
  });
});

function policy() {
  return Object.freeze({
    minimumLeaseDurationMilliseconds: 10_000,
    heartbeatIntervalMilliseconds: 1_000,
    leaseSettlementReserveMilliseconds: 5_000,
    maximumLifecycleResolveMilliseconds: 500,
    maximumHeartbeatOperationMilliseconds: 500,
    maximumResultPublicationMilliseconds: 2_000,
    maximumCompletionOperationMilliseconds: 1_000,
    maximumSessionCloseMilliseconds: 500,
    maximumCompletionReplays: 1,
    completionReplayDelayMilliseconds: 10,
  });
}

function legacyDispatch(
  cancellation: unknown = { kind: "not_requested", generation: 0n },
  executionFence: unknown = 1n,
) {
  return Result.getOrThrow(validateTaskComputeDispatchRequestV1({
    version: TASK_COMPUTE_DISPATCH_REQUEST_VERSION_V1,
    identity: {
      version: "flarex.task-compute-dispatch-identity.v1",
      scopeId: "scope_00000000-0000-4000-8000-000000000001",
      runId: "run_00000000-0000-4000-8000-000000000001",
      requestedEffectSequence: 1n,
      attemptId: "attempt_00000000-0000-4000-8000-000000000001",
      executionFence,
    },
    taskDefinitionRevisionId:
      "taskdef_00000000-0000-4000-8000-000000000001",
    attemptNumber: 1,
    leaseVersion: 1n,
    computeProfile: "standard-1x",
    cancellation,
    maximumDurationMs: 30_000,
  }));
}

function legacyLifecycle(
  dispatch: ReturnType<typeof legacyDispatch>,
  operations: Pick<LegacyTaskAttemptLifecycleCapability, "heartbeat" | "complete">,
): LegacyTaskAttemptLifecycleCapability {
  return Object.freeze({
    generation: "legacy_dynamic_worker_v1",
    deploymentId: "deployment-task-supervisor",
    scopeId: dispatch.identity.scopeId,
    runId: dispatch.identity.runId,
    requestedEffectSequence: dispatch.identity.requestedEffectSequence,
    attemptId: dispatch.identity.attemptId,
    executionFence: dispatch.identity.executionFence,
    leaseVersion: dispatch.leaseVersion,
    inspect: () => Effect.die("inspection is not used by E4"),
    heartbeat: operations.heartbeat,
    complete: operations.complete,
  });
}

function taskSession(
  dispatch: CurrentTaskComputeDispatchRequestV1,
  settlement: Effect.Effect<TaskWorkerSessionSettlementV1, never>,
  onClose: () => void,
  executionId = "execution-task-supervisor-1",
): TaskExecutionSession {
  return adaptWorkerLoaderTaskExecutionSession(Object.freeze({
    acceptance: Result.getOrThrow(decodeTaskWorkerSessionAcceptanceV1({
      format: TASK_WORKER_SESSION_ACCEPTANCE_FORMAT_V1,
      version: TASK_WORKER_SESSION_ACCEPTANCE_VERSION_V1,
      kind: "accepted",
      generation: "taskDefinitionRevisionId" in dispatch
        ? "legacy_dynamic_worker_v1"
        : "application_v1",
      identity: dispatch.identity,
      executionId,
      cancellationGeneration: dispatch.cancellation.generation,
    })),
    maximumCloseMilliseconds: 100,
    requestInterruption: () => Effect.die("direct interruption is not used"),
    settlement,
    close: Effect.sync(onClose),
  }));
}

function successfulSettlement(
  dispatch: ReturnType<typeof legacyDispatch>,
): TaskWorkerSessionSettlementV1 {
  return Result.getOrThrow(decodeTaskWorkerSessionSettlementV1({
    format: TASK_WORKER_SESSION_SETTLEMENT_FORMAT_V1,
    version: TASK_WORKER_SESSION_SETTLEMENT_VERSION_V1,
    kind: "settled",
    generation: "legacy_dynamic_worker_v1",
    identity: dispatch.identity,
    executionId: "execution-task-supervisor-1",
    outcome: {
      kind: "completed",
      result: {
        format: LEGACY_TASK_WORKER_RESULT_FORMAT_V1,
        version: LEGACY_TASK_WORKER_RESULT_VERSION_V1,
        kind: "completed",
        identity: dispatch.identity,
        value: null,
        valueSemanticBytes: 1,
      },
    },
  }));
}

function failedSettlement(
  dispatch: ReturnType<typeof legacyDispatch>,
): TaskWorkerSessionSettlementV1 {
  return Result.getOrThrow(decodeTaskWorkerSessionSettlementV1({
    format: TASK_WORKER_SESSION_SETTLEMENT_FORMAT_V1,
    version: TASK_WORKER_SESSION_SETTLEMENT_VERSION_V1,
    kind: "settled",
    generation: "legacy_dynamic_worker_v1",
    identity: dispatch.identity,
    executionId: "execution-task-supervisor-1",
    outcome: {
      kind: "failed",
      failure: { code: "handler_failed", message: null },
    },
  }));
}

function interruptedSettlement(
  dispatch: ReturnType<typeof legacyDispatch>,
  cancellationGeneration: bigint,
): TaskWorkerSessionSettlementV1 {
  return Result.getOrThrow(decodeTaskWorkerSessionSettlementV1({
    format: TASK_WORKER_SESSION_SETTLEMENT_FORMAT_V1,
    version: TASK_WORKER_SESSION_SETTLEMENT_VERSION_V1,
    kind: "settled",
    generation: "legacy_dynamic_worker_v1",
    identity: dispatch.identity,
    executionId: "execution-task-supervisor-1",
    outcome: {
      kind: "interrupted",
      interruption: {
        cancellationGeneration,
        reason: "cancellation_requested",
      },
    },
  }));
}

function resultStore(): TaskResultStore {
  const commitment = Result.getOrThrow(decodeTaskResultCommitmentV1({
    codec: "flarex.task-result.v1",
    byteLength: 1,
    sha256: new Uint8Array(32).fill(7),
  }));
  return Object.freeze({
    publish: () => Effect.succeed(commitment),
    read: () => Effect.die("read is not used by supervision"),
  });
}

function heartbeatReceipt(
  sequence: number,
  observedAtMs: number,
): TaskSystemRunAttemptTransactionReceiptV1<HeartbeatAttemptOutcomeV1> {
  // SAFETY: this focused fake supplies the exact receipt facets consumed by
  // the supervisor; durable lifecycle tests own full receipt construction.
  return {
    disposition: "accepted",
    observedAtMs,
    runVersion: BigInt(sequence + 1),
    outcome: {
      kind: "lease_renewed",
      attempt: {
        attemptId: "attempt_00000000-0000-4000-8000-000000000001",
        attemptNumber: 1,
        executionFence: 1n,
      },
      heartbeatSequence: sequence,
      enteredExecuting: sequence === 1,
      lease: {
        version: BigInt(sequence + 1),
        renewedAtMs: observedAtMs,
        expiresAtMs: observedAtMs + 10_000,
      },
    },
    evidence: [],
    requestedEffects: [],
  } as unknown as TaskSystemRunAttemptTransactionReceiptV1<
    HeartbeatAttemptOutcomeV1
  >;
}

function currentHeartbeatReceipt():
  TaskSystemRunAttemptTransactionReceiptV1<HeartbeatAttemptOutcomeV1> {
  // SAFETY: the supervisor reads only the current reason from this focused
  // fake; durable lifecycle tests own the complete aggregate shape.
  return {
    disposition: "current",
    observedAtMs: 1_000,
    runVersion: 1n,
    outcome: {
      kind: "current",
      reason: "stale_fence",
      state: {},
    },
    evidence: [],
    requestedEffects: [],
  } as unknown as TaskSystemRunAttemptTransactionReceiptV1<
    HeartbeatAttemptOutcomeV1
  >;
}

function completionReceipt(
  completion: TaskAttemptCompletionV1,
): TaskSystemRunAttemptTransactionReceiptV1<CompleteAttemptOutcomeV1> {
  // SAFETY: this focused fake supplies the exact terminal kind and disposition
  // consumed by the supervisor; lifecycle tests own full terminal evidence.
  return {
    disposition: "accepted",
    observedAtMs: 2_000,
    runVersion: 3n,
    outcome: completion.kind === "succeeded"
      ? { kind: "terminal_succeeded" }
      : completion.kind === "cancellation_acknowledged"
      ? { kind: "terminal_cancelled" }
      : { kind: "terminal_failed" },
    evidence: [],
    requestedEffects: [],
  } as unknown as TaskSystemRunAttemptTransactionReceiptV1<
    CompleteAttemptOutcomeV1
  >;
}
