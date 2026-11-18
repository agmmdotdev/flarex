import { Effect, Result, Schema } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { makeLivePrivateSha256V1 } from "@flarex/analysis/internal/private-sha256-v1";
import { encodeCanonicalJson, isJsonObject, type Json, type JsonObject } from "flarex-protocol/json";
import { capturePrivateJsonData } from "../values/privateJsonData";
import { CoreNativeRootIdentitySchema, CoreTransactionError, type CoreError, type CoreNativeRootIdentity } from "./api";
import { CoreSchemaError } from "./schemaTypes";
import { CoreNativeIdentitySchema, type CoreNativeIdentity } from "./nativePolicy";
import { CoreTableNamespaceSchema } from "./namespace";
import { snapshotDecodedProtocolPlainData } from "flarex-protocol/internal/decoded-protocol-snapshot";

export const CORE_NATIVE_ROOT_FRAME_BYTES = 1_048_576;
const invalid = (cause?: unknown) => new CoreTransactionError({ reason: "invalidValue", cause });
const refuseCapture = (reason: "limitExceeded" | "invalidInput", cause?: unknown) =>
  new CoreTransactionError({ reason: reason === "limitExceeded" ? "capacity" : "invalidValue", cause });
const canonicalCapture = { canonicalNumbers: true, wellFormedUnicode: true } as const;
const hash = makeLivePrivateSha256V1<CoreError>({
  invalidBudget: () => invalid(), invalidBytes: () => invalid(), inputBytesExceeded: () => invalid(),
  unavailable: () => new CoreSchemaError({ reason: "hashFailure", message: "Native root digest unavailable" }),
  nativeRejected: cause => new CoreSchemaError({ reason: "hashFailure", message: "Native root digest rejected", cause }),
  invalidDigestOutput: () => new Error("Native root digest output invariant"),
});

/** The existing canonical root digest, retained with its exact immutable frame.
 * It contains metadata and declared policy; request arguments never enter it. */
export const captureCoreNativeRootIdentity = Effect.fn("CoreDatabase.nativeRootIdentity")(function* (frame: Json) {
  const captured = yield* Effect.fromResult(capturePrivateJsonData(frame, CORE_NATIVE_ROOT_FRAME_BYTES, refuseCapture, canonicalCapture));
  if (!isJsonObject(captured.value)) return yield* invalid("Native root frame must be an object");
  const decoded = yield* Effect.fromResult(decodeFrame(captured.value).pipe(Result.mapError(invalid)));
  const ownedFrame = snapshotDecodedProtocolPlainData(decoded);
  const canonical = encodeCanonicalJson(ownedFrame, issue => { throw new Error("Native root frame invariant", { cause: issue }); });
  const bytes = new TextEncoder().encode(canonical);
  const digest = yield* hash(bytes, { maximumInputBytes: CORE_NATIVE_ROOT_FRAME_BYTES });
  issuedFrames.add(ownedFrame);
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
  executionIsolation: Schema.optionalKey(Schema.Literal("scopeExclusive")),
}).annotate({ parseOptions: { onExcessProperty: "error" } });
const decodeFrame = Schema.decodeUnknownResult(Frame, { onExcessProperty: "error" });
const requestFields = { key: Schema.String.check(Schema.isLengthBetween(1, 256)),
  requestHash: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)), root: CoreNativeRootIdentitySchema,
  source: CoreNativeIdentitySchema };
const RequestParts = Schema.Struct(requestFields).annotate({ parseOptions: { onExcessProperty: "error" } });
export const CoreNativeRootRequestEvidenceSchema = Schema.Struct({ ...requestFields, frame: Frame })
  .annotate({ parseOptions: { onExcessProperty: "error" } });
export type CoreNativeRootRequestEvidence = typeof CoreNativeRootRequestEvidenceSchema.Type;
type RootFrame = CoreNativeRootRequestEvidence["frame"];
const decodeEvidence = Schema.decodeUnknownResult(CoreNativeRootRequestEvidenceSchema, { onExcessProperty: "error" });
const decodeRequestParts = Schema.decodeUnknownResult(RequestParts, { onExcessProperty: "error" });
const REQUEST_EVIDENCE_BYTES = CORE_NATIVE_ROOT_FRAME_BYTES + 1024;

