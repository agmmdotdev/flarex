import { Data, type Effect } from "effect";

import type {
  TaskDatabaseTimeMsV1,
  TaskLifecycleEventProjectionV1,
  TaskRequestedEffectSequenceV1,
  TaskRunIdV1,
  TaskRunVersionV1,
} from "../runAttempt/Model.js";
import type { TaskEventHistoryStoreItem } from "./EventHistorySchema.js";

export type { TaskEventHistoryStoreItem } from "./EventHistorySchema.js";

/**
 * At most 250 grants, 250 first-heartbeat observations, 249 retries, one
 * cancellation request, and one terminal event can be accepted for one run.
 */
export const MAX_TASK_EVENT_HISTORY_ENTRIES = 751;

export interface TaskEventHistoryStoreSnapshot {
  readonly observedAtMs: TaskDatabaseTimeMsV1;
  readonly runVersion: TaskRunVersionV1;
  readonly events: readonly TaskEventHistoryStoreItem[];
}

export class TaskEventHistoryStoreFailure extends Data.TaggedError(
  "TaskEventHistoryStoreError",
)<{
  readonly operation: "list_task_events";
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

export type TaskEventHistoryStoreError = TaskEventHistoryStoreFailure;

export interface ApplicationTaskEventHistoryStoreShape {
  readonly listEvents: (
    runId: TaskRunIdV1,
  ) => Effect.Effect<TaskEventHistoryStoreSnapshot, TaskEventHistoryStoreError>;
}

export interface TaskEventHistoryEntry {
  /** Immutable order in the run's durable requested-effect ledger. */
  readonly sequence: TaskRequestedEffectSequenceV1;
  /** Run version whose commit recorded this event. */
  readonly recordedRunVersion: TaskRunVersionV1;
  readonly observedAtMs: TaskDatabaseTimeMsV1;
  readonly event: TaskLifecycleEventProjectionV1;
}

export interface TaskEventHistory {
  readonly runId: TaskRunIdV1;
  readonly observedAtMs: TaskDatabaseTimeMsV1;
  readonly runVersion: TaskRunVersionV1;
  readonly events: readonly TaskEventHistoryEntry[];
}
