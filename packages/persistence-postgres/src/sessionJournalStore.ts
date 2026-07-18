import {
  bytesEqualFullScan as bytesEqual,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { finiteDateMilliseconds } from "@flarex/utils/dates";
import {
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
} from "@flarex/utils/numbers";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { and, asc, eq, sql } from "drizzle-orm";
import { Data, Effect, Result, Schema } from "effect";

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
  appDocumentIdV1FromRowIdentity,
  appRowIdHexV1FromBytes,
  appRowIdHexV1ToBytes,
  decodeAppDocumentIdentityV1,
  requireAppDocumentIdentityV1ForTable,
  type AppDocumentIdV1,
  type AppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import {
  CatalogTableIdSchema,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import {
  COMMIT_ENVELOPE_FORMAT_V1,
  AppDocumentFieldsJsonV1Schema,
  CommitDocumentSemanticBytesV1Schema,
  CommitFinalSyscallSequenceV1Schema,
  CommitMaterialWriteEventEvidenceBytesV1Schema,
  CommitReadDocumentsV1Schema,
  CommitReadSemanticBytesV1Schema,
  CommitSyscallSequenceV1Schema,
  LogicalAppWriteV1Schema,
  LogicalPatchFieldV1Schema,
  MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1,
  MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
  MAX_COMMIT_READ_DOCUMENTS_V1,
  MAX_COMMIT_READ_SEMANTIC_BYTES_V1,
  MAX_COMMIT_WRITE_OPERATIONS_V1,
  MAX_COMMIT_WRITE_SEMANTIC_BYTES_V1,
  SESSION_JOURNAL_FORMAT_V1,
  SessionJournalV1Schema,
  verifySuccessfulResultEvidenceV1Effect,
  type CanonicalSessionJournalV1,
  type CanonicalSuccessfulResultV1,
  type CommitFinalSyscallSequenceV1,
  type CommitProtocolV1LimitDimension,
  type CommitSyscallSequenceV1,
  type LogicalAppWriteV1,
  type LogicalPatchFieldV1,
  type LogicalReadDependencyV1,
  type SessionJournalV1,
  type StoredForSessionAttemptCommitEnvelopeV1,
} from "flarex-protocol/commit-protocol";
import {
  encodeCanonicalJson,
  isJson,
  isJsonObject,
  jsonEqual,
  JsonValue,
  type Json,
  type JsonObject,
} from "flarex-protocol/json";
import {
  CatalogSchemaVersionIdSchema,
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
  getAppRowAtSnapshotInTransaction,
  type AppRowPointDependencyV1,
  type AppRowTransaction,
} from "./appRows";
import {
  PinnedPointTableCorruptionV1Error,
  PinnedPointTableNotFoundV1Error,
} from "./pinnedPointTableResolution";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
  TrustedScopeAuthorityPortError,
  type TrustedScopeAuthority,
} from "./scopeAuthorityResolution";
import { decodeScopeClockRecord } from "./scopeClock";
import {
  fxAppRowRevisions,
  fxSystemScopeClocks,
  fxSystemSnapshotLeases,
  fxSystemTransactionJournalLatestReceipts,
  fxSystemTransactionJournalPoints,
  fxSystemTransactionJournals,
  fxSystemTransactionJournalWriteEvents,
  fxSystemTransactionSessions,
} from "./schema";
import {
  ExactRunningAttemptTransactionV1Error,
  RESOLVE_PINNED_POINT_TABLE_ID_V1,
  RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1,
  RUN_LOCATED_REPEATABLE_READ_V1,
  isLocatedExactRunningAttemptKernelV1,
  type ExactRunningAttemptKernelContextV1,
  type LocatedExactRunningAttemptKernelV1,
} from "./transactionSessionAttemptKernel";
import {
  PointMutationSessionAttemptLoadV1Error,
  type PointMutationSessionAttemptLoadIssueV1,
  type PointMutationSessionAttemptSelectorV1,
  type PointMutationSessionAuthorityResolutionPortsV1,
} from "./transactionSessionActivation";

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
  | "writeOperations"
  | "writeSemanticBytes"
  | "materialWriteEventEvidenceBytes"
>;

const SESSION_JOURNAL_INCREMENTAL_LIMIT_MAXIMUMS_V1 = Object.freeze({
  readDocuments: MAX_COMMIT_READ_DOCUMENTS_V1,
  readSemanticBytes: MAX_COMMIT_READ_SEMANTIC_BYTES_V1,
  pointReadDependencies: MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
  writeOperations: MAX_COMMIT_WRITE_OPERATIONS_V1,
  writeSemanticBytes: MAX_COMMIT_WRITE_SEMANTIC_BYTES_V1,
  materialWriteEventEvidenceBytes:
    MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1,
} satisfies Readonly<
  Record<SessionJournalIncrementalLimitDimensionV1, number>
>);

export type SessionJournalPointOperationKindV1 =
  | "get"
  | "insert"
  | "patch"
  | "replace"
  | "delete";

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
        readonly reason: "journalSealed" | "journalFailed";
      }>;
    }>;

const sessionJournalAttemptBrand: unique symbol = Symbol(
  "FlarexDB/SessionJournalAttemptV1",
);

/** Process-local proof that B2a supplied the exact attempt and schema pins. */
export interface SessionJournalAttemptV1 {
  readonly [sessionJournalAttemptBrand]: true;
}

const pinnedPointTableBrand: unique symbol = Symbol(
  "FlarexDB/PinnedPointTableV1",
);

/** Opaque C03A table identity resolved only from the pinned schema artifact. */
export interface PinnedPointTableV1 {
  readonly [pinnedPointTableBrand]: true;
}

const preparedSessionJournalSealBrand: unique symbol = Symbol(
  "FlarexDB/PreparedSessionJournalSealV1",
);

