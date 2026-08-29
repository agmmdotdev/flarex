import { Context, Effect, Layer } from "effect";

import type { TaskSystemRunAttemptStoreErrorV1 } from
  "../runAttempt/Errors.js";
import type {
  TaskRunIdV1,
} from "../runAttempt/Model.js";
import type {
  ApplicationTaskSystemRunAttemptStoreShape,
} from "../runAttempt/Services/TaskSystemRunAttemptStore.js";
import type { TaskRunProjection } from "./Model.js";
import { projectTaskRun } from "./Projection.js";

export type TaskRunQueryError = TaskSystemRunAttemptStoreErrorV1;

export interface TaskRunQueryApi {
  readonly inspect: (
    runId: TaskRunIdV1,
  ) => Effect.Effect<TaskRunProjection, TaskRunQueryError>;
}

/**
 * One current Application scope's authoritative Task point-read capability.
 * Hosts must construct and provide a distinct Layer for each trusted scope.
 */
export class TaskRunQuery extends Context.Service<
  TaskRunQuery,
  TaskRunQueryApi
>()("flarex/durable-task/TaskRunQuery") {}

export function makeTaskRunQueryLayer(
  store: Pick<ApplicationTaskSystemRunAttemptStoreShape, "inspectRunAttempt">,
): Layer.Layer<TaskRunQuery> {
  const inspectRunAttempt = store.inspectRunAttempt;
  const inspect: TaskRunQueryApi["inspect"] = Effect.fn(
    "TaskRunQuery.inspect",
  )((runId) =>
    inspectRunAttempt({
      operation: "inspect_current_attempt",
      runId,
    }).pipe(Effect.map(projectTaskRun))
  );
  return Layer.succeed(TaskRunQuery, TaskRunQuery.of({ inspect }));
}
