import type {
  HandleLeaseExpiryOutcomeV1,
  StartAttemptOutcomeV1,
  TaskDatabaseTimeMsV1,
  TaskRunIdV1,
  TaskRunVersionV1,
} from "../runAttempt/Model.js";
import type { TaskRunAttemptDueKindV1 } from "../runAttempt/PersistenceProjection.js";
import type { TaskDueDiscoveryCursorV1 } from "../runRead/Model.js";

export const MAX_TASK_WAKE_SCHEDULER_PAGES_V1 = 100;
export const MAX_TASK_WAKE_SCHEDULER_CANDIDATES_V1 = 10_000;

export interface TaskWakeSchedulerOptionsV1 {
  readonly pageSize: number;
  readonly maximumPages: number;
  readonly maximumCandidates: number;
}

export interface TaskWakeSchedulerRunRequestV1 {
  readonly dueKind: TaskRunAttemptDueKindV1;
  readonly cursor: TaskDueDiscoveryCursorV1 | null;
}

interface TaskDueCandidateHandlingReceiptBaseV1 {
  readonly version: "flarex.task-due-candidate-handling-receipt.v1";
  readonly dueAtMs: TaskDatabaseTimeMsV1;
  readonly runId: TaskRunIdV1;
  readonly observedAtMs: TaskDatabaseTimeMsV1;
  readonly runVersion: TaskRunVersionV1;
}

type AcceptedTaskDueCandidateDispositionV1 = "accepted" | "idempotent";

export type TaskDueCandidateHandlingReceiptV1 =
  | (TaskDueCandidateHandlingReceiptBaseV1 & {
      readonly kind: "start_attempt";
      readonly disposition: AcceptedTaskDueCandidateDispositionV1;
      readonly outcomeKind: Exclude<StartAttemptOutcomeV1["kind"], "current">;
    })
  | (TaskDueCandidateHandlingReceiptBaseV1 & {
      readonly kind: "start_attempt";
      readonly disposition: "current";
      readonly outcomeKind: "current";
    })
  | (TaskDueCandidateHandlingReceiptBaseV1 & {
      readonly kind: "handle_lease_expiry";
      readonly disposition: AcceptedTaskDueCandidateDispositionV1;
      readonly outcomeKind: Exclude<HandleLeaseExpiryOutcomeV1["kind"], "current">;
    })
  | (TaskDueCandidateHandlingReceiptBaseV1 & {
      readonly kind: "handle_lease_expiry";
      readonly disposition: "current";
      readonly outcomeKind: "current";
    });

export type TaskWakeSchedulerStopReasonV1 =
  | "source_exhausted"
  | "page_budget"
  | "candidate_budget";

export interface TaskWakeSchedulerRunReceiptV1 {
  readonly version: "flarex.task-wake-scheduler-run-receipt.v1";
  readonly dueKind: TaskRunAttemptDueKindV1;
  readonly throughMs: TaskDatabaseTimeMsV1;
  readonly stopReason: TaskWakeSchedulerStopReasonV1;
  readonly pagesRead: number;
  readonly candidatesHandled: number;
  readonly handled: ReadonlyArray<TaskDueCandidateHandlingReceiptV1>;
  readonly continuation: TaskDueDiscoveryCursorV1 | null;
}
