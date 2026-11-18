import {
  bytesEqual,
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { isNonArrayRecord as isRecord } from "@flarex/utils/records";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { Data, Effect, Encoding, Result, Schema } from "effect";

import { AppCreationTimeV1Schema } from "./app-document";
import {
  AppDocumentIdV1Schema,
  AppRowIdHexV1Schema,
  decodeAppDocumentIdentityV1Result,
  type AppDocumentIdV1,
  type AppRowIdHexV1,
} from "./app-document-id";
import {
  CatalogEdgeDefinitionIdSchema,
  CatalogIndexDefinitionIdSchema,
  CatalogTableIdSchema,
  type CatalogTableId,
  type CatalogEdgeDefinitionId,
  type CatalogIndexDefinitionId,
} from "./catalog";
import { AppIndexPhysicalSpecSha256HexV1Schema } from "./index-definition";
import {
  OrderedIndexBoundHexV1Schema,
  OrderedIndexKeyBytesHexV1Schema,
  OrderedIndexKeyCodecVersionSchema,
  OrderedIndexRowIdHexV1Schema,
} from "./ordered-index";
import { freezeOwnedProtocolProjection } from "./owned-protocol-projection";
import {
  encodeCanonicalJson,
  isJsonObject,
  jsonEqual,
  JsonValue,
  type CanonicalJsonEncodingInvariantIssue,
  type Json,
  type JsonObject,
} from "./json";
import {
  UnpaddedBase64UrlTextSchema,
  canonicalBase64UrlEncodedLength,
  decodeCanonicalBase64Url,
  type CanonicalBase64UrlDecodeIssue,
} from "./canonical-base64url";
import {
  CanonicalNonNegativePostgresBigIntFromString,
  CanonicalPositivePostgresBigIntFromString,
} from "./postgres-bigint";
import { CommitSeqSchema, ScopeIdSchema } from "./storage-authority";
import { CatalogSchemaVersionIdSchema } from "./schema-manifest";
import {
  StrictParseOptions,
  StrictStructOptions,
} from "./strict-schema-options";
import {
  TransactionAttemptFenceSchema,
  TransactionSessionIdV1Schema,
  TransactionSessionProtocolVersionV1Schema,
} from "./transaction-session";
import {
  FLAREX_VALUE_CODEC_VERSION_V1,
  FlarexValueEnvelopeV1Schema,
  FlarexValueCodecV1Error,
  FlarexValueCodecVersionSchema,
  MAX_FLAREX_APP_DOCUMENT_SEMANTIC_BYTES_V1,
  MAX_FLAREX_VALUE_ARRAY_ITEMS_V1,
  MAX_FLAREX_VALUE_NESTING_V1,
  MAX_FLAREX_VALUE_OBJECT_FIELD_BYTES_V1,
  MAX_FLAREX_VALUE_OBJECT_FIELDS_V1,
  canonicalizeFlarexValueJsonV1,
  canonicalizeFlarexValueV1,
  normalizeFlarexValueJsonV1,
  type CanonicalFlarexRuntimeValueV1,
  type CanonicalFlarexValueV1,
  type FlarexValueProfileV1,
  type NormalizedFlarexValueV1,
} from "./value";
import { createOwnedCanonicalFlarexRuntimeValueReaderV1 } from "./value-runtime-core";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });
const LOWERCASE_SHA256_PATTERN = /^[0-9a-f]{64}$/;

export const SESSION_JOURNAL_FORMAT = "flarex.session-journal";
export const COMMIT_ENVELOPE_FORMAT_V1 = "flarex.commit-envelope";

import {
  MAX_COMMIT_READ_DOCUMENTS_V1,
  MAX_COMMIT_READ_SEMANTIC_BYTES_V1,
  MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
  MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1,
  MAX_COMMIT_INDEX_RANGE_DEPENDENCY_EVIDENCE_BYTES_V1,
  MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1,
  MAX_COMMIT_WRITE_OPERATIONS_V1,
  MAX_COMMIT_WRITE_SEMANTIC_BYTES_V1,
  MAX_COMMIT_RESULT_SEMANTIC_BYTES_V1,
  MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1,
  MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1,
  MAX_COMMIT_RECEIPT_EVIDENCE_BYTES_V1,
  MAX_COMMIT_PARTICIPANT_WORK_BYTES_V1,
  MAX_COMMIT_PARTICIPANT_WORK_CALLS_V1,
} from "./commit-limits";
export * from "./commit-limits";

const MAX_COMMIT_CANONICAL_EVIDENCE_BASE64URL_CHARACTERS_V1 =
  canonicalBase64UrlEncodedLength(MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1);
const MAX_COMMIT_CANDIDATE_ARRAY_ITEMS_V1 = Math.max(
  MAX_COMMIT_WRITE_OPERATIONS_V1,
  MAX_FLAREX_VALUE_ARRAY_ITEMS_V1,
);
const MAX_COMMIT_CANDIDATE_NESTING_V1 = MAX_FLAREX_VALUE_NESTING_V1 + 8;
const MIN_SIGNED_INT64 = -(1n << 63n);
const MAX_SIGNED_INT64 = (1n << 63n) - 1n;

const NonNegativeSafeIntegerSchema = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
);

const PositiveSafeIntegerSchema = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
);

export const CommitSyscallSequenceV1Schema =
  CanonicalPositivePostgresBigIntFromString.pipe(
    Schema.brand("FlarexDB/CommitSyscallSequenceV1"),
  );
export type CommitSyscallSequenceV1 =
  typeof CommitSyscallSequenceV1Schema.Type;

export const CommitFinalSyscallSequenceV1Schema =
  CanonicalNonNegativePostgresBigIntFromString.pipe(
    Schema.brand("FlarexDB/CommitFinalSyscallSequenceV1"),
  );
export type CommitFinalSyscallSequenceV1 =
  typeof CommitFinalSyscallSequenceV1Schema.Type;

export const ApplicationActivationSequenceV1Schema =
  CanonicalPositivePostgresBigIntFromString.pipe(
    Schema.brand("FlarexDB/ApplicationActivationSequenceV1"),
  );
export type ApplicationActivationSequenceV1 =
  typeof ApplicationActivationSequenceV1Schema.Type;

/** Metadata activation order is independent of application-data commit order. */
export const MetadataSequenceSchema = CanonicalNonNegativePostgresBigIntFromString.pipe(
  Schema.brand("FlarexDB/MetadataSequence"),
);
export type MetadataSequence = typeof MetadataSequenceSchema.Type;

export const LogicalMetadataKeySchema = Schema.Struct({
  namespace: Schema.Literals(["application", "binding", "execution"]),
  ownerKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  contractKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
}).annotate(StrictStructOptions);
export type LogicalMetadataKey = typeof LogicalMetadataKeySchema.Type;

export const LogicalMetadataReadDependencySchema = Schema.Struct({
  kind: Schema.Literal("metadata"),
  ...LogicalMetadataKeySchema.fields,
  capturedWatermark: MetadataSequenceSchema,
  observed: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("present"),
      semanticSha256Hex: Schema.String.check(Schema.isPattern(LOWERCASE_SHA256_PATTERN)),
    }).annotate(StrictStructOptions),
    Schema.Struct({ kind: Schema.Literal("missing") }).annotate(StrictStructOptions),
  ]),
}).annotate(StrictStructOptions);
export type LogicalMetadataReadDependency = typeof LogicalMetadataReadDependencySchema.Type;
export const FiniteMetadataConflictSchema = Schema.Struct({ kind: Schema.Literal("metadata"),
  ...LogicalMetadataKeySchema.fields, capturedMetadataWatermark: MetadataSequenceSchema,
  lastChangedMetadataSequence: MetadataSequenceSchema,
}).check(Schema.makeFilter(value =>
  value.lastChangedMetadataSequence > value.capturedMetadataWatermark ? undefined : "Expected a changed metadata sequence"))
  .annotate(StrictStructOptions);
export type FiniteMetadataConflict = typeof FiniteMetadataConflictSchema.Type;
export const MAX_COMMIT_METADATA_READ_DEPENDENCIES = 4096;
export const logicalMetadataDependencyIdentity = (key: LogicalMetadataKey): string =>
  JSON.stringify([key.namespace, key.ownerKey, key.contractKey]);

export const ApplicationActiveHeadSha256HexV1Schema = Schema.String.check(
  Schema.isPattern(LOWERCASE_SHA256_PATTERN),
).pipe(Schema.brand("FlarexDB/ApplicationActiveHeadSha256HexV1"));
export type ApplicationActiveHeadSha256HexV1 =
  typeof ApplicationActiveHeadSha256HexV1Schema.Type;

export const CommitReadDocumentsV1Schema = NonNegativeSafeIntegerSchema.pipe(
  Schema.brand("FlarexDB/CommitReadDocumentsV1"),
);
export type CommitReadDocumentsV1 =
  typeof CommitReadDocumentsV1Schema.Type;

export const CommitReadSemanticBytesV1Schema =
  NonNegativeSafeIntegerSchema.pipe(
    Schema.brand("FlarexDB/CommitReadSemanticBytesV1"),
  );
export type CommitReadSemanticBytesV1 =
  typeof CommitReadSemanticBytesV1Schema.Type;

export const CommitMaterialWriteEventEvidenceBytesV1Schema =
  NonNegativeSafeIntegerSchema.check(Schema.isBetween({
    minimum: 0,
    maximum: MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1,
  })).pipe(Schema.brand("FlarexDB/CommitMaterialWriteEventEvidenceBytesV1"));
export type CommitMaterialWriteEventEvidenceBytesV1 =
  typeof CommitMaterialWriteEventEvidenceBytesV1Schema.Type;

export const CommitDocumentSemanticBytesV1Schema =
  PositiveSafeIntegerSchema.pipe(
    Schema.brand("FlarexDB/CommitDocumentSemanticBytesV1"),
  );
export type CommitDocumentSemanticBytesV1 =
  typeof CommitDocumentSemanticBytesV1Schema.Type;

const PresentReadObservationV1Schema = Schema.Struct({
  kind: Schema.Literal("present"),
  revisionCommitSeq: CommitSeqSchema,
}).annotate(StrictStructOptions);

const NoVisibleRevisionV1Schema = Schema.Struct({
  kind: Schema.Literal("noVisibleRevision"),
}).annotate(StrictStructOptions);

const TombstoneRevisionV1Schema = Schema.Struct({
  kind: Schema.Literal("tombstone"),
  revisionCommitSeq: CommitSeqSchema,
}).annotate(StrictStructOptions);

const MissingReadObservationV1Schema = Schema.Struct({
  kind: Schema.Literal("missing"),
  basis: Schema.Union([
    NoVisibleRevisionV1Schema,
    TombstoneRevisionV1Schema,
  ]),
}).annotate(StrictStructOptions);

const LogicalPointReadDependencyV1Schema = Schema.Struct({
  kind: Schema.Literal("appRowPoint"),
  documentId: AppDocumentIdV1Schema,
  observed: Schema.Union([
    PresentReadObservationV1Schema,
    MissingReadObservationV1Schema,
  ]),
}).annotate(StrictStructOptions);

const LogicalIndexRangeLowerBoundV1Schema = Schema.Struct({
  kind: Schema.Literal("key"),
  encodedKey: OrderedIndexBoundHexV1Schema,
  inclusive: Schema.Literal(true),
}).annotate(StrictStructOptions);

const LogicalIndexRangeUpperKeyBoundV1Schema = Schema.Struct({
  kind: Schema.Literal("key"),
  encodedKey: OrderedIndexBoundHexV1Schema,
  inclusive: Schema.Literal(false),
}).annotate(StrictStructOptions);

const LogicalIndexRangeUpperPositionBoundV1Schema = Schema.Struct({
  kind: Schema.Literal("position"),
  encodedKey: OrderedIndexKeyBytesHexV1Schema,
  rowId: OrderedIndexRowIdHexV1Schema,
  inclusive: Schema.Literal(true),
}).annotate(StrictStructOptions);

export const LogicalIndexRangeReadDependencyV1Schema = Schema.Struct({
  kind: Schema.Literal("appIndexRange"),
  tableId: CatalogTableIdSchema,
  indexDefinitionId: CatalogIndexDefinitionIdSchema,
  keyCodecVersion: OrderedIndexKeyCodecVersionSchema,
  physicalSpecSha256Hex: AppIndexPhysicalSpecSha256HexV1Schema,
  direction: Schema.Literal("asc"),
  lower: Schema.NullOr(LogicalIndexRangeLowerBoundV1Schema),
  upper: Schema.NullOr(Schema.Union([
    LogicalIndexRangeUpperKeyBoundV1Schema,
    LogicalIndexRangeUpperPositionBoundV1Schema,
  ])),
}).annotate(StrictStructOptions);
export type LogicalIndexRangeReadDependencyV1 =
  typeof LogicalIndexRangeReadDependencyV1Schema.Type;

