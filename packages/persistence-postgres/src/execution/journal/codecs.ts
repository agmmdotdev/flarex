import { SessionJournalPersistenceV1Error } from "./errors";
import { observeExecution } from "../diagnostics/operation";
import { Effect, Option, Result, Schema } from "effect";
import { EventEnvelope } from "../../commit/events/model";
import {
  AppDocumentIdV1Schema,
  AppRowIdHexV1Schema,
} from "flarex-protocol/app-document-id";
import {
  CatalogEdgeDefinitionIdSchema,
  CatalogIndexDefinitionIdSchema,
  CatalogIndexIdSchema,
  CatalogRelationIdSchema,
  CatalogTableIdSchema,
} from "flarex-protocol/catalog";
import {
  AppDocumentFieldsJsonV1Schema,
  CommitFinalSyscallSequenceV1Schema,
  CommitSyscallSequenceV1Schema,
  LogicalAppWriteV1Schema,
  LogicalPatchFieldV1Schema,
  MAX_COMMIT_OPERATION_CALLS_V1,
  SessionJournalSchema,
  LogicalIndexRangeReadDependencyV1Schema,
  LogicalApplicationRelationIncomingReadDependencyV1Schema,
  AdmittedSourceBindingSchema,
} from "flarex-protocol/commit-protocol";
import type {
  CommitFinalSyscallSequenceV1,
  CommitSyscallSequenceV1,
} from "flarex-protocol/commit-protocol";
import { OrderedIndexBoundHexV1Schema } from "flarex-protocol/ordered-index";
import { isJson, JsonValue } from "flarex-protocol/json";
import type { Json } from "flarex-protocol/json";
import {
  CatalogSchemaVersionIdSchema,
  SchemaManifestAppTableNameSchema,
} from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  SnapshotTokenSchema,
} from "flarex-protocol/storage-authority";
import {
  TransactionAttemptFenceSchema,
  TransactionSessionIdV1Schema,
} from "flarex-protocol/transaction-session";
import { canonicalizeFlarexValueJsonV1Effect } from "flarex-protocol/value";
import type { CanonicalFlarexValueV1 } from "flarex-protocol/value";
import {
  decodeTransactionExecutionClaimFenceV1,
  decodeTransactionExecutionClaimOwnerV1,
} from "../claims/transactionExecutionClaimModel";

const StrictStructOptions = {
  parseOptions: { onExcessProperty: "error" },
} as const;

export const TEXT_ENCODER = new TextEncoder();

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
  sources: Schema.Array(AdmittedSourceBindingSchema).check(
    Schema.isMaxLength(3),
  ),
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

export type SessionJournalStoredRequest =
  typeof SessionJournalStoredRequestSchema.Type;

export type SessionJournalStoredPointRequest = Exclude<
  SessionJournalStoredRequest,
  {
    readonly kind:
      "indexRange" | "relationIncoming" | "admittedLogicalOperation";
  }
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
  items: Schema.Array(
    Schema.Struct({
      sourceDocumentId: AppDocumentIdV1Schema,
      duplicateOrdinal: Schema.Literal(0),
      position: Schema.NullOr(
        Schema.Int.check(
          Schema.isBetween({
            minimum: 0,
            maximum: Number.MAX_SAFE_INTEGER,
          }),
        ),
      ),
    }).annotate(StrictStructOptions),
  ),
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
  events: Schema.Array(
    Schema.Struct({
      sourceKey: Schema.NullOr(Schema.NonEmptyString),
      intent: JsonValue,
    }).annotate(StrictStructOptions),
  ),
  sourceDependencies: Schema.Array(
    Schema.Struct({
      sourceKey: Schema.NonEmptyString,
      evidence: Schema.Record(Schema.String, JsonValue),
    }).annotate(StrictStructOptions),
  ),
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

export type SessionJournalStoredOutcome =
  typeof SessionJournalStoredOutcomeSchema.Type;

export const encodeStoredRequest = Schema.encodeSync(
  SessionJournalStoredRequestSchema,
);

export const decodeStoredRequestResult = Schema.decodeUnknownResult(
  SessionJournalStoredRequestSchema,
  { onExcessProperty: "error" },
);

const encodeStoredOutcome = Schema.encodeSync(
  SessionJournalStoredOutcomeSchema,
);

