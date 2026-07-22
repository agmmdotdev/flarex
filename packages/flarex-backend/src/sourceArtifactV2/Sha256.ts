import { isUint8Array } from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Effect } from "effect";

const SHA256_BYTES = 32;
const TYPED_ARRAY_PROTOTYPE: object = Object.getPrototypeOf(Uint8Array.prototype);
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteLength",
)?.get;
const TYPED_ARRAY_BYTE_OFFSET_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteOffset",
)?.get;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "buffer",
)?.get;
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get;
const DOM_EXCEPTION_CONSTRUCTOR = typeof DOMException === "undefined" ? undefined : DOMException;
const DOM_EXCEPTION_CODE_GETTER = DOM_EXCEPTION_CONSTRUCTOR === undefined
  ? undefined
  : Object.getOwnPropertyDescriptor(DOM_EXCEPTION_CONSTRUCTOR.prototype, "code")?.get;

export interface SourceArtifactV2Sha256Budget {
  readonly maximumInputBytes: number;
}

export class SourceArtifactV2Sha256InputError extends Data.TaggedError(
  "SourceArtifactV2Sha256InputError",
)<{
  readonly reason: "invalidBudget" | "invalidBytes" | "inputBytesExceeded";
  readonly observed?: number;
  readonly maximum?: number;
}> {}

export class SourceArtifactV2Sha256ResourceError extends Data.TaggedError(
  "SourceArtifactV2Sha256ResourceError",
)<{
  readonly reason: "unavailable" | "nativeRejected";
}> {}

export class SourceArtifactV2Sha256InvariantDefect extends Data.TaggedError(
  "SourceArtifactV2Sha256InvariantDefect",
)<{
  readonly reason: "invalidPlatformIntrinsic" | "invalidDigestOutput";
  readonly observedByteLength?: number;
}> {}

export type SourceArtifactV2Sha256Error =
  | SourceArtifactV2Sha256InputError
  | SourceArtifactV2Sha256ResourceError;

export type SourceArtifactV2ForeignSha256 = (
  ownedInput: ArrayBuffer,
) => PromiseLike<unknown>;

export type SourceArtifactV2Sha256 = (
  input: unknown,
  budget: unknown,
) => Effect.Effect<Uint8Array, SourceArtifactV2Sha256Error, never>;

class SourceArtifactV2ForeignSha256Error extends Data.TaggedError(
  "SourceArtifactV2ForeignSha256Error",
)<{
  readonly cause: unknown;
}> {}

class SourceArtifactV2Sha256UnavailableError extends Data.TaggedError(
  "SourceArtifactV2Sha256UnavailableError",
)<{}> {}

const nativeCauseByResourceError = new WeakMap<SourceArtifactV2Sha256ResourceError, DOMException>();

export function sourceArtifactV2Sha256NativeCause(
  error: SourceArtifactV2Sha256ResourceError,
): DOMException | undefined {
  return nativeCauseByResourceError.get(error);
}

export function makeSourceArtifactV2Sha256(
  foreign: SourceArtifactV2ForeignSha256,
): SourceArtifactV2Sha256 {
  return Effect.fn("SourceArtifactV2.sha256")(function* (input: unknown, budget: unknown) {
    const maximum = yield* decodeBudget(budget);
    const captured = yield* captureInput(input, maximum);
    const outcome = yield* Effect.tryPromise({
      try: () => foreign(captured),
      catch: cause => new SourceArtifactV2ForeignSha256Error({ cause }),
    }).pipe(
      Effect.catchTag("SourceArtifactV2ForeignSha256Error", failure => {
        if (failure.cause instanceof SourceArtifactV2Sha256UnavailableError) {
          return Effect.fail(new SourceArtifactV2Sha256ResourceError({ reason: "unavailable" }));
        }
        if (!isDirectDomException(failure.cause)) return Effect.die(failure.cause);
        const error = new SourceArtifactV2Sha256ResourceError({ reason: "nativeRejected" });
        nativeCauseByResourceError.set(error, failure.cause);
        return Effect.fail(error);
      }),
    );
    return yield* captureDigestOutput(outcome);
  });
}

export function makeLiveSourceArtifactV2Sha256(): SourceArtifactV2Sha256 {
  return makeSourceArtifactV2Sha256(ownedInput => {
    const cryptoValue: unknown = globalThis.crypto;
    if (!isNonArrayRecord(cryptoValue)) {
      return Promise.reject(new SourceArtifactV2Sha256UnavailableError());
    }
    const subtle: unknown = cryptoValue.subtle;
    if (!isNonArrayRecord(subtle) || typeof subtle.digest !== "function") {
      return Promise.reject(new SourceArtifactV2Sha256UnavailableError());
    }
    return Reflect.apply(subtle.digest, subtle, ["SHA-256", ownedInput]) as PromiseLike<unknown>;
  });
}

