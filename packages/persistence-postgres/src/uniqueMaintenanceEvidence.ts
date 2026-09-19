import { bytesEqualFullScan, copyBytes, copyBytesToArrayBuffer, isUint8ArrayWithByteLength } from "@flarex/utils/bytes";
import { Data, Effect, Result, Schema } from "effect";
import { CatalogUniqueConstraintDefinitionIdSchema, CatalogTableIdSchema } from "flarex-protocol/catalog";
import { AppUniqueConstraintSpecSha256HexV1Schema } from "flarex-protocol/app-unique-constraint-definition";
import { encodeCanonicalJson } from "flarex-protocol/json";
import { ScopeIdSchema, ScopeEpochSchema } from "flarex-protocol/storage-authority";

const sequence = Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]{0,18})$/),
  Schema.makeFilter(value => BigInt(value) <= 9_223_372_036_854_775_807n ? undefined : "Sequence exceeds storage range"));
const positive = sequence.check(Schema.makeFilter(value => value !== "0" ? undefined : "Expected positive sequence"));
const digest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));

/** Current unique ownership has a build start, not an ordered-history first-readable boundary. */
export const UniqueMaintenanceFrameSchema = Schema.Struct({
  format: Schema.Literal("flarex.unique-maintenance"), version: Schema.Literal(1),
  scopeId: ScopeIdSchema, storageGeneration: Schema.Literal("flarexdb_v1"),
  storageGenerationFence: positive, epoch: ScopeEpochSchema,
  uniqueConstraintDefinitionId: CatalogUniqueConstraintDefinitionIdSchema,
  tableId: CatalogTableIdSchema, physicalSpecSha256Hex: AppUniqueConstraintSpecSha256HexV1Schema,
  deploymentId: Schema.NonEmptyString, schemaVersionId: Schema.NonEmptyString,
  startCommitSeq: sequence, attemptFence: positive,
  openedCommitSeq: sequence, activationSequence: positive, headSha256: digest,
}).check(Schema.makeFilter(frame => BigInt(frame.startCommitSeq) <= BigInt(frame.openedCommitSeq)
  ? undefined : "Build start exceeds opening frontier"));

export type UniqueMaintenanceFrame = typeof UniqueMaintenanceFrameSchema.Type;
export interface UniqueMaintenanceEvidence {
  readonly frame: UniqueMaintenanceFrame;
  readonly bytes: Uint8Array;
  readonly sha256: Uint8Array;
}
export class UniqueMaintenanceError extends Data.TaggedError("UniqueMaintenanceError")<{
  readonly reason: "storedState" | "resourceFailure" | "unavailable";
  readonly cause?: unknown;
  readonly retryable?: boolean;
}> {}

const decodeFrame = Schema.decodeUnknownResult(Schema.fromJsonString(UniqueMaintenanceFrameSchema), { onExcessProperty: "error" });
const utf8 = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });
export function uniqueMaintenanceFrameBytes(frame: UniqueMaintenanceFrame): Uint8Array {
  return utf8.encode(encodeCanonicalJson(frame, issue => { throw new Error(`Unique maintenance frame: ${issue.reason}`); }));
}

export function decodeUniqueMaintenanceEvidenceResult(
  activationSequence: bigint | null, bytes: Uint8Array | null, sha256: Uint8Array | null,
): Result.Result<UniqueMaintenanceEvidence | null, UniqueMaintenanceError> {
  return Result.gen(function* () {
    if (activationSequence === null && bytes === null && sha256 === null) return null;
    if (activationSequence === null || bytes === null || sha256 === null || bytes.byteLength === 0 || bytes.byteLength > 16_384 ||
      !isUint8ArrayWithByteLength(sha256, 32)) return yield* Result.fail(new UniqueMaintenanceError({ reason: "storedState" }));
    const text = yield* Result.try({ try: () => textDecoder.decode(bytes),
      catch: cause => new UniqueMaintenanceError({ reason: "storedState", cause }) });
    const frame = yield* decodeFrame(text).pipe(Result.mapError(cause => new UniqueMaintenanceError({ reason: "storedState", cause })));
    if (BigInt(frame.activationSequence) !== activationSequence || !bytesEqualFullScan(bytes, uniqueMaintenanceFrameBytes(frame))) {
      return yield* Result.fail(new UniqueMaintenanceError({ reason: "storedState" }));
    }
    return Object.freeze({ frame: Object.freeze(frame), bytes: copyBytes(bytes), sha256: copyBytes(sha256) });
  });
}

export const hashUniqueMaintenanceEvidence = Effect.fn("UniqueMaintenance.hashEvidence")(
  (bytes: Uint8Array) => Effect.tryPromise({
    try: () => crypto.subtle.digest("SHA-256", copyBytesToArrayBuffer(bytes)),
    catch: cause => new UniqueMaintenanceError({ reason: "resourceFailure", retryable: false, cause }),
  }).pipe(Effect.map(buffer => new Uint8Array(buffer))),
);
export const verifyUniqueMaintenanceEvidence = Effect.fn("UniqueMaintenance.verifyEvidence")(
  function* (evidence: UniqueMaintenanceEvidence) {
    const actual = yield* hashUniqueMaintenanceEvidence(evidence.bytes);
    if (!bytesEqualFullScan(actual, evidence.sha256)) return yield* Effect.fail(new UniqueMaintenanceError({ reason: "storedState" }));
  },
);
