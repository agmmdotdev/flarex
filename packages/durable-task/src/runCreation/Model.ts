import type { Brand } from "effect";

import type {
  RunAttemptPolicyV1,
  TaskComputeProfileRefV1,
  TaskDatabaseTimeMsV1,
  TaskDefinitionRevisionIdV1,
  TaskDurationMsV1,
  TaskRunIdV1,
} from "../runAttempt/Model.js";

export const TASK_INPUT_REFERENCE_CODEC_V1 =
  "flarex.task-input-reference.v1" as const;
export const TASK_INPUT_OBJECT_STORE_V1 =
  "flarex.task-input-object-store.v1" as const;
export const TASK_INPUT_VALUE_CODEC_V1 = "flarex-value/v1" as const;
export const TASK_INPUT_RETENTION_V1 = "run_lifetime" as const;
export const TASK_INPUT_OBJECT_KEY_PREFIX_V1 =
  "durable-task-input/v1/sha256/" as const;
export const MAX_TASK_INPUT_CANONICAL_BYTES_V1 = 32 * 1_048_576;
export const TASK_EXECUTION_PRINCIPAL_REFERENCE_CODEC_V1 =
  "flarex.task-execution-principal-reference.v1" as const;
export const TASK_EXECUTION_PRINCIPAL_OBJECT_STORE_V1 =
  "flarex.task-execution-principal-object-store.v1" as const;
export const TASK_EXECUTION_PRINCIPAL_VALUE_CODEC_V1 = "flarex-value/v1" as const;
export const TASK_EXECUTION_PRINCIPAL_KIND_V1 = "authenticated_user" as const;
export const TASK_EXECUTION_PRINCIPAL_RETENTION_V1 = "run_lifetime" as const;
export const TASK_EXECUTION_PRINCIPAL_OBJECT_KEY_PREFIX_V1 =
  "durable-task-principal/v1/sha256/" as const;
export const MAX_TASK_EXECUTION_PRINCIPAL_CANONICAL_BYTES_V1 = 256 * 1_024;
export const MAX_TASK_RUN_CREATION_REQUEST_KEY_UTF8_BYTES_V1 = 255;

export const TASK_RUN_CREATION_REQUEST_KEY_PREIMAGE_CODEC_V1 =
  "flarex.task-run-creation-request-key-preimage.v1" as const;
export const TASK_RUN_CREATION_REQUEST_PREIMAGE_CODEC_V1 =
  "flarex.task-run-creation-request-preimage.v1" as const;
export const APPLICATION_TASK_RUN_CREATION_REQUEST_PREIMAGE_CODEC_V1 =
  "flarex.application-task-run-creation-request-preimage.v1" as const;

export type TaskInputSha256V1 = Brand.Branded<
  Uint8Array,
  "FlarexDurableTask/TaskInputSha256V1"
>;
export type TaskExecutionPrincipalSha256V1 = Brand.Branded<
  Uint8Array,
  "FlarexDurableTask/TaskExecutionPrincipalSha256V1"
>;
export type TaskRunCreationRequestKeyV1 = Brand.Branded<
  string,
  "FlarexDurableTask/TaskRunCreationRequestKeyV1"
>;
export type TaskRunCreationRequestKeySha256V1 = Brand.Branded<
  Uint8Array,
  "FlarexDurableTask/TaskRunCreationRequestKeySha256V1"
>;
export type TaskRunCreationRequestSha256V1 = Brand.Branded<
  Uint8Array,
  "FlarexDurableTask/TaskRunCreationRequestSha256V1"
>;
export type TaskRunCreationAuthoritySha256V1 = Brand.Branded<
  Uint8Array,
  "FlarexDurableTask/TaskRunCreationAuthoritySha256V1"
>;
export type ApplicationTaskRuntimeTargetSha256V1 = Brand.Branded<
  Uint8Array,
  "FlarexDurableTask/ApplicationTaskRuntimeTargetSha256V1"
>;

/** Current in-memory definition identity; persisted V1 contracts remain exact. */
export type TaskDefinitionReference =
  | Readonly<{
      readonly generation: "legacy_definition_v1";
      readonly taskDefinitionRevisionId: TaskDefinitionRevisionIdV1;
    }>
  | Readonly<{
      readonly generation: "application_v1";
      readonly applicationTaskRuntimeTargetSha256:
        ApplicationTaskRuntimeTargetSha256V1;
    }>;

