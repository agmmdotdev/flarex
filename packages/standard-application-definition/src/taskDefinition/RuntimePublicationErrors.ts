import { Data } from "effect";
import type { CanonicalJsonEncodingInvariantIssue } from "flarex-protocol/json";

export type TaskRuntimePublicationOperationV1 =
  | "prepare_publication"
  | "decode_projection_module"
  | "decode_projection_modules"
  | "encode_projection_module"
  | "decode_projection_module_preimage"
  | "hash_projection_module"
  | "decode_projection"
  | "encode_projection"
  | "decode_projection_preimage"
  | "hash_projection"
  | "decode_group_manifest"
  | "encode_group_manifest"
  | "decode_group_manifest_preimage"
  | "hash_group_manifest"
  | "decode_materialization_spec"
  | "encode_materialization_spec"
  | "decode_materialization_spec_preimage"
  | "hash_materialization_spec"
  | "encode_module_root"
  | "decode_module_root_preimage"
  | "hash_module_root"
  | "encode_entry_root"
  | "decode_entry_root"
  | "decode_entry_root_preimage"
  | "hash_entry_root";

export type TaskRuntimePublicationReasonV1 =
  | "invalid_preparation_input"
  | "authenticated_evidence_mismatch"
  | "task_binding_mismatch"
  | "unsupported_materialization_policy"
  | "module_collision"
  | "publication_budget_exceeded"
  | "invalid_shape"
  | "invalid_digest"
  | "invalid_ordinal"
  | "invalid_count"
  | "invalid_byte_length"
  | "invalid_module_path"
  | "reserved_module_path"
  | "invalid_source_roles"
  | "invalid_source_bytes"
  | "source_length_mismatch"
  | "source_digest_mismatch"
  | "duplicate_module_path"
  | "unordered_modules"
  | "missing_execution_module"
  | "invalid_compatibility"
  | "invalid_implementation_version"
  | "invalid_compute_profile"
  | "duplicate_compute_profile"
  | "unordered_compute_profiles"
  | "invalid_root"
  | "canonical_bytes_exceeded"
  | "noncanonical_preimage";

export class InvalidTaskRuntimePublicationV1Error<
  Operation extends TaskRuntimePublicationOperationV1 =
    TaskRuntimePublicationOperationV1,
> extends Data.TaggedError("InvalidTaskRuntimePublicationV1Error")<{
  readonly operation: Operation;
  readonly reason: TaskRuntimePublicationReasonV1;
  readonly path?: string;
  readonly observed?: number;
  readonly maximum?: number;
}> {}

export class TaskRuntimePublicationCanonicalEncodingV1Defect
  extends Data.TaggedError("TaskRuntimePublicationCanonicalEncodingV1Defect")<{
    readonly operation: TaskRuntimePublicationOperationV1;
    readonly issue: CanonicalJsonEncodingInvariantIssue;
  }> {}
