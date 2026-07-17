import {
  bytesEqual,
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { isNonArrayRecord as isRecord } from "@flarex/utils/records";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { Data, Effect, Encoding, Schema } from "effect";

import { AppCreationTimeV1Schema } from "./app-document";
import {
  AppDocumentIdV1Schema,
  type AppDocumentIdV1,
} from "./app-document-id";
import {
  encodeCanonicalJson,
  isJsonArray,
  isJsonObject,
  JsonValue,
  type CanonicalJsonEncodingInvariantIssue,
  type Json,
  type JsonObject,
} from "./json";
import {
  CanonicalNonNegativePostgresBigIntFromString,
  CanonicalPositivePostgresBigIntFromString,
} from "./postgres-bigint";
import { CommitSeqSchema, type CommitSeq } from "./storage-authority";
import {
  TransactionAttemptFenceSchema,
  TransactionSessionIdV1Schema,
  TransactionSessionProtocolVersionV1Schema,
  type TransactionAttemptFence,
  type TransactionSessionIdV1,
  type TransactionSessionProtocolVersionV1,
} from "./transaction-session";
import {
  FLAREX_VALUE_CODEC_VERSION_V1,
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
  type CanonicalFlarexValueV1,
  type FlarexValueCodecVersion,
  type FlarexValueProfileV1,
  type NormalizedFlarexValueV1,
} from "./value";

const StrictStructOptions: {
  readonly parseOptions: { readonly onExcessProperty: "error" };
} = { parseOptions: { onExcessProperty: "error" } };

const StrictParseOptions: {
  readonly onExcessProperty: "error";
} = { onExcessProperty: "error" };

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const LOWERCASE_SHA256_PATTERN = /^[0-9a-f]{64}$/;

export const SESSION_JOURNAL_FORMAT_V1 = "flarex.session-journal";
export const COMMIT_ENVELOPE_FORMAT_V1 = "flarex.commit-envelope";

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
export const MAX_COMMIT_WRITE_OPERATIONS_V1 = 16_000;
export const MAX_COMMIT_WRITE_SEMANTIC_BYTES_V1 = 1 << 24;
export const MAX_COMMIT_RESULT_SEMANTIC_BYTES_V1 = 1 << 24;

export interface CommitProtocolExecutionLimitsV1 {
  readonly readDocuments: number;
  readonly readSemanticBytes: number;
  readonly pointReadDependencies: number;
  readonly writeOperations: number;
  readonly writeSemanticBytes: number;
  readonly resultSemanticBytes: number;
}

export const COMMIT_PROTOCOL_EXECUTION_LIMITS_V1 = Object.freeze({
  readDocuments: MAX_COMMIT_READ_DOCUMENTS_V1,
  readSemanticBytes: MAX_COMMIT_READ_SEMANTIC_BYTES_V1,
  pointReadDependencies: MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
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
  readonly materialWriteEventEvidenceBytes: number;
}

export const COMMIT_PROTOCOL_OPERATIONAL_LIMITS_V1 = Object.freeze({
  canonicalEvidenceBytes: MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1,
  materialWriteEventEvidenceBytes:
    MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1,
} satisfies CommitProtocolOperationalLimitsV1);

const MAX_COMMIT_CANONICAL_EVIDENCE_BASE64URL_CHARACTERS_V1 =
  base64UrlMaximumCharacters(MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1);
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

export const LogicalReadDependencyV1Schema = Schema.Struct({
  kind: Schema.Literal("appRowPoint"),
  documentId: AppDocumentIdV1Schema,
  observed: Schema.Union([
    PresentReadObservationV1Schema,
    MissingReadObservationV1Schema,
  ]),
}).annotate(StrictStructOptions);
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

const AppDocumentFieldsJsonV1Schema = Schema.Record(
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

export const SessionJournalV1Schema = Schema.Struct({
  format: Schema.Literal(SESSION_JOURNAL_FORMAT_V1),
  protocolVersion: TransactionSessionProtocolVersionV1Schema,
  valueCodecVersion: FlarexValueCodecVersionSchema,
  finalSyscallSequence: CommitFinalSyscallSequenceV1Schema,
  readDependencies: Schema.Array(LogicalReadDependencyV1Schema),
  readUsage: SessionReadUsageV1Schema,
  writes: Schema.Array(LogicalAppWriteV1Schema),
}).annotate(StrictStructOptions);
export type SessionJournalV1 = typeof SessionJournalV1Schema.Type;

export const CanonicalSessionJournalBytesV1Schema =
  Schema.Uint8Array.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1),
  ).pipe(Schema.brand("FlarexDB/CanonicalSessionJournalBytesV1"));
export type CanonicalSessionJournalBytesV1 =
  typeof CanonicalSessionJournalBytesV1Schema.Type;

export const SessionJournalSha256HexV1Schema = Schema.String.check(
  Schema.isPattern(LOWERCASE_SHA256_PATTERN),
).pipe(Schema.brand("FlarexDB/SessionJournalSha256HexV1"));
export type SessionJournalSha256HexV1 =
  typeof SessionJournalSha256HexV1Schema.Type;

export const CanonicalSessionJournalBase64UrlV1Schema =
  Schema.String.check(
    Schema.isPattern(BASE64URL_PATTERN),
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
  Schema.String.check(
    Schema.isPattern(BASE64URL_PATTERN),
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

export interface CanonicalSessionJournalV1 {
  readonly journal: SessionJournalV1;
  readonly canonicalText: string;
  readonly canonicalBytes: CanonicalSessionJournalBytesV1;
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
  | "readDocuments"
  | "readSemanticBytes"
  | "pointReadDependencies"
  | "writeOperations"
  | "patchFields"
  | "writeSemanticBytes"
  | "resultSemanticBytes"
  | "materialWriteEventEvidenceBytes"
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
    }
  | {
      readonly reason: "inlineJournalCarriageRequired";
    };

export class CommitProtocolV1Error extends Data.TaggedError(
  "CommitProtocolV1Error",
)<{
  readonly issue: CommitProtocolV1Issue;
}> {}

export interface DecodeCanonicalSessionJournalV1Input {
  readonly canonicalBytes: unknown;
  readonly expectedSha256Hex: unknown;
}

const decodeUnknownSessionJournalV1 = Schema.decodeUnknownEffect(
  SessionJournalV1Schema,
  StrictParseOptions,
);
const encodeUnknownSessionJournalV1 = Schema.encodeUnknownEffect(
  SessionJournalV1Schema,
  StrictParseOptions,
);
const decodeUnknownCanonicalSessionJournalBytesV1 =
  Schema.decodeUnknownEffect(CanonicalSessionJournalBytesV1Schema);
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

export const canonicalizeSessionJournalV1Effect = Effect.fn(
  "CommitProtocol.canonicalizeSessionJournalV1",
)(function* (
  input: unknown,
): Effect.fn.Return<CanonicalSessionJournalV1, CommitProtocolV1Error> {
  yield* inspectProtocolHeaderEffect(
    input,
    "journal",
    SESSION_JOURNAL_FORMAT_V1,
  );
  const preflightIssue = preflightSessionJournalCandidate(input);
  if (preflightIssue !== undefined) {
    return yield* protocolFailureEffect(preflightIssue);
  }
  const encodedInput = yield* encodeUnknownSessionJournalV1(input).pipe(
    Effect.mapError(() => invalidSchemaError("journal")),
  );
  const detached = yield* decodeUnknownSessionJournalV1(encodedInput).pipe(
    Effect.mapError(() => invalidSchemaError("journal")),
  );
  const journal = yield* normalizeSessionJournalV1Effect(detached);
  const encoded = yield* encodeUnknownSessionJournalV1(journal).pipe(
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
  const stableJournal = deepFreezeCommitProjection(journal);
  return Object.freeze({
    journal: stableJournal,
    canonicalText,
    get canonicalBytes(): CanonicalSessionJournalBytesV1 {
      return CanonicalSessionJournalBytesV1Schema.make(
        new Uint8Array(stableCanonicalBytes),
      );
    },
    sha256Hex,
  } satisfies CanonicalSessionJournalV1);
});

export const decodeCanonicalSessionJournalV1Effect = Effect.fn(
  "CommitProtocol.decodeCanonicalSessionJournalV1",
)(function* (
  input: DecodeCanonicalSessionJournalV1Input,
): Effect.fn.Return<CanonicalSessionJournalV1, CommitProtocolV1Error> {
  const decodedBytes = yield* decodeUnknownCanonicalSessionJournalBytesV1(
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
    SESSION_JOURNAL_FORMAT_V1,
  );
  const decoded = yield* decodeUnknownSessionJournalV1(parsed).pipe(
    Effect.mapError(() => invalidSchemaError("journal")),
  );
  const canonical = yield* canonicalizeSessionJournalV1Effect(decoded);
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

export const canonicalizeSuccessfulResultV1Effect = Effect.fn(
  "CommitProtocol.canonicalizeSuccessfulResultV1",
)(function* (
  value: unknown,
): Effect.fn.Return<CanonicalSuccessfulResultV1, CommitProtocolV1Error> {
  const canonical = yield* canonicalizeRuntimeValueEffect(
    value,
    "successfulResult",
  );
  return yield* createCanonicalSuccessfulResultV1Effect(canonical);
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
  return verified;
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
  return deepFreezeCommitProjection(envelope);
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
  return deepFreezeCommitProjection(envelope);
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

/**
 * Integrity inspection only. A successful result does not authenticate these
 * bytes or make inline carriage operational. C07A must first establish a
 * non-forgeable supervisor/facet provenance boundary.
 */
export const inspectInlineUntrustedJournalIntegrityV1Effect = Effect.fn(
  "CommitProtocol.inspectInlineUntrustedJournalIntegrityV1",
)(function* (
  input: CommitEnvelopeV1,
): Effect.fn.Return<CanonicalSessionJournalV1, CommitProtocolV1Error> {
  const envelope = yield* makeCommitEnvelopeV1Effect(input);
  if (envelope.journal.kind !== "inlineUntrusted") {
    return yield* protocolFailureEffect({
      reason: "inlineJournalCarriageRequired",
    });
  }
  const bytes = yield* decodeBase64UrlEffect(
    envelope.journal.canonicalJournalBase64Url,
    "journal",
  );
  const journal = yield* decodeCanonicalSessionJournalV1Effect({
    canonicalBytes: bytes,
    expectedSha256Hex: envelope.journalSha256Hex,
  });
  if (
    journal.journal.protocolVersion !== envelope.protocolVersion ||
    journal.journal.finalSyscallSequence !== envelope.finalSyscallSequence
  ) {
    return yield* protocolFailureEffect({ reason: "sequenceMismatch" });
  }
  return journal;
});

const normalizeSessionJournalV1Effect = Effect.fn(function* (
  journal: SessionJournalV1,
): Effect.fn.Return<SessionJournalV1, CommitProtocolV1Error> {
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
    "pointReadDependencies",
    journal.readDependencies.length,
    MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
  );
  yield* enforceLimitEffect(
    "writeOperations",
    journal.writes.length,
    MAX_COMMIT_WRITE_OPERATIONS_V1,
  );

  const readDependencies = [...journal.readDependencies].sort((left, right) =>
    compareUtf16Strings(left.documentId, right.documentId)
  );
  const seenDependencies = new Set<AppDocumentIdV1>();
  for (const dependency of readDependencies) {
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

  const orderedWrites = [...journal.writes].sort((left, right) =>
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
    (readDependencies.length > 0 ||
      journal.readUsage.documentsRead > 0 ||
      journal.readUsage.semanticBytesRead > 0 ||
      writes.length > 0)
  ) {
    return yield* protocolFailureEffect({ reason: "sequenceMismatch" });
  }

  return deepFreezeCommitProjection({
    format: SESSION_JOURNAL_FORMAT_V1,
    protocolVersion: journal.protocolVersion,
    valueCodecVersion: journal.valueCodecVersion,
    finalSyscallSequence: journal.finalSyscallSequence,
    readDependencies,
    readUsage: {
      documentsRead: journal.readUsage.documentsRead,
      semanticBytesRead: journal.readUsage.semanticBytesRead,
    },
    writes,
  } satisfies SessionJournalV1);
});

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
      const orderedChanges = [...write.changes].sort((left, right) =>
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
  const evidence = deepFreezeCommitProjection({
    valueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
    canonicalValueBase64Url:
      CanonicalSuccessfulResultBase64UrlV1Schema.make(
        Encoding.encodeBase64Url(stableCanonicalBytes),
      ),
    sha256Hex: SuccessfulResultSha256HexV1Schema.make(
      encodeBytesToLowercaseHex(canonical.sha256),
    ),
  } satisfies SuccessfulResultEvidenceV1);
  const stableValueJson = deepFreezeCommitProjection(canonical.valueJson);

  return Object.freeze({
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
});

const FlarexValueEnvelopeV1Schema = Schema.Struct({
  format: Schema.Literal("flarex-value"),
  value: JsonValue,
  valueCodecVersion: Schema.Literal(1),
}).annotate(StrictStructOptions);

const decodeUnknownFlarexValueEnvelopeV1 = Schema.decodeUnknownEffect(
  FlarexValueEnvelopeV1Schema,
  StrictParseOptions,
);

const decodeFlarexValueEnvelopeEffect = Effect.fn((input: unknown) =>
  decodeUnknownFlarexValueEnvelopeV1(input).pipe(
    Effect.mapError(() => invalidSchemaError("successfulResult")),
  ));

const inspectProtocolHeaderEffect = Effect.fn(function* (
  input: unknown,
  component: "journal" | "envelope",
  expectedFormat:
    | typeof SESSION_JOURNAL_FORMAT_V1
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
    value.length === 0 ||
    value.length > MAX_COMMIT_CANONICAL_EVIDENCE_BASE64URL_CHARACTERS_V1 ||
    !BASE64URL_PATTERN.test(value) ||
    value.length % 4 === 1
  ) {
    return yield* protocolFailureEffect({
      reason: "invalidBase64Url",
      component,
    });
  }
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = yield* Effect.try({
    try: () => atob(value.replace(/-/g, "+").replace(/_/g, "/") + padding),
    catch: () =>
      new CommitProtocolV1Error({
        issue: { reason: "invalidBase64Url", component },
      }),
  });
  yield* enforceLimitEffect(
    "canonicalEvidenceBytes",
    binary.length,
    MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1,
  );
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  if (Encoding.encodeBase64Url(bytes) !== value) {
    return yield* protocolFailureEffect({
      reason: "invalidBase64Url",
      component,
    });
  }
  return bytes;
});

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
    input.readDependencies.length > MAX_COMMIT_POINT_READ_DEPENDENCIES_V1
  ) {
    return {
      reason: "limitExceeded",
      dimension: "pointReadDependencies",
      observed: input.readDependencies.length,
      maximum: MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
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

function base64UrlMaximumCharacters(byteLength: number): number {
  return Math.ceil((byteLength * 4) / 3);
}

function base64UrlDecodedLength(value: string): number {
  return Math.floor((value.length * 3) / 4);
}

function deepFreezeCommitProjection<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && "value" in descriptor) {
      deepFreezeCommitProjection(descriptor.value);
    }
  }
  Object.freeze(value);
  return value;
}

function assertNever(value: never): never {
  throw new Error(`Unreachable commit-protocol variant: ${String(value)}`);
}
