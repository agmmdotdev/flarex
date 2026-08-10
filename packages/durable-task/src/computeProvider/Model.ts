import type { Brand } from "effect";
import type { ReplacementScopeIdV1 } from "flarex-protocol/storage-authority";

import type {
  TaskAttemptIdV1,
  TaskAttemptNumberV1,
  TaskCancellationGenerationV1,
  TaskComputeProfileRefV1,
  TaskDefinitionRevisionIdV1,
  TaskDurationMsV1,
  TaskExecutionFenceV1,
  TaskLeaseVersionV1,
  TaskRequestedEffectSequenceV1,
  TaskRunIdV1,
} from "../runAttempt/Model.js";

export const TASK_COMPUTE_DISPATCH_IDENTITY_VERSION_V1 =
  "flarex.task-compute-dispatch-identity.v1" as const;
export const TASK_COMPUTE_DISPATCH_REQUEST_VERSION_V1 =
  "flarex.task-compute-dispatch-request.v1" as const;
export const TASK_COMPUTE_DISPATCH_ACCEPTANCE_VERSION_V1 =
  "flarex.task-compute-dispatch-acceptance.v1" as const;
export const TASK_COMPUTE_CANCELLATION_REQUEST_VERSION_V1 =
  "flarex.task-compute-cancellation-request.v1" as const;
export const TASK_COMPUTE_CANCELLATION_RECEIPT_VERSION_V1 =
  "flarex.task-compute-cancellation-receipt.v1" as const;

export type TaskComputeProviderNameV1 = Brand.Branded<
  string,
  "FlarexDurableTask/TaskComputeProviderNameV1"
>;
export type TaskComputeProviderVersionV1 = Brand.Branded<
  string,
  "FlarexDurableTask/TaskComputeProviderVersionV1"
>;
export type TaskComputeExecutionIdV1 = Brand.Branded<
  string,
  "FlarexDurableTask/TaskComputeExecutionIdV1"
>;

export interface TaskComputeProviderDescriptorV1 {
  readonly provider: TaskComputeProviderNameV1;
  readonly providerVersion: TaskComputeProviderVersionV1;
}

export interface TaskComputeDispatchIdentityV1 {
  readonly version: typeof TASK_COMPUTE_DISPATCH_IDENTITY_VERSION_V1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly runId: TaskRunIdV1;
  readonly requestedEffectSequence: TaskRequestedEffectSequenceV1;
  readonly attemptId: TaskAttemptIdV1;
  readonly executionFence: TaskExecutionFenceV1;
}

export type TaskComputeCancellationProjectionV1 =
  | {
      readonly kind: "not_requested";
      readonly generation: TaskCancellationGenerationV1;
    }
  | {
      readonly kind: "requested";
      readonly generation: TaskCancellationGenerationV1;
    };

export interface TaskComputeDispatchRequestV1 {
  readonly version: typeof TASK_COMPUTE_DISPATCH_REQUEST_VERSION_V1;
  readonly identity: TaskComputeDispatchIdentityV1;
  readonly taskDefinitionRevisionId: TaskDefinitionRevisionIdV1;
  readonly attemptNumber: TaskAttemptNumberV1;
  readonly leaseVersion: TaskLeaseVersionV1;
  readonly computeProfile: TaskComputeProfileRefV1;
  readonly cancellation: TaskComputeCancellationProjectionV1;
  readonly maximumDurationMs: TaskDurationMsV1;
}

export interface TaskComputeExecutionRefV1
  extends TaskComputeProviderDescriptorV1 {
  readonly executionId: TaskComputeExecutionIdV1;
}

export interface TaskComputeDispatchAcceptanceV1 {
  readonly version: typeof TASK_COMPUTE_DISPATCH_ACCEPTANCE_VERSION_V1;
  readonly kind: "accepted";
  readonly identity: TaskComputeDispatchIdentityV1;
  readonly execution: TaskComputeExecutionRefV1;
}

export interface TaskComputeCancellationRequestV1 {
  readonly version: typeof TASK_COMPUTE_CANCELLATION_REQUEST_VERSION_V1;
  readonly identity: TaskComputeDispatchIdentityV1;
  readonly execution: TaskComputeExecutionRefV1;
  readonly cancellationGeneration: TaskCancellationGenerationV1;
}

export interface TaskComputeCancellationReceiptV1 {
  readonly version: typeof TASK_COMPUTE_CANCELLATION_RECEIPT_VERSION_V1;
  readonly kind: "interruption_requested";
  readonly identity: TaskComputeDispatchIdentityV1;
  readonly execution: TaskComputeExecutionRefV1;
  readonly cancellationGeneration: TaskCancellationGenerationV1;
}
