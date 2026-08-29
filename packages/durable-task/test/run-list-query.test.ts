import { Brand, Effect, Result, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";

import type {
  ApplicationTaskRunAttemptAggregateV1,
  TaskAttemptNumberV1,
  TaskComputeProfileRefV1,
  TaskDatabaseTimeMsV1,
  TaskRunIdV1,
  TaskRunVersionV1,
} from "../src/runAttempt/Model.js";
import type { ApplicationTaskRuntimeTargetSha256V1 } from
  "../src/runCreation/Model.js";
import {
  makeTaskRunListQueryLayer,
  MAX_TASK_RUN_LIST_PAGE_SIZE,
  projectTaskRun,
  type ApplicationTaskRunListStoreShape,
  type TaskRunListCursorV1,
  TaskRunListQuery,
  type TaskRunListStoreItem,
  TaskRunListStoreItemSchema,
  type TaskRunListQueryOptions,
  TaskRunListStoreFailure,
  type TaskRunListStorePage,
} from "../src/runProjection/index.js";
import { readyAggregate } from "./support.js";

const runId = Brand.nominal<TaskRunIdV1>();
const databaseTime = Brand.nominal<TaskDatabaseTimeMsV1>();
const runVersion = Brand.nominal<TaskRunVersionV1>();
const RUN_1 = runId("run_00000000-0000-4000-8000-000000000081");
const RUN_2 = runId("run_00000000-0000-4000-8000-000000000082");
const RUN_3 = runId("run_00000000-0000-4000-8000-000000000083");
const RUN_4 = runId("run_00000000-0000-4000-8000-000000000084");
const OBSERVED_AT = databaseTime(10_000);
const attemptNumber = Brand.nominal<TaskAttemptNumberV1>();
const computeProfile = Brand.nominal<TaskComputeProfileRefV1>();

describe("TaskRunListQuery", () => {
  it("returns stable newest-first pages and derives the continuation cursor", async () => {
    const stored = [
      applicationReady(RUN_1, 1_000),
      applicationReady(RUN_2, 3_000),
      applicationReady(RUN_3, 3_000),
    ];
    const listRuns = vi.fn<ApplicationTaskRunListStoreShape["listRuns"]>(
      request => Effect.succeed(listPage(stored, request)),
    );
    const layer = makeTaskRunListQueryLayer({ listRuns });

    const first = await Effect.runPromise(listWith(layer, {
      pageSize: 2,
    }));
    expect(first.items.map(item => item.runId)).toEqual([RUN_3, RUN_2]);
    expect(first.nextCursor).toEqual({
      version: 1,
      createdAtMs: databaseTime(3_000),
      runId: RUN_2,
    });
    expect(listRuns).toHaveBeenNthCalledWith(1, {
      pageSize: 2,
      cursor: null,
    });

    stored.push(applicationReady(RUN_4, 4_000));
    const second = await Effect.runPromise(listWith(layer, {
      pageSize: 2,
      cursor: first.nextCursor,
    }));
    expect(second.items.map(item => item.runId)).toEqual([RUN_1]);
    expect(second.nextCursor).toBeNull();
    expect(second.items.some(item => item.runId === RUN_4)).toBe(false);
    expect(listRuns).toHaveBeenCalledTimes(2);

    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.items)).toBe(true);
    expect(Object.isFrozen(first.nextCursor)).toBe(true);
    for (const item of first.items) {
      expect(Object.isFrozen(item)).toBe(true);
      expect(hasOwnKeyDeep(item, "applicationTaskRuntimeTargetSha256"))
        .toBe(false);
      expect(hasOwnKeyDeep(item, "attemptId")).toBe(false);
      expect(hasOwnKeyDeep(item, "message")).toBe(false);
    }
  });

  it.each([
    0,
    -1,
    1.5,
    MAX_TASK_RUN_LIST_PAGE_SIZE + 1,
  ])("rejects invalid page size %s before store I/O", async (pageSize) => {
    const listRuns = vi.fn<ApplicationTaskRunListStoreShape["listRuns"]>(
      () => Effect.die("must not list"),
    );
    const result = await Effect.runPromise(Effect.result(listWith(
      makeTaskRunListQueryLayer({ listRuns }),
      { pageSize },
    )));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: "TaskRunListOptionsError",
        field: "pageSize",
        reason: "invalid_page_size",
      });
    }
    expect(listRuns).not.toHaveBeenCalled();
  });

  it("rejects an invalid cursor before store I/O", async () => {
    const listRuns = vi.fn<ApplicationTaskRunListStoreShape["listRuns"]>(
      () => Effect.die("must not list"),
    );
    const invalid = Object.freeze({
      version: 2,
      createdAtMs: databaseTime(1_000),
      runId: RUN_1,
    }) as unknown as TaskRunListCursorV1;
    const result = await Effect.runPromise(Effect.result(listWith(
      makeTaskRunListQueryLayer({ listRuns }),
      { pageSize: 10, cursor: invalid },
    )));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: "TaskRunListOptionsError",
        field: "cursor",
        reason: "invalid_cursor",
      });
    }
    expect(listRuns).not.toHaveBeenCalled();
  });

  it.each([
    {
      version: 1,
      createdAtMs: databaseTime(-1),
      runId: RUN_1,
    },
    {
      version: 1,
      createdAtMs: databaseTime(1_000),
      runId: runId("not-a-run-id"),
    },
  ] as const)("rejects each invalid cursor field before store I/O", async (
    invalid,
  ) => {
    const listRuns = vi.fn<ApplicationTaskRunListStoreShape["listRuns"]>(
      () => Effect.die("must not list"),
    );
    const result = await Effect.runPromise(Effect.result(listWith(
      makeTaskRunListQueryLayer({ listRuns }),
      { pageSize: 10, cursor: invalid },
    )));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: "TaskRunListOptionsError",
        field: "cursor",
        reason: "invalid_cursor",
      });
    }
    expect(listRuns).not.toHaveBeenCalled();
  });

  it("snapshots validated option and cursor properties exactly once", async () => {
    const reads = { pageSize: 0, version: 0, createdAtMs: 0, runId: 0 };
    const cursorWithGetters = {
      get version() {
        reads.version += 1;
        return reads.version === 1 ? 1 : 2;
      },
      get createdAtMs() {
        reads.createdAtMs += 1;
        return reads.createdAtMs === 1 ? databaseTime(2_000) : databaseTime(-1);
      },
      get runId() {
        reads.runId += 1;
        return reads.runId === 1 ? RUN_2 : runId("not-a-run-id");
      },
    } as unknown as TaskRunListCursorV1;
    const options: TaskRunListQueryOptions = {
      get pageSize() {
        reads.pageSize += 1;
        return reads.pageSize === 1 ? 1 : MAX_TASK_RUN_LIST_PAGE_SIZE + 1;
      },
      cursor: cursorWithGetters,
    };
    const listRuns = vi.fn<ApplicationTaskRunListStoreShape["listRuns"]>(
      () => Effect.succeed({
        observedAtMs: OBSERVED_AT,
        runs: Object.freeze([applicationReady(RUN_1, 1_000)]),
        hasMore: false,
      }),
    );

    await Effect.runPromise(listWith(
      makeTaskRunListQueryLayer({ listRuns }),
      options,
    ));

    expect(reads).toEqual({ pageSize: 1, version: 1, createdAtMs: 1, runId: 1 });
    expect(listRuns).toHaveBeenCalledWith({
      pageSize: 1,
      cursor: cursor(RUN_2, 2_000),
    });
  });

  it("snapshots validated store-page properties exactly once", async () => {
    const reads = { observedAtMs: 0, runs: 0, hasMore: 0 };
    const page: TaskRunListStorePage = {
      get observedAtMs() {
        reads.observedAtMs += 1;
        return reads.observedAtMs === 1 ? OBSERVED_AT : databaseTime(0);
      },
      get runs() {
        reads.runs += 1;
        return reads.runs === 1
          ? Object.freeze([applicationReady(RUN_1, 1_000)])
          : Object.freeze([]);
      },
      get hasMore() {
        reads.hasMore += 1;
        return reads.hasMore === 1;
      },
    };
    const result = await Effect.runPromise(listWith(
      makeTaskRunListQueryLayer({ listRuns: () => Effect.succeed(page) }),
      { pageSize: 1 },
    ));

    expect(reads).toEqual({ observedAtMs: 1, runs: 1, hasMore: 1 });
    expect(result.observedAtMs).toBe(OBSERVED_AT);
    expect(result.nextCursor).toEqual(cursor(RUN_1, 1_000));
  });

  it("keeps direct Schema decoding strict at every struct boundary", () => {
    const item = applicationReady(RUN_1, 1_000);
    const decodeDirect = Schema.decodeUnknownResult(TaskRunListStoreItemSchema);

    expect(Result.isFailure(decodeDirect({ ...item, extra: true }))).toBe(true);
    expect(Result.isFailure(decodeDirect({
      ...item,
      state: { ...item.state, extra: true },
    }))).toBe(true);
  });

  it.each([
    [
      "page_too_large",
      { runs: [applicationReady(RUN_2, 2_000), applicationReady(RUN_1, 1_000)], hasMore: false },
      1,
      null,
    ],
    [
      "order_invalid",
      { runs: [applicationReady(RUN_1, 1_000), applicationReady(RUN_2, 2_000)], hasMore: false },
      2,
      null,
    ],
    [
      "cursor_not_advanced",
      { runs: [applicationReady(RUN_2, 2_000)], hasMore: false },
      1,
      cursor(RUN_1, 1_000),
    ],
    [
      "observation_precedes_creation",
      { runs: [applicationReady(RUN_1, 20_000)], hasMore: false },
      1,
      null,
    ],
    [
      "has_more_invalid",
      { runs: [], hasMore: true },
      1,
      null,
    ],
    [
      "has_more_invalid",
      { runs: [applicationReady(RUN_1, 1_000)], hasMore: true },
      2,
      null,
    ],
    [
      "item_invalid",
      {
        runs: [{ ...applicationReady(RUN_1, 1_000), runId: runId("invalid") }],
        hasMore: false,
      },
      1,
      null,
    ],
    [
      "item_semantics_invalid",
      { runs: [failedItem(RUN_1, 1_000, 500)], hasMore: false },
      1,
      null,
    ],
    [
      "item_semantics_invalid",
      { runs: [failedItem(RUN_1, 1_000, 20_000)], hasMore: false },
      1,
      null,
    ],
    [
      "item_semantics_invalid",
      { runs: [retryReadyItem(RUN_1, 1_000, 2_000, 3_000)], hasMore: false },
      1,
      null,
    ],
    [
      "item_semantics_invalid",
      { runs: [retryReadyItem(RUN_1, 1_000, 2_001, 2_000)], hasMore: false },
      1,
      null,
    ],
  ] as const)(
    "rejects malformed store page: %s",
    async (reason, page, pageSize, suppliedCursor) => {
      const listRuns: ApplicationTaskRunListStoreShape["listRuns"] = () =>
        Effect.succeed({ observedAtMs: OBSERVED_AT, ...page });
      const result = await Effect.runPromise(Effect.result(listWith(
        makeTaskRunListQueryLayer({ listRuns }),
        { pageSize, cursor: suppliedCursor },
      )));

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toMatchObject({
          _tag: "TaskRunListStoreContractError",
          reason,
        });
      }
    },
  );

  it("preserves a store failure by identity without retry", async () => {
    const failure = new TaskRunListStoreFailure({
      operation: "list_task_runs",
      reason: "transient",
      cause: new Error("database unavailable"),
    });
    const listRuns = vi.fn<ApplicationTaskRunListStoreShape["listRuns"]>(
      () => Effect.fail(failure),
    );
    const result = await Effect.runPromise(Effect.result(listWith(
      makeTaskRunListQueryLayer({ listRuns }),
      { pageSize: 10 },
    )));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBe(failure);
    expect(listRuns).toHaveBeenCalledOnce();
  });
});

