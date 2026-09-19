import { bytesEqualFullScan, copyBytes, copyBytesToArrayBuffer, isUint8ArrayWithByteLength } from "@flarex/utils/bytes";
import { Data, Effect, Result, Schema } from "effect";
import { CatalogIndexDefinitionIdSchema, CatalogTableIdSchema } from "flarex-protocol/catalog";
import { AppIndexPhysicalSpecSha256HexV1Schema } from "flarex-protocol/index-definition";
import { encodeCanonicalJson } from "flarex-protocol/json";
import { ScopeIdSchema, ScopeEpochSchema } from "flarex-protocol/storage-authority";

const sequence = Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]{0,18})$/),
  Schema.makeFilter(value => BigInt(value) <= 9_223_372_036_854_775_807n ? undefined : "Sequence exceeds storage range"));
const positive = sequence.check(Schema.makeFilter(value => value !== "0" ? undefined : "Expected positive sequence"));
const digest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));

export const IndexMaintenanceFrameSchema = Schema.Struct({
  format: Schema.Literal("flarex.index-maintenance"),
  version: Schema.Literal(1),
  scopeId: ScopeIdSchema,
  storageGeneration: Schema.Literal("flarexdb_v1"),
  storageGenerationFence: positive,
  epoch: ScopeEpochSchema,
  indexDefinitionId: CatalogIndexDefinitionIdSchema,
  tableId: CatalogTableIdSchema,
  physicalSpecSha256Hex: AppIndexPhysicalSpecSha256HexV1Schema,
  deploymentId: Schema.NonEmptyString,
  schemaVersionId: Schema.NonEmptyString,
  schemaManifestSha256: digest,
  attemptFence: positive,
  firstReadableCommitSeq: sequence,
  openedCommitSeq: sequence,
  activationSequence: positive,
  headSha256: digest,
}).check(Schema.makeFilter(frame => BigInt(frame.firstReadableCommitSeq) <= BigInt(frame.openedCommitSeq)
  ? undefined : "First-readable frontier exceeds opening frontier"));

export type IndexMaintenanceFrame = typeof IndexMaintenanceFrameSchema.Type;
export interface IndexMaintenanceEvidence {
  readonly frame: IndexMaintenanceFrame;
  readonly bytes: Uint8Array;
  readonly sha256: Uint8Array;
}

export class IndexMaintenanceError extends Data.TaggedError("IndexMaintenanceError")<{
  readonly reason: "storedState" | "resourceFailure" | "unavailable";
  readonly cause?: unknown;
  readonly retryable?: boolean;
}> {}

const decodeFrame = Schema.decodeUnknownResult(Schema.fromJsonString(IndexMaintenanceFrameSchema), { onExcessProperty: "error" });
const utf8 = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

export function indexMaintenanceFrameBytes(frame: IndexMaintenanceFrame): Uint8Array {
  return utf8.encode(encodeCanonicalJson(frame, issue => { throw new Error(`Index maintenance frame: ${issue.reason}`); }));
}

export function decodeIndexMaintenanceEvidenceResult(
  activationSequence: bigint | null,
  bytes: Uint8Array | null,
  sha256: Uint8Array | null,
): Result.Result<IndexMaintenanceEvidence | null, IndexMaintenanceError> {
  return Result.gen(function* () {
    if (activationSequence === null && bytes === null && sha256 === null) return null;
    if (activationSequence === null || bytes === null || sha256 === null ||
      bytes.byteLength === 0 || bytes.byteLength > 16_384 || !isUint8ArrayWithByteLength(sha256, 32)) {
      return yield* Result.fail(new IndexMaintenanceError({ reason: "storedState" }));
    }
    const text = yield* Result.try({ try: () => textDecoder.decode(bytes),
      catch: cause => new IndexMaintenanceError({ reason: "storedState", cause }) });
    const frame = yield* decodeFrame(text).pipe(Result.mapError(cause => new IndexMaintenanceError({ reason: "storedState", cause })));
    if (BigInt(frame.activationSequence) !== activationSequence || !bytesEqualFullScan(bytes, indexMaintenanceFrameBytes(frame))) {
      return yield* Result.fail(new IndexMaintenanceError({ reason: "storedState" }));
    }
    return Object.freeze({ frame: Object.freeze(frame), bytes: copyBytes(bytes), sha256: copyBytes(sha256) });
  });
}

export const hashIndexMaintenanceEvidence = Effect.fn("IndexMaintenance.hashEvidence")(
  (bytes: Uint8Array) => Effect.tryPromise({
    try: () => crypto.subtle.digest("SHA-256", copyBytesToArrayBuffer(bytes)),
    catch: cause => new IndexMaintenanceError({ reason: "resourceFailure", retryable: false, cause }),
  }).pipe(Effect.map(buffer => new Uint8Array(buffer))),
);

export const verifyIndexMaintenanceEvidence = Effect.fn("IndexMaintenance.verifyEvidence")(
  function* (evidence: IndexMaintenanceEvidence) {
    const actual = yield* hashIndexMaintenanceEvidence(evidence.bytes);
    if (!bytesEqualFullScan(actual, evidence.sha256)) return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
  },
);
