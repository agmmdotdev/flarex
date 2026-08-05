import type {
  CanonicalJsonEncodingInvariantIssue,
} from "flarex-protocol/json";
import { Data } from "effect";

export type StandardApplicationTaskDefinitionOperationV1 =
  | "decode_task_id"
  | "decode_manifest"
  | "decode_catalog"
  | "encode_manifest"
  | "encode_catalog"
  | "decode_runtime_entry"
  | "encode_runtime_entry"
  | "decode_application_revision_task_binding"
  | "encode_application_revision_task_binding"
  | "decode_runtime_binding"
  | "encode_runtime_binding"
  | "decode_creation_authority"
  | "decode_creation_authority_preimage"
  | "encode_creation_authority"
  | "hash_manifest"
  | "hash_catalog"
  | "hash_runtime_entry"
  | "hash_application_revision_task_binding"
  | "hash_runtime_binding"
  | "hash_creation_authority";

export type StandardApplicationTaskDefinitionReasonV1 =
  | "invalid_shape"
  | "invalid_task_id"
  | "duplicate_task_id"
  | "too_many_tasks"
  | "catalog_validator_budget_exceeded"
  | "invalid_handler"
  | "invalid_validator"
  | "invalid_policy"
  | "invalid_duration"
  | "invalid_compute_profile"
  | "invalid_queue"
  | "invalid_digest"
  | "invalid_application_revision"
  | "invalid_ordinal"
  | "invalid_activation_revision"
  | "invalid_runtime_object"
  | "duplicate_runtime_object"
  | "missing_runtime_object"
  | "inconsistent_binding"
  | "canonical_bytes_exceeded";

export class InvalidStandardApplicationTaskDefinitionV1Error
  extends Data.TaggedError("InvalidStandardApplicationTaskDefinitionV1Error")<{
    readonly operation: StandardApplicationTaskDefinitionOperationV1;
    readonly reason: StandardApplicationTaskDefinitionReasonV1;
    readonly path?: string;
    readonly observed?: number;
    readonly maximum?: number;
  }> {}

export class StandardApplicationTaskSha256InputV1Error
  extends Data.TaggedError("StandardApplicationTaskSha256InputV1Error")<{
    readonly reason: "invalidBudget" | "invalidBytes" | "inputBytesExceeded";
    readonly observed?: number;
    readonly maximum?: number;
  }> {}

export class StandardApplicationTaskSha256ResourceV1Error
  extends Data.TaggedError("StandardApplicationTaskSha256ResourceV1Error")<{
    readonly reason: "unavailable" | "nativeRejected";
  }> {}

export type StandardApplicationTaskSha256V1Error =
  | StandardApplicationTaskSha256InputV1Error
  | StandardApplicationTaskSha256ResourceV1Error;

export class StandardApplicationTaskSha256InvariantV1Defect
  extends Data.TaggedError("StandardApplicationTaskSha256InvariantV1Defect")<{
    readonly observedByteLength: number | undefined;
  }> {}

export class StandardApplicationTaskCanonicalEncodingV1Defect
  extends Data.TaggedError(
    "StandardApplicationTaskCanonicalEncodingV1Defect",
  )<{
    readonly operation: StandardApplicationTaskDefinitionOperationV1;
    readonly issue: CanonicalJsonEncodingInvariantIssue;
  }> {}
