import {
  TaskRunResultQuery,
  type TaskRunResultQueryApi,
  type TaskRunResultQueryError,
} from "@flarex/durable-task/internal/run-result-query";
import type { CanonicalFlarexRuntimeValueV1 } from "flarex-protocol/value";
import { Context, Effect, Layer } from "effect";

import type {
  TaskResultStore,
  TaskResultStoreError,
} from "./TaskResultStore.js";

export type TaskResultBodyQueryError =
  | TaskRunResultQueryError
  | TaskResultStoreError;

export interface TaskResultBodyQueryApi {
  readonly read: (
    runId: Parameters<TaskRunResultQueryApi["authorizeRead"]>[0],
  ) => Effect.Effect<CanonicalFlarexRuntimeValueV1, TaskResultBodyQueryError>;
}

export class TaskResultBodyQuery extends Context.Service<
  TaskResultBodyQuery,
  TaskResultBodyQueryApi
>()("flarex/backend/taskResult/TaskResultBodyQuery") {}

export const readTaskResultBody = Effect.fn("TaskResultBodyQuery.read")(
  function* (
    runId: Parameters<TaskResultBodyQueryApi["read"]>[0],
  ): Effect.fn.Return<
    CanonicalFlarexRuntimeValueV1,
    TaskResultBodyQueryError,
    TaskResultBodyQuery
  > {
    const query = yield* TaskResultBodyQuery;
    return yield* query.read(runId);
  },
);

export function makeTaskResultBodyQueryLayer(
  resultStore: Pick<TaskResultStore, "read">,
): Layer.Layer<TaskResultBodyQuery, never, TaskRunResultQuery> {
  const readStoredResult = resultStore.read;
  return Layer.effect(
    TaskResultBodyQuery,
    Effect.gen(function* () {
      const resultQuery = yield* TaskRunResultQuery;
      const read: TaskResultBodyQueryApi["read"] = Effect.fn(
        "TaskResultBodyQuery.readLive",
      )(function* (runId) {
        const commitment = yield* resultQuery.authorizeRead(runId);
        const stored = yield* readStoredResult(commitment);
        return stored.value;
      });
      return TaskResultBodyQuery.of({ read });
    }),
  );
}
