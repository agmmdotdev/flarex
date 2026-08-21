import {
  copyBytes,
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { isNonBlankString } from "@flarex/utils/strings";
import { Data, Effect, Result, Schema } from "effect";

import {
  canonicalizeApplicationRuntimeTargetV1,
  type ApplicationRuntimeTargetV1,
} from "./application-runtime-target-v1";
import { encodeCanonicalJson, type JsonObject } from "./json";
import { CatalogSchemaVersionIdSchema } from "./schema-manifest";

const UTF8 = new TextEncoder();
const LOWERCASE_SHA256 = /^[0-9a-f]{64}$/;
const DECIMAL_SEQUENCE = /^[1-9][0-9]*$/;
const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;

export const APPLICATION_ACTION_EXECUTION_AUTHORITY_FORMAT_V1 =
  "flarex.application-action-execution-authority";
export const APPLICATION_ACTION_EXECUTION_AUTHORITY_VERSION_V1 = 1;
export const MAX_APPLICATION_ACTION_EXECUTION_AUTHORITY_BYTES_V1 = 131_072;

export interface ApplicationActionExecutionAuthorityV1 {
  readonly format: typeof APPLICATION_ACTION_EXECUTION_AUTHORITY_FORMAT_V1;
  readonly version: typeof APPLICATION_ACTION_EXECUTION_AUTHORITY_VERSION_V1;
  readonly runtimeTarget: ApplicationRuntimeTargetV1;
  readonly runtimeTargetSha256: string;
  readonly activationSequence: string;
  readonly activeHeadSha256: string;
  readonly schemaVersionId: string;
}

export interface CanonicalApplicationActionExecutionAuthorityV1 {
  readonly authority: ApplicationActionExecutionAuthorityV1;
  readonly authorityJson: JsonObject;
  readonly canonicalBytes: Uint8Array;
  readonly sha256: Uint8Array;
}

export class ApplicationActionExecutionAuthorityV1Error
  extends Data.TaggedError("ApplicationActionExecutionAuthorityV1Error")<{
    readonly operation: "canonicalize";
    readonly reason:
      | "invalidShape"
      | "invalidRuntimeTarget"
      | "runtimeTargetDigestMismatch"
      | "bytesExceeded"
      | "hashFailure";
    readonly cause?: unknown;
  }> {}

const decodeSchemaVersionId = Schema.decodeUnknownResult(
  Schema.toType(CatalogSchemaVersionIdSchema),
);

export const canonicalizeApplicationActionExecutionAuthorityV1 = Effect.fn(
  "ApplicationActionExecutionAuthority.canonicalizeV1",
)(function* (
  input: unknown,
): Effect.fn.Return<
  CanonicalApplicationActionExecutionAuthorityV1,
  ApplicationActionExecutionAuthorityV1Error
> {
  const captured = yield* Effect.fromResult(captureAuthority(input));
  const target = yield* Effect.fromResult(
    canonicalizeApplicationRuntimeTargetV1(captured.runtimeTarget).pipe(
      Result.mapError(cause => failure("invalidRuntimeTarget", cause)),
    ),
  );
  if (
    target.target.function.kind !== "action" ||
    target.target.function.visibility !== "public"
  ) return yield* failureEffect("invalidRuntimeTarget");
  const runtimeTargetSha256 = yield* sha256Hex(target.canonicalBytes);
  if (runtimeTargetSha256 !== captured.runtimeTargetSha256) {
    return yield* failureEffect("runtimeTargetDigestMismatch");
  }
  const authorityJson = Object.freeze({
    format: APPLICATION_ACTION_EXECUTION_AUTHORITY_FORMAT_V1,
    version: APPLICATION_ACTION_EXECUTION_AUTHORITY_VERSION_V1,
    runtimeTarget: target.target,
    runtimeTargetSha256,
    activationSequence: captured.activationSequence,
    activeHeadSha256: captured.activeHeadSha256,
    schemaVersionId: captured.schemaVersionId,
  }) satisfies JsonObject;
  const canonicalBytes = UTF8.encode(encodeCanonicalJson(
    authorityJson,
    issue => {
      throw new Error(
        `Application action authority invariant: ${issue.reason}`,
      );
    },
  ));
  if (
    canonicalBytes.byteLength < 1 ||
    canonicalBytes.byteLength >
      MAX_APPLICATION_ACTION_EXECUTION_AUTHORITY_BYTES_V1
  ) return yield* failureEffect("bytesExceeded");
  const sha256 = yield* hash(canonicalBytes);
  const stableBytes = copyBytes(canonicalBytes);
  const stableSha256 = copyBytes(sha256);
  return Object.freeze({
    authority: Object.freeze({ ...authorityJson }),
    authorityJson,
    get canonicalBytes(): Uint8Array {
      return copyBytes(stableBytes);
    },
    get sha256(): Uint8Array {
      return copyBytes(stableSha256);
    },
  } satisfies CanonicalApplicationActionExecutionAuthorityV1);
});

interface CapturedAuthority {
  readonly runtimeTarget: unknown;
  readonly runtimeTargetSha256: string;
  readonly activationSequence: string;
  readonly activeHeadSha256: string;
  readonly schemaVersionId: string;
}

function captureAuthority(
  input: unknown,
): Result.Result<
  CapturedAuthority,
  ApplicationActionExecutionAuthorityV1Error
> {
  return Result.try({
    try: () => {
      if (!isNonArrayRecord(input)) throw new Error("record");
      const expected = [
        "format",
        "version",
        "runtimeTarget",
        "runtimeTargetSha256",
        "activationSequence",
        "activeHeadSha256",
        "schemaVersionId",
      ] as const;
      const keys = Reflect.ownKeys(input);
      if (
        keys.length !== expected.length ||
        keys.some(key => typeof key !== "string" || !expected.includes(
          // SAFETY: each key is proven to be a plain string before the
          // membership test; the cast only narrows it to the expected
          // union.
          key as typeof expected[number],
        ))
      ) throw new Error("keys");
      // SAFETY: a freshly created null-prototype object is used as a
      // mutable string-keyed record for validated descriptor values.
      const values = Object.create(null) as Record<string, unknown>;
      for (const key of expected) {
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (
          descriptor === undefined || descriptor.enumerable !== true ||
          !("value" in descriptor)
        ) throw new Error(key);
        values[key] = descriptor.value;
      }
      if (
        values.format !== APPLICATION_ACTION_EXECUTION_AUTHORITY_FORMAT_V1 ||
        values.version !== APPLICATION_ACTION_EXECUTION_AUTHORITY_VERSION_V1 ||
        typeof values.runtimeTargetSha256 !== "string" ||
        !LOWERCASE_SHA256.test(values.runtimeTargetSha256) ||
        typeof values.activeHeadSha256 !== "string" ||
        !LOWERCASE_SHA256.test(values.activeHeadSha256) ||
        typeof values.activationSequence !== "string" ||
        !DECIMAL_SEQUENCE.test(values.activationSequence) ||
        BigInt(values.activationSequence) > MAX_POSTGRES_BIGINT ||
        !isNonBlankString(values.schemaVersionId)
      ) throw new Error("fields");
      const schemaVersionId = Result.getOrThrow(
        decodeSchemaVersionId(values.schemaVersionId),
      );
      return Object.freeze({
        runtimeTarget: values.runtimeTarget,
        runtimeTargetSha256: values.runtimeTargetSha256,
        activationSequence: values.activationSequence,
        activeHeadSha256: values.activeHeadSha256,
        schemaVersionId,
      });
    },
    catch: cause => failure("invalidShape", cause),
  });
}

function sha256Hex(
  bytes: Uint8Array,
): Effect.Effect<string, ApplicationActionExecutionAuthorityV1Error> {
  return hash(bytes).pipe(Effect.map(encodeBytesToLowercaseHex));
}

function hash(
  bytes: Uint8Array,
): Effect.Effect<Uint8Array, ApplicationActionExecutionAuthorityV1Error> {
  return Effect.tryPromise({
    try: () => globalThis.crypto.subtle.digest(
      "SHA-256",
      copyBytesToArrayBuffer(bytes),
    ),
    catch: cause => failure("hashFailure", cause),
  }).pipe(Effect.map(buffer => new Uint8Array(buffer)));
}

function failure(
  reason: ApplicationActionExecutionAuthorityV1Error["reason"],
  cause?: unknown,
): ApplicationActionExecutionAuthorityV1Error {
  return new ApplicationActionExecutionAuthorityV1Error({
    operation: "canonicalize",
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}

function failureEffect(
  reason: ApplicationActionExecutionAuthorityV1Error["reason"],
) {
  return Effect.fail(failure(reason));
}