export interface PreparedSessionJournalSealV1 {
  readonly [preparedSessionJournalSealBrand]: true;
}

export interface OpenSessionJournalAttemptV1Input {
  readonly selector: PointMutationSessionAttemptSelectorV1;
  readonly snapshotToken: SnapshotToken;
  readonly schemaVersionId: CatalogSchemaVersionId;
}

export interface PreparedSessionJournalSealResultV1 {
  readonly preparation: PreparedSessionJournalSealV1;
  readonly journal: SessionJournalV1;
}

export interface SessionJournalStorePersistenceV1 {
  readonly openAttemptEffect: (
    input: OpenSessionJournalAttemptV1Input,
  ) => Effect.Effect<
    SessionJournalAttemptV1,
    InvalidSessionJournalInputV1Error
  >;
  readonly resolvePointTableEffect: (
    attempt: SessionJournalAttemptV1,
    tableName: unknown,
  ) => Effect.Effect<
    PinnedPointTableV1,
    SessionJournalResolvePointTableV1Error
  >;
  readonly runPointOperationEffect: (
    table: PinnedPointTableV1,
    operation: SessionJournalPointOperationV1,
  ) => Effect.Effect<
    RunSessionJournalPointOperationV1Result,
    SessionJournalRunPointOperationV1Error
  >;
  readonly prepareSealEffect: (
    attempt: SessionJournalAttemptV1,
  ) => Effect.Effect<
    PreparedSessionJournalSealResultV1,
    SessionJournalPrepareSealV1Error
  >;
  readonly completeSealEffect: (
    preparation: PreparedSessionJournalSealV1,
    journal: CanonicalSessionJournalV1,
    successfulResult: CanonicalSuccessfulResultV1,
  ) => Effect.Effect<
    StoredForSessionAttemptCommitEnvelopeV1,
    SessionJournalCompleteSealV1Error
  >;
}

export interface SessionJournalStorePersistenceOptionsV1 {
  /** Construction-bound server randomness; exposed only for deterministic tests. */
  readonly randomUuid?: () => string;
}

export class InvalidSessionJournalCapabilityV1Error extends Data.TaggedError(
  "InvalidSessionJournalCapabilityV1Error",
)<{
  readonly capability: "attempt" | "pointTable" | "sealPreparation";
}> {}

export class InvalidSessionJournalInputV1Error extends Data.TaggedError(
  "InvalidSessionJournalInputV1Error",
)<{
  readonly operation:
    | SessionJournalPointOperationKindV1
    | "openAttempt"
    | "resolvePointTable";
  readonly reason: "invalidAttemptPins" | "invalidTableName" | "invalidOperation";
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
    | "canonicalizePointRequest"
    | "completeSealTransaction"
    | "hashSealJournal"
    | "prepareSealSnapshot"
    | "resolveJournalTarget"
    | "resolvePinnedPointTable"
    | "runPointOperation";
  readonly cause: unknown;
}> {}

export type SessionJournalResolvePointTableV1Error =
  | InvalidSessionJournalCapabilityV1Error
  | InvalidSessionJournalInputV1Error
  | PinnedPointTableCorruptionV1Error
  | PinnedPointTableNotFoundV1Error
  | SessionJournalPersistenceV1Error
  | SessionJournalTargetUnavailableV1Error;

export type SessionJournalRunPointOperationV1Error =
  | InvalidSessionJournalCapabilityV1Error
  | InvalidSessionJournalInputV1Error
  | SessionJournalAttemptUnavailableV1Error
  | SessionJournalIdentityGenerationV1Error
  | SessionJournalPersistenceV1Error
  | SessionJournalStorageCorruptionV1Error
  | SessionJournalTargetUnavailableV1Error;

export type SessionJournalPrepareSealV1Error =
  | InvalidSessionJournalCapabilityV1Error
  | SessionJournalPersistenceV1Error
  | SessionJournalSealV1Error
  | SessionJournalStorageCorruptionV1Error
  | SessionJournalTargetUnavailableV1Error;

export type SessionJournalCompleteSealV1Error =
  | InvalidSessionJournalCapabilityV1Error
  | SessionJournalAttemptUnavailableV1Error
  | SessionJournalPersistenceV1Error
  | SessionJournalSealV1Error
  | SessionJournalStorageCorruptionV1Error
  | SessionJournalTargetUnavailableV1Error;

type SessionJournalStorageCorruptionReasonV1 =
  | "databaseClockInvalid"
  | "exactAttemptPinsChanged"
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
  | "presentDependencyRevisionMissing"
  | "requestTableCapabilityMismatch"
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

export class SessionJournalSealV1Error extends Data.TaggedError(
  "SessionJournalSealV1Error",
)<{
  readonly reason:
    | "journalFailed"
    | "stalePreparation"
    | "canonicalJournalMismatch"
    | "canonicalResultMismatch"
    | "sealedEvidenceMismatch";
}> {}

export {
  PinnedPointTableCorruptionV1Error,
  PinnedPointTableNotFoundV1Error,
};

interface SessionJournalAttemptStateV1 {
  readonly selector: PointMutationSessionAttemptSelectorV1;
  readonly snapshotToken: SnapshotToken;
  readonly schemaVersionId: CatalogSchemaVersionId;
}

interface PinnedPointTableStateV1 {
  readonly attempt: SessionJournalAttemptStateV1;
  readonly tableName: SchemaManifestAppTableName;
  readonly tableId: CatalogTableId;
}

interface PreparedSessionJournalSealStateV1 {
  readonly attempt: SessionJournalAttemptStateV1;
  readonly candidate: SessionJournalSealCandidateV1;
}

