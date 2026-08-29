import {
  TaskRunListStoreFailure,
  type ApplicationTaskRunListStoreShape,
  type TaskRunListStoreItem,
} from "@flarex/durable-task/internal/run-projection";
import type {
  TaskDatabaseTimeMsV1,
  TaskRunIdV1,
  TaskRunVersionV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { Brand, Effect, Result } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  listStandardApplicationTaskRuns,
  makeStandardApplicationTaskRunListQueryLayer,
} from "../src/StandardApplicationTaskRunListQuery.js";

const runId = Brand.nominal<TaskRunIdV1>()(
  "run_00000000-0000-4000-8000-000000000091",
);
const databaseTime = Brand.nominal<TaskDatabaseTimeMsV1>();

describe("StandardApplicationTaskRunListQuery", () => {
  it("wires one captured scope store through the durable list projection", async () => {
    const listRuns = vi.fn<ApplicationTaskRunListStoreShape["listRuns"]>(
      () => Effect.succeed({
        observedAtMs: databaseTime(2_000),
        runs: Object.freeze([applicationReady()]),
        hasMore: false,
      }),
    );
    const page = await Effect.runPromise(
      listStandardApplicationTaskRuns({ pageSize: 10 }).pipe(
        Effect.provide(makeStandardApplicationTaskRunListQueryLayer({
          listRuns,
        })),
      ),
    );

    expect(page.items.map(item => item.runId)).toEqual([runId]);
    expect(page.nextCursor).toBeNull();
    expect(listRuns).toHaveBeenCalledWith({ pageSize: 10, cursor: null });
  });

  it("preserves a scope-store failure by identity without retry", async () => {
    const failure = new TaskRunListStoreFailure({
      operation: "list_task_runs",
      reason: "stale_scope_authority",
      cause: null,
    });
    const listRuns = vi.fn<ApplicationTaskRunListStoreShape["listRuns"]>(
      () => Effect.fail(failure),
    );
    const result = await Effect.runPromise(Effect.result(
      listStandardApplicationTaskRuns({ pageSize: 10 }).pipe(
        Effect.provide(makeStandardApplicationTaskRunListQueryLayer({
          listRuns,
        })),
      ),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBe(failure);
    expect(listRuns).toHaveBeenCalledOnce();
  });

  it("keeps equal run ids isolated by independently captured stores", async () => {
    const first = vi.fn<ApplicationTaskRunListStoreShape["listRuns"]>(
      () => Effect.succeed({
        observedAtMs: databaseTime(2_000),
        runs: Object.freeze([applicationReady()]),
        hasMore: false,
      }),
    );
    const second = vi.fn<ApplicationTaskRunListStoreShape["listRuns"]>(
      () => Effect.succeed({
        observedAtMs: databaseTime(3_000),
        runs: Object.freeze([applicationReady()]),
        hasMore: false,
      }),
    );
    const runWith = (listRuns: ApplicationTaskRunListStoreShape["listRuns"]) =>
      Effect.runPromise(listStandardApplicationTaskRuns({ pageSize: 1 }).pipe(
        Effect.provide(makeStandardApplicationTaskRunListQueryLayer({
          listRuns,
        })),
      ));

    const firstPage = await runWith(first);
    expect(firstPage.observedAtMs).toBe(databaseTime(2_000));
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();

    const secondPage = await runWith(second);
    expect(secondPage.observedAtMs).toBe(databaseTime(3_000));
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });
});

function applicationReady(): TaskRunListStoreItem {
  return Object.freeze({
    runId,
    createdAtMs: databaseTime(1_000),
    runVersion: Brand.nominal<TaskRunVersionV1>()(1n),
    state: Object.freeze({
      kind: "ready",
      eligibleAtMs: databaseTime(1_000),
      retry: null,
      cancellation: Object.freeze({ kind: "not_requested" }),
    }),
  });
}
