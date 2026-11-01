import { Effect, Result, Schema } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { makeLivePrivateSha256V1 } from "@flarex/analysis/internal/private-sha256-v1";
import { encodeCanonicalJson, isJsonObject, type Json, type JsonObject } from "flarex-protocol/json";
import { capturePrivateJsonData } from "../values/privateJsonData";
import { CoreNativeRootIdentitySchema, CoreTransactionError, type CoreError, type CoreNativeRootIdentity } from "./api";
import { CoreSchemaError } from "./schemaTypes";
import { CoreNativeIdentitySchema } from "./nativePolicy";
import { CoreTableNamespaceSchema } from "./namespace";
import { snapshotDecodedProtocolPlainData } from "flarex-protocol/internal/decoded-protocol-snapshot";

export const CORE_NATIVE_ROOT_FRAME_BYTES = 1_048_576;
const invalid = (cause?: unknown) => new CoreTransactionError({ reason: "invalidValue", cause });
const hash = makeLivePrivateSha256V1<CoreError>({
  invalidBudget: () => invalid(), invalidBytes: () => invalid(), inputBytesExceeded: () => invalid(),
  unavailable: () => new CoreSchemaError({ reason: "hashFailure", message: "Native root digest unavailable" }),
  nativeRejected: cause => new CoreSchemaError({ reason: "hashFailure", message: "Native root digest rejected", cause }),
  invalidDigestOutput: () => new Error("Native root digest output invariant"),
});

/** The existing canonical root digest, retained with its exact immutable frame.
 * It contains metadata and declared policy; request arguments never enter it. */
export const captureCoreNativeRootIdentity = Effect.fn("CoreDatabase.nativeRootIdentity")(function* (frame: Json) {
  const captured = yield* Effect.fromResult(capturePrivateJsonData(frame, CORE_NATIVE_ROOT_FRAME_BYTES,
    (reason, cause) => new CoreTransactionError({ reason: reason === "limitExceeded" ? "capacity" : "invalidValue", cause }),
    { canonicalNumbers: true, wellFormedUnicode: true }));
  if (!isJsonObject(captured.value)) return yield* invalid("Native root frame must be an object");
  const decoded = yield* Effect.fromResult(decodeFrame(captured.value).pipe(Result.mapError(invalid)));
  const ownedFrame = snapshotDecodedProtocolPlainData(decoded);
  const canonical = encodeCanonicalJson(ownedFrame, issue => { throw new Error("Native root frame invariant", { cause: issue }); });
  const bytes = new TextEncoder().encode(canonical);
  const digest = yield* hash(bytes, { maximumInputBytes: CORE_NATIVE_ROOT_FRAME_BYTES });
  return Object.freeze({ identity: Object.freeze({ definitionHash: encodeBytesToLowercaseHex(digest) }),
    frame: ownedFrame, bytes: bytes.byteLength });
});

const JsonObjectSchema = Schema.Record(Schema.String, Schema.Json);
const Frame = Schema.Struct({ format: Schema.Literal("flarex.core-native-root"), version: Schema.Literal(1),
  namespace: CoreTableNamespaceSchema, contract: JsonObjectSchema,
  participants: Schema.Array(Schema.Struct({ source: CoreNativeIdentitySchema,
    commands: Schema.Array(Schema.Struct({ name: Schema.NonEmptyString, mode: Schema.Literals(["read", "write"]) })),
    limits: Schema.Struct({ maxIdentities: Schema.Int, maxDocumentBytes: Schema.Int }),
  })).check(Schema.isLengthBetween(1, 64)),
  applicationInsert: Schema.NullOr(JsonObjectSchema), maxFinalUserDocuments: Schema.Int,
  applicationRead: Schema.optionalKey(JsonObjectSchema), applicationProgram: Schema.optionalKey(JsonObjectSchema),
  retryProvenNoncommit: Schema.optionalKey(Schema.Literal(true)), protectedMetadata: Schema.optionalKey(Schema.Literal(true)),
}).annotate({ parseOptions: { onExcessProperty: "error" } });
const decodeFrame = Schema.decodeUnknownResult(Frame, { onExcessProperty: "error" });
export const CoreNativeRootRequestEvidenceSchema = Schema.Struct({
  key: Schema.String.check(Schema.isLengthBetween(1, 256)),
  requestHash: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)), root: CoreNativeRootIdentitySchema,
  source: CoreNativeIdentitySchema, frame: Frame,
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type CoreNativeRootRequestEvidence = typeof CoreNativeRootRequestEvidenceSchema.Type;
const decodeEvidence = Schema.decodeUnknownResult(CoreNativeRootRequestEvidenceSchema, { onExcessProperty: "error" });

export function captureCoreNativeRootRequestEvidence(input: unknown) {
  return Result.gen(function* () {
    const captured = yield* capturePrivateJsonData(input, CORE_NATIVE_ROOT_FRAME_BYTES + 1024,
      (reason, cause) => new CoreTransactionError({ reason: reason === "limitExceeded" ? "capacity" : "invalidValue", cause }),
      { canonicalNumbers: true, wellFormedUnicode: true });
    const decoded = yield* decodeEvidence(captured.value).pipe(Result.mapError(invalid));
    return snapshotDecodedProtocolPlainData(decoded);
  });
}

export interface CoreCommittedNativeRootRequest {
  readonly evidence: CoreNativeRootRequestEvidence;
  readonly root: CoreNativeRootIdentity;
  readonly scopeUuid: string;
  readonly epochUuid: string;
  readonly contract: JsonObject;
}
