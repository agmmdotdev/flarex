import {
  copyBytes,
  copyBytesToArrayBuffer,
  isUint8Array,
  uint8ArrayByteLength,
} from "@flarex/utils/bytes";
import { Effect, Encoding, Result } from "effect";
import {
  encodeCanonicalJson,
  measureCanonicalJsonUtf8Bytes,
  type Json,
  type JsonObject,
} from "flarex-protocol/json";

import { hasExactOwnDataKeys } from "../exactOwnDataKeys";

const SHA256_BYTE_LENGTH = 32;
const MAX_STORED_JSON_DEPTH = 128;
const UTF8 = new TextEncoder();
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get;

export class PrivateCanonicalValueInvariantDefect extends Error {
  readonly _tag = "PrivateCanonicalValueInvariantDefect";

  constructor(readonly reason: "canonicalFrameInvalid" | "invalidDigestOutput") {
    super(`Private canonical value invariant failed: ${reason}`);
  }
}

export interface PrivateCanonicalValueSnapshot<Frame extends JsonObject> {
  readonly frame: Frame;
  readonly canonicalJson: string;
  readonly canonicalByteLength: number;
  readonly sha256Hex: string;
  readonly copyCanonicalBytes: () => Uint8Array;
  readonly copySha256Bytes: () => Uint8Array;
}

export interface PrivateCanonicalValueErrorPolicy<Error> {
  readonly invalidInput: () => Error;
  readonly hashFailure: (cause: unknown) => Error;
}

export interface PrivateCanonicalStoredValueErrorPolicy<Error> {
  readonly storedCorruption: () => Error;
  readonly hashFailure: (cause: unknown) => Error;
}

export interface VerifyStoredPrivateCanonicalValueInput {
  readonly canonicalBytes: unknown;
  readonly sha256Hex: unknown;
  readonly expectedFormat: string;
  readonly expectedVersion: number;
  readonly maximumCanonicalBytes: number;
  readonly expectedKeys: readonly string[] | undefined;
  readonly validateFrame?: (frame: JsonObject) => boolean;
}

/**
 * Package-private portable capture mechanics for framework lifecycle values.
 * Domain modules remain responsible for exact fields, semantic validation,
 * brands, and comparison policy.
 */
export const capturePrivateCanonicalValue = Effect.fn(
  "FrameworkSchema.capturePrivateCanonicalValue",
)(function* <Frame extends JsonObject, Error>(
  frame: Frame,
  maximumCanonicalBytes: number,
  errors: PrivateCanonicalValueErrorPolicy<Error>,
): Effect.fn.Return<PrivateCanonicalValueSnapshot<Frame>, Error> {
  const measurement = measureCanonicalJsonUtf8Bytes(
    frame,
    maximumCanonicalBytes,
  );
  if (measurement.kind === "invalid") {
    return yield* Effect.die(new PrivateCanonicalValueInvariantDefect(
      "canonicalFrameInvalid",
    ));
  }
  if (measurement.kind === "exceeded") {
    return yield* Effect.fail(errors.invalidInput());
  }
  const canonicalJson = encodeCanonicalJson(frame, () => {
    throw new PrivateCanonicalValueInvariantDefect("canonicalFrameInvalid");
  });
  const canonicalBytes = UTF8.encode(canonicalJson);
  if (canonicalBytes.byteLength !== measurement.bytes) {
    return yield* Effect.die(new PrivateCanonicalValueInvariantDefect(
      "canonicalFrameInvalid",
    ));
  }
  const foreignDigest = yield* Effect.tryPromise({
    try: () => globalThis.crypto.subtle.digest(
      "SHA-256",
      copyBytesToArrayBuffer(canonicalBytes),
    ),
    catch: errors.hashFailure,
  });
  const sha256Bytes = yield* Result.match(
    validateSha256ArrayBuffer(foreignDigest),
    {
      onFailure: Effect.die,
      onSuccess: digest => Effect.succeed(copyBytes(new Uint8Array(digest))),
    },
  );
  const ownedCanonicalBytes = copyBytes(canonicalBytes);
  const ownedSha256Bytes = copyBytes(sha256Bytes);
  return Object.freeze({
    frame,
    canonicalJson,
    canonicalByteLength: canonicalBytes.byteLength,
    sha256Hex: Encoding.encodeHex(ownedSha256Bytes),
    copyCanonicalBytes: () => copyBytes(ownedCanonicalBytes),
    copySha256Bytes: () => copyBytes(ownedSha256Bytes),
  });
});

