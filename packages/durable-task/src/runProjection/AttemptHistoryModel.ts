import { Data, type Effect } from "effect";

import type {
  TaskDatabaseTimeMsV1,
  TaskRunIdV1,
  TaskRunVersionV1,
} from "../runAttempt/Model.js";
import type { TaskAttemptHistoryStoreItem } from
  "./AttemptHistorySchema.js";

export type { TaskAttemptHistoryStoreItem } from
  "./AttemptHistorySchema.js";

export const MAX_TASK_ATTEMPT_HISTORY_ENTRIES = 250;

export interface TaskAttemptHistoryStoreSnapshot {
  readonly observedAtMs: TaskDatabaseTimeMsV1;
  readonly runVersion: TaskRunVersionV1;
  readonly attempts: readonly TaskAttemptHistoryStoreItem[];
}

export class TaskAttemptHistoryStoreFailure extends Data.TaggedError(
  "TaskAttemptHistoryStoreError",
)<{
  readonly operation: "list_task_attempts";
  readonly runId: TaskRunIdV1;
  readonly reason:
    | "run_not_found"
    | "unavailable"
    | "corrupt_data"
    | "stale_scope_authority"
    | "transient"
    | "unsupported";
  readonly cause: unknown;
}> {}

export type TaskAttemptHistoryStoreError = TaskAttemptHistoryStoreFailure;

export interface ApplicationTaskAttemptHistoryStoreShape {
  readonly listAttempts: (
    runId: TaskRunIdV1,
  ) => Effect.Effect<
    TaskAttemptHistoryStoreSnapshot,
    TaskAttemptHistoryStoreError
  >;
}

export interface TaskAttemptHistoryEntry {
  readonly attemptId: TaskAttemptHistoryStoreItem["attemptId"];
  readonly attemptNumber: TaskAttemptHistoryStoreItem["attemptNumber"];
  /** Run version whose commit admitted this attempt. */
  readonly admittedRunVersion: TaskRunVersionV1;
}

export interface TaskAttemptHistory {
  readonly runId: TaskRunIdV1;
  readonly observedAtMs: TaskDatabaseTimeMsV1;
  readonly runVersion: TaskRunVersionV1;
  readonly attempts: readonly TaskAttemptHistoryEntry[];
}
