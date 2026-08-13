// Adapted from Trigger.dev commit f10bc23785e569e5d917318cf2033aabdbe96a0b,
// multiple mapped upstream paths. See trigger-source-map.json and THIRD_PARTY_NOTICES.md.
import { Data } from "effect";
import type { TaskDefinitionReference } from "../runCreation/Model.js";
import type {
  RunAttemptMutationOperationV1,
  RunAttemptOperationV1,
  RunAttemptPhaseV1,
  TaskAttemptCompletionV1,
  TaskAttemptIdV1,
  TaskCancellationGenerationV1,
  TaskRunIdV1,
} from "./Model.js";

export class InvalidRunAttemptCommandError extends Data.TaggedError(
  "InvalidRunAttemptCommandError",
)<{
  readonly operation: RunAttemptOperationV1;
  readonly issue:
    | "invalid_shape"
    | "invalid_identifier"
    | "invalid_number"
    | "invalid_completion"
    | "invalid_cancellation_reason";
}> {}

export class TaskDefinitionReferenceGenerationMismatchError extends
  Data.TaggedError("TaskDefinitionReferenceGenerationMismatchError")<{
    readonly operation: "persist_requested_effect";
    readonly expectedGeneration: TaskDefinitionReference["generation"];
    readonly receivedGeneration: TaskDefinitionReference["generation"];
  }> {}

export class InvalidRunAttemptTransitionError extends Data.TaggedError(
  "InvalidRunAttemptTransitionError",
)<{
  readonly operation: RunAttemptMutationOperationV1;
  readonly runId: TaskRunIdV1;
  readonly phase: RunAttemptPhaseV1;
  readonly reason:
    | "candidate_missing"
    | "candidate_unexpected"
    | "next_state_invalid"
    | "acceptance_invalid"
    | "completion_replay_invalid"
    | "evidence_invalid"
    | "effect_order_invalid";
}> {}

export class StaleTaskRunVersionError extends Data.TaggedError(
  "StaleTaskRunVersionError",
)<{
  readonly operation: RunAttemptMutationOperationV1;
  readonly runId: TaskRunIdV1;
  readonly reason: "commit_basis_disagrees_with_decoded_state";
}> {}

export class StaleTaskExecutionFenceError extends Data.TaggedError(
  "StaleTaskExecutionFenceError",
)<{
  readonly operation:
    | "heartbeat_attempt"
    | "complete_attempt"
    | "handle_lease_expiry";
  readonly runId: TaskRunIdV1;
  readonly attemptId: TaskAttemptIdV1;
  readonly reason: "accepted_transition_uses_noncurrent_fence";
}> {}

export class ConflictingTaskAttemptCompletionError extends Data.TaggedError(
  "ConflictingTaskAttemptCompletionError",
)<{
  readonly operation: "complete_attempt";
  readonly runId: TaskRunIdV1;
  readonly attemptId: TaskAttemptIdV1;
  readonly acceptedKind: TaskAttemptCompletionV1["kind"];
  readonly receivedKind: TaskAttemptCompletionV1["kind"];
}> {}

export class InvalidTaskCancellationAcknowledgementError extends Data.TaggedError(
  "InvalidTaskCancellationAcknowledgementError",
)<{
  readonly operation: "complete_attempt";
  readonly runId: TaskRunIdV1;
  readonly attemptId: TaskAttemptIdV1;
  readonly requestedGeneration: TaskCancellationGenerationV1 | null;
  readonly receivedGeneration: TaskCancellationGenerationV1;
}> {}

export class TaskRunAttemptPolicyError extends Data.TaggedError(
  "TaskRunAttemptPolicyError",
)<{
  readonly operation:
    | "start_attempt"
    | "heartbeat_attempt"
    | "complete_attempt"
    | "handle_lease_expiry";
  readonly runId: TaskRunIdV1;
  readonly reason:
    | "invalid_bound_policy"
    | "attempt_limit_invariant"
    | "retry_delay_overflow"
    | "eligibility_time_overflow"
    | "lease_expiry_time_overflow"
    | "compute_escalation_invalid";
}> {}

export class TaskRunAttemptCounterExhaustedError extends Data.TaggedError(
  "TaskRunAttemptCounterExhaustedError",
)<{
  readonly operation: RunAttemptMutationOperationV1;
  readonly runId: TaskRunIdV1;
  readonly counter:
    | "run_version"
    | "attempt_number"
    | "lease_version"
    | "cancellation_generation"
    | "requested_effect_sequence";
}> {}

export type RunAttemptDecisionErrorV1 =
  | InvalidRunAttemptTransitionError
  | StaleTaskRunVersionError
  | StaleTaskExecutionFenceError
  | ConflictingTaskAttemptCompletionError
  | InvalidTaskCancellationAcknowledgementError
  | TaskRunAttemptPolicyError
  | TaskRunAttemptCounterExhaustedError;

export class TaskSystemRunAttemptUnavailableError extends Data.TaggedError(
  "TaskSystemRunAttemptUnavailableError",
)<{
  readonly operation: RunAttemptOperationV1;
  readonly runId: TaskRunIdV1;
  readonly reason: "unavailable";
}> {}

export class TaskSystemRunAttemptCorruptionError extends Data.TaggedError(
  "TaskSystemRunAttemptCorruptionError",
)<{
  readonly operation: RunAttemptOperationV1;
  readonly runId: TaskRunIdV1;
  readonly reason:
    | "aggregate_invalid"
    | "binding_reference_invalid"
    | "acceptance_invalid"
    | "completion_replay_invalid"
    | "evidence_invalid"
    | "effect_sequence_invalid";
}> {}

export class TaskSystemRunAttemptStaleScopeAuthorityError extends Data.TaggedError(
  "TaskSystemRunAttemptStaleScopeAuthorityError",
)<{
  readonly operation: RunAttemptOperationV1;
  readonly runId: TaskRunIdV1;
  readonly authority:
    | "epoch"
    | "storage_generation"
    | "physical_locator"
    | "deployment_binding";
}> {}

export class TaskSystemRunAttemptTransientStoreError extends Data.TaggedError(
  "TaskSystemRunAttemptTransientStoreError",
)<{
  readonly operation: RunAttemptOperationV1;
  readonly runId: TaskRunIdV1;
  readonly reason:
    | "transaction_conflict"
    | "connection_unavailable"
    | "timeout"
    | "driver_failure";
  readonly cause: unknown;
}> {}

export class TaskSystemRunAttemptTerminalStoreError extends Data.TaggedError(
  "TaskSystemRunAttemptTerminalStoreError",
)<{
  readonly operation: RunAttemptOperationV1;
  readonly runId: TaskRunIdV1;
  readonly reason:
    | "unsupported_integration"
    | "wrong_placement"
    | "transaction_capability_missing"
    | "identity_allocation_exhausted"
    | "fence_allocation_exhausted"
    | "version_storage_exhausted"
    | "serialization_unsupported";
  readonly cause: unknown | null;
}> {}

export type TaskSystemRunAttemptStoreErrorV1 =
  | TaskSystemRunAttemptUnavailableError
  | TaskSystemRunAttemptCorruptionError
  | TaskSystemRunAttemptStaleScopeAuthorityError
  | TaskSystemRunAttemptTransientStoreError
  | TaskSystemRunAttemptTerminalStoreError;

export type RunAttemptLifecycleErrorV1 =
  | InvalidRunAttemptCommandError
  | RunAttemptDecisionErrorV1
  | TaskSystemRunAttemptStoreErrorV1;
