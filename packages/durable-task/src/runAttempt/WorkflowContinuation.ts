import { Schema, SchemaTransformation } from "effect";
import type { CurrentTaskRunAttemptAcceptedReceipt, CurrentTaskRunAttemptAggregateBase,
  TaskCancellationNotRequestedV1, TaskCancellationRequestedV1,
  TaskDatabaseTimeMsV1, TaskDurationMsV1, TaskExecutionFenceV1, TaskAttemptIdV1,
  TaskRunIdV1, TaskRunVersionV1, TaskTerminalAttemptRefV1, TaskAcceptedRetryV1,
  TaskComputeProfileRefV1 } from "./Model.js";

export const MAX_TRUSTED_WORKFLOW_CHECKPOINT_BYTES = 1_048_576;
export const TrustedWorkflowCheckpointDescriptorSchema = Schema.Struct({
  revision: Schema.BigInt.check(Schema.makeFilter(value => value >= 1n && value <= 9_223_372_036_854_775_807n)),
  sha256: Schema.Uint8Array.check(Schema.makeFilter(value => value.byteLength === 32)),
  byteLength: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MAX_TRUSTED_WORKFLOW_CHECKPOINT_BYTES })),
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type TrustedWorkflowCheckpointDescriptor = typeof TrustedWorkflowCheckpointDescriptorSchema.Type;
/** Task aggregate persistence already encodes counters as canonical decimals. */
export const TrustedWorkflowCheckpointDescriptorCodec = Schema.Struct({
  ...TrustedWorkflowCheckpointDescriptorSchema.fields,
  revision: Schema.String.check(Schema.isPattern(/^(?:0|[1-9][0-9]*)$/)).pipe(Schema.decodeTo(
    TrustedWorkflowCheckpointDescriptorSchema.fields.revision, SchemaTransformation.bigintFromString,
  )),
}).annotate({ parseOptions: { onExcessProperty: "error" } });

export interface TrustedWorkflowContinuation {
  readonly waitId: string;
  readonly checkpoint: TrustedWorkflowCheckpointDescriptor;
  readonly nativeStartedAtMs: TaskDatabaseTimeMsV1;
  readonly timeoutMs: TaskDurationMsV1;
  readonly deadlineAtMs: TaskDatabaseTimeMsV1;
  readonly registeredAtMs: TaskDatabaseTimeMsV1;
  readonly suspendedAttempt: TaskTerminalAttemptRefV1;
  readonly suspendedAttemptAcceptedRunVersion: TaskRunVersionV1;
  readonly suspendedComputeProfile: TaskComputeProfileRefV1;
  readonly resumeAfterAttempt?: TaskTerminalAttemptRefV1;
  readonly resumeAfterAttemptAcceptedRunVersion?: TaskRunVersionV1;
  readonly controlRetry?: TaskAcceptedRetryV1;
  readonly resolution: null | Readonly<{
    readonly kind: "confirmed" | "timeout" | "cancelled";
    readonly observedAtMs: TaskDatabaseTimeMsV1;
  }>;
  /** Retained registration/decision receipts outlive later lifecycle acceptance. */
  readonly registrationReceipt: CurrentTaskRunAttemptAcceptedReceipt<TrustedWorkflowContinuationOutcome>;
  readonly resolutionReceipt: CurrentTaskRunAttemptAcceptedReceipt<TrustedWorkflowContinuationOutcome> | null;
  readonly cancellationReceipt?: CurrentTaskRunAttemptAcceptedReceipt<TrustedWorkflowContinuationOutcome>;
}
export type TrustedWorkflowContinuationOutcome = Readonly<{
  readonly kind: "continuation_waiting" | "continuation_ready";
  readonly waitId: string;
  readonly resolution: "confirmed" | "timeout" | "cancelled" | null;
}> | Readonly<{ readonly kind: "current"; readonly reason: "not_waiting" | "wait_mismatch" | "not_expired" | "already_resolved" }>;
export interface TrustedWorkflowContinuationEvidence {
  readonly version: "flarex.task-run-attempt-evidence.v1";
  readonly kind: "workflow_continuation";
  readonly runId: TaskRunIdV1;
  readonly acceptedRunVersion: TaskRunVersionV1;
  readonly recordedAtMs: TaskDatabaseTimeMsV1;
  readonly resultingPhase: "continuation_waiting" | "continuation_ready";
  readonly operation: "register_continuation" | "confirm_continuation" | "expire_continuation" | "request_cancellation";
  readonly waitId: string;
  readonly attempt: TaskTerminalAttemptRefV1;
  readonly outcome: TrustedWorkflowContinuationOutcome;
  readonly checkpoint?: TrustedWorkflowCheckpointDescriptor;
  readonly nativeStartedAtMs?: TaskDatabaseTimeMsV1;
  readonly timeoutMs?: TaskDurationMsV1;
  readonly deadlineAtMs?: TaskDatabaseTimeMsV1;
}
export interface TrustedWorkflowContinuationAcceptance {
  readonly kind: "workflow_continuation";
  readonly accepted: CurrentTaskRunAttemptAcceptedReceipt<TrustedWorkflowContinuationOutcome>;
}
export type TrustedWorkflowContinuationAggregate = CurrentTaskRunAttemptAggregateBase & Readonly<{
  readonly continuation: TrustedWorkflowContinuation;
  readonly cancellation: TaskCancellationNotRequestedV1 | TaskCancellationRequestedV1;
}> & (Readonly<{ readonly phase: "continuation_waiting" }> | Readonly<{ readonly phase: "continuation_ready" }>);
export interface RegisterTrustedWorkflowContinuationCommand {
  readonly type: "register_continuation";
  readonly runId: TaskRunIdV1;
  readonly attemptId: TaskAttemptIdV1;
  readonly executionFence: TaskExecutionFenceV1;
  readonly expectedRunVersion: TaskRunVersionV1;
  readonly waitId: string;
  readonly checkpoint: TrustedWorkflowCheckpointDescriptor;
  readonly nativeStartedAtMs: TaskDatabaseTimeMsV1;
  readonly timeoutMs: TaskDurationMsV1;
  readonly deadlineAtMs: TaskDatabaseTimeMsV1;
}
export interface ResolveTrustedWorkflowContinuationCommand {
  readonly type: "confirm_continuation" | "expire_continuation";
  readonly runId: TaskRunIdV1;
  readonly waitId: string;
}