export const LogicalApplicationRelationIncomingReadDependencyV1Schema =
  Schema.Struct({
    kind: Schema.Literal("appRelationIncoming"),
    edgeDefinitionId: CatalogEdgeDefinitionIdSchema,
    targetRowId: AppRowIdHexV1Schema,
    observedAdjacencyVersion: CommitSeqSchema,
    activationSequence: ApplicationActivationSequenceV1Schema,
    activeHeadSha256Hex: ApplicationActiveHeadSha256HexV1Schema,
  }).annotate(StrictStructOptions);
export type LogicalApplicationRelationIncomingReadDependencyV1 =
  typeof LogicalApplicationRelationIncomingReadDependencyV1Schema.Type;

export const LogicalReadDependencyV1Schema = Schema.Union([
  LogicalPointReadDependencyV1Schema,
  LogicalIndexRangeReadDependencyV1Schema,
  LogicalApplicationRelationIncomingReadDependencyV1Schema,
  LogicalMetadataReadDependencySchema,
]);
export type LogicalReadDependencyV1 =
  typeof LogicalReadDependencyV1Schema.Type;

const LogicalPatchSetFieldV1Schema = Schema.Struct({
  kind: Schema.Literal("set"),
  field: Schema.String,
  valueJson: JsonValue,
}).annotate(StrictStructOptions);

const LogicalPatchRemoveFieldV1Schema = Schema.Struct({
  kind: Schema.Literal("remove"),
  field: Schema.String,
}).annotate(StrictStructOptions);

export const LogicalPatchFieldV1Schema = Schema.Union([
  LogicalPatchSetFieldV1Schema,
  LogicalPatchRemoveFieldV1Schema,
]);
export type LogicalPatchFieldV1 = typeof LogicalPatchFieldV1Schema.Type;

export const AppDocumentFieldsJsonV1Schema = Schema.Record(
  Schema.String,
  JsonValue,
);

const LogicalInsertWriteV1Schema = Schema.Struct({
  kind: Schema.Literal("insert"),
  syscallSequence: CommitSyscallSequenceV1Schema,
  documentId: AppDocumentIdV1Schema,
  creationTime: AppCreationTimeV1Schema,
  fieldsValueJson: AppDocumentFieldsJsonV1Schema,
  resultingDocumentSemanticBytes: CommitDocumentSemanticBytesV1Schema,
}).annotate(StrictStructOptions);

const LogicalPatchWriteV1Schema = Schema.Struct({
  kind: Schema.Literal("patch"),
  syscallSequence: CommitSyscallSequenceV1Schema,
  documentId: AppDocumentIdV1Schema,
  changes: Schema.Array(LogicalPatchFieldV1Schema),
  resultingDocumentSemanticBytes: CommitDocumentSemanticBytesV1Schema,
}).annotate(StrictStructOptions);

const LogicalReplaceWriteV1Schema = Schema.Struct({
  kind: Schema.Literal("replace"),
  syscallSequence: CommitSyscallSequenceV1Schema,
  documentId: AppDocumentIdV1Schema,
  fieldsValueJson: AppDocumentFieldsJsonV1Schema,
  resultingDocumentSemanticBytes: CommitDocumentSemanticBytesV1Schema,
}).annotate(StrictStructOptions);

const LogicalDeleteWriteV1Schema = Schema.Struct({
  kind: Schema.Literal("delete"),
  syscallSequence: CommitSyscallSequenceV1Schema,
  documentId: AppDocumentIdV1Schema,
}).annotate(StrictStructOptions);

export const LogicalAppWriteV1Schema = Schema.Union([
  LogicalInsertWriteV1Schema,
  LogicalPatchWriteV1Schema,
  LogicalReplaceWriteV1Schema,
  LogicalDeleteWriteV1Schema,
]);
export type LogicalAppWriteV1 = typeof LogicalAppWriteV1Schema.Type;

/**
 * Read rows/bytes cannot be reconstructed from the coalesced OCC dependency
 * set because repeated present reads still count. Only the trusted C03 journal
 * owner may operationally supply this evidence; inline carriage is dormant.
 */
export const SessionReadUsageV1Schema = Schema.Struct({
  documentsRead: CommitReadDocumentsV1Schema,
  semanticBytesRead: CommitReadSemanticBytesV1Schema,
}).annotate(StrictStructOptions);
export type SessionReadUsageV1 = typeof SessionReadUsageV1Schema.Type;

const ParticipantDigestSha256HexV1Schema = Schema.String.check(
  Schema.isPattern(LOWERCASE_SHA256_PATTERN),
);
const ParticipantSelectorV1Schema = Schema.String.check(
  Schema.isMinLength(1), Schema.isMaxLength(512),
);
const ParticipantBindingHeadV1Schema = Schema.Struct({
  sequence: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  sha256: ParticipantDigestSha256HexV1Schema,
}).annotate(StrictStructOptions);

/** Exact trusted preimage shared by live admission and finish-only recovery.
 * The caller hashes the canonical bytes; a sandbox selector is never authority. */
export const AdmittedParticipantBindingV1Schema = Schema.Struct({
  scopeId: ScopeIdSchema,
  sessionId: TransactionSessionIdV1Schema,
  attemptFence: TransactionAttemptFenceSchema,
  snapshotCommitSeq: CommitSeqSchema,
  schemaVersionId: CatalogSchemaVersionIdSchema,
  principalDigest: ParticipantDigestSha256HexV1Schema,
  participant: ParticipantSelectorV1Schema,
  method: ParticipantSelectorV1Schema,
  sourceKey: ParticipantSelectorV1Schema,
  sourceSha256Hex: ParticipantDigestSha256HexV1Schema,
  bindingHead: ParticipantBindingHeadV1Schema,
}).annotate(StrictStructOptions);
export type AdmittedParticipantBindingV1 =
  typeof AdmittedParticipantBindingV1Schema.Type;
const encodeAdmittedParticipantBindingResult = Schema.encodeUnknownResult(
  AdmittedParticipantBindingV1Schema,
);

export const canonicalizeAdmittedParticipantBindingV1Result = (
  candidate: unknown,
): Result.Result<Readonly<{ bytes: Uint8Array; text: string }>, "invalidBinding"> =>
  Result.gen(function* () {
    const encoded = yield* encodeAdmittedParticipantBindingResult(candidate).pipe(
      Result.mapError(() => "invalidBinding" as const),
    );
    if (!isJsonObject(encoded)) return yield* Result.fail("invalidBinding" as const);
    const text = encodeCanonicalJson(encoded, commitJsonEncodingInvariantFailure);
    const bytes = TEXT_ENCODER.encode(text);
    if (bytes.byteLength > 4_096) return yield* Result.fail("invalidBinding" as const);
    return Object.freeze({ bytes, text });
  });

/** Ordered trusted source selection for one outer operation. The persisted
 * receipt stores the digest of these exact bytes. */
export const AdmittedSourceBindingSchema = Schema.Struct({
  sourceKey: ParticipantSelectorV1Schema,
  sourceSha256Hex: ParticipantDigestSha256HexV1Schema,
  bindingHead: ParticipantBindingHeadV1Schema,
  sourceBindingSha256Hex: ParticipantDigestSha256HexV1Schema,
  methods: Schema.Array(ParticipantSelectorV1Schema).check(Schema.isMaxLength(32)),
}).annotate(StrictStructOptions);
export type AdmittedSourceBinding = typeof AdmittedSourceBindingSchema.Type;
export const AdmittedSourceBundleSchema = Schema.Struct({
  participant: ParticipantSelectorV1Schema,
  method: ParticipantSelectorV1Schema,
  profileRevision: ParticipantDigestSha256HexV1Schema,
  sources: Schema.Array(AdmittedSourceBindingSchema).check(Schema.isMaxLength(3)),
}).annotate(StrictStructOptions);
export type AdmittedSourceBundle = typeof AdmittedSourceBundleSchema.Type;
const encodeAdmittedSourceBundleResult = Schema.encodeUnknownResult(AdmittedSourceBundleSchema);
export const canonicalizeAdmittedSourceBundleResult = (
  candidate: unknown,
): Result.Result<Readonly<{ bytes: Uint8Array; text: string }>, "invalidBundle"> =>
  Result.gen(function* () {
    const encoded = yield* encodeAdmittedSourceBundleResult(candidate).pipe(
      Result.mapError(() => "invalidBundle" as const),
    );
    if (!isJsonObject(encoded)) return yield* Result.fail("invalidBundle" as const);
    const text = encodeCanonicalJson(encoded, commitJsonEncodingInvariantFailure);
    const bytes = TEXT_ENCODER.encode(text);
    if (bytes.byteLength > 16_384) return yield* Result.fail("invalidBundle" as const);
    return Object.freeze({ bytes, text });
  });
const ParticipantEffectOrdinalV1Schema = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 0, maximum: 65_535 }),
);
const ParticipantDocumentV1Schema = Schema.Record(Schema.String, JsonValue);

export const AdmittedParticipantLogicalEffectV1Schema = Schema.Struct({
  effectOrdinal: ParticipantEffectOrdinalV1Schema,
  tableId: CatalogTableIdSchema,
  documentId: AppDocumentIdV1Schema,
  operation: Schema.Literals(["insert", "patch", "replace", "delete"]),
  before: Schema.NullOr(ParticipantDocumentV1Schema),
  after: Schema.NullOr(ParticipantDocumentV1Schema),
}).annotate(StrictStructOptions);
export type AdmittedParticipantLogicalEffectV1 =
  typeof AdmittedParticipantLogicalEffectV1Schema.Type;

export const AdmittedParticipantWriteEventSchema = Schema.Struct({
  kind: Schema.Literal("logicalDocument"),
  syscallSequence: CommitSyscallSequenceV1Schema,
  sourceBindingSha256Hex: ParticipantDigestSha256HexV1Schema,
  effect: AdmittedParticipantLogicalEffectV1Schema,
}).annotate(StrictStructOptions);
export type AdmittedParticipantWriteEvent =
  typeof AdmittedParticipantWriteEventSchema.Type;

export const SourceContributionSchema = Schema.Struct({
  ...AdmittedSourceBindingSchema.fields,
  effects: Schema.Array(AdmittedParticipantLogicalEffectV1Schema).check(
    Schema.isMaxLength(MAX_COMMIT_WRITE_OPERATIONS_V1),
  ),
  dependencyEvidence: ParticipantDocumentV1Schema,
}).annotate(StrictStructOptions);
export type SourceContribution = typeof SourceContributionSchema.Type;

export const AdmittedParticipantEventIntentSchema = Schema.Struct({
  sourceKey: Schema.NullOr(ParticipantSelectorV1Schema),
  intent: JsonValue,
}).annotate(StrictStructOptions);
export type AdmittedParticipantEventIntent = typeof AdmittedParticipantEventIntentSchema.Type;

export const AdmittedParticipantOperationSchema = Schema.Struct({
  syscallSequence: CommitSyscallSequenceV1Schema,
  participant: ParticipantSelectorV1Schema,
  method: ParticipantSelectorV1Schema,
  profileRevision: ParticipantDigestSha256HexV1Schema,
  admissionBundleSha256Hex: ParticipantDigestSha256HexV1Schema,
  requestSha256Hex: ParticipantDigestSha256HexV1Schema,
  resultSha256Hex: ParticipantDigestSha256HexV1Schema,
  sourceContributions: Schema.Array(SourceContributionSchema).check(Schema.isMaxLength(3)),
  eventIntents: Schema.Array(AdmittedParticipantEventIntentSchema).check(Schema.isMaxLength(2_048)),
}).annotate(StrictStructOptions);
export type AdmittedParticipantOperation =
  typeof AdmittedParticipantOperationSchema.Type;

/** Private insertion provenance travels inside the authenticated source receipt.
 * Absence of this field in retained bytes means no explicit insertion intent. */
