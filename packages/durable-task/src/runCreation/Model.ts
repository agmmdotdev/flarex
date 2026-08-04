import type { Brand } from "effect";

import type {
  TaskDatabaseTimeMsV1,
  TaskDefinitionRevisionIdV1,
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
export const MAX_TASK_RUN_CREATION_REQUEST_KEY_UTF8_BYTES_V1 = 255;

export const TASK_RUN_CREATION_REQUEST_KEY_PREIMAGE_CODEC_V1 =
  "flarex.task-run-creation-request-key-preimage.v1" as const;
export const TASK_RUN_CREATION_REQUEST_PREIMAGE_CODEC_V1 =
  "flarex.task-run-creation-request-preimage.v1" as const;

export type TaskInputSha256V1 = Brand.Branded<
  Uint8Array,
  "FlarexDurableTask/TaskInputSha256V1"
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

export interface TaskRunCreationRequestV1 {
  readonly version: 1;
  readonly requestKey: TaskRunCreationRequestKeyV1;
  readonly taskDefinitionRevisionId: TaskDefinitionRevisionIdV1;
  readonly input: TaskInputReferenceV1;
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
