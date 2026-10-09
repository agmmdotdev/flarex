import type { materializeFiniteExecutionSchema } from "../../commit/authority/materialization";
import type { FiniteApplicationExecutionEvidence } from "../../commit/authority/model";
import type { Effect, Result, Scope } from "effect";
import type { AppDocumentIdV1, AppRowIdHexV1 } from "flarex-protocol/app-document-id";
import type { CatalogEdgeDefinitionId, CatalogRelationId, CatalogTableId } from "flarex-protocol/catalog";
import type {
  CanonicalSessionJournal,
  CanonicalSuccessfulResultV1,
  CommitFinalSyscallSequenceV1,
  CommitProtocolV1LimitDimension,
  CommitSyscallSequenceV1,
  SessionJournal,
  StoredForSessionAttemptCommitEnvelopeV1,
} from "flarex-protocol/commit-protocol";
import type { OrderedIndexBoundsV1 } from "flarex-protocol/ordered-index";
import type { Json } from "flarex-protocol/json";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { CommitSeq, SnapshotToken } from "flarex-protocol/storage-authority";
import type { CanonicalFlarexRuntimeValueV1 } from "flarex-protocol/value";
import type {
  ApplicationRelationIncomingReadItem,
  ApplicationRelationReadCapability,
} from "../../application/relations/applicationRelationRead";
import type {
  ApplicationRevisionSyscallValidatorV1,
} from "../../application/revision/applicationRevisionSyscallValidatorV1";
import type {
  LogicalParticipantAdmissionError,
  LogicalParticipantInvocationError,
} from "../../storage/documents/logicalDocuments/participantErrors";
import type {
  LogicalParticipantAttemptAdmission,
  LogicalParticipantAdmissionBundle,
  LogicalParticipantSelection,
} from "../../storage/documents/logicalDocuments/participantAdmission";
import type {
  ApplicationBindingInput,
  ApplicationActiveSelection,
} from "../../application/applicationActivation";
import type {
  LogicalJournalContributionError,
} from "../../storage/documents/logicalDocuments/journalContribution";
import type {
  LogicalParticipantEvidenceError,
} from "../../storage/documents/logicalDocuments/journalEvidence";
import type { LogicalDocumentChanges } from "../../storage/documents/logicalDocuments/workingSet";
import type { LogicalDocumentBorrowView } from "../../storage/documents/logicalDocuments/model";
import type { FiniteEntryAttemptKernelContext } from "../transactionSessionAttemptKernel";
import type {
  PointMutationExecutionProfile,
  PointMutationSessionAttemptSelectorV1,
} from "../transactionSessionActivation";
import type { TransactionExecutionClaimPinV1 } from "../claims/transactionExecutionClaimModel";
import type {
  InvalidSessionJournalCapabilityV1Error,
  InvalidSessionJournalInputV1Error,
  SessionJournalTargetUnavailableV1Error,
  SessionJournalAttemptUnavailableV1Error,
  SessionJournalPersistenceV1Error,
  SessionJournalResolvePointTableV1Error,
  SessionJournalRunPointOperationV1Error,
  SessionJournalResolveDeveloperIndexV1Error,
  SessionJournalRunIndexedQueryV1Error,
  SessionJournalResolveApplicationRelationReadError,
  SessionJournalRunApplicationRelationReadError,
  SessionJournalPrepareSealV1Error,
  SessionJournalCompleteSealV1Error,
  SessionJournalStorageCorruptionV1Error,
} from "./errors";
import type {
  PreparedFiniteSessionJournalEntry,
  ConfirmedFiniteRootEntryCapture,
  FiniteSessionJournalParticipantSelection,
  FiniteEntryFailure,
} from "./finiteEntry";
import type { FrozenFiniteAttempt } from "./frozenAttempt";

export type SessionJournalIncrementalLimitDimensionV1 = Extract<
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

export const sessionJournalAttemptBrand: unique symbol = Symbol(
  "FlarexDB/SessionJournalAttempt",
);

/** Process-local proof that B2a supplied the exact attempt and schema pins. */
export interface SessionJournalAttempt {
  readonly [sessionJournalAttemptBrand]: true;
}

export const pinnedPointTableBrand: unique symbol = Symbol(
  "FlarexDB/PinnedPointTableV1",
);

/** Opaque C03A table identity resolved only from the pinned schema artifact. */
export interface PinnedPointTableV1 {
  readonly [pinnedPointTableBrand]: true;
}

export const pinnedDeveloperIndexBrand: unique symbol = Symbol(
  "FlarexDB/PinnedDeveloperIndexV1",
);