export const GeneratedInsertionIntentSchema = Schema.Struct({
  documentId: AppDocumentIdV1Schema, tableId: CatalogTableIdSchema, rowId: AppRowIdHexV1Schema,
  effectOrdinal: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: MAX_COMMIT_WRITE_OPERATIONS_V1 - 1 })),
}).annotate(StrictStructOptions);
export const GeneratedInsertionIntentsSchema = Schema.Array(GeneratedInsertionIntentSchema).check(
  Schema.isMaxLength(MAX_COMMIT_POINT_READ_DEPENDENCIES_V1));
export type GeneratedInsertionIntent = typeof GeneratedInsertionIntentSchema.Type;
export interface AuthenticatedGeneratedInsertion extends GeneratedInsertionIntent {
  readonly origin: Readonly<{ syscallSequence: bigint; sourceBindingSha256Hex: string }>;
}
const decodeInsertionCarrier = Schema.decodeUnknownResult(Schema.Struct({
  generatedInsertions: Schema.optionalKey(GeneratedInsertionIntentsSchema),
}));
export function authenticatedGeneratedInsertionsResult(operations: readonly AdmittedParticipantOperation[]) {
  return Result.gen(function* () {
    const intents = new Map<AppDocumentIdV1, AuthenticatedGeneratedInsertion>();
    const firstEffects = new Map<AppDocumentIdV1, Readonly<{ sequence: bigint; ordinal: number; binding: string }>>();
    for (const operation of operations) for (const source of operation.sourceContributions)
      for (const effect of source.effects) {
        const first = firstEffects.get(effect.documentId);
        if (first === undefined || operation.syscallSequence < first.sequence ||
          operation.syscallSequence === first.sequence && effect.effectOrdinal < first.ordinal)
          firstEffects.set(effect.documentId, { sequence: operation.syscallSequence,
            ordinal: effect.effectOrdinal, binding: source.sourceBindingSha256Hex });
      }
    for (const operation of operations) for (const source of operation.sourceContributions) {
      const carrier = yield* decodeInsertionCarrier(source.dependencyEvidence)
        .pipe(Result.mapError(() => invalidSchemaError("journal")));
      for (const intent of carrier.generatedInsertions ?? []) {
        const identity = yield* decodeAppDocumentIdentityV1Result(intent.documentId)
          .pipe(Result.mapError(() => invalidSchemaError("journal")));
        const effect = source.effects.find(member => member.effectOrdinal === intent.effectOrdinal);
        const first = firstEffects.get(intent.documentId);
        if (intents.has(intent.documentId) || identity.tableId !== intent.tableId || identity.rowId !== intent.rowId ||
          effect === undefined || effect.tableId !== intent.tableId || effect.documentId !== intent.documentId ||
          effect.operation !== "insert" || effect.before !== null || effect.after === null ||
          first?.sequence !== operation.syscallSequence || first.ordinal !== intent.effectOrdinal ||
          first.binding !== source.sourceBindingSha256Hex)
          return yield* Result.fail(invalidSchemaError("journal"));
        intents.set(intent.documentId, { ...intent, origin: { syscallSequence: operation.syscallSequence,
          sourceBindingSha256Hex: source.sourceBindingSha256Hex } });
      }
    }
    if (intents.size > MAX_COMMIT_POINT_READ_DEPENDENCIES_V1) return yield* Result.fail(invalidSchemaError("journal"));
    return intents;
  });
}

/** Operational usage is recomputed from retained receipts by the journal
 * owner at seal, then bound by the canonical journal digest for recovery. */
export const SessionJournalOperationUsageSchema = Schema.Struct({
  receiptEvidenceBytes: Schema.Int.check(Schema.isBetween({
    minimum: 0, maximum: MAX_COMMIT_RECEIPT_EVIDENCE_BYTES_V1,
  })),
  participantWorkBytes: Schema.Int.check(Schema.isBetween({
    minimum: 0, maximum: MAX_COMMIT_PARTICIPANT_WORK_BYTES_V1,
  })),
  participantWorkCalls: Schema.Int.check(Schema.isBetween({
    minimum: 0, maximum: MAX_COMMIT_PARTICIPANT_WORK_CALLS_V1,
  })),
}).annotate(StrictStructOptions);
export type SessionJournalOperationUsage =
  typeof SessionJournalOperationUsageSchema.Type;

/** The new exact persisted journal format. Application write history remains
 * its domain contract; participant effects are separately authenticated and
 * the journal point overlay remains the sole pending row authority. */
export const SessionJournalSchema = Schema.Struct({
  format: Schema.Literal(SESSION_JOURNAL_FORMAT),
  protocolVersion: TransactionSessionProtocolVersionV1Schema,
  valueCodecVersion: FlarexValueCodecVersionSchema,
  finalSyscallSequence: CommitFinalSyscallSequenceV1Schema,
  readDependencies: Schema.Array(LogicalReadDependencyV1Schema),
  readUsage: SessionReadUsageV1Schema,
  writes: Schema.Array(LogicalAppWriteV1Schema),
  operationUsage: SessionJournalOperationUsageSchema,
  participantOperations: Schema.Array(AdmittedParticipantOperationSchema)
    .check(Schema.isMaxLength(MAX_COMMIT_WRITE_OPERATIONS_V1)),
  finiteMetadataReservationSha256Hex: Schema.optionalKey(Schema.String.check(Schema.isPattern(LOWERCASE_SHA256_PATTERN))),
}).annotate(StrictStructOptions);
export type SessionJournal = typeof SessionJournalSchema.Type;

/** Canonical point evidence projected by the trusted loader. The helper checks
 * only the neutral effect chain; authority and historical validation stay
 * with the executor and publisher. */
export interface ParticipantPointCorrelation {
  readonly documentId: AppDocumentIdV1;
  readonly tableId: CatalogTableId;
  readonly observed: Extract<LogicalReadDependencyV1,
    { readonly kind: "appRowPoint" }>["observed"] | Readonly<{ kind: "generatedInsertion" }>;
  readonly overlayKind: "none" | "live" | "deleted";
  readonly overlayValueJson: JsonObject | null;
}

export const verifyParticipantPointCorrelationEffect = Effect.fn(
  "CommitProtocol.verifyParticipantPointCorrelation",
)(function* (journal: SessionJournal,
  points: readonly ParticipantPointCorrelation[]): Effect.fn.Return<
    Readonly<{ effectCount: number; writeSemanticBytes: number }>, CommitProtocolV1Error> {
  const byId = new Map(points.map(point => [point.documentId, point] as const));
  if (byId.size !== points.length) {
    return yield* protocolFailureEffect({ reason: "invalidSchema", component: "journal" });
  }
  const appWritten = new Set(journal.writes.map(write => write.documentId));
  const prior = new Map<AppDocumentIdV1, JsonObject | null>();
  const deleted = new Set<AppDocumentIdV1>();
  let effectCount = 0;
  let writeSemanticBytes = 0;
  for (const operation of journal.participantOperations) {
    const orderedEffects = operation.sourceContributions.flatMap(source => source.effects)
      .toSorted((left, right) => left.effectOrdinal - right.effectOrdinal);
    for (const effect of orderedEffects) {
      effectCount += 1;
      const point = byId.get(effect.documentId);
      if (point === undefined || appWritten.has(effect.documentId) ||
        point.tableId !== effect.tableId || deleted.has(effect.documentId) ||
        (point.observed.kind === "missing" &&
          point.observed.basis.kind === "tombstone")) {
        return yield* protocolFailureEffect({ reason: "invalidSchema", component: "journal" });
      }
      const hasPrior = prior.has(effect.documentId);
      const before = hasPrior ? prior.get(effect.documentId) : undefined;
      if (hasPrior ? before === undefined || !jsonEqual(before, effect.before) :
        point.observed.kind === "present" ? effect.before === null : effect.before !== null) {
        return yield* protocolFailureEffect({ reason: "invalidSchema", component: "journal" });
      }
      if (effect.operation === "insert" ? effect.before !== null || effect.after === null :
        effect.operation === "delete" ? effect.before === null || effect.after !== null :
          effect.before === null || effect.after === null) {
        return yield* protocolFailureEffect({ reason: "invalidSchema", component: "journal" });
      }
      if (effect.after === null) deleted.add(effect.documentId);
      else {
        const normalized = yield* normalizeValueJsonEffect(effect.after,
          "appDocument", "journal", `participantOperations.${effect.documentId}.after`);
        writeSemanticBytes += normalized.semanticSizeBytes;
      }
      prior.set(effect.documentId, effect.after);
    }
  }
  for (const [documentId, final] of prior) {
    const point = byId.get(documentId);
    if (point === undefined || (final === null ? point.overlayKind !== "deleted" ||
      point.overlayValueJson !== null : point.overlayKind !== "live" ||
      point.overlayValueJson === null || !jsonEqual(final, point.overlayValueJson))) {
      return yield* protocolFailureEffect({ reason: "invalidSchema", component: "journal" });
    }
  }
  return Object.freeze({ effectCount, writeSemanticBytes });
});

export const CanonicalSessionJournalBytesSchema =
  Schema.Uint8Array.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1),
  ).pipe(Schema.brand("FlarexDB/CanonicalSessionJournalBytes"));
export type CanonicalSessionJournalBytes =
  typeof CanonicalSessionJournalBytesSchema.Type;

export const SessionJournalSha256HexV1Schema = Schema.String.check(
  Schema.isPattern(LOWERCASE_SHA256_PATTERN),
).pipe(Schema.brand("FlarexDB/SessionJournalSha256HexV1"));
export type SessionJournalSha256HexV1 =
  typeof SessionJournalSha256HexV1Schema.Type;

export const CanonicalSessionJournalBase64UrlV1Schema =
  UnpaddedBase64UrlTextSchema.check(
    Schema.isMaxLength(
      MAX_COMMIT_CANONICAL_EVIDENCE_BASE64URL_CHARACTERS_V1,
    ),
  ).pipe(Schema.brand("FlarexDB/CanonicalSessionJournalBase64UrlV1"));
export type CanonicalSessionJournalBase64UrlV1 =
  typeof CanonicalSessionJournalBase64UrlV1Schema.Type;

export const CanonicalSuccessfulResultBytesV1Schema =
  Schema.Uint8Array.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1),
  ).pipe(Schema.brand("FlarexDB/CanonicalSuccessfulResultBytesV1"));
export type CanonicalSuccessfulResultBytesV1 =
  typeof CanonicalSuccessfulResultBytesV1Schema.Type;

export const SuccessfulResultSha256HexV1Schema = Schema.String.check(
  Schema.isPattern(LOWERCASE_SHA256_PATTERN),
).pipe(Schema.brand("FlarexDB/SuccessfulResultSha256HexV1"));
export type SuccessfulResultSha256HexV1 =
  typeof SuccessfulResultSha256HexV1Schema.Type;

export const CanonicalSuccessfulResultBase64UrlV1Schema =
  UnpaddedBase64UrlTextSchema.check(
    Schema.isMaxLength(
      MAX_COMMIT_CANONICAL_EVIDENCE_BASE64URL_CHARACTERS_V1,
    ),
  ).pipe(Schema.brand("FlarexDB/CanonicalSuccessfulResultBase64UrlV1"));
export type CanonicalSuccessfulResultBase64UrlV1 =
  typeof CanonicalSuccessfulResultBase64UrlV1Schema.Type;

export const SuccessfulResultEvidenceV1Schema = Schema.Struct({
  valueCodecVersion: FlarexValueCodecVersionSchema,
  canonicalValueBase64Url: CanonicalSuccessfulResultBase64UrlV1Schema,
  sha256Hex: SuccessfulResultSha256HexV1Schema,
}).annotate(StrictStructOptions);
export type SuccessfulResultEvidenceV1 =
  typeof SuccessfulResultEvidenceV1Schema.Type;

export const StoredForSessionAttemptJournalCarriageV1Schema = Schema.Struct({
  kind: Schema.Literal("storedForSessionAttempt"),
}).annotate(StrictStructOptions);
export type StoredForSessionAttemptJournalCarriageV1 =
  typeof StoredForSessionAttemptJournalCarriageV1Schema.Type;

export const InlineUntrustedJournalCarriageV1Schema = Schema.Struct({
  kind: Schema.Literal("inlineUntrusted"),
  canonicalJournalBase64Url: CanonicalSessionJournalBase64UrlV1Schema,
}).annotate(StrictStructOptions);
export type InlineUntrustedJournalCarriageV1 =
  typeof InlineUntrustedJournalCarriageV1Schema.Type;

export const JournalCarriageV1Schema = Schema.Union([
  StoredForSessionAttemptJournalCarriageV1Schema,
  InlineUntrustedJournalCarriageV1Schema,
]);
export type JournalCarriageV1 = typeof JournalCarriageV1Schema.Type;

