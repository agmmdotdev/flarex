import {
  makeTaskRunQueryLayer,
  TaskRunQuery,
  type TaskRunProjection,
  type TaskRunQueryApi,
  type TaskRunQueryError,
} from "@flarex/durable-task/internal/run-projection";
import { Context, Effect, Layer } from "effect";

export type StandardApplicationTaskRunStatus = TaskRunProjection;
export type StandardApplicationTaskRunQueryError = TaskRunQueryError;

export interface StandardApplicationTaskRunQueryApi {
  readonly inspect: TaskRunQueryApi["inspect"];
}

export class StandardApplicationTaskRunQuery extends Context.Service<
  StandardApplicationTaskRunQuery,
  StandardApplicationTaskRunQueryApi
>()(
  "flarex/standard-application-invocation/StandardApplicationTaskRunQuery",
) {}

export const inspectStandardApplicationTaskRun = Effect.fn(
  "StandardApplicationTaskRunQuery.inspect",
)(function* (
  runId: Parameters<StandardApplicationTaskRunQueryApi["inspect"]>[0],
): Effect.fn.Return<
  StandardApplicationTaskRunStatus,
  StandardApplicationTaskRunQueryError,
  StandardApplicationTaskRunQuery
> {
  const query = yield* StandardApplicationTaskRunQuery;
  return yield* query.inspect(runId);
});

export function makeStandardApplicationTaskRunQueryLayer(
  store: Parameters<typeof makeTaskRunQueryLayer>[0],
): Layer.Layer<StandardApplicationTaskRunQuery> {
  const live = Layer.effect(
    StandardApplicationTaskRunQuery,
    Effect.gen(function* () {
      const query = yield* TaskRunQuery;
      const inspect: StandardApplicationTaskRunQueryApi["inspect"] = Effect.fn(
        "StandardApplicationTaskRunQuery.inspectLive",
      )(runId => query.inspect(runId));
      return StandardApplicationTaskRunQuery.of({ inspect });
    }),
  );
  return live.pipe(Layer.provide(makeTaskRunQueryLayer(store)));
}
