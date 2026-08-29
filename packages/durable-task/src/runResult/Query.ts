import { copyBytes } from "@flarex/utils/bytes";
import { Context, Effect, Layer } from "effect";

import type { TaskSystemRunAttemptStoreErrorV1 } from
  "../runAttempt/Errors.js";
import type {
  TaskResultCommitmentV1,
  TaskRunIdV1,
} from "../runAttempt/Model.js";
import type { ApplicationTaskSystemRunAttemptStoreShape } from
  "../runAttempt/Services/TaskSystemRunAttemptStore.js";
import { TaskRunResultUnavailableError } from "./Errors.js";

export type TaskRunResultQueryError =
  | TaskSystemRunAttemptStoreErrorV1
  | TaskRunResultUnavailableError;

export interface TaskRunResultQueryApi {
  readonly authorizeRead: (
    runId: TaskRunIdV1,
  ) => Effect.Effect<TaskResultCommitmentV1, TaskRunResultQueryError>;
}

/** Authorizes one result commitment through one captured Application scope. */
export class TaskRunResultQuery extends Context.Service<
  TaskRunResultQuery,
  TaskRunResultQueryApi
>()("flarex/durable-task/TaskRunResultQuery") {}

export function makeTaskRunResultQueryLayer(
  store: Pick<ApplicationTaskSystemRunAttemptStoreShape, "inspectRunAttempt">,
): Layer.Layer<TaskRunResultQuery> {
  const inspectRunAttempt = store.inspectRunAttempt;
  const authorizeRead: TaskRunResultQueryApi["authorizeRead"] = Effect.fn(
    "TaskRunResultQuery.authorizeRead",
  )(function* (runId) {
    const snapshot = yield* inspectRunAttempt({
      operation: "inspect_current_attempt",
      runId,
    });
    if (snapshot.current.phase !== "terminal") {
      return yield* new TaskRunResultUnavailableError({
        runId,
        reason: "run_incomplete",
      });
    }
    if (snapshot.current.terminal.kind !== "succeeded") {
      return yield* new TaskRunResultUnavailableError({
        runId,
        reason: "run_not_succeeded",
      });
    }
    if (snapshot.current.terminal.result === null) {
      return yield* new TaskRunResultUnavailableError({
        runId,
        reason: "result_absent",
      });
    }
    const commitment = snapshot.current.terminal.result;
    return Object.freeze({
      codec: commitment.codec,
      byteLength: commitment.byteLength,
      sha256: copyBytes(commitment.sha256),
    });
  });
  return Layer.succeed(
    TaskRunResultQuery,
    TaskRunResultQuery.of({ authorizeRead }),
  );
}