export const CommitEnvelopeV1Schema = Schema.Struct({
  format: Schema.Literal(COMMIT_ENVELOPE_FORMAT_V1),
  protocolVersion: TransactionSessionProtocolVersionV1Schema,
  sessionId: TransactionSessionIdV1Schema,
  attemptFence: TransactionAttemptFenceSchema,
  finalSyscallSequence: CommitFinalSyscallSequenceV1Schema,
  journal: JournalCarriageV1Schema,
  journalSha256Hex: SessionJournalSha256HexV1Schema,
  successfulResult: SuccessfulResultEvidenceV1Schema,
}).annotate(StrictStructOptions);
export type CommitEnvelopeV1 = typeof CommitEnvelopeV1Schema.Type;

export interface StoredForSessionAttemptCommitEnvelopeV1 {
  readonly format: CommitEnvelopeV1["format"];
  readonly protocolVersion: CommitEnvelopeV1["protocolVersion"];
  readonly sessionId: CommitEnvelopeV1["sessionId"];
  readonly attemptFence: CommitEnvelopeV1["attemptFence"];
  readonly finalSyscallSequence: CommitEnvelopeV1["finalSyscallSequence"];
  readonly journal: StoredForSessionAttemptJournalCarriageV1;
  readonly journalSha256Hex: CommitEnvelopeV1["journalSha256Hex"];
  readonly successfulResult: CommitEnvelopeV1["successfulResult"];
}

export interface CanonicalSessionJournal {
  readonly journal: SessionJournal;
  readonly canonicalText: string;
  readonly canonicalBytes: CanonicalSessionJournalBytes;
  readonly sha256Hex: SessionJournalSha256HexV1;
}

export interface CanonicalSuccessfulResultV1 {
  readonly valueJson: Json;
  readonly semanticSizeBytes: number;
  readonly canonicalText: string;
  readonly canonicalBytes: CanonicalSuccessfulResultBytesV1;
  readonly evidence: SuccessfulResultEvidenceV1;
}

export type CommitProtocolV1Component =
  | "journal"
  | "envelope"
  | "successfulResult";

export type CommitProtocolV1LimitDimension =
  | "metadataReadDependencies"
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
  | "patchFields"
  | "writeSemanticBytes"
  | "resultSemanticBytes"
  | "materialWriteEventEvidenceBytes"
  | "operationCalls"
  | "receiptEvidenceBytes"
  | "canonicalEvidenceBytes";

export type CommitProtocolV1Issue =
  | {
      readonly reason: "invalidFormat";
      readonly component: "journal" | "envelope";
    }
  | {
      readonly reason: "unsupportedVersion";
      readonly component: CommitProtocolV1Component;
      readonly field: "protocolVersion" | "valueCodecVersion";
    }
  | {
      readonly reason: "invalidSchema";
      readonly component: CommitProtocolV1Component;
    }
  | {
      readonly reason: "invalidUtf8" | "invalidJson" | "nonCanonical";
      readonly component: "journal" | "successfulResult";
    }
  | {
      readonly reason: "invalidValue";
      readonly component: "journal" | "successfulResult";
      readonly path: string;
    }
  | {
      readonly reason: "invalidBase64Url";
      readonly component: "journal" | "successfulResult";
    }
  | {
      readonly reason: "digestMismatch" | "digestUnavailable";
      readonly component: "journal" | "successfulResult";
    }
  | {
      readonly reason: "duplicateReadDependency";
      readonly documentId: AppDocumentIdV1;
    }
  | {
      readonly reason: "invalidIndexRangeDependency";
      readonly indexDefinitionId: CatalogIndexDefinitionId;
    }
  | {
      readonly reason: "conflictingApplicationRelationReadDependency";
      readonly edgeDefinitionId: CatalogEdgeDefinitionId;
      readonly targetRowId: AppRowIdHexV1;
    }
  | {
      readonly reason: "conflictingApplicationRelationActiveSelection";
      readonly edgeDefinitionId: CatalogEdgeDefinitionId;
      readonly targetRowId: AppRowIdHexV1;
    }
  | {
      readonly reason: "duplicateWriteSequence";
      readonly syscallSequence: CommitSyscallSequenceV1;
    }
  | {
      readonly reason: "duplicatePatchField";
      readonly documentId: AppDocumentIdV1;
      readonly field: string;
    }
  | {
      readonly reason: "developerAuthoredSystemField";
      readonly documentId: AppDocumentIdV1;
      readonly field: "_id" | "_creationTime";
    }
  | {
      readonly reason: "invalidRevisionCommitSeq";
      readonly documentId: AppDocumentIdV1;
    }
  | {
      readonly reason: "sequenceMismatch";
    }
  | {
      readonly reason: "limitExceeded";
      readonly dimension: CommitProtocolV1LimitDimension;
      readonly observed: number;
      readonly maximum: number;
    }
  | {
      readonly reason: "inlineJournalCarriageDormant";
    };

export class CommitProtocolV1Error extends Data.TaggedError(
  "CommitProtocolV1Error",
)<{
  readonly issue: CommitProtocolV1Issue;
}> {}

export interface DecodeCanonicalSessionJournalInput {
  readonly canonicalBytes: unknown;
  readonly expectedSha256Hex: unknown;
}

const decodeUnknownSessionJournal = Schema.decodeUnknownEffect(
  SessionJournalSchema,
  StrictParseOptions,
);
const encodeUnknownSessionJournal = Schema.encodeUnknownEffect(
  SessionJournalSchema,
  StrictParseOptions,
);
const decodeUnknownCanonicalSessionJournalBytes =
  Schema.decodeUnknownEffect(CanonicalSessionJournalBytesSchema);
const encodeUnknownLogicalIndexRangeReadDependencyV1Result =
  Schema.encodeUnknownResult(
    LogicalIndexRangeReadDependencyV1Schema,
    StrictParseOptions,
  );
const decodeUnknownJsonValueResult = Schema.decodeUnknownResult(JsonValue);
const decodeUnknownSessionJournalSha256HexV1 = Schema.decodeUnknownEffect(
  SessionJournalSha256HexV1Schema,
);
const decodeUnknownSuccessfulResultEvidenceV1 = Schema.decodeUnknownEffect(
  SuccessfulResultEvidenceV1Schema,
  StrictParseOptions,
);
const decodeUnknownCommitEnvelopeV1 = Schema.decodeUnknownEffect(
  CommitEnvelopeV1Schema,
  StrictParseOptions,
);
const encodeUnknownCommitEnvelopeV1 = Schema.encodeUnknownEffect(
  CommitEnvelopeV1Schema,
  StrictParseOptions,
);
const decodeUnknownJsonValue = Schema.decodeUnknownEffect(JsonValue);

export const canonicalizeSessionJournalEffect = Effect.fn(
  "CommitProtocol.canonicalizeSessionJournal",
)(function* (
  input: unknown,
): Effect.fn.Return<CanonicalSessionJournal, CommitProtocolV1Error> {
  yield* inspectProtocolHeaderEffect(
    input,
    "journal",
    SESSION_JOURNAL_FORMAT,
  );
  const preflightIssue = preflightSessionJournalCandidate(input);
  if (preflightIssue !== undefined) {
    return yield* protocolFailureEffect(preflightIssue);
  }
  const encodedInput = yield* encodeUnknownSessionJournal(input).pipe(
    Effect.mapError(() => invalidSchemaError("journal")),
  );
  const detached = yield* decodeUnknownSessionJournal(encodedInput).pipe(
    Effect.mapError(() => invalidSchemaError("journal")),
  );
  const app = yield* normalizeAppJournalFieldsEffect(detached);
  if (app.readDependencies.some(dependency => dependency.kind === "metadata") && detached.finiteMetadataReservationSha256Hex === undefined)
    return yield* Effect.fail(invalidSchemaError("journal"));
  const ordered = [...detached.participantOperations].toSorted((left, right) =>
    left.syscallSequence < right.syscallSequence ? -1
    : left.syscallSequence > right.syscallSequence ? 1
    : 0
  );
  const seen = new Set<CommitSyscallSequenceV1>(
    app.writes.map((write) => write.syscallSequence),
  );
  const participantOperations: AdmittedParticipantOperation[] = [];
  let effectCount = app.writes.length;
  let eventCount = 0;
  let semanticBytes = app.writes.reduce((total, write) =>
    write.kind === "delete" ? total : total + write.resultingDocumentSemanticBytes,
  0);
  for (const operation of ordered) {
    if (seen.has(operation.syscallSequence)) {
      return yield* protocolFailureEffect({
        reason: "duplicateWriteSequence",
        syscallSequence: operation.syscallSequence,
      });
    }
    seen.add(operation.syscallSequence);
    if (operation.syscallSequence > detached.finalSyscallSequence) {
      return yield* protocolFailureEffect({ reason: "sequenceMismatch" });
    }
    eventCount += operation.eventIntents.length;
    if (eventCount > 2_048) {
      return yield* protocolFailureEffect({
        reason: "invalidSchema",
        component: "journal",
      });
    }
    const sourceContributions: SourceContribution[] = [];
    const sourceKeys = new Set<string>();
    const allEffects = operation.sourceContributions.flatMap(source => source.effects)
      .toSorted((left, right) => left.effectOrdinal - right.effectOrdinal);
    effectCount += allEffects.length;
    yield* enforceLimitEffect("writeOperations", effectCount, MAX_COMMIT_WRITE_OPERATIONS_V1);
    if (operation.sourceContributions.length === 0) {
      return yield* protocolFailureEffect({ reason: "invalidSchema", component: "journal" });
    }
    for (const source of operation.sourceContributions) {
      if (sourceKeys.has(source.sourceKey)) {
        return yield* protocolFailureEffect({ reason: "invalidSchema", component: "journal" });
      }
      sourceKeys.add(source.sourceKey);
      for (const [position, effect] of source.effects.entries()) {
        if (position > 0 && effect.effectOrdinal <= source.effects[position - 1]!.effectOrdinal) {
          return yield* protocolFailureEffect({ reason: "sequenceMismatch" });
        }
      }
    }
    for (const [ordinal, effect] of allEffects.entries()) {
      if (effect.effectOrdinal !== ordinal) {
        return yield* protocolFailureEffect({ reason: "sequenceMismatch" });
      }
    }
    for (const [sourceOrdinal, source] of operation.sourceContributions.entries()) {
      if (source.methods.length === 0 || new Set(source.methods).size !== source.methods.length) {
        return yield* protocolFailureEffect({ reason: "invalidSchema", component: "journal" });
      }
      const effects: AdmittedParticipantLogicalEffectV1[] = [];
      for (const effect of source.effects) {
        const identity = yield* Effect.fromResult(
          decodeAppDocumentIdentityV1Result(effect.documentId).pipe(
            Result.mapError(() => invalidSchemaError("journal")),
          ),
        );
        if (identity.tableId !== effect.tableId ||
          (effect.before !== null && effect.before._id !== effect.documentId) ||
          (effect.after !== null && effect.after._id !== effect.documentId)) {
          return yield* protocolFailureEffect({ reason: "invalidSchema", component: "journal" });
        }
        const before = yield* normalizeParticipantDocumentV1Effect(
          effect.before,
          effect.documentId,
          "before",
        );
        const after = yield* normalizeParticipantDocumentV1Effect(
          effect.after,
          effect.documentId,
          "after",
        );
        if (
          (effect.operation === "insert" && (before !== null || after === null)) ||
          (effect.operation === "delete" && (before === null || after !== null)) ||
          ((effect.operation === "patch" || effect.operation === "replace") &&
            (before === null || after === null))
        ) {
          return yield* protocolFailureEffect({
            reason: "invalidSchema",
            component: "journal",
          });
        }
        if (after !== null) {
          const normalized = yield* normalizeValueJsonEffect(
            after,
            "appDocument",
            "journal",
            `participantOperations.${operation.syscallSequence}.${sourceOrdinal}.${effect.effectOrdinal}.after`,
          );
          semanticBytes += normalized.semanticSizeBytes;
          yield* enforceLimitEffect(
            "writeSemanticBytes",
            semanticBytes,
            MAX_COMMIT_WRITE_SEMANTIC_BYTES_V1,
          );
        }
        effects.push(Object.freeze({ ...effect, before, after }));
      }
      const dependencyEvidence = yield* normalizeValueJsonEffect(
        source.dependencyEvidence,
        "generalValue",
        "journal",
        `participantOperations.${operation.syscallSequence}.${sourceOrdinal}.dependencyEvidence`,
      );
      if (!isJsonObject(dependencyEvidence.valueJson)) {
        return yield* protocolFailureEffect({ reason: "invalidSchema", component: "journal" });
      }
      sourceContributions.push(Object.freeze({ ...source, effects,
        dependencyEvidence: dependencyEvidence.valueJson }));
    }
    const eventIntents: AdmittedParticipantEventIntent[] = [];
    for (const [ordinal, event] of operation.eventIntents.entries()) {
      if (event.sourceKey !== null && !sourceKeys.has(event.sourceKey)) {
        return yield* protocolFailureEffect({ reason: "invalidSchema", component: "journal" });
      }
      const normalized = yield* normalizeValueJsonEffect(
        event.intent,
        "generalValue",
        "journal",
        `participantOperations.${operation.syscallSequence}.eventIntents.${ordinal}`,
      );
      eventIntents.push(Object.freeze({ sourceKey: event.sourceKey,
        intent: normalized.valueJson }));
    }
    participantOperations.push(Object.freeze({
      syscallSequence: operation.syscallSequence,
      participant: operation.participant,
      method: operation.method,
      profileRevision: operation.profileRevision,
      admissionBundleSha256Hex: operation.admissionBundleSha256Hex,
      requestSha256Hex: operation.requestSha256Hex,
      resultSha256Hex: operation.resultSha256Hex,
      sourceContributions,
      eventIntents,
    }));
  }
  if (
    detached.finalSyscallSequence === 0n &&
    participantOperations.length > 0
  ) {
    return yield* protocolFailureEffect({ reason: "sequenceMismatch" });
  }
  const journal: SessionJournal = {
    ...app,
    format: SESSION_JOURNAL_FORMAT,
    operationUsage: detached.operationUsage,
    participantOperations,
    ...(detached.finiteMetadataReservationSha256Hex === undefined ? {} : {
      finiteMetadataReservationSha256Hex: detached.finiteMetadataReservationSha256Hex }),
  };
  const encoded = yield* encodeUnknownSessionJournal(journal).pipe(
    Effect.mapError(() => invalidSchemaError("journal")),
  );
  const json = yield* decodeUnknownJsonValue(encoded).pipe(
    Effect.mapError(() => invalidSchemaError("journal")),
  );
  const canonicalText = encodeCanonicalJson(
    json,
    commitJsonEncodingInvariantFailure,
  );
  const rawBytes = TEXT_ENCODER.encode(canonicalText);
  yield* enforceLimitEffect(
    "canonicalEvidenceBytes",
    rawBytes.byteLength,
    MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1,
  );
  const stableCanonicalBytes = new Uint8Array(rawBytes);
  const sha256Hex = yield* sha256HexEffect(stableCanonicalBytes, "journal");
  return Object.freeze({
    journal: freezeOwnedProtocolProjection(journal),
    canonicalText,
    get canonicalBytes(): CanonicalSessionJournalBytes {
      return CanonicalSessionJournalBytesSchema.make(
        new Uint8Array(stableCanonicalBytes),
      );
    },
    sha256Hex,
  } satisfies CanonicalSessionJournal);
});

