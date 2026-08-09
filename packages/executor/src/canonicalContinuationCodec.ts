import { bytesEqual, isUint8Array } from "@flarex/utils/bytes";
import { Effect, Result } from "effect";
import {
  encodeCanonicalJson,
  isJsonObjectFromUnknown,
} from "flarex-protocol/json";

export type CanonicalContinuationCodecOperation = "encode" | "decode";

export type CanonicalContinuationCodecFailureReason =
  | "invalidInput"
  | "invalidBytes"
  | "invalidDigest"
  | "invalidUtf8"
  | "invalidJson"
  | "nonCanonical"
  | "sizeExceeded"
  | "cryptoFailed";

export interface CanonicalContinuationEvidence<
  CodecVersion extends number,
> {
  readonly codecVersion: CodecVersion;
  readonly canonicalBytes: Uint8Array;
  readonly sha256: Uint8Array;
}

interface CanonicalContinuationCodecOptions<
  Value,
  CodecVersion extends number,
  Failure,
> {
  readonly codecVersion: CodecVersion;
  readonly maximumBytes: number;
  readonly encodeOperationName: string;
  readonly decodeOperationName: string;
  readonly decodeValueResult: (
    input: unknown,
  ) => Result.Result<Value, unknown>;
  readonly captureValue: (value: Value) => Value;
  readonly failure: (
    operation: CanonicalContinuationCodecOperation,
    reason: CanonicalContinuationCodecFailureReason,
    cause?: unknown,
    observedBytes?: number,
  ) => Failure;
}

/**
 * Executor-local mechanics for canonical, digest-bound continuation evidence.
 * Domain shape, limits, error identity, and owned-value capture remain with
 * each continuation codec.
 */
export function makeCanonicalContinuationCodec<
  Value,
  CodecVersion extends number,
  Failure,
>(options: CanonicalContinuationCodecOptions<Value, CodecVersion, Failure>) {
  const encode = Effect.fn(options.encodeOperationName)(function* (
    input: unknown,
  ): Effect.fn.Return<CanonicalContinuationEvidence<CodecVersion>, Failure> {
    const value = yield* Effect.fromResult(
      options.decodeValueResult(input).pipe(
        Result.mapError((cause) =>
          options.failure("encode", "invalidInput", cause)
        ),
      ),
    );
    const canonicalBytes = yield* canonicalBytesEffect(value, "encode", options);
    const sha256 = yield* sha256Effect(canonicalBytes, "encode", options);
    return captureEvidence(canonicalBytes, sha256, options.codecVersion);
  });

  const decode = Effect.fn(options.decodeOperationName)(function* (
    input: unknown,
  ): Effect.fn.Return<Value, Failure> {
    const evidence = yield* Effect.fromResult(
      captureEvidenceResult(input, options),
    );
    const parsed = yield* decodeJsonEffect(evidence.canonicalBytes, options);
    const value = yield* Effect.fromResult(
      options.decodeValueResult(parsed).pipe(
        Result.mapError((cause) =>
          options.failure("decode", "invalidJson", cause)
        ),
      ),
    );
    const canonicalBytes = yield* canonicalBytesEffect(value, "decode", options);
    if (!bytesEqual(canonicalBytes, evidence.canonicalBytes)) {
      return yield* Effect.fail(options.failure("decode", "nonCanonical"));
    }
    const sha256 = yield* sha256Effect(canonicalBytes, "decode", options);
    if (!bytesEqual(sha256, evidence.sha256)) {
      return yield* Effect.fail(options.failure("decode", "invalidDigest"));
    }
    return options.captureValue(value);
  });

  return Object.freeze({ encode, decode });
}