export interface TaskInputReferenceV1 {
  readonly codec: typeof TASK_INPUT_REFERENCE_CODEC_V1;
  readonly store: typeof TASK_INPUT_OBJECT_STORE_V1;
  readonly valueCodec: typeof TASK_INPUT_VALUE_CODEC_V1;
  readonly objectKey: string;
  readonly byteLength: number;
  readonly sha256: TaskInputSha256V1;
  readonly retention: {
    readonly kind: typeof TASK_INPUT_RETENTION_V1;
  };
}

export interface TaskExecutionPrincipalReferenceV1 {
  readonly principalKind: typeof TASK_EXECUTION_PRINCIPAL_KIND_V1;
  readonly codec: typeof TASK_EXECUTION_PRINCIPAL_REFERENCE_CODEC_V1;
  readonly store: typeof TASK_EXECUTION_PRINCIPAL_OBJECT_STORE_V1;
  readonly valueCodec: typeof TASK_EXECUTION_PRINCIPAL_VALUE_CODEC_V1;
  readonly objectKey: string;
  readonly byteLength: number;
  readonly sha256: TaskExecutionPrincipalSha256V1;
  readonly retention: {
    readonly kind: typeof TASK_EXECUTION_PRINCIPAL_RETENTION_V1;
  };
}

export interface TaskRunCreationRequestV1 {
  readonly version: 1;
  readonly requestKey: TaskRunCreationRequestKeyV1;
  readonly taskDefinitionRevisionId: TaskDefinitionRevisionIdV1;
  readonly input: TaskInputReferenceV1;
}

export interface ApplicationTaskRunCreationRequestV1 {
  readonly version: 1;
  readonly requestKey: TaskRunCreationRequestKeyV1;
  readonly applicationTaskRuntimeTargetSha256:
    ApplicationTaskRuntimeTargetSha256V1;
  readonly input: TaskInputReferenceV1;
  readonly principal: TaskExecutionPrincipalReferenceV1;
}

/**
 * Stable durable replay data. Whether this call inserted or replayed the row
 * is deliberately not part of this receipt.
 */
export interface TaskRunCreationReceiptV1 {
  readonly status: "created";
  readonly version: 1;
  readonly runId: TaskRunIdV1;
  readonly taskDefinitionRevisionId: TaskDefinitionRevisionIdV1;
  readonly createdAtMs: TaskDatabaseTimeMsV1;
  readonly requestKeySha256: TaskRunCreationRequestKeySha256V1;
  readonly requestSha256: TaskRunCreationRequestSha256V1;
  readonly creationAuthoritySha256: TaskRunCreationAuthoritySha256V1;
}

export interface ApplicationTaskRunCreationReceiptV1 {
  readonly status: "created";
  readonly version: 1;
  readonly runId: TaskRunIdV1;
  readonly applicationTaskRuntimeTargetSha256:
    ApplicationTaskRuntimeTargetSha256V1;
  readonly createdAtMs: TaskDatabaseTimeMsV1;
  readonly requestKeySha256: TaskRunCreationRequestKeySha256V1;
  readonly requestSha256: TaskRunCreationRequestSha256V1;
  readonly creationAuthoritySha256: TaskRunCreationAuthoritySha256V1;
}

export interface TaskRunCreationInitialAggregateInputV1 {
  readonly runId: TaskRunIdV1;
  readonly taskDefinitionRevisionId: TaskDefinitionRevisionIdV1;
  readonly createdAtMs: TaskDatabaseTimeMsV1;
  readonly runAttemptPolicy: RunAttemptPolicyV1;
  readonly maximumDurationMs: TaskDurationMsV1;
  readonly initialComputeProfile: TaskComputeProfileRefV1;
  readonly leaseDurationMs: TaskDurationMsV1;
  readonly immediateRetryThresholdMs: TaskDurationMsV1;
}

export interface ApplicationTaskRunCreationInitialAggregateInputV1 {
  readonly runId: TaskRunIdV1;
  readonly applicationTaskRuntimeTargetSha256:
    ApplicationTaskRuntimeTargetSha256V1;
  readonly createdAtMs: TaskDatabaseTimeMsV1;
  readonly runAttemptPolicy: RunAttemptPolicyV1;
  readonly maximumDurationMs: TaskDurationMsV1;
  readonly initialComputeProfile: TaskComputeProfileRefV1;
  readonly leaseDurationMs: TaskDurationMsV1;
  readonly immediateRetryThresholdMs: TaskDurationMsV1;
}
