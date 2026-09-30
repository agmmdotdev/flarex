import { ExactDecimalError } from "flarex-protocol/internal/exact-decimal";
import {
  bytesEqualFullScan as bytesEqual,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { finiteDateMilliseconds } from "@flarex/utils/dates";
import {
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
} from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { Cause, Data, Effect, Exit, Option, Result, Schema } from "effect";
import { validateApplicationWriteOwnershipForCommit } from "./applicationWriteOwnership/Commit";
import { EventEnvelope, commitEventLimits } from "./commitEvents/model";
import { ApplicationTableWriteDeniedError } from "./applicationWriteOwnership/Model";
export { ApplicationTableWriteDeniedError } from "./applicationWriteOwnership/Model";

import {
  AppDocumentSystemFieldV1Error,
  decodeAppCreationTimeV1,
  verifyAppDocumentEvidenceV1,
  canonicalizeAppDocumentV1,
  type AppCreationTimeV1,
} from "flarex-protocol/app-document";
import {
  AppDocumentIdV1Error,
  AppDocumentIdV1Schema,
  AppRowIdHexV1Schema,
  appDocumentIdV1FromRowIdentity,
  appRowIdHexV1FromBytes,
  appRowIdHexV1ToBytes,
  decodeAppDocumentIdentityV1,
  requireAppDocumentIdentityV1ForTableResult,
  type AppDocumentIdV1,
  type AppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import {
  CatalogEdgeDefinitionIdSchema,
  CatalogIndexDefinitionIdSchema,
  CatalogIndexIdSchema,
  CatalogRelationIdSchema,
  CatalogTableIdSchema,
  type CatalogEdgeDefinitionId,
  type CatalogIndexId,
  type CatalogRelationId,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import {
  COMMIT_ENVELOPE_FORMAT_V1,
  AppDocumentFieldsJsonV1Schema,
  ApplicationActivationSequenceV1Schema,
  ApplicationActiveHeadSha256HexV1Schema,
  CommitDocumentSemanticBytesV1Schema,
  CommitFinalSyscallSequenceV1Schema,
  CommitMaterialWriteEventEvidenceBytesV1Schema,
  CommitReadDocumentsV1Schema,
  CommitReadSemanticBytesV1Schema,
  CommitSyscallSequenceV1Schema,
  LogicalAppWriteV1Schema,
  LogicalPatchFieldV1Schema,
  MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1,
  MAX_COMMIT_OPERATION_CALLS_V1,
  MAX_COMMIT_RECEIPT_EVIDENCE_BYTES_V1,
  MAX_COMMIT_FAILED_RECEIPT_EVIDENCE_BYTES_V1,
  MAX_COMMIT_PARTICIPANT_WORK_BYTES_V1,
  MAX_COMMIT_PARTICIPANT_WORK_CALLS_V1,
  MAX_COMMIT_INDEXED_QUERY_SYSCALLS_V1,
  MAX_COMMIT_INDEXED_QUERY_PAGE_SIZE_V1,
  MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1,
  MAX_COMMIT_INDEX_RANGE_DEPENDENCY_EVIDENCE_BYTES_V1,
  MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
  MAX_POINT_COMMIT_MATERIAL_ROWS_V1,
  MAX_COMMIT_READ_DOCUMENTS_V1,
  MAX_COMMIT_READ_SEMANTIC_BYTES_V1,
  MAX_COMMIT_WRITE_OPERATIONS_V1,
  MAX_COMMIT_WRITE_SEMANTIC_BYTES_V1,
  SESSION_JOURNAL_FORMAT,
  SessionJournalSchema,
  canonicalizeSessionJournalEffect,
  LogicalIndexRangeReadDependencyV1Schema,
  LogicalApplicationRelationIncomingReadDependencyV1Schema,
  MAX_COMMIT_RELATION_BASE_OCCURRENCES_V1,
  MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1,
  MAX_COMMIT_RELATION_READ_SYSCALLS_V1,
  normalizeLogicalIndexRangeReadDependenciesV1Result,
  verifySuccessfulResultEvidenceV1Effect,
  type ApplicationActivationSequenceV1,
  type CanonicalSessionJournal,
  type CanonicalSuccessfulResultV1,
  type CommitFinalSyscallSequenceV1,
  type CommitProtocolV1LimitDimension,
  type CommitSyscallSequenceV1,
  type LogicalAppWriteV1,
  type LogicalPatchFieldV1,
  type LogicalReadDependencyV1,
  type LogicalIndexRangeReadDependencyV1,
  type LogicalApplicationRelationIncomingReadDependencyV1,
  type SessionJournal,
  canonicalizeAdmittedParticipantBindingV1Result,
  canonicalizeAdmittedSourceBundleResult,
  AdmittedSourceBindingSchema,
  AdmittedParticipantWriteEventSchema,
  type AdmittedParticipantLogicalEffectV1,
  type AdmittedParticipantOperation,
  type SourceContribution,
  type StoredForSessionAttemptCommitEnvelopeV1,
} from "flarex-protocol/commit-protocol";
import { RELATION_INCOMING_PAGE_MAXIMUM_IDENTITIES_V1 } from
  "flarex-protocol/internal/application-schema-binding";
import type { PhysicalEdgeDefinitionV1 } from
  "flarex-protocol/internal/application-schema-binding";
import { MAX_RELATION_MANY_ITEMS_V1 } from
  "flarex-protocol/internal/relation-declaration-v1";
import {
  appIndexPhysicalSpecSha256HexV1FromBytes,
  appIndexPhysicalSpecSha256HexV1ToBytes,
} from "flarex-protocol/index-definition";
import {
  ORDERED_INDEX_KEY_CODEC_VERSION_V1,
  OrderedIndexBoundHexV1Schema,
  orderedIndexBoundHexV1ToBytes,
  orderedIndexBoundHexV1FromBytes,
  orderedIndexKeyBytesHexV1FromBytes,
  orderedIndexKeyBytesHexV1ToBytes,
  orderedIndexRowIdHexV1FromBytesResult,
  orderedIndexRowIdHexV1ToBytes,
  OrderedIndexKeyTooLargeError,
  type OrderedIndexBoundsV1,
  type OrderedIndexKeyBytesHexV1,
  type OrderedIndexRowIdHexV1,
} from "flarex-protocol/ordered-index";
import {
  encodeCanonicalJson,
  isJson,
  isJsonObject,
  jsonEqual,
  JsonValue,
  type Json,
  type JsonObject,
} from "flarex-protocol/json";
import type { GrantRetentionPolicyV1 } from "flarex-protocol/grant-retention-policy";
import {
  CatalogSchemaVersionIdSchema,
  MAX_SCHEMA_MANIFEST_APP_INDEXES_PER_TABLE,
  SchemaManifestAppIndexDescriptorSchema,
  SchemaManifestAppTableNameSchema,
  type CatalogSchemaVersionId,
  type SchemaManifestAppTableName,
} from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  SnapshotTokenSchema,
  decodeScopeEpochUuidV1,
  decodeScopeUuidV1,
  projectScopeEpochUuidV1,
  projectScopeIdUuidV1,
  replacementScopeEpochV1FromUuid,
  type CommitSeq,
  type ScopeId,
  type ScopeUuidV1,
  type SnapshotToken,
} from "flarex-protocol/storage-authority";
import {
  TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
  TransactionAttemptFenceSchema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionSessionIdV1Schema,
  type TransactionAttemptFence,
} from "flarex-protocol/transaction-session";
import {
  FLAREX_VALUE_CODEC_VERSION_V1,
  FlarexValueCodecV1Error,
  FlarexValueEvidenceV1Error,
  MAX_FLAREX_VALUE_OBJECT_FIELDS_V1,
  canonicalizeFlarexValueJsonV1,
  copyCanonicalFlarexValueBytesV1,
  copyFlarexValueSha256V1,
  decodeCanonicalFlarexValueEvidenceV1,
  isCanonicalFlarexRuntimeObjectV1,
  normalizeFlarexValueJsonV1,
  normalizeFlarexValueV1,
  type CanonicalFlarexRuntimeValueV1,
  type CanonicalFlarexValueBytesV1,
  type CanonicalFlarexValueV1,
  type FlarexValueSha256V1,
} from "flarex-protocol/value";

import {
  readIncomingAppRelationEdgePageInTransactionEffect,
  type AppRelationEdgeIncomingPageItem,
  type AppRelationEdgeReadError,
} from "./appRelationEdges";
import {
  ApplicationRelationReadOverlayError,
  ApplicationRelationReadUnavailableError,
  hasApplicationRelationReadPortAuthorityForPointCommit,
  mergeApplicationRelationIncomingPageResult,
  type ApplicationRelationIncomingReadItem,
  type ApplicationRelationReadCapability,
  type ApplicationRelationReadPort,
  type ResolvedApplicationRelationReadCapability,
  type ValidateApplicationRelationReadCapabilityError,
} from "./applicationRelationRead";
import type {
  ApplicationRelationRowTransition,
  PrepareApplicationRelationCommitError,
} from "./applicationRelationCommit";
import {
  getAppRowAtSnapshotInTransactionEffect,
  readLiveAppRowsAtSnapshotInTransactionEffect,
  type AppRowPointDependencyV1,
  type AppRowTransaction,
  type LiveAppRowRevisionV1,
  type ReadAppRowError,
} from "./appRows";
import {
  scanAppIndexAtSnapshotInTransactionEffect,
  type AppIndexRangeEntryV1,
  type ReadAppIndexRangeV1Error,
} from "./appIndexEntries";
import {
  hasAppDeveloperIndexDefinitionAuthorityForControlDbV1,
  lowerAppDeveloperIndexKeyV1,
  type AppDeveloperIndexDefinitionPortV1,
  type LocateAppDeveloperIndexDefinitionsV1Error,
} from "./appDeveloperIndexCommitV1";
import type { LocatedAppIndexDefinitionV1 } from "./appIndexDefinitions";
import type { FlarexMetadataDatabase } from "./deployments";
import { hasExactOwnDataKeys } from "./exactOwnDataKeys";
import {
  isIndexBuildSnapshotCoveredInTransactionEffect,
  readIndexCoverageContextInTransactionEffect,
  readFencedIndexBuildStateEffect,
  type ReadFencedIndexBuildStateError,
} from "./indexBuildStates";
import {
  validateApplicationRevisionSyscallDocumentInTransactionV1,
  type ApplicationRevisionSyscallValidatorV1,
  type ApplicationRevisionSyscallValidatorV1Error,
  type ValidateApplicationRevisionSyscallDocumentV1Input,
} from "./applicationRevisionSyscallValidatorV1";
import {
  PinnedDeveloperIndexCorruptionV1Error,
  PinnedDeveloperIndexNotFoundV1Error,
  PinnedDeveloperIndexPersistenceV1Error,
  PinnedPointTableCorruptionV1Error,
  PinnedPointTableNotFoundV1Error,
  PinnedPointTablePersistenceV1Error,
} from "./pinnedPointTableResolution";
import {
  resolveLocatedTrustedScopeAuthorityByIdEffect,
  TrustedScopeAuthorityPortError,
  type TrustedScopeAuthority,
} from "./scopeAuthorityResolution";
import { decodeScopeClockRecord } from "./scopeClock";
import { LogicalParticipantAdmissionError, LogicalParticipantInvocationError,
  inspectLogicalParticipantAttemptAdmission, hasLogicalParticipantAttemptAdmission,
  issueLogicalParticipantAdmissionBundle, inspectLogicalParticipantAdmissionBundle,
  requireLogicalParticipantAttemptAdmissionInTransactionEffect,
  type LogicalParticipantAttemptAdmission, type LogicalParticipantAttemptReadTransaction,
  type LogicalParticipantAdmissionBundle, type LogicalParticipantSelection } from "./logicalDocuments/participantAdmission";
import type { ApplicationBindingInput } from "./applicationActivation";
import type { FlarexMetadataTransaction } from "./metadataTransaction";
import type { ScopeClockRecord } from "./scopeClock";
import { withSharedLogicalSourceBindingChecks } from "./logicalDocuments/sourceAdmission";
import { projectLogicalDocumentJournalContribution, type LogicalJournalContributionError } from "./logicalDocuments/journalContribution";
import { serializeLogicalParticipantDependencyEvidence, type LogicalParticipantEvidenceError } from "./logicalDocuments/journalEvidence";
import type { LogicalDocumentChanges } from "./logicalDocuments/workingSet";
import type { LogicalDocumentBorrowView, LogicalPendingDocumentSeed } from "./logicalDocuments/model";
import { makeLogicalDocumentRootEvaluator, type LogicalDocumentRootEvaluator } from
  "./logicalDocuments/rootEvaluator";
import {
  encodeAdmittedFrameworkOperationV1Result,
  MAX_ADMITTED_FRAMEWORK_OPERATION_BYTES_V1,
  type AdmittedFrameworkOperationV1,
} from "flarex-protocol/internal/admitted-framework-operation-v1";
import {
  fxAppRowRevisions,
  fxSystemScopeClocks,
  fxSystemSnapshotLeases,
  fxSystemTransactionJournalReceipts,
  fxSystemTransactionJournalIndexRanges,
  fxSystemTransactionJournalRelationIncomingDependencies,
  fxSystemTransactionJournalPoints,
  fxSystemTransactionJournals,
  fxSystemTransactionJournalWriteEvents,
  fxSystemTransactionSessions,
} from "./schema";
import {
  projectSealedAttemptLeasePromotionV1Result,
  type SealedAttemptLeasePromotionIssueV1,
} from "./sealedAttemptLeasePromotion";
import {
  ExactRunningAttemptTransactionV1Error,
  RESOLVE_PINNED_DEVELOPER_INDEX_ID_EFFECT_V1,
  RESOLVE_PINNED_POINT_TABLE_ID_EFFECT_V1,
  RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1,
  RUN_LOCATED_REPEATABLE_READ_V1,
  isLocatedExactRunningAttemptKernelV1,
  type ExactRunningAttemptKernelContextV1,
  type LocatedExactRunningAttemptKernelV1,
} from "./transactionSessionAttemptKernel";
import {
  PointMutationSessionAuthorityCorruptionV1Error,
  PointMutationSessionAttemptLoadV1Error,
  type PointMutationExecutionProfile,
  type PointMutationSessionAttemptLoadIssueV1,
  type PointMutationSessionAttemptSelectorV1,
  type PointMutationSessionAuthorityResolutionPortsV1,
} from "./transactionSessionActivation";
import {
  RUN_EXACT_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT_V1,
  isLocatedExactRunningAttemptReadSyscallKernelV1,
} from "./transactionSessionReadSyscallKernel";
import {
  decodeTransactionExecutionClaimFenceV1,
  decodeTransactionExecutionClaimOwnerV1,
  type TransactionExecutionClaimPinV1,
} from "./transactionExecutionClaimModel";

const StrictStructOptions: {
  readonly parseOptions: { readonly onExcessProperty: "error" };
} = { parseOptions: { onExcessProperty: "error" } };

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TEXT_ENCODER = new TextEncoder();
type SessionJournalIncrementalLimitDimensionV1 = Extract<
  CommitProtocolV1LimitDimension,
  | "readDocuments"
  | "readSemanticBytes"
  | "pointReadDependencies"
  | "indexedQuerySyscalls"
  | "indexRangeReadDependencies"
  | "indexRangeDependencyEvidenceBytes"
  | "relationReadSyscalls"
  | "relationReadDependencies"
  | "relationBaseOccurrences"
  | "writeOperations"
  | "writeSemanticBytes"
  | "materialWriteEventEvidenceBytes"
  | "operationCalls"
  | "receiptEvidenceBytes"
>;
type SessionJournalIncrementalLimitIssueV1 = Omit<
  Extract<
    SessionJournalPersistedPointIssueV1,
    { readonly reason: "limitExceeded" }
  >,
  "reason"
>;

const SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1 = Object.freeze({
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

/**
 * Keep duplicate JSONB/canonical-byte materialization below the attempt-wide
 * read budget while retaining a small, fixed number of set-based reads.
 */
const INDEXED_QUERY_DOCUMENT_MATERIALIZATION_BATCH_SIZE_V1 = 8;

type IndexedQueryStagedPositionV1 =
  | Readonly<{
      readonly kind: "deleted";
      readonly rowId: OrderedIndexRowIdHexV1;
    }>
  | Readonly<{
      readonly kind: "live";
      readonly rowId: OrderedIndexRowIdHexV1;
      readonly encodedKey: OrderedIndexKeyBytesHexV1;
      readonly document: CanonicalFlarexValueV1;
    }>;

type IndexedQueryMergedPositionV1 =
  | Extract<IndexedQueryStagedPositionV1, { readonly kind: "live" }>
  | Readonly<{
      readonly kind: "snapshot";
      readonly rowId: OrderedIndexRowIdHexV1;
      readonly encodedKey: OrderedIndexKeyBytesHexV1;
      readonly entry: AppIndexRangeEntryV1;
    }>;

export type SessionJournalPointOperationKindV1 =
  | "get"
  | "insert"
  | "patch"
  | "replace"
  | "delete";

export interface SessionJournalIndexedQueryOperationV1 {
  readonly kind: "indexRange";
  readonly syscallSequence: CommitSyscallSequenceV1;
  readonly bounds: OrderedIndexBoundsV1;
  readonly limit: number;
}

export interface SessionJournalIndexedQuerySuccessV1 {
  readonly kind: "indexRangePage";
  readonly documents: ReadonlyArray<CanonicalFlarexRuntimeValueV1>;
  readonly isDone: boolean;
}

export interface SessionJournalRelationIncomingOperationV1 {
  readonly kind: "relationIncoming";
  readonly syscallSequence: CommitSyscallSequenceV1;
  readonly targetDocumentId: AppDocumentIdV1;
  readonly limit: number;
}

export interface SessionJournalRelationIncomingRequestEvidenceV1 {
  readonly format: "flarex.session-journal-syscall";
  readonly codecVersion: 2;
  readonly kind: "relationIncoming";
  readonly syscallSequence: CommitSyscallSequenceV1;
  readonly relationId: CatalogRelationId;
  readonly edgeDefinitionId: CatalogEdgeDefinitionId;
  readonly sourceTableId: CatalogTableId;
  readonly targetTableId: CatalogTableId;
  readonly targetRowId: AppRowIdHexV1;
  readonly limit: number;
}

export interface SessionJournalRelationIncomingSuccessV1 {
  readonly kind: "relationIncomingPage";
  readonly items: ReadonlyArray<ApplicationRelationIncomingReadItem>;
  readonly exhausted: boolean;
}

export interface SessionJournalRelationConflictV1 {
  readonly kind: "relationConflict";
  readonly edgeDefinitionId: CatalogEdgeDefinitionId;
  readonly targetRowId: AppRowIdHexV1;
  readonly expectedAdjacencyVersion: CommitSeq;
  readonly actualAdjacencyVersion: CommitSeq;
  readonly snapshotCommitSeq: CommitSeq;
}

export type SessionJournalPersistedPointIssueV1 =
  | Readonly<{
      readonly reason: "documentNotFound";
      readonly operation: "patch" | "replace" | "delete";
      readonly documentId: AppDocumentIdV1;
    }>
  | Readonly<{
      readonly reason: "documentIdCollision";
      readonly documentId: AppDocumentIdV1;
    }>
  | Readonly<{
      readonly reason: "invalidDocument";
      readonly operation: "insert" | "patch" | "replace";
    }>
  | Readonly<{
      readonly reason: "limitExceeded";
      readonly dimension: SessionJournalIncrementalLimitDimensionV1;
      readonly observed: number;
      readonly maximum: number;
    }>;

export type SessionJournalPointOperationV1 =
  | Readonly<{
      readonly kind: "get";
      readonly syscallSequence: CommitSyscallSequenceV1;
      readonly documentId: AppDocumentIdV1;
    }>
  | Readonly<{
      readonly kind: "insert";
      readonly syscallSequence: CommitSyscallSequenceV1;
      readonly fields: unknown;
    }>
  | Readonly<{
      readonly kind: "patch";
      readonly syscallSequence: CommitSyscallSequenceV1;
      readonly documentId: AppDocumentIdV1;
      readonly patch: unknown;
    }>
  | Readonly<{
      readonly kind: "replace";
      readonly syscallSequence: CommitSyscallSequenceV1;
      readonly documentId: AppDocumentIdV1;
      readonly fields: unknown;
    }>
  | Readonly<{
      readonly kind: "delete";
      readonly syscallSequence: CommitSyscallSequenceV1;
      readonly documentId: AppDocumentIdV1;
    }>;

export type SessionJournalPointSuccessV1 =
  | Readonly<{ readonly kind: "missing"; readonly document: null }>
  | Readonly<{
      readonly kind: "present";
      readonly document: CanonicalFlarexRuntimeValueV1;
    }>
  | Readonly<{
      readonly kind: "inserted";
      readonly documentId: AppDocumentIdV1;
      readonly document: CanonicalFlarexRuntimeValueV1;
    }>
  | Readonly<{
      readonly kind: "unit";
      readonly operation: "patch" | "replace" | "delete";
    }>;

export type SessionJournalSequenceIssueV1 =
  | Readonly<{
      readonly reason: "sequenceGap";
      readonly actual: CommitSyscallSequenceV1;
      readonly expectedNext: CommitSyscallSequenceV1;
    }>
  | Readonly<{
      readonly reason: "staleSequence";
      readonly actual: CommitSyscallSequenceV1;
      readonly lastAccepted: CommitFinalSyscallSequenceV1;
    }>
  | Readonly<{
      readonly reason: "requestMismatch";
      readonly syscallSequence: CommitSyscallSequenceV1;
    }>
  | Readonly<{
      readonly reason: "sequenceExhausted";
      readonly lastAccepted: CommitFinalSyscallSequenceV1;
    }>;

export type RunSessionJournalPointOperationV1Result =
  | Readonly<{
      readonly kind: "completed";
      readonly delivery: "executed" | "replayed";
      readonly outcome: SessionJournalPointSuccessV1;
    }>
  | Readonly<{
      readonly kind: "rejected";
      readonly delivery: "executed" | "replayed" | "sticky";
      readonly issue: SessionJournalPersistedPointIssueV1;
    }>
  | Readonly<{
      readonly kind: "sequenceRejected";
      readonly issue: SessionJournalSequenceIssueV1;
    }>
  | Readonly<{
      readonly kind: "stateRejected";
      readonly issue: Readonly<{
        readonly reason:
          | "journalSealed"
          | "journalFailed"
          | "journalRelationConflicted";
      }>;
    }>;

export type RunSessionJournalIndexedQueryV1Result =
  | Readonly<{
      readonly kind: "completed";
      readonly delivery: "executed" | "replayed";
      readonly outcome: SessionJournalIndexedQuerySuccessV1;
    }>
  | Readonly<{
      readonly kind: "rejected";
      readonly delivery: "executed" | "replayed" | "sticky";
      readonly issue: Extract<
        SessionJournalPersistedPointIssueV1,
        { readonly reason: "limitExceeded" }
      >;
    }>
  | Readonly<{
      readonly kind: "sequenceRejected";
      readonly issue: SessionJournalSequenceIssueV1;
    }>
  | Readonly<{
      readonly kind: "stateRejected";
      readonly issue: Readonly<{
        readonly reason:
          | "journalSealed"
          | "journalFailed"
          | "journalRelationConflicted";
      }>;
    }>;

export type RunSessionJournalRelationIncomingV1Result =
  | Readonly<{
      readonly kind: "completed";
      readonly delivery: "executed" | "replayed";
      readonly outcome: SessionJournalRelationIncomingSuccessV1;
    }>
  | Readonly<{
      readonly kind: "conflicted";
      readonly delivery: "executed" | "replayed";
      readonly request: Readonly<
        SessionJournalRelationIncomingRequestEvidenceV1
      >;
      readonly conflict: SessionJournalRelationConflictV1;
    }>
  | Readonly<{
      readonly kind: "rejected";
      readonly delivery: "executed" | "replayed" | "sticky";
      readonly issue: Extract<
        SessionJournalPersistedPointIssueV1,
        { readonly reason: "limitExceeded" }
      >;
    }>
  | Readonly<{
      readonly kind: "sequenceRejected";
      readonly issue: SessionJournalSequenceIssueV1;
    }>
  | Readonly<{
      readonly kind: "stateRejected";
      readonly issue: Readonly<{
        readonly reason:
          | "journalSealed"
          | "journalFailed"
          | "journalRelationConflicted";
      }>;
    }>;

const sessionJournalAttemptBrand: unique symbol = Symbol(
  "FlarexDB/SessionJournalAttempt",
);

/** Process-local proof that B2a supplied the exact attempt and schema pins. */
export interface SessionJournalAttempt {
  readonly [sessionJournalAttemptBrand]: true;
}

const pinnedPointTableBrand: unique symbol = Symbol(
  "FlarexDB/PinnedPointTableV1",
);

/** Opaque C03A table identity resolved only from the pinned schema artifact. */
export interface PinnedPointTableV1 {
  readonly [pinnedPointTableBrand]: true;
}

const pinnedDeveloperIndexBrand: unique symbol = Symbol(
  "FlarexDB/PinnedDeveloperIndexV1",
);

export interface PinnedDeveloperIndexV1 {
  readonly [pinnedDeveloperIndexBrand]: true;
}

const pinnedApplicationRelationReadBrand: unique symbol = Symbol(
  "FlarexDB/PinnedApplicationRelationRead",
);

export interface PinnedApplicationRelationRead {
  readonly [pinnedApplicationRelationReadBrand]: true;
}

const appDeveloperIndexQueryPortBrand: unique symbol = Symbol(
  "FlarexDB/AppDeveloperIndexQueryPortV1",
);

export interface AppDeveloperIndexQueryPortV1 {
  readonly [appDeveloperIndexQueryPortBrand]: true;
}

interface AppDeveloperIndexQueryPortStateV1 {
  readonly controlDb: FlarexMetadataDatabase;
  readonly authority: PointMutationSessionAuthorityResolutionPortsV1;
  readonly definitions: AppDeveloperIndexDefinitionPortV1;
}

const appDeveloperIndexQueryPortStatesV1 = new WeakMap<
  AppDeveloperIndexQueryPortV1,
  AppDeveloperIndexQueryPortStateV1
>();

export function createAppDeveloperIndexQueryPortV1(
  controlDb: FlarexMetadataDatabase,
  authority: PointMutationSessionAuthorityResolutionPortsV1,
  definitions: AppDeveloperIndexDefinitionPortV1,
): AppDeveloperIndexQueryPortV1 {
  const port = Object.freeze({
    [appDeveloperIndexQueryPortBrand]: true as const,
  });
  if (hasAppDeveloperIndexDefinitionAuthorityForControlDbV1(
    definitions,
    controlDb,
  )) {
    appDeveloperIndexQueryPortStatesV1.set(port, Object.freeze({
      controlDb,
      authority,
      definitions,
    }));
  }
  return port;
}

const preparedSessionJournalSealBrand: unique symbol = Symbol(
  "FlarexDB/PreparedSessionJournalSealV1",
);

export interface PreparedSessionJournalSealV1 {
  readonly [preparedSessionJournalSealBrand]: true;
}

export interface OpenSessionJournalAttemptInput {
  readonly selector: PointMutationSessionAttemptSelectorV1;
  readonly snapshotToken: SnapshotToken;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly executionClaim: TransactionExecutionClaimPinV1;
  readonly executionProfile?: PointMutationExecutionProfile;
}

export interface PreparedSessionJournalSealResultV1 {
  readonly preparation: PreparedSessionJournalSealV1;
  readonly journal: SessionJournal;
}

export interface LogicalBorrowedParticipantOperation {
  readonly invoke: (method: string, args: Json) => Effect.Effect<AdmittedCompletion, LogicalParticipantInvocationError>;
  readonly abort: Effect.Effect<void>;
  readonly currentUsage: () => Readonly<{ workBytes: number; workCalls: number }>;
}
type LogicalParticipantBorrowBase = Readonly<{
  attempt: SessionJournalAttempt;
  admissions: readonly LogicalParticipantAttemptAdmission[];
  bundle: LogicalParticipantAdmissionBundle;
  method: string;
}>;
export type LogicalParticipantBorrow = (input: LogicalParticipantBorrowBase &
  LogicalDocumentBorrowView) => Effect.Effect<LogicalBorrowedParticipantOperation,
    LogicalParticipantInvocationError>;

export interface SessionJournalStorePersistence {
  readonly openAttemptEffect: (
    input: OpenSessionJournalAttemptInput,
  ) => Effect.Effect<
    SessionJournalAttempt,
    | InvalidSessionJournalInputV1Error
    | SessionJournalAttemptUnavailableV1Error
    | SessionJournalPersistenceV1Error
    | SessionJournalStorageCorruptionV1Error
    | SessionJournalTargetUnavailableV1Error
  >;
  /** The journal owner binds a finite, ordered source set to one exact attempt. */
  readonly admitLogicalParticipantsEffect: (
    attempt: SessionJournalAttempt,
    input: Readonly<{
      participant: string;
      operationMethods: readonly string[];
      profileRevision: string;
      sources: readonly Readonly<{ selection: LogicalParticipantSelection;
        application: ApplicationBindingInput; methods: readonly string[] }>[];
    }>,
  ) => Effect.Effect<
    LogicalParticipantAdmissionBundle,
    InvalidSessionJournalCapabilityV1Error |
      SessionJournalPersistenceV1Error |
      SessionJournalTargetUnavailableV1Error |
      LogicalParticipantAdmissionError
  >;
  readonly runAdmittedOperationEffect: (
    attempt: SessionJournalAttempt,
    admission: LogicalParticipantAdmissionBundle,
    input: Readonly<{
      syscallSequence: CommitSyscallSequenceV1;
      requestBytes: Uint8Array;
      requestSha256: Uint8Array;
      participant: string;
      method: string;
      profileRevision: string;
    }>,
    borrow: LogicalParticipantBorrow,
  ) => Effect.Effect<
    Readonly<{ kind: "completed"; delivery: "executed" | "replayed"; result: Json }> |
      Readonly<{ kind: "sequenceRejected"; issue: SessionJournalSequenceIssueV1 }> |
      Readonly<{ kind: "stateRejected"; issue: Readonly<{ reason: "journalSealed" | "journalFailed" | "journalRelationConflicted" | "operationPending" }> }>,
    InvalidSessionJournalCapabilityV1Error | SessionJournalPersistenceV1Error |
      SessionJournalAttemptUnavailableV1Error | SessionJournalStorageCorruptionV1Error |
      SessionJournalTargetUnavailableV1Error |
      LogicalParticipantAdmissionError | LogicalJournalContributionError |
      LogicalParticipantEvidenceError | LogicalParticipantInvocationError
  >;
  readonly resolvePointTableEffect: (
    attempt: SessionJournalAttempt,
    tableName: unknown,
  ) => Effect.Effect<
    PinnedPointTableV1,
    SessionJournalResolvePointTableV1Error
  >;
  readonly runPointOperationEffect: (
    table: PinnedPointTableV1,
    operation: SessionJournalPointOperationV1,
    validator: ApplicationRevisionSyscallValidatorV1,
  ) => Effect.Effect<
    RunSessionJournalPointOperationV1Result,
    SessionJournalRunPointOperationV1Error
  >;
  readonly resolveDeveloperIndexEffect: (
    table: PinnedPointTableV1,
    indexDescriptor: unknown,
  ) => Effect.Effect<
    PinnedDeveloperIndexV1,
    SessionJournalResolveDeveloperIndexV1Error
  >;
  readonly runIndexedQueryEffect: (
    index: PinnedDeveloperIndexV1,
    operation: SessionJournalIndexedQueryOperationV1,
  ) => Effect.Effect<
    RunSessionJournalIndexedQueryV1Result,
    SessionJournalRunIndexedQueryV1Error
  >;
  readonly resolveApplicationRelationReadEffect: (
    attempt: SessionJournalAttempt,
    capability: ApplicationRelationReadCapability,
  ) => Effect.Effect<
    PinnedApplicationRelationRead,
    SessionJournalResolveApplicationRelationReadError
  >;
  readonly runApplicationRelationIncomingReadEffect: (
    relation: PinnedApplicationRelationRead,
    operation: SessionJournalRelationIncomingOperationV1,
  ) => Effect.Effect<
    RunSessionJournalRelationIncomingV1Result,
    SessionJournalRunApplicationRelationReadError
  >;
  readonly prepareSealEffect: (
    attempt: SessionJournalAttempt,
  ) => Effect.Effect<
    PreparedSessionJournalSealResultV1,
    SessionJournalPrepareSealV1Error
  >;
  readonly completeSealEffect: (
    preparation: PreparedSessionJournalSealV1,
    journal: CanonicalSessionJournal,
    successfulResult: CanonicalSuccessfulResultV1,
  ) => Effect.Effect<
    StoredForSessionAttemptCommitEnvelopeV1,
    SessionJournalCompleteSealV1Error
  >;
  /** Finite roots publish every tentative child in one authoritative seal. */
  readonly sealFiniteRootEffect: (
    attempt: SessionJournalAttempt,
    successfulResult: CanonicalSuccessfulResultV1,
  ) => Effect.Effect<
    Readonly<{ envelope: StoredForSessionAttemptCommitEnvelopeV1;
      journalByteLength: number }>,
    SessionJournalCompleteSealV1Error
  >;
  /** Drop only local tentative evidence; durable terminalization stays with
   * the outer session owner and this fence remains a busy tombstone. */
  readonly discardFiniteRootEffect: (
    attempt: SessionJournalAttempt,
  ) => Effect.Effect<void, InvalidSessionJournalCapabilityV1Error>;
}

export interface SessionJournalStorePersistenceOptionsV1 {
  /** Trusted deployment configuration; never derived from request evidence. */
  readonly grantRetentionPolicy: GrantRetentionPolicyV1;
  /** Construction-bound server randomness; exposed only for deterministic tests. */
  readonly randomUuid?: () => string;
  readonly indexedQueries?: AppDeveloperIndexQueryPortV1;
  readonly applicationRelations?: ApplicationRelationReadPort;
  /** Package-internal deterministic fault seam used by the persistence proof. */
  readonly faultAfter?: (
    point:
      | "indexedQueryEvidenceWritten"
      | "relationReadEvidenceWritten"
      | "relationConflictEvidenceWritten",
  ) => void | Promise<void>;
}

export class InvalidSessionJournalCapabilityV1Error extends Data.TaggedError(
  "InvalidSessionJournalCapabilityV1Error",
)<{
  readonly capability:
    | "attempt"
    | "pointTable"
    | "developerIndex"
    | "applicationRelation"
    | "sealPreparation";
}> {}

export class InvalidSessionJournalInputV1Error extends Data.TaggedError(
  "InvalidSessionJournalInputV1Error",
)<{
  readonly operation:
    | SessionJournalPointOperationKindV1
    | "indexRange"
    | "relationIncoming"
    | "openAttempt"
    | "resolvePointTable"
    | "resolveDeveloperIndex"
    | "resolveApplicationRelation";
  readonly reason:
    | "invalidAttemptPins"
    | "invalidTableName"
    | "invalidIndexDescriptor"
    | "invalidOperation";
  readonly cause?: unknown;
}> {}

export class SessionJournalTargetUnavailableV1Error extends Data.TaggedError(
  "SessionJournalTargetUnavailableV1Error",
)<{
  readonly scopeId: ScopeId;
}> {}

export class SessionJournalAttemptUnavailableV1Error extends Data.TaggedError(
  "SessionJournalAttemptUnavailableV1Error",
)<{
  readonly issue: PointMutationSessionAttemptLoadIssueV1;
}> {}

export class SessionJournalPersistenceV1Error extends Data.TaggedError(
  "SessionJournalPersistenceV1Error",
)<{
  readonly operation:
    | "canonicalizeRequest"
    | "completeSealTransaction"
    | "hashSealJournal"
    | "openAttempt"
    | "prepareSealSnapshot"
    | "resolveJournalTarget"
    | "admitLogicalParticipant"
    | "runAdmittedOperation"
    | "resolvePinnedPointTable"
    | "resolveDeveloperIndex"
    | "resolveApplicationRelation"
    | "runPointOperation"
    | "runIndexedQuery"
    | "runApplicationRelationRead";
  readonly cause: unknown;
}> {}

export type SessionJournalResolvePointTableV1Error =
  | InvalidSessionJournalCapabilityV1Error
  | InvalidSessionJournalInputV1Error
  | SessionJournalAttemptUnavailableV1Error
  | PinnedPointTableCorruptionV1Error
  | PinnedPointTableNotFoundV1Error
  | SessionJournalPersistenceV1Error
  | SessionJournalStorageCorruptionV1Error
  | SessionJournalTargetUnavailableV1Error;

export type SessionJournalRunPointOperationV1Error =
  | ApplicationTableWriteDeniedError
  | InvalidSessionJournalCapabilityV1Error
  | InvalidSessionJournalInputV1Error
  | SessionJournalAttemptUnavailableV1Error
  | SessionJournalIdentityGenerationV1Error
  | SessionJournalPersistenceV1Error
  | SessionJournalStorageCorruptionV1Error
  | SessionJournalTargetUnavailableV1Error
  | ApplicationRevisionSyscallValidatorV1Error;

export class SessionJournalDeveloperIndexUnavailableV1Error
  extends Data.TaggedError("SessionJournalDeveloperIndexUnavailableV1Error")<{
    readonly reason:
      | "invalidComposition"
      | "definitionNotFound"
      | "definitionMismatch"
      | "buildNotEnabled";
  }> {}

export type SessionJournalResolveDeveloperIndexV1Error =
  | InvalidSessionJournalCapabilityV1Error
  | InvalidSessionJournalInputV1Error
  | SessionJournalDeveloperIndexUnavailableV1Error
  | SessionJournalPersistenceV1Error
  | SessionJournalTargetUnavailableV1Error
  | LocateAppDeveloperIndexDefinitionsV1Error;

export type SessionJournalRunIndexedQueryV1Error =
  | InvalidSessionJournalCapabilityV1Error
  | InvalidSessionJournalInputV1Error
  | SessionJournalAttemptUnavailableV1Error
  | SessionJournalDeveloperIndexUnavailableV1Error
  | SessionJournalPersistenceV1Error
  | SessionJournalStorageCorruptionV1Error
  | SessionJournalTargetUnavailableV1Error
  | ReadFencedIndexBuildStateError
  | ReadAppIndexRangeV1Error
  | ReadAppRowError
  | OrderedIndexKeyTooLargeError
  | ExactDecimalError;

export type SessionJournalResolveApplicationRelationReadError =
  | InvalidSessionJournalCapabilityV1Error
  | InvalidSessionJournalInputV1Error
  | SessionJournalAttemptUnavailableV1Error
  | SessionJournalPersistenceV1Error
  | SessionJournalStorageCorruptionV1Error
  | SessionJournalTargetUnavailableV1Error
  | ApplicationRelationReadUnavailableError;

export type SessionJournalRunApplicationRelationReadError =
  | InvalidSessionJournalCapabilityV1Error
  | InvalidSessionJournalInputV1Error
  | SessionJournalAttemptUnavailableV1Error
  | SessionJournalPersistenceV1Error
  | SessionJournalStorageCorruptionV1Error
  | SessionJournalTargetUnavailableV1Error
  | ValidateApplicationRelationReadCapabilityError
  | ApplicationRelationReadOverlayError
  | PrepareApplicationRelationCommitError
  | AppRelationEdgeReadError
  | ReadAppRowError;

export type SessionJournalPrepareSealV1Error =
  | InvalidSessionJournalCapabilityV1Error
  | SessionJournalAttemptUnavailableV1Error
  | SessionJournalPersistenceV1Error
  | SessionJournalSealV1Error
  | SessionJournalStorageCorruptionV1Error
  | SessionJournalTargetUnavailableV1Error;

export type SessionJournalCompleteSealV1Error =
  | InvalidSessionJournalCapabilityV1Error
  | SessionJournalAttemptUnavailableV1Error
  | SessionJournalLeasePromotionV1Error
  | SessionJournalPersistenceV1Error
  | SessionJournalSealV1Error
  | SessionJournalStorageCorruptionV1Error
  | SessionJournalTargetUnavailableV1Error;

type SessionJournalStorageCorruptionReasonV1 =
  | "databaseClockInvalid"
  | "exactAttemptPinsChanged"
  | "executionClaimInvalid"
  | "failedJournalEvidenceInvalid"
  | "failedJournalReceiptInvalid"
  | "journalCountersInvalid"
  | "journalReceiptStateMismatch"
  | "journalRootMissingOrDuplicate"
  | "journalRootOperationUpdateMismatch"
  | "journalStateInvalid"
  | "latestReceiptEvidenceInvalid"
  | "latestReceiptMissing"
  | "latestReceiptRequestDigestMismatch"
  | "latestReceiptSequenceMismatch"
  | "liveOverlayEvidenceMissing"
  | "liveOverlaySemanticBytesMismatch"
  | "logicalWriteEventInvalid"
  | "materialWriteEventEvidenceBytesMismatch"
  | "missingDependencyUnexpectedRevision"
  | "pointDependencyChangedAtSnapshot"
  | "pointDependencyCountMismatch"
  | "indexRangeDependencyCountMismatch"
  | "indexRangeDependencyEvidenceBytesMismatch"
  | "indexRangeDependencyInvalid"
  | "indexedSnapshotPositionMismatch"
  | "presentDependencyRevisionMissing"
  | "relationAdjacencyVersionInvalid"
  | "relationDependencyCountMismatch"
  | "relationDependencyInvalid"
  | "relationPageFrontierInvalid"
  | "requestTableCapabilityMismatch"
  | "indexMaintenanceInvalid"
  | "scopeClockMissingOrDuplicate"
  | "sealedJournalStateInvalid"
  | "sessionRecordInvalid"
  | "snapshotLeaseInvalid"
  | "tombstoneDependencyRevisionMissing"
  | "writeOperationCountMismatch"
  | "writeSemanticBytesMismatch"
  | "writeSequenceBeyondJournalFinalSequence"
  | "zeroSequenceHasReceipt";

export class SessionJournalStorageCorruptionV1Error extends Data.TaggedError(
  "SessionJournalStorageCorruptionV1Error",
)<{
  readonly scopeId: ScopeId;
  readonly reason: SessionJournalStorageCorruptionReasonV1;
  readonly cause?: unknown;
}> {}

export class SessionJournalIdentityGenerationV1Error extends Data.TaggedError(
  "SessionJournalIdentityGenerationV1Error",
)<{
  readonly generatedValue: unknown;
}> {}

export type SessionJournalLeasePromotionV1Issue =
  | Readonly<{
      readonly kind: "retentionPolicyInvalid";
      readonly maximumLiveSnapshotRetentionMilliseconds: number;
    }>
  | Readonly<{
      readonly kind: "retentionBudgetExceeded";
      readonly remainingMilliseconds: number;
      readonly maximumLiveSnapshotRetentionMilliseconds: number;
    }>;

export class SessionJournalLeasePromotionV1Error extends Data.TaggedError(
  "SessionJournalLeasePromotionV1Error",
)<{
  readonly issue: SessionJournalLeasePromotionV1Issue;
}> {}

export class SessionJournalSealV1Error extends Data.TaggedError(
  "SessionJournalSealV1Error",
)<{
  readonly reason:
    | "journalFailed"
    | "journalRelationConflicted"
    | "stalePreparation"
    | "canonicalJournalMismatch"
    | "canonicalResultMismatch"
    | "sealedEvidenceMismatch";
  readonly cause?: unknown;
}> {}

export {
  PinnedPointTableCorruptionV1Error,
  PinnedPointTableNotFoundV1Error,
};

interface SessionJournalAttemptStateV1 {
  readonly selector: PointMutationSessionAttemptSelectorV1;
  readonly snapshotToken: SnapshotToken;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly executionClaim: TransactionExecutionClaimPinV1;
  readonly executionProfile: PointMutationExecutionProfile;
}

interface PinnedPointTableStateV1 {
  readonly attempt: SessionJournalAttemptStateV1;
  readonly tableName: SchemaManifestAppTableName;
  readonly tableId: CatalogTableId;
}

interface PinnedDeveloperIndexStateV1 {
  readonly attempt: SessionJournalAttemptStateV1;
  readonly tableId: CatalogTableId;
  readonly logicalIndexId: CatalogIndexId;
  readonly definition: LocatedAppIndexDefinitionV1;
}

interface PinnedApplicationRelationReadState {
  readonly attempt: SessionJournalAttemptStateV1;
  readonly capability: ApplicationRelationReadCapability;
  readonly resolved: ResolvedApplicationRelationReadCapability;
}

interface PreparedSessionJournalSealStateV1 {
  readonly attempt: SessionJournalAttemptStateV1;
  readonly candidate: SessionJournalSealCandidateV1;
}

const SessionJournalGetRequestV1Schema = Schema.Struct({
  format: Schema.Literal("flarex.session-journal-syscall"),
  codecVersion: Schema.Literal(2),
  kind: Schema.Literal("get"),
  syscallSequence: CommitSyscallSequenceV1Schema,
  tableId: CatalogTableIdSchema,
  documentId: AppDocumentIdV1Schema,
}).annotate(StrictStructOptions);

const SessionJournalInsertRequestV1Schema = Schema.Struct({
  format: Schema.Literal("flarex.session-journal-syscall"),
  codecVersion: Schema.Literal(2),
  kind: Schema.Literal("insert"),
  syscallSequence: CommitSyscallSequenceV1Schema,
  tableId: CatalogTableIdSchema,
  fieldsValueJson: AppDocumentFieldsJsonV1Schema,
}).annotate(StrictStructOptions);

const SessionJournalPatchRequestV1Schema = Schema.Struct({
  format: Schema.Literal("flarex.session-journal-syscall"),
  codecVersion: Schema.Literal(2),
  kind: Schema.Literal("patch"),
  syscallSequence: CommitSyscallSequenceV1Schema,
  tableId: CatalogTableIdSchema,
  documentId: AppDocumentIdV1Schema,
  changes: Schema.Array(LogicalPatchFieldV1Schema),
}).annotate(StrictStructOptions);

const SessionJournalReplaceRequestV1Schema = Schema.Struct({
  format: Schema.Literal("flarex.session-journal-syscall"),
  codecVersion: Schema.Literal(2),
  kind: Schema.Literal("replace"),
  syscallSequence: CommitSyscallSequenceV1Schema,
  tableId: CatalogTableIdSchema,
  documentId: AppDocumentIdV1Schema,
  fieldsValueJson: AppDocumentFieldsJsonV1Schema,
}).annotate(StrictStructOptions);

const SessionJournalDeleteRequestV1Schema = Schema.Struct({
  format: Schema.Literal("flarex.session-journal-syscall"),
  codecVersion: Schema.Literal(2),
  kind: Schema.Literal("delete"),
  syscallSequence: CommitSyscallSequenceV1Schema,
  tableId: CatalogTableIdSchema,
  documentId: AppDocumentIdV1Schema,
}).annotate(StrictStructOptions);

const SessionJournalIndexRangeRequestV1Schema = Schema.Struct({
  format: Schema.Literal("flarex.session-journal-syscall"),
  codecVersion: Schema.Literal(2),
  kind: Schema.Literal("indexRange"),
  syscallSequence: CommitSyscallSequenceV1Schema,
  tableId: CatalogTableIdSchema,
  logicalIndexId: CatalogIndexIdSchema,
  indexDefinitionId: CatalogIndexDefinitionIdSchema,
  startInclusive: Schema.NullOr(OrderedIndexBoundHexV1Schema),
  endExclusive: Schema.NullOr(OrderedIndexBoundHexV1Schema),
  limit: Schema.Int,
}).annotate(StrictStructOptions);

const SessionJournalRelationIncomingRequestV1Schema = Schema.Struct({
  format: Schema.Literal("flarex.session-journal-syscall"),
  codecVersion: Schema.Literal(2),
  kind: Schema.Literal("relationIncoming"),
  syscallSequence: CommitSyscallSequenceV1Schema,
  relationId: CatalogRelationIdSchema,
  edgeDefinitionId: CatalogEdgeDefinitionIdSchema,
  sourceTableId: CatalogTableIdSchema,
  targetTableId: CatalogTableIdSchema,
  targetRowId: AppRowIdHexV1Schema,
  limit: Schema.Int,
}).annotate(StrictStructOptions);

const SessionJournalAdmittedLogicalRequestSchema = Schema.Struct({
  format: Schema.Literal("flarex.session-journal-syscall"),
  codecVersion: Schema.Literal(2),
  kind: Schema.Literal("admittedLogicalOperation"),
  syscallSequence: CommitSyscallSequenceV1Schema,
  participant: Schema.NonEmptyString,
  method: Schema.NonEmptyString,
  profileRevision: Schema.String,
  sources: Schema.Array(AdmittedSourceBindingSchema).check(Schema.isMaxLength(3)),
  admissionBundleSha256Hex: Schema.String,
  requestSha256Hex: Schema.String,
  frame: JsonValue,
}).annotate(StrictStructOptions);

const SessionJournalStoredRequestSchema = Schema.Union([
  SessionJournalGetRequestV1Schema,
  SessionJournalInsertRequestV1Schema,
  SessionJournalPatchRequestV1Schema,
  SessionJournalReplaceRequestV1Schema,
  SessionJournalDeleteRequestV1Schema,
  SessionJournalIndexRangeRequestV1Schema,
  SessionJournalRelationIncomingRequestV1Schema,
  SessionJournalAdmittedLogicalRequestSchema,
]);
type SessionJournalStoredRequest =
  typeof SessionJournalStoredRequestSchema.Type;
type SessionJournalStoredPointRequest = Exclude<
  SessionJournalStoredRequest,
  { readonly kind: "indexRange" | "relationIncoming" | "admittedLogicalOperation" }
>;

const SessionJournalMissingOutcomeV1Schema = Schema.Struct({
  kind: Schema.Literal("missing"),
}).annotate(StrictStructOptions);
const SessionJournalPresentOutcomeV1Schema = Schema.Struct({
  kind: Schema.Literal("present"),
  documentValueJson: JsonValue,
}).annotate(StrictStructOptions);
const SessionJournalInsertedOutcomeV1Schema = Schema.Struct({
  kind: Schema.Literal("inserted"),
  documentId: AppDocumentIdV1Schema,
  documentValueJson: JsonValue,
}).annotate(StrictStructOptions);
const SessionJournalUnitOutcomeV1Schema = Schema.Struct({
  kind: Schema.Literal("unit"),
  operation: Schema.Union([
    Schema.Literal("patch"),
    Schema.Literal("replace"),
    Schema.Literal("delete"),
  ]),
}).annotate(StrictStructOptions);
const SessionJournalIndexRangePageOutcomeV1Schema = Schema.Struct({
  kind: Schema.Literal("indexRangePage"),
  documentsValueJson: Schema.Array(JsonValue),
  isDone: Schema.Boolean,
}).annotate(StrictStructOptions);
const SessionJournalRelationIncomingPageOutcomeV1Schema = Schema.Struct({
  kind: Schema.Literal("relationIncomingPage"),
  items: Schema.Array(Schema.Struct({
    sourceDocumentId: AppDocumentIdV1Schema,
    duplicateOrdinal: Schema.Literal(0),
    position: Schema.NullOr(Schema.Int.check(Schema.isBetween({
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
    }))),
  }).annotate(StrictStructOptions)),
  exhausted: Schema.Boolean,
}).annotate(StrictStructOptions);
const SessionJournalRelationConflictOutcomeV1Schema = Schema.Struct({
  kind: Schema.Literal("relationConflict"),
  edgeDefinitionId: CatalogEdgeDefinitionIdSchema,
  targetRowId: AppRowIdHexV1Schema,
  expectedAdjacencyVersion: CommitSeqSchema,
  actualAdjacencyVersion: CommitSeqSchema,
  snapshotCommitSeq: CommitSeqSchema,
}).annotate(StrictStructOptions);
const SessionJournalAdmittedLogicalResultSchema = Schema.Struct({
  kind: Schema.Literal("admittedLogicalResult"),
  result: JsonValue,
  events: Schema.Array(Schema.Struct({ sourceKey: Schema.NullOr(Schema.NonEmptyString),
    intent: JsonValue }).annotate(StrictStructOptions)),
  sourceDependencies: Schema.Array(Schema.Struct({ sourceKey: Schema.NonEmptyString,
    evidence: Schema.Record(Schema.String, JsonValue) }).annotate(StrictStructOptions)),
  workBytes: Schema.Int,
  workCalls: Schema.Int,
}).annotate(StrictStructOptions);
const SessionJournalAdmittedLogicalErrorSchema = Schema.Struct({
  kind: Schema.Literal("admittedLogicalError"),
  reason: Schema.NonEmptyString,
  workBytes: Schema.Int,
  workCalls: Schema.Int,
}).annotate(StrictStructOptions);
const SessionJournalAdmittedLogicalInvokingSchema = Schema.Struct({
  kind: Schema.Literal("admittedLogicalInvoking"),
}).annotate(StrictStructOptions);
const SessionJournalNotFoundOutcomeV1Schema = Schema.Struct({
  kind: Schema.Literal("error"),
  reason: Schema.Literal("documentNotFound"),
  operation: Schema.Union([
    Schema.Literal("patch"),
    Schema.Literal("replace"),
    Schema.Literal("delete"),
  ]),
  documentId: AppDocumentIdV1Schema,
}).annotate(StrictStructOptions);
const SessionJournalCollisionOutcomeV1Schema = Schema.Struct({
  kind: Schema.Literal("error"),
  reason: Schema.Literal("documentIdCollision"),
  documentId: AppDocumentIdV1Schema,
}).annotate(StrictStructOptions);
const SessionJournalInvalidDocumentOutcomeV1Schema = Schema.Struct({
  kind: Schema.Literal("error"),
  reason: Schema.Literal("invalidDocument"),
  operation: Schema.Union([
    Schema.Literal("insert"),
    Schema.Literal("patch"),
    Schema.Literal("replace"),
  ]),
}).annotate(StrictStructOptions);
const SessionJournalLimitOutcomeV1Schema = Schema.Struct({
  kind: Schema.Literal("error"),
  reason: Schema.Literal("limitExceeded"),
  dimension: Schema.Union([
    Schema.Literal("readDocuments"),
    Schema.Literal("readSemanticBytes"),
    Schema.Literal("pointReadDependencies"),
    Schema.Literal("writeOperations"),
    Schema.Literal("writeSemanticBytes"),
    Schema.Literal("materialWriteEventEvidenceBytes"),
    Schema.Literal("operationCalls"),
    Schema.Literal("receiptEvidenceBytes"),
    Schema.Literal("indexedQuerySyscalls"),
    Schema.Literal("indexRangeReadDependencies"),
    Schema.Literal("indexRangeDependencyEvidenceBytes"),
    Schema.Literal("relationReadSyscalls"),
    Schema.Literal("relationReadDependencies"),
    Schema.Literal("relationBaseOccurrences"),
  ]),
  observed: Schema.Int,
  maximum: Schema.Int,
}).annotate(StrictStructOptions);

const SessionJournalStoredOutcomeSchema = Schema.Union([
  SessionJournalMissingOutcomeV1Schema,
  SessionJournalPresentOutcomeV1Schema,
  SessionJournalInsertedOutcomeV1Schema,
  SessionJournalUnitOutcomeV1Schema,
  SessionJournalIndexRangePageOutcomeV1Schema,
  SessionJournalRelationIncomingPageOutcomeV1Schema,
  SessionJournalRelationConflictOutcomeV1Schema,
  SessionJournalAdmittedLogicalResultSchema,
  SessionJournalAdmittedLogicalErrorSchema,
  SessionJournalAdmittedLogicalInvokingSchema,
  SessionJournalNotFoundOutcomeV1Schema,
  SessionJournalCollisionOutcomeV1Schema,
  SessionJournalInvalidDocumentOutcomeV1Schema,
  SessionJournalLimitOutcomeV1Schema,
]);
type SessionJournalStoredOutcome =
  typeof SessionJournalStoredOutcomeSchema.Type;

/** Tentative child evidence for one fenced, effect-free root. A child result is
 * never an independently durable acknowledgement in this profile. */
interface FiniteRootAdmittedRecord {
  readonly kind: "admitted";
  /** Issuer-owned capability stays local and is never cloned or serialized. */
  readonly admission: LogicalParticipantAdmissionBundle;
  readonly request: Extract<SessionJournalStoredRequest, {
    readonly kind: "admittedLogicalOperation";
  }>;
  readonly requestEvidence: CanonicalFlarexValueV1;
  readonly bindingDigest: Uint8Array;
  readonly completed: AdmittedCompletion;
  readonly contribution: Effect.Success<ReturnType<
    typeof projectLogicalDocumentJournalContribution
  >>;
  readonly sources: readonly SourceContribution[];
  readonly outcome: Extract<SessionJournalStoredOutcome, {
    readonly kind: "admittedLogicalResult";
  }>;
  readonly outcomeEvidence: CanonicalFlarexValueV1;
  readonly pointMutations: readonly JournalPointMutationV1[];
  readonly events: readonly Readonly<{
    effectOrdinal: number;
    bytes: Uint8Array;
    sha256: Uint8Array;
  }>[];
}

interface FiniteRootPointRecord {
  readonly kind: "point";
  readonly request: SessionJournalStoredPointRequest;
  readonly requestEvidence: CanonicalFlarexValueV1;
  readonly outcome: SessionJournalStoredOutcome;
  readonly outcomeEvidence: CanonicalFlarexValueV1;
  readonly plan: SessionJournalOperationPlanV1;
  readonly writeEvent?: PreparedLogicalWriteEventV1;
}

interface FiniteRootIndexRecord {
  readonly kind: "index";
  readonly request: Extract<SessionJournalStoredRequest, { readonly kind: "indexRange" }>;
  readonly requestEvidence: CanonicalFlarexValueV1;
  readonly outcome: SessionJournalStoredOutcome;
  readonly outcomeEvidence: CanonicalFlarexValueV1;
}

interface FiniteRootRelationRecord {
  readonly kind: "relation";
  readonly request: Extract<SessionJournalStoredRequest, { readonly kind: "relationIncoming" }>;
  readonly requestEvidence: CanonicalFlarexValueV1;
  readonly outcome: SessionJournalStoredOutcome;
  readonly outcomeEvidence: CanonicalFlarexValueV1;
}

type FiniteRootRecord = FiniteRootAdmittedRecord | FiniteRootPointRecord |
  FiniteRootIndexRecord | FiniteRootRelationRecord;

interface FiniteRootAttemptState {
  readonly evaluator: LogicalDocumentRootEvaluator;
  readonly entries: Map<bigint, FiniteRootRecord>;
  readonly points: Map<string, JournalPointMutationV1>;
  readonly pointReads: Map<string, LogicalPointReadV1>;
  indexRanges: LogicalIndexRangeReadDependencyV1[];
  relationDependencies: LogicalApplicationRelationIncomingReadDependencyV1[];
  status: "open" | "aborted" | "sealing" | "sealed";
  lastSequence: bigint;
  nextCreationTime?: AppCreationTimeV1;
  counters: SessionJournalCountersV1;
  participantWorkBytes: number;
  participantWorkCalls: number;
}

/** Keep an inert exact-claim tombstone after abort or uncertain seal while
 * releasing provisional documents and receipts. Only a durable terminal or
 * fenced observation permits removing its strong registry entry. */
function discardFiniteRootEvidence(finite: FiniteRootAttemptState): void {
  finite.evaluator.close();
  finite.entries.clear();
  finite.points.clear();
  finite.pointReads.clear();
  finite.indexRanges.length = 0;
  finite.relationDependencies.length = 0;
}

const encodeStoredRequest = Schema.encodeSync(
  SessionJournalStoredRequestSchema,
);
const decodeStoredRequestResult = Schema.decodeUnknownResult(
  SessionJournalStoredRequestSchema,
  { onExcessProperty: "error" },
);
const encodeStoredOutcome = Schema.encodeSync(
  SessionJournalStoredOutcomeSchema,
);
const decodeStoredOutcomeResult = Schema.decodeUnknownResult(
  SessionJournalStoredOutcomeSchema,
  { onExcessProperty: "error" },
);
const encodeIndexRangeDependency = Schema.encodeSync(
  LogicalIndexRangeReadDependencyV1Schema,
);
const decodeIndexRangeDependencyResult = Schema.decodeUnknownResult(
  LogicalIndexRangeReadDependencyV1Schema,
  { onExcessProperty: "error" },
);
const decodeRelationIncomingDependencyResult = Schema.decodeUnknownResult(
  Schema.toType(LogicalApplicationRelationIncomingReadDependencyV1Schema),
  { onExcessProperty: "error" },
);
const encodeLogicalAppWrite = Schema.encodeSync(LogicalAppWriteV1Schema);
const decodeLogicalAppWriteResult = Schema.decodeUnknownResult(
  LogicalAppWriteV1Schema,
  { onExcessProperty: "error" },
);
const decodeCommitFinalSyscallSequenceResult = Schema.decodeUnknownResult(
  Schema.toType(CommitFinalSyscallSequenceV1Schema),
);
const decodeCommitSyscallSequenceResult = Schema.decodeUnknownResult(
  Schema.toType(CommitSyscallSequenceV1Schema),
);

function nextCommitSyscallSequence(
  last: CommitFinalSyscallSequenceV1,
): Option.Option<CommitSyscallSequenceV1> {
  if (last >= BigInt(MAX_COMMIT_OPERATION_CALLS_V1)) return Option.none();
  return decodeCommitSyscallSequenceResult(last + 1n).pipe(Result.match({
    onFailure: () => Option.none(),
    onSuccess: Option.some,
  }));
}

const encodeSessionJournal = Schema.encodeSync(SessionJournalSchema);
const encodeSessionJournalResult = Schema.encodeResult(SessionJournalSchema);
const decodeSchemaManifestAppTableNameEffect = Schema.decodeUnknownEffect(
  SchemaManifestAppTableNameSchema,
);
const decodeTransactionSessionIdResult = Schema.decodeUnknownResult(
  Schema.toType(TransactionSessionIdV1Schema),
);
const decodeTransactionAttemptFenceResult = Schema.decodeUnknownResult(
  Schema.toType(TransactionAttemptFenceSchema),
);
const decodeSnapshotTokenResult = Schema.decodeUnknownResult(
  Schema.toType(SnapshotTokenSchema),
);
const decodeCatalogSchemaVersionIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogSchemaVersionIdSchema),
);
const decodeOrderedIndexBoundHexV1Result = Schema.decodeUnknownResult(
  Schema.toType(OrderedIndexBoundHexV1Schema),
);
const decodeExecutionClaimOwnerResult = decodeTransactionExecutionClaimOwnerV1;
const decodeExecutionClaimFenceResult = decodeTransactionExecutionClaimFenceV1;

const captureAdmittedOperationRequestEffect = Effect.fn(
  "SessionJournalStore.captureAdmittedOperationRequest",
)(function* (input: Readonly<{
  requestBytes: Uint8Array;
  requestSha256: Uint8Array;
}>): Effect.fn.Return<
  Readonly<{ frame: AdmittedFrameworkOperationV1; sha256: Uint8Array }>,
  LogicalParticipantAdmissionError | SessionJournalPersistenceV1Error
> {
  if (!(input.requestBytes instanceof Uint8Array) ||
    input.requestBytes.byteLength < 1 ||
    input.requestBytes.byteLength > MAX_ADMITTED_FRAMEWORK_OPERATION_BYTES_V1 ||
    !(input.requestSha256 instanceof Uint8Array) ||
    input.requestSha256.byteLength !== 32) {
    return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidInput" }));
  }
  const bytes = new Uint8Array(input.requestBytes);
  const suppliedDigest = new Uint8Array(input.requestSha256);
  const parsed = yield* Effect.try({
    try: (): unknown => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    catch: (cause) => new LogicalParticipantAdmissionError({ reason: "invalidInput", cause }),
  });
  const encoded = yield* Effect.fromResult(
    encodeAdmittedFrameworkOperationV1Result(parsed).pipe(Result.mapError((cause) =>
      new LogicalParticipantAdmissionError({ reason: "invalidInput", cause }))),
  );
  if (!bytesEqual(bytes, encoded.bytes)) {
    return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidInput" }));
  }
  const digest = yield* Effect.tryPromise({
    try: () => sha256(bytes),
    catch: (cause) => new SessionJournalPersistenceV1Error({
      operation: "runAdmittedOperation", cause,
    }),
  });
  if (!bytesEqual(digest, suppliedDigest)) {
    return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidInput" }));
  }
  return Object.freeze({ frame: encoded.operation, sha256: digest });
});

function mapAdmittedKernelFailure(cause: unknown):
  InvalidSessionJournalCapabilityV1Error | SessionJournalPersistenceV1Error |
  SessionJournalAttemptUnavailableV1Error | SessionJournalStorageCorruptionV1Error |
  SessionJournalTargetUnavailableV1Error |
  LogicalParticipantAdmissionError | LogicalParticipantInvocationError {
  if (cause instanceof ExactRunningAttemptTransactionV1Error) {
    return mapExactAdmissionFailure("runAdmittedOperation", cause);
  }
  if (cause instanceof InvalidSessionJournalCapabilityV1Error ||
    cause instanceof SessionJournalAttemptUnavailableV1Error ||
    cause instanceof SessionJournalPersistenceV1Error ||
    cause instanceof SessionJournalStorageCorruptionV1Error ||
    cause instanceof SessionJournalTargetUnavailableV1Error ||
    cause instanceof LogicalParticipantAdmissionError ||
    cause instanceof LogicalParticipantInvocationError) return cause;
  return new SessionJournalPersistenceV1Error({
    operation: "runAdmittedOperation", cause,
  });
}

/** The caller owns the transaction-local sharing scope. Every source still
 * authenticates its own issuer, selected head and request pins. */
const requireAdmittedBundleSourcesInTransactionEffect = Effect.fn(
  "SessionJournalStore.requireAdmittedBundleSources",
)(function* (
  bundle: LogicalParticipantAdmissionBundle,
  attempt: SessionJournalAttempt,
  request: Extract<SessionJournalStoredRequest, { readonly kind: "admittedLogicalOperation" }>,
  tx: FlarexMetadataTransaction,
  authority: TrustedScopeAuthority,
  clock: ScopeClockRecord,
) {
  const selected = inspectLogicalParticipantAdmissionBundle(bundle, attempt,
    request.participant, request.method, request.profileRevision);
  if (selected === null || selected.admissions.length !== request.sources.length) {
    return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
  }
  const states = [];
  for (const [ordinal, admission] of selected.admissions.entries()) {
    const methods = selected.sourceMethods[ordinal]!;
    const expected = request.sources[ordinal];
    const state = yield* requireLogicalParticipantAttemptAdmissionInTransactionEffect(
      admission, attempt, methods[0]!, tx, authority, clock);
    if (expected === undefined || expected.sourceKey !== state.sourceKey ||
      expected.sourceSha256Hex !== state.sourceSha256 ||
      expected.bindingHead.sequence !== state.head.sequence ||
      expected.bindingHead.sha256 !== state.head.sha256 ||
      expected.methods.length !== methods.length ||
      expected.methods.some((method, position) => method !== methods[position])) {
      return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    }
    states.push(state);
  }
  return Object.freeze(states);
});

const requireAdmittedBundleInTransactionEffect = Effect.fn(
  "SessionJournalStore.requireAdmittedBundle",
)((bundle: LogicalParticipantAdmissionBundle, attempt: SessionJournalAttempt,
  request: Extract<SessionJournalStoredRequest, { readonly kind: "admittedLogicalOperation" }>,
  tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord) =>
  withSharedLogicalSourceBindingChecks(tx, () => requireAdmittedBundleSourcesInTransactionEffect(
    bundle, attempt, request, tx, authority, clock)));

const preflightAdmittedOperationInTransactionEffect = Effect.fn(
  "SessionJournalStore.preflightAdmittedOperation",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  attempt: SessionJournalAttemptStateV1,
  admission: LogicalParticipantAdmissionBundle,
  attemptHandle: SessionJournalAttempt,
  authority: TrustedScopeAuthority,
  request: Extract<SessionJournalStoredRequest, { readonly kind: "admittedLogicalOperation" }>,
  requestEvidence: CanonicalFlarexValueV1,
  bindingDigest: Uint8Array,
) {
  const root = context.journalRoot;
  if (root.journalFormat !== SESSION_JOURNAL_FORMAT) {
    return yield* Effect.fail(corruption(attempt, "journalStateInvalid"));
  }
  const latest = yield* Effect.tryPromise({
    try: () => loadLatestReceipt(tx, context),
    catch: (cause) => new SessionJournalPersistenceV1Error({
      operation: "runAdmittedOperation", cause,
    }),
  });
  const last = CommitFinalSyscallSequenceV1Schema.make(root.lastSyscallSequence);
  yield* Effect.fromResult(validateReceiptCardinalityResult(attempt, last, latest));
  if (root.state === "operation_invoking") {
    if (latest === undefined) {
      return yield* Effect.fail(corruption(attempt, "latestReceiptSequenceMismatch"));
    }
    const marker = yield* decodeAndVerifyReceiptRecordEffect(attempt, latest, undefined);
    if (marker.request.kind !== "admittedLogicalOperation" ||
      marker.outcome.kind !== "admittedLogicalInvoking" ||
      latest.participantBindingSha256 === null) {
      return yield* Effect.fail(corruption(attempt, "latestReceiptEvidenceInvalid"));
    }
    return Object.freeze({ kind: "resolved" as const, result: Object.freeze({
      kind: "stateRejected" as const,
      issue: Object.freeze({ reason: "operationPending" as const }),
    }) });
  }
  if (root.state === "sealed" || root.state === "failed" ||
    root.state === "operation_failed" || root.state === "relation_conflicted") {
    return Object.freeze({ kind: "resolved" as const, result: Object.freeze({
      kind: "stateRejected" as const,
      issue: Object.freeze({ reason: root.state === "sealed" ? "journalSealed" as const :
        root.state === "relation_conflicted" ? "journalRelationConflicted" as const :
        "journalFailed" as const }),
    }) });
  }
  if (request.syscallSequence <= last) {
    const retained = yield* Effect.tryPromise({
      try: () => loadReceiptAtSequence(tx, context, request.syscallSequence),
      catch: (cause) => new SessionJournalPersistenceV1Error({
        operation: "runAdmittedOperation", cause,
      }),
    });
    if (retained === undefined) {
      return yield* Effect.fail(corruption(attempt, "latestReceiptSequenceMismatch"));
    }
    if (retained.participantBindingSha256 === null ||
      !bytesEqual(retained.participantBindingSha256, bindingDigest) ||
      !bytesEqual(retained.requestSha256, requestEvidence.sha256)) {
      return Object.freeze({ kind: "resolved" as const, result: Object.freeze({
        kind: "sequenceRejected" as const,
        issue: Object.freeze({ reason: "requestMismatch" as const,
          syscallSequence: request.syscallSequence }),
      }) });
    }
    const outcome = yield* decodeAndVerifyLatestReceiptEffect(
      attempt, retained, request,
    );
    if (outcome.kind === "admittedLogicalResult") {
      return Object.freeze({ kind: "resolved" as const, result: Object.freeze({
        kind: "completed" as const,
        delivery: "replayed" as const,
        result: outcome.result,
      }) });
    }
    if (outcome.kind === "admittedLogicalError") {
      return Object.freeze({ kind: "resolved" as const, result: Object.freeze({
        kind: "stateRejected" as const,
        issue: Object.freeze({ reason: "journalFailed" as const }),
      }) });
    }
    return yield* Effect.fail(corruption(attempt, "latestReceiptEvidenceInvalid"));
  }
  if (request.syscallSequence !== last + 1n) {
    return Object.freeze({ kind: "resolved" as const, result: Object.freeze({
      kind: "sequenceRejected" as const,
      issue: Object.freeze({ reason: "sequenceGap" as const,
        actual: request.syscallSequence,
        expectedNext: CommitSyscallSequenceV1Schema.make(last + 1n) }),
    }) });
  }
  if (last >= BigInt(MAX_COMMIT_OPERATION_CALLS_V1)) {
    return Object.freeze({ kind: "resolved" as const, result: Object.freeze({
      kind: "sequenceRejected" as const,
      issue: Object.freeze({ reason: "sequenceExhausted" as const,
        lastAccepted: last }),
    }) });
  }
  const admittedStates = yield* requireAdmittedBundleInTransactionEffect(
    admission, attemptHandle, request, tx, authority, context.scopeClock,
  );
  const tableIds = admittedStates.flatMap(state => [...state.tableIds]);
  if (tableIds.length === 0) {
    return yield* Effect.fail(new LogicalParticipantAdmissionError({
      reason: "unsupportedProfile",
    }));
  }
  const rows = yield* Effect.tryPromise({
    try: () => tx.select().from(fxSystemTransactionJournalPoints).where(and(
      eq(fxSystemTransactionJournalPoints.scopeUuid, context.scopeUuid),
      eq(fxSystemTransactionJournalPoints.sessionId, context.anchor.sessionId),
      eq(fxSystemTransactionJournalPoints.attemptFence, context.anchor.attemptFence),
      inArray(fxSystemTransactionJournalPoints.tableId, tableIds),
      ne(fxSystemTransactionJournalPoints.overlayKind, "none"),
    )).limit(MAX_COMMIT_POINT_READ_DEPENDENCIES_V1 + 1),
    catch: (cause) => new SessionJournalPersistenceV1Error({
      operation: "runAdmittedOperation", cause,
    }),
  });
  if (rows.length > MAX_COMMIT_POINT_READ_DEPENDENCIES_V1) {
    return yield* Effect.fail(corruption(attempt, "pointDependencyCountMismatch"));
  }
  const pendingRows: LogicalPendingDocumentSeed[] = [];
  for (const row of rows) {
    const dependency = yield* Effect.fromResult(decodePointDependencyResult(attempt, row));
    const observed = logicalDependencyFromPoint(dependency).observed;
    if (row.overlayKind === "live" && row.overlayCreationTime === null) {
      return yield* Effect.fail(corruption(attempt, "liveOverlayEvidenceMissing"));
    }
    const overlay = row.overlayKind === "live"
      ? Object.freeze({ kind: "live" as const,
        creationTime: decodeAppCreationTimeV1(row.overlayCreationTime),
        document: yield* decodeLivePointOverlayEvidenceEffect(attempt, row) })
      : Object.freeze({ kind: "deleted" as const });
    pendingRows.push(Object.freeze({ tableId: row.tableId,
      rowId: appRowIdHexV1FromBytes(row.rowId), observed, overlay }));
  }
  return Object.freeze({ kind: "ready" as const, pendingRows: Object.freeze(pendingRows) });
});

const persistAdmittedFailureInTransactionEffect = Effect.fn(
  "SessionJournalStore.persistAdmittedFailure",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  attempt: SessionJournalAttemptStateV1,
  request: Extract<SessionJournalStoredRequest, { readonly kind: "admittedLogicalOperation" }>,
  requestEvidence: CanonicalFlarexValueV1,
  bindingDigest: Uint8Array,
  reason: string,
  usage: Readonly<{ workBytes: number; workCalls: number }>,
) {
  if (context.journalRoot.state !== "operation_invoking" ||
    BigInt(context.journalRoot.lastSyscallSequence) !== BigInt(request.syscallSequence)) {
    return yield* Effect.fail(corruption(attempt, "journalRootOperationUpdateMismatch"));
  }
  const counters = yield* Effect.fromResult(decodeJournalCountersResult(
    attempt, context.journalRoot,
  ));
  if (!Number.isSafeInteger(usage.workBytes) || usage.workBytes < 0 ||
    !Number.isSafeInteger(usage.workCalls) || usage.workCalls < 0) {
    return yield* Effect.fail(corruption(attempt, "journalCountersInvalid"));
  }
  const outcome = Object.freeze({
    kind: "admittedLogicalError" as const,
    reason,
    workBytes: usage.workBytes,
    workCalls: usage.workCalls,
  });
  yield* Effect.tryPromise({
    try: () => persistAcceptedOperation(
      tx, context, request, requestEvidence, outcome, counters,
      ZERO_COUNTER_DELTAS,
      { state: "operation_failed", failureDimension: null,
        participantWorkBytes: usage.workBytes, participantWorkCalls: usage.workCalls },
      bindingDigest,
    ),
    catch: (cause) => new SessionJournalPersistenceV1Error({
      operation: "runAdmittedOperation", cause,
    }),
  });
});

const persistAdmittedInvocationMarkerInTransactionEffect = Effect.fn(
  "SessionJournalStore.markAdmittedInvocation",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  attemptState: SessionJournalAttemptStateV1,
  admission: LogicalParticipantAdmissionBundle,
  attempt: SessionJournalAttempt,
  authority: TrustedScopeAuthority,
  request: Extract<SessionJournalStoredRequest, { readonly kind: "admittedLogicalOperation" }>,
  requestEvidence: CanonicalFlarexValueV1,
  bindingDigest: Uint8Array,
) {
  const root = context.journalRoot;
  if (root.journalFormat !== SESSION_JOURNAL_FORMAT || root.state !== "open" ||
    root.lastSyscallSequence + 1n !== request.syscallSequence) {
    return yield* Effect.fail(corruption(attemptState, "journalRootOperationUpdateMismatch"));
  }
  yield* requireAdmittedBundleInTransactionEffect(admission, attempt, request,
    tx, authority, context.scopeClock);
  const outcomeEvidence = yield* Effect.tryPromise({
    try: () => canonicalizeStoredOutcome({ kind: "admittedLogicalInvoking" }),
    catch: cause => new SessionJournalPersistenceV1Error({
      operation: "runAdmittedOperation", cause,
    }),
  });
  const evidenceBytes = requestEvidence.canonicalBytes.byteLength +
    outcomeEvidence.canonicalBytes.byteLength;
  // Reserve room for the bounded terminal error receipt before calling the
  // native service; a full result can then fail closed without losing poison.
  if (root.receiptEvidenceBytes + evidenceBytes + 1_024 >
    MAX_COMMIT_RECEIPT_EVIDENCE_BYTES_V1) {
    return yield* Effect.fail(new LogicalParticipantAdmissionError({
      reason: "unsupportedProfile",
    }));
  }
  const changedCount = yield* Effect.tryPromise({
    try: async () => {
      await tx.insert(fxSystemTransactionJournalReceipts).values({
        scopeUuid: context.scopeUuid,
        sessionId: context.anchor.sessionId,
        attemptFence: context.anchor.attemptFence,
        lastSyscallSequence: request.syscallSequence,
        operationKind: request.kind,
        participantBindingSha256: new Uint8Array(bindingDigest),
        requestCodecVersion: 2,
        requestBytes: new Uint8Array(requestEvidence.canonicalBytes),
        requestSha256: new Uint8Array(requestEvidence.sha256),
        outcomeKind: "admittedLogicalInvoking",
        outcomeCodecVersion: 2,
        outcomeBytes: new Uint8Array(outcomeEvidence.canonicalBytes),
        outcomeSha256: new Uint8Array(outcomeEvidence.sha256),
        createdAt: context.databaseNow,
        updatedAt: context.databaseNow,
      });
      const changed = await tx.update(fxSystemTransactionJournals).set({
        state: "operation_invoking",
        lastSyscallSequence: CommitFinalSyscallSequenceV1Schema.make(request.syscallSequence),
        receiptEvidenceBytes: root.receiptEvidenceBytes + evidenceBytes,
        updatedAt: context.databaseNow,
      }).where(and(
        eq(fxSystemTransactionJournals.scopeUuid, context.scopeUuid),
        eq(fxSystemTransactionJournals.sessionId, context.anchor.sessionId),
        eq(fxSystemTransactionJournals.attemptFence, context.anchor.attemptFence),
        eq(fxSystemTransactionJournals.state, "open"),
        eq(fxSystemTransactionJournals.lastSyscallSequence, root.lastSyscallSequence),
      )).returning({ state: fxSystemTransactionJournals.state });
      return changed.length;
    },
    catch: cause => new SessionJournalPersistenceV1Error({
      operation: "runAdmittedOperation", cause,
    }),
  });
  if (changedCount !== 1) {
    return yield* Effect.fail(corruption(attemptState,
      "journalRootOperationUpdateMismatch"));
  }
});

export type AdmittedCompletion = Readonly<{
  result: Json;
  changes: LogicalDocumentChanges;
  eventIntents: readonly Readonly<{ sourceKey: string | null; intent: Json }>[];
  workBytes: number;
  workCalls: number;
}>;

const prepareAdmittedContributionsEffect = Effect.fn(
  "SessionJournalStore.prepareAdmittedContributions",
)(function* (
  attempt: SessionJournalAttempt,
  bundle: LogicalParticipantAdmissionBundle,
  request: Extract<SessionJournalStoredRequest, { readonly kind: "admittedLogicalOperation" }>,
  completed: AdmittedCompletion,
  contribution: Effect.Success<ReturnType<typeof projectLogicalDocumentJournalContribution>>,
) {
  const selected = inspectLogicalParticipantAdmissionBundle(bundle, attempt,
    request.participant, request.method, request.profileRevision);
  if (selected === null || selected.admissions.length !== request.sources.length) {
    return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
  }
  // The aggregate checked working set owns global attempt order. Every
  // projected point, effect and indexed dependency has exactly one source.
  for (const [ordinal, effect] of contribution.effects.entries()) {
    if (effect.effectOrdinal !== ordinal) {
      return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidInput" }));
    }
  }
  yield* serializeLogicalParticipantDependencyEvidence(completed.changes);
  const states = selected.admissions.map((admission, ordinal) => inspectLogicalParticipantAttemptAdmission(
    admission, attempt, selected.sourceMethods[ordinal]![0]!,
  ));
  if (states.some(state => state === null)) {
    return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
  }
  const owners = states.map(state => state!);
  const ownerOfTable = (tableId: CatalogTableId) => owners.findIndex(state => state.tableIds.has(tableId));
  if (contribution.points.some(point => ownerOfTable(point.observation.tableId) < 0) ||
    contribution.effects.some(effect => ownerOfTable(effect.tableId) < 0) ||
    completed.changes.indexReads.some(read => owners.filter(state => state.indexes.some(
      index => index.indexDefinitionId === read.definition.indexDefinitionId)).length !== 1) ||
    completed.changes.pageReads.some(read => owners.filter(state => state.indexes.some(
      index => index.indexDefinitionId === read.definition.indexDefinitionId)).length !== 1) ||
    completed.changes.uniqueReads.some(read => owners.filter(state => state.unique.some(
      constraint => constraint.uniqueConstraintDefinitionId === read.constraintId)).length !== 1) ||
    completed.eventIntents.some(event => event.sourceKey !== null &&
      !request.sources.some(source => source.sourceKey === event.sourceKey))) {
    return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
  }
  const sources: SourceContribution[] = [];
  for (const [ordinal, source] of request.sources.entries()) {
    const owner = owners[ordinal]!;
    const dependency = yield* serializeLogicalParticipantDependencyEvidence({
      ...completed.changes,
      indexReads: completed.changes.indexReads.filter(read => owner.indexes.some(
        index => index.indexDefinitionId === read.definition.indexDefinitionId)),
      pageReads: completed.changes.pageReads.filter(read => owner.indexes.some(
        index => index.indexDefinitionId === read.definition.indexDefinitionId)),
      uniqueReads: completed.changes.uniqueReads.filter(read => owner.unique.some(
        constraint => constraint.uniqueConstraintDefinitionId === read.constraintId)),
    });
    sources.push(Object.freeze({ ...source,
      effects: Object.freeze(contribution.effects.filter(effect => owner.tableIds.has(effect.tableId))),
      dependencyEvidence: dependency.evidence,
    }));
  }
  return Object.freeze(sources);
});

/** Framework callbacks remain outside SQL; both durable-operation and finite
 * roots use the same validation and contribution projection. */
const prepareAdmittedCompletionEffect = Effect.fn(
  "SessionJournalStore.prepareAdmittedCompletion",
)(function* (
  attempt: SessionJournalAttempt,
  admission: LogicalParticipantAdmissionBundle,
  request: Extract<SessionJournalStoredRequest, {
    readonly kind: "admittedLogicalOperation";
  }>,
  frame: AdmittedFrameworkOperationV1,
  borrowed: LogicalBorrowedParticipantOperation,
) {
  const completed = yield* borrowed.invoke(frame.operation, frame.args);
  if (completed.eventIntents.length > commitEventLimits.messages) {
    return yield* Effect.fail(new LogicalParticipantAdmissionError({
      reason: "invalidInput",
    }));
  }
  for (const event of completed.eventIntents) {
    yield* Effect.fromResult(Schema.decodeUnknownResult(EventEnvelope,
      { onExcessProperty: "error" })(event.intent).pipe(Result.mapError(cause =>
      new LogicalParticipantAdmissionError({ reason: "invalidInput", cause }))));
  }
  const contribution = yield* projectLogicalDocumentJournalContribution(
    completed.changes,
  );
  const sources = yield* prepareAdmittedContributionsEffect(
    attempt, admission, request, completed, contribution,
  );
  return Object.freeze({ completed, contribution, sources });
});

const appendAdmittedOperationInTransactionEffect = Effect.fn(
  "SessionJournalStore.appendAdmittedOperation",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  attemptState: SessionJournalAttemptStateV1,
  admission: LogicalParticipantAdmissionBundle,
  attempt: SessionJournalAttempt,
  authority: TrustedScopeAuthority,
  request: Extract<SessionJournalStoredRequest, { readonly kind: "admittedLogicalOperation" }>,
  requestEvidence: CanonicalFlarexValueV1,
  bindingDigest: Uint8Array,
  completed: AdmittedCompletion,
  contribution: Effect.Success<ReturnType<typeof projectLogicalDocumentJournalContribution>>,
  sources: readonly SourceContribution[],
) {
  const root = context.journalRoot;
  if (root.journalFormat !== SESSION_JOURNAL_FORMAT || root.state !== "operation_invoking" ||
    BigInt(root.lastSyscallSequence) !== BigInt(request.syscallSequence)) {
    return yield* Effect.fail(corruption(attemptState, "journalRootOperationUpdateMismatch"));
  }
  yield* requireAdmittedBundleInTransactionEffect(admission, attempt, request,
    tx, authority, context.scopeClock);
  const principalRows = yield* Effect.tryPromise({
    try: () => tx.select({ digest: fxSystemTransactionSessions.identityAccessPolicySha256 })
      .from(fxSystemTransactionSessions).where(and(
        eq(fxSystemTransactionSessions.scopeUuid, context.scopeUuid),
        eq(fxSystemTransactionSessions.sessionId, context.anchor.sessionId),
        eq(fxSystemTransactionSessions.attemptFence, context.anchor.attemptFence),
      )).limit(2),
    catch: (cause) => new SessionJournalPersistenceV1Error({
      operation: "runAdmittedOperation", cause,
    }),
  });
  const admissionEvidence = inspectLogicalParticipantAdmissionBundle(
    admission, attempt, request.participant, request.method, request.profileRevision,
  );
  const firstSource = admissionEvidence === null ? null : inspectLogicalParticipantAttemptAdmission(
    admissionEvidence.admissions[0]!, attempt, admissionEvidence.sourceMethods[0]![0]!,
  );
  if (firstSource === null || principalRows.length !== 1 ||
    encodeBytesToLowercaseHex(principalRows[0]!.digest) !==
      firstSource.root.principalDigest) {
    return yield* Effect.fail(new LogicalParticipantAdmissionError({
      reason: "invalidAuthority",
    }));
  }
  const counters = yield* Effect.fromResult(decodeJournalCountersResult(attemptState, root));
  const existingPoints = yield* Effect.tryPromise({
    try: () => tx.select().from(fxSystemTransactionJournalPoints).where(and(
      eq(fxSystemTransactionJournalPoints.scopeUuid, context.scopeUuid),
      eq(fxSystemTransactionJournalPoints.sessionId, context.anchor.sessionId),
      eq(fxSystemTransactionJournalPoints.attemptFence, context.anchor.attemptFence),
    )).limit(MAX_COMMIT_POINT_READ_DEPENDENCIES_V1 + 1),
    catch: (cause) => new SessionJournalPersistenceV1Error({
      operation: "runAdmittedOperation", cause,
    }),
  });
  if (existingPoints.length > MAX_COMMIT_POINT_READ_DEPENDENCIES_V1) {
    return yield* Effect.fail(corruption(attemptState, "pointDependencyCountMismatch"));
  }
  const existingByIdentity = new Map<string, typeof existingPoints[number]>(existingPoints.map((row) => [
    `${row.tableId}/${appRowIdHexV1FromBytes(row.rowId)}`, row,
  ] as const));
  const mutations: JournalPointMutationV1[] = [];
  let newPoints = 0;
  for (const point of contribution.points) {
    const observation = point.observation;
    const key = `${observation.tableId}/${observation.rowId}`;
    const existing = existingByIdentity.get(key);
    const identity = Object.freeze({ scopeId: attemptState.selector.scopeId,
      tableId: observation.tableId, rowId: observation.rowId });
    const observed = observation.dependency.observed;
    const dependency: AppRowPointDependencyV1 = observed.kind === "present"
      ? Object.freeze({ kind: "present" as const, identity,
        revisionCommitSeq: observed.revisionCommitSeq })
      : Object.freeze({ kind: "missing" as const, identity,
        basis: observed.basis });
    if (existing !== undefined) {
      const prior = yield* Effect.fromResult(decodePointDependencyResult(
        attemptState, existing,
      ));
      if (!dependenciesEqual(prior, dependency)) {
        return yield* Effect.fail(corruption(attemptState, "pointDependencyCountMismatch"));
      }
    } else {
      newPoints += 1;
    }
    if (point.overlay.kind === "retain" && existing !== undefined) continue;
    const overlay: JournalPointOverlayV1 = point.overlay.kind === "retain"
      ? Object.freeze({ kind: "none" as const })
      : point.overlay.kind === "deleted"
        ? Object.freeze({ kind: "deleted" as const })
        : Object.freeze({ kind: "live" as const,
          creationTime: point.overlay.creationTime,
          document: point.overlay.document });
    mutations.push(Object.freeze({ mode: existing === undefined ? "insert" as const : "update" as const,
      tableId: observation.tableId, rowId: observation.rowId,
      dependency, overlay }));
  }
  const preparedEvents: Array<Readonly<{
    effectOrdinal: number; bytes: Uint8Array; sha256: Uint8Array;
  }>> = [];
  let writeSemanticBytes = 0;
  let eventEvidenceBytes = 0;
  for (const effect of contribution.effects) {
    const source = sources.find(member => member.effects.some(candidate =>
      candidate.effectOrdinal === effect.effectOrdinal));
    if (source === undefined) {
      return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    }
    const encoded = Schema.encodeSync(AdmittedParticipantWriteEventSchema)({
      kind: "logicalDocument", syscallSequence: request.syscallSequence,
      sourceBindingSha256Hex: source.sourceBindingSha256Hex,
      effect,
    });
    const evidence = yield* Effect.tryPromise({
      try: () => canonicalizeFlarexValueJsonV1(requireJson(encoded)),
      catch: (cause) => new SessionJournalPersistenceV1Error({
        operation: "runAdmittedOperation", cause,
      }),
    });
    preparedEvents.push(Object.freeze({ effectOrdinal: effect.effectOrdinal,
      bytes: new Uint8Array(evidence.canonicalBytes),
      sha256: new Uint8Array(evidence.sha256) }));
    eventEvidenceBytes += evidence.canonicalBytes.byteLength;
    if (effect.after !== null) {
      const after = yield* Effect.tryPromise({
        try: () => canonicalizeFlarexValueJsonV1(effect.after),
        catch: (cause) => new SessionJournalPersistenceV1Error({
          operation: "runAdmittedOperation", cause,
        }),
      });
      writeSemanticBytes += after.semanticSizeBytes;
    }
  }
  if (!Number.isSafeInteger(completed.workBytes) || completed.workBytes < 0 ||
    !Number.isSafeInteger(completed.workCalls) || completed.workCalls < 0) {
    return yield* Effect.fail(corruption(attemptState, "journalCountersInvalid"));
  }
  const outcome = Object.freeze({ kind: "admittedLogicalResult" as const,
    result: completed.result, events: completed.eventIntents,
    sourceDependencies: sources.map(source => ({ sourceKey: source.sourceKey,
      evidence: source.dependencyEvidence })), workBytes: completed.workBytes,
    workCalls: completed.workCalls });
  const outcomeEvidence = yield* Effect.tryPromise({
    try: () => canonicalizeStoredOutcome(outcome),
    catch: (cause) => new SessionJournalPersistenceV1Error({
      operation: "runAdmittedOperation", cause,
    }),
  });
  const invokingEvidence = yield* Effect.tryPromise({
    try: () => canonicalizeStoredOutcome({ kind: "admittedLogicalInvoking" }),
    catch: (cause) => new SessionJournalPersistenceV1Error({
      operation: "runAdmittedOperation", cause,
    }),
  });
  const deltas = Object.freeze({ ...ZERO_COUNTER_DELTAS,
    operationCalls: 0,
    pointDependencyCount: newPoints,
    writeOperations: contribution.effects.length,
    writeSemanticBytes,
    materialWriteEventEvidenceBytes: eventEvidenceBytes,
    receiptEvidenceBytes: outcomeEvidence.canonicalBytes.byteLength -
      invokingEvidence.canonicalBytes.byteLength,
  } satisfies SessionJournalCounterDeltasV1);
  const limit = firstExceededLimit(counters, deltas);
  if (limit !== undefined ||
    root.participantWorkBytes + completed.workBytes > MAX_COMMIT_PARTICIPANT_WORK_BYTES_V1 ||
    root.participantWorkCalls + completed.workCalls > MAX_COMMIT_PARTICIPANT_WORK_CALLS_V1) {
    return yield* Effect.fail(new LogicalParticipantAdmissionError({
      reason: "unsupportedProfile",
    }));
  }
  yield* Effect.tryPromise({
    try: async () => {
      for (const mutation of mutations) await persistPointMutation(tx, context, mutation);
      for (const event of preparedEvents) {
        await tx.insert(fxSystemTransactionJournalWriteEvents).values({
          scopeUuid: context.scopeUuid, sessionId: context.anchor.sessionId,
          attemptFence: context.anchor.attemptFence,
          syscallSequence: request.syscallSequence,
          effectOrdinal: event.effectOrdinal,
          writeKind: "logicalDocument", eventCodecVersion: 2,
          eventBytes: event.bytes, eventSha256: event.sha256,
          createdAt: context.databaseNow,
        });
      }
      await persistAcceptedOperation(tx, context, request, requestEvidence,
        outcome, counters, deltas,
        { state: "open", failureDimension: null,
          participantWorkBytes: completed.workBytes,
          participantWorkCalls: completed.workCalls }, bindingDigest);
    },
    catch: (cause) => new SessionJournalPersistenceV1Error({
      operation: "runAdmittedOperation", cause,
    }),
  });
  return Object.freeze({ kind: "completed" as const, delivery: "executed" as const,
    result: completed.result });
});

export function createSessionJournalStorePersistence(
  ports: PointMutationSessionAuthorityResolutionPortsV1,
  options: SessionJournalStorePersistenceOptionsV1,
): SessionJournalStorePersistence {
  const randomUuid = options.randomUuid ?? (() => crypto.randomUUID());
  const indexedQueryPort = options.indexedQueries;
  const applicationRelationPort = options.applicationRelations;
  const faultAfter = options.faultAfter;
  const indexedQueryPortState = indexedQueryPort === undefined
    ? undefined
    : appDeveloperIndexQueryPortStatesV1.get(indexedQueryPort);
  const applicationRelationCompositionIsExact =
    applicationRelationPort !== undefined &&
    hasApplicationRelationReadPortAuthorityForPointCommit(
      applicationRelationPort,
      ports,
    );
  const maximumLiveSnapshotRetentionMilliseconds =
    options.grantRetentionPolicy.maximumLiveSnapshotRetentionMilliseconds;
  const attemptStates = new WeakMap<object, SessionJournalAttemptStateV1>();
  const finiteRootStates = new WeakMap<SessionJournalAttemptStateV1,
    FiniteRootAttemptState>();
  // A live exact claim owns one evaluator even if a second trusted journal
  // facade reopens it on this host. Keep strong ownership until durable seal
  // or authoritative abort; GC must not silently permit same-fence restart.
  const finiteClaims = new Map<string, Readonly<{
    handle: SessionJournalAttempt;
    state: FiniteRootAttemptState;
  }>>();
  const tableStates = new WeakMap<object, PinnedPointTableStateV1>();
  const indexStates = new WeakMap<object, PinnedDeveloperIndexStateV1>();
  const relationStates = new WeakMap<
    object,
    PinnedApplicationRelationReadState
  >();
  const sealStates = new WeakMap<
    object,
    PreparedSessionJournalSealStateV1
  >();

  const createAttemptHandle = (
    state: SessionJournalAttemptStateV1,
  ): SessionJournalAttempt => {
    const handle = Object.freeze({
      [sessionJournalAttemptBrand]: true as const,
    });
    attemptStates.set(handle, state);
    return handle;
  };

  const retireFinishedFiniteRootsEffect = Effect.fn(
    "SessionJournalStore.retireFinishedFiniteRoots",
  )(function* () {
    for (const [key, owner] of finiteClaims) {
      if (owner.state.status === "sealing") {
        continue;
      }
      const prior = attemptStates.get(owner.handle);
      if (prior === undefined) continue;
      const resolved = yield* resolveJournalTargetEffect(prior);
      const retired = yield* resolved.target[
        RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1
      ]({ selector: prior.selector,
        preliminaryAuthority: resolved.authority,
        executionClaim: prior.executionClaim,
      }, (_tx, context) => Effect.succeed(
        context.journalRoot.state === "sealed",
      )).pipe(Effect.catchTag("ExactRunningAttemptTransactionV1Error", error => {
        const cause = error.cause;
        if (error.callbackCause === undefined &&
          cause instanceof PointMutationSessionAttemptLoadV1Error &&
          (["sessionMissing", "staleAttemptFence", "attemptNotRunning",
            "activeAttemptExpired", "executionClaimUnavailable"] as const)
            .some(reason => reason === cause.issue.reason)) {
          return Effect.succeed(true);
        }
        return Effect.fail(error);
      }));
      if (retired) {
        owner.state.status = "aborted";
        discardFiniteRootEvidence(owner.state);
        finiteClaims.delete(key);
      }
    }
  });

  const openAttemptEffect: SessionJournalStorePersistence[
    "openAttemptEffect"
  ] = Effect.fn("SessionJournalStore.openAttempt")(function* (input) {
    const state = yield* Effect.fromResult(captureAttemptStateResult(input));
    const resolved = yield* resolveJournalTargetEffect(state);
    yield* admitExactRunningAttemptEffect(resolved, state, "openAttempt");
    const finiteKey = state.executionProfile === "finiteRoot"
      ? JSON.stringify([state.selector.deploymentId, state.selector.scopeId,
        state.selector.sessionId,
        String(state.selector.attemptFence), state.executionClaim.claimOwner,
        String(state.executionClaim.claimFence)])
      : undefined;
    if (finiteKey !== undefined) {
      const existing = finiteClaims.get(finiteKey);
      if (existing !== undefined) {
        const prior = attemptStates.get(existing.handle);
        if (prior === undefined ||
          prior.selector.deploymentId !== state.selector.deploymentId ||
          prior.selector.scopeId !== state.selector.scopeId ||
          prior.selector.sessionId !== state.selector.sessionId ||
          prior.selector.attemptFence !== state.selector.attemptFence ||
          prior.snapshotToken.scopeId !== state.snapshotToken.scopeId ||
          prior.snapshotToken.epoch !== state.snapshotToken.epoch ||
          prior.snapshotToken.commitSeq !== state.snapshotToken.commitSeq ||
          prior.schemaVersionId !== state.schemaVersionId ||
          prior.executionClaim.claimOwner !== state.executionClaim.claimOwner ||
          prior.executionClaim.claimFence !== state.executionClaim.claimFence ||
          prior.executionProfile !== state.executionProfile) {
          return yield* Effect.fail(new InvalidSessionJournalInputV1Error({
            operation: "openAttempt", reason: "invalidAttemptPins",
          }));
        }
        if (existing.state.status !== "open") {
          return yield* Effect.fail(new SessionJournalAttemptUnavailableV1Error({
            issue: { reason: "executionClaimUnavailable" },
          }));
        }
        return existing.handle;
      }
      if (finiteClaims.size >= 1_024) {
        yield* retireFinishedFiniteRootsEffect().pipe(Effect.mapError(error =>
          error instanceof ExactRunningAttemptTransactionV1Error
            ? new SessionJournalPersistenceV1Error({ operation: "openAttempt",
              cause: error }) : error));
      }
      if (finiteClaims.size >= 1_024) {
        return yield* Effect.fail(new SessionJournalPersistenceV1Error({
          operation: "openAttempt", cause: "finite root owner capacity exhausted",
        }));
      }
    }
    const handle = createAttemptHandle(state);
    if (state.executionProfile === "finiteRoot") {
      const finite: FiniteRootAttemptState = {
        evaluator: makeLogicalDocumentRootEvaluator({
          attempt: handle,
          scopeId: state.selector.scopeId,
          snapshotCommitSeq: state.snapshotToken.commitSeq,
          attemptFence: String(state.selector.attemptFence),
        }, {
          identities: MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
          workingBytes: MAX_COMMIT_PARTICIPANT_WORK_BYTES_V1,
        }),
        entries: new Map(), points: new Map(), pointReads: new Map(),
        indexRanges: [], relationDependencies: [],
        status: "open", lastSequence: 0n,
        counters: { ...ZERO_FINITE_COUNTERS },
        participantWorkBytes: 0,
        participantWorkCalls: 0,
      };
      finiteRootStates.set(state, finite);
      if (finiteKey !== undefined) {
        finiteClaims.set(finiteKey, Object.freeze({ handle, state: finite }));
      }
    }
    return handle;
  });

  const admitSourceEffect = Effect.fn("SessionJournalStore.admitSource")(function* (
    attempt: SessionJournalAttempt,
    input: Readonly<{ selection: LogicalParticipantSelection;
      application: ApplicationBindingInput; methods: readonly string[] }>,
  ) {
    const attemptState = typeof attempt === "object" && attempt !== null
      ? attemptStates.get(attempt)
      : undefined;
    if (attemptState === undefined) {
      return yield* Effect.fail(new InvalidSessionJournalCapabilityV1Error({
        capability: "attempt",
      }));
    }
    const resolved = yield* resolveJournalTargetEffect(attemptState);
    const readTransaction: LogicalParticipantAttemptReadTransaction =
      <Value, Failure>(work: (tx: FlarexMetadataTransaction,
        authority: TrustedScopeAuthority, clock: ScopeClockRecord) =>
          Effect.Effect<Value, Failure>) =>
        resolved.target[RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1](
          {
            selector: attemptState.selector,
            preliminaryAuthority: resolved.authority,
            executionClaim: attemptState.executionClaim,
          },
          (tx, context) => work(tx, resolved.authority, context.scopeClock),
        ).pipe(Effect.catchTag("ExactRunningAttemptTransactionV1Error", (cause) =>
          Effect.fail(new LogicalParticipantAdmissionError({
            reason: "invalidAuthority", cause,
          }))));
    const principalRows = yield* readTransaction((tx) => Effect.tryPromise({
      try: () => tx.select({
          digest: fxSystemTransactionSessions.identityAccessPolicySha256,
        }).from(fxSystemTransactionSessions).where(and(
          eq(fxSystemTransactionSessions.scopeUuid, projectScopeIdUuidV1(
            attemptState.selector.scopeId,
          ).scopeUuid),
          eq(fxSystemTransactionSessions.sessionId, attemptState.selector.sessionId),
          eq(fxSystemTransactionSessions.attemptFence, attemptState.selector.attemptFence),
        )).limit(2),
      catch: (cause) => new SessionJournalPersistenceV1Error({
        operation: "admitLogicalParticipant", cause,
      }),
    }));
    if (principalRows.length !== 1 || principalRows[0]?.digest.byteLength !== 32) {
      return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }));
    }
    const principalDigest = encodeBytesToLowercaseHex(principalRows[0].digest);
    return yield* input.selection.bindAttemptEffect(input.application, attempt, {
      scopeId: attemptState.selector.scopeId,
      sessionId: attemptState.selector.sessionId,
      attemptFence: attemptState.selector.attemptFence,
      principalDigest,
      snapshotCommitSeq: attemptState.snapshotToken.commitSeq,
      schemaVersionId: attemptState.schemaVersionId,
    }, readTransaction, input.methods);
  });

  const admitLogicalParticipantsEffect: SessionJournalStorePersistence[
    "admitLogicalParticipantsEffect"
  ] = Effect.fn("SessionJournalStore.admitLogicalParticipants")(function* (
    attempt, input,
  ) {
    if (input.sources.length === 0 || input.sources.length > 3) {
      return yield* Effect.fail(new LogicalParticipantAdmissionError({ reason: "unsupportedProfile" }));
    }
    const sources = [];
    for (const source of input.sources) {
      const admission = yield* admitSourceEffect(attempt, source);
      sources.push(Object.freeze({ admission, methods: source.methods }));
    }
    return yield* Effect.fromResult(issueLogicalParticipantAdmissionBundle(attempt, {
      participant: input.participant, operationMethods: input.operationMethods,
      profileRevision: input.profileRevision, sources,
    }));
  });

  const admittedInFlight = new Set<string>();
  const runAdmittedOperationEffect: SessionJournalStorePersistence[
    "runAdmittedOperationEffect"
  ] = Effect.fn("SessionJournalStore.runAdmittedOperation")(function* (
    attempt, admission, input, borrow,
  ) {
    const attemptState = typeof attempt === "object" && attempt !== null
      ? attemptStates.get(attempt)
      : undefined;
    if (attemptState === undefined) {
      return yield* Effect.fail(new InvalidSessionJournalCapabilityV1Error({
        capability: "attempt",
      }));
    }
    const admitted = inspectLogicalParticipantAdmissionBundle(
      admission, attempt, input.participant, input.method, input.profileRevision,
    );
    if (admitted === null) {
      return yield* Effect.fail(new InvalidSessionJournalCapabilityV1Error({
        capability: "attempt",
      }));
    }
    const captured = yield* captureAdmittedOperationRequestEffect(input);
    if (captured.frame.participant !== input.participant ||
      captured.frame.operation !== input.method) {
      return yield* Effect.fail(new LogicalParticipantAdmissionError({
        reason: "invalidInput",
      }));
    }
    const sources = [];
    for (const [ordinal, source] of admitted.admissions.entries()) {
      const state = inspectLogicalParticipantAttemptAdmission(source, attempt,
        admitted.sourceMethods[ordinal]![0]!);
      if (state === null || state.root.scopeId !== attemptState.selector.scopeId ||
        state.root.sessionId !== attemptState.selector.sessionId ||
        state.root.attemptFence !== attemptState.selector.attemptFence ||
        state.root.snapshotCommitSeq !== attemptState.snapshotToken.commitSeq ||
        state.root.schemaVersionId !== attemptState.schemaVersionId) {
        return yield* Effect.fail(new InvalidSessionJournalCapabilityV1Error({ capability: "attempt" }));
      }
      const binding = yield* Effect.fromResult(
        canonicalizeAdmittedParticipantBindingV1Result({
          ...state.root, participant: input.participant, method: input.method,
          sourceKey: state.sourceKey, sourceSha256Hex: state.sourceSha256,
          bindingHead: state.bindingHead,
        }).pipe(Result.mapError(cause => new LogicalParticipantAdmissionError({
          reason: "invalidAuthority", cause,
        }))),
      );
      const sourceBindingDigest = yield* Effect.tryPromise({
        try: () => sha256(binding.bytes),
        catch: cause => new SessionJournalPersistenceV1Error({ operation: "runAdmittedOperation", cause }),
      });
      sources.push(Object.freeze({ sourceKey: state.sourceKey,
        sourceSha256Hex: state.sourceSha256, bindingHead: state.bindingHead,
        sourceBindingSha256Hex: encodeBytesToLowercaseHex(sourceBindingDigest),
        methods: admitted.sourceMethods[ordinal]! }));
    }
    const bundle = yield* Effect.fromResult(canonicalizeAdmittedSourceBundleResult({
      participant: input.participant, method: input.method,
      profileRevision: input.profileRevision, sources,
    }).pipe(Result.mapError(cause => new LogicalParticipantAdmissionError({
      reason: "invalidAuthority", cause,
    }))));
    const bindingDigest = yield* Effect.tryPromise({
      try: () => sha256(bundle.bytes),
      catch: (cause) => new SessionJournalPersistenceV1Error({
        operation: "runAdmittedOperation", cause,
      }),
    });
    const request = Object.freeze({
      format: "flarex.session-journal-syscall" as const,
      codecVersion: 2 as const,
      kind: "admittedLogicalOperation" as const,
      syscallSequence: input.syscallSequence,
      participant: input.participant,
      method: input.method,
      profileRevision: input.profileRevision,
      sources,
      admissionBundleSha256Hex: encodeBytesToLowercaseHex(bindingDigest),
      requestSha256Hex: encodeBytesToLowercaseHex(captured.sha256),
      frame: captured.frame,
    } satisfies Extract<SessionJournalStoredRequest, {
      readonly kind: "admittedLogicalOperation";
    }>);
    const requestEvidence = yield* canonicalizeStoredRequestEffect(request);
    const resolved = yield* resolveJournalTargetEffect(attemptState);
    const inFlightKey = `${attemptState.selector.scopeId}/${attemptState.selector.sessionId}/${attemptState.selector.attemptFence}`;
    if (admittedInFlight.has(inFlightKey)) {
      return Object.freeze({ kind: "stateRejected", issue: Object.freeze({
        reason: "operationPending",
      }) });
    }
    admittedInFlight.add(inFlightKey);
    return yield* Effect.gen(function* () {
      const pins = {
        selector: attemptState.selector,
        preliminaryAuthority: resolved.authority,
        executionClaim: attemptState.executionClaim,
      } as const;
      const finite = finiteRootStates.get(attemptState);
      if (attemptState.executionProfile === "finiteRoot") {
        if (finite === undefined) {
          return yield* Effect.fail(corruption(attemptState, "journalStateInvalid"));
        }
        return yield* Effect.gen(function* () {
          // This short transaction authenticates the live claim, root position
          // and selected source rights. It ends before framework callbacks.
          yield* resolved.target[RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1](
            pins,
            (tx, context) => Effect.gen(function* () {
              if (!kernelContextMatchesAttempt(context, attemptState) ||
                context.journalRoot.executionProfile !== "finiteRoot" ||
                context.journalRoot.state !== "open" ||
                context.journalRoot.lastSyscallSequence !== 0n) {
                return yield* Effect.fail(corruption(attemptState, "journalStateInvalid"));
              }
              yield* requireAdmittedBundleInTransactionEffect(admission,
                attempt, request, tx, resolved.authority, context.scopeClock);
            }),
          ).pipe(Effect.mapError(mapAdmittedKernelFailure));
          if (finite.status !== "open") {
            return Object.freeze({ kind: "stateRejected" as const,
              issue: Object.freeze({ reason: "journalFailed" as const }) });
          }
          const previous = finite.entries.get(request.syscallSequence);
          if (previous !== undefined) {
            if (previous.kind !== "admitted" ||
              !bytesEqual(previous.requestEvidence.sha256, requestEvidence.sha256) ||
              !bytesEqual(previous.bindingDigest, bindingDigest)) {
              return Object.freeze({ kind: "sequenceRejected" as const,
                issue: Object.freeze({ reason: "requestMismatch" as const,
                  syscallSequence: request.syscallSequence }) });
            }
            return Object.freeze({ kind: "completed" as const,
              delivery: "replayed" as const,
              result: structuredClone(previous.outcome.result) });
          }
          if (request.syscallSequence !== finite.lastSequence + 1n) {
            return Object.freeze({ kind: "sequenceRejected" as const,
              issue: Object.freeze({ reason: "sequenceGap" as const,
                actual: request.syscallSequence,
                expectedNext: CommitSyscallSequenceV1Schema.make(
                  finite.lastSequence + 1n) }) });
          }
          if (finite.lastSequence >= BigInt(MAX_COMMIT_OPERATION_CALLS_V1)) {
            return Object.freeze({ kind: "sequenceRejected" as const,
              issue: Object.freeze({ reason: "sequenceExhausted" as const,
                lastAccepted: CommitFinalSyscallSequenceV1Schema.make(
                  finite.lastSequence) }) });
          }
          const borrowedExit = yield* Effect.exit(borrow({
            admissions: admitted.admissions, bundle: admission, attempt,
            method: input.method,
            rootEvaluator: finite.evaluator,
            rootAttemptFence: String(attemptState.selector.attemptFence),
          }));
          if (Exit.isFailure(borrowedExit)) {
            return yield* Effect.failCause(borrowedExit.cause);
          }
          const borrowed = borrowedExit.value;
          const prepared = yield* Effect.exit(
            prepareAdmittedCompletionEffect(attempt, admission, request,
              captured.frame, borrowed).pipe(Effect.ensuring(borrowed.abort)),
          );
          if (Exit.isFailure(prepared)) {
            return yield* Effect.failCause(prepared.cause);
          }
          const { completed, contribution, sources: preparedSources } =
            prepared.value;
          const outcome = Object.freeze({ kind: "admittedLogicalResult" as const,
            result: completed.result, events: completed.eventIntents,
            sourceDependencies: preparedSources.map(source => ({
              sourceKey: source.sourceKey, evidence: source.dependencyEvidence,
            })), workBytes: completed.workBytes, workCalls: completed.workCalls });
          const outcomeEvidence = yield* Effect.tryPromise({
            try: () => canonicalizeStoredOutcome(outcome),
            catch: cause => new SessionJournalPersistenceV1Error({
              operation: "runAdmittedOperation", cause,
            }),
          });
          const pointMutations: JournalPointMutationV1[] = [];
          let newPoints = 0;
          for (const point of contribution.points) {
            const key = `${point.observation.tableId}/${point.observation.rowId}`;
            const prior = finite.points.get(key);
            const observed = point.observation.dependency.observed;
            const dependency: AppRowPointDependencyV1 = observed.kind === "present"
              ? Object.freeze({ kind: "present" as const,
                identity: Object.freeze({ scopeId: attemptState.selector.scopeId,
                  tableId: point.observation.tableId,
                  rowId: point.observation.rowId }),
                revisionCommitSeq: observed.revisionCommitSeq })
              : Object.freeze({ kind: "missing" as const,
                identity: Object.freeze({ scopeId: attemptState.selector.scopeId,
                  tableId: point.observation.tableId,
                  rowId: point.observation.rowId }),
                basis: observed.basis });
            if (prior !== undefined &&
              !dependenciesEqual(prior.dependency, dependency)) {
              return yield* Effect.fail(corruption(attemptState,
                "pointDependencyCountMismatch"));
            }
            if (prior === undefined) newPoints++;
            if (point.overlay.kind === "retain" && prior !== undefined) continue;
            const overlay: JournalPointOverlayV1 = point.overlay.kind === "retain"
              ? Object.freeze({ kind: "none" as const })
              : point.overlay.kind === "deleted"
                ? Object.freeze({ kind: "deleted" as const })
                : Object.freeze({ kind: "live" as const,
                  creationTime: point.overlay.creationTime,
                  document: point.overlay.document });
            pointMutations.push(Object.freeze({
              mode: prior === undefined ? "insert" as const : prior.mode,
              tableId: point.observation.tableId,
              rowId: point.observation.rowId,
              dependency, overlay,
            }));
          }
          const events: Array<Readonly<{
            effectOrdinal: number; bytes: Uint8Array; sha256: Uint8Array;
          }>> = [];
          let writeSemanticBytes = 0;
          let eventEvidenceBytes = 0;
          for (const effect of contribution.effects) {
            const source = preparedSources.find(member => member.effects.some(
              candidate => candidate.effectOrdinal === effect.effectOrdinal));
            if (source === undefined) {
              return yield* Effect.fail(new LogicalParticipantAdmissionError({
                reason: "invalidAuthority",
              }));
            }
            const encoded = Schema.encodeSync(AdmittedParticipantWriteEventSchema)({
              kind: "logicalDocument", syscallSequence: request.syscallSequence,
              sourceBindingSha256Hex: source.sourceBindingSha256Hex, effect,
            });
            const evidence = yield* Effect.tryPromise({
              try: () => canonicalizeFlarexValueJsonV1(requireJson(encoded)),
              catch: cause => new SessionJournalPersistenceV1Error({
                operation: "runAdmittedOperation", cause,
              }),
            });
            events.push(Object.freeze({ effectOrdinal: effect.effectOrdinal,
              bytes: new Uint8Array(evidence.canonicalBytes),
              sha256: new Uint8Array(evidence.sha256) }));
            eventEvidenceBytes += evidence.canonicalBytes.byteLength;
            if (effect.after !== null) {
              const after = yield* Effect.tryPromise({
                try: () => canonicalizeFlarexValueJsonV1(effect.after),
                catch: cause => new SessionJournalPersistenceV1Error({
                  operation: "runAdmittedOperation", cause,
                }),
              });
              writeSemanticBytes += after.semanticSizeBytes;
            }
          }
          const receiptBytes = requestEvidence.canonicalBytes.byteLength +
            outcomeEvidence.canonicalBytes.byteLength;
          const deltas = Object.freeze({ ...ZERO_COUNTER_DELTAS,
            pointDependencyCount: newPoints,
            writeOperations: contribution.effects.length,
            writeSemanticBytes,
            materialWriteEventEvidenceBytes: eventEvidenceBytes,
            receiptEvidenceBytes: receiptBytes,
          } satisfies SessionJournalCounterDeltasV1);
          if (firstExceededLimit(finite.counters, deltas) !== undefined ||
            finite.participantWorkBytes + completed.workBytes >
              MAX_COMMIT_PARTICIPANT_WORK_BYTES_V1 ||
            finite.participantWorkCalls + completed.workCalls >
              MAX_COMMIT_PARTICIPANT_WORK_CALLS_V1) {
            return yield* Effect.fail(new LogicalParticipantAdmissionError({
              reason: "unsupportedProfile",
            }));
          }
          finite.entries.set(request.syscallSequence, Object.freeze({ admission, request, ...structuredClone({
            kind: "admitted" as const, requestEvidence,
            bindingDigest, completed, contribution,
            sources: preparedSources, outcome, outcomeEvidence,
            pointMutations, events,
          }) }));
          for (const mutation of pointMutations) {
            finite.points.set(`${mutation.tableId}/${mutation.rowId}`, mutation);
          }
          finite.lastSequence = request.syscallSequence;
          finite.counters = addFiniteCounters(finite.counters, deltas);
          finite.participantWorkBytes += completed.workBytes;
          finite.participantWorkCalls += completed.workCalls;
          return Object.freeze({ kind: "completed" as const,
            delivery: "executed" as const,
            result: structuredClone(completed.result) });
        }).pipe(Effect.onError(() => Effect.sync(() => {
          finite.status = "aborted";
          discardFiniteRootEvidence(finite);
        })));
      }
      const preflight = yield* resolved.target[
        RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1
      ](pins, (tx, context) => preflightAdmittedOperationInTransactionEffect(
        tx, context, attemptState, admission, attempt, resolved.authority,
        request, requestEvidence, bindingDigest,
      )).pipe(Effect.mapError(mapAdmittedKernelFailure));
      if (preflight.kind !== "ready") return preflight.result;
      return yield* Effect.uninterruptibleMask((restore) => Effect.gen(function* () {
        yield* resolved.target[RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1](
          pins,
          (tx, context) => persistAdmittedInvocationMarkerInTransactionEffect(
            tx, context, attemptState, admission, attempt, resolved.authority,
            request, requestEvidence, bindingDigest,
          ),
        ).pipe(Effect.mapError(mapAdmittedKernelFailure));
        const borrowedExit = yield* Effect.exit(restore(borrow({
          admissions: admitted.admissions, bundle: admission, attempt,
          method: input.method, pendingRows: preflight.pendingRows,
        })));
        if (Exit.isFailure(borrowedExit)) {
          const poison = yield* Effect.exit(resolved.target[
            RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1
          ](pins, (tx, context) => persistAdmittedFailureInTransactionEffect(
            tx, context, attemptState, request, requestEvidence,
            bindingDigest, "participantPreparationFailed",
            Object.freeze({ workBytes: 0, workCalls: 0 }),
          )).pipe(Effect.mapError(mapAdmittedKernelFailure)));
          return yield* Effect.failCause(Exit.isFailure(poison)
            ? Cause.combine(borrowedExit.cause, poison.cause) : borrowedExit.cause);
        }
        const borrowed = borrowedExit.value;
        return yield* Effect.gen(function* () {
        // A native method may already have staged work when any subsequent
        // projection or evidence check fails. Keep the entire preparation in
        // the failure bracket and durably poison the exact root before exit.
        const prepared = yield* Effect.exit(restore(
          prepareAdmittedCompletionEffect(attempt, admission, request,
            captured.frame, borrowed),
        ));
        if (Exit.isFailure(prepared)) {
          const usage = borrowed.currentUsage();
          yield* borrowed.abort;
          const poison = yield* Effect.exit(resolved.target[RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1](
            pins,
            (tx, context) => persistAdmittedFailureInTransactionEffect(
              tx, context, attemptState, request, requestEvidence,
              bindingDigest, "participantFailed", usage,
            ),
          ).pipe(Effect.mapError(mapAdmittedKernelFailure)));
          if (Exit.isFailure(poison)) {
            return yield* Effect.failCause(Cause.combine(prepared.cause, poison.cause));
          }
          return yield* Effect.failCause(prepared.cause);
        }
        const { completed, contribution, sources: preparedSources } = prepared.value;
        const acceptance = yield* Effect.exit(resolved.target[
          RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1
        ](pins, (tx, context) => appendAdmittedOperationInTransactionEffect(
          tx, context, attemptState, admission, attempt, resolved.authority,
          request, requestEvidence,
          bindingDigest, completed, contribution, preparedSources,
        )).pipe(Effect.mapError(mapAdmittedKernelFailure)));
        if (Exit.isSuccess(acceptance)) return acceptance.value;
        // The write may have committed even if its acknowledgement was lost.
        // Resolve that exact sequence under the same fenced root before any
        // failure receipt, and never invoke the native participant again here.
        const resolution = yield* Effect.exit(resolved.target[
          RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1
        ](pins, (tx, context) => preflightAdmittedOperationInTransactionEffect(
          tx, context, attemptState, admission, attempt, resolved.authority,
          request, requestEvidence, bindingDigest,
        )).pipe(Effect.mapError(mapAdmittedKernelFailure)));
        if (Exit.isFailure(resolution)) {
          return yield* Effect.failCause(Cause.combine(acceptance.cause,
            resolution.cause));
        }
        if (resolution.value.kind === "resolved" &&
          !(resolution.value.result.kind === "stateRejected" &&
            resolution.value.result.issue.reason === "operationPending")) {
          return resolution.value.result;
        }
        const poison = yield* Effect.exit(resolved.target[RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1](
          pins,
          (tx, context) => persistAdmittedFailureInTransactionEffect(
            tx, context, attemptState, request, requestEvidence,
            bindingDigest, "acceptanceFailed", borrowed.currentUsage(),
          ),
        ).pipe(Effect.mapError(mapAdmittedKernelFailure)));
        if (Exit.isFailure(poison)) {
          return yield* Effect.failCause(Cause.combine(acceptance.cause, poison.cause));
        }
        return yield* Effect.failCause(acceptance.cause);
        }).pipe(Effect.ensuring(borrowed.abort));
      }));
    }).pipe(Effect.ensuring(Effect.sync(() => admittedInFlight.delete(inFlightKey))));
  });

  const resolveJournalTargetEffect = Effect.fn(
    "SessionJournalStore.resolveJournalTarget",
  )(function* (attempt: SessionJournalAttemptStateV1): Effect.fn.Return<
    ResolvedJournalTargetV1,
    SessionJournalPersistenceV1Error | SessionJournalTargetUnavailableV1Error
  > {
    const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
      { deploymentId: attempt.selector.deploymentId, scopeId: attempt.selector.scopeId },
      {
        scopeMetadata: ports.scopeMetadata,
        provisioningReceipts: ports.provisioningReceipts,
        scopeClockTargets: ports.scopeSessionTargets,
      },
    ).pipe(
      Effect.mapError((cause) => new SessionJournalPersistenceV1Error({
        operation: "resolveJournalTarget",
        cause: cause instanceof TrustedScopeAuthorityPortError
          ? cause.cause
          : cause,
      })),
    );
    if (
      located.authority.scopeId !== attempt.selector.scopeId ||
      !isLocatedExactRunningAttemptKernelV1(located.target)
    ) {
      return yield* Effect.fail(new SessionJournalTargetUnavailableV1Error({
        scopeId: attempt.selector.scopeId,
      }));
    }
    return Object.freeze({
      target: located.target,
      authority: located.authority,
    });
  });

  const admitExactRunningAttemptEffect = Effect.fn(
    "SessionJournalStore.admitExactRunningAttempt",
  )(function* (
    resolved: ResolvedJournalTargetV1,
    attempt: SessionJournalAttemptStateV1,
    operation:
      | "openAttempt"
      | "resolvePinnedPointTable"
      | "resolveApplicationRelation"
      | "prepareSealSnapshot",
  ) {
    return yield* resolved.target[
      RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1
    ](
      {
        selector: attempt.selector,
        preliminaryAuthority: resolved.authority,
        executionClaim: attempt.executionClaim,
      },
      (_tx, context) => context.journalRoot.executionProfile === attempt.executionProfile &&
        (attempt.executionProfile !== "finiteRoot" ||
          context.journalRoot.state === "open" &&
          context.journalRoot.lastSyscallSequence === 0n)
        ? Effect.void
        : Effect.fail(corruption(attempt, "journalStateInvalid")),
    ).pipe(
      Effect.mapError((cause) => cause instanceof ExactRunningAttemptTransactionV1Error
        ? mapExactAdmissionFailure(operation, cause) : cause),
    );
  });

  const resolvePointTableEffect: SessionJournalStorePersistence[
    "resolvePointTableEffect"
  ] = Effect.fn("SessionJournalStore.resolvePointTable")(function* (
    attempt,
    tableNameInput,
  ) {
    const attemptState = typeof attempt === "object" && attempt !== null
      ? attemptStates.get(attempt)
      : undefined;
    if (attemptState === undefined) {
      return yield* Effect.fail(new InvalidSessionJournalCapabilityV1Error({
        capability: "attempt",
      }));
    }
    const tableName = yield* decodeSchemaManifestAppTableNameEffect(
      tableNameInput,
    ).pipe(
      Effect.mapError((cause) => new InvalidSessionJournalInputV1Error({
        operation: "resolvePointTable",
        reason: "invalidTableName",
        cause,
      })),
    );
    const resolved = yield* resolveJournalTargetEffect(attemptState);
    yield* admitExactRunningAttemptEffect(
      resolved,
      attemptState,
      "resolvePinnedPointTable",
    );
    const tableId = yield* resolved.target[
      RESOLVE_PINNED_POINT_TABLE_ID_EFFECT_V1
    ]({
      deploymentId: attemptState.selector.deploymentId,
      schemaVersionId: attemptState.schemaVersionId,
      tableName,
    }).pipe(Effect.mapError(mapPointTableResolutionFailure));
    const state = Object.freeze({
      attempt: attemptState,
      tableName,
      tableId,
    } satisfies PinnedPointTableStateV1);
    const handle = Object.freeze({
      [pinnedPointTableBrand]: true as const,
    });
    tableStates.set(handle, state);
    return handle;
  });

  const runPointOperationEffect: SessionJournalStorePersistence[
    "runPointOperationEffect"
  ] = Effect.fn("SessionJournalStore.runPointOperation")(function* (
    table,
    operation,
    validator,
  ) {
    const tableState = typeof table === "object" && table !== null
      ? tableStates.get(table)
      : undefined;
    if (tableState === undefined) {
      return yield* Effect.fail(new InvalidSessionJournalCapabilityV1Error({
        capability: "pointTable",
      }));
    }
    const request = yield* Effect.fromResult(
      captureStoredRequestResult(tableState, operation),
    );
    const requestEvidence = yield* canonicalizeStoredRequestEffect(request);
    const resolved = yield* resolveJournalTargetEffect(tableState.attempt);
    const applied = yield* resolved.target[
      RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1
    ](
      {
        selector: tableState.attempt.selector,
        preliminaryAuthority: resolved.authority,
        executionClaim: tableState.attempt.executionClaim,
      },
      (tx, context) => {
        const finite = finiteRootStates.get(tableState.attempt);
        if (tableState.attempt.executionProfile === "finiteRoot") {
          return finite === undefined
            ? Effect.fail(corruption(tableState.attempt, "journalStateInvalid"))
            : runFinitePointOperationInTransactionEffect(tx, context,
              tableState, request, requestEvidence, randomUuid, validator, finite);
        }
        return runPointOperationInTransactionEffect(tx, context, tableState,
          request, requestEvidence, randomUuid, validator);
      },
    ).pipe(
      Effect.onError(() => Effect.sync(() => {
        const finite = finiteRootStates.get(tableState.attempt);
        if (finite !== undefined) {
          finite.status = "aborted";
          discardFiniteRootEvidence(finite);
        }
      })),
      Effect.mapError((error) =>
        error instanceof ExactRunningAttemptTransactionV1Error
          ? mapExactRunningAttemptTransactionFailure(error)
          : error
      ),
    );
    const finite = finiteRootStates.get(tableState.attempt);
    if (finite?.status === "aborted") discardFiniteRootEvidence(finite);
    return projectPointOperationResult(applied);
  });

  const resolveDeveloperIndexEffect: SessionJournalStorePersistence[
    "resolveDeveloperIndexEffect"
  ] = Effect.fn("SessionJournalStore.resolveDeveloperIndex")(function* (
    table,
    indexDescriptorInput,
  ) {
    const tableState = typeof table === "object" && table !== null
      ? tableStates.get(table)
      : undefined;
    if (tableState === undefined) {
      return yield* Effect.fail(new InvalidSessionJournalCapabilityV1Error({
        capability: "pointTable",
      }));
    }
    const descriptor = yield* Schema.decodeUnknownEffect(
      Schema.toType(SchemaManifestAppIndexDescriptorSchema),
    )(indexDescriptorInput).pipe(
      Effect.mapError((cause) => new InvalidSessionJournalInputV1Error({
        operation: "resolveDeveloperIndex",
        reason: "invalidIndexDescriptor",
        cause,
      })),
    );
    if (
      indexedQueryPortState === undefined ||
      indexedQueryPortState.authority !== ports
    ) {
      return yield* Effect.fail(
        new SessionJournalDeveloperIndexUnavailableV1Error({
          reason: "invalidComposition",
        }),
      );
    }
    const resolved = yield* resolveJournalTargetEffect(tableState.attempt);
    const logicalIndexId = yield* resolved.target[
      RESOLVE_PINNED_DEVELOPER_INDEX_ID_EFFECT_V1
    ]({
      deploymentId: tableState.attempt.selector.deploymentId,
      schemaVersionId: tableState.attempt.schemaVersionId,
      tableId: tableState.tableId,
      descriptor,
    }).pipe(Effect.mapError(mapDeveloperIndexResolutionFailure));
    const definitions = yield* indexedQueryPortState.definitions.locate({
      deploymentId: tableState.attempt.selector.deploymentId,
      scopeId: tableState.attempt.selector.scopeId,
      schemaVersionId: tableState.attempt.schemaVersionId,
      tableIds: Object.freeze([tableState.tableId]),
      maximumDefinitions: MAX_SCHEMA_MANIFEST_APP_INDEXES_PER_TABLE,
    });
    const matches = definitions?.filter((definition) =>
      definition.access.kind === "developer" &&
      definition.access.logicalIndexId === logicalIndexId &&
      definition.access.tableId === tableState.tableId
    ) ?? [];
    if (matches.length !== 1) {
      return yield* Effect.fail(
        new SessionJournalDeveloperIndexUnavailableV1Error({
          reason: matches.length === 0
            ? "definitionNotFound"
            : "definitionMismatch",
        }),
      );
    }
    const state = Object.freeze({
      attempt: tableState.attempt,
      tableId: tableState.tableId,
      logicalIndexId,
      definition: matches[0]!,
    } satisfies PinnedDeveloperIndexStateV1);
    const handle = Object.freeze({
      [pinnedDeveloperIndexBrand]: true as const,
    });
    indexStates.set(handle, state);
    return handle;
  });

  const runIndexedQueryEffect: SessionJournalStorePersistence[
    "runIndexedQueryEffect"
  ] = Effect.fn("SessionJournalStore.runIndexedQuery")(function* (
    index,
    operation,
  ) {
    const state = typeof index === "object" && index !== null
      ? indexStates.get(index)
      : undefined;
    if (state === undefined) {
      return yield* Effect.fail(new InvalidSessionJournalCapabilityV1Error({
        capability: "developerIndex",
      }));
    }
    const request = yield* Effect.fromResult(
      captureIndexedQueryRequestResult(state, operation),
    );
    const requestEvidence = yield* canonicalizeStoredRequestEffect(request);
    const resolved = yield* resolveJournalTargetEffect(state.attempt);
    if (!isLocatedExactRunningAttemptReadSyscallKernelV1(resolved.target)) {
      return yield* Effect.fail(new SessionJournalTargetUnavailableV1Error({
        scopeId: state.attempt.selector.scopeId,
      }));
    }
    const applied = yield* resolved.target[
      RUN_EXACT_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT_V1
    ](
      {
        selector: state.attempt.selector,
        preliminaryAuthority: resolved.authority,
        executionClaim: state.attempt.executionClaim,
      },
      (tx, context) => {
        const finite = finiteRootStates.get(state.attempt);
        if (state.attempt.executionProfile === "finiteRoot") {
          return finite === undefined
            ? Effect.fail(corruption(state.attempt, "journalStateInvalid"))
            : runFiniteIndexedQueryInTransactionEffect(tx, context, state,
              request, requestEvidence, finite);
        }
        return runIndexedQueryInTransactionEffect(tx, context, state,
          request, requestEvidence, faultAfter);
      },
    ).pipe(
      Effect.onError(() => Effect.sync(() => {
        const finite = finiteRootStates.get(state.attempt);
        if (finite !== undefined) {
          finite.status = "aborted";
          discardFiniteRootEvidence(finite);
        }
      })),
      Effect.mapError((error) =>
        error instanceof ExactRunningAttemptTransactionV1Error
          ? mapExactRunningIndexedQueryFailure(error)
          : error
      ),
    );
    const finite = finiteRootStates.get(state.attempt);
    if (finite?.status === "aborted") discardFiniteRootEvidence(finite);
    return projectIndexedQueryResult(applied);
  });

  const resolveApplicationRelationReadEffect: SessionJournalStorePersistence[
    "resolveApplicationRelationReadEffect"
  ] = Effect.fn("SessionJournalStore.resolveApplicationRelationRead")(
    function* (attempt, capability) {
      const attemptState = typeof attempt === "object" && attempt !== null
        ? attemptStates.get(attempt)
        : undefined;
      if (attemptState === undefined) {
        return yield* Effect.fail(new InvalidSessionJournalCapabilityV1Error({
          capability: "attempt",
        }));
      }
      if (
        applicationRelationPort === undefined ||
        !applicationRelationCompositionIsExact
      ) {
        return yield* Effect.fail(
          new ApplicationRelationReadUnavailableError({
            reason: "invalidComposition",
          }),
        );
      }
      const resolved = yield* Effect.fromResult(
        applicationRelationPort.resolve(capability, {
          deploymentId: attemptState.selector.deploymentId,
          scopeId: attemptState.selector.scopeId,
          schemaVersionId: attemptState.schemaVersionId,
        }),
      );
      if (resolved.epoch !== attemptState.snapshotToken.epoch) {
        return yield* Effect.fail(new ApplicationRelationReadUnavailableError({
          reason: "capabilityMismatch",
        }));
      }
      const resolvedTarget = yield* resolveJournalTargetEffect(attemptState);
      yield* admitExactRunningAttemptEffect(
        resolvedTarget,
        attemptState,
        "resolveApplicationRelation",
      );
      const state = Object.freeze({
        attempt: attemptState,
        capability,
        resolved,
      } satisfies PinnedApplicationRelationReadState);
      const handle = Object.freeze({
        [pinnedApplicationRelationReadBrand]: true as const,
      });
      relationStates.set(handle, state);
      return handle;
    },
  );

  const runApplicationRelationIncomingReadEffect:
    SessionJournalStorePersistence[
      "runApplicationRelationIncomingReadEffect"
    ] = Effect.fn("SessionJournalStore.runApplicationRelationIncomingRead")(
      function* (relation, operation) {
        const state = typeof relation === "object" && relation !== null
          ? relationStates.get(relation)
          : undefined;
        if (state === undefined) {
          return yield* Effect.fail(
            new InvalidSessionJournalCapabilityV1Error({
              capability: "applicationRelation",
            }),
          );
        }
        const relationPort = applicationRelationPort;
        if (
          relationPort === undefined ||
          !applicationRelationCompositionIsExact
        ) {
          return yield* Effect.fail(
            new ApplicationRelationReadUnavailableError({
              reason: "invalidComposition",
            }),
          );
        }
        const request = yield* Effect.fromResult(
          captureApplicationRelationIncomingRequestResult(state, operation),
        );
        const requestEvidence = yield* canonicalizeStoredRequestEffect(request);
        const resolved = yield* resolveJournalTargetEffect(state.attempt);
        if (!isLocatedExactRunningAttemptReadSyscallKernelV1(resolved.target)) {
          return yield* Effect.fail(new SessionJournalTargetUnavailableV1Error({
            scopeId: state.attempt.selector.scopeId,
          }));
        }
        const applied = yield* resolved.target[
          RUN_EXACT_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT_V1
        ](
          {
            selector: state.attempt.selector,
            preliminaryAuthority: resolved.authority,
            executionClaim: state.attempt.executionClaim,
          },
          (tx, context) => {
            const finite = finiteRootStates.get(state.attempt);
            if (state.attempt.executionProfile === "finiteRoot") {
              return finite === undefined
                ? Effect.fail(corruption(state.attempt, "journalStateInvalid"))
                : runFiniteApplicationRelationIncomingInTransactionEffect(
                  tx, context, state, request, requestEvidence, relationPort,
                  finite);
            }
            return runApplicationRelationIncomingInTransactionEffect(tx,
              context, state, request, requestEvidence, relationPort, faultAfter);
          },
        ).pipe(
          Effect.onError(() => Effect.sync(() => {
            const finite = finiteRootStates.get(state.attempt);
            if (finite !== undefined) {
              finite.status = "aborted";
              discardFiniteRootEvidence(finite);
            }
          })),
          Effect.mapError((error) =>
            error instanceof ExactRunningAttemptTransactionV1Error
              ? mapExactRunningApplicationRelationFailure(error)
              : error
          ),
        );
        const finite = finiteRootStates.get(state.attempt);
        if (finite?.status === "aborted") discardFiniteRootEvidence(finite);
        return projectApplicationRelationIncomingResult(applied, request);
      },
    );

  const prepareSealEffect: SessionJournalStorePersistence[
    "prepareSealEffect"
  ] = Effect.fn("SessionJournalStore.prepareSeal")(function* (attempt) {
    const attemptState = typeof attempt === "object" && attempt !== null
      ? attemptStates.get(attempt)
      : undefined;
    if (attemptState === undefined) {
      return yield* Effect.fail(new InvalidSessionJournalCapabilityV1Error({
        capability: "attempt",
      }));
    }
    if (attemptState.executionProfile === "finiteRoot") {
      return yield* Effect.fail(corruption(attemptState,
        "journalStateInvalid"));
    }
    const resolved = yield* resolveJournalTargetEffect(attemptState);
    yield* admitExactRunningAttemptEffect(
      resolved,
      attemptState,
      "prepareSealSnapshot",
    );
    const snapshot = yield* Effect.uninterruptible(
      Effect.tryPromise({
        try: () => resolved.target[RUN_LOCATED_REPEATABLE_READ_V1](
          (tx) => captureSealRowsInTransaction(
            tx,
            attemptState,
            resolved.authority,
          ),
        ),
        catch: mapPrepareSealSnapshotFailure,
      }),
    );
    const candidate = detachSealCandidate(
      yield* materializeSealCandidateEffect(attemptState, snapshot),
    );
    const handle = Object.freeze({
      [preparedSessionJournalSealBrand]: true as const,
    });
    sealStates.set(handle, Object.freeze({
      attempt: attemptState,
      candidate,
    }));
    return Object.freeze({
      preparation: handle,
      journal: structuredClone(candidate.journal),
    });
  });

  const completeSealEffect: SessionJournalStorePersistence[
    "completeSealEffect"
  ] = Effect.fn("SessionJournalStore.completeSeal")(function* (
    preparation,
    journal,
    successfulResult,
  ) {
    const prepared = typeof preparation === "object" && preparation !== null
      ? sealStates.get(preparation)
      : undefined;
    if (prepared === undefined) {
      return yield* Effect.fail(new InvalidSessionJournalCapabilityV1Error({
        capability: "sealPreparation",
      }));
    }
    if (prepared.attempt.executionProfile === "finiteRoot") {
      return yield* Effect.fail(corruption(prepared.attempt,
        "journalStateInvalid"));
    }
    const sealedEvidence = yield* validateCanonicalSealEvidenceEffect(
      prepared.candidate,
      journal,
      successfulResult,
    );
    const resolved = yield* resolveJournalTargetEffect(prepared.attempt);
    return yield* Effect.uninterruptible(Effect.gen(function* () {
      const envelope = yield* resolved.target[
        RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1
      ](
        {
          selector: prepared.attempt.selector,
          preliminaryAuthority: resolved.authority,
          executionClaim: prepared.attempt.executionClaim,
        },
        (tx, context) => completeSealInTransactionEffect(
          tx,
          context,
          prepared,
          sealedEvidence,
          maximumLiveSnapshotRetentionMilliseconds,
        ),
      ).pipe(
        Effect.mapError((error) =>
          error instanceof ExactRunningAttemptTransactionV1Error
            ? mapExactRunningAttemptCompleteSealFailure(error)
            : error
        ),
      );
      sealStates.delete(preparation);
      return envelope;
    }));
  });

  const sealFiniteRootEffect: SessionJournalStorePersistence[
    "sealFiniteRootEffect"
  ] = Effect.fn("SessionJournalStore.sealFiniteRoot")(function* (
    attempt,
    successfulResult,
  ) {
    const attemptState = typeof attempt === "object" && attempt !== null
      ? attemptStates.get(attempt) : undefined;
    if (attemptState === undefined) {
      return yield* Effect.fail(new InvalidSessionJournalCapabilityV1Error({
        capability: "attempt",
      }));
    }
    const finite = finiteRootStates.get(attemptState);
    if (attemptState.executionProfile !== "finiteRoot" || finite === undefined) {
      return yield* Effect.fail(corruption(attemptState, "journalStateInvalid"));
    }
    if (finite.status !== "open" ||
      finite.entries.size !== Number(finite.lastSequence)) {
      return yield* Effect.fail(new SessionJournalSealV1Error({
        reason: "journalFailed",
        cause: Object.freeze({ kind: "finiteRootSealInvariant",
          status: finite.status,
          entryCount: finite.entries.size,
          lastSequence: String(finite.lastSequence) }),
      }));
    }
    const resolved = yield* resolveJournalTargetEffect(attemptState);
    finite.status = "sealing";
    const sealed = yield* Effect.uninterruptible(resolved.target[
      RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1
    ]({
      selector: attemptState.selector,
      preliminaryAuthority: resolved.authority,
      executionClaim: attemptState.executionClaim,
    }, (tx, context) => Effect.gen(function* () {
      yield* withSharedLogicalSourceBindingChecks(tx, () => Effect.gen(function* () {
        for (const entry of finite.entries.values()) {
          if (entry.kind !== "admitted") continue;
          yield* requireAdmittedBundleSourcesInTransactionEffect(entry.admission, attempt,
            entry.request, tx, resolved.authority, context.scopeClock);
        }
      })).pipe(Effect.mapError(cause => new SessionJournalSealV1Error({
        reason: "journalFailed", cause,
      })));
      yield* Effect.tryPromise({
        try: () => stageFiniteRootRows(tx, context, attemptState, finite,
          "seal"),
        catch: cause => cause instanceof SessionJournalStorageCorruptionV1Error
          ? cause : new SessionJournalPersistenceV1Error({
            operation: "completeSealTransaction", cause,
          }),
      });
      const rows = yield* Effect.tryPromise({
        try: () => captureSealRowsInTransaction(tx, attemptState,
          resolved.authority),
        catch: mapPrepareSealSnapshotFailure,
      });
      const candidate = yield* materializeSealCandidateEffect(attemptState,
        rows);
      const canonical = yield* canonicalizeSessionJournalEffect(
        candidate.journal).pipe(Effect.mapError(() =>
          new SessionJournalSealV1Error({
            reason: "canonicalJournalMismatch",
          })));
      const evidence = yield* validateCanonicalSealEvidenceEffect(candidate,
        canonical, successfulResult);
      const envelope = yield* completeSealInTransactionEffect(tx,
        { ...context, journalRoot: rows.root },
        { attempt: attemptState, candidate }, evidence,
        maximumLiveSnapshotRetentionMilliseconds);
      return Object.freeze({ envelope,
        journalByteLength: evidence.journalBytes.byteLength });
    })).pipe(Effect.mapError(error =>
      error instanceof ExactRunningAttemptTransactionV1Error
        ? mapExactRunningAttemptCompleteSealFailure(error) : error,
    ))).pipe(Effect.onError(() => Effect.sync(() => {
      // A lost COMMIT acknowledgement may already have sealed the root. The
      // caller resolves that durable outcome; local children never reopen.
      finite.status = "aborted";
      discardFiniteRootEvidence(finite);
    })));
    finite.status = "sealed";
    discardFiniteRootEvidence(finite);
    for (const [key, owner] of finiteClaims) {
      if (owner.state === finite) finiteClaims.delete(key);
    }
    return sealed;
  });

  const discardFiniteRootEffect: SessionJournalStorePersistence[
    "discardFiniteRootEffect"
  ] = Effect.fn("SessionJournalStore.discardFiniteRoot")(function* (attempt) {
    const state = typeof attempt === "object" && attempt !== null
      ? attemptStates.get(attempt) : undefined;
    const finite = state === undefined ? undefined : finiteRootStates.get(state);
    if (state?.executionProfile !== "finiteRoot" || finite === undefined) {
      return yield* Effect.fail(new InvalidSessionJournalCapabilityV1Error({
        capability: "attempt",
      }));
    }
    finite.status = "aborted";
    discardFiniteRootEvidence(finite);
  });

  return Object.freeze({
    admitLogicalParticipantsEffect,
    runAdmittedOperationEffect,
    openAttemptEffect,
    resolvePointTableEffect,
    runPointOperationEffect,
    resolveDeveloperIndexEffect,
    runIndexedQueryEffect,
    resolveApplicationRelationReadEffect,
    runApplicationRelationIncomingReadEffect,
    prepareSealEffect,
    completeSealEffect,
    sealFiniteRootEffect,
    discardFiniteRootEffect,
  });
}

function mapPointTableResolutionFailure(
  cause:
    | PinnedPointTableCorruptionV1Error
    | PinnedPointTableNotFoundV1Error
    | PinnedPointTablePersistenceV1Error,
):
  | PinnedPointTableCorruptionV1Error
  | PinnedPointTableNotFoundV1Error
  | SessionJournalPersistenceV1Error {
  return cause instanceof PinnedPointTablePersistenceV1Error
    ? new SessionJournalPersistenceV1Error({
        operation: "resolvePinnedPointTable",
        cause: cause.cause,
      })
    : cause;
}

function mapDeveloperIndexResolutionFailure(
  cause:
    | PinnedDeveloperIndexCorruptionV1Error
    | PinnedDeveloperIndexNotFoundV1Error
    | PinnedDeveloperIndexPersistenceV1Error,
):
  | SessionJournalDeveloperIndexUnavailableV1Error
  | SessionJournalPersistenceV1Error {
  if (cause instanceof PinnedDeveloperIndexPersistenceV1Error) {
    return new SessionJournalPersistenceV1Error({
      operation: "resolveDeveloperIndex",
      cause: cause.cause,
    });
  }
  return new SessionJournalDeveloperIndexUnavailableV1Error({
    reason: cause instanceof PinnedDeveloperIndexNotFoundV1Error
      ? "definitionNotFound"
      : "definitionMismatch",
  });
}

function mapPrepareSealSnapshotFailure(
  cause: unknown,
): SessionJournalPrepareSealV1Error {
  if (
    cause instanceof SessionJournalPersistenceV1Error ||
    cause instanceof SessionJournalSealV1Error ||
    cause instanceof SessionJournalStorageCorruptionV1Error ||
    cause instanceof SessionJournalTargetUnavailableV1Error
  ) {
    return cause;
  }
  return new SessionJournalPersistenceV1Error({
    operation: "prepareSealSnapshot",
    cause,
  });
}

function mapCompleteSealTransactionFailure(
  cause: unknown,
): SessionJournalCompleteSealV1Error {
  if (cause instanceof PointMutationSessionAuthorityCorruptionV1Error) {
    return mapSessionAuthorityCorruption(cause);
  }
  if (cause instanceof PointMutationSessionAttemptLoadV1Error) {
    return new SessionJournalAttemptUnavailableV1Error({
      issue: cause.issue,
    });
  }
  if (
    cause instanceof InvalidSessionJournalCapabilityV1Error ||
    cause instanceof SessionJournalAttemptUnavailableV1Error ||
    cause instanceof SessionJournalLeasePromotionV1Error ||
    cause instanceof SessionJournalPersistenceV1Error ||
    cause instanceof SessionJournalSealV1Error ||
    cause instanceof SessionJournalStorageCorruptionV1Error ||
    cause instanceof SessionJournalTargetUnavailableV1Error
  ) {
    return cause;
  }
  return new SessionJournalPersistenceV1Error({
    operation: "completeSealTransaction",
    cause,
  });
}

function mapExactRunningAttemptCompleteSealFailure(
  failure: ExactRunningAttemptTransactionV1Error,
): SessionJournalCompleteSealV1Error {
  if (failure.callbackCause === undefined) {
    return mapCompleteSealTransactionFailure(failure.cause);
  }
  return new SessionJournalPersistenceV1Error({
    operation: "completeSealTransaction",
    cause: failure,
  });
}

interface ResolvedJournalTargetV1 {
  readonly target: LocatedExactRunningAttemptKernelV1;
  readonly authority: TrustedScopeAuthority;
}

function mapExactAdmissionFailure(
  operation:
    | "openAttempt"
    | "resolvePinnedPointTable"
    | "resolveApplicationRelation"
    | "prepareSealSnapshot"
    | "runAdmittedOperation",
  cause: ExactRunningAttemptTransactionV1Error,
): SessionJournalAttemptUnavailableV1Error |
  SessionJournalStorageCorruptionV1Error |
  SessionJournalPersistenceV1Error {
  if (
    cause.callbackCause === undefined &&
    cause.cause instanceof PointMutationSessionAttemptLoadV1Error
  ) {
    return new SessionJournalAttemptUnavailableV1Error({
      issue: cause.cause.issue,
    });
  }
  if (
    cause.callbackCause === undefined &&
    cause.cause instanceof PointMutationSessionAuthorityCorruptionV1Error
  ) {
    return mapSessionAuthorityCorruption(cause.cause);
  }
  return new SessionJournalPersistenceV1Error({ operation, cause });
}

function captureAttemptStateResult(
  input: OpenSessionJournalAttemptInput,
): Result.Result<
  SessionJournalAttemptStateV1,
  InvalidSessionJournalInputV1Error
> {
  return Result.gen(function* () {
    const selectorInput = yield* readOpenAttemptInput(() => input.selector);
    const deploymentId = yield* readOpenAttemptInput(
      () => selectorInput.deploymentId,
    );
    const scopeId = yield* readOpenAttemptInput(() => selectorInput.scopeId);
    const sessionIdInput = yield* readOpenAttemptInput(
      () => selectorInput.sessionId,
    );
    const sessionId = yield* decodeTransactionSessionIdResult(
      sessionIdInput,
    ).pipe(Result.mapError(invalidAttemptPins));
    const attemptFenceInput = yield* readOpenAttemptInput(
      () => selectorInput.attemptFence,
    );
    const attemptFence = yield* decodeTransactionAttemptFenceResult(
      attemptFenceInput,
    ).pipe(Result.mapError(invalidAttemptPins));
    const selector = Object.freeze({
      deploymentId,
      scopeId,
      sessionId,
      attemptFence,
    } satisfies PointMutationSessionAttemptSelectorV1);
    const snapshotTokenInput = yield* readOpenAttemptInput(
      () => input.snapshotToken,
    );
    const snapshotScopeId = yield* readOpenAttemptInput(
      () => snapshotTokenInput.scopeId,
    );
    const snapshotEpoch = yield* readOpenAttemptInput(
      () => snapshotTokenInput.epoch,
    );
    const snapshotCommitSeq = yield* readOpenAttemptInput(
      () => snapshotTokenInput.commitSeq,
    );
    const snapshotToken = Object.freeze(
      yield* decodeSnapshotTokenResult({
        scopeId: snapshotScopeId,
        epoch: snapshotEpoch,
        commitSeq: snapshotCommitSeq,
      }).pipe(Result.mapError(invalidAttemptPins)),
    );
    if (snapshotToken.scopeId !== selector.scopeId) {
      return yield* Result.fail(invalidAttemptPins(
        new Error("Snapshot scope does not match the attempt selector."),
      ));
    }
    const schemaVersionIdInput = yield* readOpenAttemptInput(
      () => input.schemaVersionId,
    );
    const schemaVersionId = yield* decodeCatalogSchemaVersionIdResult(
      schemaVersionIdInput,
    ).pipe(Result.mapError(invalidAttemptPins));
    const executionClaimInput = yield* readOpenAttemptInput(
      () => input.executionClaim,
    );
    const claimOwnerInput = yield* readOpenAttemptInput(
      () => executionClaimInput.claimOwner,
    );
    const claimFenceInput = yield* readOpenAttemptInput(
      () => executionClaimInput.claimFence,
    );
    const claimOwner = yield* decodeExecutionClaimOwnerResult(
      claimOwnerInput,
    ).pipe(Result.mapError(invalidAttemptPins));
    const claimFence = yield* decodeExecutionClaimFenceResult(
      claimFenceInput,
    ).pipe(Result.mapError(invalidAttemptPins));
    const executionProfile = yield* readOpenAttemptInput(
      () => input.executionProfile ?? "durableOperations",
    );
    if (executionProfile !== "durableOperations" &&
      executionProfile !== "finiteRoot") {
      return yield* Result.fail(invalidAttemptPins(
        new Error("Unknown journal execution profile."),
      ));
    }
    return Object.freeze({
      selector,
      snapshotToken,
      schemaVersionId,
      executionClaim: Object.freeze({ claimOwner, claimFence }),
      executionProfile,
    });
  });
}

function readOpenAttemptInput<A>(
  read: () => A,
): Result.Result<A, InvalidSessionJournalInputV1Error> {
  return Result.try({
    try: read,
    catch: invalidAttemptPins,
  });
}

function invalidAttemptPins(cause: unknown): InvalidSessionJournalInputV1Error {
  return new InvalidSessionJournalInputV1Error({
    operation: "openAttempt",
    reason: "invalidAttemptPins",
    cause,
  });
}

function captureStoredRequestResult(
  table: PinnedPointTableStateV1,
  operation: SessionJournalPointOperationV1,
): Result.Result<
  SessionJournalStoredPointRequest,
  InvalidSessionJournalInputV1Error
> {
  return Result.gen(function* () {
    // Preserve the compatibility boundary's observable caller-access order:
    // syscall sequence first, then the discriminant used to classify failure.
    const syscallSequenceInput = yield* Result.try({
      try: () => operation.syscallSequence,
      catch: (cause) => invalidPointOperation(operation.kind, cause),
    });
    const syscallSequence = yield* decodeCommitSyscallSequenceResult(
      syscallSequenceInput,
    ).pipe(Result.mapError((cause) =>
      invalidPointOperation(operation.kind, cause)
    ));
    const capturedOperation = yield* capturePointOperationInputResult(operation);
    switch (capturedOperation.kind) {
      case "get": {
        const documentId = yield* readPointOperationInput(
          capturedOperation.source,
          () => capturedOperation.source.documentId,
        );
        const identity = yield* requireAppDocumentIdentityV1ForTableResult(
          documentId,
          table.tableId,
        ).pipe(Result.mapError((cause) =>
          invalidPointOperation(capturedOperation.source.kind, cause)
        ));
        return Object.freeze({
          format: "flarex.session-journal-syscall",
          codecVersion: 2,
          kind: "get",
          syscallSequence,
          tableId: table.tableId,
          documentId: identity.id,
        });
      }
      case "insert": {
        const fields = yield* readPointOperationInput(
          capturedOperation.source,
          () => capturedOperation.source.fields,
        );
        return Object.freeze({
          format: "flarex.session-journal-syscall",
          codecVersion: 2,
          kind: "insert",
          syscallSequence,
          tableId: table.tableId,
          fieldsValueJson: yield* captureDeveloperFieldsValueJsonResult(
            fields,
            capturedOperation.source,
          ),
        });
      }
      case "patch": {
        const documentId = yield* readPointOperationInput(
          capturedOperation.source,
          () => capturedOperation.source.documentId,
        );
        const identity = yield* requireAppDocumentIdentityV1ForTableResult(
          documentId,
          table.tableId,
        ).pipe(Result.mapError((cause) =>
          invalidPointOperation(capturedOperation.source.kind, cause)
        ));
        const patch = yield* readPointOperationInput(
          capturedOperation.source,
          () => capturedOperation.source.patch,
        );
        return Object.freeze({
          format: "flarex.session-journal-syscall",
          codecVersion: 2,
          kind: "patch",
          syscallSequence,
          tableId: table.tableId,
          documentId: identity.id,
          changes: yield* capturePatchChangesResult(
            patch,
            capturedOperation.source,
          ),
        });
      }
      case "replace": {
        const documentId = yield* readPointOperationInput(
          capturedOperation.source,
          () => capturedOperation.source.documentId,
        );
        const identity = yield* requireAppDocumentIdentityV1ForTableResult(
          documentId,
          table.tableId,
        ).pipe(Result.mapError((cause) =>
          invalidPointOperation(capturedOperation.source.kind, cause)
        ));
        const fields = yield* readPointOperationInput(
          capturedOperation.source,
          () => capturedOperation.source.fields,
        );
        return Object.freeze({
          format: "flarex.session-journal-syscall",
          codecVersion: 2,
          kind: "replace",
          syscallSequence,
          tableId: table.tableId,
          documentId: identity.id,
          fieldsValueJson: yield* captureDeveloperFieldsValueJsonResult(
            fields,
            capturedOperation.source,
          ),
        });
      }
      case "delete": {
        const documentId = yield* readPointOperationInput(
          capturedOperation.source,
          () => capturedOperation.source.documentId,
        );
        const identity = yield* requireAppDocumentIdentityV1ForTableResult(
          documentId,
          table.tableId,
        ).pipe(Result.mapError((cause) =>
          invalidPointOperation(capturedOperation.source.kind, cause)
        ));
        return Object.freeze({
          format: "flarex.session-journal-syscall",
          codecVersion: 2,
          kind: "delete",
          syscallSequence,
          tableId: table.tableId,
          documentId: identity.id,
        });
      }
    }
  });
}

function captureIndexedQueryRequestResult(
  index: PinnedDeveloperIndexStateV1,
  operation: SessionJournalIndexedQueryOperationV1,
): Result.Result<
  Extract<SessionJournalStoredRequest, { readonly kind: "indexRange" }>,
  InvalidSessionJournalInputV1Error
> {
  return Result.gen(function* () {
    const syscallSequence = yield* Result.try({
      try: () => operation.syscallSequence,
      catch: (cause) => invalidIndexedQueryOperation(cause),
    }).pipe(
      Result.flatMap(decodeCommitSyscallSequenceResult),
      Result.mapError(invalidIndexedQueryOperation),
    );
    const bounds = yield* Result.try({
      try: () => operation.bounds,
      catch: (cause) => invalidIndexedQueryOperation(cause),
    });
    if (!isNonArrayRecord(bounds)) {
      return yield* Result.fail(invalidIndexedQueryOperation(
        new Error("Indexed query bounds must be an object."),
      ));
    }
    const capturedBounds = yield* Result.try({
      try: () => ({
        startInclusive: bounds.startInclusive,
        endExclusive: bounds.endExclusive,
      }),
      catch: (cause) => invalidIndexedQueryOperation(cause),
    });
    const startInclusive = capturedBounds.startInclusive === undefined
      ? null
      : yield* decodeOrderedIndexBoundHexV1Result(
        capturedBounds.startInclusive,
      ).pipe(Result.mapError(invalidIndexedQueryOperation));
    const endExclusive = capturedBounds.endExclusive === undefined
      ? null
      : yield* decodeOrderedIndexBoundHexV1Result(
        capturedBounds.endExclusive,
      ).pipe(Result.mapError(invalidIndexedQueryOperation));
    if (
      startInclusive !== null &&
      endExclusive !== null &&
      compareUtf16Strings(startInclusive, endExclusive) >= 0
    ) {
      return yield* Result.fail(invalidIndexedQueryOperation(
        new Error("Indexed query bounds must describe a non-empty interval."),
      ));
    }
    const limit = yield* Result.try({
      try: () => operation.limit,
      catch: (cause) => invalidIndexedQueryOperation(cause),
    });
    if (
      !isPositiveSafeInteger(limit) ||
      limit > MAX_COMMIT_INDEXED_QUERY_PAGE_SIZE_V1
    ) {
      return yield* Result.fail(invalidIndexedQueryOperation(
        new Error(
          `Indexed query limit must be between 1 and ${MAX_COMMIT_INDEXED_QUERY_PAGE_SIZE_V1}.`,
        ),
      ));
    }
    return Object.freeze({
      format: "flarex.session-journal-syscall" as const,
      codecVersion: 2 as const,
      kind: "indexRange" as const,
      syscallSequence,
      tableId: index.tableId,
      logicalIndexId: index.logicalIndexId,
      indexDefinitionId: index.definition.indexDefinitionId,
      startInclusive,
      endExclusive,
      limit,
    });
  });
}

function captureApplicationRelationIncomingRequestResult(
  relation: PinnedApplicationRelationReadState,
  operation: SessionJournalRelationIncomingOperationV1,
): Result.Result<
  Extract<SessionJournalStoredRequest, {
    readonly kind: "relationIncoming";
  }>,
  InvalidSessionJournalInputV1Error
> {
  return Result.gen(function* () {
    const exactOperation = yield* Result.try({
      try: () => hasExactOwnDataKeys(operation, [
        "kind",
        "syscallSequence",
        "targetDocumentId",
        "limit",
      ]),
      catch: invalidApplicationRelationOperation,
    });
    if (!exactOperation) {
      return yield* Result.fail(invalidApplicationRelationOperation(
        new Error("Incoming relation operation has an unsupported shape."),
      ));
    }
    const captured = yield* Result.try({
      try: () => ({
        syscallSequence: operation.syscallSequence,
        kind: operation.kind,
        targetDocumentId: operation.targetDocumentId,
        limit: operation.limit,
      }),
      catch: invalidApplicationRelationOperation,
    });
    if (captured.kind !== "relationIncoming") {
      return yield* Result.fail(invalidApplicationRelationOperation(
        new Error("Expected an incoming relation read operation."),
      ));
    }
    const syscallSequence = yield* decodeCommitSyscallSequenceResult(
      captured.syscallSequence,
    ).pipe(Result.mapError(invalidApplicationRelationOperation));
    const definition = relation.resolved.definition;
    const target = yield* requireAppDocumentIdentityV1ForTableResult(
      captured.targetDocumentId,
      definition.binding.targetTableId,
    ).pipe(Result.mapError(invalidApplicationRelationOperation));
    if (
      !isPositiveSafeInteger(captured.limit) ||
      captured.limit > RELATION_INCOMING_PAGE_MAXIMUM_IDENTITIES_V1
    ) {
      return yield* Result.fail(invalidApplicationRelationOperation(
        new Error(
          `Incoming relation limit must be between 1 and ${RELATION_INCOMING_PAGE_MAXIMUM_IDENTITIES_V1}.`,
        ),
      ));
    }
    return Object.freeze({
      format: "flarex.session-journal-syscall" as const,
      codecVersion: 2 as const,
      kind: "relationIncoming" as const,
      syscallSequence,
      relationId: definition.binding.relationId,
      edgeDefinitionId: definition.edge.edgeDefinitionId,
      sourceTableId: definition.binding.sourceTableId,
      targetTableId: definition.binding.targetTableId,
      targetRowId: target.rowId,
      limit: captured.limit,
    });
  });
}

function invalidApplicationRelationOperation(
  cause: unknown,
): InvalidSessionJournalInputV1Error {
  return new InvalidSessionJournalInputV1Error({
    operation: "relationIncoming",
    reason: "invalidOperation",
    cause,
  });
}

function invalidIndexedQueryOperation(
  cause: unknown,
): InvalidSessionJournalInputV1Error {
  return new InvalidSessionJournalInputV1Error({
    operation: "indexRange",
    reason: "invalidOperation",
    cause,
  });
}

type CapturedPointOperationInputV1 = {
  readonly [Kind in SessionJournalPointOperationKindV1]: Readonly<{
    readonly kind: Kind;
    readonly source: Extract<SessionJournalPointOperationV1, { kind: Kind }>;
  }>;
}[SessionJournalPointOperationKindV1];

function capturePointOperationInputResult(
  operation: SessionJournalPointOperationV1,
): Result.Result<
  CapturedPointOperationInputV1,
  InvalidSessionJournalInputV1Error
> {
  return Result.try({
    try: () => {
      const operationKind = operation.kind;
      switch (operationKind) {
        case "get":
          return { kind: operationKind, source: operation };
        case "insert":
          return { kind: operationKind, source: operation };
        case "patch":
          return { kind: operationKind, source: operation };
        case "replace":
          return { kind: operationKind, source: operation };
        case "delete":
          return { kind: operationKind, source: operation };
      }
    },
    catch: (cause) => invalidPointOperation(operation.kind, cause),
  });
}

function readPointOperationInput<A>(
  operation: SessionJournalPointOperationV1,
  read: () => A,
): Result.Result<A, InvalidSessionJournalInputV1Error> {
  return Result.try({
    try: read,
    catch: (cause) => invalidPointOperation(operation.kind, cause),
  });
}

function invalidPointOperation(
  operation: SessionJournalPointOperationKindV1,
  cause: unknown,
): InvalidSessionJournalInputV1Error {
  return new InvalidSessionJournalInputV1Error({
    operation,
    reason: "invalidOperation",
    cause,
  });
}

/**
 * Temporary compatibility seam for the protocol's throwing value normalizer.
 * Delete this adapter when Value Codec V1 exposes its Result-native decoder.
 */
function normalizePointOperationValueResult(
  input: unknown,
  profile: "appDocument" | "generalValue",
  operation: SessionJournalPointOperationV1,
): Result.Result<
  ReturnType<typeof normalizeFlarexValueV1>,
  InvalidSessionJournalInputV1Error
> {
  return Result.try({
    try: () => normalizeFlarexValueV1(input, profile),
    catch: (cause) => {
      if (cause instanceof FlarexValueCodecV1Error) {
        return invalidPointOperation(operation.kind, cause);
      }
      throw cause;
    },
  });
}

function captureDeveloperFieldsValueJsonResult(
  input: unknown,
  operation: SessionJournalPointOperationV1,
): Result.Result<JsonObject, InvalidSessionJournalInputV1Error> {
  return Result.gen(function* () {
    const normalized = yield* normalizePointOperationValueResult(
      input,
      "appDocument",
      operation,
    );
    if (!isCanonicalFlarexRuntimeObjectV1(normalized.value)) {
      throw new Error("App-document normalization returned a non-object.");
    }
    for (const field of ["_id", "_creationTime"] as const) {
      if (Object.hasOwn(normalized.value, field)) {
        return yield* Result.fail(invalidPointOperation(
          operation.kind,
          new Error(`Developer fields contain reserved field ${field}.`),
        ));
      }
    }
    if (!isJsonObject(normalized.valueJson)) {
      throw new Error("App-document JSON normalization returned a non-object.");
    }
    return cloneJsonObject(normalized.valueJson);
  });
}

function capturePatchChangesResult(
  input: unknown,
  operation: SessionJournalPointOperationV1,
): Result.Result<
  ReadonlyArray<LogicalPatchFieldV1>,
  InvalidSessionJournalInputV1Error
> {
  return Result.gen(function* () {
    const patch = yield* readPointOperationInput(operation, () =>
      isPlainObject(input) ? input : undefined
    );
    if (patch === undefined) {
      return yield* Result.fail(invalidPointOperation(
        operation.kind,
        new Error("Patch must be a plain object."),
      ));
    }
    const symbols = yield* readPointOperationInput(
      operation,
      () => Object.getOwnPropertySymbols(patch),
    );
    if (symbols.length > 0) {
      return yield* Result.fail(invalidPointOperation(
        operation.kind,
        new Error("Patch cannot contain symbol fields."),
      ));
    }
    const fields = yield* readPointOperationInput(
      operation,
      () => Object.keys(patch),
    );
    fields.sort(compareUtf16Strings);
    if (fields.length > MAX_FLAREX_VALUE_OBJECT_FIELDS_V1) {
      return yield* Result.fail(invalidPointOperation(
        operation.kind,
        new Error(
          `Patch exceeds the ${MAX_FLAREX_VALUE_OBJECT_FIELDS_V1}-field limit.`,
        ),
      ));
    }
    const changes: LogicalPatchFieldV1[] = [];
    for (const field of fields) {
      if (field === "_id" || field === "_creationTime") {
        return yield* Result.fail(invalidPointOperation(
          operation.kind,
          new Error(`Patch cannot modify reserved field ${field}.`),
        ));
      }
      const descriptor = yield* readPointOperationInput(
        operation,
        () => Object.getOwnPropertyDescriptor(patch, field),
      );
      if (
        descriptor === undefined ||
        descriptor.enumerable !== true ||
        !("value" in descriptor)
      ) {
        return yield* Result.fail(invalidPointOperation(
          operation.kind,
          new Error(`Patch field ${field} must be an enumerable data field.`),
        ));
      }
      if (descriptor.value === undefined) {
        yield* normalizePointOperationValueResult(
          { [field]: null },
          "appDocument",
          operation,
        );
        changes.push(Object.freeze({ kind: "remove", field }));
        continue;
      }
      const fieldContainer = Object.create(null);
      Object.defineProperty(fieldContainer, field, {
        value: descriptor.value,
        enumerable: true,
        configurable: false,
        writable: false,
      });
      const normalized = yield* normalizePointOperationValueResult(
        fieldContainer,
        "generalValue",
        operation,
      );
      if (!isJsonObject(normalized.valueJson)) {
        throw new Error(`Patch field ${field} did not normalize as an object.`);
      }
      const valueJson = normalized.valueJson[field];
      if (valueJson === undefined) {
        throw new Error(`Patch field ${field} was lost during normalization.`);
      }
      changes.push(Object.freeze({
        kind: "set",
        field,
        valueJson,
      }));
    }
    return Object.freeze(changes);
  });
}

const canonicalizeStoredRequestEffect = Effect.fn(
  "SessionJournalStore.canonicalizeStoredRequest",
)(function* (
  request: SessionJournalStoredRequest,
): Effect.fn.Return<
  CanonicalFlarexValueV1,
  SessionJournalPersistenceV1Error
> {
  const encoded = encodeStoredRequest(request);
  const json = requireJson(encoded);
  return yield* Effect.tryPromise({
    try: () => canonicalizeFlarexValueJsonV1(json),
    catch: (cause) => new SessionJournalPersistenceV1Error({
      operation: "canonicalizeRequest",
      cause,
    }),
  });
});

function mapRunPointOperationFailure(
  cause: unknown,
): SessionJournalRunPointOperationV1Error {
  if (cause instanceof PointMutationSessionAuthorityCorruptionV1Error) {
    return mapSessionAuthorityCorruption(cause);
  }
  if (
    cause instanceof PointMutationSessionAttemptLoadV1Error
  ) {
    return new SessionJournalAttemptUnavailableV1Error({
      issue: cause.issue,
    });
  }
  if (
    cause instanceof ApplicationTableWriteDeniedError ||
    cause instanceof InvalidSessionJournalCapabilityV1Error ||
    cause instanceof InvalidSessionJournalInputV1Error ||
    cause instanceof SessionJournalAttemptUnavailableV1Error ||
    cause instanceof SessionJournalIdentityGenerationV1Error ||
    cause instanceof SessionJournalPersistenceV1Error ||
    cause instanceof SessionJournalStorageCorruptionV1Error ||
    cause instanceof SessionJournalTargetUnavailableV1Error
  ) {
    return cause;
  }
  return new SessionJournalPersistenceV1Error({
    operation: "runPointOperation",
    cause,
  });
}

function mapSessionAuthorityCorruption(
  cause: PointMutationSessionAuthorityCorruptionV1Error,
): SessionJournalStorageCorruptionV1Error {
  const reason = cause.issue === "executionClaimInvalid" ||
      cause.issue === "snapshotLeaseInvalid"
    ? cause.issue
    : "sessionRecordInvalid";
  return new SessionJournalStorageCorruptionV1Error({
    scopeId: cause.scopeId,
    reason,
    cause,
  });
}

function fromPointOperationPromise<A>(
  run: () => PromiseLike<A>,
): Effect.Effect<A, SessionJournalRunPointOperationV1Error> {
  return Effect.tryPromise({
    try: run,
    catch: mapRunPointOperationFailure,
  });
}

function mapExactRunningAttemptTransactionFailure(
  failure: ExactRunningAttemptTransactionV1Error,
): SessionJournalRunPointOperationV1Error {
  if (failure.callbackCause === undefined) {
    return mapRunPointOperationFailure(failure.cause);
  }
  return new SessionJournalPersistenceV1Error({
    operation: "runPointOperation",
    cause: failure,
  });
}

function mapRunIndexedQueryFailure(
  cause: unknown,
): SessionJournalRunIndexedQueryV1Error {
  if (cause instanceof PointMutationSessionAuthorityCorruptionV1Error) {
    return mapSessionAuthorityCorruption(cause);
  }
  if (cause instanceof PointMutationSessionAttemptLoadV1Error) {
    return new SessionJournalAttemptUnavailableV1Error({ issue: cause.issue });
  }
  if (
    cause instanceof InvalidSessionJournalCapabilityV1Error ||
    cause instanceof InvalidSessionJournalInputV1Error ||
    cause instanceof SessionJournalAttemptUnavailableV1Error ||
    cause instanceof SessionJournalDeveloperIndexUnavailableV1Error ||
    cause instanceof SessionJournalPersistenceV1Error ||
    cause instanceof SessionJournalStorageCorruptionV1Error ||
    cause instanceof SessionJournalTargetUnavailableV1Error ||
    cause instanceof OrderedIndexKeyTooLargeError || cause instanceof ExactDecimalError
  ) return cause;
  return new SessionJournalPersistenceV1Error({
    operation: "runIndexedQuery",
    cause,
  });
}

function fromIndexedQueryPromise<A>(
  run: () => PromiseLike<A>,
): Effect.Effect<A, SessionJournalRunIndexedQueryV1Error> {
  return Effect.uninterruptible(Effect.tryPromise({
    try: run,
    catch: mapRunIndexedQueryFailure,
  }));
}

function mapExactRunningIndexedQueryFailure(
  failure: ExactRunningAttemptTransactionV1Error,
): SessionJournalRunIndexedQueryV1Error {
  if (failure.callbackCause === undefined) {
    return mapRunIndexedQueryFailure(failure.cause);
  }
  return new SessionJournalPersistenceV1Error({
    operation: "runIndexedQuery",
    cause: failure,
  });
}

function mapRunApplicationRelationFailure(
  cause: unknown,
): SessionJournalRunApplicationRelationReadError {
  if (cause instanceof PointMutationSessionAuthorityCorruptionV1Error) {
    return mapSessionAuthorityCorruption(cause);
  }
  if (cause instanceof PointMutationSessionAttemptLoadV1Error) {
    return new SessionJournalAttemptUnavailableV1Error({ issue: cause.issue });
  }
  if (
    cause instanceof InvalidSessionJournalCapabilityV1Error ||
    cause instanceof InvalidSessionJournalInputV1Error ||
    cause instanceof SessionJournalAttemptUnavailableV1Error ||
    cause instanceof SessionJournalPersistenceV1Error ||
    cause instanceof SessionJournalStorageCorruptionV1Error ||
    cause instanceof SessionJournalTargetUnavailableV1Error ||
    cause instanceof ApplicationRelationReadUnavailableError ||
    cause instanceof ApplicationRelationReadOverlayError
  ) return cause;
  return new SessionJournalPersistenceV1Error({
    operation: "runApplicationRelationRead",
    cause,
  });
}

function fromApplicationRelationPromise<A>(
  run: () => PromiseLike<A>,
): Effect.Effect<A, SessionJournalRunApplicationRelationReadError> {
  return Effect.uninterruptible(Effect.tryPromise({
    try: run,
    catch: mapRunApplicationRelationFailure,
  }));
}

function mapExactRunningApplicationRelationFailure(
  failure: ExactRunningAttemptTransactionV1Error,
): SessionJournalRunApplicationRelationReadError {
  if (failure.callbackCause === undefined) {
    return mapRunApplicationRelationFailure(failure.cause);
  }
  return new SessionJournalPersistenceV1Error({
    operation: "runApplicationRelationRead",
    cause: failure,
  });
}

async function canonicalizeStoredOutcome(
  outcome: SessionJournalStoredOutcome,
): Promise<CanonicalFlarexValueV1> {
  const encoded = encodeStoredOutcome(outcome);
  return canonicalizeFlarexValueJsonV1(requireJson(encoded));
}

const prepareLogicalWriteEventEffect = Effect.fn(
  "SessionJournalStore.prepareLogicalWriteEvent",
)(function* (
  write: LogicalAppWriteV1,
): Effect.fn.Return<
  PreparedLogicalWriteEventV1,
  SessionJournalRunPointOperationV1Error
> {
  const encoded = requireJson(encodeLogicalAppWrite(write));
  if (!isJsonObject(encoded)) {
    return yield* Effect.die(
      new Error("Logical write encoder returned a non-object."),
    );
  }
  const evidence = yield* Effect.tryPromise({
    try: () => canonicalizeFlarexValueJsonV1(encoded),
    catch: mapRunPointOperationFailure,
  });
  if (!isJsonObject(evidence.valueJson)) {
    return yield* Effect.die(
      new Error("Canonical logical write evidence returned a non-object."),
    );
  }
  const strictWrite = yield* Effect.fromResult(
    decodeLogicalAppWriteResult(evidence.valueJson).pipe(
      Result.mapError(mapRunPointOperationFailure),
    ),
  );
  return Object.freeze({
    write: strictWrite,
    canonicalBytes: copyCanonicalFlarexValueBytesV1(evidence.canonicalBytes),
    sha256: copyFlarexValueSha256V1(evidence.sha256),
    evidenceBytes: evidence.canonicalBytes.byteLength,
  });
});

function requireJson(input: unknown): Json {
  if (!isJson(input)) throw new Error("Schema encoder returned non-JSON data.");
  return input;
}

function isPlainObject(
  input: unknown,
): input is Readonly<Record<string, unknown>> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function cloneJsonObject(input: JsonObject): JsonObject {
  return structuredClone(input);
}

type AppliedSessionJournalOperationV1 =
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
        | "journalSealed"
        | "journalFailed"
        | "journalRelationConflicted";
    }>;

interface SessionJournalCountersV1 {
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

interface SessionJournalCounterDeltasV1 {
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

const ZERO_FINITE_COUNTERS: SessionJournalCountersV1 = Object.freeze({
  operationCalls: 0, receiptEvidenceBytes: 0, readDocuments: 0,
  readSemanticBytes: 0, pointDependencyCount: 0, indexedQuerySyscalls: 0,
  indexRangeDependencyCount: 0, indexRangeDependencyEvidenceBytes: 0,
  relationReadSyscalls: 0, relationDependencyCount: 0,
  relationBaseOccurrences: 0, writeOperations: 0,
  writeSemanticBytes: 0, materialWriteEventEvidenceBytes: 0,
});

function addFiniteCounters(current: SessionJournalCountersV1,
  delta: SessionJournalCounterDeltasV1): SessionJournalCountersV1 {
  return Object.freeze({
    operationCalls: current.operationCalls + delta.operationCalls,
    receiptEvidenceBytes: current.receiptEvidenceBytes + delta.receiptEvidenceBytes,
    readDocuments: current.readDocuments + delta.readDocuments,
    readSemanticBytes: current.readSemanticBytes + delta.readSemanticBytes,
    pointDependencyCount: current.pointDependencyCount + delta.pointDependencyCount,
    indexedQuerySyscalls: current.indexedQuerySyscalls + delta.indexedQuerySyscalls,
    indexRangeDependencyCount: current.indexRangeDependencyCount + delta.indexRangeDependencyCount,
    indexRangeDependencyEvidenceBytes: current.indexRangeDependencyEvidenceBytes +
      delta.indexRangeDependencyEvidenceBytes,
    relationReadSyscalls: current.relationReadSyscalls + delta.relationReadSyscalls,
    relationDependencyCount: current.relationDependencyCount + delta.relationDependencyCount,
    relationBaseOccurrences: current.relationBaseOccurrences + delta.relationBaseOccurrences,
    writeOperations: current.writeOperations + delta.writeOperations,
    writeSemanticBytes: current.writeSemanticBytes + delta.writeSemanticBytes,
    materialWriteEventEvidenceBytes: current.materialWriteEventEvidenceBytes +
      delta.materialWriteEventEvidenceBytes,
  });
}

const ZERO_COUNTER_DELTAS = Object.freeze({
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

type JournalPointOverlayV1 =
  | JournalPointOverlayNoneV1
  | JournalPointOverlayLiveV1;

interface JournalPointMutationV1 {
  readonly mode: "insert" | "update";
  readonly tableId: CatalogTableId;
  readonly rowId: AppRowIdHexV1;
  readonly dependency: AppRowPointDependencyV1;
  readonly overlay: JournalPointOverlayV1;
}

interface SessionJournalOperationPlanV1 {
  readonly outcome: SessionJournalStoredOutcome;
  readonly counters: SessionJournalCounterDeltasV1;
  readonly pointMutation?: JournalPointMutationV1;
  readonly write?: LogicalAppWriteV1;
  readonly nextCreationTime?: AppCreationTimeV1;
  readonly documentValidation?: ValidateApplicationRevisionSyscallDocumentV1Input;
}

interface PreparedLogicalWriteEventV1 {
  readonly write: LogicalAppWriteV1;
  readonly canonicalBytes: CanonicalFlarexValueBytesV1;
  readonly sha256: FlarexValueSha256V1;
  readonly evidenceBytes: number;
}

interface LogicalPointReadV1 {
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

const runPointOperationInTransactionEffect = Effect.fn(
  "SessionJournalStore.runPointOperationInTransaction",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  table: PinnedPointTableStateV1,
  request: SessionJournalStoredPointRequest,
  requestEvidence: CanonicalFlarexValueV1,
  randomUuid: () => string,
  validator: ApplicationRevisionSyscallValidatorV1,
): Effect.fn.Return<
  AppliedSessionJournalOperationV1,
  SessionJournalRunPointOperationV1Error
> {
  if (!kernelContextMatchesAttempt(context, table.attempt)) {
    return yield* Effect.fail(corruption(
      table.attempt,
      "exactAttemptPinsChanged",
    ));
  }
  if (request.tableId !== table.tableId) {
    return yield* Effect.fail(corruption(
      table.attempt,
      "requestTableCapabilityMismatch",
    ));
  }
  const root = context.journalRoot;
  const counters = yield* Effect.fromResult(
    decodeJournalCountersResult(table.attempt, root),
  );
  const receipt = yield* Effect.tryPromise({
    try: () => loadLatestReceipt(tx, context),
    catch: mapRunPointOperationFailure,
  });
  yield* Effect.fromResult(validateReceiptCardinalityResult(
    table.attempt,
    root.lastSyscallSequence,
    receipt,
  ));

  const last = yield* Effect.fromResult(
    decodeCommitFinalSyscallSequenceResult(root.lastSyscallSequence).pipe(
      Result.mapError(mapRunPointOperationFailure),
    ),
  );
  const actual = request.syscallSequence;
  if (root.state === "sealed") {
    return Object.freeze({
      kind: "stateRejected",
      reason: "journalSealed",
    });
  }
  if (actual < last) {
    const prior = yield* Effect.tryPromise({
      try: () => loadReceiptAtSequence(tx, context, actual),
      catch: mapRunPointOperationFailure,
    });
    if (prior === undefined) {
      return yield* Effect.fail(corruption(
        table.attempt,
        "latestReceiptMissing",
      ));
    }
    if (!bytesEqual(prior.requestBytes, requestEvidence.canonicalBytes)) {
      return Object.freeze({
        kind: "sequenceRejected",
        issue: Object.freeze({
          reason: "requestMismatch",
          syscallSequence: actual,
        }),
      });
    }
    const replayed = yield* decodeAndVerifyLatestReceiptEffect(
      table.attempt,
      prior,
      request,
    );
    return Object.freeze({
      kind: "outcome",
      delivery: "replayed",
      outcome: replayed,
    });
  }
  if (BigInt(actual) === BigInt(last)) {
    if (receipt === undefined) {
      return yield* Effect.fail(corruption(
        table.attempt,
        "latestReceiptMissing",
      ));
    }
    if (!bytesEqual(receipt.requestBytes, requestEvidence.canonicalBytes)) {
      return Object.freeze({
        kind: "sequenceRejected",
        issue: Object.freeze({
          reason: "requestMismatch",
          syscallSequence: actual,
        }),
      });
    }
    if (!bytesEqual(receipt.requestSha256, requestEvidence.sha256)) {
      return yield* Effect.fail(corruption(
        table.attempt,
        "latestReceiptRequestDigestMismatch",
      ));
    }
    const replayed = yield* decodeAndVerifyLatestReceiptEffect(
      table.attempt,
      receipt,
      request,
    );
    yield* Effect.fromResult(validateReceiptOutcomeMatchesJournalRootResult(
      table.attempt,
      root,
      replayed,
    ));
    return Object.freeze({
      kind: "outcome",
      delivery: "replayed",
      outcome: replayed,
    });
  }

  const nextSequence = nextCommitSyscallSequence(last);
  if (Option.isNone(nextSequence)) {
    return Object.freeze({
      kind: "sequenceRejected",
      issue: Object.freeze({
        reason: "sequenceExhausted",
        lastAccepted: last,
      }),
    });
  }
  const expectedNext = nextSequence.value;
  if (actual !== expectedNext) {
    return Object.freeze({
      kind: "sequenceRejected",
      issue: Object.freeze({
        reason: "sequenceGap",
        actual,
        expectedNext,
      }),
    });
  }

  if (root.state === "relation_conflicted") {
    return Object.freeze({
      kind: "stateRejected",
      reason: "journalRelationConflicted",
    });
  }
  if (root.state === "operation_failed") {
    return Object.freeze({ kind: "stateRejected", reason: "journalFailed" });
  }
  if (root.state === "failed") {
    if (receipt === undefined) {
      return yield* Effect.fail(corruption(
        table.attempt,
        "failedJournalEvidenceInvalid",
      ));
    }
    const sticky = yield* decodeAndVerifyLatestReceiptEffect(
      table.attempt,
      receipt,
      undefined,
    );
    yield* Effect.fromResult(validateReceiptOutcomeMatchesJournalRootResult(
      table.attempt,
      root,
      sticky,
    ));
    return Object.freeze({
      kind: "outcome",
      delivery: "sticky",
      outcome: sticky,
    });
  }
  if (root.state !== "open") {
    return yield* Effect.fail(corruption(
      table.attempt,
      "journalStateInvalid",
    ));
  }

  if (request.kind !== "get") {
    // The resolved table capability supplies this identity before any write event,
    // overlay, counter or receipt is appended. Commit-generation admission remains separate.
    yield* validateApplicationWriteOwnershipForCommit(tx, { scopeId: context.anchor.scopeId,
      generation: "application_v1", authenticatedAttemptedTables: [table.tableId], materialTables: [] }).pipe(
      Effect.mapError(cause => cause.reason === "writeDenied" ? new ApplicationTableWriteDeniedError({
        operation: request.kind, tableName: table.tableName,
        message: "Ordinary Application mutations cannot write this managed table.",
      }) : new SessionJournalPersistenceV1Error({ operation: "runPointOperation", cause })));
  }
  const plan = yield* planFreshPointOperationEffect(
    tx,
    context,
    table,
    request,
    randomUuid,
  );
  const logicalWrite = plan.write;
  const preparedWriteEvent = logicalWrite === undefined
    ? undefined
    : yield* prepareLogicalWriteEventEffect(logicalWrite);
  const plannedOutcomeEvidence = yield* Effect.tryPromise({
    try: () => canonicalizeStoredOutcome(plan.outcome),
    catch: mapRunPointOperationFailure,
  });
  const counterDeltas = Object.freeze({
    ...plan.counters,
    materialWriteEventEvidenceBytes:
      preparedWriteEvent?.evidenceBytes ?? 0,
    receiptEvidenceBytes: requestEvidence.canonicalBytes.byteLength +
      plannedOutcomeEvidence.canonicalBytes.byteLength,
  } satisfies SessionJournalCounterDeltasV1);
  const limitIssue = firstExceededLimit(counters, counterDeltas);
  if (plan.documentValidation !== undefined) {
    yield* validateApplicationRevisionSyscallDocumentInTransactionV1(
      validator,
      tx,
      context,
      plan.documentValidation,
    );
  }

  if (limitIssue !== undefined) {
    const outcome = Object.freeze({
      kind: "error",
      reason: "limitExceeded",
      ...limitIssue,
    } satisfies SessionJournalStoredOutcome);
    yield* Effect.tryPromise({
      try: () => persistAcceptedOperation(
        tx,
        context,
        request,
        requestEvidence,
        outcome,
        counters,
        {
          ...ZERO_COUNTER_DELTAS,
        },
        {
          state: "failed",
          failureDimension: limitIssue.dimension,
          ...(plan.nextCreationTime === undefined
            ? {}
            : { nextCreationTime: plan.nextCreationTime }),
        },
      ),
      catch: mapRunPointOperationFailure,
    });
    return Object.freeze({
      kind: "outcome",
      delivery: "executed",
      outcome,
    });
  }

  // Drizzle still requires a Promise callback. Keep the mutation statements
  // in one adapter so any typed failure or defect reaches the kernel Cause
  // bridge and rolls the transaction back before it is rehydrated.
  yield* Effect.tryPromise({
    try: async () => {
      if (plan.pointMutation !== undefined) {
        await persistPointMutation(
          tx,
          context,
          plan.pointMutation,
        );
      }
      if (preparedWriteEvent !== undefined) {
        await persistLogicalWrite(tx, context, preparedWriteEvent);
      }
      await persistAcceptedOperation(
        tx,
        context,
        request,
        requestEvidence,
        plan.outcome,
        counters,
        counterDeltas,
        {
          state: "open",
          failureDimension: null,
          ...(plan.nextCreationTime === undefined
            ? {}
            : { nextCreationTime: plan.nextCreationTime }),
        },
      );
    },
    catch: mapRunPointOperationFailure,
  });
  return Object.freeze({
    kind: "outcome",
    delivery: "executed",
    outcome: plan.outcome,
  });
});

/** Tentative point syscall under a fenced finite root. The checked transaction
 * supplies fresh authority, but only the final seal persists this evidence. */
const runFinitePointOperationInTransactionEffect = Effect.fn(
  "SessionJournalStore.runFinitePointOperationInTransaction",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  table: PinnedPointTableStateV1,
  request: SessionJournalStoredPointRequest,
  requestEvidence: CanonicalFlarexValueV1,
  randomUuid: () => string,
  validator: Parameters<typeof runPointOperationInTransactionEffect>[6],
  finite: FiniteRootAttemptState,
): Effect.fn.Return<AppliedSessionJournalOperationV1, SessionJournalRunPointOperationV1Error> {
  if (!kernelContextMatchesAttempt(context, table.attempt) ||
    context.journalRoot.executionProfile !== "finiteRoot" ||
    context.journalRoot.state !== "open" || context.journalRoot.lastSyscallSequence !== 0n)
    return yield* Effect.fail(corruption(table.attempt, "exactAttemptPinsChanged"));
  if (request.tableId !== table.tableId)
    return yield* Effect.fail(corruption(table.attempt, "requestTableCapabilityMismatch"));
  if (finite.status !== "open") return Object.freeze({ kind: "stateRejected", reason: "journalFailed" });
  const previous = finite.entries.get(request.syscallSequence);
  if (previous !== undefined) {
    if (previous.kind !== "point" || !bytesEqual(previous.requestEvidence.sha256, requestEvidence.sha256))
      return Object.freeze({ kind: "sequenceRejected", issue: Object.freeze({
        reason: "requestMismatch", syscallSequence: request.syscallSequence,
      }) });
    return Object.freeze({ kind: "outcome", delivery: "replayed", outcome: structuredClone(previous.outcome) });
  }
  if (request.syscallSequence !== finite.lastSequence + 1n) return Object.freeze({
    kind: "sequenceRejected", issue: Object.freeze({ reason: "sequenceGap", actual: request.syscallSequence,
      expectedNext: CommitSyscallSequenceV1Schema.make(finite.lastSequence + 1n) }),
  });
  if (finite.lastSequence >= BigInt(MAX_COMMIT_OPERATION_CALLS_V1)) return Object.freeze({
    kind: "sequenceRejected", issue: Object.freeze({ reason: "sequenceExhausted",
      lastAccepted: CommitFinalSyscallSequenceV1Schema.make(finite.lastSequence) }),
  });
  if (request.kind !== "get") yield* validateApplicationWriteOwnershipForCommit(tx, {
    scopeId: context.anchor.scopeId, generation: "application_v1",
    authenticatedAttemptedTables: [table.tableId], materialTables: [],
  }).pipe(Effect.mapError(cause => cause.reason === "writeDenied" ? new ApplicationTableWriteDeniedError({
    operation: request.kind, tableName: table.tableName,
    message: "Ordinary Application mutations cannot write this managed table.",
  }) : new SessionJournalPersistenceV1Error({ operation: "runPointOperation", cause })));
  const plan = yield* planFreshPointOperationEffect(tx, context, table, request, randomUuid, finite);
  const preparedWriteEvent = plan.write === undefined ? undefined : yield* prepareLogicalWriteEventEffect(plan.write);
  const outcomeEvidence = yield* Effect.tryPromise({
    try: () => canonicalizeStoredOutcome(plan.outcome), catch: mapRunPointOperationFailure,
  });
  const deltas = Object.freeze({ ...plan.counters,
    materialWriteEventEvidenceBytes: preparedWriteEvent?.evidenceBytes ?? 0,
    receiptEvidenceBytes: requestEvidence.canonicalBytes.byteLength + outcomeEvidence.canonicalBytes.byteLength,
  } satisfies SessionJournalCounterDeltasV1);
  if (plan.documentValidation !== undefined) yield* validateApplicationRevisionSyscallDocumentInTransactionV1(
    validator, tx, context, plan.documentValidation);
  const limitIssue = firstExceededLimit(finite.counters, deltas);
  if (limitIssue !== undefined) {
    finite.status = "aborted";
    return Object.freeze({ kind: "outcome", delivery: "executed", outcome: Object.freeze({
      kind: "error", reason: "limitExceeded", ...limitIssue,
    }) });
  }
  const point = plan.pointMutation;
  if (point !== undefined && point.overlay.kind !== "none" && plan.write !== undefined) {
    const observed = point.dependency.kind === "present"
      ? Object.freeze({ kind: "present" as const, revisionCommitSeq: point.dependency.revisionCommitSeq })
      : Object.freeze({ kind: "missing" as const, basis: point.dependency.basis });
    const overlay = point.overlay.kind === "live"
      ? Object.freeze({ kind: "live" as const, creationTime: point.overlay.creationTime,
        document: point.overlay.document }) : Object.freeze({ kind: "deleted" as const });
    if (!finite.evaluator.stageAppPoint({ tableId: point.tableId, rowId: point.rowId, observed, overlay }))
      return yield* Effect.fail(corruption(table.attempt, "pointDependencyChangedAtSnapshot"));
  }
  if (point !== undefined) finite.points.set(`${point.tableId}/${point.rowId}`, point);
  finite.counters = addFiniteCounters(finite.counters, deltas);
  if (plan.nextCreationTime !== undefined) finite.nextCreationTime = plan.nextCreationTime;
  finite.entries.set(request.syscallSequence, Object.freeze({ kind: "point", request,
    requestEvidence, outcome: plan.outcome, outcomeEvidence, plan,
    ...(preparedWriteEvent === undefined ? {} : { writeEvent: preparedWriteEvent }) }));
  finite.lastSequence = request.syscallSequence;
  return Object.freeze({ kind: "outcome", delivery: "executed", outcome: structuredClone(plan.outcome) });
});

/** Evaluate an indexed Application page against one root-wide point overlay.
 * Physical index facts remain snapshot facts; the final seal persists the
 * normalized negative/range evidence together with the root's writes. */
const runFiniteIndexedQueryInTransactionEffect = Effect.fn(
  "SessionJournalStore.runFiniteIndexedQueryInTransaction",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  index: PinnedDeveloperIndexStateV1,
  request: Extract<SessionJournalStoredRequest, { readonly kind: "indexRange" }>,
  requestEvidence: CanonicalFlarexValueV1,
  finite: FiniteRootAttemptState,
): Effect.fn.Return<AppliedSessionJournalOperationV1, SessionJournalRunIndexedQueryV1Error> {
  if (!kernelContextMatchesAttempt(context, index.attempt) || context.journalRoot.executionProfile !== "finiteRoot" ||
    context.journalRoot.state !== "open" || context.journalRoot.lastSyscallSequence !== 0n)
    return yield* Effect.fail(corruption(index.attempt, "exactAttemptPinsChanged"));
  if (request.tableId !== index.tableId || request.logicalIndexId !== index.logicalIndexId ||
    request.indexDefinitionId !== index.definition.indexDefinitionId)
    return yield* Effect.fail(corruption(index.attempt, "requestTableCapabilityMismatch"));
  if (finite.status !== "open") return Object.freeze({ kind: "stateRejected", reason: "journalFailed" });
  const previous = finite.entries.get(request.syscallSequence);
  if (previous !== undefined) {
    if (previous.kind !== "index" || !bytesEqual(previous.requestEvidence.sha256, requestEvidence.sha256))
      return Object.freeze({ kind: "sequenceRejected", issue: Object.freeze({
        reason: "requestMismatch", syscallSequence: request.syscallSequence,
      }) });
    return Object.freeze({ kind: "outcome", delivery: "replayed", outcome: structuredClone(previous.outcome) });
  }
  if (request.syscallSequence !== finite.lastSequence + 1n) return Object.freeze({
    kind: "sequenceRejected", issue: Object.freeze({ reason: "sequenceGap", actual: request.syscallSequence,
      expectedNext: CommitSyscallSequenceV1Schema.make(finite.lastSequence + 1n) }),
  });
  if (finite.lastSequence >= BigInt(MAX_COMMIT_OPERATION_CALLS_V1)) return Object.freeze({
    kind: "sequenceRejected", issue: Object.freeze({ reason: "sequenceExhausted",
      lastAccepted: CommitFinalSyscallSequenceV1Schema.make(finite.lastSequence) }),
  });
  const build = yield* readFencedIndexBuildStateEffect(tx, {
    scopeId: index.attempt.selector.scopeId, indexDefinitionId: index.definition.indexDefinitionId,
  });
  if (build.status !== "current" || !(yield* isIndexBuildSnapshotCoveredInTransactionEffect(
    tx, build.buildState, { ...index.definition, tableId: index.tableId }, index.attempt.snapshotToken.commitSeq,
    yield* readIndexCoverageContextInTransactionEffect(tx, context.scopeClock).pipe(Effect.mapError(cause =>
      cause.reason === "resourceFailure" ? new SessionJournalPersistenceV1Error({ operation: "runIndexedQuery", cause })
        : corruption(index.attempt, "indexMaintenanceInvalid", cause))),
  ).pipe(Effect.catchTag("IndexMaintenanceError", cause => Effect.fail(
    cause.reason === "resourceFailure" ? new SessionJournalPersistenceV1Error({ operation: "runIndexedQuery", cause })
      : corruption(index.attempt, "indexMaintenanceInvalid", cause))))))
    return yield* Effect.fail(new SessionJournalDeveloperIndexUnavailableV1Error({ reason: "buildNotEnabled" }));
  const staged = [...finite.points.values()].filter(point => point.tableId === index.tableId && point.overlay.kind !== "none");
  if (staged.length > MAX_POINT_COMMIT_MATERIAL_ROWS_V1)
    return yield* Effect.fail(corruption(index.attempt, "pointDependencyCountMismatch"));
  const stagedByRowId = new Map<OrderedIndexRowIdHexV1, IndexedQueryStagedPositionV1>();
  for (const point of staged) {
    const rowId = yield* Effect.fromResult(orderedIndexRowIdHexV1FromBytesResult(appRowIdHexV1ToBytes(point.rowId))
      .pipe(Result.mapError(cause => corruption(index.attempt, "pointDependencyCountMismatch", cause))));
    if (point.overlay.kind === "deleted") { stagedByRowId.set(rowId, Object.freeze({ kind: "deleted", rowId })); continue; }
    if (point.overlay.kind !== "live") return yield* Effect.fail(corruption(index.attempt, "liveOverlayEvidenceMissing"));
    const encodedKey = yield* Effect.fromResult(lowerAppDeveloperIndexKeyV1(index.definition,
      point.overlay.document, point.overlay.creationTime));
    stagedByRowId.set(rowId, encodedKey === null ? Object.freeze({ kind: "deleted", rowId }) :
      Object.freeze({ kind: "live", rowId, encodedKey, document: point.overlay.document }));
  }
  const bounds: OrderedIndexBoundsV1 = Object.freeze({
    ...(request.startInclusive === null ? {} : { startInclusive: request.startInclusive }),
    ...(request.endExclusive === null ? {} : { endExclusive: request.endExclusive }),
  });
  const snapshotPage = yield* scanAppIndexAtSnapshotInTransactionEffect(tx, {
    scopeId: index.attempt.selector.scopeId, definition: index.definition, bounds,
    limit: request.limit + staged.length, snapshotCommitSeq: index.attempt.snapshotToken.commitSeq,
  });
  const merged: IndexedQueryMergedPositionV1[] = [];
  for (const entry of snapshotPage.entries) if (!stagedByRowId.has(entry.rowId)) merged.push(Object.freeze({
    kind: "snapshot", rowId: entry.rowId, encodedKey: entry.encodedKey, entry,
  }));
  for (const position of stagedByRowId.values()) if (position.kind === "live" &&
    encodedIndexKeyIsWithinBounds(position.encodedKey, request)) merged.push(position);
  merged.sort(compareIndexedQueryMergedPositions);
  const page = Object.freeze(merged.slice(0, request.limit));
  const isDone = snapshotPage.isDone && merged.length <= request.limit;
  const documents: CanonicalFlarexValueV1[] = [];
  const newPoints: JournalPointMutationV1[] = [];
  const newPointReads = new Map<string, LogicalPointReadV1>();
  let readSemanticBytes = 0;
  for (let offset = 0; offset < page.length; offset += INDEXED_QUERY_DOCUMENT_MATERIALIZATION_BATCH_SIZE_V1) {
    const batch = page.slice(offset, offset + INDEXED_QUERY_DOCUMENT_MATERIALIZATION_BATCH_SIZE_V1);
    const snapshotEntries = batch.flatMap(position => position.kind === "snapshot" ? [position.entry] : []);
    const revisions = snapshotEntries.length === 0 ? [] : yield* readLiveAppRowsAtSnapshotInTransactionEffect(tx, {
      scopeId: index.attempt.selector.scopeId, tableId: index.tableId,
      rowIds: Object.freeze(snapshotEntries.map(entry => entry.rowId)),
      snapshotCommitSeq: index.attempt.snapshotToken.commitSeq,
    });
    let revisionIndex = 0;
    for (const position of batch) {
      const revision = position.kind === "snapshot" ? revisions[revisionIndex++] : undefined;
      const document = position.kind === "live" ? position.document : revision?.document;
      if (document === undefined) return yield* Effect.fail(corruption(index.attempt, "indexedSnapshotPositionMismatch"));
      if (revision !== undefined) {
        const lowered = yield* Effect.fromResult(lowerAppDeveloperIndexKeyV1(index.definition,
          revision.document, revision.creationTime));
        if (position.kind !== "snapshot" || position.entry.tableId !== index.tableId ||
          position.entry.rowId !== revision.rowId || lowered !== position.entry.encodedKey)
          return yield* Effect.fail(corruption(index.attempt, "indexedSnapshotPositionMismatch"));
        const key = `${index.tableId}/${revision.rowId}`;
        const existing = finite.points.get(key);
        if (existing !== undefined && (existing.dependency.kind !== "present" ||
          existing.dependency.revisionCommitSeq !== revision.commitSeq || existing.overlay.kind !== "none"))
          return yield* Effect.fail(corruption(index.attempt, "pointDependencyChangedAtSnapshot"));
        if (existing === undefined) {
          const dependency = Object.freeze({ kind: "present" as const, identity: Object.freeze({
            scopeId: index.attempt.selector.scopeId, tableId: index.tableId, rowId: revision.rowId,
          }), revisionCommitSeq: revision.commitSeq });
          newPoints.push(Object.freeze({ mode: "insert", tableId: index.tableId, rowId: revision.rowId,
            dependency, overlay: Object.freeze({ kind: "none" }) }));
          newPointReads.set(key, Object.freeze({ dependencyIsNew: false,
            result: Object.freeze({ kind: "present", document: revision.document, dependency }) }));
        }
      }
      documents.push(document); readSemanticBytes += document.semanticSizeBytes;
    }
  }
  const dependency = indexRangeDependencyFromPage(index, request, page, isDone);
  const ranges = yield* Effect.fromResult(normalizeLogicalIndexRangeReadDependenciesV1Result([
    ...finite.indexRanges, dependency,
  ]).pipe(Result.mapError(cause => corruption(index.attempt, "indexRangeDependencyInvalid", cause))));
  const evidenceBytes = prepareStoredIndexRanges(ranges).reduce((sum, entry) => sum + entry.evidenceBytes, 0);
  const priorEvidenceBytes = prepareStoredIndexRanges(finite.indexRanges).reduce((sum, entry) => sum + entry.evidenceBytes, 0);
  const outcome = Object.freeze({ kind: "indexRangePage", documentsValueJson: Object.freeze(
    documents.map(document => structuredClone(document.valueJson))), isDone } satisfies SessionJournalStoredOutcome);
  const outcomeEvidence = yield* fromIndexedQueryPromise(() => canonicalizeStoredOutcome(outcome));
  const deltas = Object.freeze({ ...ZERO_COUNTER_DELTAS, readDocuments: documents.length,
    readSemanticBytes, pointDependencyCount: newPoints.length, indexedQuerySyscalls: 1,
    indexRangeDependencyCount: ranges.length - finite.indexRanges.length,
    indexRangeDependencyEvidenceBytes: evidenceBytes - priorEvidenceBytes,
    receiptEvidenceBytes: requestEvidence.canonicalBytes.byteLength + outcomeEvidence.canonicalBytes.byteLength,
  } satisfies SessionJournalCounterDeltasV1);
  const issue = firstExceededLimit(finite.counters, deltas);
  if (issue !== undefined) {
    finite.status = "aborted";
    return Object.freeze({ kind: "outcome", delivery: "executed", outcome: Object.freeze({
      kind: "error", reason: "limitExceeded", ...issue,
    }) });
  }
  for (const point of newPoints) finite.points.set(`${point.tableId}/${point.rowId}`, point);
  for (const [key, read] of newPointReads) finite.pointReads.set(key, read);
  finite.indexRanges = [...ranges];
  finite.counters = addFiniteCounters(finite.counters, deltas);
  finite.entries.set(request.syscallSequence, Object.freeze({ kind: "index", request,
    requestEvidence, outcome, outcomeEvidence }));
  finite.lastSequence = request.syscallSequence;
  return Object.freeze({ kind: "outcome", delivery: "executed", outcome: structuredClone(outcome) });
});

const runIndexedQueryInTransactionEffect = Effect.fn(
  "SessionJournalStore.runIndexedQueryInTransaction",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  index: PinnedDeveloperIndexStateV1,
  request: Extract<SessionJournalStoredRequest, {
    readonly kind: "indexRange";
  }>,
  requestEvidence: CanonicalFlarexValueV1,
  faultAfter: SessionJournalStorePersistenceOptionsV1["faultAfter"],
): Effect.fn.Return<
  AppliedSessionJournalOperationV1,
  SessionJournalRunIndexedQueryV1Error
> {
  if (!kernelContextMatchesAttempt(context, index.attempt)) {
    return yield* Effect.fail(corruption(
      index.attempt,
      "exactAttemptPinsChanged",
    ));
  }
  if (
    request.tableId !== index.tableId ||
    request.logicalIndexId !== index.logicalIndexId ||
    request.indexDefinitionId !== index.definition.indexDefinitionId
  ) {
    return yield* Effect.fail(corruption(
      index.attempt,
      "requestTableCapabilityMismatch",
    ));
  }
  const root = context.journalRoot;
  const counters = yield* Effect.fromResult(
    decodeJournalCountersResult(index.attempt, root),
  );
  const receipt = yield* fromIndexedQueryPromise(() =>
    loadLatestReceipt(tx, context)
  );
  yield* Effect.fromResult(validateReceiptCardinalityResult(
    index.attempt,
    root.lastSyscallSequence,
    receipt,
  ));
  const last = yield* Effect.fromResult(
    decodeCommitFinalSyscallSequenceResult(root.lastSyscallSequence).pipe(
      Result.mapError(mapRunIndexedQueryFailure),
    ),
  );
  const actual = request.syscallSequence;
  if (root.state === "sealed") {
    return Object.freeze({ kind: "stateRejected", reason: "journalSealed" });
  }
  if (actual < last) {
    const prior = yield* fromIndexedQueryPromise(() =>
      loadReceiptAtSequence(tx, context, actual)
    );
    if (prior === undefined) {
      return yield* Effect.fail(corruption(
        index.attempt,
        "latestReceiptMissing",
      ));
    }
    if (!bytesEqual(prior.requestBytes, requestEvidence.canonicalBytes)) {
      return Object.freeze({
        kind: "sequenceRejected",
        issue: Object.freeze({
          reason: "requestMismatch",
          syscallSequence: actual,
        }),
      });
    }
    const replayed = yield* decodeAndVerifyLatestReceiptEffect(
      index.attempt,
      prior,
      request,
    );
    if (replayed.kind !== "indexRangePage" && !isLimitOutcome(replayed)) {
      return yield* Effect.fail(corruption(
        index.attempt,
        "latestReceiptEvidenceInvalid",
      ));
    }
    return Object.freeze({
      kind: "outcome",
      delivery: "replayed",
      outcome: replayed,
    });
  }
  if (BigInt(actual) === BigInt(last)) {
    if (receipt === undefined) {
      return yield* Effect.fail(corruption(
        index.attempt,
        "latestReceiptMissing",
      ));
    }
    if (!bytesEqual(receipt.requestBytes, requestEvidence.canonicalBytes)) {
      return Object.freeze({
        kind: "sequenceRejected",
        issue: Object.freeze({
          reason: "requestMismatch",
          syscallSequence: actual,
        }),
      });
    }
    if (!bytesEqual(receipt.requestSha256, requestEvidence.sha256)) {
      return yield* Effect.fail(corruption(
        index.attempt,
        "latestReceiptRequestDigestMismatch",
      ));
    }
    const replayed = yield* decodeAndVerifyLatestReceiptEffect(
      index.attempt,
      receipt,
      request,
    );
    if (replayed.kind !== "indexRangePage" && !isLimitOutcome(replayed)) {
      return yield* Effect.fail(corruption(
        index.attempt,
        "latestReceiptEvidenceInvalid",
      ));
    }
    yield* Effect.fromResult(validateReceiptOutcomeMatchesJournalRootResult(
      index.attempt,
      root,
      replayed,
    ));
    return Object.freeze({
      kind: "outcome",
      delivery: "replayed",
      outcome: replayed,
    });
  }
  const nextSequence = nextCommitSyscallSequence(last);
  if (Option.isNone(nextSequence)) {
    return Object.freeze({
      kind: "sequenceRejected",
      issue: Object.freeze({ reason: "sequenceExhausted", lastAccepted: last }),
    });
  }
  const expectedNext = nextSequence.value;
  if (actual !== expectedNext) {
    return Object.freeze({
      kind: "sequenceRejected",
      issue: Object.freeze({
        reason: "sequenceGap",
        actual,
        expectedNext,
      }),
    });
  }
  if (root.state === "relation_conflicted") {
    return Object.freeze({
      kind: "stateRejected",
      reason: "journalRelationConflicted",
    });
  }
  if (root.state === "operation_failed") {
    return Object.freeze({ kind: "stateRejected", reason: "journalFailed" });
  }
  if (root.state === "failed") {
    if (receipt === undefined) {
      return yield* Effect.fail(corruption(
        index.attempt,
        "failedJournalEvidenceInvalid",
      ));
    }
    const sticky = yield* decodeAndVerifyLatestReceiptEffect(
      index.attempt,
      receipt,
      undefined,
    );
    if (!isLimitOutcome(sticky)) {
      return yield* Effect.fail(corruption(
        index.attempt,
        "failedJournalReceiptInvalid",
      ));
    }
    yield* Effect.fromResult(validateReceiptOutcomeMatchesJournalRootResult(
      index.attempt,
      root,
      sticky,
    ));
    return Object.freeze({ kind: "outcome", delivery: "sticky", outcome: sticky });
  }
  if (root.state !== "open") {
    return yield* Effect.fail(corruption(index.attempt, "journalStateInvalid"));
  }
  const currentRanges = yield* loadIndexRangeDependenciesForUpdateEffect(
    tx,
    context,
    index.attempt,
  );
  const currentPreparedRanges = prepareStoredIndexRanges(currentRanges);
  if (currentRanges.length !== counters.indexRangeDependencyCount) {
    return yield* Effect.fail(corruption(
      index.attempt,
      "indexRangeDependencyCountMismatch",
    ));
  }
  const currentRangeEvidenceBytes = currentPreparedRanges.reduce(
    (total, range) => total + range.evidenceBytes,
    0,
  );
  if (
    currentRangeEvidenceBytes !==
      counters.indexRangeDependencyEvidenceBytes
  ) {
    return yield* Effect.fail(corruption(
      index.attempt,
      "indexRangeDependencyEvidenceBytesMismatch",
    ));
  }
  if (counters.indexedQuerySyscalls >= MAX_COMMIT_INDEXED_QUERY_SYSCALLS_V1) {
    const outcome = Object.freeze({
      kind: "error",
      reason: "limitExceeded",
      dimension: "indexedQuerySyscalls",
      observed: counters.indexedQuerySyscalls + 1,
      maximum: MAX_COMMIT_INDEXED_QUERY_SYSCALLS_V1,
    } satisfies SessionJournalStoredOutcome);
    yield* fromIndexedQueryPromise(() => persistAcceptedOperation(
      tx,
      context,
      request,
      requestEvidence,
      outcome,
      counters,
      ZERO_COUNTER_DELTAS,
      { state: "failed", failureDimension: "indexedQuerySyscalls" },
    ));
    return Object.freeze({ kind: "outcome", delivery: "executed", outcome });
  }

  const stagedRows = yield* fromIndexedQueryPromise(() =>
    tx.select()
      .from(fxSystemTransactionJournalPoints)
      .where(and(
        eq(fxSystemTransactionJournalPoints.scopeUuid, context.scopeUuid),
        eq(fxSystemTransactionJournalPoints.sessionId, context.anchor.sessionId),
        eq(fxSystemTransactionJournalPoints.attemptFence, context.anchor.attemptFence),
        eq(fxSystemTransactionJournalPoints.tableId, index.tableId),
        ne(fxSystemTransactionJournalPoints.overlayKind, "none"),
      ))
      .orderBy(asc(fxSystemTransactionJournalPoints.rowId))
      .limit(MAX_POINT_COMMIT_MATERIAL_ROWS_V1 + 1)
      .for("update")
  );
  if (stagedRows.length > MAX_POINT_COMMIT_MATERIAL_ROWS_V1) {
    return yield* Effect.fail(corruption(
      index.attempt,
      "pointDependencyCountMismatch",
    ));
  }

  const build = yield* readFencedIndexBuildStateEffect(tx, {
    scopeId: index.attempt.selector.scopeId,
    indexDefinitionId: index.definition.indexDefinitionId,
  });
  if (
    build.status !== "current" ||
    !(yield* isIndexBuildSnapshotCoveredInTransactionEffect(
      tx, build.buildState, { ...index.definition, tableId: index.tableId }, index.attempt.snapshotToken.commitSeq,
      yield* readIndexCoverageContextInTransactionEffect(tx, context.scopeClock).pipe(Effect.mapError(cause =>
        cause.reason === "resourceFailure" ? new SessionJournalPersistenceV1Error({ operation: "runIndexedQuery", cause })
          : corruption(index.attempt, "indexMaintenanceInvalid", cause))),
    ).pipe(Effect.catchTag("IndexMaintenanceError", cause => Effect.fail(
      cause.reason === "resourceFailure" ? new SessionJournalPersistenceV1Error({ operation: "runIndexedQuery", cause })
        : corruption(index.attempt, "indexMaintenanceInvalid", cause)))))
  ) {
    return yield* Effect.fail(
      new SessionJournalDeveloperIndexUnavailableV1Error({
        reason: "buildNotEnabled",
      }),
    );
  }
  const bounds: OrderedIndexBoundsV1 = Object.freeze({
    ...(request.startInclusive === null
      ? {}
      : { startInclusive: request.startInclusive }),
    ...(request.endExclusive === null
      ? {}
      : { endExclusive: request.endExclusive }),
  });
  const stagedByRowId = new Map<OrderedIndexRowIdHexV1,
    IndexedQueryStagedPositionV1>();
  for (const stagedRow of stagedRows) {
    const rowId = yield* Effect.fromResult(
      orderedIndexRowIdHexV1FromBytesResult(stagedRow.rowId).pipe(
        Result.mapError((cause) => corruption(
          index.attempt,
          "pointDependencyCountMismatch",
          cause,
        )),
      ),
    );
    yield* Effect.fromResult(decodePointDependencyResult(index.attempt, stagedRow));
    if (stagedRow.overlayKind === "deleted") {
      stagedByRowId.set(rowId, Object.freeze({ kind: "deleted", rowId }));
      continue;
    }
    if (stagedRow.overlayKind !== "live") {
      return yield* Effect.fail(corruption(
        index.attempt,
        "liveOverlayEvidenceMissing",
      ));
    }
    const document = yield* decodeLivePointOverlayEvidenceEffect(
      index.attempt,
      stagedRow,
    );
    const creationTime = stagedRow.overlayCreationTime;
    if (creationTime === null) {
      return yield* Effect.fail(corruption(
        index.attempt,
        "liveOverlayEvidenceMissing",
      ));
    }
    const encodedKey = yield* Effect.fromResult(
      lowerAppDeveloperIndexKeyV1(index.definition, document, creationTime),
    );
    if (encodedKey === null) {
      // Remove the old index position when a live overlay leaves its predicate.
      stagedByRowId.set(rowId, Object.freeze({ kind: "deleted", rowId }));
      continue;
    }
    stagedByRowId.set(rowId, Object.freeze({
      kind: "live",
      rowId,
      encodedKey,
      document,
    }));
  }

  const snapshotPage = yield* scanAppIndexAtSnapshotInTransactionEffect(tx, {
    scopeId: index.attempt.selector.scopeId,
    definition: index.definition,
    bounds,
    limit: request.limit + stagedRows.length,
    snapshotCommitSeq: index.attempt.snapshotToken.commitSeq,
  });
  const mergedPositions: IndexedQueryMergedPositionV1[] = [];
  for (const entry of snapshotPage.entries) {
    if (!stagedByRowId.has(entry.rowId)) {
      mergedPositions.push(Object.freeze({
        kind: "snapshot",
        rowId: entry.rowId,
        encodedKey: entry.encodedKey,
        entry,
      }));
    }
  }
  for (const staged of stagedByRowId.values()) {
    if (
      staged.kind === "live" &&
      encodedIndexKeyIsWithinBounds(staged.encodedKey, request)
    ) {
      mergedPositions.push(staged);
    }
  }
  mergedPositions.sort(compareIndexedQueryMergedPositions);
  const pagePositions = Object.freeze(mergedPositions.slice(0, request.limit));
  const pageIsDone = snapshotPage.isDone && mergedPositions.length <= request.limit;
  const readDocumentLimitIssue = firstExceededLimit(counters, {
    ...ZERO_COUNTER_DELTAS,
    readDocuments: pagePositions.length,
  });
  if (readDocumentLimitIssue !== undefined) {
    return yield* persistIndexedQueryLimitOutcomeEffect(
      tx,
      context,
      request,
      requestEvidence,
      counters,
      readDocumentLimitIssue,
    );
  }
  const resultDocuments: CanonicalFlarexValueV1[] = [];
  const snapshotResultEntries: AppIndexRangeEntryV1[] = [];
  const snapshotResultRevisions: LiveAppRowRevisionV1[] = [];
  let readSemanticBytes = 0;
  for (
    let batchStart = 0;
    batchStart < pagePositions.length;
    batchStart += INDEXED_QUERY_DOCUMENT_MATERIALIZATION_BATCH_SIZE_V1
  ) {
    const batchPositions = pagePositions.slice(
      batchStart,
      batchStart + INDEXED_QUERY_DOCUMENT_MATERIALIZATION_BATCH_SIZE_V1,
    );
    const batchSnapshotEntries = batchPositions.flatMap((position) =>
      position.kind === "snapshot" ? [position.entry] : []
    );
    const batchSnapshotRevisions = batchSnapshotEntries.length === 0
      ? []
      : yield* readLiveAppRowsAtSnapshotInTransactionEffect(tx, {
        scopeId: index.attempt.selector.scopeId,
        tableId: index.tableId,
        rowIds: Object.freeze(batchSnapshotEntries.map((entry) => entry.rowId)),
        snapshotCommitSeq: index.attempt.snapshotToken.commitSeq,
      });
    let snapshotOffset = 0;
    for (const position of batchPositions) {
      const document = position.kind === "live"
        ? position.document
        : batchSnapshotRevisions[snapshotOffset]?.document;
      if (document === undefined) {
        return yield* Effect.fail(corruption(
          index.attempt,
          "indexedSnapshotPositionMismatch",
        ));
      }
      if (position.kind === "snapshot") {
        const entry = position.entry;
        const revision = batchSnapshotRevisions[snapshotOffset]!;
        snapshotOffset += 1;
      const lowered = yield* Effect.fromResult(
        lowerAppDeveloperIndexKeyV1(
          index.definition,
          revision.document,
          revision.creationTime,
        ),
      );
      if (
        entry.tableId !== index.tableId ||
        lowered !== entry.encodedKey ||
        revision.rowId !== entry.rowId
      ) {
        return yield* Effect.fail(corruption(
          index.attempt,
          "indexedSnapshotPositionMismatch",
        ));
      }
        snapshotResultEntries.push(entry);
        snapshotResultRevisions.push(revision);
      }
      const nextReadSemanticBytes = readSemanticBytes +
        document.semanticSizeBytes;
      const readSemanticLimitIssue = firstExceededLimit(counters, {
        ...ZERO_COUNTER_DELTAS,
        readSemanticBytes: nextReadSemanticBytes,
      });
      if (readSemanticLimitIssue !== undefined) {
        return yield* persistIndexedQueryLimitOutcomeEffect(
          tx,
          context,
          request,
          requestEvidence,
          counters,
          readSemanticLimitIssue,
        );
      }
      resultDocuments.push(document);
      readSemanticBytes = nextReadSemanticBytes;
    }
  }

  const pointRows = snapshotResultEntries.length === 0
    ? []
    : yield* fromIndexedQueryPromise(() =>
      tx.select()
        .from(fxSystemTransactionJournalPoints)
        .where(and(
          eq(fxSystemTransactionJournalPoints.scopeUuid, context.scopeUuid),
          eq(fxSystemTransactionJournalPoints.sessionId, context.anchor.sessionId),
          eq(fxSystemTransactionJournalPoints.attemptFence, context.anchor.attemptFence),
          eq(fxSystemTransactionJournalPoints.tableId, index.tableId),
          inArray(
            fxSystemTransactionJournalPoints.rowId,
            snapshotResultEntries.map((entry) =>
              orderedIndexRowIdHexV1ToBytes(entry.rowId)
            ),
          ),
        ))
        .for("update")
    );
  const existingByRowId = new Map<OrderedIndexRowIdHexV1,
    typeof fxSystemTransactionJournalPoints.$inferSelect>();
  for (const row of pointRows) {
    const rowId = yield* Effect.fromResult(
      orderedIndexRowIdHexV1FromBytesResult(row.rowId).pipe(
        Result.mapError((cause) => corruption(
          index.attempt,
          "pointDependencyCountMismatch",
          cause,
        )),
      ),
    );
    existingByRowId.set(rowId, row);
  }
  const newPointRows: Array<typeof fxSystemTransactionJournalPoints.$inferInsert> = [];
  for (const revision of snapshotResultRevisions) {
    const existing = existingByRowId.get(revision.rowId);
    if (existing !== undefined) {
      const dependency = yield* Effect.fromResult(
        decodePointDependencyResult(index.attempt, existing),
      );
      if (
        dependency.kind !== "present" ||
        dependency.revisionCommitSeq !== revision.commitSeq ||
        existing.overlayKind !== "none"
      ) {
        return yield* Effect.fail(corruption(
          index.attempt,
          "pointDependencyChangedAtSnapshot",
        ));
      }
      continue;
    }
    newPointRows.push({
      scopeUuid: context.scopeUuid,
      sessionId: context.anchor.sessionId,
      attemptFence: context.anchor.attemptFence,
      tableId: index.tableId,
      rowId: orderedIndexRowIdHexV1ToBytes(revision.rowId),
      dependencyKind: "present",
      dependencyRevisionCommitSeq: revision.commitSeq,
      overlayKind: "none",
      createdAt: context.databaseNow,
      updatedAt: context.databaseNow,
    });
  }

  const dependency = indexRangeDependencyFromPage(
    index,
    request,
    pagePositions,
    pageIsDone,
  );
  const nextRanges = yield* Effect.fromResult(
    normalizeLogicalIndexRangeReadDependenciesV1Result([
      ...currentRanges,
      dependency,
    ]).pipe(
      Result.mapError((cause) => corruption(
        index.attempt,
        "indexRangeDependencyInvalid",
        cause,
      )),
    ),
  );
  const preparedRanges = prepareStoredIndexRanges(nextRanges);
  const evidenceBytes = preparedRanges.reduce(
    (total, range) => total + range.evidenceBytes,
    0,
  );
  const outcome = Object.freeze({
    kind: "indexRangePage",
    documentsValueJson: Object.freeze(
      resultDocuments.map((document) => structuredClone(document.valueJson)),
    ),
    isDone: pageIsDone,
  } satisfies SessionJournalStoredOutcome);
  const outcomeEvidence = yield* fromIndexedQueryPromise(() =>
    canonicalizeStoredOutcome(outcome)
  );
  const deltas = Object.freeze({
    ...ZERO_COUNTER_DELTAS,
    readDocuments: resultDocuments.length,
    readSemanticBytes,
    pointDependencyCount: newPointRows.length,
    indexedQuerySyscalls: 1,
    indexRangeDependencyCount:
      nextRanges.length - counters.indexRangeDependencyCount,
    indexRangeDependencyEvidenceBytes:
      evidenceBytes - counters.indexRangeDependencyEvidenceBytes,
    receiptEvidenceBytes: requestEvidence.canonicalBytes.byteLength +
      outcomeEvidence.canonicalBytes.byteLength,
  } satisfies SessionJournalCounterDeltasV1);
  const limitIssue = firstExceededLimit(counters, deltas);
  if (limitIssue !== undefined) {
    return yield* persistIndexedQueryLimitOutcomeEffect(
      tx,
      context,
      request,
      requestEvidence,
      counters,
      limitIssue,
    );
  }
  yield* fromIndexedQueryPromise(async () => {
    if (newPointRows.length > 0) {
      await tx.insert(fxSystemTransactionJournalPoints).values(newPointRows);
    }
    await replaceStoredIndexRanges(tx, context, preparedRanges);
    await faultAfter?.("indexedQueryEvidenceWritten");
    await persistAcceptedOperation(
      tx,
      context,
      request,
      requestEvidence,
      outcome,
      counters,
      deltas,
      { state: "open", failureDimension: null },
    );
  });
  return Object.freeze({ kind: "outcome", delivery: "executed", outcome });
});

type StoredApplicationRelationIncomingRequest = Extract<
  SessionJournalStoredRequest,
  { readonly kind: "relationIncoming" }
>;

const loadFiniteApplicationRelationTransitionsEffect = Effect.fn(
  "SessionJournalStore.loadFiniteApplicationRelationTransitions",
)(function* (
  tx: AppRowTransaction,
  relation: PinnedApplicationRelationReadState,
  finite: FiniteRootAttemptState,
): Effect.fn.Return<ReadonlyArray<ApplicationRelationRowTransition>, SessionJournalRunApplicationRelationReadError> {
  const attempt = relation.attempt;
  const tableId = relation.resolved.definition.binding.sourceTableId;
  const points = [...finite.points.values()].filter(point => point.tableId === tableId && point.overlay.kind !== "none");
  if (points.length > MAX_POINT_COMMIT_MATERIAL_ROWS_V1)
    return yield* Effect.fail(corruption(attempt, "pointDependencyCountMismatch"));
  const present = points.filter(point => point.dependency.kind === "present");
  const revisions = present.length === 0 ? [] : yield* readLiveAppRowsAtSnapshotInTransactionEffect(tx, {
    scopeId: attempt.selector.scopeId, tableId,
    rowIds: Object.freeze(present.map(point => point.rowId)),
    snapshotCommitSeq: attempt.snapshotToken.commitSeq,
  }).pipe(Effect.mapError(mapRunApplicationRelationFailure));
  const byRowId = new Map(revisions.map(revision => [revision.rowId, revision] as const));
  const transitions: ApplicationRelationRowTransition[] = [];
  for (const point of points) {
    const prior = byRowId.get(point.rowId);
    if (point.dependency.kind === "present" &&
      (prior === undefined || prior.commitSeq !== point.dependency.revisionCommitSeq))
      return yield* Effect.fail(corruption(attempt, "pointDependencyChangedAtSnapshot"));
    const final = point.overlay.kind === "live" ? point.overlay.document : null;
    transitions.push(Object.freeze({ documentId: appDocumentIdV1FromRowIdentity({ tableId, rowId: point.rowId }),
      tableId, rowId: point.rowId, prior: prior?.document ?? null, final }));
  }
  return Object.freeze(transitions);
});

const runFiniteApplicationRelationIncomingInTransactionEffect = Effect.fn(
  "SessionJournalStore.runFiniteApplicationRelationIncomingInTransaction",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  relation: PinnedApplicationRelationReadState,
  request: StoredApplicationRelationIncomingRequest,
  requestEvidence: CanonicalFlarexValueV1,
  relationPort: ApplicationRelationReadPort,
  finite: FiniteRootAttemptState,
): Effect.fn.Return<AppliedSessionJournalOperationV1, SessionJournalRunApplicationRelationReadError> {
  const attempt = relation.attempt;
  const resolved = relation.resolved;
  const definition = resolved.definition;
  if (!kernelContextMatchesAttempt(context, attempt) || context.journalRoot.executionProfile !== "finiteRoot" ||
    context.journalRoot.state !== "open" || context.journalRoot.lastSyscallSequence !== 0n)
    return yield* Effect.fail(corruption(attempt, "exactAttemptPinsChanged"));
  if (request.relationId !== definition.binding.relationId ||
    request.edgeDefinitionId !== definition.edge.edgeDefinitionId ||
    request.sourceTableId !== definition.binding.sourceTableId ||
    request.targetTableId !== definition.binding.targetTableId)
    return yield* Effect.fail(corruption(attempt, "requestTableCapabilityMismatch"));
  if (resolved.storageGenerationFence !== context.anchor.storageGenerationFence ||
    resolved.storageGenerationFence !== context.scopeClock.storageGenerationFence ||
    resolved.epoch !== context.anchor.snapshotToken.epoch || resolved.epoch !== context.scopeClock.epoch)
    return yield* Effect.fail(new ApplicationRelationReadUnavailableError({ reason: "capabilityMismatch" }));
  const validated = yield* relationPort.validateInTransaction(relation.capability, {
    deploymentId: attempt.selector.deploymentId, scopeId: attempt.selector.scopeId,
    schemaVersionId: attempt.schemaVersionId,
  }, tx, context.scopeClock);
  const activationSequence = ApplicationActivationSequenceV1Schema.make(validated.activeSelection.activationSequence);
  const activeHeadSha256Hex = ApplicationActiveHeadSha256HexV1Schema.make(
    encodeBytesToLowercaseHex(validated.activeSelection.activeHeadSha256));
  if (finite.relationDependencies.some(dependency => dependency.activationSequence !== activationSequence ||
    dependency.activeHeadSha256Hex !== activeHeadSha256Hex))
    return yield* Effect.fail(new ApplicationRelationReadUnavailableError({ reason: "capabilityMismatch" }));
  if (finite.status !== "open") return Object.freeze({ kind: "stateRejected", reason: "journalFailed" });
  const previous = finite.entries.get(request.syscallSequence);
  if (previous !== undefined) {
    if (previous.kind !== "relation" || !bytesEqual(previous.requestEvidence.sha256, requestEvidence.sha256))
      return Object.freeze({ kind: "sequenceRejected", issue: Object.freeze({
        reason: "requestMismatch", syscallSequence: request.syscallSequence,
      }) });
    return Object.freeze({ kind: "outcome", delivery: "replayed", outcome: structuredClone(previous.outcome) });
  }
  if (request.syscallSequence !== finite.lastSequence + 1n) return Object.freeze({
    kind: "sequenceRejected", issue: Object.freeze({ reason: "sequenceGap", actual: request.syscallSequence,
      expectedNext: CommitSyscallSequenceV1Schema.make(finite.lastSequence + 1n) }),
  });
  if (finite.lastSequence >= BigInt(MAX_COMMIT_OPERATION_CALLS_V1)) return Object.freeze({
    kind: "sequenceRejected", issue: Object.freeze({ reason: "sequenceExhausted",
      lastAccepted: CommitFinalSyscallSequenceV1Schema.make(finite.lastSequence) }),
  });
  const existing = finite.relationDependencies.find(dependency => dependency.edgeDefinitionId === request.edgeDefinitionId &&
    dependency.targetRowId === request.targetRowId);
  const dependencyIsNew = existing === undefined;
  const remaining = MAX_COMMIT_RELATION_BASE_OCCURRENCES_V1 - finite.counters.relationBaseOccurrences;
  if (remaining < 2 || firstExceededLimit(finite.counters, { ...ZERO_COUNTER_DELTAS,
    relationReadSyscalls: 1, relationDependencyCount: dependencyIsNew ? 1 : 0 }) !== undefined) {
    finite.status = "aborted";
    const issue = firstExceededLimit(finite.counters, { ...ZERO_COUNTER_DELTAS,
      relationReadSyscalls: 1, relationDependencyCount: dependencyIsNew ? 1 : 0 }) ?? Object.freeze({
      dimension: "relationBaseOccurrences" as const, observed: MAX_COMMIT_RELATION_BASE_OCCURRENCES_V1 + 1,
      maximum: MAX_COMMIT_RELATION_BASE_OCCURRENCES_V1,
    });
    return Object.freeze({ kind: "outcome", delivery: "executed", outcome: Object.freeze({
      kind: "error", reason: "limitExceeded", ...issue,
    }) });
  }
  const transitions = yield* loadFiniteApplicationRelationTransitionsEffect(tx, relation, finite);
  const overlay = yield* Effect.fromResult(relationPort.lowerOverlay(relation.capability, {
    deploymentId: attempt.selector.deploymentId, scopeId: attempt.selector.scopeId,
    schemaVersionId: attempt.schemaVersionId,
  }, transitions));
  const baseItems: AppRelationEdgeIncomingPageItem[] = [];
  let baseExhausted = false;
  let frontier: Readonly<{ sourceRowId: AppRowIdHexV1; duplicateOrdinal: 0 }> | undefined;
  let stableVersion: CommitSeq | undefined;
  let inspected = 0;
  while (true) {
    const available = remaining - inspected;
    if (available < 2) {
      finite.status = "aborted";
      return Object.freeze({ kind: "outcome", delivery: "executed", outcome: Object.freeze({
        kind: "error", reason: "limitExceeded", dimension: "relationBaseOccurrences",
        observed: MAX_COMMIT_RELATION_BASE_OCCURRENCES_V1 + 1,
        maximum: MAX_COMMIT_RELATION_BASE_OCCURRENCES_V1,
      }) });
    }
    const page = yield* readIncomingAppRelationEdgePageInTransactionEffect(tx, {
      scopeId: attempt.selector.scopeId, definition: definition.edge, targetRowId: request.targetRowId,
      maximumIdentities: Math.min(RELATION_INCOMING_PAGE_MAXIMUM_IDENTITIES_V1, available - 1),
      ...(frontier === undefined ? {} : { after: frontier }),
    }).pipe(Effect.mapError(mapRunApplicationRelationFailure));
    inspected += page.inspectedBaseOccurrenceCount;
    if (page.versionAfter < page.versionBefore || page.versionBefore > context.scopeClock.lastCommitSeq ||
      page.versionAfter > context.scopeClock.lastCommitSeq)
      return yield* Effect.fail(corruption(attempt, "relationAdjacencyVersionInvalid"));
    const expectedVersion = existing?.observedAdjacencyVersion ?? stableVersion ?? attempt.snapshotToken.commitSeq;
    if (page.versionBefore !== page.versionAfter || page.versionBefore > attempt.snapshotToken.commitSeq ||
      stableVersion !== undefined && page.versionBefore !== stableVersion ||
      existing !== undefined && page.versionBefore !== existing.observedAdjacencyVersion) {
      if (page.versionAfter <= attempt.snapshotToken.commitSeq)
        return yield* Effect.fail(corruption(attempt, "relationAdjacencyVersionInvalid"));
      const stagedRoot = yield* Effect.tryPromise({
        try: () => stageFiniteRootRows(tx, context, attempt, finite,
          "relationConflict"),
        catch: cause => cause instanceof SessionJournalStorageCorruptionV1Error
          ? cause : new SessionJournalPersistenceV1Error({
            operation: "runApplicationRelationRead", cause,
          }),
      });
      const result = yield* persistApplicationRelationConflictOutcomeEffect(
        tx,
        { ...context, journalRoot: stagedRoot },
        request,
        requestEvidence,
        finite.counters,
        inspected,
        {
          expectedAdjacencyVersion: expectedVersion,
          actualAdjacencyVersion: page.versionAfter,
        },
        dependencyIsNew,
        {
          edgeDefinitionId: request.edgeDefinitionId,
          targetRowId: request.targetRowId,
          observedAdjacencyVersion: expectedVersion,
          activationSequence,
          activeHeadSha256: validated.activeSelection.activeHeadSha256,
        },
        undefined,
      );
      finite.status = "aborted";
      return result;
    }
    stableVersion ??= page.versionBefore;
    baseItems.push(...page.items);
    baseExhausted = page.exhausted;
    const merged = yield* Effect.fromResult(mergeApplicationRelationIncomingPageResult({
      sourceTableId: request.sourceTableId, targetRowId: request.targetRowId,
      maximumIdentities: request.limit, baseItems, baseExhausted, actions: overlay.actions,
    }));
    if (merged.status === "complete") {
      if (stableVersion === undefined) return yield* Effect.fail(corruption(attempt, "relationAdjacencyVersionInvalid"));
      const dependency = yield* Effect.fromResult(decodeRelationIncomingDependencyResult({
        kind: "appRelationIncoming", edgeDefinitionId: request.edgeDefinitionId, targetRowId: request.targetRowId,
        observedAdjacencyVersion: stableVersion, activationSequence, activeHeadSha256Hex,
      }).pipe(Result.mapError(cause => corruption(attempt, "relationDependencyInvalid", cause))));
      const outcome = Object.freeze({ kind: "relationIncomingPage", items: merged.items,
        exhausted: merged.exhausted } satisfies SessionJournalStoredOutcome);
      const outcomeEvidence = yield* fromApplicationRelationPromise(() => canonicalizeStoredOutcome(outcome));
      const deltas = Object.freeze({ ...ZERO_COUNTER_DELTAS, relationReadSyscalls: 1,
        relationDependencyCount: dependencyIsNew ? 1 : 0, relationBaseOccurrences: inspected,
        receiptEvidenceBytes: requestEvidence.canonicalBytes.byteLength + outcomeEvidence.canonicalBytes.byteLength,
      } satisfies SessionJournalCounterDeltasV1);
      const issue = firstExceededLimit(finite.counters, deltas);
      if (issue !== undefined) {
        finite.status = "aborted";
        return Object.freeze({ kind: "outcome", delivery: "executed", outcome: Object.freeze({
          kind: "error", reason: "limitExceeded", ...issue,
        }) });
      }
      if (dependencyIsNew) {
        finite.relationDependencies.push(dependency);
        finite.relationDependencies.sort(compareRelationIncomingDependencies);
      }
      finite.counters = addFiniteCounters(finite.counters, deltas);
      finite.entries.set(request.syscallSequence, Object.freeze({ kind: "relation", request,
        requestEvidence, outcome, outcomeEvidence }));
      finite.lastSequence = request.syscallSequence;
      return Object.freeze({ kind: "outcome", delivery: "executed", outcome: structuredClone(outcome) });
    }
    if (baseExhausted || page.nextFrontier === null)
      return yield* Effect.fail(corruption(attempt, "relationPageFrontierInvalid"));
    frontier = page.nextFrontier;
  }
});

const runApplicationRelationIncomingInTransactionEffect = Effect.fn(
  "SessionJournalStore.runApplicationRelationIncomingInTransaction",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  relation: PinnedApplicationRelationReadState,
  request: StoredApplicationRelationIncomingRequest,
  requestEvidence: CanonicalFlarexValueV1,
  relationPort: ApplicationRelationReadPort,
  faultAfter: SessionJournalStorePersistenceOptionsV1["faultAfter"],
): Effect.fn.Return<
  AppliedSessionJournalOperationV1,
  SessionJournalRunApplicationRelationReadError
> {
  const attempt = relation.attempt;
  const resolved = relation.resolved;
  const definition = resolved.definition;
  if (!kernelContextMatchesAttempt(context, attempt)) {
    return yield* Effect.fail(corruption(attempt, "exactAttemptPinsChanged"));
  }
  if (
    request.relationId !== definition.binding.relationId ||
    request.edgeDefinitionId !== definition.edge.edgeDefinitionId ||
    request.sourceTableId !== definition.binding.sourceTableId ||
    request.targetTableId !== definition.binding.targetTableId
  ) {
    return yield* Effect.fail(corruption(
      attempt,
      "requestTableCapabilityMismatch",
    ));
  }
  if (
    resolved.storageGenerationFence !== context.anchor.storageGenerationFence ||
    resolved.storageGenerationFence !==
      context.scopeClock.storageGenerationFence ||
    resolved.epoch !== context.anchor.snapshotToken.epoch ||
    resolved.epoch !== context.scopeClock.epoch
  ) {
    return yield* Effect.fail(new ApplicationRelationReadUnavailableError({
      reason: "capabilityMismatch",
    }));
  }

  const validated = yield* relationPort.validateInTransaction(
    relation.capability,
    {
      deploymentId: attempt.selector.deploymentId,
      scopeId: attempt.selector.scopeId,
      schemaVersionId: attempt.schemaVersionId,
    },
    tx,
    context.scopeClock,
  );
  const activationSequence = ApplicationActivationSequenceV1Schema.make(
    validated.activeSelection.activationSequence,
  );
  const activeHeadSha256Hex = ApplicationActiveHeadSha256HexV1Schema.make(
    encodeBytesToLowercaseHex(validated.activeSelection.activeHeadSha256),
  );

  const root = context.journalRoot;
  const counters = yield* Effect.fromResult(
    decodeJournalCountersResult(attempt, root),
  );
  const currentDependencies = yield* loadRelationIncomingDependenciesForUpdateEffect(
    tx,
    context,
    attempt,
  );
  if (currentDependencies.length !== counters.relationDependencyCount) {
    return yield* Effect.fail(corruption(
      attempt,
      "relationDependencyCountMismatch",
    ));
  }
  if (currentDependencies.some((dependency) =>
    dependency.activationSequence !== activationSequence ||
    dependency.activeHeadSha256Hex !== activeHeadSha256Hex
  )) {
    return yield* Effect.fail(new ApplicationRelationReadUnavailableError({
      reason: "capabilityMismatch",
    }));
  }
  const receipt = yield* fromApplicationRelationPromise(() =>
    loadLatestReceipt(tx, context)
  );
  yield* Effect.fromResult(validateReceiptCardinalityResult(
    attempt,
    root.lastSyscallSequence,
    receipt,
  ));
  const last = yield* Effect.fromResult(
    decodeCommitFinalSyscallSequenceResult(root.lastSyscallSequence).pipe(
      Result.mapError(mapRunApplicationRelationFailure),
    ),
  );
  const actual = request.syscallSequence;
  if (root.state === "sealed") {
    return Object.freeze({ kind: "stateRejected", reason: "journalSealed" });
  }
  if (actual < last) {
    const prior = yield* fromApplicationRelationPromise(() =>
      loadReceiptAtSequence(tx, context, actual)
    );
    if (prior === undefined) {
      return yield* Effect.fail(corruption(attempt, "latestReceiptMissing"));
    }
    if (!bytesEqual(prior.requestBytes, requestEvidence.canonicalBytes)) {
      return Object.freeze({
        kind: "sequenceRejected",
        issue: Object.freeze({
          reason: "requestMismatch",
          syscallSequence: actual,
        }),
      });
    }
    const replayed = yield* decodeAndVerifyLatestReceiptEffect(
      attempt,
      prior,
      request,
    );
    if (
      replayed.kind !== "relationIncomingPage" &&
      replayed.kind !== "relationConflict" &&
      !isLimitOutcome(replayed)
    ) {
      return yield* Effect.fail(corruption(
        attempt,
        "latestReceiptEvidenceInvalid",
      ));
    }
    return Object.freeze({
      kind: "outcome",
      delivery: "replayed",
      outcome: replayed,
    });
  }
  if (BigInt(actual) === BigInt(last)) {
    if (receipt === undefined) {
      return yield* Effect.fail(corruption(attempt, "latestReceiptMissing"));
    }
    if (!bytesEqual(receipt.requestBytes, requestEvidence.canonicalBytes)) {
      return Object.freeze({
        kind: "sequenceRejected",
        issue: Object.freeze({
          reason: "requestMismatch",
          syscallSequence: actual,
        }),
      });
    }
    if (!bytesEqual(receipt.requestSha256, requestEvidence.sha256)) {
      return yield* Effect.fail(corruption(
        attempt,
        "latestReceiptRequestDigestMismatch",
      ));
    }
    const replayed = yield* decodeAndVerifyLatestReceiptEffect(
      attempt,
      receipt,
      request,
    );
    if (
      replayed.kind !== "relationIncomingPage" &&
      replayed.kind !== "relationConflict" &&
      !isLimitOutcome(replayed)
    ) {
      return yield* Effect.fail(corruption(
        attempt,
        "latestReceiptEvidenceInvalid",
      ));
    }
    if (
      replayed.kind === "relationIncomingPage" &&
      !relationIncomingPositionsCorrelate(
        definition.edge.physical,
        replayed.items,
      )
    ) {
      return yield* Effect.fail(corruption(
        attempt,
        "latestReceiptEvidenceInvalid",
      ));
    }
    yield* Effect.fromResult(validateReceiptOutcomeMatchesJournalRootResult(
      attempt,
      root,
      replayed,
    ));
    return Object.freeze({
      kind: "outcome",
      delivery: "replayed",
      outcome: replayed,
    });
  }
  const nextSequence = nextCommitSyscallSequence(last);
  if (Option.isNone(nextSequence)) {
    return Object.freeze({
      kind: "sequenceRejected",
      issue: Object.freeze({ reason: "sequenceExhausted", lastAccepted: last }),
    });
  }
  const expectedNext = nextSequence.value;
  if (actual !== expectedNext) {
    return Object.freeze({
      kind: "sequenceRejected",
      issue: Object.freeze({ reason: "sequenceGap", actual, expectedNext }),
    });
  }
  if (root.state === "operation_failed") {
    return Object.freeze({ kind: "stateRejected", reason: "journalFailed" });
  }
  if (root.state === "failed") {
    if (receipt === undefined) {
      return yield* Effect.fail(corruption(
        attempt,
        "failedJournalEvidenceInvalid",
      ));
    }
    const sticky = yield* decodeAndVerifyLatestReceiptEffect(
      attempt,
      receipt,
      undefined,
    );
    if (!isLimitOutcome(sticky)) {
      return yield* Effect.fail(corruption(
        attempt,
        "failedJournalReceiptInvalid",
      ));
    }
    yield* Effect.fromResult(validateReceiptOutcomeMatchesJournalRootResult(
      attempt,
      root,
      sticky,
    ));
    return Object.freeze({ kind: "outcome", delivery: "sticky", outcome: sticky });
  }
  if (root.state === "relation_conflicted") {
    return Object.freeze({
      kind: "stateRejected",
      reason: "journalRelationConflicted",
    });
  }
  if (root.state !== "open") {
    return yield* Effect.fail(corruption(attempt, "journalStateInvalid"));
  }

  const existingDependency = currentDependencies.find((dependency) =>
    dependency.edgeDefinitionId === request.edgeDefinitionId &&
    dependency.targetRowId === request.targetRowId
  );
  const dependencyIsNew = existingDependency === undefined;
  const preflightLimit = firstExceededLimit(counters, {
    ...ZERO_COUNTER_DELTAS,
    relationReadSyscalls: 1,
    relationDependencyCount: dependencyIsNew ? 1 : 0,
  });
  if (preflightLimit !== undefined) {
    return yield* persistApplicationRelationLimitOutcomeEffect(
      tx,
      context,
      request,
      requestEvidence,
      counters,
      preflightLimit,
    );
  }
  const remainingBaseBudget = MAX_COMMIT_RELATION_BASE_OCCURRENCES_V1 -
    counters.relationBaseOccurrences;
  if (remainingBaseBudget < 2) {
    return yield* persistApplicationRelationLimitOutcomeEffect(
      tx,
      context,
      request,
      requestEvidence,
      counters,
      Object.freeze({
        dimension: "relationBaseOccurrences",
        observed: MAX_COMMIT_RELATION_BASE_OCCURRENCES_V1 + 1,
        maximum: MAX_COMMIT_RELATION_BASE_OCCURRENCES_V1,
      }),
    );
  }

  const transitions = yield* loadApplicationRelationOverlayTransitionsEffect(
    tx,
    context,
    relation,
  );
  const overlay = yield* Effect.fromResult(relationPort.lowerOverlay(
    relation.capability,
    {
      deploymentId: attempt.selector.deploymentId,
      scopeId: attempt.selector.scopeId,
      schemaVersionId: attempt.schemaVersionId,
    },
    transitions,
  ));

  const baseItems: AppRelationEdgeIncomingPageItem[] = [];
  let baseExhausted = false;
  let frontier: Readonly<{
    sourceRowId: AppRowIdHexV1;
    duplicateOrdinal: 0;
  }> | undefined;
  let stableVersion: CommitSeq | undefined;
  let inspectedBaseOccurrences = 0;
  while (true) {
    const available = remainingBaseBudget - inspectedBaseOccurrences;
    if (available < 2) {
      return yield* persistApplicationRelationLimitOutcomeEffect(
        tx,
        context,
        request,
        requestEvidence,
        counters,
        Object.freeze({
          dimension: "relationBaseOccurrences",
          observed: MAX_COMMIT_RELATION_BASE_OCCURRENCES_V1 + 1,
          maximum: MAX_COMMIT_RELATION_BASE_OCCURRENCES_V1,
        }),
      );
    }
    const physicalPageSize = Math.min(
      RELATION_INCOMING_PAGE_MAXIMUM_IDENTITIES_V1,
      available - 1,
    );
    const page = yield* readIncomingAppRelationEdgePageInTransactionEffect(
      tx,
      {
        scopeId: attempt.selector.scopeId,
        definition: definition.edge,
        targetRowId: request.targetRowId,
        maximumIdentities: physicalPageSize,
        ...(frontier === undefined ? {} : { after: frontier }),
      },
    ).pipe(Effect.mapError(mapRunApplicationRelationFailure));
    inspectedBaseOccurrences += page.inspectedBaseOccurrenceCount;
    if (
      page.versionAfter < page.versionBefore ||
      page.versionBefore > context.scopeClock.lastCommitSeq ||
      page.versionAfter > context.scopeClock.lastCommitSeq
    ) {
      return yield* Effect.fail(corruption(
        attempt,
        "relationAdjacencyVersionInvalid",
      ));
    }
    const expectedVersion = existingDependency?.observedAdjacencyVersion ??
      stableVersion ?? attempt.snapshotToken.commitSeq;
    const actualVersion = page.versionAfter;
    if (
      page.versionBefore !== page.versionAfter ||
      page.versionBefore > attempt.snapshotToken.commitSeq ||
      (stableVersion !== undefined && page.versionBefore !== stableVersion) ||
      (existingDependency !== undefined &&
        page.versionBefore !== existingDependency.observedAdjacencyVersion)
    ) {
      if (actualVersion <= attempt.snapshotToken.commitSeq) {
        return yield* Effect.fail(corruption(
          attempt,
          "relationAdjacencyVersionInvalid",
        ));
      }
      return yield* persistApplicationRelationConflictOutcomeEffect(
        tx,
        context,
        request,
        requestEvidence,
        counters,
        inspectedBaseOccurrences,
        Object.freeze({
          expectedAdjacencyVersion: expectedVersion,
          actualAdjacencyVersion: actualVersion,
        }),
        dependencyIsNew,
        Object.freeze({
          edgeDefinitionId: request.edgeDefinitionId,
          targetRowId: request.targetRowId,
          observedAdjacencyVersion: expectedVersion,
          activationSequence,
          activeHeadSha256: validated.activeSelection.activeHeadSha256,
        }),
        faultAfter,
      );
    }
    stableVersion ??= page.versionBefore;
    baseItems.push(...page.items);
    baseExhausted = page.exhausted;
    const merged = yield* Effect.fromResult(
      mergeApplicationRelationIncomingPageResult({
        sourceTableId: request.sourceTableId,
        targetRowId: request.targetRowId,
        maximumIdentities: request.limit,
        baseItems,
        baseExhausted,
        actions: overlay.actions,
      }),
    );
    if (merged.status === "complete") {
      const observedAdjacencyVersion = stableVersion;
      if (observedAdjacencyVersion === undefined) {
        return yield* Effect.fail(corruption(
          attempt,
          "relationAdjacencyVersionInvalid",
        ));
      }
      const outcome = Object.freeze({
        kind: "relationIncomingPage",
        items: merged.items,
        exhausted: merged.exhausted,
      } satisfies SessionJournalStoredOutcome);
      const outcomeEvidence = yield* fromApplicationRelationPromise(() =>
        canonicalizeStoredOutcome(outcome)
      );
      const deltas = Object.freeze({
        ...ZERO_COUNTER_DELTAS,
        relationReadSyscalls: 1,
        relationDependencyCount: dependencyIsNew ? 1 : 0,
        relationBaseOccurrences: inspectedBaseOccurrences,
        receiptEvidenceBytes: requestEvidence.canonicalBytes.byteLength +
          outcomeEvidence.canonicalBytes.byteLength,
      } satisfies SessionJournalCounterDeltasV1);
      const limitIssue = firstExceededLimit(counters, deltas);
      if (limitIssue !== undefined) {
        return yield* persistApplicationRelationLimitOutcomeEffect(
          tx,
          context,
          request,
          requestEvidence,
          counters,
          limitIssue,
        );
      }
      yield* fromApplicationRelationPromise(async () => {
        if (dependencyIsNew) {
          await insertApplicationRelationIncomingDependency(tx, context, {
            edgeDefinitionId: request.edgeDefinitionId,
            targetRowId: request.targetRowId,
            observedAdjacencyVersion,
            activationSequence,
            activeHeadSha256: validated.activeSelection.activeHeadSha256,
          });
        }
        await faultAfter?.("relationReadEvidenceWritten");
        await persistAcceptedOperation(
          tx,
          context,
          request,
          requestEvidence,
          outcome,
          counters,
          deltas,
          { state: "open", failureDimension: null },
        );
      });
      return Object.freeze({ kind: "outcome", delivery: "executed", outcome });
    }
    const nextFrontier = page.nextFrontier;
    if (baseExhausted || nextFrontier === null) {
      return yield* Effect.fail(corruption(
        attempt,
        "relationPageFrontierInvalid",
      ));
    }
    frontier = nextFrontier;
  }
});

const loadRelationIncomingDependenciesForUpdateEffect = Effect.fn(
  "SessionJournalStore.loadRelationIncomingDependenciesForUpdate",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  attempt: SessionJournalAttemptStateV1,
): Effect.fn.Return<
  ReadonlyArray<LogicalApplicationRelationIncomingReadDependencyV1>,
  SessionJournalRunApplicationRelationReadError
> {
  const rows = yield* fromApplicationRelationPromise(() =>
    tx.select()
      .from(fxSystemTransactionJournalRelationIncomingDependencies)
      .where(and(
        eq(
          fxSystemTransactionJournalRelationIncomingDependencies.scopeUuid,
          context.scopeUuid,
        ),
        eq(
          fxSystemTransactionJournalRelationIncomingDependencies.sessionId,
          context.anchor.sessionId,
        ),
        eq(
          fxSystemTransactionJournalRelationIncomingDependencies.attemptFence,
          context.anchor.attemptFence,
        ),
      ))
      .orderBy(
        asc(
          fxSystemTransactionJournalRelationIncomingDependencies
            .edgeDefinitionId,
        ),
        asc(
          fxSystemTransactionJournalRelationIncomingDependencies.targetRowId,
        ),
      )
      .limit(MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1 + 1)
      .for("update")
  );
  return yield* decodeStoredRelationIncomingDependenciesEffect(attempt, rows);
});

const decodeStoredRelationIncomingDependenciesEffect = Effect.fn(
  "SessionJournalStore.decodeStoredRelationIncomingDependencies",
)(function* (
  attempt: SessionJournalAttemptStateV1,
  rows: ReadonlyArray<
    typeof fxSystemTransactionJournalRelationIncomingDependencies.$inferSelect
  >,
): Effect.fn.Return<
  ReadonlyArray<LogicalApplicationRelationIncomingReadDependencyV1>,
  SessionJournalStorageCorruptionV1Error
> {
  if (rows.length > MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1) {
    return yield* Effect.fail(corruption(
      attempt,
      "relationDependencyCountMismatch",
    ));
  }
  const dependencies: LogicalApplicationRelationIncomingReadDependencyV1[] = [];
  for (const row of rows) {
    const candidate = yield* Effect.try({
      try: () => ({
        kind: "appRelationIncoming" as const,
        edgeDefinitionId: row.edgeDefinitionId,
        targetRowId: appRowIdHexV1FromBytes(row.targetRowId),
        observedAdjacencyVersion: row.observedAdjacencyVersion,
        activationSequence: row.activationSequence,
        activeHeadSha256Hex:
          encodeBytesToLowercaseHex(row.activeHeadSha256),
      }),
      catch: (cause) => corruption(
        attempt,
        "relationDependencyInvalid",
        cause,
      ),
    });
    const dependency = yield* Effect.fromResult(
      decodeRelationIncomingDependencyResult(candidate).pipe(
        Result.mapError((cause) => corruption(
          attempt,
          "relationDependencyInvalid",
          cause,
        )),
      ),
    );
    const previous = dependencies.at(-1);
    if (
      dependency.observedAdjacencyVersion >
        attempt.snapshotToken.commitSeq ||
      previous !== undefined &&
      (compareRelationIncomingDependencies(previous, dependency) >= 0 ||
        previous.activationSequence !== dependency.activationSequence ||
        previous.activeHeadSha256Hex !== dependency.activeHeadSha256Hex)
    ) {
      return yield* Effect.fail(corruption(
        attempt,
        "relationDependencyInvalid",
      ));
    }
    dependencies.push(dependency);
  }
  return Object.freeze(dependencies);
});

const loadApplicationRelationOverlayTransitionsEffect = Effect.fn(
  "SessionJournalStore.loadApplicationRelationOverlayTransitions",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  relation: PinnedApplicationRelationReadState,
): Effect.fn.Return<
  ReadonlyArray<ApplicationRelationRowTransition>,
  SessionJournalRunApplicationRelationReadError
> {
  const attempt = relation.attempt;
  const sourceTableId = relation.resolved.definition.binding.sourceTableId;
  const rows = yield* fromApplicationRelationPromise(() =>
    tx.select()
      .from(fxSystemTransactionJournalPoints)
      .where(and(
        eq(fxSystemTransactionJournalPoints.scopeUuid, context.scopeUuid),
        eq(fxSystemTransactionJournalPoints.sessionId, context.anchor.sessionId),
        eq(
          fxSystemTransactionJournalPoints.attemptFence,
          context.anchor.attemptFence,
        ),
        eq(fxSystemTransactionJournalPoints.tableId, sourceTableId),
        ne(fxSystemTransactionJournalPoints.overlayKind, "none"),
      ))
      .orderBy(asc(fxSystemTransactionJournalPoints.rowId))
      .limit(MAX_POINT_COMMIT_MATERIAL_ROWS_V1 + 1)
      .for("update")
  );
  if (rows.length > MAX_POINT_COMMIT_MATERIAL_ROWS_V1) {
    return yield* Effect.fail(corruption(
      attempt,
      "pointDependencyCountMismatch",
    ));
  }
  const decoded: Array<Readonly<{
    row: typeof fxSystemTransactionJournalPoints.$inferSelect;
    rowId: AppRowIdHexV1;
    dependency: AppRowPointDependencyV1;
  }>> = [];
  const presentRowIds: AppRowIdHexV1[] = [];
  for (const row of rows) {
    const rowId = yield* Effect.try({
      try: () => appRowIdHexV1FromBytes(row.rowId),
      catch: (cause) => corruption(
        attempt,
        "pointDependencyCountMismatch",
        cause,
      ),
    });
    const dependency = yield* Effect.fromResult(
      decodePointDependencyResult(attempt, row),
    );
    if (
      dependency.identity.tableId !== sourceTableId ||
      dependency.identity.rowId !== rowId
    ) {
      return yield* Effect.fail(corruption(
        attempt,
        "pointDependencyCountMismatch",
      ));
    }
    if (dependency.kind === "present") presentRowIds.push(rowId);
    decoded.push(Object.freeze({ row, rowId, dependency }));
  }
  const priorRevisions = presentRowIds.length === 0
    ? Object.freeze([])
    : yield* readLiveAppRowsAtSnapshotInTransactionEffect(tx, {
        scopeId: attempt.selector.scopeId,
        tableId: sourceTableId,
        rowIds: Object.freeze(presentRowIds),
        snapshotCommitSeq: attempt.snapshotToken.commitSeq,
      }).pipe(Effect.mapError(mapRunApplicationRelationFailure));
  const priorByRowId = new Map<AppRowIdHexV1, LiveAppRowRevisionV1>();
  for (const revision of priorRevisions) {
    if (priorByRowId.has(revision.rowId)) {
      return yield* Effect.fail(corruption(
        attempt,
        "pointDependencyChangedAtSnapshot",
      ));
    }
    priorByRowId.set(revision.rowId, revision);
  }
  const transitions: ApplicationRelationRowTransition[] = [];
  for (const item of decoded) {
    const priorRevision = item.dependency.kind === "present"
      ? priorByRowId.get(item.rowId)
      : undefined;
    if (
      item.dependency.kind === "present" &&
      (priorRevision === undefined ||
        priorRevision.commitSeq !== item.dependency.revisionCommitSeq)
    ) {
      return yield* Effect.fail(corruption(
        attempt,
        "pointDependencyChangedAtSnapshot",
      ));
    }
    const final = item.row.overlayKind === "deleted"
      ? null
      : item.row.overlayKind === "live"
        ? yield* decodeLivePointOverlayEvidenceEffect(attempt, item.row)
        : yield* Effect.fail(corruption(
            attempt,
            "liveOverlayEvidenceMissing",
          ));
    transitions.push(Object.freeze({
      documentId: appDocumentIdV1FromRowIdentity({
        tableId: sourceTableId,
        rowId: item.rowId,
      }),
      tableId: sourceTableId,
      rowId: item.rowId,
      prior: priorRevision?.document ?? null,
      final,
    }));
  }
  return Object.freeze(transitions);
});

function compareRelationIncomingDependencies(
  left: LogicalApplicationRelationIncomingReadDependencyV1,
  right: LogicalApplicationRelationIncomingReadDependencyV1,
): number {
  return left.edgeDefinitionId !== right.edgeDefinitionId
    ? left.edgeDefinitionId - right.edgeDefinitionId
    : compareUtf16Strings(left.targetRowId, right.targetRowId);
}

interface ApplicationRelationIncomingJournalDependency {
  readonly edgeDefinitionId: CatalogEdgeDefinitionId;
  readonly targetRowId: AppRowIdHexV1;
  readonly observedAdjacencyVersion: CommitSeq;
  readonly activationSequence: ApplicationActivationSequenceV1;
  readonly activeHeadSha256: Uint8Array;
}

async function insertApplicationRelationIncomingDependency(
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  dependency: ApplicationRelationIncomingJournalDependency,
): Promise<void> {
  await tx.insert(
    fxSystemTransactionJournalRelationIncomingDependencies,
  ).values({
    scopeUuid: context.scopeUuid,
    sessionId: context.anchor.sessionId,
    attemptFence: context.anchor.attemptFence,
    edgeDefinitionId: dependency.edgeDefinitionId,
    targetRowId: appRowIdHexV1ToBytes(dependency.targetRowId),
    observedAdjacencyVersion: dependency.observedAdjacencyVersion,
    activationSequence: dependency.activationSequence,
    activeHeadSha256: new Uint8Array(dependency.activeHeadSha256),
    createdAt: context.databaseNow,
    updatedAt: context.databaseNow,
  });
}

const persistApplicationRelationLimitOutcomeEffect = Effect.fn(
  "SessionJournalStore.persistApplicationRelationLimitOutcome",
)(function (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  request: StoredApplicationRelationIncomingRequest,
  requestEvidence: CanonicalFlarexValueV1,
  counters: SessionJournalCountersV1,
  issue: SessionJournalIncrementalLimitIssueV1,
) {
  const outcome = Object.freeze({
    kind: "error",
    reason: "limitExceeded",
    ...issue,
  } satisfies SessionJournalStoredOutcome);
  return fromApplicationRelationPromise(() => persistAcceptedOperation(
    tx,
    context,
    request,
    requestEvidence,
    outcome,
    counters,
    ZERO_COUNTER_DELTAS,
    { state: "failed", failureDimension: issue.dimension },
  )).pipe(Effect.map(() => Object.freeze({
    kind: "outcome",
    delivery: "executed",
    outcome,
  } as const)));
});

const persistApplicationRelationConflictOutcomeEffect = Effect.fn(
  "SessionJournalStore.persistApplicationRelationConflictOutcome",
)(function (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  request: StoredApplicationRelationIncomingRequest,
  requestEvidence: CanonicalFlarexValueV1,
  counters: SessionJournalCountersV1,
  inspectedBaseOccurrences: number,
  conflict: Readonly<{
    expectedAdjacencyVersion: CommitSeq;
    actualAdjacencyVersion: CommitSeq;
  }>,
  dependencyIsNew: boolean,
  dependency: ApplicationRelationIncomingJournalDependency,
  faultAfter: SessionJournalStorePersistenceOptionsV1["faultAfter"],
) {
  const outcome = Object.freeze({
    kind: "relationConflict",
    edgeDefinitionId: request.edgeDefinitionId,
    targetRowId: request.targetRowId,
    expectedAdjacencyVersion: conflict.expectedAdjacencyVersion,
    actualAdjacencyVersion: conflict.actualAdjacencyVersion,
    snapshotCommitSeq: context.anchor.snapshotToken.commitSeq,
  } satisfies SessionJournalStoredOutcome);
  const deltas = Object.freeze({
    ...ZERO_COUNTER_DELTAS,
    relationReadSyscalls: 1,
    relationDependencyCount: dependencyIsNew ? 1 : 0,
    relationBaseOccurrences: inspectedBaseOccurrences,
  } satisfies SessionJournalCounterDeltasV1);
  return fromApplicationRelationPromise(async () => {
    if (dependencyIsNew) {
      await insertApplicationRelationIncomingDependency(
        tx,
        context,
        dependency,
      );
    }
    await persistAcceptedOperation(
      tx,
      context,
      request,
      requestEvidence,
      outcome,
      counters,
      deltas,
      { state: "relation_conflicted", failureDimension: null },
    );
    await faultAfter?.("relationConflictEvidenceWritten");
  }).pipe(Effect.map(() => Object.freeze({
    kind: "outcome",
    delivery: "executed",
    outcome,
  } as const)));
});

function indexRangeDependencyFromPage(
  index: PinnedDeveloperIndexStateV1,
  request: Extract<SessionJournalStoredRequest, {
    readonly kind: "indexRange";
  }>,
  entries: ReadonlyArray<Readonly<{
    readonly encodedKey: OrderedIndexKeyBytesHexV1;
    readonly rowId: OrderedIndexRowIdHexV1;
  }>>,
  isDone: boolean,
): LogicalIndexRangeReadDependencyV1 {
  const last = entries.at(-1);
  if (!isDone && last === undefined) {
    // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: invariant - positive limits and N-plus-one page construction require a consumed position for every non-final page
    throw new Error("A non-final indexed page must contain a consumed position.");
  }
  return Object.freeze({
    kind: "appIndexRange",
    tableId: index.tableId,
    indexDefinitionId: index.definition.indexDefinitionId,
    keyCodecVersion: ORDERED_INDEX_KEY_CODEC_VERSION_V1,
    physicalSpecSha256Hex: index.definition.physicalSpecSha256Hex,
    direction: "asc",
    lower: request.startInclusive === null
      ? null
      : Object.freeze({
          kind: "key",
          encodedKey: request.startInclusive,
          inclusive: true,
        }),
    upper: isDone
      ? request.endExclusive === null
        ? null
        : Object.freeze({
            kind: "key",
            encodedKey: request.endExclusive,
            inclusive: false,
          })
      : Object.freeze({
          kind: "position",
          encodedKey: last!.encodedKey,
          rowId: last!.rowId,
          inclusive: true,
        }),
  });
}

function encodedIndexKeyIsWithinBounds(
  encodedKey: OrderedIndexKeyBytesHexV1,
  request: Extract<SessionJournalStoredRequest, {
    readonly kind: "indexRange";
  }>,
): boolean {
  return (
    request.startInclusive === null ||
    compareUtf16Strings(encodedKey, request.startInclusive) >= 0
  ) && (
    request.endExclusive === null ||
    compareUtf16Strings(encodedKey, request.endExclusive) < 0
  );
}

function compareIndexedQueryMergedPositions(
  left: IndexedQueryMergedPositionV1,
  right: IndexedQueryMergedPositionV1,
): number {
  const keyOrder = compareUtf16Strings(left.encodedKey, right.encodedKey);
  return keyOrder !== 0
    ? keyOrder
    : compareUtf16Strings(left.rowId, right.rowId);
}

interface PreparedStoredIndexRangeV1 {
  readonly dependency: LogicalIndexRangeReadDependencyV1;
  readonly evidenceBytes: number;
}

function prepareStoredIndexRanges(
  dependencies: ReadonlyArray<LogicalIndexRangeReadDependencyV1>,
): ReadonlyArray<PreparedStoredIndexRangeV1> {
  return Object.freeze(dependencies.map((dependency) => {
    const encoded = requireJson(encodeIndexRangeDependency(dependency));
    const canonicalText = encodeCanonicalJson(encoded, () => {
      throw new Error("Index-range dependency violated canonical JSON invariants.");
    });
    return Object.freeze({
      dependency,
      evidenceBytes: TEXT_ENCODER.encode(canonicalText).byteLength,
    });
  }));
}

const loadIndexRangeDependenciesForUpdateEffect = Effect.fn(
  "SessionJournalStore.loadIndexRangeDependenciesForUpdate",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  attempt: SessionJournalAttemptStateV1,
): Effect.fn.Return<
  ReadonlyArray<LogicalIndexRangeReadDependencyV1>,
  SessionJournalRunIndexedQueryV1Error
> {
  const rows = yield* fromIndexedQueryPromise(() =>
    tx.select()
      .from(fxSystemTransactionJournalIndexRanges)
      .where(and(
        eq(fxSystemTransactionJournalIndexRanges.scopeUuid, context.scopeUuid),
        eq(fxSystemTransactionJournalIndexRanges.sessionId, context.anchor.sessionId),
        eq(fxSystemTransactionJournalIndexRanges.attemptFence, context.anchor.attemptFence),
      ))
      .orderBy(asc(fxSystemTransactionJournalIndexRanges.ordinal))
      .limit(MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1 + 1)
      .for("update")
  );
  return yield* decodeStoredIndexRangeRowsEffect(attempt, rows);
});

const decodeStoredIndexRangeRowsEffect = Effect.fn(
  "SessionJournalStore.decodeStoredIndexRangeRows",
)(function* (
  attempt: SessionJournalAttemptStateV1,
  rows: ReadonlyArray<
    typeof fxSystemTransactionJournalIndexRanges.$inferSelect
  >,
): Effect.fn.Return<
  ReadonlyArray<LogicalIndexRangeReadDependencyV1>,
  SessionJournalStorageCorruptionV1Error
> {
  if (rows.length > MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1) {
    return yield* Effect.fail(corruption(
      attempt,
      "indexRangeDependencyCountMismatch",
    ));
  }
  const dependencies: LogicalIndexRangeReadDependencyV1[] = [];
  for (let ordinal = 0; ordinal < rows.length; ordinal += 1) {
    const row = rows[ordinal]!;
    if (row.ordinal !== ordinal) {
      return yield* Effect.fail(corruption(
        attempt,
        "indexRangeDependencyInvalid",
      ));
    }
    const candidate = yield* Effect.try({
      try: () => ({
        kind: "appIndexRange",
        tableId: row.tableId,
        indexDefinitionId: row.indexDefinitionId,
        keyCodecVersion: row.keyCodecVersion,
        physicalSpecSha256Hex: appIndexPhysicalSpecSha256HexV1FromBytes(
          row.physicalSpecSha256,
        ),
        direction: row.direction,
        lower: row.lowerKind === "unbounded"
          ? null
          : {
              kind: "key",
              encodedKey: orderedIndexBoundHexV1FromBytes(row.lowerEncodedKey!),
              inclusive: true,
            },
        upper: row.upperKind === "unbounded"
          ? null
          : row.upperKind === "key_exclusive"
            ? {
                kind: "key",
                encodedKey: orderedIndexBoundHexV1FromBytes(row.upperEncodedKey!),
                inclusive: false,
              }
            : {
                kind: "position",
                encodedKey: orderedIndexKeyBytesHexV1FromBytes(row.upperEncodedKey!),
                rowId: Result.getOrThrow(
                  orderedIndexRowIdHexV1FromBytesResult(row.upperRowId!),
                ),
                inclusive: true,
              },
      }),
      catch: (cause) => corruption(
        attempt,
        "indexRangeDependencyInvalid",
        cause,
      ),
    });
    const dependency = yield* Effect.fromResult(
      decodeIndexRangeDependencyResult(candidate).pipe(
        Result.mapError((cause) => corruption(
          attempt,
          "indexRangeDependencyInvalid",
          cause,
        )),
      ),
    );
    const prepared = prepareStoredIndexRanges([dependency])[0]!;
    if (prepared.evidenceBytes !== row.evidenceBytes) {
      return yield* Effect.fail(corruption(
        attempt,
        "indexRangeDependencyEvidenceBytesMismatch",
      ));
    }
    dependencies.push(dependency);
  }
  const normalized = yield* Effect.fromResult(
    normalizeLogicalIndexRangeReadDependenciesV1Result(dependencies).pipe(
      Result.mapError((cause) => corruption(
        attempt,
        "indexRangeDependencyInvalid",
        cause,
      )),
    ),
  );
  if (
    normalized.length !== dependencies.length ||
    normalized.some((dependency, ordinal) =>
      !storedIndexRangeDependenciesEqual(
        dependency,
        dependencies[ordinal]!,
      )
    )
  ) {
    return yield* Effect.fail(corruption(
      attempt,
      "indexRangeDependencyInvalid",
    ));
  }
  return normalized;
});

function storedIndexRangeDependenciesEqual(
  left: LogicalIndexRangeReadDependencyV1,
  right: LogicalIndexRangeReadDependencyV1,
): boolean {
  return jsonEqual(
    requireJson(encodeIndexRangeDependency(left)),
    requireJson(encodeIndexRangeDependency(right)),
  );
}

async function replaceStoredIndexRanges(
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  ranges: ReadonlyArray<PreparedStoredIndexRangeV1>,
): Promise<void> {
  await tx.delete(fxSystemTransactionJournalIndexRanges).where(and(
    eq(fxSystemTransactionJournalIndexRanges.scopeUuid, context.scopeUuid),
    eq(fxSystemTransactionJournalIndexRanges.sessionId, context.anchor.sessionId),
    eq(fxSystemTransactionJournalIndexRanges.attemptFence, context.anchor.attemptFence),
  ));
  if (ranges.length === 0) return;
  await tx.insert(fxSystemTransactionJournalIndexRanges).values(
    ranges.map((range, ordinal) => {
      const dependency = range.dependency;
      return {
        scopeUuid: context.scopeUuid,
        sessionId: context.anchor.sessionId,
        attemptFence: context.anchor.attemptFence,
        ordinal,
        tableId: dependency.tableId,
        indexDefinitionId: dependency.indexDefinitionId,
        keyCodecVersion: dependency.keyCodecVersion,
        physicalSpecSha256: appIndexPhysicalSpecSha256HexV1ToBytes(
          dependency.physicalSpecSha256Hex,
        ),
        direction: dependency.direction,
        lowerKind: dependency.lower === null
          ? "unbounded" as const
          : "key_inclusive" as const,
        lowerEncodedKey: dependency.lower === null
          ? null
          : orderedIndexBoundHexV1ToBytes(dependency.lower.encodedKey),
        upperKind: dependency.upper === null
          ? "unbounded" as const
          : dependency.upper.kind === "key"
            ? "key_exclusive" as const
            : "position_inclusive" as const,
        upperEncodedKey: dependency.upper === null
          ? null
          : dependency.upper.kind === "key"
            ? orderedIndexBoundHexV1ToBytes(dependency.upper.encodedKey)
            : orderedIndexKeyBytesHexV1ToBytes(dependency.upper.encodedKey),
        upperRowId: dependency.upper?.kind === "position"
          ? orderedIndexRowIdHexV1ToBytes(dependency.upper.rowId)
          : null,
        evidenceBytes: range.evidenceBytes,
        createdAt: context.databaseNow,
        updatedAt: context.databaseNow,
      };
    }),
  );
}

const planFreshPointOperationEffect = Effect.fn(
  "SessionJournalStore.planFreshPointOperation",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  table: PinnedPointTableStateV1,
  request: SessionJournalStoredPointRequest,
  randomUuid: () => string,
  finite?: FiniteRootAttemptState,
): Effect.fn.Return<
  SessionJournalOperationPlanV1,
  SessionJournalRunPointOperationV1Error
> {
  switch (request.kind) {
    case "get": {
      const identity = decodeAppDocumentIdentityV1(request.documentId);
      const read = yield* readLogicalPointEffect(
        tx,
        context,
        table,
        identity.rowId,
        finite,
      );
      const counters = countersForPointRead(read);
      return Object.freeze({
        outcome: read.result.kind === "present"
          ? Object.freeze({
              kind: "present",
              documentValueJson: read.result.document.valueJson,
            })
          : Object.freeze({ kind: "missing" }),
        counters,
        ...(read.pointMutation === undefined
          ? {}
          : { pointMutation: read.pointMutation }),
      });
    }
    case "insert":
      return yield* planInsertEffect(
        tx,
        context,
        table,
        request,
        randomUuid,
        finite,
      );
    case "patch":
      return yield* planPatchEffect(tx, context, table, request, finite);
    case "replace":
      return yield* planReplaceEffect(tx, context, table, request, finite);
    case "delete":
      return yield* planDeleteEffect(tx, context, table, request, finite);
  }
});

const planInsertEffect = Effect.fn(
  "SessionJournalStore.planInsert",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  table: PinnedPointTableStateV1,
  request: Extract<SessionJournalStoredRequest, { readonly kind: "insert" }>,
  randomUuid: () => string,
  finite?: FiniteRootAttemptState,
): Effect.fn.Return<
  SessionJournalOperationPlanV1,
  SessionJournalRunPointOperationV1Error
> {
  const generatedUuid = randomUuid();
  if (typeof generatedUuid !== "string" || !UUID_V4_PATTERN.test(generatedUuid)) {
    return yield* Effect.fail(new SessionJournalIdentityGenerationV1Error({
      generatedValue: generatedUuid,
    }));
  }
  const rowId = decodeAppDocumentIdentityV1(
    `${table.tableId}:${generatedUuid}`,
  ).rowId;
  const documentId = appDocumentIdV1FromRowIdentity({
    tableId: table.tableId,
    rowId,
  });
  const creationTime = decodeAppCreationTimeV1(
    finite?.nextCreationTime ?? context.journalRoot.nextCreationTime,
  );
  const nextCreationTime = nextAppCreationTime(creationTime);

  const historical = yield* fromPointOperationPromise(() =>
    tx
      .select({ commitSeq: fxAppRowRevisions.commitSeq })
      .from(fxAppRowRevisions)
      .where(and(
        eq(fxAppRowRevisions.scopeUuid, context.scopeUuid),
        eq(fxAppRowRevisions.tableId, table.tableId),
        eq(fxAppRowRevisions.rowId, appRowIdHexV1ToBytes(rowId)),
      ))
      .limit(1)
  );
  const staged = finite === undefined
    ? yield* loadJournalPointRowEffect(tx, context, table.tableId, rowId)
    : finite.points.get(`${table.tableId}/${rowId}`);
  if (historical[0] !== undefined || staged !== undefined) {
    return Object.freeze({
      outcome: Object.freeze({
        kind: "error",
        reason: "documentIdCollision",
        documentId,
      }),
      counters: ZERO_COUNTER_DELTAS,
      nextCreationTime,
    });
  }

  const fields = normalizeFlarexValueJsonV1(
    request.fieldsValueJson,
    "appDocument",
  ).value;
  const documentResult = yield* tryCanonicalizeDocumentEffect({
    tableId: table.tableId,
    rowId,
    creationTime,
    fields,
  });
  if (documentResult.kind === "invalid") {
    return Object.freeze({
      outcome: Object.freeze({
        kind: "error",
        reason: "invalidDocument",
        operation: "insert",
      }),
      counters: ZERO_COUNTER_DELTAS,
      nextCreationTime,
    });
  }
  const document = documentResult.document;
  const dependency = Object.freeze({
    kind: "missing",
    identity: Object.freeze({
      scopeId: table.attempt.selector.scopeId,
      tableId: table.tableId,
      rowId,
    }),
    basis: Object.freeze({ kind: "noVisibleRevision" }),
  } satisfies AppRowPointDependencyV1);
  const write = Object.freeze({
    kind: "insert",
    syscallSequence: request.syscallSequence,
    documentId,
    creationTime,
    fieldsValueJson: request.fieldsValueJson,
    resultingDocumentSemanticBytes:
      CommitDocumentSemanticBytesV1Schema.make(document.semanticSizeBytes),
  } satisfies LogicalAppWriteV1);
  return Object.freeze({
    outcome: Object.freeze({
      kind: "inserted",
      documentId,
      documentValueJson: document.valueJson,
    }),
    counters: Object.freeze({
      ...ZERO_COUNTER_DELTAS,
      pointDependencyCount: 1,
      writeOperations: 1,
      writeSemanticBytes: document.semanticSizeBytes,
    }),
    pointMutation: Object.freeze({
      mode: "insert",
      tableId: table.tableId,
      rowId,
      dependency,
      overlay: Object.freeze({
        kind: "live",
        creationTime,
        document,
      }),
    }),
    write,
    documentValidation: Object.freeze({
      operation: "insert",
      tableName: table.tableName,
      tableId: table.tableId,
      documentId,
      creationTime,
      document,
    }),
    nextCreationTime,
  });
});

const planPatchEffect = Effect.fn(
  "SessionJournalStore.planPatch",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  table: PinnedPointTableStateV1,
  request: Extract<SessionJournalStoredRequest, { readonly kind: "patch" }>,
  finite?: FiniteRootAttemptState,
): Effect.fn.Return<
  SessionJournalOperationPlanV1,
  SessionJournalRunPointOperationV1Error
> {
  const identity = decodeAppDocumentIdentityV1(request.documentId);
  const read = yield* readLogicalPointEffect(
    tx,
    context,
    table,
    identity.rowId,
    finite,
  );
  const readCounters = countersForPointRead(read);
  if (read.result.kind === "missing") {
    return Object.freeze({
      outcome: Object.freeze({
        kind: "error",
        reason: "documentNotFound",
        operation: "patch",
        documentId: request.documentId,
      }),
      counters: readCounters,
      ...(read.pointMutation === undefined
        ? {}
        : { pointMutation: read.pointMutation }),
    });
  }
  const current = read.result.document;
  const fields = developerFieldsFromDocument(current.value);
  applyPatchChanges(fields, request.changes);
  const creationTime = creationTimeFromDocument(current.value);
  const documentResult = yield* tryCanonicalizeDocumentEffect({
    tableId: table.tableId,
    rowId: identity.rowId,
    creationTime,
    fields,
  });
  if (documentResult.kind === "invalid") {
    return Object.freeze({
      outcome: Object.freeze({
        kind: "error",
        reason: "invalidDocument",
        operation: "patch",
      }),
      counters: readCounters,
      ...(read.pointMutation === undefined
        ? {}
        : { pointMutation: read.pointMutation }),
    });
  }
  const next = documentResult.document;
  if (bytesEqual(current.canonicalBytes, next.canonicalBytes)) {
    return Object.freeze({
      outcome: Object.freeze({ kind: "unit", operation: "patch" }),
      counters: readCounters,
      documentValidation: Object.freeze({
        operation: "patch",
        tableName: table.tableName,
        tableId: table.tableId,
        documentId: request.documentId,
        creationTime,
        document: next,
      }),
      ...(read.pointMutation === undefined
        ? {}
        : { pointMutation: read.pointMutation }),
    });
  }
  const write = Object.freeze({
    kind: "patch",
    syscallSequence: request.syscallSequence,
    documentId: request.documentId,
    changes: request.changes,
    resultingDocumentSemanticBytes:
      CommitDocumentSemanticBytesV1Schema.make(next.semanticSizeBytes),
  } satisfies LogicalAppWriteV1);
  return Object.freeze({
    outcome: Object.freeze({ kind: "unit", operation: "patch" }),
    counters: Object.freeze({
      ...readCounters,
      writeOperations: 1,
      writeSemanticBytes: next.semanticSizeBytes,
    }),
    pointMutation: pointMutationForOverlay(
      read,
      table.tableId,
      identity.rowId,
      Object.freeze({ kind: "live", creationTime, document: next }),
    ),
    write,
    documentValidation: Object.freeze({
      operation: "patch",
      tableName: table.tableName,
      tableId: table.tableId,
      documentId: request.documentId,
      creationTime,
      document: next,
    }),
  });
});

const planReplaceEffect = Effect.fn(
  "SessionJournalStore.planReplace",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  table: PinnedPointTableStateV1,
  request: Extract<SessionJournalStoredRequest, { readonly kind: "replace" }>,
  finite?: FiniteRootAttemptState,
): Effect.fn.Return<
  SessionJournalOperationPlanV1,
  SessionJournalRunPointOperationV1Error
> {
  const identity = decodeAppDocumentIdentityV1(request.documentId);
  const read = yield* readLogicalPointEffect(
    tx,
    context,
    table,
    identity.rowId,
    finite,
  );
  const readCounters = countersForPointRead(read);
  if (read.result.kind === "missing") {
    return Object.freeze({
      outcome: Object.freeze({
        kind: "error",
        reason: "documentNotFound",
        operation: "replace",
        documentId: request.documentId,
      }),
      counters: readCounters,
      ...(read.pointMutation === undefined
        ? {}
        : { pointMutation: read.pointMutation }),
    });
  }
  const current = read.result.document;
  const fields = normalizeFlarexValueJsonV1(
    request.fieldsValueJson,
    "appDocument",
  ).value;
  const creationTime = creationTimeFromDocument(current.value);
  const documentResult = yield* tryCanonicalizeDocumentEffect({
    tableId: table.tableId,
    rowId: identity.rowId,
    creationTime,
    fields,
  });
  if (documentResult.kind === "invalid") {
    return Object.freeze({
      outcome: Object.freeze({
        kind: "error",
        reason: "invalidDocument",
        operation: "replace",
      }),
      counters: readCounters,
      ...(read.pointMutation === undefined
        ? {}
        : { pointMutation: read.pointMutation }),
    });
  }
  const next = documentResult.document;
  if (bytesEqual(current.canonicalBytes, next.canonicalBytes)) {
    return Object.freeze({
      outcome: Object.freeze({ kind: "unit", operation: "replace" }),
      counters: readCounters,
      documentValidation: Object.freeze({
        operation: "replace",
        tableName: table.tableName,
        tableId: table.tableId,
        documentId: request.documentId,
        creationTime,
        document: next,
      }),
      ...(read.pointMutation === undefined
        ? {}
        : { pointMutation: read.pointMutation }),
    });
  }
  const write = Object.freeze({
    kind: "replace",
    syscallSequence: request.syscallSequence,
    documentId: request.documentId,
    fieldsValueJson: request.fieldsValueJson,
    resultingDocumentSemanticBytes:
      CommitDocumentSemanticBytesV1Schema.make(next.semanticSizeBytes),
  } satisfies LogicalAppWriteV1);
  return Object.freeze({
    outcome: Object.freeze({ kind: "unit", operation: "replace" }),
    counters: Object.freeze({
      ...readCounters,
      writeOperations: 1,
      writeSemanticBytes: next.semanticSizeBytes,
    }),
    pointMutation: pointMutationForOverlay(
      read,
      table.tableId,
      identity.rowId,
      Object.freeze({ kind: "live", creationTime, document: next }),
    ),
    write,
    documentValidation: Object.freeze({
      operation: "replace",
      tableName: table.tableName,
      tableId: table.tableId,
      documentId: request.documentId,
      creationTime,
      document: next,
    }),
  });
});

const planDeleteEffect = Effect.fn(
  "SessionJournalStore.planDelete",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  table: PinnedPointTableStateV1,
  request: Extract<SessionJournalStoredRequest, { readonly kind: "delete" }>,
  finite?: FiniteRootAttemptState,
): Effect.fn.Return<
  SessionJournalOperationPlanV1,
  SessionJournalRunPointOperationV1Error
> {
  const identity = decodeAppDocumentIdentityV1(request.documentId);
  const read = yield* readLogicalPointEffect(
    tx,
    context,
    table,
    identity.rowId,
    finite,
  );
  const readCounters = countersForPointRead(read);
  if (read.result.kind === "missing") {
    return Object.freeze({
      outcome: Object.freeze({
        kind: "error",
        reason: "documentNotFound",
        operation: "delete",
        documentId: request.documentId,
      }),
      counters: readCounters,
      ...(read.pointMutation === undefined
        ? {}
        : { pointMutation: read.pointMutation }),
    });
  }
  const write = Object.freeze({
    kind: "delete",
    syscallSequence: request.syscallSequence,
    documentId: request.documentId,
  } satisfies LogicalAppWriteV1);
  return Object.freeze({
    outcome: Object.freeze({ kind: "unit", operation: "delete" }),
    counters: Object.freeze({
      ...readCounters,
      writeOperations: 1,
    }),
    pointMutation: pointMutationForOverlay(
      read,
      table.tableId,
      identity.rowId,
      Object.freeze({ kind: "deleted" }),
    ),
    write,
  });
});

const readLogicalPointEffect = Effect.fn(
  "SessionJournalStore.readLogicalPoint",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  table: PinnedPointTableStateV1,
  rowId: AppRowIdHexV1,
  finite?: FiniteRootAttemptState,
): Effect.fn.Return<
  LogicalPointReadV1,
  SessionJournalRunPointOperationV1Error
> {
  if (finite !== undefined) {
    const key = `${table.tableId}/${rowId}`;
    const staged = finite.points.get(key);
    const cached = finite.pointReads.get(key);
    if (staged !== undefined) {
      const dependency = staged.dependency;
      if (staged.overlay.kind === "live") return Object.freeze({ dependencyIsNew: false, pointMutation: staged,
        result: Object.freeze({ kind: "present", document: staged.overlay.document, dependency }) });
      if (staged.overlay.kind === "deleted") return Object.freeze({ dependencyIsNew: false, pointMutation: staged,
        result: Object.freeze({ kind: "missing", document: null, dependency }) });
      if (cached !== undefined) return Object.freeze({ result: cached.result, dependencyIsNew: false,
        pointMutation: staged });
      const result = yield* getAppRowAtSnapshotInTransactionEffect(tx, {
        snapshotToken: table.attempt.snapshotToken, tableId: table.tableId, rowId,
      }).pipe(Effect.mapError(mapRunPointOperationFailure));
      if (!dependenciesEqual(dependency, result.dependency)) return yield* Effect.fail(corruption(
        table.attempt, "pointDependencyChangedAtSnapshot"));
      finite.pointReads.set(key, Object.freeze({ result, dependencyIsNew: false }));
      return Object.freeze({ result, dependencyIsNew: false, pointMutation: staged });
    }
    if (cached !== undefined) return Object.freeze({ result: cached.result, dependencyIsNew: false });
    const result = yield* getAppRowAtSnapshotInTransactionEffect(tx, {
      snapshotToken: table.attempt.snapshotToken, tableId: table.tableId, rowId,
    }).pipe(Effect.mapError(mapRunPointOperationFailure));
    const read = Object.freeze({ result, dependencyIsNew: true,
      pointMutation: Object.freeze({ mode: "insert" as const, tableId: table.tableId, rowId,
        dependency: result.dependency, overlay: Object.freeze({ kind: "none" as const }) }) });
    finite.pointReads.set(key, read);
    return read;
  }
  const point = yield* loadJournalPointRowEffect(
    tx,
    context,
    table.tableId,
    rowId,
  );
  if (point === undefined) {
    const result = yield* getAppRowAtSnapshotInTransactionEffect(tx, {
        snapshotToken: table.attempt.snapshotToken,
        tableId: table.tableId,
        rowId,
      }).pipe(Effect.mapError(mapRunPointOperationFailure));
    return Object.freeze({
      result,
      dependencyIsNew: true,
      pointMutation: Object.freeze({
        mode: "insert",
        tableId: table.tableId,
        rowId,
        dependency: result.dependency,
        overlay: Object.freeze({ kind: "none" }),
      }),
    });
  }

  const dependency = yield* Effect.fromResult(
    decodePointDependencyResult(table.attempt, point),
  );
  switch (point.overlayKind) {
    case "live": {
      const document = yield* decodeLivePointOverlayEvidenceEffect(
        table.attempt,
        point,
      );
      return Object.freeze({
        dependencyIsNew: false,
        result: Object.freeze({
          kind: "present",
          document,
          dependency,
        }),
      });
    }
    case "deleted":
      return Object.freeze({
        dependencyIsNew: false,
        result: Object.freeze({
          kind: "missing",
          document: null,
          dependency,
        }),
      });
    case "none": {
      const result = yield* getAppRowAtSnapshotInTransactionEffect(tx, {
          snapshotToken: table.attempt.snapshotToken,
          tableId: table.tableId,
          rowId,
        }).pipe(Effect.mapError(mapRunPointOperationFailure));
      if (!dependenciesEqual(dependency, result.dependency)) {
        return yield* Effect.fail(corruption(
          table.attempt,
          "pointDependencyChangedAtSnapshot",
        ));
      }
      return Object.freeze({ result, dependencyIsNew: false });
    }
  }
});

const loadJournalPointRowEffect = Effect.fn(
  "SessionJournalStore.loadJournalPointRow",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  tableId: CatalogTableId,
  rowId: AppRowIdHexV1,
): Effect.fn.Return<
  typeof fxSystemTransactionJournalPoints.$inferSelect | undefined,
  SessionJournalRunPointOperationV1Error
> {
  const rows = yield* fromPointOperationPromise(() =>
    tx
      .select()
      .from(fxSystemTransactionJournalPoints)
      .where(and(
        eq(fxSystemTransactionJournalPoints.scopeUuid, context.scopeUuid),
        eq(
          fxSystemTransactionJournalPoints.sessionId,
          context.anchor.sessionId,
        ),
        eq(
          fxSystemTransactionJournalPoints.attemptFence,
          context.anchor.attemptFence,
        ),
        eq(fxSystemTransactionJournalPoints.tableId, tableId),
        eq(
          fxSystemTransactionJournalPoints.rowId,
          appRowIdHexV1ToBytes(rowId),
        ),
      ))
      .limit(2)
  );
  if (rows.length > 1) {
    return yield* Effect.fail(mapRunPointOperationFailure(
      new Error("Journal point primary key returned duplicate rows."),
    ));
  }
  return rows[0];
});

function countersForPointRead(
  read: LogicalPointReadV1,
): SessionJournalCounterDeltasV1 {
  return Object.freeze({
    ...ZERO_COUNTER_DELTAS,
    pointDependencyCount: read.dependencyIsNew ? 1 : 0,
    readDocuments: read.result.kind === "present" ? 1 : 0,
    readSemanticBytes: read.result.kind === "present"
      ? read.result.document.semanticSizeBytes
      : 0,
  });
}

function pointMutationForOverlay(
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

function decodePointDependencyResult(
  attempt: SessionJournalAttemptStateV1,
  row: typeof fxSystemTransactionJournalPoints.$inferSelect,
): Result.Result<
  AppRowPointDependencyV1,
  SessionJournalStorageCorruptionV1Error
> {
  const rowId = appRowIdHexV1FromBytes(row.rowId);
  const identity = Object.freeze({
    scopeId: attempt.selector.scopeId,
    tableId: CatalogTableIdSchema.make(row.tableId),
    rowId,
  });
  switch (row.dependencyKind) {
    case "present":
      if (row.dependencyRevisionCommitSeq === null) {
        return Result.fail(corruption(
          attempt,
          "presentDependencyRevisionMissing",
        ));
      }
      return Result.succeed(Object.freeze({
        kind: "present",
        identity,
        revisionCommitSeq: CommitSeqSchema.make(
          row.dependencyRevisionCommitSeq,
        ),
      }));
    case "missing_no_visible_revision":
      if (row.dependencyRevisionCommitSeq !== null) {
        return Result.fail(corruption(
          attempt,
          "missingDependencyUnexpectedRevision",
        ));
      }
      return Result.succeed(Object.freeze({
        kind: "missing",
        identity,
        basis: Object.freeze({ kind: "noVisibleRevision" }),
      }));
    case "missing_tombstone":
      if (row.dependencyRevisionCommitSeq === null) {
        return Result.fail(corruption(
          attempt,
          "tombstoneDependencyRevisionMissing",
        ));
      }
      return Result.succeed(Object.freeze({
        kind: "missing",
        identity,
        basis: Object.freeze({
          kind: "tombstone",
          revisionCommitSeq: CommitSeqSchema.make(
            row.dependencyRevisionCommitSeq,
          ),
        }),
      }));
  }
}

function dependenciesEqual(
  left: AppRowPointDependencyV1,
  right: AppRowPointDependencyV1,
): boolean {
  if (
    left.kind !== right.kind ||
    left.identity.scopeId !== right.identity.scopeId ||
    left.identity.tableId !== right.identity.tableId ||
    left.identity.rowId !== right.identity.rowId
  ) {
    return false;
  }
  if (left.kind === "present" && right.kind === "present") {
    return left.revisionCommitSeq === right.revisionCommitSeq;
  }
  if (left.kind === "missing" && right.kind === "missing") {
    if (left.basis.kind !== right.basis.kind) return false;
    return left.basis.kind === "noVisibleRevision" ||
      (right.basis.kind === "tombstone" &&
        left.basis.revisionCommitSeq === right.basis.revisionCommitSeq);
  }
  return false;
}

function developerFieldsFromDocument(
  document: CanonicalFlarexRuntimeValueV1,
): Record<string, CanonicalFlarexRuntimeValueV1> {
  if (!isCanonicalFlarexRuntimeObjectV1(document)) {
    throw new Error("Canonical app document is not an object.");
  }
  const fields: Record<string, CanonicalFlarexRuntimeValueV1> = {};
  for (const [field, value] of Object.entries(document)) {
    if (field === "_id" || field === "_creationTime") continue;
    Object.defineProperty(fields, field, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return fields;
}

function creationTimeFromDocument(
  document: CanonicalFlarexRuntimeValueV1,
): AppCreationTimeV1 {
  if (!isCanonicalFlarexRuntimeObjectV1(document)) {
    throw new Error("Canonical app document is not an object.");
  }
  return decodeAppCreationTimeV1(document._creationTime);
}

function applyPatchChanges(
  fields: Record<string, CanonicalFlarexRuntimeValueV1>,
  changes: ReadonlyArray<LogicalPatchFieldV1>,
): void {
  for (const change of changes) {
    switch (change.kind) {
      case "remove":
        Reflect.deleteProperty(fields, change.field);
        break;
      case "set": {
        const value = normalizeFlarexValueJsonV1(change.valueJson).value;
        Object.defineProperty(fields, change.field, {
          value,
          enumerable: true,
          configurable: true,
          writable: true,
        });
        break;
      }
    }
  }
}

type CanonicalizePlannedDocumentResultV1 =
  | Readonly<{
      readonly kind: "valid";
      readonly document: CanonicalFlarexValueV1;
    }>
  | Readonly<{ readonly kind: "invalid" }>;

const tryCanonicalizeDocumentEffect = Effect.fn(
  "SessionJournalStore.tryCanonicalizeDocument",
)((input: {
  readonly tableId: CatalogTableId;
  readonly rowId: AppRowIdHexV1;
  readonly creationTime: AppCreationTimeV1;
  readonly fields: unknown;
}): Effect.Effect<CanonicalizePlannedDocumentResultV1> =>
  Effect.tryPromise({
    try: () => canonicalizeAppDocumentV1(input),
    catch: (cause): unknown => cause,
  }).pipe(
    Effect.map((document) =>
      Object.freeze({ kind: "valid", document } as const)
    ),
    Effect.catch((cause) =>
      cause instanceof FlarexValueCodecV1Error ||
        cause instanceof AppDocumentSystemFieldV1Error
        ? Effect.succeed(Object.freeze({ kind: "invalid" } as const))
        : Effect.die(cause)
    ),
  ));

function nextAppCreationTime(value: AppCreationTimeV1): AppCreationTimeV1 {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value, false);
  const high = view.getUint32(0, false);
  const low = view.getUint32(4, false);
  if (low === 0xffff_ffff) {
    view.setUint32(0, high + 1, false);
    view.setUint32(4, 0, false);
  } else {
    view.setUint32(4, low + 1, false);
  }
  return decodeAppCreationTimeV1(view.getFloat64(0, false));
}

function firstExceededLimit(
  current: SessionJournalCountersV1,
  deltas: SessionJournalCounterDeltasV1,
): SessionJournalIncrementalLimitIssueV1 | undefined {
  const candidates: ReadonlyArray<Readonly<{
    dimension: SessionJournalIncrementalLimitDimensionV1;
    observed: number;
    maximum: number;
  }>> = [
    {
      dimension: "operationCalls",
      observed: current.operationCalls + deltas.operationCalls,
      maximum: SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.operationCalls,
    },
    {
      dimension: "receiptEvidenceBytes",
      observed: current.receiptEvidenceBytes + deltas.receiptEvidenceBytes,
      maximum: SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.receiptEvidenceBytes,
    },
    {
      dimension: "readDocuments",
      observed: current.readDocuments + deltas.readDocuments,
      maximum: SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.readDocuments,
    },
    {
      dimension: "readSemanticBytes",
      observed: current.readSemanticBytes + deltas.readSemanticBytes,
      maximum:
        SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.readSemanticBytes,
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
      maximum: SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1
        .indexedQuerySyscalls,
    },
    {
      dimension: "indexRangeReadDependencies",
      observed: current.indexRangeDependencyCount +
        deltas.indexRangeDependencyCount,
      maximum: SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1
        .indexRangeReadDependencies,
    },
    {
      dimension: "indexRangeDependencyEvidenceBytes",
      observed: current.indexRangeDependencyEvidenceBytes +
        deltas.indexRangeDependencyEvidenceBytes,
      maximum: SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1
        .indexRangeDependencyEvidenceBytes,
    },
    {
      dimension: "relationReadSyscalls",
      observed: current.relationReadSyscalls + deltas.relationReadSyscalls,
      maximum:
        SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.relationReadSyscalls,
    },
    {
      dimension: "relationReadDependencies",
      observed: current.relationDependencyCount +
        deltas.relationDependencyCount,
      maximum: SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1
        .relationReadDependencies,
    },
    {
      dimension: "relationBaseOccurrences",
      observed: current.relationBaseOccurrences +
        deltas.relationBaseOccurrences,
      maximum: SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1
        .relationBaseOccurrences,
    },
    {
      dimension: "writeOperations",
      observed: current.writeOperations + deltas.writeOperations,
      maximum: SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.writeOperations,
    },
    {
      dimension: "writeSemanticBytes",
      observed: current.writeSemanticBytes + deltas.writeSemanticBytes,
      maximum:
        SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.writeSemanticBytes,
    },
    {
      dimension: "materialWriteEventEvidenceBytes",
      observed: current.materialWriteEventEvidenceBytes +
        deltas.materialWriteEventEvidenceBytes,
      maximum: SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1
        .materialWriteEventEvidenceBytes,
    },
  ];
  return candidates.find((candidate) => candidate.observed > candidate.maximum);
}

const persistIndexedQueryLimitOutcomeEffect = Effect.fn(
  "SessionJournalStore.persistIndexedQueryLimitOutcome",
)(function (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  request: Extract<SessionJournalStoredRequest, {
    readonly kind: "indexRange";
  }>,
  requestEvidence: CanonicalFlarexValueV1,
  counters: SessionJournalCountersV1,
  issue: SessionJournalIncrementalLimitIssueV1,
) {
  const outcome = Object.freeze({
    kind: "error",
    reason: "limitExceeded",
    ...issue,
  } satisfies SessionJournalStoredOutcome);
  return fromIndexedQueryPromise(() => persistAcceptedOperation(
    tx,
    context,
    request,
    requestEvidence,
    outcome,
    counters,
    ZERO_COUNTER_DELTAS,
    { state: "failed", failureDimension: issue.dimension },
  )).pipe(
    Effect.map(() => Object.freeze({
      kind: "outcome",
      delivery: "executed",
      outcome,
    } as const)),
  );
});

function decodeJournalCountersResult(
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
    indexRangeDependencyEvidenceBytes:
      root.indexRangeDependencyEvidenceBytes,
    relationReadSyscalls: root.relationReadSyscalls,
    relationDependencyCount: root.relationDependencyCount,
    relationBaseOccurrences: root.relationBaseOccurrences,
    writeOperations: root.writeOperations,
    writeSemanticBytes: root.writeSemanticBytes,
    materialWriteEventEvidenceBytes: root.materialWriteEventEvidenceBytes,
  };
  const limits: ReadonlyArray<readonly [number, number]> = [
    [counters.operationCalls, SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.operationCalls],
    [counters.receiptEvidenceBytes,
      root.state === "failed" && root.failureDimension !== null
        ? MAX_COMMIT_FAILED_RECEIPT_EVIDENCE_BYTES_V1
        : SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.receiptEvidenceBytes],
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
      SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1
        .indexRangeReadDependencies,
    ],
    [
      counters.indexRangeDependencyEvidenceBytes,
      SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1
        .indexRangeDependencyEvidenceBytes,
    ],
    [
      counters.relationReadSyscalls,
      SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1.relationReadSyscalls,
    ],
    [
      counters.relationDependencyCount,
      SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1
        .relationReadDependencies,
    ],
    [
      counters.relationBaseOccurrences,
      SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1
        .relationBaseOccurrences,
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
      SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1
        .materialWriteEventEvidenceBytes,
    ],
  ];
  if (limits.some(([value, maximum]) =>
    !isNonNegativeSafeInteger(value) || value > maximum)) {
    return Result.fail(corruption(attempt, "journalCountersInvalid"));
  }
  return Result.succeed(Object.freeze(counters));
}

async function loadLatestReceipt(
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
): Promise<
  typeof fxSystemTransactionJournalReceipts.$inferSelect | undefined
> {
  const rows = await tx
    .select()
    .from(fxSystemTransactionJournalReceipts)
    .where(and(
      eq(
        fxSystemTransactionJournalReceipts.scopeUuid,
        context.scopeUuid,
      ),
      eq(
        fxSystemTransactionJournalReceipts.sessionId,
        context.anchor.sessionId,
      ),
      eq(
        fxSystemTransactionJournalReceipts.attemptFence,
        context.anchor.attemptFence,
      ),
    ))
    .orderBy(desc(fxSystemTransactionJournalReceipts.lastSyscallSequence))
    .limit(1)
    .for("update");
  return rows[0];
}

async function loadReceiptAtSequence(
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  sequence: CommitSyscallSequenceV1,
): Promise<
  typeof fxSystemTransactionJournalReceipts.$inferSelect | undefined
> {
  const rows = await tx
    .select()
    .from(fxSystemTransactionJournalReceipts)
    .where(and(
      eq(fxSystemTransactionJournalReceipts.scopeUuid, context.scopeUuid),
      eq(fxSystemTransactionJournalReceipts.sessionId, context.anchor.sessionId),
      eq(fxSystemTransactionJournalReceipts.attemptFence, context.anchor.attemptFence),
      eq(fxSystemTransactionJournalReceipts.lastSyscallSequence, sequence),
    ))
    .limit(1)
    .for("update");
  return rows[0];
}

function validateReceiptCardinalityResult(
  attempt: SessionJournalAttemptStateV1,
  lastSequence: CommitFinalSyscallSequenceV1,
  receipt: typeof fxSystemTransactionJournalReceipts.$inferSelect |
    undefined,
): Result.Result<void, SessionJournalStorageCorruptionV1Error> {
  if (lastSequence === 0n && receipt !== undefined) {
    return Result.fail(corruption(attempt, "zeroSequenceHasReceipt"));
  }
  if (lastSequence > 0n) {
    if (
      receipt === undefined ||
      BigInt(receipt.lastSyscallSequence) !== BigInt(lastSequence)
    ) {
      return Result.fail(corruption(
        attempt,
        "latestReceiptSequenceMismatch",
      ));
    }
  }
  return Result.succeed(undefined);
}

const decodeStoredEvidenceEffect = Effect.fn((
  attempt: SessionJournalAttemptStateV1,
  reason: "latestReceiptEvidenceInvalid" | "logicalWriteEventInvalid",
  canonicalBytes: unknown,
  valueSha256: unknown,
): Effect.Effect<
  CanonicalFlarexValueV1,
  SessionJournalStorageCorruptionV1Error
> =>
  Effect.tryPromise({
    try: () => decodeCanonicalFlarexValueEvidenceV1({
      canonicalBytes,
      sha256: valueSha256,
    }),
    catch: (cause): unknown => cause,
  }).pipe(
    Effect.catch((cause) =>
      cause instanceof FlarexValueCodecV1Error ||
        cause instanceof FlarexValueEvidenceV1Error
        ? Effect.fail(corruption(attempt, reason, cause))
        : Effect.die(cause)
    ),
  ));

const decodeAndVerifyReceiptRecordEffect = Effect.fn(function* (
  attempt: SessionJournalAttemptStateV1,
  receipt: typeof fxSystemTransactionJournalReceipts.$inferSelect,
  expectedRequest: SessionJournalStoredRequest | undefined,
): Effect.fn.Return<
  Readonly<{ request: SessionJournalStoredRequest; outcome: SessionJournalStoredOutcome }>,
  SessionJournalStorageCorruptionV1Error
> {
  const requestEvidence = yield* decodeStoredEvidenceEffect(
    attempt,
    "latestReceiptEvidenceInvalid",
    receipt.requestBytes,
    receipt.requestSha256,
  );
  const request = yield* Effect.fromResult(
    decodeStoredRequestResult(requestEvidence.valueJson).pipe(
      Result.mapError((cause) => corruption(
        attempt,
        "latestReceiptEvidenceInvalid",
        cause,
      )),
    ),
  );
  if (
    request.kind !== receipt.operationKind ||
    BigInt(request.syscallSequence) !== BigInt(receipt.lastSyscallSequence) ||
    (expectedRequest !== undefined &&
      !storedRequestsEqual(request, expectedRequest))
  ) {
    return yield* Effect.fail(corruption(
      attempt,
      "latestReceiptEvidenceInvalid",
    ));
  }

  const outcomeEvidence = yield* decodeStoredEvidenceEffect(
    attempt,
    "latestReceiptEvidenceInvalid",
    receipt.outcomeBytes,
    receipt.outcomeSha256,
  );
  const outcome = yield* Effect.fromResult(
    decodeStoredOutcomeResult(outcomeEvidence.valueJson).pipe(
      Result.mapError((cause) => corruption(
        attempt,
        "latestReceiptEvidenceInvalid",
        cause,
      )),
    ),
  );
  if (
    outcome.kind !== receipt.outcomeKind ||
    !requestOutcomeCorrelates(
      request,
      outcome,
      attempt.snapshotToken.commitSeq,
    )
  ) {
    return yield* Effect.fail(corruption(
      attempt,
      "latestReceiptEvidenceInvalid",
    ));
  }
  if (request.kind === "admittedLogicalOperation") {
    const bundle = yield* Effect.fromResult(canonicalizeAdmittedSourceBundleResult({
      participant: request.participant, method: request.method,
      profileRevision: request.profileRevision, sources: request.sources,
    }).pipe(Result.mapError(cause => corruption(attempt, "latestReceiptEvidenceInvalid", cause))));
    const bundleDigest = yield* Effect.tryPromise({
      try: () => sha256(bundle.bytes),
      catch: cause => corruption(attempt, "latestReceiptEvidenceInvalid", cause),
    });
    if (receipt.participantBindingSha256 === null ||
      encodeBytesToLowercaseHex(receipt.participantBindingSha256) !==
        request.admissionBundleSha256Hex ||
      !bytesEqual(bundleDigest, receipt.participantBindingSha256)) {
      return yield* Effect.fail(corruption(attempt, "latestReceiptEvidenceInvalid"));
    }
  } else if (receipt.participantBindingSha256 !== null) {
    return yield* Effect.fail(corruption(attempt, "latestReceiptEvidenceInvalid"));
  }
  return Object.freeze({ request, outcome });
});

const decodeAndVerifyLatestReceiptEffect = Effect.fn(function* (
  attempt: SessionJournalAttemptStateV1,
  receipt: typeof fxSystemTransactionJournalReceipts.$inferSelect,
  expectedRequest: SessionJournalStoredRequest | undefined,
) {
  if (receipt.requestCodecVersion !== 2 || receipt.outcomeCodecVersion !== 2) {
    return yield* Effect.fail(corruption(attempt, "latestReceiptEvidenceInvalid"));
  }
  return (yield* decodeAndVerifyReceiptRecordEffect(
    attempt, receipt, expectedRequest,
  )).outcome;
});

function storedRequestsEqual(
  left: SessionJournalStoredRequest,
  right: SessionJournalStoredRequest,
): boolean {
  const leftEncoded = requireJson(encodeStoredRequest(left));
  const rightEncoded = requireJson(encodeStoredRequest(right));
  return jsonEqual(leftEncoded, rightEncoded);
}

function requestOutcomeCorrelates(
  request: SessionJournalStoredRequest,
  outcome: SessionJournalStoredOutcome,
  snapshotCommitSeq: CommitSeq,
): boolean {
  switch (request.kind) {
    case "get":
      if (
        outcome.kind === "missing" ||
        outcome.kind === "present" ||
        isLimitOutcome(outcome)
      ) return true;
      break;
    case "insert":
      if (
        outcome.kind === "inserted" ||
        (outcome.kind === "error" &&
          (outcome.reason === "documentIdCollision" ||
            outcome.reason === "invalidDocument" ||
            outcome.reason === "limitExceeded"))
      ) return true;
      break;
    case "patch":
    case "replace":
    case "delete":
      if (
        (outcome.kind === "unit" && outcome.operation === request.kind) ||
        (outcome.kind === "error" &&
          ((outcome.reason === "documentNotFound" &&
            outcome.operation === request.kind) ||
            (outcome.reason === "invalidDocument" &&
              outcome.operation === request.kind) ||
            outcome.reason === "limitExceeded"))
      ) return true;
      break;
    case "indexRange":
      return isLimitOutcome(outcome) ||
        (outcome.kind === "indexRangePage" &&
          outcome.documentsValueJson.length <= request.limit &&
          (outcome.isDone ||
            outcome.documentsValueJson.length === request.limit));
    case "relationIncoming":
      if (isLimitOutcome(outcome)) return true;
      if (outcome.kind === "relationConflict") {
        return outcome.edgeDefinitionId === request.edgeDefinitionId &&
          outcome.targetRowId === request.targetRowId &&
          outcome.snapshotCommitSeq === snapshotCommitSeq &&
          outcome.expectedAdjacencyVersion <= snapshotCommitSeq &&
          outcome.actualAdjacencyVersion > outcome.snapshotCommitSeq;
      }
      return outcome.kind === "relationIncomingPage" &&
        outcome.items.length <= request.limit &&
        (outcome.exhausted || outcome.items.length === request.limit) &&
        relationIncomingItemsCorrelate(request, outcome.items);
    case "admittedLogicalOperation":
      return outcome.kind === "admittedLogicalResult" ||
        outcome.kind === "admittedLogicalError" ||
        outcome.kind === "admittedLogicalInvoking";
  }
  return false;
}

function relationIncomingItemsCorrelate(
  request: Extract<
    SessionJournalStoredRequest,
    { readonly kind: "relationIncoming" }
  >,
  items: ReadonlyArray<
    Extract<
      SessionJournalStoredOutcome,
      { readonly kind: "relationIncomingPage" }
    >["items"][number]
  >,
): boolean {
  let previous: Readonly<{
    readonly sourceRowId: AppRowIdHexV1;
    readonly duplicateOrdinal: 0;
  }> | undefined;
  for (const item of items) {
    let identity: ReturnType<typeof decodeAppDocumentIdentityV1>;
    try {
      identity = decodeAppDocumentIdentityV1(item.sourceDocumentId);
    } catch {
      return false;
    }
    if (identity.tableId !== request.sourceTableId) return false;
    if (previous !== undefined) {
      const rowOrder = compareUtf16Strings(
        previous.sourceRowId,
        identity.rowId,
      );
      if (
        rowOrder > 0 ||
        (rowOrder === 0 &&
          previous.duplicateOrdinal >= item.duplicateOrdinal)
      ) {
        return false;
      }
    }
    previous = Object.freeze({
      sourceRowId: identity.rowId,
      duplicateOrdinal: item.duplicateOrdinal,
    });
  }
  return true;
}

function relationIncomingPositionsCorrelate(
  definition: PhysicalEdgeDefinitionV1,
  items: ReadonlyArray<
    Extract<
      SessionJournalStoredOutcome,
      { readonly kind: "relationIncomingPage" }
    >["items"][number]
  >,
): boolean {
  return items.every((item) =>
    definition.sourceValueExtraction === "scalar"
      ? item.position === null
      : item.position !== null &&
        item.position < MAX_RELATION_MANY_ITEMS_V1
  );
}

function isLimitOutcome(
  outcome: SessionJournalStoredOutcome,
): outcome is Extract<
  SessionJournalStoredOutcome,
  { readonly kind: "error"; readonly reason: "limitExceeded" }
> {
  return outcome.kind === "error" && outcome.reason === "limitExceeded";
}

function validateReceiptOutcomeMatchesJournalRootResult(
  attempt: SessionJournalAttemptStateV1,
  root: typeof fxSystemTransactionJournals.$inferSelect,
  outcome: SessionJournalStoredOutcome,
): Result.Result<void, SessionJournalStorageCorruptionV1Error> {
  if (root.state === "operation_invoking") {
    return outcome.kind === "admittedLogicalInvoking" && root.failureDimension === null
      ? Result.succeed(undefined)
      : Result.fail(corruption(attempt, "journalReceiptStateMismatch"));
  }
  if (root.state === "operation_failed") {
    return outcome.kind === "admittedLogicalError" && root.failureDimension === null
      ? Result.succeed(undefined)
      : Result.fail(corruption(attempt, "failedJournalReceiptInvalid"));
  }
  if (root.state === "failed") {
    if (root.failureDimension === null) {
      return Result.fail(corruption(
        attempt,
        "failedJournalEvidenceInvalid",
      ));
    }
    const expectedMaximum =
      SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1[root.failureDimension];
    if (
      !isLimitOutcome(outcome) ||
      outcome.dimension !== root.failureDimension ||
      outcome.maximum !== expectedMaximum ||
      outcome.observed <= outcome.maximum
    ) {
      return Result.fail(corruption(
        attempt,
        "failedJournalReceiptInvalid",
      ));
    }
    return Result.succeed(undefined);
  }
  if (root.state === "relation_conflicted") {
    if (
      outcome.kind !== "relationConflict" ||
      root.failureDimension !== null
    ) {
      return Result.fail(corruption(
        attempt,
        "journalReceiptStateMismatch",
      ));
    }
    return Result.succeed(undefined);
  }
  if (outcome.kind === "admittedLogicalInvoking" || outcome.kind === "relationConflict") {
    return Result.fail(corruption(
      attempt,
      "journalReceiptStateMismatch",
    ));
  }
  if (isLimitOutcome(outcome)) {
    return Result.fail(corruption(
      attempt,
      "journalReceiptStateMismatch",
    ));
  }
  return Result.succeed(undefined);
}

interface PersistAcceptedOperationRootStateV1 {
  readonly state: "open" | "failed" | "operation_failed" | "relation_conflicted";
  readonly failureDimension: SessionJournalIncrementalLimitDimensionV1 | null;
  readonly nextCreationTime?: AppCreationTimeV1;
  readonly participantWorkBytes?: number;
  readonly participantWorkCalls?: number;
}

async function persistAcceptedOperation(
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  request: SessionJournalStoredRequest,
  requestEvidence: CanonicalFlarexValueV1,
  outcome: SessionJournalStoredOutcome,
  current: SessionJournalCountersV1,
  deltas: SessionJournalCounterDeltasV1,
  state: PersistAcceptedOperationRootStateV1,
  participantBindingSha256: Uint8Array | null = null,
): Promise<void> {
  const outcomeEvidence = await canonicalizeStoredOutcome(outcome);
  const replacingInvocation = request.kind === "admittedLogicalOperation" &&
    context.journalRoot.state === "operation_invoking";
  const marker = replacingInvocation
    ? await loadReceiptAtSequence(tx, context, request.syscallSequence)
    : undefined;
  if (replacingInvocation && (marker === undefined ||
    marker.outcomeKind !== "admittedLogicalInvoking" ||
    marker.operationKind !== request.kind ||
    !bytesEqual(marker.requestSha256, requestEvidence.sha256) ||
    participantBindingSha256 === null ||
    marker.participantBindingSha256 === null ||
    !bytesEqual(marker.participantBindingSha256, participantBindingSha256))) {
    // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: transaction - this async SQL adapter rejects a mismatched durable marker so Effect.tryPromise rolls back the transaction
    throw corruption(attemptFromContext(context), "latestReceiptEvidenceInvalid");
  }
  const receiptEvidenceDelta = replacingInvocation
    ? outcomeEvidence.canonicalBytes.byteLength - marker!.outcomeBytes.byteLength
    : requestEvidence.canonicalBytes.byteLength + outcomeEvidence.canonicalBytes.byteLength;
  const boundedTerminalLimitFailure = state.state === "failed" &&
    state.failureDimension !== null && isLimitOutcome(outcome) &&
    outcome.dimension === state.failureDimension;
  const maximumReceiptEvidenceBytes = boundedTerminalLimitFailure
    ? MAX_COMMIT_FAILED_RECEIPT_EVIDENCE_BYTES_V1
    : MAX_COMMIT_RECEIPT_EVIDENCE_BYTES_V1;
  if (!Number.isSafeInteger(receiptEvidenceDelta) ||
    (boundedTerminalLimitFailure && outcomeEvidence.canonicalBytes.byteLength > 1_024) ||
    current.receiptEvidenceBytes + receiptEvidenceDelta > maximumReceiptEvidenceBytes) {
    // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: transaction - the receipt cap is enforced inside the owning SQL adapter and rejection rolls back staged point/event rows
    throw new SessionJournalPersistenceV1Error({
      operation: "runAdmittedOperation",
      cause: "receiptEvidenceBytes limit exceeded before durable acknowledgement",
    });
  }
  const receipt = {
    lastSyscallSequence: request.syscallSequence,
    operationKind: request.kind,
    participantBindingSha256,
    requestCodecVersion: 2,
    requestBytes: new Uint8Array(requestEvidence.canonicalBytes),
    requestSha256: new Uint8Array(requestEvidence.sha256),
    outcomeKind: outcome.kind,
    outcomeCodecVersion: 2,
    outcomeBytes: new Uint8Array(outcomeEvidence.canonicalBytes),
    outcomeSha256: new Uint8Array(outcomeEvidence.sha256),
    createdAt: context.databaseNow,
    updatedAt: context.databaseNow,
  } satisfies Omit<
    typeof fxSystemTransactionJournalReceipts.$inferInsert,
    "scopeUuid" | "sessionId" | "attemptFence"
  >;
  if (replacingInvocation) {
    const changedReceipt = await tx.update(fxSystemTransactionJournalReceipts).set({
      outcomeKind: receipt.outcomeKind,
      outcomeCodecVersion: receipt.outcomeCodecVersion,
      outcomeBytes: receipt.outcomeBytes,
      outcomeSha256: receipt.outcomeSha256,
      updatedAt: context.databaseNow,
    }).where(and(
      eq(fxSystemTransactionJournalReceipts.scopeUuid, context.scopeUuid),
      eq(fxSystemTransactionJournalReceipts.sessionId, context.anchor.sessionId),
      eq(fxSystemTransactionJournalReceipts.attemptFence, context.anchor.attemptFence),
      eq(fxSystemTransactionJournalReceipts.lastSyscallSequence, request.syscallSequence),
      eq(fxSystemTransactionJournalReceipts.outcomeKind, "admittedLogicalInvoking"),
    )).returning({ outcomeKind: fxSystemTransactionJournalReceipts.outcomeKind });
    if (changedReceipt.length !== 1) {
      // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: transaction - a failed exact marker update rejects the SQL transaction before its root advances
      throw corruption(attemptFromContext(context), "latestReceiptEvidenceInvalid");
    }
  } else {
    await tx.insert(fxSystemTransactionJournalReceipts).values({
      scopeUuid: context.scopeUuid,
      sessionId: context.anchor.sessionId,
      attemptFence: context.anchor.attemptFence,
      ...receipt,
    });
  }
  const updated = await tx
    .update(fxSystemTransactionJournals)
    .set({
      state: state.state,
      lastSyscallSequence: CommitFinalSyscallSequenceV1Schema.make(
        request.syscallSequence,
      ),
      readDocuments: current.readDocuments + deltas.readDocuments,
      readSemanticBytes:
        current.readSemanticBytes + deltas.readSemanticBytes,
      pointDependencyCount:
        current.pointDependencyCount + deltas.pointDependencyCount,
      indexedQuerySyscalls:
        current.indexedQuerySyscalls + deltas.indexedQuerySyscalls,
      indexRangeDependencyCount:
        current.indexRangeDependencyCount + deltas.indexRangeDependencyCount,
      indexRangeDependencyEvidenceBytes:
        current.indexRangeDependencyEvidenceBytes +
        deltas.indexRangeDependencyEvidenceBytes,
      relationReadSyscalls:
        current.relationReadSyscalls + deltas.relationReadSyscalls,
      relationDependencyCount:
        current.relationDependencyCount + deltas.relationDependencyCount,
      relationBaseOccurrences:
        current.relationBaseOccurrences + deltas.relationBaseOccurrences,
      writeOperations: current.writeOperations + deltas.writeOperations,
      writeSemanticBytes:
        current.writeSemanticBytes + deltas.writeSemanticBytes,
      materialWriteEventEvidenceBytes:
        CommitMaterialWriteEventEvidenceBytesV1Schema.make(
          current.materialWriteEventEvidenceBytes +
          deltas.materialWriteEventEvidenceBytes,
        ),
      receiptEvidenceBytes: current.receiptEvidenceBytes + receiptEvidenceDelta,
      participantWorkBytes: context.journalRoot.participantWorkBytes +
        (state.participantWorkBytes ?? 0),
      participantWorkCalls: context.journalRoot.participantWorkCalls +
        (state.participantWorkCalls ?? 0),
      failureDimension: state.failureDimension,
      ...(state.nextCreationTime === undefined
        ? {}
        : { nextCreationTime: state.nextCreationTime }),
      updatedAt: context.databaseNow,
    })
    .where(and(
      eq(fxSystemTransactionJournals.scopeUuid, context.scopeUuid),
      eq(fxSystemTransactionJournals.sessionId, context.anchor.sessionId),
      eq(
        fxSystemTransactionJournals.attemptFence,
        context.anchor.attemptFence,
      ),
      eq(fxSystemTransactionJournals.state,
        replacingInvocation ? "operation_invoking" : "open"),
      eq(
        fxSystemTransactionJournals.lastSyscallSequence,
        context.journalRoot.lastSyscallSequence,
      ),
    ))
    .returning({
      lastSyscallSequence: fxSystemTransactionJournals.lastSyscallSequence,
    });
  if (
    updated.length !== 1 ||
    BigInt(updated[0]?.lastSyscallSequence ?? -1n) !==
      BigInt(request.syscallSequence)
  ) {
    throw corruption(
      attemptFromContext(context),
      "journalRootOperationUpdateMismatch",
    );
  }
}

async function persistPointMutation(
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  mutation: JournalPointMutationV1,
): Promise<void> {
  const dependencyColumns = dependencyColumnsForPoint(mutation.dependency);
  const overlayColumns = overlayColumnsForPoint(mutation.overlay);
  if (mutation.mode === "insert") {
    await tx.insert(fxSystemTransactionJournalPoints).values({
      scopeUuid: context.scopeUuid,
      sessionId: context.anchor.sessionId,
      attemptFence: context.anchor.attemptFence,
      tableId: mutation.tableId,
      rowId: appRowIdHexV1ToBytes(mutation.rowId),
      ...dependencyColumns,
      ...overlayColumns,
      createdAt: context.databaseNow,
      updatedAt: context.databaseNow,
    });
    return;
  }
  const updated = await tx
    .update(fxSystemTransactionJournalPoints)
    .set({
      ...overlayColumns,
      updatedAt: context.databaseNow,
    })
    .where(and(
      eq(fxSystemTransactionJournalPoints.scopeUuid, context.scopeUuid),
      eq(fxSystemTransactionJournalPoints.sessionId, context.anchor.sessionId),
      eq(
        fxSystemTransactionJournalPoints.attemptFence,
        context.anchor.attemptFence,
      ),
      eq(fxSystemTransactionJournalPoints.tableId, mutation.tableId),
      eq(
        fxSystemTransactionJournalPoints.rowId,
        appRowIdHexV1ToBytes(mutation.rowId),
      ),
    ))
    .returning({ tableId: fxSystemTransactionJournalPoints.tableId });
  if (updated.length !== 1 || updated[0]?.tableId !== mutation.tableId) {
    throw new Error("Journal point overlay update did not affect one row.");
  }
}

function dependencyColumnsForPoint(
  dependency: AppRowPointDependencyV1,
): Readonly<{
  dependencyKind:
    | "present"
    | "missing_no_visible_revision"
    | "missing_tombstone";
  dependencyRevisionCommitSeq: CommitSeq | null;
}> {
  switch (dependency.kind) {
    case "present":
      return Object.freeze({
        dependencyKind: "present",
        dependencyRevisionCommitSeq: dependency.revisionCommitSeq,
      });
    case "missing":
      return dependency.basis.kind === "noVisibleRevision"
        ? Object.freeze({
            dependencyKind: "missing_no_visible_revision",
            dependencyRevisionCommitSeq: null,
          })
        : Object.freeze({
            dependencyKind: "missing_tombstone",
            dependencyRevisionCommitSeq: dependency.basis.revisionCommitSeq,
          });
  }
}

function overlayColumnsForPoint(
  overlay: JournalPointOverlayV1,
): Readonly<{
  overlayKind: "none" | "live" | "deleted";
  overlayCreationTime: AppCreationTimeV1 | null;
  overlayValueCodecVersion: typeof FLAREX_VALUE_CODEC_VERSION_V1 | null;
  overlayValueJson: JsonObject | null;
  overlayValueBytes: CanonicalFlarexValueBytesV1 | null;
  overlayValueSha256: FlarexValueSha256V1 | null;
  overlaySemanticBytes: number | null;
}> {
  if (overlay.kind !== "live") {
    return Object.freeze({
      overlayKind: overlay.kind,
      overlayCreationTime: null,
      overlayValueCodecVersion: null,
      overlayValueJson: null,
      overlayValueBytes: null,
      overlayValueSha256: null,
      overlaySemanticBytes: null,
    });
  }
  if (!isJsonObject(overlay.document.valueJson)) {
    throw new Error("Canonical app document JSON is not an object.");
  }
  return Object.freeze({
    overlayKind: "live",
    overlayCreationTime: overlay.creationTime,
    overlayValueCodecVersion: overlay.document.codecVersion,
    overlayValueJson: cloneJsonObject(overlay.document.valueJson),
    overlayValueBytes: copyCanonicalFlarexValueBytesV1(
      overlay.document.canonicalBytes,
    ),
    overlayValueSha256: copyFlarexValueSha256V1(overlay.document.sha256),
    overlaySemanticBytes: overlay.document.semanticSizeBytes,
  });
}

async function persistLogicalWrite(
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  event: PreparedLogicalWriteEventV1,
): Promise<void> {
  await tx.insert(fxSystemTransactionJournalWriteEvents).values({
    scopeUuid: context.scopeUuid,
    sessionId: context.anchor.sessionId,
    attemptFence: context.anchor.attemptFence,
    syscallSequence: event.write.syscallSequence,
    writeKind: event.write.kind,
    eventCodecVersion: 2,
    eventBytes: new Uint8Array(event.canonicalBytes),
    eventSha256: new Uint8Array(event.sha256),
    createdAt: context.databaseNow,
  });
}

function projectPointOperationResult(
  applied: AppliedSessionJournalOperationV1,
): RunSessionJournalPointOperationV1Result {
  switch (applied.kind) {
    case "sequenceRejected":
      return Object.freeze({
        kind: "sequenceRejected",
        issue: applied.issue,
      });
    case "stateRejected":
      return Object.freeze({
        kind: "stateRejected",
        issue: Object.freeze({ reason: applied.reason }),
      });
    case "outcome": {
      const outcome = applied.outcome;
      if (outcome.kind === "error") {
        return Object.freeze({
          kind: "rejected",
          delivery: applied.delivery,
          issue: issueFromStoredOutcome(outcome),
        });
      }
      const projected = projectSuccessfulStoredOutcome(outcome);
      return Object.freeze({
        kind: "completed",
        delivery: applied.delivery === "sticky"
          ? "replayed"
          : applied.delivery,
        outcome: projected,
      });
    }
  }
}

function projectIndexedQueryResult(
  applied: AppliedSessionJournalOperationV1,
): RunSessionJournalIndexedQueryV1Result {
  switch (applied.kind) {
    case "sequenceRejected":
      return Object.freeze({ kind: "sequenceRejected", issue: applied.issue });
    case "stateRejected":
      return Object.freeze({
        kind: "stateRejected",
        issue: Object.freeze({ reason: applied.reason }),
      });
    case "outcome": {
      if (applied.outcome.kind === "error") {
        if (applied.outcome.reason !== "limitExceeded") {
          throw new Error("Indexed query receipt contains a point-only error.");
        }
        return Object.freeze({
          kind: "rejected",
          delivery: applied.delivery,
          issue: Object.freeze({
            reason: "limitExceeded",
            dimension: applied.outcome.dimension,
            observed: applied.outcome.observed,
            maximum: applied.outcome.maximum,
          }),
        });
      }
      if (applied.outcome.kind !== "indexRangePage") {
        throw new Error("Indexed query receipt contains a point-only success.");
      }
      return Object.freeze({
        kind: "completed",
        delivery: applied.delivery === "sticky"
          ? "replayed"
          : applied.delivery,
        outcome: Object.freeze({
          kind: "indexRangePage",
          documents: Object.freeze(applied.outcome.documentsValueJson.map(
            (document) => normalizeFlarexValueJsonV1(
              document,
              "appDocument",
            ).value,
          )),
          isDone: applied.outcome.isDone,
        }),
      });
    }
  }
}

function projectApplicationRelationIncomingResult(
  applied: AppliedSessionJournalOperationV1,
  request: StoredApplicationRelationIncomingRequest,
): RunSessionJournalRelationIncomingV1Result {
  switch (applied.kind) {
    case "sequenceRejected":
      return Object.freeze({ kind: "sequenceRejected", issue: applied.issue });
    case "stateRejected":
      return Object.freeze({
        kind: "stateRejected",
        issue: Object.freeze({ reason: applied.reason }),
      });
    case "outcome": {
      const outcome = applied.outcome;
      if (outcome.kind === "error") {
        if (outcome.reason !== "limitExceeded") {
          // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: invariant - relation request and receipt correlation rejects every non-limit point error before projection
          throw new Error("Relation receipt contains a point-only error.");
        }
        return Object.freeze({
          kind: "rejected",
          delivery: applied.delivery,
          issue: Object.freeze({
            reason: "limitExceeded",
            dimension: outcome.dimension,
            observed: outcome.observed,
            maximum: outcome.maximum,
          }),
        });
      }
      if (outcome.kind === "relationConflict") {
        return Object.freeze({
          kind: "conflicted",
          delivery: applied.delivery === "sticky"
            ? "replayed"
            : applied.delivery,
          request: Object.freeze({ ...request }),
          conflict: Object.freeze({ ...outcome }),
        });
      }
      if (outcome.kind !== "relationIncomingPage") {
        // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: invariant - relation request and receipt correlation permits only relation page or relation conflict successes
        throw new Error("Relation receipt contains an unrelated success.");
      }
      return Object.freeze({
        kind: "completed",
        delivery: applied.delivery === "sticky"
          ? "replayed"
          : applied.delivery,
        outcome: Object.freeze({
          kind: "relationIncomingPage",
          items: Object.freeze(outcome.items.map((item) =>
            Object.freeze({ ...item })
          )),
          exhausted: outcome.exhausted,
        }),
      });
    }
  }
}

function issueFromStoredOutcome(
  outcome: Extract<SessionJournalStoredOutcome, { readonly kind: "error" }>,
): SessionJournalPersistedPointIssueV1 {
  switch (outcome.reason) {
    case "documentNotFound":
      return Object.freeze({
        reason: outcome.reason,
        operation: outcome.operation,
        documentId: outcome.documentId,
      });
    case "documentIdCollision":
      return Object.freeze({
        reason: outcome.reason,
        documentId: outcome.documentId,
      });
    case "invalidDocument":
      return Object.freeze({
        reason: outcome.reason,
        operation: outcome.operation,
      });
    case "limitExceeded":
      return Object.freeze({
        reason: outcome.reason,
        dimension: outcome.dimension,
        observed: outcome.observed,
        maximum: outcome.maximum,
      });
  }
}

function projectSuccessfulStoredOutcome(
  outcome: Exclude<SessionJournalStoredOutcome, { readonly kind: "error" }>,
): SessionJournalPointSuccessV1 {
  switch (outcome.kind) {
    case "missing":
      return Object.freeze({ kind: "missing", document: null });
    case "present": {
      const document = normalizeFlarexValueJsonV1(
        outcome.documentValueJson,
        "appDocument",
      ).value;
      return Object.freeze({ kind: "present", document });
    }
    case "inserted": {
      const document = normalizeFlarexValueJsonV1(
        outcome.documentValueJson,
        "appDocument",
      ).value;
      return Object.freeze({
        kind: "inserted",
        documentId: outcome.documentId,
        document,
      });
    }
    case "unit":
      return Object.freeze({
        kind: "unit",
        operation: outcome.operation,
      });
    case "indexRangePage":
      throw new Error("Point operation received an indexed-query outcome.");
    case "relationIncomingPage":
    case "relationConflict":
      // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: invariant - point request and receipt correlation rejects relation outcomes before point projection
      throw new Error("Point operation received a relation-read outcome.");
    case "admittedLogicalResult":
    case "admittedLogicalError":
    case "admittedLogicalInvoking":
      // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: invariant - point request and receipt correlation excludes participant outcomes before this projection
      throw new Error("Point operation received an admitted logical outcome.");
  }
}

function kernelContextMatchesAttempt(
  context: ExactRunningAttemptKernelContextV1,
  attempt: SessionJournalAttemptStateV1,
): boolean {
  const anchor = context.anchor;
  return anchor.deploymentId === attempt.selector.deploymentId &&
    anchor.scopeId === attempt.selector.scopeId &&
    anchor.sessionId === attempt.selector.sessionId &&
    anchor.attemptFence === attempt.selector.attemptFence &&
    context.executionPin.schemaVersionId === attempt.schemaVersionId &&
    anchor.snapshotToken.scopeId === attempt.snapshotToken.scopeId &&
    anchor.snapshotToken.epoch === attempt.snapshotToken.epoch &&
    anchor.snapshotToken.commitSeq === attempt.snapshotToken.commitSeq;
}

function attemptFromContext(
  context: ExactRunningAttemptKernelContextV1,
): SessionJournalAttemptStateV1 {
  return Object.freeze({
    selector: Object.freeze({
      deploymentId: context.anchor.deploymentId,
      scopeId: context.anchor.scopeId,
      sessionId: context.anchor.sessionId,
      attemptFence: context.anchor.attemptFence,
    }),
    snapshotToken: context.anchor.snapshotToken,
    schemaVersionId: context.executionPin.schemaVersionId,
    executionClaim: Object.freeze({ ...context.executionClaim }),
    executionProfile: context.journalRoot.executionProfile,
  });
}

function corruption(
  attempt: SessionJournalAttemptStateV1,
  reason: SessionJournalStorageCorruptionReasonV1,
  cause?: unknown,
): SessionJournalStorageCorruptionV1Error {
  return new SessionJournalStorageCorruptionV1Error({
    scopeId: attempt.selector.scopeId,
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}

interface SessionJournalSealCandidateV1 {
  readonly lastSyscallSequence: CommitFinalSyscallSequenceV1;
  readonly nextCreationTime: AppCreationTimeV1;
  readonly counters: SessionJournalCountersV1;
  readonly rootUpdatedAtMilliseconds: number;
  readonly journal: SessionJournal;
}

interface ValidatedCanonicalSealEvidenceV1 {
  readonly finalSyscallSequence: CommitFinalSyscallSequenceV1;
  readonly journalBytes: Uint8Array;
  readonly journalSha256: Uint8Array;
  readonly journalSha256Hex: CanonicalSessionJournal["sha256Hex"];
  readonly resultValueCodecVersion: typeof FLAREX_VALUE_CODEC_VERSION_V1;
  readonly resultSemanticBytes: number;
  readonly resultBytes: Uint8Array;
  readonly resultSha256: Uint8Array;
  readonly successfulResult: CanonicalSuccessfulResultV1["evidence"];
}

interface SessionJournalSealRowsV1 {
  readonly root: typeof fxSystemTransactionJournals.$inferSelect;
  readonly receipts: ReadonlyArray<typeof fxSystemTransactionJournalReceipts.$inferSelect>;
  readonly points: ReadonlyArray<
    typeof fxSystemTransactionJournalPoints.$inferSelect
  >;
  readonly indexRanges: ReadonlyArray<
    typeof fxSystemTransactionJournalIndexRanges.$inferSelect
  >;
  readonly relationDependencies: ReadonlyArray<
    typeof fxSystemTransactionJournalRelationIncomingDependencies.$inferSelect
  >;
  readonly events: ReadonlyArray<
    typeof fxSystemTransactionJournalWriteEvents.$inferSelect
  >;
}

/** Stage one finite root's provisional evidence inside its final seal tx.
 * No child receipt is visible before this transaction commits sealed. */
async function stageFiniteRootRows(
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  attempt: SessionJournalAttemptStateV1,
  finite: FiniteRootAttemptState,
  purpose: "seal" | "relationConflict",
): Promise<typeof fxSystemTransactionJournals.$inferSelect> {
  if (!kernelContextMatchesAttempt(context, attempt) ||
    context.journalRoot.executionProfile !== "finiteRoot" ||
    context.journalRoot.state !== "open" ||
    context.journalRoot.lastSyscallSequence !== 0n ||
    finite.status !== (purpose === "seal" ? "sealing" : "open") ||
    finite.entries.size !== Number(finite.lastSequence)) {
    // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: transaction - this SQL adapter rejects a mismatched finite root and its owning Effect.tryPromise rolls back the seal transaction
    throw corruption(attempt, "journalStateInvalid");
  }
  const ordered = [...finite.entries.entries()].toSorted(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0);
  const receipts: Array<typeof fxSystemTransactionJournalReceipts.$inferInsert> = [];
  const events: Array<typeof fxSystemTransactionJournalWriteEvents.$inferInsert> = [];
  for (const [ordinal, [sequence, entry]] of ordered.entries()) {
    if (sequence !== BigInt(ordinal + 1) ||
      entry.request.syscallSequence !== sequence) {
      // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: transaction - a sequence gap rejects the aggregate SQL stage before any seal can commit
      throw corruption(attempt, "latestReceiptSequenceMismatch");
    }
    receipts.push({
      scopeUuid: context.scopeUuid,
      sessionId: context.anchor.sessionId,
      attemptFence: context.anchor.attemptFence,
      lastSyscallSequence: CommitSyscallSequenceV1Schema.make(sequence),
      operationKind: entry.request.kind,
      participantBindingSha256: entry.kind === "admitted"
        ? new Uint8Array(entry.bindingDigest) : null,
      requestCodecVersion: 2,
      requestBytes: new Uint8Array(entry.requestEvidence.canonicalBytes),
      requestSha256: new Uint8Array(entry.requestEvidence.sha256),
      outcomeKind: entry.outcome.kind,
      outcomeCodecVersion: 2,
      outcomeBytes: new Uint8Array(entry.outcomeEvidence.canonicalBytes),
      outcomeSha256: new Uint8Array(entry.outcomeEvidence.sha256),
      createdAt: context.databaseNow,
      updatedAt: context.databaseNow,
    });
    if (entry.kind === "admitted") {
      for (const event of entry.events) {
        events.push({
          scopeUuid: context.scopeUuid,
          sessionId: context.anchor.sessionId,
          attemptFence: context.anchor.attemptFence,
          syscallSequence: CommitSyscallSequenceV1Schema.make(sequence),
          effectOrdinal: event.effectOrdinal,
          writeKind: "logicalDocument",
          eventCodecVersion: 2,
          eventBytes: new Uint8Array(event.bytes),
          eventSha256: new Uint8Array(event.sha256),
          createdAt: context.databaseNow,
        });
      }
    } else if (entry.kind === "point" && entry.writeEvent !== undefined) {
      const event = entry.writeEvent;
      events.push({
        scopeUuid: context.scopeUuid,
        sessionId: context.anchor.sessionId,
        attemptFence: context.anchor.attemptFence,
        syscallSequence: CommitSyscallSequenceV1Schema.make(sequence),
        effectOrdinal: 0,
        writeKind: event.write.kind,
        eventCodecVersion: 2,
        eventBytes: new Uint8Array(event.canonicalBytes),
        eventSha256: new Uint8Array(event.sha256),
        createdAt: context.databaseNow,
      });
    }
  }
  for (let offset = 0; offset < receipts.length; offset += 128) {
    await tx.insert(fxSystemTransactionJournalReceipts).values(
      receipts.slice(offset, offset + 128));
  }
  const points = [...finite.points.values()].map(mutation => ({
    scopeUuid: context.scopeUuid,
    sessionId: context.anchor.sessionId,
    attemptFence: context.anchor.attemptFence,
    tableId: mutation.tableId,
    rowId: appRowIdHexV1ToBytes(mutation.rowId),
    ...dependencyColumnsForPoint(mutation.dependency),
    ...overlayColumnsForPoint(mutation.overlay),
    createdAt: context.databaseNow,
    updatedAt: context.databaseNow,
  }));
  for (let offset = 0; offset < points.length; offset += 128) {
    await tx.insert(fxSystemTransactionJournalPoints).values(
      points.slice(offset, offset + 128));
  }
  await replaceStoredIndexRanges(tx, context,
    prepareStoredIndexRanges(finite.indexRanges));
  const relationRows = finite.relationDependencies.map(dependency => ({
    scopeUuid: context.scopeUuid,
    sessionId: context.anchor.sessionId,
    attemptFence: context.anchor.attemptFence,
    edgeDefinitionId: dependency.edgeDefinitionId,
    targetRowId: appRowIdHexV1ToBytes(dependency.targetRowId),
    observedAdjacencyVersion: dependency.observedAdjacencyVersion,
    activationSequence: dependency.activationSequence,
    activeHeadSha256: Uint8Array.from({ length: 32 }, (_, index) =>
      Number.parseInt(dependency.activeHeadSha256Hex.slice(index * 2,
        index * 2 + 2), 16)),
    createdAt: context.databaseNow,
    updatedAt: context.databaseNow,
  }));
  for (let offset = 0; offset < relationRows.length; offset += 128) {
    await tx.insert(fxSystemTransactionJournalRelationIncomingDependencies)
      .values(relationRows.slice(offset, offset + 128));
  }
  for (let offset = 0; offset < events.length; offset += 128) {
    await tx.insert(fxSystemTransactionJournalWriteEvents).values(
      events.slice(offset, offset + 128));
  }
  const counters = finite.counters;
  const changed = await tx.update(fxSystemTransactionJournals).set({
    lastSyscallSequence: CommitFinalSyscallSequenceV1Schema.make(finite.lastSequence),
    readDocuments: counters.readDocuments,
    readSemanticBytes: counters.readSemanticBytes,
    pointDependencyCount: counters.pointDependencyCount,
    indexedQuerySyscalls: counters.indexedQuerySyscalls,
    indexRangeDependencyCount: counters.indexRangeDependencyCount,
    indexRangeDependencyEvidenceBytes: counters.indexRangeDependencyEvidenceBytes,
    relationReadSyscalls: counters.relationReadSyscalls,
    relationDependencyCount: counters.relationDependencyCount,
    relationBaseOccurrences: counters.relationBaseOccurrences,
    writeOperations: counters.writeOperations,
    writeSemanticBytes: counters.writeSemanticBytes,
    materialWriteEventEvidenceBytes:
      CommitMaterialWriteEventEvidenceBytesV1Schema.make(
        counters.materialWriteEventEvidenceBytes),
    receiptEvidenceBytes: counters.receiptEvidenceBytes,
    participantWorkBytes: finite.participantWorkBytes,
    participantWorkCalls: finite.participantWorkCalls,
    ...(finite.nextCreationTime === undefined ? {} : {
      nextCreationTime: finite.nextCreationTime,
    }),
    updatedAt: context.databaseNow,
  }).where(and(
    eq(fxSystemTransactionJournals.scopeUuid, context.scopeUuid),
    eq(fxSystemTransactionJournals.sessionId, context.anchor.sessionId),
    eq(fxSystemTransactionJournals.attemptFence, context.anchor.attemptFence),
    eq(fxSystemTransactionJournals.state, "open"),
    eq(fxSystemTransactionJournals.lastSyscallSequence,
      CommitFinalSyscallSequenceV1Schema.make(0n)),
    eq(fxSystemTransactionJournals.executionProfile, "finiteRoot"),
  )).returning();
  if (changed.length !== 1 ||
    changed[0]?.lastSyscallSequence !== finite.lastSequence) {
    // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: transaction - a failed root compare-and-set rolls back all aggregate rows in this SQL adapter
    throw corruption(attempt, "journalRootOperationUpdateMismatch");
  }
  return changed[0];
}

function detachSealCandidate(
  candidate: SessionJournalSealCandidateV1,
): SessionJournalSealCandidateV1 {
  return Object.freeze({
    ...candidate,
    counters: Object.freeze({ ...candidate.counters }),
    journal: structuredClone(candidate.journal),
  });
}

/** Caller owns a coherent transaction: legacy preparation uses repeatable
 * read; finite seal holds the exact journal row lock through materialization. */
async function captureSealRowsInTransaction(
  tx: AppRowTransaction,
  attempt: SessionJournalAttemptStateV1,
  preliminaryAuthority: TrustedScopeAuthority,
): Promise<SessionJournalSealRowsV1> {
  const authority = await requireRepeatableReadAttemptAuthority(
    tx,
    attempt,
    preliminaryAuthority,
  );
  const receipts = await loadReceiptsReadOnly(tx, authority);
  const points = await tx
    .select()
    .from(fxSystemTransactionJournalPoints)
    .where(and(
      eq(fxSystemTransactionJournalPoints.scopeUuid, authority.scopeUuid),
      eq(
        fxSystemTransactionJournalPoints.sessionId,
        attempt.selector.sessionId,
      ),
      eq(
        fxSystemTransactionJournalPoints.attemptFence,
        attempt.selector.attemptFence,
      ),
    ))
    .orderBy(
      asc(fxSystemTransactionJournalPoints.tableId),
      asc(fxSystemTransactionJournalPoints.rowId),
    )
    .limit(MAX_COMMIT_POINT_READ_DEPENDENCIES_V1 + 1);
  const indexRanges = await tx
    .select()
    .from(fxSystemTransactionJournalIndexRanges)
    .where(and(
      eq(fxSystemTransactionJournalIndexRanges.scopeUuid, authority.scopeUuid),
      eq(
        fxSystemTransactionJournalIndexRanges.sessionId,
        attempt.selector.sessionId,
      ),
      eq(
        fxSystemTransactionJournalIndexRanges.attemptFence,
        attempt.selector.attemptFence,
      ),
    ))
    .orderBy(asc(fxSystemTransactionJournalIndexRanges.ordinal))
    .limit(MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1 + 1);
  const relationDependencies = await tx
    .select()
    .from(fxSystemTransactionJournalRelationIncomingDependencies)
    .where(and(
      eq(
        fxSystemTransactionJournalRelationIncomingDependencies.scopeUuid,
        authority.scopeUuid,
      ),
      eq(
        fxSystemTransactionJournalRelationIncomingDependencies.sessionId,
        attempt.selector.sessionId,
      ),
      eq(
        fxSystemTransactionJournalRelationIncomingDependencies.attemptFence,
        attempt.selector.attemptFence,
      ),
    ))
    .orderBy(
      asc(
        fxSystemTransactionJournalRelationIncomingDependencies
          .edgeDefinitionId,
      ),
      asc(
        fxSystemTransactionJournalRelationIncomingDependencies.targetRowId,
      ),
    )
    .limit(MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1 + 1);
  const events = await tx
    .select()
    .from(fxSystemTransactionJournalWriteEvents)
    .where(and(
      eq(
        fxSystemTransactionJournalWriteEvents.scopeUuid,
        authority.scopeUuid,
      ),
      eq(
        fxSystemTransactionJournalWriteEvents.sessionId,
        attempt.selector.sessionId,
      ),
      eq(
        fxSystemTransactionJournalWriteEvents.attemptFence,
        attempt.selector.attemptFence,
      ),
    ))
    .orderBy(asc(fxSystemTransactionJournalWriteEvents.syscallSequence),
      asc(fxSystemTransactionJournalWriteEvents.effectOrdinal))
    .limit(MAX_COMMIT_WRITE_OPERATIONS_V1 + 1);
  return Object.freeze({
    root: structuredClone(authority.root),
    receipts: Object.freeze(structuredClone(receipts)),
    points: Object.freeze(structuredClone(points)),
    indexRanges: Object.freeze(structuredClone(indexRanges)),
    relationDependencies: Object.freeze(
      structuredClone(relationDependencies),
    ),
    events: Object.freeze(structuredClone(events)),
  });
}

const materializeSealCandidateEffect = Effect.fn(
  "SessionJournalStore.materializeSealCandidate",
)(function* (
  attempt: SessionJournalAttemptStateV1,
  snapshot: SessionJournalSealRowsV1,
): Effect.fn.Return<
  SessionJournalSealCandidateV1,
  SessionJournalSealV1Error | SessionJournalStorageCorruptionV1Error
> {
  const root = snapshot.root;
  if (root.journalFormat !== SESSION_JOURNAL_FORMAT) {
    return yield* Effect.fail(corruption(attempt, "journalStateInvalid"));
  }
  if (root.state === "failed" || root.state === "operation_failed") {
    return yield* Effect.fail(
      new SessionJournalSealV1Error({ reason: "journalFailed" }),
    );
  }
  if (root.state === "relation_conflicted") {
    return yield* Effect.fail(
      new SessionJournalSealV1Error({
        reason: "journalRelationConflicted",
      }),
    );
  }
  if (root.state !== "open" && root.state !== "sealed") {
    return yield* Effect.fail(corruption(attempt, "journalStateInvalid"));
  }
  if (snapshot.points.length > MAX_COMMIT_POINT_READ_DEPENDENCIES_V1) {
    return yield* Effect.fail(corruption(
      attempt,
      "pointDependencyCountMismatch",
    ));
  }
  if (snapshot.events.length > MAX_COMMIT_WRITE_OPERATIONS_V1) {
    return yield* Effect.fail(corruption(
      attempt,
      "writeOperationCountMismatch",
    ));
  }
  if (
    snapshot.indexRanges.length > MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1
  ) {
    return yield* Effect.fail(corruption(
      attempt,
      "indexRangeDependencyCountMismatch",
    ));
  }
  if (
    snapshot.relationDependencies.length >
      MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1
  ) {
    return yield* Effect.fail(corruption(
      attempt,
      "relationDependencyCountMismatch",
    ));
  }
  const counters = yield* Effect.fromResult(
    decodeJournalCountersResult(attempt, root),
  );
  const lastSyscallSequence = CommitFinalSyscallSequenceV1Schema.make(
    root.lastSyscallSequence,
  );
  if (snapshot.receipts.length !== Number(lastSyscallSequence) ||
    snapshot.receipts.length > MAX_COMMIT_OPERATION_CALLS_V1) {
    return yield* Effect.fail(corruption(attempt, "latestReceiptSequenceMismatch"));
  }
  const receiptRecords: Array<Readonly<{
    request: SessionJournalStoredRequest;
    outcome: SessionJournalStoredOutcome;
  }>> = [];
  let receiptEvidenceBytes = 0;
  let participantWorkBytes = 0;
  let participantWorkCalls = 0;
  for (const [ordinal, receipt] of snapshot.receipts.entries()) {
    if (receipt.lastSyscallSequence !== BigInt(ordinal + 1)) {
      return yield* Effect.fail(corruption(attempt, "latestReceiptSequenceMismatch"));
    }
    const decoded = yield* decodeAndVerifyReceiptRecordEffect(
      attempt, receipt, undefined,
    );
    receiptRecords.push(decoded);
    receiptEvidenceBytes += receipt.requestBytes.byteLength + receipt.outcomeBytes.byteLength;
    if (decoded.outcome.kind === "admittedLogicalResult" ||
      decoded.outcome.kind === "admittedLogicalError") {
      participantWorkBytes += decoded.outcome.workBytes;
      participantWorkCalls += decoded.outcome.workCalls;
    }
  }
  if (receiptEvidenceBytes !== root.receiptEvidenceBytes ||
    participantWorkBytes !== root.participantWorkBytes ||
    participantWorkCalls !== root.participantWorkCalls) {
    return yield* Effect.fail(corruption(attempt, "journalCountersInvalid"));
  }
  const lastRecord = receiptRecords.at(-1);
  if (lastRecord !== undefined) {
    yield* Effect.fromResult(validateReceiptOutcomeMatchesJournalRootResult(
      attempt, root, lastRecord.outcome,
    ));
  }

  const pointRows = snapshot.points;
  if (pointRows.length !== counters.pointDependencyCount) {
    return yield* Effect.fail(corruption(
      attempt,
      "pointDependencyCountMismatch",
    ));
  }
  const pointDependencies: Array<Extract<
    LogicalReadDependencyV1,
    { readonly kind: "appRowPoint" }
  >> = [];
  for (const point of pointRows) {
    const dependency = yield* Effect.fromResult(
      decodePointDependencyResult(attempt, point),
    );
    yield* verifyPointOverlayEvidenceEffect(attempt, point);
    pointDependencies.push(logicalDependencyFromPoint(dependency));
  }
  pointDependencies.sort((left, right) =>
    compareUtf16Strings(left.documentId, right.documentId));
  const indexRangeDependencies = yield* decodeStoredIndexRangeRowsEffect(
    attempt,
    snapshot.indexRanges,
  );
  if (
    indexRangeDependencies.length !== counters.indexRangeDependencyCount
  ) {
    return yield* Effect.fail(corruption(
      attempt,
      "indexRangeDependencyCountMismatch",
    ));
  }
  const computedIndexRangeEvidenceBytes = snapshot.indexRanges.reduce(
    (total, row) => total + row.evidenceBytes,
    0,
  );
  if (
    computedIndexRangeEvidenceBytes !==
      counters.indexRangeDependencyEvidenceBytes
  ) {
    return yield* Effect.fail(corruption(
      attempt,
      "indexRangeDependencyEvidenceBytesMismatch",
    ));
  }
  const relationDependencies = yield*
    decodeStoredRelationIncomingDependenciesEffect(
      attempt,
      snapshot.relationDependencies,
    );
  if (relationDependencies.length !== counters.relationDependencyCount) {
    return yield* Effect.fail(corruption(
      attempt,
      "relationDependencyCountMismatch",
    ));
  }
  const dependencies: LogicalReadDependencyV1[] = [
    ...pointDependencies,
    ...indexRangeDependencies,
    ...relationDependencies,
  ];

  const eventRows = snapshot.events;
  if (eventRows.length !== counters.writeOperations) {
    return yield* Effect.fail(corruption(
      attempt,
      "writeOperationCountMismatch",
    ));
  }
  const writes: LogicalAppWriteV1[] = [];
  const participantEffects = new Map<bigint, Array<Readonly<{
    sourceBindingSha256Hex: string; effect: AdmittedParticipantLogicalEffectV1 }>>>();
  let computedWriteSemanticBytes = 0;
  let computedMaterialWriteEventEvidenceBytes = 0;
  for (const event of eventRows) {
    computedMaterialWriteEventEvidenceBytes += event.eventBytes.byteLength;
    if (
      !Number.isSafeInteger(computedMaterialWriteEventEvidenceBytes) ||
      computedMaterialWriteEventEvidenceBytes >
        MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1
    ) {
      return yield* Effect.fail(corruption(
        attempt,
        "materialWriteEventEvidenceBytesMismatch",
      ));
    }
    if (event.syscallSequence > lastSyscallSequence) {
      return yield* Effect.fail(corruption(
        attempt,
        "writeSequenceBeyondJournalFinalSequence",
      ));
    }
    if (event.writeKind === "logicalDocument") {
      const evidence = yield* decodeStoredEvidenceEffect(attempt,
        "logicalWriteEventInvalid", event.eventBytes, event.eventSha256);
      const decoded = yield* Effect.fromResult(Schema.decodeUnknownResult(
        AdmittedParticipantWriteEventSchema, { onExcessProperty: "error" },
      )(evidence.valueJson).pipe(Result.mapError(cause => corruption(
        attempt, "logicalWriteEventInvalid", cause,
      ))));
      const matching = receiptRecords[Number(event.syscallSequence) - 1];
      if (matching?.request.kind !== "admittedLogicalOperation" ||
        matching.outcome.kind !== "admittedLogicalResult" ||
        decoded.syscallSequence !== event.syscallSequence ||
        decoded.effect.effectOrdinal !== event.effectOrdinal ||
        !matching.request.sources.some(source =>
          source.sourceBindingSha256Hex === decoded.sourceBindingSha256Hex)) {
        return yield* Effect.fail(corruption(attempt, "logicalWriteEventInvalid"));
      }
      const effects = participantEffects.get(event.syscallSequence) ?? [];
      if (event.effectOrdinal !== effects.length) {
        return yield* Effect.fail(corruption(attempt, "logicalWriteEventInvalid"));
      }
      effects.push(Object.freeze({ sourceBindingSha256Hex: decoded.sourceBindingSha256Hex,
        effect: decoded.effect }));
      participantEffects.set(event.syscallSequence, effects);
      if (decoded.effect.after !== null) {
        const after = yield* Effect.tryPromise({
          try: () => canonicalizeFlarexValueJsonV1(decoded.effect.after),
          catch: cause => corruption(attempt, "logicalWriteEventInvalid", cause),
        });
        computedWriteSemanticBytes += after.semanticSizeBytes;
      }
    } else {
      if (event.effectOrdinal !== 0) {
        return yield* Effect.fail(corruption(attempt, "logicalWriteEventInvalid"));
      }
      const write = yield* decodeAndVerifyLogicalWriteEventEffect(attempt, event);
      computedWriteSemanticBytes += write.kind === "delete"
        ? 0 : write.resultingDocumentSemanticBytes;
      writes.push(write);
    }
  }
  if (computedWriteSemanticBytes !== counters.writeSemanticBytes) {
    return yield* Effect.fail(corruption(
      attempt,
      "writeSemanticBytesMismatch",
    ));
  }
  if (
    computedMaterialWriteEventEvidenceBytes !==
      counters.materialWriteEventEvidenceBytes
  ) {
    return yield* Effect.fail(corruption(
      attempt,
      "materialWriteEventEvidenceBytesMismatch",
    ));
  }

  const participantOperations: AdmittedParticipantOperation[] = [];
  for (const record of receiptRecords) {
    if (record.request.kind !== "admittedLogicalOperation") continue;
    const admittedRequest = record.request;
    const outcome = record.outcome;
    if (outcome.kind !== "admittedLogicalResult") {
      return yield* Effect.fail(corruption(attempt, "latestReceiptEvidenceInvalid"));
    }
    const frame = yield* Effect.fromResult(
      encodeAdmittedFrameworkOperationV1Result(record.request.frame).pipe(
        Result.mapError(cause => corruption(attempt,
          "latestReceiptEvidenceInvalid", cause)),
      ),
    );
    const frameDigest = yield* Effect.tryPromise({
      try: () => sha256(frame.bytes),
      catch: cause => corruption(attempt, "latestReceiptEvidenceInvalid", cause),
    });
    if (frame.operation.participant !== record.request.participant ||
      frame.operation.operation !== record.request.method ||
      encodeBytesToLowercaseHex(frameDigest) !== record.request.requestSha256Hex) {
      return yield* Effect.fail(corruption(attempt, "latestReceiptEvidenceInvalid"));
    }
    const resultEvidence = yield* Effect.tryPromise({
      try: () => canonicalizeFlarexValueJsonV1(outcome.result),
      catch: cause => corruption(attempt, "latestReceiptEvidenceInvalid", cause),
    });
    if (outcome.sourceDependencies.length !== admittedRequest.sources.length ||
      outcome.sourceDependencies.some((source, ordinal) =>
        source.sourceKey !== admittedRequest.sources[ordinal]?.sourceKey)) {
      return yield* Effect.fail(corruption(attempt, "latestReceiptEvidenceInvalid"));
    }
    const binding = yield* Effect.fromResult(canonicalizeAdmittedSourceBundleResult({
      participant: record.request.participant, method: record.request.method,
      profileRevision: record.request.profileRevision, sources: record.request.sources,
    }).pipe(Result.mapError(cause => corruption(attempt, "latestReceiptEvidenceInvalid", cause))));
    const bindingDigest = yield* Effect.tryPromise({
      try: () => sha256(binding.bytes),
      catch: cause => corruption(attempt, "latestReceiptEvidenceInvalid", cause),
    });
    if (encodeBytesToLowercaseHex(bindingDigest) !== record.request.admissionBundleSha256Hex) {
      return yield* Effect.fail(corruption(attempt, "latestReceiptEvidenceInvalid"));
    }
    const sourceContributions = record.request.sources.map((source, ordinal) => Object.freeze({
      ...source,
      effects: Object.freeze((participantEffects.get(record.request.syscallSequence) ?? [])
        .filter(item => item.sourceBindingSha256Hex === source.sourceBindingSha256Hex)
        .map(item => item.effect)),
      dependencyEvidence: outcome.sourceDependencies[ordinal]!.evidence,
    }));
    participantOperations.push(Object.freeze({
      syscallSequence: record.request.syscallSequence,
      participant: record.request.participant,
      method: record.request.method,
      profileRevision: record.request.profileRevision,
      admissionBundleSha256Hex: record.request.admissionBundleSha256Hex,
      requestSha256Hex: record.request.requestSha256Hex,
      resultSha256Hex: encodeBytesToLowercaseHex(resultEvidence.sha256),
      sourceContributions: Object.freeze(sourceContributions),
      eventIntents: Object.freeze(outcome.events),
    }));
  }
  if ([...participantEffects.keys()].some(sequence => !participantOperations.some(
      operation => operation.syscallSequence === sequence))) {
    return yield* Effect.fail(corruption(attempt, "logicalWriteEventInvalid"));
  }

  const journal = Object.freeze(SessionJournalSchema.make({
    format: SESSION_JOURNAL_FORMAT,
    protocolVersion: TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
    valueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
    finalSyscallSequence: lastSyscallSequence,
    readDependencies: Object.freeze(dependencies),
    readUsage: Object.freeze({
      documentsRead: CommitReadDocumentsV1Schema.make(
        counters.readDocuments,
      ),
      semanticBytesRead: CommitReadSemanticBytesV1Schema.make(
        counters.readSemanticBytes,
      ),
    }),
    writes: Object.freeze(writes),
    operationUsage: Object.freeze({
      receiptEvidenceBytes,
      participantWorkBytes,
      participantWorkCalls,
    }),
    participantOperations: Object.freeze(participantOperations),
  }));
  const rootUpdatedAtMilliseconds = finiteDateMilliseconds(root.updatedAt);
  if (rootUpdatedAtMilliseconds === undefined) {
    return yield* Effect.fail(corruption(attempt, "journalStateInvalid"));
  }
  return Object.freeze({
    lastSyscallSequence,
    nextCreationTime: decodeAppCreationTimeV1(root.nextCreationTime),
    counters,
    rootUpdatedAtMilliseconds,
    journal,
  });
});

interface RepeatableReadAttemptAuthorityV1 {
  readonly scopeUuid: ScopeUuidV1;
  readonly root: typeof fxSystemTransactionJournals.$inferSelect;
}

async function requireRepeatableReadAttemptAuthority(
  tx: AppRowTransaction,
  attempt: SessionJournalAttemptStateV1,
  preliminary: TrustedScopeAuthority,
): Promise<RepeatableReadAttemptAuthorityV1> {
  const clockRows = await tx
    .select()
    .from(fxSystemScopeClocks)
    .where(eq(fxSystemScopeClocks.scopeId, attempt.selector.scopeId))
    .limit(2);
  const clockRow = clockRows[0];
  if (clockRow === undefined || clockRows.length !== 1) {
    throw corruption(attempt, "scopeClockMissingOrDuplicate");
  }
  const clock = decodeScopeClockRecord(clockRow);
  const scopeUuid = decodeScopeUuidV1(clockRow.scopeUuid);
  const epochUuid = decodeScopeEpochUuidV1(clockRow.epochUuid);
  if (
    scopeUuid !== projectScopeIdUuidV1(clock.scopeId).scopeUuid ||
    epochUuid !== projectScopeEpochUuidV1(clock.epoch).epochUuid ||
    preliminary.scopeId !== attempt.selector.scopeId ||
    preliminary.deploymentId !== attempt.selector.deploymentId ||
    preliminary.storageGeneration !== "flarexdb_v1" ||
    clock.storageGeneration !== "flarexdb_v1" ||
    preliminary.storageGenerationFence !== clock.storageGenerationFence ||
    preliminary.epoch !== clock.epoch
  ) {
    throw new SessionJournalSealV1Error({ reason: "stalePreparation" });
  }

  const sessionRows = await tx
    .select()
    .from(fxSystemTransactionSessions)
    .where(and(
      eq(fxSystemTransactionSessions.scopeUuid, scopeUuid),
      eq(
        fxSystemTransactionSessions.sessionId,
        attempt.selector.sessionId,
      ),
    ))
    .limit(2);
  const session = sessionRows[0];
  if (session === undefined || sessionRows.length !== 1) {
    throw new SessionJournalSealV1Error({ reason: "stalePreparation" });
  }
  let sessionAttemptFence: TransactionAttemptFence;
  let authorizationRevocationEpoch: ReturnType<
    typeof TransactionAuthorizationRevocationEpochSchema.make
  >;
  try {
    sessionAttemptFence = TransactionAttemptFenceSchema.make(
      session.attemptFence,
    );
    authorizationRevocationEpoch =
      TransactionAuthorizationRevocationEpochSchema.make(
        clockRow.authorizationRevocationEpoch,
      );
  } catch (cause) {
    throw corruption(attempt, "sessionRecordInvalid", cause);
  }
  const authorizationGrantExpiresAtMilliseconds = finiteDateMilliseconds(
    session.authorizationGrantExpiresAt,
  );
  const hardExpiresAtMilliseconds = finiteDateMilliseconds(
    session.hardExpiresAt,
  );
  if (
    session.protocolVersion !== TRANSACTION_SESSION_PROTOCOL_VERSION_V1 ||
    authorizationGrantExpiresAtMilliseconds === undefined ||
    hardExpiresAtMilliseconds === undefined ||
    finiteDateMilliseconds(session.createdAt) === undefined ||
    finiteDateMilliseconds(session.updatedAt) === undefined ||
    hardExpiresAtMilliseconds > authorizationGrantExpiresAtMilliseconds
  ) {
    throw corruption(attempt, "sessionRecordInvalid");
  }
  if (
    sessionAttemptFence !== attempt.selector.attemptFence ||
    session.lifecycle !== "running" ||
    session.storageGeneration !== "flarexdb_v1" ||
    session.storageGenerationFence !== clock.storageGenerationFence ||
    session.authorizationRevocationEpoch !== authorizationRevocationEpoch ||
    session.schemaVersionId !== attempt.schemaVersionId
  ) {
    throw new SessionJournalSealV1Error({ reason: "stalePreparation" });
  }

  const leaseRows = await tx
    .select()
    .from(fxSystemSnapshotLeases)
    .where(and(
      eq(fxSystemSnapshotLeases.scopeUuid, scopeUuid),
      eq(fxSystemSnapshotLeases.sessionId, attempt.selector.sessionId),
    ))
    .limit(2);
  const lease = leaseRows[0];
  if (lease === undefined || leaseRows.length !== 1) {
    throw new SessionJournalSealV1Error({ reason: "stalePreparation" });
  }
  let leaseSnapshot: SnapshotToken;
  try {
    leaseSnapshot = SnapshotTokenSchema.make({
      scopeId: attempt.selector.scopeId,
      epoch: replacementScopeEpochV1FromUuid(lease.snapshotEpochUuid),
      commitSeq: CommitSeqSchema.make(lease.snapshotCommitSeq),
    });
  } catch (cause) {
    throw corruption(attempt, "snapshotLeaseInvalid", cause);
  }
  const leaseExpiresAtMilliseconds = finiteDateMilliseconds(
    lease.leaseExpiresAt,
  );
  if (
    leaseExpiresAtMilliseconds === undefined ||
    leaseExpiresAtMilliseconds > hardExpiresAtMilliseconds
  ) {
    throw corruption(attempt, "snapshotLeaseInvalid");
  }
  if (
    lease.attemptFence !== attempt.selector.attemptFence ||
    leaseSnapshot.epoch !== attempt.snapshotToken.epoch ||
    leaseSnapshot.epoch !== clock.epoch ||
    leaseSnapshot.commitSeq !== attempt.snapshotToken.commitSeq ||
    leaseSnapshot.commitSeq > clock.lastCommitSeq
  ) {
    throw new SessionJournalSealV1Error({ reason: "stalePreparation" });
  }
  const databaseNow = await readDatabaseNowForSeal(tx, attempt);
  const databaseNowMilliseconds = finiteDateMilliseconds(databaseNow);
  if (databaseNowMilliseconds === undefined) {
    throw corruption(attempt, "databaseClockInvalid");
  }
  if (
    authorizationGrantExpiresAtMilliseconds <= databaseNowMilliseconds ||
    hardExpiresAtMilliseconds <= databaseNowMilliseconds ||
    leaseExpiresAtMilliseconds <= databaseNowMilliseconds
  ) {
    throw new SessionJournalSealV1Error({ reason: "stalePreparation" });
  }

  const rootRows = await tx
    .select()
    .from(fxSystemTransactionJournals)
    .where(and(
      eq(fxSystemTransactionJournals.scopeUuid, scopeUuid),
      eq(fxSystemTransactionJournals.sessionId, attempt.selector.sessionId),
      eq(
        fxSystemTransactionJournals.attemptFence,
        attempt.selector.attemptFence,
      ),
    ))
    .limit(2);
  const root = rootRows[0];
  if (root === undefined || rootRows.length !== 1) {
    throw corruption(attempt, "journalRootMissingOrDuplicate");
  }
  return Object.freeze({ scopeUuid, root });
}

async function readDatabaseNowForSeal(
  tx: AppRowTransaction,
  attempt: SessionJournalAttemptStateV1,
): Promise<Date> {
  const rows = await tx
    .select({
      milliseconds: sql<string>`
        floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text
      `,
    })
    .from(fxSystemScopeClocks)
    .where(eq(fxSystemScopeClocks.scopeId, attempt.selector.scopeId))
    .limit(1);
  const text = rows[0]?.milliseconds;
  if (typeof text !== "string") {
    throw corruption(attempt, "databaseClockInvalid");
  }
  const milliseconds = Number(text);
  const date = new Date(milliseconds);
  if (
    !isPositiveSafeInteger(milliseconds) ||
    finiteDateMilliseconds(date) === undefined
  ) {
    throw corruption(attempt, "databaseClockInvalid");
  }
  return date;
}

async function loadReceiptsReadOnly(
  tx: AppRowTransaction,
  authority: RepeatableReadAttemptAuthorityV1,
): Promise<
  ReadonlyArray<typeof fxSystemTransactionJournalReceipts.$inferSelect>
> {
  const rows = await tx
    .select()
    .from(fxSystemTransactionJournalReceipts)
    .where(and(
      eq(
        fxSystemTransactionJournalReceipts.scopeUuid,
        authority.scopeUuid,
      ),
      eq(
        fxSystemTransactionJournalReceipts.sessionId,
        authority.root.sessionId,
      ),
      eq(
        fxSystemTransactionJournalReceipts.attemptFence,
        authority.root.attemptFence,
      ),
    ))
    .orderBy(asc(fxSystemTransactionJournalReceipts.lastSyscallSequence))
    .limit(MAX_COMMIT_OPERATION_CALLS_V1 + 1);
  return rows;
}

const decodeLivePointOverlayEvidenceEffect = Effect.fn(
  "SessionJournalStore.decodeLivePointOverlayEvidence",
)(function* (
  attempt: SessionJournalAttemptStateV1,
  point: typeof fxSystemTransactionJournalPoints.$inferSelect,
): Effect.fn.Return<
  CanonicalFlarexValueV1,
  SessionJournalStorageCorruptionV1Error
> {
  if (point.overlayKind !== "live") {
    return yield* Effect.die(
      new Error("Live point-overlay decoder received a non-live row."),
    );
  }
  if (
    point.overlayCreationTime === null ||
    point.overlayValueCodecVersion === null ||
    point.overlayValueJson === null ||
    point.overlayValueBytes === null ||
    point.overlayValueSha256 === null ||
    point.overlaySemanticBytes === null
  ) {
    return yield* Effect.fail(corruption(
      attempt,
      "liveOverlayEvidenceMissing",
    ));
  }
  const overlayCreationTime = point.overlayCreationTime;
  const overlayValueCodecVersion = point.overlayValueCodecVersion;
  const overlayValueJson = point.overlayValueJson;
  const overlayValueBytes = point.overlayValueBytes;
  const overlayValueSha256 = point.overlayValueSha256;
  const document = yield* Effect.tryPromise({
    try: () => verifyAppDocumentEvidenceV1({
      tableId: point.tableId,
      rowId: appRowIdHexV1FromBytes(point.rowId),
      creationTime: overlayCreationTime,
      codecVersion: overlayValueCodecVersion,
      valueJson: overlayValueJson,
      canonicalBytes: overlayValueBytes,
      sha256: overlayValueSha256,
    }),
    catch: (cause): unknown => cause,
  }).pipe(
    Effect.catch((cause) =>
      cause instanceof AppDocumentIdV1Error ||
      cause instanceof AppDocumentSystemFieldV1Error ||
      cause instanceof FlarexValueCodecV1Error ||
      cause instanceof FlarexValueEvidenceV1Error ||
      Schema.isSchemaError(cause)
        ? Effect.fail(corruption(
            attempt,
            "liveOverlaySemanticBytesMismatch",
            cause,
          ))
        : Effect.die(cause)
    ),
  );
  if (document.semanticSizeBytes !== point.overlaySemanticBytes) {
    return yield* Effect.fail(corruption(
      attempt,
      "liveOverlaySemanticBytesMismatch",
    ));
  }
  return document;
});

const verifyPointOverlayEvidenceEffect = Effect.fn(function* (
  attempt: SessionJournalAttemptStateV1,
  point: typeof fxSystemTransactionJournalPoints.$inferSelect,
): Effect.fn.Return<void, SessionJournalStorageCorruptionV1Error> {
  if (point.overlayKind !== "live") return;
  yield* decodeLivePointOverlayEvidenceEffect(attempt, point);
});

function logicalDependencyFromPoint(
  dependency: AppRowPointDependencyV1,
): Extract<LogicalReadDependencyV1, { readonly kind: "appRowPoint" }> {
  const documentId = appDocumentIdV1FromRowIdentity({
    tableId: dependency.identity.tableId,
    rowId: dependency.identity.rowId,
  });
  return dependency.kind === "present"
    ? Object.freeze({
        kind: "appRowPoint",
        documentId,
        observed: Object.freeze({
          kind: "present",
          revisionCommitSeq: dependency.revisionCommitSeq,
        }),
      })
    : Object.freeze({
        kind: "appRowPoint",
        documentId,
        observed: Object.freeze({
          kind: "missing",
          basis: dependency.basis,
        }),
      });
}

const decodeAndVerifyLogicalWriteEventEffect = Effect.fn(function* (
  attempt: SessionJournalAttemptStateV1,
  event: typeof fxSystemTransactionJournalWriteEvents.$inferSelect,
): Effect.fn.Return<
  LogicalAppWriteV1,
  SessionJournalStorageCorruptionV1Error
> {
  const evidence = yield* decodeStoredEvidenceEffect(
    attempt,
    "logicalWriteEventInvalid",
    event.eventBytes,
    event.eventSha256,
  );
  const write = yield* Effect.fromResult(
    decodeLogicalAppWriteResult(evidence.valueJson).pipe(
      Result.mapError((cause) => corruption(
        attempt,
        "logicalWriteEventInvalid",
        cause,
      )),
    ),
  );
  if (
    write.kind !== event.writeKind ||
    write.syscallSequence !== event.syscallSequence
  ) {
    return yield* Effect.fail(corruption(
      attempt,
      "logicalWriteEventInvalid",
    ));
  }
  return write;
});

interface CanonicalSealInputsSnapshotV1 {
  readonly journal: SessionJournal;
  readonly journalCanonicalText: string;
  readonly journalBytes: Uint8Array;
  readonly journalSha256Hex: CanonicalSessionJournal["sha256Hex"];
  readonly resultValueJson: Json;
  readonly resultSemanticBytes: number;
  readonly resultCanonicalText: string;
  readonly resultBytes: Uint8Array;
  readonly resultEvidence: unknown;
}

function captureCanonicalSealInputsResult(
  journal: CanonicalSessionJournal,
  successfulResult: CanonicalSuccessfulResultV1,
): Result.Result<CanonicalSealInputsSnapshotV1, SessionJournalSealV1Error> {
  return Result.gen(function* () {
    const capturedJournal = yield* Result.try({
      try: () => Object.freeze({
        journal: structuredClone(journal.journal),
        journalCanonicalText: journal.canonicalText,
        journalBytes: new Uint8Array(journal.canonicalBytes),
        journalSha256Hex: journal.sha256Hex,
      }),
      catch: () => sealMismatch("canonicalJournalMismatch"),
    });
    return yield* Result.try({
      try: () => Object.freeze({
        ...capturedJournal,
        resultValueJson: structuredClone(successfulResult.valueJson),
        resultSemanticBytes: successfulResult.semanticSizeBytes,
        resultCanonicalText: successfulResult.canonicalText,
        resultBytes: new Uint8Array(successfulResult.canonicalBytes),
        resultEvidence: structuredClone(successfulResult.evidence),
      }),
      catch: () => sealMismatch("canonicalResultMismatch"),
    });
  });
}

const validateCanonicalSealEvidenceEffect = Effect.fn(
  "SessionJournalStore.validateCanonicalSealEvidence",
)(function* (
  candidate: SessionJournalSealCandidateV1,
  journal: CanonicalSessionJournal,
  successfulResult: CanonicalSuccessfulResultV1,
): Effect.fn.Return<
  ValidatedCanonicalSealEvidenceV1,
  SessionJournalPersistenceV1Error | SessionJournalSealV1Error
> {
  const supplied = yield* Effect.fromResult(
    captureCanonicalSealInputsResult(journal, successfulResult),
  );
  const expectedJournalJson = requireJson(
    encodeSessionJournal(candidate.journal),
  );
  const suppliedJournalEncoded = yield* Effect.fromResult(
    encodeSessionJournalResult(supplied.journal).pipe(
      Result.mapError(() => sealMismatch("canonicalJournalMismatch")),
    ),
  );
  const suppliedJournalJson = requireJson(suppliedJournalEncoded);
  const expectedJournalText = encodeCanonicalJson(
    expectedJournalJson,
    () => {
      throw new Error(
        "Materialized session journal violated canonical JSON invariants.",
      );
    },
  );
  if (
    !jsonEqual(expectedJournalJson, suppliedJournalJson) ||
    supplied.journalCanonicalText !== expectedJournalText ||
    !bytesEqual(
      supplied.journalBytes,
      TEXT_ENCODER.encode(expectedJournalText),
    )
  ) {
    return yield* Effect.fail(sealMismatch("canonicalJournalMismatch"));
  }
  const journalDigest = yield* Effect.tryPromise({
    try: () => sha256(supplied.journalBytes),
    catch: (cause) => new SessionJournalPersistenceV1Error({
      operation: "hashSealJournal",
      cause,
    }),
  });
  if (
    encodeBytesToLowercaseHex(journalDigest) !== supplied.journalSha256Hex ||
    supplied.journal.finalSyscallSequence !== candidate.lastSyscallSequence
  ) {
    return yield* Effect.fail(sealMismatch("canonicalJournalMismatch"));
  }

  const normalizedResult = yield* Effect.fromResult(
    normalizeSealResultValueJsonCompatibilityResult(supplied.resultValueJson),
  );
  const expectedResultText = encodeCanonicalJson(
    {
      format: "flarex-value",
      value: normalizedResult.valueJson,
      valueCodecVersion: 1,
    },
    () => {
      throw new Error(
        "Normalized successful result violated canonical JSON invariants.",
      );
    },
  );
  const verifiedResult = yield* verifySuccessfulResultEvidenceV1Effect(
    supplied.resultEvidence,
  ).pipe(
    Effect.mapError(() => sealMismatch("canonicalResultMismatch")),
  );
  const verifiedResultBytes = verifiedResult.canonicalBytes;
  if (
    supplied.resultSemanticBytes !== normalizedResult.semanticSizeBytes ||
    verifiedResult.semanticSizeBytes !== normalizedResult.semanticSizeBytes ||
    supplied.resultCanonicalText !== expectedResultText ||
    verifiedResult.canonicalText !== expectedResultText ||
    !jsonEqual(verifiedResult.valueJson, normalizedResult.valueJson) ||
    !bytesEqual(
      supplied.resultBytes,
      TEXT_ENCODER.encode(expectedResultText),
    ) ||
    !bytesEqual(verifiedResultBytes, supplied.resultBytes)
  ) {
    return yield* Effect.fail(sealMismatch("canonicalResultMismatch"));
  }
  const resultDigest = yield* Effect.fromResult(
    decodeLowercaseSha256HexResult(verifiedResult.evidence.sha256Hex),
  );
  return Object.freeze({
    finalSyscallSequence: candidate.lastSyscallSequence,
    journalBytes: new Uint8Array(supplied.journalBytes),
    journalSha256: journalDigest,
    journalSha256Hex: supplied.journalSha256Hex,
    resultValueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
    resultSemanticBytes: verifiedResult.semanticSizeBytes,
    resultBytes: new Uint8Array(verifiedResultBytes),
    resultSha256: resultDigest,
    successfulResult: Object.freeze({ ...verifiedResult.evidence }),
  });
});

/**
 * Temporary compatibility seam for the protocol's throwing JSON normalizer.
 * Delete this adapter when Value Codec V1 exposes its Result-native decoder.
 */
function normalizeSealResultValueJsonCompatibilityResult(
  valueJson: unknown,
): Result.Result<
  ReturnType<typeof normalizeFlarexValueJsonV1>,
  SessionJournalSealV1Error
> {
  return Result.try({
    try: () => normalizeFlarexValueJsonV1(valueJson),
    catch: (cause) => {
      if (cause instanceof FlarexValueCodecV1Error) {
        return sealMismatch("canonicalResultMismatch");
      }
      throw cause;
    },
  });
}

function sealMismatch(
  reason: "canonicalJournalMismatch" | "canonicalResultMismatch",
): SessionJournalSealV1Error {
  return new SessionJournalSealV1Error({ reason });
}

const completeSealInTransactionEffect = Effect.fn(
  "SessionJournalStore.completeSealInTransaction",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  prepared: PreparedSessionJournalSealStateV1,
  evidence: ValidatedCanonicalSealEvidenceV1,
  maximumLiveSnapshotRetentionMilliseconds: number,
): Effect.fn.Return<
  StoredForSessionAttemptCommitEnvelopeV1,
  SessionJournalCompleteSealV1Error
> {
  if (!kernelContextMatchesAttempt(context, prepared.attempt)) {
    return yield* Effect.fail(corruption(
      prepared.attempt,
      "exactAttemptPinsChanged",
    ));
  }
  const root = context.journalRoot;
  if (root.state === "failed" || root.state === "operation_failed") {
    return yield* Effect.fail(
      new SessionJournalSealV1Error({ reason: "journalFailed" }),
    );
  }
  if (root.state === "relation_conflicted") {
    return yield* Effect.fail(
      new SessionJournalSealV1Error({
        reason: "journalRelationConflicted",
      }),
    );
  }
  const databaseNowMilliseconds = finiteDateMilliseconds(context.databaseNow);
  const currentLeaseExpiresAt = new Date(context.anchor.leaseExpiresAt);
  const currentLeaseExpiresAtMilliseconds = finiteDateMilliseconds(
    currentLeaseExpiresAt,
  );
  const promotion = yield* Effect.fromResult(
    projectSealedAttemptLeasePromotionV1Result({
      authorizationGrantExpiresAtMilliseconds:
        context.authorizationGrantExpiresAtMilliseconds,
      hardExpiresAtMilliseconds: context.hardExpiresAtMilliseconds,
      databaseNowMilliseconds: databaseNowMilliseconds ?? Number.NaN,
      currentLeaseExpiresAtMilliseconds:
        currentLeaseExpiresAtMilliseconds ?? Number.NaN,
      maximumLiveSnapshotRetentionMilliseconds,
    }),
  ).pipe(Effect.mapError((issue) => mapLeasePromotionIssue(
    prepared.attempt,
    issue,
    maximumLiveSnapshotRetentionMilliseconds,
  )));
  const targetLeaseExpiresAt = new Date(
    promotion.targetLeaseExpiresAtMilliseconds,
  );
  if (root.state === "sealed") {
    if (
      currentLeaseExpiresAtMilliseconds !==
        promotion.targetLeaseExpiresAtMilliseconds
    ) {
      return yield* Effect.fail(corruption(
        prepared.attempt,
        "snapshotLeaseInvalid",
      ));
    }
    yield* Effect.fromResult(validateStoredSealMatchesResult(
      prepared.attempt,
      root,
      evidence,
    ));
    return storedSealEnvelope(context, evidence);
  }
  if (root.state !== "open") {
    return yield* Effect.fail(corruption(
      prepared.attempt,
      "journalStateInvalid",
    ));
  }
  yield* Effect.fromResult(validateSealCandidateStillCurrentResult(
    prepared.candidate,
    root,
  ));

  const updated = yield* Effect.tryPromise({
    try: async () => {
      const promotedLeaseRows = await tx
        .update(fxSystemSnapshotLeases)
        .set({ leaseExpiresAt: targetLeaseExpiresAt })
        .where(and(
          eq(fxSystemSnapshotLeases.scopeUuid, context.scopeUuid),
          eq(fxSystemSnapshotLeases.sessionId, context.anchor.sessionId),
          eq(
            fxSystemSnapshotLeases.attemptFence,
            context.anchor.attemptFence,
          ),
          eq(
            fxSystemSnapshotLeases.snapshotEpochUuid,
            projectScopeEpochUuidV1(context.anchor.snapshotToken.epoch)
              .epochUuid,
          ),
          eq(
            fxSystemSnapshotLeases.snapshotCommitSeq,
            context.anchor.snapshotToken.commitSeq,
          ),
          eq(fxSystemSnapshotLeases.leaseExpiresAt, currentLeaseExpiresAt),
        ))
        .returning({ leaseExpiresAt: fxSystemSnapshotLeases.leaseExpiresAt });
      const promotedLeaseExpiresAtMilliseconds =
        promotedLeaseRows.length === 1
          ? finiteDateMilliseconds(promotedLeaseRows[0]?.leaseExpiresAt)
          : undefined;
      if (
        promotedLeaseExpiresAtMilliseconds !==
          promotion.targetLeaseExpiresAtMilliseconds
      ) {
        throw corruption(prepared.attempt, "snapshotLeaseInvalid");
      }

      return tx
        .update(fxSystemTransactionJournals)
        .set({
          state: "sealed",
          failureDimension: null,
          sealedJournalBytes: new Uint8Array(evidence.journalBytes),
          sealedJournalSha256: new Uint8Array(evidence.journalSha256),
          sealedResultValueCodecVersion: evidence.resultValueCodecVersion,
          sealedResultSemanticBytes: evidence.resultSemanticBytes,
          sealedResultBytes: new Uint8Array(evidence.resultBytes),
          sealedResultSha256: new Uint8Array(evidence.resultSha256),
          sealedAt: context.databaseNow,
          updatedAt: context.databaseNow,
        })
        .where(and(
          eq(fxSystemTransactionJournals.scopeUuid, context.scopeUuid),
          eq(fxSystemTransactionJournals.sessionId, context.anchor.sessionId),
          eq(
            fxSystemTransactionJournals.attemptFence,
            context.anchor.attemptFence,
          ),
          eq(fxSystemTransactionJournals.state, "open"),
          eq(
            fxSystemTransactionJournals.lastSyscallSequence,
            prepared.candidate.lastSyscallSequence,
          ),
          eq(
            fxSystemTransactionJournals.updatedAt,
            new Date(prepared.candidate.rootUpdatedAtMilliseconds),
          ),
        ))
        .returning({ state: fxSystemTransactionJournals.state });
    },
    catch: mapCompleteSealTransactionFailure,
  });
  if (updated.length !== 1 || updated[0]?.state !== "sealed") {
    return yield* Effect.fail(
      new SessionJournalSealV1Error({ reason: "stalePreparation" }),
    );
  }
  return storedSealEnvelope(context, evidence);
});

function mapLeasePromotionIssue(
  attempt: SessionJournalAttemptStateV1,
  issue: SealedAttemptLeasePromotionIssueV1,
  maximumLiveSnapshotRetentionMilliseconds: number,
): SessionJournalAttemptUnavailableV1Error |
  SessionJournalLeasePromotionV1Error |
  SessionJournalStorageCorruptionV1Error {
  switch (issue.kind) {
    case "authorityExpiryInvalid":
      return corruption(attempt, "sessionRecordInvalid");
    case "databaseClockInvalid":
      return corruption(attempt, "databaseClockInvalid");
    case "retentionBudgetInvalid":
      return new SessionJournalLeasePromotionV1Error({
        issue: Object.freeze({
          kind: "retentionPolicyInvalid",
          maximumLiveSnapshotRetentionMilliseconds,
        }),
      });
    case "authorityExpired":
    case "currentLeaseExpired":
      return new SessionJournalAttemptUnavailableV1Error({
        issue: { reason: "activeAttemptExpired" },
      });
    case "retentionBudgetExceeded":
      return new SessionJournalLeasePromotionV1Error({
        issue: Object.freeze({
          kind: "retentionBudgetExceeded",
          remainingMilliseconds: issue.remainingMilliseconds,
          maximumLiveSnapshotRetentionMilliseconds:
            issue.maximumLiveSnapshotRetentionMilliseconds,
        }),
      });
    case "currentLeaseInvalid":
    case "currentLeaseAfterTarget":
      return corruption(attempt, "snapshotLeaseInvalid");
  }
}

function validateSealCandidateStillCurrentResult(
  candidate: SessionJournalSealCandidateV1,
  root: typeof fxSystemTransactionJournals.$inferSelect,
): Result.Result<void, SessionJournalSealV1Error> {
  const rootUpdatedAtMilliseconds = finiteDateMilliseconds(root.updatedAt);
  if (
    root.lastSyscallSequence !== candidate.lastSyscallSequence ||
    root.nextCreationTime !== candidate.nextCreationTime ||
    root.readDocuments !== candidate.counters.readDocuments ||
    root.readSemanticBytes !== candidate.counters.readSemanticBytes ||
    root.pointDependencyCount !== candidate.counters.pointDependencyCount ||
    root.indexedQuerySyscalls !== candidate.counters.indexedQuerySyscalls ||
    root.indexRangeDependencyCount !==
      candidate.counters.indexRangeDependencyCount ||
    root.indexRangeDependencyEvidenceBytes !==
      candidate.counters.indexRangeDependencyEvidenceBytes ||
    root.relationReadSyscalls !== candidate.counters.relationReadSyscalls ||
    root.relationDependencyCount !==
      candidate.counters.relationDependencyCount ||
    root.relationBaseOccurrences !==
      candidate.counters.relationBaseOccurrences ||
    root.writeOperations !== candidate.counters.writeOperations ||
    root.writeSemanticBytes !== candidate.counters.writeSemanticBytes ||
    root.materialWriteEventEvidenceBytes !==
      candidate.counters.materialWriteEventEvidenceBytes ||
    rootUpdatedAtMilliseconds !== candidate.rootUpdatedAtMilliseconds
  ) {
    return Result.fail(
      new SessionJournalSealV1Error({ reason: "stalePreparation" }),
    );
  }
  return Result.succeed(undefined);
}

function validateStoredSealMatchesResult(
  attempt: SessionJournalAttemptStateV1,
  root: typeof fxSystemTransactionJournals.$inferSelect,
  evidence: ValidatedCanonicalSealEvidenceV1,
): Result.Result<
  void,
  SessionJournalSealV1Error | SessionJournalStorageCorruptionV1Error
> {
  if (
    root.lastSyscallSequence !== evidence.finalSyscallSequence ||
    root.sealedJournalBytes === null ||
    root.sealedJournalSha256 === null ||
    root.sealedResultValueCodecVersion !== evidence.resultValueCodecVersion ||
    root.sealedResultSemanticBytes !== evidence.resultSemanticBytes ||
    root.sealedResultBytes === null ||
    root.sealedResultSha256 === null ||
    !bytesEqual(root.sealedJournalBytes, evidence.journalBytes) ||
    !bytesEqual(root.sealedJournalSha256, evidence.journalSha256) ||
    !bytesEqual(root.sealedResultBytes, evidence.resultBytes) ||
    !bytesEqual(root.sealedResultSha256, evidence.resultSha256)
  ) {
    return Result.fail(new SessionJournalSealV1Error({
      reason: "sealedEvidenceMismatch",
    }));
  }
  if (root.failureDimension !== null || root.sealedAt === null) {
    return Result.fail(corruption(attempt, "sealedJournalStateInvalid"));
  }
  return Result.succeed(undefined);
}

function storedSealEnvelope(
  context: ExactRunningAttemptKernelContextV1,
  evidence: ValidatedCanonicalSealEvidenceV1,
): StoredForSessionAttemptCommitEnvelopeV1 {
  return Object.freeze({
    format: COMMIT_ENVELOPE_FORMAT_V1,
    protocolVersion: TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
    sessionId: context.anchor.sessionId,
    attemptFence: context.anchor.attemptFence,
    finalSyscallSequence: evidence.finalSyscallSequence,
    journal: Object.freeze({ kind: "storedForSessionAttempt" }),
    journalSha256Hex: evidence.journalSha256Hex,
    successfulResult: evidence.successfulResult,
  });
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(bytes);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", copy.buffer));
}

function decodeLowercaseSha256HexResult(
  value: string,
): Result.Result<Uint8Array, SessionJournalSealV1Error> {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    return Result.fail(sealMismatch("canonicalResultMismatch"));
  }
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return Result.succeed(bytes);
}
