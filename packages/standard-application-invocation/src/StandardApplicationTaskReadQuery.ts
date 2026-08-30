import {
  makeTaskAttemptHistoryQueryLayer,
  makeTaskEventHistoryQueryLayer,
  makeTaskRunListQueryLayer,
  makeTaskRunQueryLayer,
  TaskAttemptHistoryQuery,
  TaskEventHistoryQuery,
  TaskRunListQuery,
  TaskRunQuery,
  type TaskAttemptHistory,
  type TaskAttemptHistoryQueryApi,
  type TaskAttemptHistoryQueryError,
  type TaskEventHistory,
  type TaskEventHistoryQueryApi,
  type TaskEventHistoryQueryError,
} from "@flarex/durable-task/internal/run-projection";
import {
  isApplicationTaskReadStore,
  type ApplicationTaskReadStore,
} from "@flarex/persistence-postgres/internal/application-task-read-store";
import { Context, Effect, Layer } from "effect";

import {
  StandardApplicationTaskRunListQuery,
} from "./StandardApplicationTaskRunListQuery.js";
import {
  StandardApplicationTaskRunQuery,
  type StandardApplicationTaskRunQueryApi,
} from "./StandardApplicationTaskRunQuery.js";

export {
  listStandardApplicationTaskRuns,
  STANDARD_APPLICATION_TASK_RUN_LIST_MAX_PAGE_SIZE,
  StandardApplicationTaskRunListQuery,
  type StandardApplicationTaskRunListOptions,
  type StandardApplicationTaskRunListPage,
  type StandardApplicationTaskRunListQueryApi,
  type StandardApplicationTaskRunListQueryError,
} from "./StandardApplicationTaskRunListQuery.js";

export type StandardApplicationTaskAttemptHistory = TaskAttemptHistory;
export type StandardApplicationTaskAttemptHistoryQueryError =
  TaskAttemptHistoryQueryError;
export type StandardApplicationTaskEventHistory = TaskEventHistory;
export type StandardApplicationTaskEventHistoryQueryError =
  TaskEventHistoryQueryError;

export interface StandardApplicationTaskAttemptHistoryQueryApi {
  readonly scope: StandardApplicationTaskRunQueryApi;
  readonly list: TaskAttemptHistoryQueryApi["list"];
}

export interface StandardApplicationTaskEventHistoryQueryApi {
  readonly scope: StandardApplicationTaskRunQueryApi;
  readonly list: TaskEventHistoryQueryApi["list"];
}

export class StandardApplicationTaskAttemptHistoryQuery extends Context.Service<
  StandardApplicationTaskAttemptHistoryQuery,
  StandardApplicationTaskAttemptHistoryQueryApi
>()(
  "flarex/standard-application-invocation/StandardApplicationTaskAttemptHistoryQuery",
) {}

export class StandardApplicationTaskEventHistoryQuery extends Context.Service<
  StandardApplicationTaskEventHistoryQuery,
  StandardApplicationTaskEventHistoryQueryApi
>()(
  "flarex/standard-application-invocation/StandardApplicationTaskEventHistoryQuery",
) {}

export const listStandardApplicationTaskAttempts = Effect.fn(
  "StandardApplicationTaskReadQuery.listAttempts",
)(function* (
  runId: TaskAttemptHistory["runId"],
): Effect.fn.Return<
  StandardApplicationTaskAttemptHistory,
  StandardApplicationTaskAttemptHistoryQueryError,
  StandardApplicationTaskAttemptHistoryQuery
> {
  const query = yield* StandardApplicationTaskAttemptHistoryQuery;
  return yield* query.list(runId);
});

export const listStandardApplicationTaskEvents = Effect.fn(
  "StandardApplicationTaskReadQuery.listEvents",
)(function* (
  runId: TaskEventHistory["runId"],
): Effect.fn.Return<
  StandardApplicationTaskEventHistory,
  StandardApplicationTaskEventHistoryQueryError,
  StandardApplicationTaskEventHistoryQuery
> {
  const query = yield* StandardApplicationTaskEventHistoryQuery;
  return yield* query.list(runId);
});

/** Builds list, point, attempt, and event reads from one authentic store. */
export function makeStandardApplicationTaskReadQueryLayer(
  store: ApplicationTaskReadStore,
): Layer.Layer<
  | StandardApplicationTaskAttemptHistoryQuery
  | StandardApplicationTaskEventHistoryQuery
  | StandardApplicationTaskRunListQuery
  | StandardApplicationTaskRunQuery
> {
  if (!isApplicationTaskReadStore(store)) {
    throw new TypeError("Application Task read store is unavailable.");
  }
  const live = Layer.effectContext(
    Effect.gen(function* () {
      const runQuery = yield* TaskRunQuery;
      const runListQuery = yield* TaskRunListQuery;
      const attemptQuery = yield* TaskAttemptHistoryQuery;
      const eventQuery = yield* TaskEventHistoryQuery;
      const inspect: StandardApplicationTaskRunQueryApi["inspect"] = Effect.fn(
        "StandardApplicationTaskRunQuery.inspectReadScope",
      )(runId => runQuery.inspect(runId));
      const scope = StandardApplicationTaskRunQuery.of({ inspect });
      const runList = StandardApplicationTaskRunListQuery.of({
        scope,
        list: Effect.fn("StandardApplicationTaskReadQuery.listRunsLive")(
          options => runListQuery.list(options),
        ),
      });
      const attempts = StandardApplicationTaskAttemptHistoryQuery.of({
        scope,
        list: Effect.fn("StandardApplicationTaskReadQuery.listAttemptsLive")(
          runId => attemptQuery.list(runId),
        ),
      });
      const events = StandardApplicationTaskEventHistoryQuery.of({
        scope,
        list: Effect.fn("StandardApplicationTaskReadQuery.listEventsLive")(
          runId => eventQuery.list(runId),
        ),
      });
      return Context.make(StandardApplicationTaskRunQuery, scope).pipe(
        Context.add(StandardApplicationTaskRunListQuery, runList),
        Context.add(StandardApplicationTaskAttemptHistoryQuery, attempts),
        Context.add(StandardApplicationTaskEventHistoryQuery, events),
      );
    }),
  );
  return live.pipe(Layer.provide(Layer.mergeAll(
    makeTaskRunQueryLayer(store),
    makeTaskRunListQueryLayer(store),
    makeTaskAttemptHistoryQueryLayer(store),
    makeTaskEventHistoryQueryLayer(store),
  )));
}
