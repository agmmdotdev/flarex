import type {
  SessionJournalIncrementalLimitDimensionV1,
  SessionJournalPersistedPointIssueV1,
  SessionJournalSequenceIssueV1,
} from "./contracts";
import type { SessionJournalStorageCorruptionV1Error } from "./errors";
import type { SessionJournalAttemptStateV1 } from "./state";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { Result } from "effect";
import type { AppCreationTimeV1 } from "flarex-protocol/app-document";
import type { AppRowIdHexV1 } from "flarex-protocol/app-document-id";
import type { CatalogTableId } from "flarex-protocol/catalog";
import {
  MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1,
  MAX_COMMIT_OPERATION_CALLS_V1,
  MAX_COMMIT_RECEIPT_EVIDENCE_BYTES_V1,
  MAX_COMMIT_FAILED_RECEIPT_EVIDENCE_BYTES_V1,
  MAX_COMMIT_INDEXED_QUERY_SYSCALLS_V1,
  MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1,
  MAX_COMMIT_INDEX_RANGE_DEPENDENCY_EVIDENCE_BYTES_V1,
  MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
  MAX_COMMIT_READ_DOCUMENTS_V1,
  MAX_COMMIT_READ_SEMANTIC_BYTES_V1,
  MAX_COMMIT_WRITE_OPERATIONS_V1,
  MAX_COMMIT_WRITE_SEMANTIC_BYTES_V1,
  MAX_COMMIT_RELATION_BASE_OCCURRENCES_V1,
  MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1,
  MAX_COMMIT_RELATION_READ_SYSCALLS_V1,
} from "flarex-protocol/commit-protocol";
import type { LogicalAppWriteV1 } from "flarex-protocol/commit-protocol";
import type {
  CanonicalFlarexValueBytesV1,
  CanonicalFlarexValueV1,
  FlarexValueSha256V1,
} from "flarex-protocol/value";
import type { AppRowPointDependencyV1 } from "../../storage/documents/appRows";
import type { ValidateApplicationRevisionSyscallDocumentV1Input } from "../../application/revision/applicationRevisionSyscallValidatorV1";
import type { fxSystemTransactionJournals } from "../../database/schema";
import type { SessionJournalStoredOutcome } from "./codecs";
import { corruption } from "./journalFailures";

export type SessionJournalIncrementalLimitIssueV1 = Omit<
  Extract<
    SessionJournalPersistedPointIssueV1,
    { readonly reason: "limitExceeded" }
  >,
  "reason"
>;

export const SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1 = Object.freeze({
  readDocuments: MAX_COMMIT_READ_DOCUMENTS_V1,
  readSemanticBytes: MAX_COMMIT_READ_SEMANTIC_BYTES_V1,
  pointReadDependencies: MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
  indexedQuerySyscalls: MAX_COMMIT_INDEXED_QUERY_SYSCALLS_V1,
  indexRangeReadDependencies: MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1,
  indexRangeDependencyEvidenceBytes:
    MAX_COMMIT_INDEX_RANGE_DEPENDENCY_EVIDENCE_BYTES_V1,
  relationReadSyscalls: MAX_COMMIT_RELATION_READ_SYSCALLS_V1,
  relationReadDependencies: MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1,
  relationBaseOccurrences: MAX_COMMIT_RELATION_BASE_OCCURRENCES_V1,
  writeOperations: MAX_COMMIT_WRITE_OPERATIONS_V1,
  writeSemanticBytes: MAX_COMMIT_WRITE_SEMANTIC_BYTES_V1,
  materialWriteEventEvidenceBytes:
    MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1,
  operationCalls: MAX_COMMIT_OPERATION_CALLS_V1,
  receiptEvidenceBytes: MAX_COMMIT_RECEIPT_EVIDENCE_BYTES_V1,
} satisfies Readonly<
  Record<SessionJournalIncrementalLimitDimensionV1, number>
>);

export type AppliedSessionJournalOperationV1 =
  | Readonly<{
      readonly kind: "outcome";
      readonly delivery: "executed" | "replayed" | "sticky";
      readonly outcome: SessionJournalStoredOutcome;
    }>
  | Readonly<{
      readonly kind: "sequenceRejected";
      readonly issue: SessionJournalSequenceIssueV1;
    }>
  | Readonly<{
      readonly kind: "stateRejected";
      readonly reason:
        "journalSealed" | "journalFailed" | "journalRelationConflicted";
    }>;