export const decodeStoredOutcomeResult = Schema.decodeUnknownResult(
  SessionJournalStoredOutcomeSchema,
  { onExcessProperty: "error" },
);

export const strictEventEnvelope = Schema.decodeUnknownResult(EventEnvelope, {
  onExcessProperty: "error",
});

export const encodeIndexRangeDependency = Schema.encodeSync(
  LogicalIndexRangeReadDependencyV1Schema,
);

export const decodeIndexRangeDependencyResult = Schema.decodeUnknownResult(
  LogicalIndexRangeReadDependencyV1Schema,
  { onExcessProperty: "error" },
);

export const decodeRelationIncomingDependencyResult =
  Schema.decodeUnknownResult(
    Schema.toType(LogicalApplicationRelationIncomingReadDependencyV1Schema),
    { onExcessProperty: "error" },
  );

export const encodeLogicalAppWrite = Schema.encodeSync(LogicalAppWriteV1Schema);

export const decodeLogicalAppWriteResult = Schema.decodeUnknownResult(
  LogicalAppWriteV1Schema,
  { onExcessProperty: "error" },
);

export const decodeCommitFinalSyscallSequenceResult =
  Schema.decodeUnknownResult(Schema.toType(CommitFinalSyscallSequenceV1Schema));

export const decodeCommitSyscallSequenceResult = Schema.decodeUnknownResult(
  Schema.toType(CommitSyscallSequenceV1Schema),
);

export function nextCommitSyscallSequence(
  last: CommitFinalSyscallSequenceV1,
): Option.Option<CommitSyscallSequenceV1> {
  if (last >= BigInt(MAX_COMMIT_OPERATION_CALLS_V1)) return Option.none();
  return decodeCommitSyscallSequenceResult(last + 1n).pipe(
    Result.match({
      onFailure: () => Option.none(),
      onSuccess: Option.some,
    }),
  );
}

export const encodeSessionJournal = Schema.encodeSync(SessionJournalSchema);

export const encodeSessionJournalResult =
  Schema.encodeResult(SessionJournalSchema);

export const decodeSchemaManifestAppTableNameEffect =
  Schema.decodeUnknownEffect(SchemaManifestAppTableNameSchema);

export const decodeTransactionSessionIdResult = Schema.decodeUnknownResult(
  Schema.toType(TransactionSessionIdV1Schema),
);

export const decodeTransactionAttemptFenceResult = Schema.decodeUnknownResult(
  Schema.toType(TransactionAttemptFenceSchema),
);

export const decodeSnapshotTokenResult = Schema.decodeUnknownResult(
  Schema.toType(SnapshotTokenSchema),
);

export const decodeCatalogSchemaVersionIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogSchemaVersionIdSchema),
);

export const decodeOrderedIndexBoundHexV1Result = Schema.decodeUnknownResult(
  Schema.toType(OrderedIndexBoundHexV1Schema),
);

export const decodeExecutionClaimOwnerResult =
  decodeTransactionExecutionClaimOwnerV1;

export const decodeExecutionClaimFenceResult =
  decodeTransactionExecutionClaimFenceV1;

export const canonicalizeStoredRequestEffect = Effect.fnUntraced(
  function* (
    request: SessionJournalStoredRequest,
  ): Effect.fn.Return<
    CanonicalFlarexValueV1,
    SessionJournalPersistenceV1Error
  > {
    const encoded = encodeStoredRequest(request);
    const json = requireJson(encoded);
    return yield* canonicalizeFlarexValueJsonV1Effect(json).pipe(
      Effect.mapError(
        (cause) =>
          new SessionJournalPersistenceV1Error({
            operation: "canonicalizeRequest",
            cause,
          }),
      ),
    );
  },
  (work) =>
    observeExecution("SessionJournalStore.canonicalizeStoredRequest", work),
);

export const canonicalizeStoredOutcomeEffect = Effect.fnUntraced(function* (
  outcome: SessionJournalStoredOutcome,
) {
  const encoded = encodeStoredOutcome(outcome);
  return yield* canonicalizeFlarexValueJsonV1Effect(requireJson(encoded));
});

export function requireJson(input: unknown): Json {
  // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: invariant - Schema encoders own receipt/dependency values; non-JSON encoder output is a defect.
  if (!isJson(input)) throw new Error("Schema encoder returned non-JSON data.");
  return input;
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(bytes);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", copy.buffer));
}
