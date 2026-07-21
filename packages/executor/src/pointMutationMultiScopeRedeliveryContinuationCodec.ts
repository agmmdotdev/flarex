import { bytesEqual, isUint8Array } from "@flarex/utils/bytes";
import {
  MAX_POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_BYTES_V1,
  POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_CODEC_V1,
} from "@flarex/persistence-postgres/point-mutation-redelivery-scheduler-model";
import { Data, Effect, Result, Schema } from "effect";
import {
  encodeCanonicalJson,
  isJsonObjectFromUnknown,
} from "flarex-protocol/json";

import {
  PointMutationMultiScopeRedeliveryContinuationSchemaV1,
  type PointMutationMultiScopeRedeliveryContinuationV1,
} from "./pointMutationMultiScopeRedelivery";

export interface EncodedPointMutationMultiScopeRedeliveryContinuationV1 {
  readonly codecVersion: 1;
  readonly canonicalBytes: Uint8Array;
  readonly sha256: Uint8Array;
}

export class PointMutationMultiScopeRedeliveryContinuationCodecV1Error
  extends Data.TaggedError(
    "PointMutationMultiScopeRedeliveryContinuationCodecV1Error",
  )<{
    readonly operation: "encode" | "decode";
    readonly reason:
      | "invalidInput"
      | "invalidBytes"
      | "invalidDigest"
      | "invalidUtf8"
      | "invalidJson"
      | "nonCanonical"
      | "sizeExceeded"
      | "cryptoFailed";
    readonly observedBytes?: number;
    readonly maximumBytes?: number;
    readonly cause?: unknown;
  }> {}

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });
const decodeContinuationResult = Schema.decodeUnknownResult(
  PointMutationMultiScopeRedeliveryContinuationSchemaV1,
  { onExcessProperty: "error" },
);

export const encodePointMutationMultiScopeRedeliveryContinuationV1 = Effect.fn(
  "PointMutationMultiScopeRedeliveryContinuation.encode",
)(function* (input: unknown) {
  const continuation = yield* Effect.fromResult(
    decodeContinuationResult(input).pipe(
      Result.mapError((cause) => codecError("encode", "invalidInput", cause)),
    ),
  );
  const canonicalBytes = yield* canonicalBytesEffect(
    continuation,
    "encode",
  );
  const sha256 = yield* sha256Effect(canonicalBytes, "encode");
  return captureEncoded(canonicalBytes, sha256);
});

export const decodePointMutationMultiScopeRedeliveryContinuationV1 = Effect.fn(
  "PointMutationMultiScopeRedeliveryContinuation.decode",
)(function* (input: unknown) {
  const evidence = yield* Effect.fromResult(captureEvidenceResult(input));
  const parsed = yield* decodeJsonEffect(evidence.canonicalBytes);
  const continuation = yield* Effect.fromResult(
    decodeContinuationResult(parsed).pipe(
      Result.mapError((cause) => codecError("decode", "invalidJson", cause)),
    ),
  );
  const canonicalBytes = yield* canonicalBytesEffect(
    continuation,
    "decode",
  );
  if (!bytesEqual(canonicalBytes, evidence.canonicalBytes)) {
    return yield* codecError("decode", "nonCanonical");
  }
  const sha256 = yield* sha256Effect(canonicalBytes, "decode");
  if (!bytesEqual(sha256, evidence.sha256)) {
    return yield* codecError("decode", "invalidDigest");
  }
  return captureContinuation(continuation);
});

function captureContinuation(
  continuation: PointMutationMultiScopeRedeliveryContinuationV1,
): PointMutationMultiScopeRedeliveryContinuationV1 {
  return Object.freeze({
    codecVersion:
      POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_CODEC_V1,
    directory: continuation.directory.kind === "continuing"
      ? Object.freeze({
        kind: "continuing",
        continuation: Object.freeze({ ...continuation.directory.continuation }),
      })
      : Object.freeze({ kind: continuation.directory.kind }),
    scopes: Object.freeze(continuation.scopes.map((entry) => Object.freeze({
      locator: Object.freeze({ ...entry.locator }),
      attemptDiscovery: entry.attemptDiscovery.kind === "continuing"
        ? Object.freeze({
          kind: "continuing",
          continuation: Object.freeze({
            ...entry.attemptDiscovery.continuation,
          }),
        })
        : Object.freeze({ kind: "unstarted" }),
    }))),
  });
}