export interface SessionJournalCountersV1 {
  readonly operationCalls: number;
  readonly receiptEvidenceBytes: number;
  readonly readDocuments: number;
  readonly readSemanticBytes: number;
  readonly pointDependencyCount: number;
  readonly indexedQuerySyscalls: number;
  readonly indexRangeDependencyCount: number;
  readonly indexRangeDependencyEvidenceBytes: number;
  readonly relationReadSyscalls: number;
  readonly relationDependencyCount: number;
  readonly relationBaseOccurrences: number;
  readonly writeOperations: number;
  readonly writeSemanticBytes: number;
  readonly materialWriteEventEvidenceBytes: number;
}

export interface SessionJournalCounterDeltasV1 {
  readonly operationCalls: number;
  readonly receiptEvidenceBytes: number;
  readonly readDocuments: number;
  readonly readSemanticBytes: number;
  readonly pointDependencyCount: number;
  readonly indexedQuerySyscalls: number;
  readonly indexRangeDependencyCount: number;
  readonly indexRangeDependencyEvidenceBytes: number;
  readonly relationReadSyscalls: number;
  readonly relationDependencyCount: number;
  readonly relationBaseOccurrences: number;
  readonly writeOperations: number;
  readonly writeSemanticBytes: number;
  readonly materialWriteEventEvidenceBytes: number;
}

export const ZERO_FINITE_COUNTERS: SessionJournalCountersV1 = Object.freeze({
  operationCalls: 0,
  receiptEvidenceBytes: 0,
  readDocuments: 0,
  readSemanticBytes: 0,
  pointDependencyCount: 0,
  indexedQuerySyscalls: 0,
  indexRangeDependencyCount: 0,
  indexRangeDependencyEvidenceBytes: 0,
  relationReadSyscalls: 0,
  relationDependencyCount: 0,
  relationBaseOccurrences: 0,
  writeOperations: 0,
  writeSemanticBytes: 0,
  materialWriteEventEvidenceBytes: 0,
});

export function addFiniteCounters(
  current: SessionJournalCountersV1,
  delta: SessionJournalCounterDeltasV1,
): SessionJournalCountersV1 {
  return Object.freeze({
    operationCalls: current.operationCalls + delta.operationCalls,
    receiptEvidenceBytes:
      current.receiptEvidenceBytes + delta.receiptEvidenceBytes,
    readDocuments: current.readDocuments + delta.readDocuments,
    readSemanticBytes: current.readSemanticBytes + delta.readSemanticBytes,
    pointDependencyCount:
      current.pointDependencyCount + delta.pointDependencyCount,
    indexedQuerySyscalls:
      current.indexedQuerySyscalls + delta.indexedQuerySyscalls,
    indexRangeDependencyCount:
      current.indexRangeDependencyCount + delta.indexRangeDependencyCount,
    indexRangeDependencyEvidenceBytes:
      current.indexRangeDependencyEvidenceBytes +
      delta.indexRangeDependencyEvidenceBytes,
    relationReadSyscalls:
      current.relationReadSyscalls + delta.relationReadSyscalls,
    relationDependencyCount:
      current.relationDependencyCount + delta.relationDependencyCount,
    relationBaseOccurrences:
      current.relationBaseOccurrences + delta.relationBaseOccurrences,
    writeOperations: current.writeOperations + delta.writeOperations,
    writeSemanticBytes: current.writeSemanticBytes + delta.writeSemanticBytes,
    materialWriteEventEvidenceBytes:
      current.materialWriteEventEvidenceBytes +
      delta.materialWriteEventEvidenceBytes,
  });
}

export const ZERO_COUNTER_DELTAS = Object.freeze({
  operationCalls: 1,
  receiptEvidenceBytes: 0,
  readDocuments: 0,
  readSemanticBytes: 0,
  pointDependencyCount: 0,
  indexedQuerySyscalls: 0,
  indexRangeDependencyCount: 0,
  indexRangeDependencyEvidenceBytes: 0,
  relationReadSyscalls: 0,
  relationDependencyCount: 0,
  relationBaseOccurrences: 0,
  writeOperations: 0,
  writeSemanticBytes: 0,
  materialWriteEventEvidenceBytes: 0,
} satisfies SessionJournalCounterDeltasV1);

interface JournalPointOverlayNoneV1 {
  readonly kind: "none" | "deleted";
}

interface JournalPointOverlayLiveV1 {
  readonly kind: "live";
  readonly creationTime: AppCreationTimeV1;
  readonly document: CanonicalFlarexValueV1;
}

