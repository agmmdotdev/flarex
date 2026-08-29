import { Context, Data, Effect, Layer, Result } from "effect";

import {
  decodeTaskDatabaseTimeMsV1,
  decodeTaskRunIdV1,
} from "../runAttempt/Schema.js";
import {
  MAX_TASK_RUN_LIST_PAGE_SIZE,
  type ApplicationTaskRunListStoreShape,
  type TaskRunListCursorV1,
  type TaskRunListPage,
  type TaskRunListQueryOptions,
  type TaskRunListStoreError,
  type TaskRunListStorePage,
  type TaskRunListStoreRequest,
} from "./ListModel.js";
import { projectTaskRunListItem } from "./Projection.js";
import {
  decodeTaskRunListStoreItem,
  type TaskRunListStoreItem,
  validateTaskRunListStoreItemSemantics,
} from "./ListSchema.js";

class TaskRunListOptionsFailure extends Data.TaggedError(
  "TaskRunListOptionsError",
)<{
  readonly field: "pageSize" | "cursor";
  readonly reason: "invalid_page_size" | "invalid_cursor";
}> {}

class TaskRunListStoreContractFailure extends Data.TaggedError(
  "TaskRunListStoreContractError",
)<{
  readonly reason:
    | "page_too_large"
    | "order_invalid"
    | "cursor_not_advanced"
    | "item_invalid"
    | "item_semantics_invalid"
    | "observation_invalid"
    | "observation_precedes_creation"
    | "page_invalid"
    | "has_more_invalid";
}> {}

export type TaskRunListOptionsError = TaskRunListOptionsFailure;
export type TaskRunListStoreContractError = TaskRunListStoreContractFailure;
export type TaskRunListQueryError =
  | TaskRunListOptionsError
  | TaskRunListStoreContractError
  | TaskRunListStoreError;

export interface TaskRunListQueryApi {
  readonly list: (
    options: TaskRunListQueryOptions,
  ) => Effect.Effect<TaskRunListPage, TaskRunListQueryError>;
}

export class TaskRunListQuery extends Context.Service<
  TaskRunListQuery,
  TaskRunListQueryApi
>()("flarex/durable-task/TaskRunListQuery") {}

export function makeTaskRunListQueryLayer(
  store: ApplicationTaskRunListStoreShape,
): Layer.Layer<TaskRunListQuery> {
  const listRuns = store.listRuns;
  const list: TaskRunListQueryApi["list"] = Effect.fn(
    "TaskRunListQuery.list",
  )(function* (options) {
    const request = yield* Effect.fromResult(normalizeRequest(options));
    const page = yield* listRuns(request);
    return yield* Effect.fromResult(projectPage(request, page));
  });
  return Layer.succeed(TaskRunListQuery, TaskRunListQuery.of({ list }));
}

function normalizeRequest(
  options: TaskRunListQueryOptions,
): Result.Result<TaskRunListStoreRequest, TaskRunListOptionsError> {
  const pageSize = options.pageSize;
  if (
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > MAX_TASK_RUN_LIST_PAGE_SIZE
  ) {
    return Result.fail(new TaskRunListOptionsFailure({
      field: "pageSize",
      reason: "invalid_page_size",
    }));
  }
  const suppliedCursor = options.cursor ?? null;
  if (suppliedCursor === null) {
    return Result.succeed(Object.freeze({
      pageSize,
      cursor: null,
    }));
  }
  const version = suppliedCursor.version;
  const createdAtMs = suppliedCursor.createdAtMs;
  const runId = suppliedCursor.runId;
  if (version !== 1) {
    return Result.fail(new TaskRunListOptionsFailure({
      field: "cursor",
      reason: "invalid_cursor",
    }));
  }
  return Result.gen(function* () {
    const validCreatedAtMs = yield* decodeTaskDatabaseTimeMsV1(createdAtMs).pipe(
      Result.mapError(() => new TaskRunListOptionsFailure({
        field: "cursor",
        reason: "invalid_cursor",
      })),
    );
    const validRunId = yield* decodeTaskRunIdV1(runId).pipe(
      Result.mapError(() => new TaskRunListOptionsFailure({
        field: "cursor",
        reason: "invalid_cursor",
      })),
    );
    return Object.freeze({
      pageSize,
      cursor: cursorFor(validCreatedAtMs, validRunId),
    });
  });
}

