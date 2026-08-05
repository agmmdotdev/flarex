import { Data } from "effect";
import type { TaskRunIdV1 } from "../runAttempt/Model.js";
import type { TaskRunAttemptDueKindV1 } from "../runAttempt/PersistenceProjection.js";

export class InvalidTaskWakeSchedulerConfigurationError extends Data.TaggedError(
  "InvalidTaskWakeSchedulerConfigurationError",
)<{
  readonly reason:
    | "invalid_page_size"
    | "invalid_page_budget"
    | "invalid_candidate_budget";
}> {}

export class InvalidTaskWakeSchedulerRunRequestError extends Data.TaggedError(
  "InvalidTaskWakeSchedulerRunRequestError",
)<{
  readonly dueKind: TaskRunAttemptDueKindV1;
  readonly reason: "cursor_kind_mismatch" | "cursor_version_mismatch";
}> {}

export class TaskWakeSchedulerSourceContractError extends Data.TaggedError(
  "TaskWakeSchedulerSourceContractError",
)<{
  readonly dueKind: TaskRunAttemptDueKindV1;
  readonly runId: TaskRunIdV1 | null;
  readonly reason:
    | "page_version_mismatch"
    | "page_kind_mismatch"
    | "page_size_exceeded"
    | "snapshot_mismatch"
    | "candidate_kind_mismatch"
    | "candidate_after_snapshot"
    | "candidate_order_invalid"
    | "empty_page_has_continuation"
    | "continuation_invalid";
}> {}

export class TaskWakeSchedulerHandlerContractError extends Data.TaggedError(
  "TaskWakeSchedulerHandlerContractError",
)<{
  readonly dueKind: TaskRunAttemptDueKindV1;
  readonly runId: TaskRunIdV1;
  readonly reason: "receipt_candidate_mismatch";
}> {}

export class TaskDueCandidateLifecycleContractError extends Data.TaggedError(
  "TaskDueCandidateLifecycleContractError",
)<{
  readonly dueKind: TaskRunAttemptDueKindV1;
  readonly runId: TaskRunIdV1;
  readonly reason: "disposition_outcome_mismatch";
}> {}
