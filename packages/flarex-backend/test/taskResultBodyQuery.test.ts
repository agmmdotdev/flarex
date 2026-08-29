import {
  TaskRunResultQuery,
  TaskRunResultUnavailableError,
  type TaskRunResultQueryApi,
} from "@flarex/durable-task/internal/run-result-query";
import {
  TASK_RESULT_CODEC_V1,
  type TaskResultCommitmentV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { Brand, Effect, Layer, Result } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  makeTaskResultBodyQueryLayer,
  TaskResultBodyQuery,
} from "../src/taskResult/TaskResultBodyQuery.js";
import {
  TaskResultStoreNotFoundError,
  type TaskResultStore,
} from "../src/taskResult/TaskResultStore.js";

const runId = Brand.nominal<
  Parameters<TaskRunResultQueryApi["authorizeRead"]>[0]
>()("run-result-body-query-1");
const commitment: TaskResultCommitmentV1 = Object.freeze({
  codec: TASK_RESULT_CODEC_V1,
  byteLength: 12,
  sha256: new Uint8Array(32).fill(0x62),
});

describe("TaskResultBodyQuery", () => {
  it("authorizes before reading and returns only the canonical value", async () => {
    const authorizeRead = vi.fn<TaskRunResultQueryApi["authorizeRead"]>(
      () => Effect.succeed(commitment),
    );
    const value = Object.freeze({ completed: true });
    const read = vi.fn<TaskResultStore["read"]>(() => Effect.succeed({
      commitment,
      objectKey: "private/task-result",
      value,
      canonicalBytes: new Uint8Array([1, 2, 3]),
      semanticSizeBytes: 3,
    }));

    const result = await readWith({ authorizeRead }, { read });

    expect(result).toBe(value);
    expect(authorizeRead).toHaveBeenCalledOnce();
    expect(authorizeRead).toHaveBeenCalledWith(runId);
    expect(read).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith(commitment);
  });

  it("short-circuits authorization and store failures by identity", async () => {
    const unavailable = new TaskRunResultUnavailableError({
      runId,
      reason: "run_incomplete",
    });
    const forbiddenRead = vi.fn<TaskResultStore["read"]>(
      () => Effect.die("result store must not be called"),
    );
    const unauthorized = await Effect.runPromise(Effect.result(readWithEffect(
      { authorizeRead: () => Effect.fail(unavailable) },
      { read: forbiddenRead },
    )));
    expect(Result.isFailure(unauthorized)).toBe(true);
    if (Result.isFailure(unauthorized)) {
      expect(unauthorized.failure).toBe(unavailable);
    }
    expect(forbiddenRead).not.toHaveBeenCalled();

    const notFound = new TaskResultStoreNotFoundError({ commitment });
    const storeFailure = await Effect.runPromise(Effect.result(readWithEffect(
      { authorizeRead: () => Effect.succeed(commitment) },
      { read: () => Effect.fail(notFound) },
    )));
    expect(Result.isFailure(storeFailure)).toBe(true);
    if (Result.isFailure(storeFailure)) expect(storeFailure.failure).toBe(notFound);
  });
});

function readWith(
  query: TaskRunResultQueryApi,
  store: Pick<TaskResultStore, "read">,
) {
  return Effect.runPromise(readWithEffect(query, store));
}

function readWithEffect(
  query: TaskRunResultQueryApi,
  store: Pick<TaskResultStore, "read">,
) {
  const layer = makeTaskResultBodyQueryLayer(store).pipe(Layer.provide(
    Layer.succeed(TaskRunResultQuery, TaskRunResultQuery.of(query)),
  ));
  return Effect.gen(function* () {
    const body = yield* TaskResultBodyQuery;
    return yield* body.read(runId);
  }).pipe(Effect.provide(layer));
}