export function captureCoreNativeRootRequestEvidence(input: unknown) {
  return Result.gen(function* () {
    const captured = yield* capturePrivateJsonData(input, REQUEST_EVIDENCE_BYTES, refuseCapture, canonicalCapture);
    const decoded = yield* decodeEvidence(captured.value).pipe(Result.mapError(invalid));
    return snapshotDecodedProtocolPlainData(decoded);
  });
}

/** Frames issued by `captureCoreNativeRootIdentity`: captured, decoded and
 * deeply frozen. Only these exact objects may carry frame-derived values. */
const issuedFrames = new WeakSet<RootFrame>();
const frameRequestBudgets = new WeakMap<RootFrame, Result.Result<number, CoreTransactionError>>();
const frameCanonicalJson = new WeakMap<RootFrame, string>();
export const isIssuedCoreNativeRootFrame = (frame: RootFrame): boolean => issuedFrames.has(frame);

/** Bytes the request members may use beside this frame, or the refusal every
 * request over it receives. The frame is measured as an evidence member, so
 * its depth and size count exactly as in the complete capture. */
const frameRequestBudget = (frame: RootFrame) => {
  const known = frameRequestBudgets.get(frame);
  if (known !== undefined) return known;
  // `{"frame":X}` and `{members,"frame":X}` differ by the members and one comma.
  const budget = capturePrivateJsonData({ frame }, REQUEST_EVIDENCE_BYTES, refuseCapture, canonicalCapture)
    .pipe(Result.map(captured => REQUEST_EVIDENCE_BYTES - captured.bytes + 1));
  frameRequestBudgets.set(frame, budget);
  return budget;
};

/** For plain JSON request members, the same evidence and refusals as the complete
 * capture of `{ ...request, frame }`; the one caller passes decoded members.
 * An issued frame is checked once; each request captures only its own members. */
export function composeCoreNativeRootRequestEvidence(request: Readonly<{ key: string; requestHash: string;
  root: CoreNativeRootIdentity; source: CoreNativeIdentity }>, frame: RootFrame,
): Result.Result<CoreNativeRootRequestEvidence, CoreTransactionError> {
  if (!issuedFrames.has(frame)) return captureCoreNativeRootRequestEvidence({ ...request, frame });
  return Result.gen(function* () {
    const budget = yield* frameRequestBudget(frame);
    const captured = yield* capturePrivateJsonData(request, budget, refuseCapture, canonicalCapture);
    const decoded = yield* decodeRequestParts(captured.value).pipe(Result.mapError(invalid));
    return Object.freeze({ ...snapshotDecodedProtocolPlainData(decoded), frame });
  });
}

const canonicalEvidence = (value: Json) => encodeCanonicalJson(value,
  issue => { throw new Error("Native root request evidence lost its canonical owner", { cause: issue }); });

const EVIDENCE_MEMBERS: ReadonlySet<string> = new Set(["frame", "key", "requestHash", "root", "source"]);
const hasOnlyEvidenceMembers = (evidence: CoreNativeRootRequestEvidence) => {
  const keys = Object.keys(evidence);
  return keys.length === EVIDENCE_MEMBERS.size && keys.every(key => EVIDENCE_MEMBERS.has(key));
};

/** Canonical JSON of complete evidence. `frame` sorts before every request
 * member, so an issued frame's encoding is kept and spliced in front of them. */
export function encodeCoreNativeRootRequestEvidence(evidence: CoreNativeRootRequestEvidence): string {
  if (!issuedFrames.has(evidence.frame) || !hasOnlyEvidenceMembers(evidence)) return canonicalEvidence(evidence);
  let frame = frameCanonicalJson.get(evidence.frame);
  if (frame === undefined) {
    frame = canonicalEvidence(evidence.frame);
    frameCanonicalJson.set(evidence.frame, frame);
  }
  const request = canonicalEvidence({ key: evidence.key, requestHash: evidence.requestHash, root: evidence.root, source: evidence.source });
  return `{"frame":${frame},${request.slice(1)}`;
}

export interface CoreCommittedNativeRootRequest {
  readonly evidence: CoreNativeRootRequestEvidence;
  readonly root: CoreNativeRootIdentity;
  readonly scopeUuid: string;
  readonly epochUuid: string;
  readonly contract: JsonObject;
}
