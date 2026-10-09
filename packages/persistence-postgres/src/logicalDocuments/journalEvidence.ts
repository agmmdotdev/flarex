import { Data, Effect, Result, Schema } from "effect";
import { encodeCanonicalJson } from "flarex-protocol/json";
import { MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1, MAX_COMMIT_METADATA_READ_DEPENDENCIES,
  LogicalMetadataReadDependencySchema, MetadataSequenceSchema } from "flarex-protocol/commit-protocol";
import { AppRowIdHexV1Schema } from "flarex-protocol/app-document-id";
import { CatalogIndexDefinitionIdSchema, CatalogTableIdSchema,
  CatalogUniqueConstraintDefinitionIdSchema } from "flarex-protocol/catalog";
import { CommitSeqSchema } from "flarex-protocol/storage-authority";
import { OrderedIndexBoundHexV1Schema, OrderedIndexKeyBytesHexV1Schema } from "flarex-protocol/ordered-index";
import { MAX_APP_UNIQUE_KEY_COMPONENTS_V1, canonicalizeAppUniqueKeyV1Result } from "../appUniqueKeyContract";
import type { LogicalDocumentChanges } from "./workingSet";
import { GeneratedInsertionIntentsSchema } from "flarex-protocol/commit-protocol";
export { authenticatedGeneratedInsertionsResult } from "flarex-protocol/commit-protocol";

const strict = { parseOptions: { onExcessProperty: "error" as const } };
const entry = Schema.Struct({ rowId: AppRowIdHexV1Schema, encodedKey: OrderedIndexKeyBytesHexV1Schema,
  commitSeq: Schema.toEncoded(CommitSeqSchema) }).annotate(strict);
const bounds = Schema.Struct({ startInclusive: Schema.optionalKey(OrderedIndexBoundHexV1Schema),
  endExclusive: Schema.optionalKey(OrderedIndexBoundHexV1Schema) }).annotate(strict);
const range = Schema.Struct({ indexDefinitionId: CatalogIndexDefinitionIdSchema, bounds,
  entries: Schema.Array(entry).check(Schema.isMaxLength(4096)) }).annotate(strict);
const page = Schema.Struct({ indexDefinitionId: CatalogIndexDefinitionIdSchema, bounds,
  after: Schema.optionalKey(Schema.Struct({ rowId: AppRowIdHexV1Schema,
    encodedKey: OrderedIndexKeyBytesHexV1Schema }).annotate(strict)),
  isDone: Schema.Boolean, entries: Schema.Array(entry).check(Schema.isMaxLength(4096)) }).annotate(strict);
const uniqueKey = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("claim"), localeKey: Schema.String,
    encodedKey: OrderedIndexKeyBytesHexV1Schema,
    componentCount: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: MAX_APP_UNIQUE_KEY_COMPONENTS_V1 })) }).annotate(strict),
  Schema.Struct({ kind: Schema.Literal("omitted"), localeKey: Schema.String,
    reason: Schema.Literals(["sparseMissing", "predicateExcluded", "nullDistinct"]) }).annotate(strict),
]);
const unique = Schema.Struct({ constraintId: CatalogUniqueConstraintDefinitionIdSchema, key: uniqueKey,
  owner: Schema.NullOr(Schema.Struct({ tableId: CatalogTableIdSchema,
    rowId: AppRowIdHexV1Schema }).annotate(strict)) }).annotate(strict);
const LegacyLogicalParticipantDependencyEvidenceSchema = Schema.Struct({
  format: Schema.Literal("flarex.logical-participant-evidence"), version: Schema.Literal(1),
  indexRanges: Schema.Array(range).check(Schema.isMaxLength(256)),
  indexPages: Schema.Array(page).check(Schema.isMaxLength(256)),
  uniqueReads: Schema.Array(unique).check(Schema.isMaxLength(256)),
  generatedInsertions: Schema.optionalKey(GeneratedInsertionIntentsSchema),
}).annotate(strict);
export const FiniteLogicalParticipantDependencyEvidenceSchema = Schema.Struct({
  ...LegacyLogicalParticipantDependencyEvidenceSchema.fields, version: Schema.Literal(2),
  metadataWatermark: Schema.toEncoded(MetadataSequenceSchema),
  metadataDependencies: Schema.Array(Schema.toEncoded(LogicalMetadataReadDependencySchema)).check(
    Schema.isMaxLength(MAX_COMMIT_METADATA_READ_DEPENDENCIES)),
}).annotate(strict);
export const LogicalParticipantDependencyEvidenceSchema = Schema.Union([
  LegacyLogicalParticipantDependencyEvidenceSchema, FiniteLogicalParticipantDependencyEvidenceSchema,
]);
export type LogicalParticipantDependencyEvidence = typeof LogicalParticipantDependencyEvidenceSchema.Type;
const decode = Schema.decodeUnknownResult(LogicalParticipantDependencyEvidenceSchema, { onExcessProperty: "error" });
const encodeMetadataArrayEffect = Schema.encodeUnknownEffect(Schema.Array(LogicalMetadataReadDependencySchema));
const utf8 = new TextEncoder();
export class LogicalParticipantEvidenceError extends Data.TaggedError("LogicalParticipantEvidenceError")<{
  readonly reason: "unsupportedProfile" | "invalidEvidence" | "limitExceeded" | "writeConflict" | "resourceFailure";
  readonly cause?: unknown;
}> {}
export const logicalParticipantEvidenceError = (reason: LogicalParticipantEvidenceError["reason"], cause?: unknown) =>
  new LogicalParticipantEvidenceError({ reason, ...(cause === undefined ? {} : { cause }) });