function listWith(
  layer: ReturnType<typeof makeTaskRunListQueryLayer>,
  options: TaskRunListQueryOptions,
) {
  return Effect.gen(function* () {
    const query = yield* TaskRunListQuery;
    return yield* query.list(options);
  }).pipe(Effect.provide(layer));
}

function listPage(
  stored: readonly TaskRunListStoreItem[],
  request: Parameters<ApplicationTaskRunListStoreShape["listRuns"]>[0],
): TaskRunListStorePage {
  const eligible = [...stored].sort(compareRunsNewestFirst).filter(run =>
    request.cursor === null || compareRunToCursor(run, request.cursor) < 0
  );
  return Object.freeze({
    observedAtMs: OBSERVED_AT,
    runs: Object.freeze(eligible.slice(0, request.pageSize)),
    hasMore: eligible.length > request.pageSize,
  });
}

function compareRunsNewestFirst(
  left: TaskRunListStoreItem,
  right: TaskRunListStoreItem,
): number {
  return -compareRunToCursor(left, cursor(right.runId, right.createdAtMs));
}

function compareRunToCursor(
  run: TaskRunListStoreItem,
  position: TaskRunListCursorV1,
): number {
  if (run.createdAtMs < position.createdAtMs) return -1;
  if (run.createdAtMs > position.createdAtMs) return 1;
  return run.runId < position.runId ? -1 : run.runId > position.runId ? 1 : 0;
}

