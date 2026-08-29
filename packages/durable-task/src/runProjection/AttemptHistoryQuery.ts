import { Context, Data, Effect, Layer, Result } from "effect";

import {
  decodeTaskDatabaseTimeMsV1,
} from "../runAttempt/Schema.js";
import {
  MAX_TASK_ATTEMPT_HISTORY_ENTRIES,
  type ApplicationTaskAttemptHistoryStoreShape,
  type TaskAttemptHistory,
  type TaskAttemptHistoryEntry,
  type TaskAttemptHistoryStoreError,
  type TaskAttemptHistoryStoreItem,
  type TaskAttemptHistoryStoreSnapshot,
} from "./AttemptHistoryModel.js";
import {
  decodeTaskAttemptHistoryRunVersion,
  decodeTaskAttemptHistoryStoreItem,
} from "./AttemptHistorySchema.js";

class TaskAttemptHistoryStoreContractFailure extends Data.TaggedError(
  "TaskAttemptHistoryStoreContractError",
)<{
  readonly reason:
    | "snapshot_invalid"
    | "observation_invalid"
    | "run_version_invalid"
    | "too_many_attempts"
    | "attempt_invalid"
    | "attempt_order_invalid"
    | "accepted_version_not_advanced"
    | "accepted_version_exceeds_run";
}> {}

export type TaskAttemptHistoryStoreContractError =
  TaskAttemptHistoryStoreContractFailure;
export type TaskAttemptHistoryQueryError =
  | TaskAttemptHistoryStoreContractError
  | TaskAttemptHistoryStoreError;

export interface TaskAttemptHistoryQueryApi {
  readonly list: (
    runId: TaskAttemptHistory["runId"],
  ) => Effect.Effect<TaskAttemptHistory, TaskAttemptHistoryQueryError>;
}

/** One current Application scope's bounded attempt-admission history. */
export class TaskAttemptHistoryQuery extends Context.Service<
  TaskAttemptHistoryQuery,
  TaskAttemptHistoryQueryApi
>()("flarex/durable-task/TaskAttemptHistoryQuery") {}

export function makeTaskAttemptHistoryQueryLayer(
  store: ApplicationTaskAttemptHistoryStoreShape,
): Layer.Layer<TaskAttemptHistoryQuery> {
  const listAttempts = store.listAttempts;
  const list: TaskAttemptHistoryQueryApi["list"] = Effect.fn(
    "TaskAttemptHistoryQuery.list",
  )(function* (runId) {
    const snapshot = yield* listAttempts(runId);
    return yield* Effect.fromResult(projectAttemptHistory(runId, snapshot));
  });
  return Layer.succeed(TaskAttemptHistoryQuery, TaskAttemptHistoryQuery.of({
    list,
  }));
}

function projectAttemptHistory(
  runId: TaskAttemptHistory["runId"],
  snapshot: TaskAttemptHistoryStoreSnapshot,
): Result.Result<
  TaskAttemptHistory,
  TaskAttemptHistoryStoreContractError
> {
  const observedAtInput = snapshot.observedAtMs;
  const runVersionInput = snapshot.runVersion;
  const attemptsInput = snapshot.attempts;
  return Result.gen(function* () {
    if (!Array.isArray(attemptsInput)) {
      return yield* contractFailure("snapshot_invalid");
    }
    const observedAtMs = yield* decodeTaskDatabaseTimeMsV1(
      observedAtInput,
    ).pipe(Result.mapError(() => contractError("observation_invalid")));
    const runVersion = yield* decodeTaskAttemptHistoryRunVersion(
      runVersionInput,
    ).pipe(
      Result.mapError(() => contractError("run_version_invalid")),
    );
    if (attemptsInput.length > MAX_TASK_ATTEMPT_HISTORY_ENTRIES) {
      return yield* contractFailure("too_many_attempts");
    }

    const attempts: TaskAttemptHistoryEntry[] = [];
    let previousAcceptedRunVersion = 0n;
    for (let index = 0; index < attemptsInput.length; index += 1) {
      const decoded = yield* decodeStoreItem(attemptsInput[index]);
      if (decoded.attemptNumber !== index + 1) {
        return yield* contractFailure("attempt_order_invalid");
      }
      if (decoded.acceptedRunVersion <= previousAcceptedRunVersion) {
        return yield* contractFailure("accepted_version_not_advanced");
      }
      if (decoded.acceptedRunVersion > runVersion) {
        return yield* contractFailure("accepted_version_exceeds_run");
      }
      previousAcceptedRunVersion = decoded.acceptedRunVersion;
      attempts.push(Object.freeze({
        attemptId: decoded.attemptId,
        attemptNumber: decoded.attemptNumber,
        admittedRunVersion: decoded.acceptedRunVersion,
      }));
    }
    return Object.freeze({
      runId,
      observedAtMs,
      runVersion,
      attempts: Object.freeze(attempts),
    });
  });
}

function decodeStoreItem(
  input: TaskAttemptHistoryStoreItem | undefined,
): Result.Result<
  TaskAttemptHistoryStoreItem,
  TaskAttemptHistoryStoreContractError
> {
  return decodeTaskAttemptHistoryStoreItem(input).pipe(
    Result.mapError(() => contractError("attempt_invalid")),
  );
}

function contractFailure(
  reason: TaskAttemptHistoryStoreContractError["reason"],
): Result.Result<never, TaskAttemptHistoryStoreContractError> {
  return Result.fail(contractError(reason));
}

function contractError(
  reason: TaskAttemptHistoryStoreContractError["reason"],
): TaskAttemptHistoryStoreContractError {
  return new TaskAttemptHistoryStoreContractFailure({ reason });
}
