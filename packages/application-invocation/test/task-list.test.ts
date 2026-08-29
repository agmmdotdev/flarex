import {
  makeStandardApplicationTaskRunListQueryLayer,
  StandardApplicationTaskRunListQuery,
  type StandardApplicationTaskRunListPage,
  type StandardApplicationTaskRunListQueryApi,
  type StandardApplicationTaskRunListQueryError,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-run-list-query";
import { Brand, Data, Effect } from "effect";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  listTaskRuns,
  type ListTaskRunsOptions,
  type ListTaskRunsOptionsError,
  type TaskRunCursor,
  type TaskRunPage,
} from "../src/index.js";

type InternalCursor = NonNullable<
  StandardApplicationTaskRunListPage["nextCursor"]
>;
type CapturedListStore = Parameters<
  typeof makeStandardApplicationTaskRunListQueryLayer
>[0];
type CapturedStorePage = Effect.Success<
  ReturnType<CapturedListStore["listRuns"]>
>;
const databaseTime = Brand.nominal<InternalCursor["createdAtMs"]>();
const runId = Brand.nominal<InternalCursor["runId"]>();
const runVersion = Brand.nominal<
  StandardApplicationTaskRunListPage["items"][number]["runVersion"]
>();
const internalCursor = Object.freeze({
  version: 1 as const,
  createdAtMs: databaseTime(1_000),
  runId: runId("run_00000000-0000-4000-8000-000000000081"),
});

class StoreUnavailableFailure extends Data.TaggedError(
  "TaskRunListStoreError",
)<{
  readonly operation: "list_task_runs";
  readonly reason: "unavailable";
  readonly cause: unknown;
}> {}

class PrivateOptionsFailure extends Data.TaggedError(
  "TaskRunListOptionsError",
)<{
  readonly field: "pageSize" | "cursor";
  readonly reason: "invalid_page_size" | "invalid_cursor";
}> {}

