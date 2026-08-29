import { makeTaskRunResultQueryLayer } from
  "@flarex/durable-task/internal/run-result-query";
import {
  makeTaskResultBodyQueryLayer,
  TaskResultBodyQuery,
  type TaskResultBodyQueryApi,
  type TaskResultBodyQueryError,
} from "flarex-backend/internal/task-result-body-query";
import { Context, Effect, Layer } from "effect";

export type StandardApplicationTaskResultQueryError =
  TaskResultBodyQueryError;

export interface StandardApplicationTaskResultQueryApi {
  readonly read: TaskResultBodyQueryApi["read"];
}

export interface StandardApplicationTaskResultQueryLive {
  readonly runAttemptStore: Parameters<typeof makeTaskRunResultQueryLayer>[0];
  readonly resultStore: Parameters<typeof makeTaskResultBodyQueryLayer>[0];
}

export class StandardApplicationTaskResultQuery extends Context.Service<
  StandardApplicationTaskResultQuery,
  StandardApplicationTaskResultQueryApi
>()(
  "flarex/standard-application-invocation/StandardApplicationTaskResultQuery",
) {}

export const readStandardApplicationTaskResult = Effect.fn(
  "StandardApplicationTaskResultQuery.read",
)(function* (
  runId: Parameters<StandardApplicationTaskResultQueryApi["read"]>[0],
): Effect.fn.Return<
  Effect.Success<ReturnType<StandardApplicationTaskResultQueryApi["read"]>>,
  StandardApplicationTaskResultQueryError,
  StandardApplicationTaskResultQuery
> {
  const query = yield* StandardApplicationTaskResultQuery;
  return yield* query.read(runId);
});

export function makeStandardApplicationTaskResultQueryLayer(
  live: StandardApplicationTaskResultQueryLive,
): Layer.Layer<StandardApplicationTaskResultQuery> {
  const resultBodyLayer = makeTaskResultBodyQueryLayer(live.resultStore).pipe(
    Layer.provide(makeTaskRunResultQueryLayer(live.runAttemptStore)),
  );
  const standardLayer = Layer.effect(
    StandardApplicationTaskResultQuery,
    Effect.gen(function* () {
      const body = yield* TaskResultBodyQuery;
      const read: StandardApplicationTaskResultQueryApi["read"] = Effect.fn(
        "StandardApplicationTaskResultQuery.readLive",
      )(runId => body.read(runId));
      return StandardApplicationTaskResultQuery.of({ read });
    }),
  );
  return standardLayer.pipe(Layer.provide(resultBodyLayer));
}