export interface PinnedDeveloperIndexV1 {
  readonly [pinnedDeveloperIndexBrand]: true;
}

export const pinnedApplicationRelationReadBrand: unique symbol = Symbol(
  "FlarexDB/PinnedApplicationRelationRead",
);

export interface PinnedApplicationRelationRead {
  readonly [pinnedApplicationRelationReadBrand]: true;
}

export const preparedSessionJournalSealBrand: unique symbol = Symbol(
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
  readonly logicalParticipants?: readonly SessionJournalParticipantSelection[];
}

export type SessionJournalParticipantSelection = Readonly<{
  participant: string;
  operationMethods: readonly string[];
  profileRevision: string;
  sources: readonly Readonly<{ selection: LogicalParticipantSelection;
    application: ApplicationBindingInput; methods: readonly string[] }>[];
}>;

export interface PreparedSessionJournalSealResultV1 {
  readonly preparation: PreparedSessionJournalSealV1;
  readonly journal: SessionJournal;
}

export interface LogicalBorrowedParticipantOperation {
  readonly invoke: (method: string, args: Json) => Effect.Effect<AdmittedCompletion, LogicalParticipantInvocationError>;
  readonly abort: Effect.Effect<void>;
  readonly currentUsage: () => Readonly<{ workBytes: number; workCalls: number }>;
}

export type LogicalParticipantBorrowBase = Readonly<{
  attempt: SessionJournalAttempt;
  admissions: readonly LogicalParticipantAttemptAdmission[];
  bundle: LogicalParticipantAdmissionBundle;
  method: string;
}>;

export type LogicalParticipantBorrow = (input: LogicalParticipantBorrowBase &
  LogicalDocumentBorrowView) => Effect.Effect<LogicalBorrowedParticipantOperation,
    LogicalParticipantInvocationError>;

export interface SessionJournalStorePersistence {
  readonly prepareFiniteEntryEffect: (participants: readonly FiniteSessionJournalParticipantSelection[]) =>
    Effect.Effect<PreparedFiniteSessionJournalEntry, FiniteEntryFailure, Scope.Scope>;
  readonly confirmedFiniteEntryAttempt: (capture: ConfirmedFiniteRootEntryCapture,
    preparation: PreparedFiniteSessionJournalEntry) => Result.Result<Readonly<{
      attempt: SessionJournalAttempt; context: FiniteEntryAttemptKernelContext;
      schemaManifest: Effect.Success<ReturnType<typeof materializeFiniteExecutionSchema>>["schemaManifest"];
      stableBindings: Effect.Success<ReturnType<typeof materializeFiniteExecutionSchema>>["stableBindings"];
      applicationEvidence: FiniteApplicationExecutionEvidence;
      admissions: ReadonlyMap<string, LogicalParticipantAdmissionBundle>;
      applicationSelection: ApplicationActiveSelection;
    }>, LogicalParticipantAdmissionError>;
  readonly openAttemptEffect: (
    input: OpenSessionJournalAttemptInput,
  ) => Effect.Effect<
    SessionJournalAttempt,
    | InvalidSessionJournalInputV1Error
    | SessionJournalAttemptUnavailableV1Error
    | SessionJournalPersistenceV1Error
    | SessionJournalStorageCorruptionV1Error
    | SessionJournalTargetUnavailableV1Error
    | LogicalParticipantAdmissionError
  >;
  /** The journal owner binds a finite, ordered source set to one exact attempt. */
  readonly admitLogicalParticipantsEffect: (
    attempt: SessionJournalAttempt,
    input: SessionJournalParticipantSelection,
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
  /** Freeze one local finite graph; final acceptance remains database-owned. */
  readonly freezeFiniteRootEffect: (
    attempt: SessionJournalAttempt,
    successfulResult: CanonicalSuccessfulResultV1,
  ) => Effect.Effect<
    FrozenFiniteAttempt,
    SessionJournalCompleteSealV1Error
  >;
  /** Drop only local tentative evidence; durable terminalization stays with
   * the outer session owner and this fence remains a busy tombstone. */
  readonly discardFiniteRootEffect: (
    attempt: SessionJournalAttempt,
  ) => Effect.Effect<void, InvalidSessionJournalCapabilityV1Error>;
}

export type AdmittedCompletion = Readonly<{
  result: Json;
  changes: LogicalDocumentChanges;
  eventIntents: readonly Readonly<{ sourceKey: string | null; intent: Json }>[];
  workBytes: number;
  workCalls: number;
}>;