const SessionJournalGetRequestV1Schema = Schema.Struct({
  format: Schema.Literal("flarex.session-journal-syscall"),
  codecVersion: Schema.Literal(1),
  kind: Schema.Literal("get"),
  syscallSequence: CommitSyscallSequenceV1Schema,
  tableId: CatalogTableIdSchema,
  documentId: AppDocumentIdV1Schema,
}).annotate(StrictStructOptions);

const SessionJournalInsertRequestV1Schema = Schema.Struct({
  format: Schema.Literal("flarex.session-journal-syscall"),
  codecVersion: Schema.Literal(1),
  kind: Schema.Literal("insert"),
  syscallSequence: CommitSyscallSequenceV1Schema,
  tableId: CatalogTableIdSchema,
  fieldsValueJson: AppDocumentFieldsJsonV1Schema,
}).annotate(StrictStructOptions);

const SessionJournalPatchRequestV1Schema = Schema.Struct({
  format: Schema.Literal("flarex.session-journal-syscall"),
  codecVersion: Schema.Literal(1),
  kind: Schema.Literal("patch"),
  syscallSequence: CommitSyscallSequenceV1Schema,
  tableId: CatalogTableIdSchema,
  documentId: AppDocumentIdV1Schema,
  changes: Schema.Array(LogicalPatchFieldV1Schema),
}).annotate(StrictStructOptions);

const SessionJournalReplaceRequestV1Schema = Schema.Struct({
  format: Schema.Literal("flarex.session-journal-syscall"),
  codecVersion: Schema.Literal(1),
  kind: Schema.Literal("replace"),
  syscallSequence: CommitSyscallSequenceV1Schema,
  tableId: CatalogTableIdSchema,
  documentId: AppDocumentIdV1Schema,
  fieldsValueJson: AppDocumentFieldsJsonV1Schema,
}).annotate(StrictStructOptions);

const SessionJournalDeleteRequestV1Schema = Schema.Struct({
  format: Schema.Literal("flarex.session-journal-syscall"),
  codecVersion: Schema.Literal(1),
  kind: Schema.Literal("delete"),
  syscallSequence: CommitSyscallSequenceV1Schema,
  tableId: CatalogTableIdSchema,
  documentId: AppDocumentIdV1Schema,
}).annotate(StrictStructOptions);

const SessionJournalStoredRequestV1Schema = Schema.Union([
  SessionJournalGetRequestV1Schema,
  SessionJournalInsertRequestV1Schema,
  SessionJournalPatchRequestV1Schema,
  SessionJournalReplaceRequestV1Schema,
  SessionJournalDeleteRequestV1Schema,
]);
type SessionJournalStoredRequestV1 =
  typeof SessionJournalStoredRequestV1Schema.Type;

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
  ]),
  observed: Schema.Int,
  maximum: Schema.Int,
}).annotate(StrictStructOptions);

const SessionJournalStoredOutcomeV1Schema = Schema.Union([
  SessionJournalMissingOutcomeV1Schema,
  SessionJournalPresentOutcomeV1Schema,
  SessionJournalInsertedOutcomeV1Schema,
  SessionJournalUnitOutcomeV1Schema,
  SessionJournalNotFoundOutcomeV1Schema,
  SessionJournalCollisionOutcomeV1Schema,
  SessionJournalInvalidDocumentOutcomeV1Schema,
  SessionJournalLimitOutcomeV1Schema,
]);
type SessionJournalStoredOutcomeV1 =
  typeof SessionJournalStoredOutcomeV1Schema.Type;