/** Complete bounded evidence for the selected historical index and unique
 * paths. Unsupported native observations refuse before any operation ack. */
export const serializeLogicalParticipantDependencyEvidence = Effect.fn("LogicalDocuments.serializeDependencyEvidence")(
  function* (closed: LogicalDocumentChanges) {
    if (closed.scans.length > 0 || closed.searchReads.length > 0 || closed.setNull.length > 0 ||
      closed.referenceReplacements.length > 0 || closed.lifecycle.length > 0)
      return yield* Effect.fail(logicalParticipantEvidenceError("unsupportedProfile"));
    const projected = {
      format: "flarex.logical-participant-evidence" as const,
      generatedInsertions: closed.dependencies.flatMap(point => point.dependency.kind === "generatedInsertion" &&
        point.dependency.origin === undefined ? [{ documentId: point.documentId, tableId: point.tableId,
          rowId: point.rowId, effectOrdinal: point.dependency.effectOrdinal }] : []),
      ...(closed.metadataDependencies === undefined ? { version: 1 as const } : {
        version: 2 as const, metadataWatermark: closed.metadataWatermark?.toString(),
        metadataDependencies: yield* encodeMetadataArrayEffect(closed.metadataDependencies)
          .pipe(Effect.mapError(cause => logicalParticipantEvidenceError("invalidEvidence", cause))),
      }),
      indexRanges: closed.indexReads.map(read => ({ indexDefinitionId: read.definition.indexDefinitionId,
        bounds: read.bounds, entries: read.entries.map(member => ({ rowId: member.rowId,
          encodedKey: member.encodedKey, commitSeq: member.commitSeq.toString() })) })),
      indexPages: closed.pageReads.map(read => ({ indexDefinitionId: read.definition.indexDefinitionId,
        bounds: read.bounds, ...(read.after === undefined ? {} : { after: read.after }), isDone: read.isDone,
        entries: read.entries.map(member => ({ rowId: member.rowId, encodedKey: member.encodedKey,
          commitSeq: member.commitSeq.toString() })) })),
      uniqueReads: yield* Effect.forEach(closed.uniqueReads, read => Effect.gen(function* () {
        const key = yield* Effect.fromResult(canonicalizeAppUniqueKeyV1Result(read.key)
          .pipe(Result.mapError(cause => logicalParticipantEvidenceError("invalidEvidence", cause))));
        return { constraintId: read.constraintId, key: key.kind === "claim"
          ? { kind: "claim" as const, localeKey: key.localeKey, encodedKey: key.encodedKey,
            componentCount: read.key.values.length }
          : { kind: "omitted" as const, localeKey: key.localeKey, reason: key.reason }, owner: read.owner };
      })),
    };
    const checked = yield* Effect.fromResult(decode(projected).pipe(Result.mapError(cause => logicalParticipantEvidenceError("invalidEvidence", cause))));
    const text = encodeCanonicalJson(checked, () => { throw new Error("Checked logical evidence is not JSON"); });
    const evidenceBytes = utf8.encode(text).byteLength;
    if (evidenceBytes > MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1) return yield* Effect.fail(logicalParticipantEvidenceError("limitExceeded"));
    return Object.freeze({ evidence: checked, evidenceBytes });
  });

export const decodeLogicalParticipantDependencyEvidence = (input: unknown) =>
  decode(input).pipe(Result.mapError(cause => logicalParticipantEvidenceError("invalidEvidence", cause)));