function cursor(id: TaskRunIdV1, createdAt: number): TaskRunListCursorV1 {
  return Object.freeze({
    version: 1,
    createdAtMs: databaseTime(createdAt),
    runId: id,
  });
}

function applicationReady(
  id: TaskRunIdV1,
  createdAt: number,
): TaskRunListStoreItem {
  const legacy = readyAggregate(runVersion(1n));
  if (legacy.phase !== "ready") throw new Error("Expected ready aggregate.");
  const createdAtMs = databaseTime(createdAt);
  const aggregate = {
    version: legacy.version,
    runId: id,
    applicationTaskRuntimeTargetSha256:
      Brand.nominal<ApplicationTaskRuntimeTargetSha256V1>()(
        new Uint8Array(32).fill(0x58),
      ),
    createdAtMs,
    runVersion: legacy.runVersion,
    boundPolicy: legacy.boundPolicy,
    attemptHistory: legacy.attemptHistory,
    leaseHistory: legacy.leaseHistory,
    lastLifecycleAcceptance: null,
    completionReplays: Object.freeze([]),
    requestedEffectCursor: legacy.requestedEffectCursor,
    phase: "ready" as const,
    ready: { kind: "initial" as const, eligibleAtMs: createdAtMs },
    cancellation: legacy.cancellation,
  } satisfies ApplicationTaskRunAttemptAggregateV1;
  const projection = projectTaskRun({
    observedAtMs: OBSERVED_AT,
    current: Object.freeze(aggregate),
  });
  return Object.freeze({
    runId: projection.runId,
    createdAtMs: projection.createdAtMs,
    runVersion: projection.runVersion,
    state: projection.state,
  });
}

