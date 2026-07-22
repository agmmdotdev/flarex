import { isUint8Array } from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Effect } from "effect";

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

export type PrivateSha256V1Foreign = (
  ownedInput: ArrayBuffer,
) => PromiseLike<unknown>;

export interface PrivateSha256V1ErrorPolicy<E> {
  readonly invalidBudget: () => E;
  readonly invalidBytes: () => E;
  readonly inputBytesExceeded: (observed: number, maximum: number) => E;
  readonly unavailable: () => E;
  readonly nativeRejected: (cause: DOMException) => E;
  readonly invalidDigestOutput: (observedByteLength: number | undefined) => unknown;
}

export type PrivateSha256V1<E> = (
  input: unknown,
  budget: unknown,
) => Effect.Effect<Uint8Array, E, never>;

class PrivateSha256V1ForeignError {
  readonly _tag = "PrivateSha256V1ForeignError";

  constructor(readonly cause: unknown) {}
}

class PrivateSha256V1UnavailableError {
  readonly _tag = "PrivateSha256V1UnavailableError";
}

class PrivateSha256V1LiveResolutionDefect {
  readonly _tag = "PrivateSha256V1LiveResolutionDefect";

  constructor(readonly cause: unknown) {}
}

export function makePrivateSha256V1<E>(
  foreign: PrivateSha256V1Foreign,
  policy: PrivateSha256V1ErrorPolicy<E>,
): PrivateSha256V1<E> {
  return makePrivateSha256V1Operation(foreign, policy, undefined);
}

export function makeLivePrivateSha256V1<E>(
  policy: PrivateSha256V1ErrorPolicy<E>,
): PrivateSha256V1<E> {
  const unavailable = new PrivateSha256V1UnavailableError();
  return makePrivateSha256V1Operation(ownedInput => {
    let cryptoValue: unknown;
    try {
      cryptoValue = globalThis.crypto;
    } catch (cause) {
      throw new PrivateSha256V1LiveResolutionDefect(cause);
    }
    if (!isNonArrayRecord(cryptoValue)) return Promise.reject(unavailable);
    let subtle: unknown;
    try {
      subtle = cryptoValue.subtle;
    } catch (cause) {
      throw new PrivateSha256V1LiveResolutionDefect(cause);
    }
    if (!isNonArrayRecord(subtle)) return Promise.reject(unavailable);
    let digest: unknown;
    try {
      digest = subtle.digest;
    } catch (cause) {
      throw new PrivateSha256V1LiveResolutionDefect(cause);
    }
    if (typeof digest !== "function") return Promise.reject(unavailable);
    return Reflect.apply(digest, subtle, ["SHA-256", ownedInput]) as PromiseLike<unknown>;
  }, policy, unavailable);
}

function makePrivateSha256V1Operation<E>(
  foreign: PrivateSha256V1Foreign,
  policy: PrivateSha256V1ErrorPolicy<E>,
  unavailable: PrivateSha256V1UnavailableError | undefined,
): PrivateSha256V1<E> {
  return Effect.fn("PrivateSha256V1.digest")(function* (input: unknown, budget: unknown) {
    const maximum = yield* decodeBudget(budget, policy);
    const captured = yield* captureInput(input, maximum, policy);
    const outcome = yield* Effect.tryPromise({
      try: () => foreign(captured),
      catch: cause => new PrivateSha256V1ForeignError(cause),
    }).pipe(
      Effect.catchTag("PrivateSha256V1ForeignError", failure => {
        if (unavailable !== undefined && failure.cause === unavailable) {
          return Effect.fail(policy.unavailable());
        }
        if (isLiveResolutionDefect(failure.cause)) {
          return Effect.die(failure.cause.cause);
        }
        if (!isDirectDomException(failure.cause)) return Effect.die(failure.cause);
        return Effect.fail(policy.nativeRejected(failure.cause));
      }),
    );
    return yield* captureDigestOutput(outcome, policy);
  });
}

function decodeBudget<E>(
  value: unknown,
  policy: PrivateSha256V1ErrorPolicy<E>,
): Effect.Effect<number, E> {
  if (
    !isNonArrayRecord(value) ||
    typeof value.maximumInputBytes !== "number" ||
    !Number.isSafeInteger(value.maximumInputBytes) ||
    value.maximumInputBytes < 0
  ) {
    return Effect.fail(policy.invalidBudget());
  }
  return Effect.succeed(value.maximumInputBytes);
}

function captureInput<E>(
  value: unknown,
  maximum: number,
  policy: PrivateSha256V1ErrorPolicy<E>,
): Effect.Effect<ArrayBuffer, E> {
  if (!isUint8Array(value)) return Effect.fail(policy.invalidBytes());
  const byteLength = intrinsicTypedArrayByteLength(value);
  const byteOffset = intrinsicTypedArrayByteOffset(value);
  const buffer = intrinsicTypedArrayBuffer(value);
  if (
    byteLength === undefined || byteOffset === undefined || buffer === undefined ||
    intrinsicArrayBufferByteLength(buffer) === undefined
  ) {
    return Effect.fail(policy.invalidBytes());
  }
  if (byteLength > maximum) {
    return Effect.fail(policy.inputBytesExceeded(byteLength, maximum));
  }
  const output = new ArrayBuffer(byteLength);
  new Uint8Array(output).set(new Uint8Array(buffer, byteOffset, byteLength));
  return Effect.succeed(output);
}

function captureDigestOutput<E>(
  value: unknown,
  policy: PrivateSha256V1ErrorPolicy<E>,
): Effect.Effect<Uint8Array> {
  if (!isIntrinsicArrayBuffer(value)) {
    return Effect.die(policy.invalidDigestOutput(undefined));
  }
  const length = intrinsicArrayBufferByteLength(value);
  if (length !== SHA256_BYTES) {
    return Effect.die(policy.invalidDigestOutput(length));
  }
  const copy = new Uint8Array(SHA256_BYTES);
  copy.set(new Uint8Array(value));
  return Effect.succeed(copy);
}

function isDirectDomException(value: unknown): value is DOMException {
  if (
    DOM_EXCEPTION_CONSTRUCTOR === undefined || DOM_EXCEPTION_CODE_GETTER === undefined
  ) {
    return false;
  }
  try {
    if (
      !(value instanceof DOM_EXCEPTION_CONSTRUCTOR) ||
      value.constructor !== DOM_EXCEPTION_CONSTRUCTOR
    ) {
      return false;
    }
    return typeof DOM_EXCEPTION_CODE_GETTER.call(value) === "number";
  } catch {
    return false;
  }
}

function isLiveResolutionDefect(
  value: unknown,
): value is PrivateSha256V1LiveResolutionDefect {
  try {
    return value instanceof PrivateSha256V1LiveResolutionDefect;
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
