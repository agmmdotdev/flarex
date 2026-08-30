import type { StandardApplicationTaskCancellationError } from
  "@flarex/standard-application-invocation/internal/standard-application-task-cancellation";
import { Data } from "effect";

import type { TaskRunId } from "./TaskStatus.js";

export type TaskCancellationErrorReason =
  | "invalidCommand"
  | "invalidState"
  | "unavailable"
  | "corruptData"
  | "staleScopeAuthority"
  | "transient"
  | "terminal";

class TaskCancellationFailure extends Data.TaggedError(
  "TaskCancellationError",
)<{
  readonly operation: "cancelTask";
  readonly runId: TaskRunId;
  readonly reason: TaskCancellationErrorReason;
  /** Opaque owner failure retained for diagnostics and Cause inspection. */
  readonly cause: unknown;
}> {}

/** Stable clean failure contract for the authoritative cancellation command. */
export type TaskCancellationError = TaskCancellationFailure;

export function projectTaskCancellationError(
  runId: TaskRunId,
  error: StandardApplicationTaskCancellationError,
): TaskCancellationError {
  switch (error._tag) {
    case "InvalidRunAttemptCommandError":
      return taskCancellationError(runId, "invalidCommand", error);
    case "InvalidRunAttemptTransitionError":
    case "ConflictingTaskAttemptCompletionError":
    case "InvalidTaskCancellationAcknowledgementError":
    case "TaskRunAttemptPolicyError":
      return taskCancellationError(runId, "invalidState", error);
    case "StaleTaskRunVersionError":
    case "StaleTaskExecutionFenceError":
      return taskCancellationError(runId, "transient", error);
    case "TaskRunAttemptCounterExhaustedError":
      return taskCancellationError(runId, "terminal", error);
    case "TaskSystemRunAttemptUnavailableError":
      return taskCancellationError(runId, "unavailable", error);
    case "TaskSystemRunAttemptCorruptionError":
      return taskCancellationError(runId, "corruptData", error);
    case "TaskSystemRunAttemptStaleScopeAuthorityError":
      return taskCancellationError(runId, "staleScopeAuthority", error);
    case "TaskSystemRunAttemptTransientStoreError":
      return taskCancellationError(runId, "transient", error);
    case "TaskSystemRunAttemptTerminalStoreError":
      return taskCancellationError(runId, "terminal", error);
    default: {
      const unhandledError: never = error;
      throw new TypeError(
        `Unhandled Task cancellation error: ${String(unhandledError)}`,
      );
    }
  }
}

function taskCancellationError(
  runId: TaskRunId,
  reason: TaskCancellationErrorReason,
  cause: unknown,
): TaskCancellationError {
  return new TaskCancellationFailure({
    operation: "cancelTask",
    runId,
    reason,
    cause,
  });
}