const normalizeParticipantDocumentV1Effect = Effect.fn(function* (
  value: JsonObject | null,
  documentId: AppDocumentIdV1,
  phase: "before" | "after",
): Effect.fn.Return<JsonObject | null, CommitProtocolV1Error> {
  if (value === null) return null;
  const normalized = yield* normalizeValueJsonEffect(
    value,
    "appDocument",
    "journal",
    `participantOperations.${documentId}.${phase}`,
  );
  if (!isJsonObject(normalized.valueJson)) {
    return yield* protocolFailureEffect({
      reason: "invalidValue",
      component: "journal",
      path: `participantOperations.${documentId}.${phase}`,
    });
  }
  return normalized.valueJson;
});

export const decodeCanonicalSessionJournalEffect = Effect.fn(
  "CommitProtocol.decodeCanonicalSessionJournal",
)(function* (
  input: DecodeCanonicalSessionJournalInput,
): Effect.fn.Return<CanonicalSessionJournal, CommitProtocolV1Error> {
  const decodedBytes = yield* decodeUnknownCanonicalSessionJournalBytes(
    input.canonicalBytes,
  ).pipe(Effect.mapError(() => invalidSchemaError("journal")));
  const expectedSha256Hex = yield* decodeUnknownSessionJournalSha256HexV1(
    input.expectedSha256Hex,
  ).pipe(Effect.mapError(() => invalidSchemaError("journal")));
  const stableInputBytes = new Uint8Array(decodedBytes);
  const parsed = yield* decodeUtf8JsonEffect(stableInputBytes, "journal");
  yield* inspectProtocolHeaderEffect(
    parsed,
    "journal",
    SESSION_JOURNAL_FORMAT,
  );
  const decoded = yield* decodeUnknownSessionJournal(parsed).pipe(
    Effect.mapError(() => invalidSchemaError("journal")),
  );
  const canonical = yield* canonicalizeSessionJournalEffect(decoded);
  if (!bytesEqual(stableInputBytes, canonical.canonicalBytes)) {
    return yield* protocolFailureEffect({
      reason: "nonCanonical",
      component: "journal",
    });
  }
  if (canonical.sha256Hex !== expectedSha256Hex) {
    return yield* protocolFailureEffect({
      reason: "digestMismatch",
      component: "journal",
    });
  }
  return canonical;
});

/** Process-local value provenance, without storage or settlement authority.
 * The runtime getter reuses immutable branches and detaches every binary leaf.
 * Neither this projection nor the public result exposes the retained buffers. */
export interface IssuedCanonicalSuccessfulResultV1 {
  readonly result: CanonicalSuccessfulResultV1;
  readonly value: CanonicalFlarexRuntimeValueV1;
}

/** Only the original fully validating constructor can issue this handoff.
 * Restored/lookalike values remain foreign and require complete verification. */
const issuedSuccessfulResults = new WeakMap<object, IssuedCanonicalSuccessfulResultV1>();
export function readIssuedCanonicalSuccessfulResultV1(input: unknown): IssuedCanonicalSuccessfulResultV1 | undefined {
  return typeof input === "object" && input !== null ? issuedSuccessfulResults.get(input) : undefined;
}

export const canonicalizeSuccessfulResultV1Effect = Effect.fn(
  "CommitProtocol.canonicalizeSuccessfulResultV1",
)(function* (
  value: unknown,
): Effect.fn.Return<CanonicalSuccessfulResultV1, CommitProtocolV1Error> {
  const canonical = yield* canonicalizeRuntimeValueEffect(
    value,
    "successfulResult",
  );
  const result = yield* createCanonicalSuccessfulResultV1Effect(canonical);
  return issueCanonicalSuccessfulResultV1(result, canonical.value);
});

export const verifySuccessfulResultEvidenceV1Effect = Effect.fn(
  "CommitProtocol.verifySuccessfulResultEvidenceV1",
)(function* (
  input: unknown,
): Effect.fn.Return<CanonicalSuccessfulResultV1, CommitProtocolV1Error> {
  yield* inspectSuccessfulResultVersionEffect(input);
  const evidence = yield* decodeUnknownSuccessfulResultEvidenceV1(input).pipe(
    Effect.mapError(() => invalidSchemaError("successfulResult")),
  );
  const bytes = yield* decodeBase64UrlEffect(
    evidence.canonicalValueBase64Url,
    "successfulResult",
  );
  const parsed = yield* decodeUtf8JsonEffect(bytes, "successfulResult");
  const envelope = yield* decodeFlarexValueEnvelopeEffect(parsed);
  const canonical = yield* canonicalizeJsonValueEffect(
    envelope.value,
    "successfulResult",
  );
  const verified = yield* createCanonicalSuccessfulResultV1Effect(canonical);
  if (!bytesEqual(bytes, verified.canonicalBytes)) {
    return yield* protocolFailureEffect({
      reason: "nonCanonical",
      component: "successfulResult",
    });
  }
  if (verified.evidence.sha256Hex !== evidence.sha256Hex) {
    return yield* protocolFailureEffect({
      reason: "digestMismatch",
      component: "successfulResult",
    });
  }
  return issueCanonicalSuccessfulResultV1(verified, canonical.value);
});

export const makeCommitEnvelopeV1Effect = Effect.fn(
  "CommitProtocol.makeCommitEnvelopeV1",
)(function* (
  input: unknown,
): Effect.fn.Return<CommitEnvelopeV1, CommitProtocolV1Error> {
  yield* inspectProtocolHeaderEffect(
    input,
    "envelope",
    COMMIT_ENVELOPE_FORMAT_V1,
  );
  const encoded = yield* encodeUnknownCommitEnvelopeV1(input).pipe(
    Effect.mapError(() => invalidSchemaError("envelope")),
  );
  const envelope = yield* decodeUnknownCommitEnvelopeV1(encoded).pipe(
    Effect.mapError(() => invalidSchemaError("envelope")),
  );
  yield* validateEnvelopeEvidenceBudgetEffect(envelope);
  return freezeOwnedProtocolProjection(envelope);
});

export const decodeCommitEnvelopeV1Effect = Effect.fn(
  "CommitProtocol.decodeCommitEnvelopeV1",
)(function* (
  input: unknown,
): Effect.fn.Return<CommitEnvelopeV1, CommitProtocolV1Error> {
  yield* inspectProtocolHeaderEffect(
    input,
    "envelope",
    COMMIT_ENVELOPE_FORMAT_V1,
  );
  const envelope = yield* decodeUnknownCommitEnvelopeV1(input).pipe(
    Effect.mapError(() => invalidSchemaError("envelope")),
  );
  yield* validateEnvelopeEvidenceBudgetEffect(envelope);
  return freezeOwnedProtocolProjection(envelope);
});

/**
 * The only operational carriage accepted before C07A. C04 must still reload
 * the exact C03-owned journal/result/final-sequence evidence and compare it;
 * this discriminant check does not authenticate content by itself.
 */
export const requireStoredForSessionAttemptCommitEnvelopeV1Effect = Effect.fn(
  "CommitProtocol.requireStoredForSessionAttemptEnvelopeV1",
)(function* (
  input: CommitEnvelopeV1,
): Effect.fn.Return<
  StoredForSessionAttemptCommitEnvelopeV1,
  CommitProtocolV1Error
> {
  const envelope = yield* makeCommitEnvelopeV1Effect(input);
  if (envelope.journal.kind !== "storedForSessionAttempt") {
    return yield* protocolFailureEffect({
      reason: "inlineJournalCarriageDormant",
    });
  }
  return Object.freeze({
    format: envelope.format,
    protocolVersion: envelope.protocolVersion,
    sessionId: envelope.sessionId,
    attemptFence: envelope.attemptFence,
    finalSyscallSequence: envelope.finalSyscallSequence,
    journal: envelope.journal,
    journalSha256Hex: envelope.journalSha256Hex,
    successfulResult: envelope.successfulResult,
  } satisfies StoredForSessionAttemptCommitEnvelopeV1);
});

type AppJournalFields = Pick<SessionJournal,
  "protocolVersion" | "valueCodecVersion" | "finalSyscallSequence" |
  "readDependencies" | "readUsage" | "writes">;