/** Verifies exact stored bytes and returns a detached, recursively frozen JSON frame. */
export const verifyStoredPrivateCanonicalValue = Effect.fn(
  "FrameworkSchema.verifyStoredPrivateCanonicalValue",
)(function* <Error>(
  input: VerifyStoredPrivateCanonicalValueInput,
  errors: PrivateCanonicalStoredValueErrorPolicy<Error>,
): Effect.fn.Return<JsonObject, Error> {
  const canonicalBytes = input.canonicalBytes;
  const sha256Hex = input.sha256Hex;
  const canonicalByteLength = uint8ArrayByteLength(canonicalBytes);
  if (
    canonicalByteLength === undefined ||
    !isUint8Array(canonicalBytes) ||
    canonicalByteLength < 1 ||
    canonicalByteLength > input.maximumCanonicalBytes ||
    typeof sha256Hex !== "string" ||
    !/^[0-9a-f]{64}$/.test(sha256Hex)
  ) {
    return yield* Effect.fail(errors.storedCorruption());
  }
  const ownedBytes = copyBytes(canonicalBytes);
  const decoded = yield* Effect.fromResult(Result.try({
    try: () => {
      const canonicalJson = new TextDecoder("utf-8", { fatal: true }).decode(
        ownedBytes,
      );
      const parsed: unknown = JSON.parse(canonicalJson);
      return { canonicalJson, parsed };
    },
    catch: errors.storedCorruption,
  }));
  if (
    !isParsedJsonObjectWithBoundedDepth(
      decoded.parsed,
      MAX_STORED_JSON_DEPTH,
    ) ||
    (input.expectedKeys !== undefined &&
      !hasExactOwnDataKeys(decoded.parsed, input.expectedKeys)) ||
    decoded.parsed.format !== input.expectedFormat ||
    decoded.parsed.version !== input.expectedVersion ||
    !validateStoredFrame(decoded.parsed, input.validateFrame)
  ) {
    return yield* Effect.fail(errors.storedCorruption());
  }
  const frame = freezeJson(decoded.parsed);
  const captured = yield* capturePrivateCanonicalValue(
    frame,
    input.maximumCanonicalBytes,
    {
      invalidInput: errors.storedCorruption,
      hashFailure: errors.hashFailure,
    },
  );
  if (
    captured.canonicalJson !== decoded.canonicalJson ||
    captured.sha256Hex !== sha256Hex
  ) {
    return yield* Effect.fail(errors.storedCorruption());
  }
  return frame;
});

function validateSha256ArrayBuffer(
  input: unknown,
): Result.Result<ArrayBuffer, PrivateCanonicalValueInvariantDefect> {
  if (ARRAY_BUFFER_BYTE_LENGTH_GETTER === undefined) {
    return Result.fail(new PrivateCanonicalValueInvariantDefect(
      "invalidDigestOutput",
    ));
  }
  try {
    const byteLength: unknown = ARRAY_BUFFER_BYTE_LENGTH_GETTER.call(input);
    if (byteLength !== SHA256_BYTE_LENGTH) {
      return Result.fail(new PrivateCanonicalValueInvariantDefect(
        "invalidDigestOutput",
      ));
    }
  } catch {
    return Result.fail(new PrivateCanonicalValueInvariantDefect(
      "invalidDigestOutput",
    ));
  }
  // SAFETY: The intrinsic getter above proves a cross-realm ArrayBuffer.
  return Result.succeed(input as ArrayBuffer);
}

function freezeJson<Value extends Json>(value: Value): Value {
  if (value === null || typeof value !== "object") return value;
  const pending: Array<Readonly<{ value: Json; visited: boolean }>> = [{
    value,
    visited: false,
  }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (
      current === undefined ||
      current.value === null ||
      typeof current.value !== "object"
    ) {
      continue;
    }
    if (current.visited) {
      Object.freeze(current.value);
      continue;
    }
    pending.push({ value: current.value, visited: true });
    const members: readonly Json[] = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value);
    for (const member of members) {
      if (member !== null && typeof member === "object") {
        pending.push({ value: member, visited: false });
      }
    }
  }
  return value;
}

function isParsedJsonObjectWithBoundedDepth(
  input: unknown,
  maximumDepth: number,
): input is JsonObject {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return false;
  }
  return isParsedJsonValueAtDepth(input, 0, maximumDepth);
}

function isParsedJsonValueAtDepth(
  input: unknown,
  depth: number,
  maximumDepth: number,
): input is Json {
  if (depth > maximumDepth) return false;
  if (input === null || typeof input === "string" ||
    typeof input === "boolean") return true;
  if (typeof input === "number") return Number.isFinite(input);
  if (typeof input !== "object") return false;
  try {
    if (Array.isArray(input)) {
      if (Object.getPrototypeOf(input) !== Array.prototype) return false;
      const length = input.length;
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
          input,
          String(index),
        );
        if (
          descriptor === undefined ||
          !("value" in descriptor) ||
          !descriptor.enumerable ||
          !isParsedJsonValueAtDepth(
            descriptor.value,
            depth + 1,
            maximumDepth,
          )
        ) return false;
      }
      return true;
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return false;
    // JSON.parse produces only own string-keyed data properties. Iterate them
    // without materializing a second wide key array before domain bounds run.
    for (const key in input) {
      if (!Object.hasOwn(input, key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        !descriptor.enumerable ||
        !isParsedJsonValueAtDepth(
          descriptor.value,
          depth + 1,
          maximumDepth,
        )
      ) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function validateStoredFrame(
  frame: JsonObject,
  validate: ((frame: JsonObject) => boolean) | undefined,
): boolean {
  return validate === undefined || validate(frame);
}