describe("clean Task-run list primitive", () => {
  it("uses the clean default and issues an opaque continuation", async () => {
    const items = Object.freeze([readyRun()]);
    const list = vi.fn<StandardApplicationTaskRunListQueryApi["list"]>(
      () => Effect.succeed(Object.freeze({
        observedAtMs: databaseTime(2_000),
        items,
        nextCursor: internalCursor,
      })),
    );

    const page = await runWith(list);

    expect(list).toHaveBeenCalledWith({ pageSize: 50, cursor: null });
    expect(page.observedAtMs).toBe(databaseTime(2_000));
    expect(page.runs).toBe(items);
    expect(page.nextCursor).not.toBeNull();
    expect(Object.isFrozen(page)).toBe(true);
    expect(Object.isFrozen(page.runs)).toBe(true);
    expect(Object.isFrozen(page.nextCursor)).toBe(true);
    expect(Object.keys(page.nextCursor ?? {})).toEqual([]);
    expectTypeOf(page).toEqualTypeOf<TaskRunPage>();
  });

  it("round-trips only an issued cursor into the private keyset query", async () => {
    const list = vi.fn<StandardApplicationTaskRunListQueryApi["list"]>(
      options => Effect.succeed(Object.freeze({
        observedAtMs: databaseTime(2_000),
        items: Object.freeze([]),
        nextCursor: options.cursor === null ? internalCursor : null,
      })),
    );

    const first = await runWith(list, { pageSize: 7 });
    const second = await runWith(list, {
      pageSize: 7,
      cursor: first.nextCursor,
    });

    expect(second.nextCursor).toBeNull();
    expect(list).toHaveBeenNthCalledWith(1, { pageSize: 7, cursor: null });
    expect(list).toHaveBeenNthCalledWith(2, {
      pageSize: 7,
      cursor: internalCursor,
    });
  });

  it("composes the clean facade through the Standard and durable query owners", async () => {
    const listRuns = vi.fn<CapturedListStore["listRuns"]>(
      () => Effect.succeed(Object.freeze({
        observedAtMs: databaseTime(2_000),
        runs: Object.freeze([storeReadyRun()]),
        hasMore: false,
      })),
    );

    const page = await Effect.runPromise(listTaskRuns({ pageSize: 3 }).pipe(
      Effect.provide(makeStandardApplicationTaskRunListQueryLayer({
        listRuns,
      })),
    ));

    expect(listRuns).toHaveBeenCalledWith({ pageSize: 3, cursor: null });
    expect(page.runs).toHaveLength(1);
    expect(page.runs[0]).toMatchObject({
      runId: internalCursor.runId,
      observedAtMs: databaseTime(2_000),
      state: { kind: "ready" },
    });
    expect(Object.isFrozen(page.runs[0])).toBe(true);
  });

  it.each([0, 101, 1.5, Number.NaN])(
    "rejects invalid page size %s before query I/O",
    async pageSize => {
      const list = forbiddenList();
      const failure = await Effect.runPromise(Effect.flip(
        listTaskRuns({ pageSize }).pipe(Effect.provideService(
          StandardApplicationTaskRunListQuery,
          StandardApplicationTaskRunListQuery.of({ list }),
        )),
      ));

      expect(failure).toMatchObject({
        _tag: "ListTaskRunsOptionsError",
        field: "pageSize",
        reason: "invalid_page_size",
      });
      expect(list).not.toHaveBeenCalled();
    },
  );

  it("rejects a forged cursor before query I/O", async () => {
    const list = forbiddenList();
    const forged = Object.freeze({}) as TaskRunCursor;
    const failure = await Effect.runPromise(Effect.flip(
      listTaskRuns({ cursor: forged }).pipe(Effect.provideService(
        StandardApplicationTaskRunListQuery,
        StandardApplicationTaskRunListQuery.of({ list }),
      )),
    ));

    expect(failure).toMatchObject({
      _tag: "ListTaskRunsOptionsError",
      field: "cursor",
      reason: "invalid_cursor",
    });
    if (failure._tag === "ListTaskRunsOptionsError") {
      expectTypeOf(failure).toEqualTypeOf<ListTaskRunsOptionsError>();
    }
    expect(list).not.toHaveBeenCalled();
  });

  it("reads option properties once in validation order", async () => {
    const list = vi.fn<StandardApplicationTaskRunListQueryApi["list"]>(
      () => Effect.succeed(emptyPage()),
    );
    const pageSizes = [9, 0];
    let pageSizeReads = 0;
    let cursorReads = 0;
    const options = Object.defineProperties({}, {
      pageSize: {
        get: () => pageSizes[pageSizeReads++],
      },
      cursor: {
        get: () => {
          cursorReads += 1;
          return null;
        },
      },
    }) as ListTaskRunsOptions;

    await runWith(list, options);

    expect(pageSizeReads).toBe(1);
    expect(cursorReads).toBe(1);
    expect(list).toHaveBeenCalledWith({ pageSize: 9, cursor: null });
  });

  it("preserves non-option query failures by identity without retry", async () => {
    const failure: StandardApplicationTaskRunListQueryError =
      new StoreUnavailableFailure({
        operation: "list_task_runs",
        reason: "unavailable",
        cause: null,
      });
    const list = vi.fn<StandardApplicationTaskRunListQueryApi["list"]>(
      () => Effect.fail(failure),
    );

    const received = await Effect.runPromise(Effect.flip(
      listTaskRuns().pipe(Effect.provideService(
        StandardApplicationTaskRunListQuery,
        StandardApplicationTaskRunListQuery.of({ list }),
      )),
    ));

    expect(received).toBe(failure);
    expect(list).toHaveBeenCalledOnce();
  });

  it("maps only the private options failure into the clean contract", async () => {
    const upstream: StandardApplicationTaskRunListQueryError =
      new PrivateOptionsFailure({
        field: "cursor",
        reason: "invalid_cursor",
      });
    const list = vi.fn<StandardApplicationTaskRunListQueryApi["list"]>(
      () => Effect.fail(upstream),
    );

    const failure = await Effect.runPromise(Effect.flip(
      listTaskRuns().pipe(Effect.provideService(
        StandardApplicationTaskRunListQuery,
        StandardApplicationTaskRunListQuery.of({ list }),
      )),
    ));

    expect(failure).not.toBe(upstream);
    expect(failure).toMatchObject({
      _tag: "ListTaskRunsOptionsError",
      field: "cursor",
      reason: "invalid_cursor",
    });
    expect(list).toHaveBeenCalledOnce();
  });
});

async function runWith(
  list: StandardApplicationTaskRunListQueryApi["list"],
  options?: ListTaskRunsOptions,
): Promise<TaskRunPage> {
  return Effect.runPromise(listTaskRuns(options).pipe(Effect.provideService(
    StandardApplicationTaskRunListQuery,
    StandardApplicationTaskRunListQuery.of({ list }),
  )));
}

function forbiddenList(): ReturnType<typeof vi.fn<
  StandardApplicationTaskRunListQueryApi["list"]
>> {
  return vi.fn<StandardApplicationTaskRunListQueryApi["list"]>(
    () => Effect.die("must not list Task runs"),
  );
}

function emptyPage(): StandardApplicationTaskRunListPage {
  return Object.freeze({
    observedAtMs: databaseTime(2_000),
    items: Object.freeze([]),
    nextCursor: null,
  });
}

function readyRun(): StandardApplicationTaskRunListPage["items"][number] {
  return Object.freeze({
    runId: internalCursor.runId,
    createdAtMs: internalCursor.createdAtMs,
    observedAtMs: databaseTime(2_000),
    runVersion: runVersion(1n),
    state: Object.freeze({
      kind: "ready",
      eligibleAtMs: internalCursor.createdAtMs,
      retry: null,
      cancellation: Object.freeze({ kind: "not_requested" }),
    }),
  });
}

function storeReadyRun(): CapturedStorePage["runs"][number] {
  return Object.freeze({
    runId: internalCursor.runId,
    createdAtMs: internalCursor.createdAtMs,
    runVersion: runVersion(1n),
    state: Object.freeze({
      kind: "ready",
      eligibleAtMs: internalCursor.createdAtMs,
      retry: null,
      cancellation: Object.freeze({ kind: "not_requested" }),
    }),
  });
}