const normalizeAppJournalFieldsEffect = Effect.fn(function* (
  journal: AppJournalFields,
): Effect.fn.Return<AppJournalFields, CommitProtocolV1Error> {
  yield* enforceLimitEffect(
    "readDocuments",
    journal.readUsage.documentsRead,
    MAX_COMMIT_READ_DOCUMENTS_V1,
  );
  yield* enforceLimitEffect(
    "readSemanticBytes",
    journal.readUsage.semanticBytesRead,
    MAX_COMMIT_READ_SEMANTIC_BYTES_V1,
  );
  yield* enforceLimitEffect(
    "writeOperations",
    journal.writes.length,
    MAX_COMMIT_WRITE_OPERATIONS_V1,
  );

  const pointDependencies = journal.readDependencies.filter(
    (dependency) => dependency.kind === "appRowPoint",
  );
  const indexedDependencies = journal.readDependencies.filter(
    (dependency) => dependency.kind === "appIndexRange",
  );
  const applicationRelationDependencies = journal.readDependencies.filter(
    (dependency) => dependency.kind === "appRelationIncoming",
  );
  const metadataDependencies = journal.readDependencies.filter(
    (dependency) => dependency.kind === "metadata",
  );
  yield* enforceLimitEffect("metadataReadDependencies", metadataDependencies.length,
    MAX_COMMIT_METADATA_READ_DEPENDENCIES);
  metadataDependencies.sort((left, right) => compareUtf16Strings(
    logicalMetadataDependencyIdentity(left), logicalMetadataDependencyIdentity(right)));
  const normalizedMetadataDependencies: LogicalMetadataReadDependency[] = [];
  for (const dependency of metadataDependencies) {
    const previous = normalizedMetadataDependencies.at(-1);
    if (previous !== undefined && logicalMetadataDependencyIdentity(previous) === logicalMetadataDependencyIdentity(dependency)) {
      if (previous.capturedWatermark !== dependency.capturedWatermark || previous.observed.kind !== dependency.observed.kind ||
        previous.observed.kind === "present" && dependency.observed.kind === "present" &&
          previous.observed.semanticSha256Hex !== dependency.observed.semanticSha256Hex)
        return yield* Effect.fail(invalidSchemaError("journal"));
      continue;
    }
    normalizedMetadataDependencies.push(dependency);
  }
  yield* enforceLimitEffect(
    "pointReadDependencies",
    pointDependencies.length,
    MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
  );
  yield* enforceLimitEffect(
    "indexRangeReadDependencies",
    indexedDependencies.length,
    MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1,
  );
  yield* enforceLimitEffect(
    "relationReadDependencies",
    applicationRelationDependencies.length,
    MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1,
  );

  pointDependencies.sort((left, right) =>
    compareUtf16Strings(left.documentId, right.documentId)
  );
  const seenDependencies = new Set<AppDocumentIdV1>();
  for (const dependency of pointDependencies) {
    if (seenDependencies.has(dependency.documentId)) {
      return yield* protocolFailureEffect({
        reason: "duplicateReadDependency",
        documentId: dependency.documentId,
      });
    }
    seenDependencies.add(dependency.documentId);
    if (
      (dependency.observed.kind === "present" &&
        dependency.observed.revisionCommitSeq <= 0n) ||
      (dependency.observed.kind === "missing" &&
        dependency.observed.basis.kind === "tombstone" &&
        dependency.observed.basis.revisionCommitSeq <= 0n)
    ) {
      return yield* protocolFailureEffect({
        reason: "invalidRevisionCommitSeq",
        documentId: dependency.documentId,
      });
    }
  }
  const mergedIndexedDependencies = yield* Effect.fromResult(
    normalizeLogicalIndexRangeReadDependenciesV1Result(indexedDependencies),
  );
  yield* enforceLimitEffect(
    "indexRangeReadDependencies",
    mergedIndexedDependencies.length,
    MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1,
  );
  let indexedDependencyEvidenceBytes = 0;
  for (const dependency of mergedIndexedDependencies) {
    indexedDependencyEvidenceBytes += yield* Effect.fromResult(
      measureLogicalIndexRangeReadDependencyEvidenceBytesV1Result(dependency),
    );
  }
  yield* enforceLimitEffect(
    "indexRangeDependencyEvidenceBytes",
    indexedDependencyEvidenceBytes,
    MAX_COMMIT_INDEX_RANGE_DEPENDENCY_EVIDENCE_BYTES_V1,
  );
  applicationRelationDependencies.sort(
    compareApplicationRelationReadDependenciesV1,
  );
  const normalizedApplicationRelationDependencies:
    LogicalApplicationRelationIncomingReadDependencyV1[] = [];
  const activeRelationSelection = applicationRelationDependencies[0];
  for (const dependency of applicationRelationDependencies) {
    const previousApplicationRelationDependency =
      normalizedApplicationRelationDependencies.at(-1);
    if (
      previousApplicationRelationDependency !== undefined &&
      sameApplicationRelationReadIdentityV1(
        previousApplicationRelationDependency,
        dependency,
      )
    ) {
      if (
        previousApplicationRelationDependency.observedAdjacencyVersion !==
          dependency.observedAdjacencyVersion ||
        !sameApplicationRelationActiveSelectionV1(
          previousApplicationRelationDependency,
          dependency,
        )
      ) {
        return yield* protocolFailureEffect({
          reason: "conflictingApplicationRelationReadDependency",
          edgeDefinitionId: dependency.edgeDefinitionId,
          targetRowId: dependency.targetRowId,
        });
      }
      continue;
    }
    if (
      activeRelationSelection !== undefined &&
      !sameApplicationRelationActiveSelectionV1(
        activeRelationSelection,
        dependency,
      )
    ) {
      return yield* protocolFailureEffect({
        reason: "conflictingApplicationRelationActiveSelection",
        edgeDefinitionId: dependency.edgeDefinitionId,
        targetRowId: dependency.targetRowId,
      });
    }
    normalizedApplicationRelationDependencies.push(dependency);
  }
  yield* enforceLimitEffect(
    "relationReadDependencies",
    normalizedApplicationRelationDependencies.length,
    MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1,
  );
  const readDependencies: LogicalReadDependencyV1[] = [
    ...pointDependencies,
    ...mergedIndexedDependencies,
    ...normalizedApplicationRelationDependencies,
    ...normalizedMetadataDependencies,
  ];

  const orderedWrites = [...journal.writes].toSorted((left, right) =>
    left.syscallSequence < right.syscallSequence
      ? -1
      : left.syscallSequence > right.syscallSequence
        ? 1
        : compareUtf16Strings(left.documentId, right.documentId)
  );
  const writes: LogicalAppWriteV1[] = [];
  const seenWriteSequences = new Set<CommitSyscallSequenceV1>();
  let writeSemanticBytes = 0;
  for (const write of orderedWrites) {
    if (seenWriteSequences.has(write.syscallSequence)) {
      return yield* protocolFailureEffect({
        reason: "duplicateWriteSequence",
        syscallSequence: write.syscallSequence,
      });
    }
    seenWriteSequences.add(write.syscallSequence);
    if (write.syscallSequence > journal.finalSyscallSequence) {
      return yield* protocolFailureEffect({ reason: "sequenceMismatch" });
    }
    const normalizedWrite = yield* normalizeLogicalAppWriteV1Effect(write);
    if (normalizedWrite.kind !== "delete") {
      yield* enforceLimitEffect(
        "writeSemanticBytes",
        normalizedWrite.resultingDocumentSemanticBytes,
        MAX_FLAREX_APP_DOCUMENT_SEMANTIC_BYTES_V1,
      );
      writeSemanticBytes += normalizedWrite.resultingDocumentSemanticBytes;
      yield* enforceLimitEffect(
        "writeSemanticBytes",
        writeSemanticBytes,
        MAX_COMMIT_WRITE_SEMANTIC_BYTES_V1,
      );
    }
    writes.push(normalizedWrite);
  }

  if (
    journal.finalSyscallSequence === 0n &&
    (readDependencies.some(dependency => dependency.kind !== "metadata") ||
      journal.readUsage.documentsRead > 0 ||
      journal.readUsage.semanticBytesRead > 0 ||
      writes.length > 0)
  ) {
    return yield* protocolFailureEffect({ reason: "sequenceMismatch" });
  }

  return freezeOwnedProtocolProjection({
    protocolVersion: journal.protocolVersion,
    valueCodecVersion: journal.valueCodecVersion,
    finalSyscallSequence: journal.finalSyscallSequence,
    readDependencies,
    readUsage: {
      documentsRead: journal.readUsage.documentsRead,
      semanticBytesRead: journal.readUsage.semanticBytesRead,
    },
    writes,
  } satisfies AppJournalFields);
});

function compareApplicationRelationReadDependenciesV1(
  left: LogicalApplicationRelationIncomingReadDependencyV1,
  right: LogicalApplicationRelationIncomingReadDependencyV1,
): number {
  if (left.edgeDefinitionId !== right.edgeDefinitionId) {
    return left.edgeDefinitionId - right.edgeDefinitionId;
  }
  return compareUtf16Strings(left.targetRowId, right.targetRowId);
}

function sameApplicationRelationReadIdentityV1(
  left: LogicalApplicationRelationIncomingReadDependencyV1,
  right: LogicalApplicationRelationIncomingReadDependencyV1,
): boolean {
  return left.edgeDefinitionId === right.edgeDefinitionId &&
    left.targetRowId === right.targetRowId;
}

function sameApplicationRelationActiveSelectionV1(
  left: LogicalApplicationRelationIncomingReadDependencyV1,
  right: LogicalApplicationRelationIncomingReadDependencyV1,
): boolean {
  return left.activationSequence === right.activationSequence &&
    left.activeHeadSha256Hex === right.activeHeadSha256Hex;
}

export function normalizeLogicalIndexRangeReadDependenciesV1Result(
  input: ReadonlyArray<LogicalIndexRangeReadDependencyV1>,
): Result.Result<
  ReadonlyArray<LogicalIndexRangeReadDependencyV1>,
  CommitProtocolV1Error
> {
  const indexedDependencies = [...input].toSorted(compareIndexRangeDependenciesV1);
  const merged: LogicalIndexRangeReadDependencyV1[] = [];
  for (const dependency of indexedDependencies) {
    if (!isValidIndexRangeDependencyV1(dependency)) {
      return Result.fail(new CommitProtocolV1Error({
        issue: {
          reason: "invalidIndexRangeDependency",
          indexDefinitionId: dependency.indexDefinitionId,
        },
      }));
    }
    const previous = merged.at(-1);
    if (
      previous !== undefined &&
      sameIndexRangeAuthorityV1(previous, dependency) &&
      indexRangeDependenciesTouchOrOverlapV1(previous, dependency)
    ) {
      merged[merged.length - 1] = Object.freeze({
        ...previous,
        upper: maximumIndexRangeUpperBoundV1(
          previous.upper,
          dependency.upper,
        ),
      });
    } else {
      merged.push(Object.freeze({ ...dependency }));
    }
  }
  return Result.succeed(Object.freeze(merged));
}

export function measureLogicalIndexRangeReadDependencyEvidenceBytesV1Result(
  dependency: LogicalIndexRangeReadDependencyV1,
): Result.Result<number, CommitProtocolV1Error> {
  return encodeUnknownLogicalIndexRangeReadDependencyV1Result(dependency).pipe(
    Result.mapError(() => invalidSchemaError("journal")),
    Result.flatMap((encoded) =>
      decodeUnknownJsonValueResult(encoded).pipe(
        Result.mapError(() => invalidSchemaError("journal")),
      )
    ),
    Result.map((json) =>
      TEXT_ENCODER.encode(
        encodeCanonicalJson(json, commitJsonEncodingInvariantFailure),
      ).byteLength
    ),
  );
}

function compareIndexRangeDependenciesV1(
  left: LogicalIndexRangeReadDependencyV1,
  right: LogicalIndexRangeReadDependencyV1,
): number {
  if (left.tableId !== right.tableId) return left.tableId - right.tableId;
  if (left.indexDefinitionId !== right.indexDefinitionId) {
    return left.indexDefinitionId - right.indexDefinitionId;
  }
  const digestOrder = compareUtf16Strings(
    left.physicalSpecSha256Hex,
    right.physicalSpecSha256Hex,
  );
  if (digestOrder !== 0) return digestOrder;
  if (left.lower === null) return right.lower === null ? 0 : -1;
  if (right.lower === null) return 1;
  return compareUtf16Strings(left.lower.encodedKey, right.lower.encodedKey);
}

function sameIndexRangeAuthorityV1(
  left: LogicalIndexRangeReadDependencyV1,
  right: LogicalIndexRangeReadDependencyV1,
): boolean {
  return left.tableId === right.tableId &&
    left.indexDefinitionId === right.indexDefinitionId &&
    left.keyCodecVersion === right.keyCodecVersion &&
    left.physicalSpecSha256Hex === right.physicalSpecSha256Hex &&
    left.direction === right.direction;
}

function isValidIndexRangeDependencyV1(
  dependency: LogicalIndexRangeReadDependencyV1,
): boolean {
  if (dependency.upper === null || dependency.lower === null) return true;
  const keyOrder = compareUtf16Strings(
    dependency.lower.encodedKey,
    dependency.upper.encodedKey,
  );
  return dependency.upper.kind === "position" ? keyOrder <= 0 : keyOrder < 0;
}

function indexRangeDependenciesTouchOrOverlapV1(
  left: LogicalIndexRangeReadDependencyV1,
  right: LogicalIndexRangeReadDependencyV1,
): boolean {
  if (left.upper === null || right.lower === null) return true;
  return compareUtf16Strings(
    left.upper.encodedKey,
    right.lower.encodedKey,
  ) >= 0;
}