function captureEvidenceResult(input: unknown): Result.Result<
  EncodedPointMutationMultiScopeRedeliveryContinuationV1,
  PointMutationMultiScopeRedeliveryContinuationCodecV1Error
> {
  if (
    typeof input !== "object" || input === null || Array.isArray(input) ||
    Reflect.get(input, "codecVersion") !==
      POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_CODEC_V1
  ) {
    return Result.fail(codecError("decode", "invalidInput"));
  }
  const canonicalBytes = Reflect.get(input, "canonicalBytes");
  if (!isUint8Array(canonicalBytes)) {
    return Result.fail(codecError("decode", "invalidBytes"));
  }
  const sizeFailure = continuationSizeFailure("decode", canonicalBytes);
  if (sizeFailure !== undefined) return Result.fail(sizeFailure);
  const sha256 = Reflect.get(input, "sha256");
  if (!isUint8Array(sha256) || sha256.byteLength !== 32) {
    return Result.fail(codecError("decode", "invalidDigest"));
  }
  return Result.succeed(captureEncoded(canonicalBytes, sha256));
}

function canonicalBytesEffect(
  continuation: PointMutationMultiScopeRedeliveryContinuationV1,
  operation: "encode" | "decode",
): Effect.Effect<
  Uint8Array,
  PointMutationMultiScopeRedeliveryContinuationCodecV1Error
> {
  return Effect.gen(function* () {
    if (!isJsonObjectFromUnknown(continuation)) {
      return yield* codecError(operation, "invalidInput");
    }
    const canonicalText = encodeCanonicalJson(continuation, (cause) => {
      throw cause;
    });
    const canonicalBytes = TEXT_ENCODER.encode(canonicalText);
    const sizeFailure = continuationSizeFailure(operation, canonicalBytes);
    if (sizeFailure !== undefined) return yield* sizeFailure;
    return canonicalBytes;
  });
}

function decodeJsonEffect(
  bytes: Uint8Array,
): Effect.Effect<
  unknown,
  PointMutationMultiScopeRedeliveryContinuationCodecV1Error
> {
  return Effect.try({
    try: () => JSON.parse(TEXT_DECODER.decode(bytes)) as unknown,
    catch: (cause) =>
      codecError(
        "decode",
        cause instanceof TypeError ? "invalidUtf8" : "invalidJson",
        cause,
      ),
  });
}

function continuationSizeFailure(
  operation: "encode" | "decode",
  bytes: Uint8Array,
): PointMutationMultiScopeRedeliveryContinuationCodecV1Error | undefined {
  return bytes.byteLength >= 1 &&
      bytes.byteLength <=
        MAX_POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_BYTES_V1
    ? undefined
    : codecError(operation, "sizeExceeded", undefined, bytes.byteLength);
}

function sha256Effect(
  bytes: Uint8Array,
  operation: "encode" | "decode",
): Effect.Effect<
  Uint8Array,
  PointMutationMultiScopeRedeliveryContinuationCodecV1Error
> {
  const input = new Uint8Array(bytes);
  return Effect.tryPromise({
    try: async () =>
      new Uint8Array(await crypto.subtle.digest("SHA-256", input)),
    catch: (cause) => codecError(operation, "cryptoFailed", cause),
  });
}

function captureEncoded(
  canonicalBytes: Uint8Array,
  sha256: Uint8Array,
): EncodedPointMutationMultiScopeRedeliveryContinuationV1 {
  const bytes = new Uint8Array(canonicalBytes);
  const digest = new Uint8Array(sha256);
  return Object.freeze({
    codecVersion:
      POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_CODEC_V1,
    get canonicalBytes() {
      return new Uint8Array(bytes);
    },
    get sha256() {
      return new Uint8Array(digest);
    },
  });
}

function codecError(
  operation: "encode" | "decode",
  reason: PointMutationMultiScopeRedeliveryContinuationCodecV1Error["reason"],
  cause?: unknown,
  observedBytes?: number,
): PointMutationMultiScopeRedeliveryContinuationCodecV1Error {
  return new PointMutationMultiScopeRedeliveryContinuationCodecV1Error({
    operation,
    reason,
    ...(observedBytes === undefined ? {} : {
      observedBytes,
      maximumBytes:
        MAX_POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_BYTES_V1,
    }),
    ...(cause === undefined ? {} : { cause }),
  });
}