function decodeBudget(value: unknown): Effect.Effect<number, SourceArtifactV2Sha256InputError> {
  if (
    !isNonArrayRecord(value) ||
    typeof value.maximumInputBytes !== "number" ||
    !Number.isSafeInteger(value.maximumInputBytes) ||
    value.maximumInputBytes < 0
  ) {
    return Effect.fail(new SourceArtifactV2Sha256InputError({ reason: "invalidBudget" }));
  }
  return Effect.succeed(value.maximumInputBytes);
}

function captureInput(
  value: unknown,
  maximum: number,
): Effect.Effect<ArrayBuffer, SourceArtifactV2Sha256InputError> {
  if (!isUint8Array(value)) {
    return Effect.fail(new SourceArtifactV2Sha256InputError({ reason: "invalidBytes" }));
  }
  const byteLength = intrinsicTypedArrayByteLength(value);
  const byteOffset = intrinsicTypedArrayByteOffset(value);
  const buffer = intrinsicTypedArrayBuffer(value);
  if (
    byteLength === undefined || byteOffset === undefined || buffer === undefined ||
    intrinsicArrayBufferByteLength(buffer) === undefined
  ) {
    return Effect.fail(new SourceArtifactV2Sha256InputError({ reason: "invalidBytes" }));
  }
  if (byteLength > maximum) {
    return Effect.fail(new SourceArtifactV2Sha256InputError({
      reason: "inputBytesExceeded",
      observed: byteLength,
      maximum,
    }));
  }
  const output = new ArrayBuffer(byteLength);
  new Uint8Array(output).set(new Uint8Array(buffer, byteOffset, byteLength));
  return Effect.succeed(output);
}

function captureDigestOutput(value: unknown): Effect.Effect<Uint8Array> {
  if (!(isIntrinsicArrayBuffer(value))) {
    return Effect.die(new SourceArtifactV2Sha256InvariantDefect({
      reason: "invalidDigestOutput",
    }));
  }
  const length = intrinsicArrayBufferByteLength(value);
  if (length !== SHA256_BYTES) {
    return Effect.die(new SourceArtifactV2Sha256InvariantDefect({
      reason: "invalidDigestOutput",
      ...(length === undefined ? {} : { observedByteLength: length }),
    }));
  }
  const copy = new Uint8Array(SHA256_BYTES);
  copy.set(new Uint8Array(value));
  return Effect.succeed(copy);
}

function isDirectDomException(value: unknown): value is DOMException {
  if (
    DOM_EXCEPTION_CONSTRUCTOR === undefined || DOM_EXCEPTION_CODE_GETTER === undefined ||
    !(value instanceof DOM_EXCEPTION_CONSTRUCTOR) || value.constructor !== DOM_EXCEPTION_CONSTRUCTOR
  ) {
    return false;
  }
  try {
    return typeof DOM_EXCEPTION_CODE_GETTER.call(value) === "number";
  } catch {
    return false;
  }
}

function intrinsicTypedArrayByteLength(value: Uint8Array): number | undefined {
  try {
    const result: unknown = TYPED_ARRAY_BYTE_LENGTH_GETTER?.call(value);
    return typeof result === "number" ? result : undefined;
  } catch {
    return undefined;
  }
}

function intrinsicTypedArrayByteOffset(value: Uint8Array): number | undefined {
  try {
    const result: unknown = TYPED_ARRAY_BYTE_OFFSET_GETTER?.call(value);
    return typeof result === "number" ? result : undefined;
  } catch {
    return undefined;
  }
}

function intrinsicTypedArrayBuffer(value: Uint8Array): ArrayBuffer | undefined {
  try {
    const result: unknown = TYPED_ARRAY_BUFFER_GETTER?.call(value);
    return isIntrinsicArrayBuffer(result) ? result : undefined;
  } catch {
    return undefined;
  }
}

function intrinsicArrayBufferByteLength(value: ArrayBuffer): number | undefined {
  try {
    const result: unknown = ARRAY_BUFFER_BYTE_LENGTH_GETTER?.call(value);
    return typeof result === "number" ? result : undefined;
  } catch {
    return undefined;
  }
}

function isIntrinsicArrayBuffer(value: unknown): value is ArrayBuffer {
  if (value === null || typeof value !== "object") return false;
  return intrinsicArrayBufferByteLength(value as ArrayBuffer) !== undefined;
}
