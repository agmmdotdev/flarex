import {
  makeTaskRunListQueryLayer,
  TaskRunListQuery,
  type ApplicationTaskRunListStoreShape,
  type TaskRunListPage,
  type TaskRunListQueryApi,
  type TaskRunListQueryError,
  type TaskRunListQueryOptions,
} from "@flarex/durable-task/internal/run-projection";
import { Context, Effect, Layer } from "effect";

export type StandardApplicationTaskRunListPage = TaskRunListPage;
export type StandardApplicationTaskRunListOptions = TaskRunListQueryOptions;
export type StandardApplicationTaskRunListQueryError = TaskRunListQueryError;

export interface StandardApplicationTaskRunListQueryApi {
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

export function makeStandardApplicationTaskRunListQueryLayer(
  store: ApplicationTaskRunListStoreShape,
): Layer.Layer<StandardApplicationTaskRunListQuery> {
  const live = Layer.effect(
    StandardApplicationTaskRunListQuery,
    Effect.gen(function* () {
      const query = yield* TaskRunListQuery;
      const list: StandardApplicationTaskRunListQueryApi["list"] = Effect.fn(
        "StandardApplicationTaskRunListQuery.listLive",
      )(options => query.list(options));
      return StandardApplicationTaskRunListQuery.of({ list });
    }),
  );
  return live.pipe(Layer.provide(makeTaskRunListQueryLayer(store)));
}
