import { makeLivePrivateSha256V1 } from "@flarex/analysis/internal/private-sha256-v1";
import { bytesEqual, copyBytes } from "@flarex/utils/bytes";
import { Data, Effect, Result, Schema } from "effect";
import { MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1, MAX_COMMIT_RESULT_SEMANTIC_BYTES_V1 } from "flarex-protocol/commit-protocol";
import { encodeCanonicalJson, isJsonArray, type Json } from "flarex-protocol/json";
import { capturePrivateJsonData } from "./privateJsonData";

export const OutcomeResultEncodingSchema = Schema.Literals(["application-value", "json"]);
export type OutcomeResultEncoding = typeof OutcomeResultEncodingSchema.Type;

export class JsonOutcomeError extends Data.TaggedError("JsonOutcomeError")<{
  readonly reason: "invalidInput" | "limitExceeded" | "resourceFailure" | "invalidEvidence";
  readonly cause?: unknown;
}> {}
const failure = (reason: JsonOutcomeError["reason"], cause?: unknown) => new JsonOutcomeError({ reason, cause });
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const decodeText = Schema.decodeUnknownResult(Schema.String.check(Schema.isPattern(/^[^\uD800-\uDFFF]*$/u)));
const maximumResultBytes = Math.min(MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1, MAX_COMMIT_RESULT_SEMANTIC_BYTES_V1);
const hash = makeLivePrivateSha256V1({
  invalidBudget: () => failure("limitExceeded"), invalidBytes: () => failure("invalidInput"),
  inputBytesExceeded: () => failure("limitExceeded"), unavailable: () => failure("resourceFailure"),
  nativeRejected: cause => failure("resourceFailure", cause), invalidDigestOutput: () => new Error("Invalid outcome digest"),
});

/** Only walks the bounded, detached tree captured by privateJsonData. */
function normalizeJson(value: Json): Result.Result<Json, JsonOutcomeError> {
  return Result.gen(function* () {
    if (typeof value === "string") return yield* decodeText(value).pipe(Result.mapError(cause => failure("invalidInput", cause)));
    if (typeof value === "number") return value === 0 ? 0 : value;
    if (value === null || typeof value === "boolean") return value;
    if (isJsonArray(value)) {
      const values: Json[] = [];
      for (const member of value) values.push(yield* normalizeJson(member));
      return Object.freeze(values);
    }
    const entries: [string, Json][] = [];
    for (const [key, member] of Object.entries(value)) {
      yield* decodeText(key).pipe(Result.mapError(cause => failure("invalidInput", cause)));
      entries.push([key, yield* normalizeJson(member)]);
    }
    return Object.freeze(Object.fromEntries(entries));
  });
}

export interface CanonicalJsonOutcome {
  readonly encoding: "json";
  readonly valueJson: Json;
  readonly canonicalText: string;
  readonly canonicalBytes: Uint8Array;
  readonly semanticSizeBytes: number;
}

/** Normalization precedes dispatch as well as hashing, so equal identities have equal inputs. */
export function captureJsonOutcomeValue(input: unknown, maximum: number) {
  return capturePrivateJsonData(input, maximum, failure).pipe(Result.flatMap(captured =>
    normalizeJson(captured.value).pipe(Result.map(value => Object.freeze({ value, bytes: captured.bytes }))),
  ));
}

/** Ordinary JSON evidence; no Application value markers or wrapper encoding. */
export function canonicalizeJsonOutcome(input: unknown, maximum = maximumResultBytes): Result.Result<CanonicalJsonOutcome, JsonOutcomeError> {
  return Result.gen(function* () {
    const captured = yield* captureJsonOutcomeValue(input, Math.min(maximum, maximumResultBytes));
    const valueJson = captured.value;
    const canonicalText = encodeCanonicalJson(valueJson, issue => { throw new Error("Captured JSON encoding invariant", { cause: issue }); });
    const bytes = encoder.encode(canonicalText);
    return Object.freeze({ encoding: "json" as const, valueJson, canonicalText, semanticSizeBytes: bytes.byteLength,
      get canonicalBytes() { return copyBytes(bytes); },
    });
  });
}

export interface VerifiedJsonOutcome extends CanonicalJsonOutcome { readonly sha256: Uint8Array }

export const verifyJsonOutcome = Effect.fn("CommittedOutcome.verifyJson")(function* (
  bytes: Uint8Array, expectedSha256: Uint8Array,
): Effect.fn.Return<VerifiedJsonOutcome, JsonOutcomeError> {
  if (bytes.byteLength < 1 || bytes.byteLength > maximumResultBytes || expectedSha256.byteLength !== 32)
    return yield* Effect.fail(failure("invalidEvidence"));
  const ownedBytes = copyBytes(bytes);
  const ownedSha256 = copyBytes(expectedSha256);
  const text = yield* Effect.try({ try: () => decoder.decode(ownedBytes), catch: cause => failure("invalidEvidence", cause) });
  const parsed: unknown = yield* Effect.try({ try: () => JSON.parse(text), catch: cause => failure("invalidEvidence", cause) });
  const canonical = yield* Effect.fromResult(canonicalizeJsonOutcome(parsed));
  if (!bytesEqual(ownedBytes, canonical.canonicalBytes)) return yield* Effect.fail(failure("invalidEvidence"));
  const digest = yield* hash(ownedBytes, { maximumInputBytes: maximumResultBytes });
  if (!bytesEqual(digest, ownedSha256)) return yield* Effect.fail(failure("invalidEvidence"));
  return Object.freeze({ ...canonical, get canonicalBytes() { return canonical.canonicalBytes; }, get sha256() { return copyBytes(digest); } });
});