export type JournalPointOverlayV1 =
  JournalPointOverlayNoneV1 | JournalPointOverlayLiveV1;

export interface JournalPointMutationV1 {
  readonly mode: "insert" | "update";
  readonly tableId: CatalogTableId;
  readonly rowId: AppRowIdHexV1;
  readonly dependency: AppRowPointDependencyV1;
  readonly generatedInsertion?: true;
  readonly overlay: JournalPointOverlayV1;
}

export interface SessionJournalOperationPlanV1 {
  readonly outcome: SessionJournalStoredOutcome;
  readonly counters: SessionJournalCounterDeltasV1;
  readonly pointMutation?: JournalPointMutationV1;
  readonly write?: LogicalAppWriteV1;
  readonly nextCreationTime?: AppCreationTimeV1;
  readonly documentValidation?: ValidateApplicationRevisionSyscallDocumentV1Input;
}

export interface PreparedLogicalWriteEventV1 {
  readonly write: LogicalAppWriteV1;
  readonly canonicalBytes: CanonicalFlarexValueBytesV1;
  readonly sha256: FlarexValueSha256V1;
  readonly evidenceBytes: number;
}

export interface LogicalPointReadV1 {
  readonly result: LogicalPointReadResultV1;
  readonly pointMutation?: JournalPointMutationV1;
  readonly dependencyIsNew: boolean;
}

type LogicalPointReadResultV1 =
  | Readonly<{
      readonly kind: "present";
      readonly document: CanonicalFlarexValueV1;
      readonly dependency: AppRowPointDependencyV1;
    }>
  | Readonly<{
      readonly kind: "missing";
      readonly document: null;
      readonly dependency: AppRowPointDependencyV1;
    }>;

export function countersForPointRead(
  read: LogicalPointReadV1,
): SessionJournalCounterDeltasV1 {
  return Object.freeze({
    ...ZERO_COUNTER_DELTAS,
    pointDependencyCount: read.dependencyIsNew ? 1 : 0,
    readDocuments: read.result.kind === "present" ? 1 : 0,
    readSemanticBytes:
      read.result.kind === "present"
        ? read.result.document.semanticSizeBytes
        : 0,
  });
}

export function pointMutationForOverlay(
  read: LogicalPointReadV1,
  tableId: CatalogTableId,
  rowId: AppRowIdHexV1,
  overlay: JournalPointOverlayV1,
): JournalPointMutationV1 {
  return Object.freeze({
    mode: read.pointMutation?.mode ?? "update",
    tableId,
    rowId,
    dependency: read.result.dependency,
    overlay,
  });
}

export function firstExceededLimit(
  current: SessionJournalCountersV1,
  deltas: SessionJournalCounterDeltasV1,
): SessionJournalIncrementalLimitIssueV1 | undefined {
  const candidates: ReadonlyArray<
    Readonly<{
      dimension: SessionJournalIncrementalLimitDimensionV1;
      observed: number;
      maximum: number;
    }>
  > = [
    {
      dimension: "operationCalls",
      observed: current.operationCalls + deltas.operationCalls,
      maximum: SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.operationCalls,
    },
    {
      dimension: "receiptEvidenceBytes",
      observed: current.receiptEvidenceBytes + deltas.receiptEvidenceBytes,
      maximum:
        SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.receiptEvidenceBytes,
    },
    {
      dimension: "readDocuments",
      observed: current.readDocuments + deltas.readDocuments,
      maximum: SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.readDocuments,
    },
    {
      dimension: "readSemanticBytes",
      observed: current.readSemanticBytes + deltas.readSemanticBytes,
      maximum: SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.readSemanticBytes,
    },
    {
      dimension: "pointReadDependencies",
      observed: current.pointDependencyCount + deltas.pointDependencyCount,
      maximum:
        SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.pointReadDependencies,
    },
    {
      dimension: "indexedQuerySyscalls",
      observed: current.indexedQuerySyscalls + deltas.indexedQuerySyscalls,
      maximum:
        SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.indexedQuerySyscalls,
    },
    {
      dimension: "indexRangeReadDependencies",
      observed:
        current.indexRangeDependencyCount + deltas.indexRangeDependencyCount,
      maximum:
        SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.indexRangeReadDependencies,
    },
    {
      dimension: "indexRangeDependencyEvidenceBytes",
      observed:
        current.indexRangeDependencyEvidenceBytes +
        deltas.indexRangeDependencyEvidenceBytes,
      maximum:
        SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.indexRangeDependencyEvidenceBytes,
    },
    {
      dimension: "relationReadSyscalls",
      observed: current.relationReadSyscalls + deltas.relationReadSyscalls,
      maximum:
        SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.relationReadSyscalls,
    },
    {
      dimension: "relationReadDependencies",
      observed:
        current.relationDependencyCount + deltas.relationDependencyCount,
      maximum:
        SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.relationReadDependencies,
    },
    {
      dimension: "relationBaseOccurrences",
      observed:
        current.relationBaseOccurrences + deltas.relationBaseOccurrences,
      maximum:
        SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.relationBaseOccurrences,
    },
    {
      dimension: "writeOperations",
      observed: current.writeOperations + deltas.writeOperations,
      maximum: SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.writeOperations,
    },
    {
      dimension: "writeSemanticBytes",
      observed: current.writeSemanticBytes + deltas.writeSemanticBytes,
      maximum: SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.writeSemanticBytes,
    },
    {
      dimension: "materialWriteEventEvidenceBytes",
      observed:
        current.materialWriteEventEvidenceBytes +
        deltas.materialWriteEventEvidenceBytes,
      maximum:
        SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.materialWriteEventEvidenceBytes,
    },
  ];
  return candidates.find((candidate) => candidate.observed > candidate.maximum);
}

