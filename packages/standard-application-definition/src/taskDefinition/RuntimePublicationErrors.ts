import { Data } from "effect";
import type { CanonicalJsonEncodingInvariantIssue } from "flarex-protocol/json";

export type TaskRuntimePublicationOperation =
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
  | "hash_entry_root"
  | "encode_publication_receipt"
  | "decode_publication_receipt"
  | "prepare_publication_receipt";

export type TaskRuntimePublicationReason =
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
  | "noncanonical_preimage"
  | "invalid_receipt"
  | "invalid_runtime_object"
  | "duplicate_runtime_object"
  | "missing_runtime_object"
  | "receipt_digest_mismatch";

export class InvalidTaskRuntimePublicationError<
  Operation extends TaskRuntimePublicationOperation =
    TaskRuntimePublicationOperation,
> extends Data.TaggedError("InvalidTaskRuntimePublicationError")<{
  readonly operation: Operation;
  readonly reason: TaskRuntimePublicationReason;
  readonly path?: string;
  readonly observed?: number;
  readonly maximum?: number;
}> {}

export class TaskRuntimePublicationCanonicalEncodingDefect
  extends Data.TaggedError("TaskRuntimePublicationCanonicalEncodingDefect")<{
    readonly operation: TaskRuntimePublicationOperation;
    readonly issue: CanonicalJsonEncodingInvariantIssue;
  }> {}