function failedItem(
  id: TaskRunIdV1,
  createdAt: number,
  completedAt: number,
): TaskRunListStoreItem {
  const base = applicationReady(id, createdAt);
  return Object.freeze({
    ...base,
    state: Object.freeze({
      kind: "failed",
      completedAtMs: databaseTime(completedAt),
      attemptNumber: null,
      executionDurationMs: null,
      failure: Object.freeze({
        kind: "timed_out",
        code: "maximum_duration_exceeded",
      }),
      cancellation: Object.freeze({ kind: "not_requested" }),
    }),
  });
}

function retryReadyItem(
  id: TaskRunIdV1,
  createdAt: number,
  readyEligibleAt: number,
  acceptedAt: number,
): TaskRunListStoreItem {
  const base = applicationReady(id, createdAt);
  return Object.freeze({
    ...base,
    state: Object.freeze({
      kind: "ready",
      eligibleAtMs: databaseTime(readyEligibleAt),
      retry: Object.freeze({
        previousAttemptNumber: attemptNumber(1),
        acceptedAtMs: databaseTime(acceptedAt),
        eligibleAtMs: databaseTime(2_000),
        nextComputeProfile: computeProfile("standard-1x"),
        cause: Object.freeze({
          kind: "failed_completion",
          failure: Object.freeze({
            kind: "timed_out",
            code: "maximum_duration_exceeded",
          }),
        }),
      }),
      cancellation: Object.freeze({ kind: "not_requested" }),
    }),
  });
}

function hasOwnKeyDeep(value: unknown, key: string): boolean {
  if (value === null || typeof value !== "object") return false;
  if (Object.hasOwn(value, key)) return true;
  return Object.values(value).some(child => hasOwnKeyDeep(child, key));
}
