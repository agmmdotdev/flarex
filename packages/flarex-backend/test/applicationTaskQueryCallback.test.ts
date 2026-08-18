import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { TaskComputeExecutionIdV1Schema } from
  "@flarex/durable-task/internal/compute-provider-v1";

import {
  APPLICATION_TASK_QUERY_CALLBACK_FORMAT_V1,
  APPLICATION_TASK_QUERY_CALLBACK_VERSION_V1,
  normalizeApplicationTaskQueryCallbackValueV1,
} from "flarex-protocol/internal/application-task-query-callback-v1";
import {
  makeApplicationTaskQueryCallbackCapability,
} from "../src/taskComputeDelivery/ApplicationTaskQueryCallback";

describe("Application Task query callback capability", () => {
  it("allocates the call identity and returns one bounded canonical value", async () => {
    const calls: unknown[] = [];
    const capability = makeApplicationTaskQueryCallbackCapability({
      runQuery: (path, argumentsValue) => Effect.sync(() => {
        calls.push({ path, argumentsValue });
        return argumentsValue;
      }),
    }, {
      executionId: executionId("task-worker-1"),
      absoluteTaskDeadlineMs: 2_000,
      now: () => 1_000,
    });
    const request = queryRequest({ orderId: "order-1" });

    await expect(capability.capability.invoke(request)).resolves.toMatchObject({
      kind: "success",
      callId: "task-worker-1:query:1",
      deadlineMs: 2_000,
      value: { orderId: "order-1" },
    });
    expect(calls).toEqual([{
      path: "orders:get",
      argumentsValue: { orderId: "order-1" },
    }]);
  });

  it("maps stale selection and closed-session interruption without exposing causes", async () => {
    const capability = makeApplicationTaskQueryCallbackCapability({
      runQuery: () => Effect.fail({ reason: "staleLaunch", secret: "hidden" }),
    }, {
      executionId: executionId("task-worker-2"),
      absoluteTaskDeadlineMs: 2_000,
      now: () => 1_000,
    });

    await expect(capability.capability.invoke(queryRequest({}))).resolves.toMatchObject({
      kind: "failure",
      reason: "stale_launch",
    });
    capability.close();
    const closed = await capability.capability.invoke(queryRequest({}));
    expect(closed).toMatchObject({ kind: "failure", reason: "interrupted" });
    expect(JSON.stringify(closed)).not.toContain("hidden");
  });

  it("enforces the host-owned call ceiling", async () => {
    const capability = makeApplicationTaskQueryCallbackCapability({
      runQuery: (_path, value) => Effect.succeed(value),
    }, {
      executionId: executionId("task-worker-3"),
      absoluteTaskDeadlineMs: 2_000,
      maximumCalls: 1,
      now: () => 1_000,
    });

    await expect(capability.capability.invoke(queryRequest({ first: true }))).resolves
      .toMatchObject({ kind: "success" });
    await expect(capability.capability.invoke(queryRequest({ second: true }))).resolves
      .toMatchObject({ kind: "failure", reason: "resource_exceeded" });
  });

  it("fails before query execution when the absolute task deadline is exhausted", async () => {
    let called = false;
    const capability = makeApplicationTaskQueryCallbackCapability({
      runQuery: (_path, value) => Effect.sync(() => {
        called = true;
        return value;
      }),
    }, {
      executionId: executionId("task-worker-4"),
      absoluteTaskDeadlineMs: 999,
      now: () => 1_000,
    });

    await expect(capability.capability.invoke(queryRequest({}))).resolves.toMatchObject({
      kind: "failure",
      reason: "timed_out",
    });
    expect(called).toBe(false);
  });

  it("interrupts one in-flight authority call when the owned session closes", async () => {
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const capability = makeApplicationTaskQueryCallbackCapability({
      runQuery: () => Effect.sync(entered).pipe(Effect.andThen(Effect.never)),
    }, {
      executionId: executionId("task-worker-5"),
      absoluteTaskDeadlineMs: 10_000,
      now: () => 1_000,
    });

    const pending = capability.capability.invoke(queryRequest({}));
    await started;
    capability.close();
    await expect(pending).resolves.toMatchObject({
      kind: "failure",
      reason: "interrupted",
    });
  });

  it("rejects a concurrent query before starting shared query work", async () => {
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const capability = makeApplicationTaskQueryCallbackCapability({
      runQuery: () => Effect.sync(entered).pipe(Effect.andThen(Effect.never)),
    }, {
      executionId: executionId("task-worker-6"),
      absoluteTaskDeadlineMs: 10_000,
      now: () => 1_000,
    });

    const admitted = capability.capability.invoke(queryRequest({ first: true }));
    await started;
    await expect(capability.capability.invoke(queryRequest({ second: true })))
      .resolves.toMatchObject({
        kind: "failure",
        reason: "resource_exceeded",
      });
    capability.close();
    await expect(admitted).resolves.toMatchObject({
      kind: "failure",
      reason: "interrupted",
    });
  });

  it("does not return a result normalized after its absolute deadline", async () => {
    const observations = [1_000, 1_000, 2_000];
    const capability = makeApplicationTaskQueryCallbackCapability({
      runQuery: (_path, value) => Effect.succeed(value),
    }, {
      executionId: executionId("task-worker-7"),
      absoluteTaskDeadlineMs: 2_000,
      now: () => observations.shift() ?? 2_000,
    });

    await expect(capability.capability.invoke(queryRequest({}))).resolves.toMatchObject({
      kind: "failure",
      reason: "timed_out",
    });
  });

  it("rejects an execution identity that cannot produce a valid call identity", () => {
    expect(() => makeApplicationTaskQueryCallbackCapability({
      runQuery: (_path, value) => Effect.succeed(value),
    }, {
      // SAFETY: hostile runtime input intentionally bypasses the branded API.
      executionId: "x".repeat(256) as never,
      absoluteTaskDeadlineMs: 2_000,
      now: () => 1_000,
    })).toThrow("Application Task query callback options are invalid.");
  });
});

function queryRequest(value: unknown) {
  const normalized = Result.getOrThrow(
    normalizeApplicationTaskQueryCallbackValueV1(value, "request"),
  );
  return Object.freeze({
    format: APPLICATION_TASK_QUERY_CALLBACK_FORMAT_V1,
    version: APPLICATION_TASK_QUERY_CALLBACK_VERSION_V1,
    operation: "runQuery" as const,
    functionPath: "orders:get",
    arguments: normalized.value,
    argumentSemanticBytes: normalized.semanticSizeBytes,
  });
}

function executionId(value: string) {
  return TaskComputeExecutionIdV1Schema.make(value);
}
