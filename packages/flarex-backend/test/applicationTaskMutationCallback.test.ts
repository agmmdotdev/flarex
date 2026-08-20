import { Deferred, Effect, Exit, Fiber, Result } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";
import { TaskComputeExecutionIdV1Schema } from
  "@flarex/durable-task/internal/compute-provider-v1";
import {
  APPLICATION_TASK_MUTATION_CALLBACK_FORMAT_V1,
  APPLICATION_TASK_MUTATION_CALLBACK_VERSION_V1,
  normalizeApplicationTaskMutationCallbackValueV1,
} from "flarex-protocol/internal/application-task-mutation-callback-v1";

import {
  makeApplicationTaskMutationCallbackCapability,
} from "../src/taskComputeDelivery/ApplicationTaskMutationCallback";

describe("Application Task mutation callback capability", () => {
  it("binds the host call identity to the exact sequential ordinal", async () => {
    const calls: unknown[] = [];
    const lease = makeApplicationTaskMutationCallbackCapability({
      maximumCloseMilliseconds: 100,
      runMutation: (ordinal, path, argumentsValue) => Effect.sync(() => {
        calls.push({ ordinal, path, argumentsValue });
        return argumentsValue;
      }),
      close: Effect.void,
    }, {
      executionId: executionId("task-worker-1"),
      absoluteTaskDeadlineMs: 2_000,
      now: () => 1_000,
    });

    await expect(lease.capability.invoke(mutationRequest(1n, {
      orderId: "order-1",
    }))).resolves.toMatchObject({
      kind: "success",
      callId: "task-worker-1:mutation:1",
      deadlineMs: 2_000,
      value: { orderId: "order-1" },
    });
    expect(calls).toEqual([{
      ordinal: 1n,
      path: "orders:update",
      argumentsValue: { orderId: "order-1" },
    }]);
  });

  it("rejects skipped and repeated ordinals before mutation execution", async () => {
    const observed: bigint[] = [];
    const lease = makeApplicationTaskMutationCallbackCapability({
      maximumCloseMilliseconds: 100,
      runMutation: (ordinal, _path, value) => Effect.sync(() => {
        observed.push(ordinal);
        return value;
      }),
      close: Effect.void,
    }, {
      executionId: executionId("task-worker-2"),
      absoluteTaskDeadlineMs: 2_000,
      now: () => 1_000,
    });

    await expect(lease.capability.invoke(mutationRequest(2n, {}))).resolves
      .toMatchObject({ kind: "failure", reason: "sequence_mismatch" });
    await expect(lease.capability.invoke(mutationRequest(1n, {}))).resolves
      .toMatchObject({ kind: "failure", reason: "sequence_mismatch" });
    expect(observed).toEqual([]);
  });

  it("maps replay uncertainty without exposing the authority cause", async () => {
    const lease = makeApplicationTaskMutationCallbackCapability({
      maximumCloseMilliseconds: 100,
      runMutation: () => Effect.fail({
        reason: "outcomeUncertain",
        secret: "must-not-cross",
      }),
      close: Effect.void,
    }, {
      executionId: executionId("task-worker-3"),
      absoluteTaskDeadlineMs: 2_000,
      now: () => 1_000,
    });

    const result = await lease.capability.invoke(mutationRequest(1n, {}));
    expect(result).toMatchObject({
      kind: "failure",
      reason: "outcome_uncertain",
    });
    expect(JSON.stringify(result)).not.toContain("must-not-cross");
  });

  it("enforces call and concurrency ceilings", async () => {
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const lease = makeApplicationTaskMutationCallbackCapability({
      maximumCloseMilliseconds: 100,
      runMutation: () => Effect.sync(entered).pipe(Effect.andThen(Effect.never)),
      close: Effect.void,
    }, {
      executionId: executionId("task-worker-4"),
      absoluteTaskDeadlineMs: 10_000,
      maximumCalls: 2,
      now: () => 1_000,
    });

    const first = lease.capability.invoke(mutationRequest(1n, {}));
    await started;
    await expect(lease.capability.invoke(mutationRequest(2n, {}))).resolves
      .toMatchObject({ kind: "failure", reason: "resource_exceeded" });
    await expect(lease.capability.invoke(mutationRequest(3n, {}))).resolves
      .toMatchObject({ kind: "failure", reason: "resource_exceeded" });
    await Effect.runPromise(lease.close);
    await expect(first).resolves.toMatchObject({
      kind: "failure",
      reason: "interrupted",
    });
  });

  it("fails before mutation execution after the absolute deadline", async () => {
    let called = false;
    const lease = makeApplicationTaskMutationCallbackCapability({
      maximumCloseMilliseconds: 100,
      runMutation: (_ordinal, _path, value) => Effect.sync(() => {
        called = true;
        return value;
      }),
      close: Effect.void,
    }, {
      executionId: executionId("task-worker-5"),
      absoluteTaskDeadlineMs: 999,
      now: () => 1_000,
    });

    await expect(lease.capability.invoke(mutationRequest(1n, {}))).resolves
      .toMatchObject({ kind: "failure", reason: "timed_out" });
    expect(called).toBe(false);
  });

  it("interrupts the in-flight authority operation when closed", async () => {
    let entered!: () => void;
    let sessionCloses = 0;
    const lifecycle: string[] = [];
    const started = new Promise<void>(resolve => { entered = resolve; });
    const release = Deferred.makeUnsafe<void>();
    const lease = makeApplicationTaskMutationCallbackCapability({
      maximumCloseMilliseconds: 100,
      runMutation: () => Effect.sync(entered).pipe(
        Effect.andThen(Effect.uninterruptible(Deferred.await(release))),
        Effect.andThen(Effect.succeed(Object.freeze({}))),
        Effect.ensuring(Effect.sync(() => { lifecycle.push("operation"); })),
      ),
      close: Effect.sync(() => {
        sessionCloses += 1;
        lifecycle.push("session");
        Deferred.doneUnsafe(release, Effect.void);
      }),
    }, {
      executionId: executionId("task-worker-6"),
      absoluteTaskDeadlineMs: 10_000,
      now: () => 1_000,
    });

    const pending = lease.capability.invoke(mutationRequest(1n, {}));
    await started;
    await Effect.runPromise(lease.close);
    await expect(pending).resolves.toMatchObject({
      kind: "failure",
      reason: "interrupted",
    });
    await Effect.runPromise(lease.close);
    expect(sessionCloses).toBe(1);
    expect(lifecycle).toEqual(["session", "operation"]);
  });

  it("preserves an admitted outcome-uncertain failure across close", async () => {
    const lease = makeApplicationTaskMutationCallbackCapability({
      maximumCloseMilliseconds: 100,
      runMutation: () => Effect.fail({ reason: "outcomeUncertain" }),
      close: Effect.void,
    }, {
      executionId: executionId("task-worker-7"),
      absoluteTaskDeadlineMs: 2_000,
      now: () => 1_000,
    });

    const pending = lease.capability.invoke(mutationRequest(1n, {}));
    await Effect.runPromise(lease.close);
    await expect(pending).resolves.toMatchObject({
      kind: "failure",
      reason: "outcome_uncertain",
    });
  });

  it("keeps once-only cleanup alive after an interruptible waiter times out", async () => {
    const release = Deferred.makeUnsafe<void>();
    let closes = 0;
    const lease = makeApplicationTaskMutationCallbackCapability({
      maximumCloseMilliseconds: 10,
      runMutation: (_ordinal, _path, value) => Effect.succeed(value),
      close: Effect.sync(() => { closes += 1; }).pipe(
        Effect.andThen(Deferred.await(release)),
      ),
    }, {
      executionId: executionId("task-worker-8"),
      absoluteTaskDeadlineMs: 2_000,
      now: () => 1_000,
    });

    await Effect.runPromise(Effect.gen(function* () {
      const waiter = yield* lease.close.pipe(
        Effect.timeoutOrElse({
          duration: "10 millis",
          orElse: () => Effect.fail(new Error("waiter timed out")),
        }),
        Effect.forkChild,
      );
      yield* TestClock.adjust("10 millis");
      expect(Exit.isFailure(yield* Fiber.await(waiter))).toBe(true);
      Deferred.doneUnsafe(release, Effect.void);
      yield* lease.close;
    }).pipe(Effect.provide(TestClock.layer())));

    expect(closes).toBe(1);
  });
});

function mutationRequest(ordinal: bigint, value: unknown) {
  const normalized = Result.getOrThrow(
    normalizeApplicationTaskMutationCallbackValueV1(value, "request"),
  );
  return Object.freeze({
    format: APPLICATION_TASK_MUTATION_CALLBACK_FORMAT_V1,
    version: APPLICATION_TASK_MUTATION_CALLBACK_VERSION_V1,
    operation: "runMutation" as const,
    ordinal,
    functionPath: "orders:update",
    arguments: normalized.value,
    argumentSemanticBytes: normalized.semanticSizeBytes,
  });
}

function executionId(value: string) {
  return TaskComputeExecutionIdV1Schema.make(value);
}
