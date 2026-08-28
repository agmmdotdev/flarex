import { Data } from "effect";
import type { CanonicalJsonEncodingInvariantIssue } from "flarex-protocol/json";

export type TaskRuntimeFamilyOperationV1 =
  | "decode_compute_profile_catalog"
  | "encode_compute_profile_catalog"
  | "decode_compute_profile_catalog_preimage"
  | "decode_node_artifact"
  | "encode_node_artifact"
  | "decode_node_artifact_preimage"
  | "admit_isolate_publication"
  | "admit_node_artifact";

export type TaskRuntimeFamilyFailureReasonV1 =
  | "invalid_shape"
  | "invalid_text"
  | "invalid_digest"
  | "invalid_number"
  | "invalid_compute_profile"
  | "duplicate_compute_profile"
  | "unordered_compute_profiles"
  | "invalid_runtime_family"
  | "invalid_runtime_contract"
  | "invalid_capability_policy"
  | "invalid_artifact_reference"
  | "invalid_module"
  | "duplicate_module_path"
  | "unordered_modules"
  | "missing_execution_module"
  | "missing_handler_module"
  | "profile_not_found"
  | "runtime_family_mismatch"
  | "runtime_abi_mismatch"
  | "duration_exceeded"
  | "manifest_mismatch"
  | "catalog_mismatch"
  | "noncanonical_preimage"
  | "canonical_bytes_exceeded";

export class InvalidTaskRuntimeFamilyV1Error<
  Operation extends TaskRuntimeFamilyOperationV1 = TaskRuntimeFamilyOperationV1,
> extends Data.TaggedError("InvalidTaskRuntimeFamilyV1Error")<{
  readonly operation: Operation;
  readonly reason: TaskRuntimeFamilyFailureReasonV1;
  readonly path?: string;
  readonly observed?: number;
  readonly maximum?: number;
}> {}

export class TaskRuntimeFamilyCanonicalEncodingV1Defect
  extends Data.TaggedError("TaskRuntimeFamilyCanonicalEncodingV1Defect")<{
    readonly operation: TaskRuntimeFamilyOperationV1;
    readonly issue: CanonicalJsonEncodingInvariantIssue;
  }> {}