function projectPage(
  request: TaskRunListStoreRequest,
  page: TaskRunListStorePage,
): Result.Result<TaskRunListPage, TaskRunListStoreContractError> {
  const observedAtInput = page.observedAtMs;
  const rawRuns = page.runs;
  const hasMore = page.hasMore;
  return Result.gen(function* () {
    if (!Array.isArray(rawRuns) || typeof hasMore !== "boolean") {
      return yield* contractFailure("page_invalid");
    }
    const runCount = rawRuns.length;
    const observedAtMs = yield* decodeTaskDatabaseTimeMsV1(observedAtInput).pipe(
      Result.mapError(() => contractError("observation_invalid")),
    );
    if (runCount > request.pageSize) {
      return yield* contractFailure("page_too_large");
    }
    if (hasMore && (runCount === 0 || runCount !== request.pageSize)) {
      return yield* contractFailure("has_more_invalid");
    }

    const runs: TaskRunListStoreItem[] = [];
    let previous = request.cursor;
    for (let index = 0; index < runCount; index += 1) {
      const run = yield* decodeTaskRunListStoreItem(rawRuns[index]).pipe(
        Result.mapError(() => contractError("item_invalid")),
      );
      if (run.createdAtMs > observedAtMs) {
        return yield* contractFailure("observation_precedes_creation");
      }
      yield* validateTaskRunListStoreItemSemantics(observedAtMs, run).pipe(
        Result.mapError(() => contractError("item_semantics_invalid")),
      );
      const position = cursorFor(run.createdAtMs, run.runId);
      if (previous !== null && comparePosition(position, previous) >= 0) {
        return yield* contractFailure(
          previous === request.cursor ? "cursor_not_advanced" : "order_invalid",
        );
      }
      previous = position;
      runs.push(run);
    }

    const items = Object.freeze(runs.map(current =>
      projectTaskRunListItem(observedAtMs, current)
    ));
    const nextCursor = hasMore && previous !== null
      ? freezeCursor(previous)
      : null;
    return Object.freeze({ observedAtMs, items, nextCursor });
  });
}

function contractFailure(
  reason: TaskRunListStoreContractError["reason"],
): Result.Result<never, TaskRunListStoreContractError> {
  return Result.fail(contractError(reason));
}

function contractError(
  reason: TaskRunListStoreContractError["reason"],
): TaskRunListStoreContractError {
  return new TaskRunListStoreContractFailure({ reason });
}

function cursorFor(
  createdAtMs: TaskRunListCursorV1["createdAtMs"],
  runId: TaskRunListCursorV1["runId"],
): TaskRunListCursorV1 {
  return Object.freeze({ version: 1, createdAtMs, runId });
}

function freezeCursor(cursor: TaskRunListCursorV1): TaskRunListCursorV1 {
  return cursorFor(cursor.createdAtMs, cursor.runId);
}

function comparePosition(
  left: TaskRunListCursorV1,
  right: TaskRunListCursorV1,
): -1 | 0 | 1 {
  if (left.createdAtMs < right.createdAtMs) return -1;
  if (left.createdAtMs > right.createdAtMs) return 1;
  // Task run IDs are fixed-length lowercase ASCII. JavaScript string order is
  // therefore their canonical ASCII byte order; SQL adapters must use the
  // equivalent binary/C collation for both ORDER BY and cursor predicates.
  if (left.runId < right.runId) return -1;
  if (left.runId > right.runId) return 1;
  return 0;
}
