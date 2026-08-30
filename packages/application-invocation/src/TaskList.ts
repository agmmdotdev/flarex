import {
  STANDARD_APPLICATION_TASK_RUN_LIST_MAX_PAGE_SIZE,
  StandardApplicationTaskRunListQuery,
  type StandardApplicationTaskRunListOptions,
  type StandardApplicationTaskRunListPage,
  type StandardApplicationTaskRunListQueryError,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-read-query";
import type { StandardApplicationTaskRunQueryApi } from
  "@flarex/standard-application-invocation/internal/standard-application-task-run-query";
import { Data, Effect, Result } from "effect";

import {
  projectTaskRunStatus,
  type TaskRunStatus,
} from "./TaskStatus.js";
import {
  issueTaskRunRef,
  type TaskRunRef,
} from "./TaskRunRef.js";

const DEFAULT_TASK_RUN_LIST_PAGE_SIZE = 50;

declare const TaskRunCursorType: unique symbol;

/** Opaque process-local continuation returned by `listTaskRuns()`. */
export interface TaskRunCursor {
  readonly [TaskRunCursorType]: true;
}

export interface ListTaskRunsOptions {
  readonly pageSize?: number;
  readonly cursor?: TaskRunCursor | null;
}

export interface ListedTaskRun {
  readonly ref: TaskRunRef;
  readonly status: TaskRunStatus;
}

export interface TaskRunPage {
  readonly observedAtMs: number;
  readonly runs: readonly ListedTaskRun[];
  readonly nextCursor: TaskRunCursor | null;
}

class ListTaskRunsOptionsFailure extends Data.TaggedError(
  "ListTaskRunsOptionsError",
)<{
  readonly field: "pageSize" | "cursor";
  readonly reason: "invalid_page_size" | "invalid_cursor";
}> {}

export type ListTaskRunsOptionsError = ListTaskRunsOptionsFailure;
type StandardApplicationTaskRunListNonOptionsError = Exclude<
  StandardApplicationTaskRunListQueryError,
  { readonly _tag: "TaskRunListOptionsError" }
>;
export type ListTaskRunsError =
  | ListTaskRunsOptionsError
  | StandardApplicationTaskRunListNonOptionsError;

const taskRunCursorStates = new WeakMap<
  TaskRunCursor,
  NonNullable<StandardApplicationTaskRunListOptions["cursor"]>
>();

class TaskRunCursorHandle implements TaskRunCursor {
  declare readonly [TaskRunCursorType]: true;

  constructor(
    cursor: NonNullable<StandardApplicationTaskRunListOptions["cursor"]>,
  ) {
    taskRunCursorStates.set(this, Object.freeze({ ...cursor }));
    Object.freeze(this);
  }
}

/** Lists the newest authoritative Task runs in the captured Application scope. */
export const listTaskRuns = Effect.fn("Application.listTaskRuns")(function* (
  options: ListTaskRunsOptions = {},
): Effect.fn.Return<
  TaskRunPage,
  ListTaskRunsError,
  StandardApplicationTaskRunListQuery
> {
  const normalized = yield* Effect.fromResult(normalizeOptions(options));
  const listQuery = yield* StandardApplicationTaskRunListQuery;
  const page = yield* listQuery.list(normalized).pipe(
    Effect.catchTag("TaskRunListOptionsError", error =>
      Effect.fail(new ListTaskRunsOptionsFailure({
        field: error.field,
        reason: error.reason,
      }))
    ),
  );
  return projectPage(page, listQuery.scope);
});

function normalizeOptions(
  options: ListTaskRunsOptions,
): Result.Result<
  StandardApplicationTaskRunListOptions,
  ListTaskRunsOptionsError
> {
  const suppliedPageSize = options.pageSize;
  const pageSize = suppliedPageSize === undefined
    ? DEFAULT_TASK_RUN_LIST_PAGE_SIZE
    : suppliedPageSize;
  if (
    !Number.isSafeInteger(pageSize)
    || pageSize < 1
    || pageSize > STANDARD_APPLICATION_TASK_RUN_LIST_MAX_PAGE_SIZE
  ) {
    return Result.fail(new ListTaskRunsOptionsFailure({
      field: "pageSize",
      reason: "invalid_page_size",
    }));
  }

  const suppliedCursor = options.cursor;
  if (suppliedCursor === undefined || suppliedCursor === null) {
    return Result.succeed(Object.freeze({ pageSize, cursor: null }));
  }
  const cursor = taskRunCursorStates.get(suppliedCursor);
  return cursor === undefined
    ? Result.fail(new ListTaskRunsOptionsFailure({
        field: "cursor",
        reason: "invalid_cursor",
      }))
    : Result.succeed(Object.freeze({ pageSize, cursor }));
}

function projectPage(
  page: StandardApplicationTaskRunListPage,
  query: StandardApplicationTaskRunQueryApi,
): TaskRunPage {
  const runs = Object.freeze(page.items.map(status => Object.freeze({
    ref: issueTaskRunRef(status.runId, query),
    status: projectTaskRunStatus(status),
  })));
  return Object.freeze({
    observedAtMs: page.observedAtMs,
    runs,
    nextCursor: page.nextCursor === null
      ? null
      : new TaskRunCursorHandle(page.nextCursor),
  });
}