function maximumIndexRangeUpperBoundV1(
  left: LogicalIndexRangeReadDependencyV1["upper"],
  right: LogicalIndexRangeReadDependencyV1["upper"],
): LogicalIndexRangeReadDependencyV1["upper"] {
  if (left === null || right === null) return null;
  const keyOrder = compareUtf16Strings(left.encodedKey, right.encodedKey);
  if (keyOrder !== 0) return keyOrder > 0 ? left : right;
  if (left.kind === "key") return right;
  if (right.kind === "key") return left;
  return compareUtf16Strings(left.rowId, right.rowId) >= 0 ? left : right;
}

const normalizeLogicalAppWriteV1Effect = Effect.fn(function* (
  write: LogicalAppWriteV1,
): Effect.fn.Return<LogicalAppWriteV1, CommitProtocolV1Error> {
  switch (write.kind) {
    case "insert": {
      const fieldsValueJson = yield* normalizeDeveloperDocumentFieldsEffect(
        write.documentId,
        write.fieldsValueJson,
      );
      return Object.freeze({
        kind: "insert",
        syscallSequence: write.syscallSequence,
        documentId: write.documentId,
        creationTime: AppCreationTimeV1Schema.make(write.creationTime),
        fieldsValueJson,
        resultingDocumentSemanticBytes:
          write.resultingDocumentSemanticBytes,
      });
    }
    case "replace": {
      const fieldsValueJson = yield* normalizeDeveloperDocumentFieldsEffect(
        write.documentId,
        write.fieldsValueJson,
      );
      return Object.freeze({
        kind: "replace",
        syscallSequence: write.syscallSequence,
        documentId: write.documentId,
        fieldsValueJson,
        resultingDocumentSemanticBytes:
          write.resultingDocumentSemanticBytes,
      });
    }
    case "patch": {
      yield* enforceLimitEffect(
        "patchFields",
        write.changes.length,
        MAX_FLAREX_VALUE_OBJECT_FIELDS_V1,
      );
      const orderedChanges = [...write.changes].toSorted((left, right) =>
        compareUtf16Strings(left.field, right.field)
      );
      const seenFields = new Set<string>();
      const changes: LogicalPatchFieldV1[] = [];
      for (const change of orderedChanges) {
        if (seenFields.has(change.field)) {
          return yield* protocolFailureEffect({
            reason: "duplicatePatchField",
            documentId: write.documentId,
            field: change.field,
          });
        }
        seenFields.add(change.field);
        yield* rejectSystemFieldEffect(write.documentId, change.field);
        const normalizedField = yield* normalizePatchFieldEffect(change);
        changes.push(normalizedField);
      }
      return Object.freeze({
        kind: "patch",
        syscallSequence: write.syscallSequence,
        documentId: write.documentId,
        changes: Object.freeze(changes),
        resultingDocumentSemanticBytes:
          write.resultingDocumentSemanticBytes,
      });
    }
    case "delete":
      return Object.freeze({
        kind: "delete",
        syscallSequence: write.syscallSequence,
        documentId: write.documentId,
      });
    default:
      return assertNever(write);
  }
});

const normalizeDeveloperDocumentFieldsEffect = Effect.fn(function* (
  documentId: AppDocumentIdV1,
  valueJson: JsonObject,
): Effect.fn.Return<JsonObject, CommitProtocolV1Error> {
  const systemFields: ReadonlyArray<"_id" | "_creationTime"> = [
    "_id",
    "_creationTime",
  ];
  for (const field of systemFields) {
    if (Object.hasOwn(valueJson, field)) {
      return yield* protocolFailureEffect({
        reason: "developerAuthoredSystemField",
        documentId,
        field,
      });
    }
  }
  const normalized = yield* normalizeValueJsonEffect(
    valueJson,
    "appDocument",
    "journal",
    `writes.${documentId}`,
  );
  if (!isJsonObject(normalized.valueJson)) {
    return yield* protocolFailureEffect({
      reason: "invalidValue",
      component: "journal",
      path: `writes.${documentId}`,
    });
  }
  return normalized.valueJson;
});

const normalizePatchFieldEffect = Effect.fn(function* (
  change: LogicalPatchFieldV1,
): Effect.fn.Return<LogicalPatchFieldV1, CommitProtocolV1Error> {
  const probe: JsonObject = {
    [change.field]: change.kind === "set" ? change.valueJson : null,
  };
  const normalized = yield* normalizeValueJsonEffect(
    probe,
    "appDocument",
    "journal",
    `patch.${change.field}`,
  );
  if (!isJsonObject(normalized.valueJson)) {
    return yield* protocolFailureEffect({
      reason: "invalidValue",
      component: "journal",
      path: `patch.${change.field}`,
    });
  }
  const normalizedValue = normalized.valueJson[change.field];
  if (normalizedValue === undefined) {
    return yield* protocolFailureEffect({
      reason: "invalidValue",
      component: "journal",
      path: `patch.${change.field}`,
    });
  }
  return change.kind === "set"
    ? Object.freeze({
        kind: "set",
        field: change.field,
        valueJson: normalizedValue,
      })
    : Object.freeze({ kind: "remove", field: change.field });
});

const rejectSystemFieldEffect = Effect.fn(function* (
  documentId: AppDocumentIdV1,
  field: string,
): Effect.fn.Return<void, CommitProtocolV1Error> {
  if (field === "_id" || field === "_creationTime") {
    return yield* protocolFailureEffect({
      reason: "developerAuthoredSystemField",
      documentId,
      field,
    });
  }
});

const normalizeValueJsonEffect = Effect.fn((
  valueJson: Json,
  profile: FlarexValueProfileV1,
  component: "journal" | "successfulResult",
  path: string,
): Effect.Effect<NormalizedFlarexValueV1, CommitProtocolV1Error> =>
  Effect.try({
    try: () => normalizeFlarexValueJsonV1(valueJson, profile),
    catch: (cause): unknown => cause,
  }).pipe(
    Effect.catch((cause: unknown) =>
      cause instanceof FlarexValueCodecV1Error
        ? Effect.fail(new CommitProtocolV1Error({
            issue: { reason: "invalidValue", component, path },
          }))
        : Effect.die(cause)
    ),
  ));

const canonicalizeRuntimeValueEffect = Effect.fn((
  value: unknown,
  component: "successfulResult",
): Effect.Effect<CanonicalFlarexValueV1, CommitProtocolV1Error> =>
  Effect.tryPromise({
    try: () => canonicalizeFlarexValueV1(value),
    catch: (cause): unknown => cause,
  }).pipe(
    Effect.catch((cause: unknown) =>
      canonicalValueFailureEffect(cause, component)
    ),
  ));

const canonicalizeJsonValueEffect = Effect.fn((
  valueJson: Json,
  component: "successfulResult",
): Effect.Effect<CanonicalFlarexValueV1, CommitProtocolV1Error> =>
  Effect.tryPromise({
    try: () => canonicalizeFlarexValueJsonV1(valueJson),
    catch: (cause): unknown => cause,
  }).pipe(
    Effect.catch((cause: unknown) =>
      canonicalValueFailureEffect(cause, component)
    ),
  ));

const createCanonicalSuccessfulResultV1Effect = Effect.fn(function* (
  canonical: CanonicalFlarexValueV1,
): Effect.fn.Return<CanonicalSuccessfulResultV1, CommitProtocolV1Error> {
  yield* enforceLimitEffect(
    "resultSemanticBytes",
    canonical.semanticSizeBytes,
    MAX_COMMIT_RESULT_SEMANTIC_BYTES_V1,
  );
  yield* enforceLimitEffect(
    "canonicalEvidenceBytes",
    canonical.canonicalBytes.byteLength,
    MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1,
  );
  const stableCanonicalBytes = new Uint8Array(canonical.canonicalBytes);
  const evidence = freezeOwnedProtocolProjection({
    valueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
    canonicalValueBase64Url:
      CanonicalSuccessfulResultBase64UrlV1Schema.make(
        Encoding.encodeBase64Url(stableCanonicalBytes),
      ),
    sha256Hex: SuccessfulResultSha256HexV1Schema.make(
      encodeBytesToLowercaseHex(canonical.sha256),
    ),
  } satisfies SuccessfulResultEvidenceV1);
  const stableValueJson = freezeOwnedProtocolProjection(canonical.valueJson);

  const result = Object.freeze({
    valueJson: stableValueJson,
    semanticSizeBytes: canonical.semanticSizeBytes,
    canonicalText: canonical.canonicalText,
    get canonicalBytes(): CanonicalSuccessfulResultBytesV1 {
      return CanonicalSuccessfulResultBytesV1Schema.make(
        new Uint8Array(stableCanonicalBytes),
      );
    },
    evidence,
  } satisfies CanonicalSuccessfulResultV1);
  return result;
});

/** Foreign evidence reaches this issuer only after exact bytes and digest have
 * been verified. The canonical runtime tree has never escaped its constructor. */
function issueCanonicalSuccessfulResultV1(
  result: CanonicalSuccessfulResultV1,
  runtimeValue: CanonicalFlarexRuntimeValueV1,
): CanonicalSuccessfulResultV1 {
  const readRuntimeValue = createOwnedCanonicalFlarexRuntimeValueReaderV1(runtimeValue);
  issuedSuccessfulResults.set(result, Object.freeze({
    result,
    get value(): CanonicalFlarexRuntimeValueV1 {
      return readRuntimeValue();
    },
  } satisfies IssuedCanonicalSuccessfulResultV1));
  return result;
}

const decodeUnknownFlarexValueEnvelopeV1 = Schema.decodeUnknownEffect(
  FlarexValueEnvelopeV1Schema,
  StrictParseOptions,
);

const decodeFlarexValueEnvelopeEffect = Effect.fn((input: unknown) =>
  decodeUnknownFlarexValueEnvelopeV1(input).pipe(
    Effect.map((envelope) => ({ ...envelope })),
    Effect.mapError(() => invalidSchemaError("successfulResult")),
  ));

const inspectProtocolHeaderEffect = Effect.fn(function* (
  input: unknown,
  component: "journal" | "envelope",
  expectedFormat:
    | typeof SESSION_JOURNAL_FORMAT
    | typeof COMMIT_ENVELOPE_FORMAT_V1,
): Effect.fn.Return<void, CommitProtocolV1Error> {
  if (!isRecord(input) || input.format !== expectedFormat) {
    return yield* protocolFailureEffect({
      reason: "invalidFormat",
      component,
    });
  }
  if (input.protocolVersion !== 1) {
    return yield* protocolFailureEffect({
      reason: "unsupportedVersion",
      component,
      field: "protocolVersion",
    });
  }
  if (
    component === "journal" &&
    input.valueCodecVersion !== 1
  ) {
    return yield* protocolFailureEffect({
      reason: "unsupportedVersion",
      component,
      field: "valueCodecVersion",
    });
  }
});

const inspectSuccessfulResultVersionEffect = Effect.fn(function* (
  input: unknown,
): Effect.fn.Return<void, CommitProtocolV1Error> {
  if (
    isRecord(input) &&
    Object.hasOwn(input, "valueCodecVersion") &&
    input.valueCodecVersion !== 1
  ) {
    return yield* protocolFailureEffect({
      reason: "unsupportedVersion",
      component: "successfulResult",
      field: "valueCodecVersion",
    });
  }
});

const decodeUtf8JsonEffect = Effect.fn(function* (
  bytes: Uint8Array,
  component: "journal" | "successfulResult",
): Effect.fn.Return<unknown, CommitProtocolV1Error> {
  const text = yield* Effect.try({
    try: () => TEXT_DECODER.decode(bytes),
    catch: () =>
      new CommitProtocolV1Error({
        issue: { reason: "invalidUtf8", component },
      }),
  });
  return yield* Effect.try({
    try: (): unknown => JSON.parse(text),
    catch: () =>
      new CommitProtocolV1Error({
        issue: { reason: "invalidJson", component },
      }),
  });
});

const sha256HexEffect = Effect.fn(function* (
  bytes: Uint8Array,
  component: "journal" | "successfulResult",
): Effect.fn.Return<
  SessionJournalSha256HexV1,
  CommitProtocolV1Error
> {
  const digestInput = copyBytesToArrayBuffer(bytes);
  const digestBuffer = yield* Effect.tryPromise({
    try: () => crypto.subtle.digest("SHA-256", digestInput),
    catch: () =>
      new CommitProtocolV1Error({
        issue: { reason: "digestUnavailable", component },
      }),
  });
  const digest = new Uint8Array(digestBuffer);
  return SessionJournalSha256HexV1Schema.make(
    encodeBytesToLowercaseHex(digest),
  );
});

