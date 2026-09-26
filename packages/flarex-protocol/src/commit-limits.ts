/**
 * Convex-compatible execution ceilings. These are semantic execution limits,
 * not encoded-envelope limits. Provenance:
 *
 * - crates/common/src/knobs.rs
 * - crates/database/src/execution_size.rs
 * - crates/database/src/reads.rs
 * - crates/database/src/writes.rs
 * - crates/isolate/src/helpers.rs
 */
export const MAX_COMMIT_READ_DOCUMENTS_V1 = 32_000;
export const MAX_COMMIT_READ_SEMANTIC_BYTES_V1 = 1 << 24;
export const MAX_COMMIT_POINT_READ_DEPENDENCIES_V1 = 4_096;
export const MAX_COMMIT_INDEXED_QUERY_SYSCALLS_V1 = 32;
export const MAX_COMMIT_INDEXED_QUERY_PAGE_SIZE_V1 = 128;
export const MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1 = 32;
export const MAX_COMMIT_INDEX_RANGE_DEPENDENCY_EVIDENCE_BYTES_V1 = 1 << 18;
export const MAX_COMMIT_RELATION_READ_SYSCALLS_V1 = 128;
export const MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1 = 128;
export const MAX_COMMIT_RELATION_BASE_OCCURRENCES_V1 = 4_096;
/**
 * Operational ceiling for net application-row revisions lowered by the
 * current point-commit transaction owner. Unlike point reads, every material
 * row currently requires serialized row, intrinsic-index, and commit-feed
 * work while the scope clock is locked. Keep this bound deliberately smaller
 * until those phases are batched and load-tested at a higher fan-out.
 */
export const MAX_POINT_COMMIT_MATERIAL_ROWS_V1 = 128;
export const MAX_COMMIT_WRITE_OPERATIONS_V1 = 16_000;
export const MAX_COMMIT_WRITE_SEMANTIC_BYTES_V1 = 1 << 24;
export const MAX_COMMIT_RESULT_SEMANTIC_BYTES_V1 = 1 << 24;

export interface CommitProtocolExecutionLimitsV1 {
  readonly readDocuments: number;
  readonly readSemanticBytes: number;
  readonly pointReadDependencies: number;
  readonly indexedQuerySyscalls: number;
  readonly indexedQueryPageSize: number;
  readonly indexRangeReadDependencies: number;
  readonly relationReadSyscalls: number;
  readonly relationReadDependencies: number;
  readonly relationBaseOccurrences: number;
  readonly writeOperations: number;
  readonly writeSemanticBytes: number;
  readonly resultSemanticBytes: number;
}

export const COMMIT_PROTOCOL_EXECUTION_LIMITS_V1 = Object.freeze({
  readDocuments: MAX_COMMIT_READ_DOCUMENTS_V1,
  readSemanticBytes: MAX_COMMIT_READ_SEMANTIC_BYTES_V1,
  pointReadDependencies: MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
  indexedQuerySyscalls: MAX_COMMIT_INDEXED_QUERY_SYSCALLS_V1,
  indexedQueryPageSize: MAX_COMMIT_INDEXED_QUERY_PAGE_SIZE_V1,
  indexRangeReadDependencies: MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1,
  relationReadSyscalls: MAX_COMMIT_RELATION_READ_SYSCALLS_V1,
  relationReadDependencies: MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1,
  relationBaseOccurrences: MAX_COMMIT_RELATION_BASE_OCCURRENCES_V1,
  writeOperations: MAX_COMMIT_WRITE_OPERATIONS_V1,
  writeSemanticBytes: MAX_COMMIT_WRITE_SEMANTIC_BYTES_V1,
  resultSemanticBytes: MAX_COMMIT_RESULT_SEMANTIC_BYTES_V1,
} satisfies CommitProtocolExecutionLimitsV1);

/**
 * Flarex operational/resource-safety divergence, separate from transaction
 * semantics. The checked-in Convex function-runner response boundary is 64 MiB
 * to accommodate reads, writes, a result, and encoding overhead. C02 applies
 * the same pre-copy/pre-parse ceiling to one canonical evidence bundle. C03
 * separately applies that numeric ceiling to the cumulative canonical bytes
 * of temporary material-write events so an attempt cannot amplify trusted
 * storage before seal. That temporary-evidence bound is not a Convex
 * transaction semantic, final-journal substitute, lease authority, or hosted
 * transport guarantee. C07A must re-prove its hosted transport boundary before
 * activating inline carriage.
 */
export const MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1 = 1 << 26;
export const MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1 = 1 << 26;

export interface CommitProtocolOperationalLimitsV1 {
  readonly canonicalEvidenceBytes: number;
  readonly indexRangeDependencyEvidenceBytes: number;
  readonly materialWriteEventEvidenceBytes: number;
}

export const COMMIT_PROTOCOL_OPERATIONAL_LIMITS_V1 = Object.freeze({
  canonicalEvidenceBytes: MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1,
  indexRangeDependencyEvidenceBytes:
    MAX_COMMIT_INDEX_RANGE_DEPENDENCY_EVIDENCE_BYTES_V1,
  materialWriteEventEvidenceBytes:
    MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1,
} satisfies CommitProtocolOperationalLimitsV1);