function canonicalBytesEffect<Value, CodecVersion extends number, Failure>(
  value: Value,
  operation: CanonicalContinuationCodecOperation,
  options: CanonicalContinuationCodecOptions<Value, CodecVersion, Failure>,
): Effect.Effect<Uint8Array, Failure> {
  return Effect.gen(function* (): Effect.fn.Return<Uint8Array, Failure> {
    if (!isJsonObjectFromUnknown(value)) {
      return yield* Effect.fail(options.failure(operation, "invalidInput"));
    }
    const canonicalText = encodeCanonicalJson(value, (cause) => {
      throw cause;
    });
    const canonicalBytes = new TextEncoder().encode(canonicalText);
    const sizeFailure = continuationSizeFailure(
      operation,
      canonicalBytes,
      options,
    );
    if (sizeFailure !== undefined) return yield* Effect.fail(sizeFailure);
    return canonicalBytes;
  });
}

function decodeJsonEffect<Value, CodecVersion extends number, Failure>(
  bytes: Uint8Array,
  options: CanonicalContinuationCodecOptions<Value, CodecVersion, Failure>,
): Effect.Effect<unknown, Failure> {
  return Effect.try({
    try: () =>
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as
        unknown,
    catch: (cause) =>
      options.failure(
        "decode",
        cause instanceof TypeError ? "invalidUtf8" : "invalidJson",
        cause,
      ),
  });
}

function captureEvidenceResult<Value, CodecVersion extends number, Failure>(
  input: unknown,
  options: CanonicalContinuationCodecOptions<Value, CodecVersion, Failure>,
): Result.Result<CanonicalContinuationEvidence<CodecVersion>, Failure> {
  if (
    typeof input !== "object" || input === null || Array.isArray(input) ||
    Reflect.get(input, "codecVersion") !== options.codecVersion
  ) {
    return Result.fail(options.failure("decode", "invalidInput"));
  }
  const canonicalBytes = Reflect.get(input, "canonicalBytes");
  if (!isUint8Array(canonicalBytes)) {
    return Result.fail(options.failure("decode", "invalidBytes"));
  }
  const sizeFailure = continuationSizeFailure(
    "decode",
    canonicalBytes,
    options,
  );
  if (sizeFailure !== undefined) return Result.fail(sizeFailure);
  const sha256 = Reflect.get(input, "sha256");
  if (!isUint8Array(sha256) || sha256.byteLength !== 32) {
    return Result.fail(options.failure("decode", "invalidDigest"));
  }
  return Result.succeed(
    captureEvidence(canonicalBytes, sha256, options.codecVersion),
  );
}

function continuationSizeFailure<Value, CodecVersion extends number, Failure>(
  operation: CanonicalContinuationCodecOperation,
  bytes: Uint8Array,
  options: CanonicalContinuationCodecOptions<Value, CodecVersion, Failure>,
): Failure | undefined {
  return bytes.byteLength >= 1 && bytes.byteLength <= options.maximumBytes
    ? undefined
    : options.failure(
      operation,
      "sizeExceeded",
      undefined,
      bytes.byteLength,
    );
}

function sha256Effect<Value, CodecVersion extends number, Failure>(
  bytes: Uint8Array,
  operation: CanonicalContinuationCodecOperation,
  options: CanonicalContinuationCodecOptions<Value, CodecVersion, Failure>,
): Effect.Effect<Uint8Array, Failure> {
  const input = new Uint8Array(bytes);
  return Effect.tryPromise({
    try: async () =>
      new Uint8Array(await crypto.subtle.digest("SHA-256", input)),
    catch: (cause) => options.failure(operation, "cryptoFailed", cause),
  });
}

function captureEvidence<CodecVersion extends number>(
  canonicalBytes: Uint8Array,
  sha256: Uint8Array,
  codecVersion: CodecVersion,
): CanonicalContinuationEvidence<CodecVersion> {
  const bytes = new Uint8Array(canonicalBytes);
  const digest = new Uint8Array(sha256);
  return Object.freeze({
    codecVersion,
    get canonicalBytes() {
      return new Uint8Array(bytes);
    },
    get sha256() {
      return new Uint8Array(digest);
    },
  });
}