const decodeBase64UrlEffect = Effect.fn(function* (
  value: string,
  component: "journal" | "successfulResult",
): Effect.fn.Return<Uint8Array, CommitProtocolV1Error> {
  if (
    value.length > MAX_COMMIT_CANONICAL_EVIDENCE_BASE64URL_CHARACTERS_V1
  ) {
    return yield* protocolFailureEffect({
      reason: "invalidBase64Url",
      component,
    });
  }
  return yield* Effect.fromResult(decodeCanonicalBase64Url(
    value,
    MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1,
  )).pipe(
    Effect.mapError((issue) =>
      commitBase64UrlDecodeError(component, issue)
    ),
  );
});

function commitBase64UrlDecodeError(
  component: "journal" | "successfulResult",
  issue: CanonicalBase64UrlDecodeIssue,
): CommitProtocolV1Error {
  return new CommitProtocolV1Error({
    issue: issue.reason === "tooLarge"
      ? {
          reason: "limitExceeded",
          dimension: "canonicalEvidenceBytes",
          observed: issue.observedBytes,
          maximum: issue.maximumBytes,
        }
      : { reason: "invalidBase64Url", component },
  });
}

const validateEnvelopeEvidenceBudgetEffect = Effect.fn(function* (
  envelope: CommitEnvelopeV1,
): Effect.fn.Return<void, CommitProtocolV1Error> {
  const resultBytes = base64UrlDecodedLength(
    envelope.successfulResult.canonicalValueBase64Url,
  );
  const inlineJournalBytes = envelope.journal.kind === "inlineUntrusted"
    ? base64UrlDecodedLength(envelope.journal.canonicalJournalBase64Url)
    : 0;
  yield* enforceLimitEffect(
    "canonicalEvidenceBytes",
    resultBytes + inlineJournalBytes,
    MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1,
  );
});

interface CommitCandidateBudget {
  bytes: number;
}

/**
 * Bound unknown object-graph work before Schema encodes or copies it. Exact
 * semantic and canonical limits are still checked after strict decoding.
 */
function preflightSessionJournalCandidate(
  input: unknown,
): CommitProtocolV1Issue | undefined {
  if (!isRecord(input)) return undefined;

  if (
    Array.isArray(input.readDependencies) &&
    input.readDependencies.length >
      MAX_COMMIT_POINT_READ_DEPENDENCIES_V1 +
        MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1 +
        MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1 + MAX_COMMIT_METADATA_READ_DEPENDENCIES
  ) {
    return {
      reason: "invalidSchema",
      component: "journal",
    };
  }
  if (
    Array.isArray(input.writes) &&
    input.writes.length > MAX_COMMIT_WRITE_OPERATIONS_V1
  ) {
    return {
      reason: "limitExceeded",
      dimension: "writeOperations",
      observed: input.writes.length,
      maximum: MAX_COMMIT_WRITE_OPERATIONS_V1,
    };
  }
  if (Array.isArray(input.participantOperations)) {
    if (input.participantOperations.length > MAX_COMMIT_WRITE_OPERATIONS_V1) {
      return {
        reason: "limitExceeded",
        dimension: "writeOperations",
        observed: input.participantOperations.length,
        maximum: MAX_COMMIT_WRITE_OPERATIONS_V1,
      };
    }
    let effects = Array.isArray(input.writes) ? input.writes.length : 0;
    for (const operation of input.participantOperations) {
      if (!isRecord(operation) || !Array.isArray(operation.sourceContributions) ||
        !Array.isArray(operation.eventIntents)) {
        return { reason: "invalidSchema", component: "journal" };
      }
      if (operation.sourceContributions.length > 3) {
        return { reason: "invalidSchema", component: "journal" };
      }
      for (const source of operation.sourceContributions) {
        if (!isRecord(source) || !Array.isArray(source.effects)) {
          return { reason: "invalidSchema", component: "journal" };
        }
        effects += source.effects.length;
      }
      if (effects > MAX_COMMIT_WRITE_OPERATIONS_V1 ||
        operation.eventIntents.length > 2_048) {
        return { reason: "invalidSchema", component: "journal" };
      }
    }
  }
  if (isRecord(input.readUsage)) {
    const documentsRead = input.readUsage.documentsRead;
    if (
      typeof documentsRead === "number" &&
      Number.isFinite(documentsRead) &&
      documentsRead > MAX_COMMIT_READ_DOCUMENTS_V1
    ) {
      return {
        reason: "limitExceeded",
        dimension: "readDocuments",
        observed: documentsRead,
        maximum: MAX_COMMIT_READ_DOCUMENTS_V1,
      };
    }
    const semanticBytesRead = input.readUsage.semanticBytesRead;
    if (
      typeof semanticBytesRead === "number" &&
      Number.isFinite(semanticBytesRead) &&
      semanticBytesRead > MAX_COMMIT_READ_SEMANTIC_BYTES_V1
    ) {
      return {
        reason: "limitExceeded",
        dimension: "readSemanticBytes",
        observed: semanticBytesRead,
        maximum: MAX_COMMIT_READ_SEMANTIC_BYTES_V1,
      };
    }
  }

  return measureUnknownCommitCandidate(
    input,
    { bytes: 0 },
    new WeakSet<object>(),
    0,
  );
}

function measureUnknownCommitCandidate(
  value: unknown,
  budget: CommitCandidateBudget,
  ancestors: WeakSet<object>,
  depth: number,
): CommitProtocolV1Issue | undefined {
  if (depth > MAX_COMMIT_CANDIDATE_NESTING_V1) {
    return { reason: "invalidSchema", component: "journal" };
  }
  if (value === null) return chargeCommitCandidateBytes(budget, 4);

  switch (typeof value) {
    case "string":
      if (value.length > MAX_COMMIT_WRITE_SEMANTIC_BYTES_V1) {
        return { reason: "invalidSchema", component: "journal" };
      }
      return chargeJsonStringBytes(budget, value);
    case "number": {
      const encoded = JSON.stringify(value);
      return chargeCommitCandidateBytes(
        budget,
        encoded === undefined ? 4 : encoded.length,
      );
    }
    case "boolean":
      return chargeCommitCandidateBytes(budget, value ? 4 : 5);
    case "bigint":
      if (value < MIN_SIGNED_INT64 || value > MAX_SIGNED_INT64) {
        return { reason: "invalidSchema", component: "journal" };
      }
      return chargeCommitCandidateBytes(budget, value.toString().length + 2);
    case "undefined":
    case "symbol":
    case "function":
      return { reason: "invalidSchema", component: "journal" };
    case "object":
      break;
  }

  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return { reason: "invalidSchema", component: "journal" };
  }
  if (ancestors.has(value)) {
    return { reason: "invalidSchema", component: "journal" };
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_COMMIT_CANDIDATE_ARRAY_ITEMS_V1) {
        return { reason: "invalidSchema", component: "journal" };
      }
      const containerIssue = chargeCommitCandidateBytes(
        budget,
        2 + Math.max(0, value.length - 1),
      );
      if (containerIssue !== undefined) return containerIssue;
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) {
          return { reason: "invalidSchema", component: "journal" };
        }
        const itemIssue = measureUnknownCommitCandidate(
          value[index],
          budget,
          ancestors,
          depth + 1,
        );
        if (itemIssue !== undefined) return itemIssue;
      }
      return undefined;
    }

    if (!isRecord(value)) {
      return { reason: "invalidSchema", component: "journal" };
    }
    const entries: Array<readonly [string, unknown]> = [];
    let enumeratedKeys = 0;
    for (const key in value) {
      enumeratedKeys += 1;
      if (enumeratedKeys > MAX_FLAREX_VALUE_OBJECT_FIELDS_V1) {
        return { reason: "invalidSchema", component: "journal" };
      }
      if (!Object.hasOwn(value, key)) continue;
      entries.push([key, value[key]]);
    }
    const containerIssue = chargeCommitCandidateBytes(
      budget,
      2 + Math.max(0, entries.length - 1) + entries.length,
    );
    if (containerIssue !== undefined) return containerIssue;
    for (const [key, item] of entries) {
      if (key.length > MAX_FLAREX_VALUE_OBJECT_FIELD_BYTES_V1) {
        return { reason: "invalidSchema", component: "journal" };
      }
      const keyIssue = chargeJsonStringBytes(budget, key);
      if (keyIssue !== undefined) return keyIssue;
      const itemIssue = measureUnknownCommitCandidate(
        item,
        budget,
        ancestors,
        depth + 1,
      );
      if (itemIssue !== undefined) return itemIssue;
    }
    return undefined;
  } finally {
    ancestors.delete(value);
  }
}

function chargeJsonStringBytes(
  budget: CommitCandidateBudget,
  value: string,
): CommitProtocolV1Issue | undefined {
  let issue = chargeCommitCandidateBytes(budget, 2);
  if (issue !== undefined) return issue;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    let bytes: number;
    if (code === 0x22 || code === 0x5c) {
      bytes = 2;
    } else if (code < 0x20) {
      bytes = code === 0x08 || code === 0x09 || code === 0x0a ||
          code === 0x0c || code === 0x0d
        ? 2
        : 6;
    } else if (code <= 0x7f) {
      bytes = 1;
    } else if (code <= 0x7ff) {
      bytes = 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes = 4;
        index += 1;
      } else {
        bytes = 6;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes = 6;
    } else {
      bytes = 3;
    }
    issue = chargeCommitCandidateBytes(budget, bytes);
    if (issue !== undefined) return issue;
  }
  return undefined;
}

function chargeCommitCandidateBytes(
  budget: CommitCandidateBudget,
  bytes: number,
): CommitProtocolV1Issue | undefined {
  const observed = budget.bytes + bytes;
  if (observed > MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1) {
    budget.bytes = MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1 + 1;
    return {
      reason: "limitExceeded",
      dimension: "canonicalEvidenceBytes",
      observed,
      maximum: MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1,
    };
  }
  budget.bytes = observed;
  return undefined;
}

function canonicalValueFailureEffect(
  cause: unknown,
  component: "successfulResult",
): Effect.Effect<never, CommitProtocolV1Error> {
  if (cause instanceof FlarexValueCodecV1Error) {
    return Effect.fail(new CommitProtocolV1Error({
      issue: {
        reason: "invalidValue",
        component,
        path: cause.issue.reason === "unsupportedValue"
          ? cause.issue.path
          : "$",
      },
    }));
  }
  if (typeof DOMException !== "undefined" && cause instanceof DOMException) {
    return Effect.fail(new CommitProtocolV1Error({
      issue: { reason: "digestUnavailable", component },
    }));
  }
  return Effect.die(cause);
}

function enforceLimitEffect(
  dimension: CommitProtocolV1LimitDimension,
  observed: number,
  maximum: number,
): Effect.Effect<void, CommitProtocolV1Error> {
  return observed <= maximum
    ? Effect.void
    : protocolFailureEffect({
        reason: "limitExceeded",
        dimension,
        observed,
        maximum,
      });
}

function protocolFailureEffect(
  issue: CommitProtocolV1Issue,
): Effect.Effect<never, CommitProtocolV1Error> {
  return Effect.fail(new CommitProtocolV1Error({ issue }));
}

function invalidSchemaError(
  component: CommitProtocolV1Component,
): CommitProtocolV1Error {
  return new CommitProtocolV1Error({
    issue: { reason: "invalidSchema", component },
  });
}

const COMMIT_JSON_ENCODING_INVARIANT_MESSAGES = {
  missingArrayItem: "Validated commit journal lost an array item.",
  missingObjectProperty:
    "Validated commit journal lost an object property.",
  primitiveEncodingFailed: "Validated commit journal could not be encoded.",
} as const satisfies Record<
  CanonicalJsonEncodingInvariantIssue["reason"],
  string
>;

function commitJsonEncodingInvariantFailure(
  issue: CanonicalJsonEncodingInvariantIssue,
): never {
  throw new Error(COMMIT_JSON_ENCODING_INVARIANT_MESSAGES[issue.reason]);
}

function base64UrlDecodedLength(value: string): number {
  return Math.floor((value.length * 3) / 4);
}

function assertNever(value: never): never {
  throw new Error(`Unreachable commit-protocol variant: ${String(value)}`);
}