const encodeStoredRequest = Schema.encodeSync(
  SessionJournalStoredRequestV1Schema,
);
const decodeStoredRequestResult = Schema.decodeUnknownResult(
  SessionJournalStoredRequestV1Schema,
  { onExcessProperty: "error" },
);
const encodeStoredOutcome = Schema.encodeSync(
  SessionJournalStoredOutcomeV1Schema,
);
const decodeStoredOutcomeResult = Schema.decodeUnknownResult(
  SessionJournalStoredOutcomeV1Schema,
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
const encodeSessionJournal = Schema.encodeSync(SessionJournalV1Schema);
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

export function createSessionJournalStorePersistenceV1(
  ports: PointMutationSessionAuthorityResolutionPortsV1,
  options: SessionJournalStorePersistenceOptionsV1 = {},
): SessionJournalStorePersistenceV1 {
  const randomUuid = options.randomUuid ?? (() => crypto.randomUUID());
  const attemptStates = new WeakMap<object, SessionJournalAttemptStateV1>();
  const tableStates = new WeakMap<object, PinnedPointTableStateV1>();
  const sealStates = new WeakMap<
    object,
    PreparedSessionJournalSealStateV1
  >();

  const createAttemptHandle = (
    state: SessionJournalAttemptStateV1,
  ): SessionJournalAttemptV1 => {
    const handle = Object.freeze({
      [sessionJournalAttemptBrand]: true as const,
    });
    attemptStates.set(handle, state);
    return handle;
  };

  const openAttemptEffect: SessionJournalStorePersistenceV1[
    "openAttemptEffect"
  ] = Effect.fn("SessionJournalStore.openAttempt")(function* (input) {
    const state = yield* Effect.fromResult(captureAttemptStateResult(input));
    return createAttemptHandle(state);
  });

  const resolveJournalTargetEffect = Effect.fn(
    "SessionJournalStore.resolveJournalTarget",
  )(function* (attempt: SessionJournalAttemptStateV1): Effect.fn.Return<
    ResolvedJournalTargetV1,
    SessionJournalPersistenceV1Error | SessionJournalTargetUnavailableV1Error
  > {
    const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
      attempt.selector.deploymentId,
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

  const resolvePointTableEffect: SessionJournalStorePersistenceV1[
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
    const tableId = yield* Effect.tryPromise({
      try: () => resolved.target[RESOLVE_PINNED_POINT_TABLE_ID_V1]({
        deploymentId: attemptState.selector.deploymentId,
        schemaVersionId: attemptState.schemaVersionId,
        tableName,
      }),
      catch: mapPointTableResolutionFailure,
    });
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

  const runPointOperationEffect: SessionJournalStorePersistenceV1[
    "runPointOperationEffect"
  ] = Effect.fn("SessionJournalStore.runPointOperation")(function* (
    table,
    operation,
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
      },
      (tx, context) => runPointOperationInTransactionEffect(
        tx,
        context,
        tableState,
        request,
        requestEvidence,
        randomUuid,
      ),
    ).pipe(
      Effect.mapError((error) =>
        error instanceof ExactRunningAttemptTransactionV1Error
          ? mapExactRunningAttemptTransactionFailure(error)
          : error
      ),
    );
    return projectPointOperationResult(applied);
  });

  const prepareSealEffect: SessionJournalStorePersistenceV1[
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
    const resolved = yield* resolveJournalTargetEffect(attemptState);
    const snapshot = yield* Effect.uninterruptible(
      Effect.tryPromise({
        try: () => resolved.target[RUN_LOCATED_REPEATABLE_READ_V1](
          (tx) => captureSealRowsInRepeatableRead(
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

  const completeSealEffect: SessionJournalStorePersistenceV1[
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
        },
        (tx, context) => completeSealInTransactionEffect(
          tx,
          context,
          prepared,
          sealedEvidence,
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

  return Object.freeze({
    openAttemptEffect,
    resolvePointTableEffect,
    runPointOperationEffect,
    prepareSealEffect,
    completeSealEffect,
  });
}

function mapPointTableResolutionFailure(
  cause: unknown,
):
  | PinnedPointTableCorruptionV1Error
  | PinnedPointTableNotFoundV1Error
  | SessionJournalPersistenceV1Error {
  return cause instanceof PinnedPointTableCorruptionV1Error ||
      cause instanceof PinnedPointTableNotFoundV1Error
    ? cause
    : new SessionJournalPersistenceV1Error({
      operation: "resolvePinnedPointTable",
      cause,
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
  if (cause instanceof PointMutationSessionAttemptLoadV1Error) {
    return new SessionJournalAttemptUnavailableV1Error({
      issue: cause.issue,
    });
  }
  if (
    cause instanceof InvalidSessionJournalCapabilityV1Error ||
    cause instanceof SessionJournalAttemptUnavailableV1Error ||
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

function captureAttemptStateResult(
  input: OpenSessionJournalAttemptV1Input,
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
    return Object.freeze({
      selector,
      snapshotToken,
      schemaVersionId,
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
  SessionJournalStoredRequestV1,
  InvalidSessionJournalInputV1Error
> {
  return Result.try({
    try: () => {
      const syscallSequence = CommitSyscallSequenceV1Schema.make(
        operation.syscallSequence,
      );
      switch (operation.kind) {
        case "get": {
          const identity = requireAppDocumentIdentityV1ForTable(
            operation.documentId,
            table.tableId,
          );
          return Object.freeze({
            format: "flarex.session-journal-syscall",
            codecVersion: 1,
            kind: "get",
            syscallSequence,
            tableId: table.tableId,
            documentId: identity.id,
          });
        }
        case "insert":
          return Object.freeze({
            format: "flarex.session-journal-syscall",
            codecVersion: 1,
            kind: "insert",
            syscallSequence,
            tableId: table.tableId,
            fieldsValueJson: captureDeveloperFieldsValueJson(
              operation.fields,
            ),
          });
        case "patch": {
          const identity = requireAppDocumentIdentityV1ForTable(
            operation.documentId,
            table.tableId,
          );
          return Object.freeze({
            format: "flarex.session-journal-syscall",
            codecVersion: 1,
            kind: "patch",
            syscallSequence,
            tableId: table.tableId,
            documentId: identity.id,
            changes: capturePatchChanges(operation.patch),
          });
        }
        case "replace": {
          const identity = requireAppDocumentIdentityV1ForTable(
            operation.documentId,
            table.tableId,
          );
          return Object.freeze({
            format: "flarex.session-journal-syscall",
            codecVersion: 1,
            kind: "replace",
            syscallSequence,
            tableId: table.tableId,
            documentId: identity.id,
            fieldsValueJson: captureDeveloperFieldsValueJson(
              operation.fields,
            ),
          });
        }
        case "delete": {
          const identity = requireAppDocumentIdentityV1ForTable(
            operation.documentId,
            table.tableId,
          );
          return Object.freeze({
            format: "flarex.session-journal-syscall",
            codecVersion: 1,
            kind: "delete",
            syscallSequence,
            tableId: table.tableId,
            documentId: identity.id,
          });
        }
      }
    },
    catch: (cause) => new InvalidSessionJournalInputV1Error({
      operation: operation.kind,
      reason: "invalidOperation",
      cause,
    }),
  });
}

function captureDeveloperFieldsValueJson(input: unknown): JsonObject {
  const normalized = normalizeFlarexValueV1(input, "appDocument");
  if (!isCanonicalFlarexRuntimeObjectV1(normalized.value)) {
    throw new Error("App-document normalization returned a non-object.");
  }
  for (const field of ["_id", "_creationTime"] as const) {
    if (Object.hasOwn(normalized.value, field)) {
      throw new Error(`Developer fields contain reserved field ${field}.`);
    }
  }
  if (!isJsonObject(normalized.valueJson)) {
    throw new Error("App-document JSON normalization returned a non-object.");
  }
  return cloneJsonObject(normalized.valueJson);
}

function capturePatchChanges(input: unknown): ReadonlyArray<LogicalPatchFieldV1> {
  if (!isPlainObject(input)) {
    throw new Error("Patch must be a plain object.");
  }
  if (Object.getOwnPropertySymbols(input).length > 0) {
    throw new Error("Patch cannot contain symbol fields.");
  }
  const fields = Object.keys(input).sort(compareUtf16Strings);
  if (fields.length > MAX_FLAREX_VALUE_OBJECT_FIELDS_V1) {
    throw new Error(
      `Patch exceeds the ${MAX_FLAREX_VALUE_OBJECT_FIELDS_V1}-field limit.`,
    );
  }
  const changes: LogicalPatchFieldV1[] = [];
  for (const field of fields) {
    if (field === "_id" || field === "_creationTime") {
      throw new Error(`Patch cannot modify reserved field ${field}.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, field);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !("value" in descriptor)
    ) {
      throw new Error(`Patch field ${field} must be an enumerable data field.`);
    }
    if (descriptor.value === undefined) {
      normalizeFlarexValueV1({ [field]: null }, "appDocument");
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
    const normalized = normalizeFlarexValueV1(fieldContainer);
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
}

const canonicalizeStoredRequestEffect = Effect.fn(
  "SessionJournalStore.canonicalizeStoredRequest",
)(function* (
  request: SessionJournalStoredRequestV1,
): Effect.fn.Return<
  CanonicalFlarexValueV1,
  SessionJournalPersistenceV1Error
> {
  const encoded = encodeStoredRequest(request);
  const json = requireJson(encoded);
  return yield* Effect.tryPromise({
    try: () => canonicalizeFlarexValueJsonV1(json),
    catch: (cause) => new SessionJournalPersistenceV1Error({
      operation: "canonicalizePointRequest",
      cause,
    }),
  });
});

function mapRunPointOperationFailure(
  cause: unknown,
): SessionJournalRunPointOperationV1Error {
  if (
    cause instanceof PointMutationSessionAttemptLoadV1Error
  ) {
    return new SessionJournalAttemptUnavailableV1Error({
      issue: cause.issue,
    });
  }
  if (
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

async function canonicalizeStoredOutcome(
  outcome: SessionJournalStoredOutcomeV1,
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
  const evidence = yield* Effect.promise(() =>
    canonicalizeFlarexValueJsonV1(encoded)
  );
  if (!isJsonObject(evidence.valueJson)) {
    return yield* Effect.die(
      new Error("Canonical logical write evidence returned a non-object."),
    );
  }
  const eventJson = cloneJsonObject(evidence.valueJson);
  const strictWrite = yield* Effect.fromResult(
    decodeLogicalAppWriteResult(structuredClone(eventJson)).pipe(
      Result.mapError(mapRunPointOperationFailure),
    ),
  );
  return Object.freeze({
    write: strictWrite,
    eventJson,
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
      readonly outcome: SessionJournalStoredOutcomeV1;
    }>
  | Readonly<{
      readonly kind: "sequenceRejected";
      readonly issue: SessionJournalSequenceIssueV1;
    }>
  | Readonly<{
      readonly kind: "stateRejected";
      readonly reason: "journalSealed" | "journalFailed";
    }>;

interface SessionJournalCountersV1 {
  readonly readDocuments: number;
  readonly readSemanticBytes: number;
  readonly pointDependencyCount: number;
  readonly writeOperations: number;
  readonly writeSemanticBytes: number;
  readonly materialWriteEventEvidenceBytes: number;
}

interface SessionJournalCounterDeltasV1 {
  readonly readDocuments: number;
  readonly readSemanticBytes: number;
  readonly pointDependencyCount: number;
  readonly writeOperations: number;
  readonly writeSemanticBytes: number;
  readonly materialWriteEventEvidenceBytes: number;
}

const ZERO_COUNTER_DELTAS = Object.freeze({
  readDocuments: 0,
  readSemanticBytes: 0,
  pointDependencyCount: 0,
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
  readonly outcome: SessionJournalStoredOutcomeV1;
  readonly counters: SessionJournalCounterDeltasV1;
  readonly pointMutation?: JournalPointMutationV1;
  readonly write?: LogicalAppWriteV1;
  readonly nextCreationTime?: AppCreationTimeV1;
}

interface PreparedLogicalWriteEventV1 {
  readonly write: LogicalAppWriteV1;
  readonly eventJson: JsonObject;
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
  request: SessionJournalStoredRequestV1,
  requestEvidence: CanonicalFlarexValueV1,
  randomUuid: () => string,
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
    return Object.freeze({
      kind: "sequenceRejected",
      issue: Object.freeze({
        reason: "staleSequence",
        actual,
        lastAccepted: last,
      }),
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

  const expectedNextValue = last + 1n;
  const expectedNextResult = decodeCommitSyscallSequenceResult(
    expectedNextValue,
  );
  if (Result.isFailure(expectedNextResult)) {
    return Object.freeze({
      kind: "sequenceRejected",
      issue: Object.freeze({
        reason: "sequenceExhausted",
        lastAccepted: last,
      }),
    });
  }
  const expectedNext = expectedNextResult.success;
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
  const counterDeltas = Object.freeze({
    ...plan.counters,
    materialWriteEventEvidenceBytes:
      preparedWriteEvent?.evidenceBytes ?? 0,
  } satisfies SessionJournalCounterDeltasV1);
  const limitIssue = firstExceededLimit(counters, counterDeltas);
  if (limitIssue !== undefined) {
    const outcome = Object.freeze({
      kind: "error",
      reason: "limitExceeded",
      ...limitIssue,
    } satisfies SessionJournalStoredOutcomeV1);
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

const planFreshPointOperationEffect = Effect.fn(
  "SessionJournalStore.planFreshPointOperation",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  table: PinnedPointTableStateV1,
  request: SessionJournalStoredRequestV1,
  randomUuid: () => string,
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
      );
    case "patch":
      return yield* planPatchEffect(tx, context, table, request);
    case "replace":
      return yield* planReplaceEffect(tx, context, table, request);
    case "delete":
      return yield* planDeleteEffect(tx, context, table, request);
  }
});

const planInsertEffect = Effect.fn(
  "SessionJournalStore.planInsert",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  table: PinnedPointTableStateV1,
  request: Extract<SessionJournalStoredRequestV1, { readonly kind: "insert" }>,
  randomUuid: () => string,
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
    context.journalRoot.nextCreationTime,
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
  const staged = yield* loadJournalPointRowEffect(
    tx,
    context,
    table.tableId,
    rowId,
  );
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
    nextCreationTime,
  });
});

const planPatchEffect = Effect.fn(
  "SessionJournalStore.planPatch",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  table: PinnedPointTableStateV1,
  request: Extract<SessionJournalStoredRequestV1, { readonly kind: "patch" }>,
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
  });
});

const planReplaceEffect = Effect.fn(
  "SessionJournalStore.planReplace",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  table: PinnedPointTableStateV1,
  request: Extract<SessionJournalStoredRequestV1, { readonly kind: "replace" }>,
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
  });
});

const planDeleteEffect = Effect.fn(
  "SessionJournalStore.planDelete",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  table: PinnedPointTableStateV1,
  request: Extract<SessionJournalStoredRequestV1, { readonly kind: "delete" }>,
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
): Effect.fn.Return<
  LogicalPointReadV1,
  SessionJournalRunPointOperationV1Error
> {
  const point = yield* loadJournalPointRowEffect(
    tx,
    context,
    table.tableId,
    rowId,
  );
  if (point === undefined) {
    const result = yield* fromPointOperationPromise(() =>
      getAppRowAtSnapshotInTransaction(tx, {
        snapshotToken: table.attempt.snapshotToken,
        tableId: table.tableId,
        rowId,
      })
    );
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
      const result = yield* fromPointOperationPromise(() =>
        getAppRowAtSnapshotInTransaction(tx, {
          snapshotToken: table.attempt.snapshotToken,
          tableId: table.tableId,
          rowId,
        })
      );
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
): Omit<
  Extract<
    SessionJournalPersistedPointIssueV1,
    { readonly reason: "limitExceeded" }
  >,
  "reason"
> | undefined {
  const candidates: ReadonlyArray<Readonly<{
    dimension: SessionJournalIncrementalLimitDimensionV1;
    observed: number;
    maximum: number;
  }>> = [
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

function decodeJournalCountersResult(
  attempt: SessionJournalAttemptStateV1,
  root: typeof fxSystemTransactionJournals.$inferSelect,
): Result.Result<
  SessionJournalCountersV1,
  SessionJournalStorageCorruptionV1Error
> {
  const counters = {
    readDocuments: root.readDocuments,
    readSemanticBytes: root.readSemanticBytes,
    pointDependencyCount: root.pointDependencyCount,
    writeOperations: root.writeOperations,
    writeSemanticBytes: root.writeSemanticBytes,
    materialWriteEventEvidenceBytes: root.materialWriteEventEvidenceBytes,
  };
  const limits: ReadonlyArray<readonly [number, number]> = [
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
  typeof fxSystemTransactionJournalLatestReceipts.$inferSelect | undefined
> {
  const rows = await tx
    .select()
    .from(fxSystemTransactionJournalLatestReceipts)
    .where(and(
      eq(
        fxSystemTransactionJournalLatestReceipts.scopeUuid,
        context.scopeUuid,
      ),
      eq(
        fxSystemTransactionJournalLatestReceipts.sessionId,
        context.anchor.sessionId,
      ),
      eq(
        fxSystemTransactionJournalLatestReceipts.attemptFence,
        context.anchor.attemptFence,
      ),
    ))
    .limit(2)
    .for("update");
  if (rows.length > 1) {
    throw new Error("Latest receipt primary key returned duplicate rows.");
  }
  return rows[0];
}

function validateReceiptCardinalityResult(
  attempt: SessionJournalAttemptStateV1,
  lastSequence: CommitFinalSyscallSequenceV1,
  receipt: typeof fxSystemTransactionJournalLatestReceipts.$inferSelect |
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
  sha256: unknown,
): Effect.Effect<
  CanonicalFlarexValueV1,
  SessionJournalStorageCorruptionV1Error
> =>
  Effect.tryPromise({
    try: () => decodeCanonicalFlarexValueEvidenceV1({
      canonicalBytes,
      sha256,
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

const decodeAndVerifyLatestReceiptEffect = Effect.fn(function* (
  attempt: SessionJournalAttemptStateV1,
  receipt: typeof fxSystemTransactionJournalLatestReceipts.$inferSelect,
  expectedRequest: SessionJournalStoredRequestV1 | undefined,
): Effect.fn.Return<
  SessionJournalStoredOutcomeV1,
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
    !requestOutcomeCorrelates(request, outcome)
  ) {
    return yield* Effect.fail(corruption(
      attempt,
      "latestReceiptEvidenceInvalid",
    ));
  }
  return outcome;
});

function storedRequestsEqual(
  left: SessionJournalStoredRequestV1,
  right: SessionJournalStoredRequestV1,
): boolean {
  const leftEncoded = requireJson(encodeStoredRequest(left));
  const rightEncoded = requireJson(encodeStoredRequest(right));
  return jsonEqual(leftEncoded, rightEncoded);
}

function requestOutcomeCorrelates(
  request: SessionJournalStoredRequestV1,
  outcome: SessionJournalStoredOutcomeV1,
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
  }
  return false;
}

function isLimitOutcome(
  outcome: SessionJournalStoredOutcomeV1,
): outcome is Extract<
  SessionJournalStoredOutcomeV1,
  { readonly kind: "error"; readonly reason: "limitExceeded" }
> {
  return outcome.kind === "error" && outcome.reason === "limitExceeded";
}

function validateReceiptOutcomeMatchesJournalRootResult(
  attempt: SessionJournalAttemptStateV1,
  root: typeof fxSystemTransactionJournals.$inferSelect,
  outcome: SessionJournalStoredOutcomeV1,
): Result.Result<void, SessionJournalStorageCorruptionV1Error> {
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
  if (isLimitOutcome(outcome)) {
    return Result.fail(corruption(
      attempt,
      "journalReceiptStateMismatch",
    ));
  }
  return Result.succeed(undefined);
}

interface PersistAcceptedOperationRootStateV1 {
  readonly state: "open" | "failed";
  readonly failureDimension: SessionJournalIncrementalLimitDimensionV1 | null;
  readonly nextCreationTime?: AppCreationTimeV1;
}

async function persistAcceptedOperation(
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  request: SessionJournalStoredRequestV1,
  requestEvidence: CanonicalFlarexValueV1,
  outcome: SessionJournalStoredOutcomeV1,
  current: SessionJournalCountersV1,
  deltas: SessionJournalCounterDeltasV1,
  state: PersistAcceptedOperationRootStateV1,
): Promise<void> {
  const outcomeEvidence = await canonicalizeStoredOutcome(outcome);
  await tx
    .delete(fxSystemTransactionJournalLatestReceipts)
    .where(and(
      eq(
        fxSystemTransactionJournalLatestReceipts.scopeUuid,
        context.scopeUuid,
      ),
      eq(
        fxSystemTransactionJournalLatestReceipts.sessionId,
        context.anchor.sessionId,
      ),
      eq(
        fxSystemTransactionJournalLatestReceipts.attemptFence,
        context.anchor.attemptFence,
      ),
    ));
  await tx.insert(fxSystemTransactionJournalLatestReceipts).values({
    scopeUuid: context.scopeUuid,
    sessionId: context.anchor.sessionId,
    attemptFence: context.anchor.attemptFence,
    lastSyscallSequence: request.syscallSequence,
    operationKind: request.kind,
    requestCodecVersion: 1,
    requestBytes: new Uint8Array(requestEvidence.canonicalBytes),
    requestSha256: new Uint8Array(requestEvidence.sha256),
    outcomeKind: outcome.kind,
    outcomeCodecVersion: 1,
    outcomeBytes: new Uint8Array(outcomeEvidence.canonicalBytes),
    outcomeSha256: new Uint8Array(outcomeEvidence.sha256),
    createdAt: context.databaseNow,
    updatedAt: context.databaseNow,
  });
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
      writeOperations: current.writeOperations + deltas.writeOperations,
      writeSemanticBytes:
        current.writeSemanticBytes + deltas.writeSemanticBytes,
      materialWriteEventEvidenceBytes:
        CommitMaterialWriteEventEvidenceBytesV1Schema.make(
          current.materialWriteEventEvidenceBytes +
          deltas.materialWriteEventEvidenceBytes,
        ),
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
      eq(fxSystemTransactionJournals.state, "open"),
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
    eventCodecVersion: 1,
    eventJson: cloneJsonObject(event.eventJson),
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

function issueFromStoredOutcome(
  outcome: Extract<SessionJournalStoredOutcomeV1, { readonly kind: "error" }>,
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
  outcome: Exclude<SessionJournalStoredOutcomeV1, { readonly kind: "error" }>,
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
  readonly journal: SessionJournalV1;
}

interface ValidatedCanonicalSealEvidenceV1 {
  readonly finalSyscallSequence: CommitFinalSyscallSequenceV1;
  readonly journalBytes: Uint8Array;
  readonly journalSha256: Uint8Array;
  readonly journalSha256Hex: CanonicalSessionJournalV1["sha256Hex"];
  readonly resultValueCodecVersion: typeof FLAREX_VALUE_CODEC_VERSION_V1;
  readonly resultSemanticBytes: number;
  readonly resultBytes: Uint8Array;
  readonly resultSha256: Uint8Array;
  readonly successfulResult: CanonicalSuccessfulResultV1["evidence"];
}

interface SessionJournalSealRowsV1 {
  readonly root: typeof fxSystemTransactionJournals.$inferSelect;
  readonly receipt?:
    typeof fxSystemTransactionJournalLatestReceipts.$inferSelect;
  readonly points: ReadonlyArray<
    typeof fxSystemTransactionJournalPoints.$inferSelect
  >;
  readonly events: ReadonlyArray<
    typeof fxSystemTransactionJournalWriteEvents.$inferSelect
  >;
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

async function captureSealRowsInRepeatableRead(
  tx: AppRowTransaction,
  attempt: SessionJournalAttemptStateV1,
  preliminaryAuthority: TrustedScopeAuthority,
): Promise<SessionJournalSealRowsV1> {
  const authority = await requireRepeatableReadAttemptAuthority(
    tx,
    attempt,
    preliminaryAuthority,
  );
  const receipt = await loadLatestReceiptReadOnly(tx, authority);
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
    .orderBy(asc(fxSystemTransactionJournalWriteEvents.syscallSequence))
    .limit(MAX_COMMIT_WRITE_OPERATIONS_V1 + 1);
  return Object.freeze({
    root: structuredClone(authority.root),
    ...(receipt === undefined ? {} : { receipt: structuredClone(receipt) }),
    points: Object.freeze(structuredClone(points)),
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
  if (root.state === "failed") {
    return yield* Effect.fail(
      new SessionJournalSealV1Error({ reason: "journalFailed" }),
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
  const counters = yield* Effect.fromResult(
    decodeJournalCountersResult(attempt, root),
  );
  const lastSyscallSequence = CommitFinalSyscallSequenceV1Schema.make(
    root.lastSyscallSequence,
  );
  const receipt = snapshot.receipt;
  yield* Effect.fromResult(validateReceiptCardinalityResult(
    attempt,
    lastSyscallSequence,
    receipt,
  ));
  if (receipt !== undefined) {
    const outcome = yield* decodeAndVerifyLatestReceiptEffect(
      attempt,
      receipt,
      undefined,
    );
    yield* Effect.fromResult(validateReceiptOutcomeMatchesJournalRootResult(
      attempt,
      root,
      outcome,
    ));
  }

  const pointRows = snapshot.points;
  if (pointRows.length !== counters.pointDependencyCount) {
    return yield* Effect.fail(corruption(
      attempt,
      "pointDependencyCountMismatch",
    ));
  }
  const dependencies: LogicalReadDependencyV1[] = [];
  for (const point of pointRows) {
    const dependency = yield* Effect.fromResult(
      decodePointDependencyResult(attempt, point),
    );
    yield* verifyPointOverlayEvidenceEffect(attempt, point);
    dependencies.push(logicalDependencyFromPoint(dependency));
  }
  dependencies.sort((left, right) =>
    compareUtf16Strings(left.documentId, right.documentId));

  const eventRows = snapshot.events;
  if (eventRows.length !== counters.writeOperations) {
    return yield* Effect.fail(corruption(
      attempt,
      "writeOperationCountMismatch",
    ));
  }
  const writes: LogicalAppWriteV1[] = [];
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
    const write = yield* decodeAndVerifyLogicalWriteEventEffect(
      attempt,
      event,
    );
    if (write.syscallSequence > lastSyscallSequence) {
      return yield* Effect.fail(corruption(
        attempt,
        "writeSequenceBeyondJournalFinalSequence",
      ));
    }
    computedWriteSemanticBytes += write.kind === "delete"
      ? 0
      : write.resultingDocumentSemanticBytes;
    writes.push(write);
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

  const journal = Object.freeze(SessionJournalV1Schema.make({
    format: SESSION_JOURNAL_FORMAT_V1,
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
    hardExpiresAtMilliseconds !== authorizationGrantExpiresAtMilliseconds
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

async function loadLatestReceiptReadOnly(
  tx: AppRowTransaction,
  authority: RepeatableReadAttemptAuthorityV1,
): Promise<
  typeof fxSystemTransactionJournalLatestReceipts.$inferSelect | undefined
> {
  const rows = await tx
    .select()
    .from(fxSystemTransactionJournalLatestReceipts)
    .where(and(
      eq(
        fxSystemTransactionJournalLatestReceipts.scopeUuid,
        authority.scopeUuid,
      ),
      eq(
        fxSystemTransactionJournalLatestReceipts.sessionId,
        authority.root.sessionId,
      ),
      eq(
        fxSystemTransactionJournalLatestReceipts.attemptFence,
        authority.root.attemptFence,
      ),
    ))
    .limit(2);
  if (rows.length > 1) {
    throw new Error("Latest receipt primary key returned duplicate rows.");
  }
  return rows[0];
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
): LogicalReadDependencyV1 {
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
  const encoded = requireJson(encodeLogicalAppWrite(write));
  if (
    write.kind !== event.writeKind ||
    write.syscallSequence !== event.syscallSequence ||
    !jsonEqual(encoded, event.eventJson)
  ) {
    return yield* Effect.fail(corruption(
      attempt,
      "logicalWriteEventInvalid",
    ));
  }
  return write;
});

interface CanonicalSealInputsSnapshotV1 {
  readonly journal: SessionJournalV1;
  readonly journalCanonicalText: string;
  readonly journalBytes: Uint8Array;
  readonly journalSha256Hex: CanonicalSessionJournalV1["sha256Hex"];
  readonly resultValueJson: Json;
  readonly resultSemanticBytes: number;
  readonly resultCanonicalText: string;
  readonly resultBytes: Uint8Array;
  readonly resultEvidence: unknown;
}

function captureCanonicalSealInputsResult(
  journal: CanonicalSessionJournalV1,
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
  journal: CanonicalSessionJournalV1,
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
  const suppliedJournalJson = yield* Effect.fromResult(
    sealInputValidationResult("canonicalJournalMismatch", () =>
      requireJson(encodeSessionJournal(supplied.journal))),
  );
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
    sealInputValidationResult("canonicalResultMismatch", () =>
      normalizeFlarexValueJsonV1(supplied.resultValueJson)),
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

function sealInputValidationResult<A>(
  reason: "canonicalJournalMismatch" | "canonicalResultMismatch",
  validate: () => A,
): Result.Result<A, SessionJournalSealV1Error> {
  return Result.try({
    try: validate,
    catch: () => sealMismatch(reason),
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
  if (root.state === "failed") {
    return yield* Effect.fail(
      new SessionJournalSealV1Error({ reason: "journalFailed" }),
    );
  }
  if (root.state === "sealed") {
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
    try: () => tx
      .update(fxSystemTransactionJournals)
      .set({
        state: "sealed",
        failureDimension: null,
        sealedFinalSyscallSequence: evidence.finalSyscallSequence,
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
      .returning({ state: fxSystemTransactionJournals.state }),
    catch: mapCompleteSealTransactionFailure,
  });
  if (updated.length !== 1 || updated[0]?.state !== "sealed") {
    return yield* Effect.fail(
      new SessionJournalSealV1Error({ reason: "stalePreparation" }),
    );
  }
  return storedSealEnvelope(context, evidence);
});

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
    root.sealedFinalSyscallSequence !== evidence.finalSyscallSequence ||
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
