import {
  TaskRunListStoreFailure,
} from "@flarex/durable-task/internal/run-projection";
import type {
  TaskDatabaseTimeMsV1,
  TaskRunIdV1,
  TaskRunVersionV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { Brand, Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  listStandardApplicationTaskRuns,
  StandardApplicationTaskRunListQuery,
  type StandardApplicationTaskRunListQueryApi,
} from "../src/StandardApplicationTaskRunListQuery.js";
import {
  StandardApplicationTaskRunQuery,
  type StandardApplicationTaskRunQueryApi,
} from "../src/StandardApplicationTaskRunQuery.js";

const runId = Brand.nominal<TaskRunIdV1>()(
  "run_00000000-0000-4000-8000-000000000091",
);
const databaseTime = Brand.nominal<TaskDatabaseTimeMsV1>();
const runVersion = Brand.nominal<TaskRunVersionV1>();

describe("StandardApplicationTaskRunListQuery", () => {
  it("delegates through its captured point-query scope", async () => {
    const scope = pointQueryScope();
    const list = vi.fn<StandardApplicationTaskRunListQueryApi["list"]>(
      () => Effect.succeed(page(databaseTime(2_000))),
    );
    const result = await runWith({ scope, list });

    expect(result.items.map(item => item.runId)).toEqual([runId]);
    expect(list).toHaveBeenCalledWith({ pageSize: 10, cursor: null });
  });

  it("preserves a query failure by identity without retry", async () => {
    const failure = new TaskRunListStoreFailure({
      operation: "list_task_runs",
      reason: "stale_scope_authority",
      cause: null,
    });
    const list = vi.fn<StandardApplicationTaskRunListQueryApi["list"]>(
      () => Effect.fail(failure),
    );
    const received = await Effect.runPromise(Effect.flip(runWithEffect({
      scope: pointQueryScope(),
      list,
    })));

    expect(received).toBe(failure);
    expect(list).toHaveBeenCalledOnce();
  });

  it("keeps equal run ids isolated by independently captured scopes", async () => {
    const firstList = vi.fn<StandardApplicationTaskRunListQueryApi["list"]>(
      () => Effect.succeed(page(databaseTime(2_000))),
    );
    const secondList = vi.fn<StandardApplicationTaskRunListQueryApi["list"]>(
      () => Effect.succeed(page(databaseTime(3_000))),
    );

    const first = await runWith({ scope: pointQueryScope(), list: firstList });
    expect(first.observedAtMs).toBe(databaseTime(2_000));
    expect(secondList).not.toHaveBeenCalled();

    const second = await runWith({ scope: pointQueryScope(), list: secondList });
    expect(second.observedAtMs).toBe(databaseTime(3_000));
    expect(firstList).toHaveBeenCalledOnce();
    expect(secondList).toHaveBeenCalledOnce();
  });
});

function runWith(api: StandardApplicationTaskRunListQueryApi) {
  return Effect.runPromise(runWithEffect(api));
}

function runWithEffect(api: StandardApplicationTaskRunListQueryApi) {
  return listStandardApplicationTaskRuns({ pageSize: 10, cursor: null }).pipe(
    Effect.provideService(
      StandardApplicationTaskRunListQuery,
      StandardApplicationTaskRunListQuery.of(api),
    ),
  );
}

function pointQueryScope(): StandardApplicationTaskRunQueryApi {
  return StandardApplicationTaskRunQuery.of({
    inspect: () => Effect.die("must not inspect a Task run"),
  });
}

function page(observedAtMs: TaskDatabaseTimeMsV1) {
  return Object.freeze({
    observedAtMs,
    items: Object.freeze([Object.freeze({
      runId,
      createdAtMs: databaseTime(1_000),
      observedAtMs,
      runVersion: runVersion(1n),
      state: Object.freeze({
        kind: "ready" as const,
        eligibleAtMs: databaseTime(1_000),
        retry: null,
        cancellation: Object.freeze({ kind: "not_requested" as const }),
      }),
    })]),
    nextCursor: null,
  });
}
