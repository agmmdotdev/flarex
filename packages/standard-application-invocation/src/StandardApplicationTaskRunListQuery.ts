import {
  MAX_TASK_RUN_LIST_PAGE_SIZE,
  type TaskRunListPage,
  type TaskRunListQueryApi,
  type TaskRunListQueryError,
  type TaskRunListQueryOptions,
} from "@flarex/durable-task/internal/run-projection";
import { Context, Effect } from "effect";

import type { StandardApplicationTaskRunQueryApi } from
  "./StandardApplicationTaskRunQuery.js";

export type StandardApplicationTaskRunListPage = TaskRunListPage;
export type StandardApplicationTaskRunListOptions = TaskRunListQueryOptions;
export type StandardApplicationTaskRunListQueryError = TaskRunListQueryError;
export const STANDARD_APPLICATION_TASK_RUN_LIST_MAX_PAGE_SIZE =
  MAX_TASK_RUN_LIST_PAGE_SIZE;

export interface StandardApplicationTaskRunListQueryApi {
  /** Exact point-query capability that owns every listed run reference. */
  readonly scope: StandardApplicationTaskRunQueryApi;
  readonly list: TaskRunListQueryApi["list"];
}

export class StandardApplicationTaskRunListQuery extends Context.Service<
  StandardApplicationTaskRunListQuery,
  StandardApplicationTaskRunListQueryApi
>()(
  "flarex/standard-application-invocation/StandardApplicationTaskRunListQuery",
) {}

export const listStandardApplicationTaskRuns = Effect.fn(
  "StandardApplicationTaskRunListQuery.list",
)(function* (
  options: StandardApplicationTaskRunListOptions,
): Effect.fn.Return<
  StandardApplicationTaskRunListPage,
  StandardApplicationTaskRunListQueryError,
  StandardApplicationTaskRunListQuery
> {
  const query = yield* StandardApplicationTaskRunListQuery;
  return yield* query.list(options);
});
