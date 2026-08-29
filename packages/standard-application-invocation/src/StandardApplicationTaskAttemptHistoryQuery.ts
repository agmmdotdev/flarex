import {
  makeTaskAttemptHistoryQueryLayer,
  makeTaskRunQueryLayer,
  TaskAttemptHistoryQuery,
  TaskRunQuery,
  type TaskAttemptHistory,
  type TaskAttemptHistoryQueryApi,
  type TaskAttemptHistoryQueryError,
} from "@flarex/durable-task/internal/run-projection";
import {
  isApplicationTaskReadStore,
  type ApplicationTaskReadStore,
} from
  "@flarex/persistence-postgres/internal/application-task-attempt-history-store";
import { Context, Effect, Layer } from "effect";

import {
  StandardApplicationTaskRunQuery,
  type StandardApplicationTaskRunQueryApi,
} from "./StandardApplicationTaskRunQuery.js";

export type StandardApplicationTaskAttemptHistory = TaskAttemptHistory;
export type StandardApplicationTaskAttemptHistoryQueryError =
  TaskAttemptHistoryQueryError;

export interface StandardApplicationTaskAttemptHistoryQueryApi {
  /** Exact point-query capability that owns this history scope. */
  readonly scope: StandardApplicationTaskRunQueryApi;
  readonly list: TaskAttemptHistoryQueryApi["list"];
}

export class StandardApplicationTaskAttemptHistoryQuery extends Context.Service<
  StandardApplicationTaskAttemptHistoryQuery,
  StandardApplicationTaskAttemptHistoryQueryApi
>()(
  "flarex/standard-application-invocation/StandardApplicationTaskAttemptHistoryQuery",
) {}

export const listStandardApplicationTaskAttempts = Effect.fn(
  "StandardApplicationTaskAttemptHistoryQuery.list",
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

export function makeStandardApplicationTaskAttemptHistoryQueryLayer(
  store: ApplicationTaskReadStore,
): Layer.Layer<
  StandardApplicationTaskAttemptHistoryQuery
  | StandardApplicationTaskRunQuery
> {
  if (!isApplicationTaskReadStore(store)) {
    throw new TypeError("Application Task read store is unavailable.");
  }
  const live = Layer.effectContext(
    Effect.gen(function* () {
      const runQuery = yield* TaskRunQuery;
      const historyQuery = yield* TaskAttemptHistoryQuery;
      const inspect: StandardApplicationTaskRunQueryApi["inspect"] = Effect.fn(
        "StandardApplicationTaskRunQuery.inspectHistoryScope",
      )(runId => runQuery.inspect(runId));
      const scope = StandardApplicationTaskRunQuery.of({ inspect });
      const list: StandardApplicationTaskAttemptHistoryQueryApi["list"] =
        Effect.fn("StandardApplicationTaskAttemptHistoryQuery.listLive")(
          runId => historyQuery.list(runId),
        );
      const history = StandardApplicationTaskAttemptHistoryQuery.of({
        scope,
        list,
      });
      return Context.make(StandardApplicationTaskRunQuery, scope).pipe(
        Context.add(StandardApplicationTaskAttemptHistoryQuery, history),
      );
    }),
  );
  return live.pipe(Layer.provide(Layer.merge(
    makeTaskRunQueryLayer(store),
    makeTaskAttemptHistoryQueryLayer(store),
  )));
}
