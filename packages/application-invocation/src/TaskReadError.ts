import type {
  StandardApplicationTaskAttemptHistoryQueryError,
  StandardApplicationTaskEventHistoryQueryError,
  StandardApplicationTaskRunListQueryError,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-read-query";
import type { StandardApplicationTaskRunQueryError } from
  "@flarex/standard-application-invocation/internal/standard-application-task-run-query";
import { Data } from "effect";

import {
  projectTaskRunId,
  type TaskRunId,
} from "./TaskStatus.js";

export type TaskReadOperation =
  | "inspectTask"
  | "listTaskRuns"
  | "listTaskAttempts"
  | "listTaskEvents";

export type TaskReadErrorReason =
  | "runNotFound"
  | "unavailable"
  | "corruptData"
  | "staleScopeAuthority"
  | "transient"
  | "terminal"
  | "unsupported";

class TaskReadFailure<Operation extends TaskReadOperation> extends
  Data.TaggedError("TaskReadError")<{
    readonly operation: Operation;
    readonly runId: TaskRunId | null;
    readonly reason: TaskReadErrorReason;
    /** Opaque owner failure retained for diagnostics and Cause inspection. */
    readonly cause: unknown;
  }> {}

/** Stable clean failure contract shared by authoritative Task read primitives. */
export type TaskReadError<
  Operation extends TaskReadOperation = TaskReadOperation,
> = TaskReadFailure<Operation>;

type StandardTaskRunListReadError = Exclude<
  StandardApplicationTaskRunListQueryError,
  { readonly _tag: "TaskRunListOptionsError" }
>;

export function projectInspectTaskError(
  error: StandardApplicationTaskRunQueryError,
): TaskReadError<"inspectTask"> {
  const runId = projectTaskRunId(error.runId);
  switch (error._tag) {
    case "TaskSystemRunAttemptUnavailableError":
      return taskReadError("inspectTask", runId, "unavailable", error);
    case "TaskSystemRunAttemptCorruptionError":
      return taskReadError("inspectTask", runId, "corruptData", error);
    case "TaskSystemRunAttemptStaleScopeAuthorityError":
      return taskReadError(
        "inspectTask",
        runId,
        "staleScopeAuthority",
        error,
      );
    case "TaskSystemRunAttemptTransientStoreError":
      return taskReadError("inspectTask", runId, "transient", error);
    case "TaskSystemRunAttemptTerminalStoreError":
      return taskReadError("inspectTask", runId, "terminal", error);
    default: {
      const unhandledError: never = error;
      throw new TypeError(
        `Unhandled Task inspection error: ${String(unhandledError)}`,
      );
    }
  }
}

export function projectListTaskRunsError(
  error: StandardTaskRunListReadError,
): TaskReadError<"listTaskRuns"> {
  switch (error._tag) {
    case "TaskRunListStoreContractError":
      return taskReadError("listTaskRuns", null, "corruptData", error);
    case "TaskRunListStoreError":
      return taskReadError(
        "listTaskRuns",
        null,
        projectStoreReason(error.reason),
        error,
      );
    default: {
      const unhandledError: never = error;
      throw new TypeError(
        `Unhandled Task-run list error: ${String(unhandledError)}`,
      );
    }
  }
}

export function projectListTaskAttemptsError(
  runId: Parameters<typeof projectTaskRunId>[0],
  error: StandardApplicationTaskAttemptHistoryQueryError,
): TaskReadError<"listTaskAttempts"> {
  const cleanRunId = projectTaskRunId(runId);
  switch (error._tag) {
    case "TaskAttemptHistoryStoreContractError":
      return taskReadError(
        "listTaskAttempts",
        cleanRunId,
        "corruptData",
        error,
      );
    case "TaskAttemptHistoryStoreError":
      return taskReadError(
        "listTaskAttempts",
        cleanRunId,
        projectHistoryStoreReason(error.reason),
        error,
      );
    default: {
      const unhandledError: never = error;
      throw new TypeError(
        `Unhandled Task attempt-history error: ${String(unhandledError)}`,
      );
    }
  }
}

export function projectListTaskEventsError(
  runId: Parameters<typeof projectTaskRunId>[0],
  error: StandardApplicationTaskEventHistoryQueryError,
): TaskReadError<"listTaskEvents"> {
  const cleanRunId = projectTaskRunId(runId);
  switch (error._tag) {
    case "TaskEventHistoryStoreContractError":
      return taskReadError(
        "listTaskEvents",
        cleanRunId,
        "corruptData",
        error,
      );
    case "TaskEventHistoryStoreError":
      return taskReadError(
        "listTaskEvents",
        cleanRunId,
        projectHistoryStoreReason(error.reason),
        error,
      );
    default: {
      const unhandledError: never = error;
      throw new TypeError(
        `Unhandled Task event-history error: ${String(unhandledError)}`,
      );
    }
  }
}

function taskReadError<Operation extends TaskReadOperation>(
  operation: Operation,
  runId: TaskRunId | null,
  reason: TaskReadErrorReason,
  cause: unknown,
): TaskReadError<Operation> {
  return new TaskReadFailure({ operation, runId, reason, cause });
}

function projectStoreReason(
  reason: Extract<
    StandardTaskRunListReadError,
    { readonly _tag: "TaskRunListStoreError" }
  >["reason"],
): TaskReadErrorReason {
  switch (reason) {
    case "unavailable":
      return "unavailable";
    case "corrupt_data":
      return "corruptData";
    case "stale_scope_authority":
      return "staleScopeAuthority";
    case "transient":
      return "transient";
    case "unsupported":
      return "unsupported";
  }
}

function projectHistoryStoreReason(
  reason:
    | Extract<
      StandardApplicationTaskAttemptHistoryQueryError,
      { readonly _tag: "TaskAttemptHistoryStoreError" }
    >["reason"]
    | Extract<
      StandardApplicationTaskEventHistoryQueryError,
      { readonly _tag: "TaskEventHistoryStoreError" }
    >["reason"],
): TaskReadErrorReason {
  switch (reason) {
    case "run_not_found":
      return "runNotFound";
    case "unavailable":
      return "unavailable";
    case "corrupt_data":
      return "corruptData";
    case "stale_scope_authority":
      return "staleScopeAuthority";
    case "transient":
      return "transient";
    case "unsupported":
      return "unsupported";
  }
}