export function decodeJournalCountersResult(
  attempt: SessionJournalAttemptStateV1,
  root: typeof fxSystemTransactionJournals.$inferSelect,
): Result.Result<
  SessionJournalCountersV1,
  SessionJournalStorageCorruptionV1Error
> {
  const counters = {
    operationCalls: Number(root.lastSyscallSequence),
    receiptEvidenceBytes: root.receiptEvidenceBytes,
    readDocuments: root.readDocuments,
    readSemanticBytes: root.readSemanticBytes,
    pointDependencyCount: root.pointDependencyCount,
    indexedQuerySyscalls: root.indexedQuerySyscalls,
    indexRangeDependencyCount: root.indexRangeDependencyCount,
    indexRangeDependencyEvidenceBytes: root.indexRangeDependencyEvidenceBytes,
    relationReadSyscalls: root.relationReadSyscalls,
    relationDependencyCount: root.relationDependencyCount,
    relationBaseOccurrences: root.relationBaseOccurrences,
    writeOperations: root.writeOperations,
    writeSemanticBytes: root.writeSemanticBytes,
    materialWriteEventEvidenceBytes: root.materialWriteEventEvidenceBytes,
  };
  const limits: ReadonlyArray<readonly [number, number]> = [
    [
      counters.operationCalls,
      SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.operationCalls,
    ],
    [
      counters.receiptEvidenceBytes,
      root.state === "failed" && root.failureDimension !== null
        ? MAX_COMMIT_FAILED_RECEIPT_EVIDENCE_BYTES_V1
        : SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.receiptEvidenceBytes,
    ],
    [
      counters.readDocuments,
      SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.readDocuments,
    ],
    [
      counters.readSemanticBytes,
      SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.readSemanticBytes,
    ],
    [
      counters.pointDependencyCount,
      SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.pointReadDependencies,
    ],
    [
      counters.indexedQuerySyscalls,
      SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.indexedQuerySyscalls,
    ],
    [
      counters.indexRangeDependencyCount,
      SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.indexRangeReadDependencies,
    ],
    [
      counters.indexRangeDependencyEvidenceBytes,
      SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.indexRangeDependencyEvidenceBytes,
    ],
    [
      counters.relationReadSyscalls,
      SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.relationReadSyscalls,
    ],
    [
      counters.relationDependencyCount,
      SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.relationReadDependencies,
    ],
    [
      counters.relationBaseOccurrences,
      SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.relationBaseOccurrences,
    ],
    [
      counters.writeOperations,
      SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.writeOperations,
    ],
    [
      counters.writeSemanticBytes,
      SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.writeSemanticBytes,
    ],
    [
      counters.materialWriteEventEvidenceBytes,
      SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.materialWriteEventEvidenceBytes,
    ],
  ];
  if (
    limits.some(
      ([value, maximum]) => !isNonNegativeSafeInteger(value) || value > maximum,
    )
  ) {
    return Result.fail(corruption(attempt, "journalCountersInvalid"));
  }
  return Result.succeed(Object.freeze(counters));
}
