import { isUint8Array } from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Effect, Result } from "effect";

const SHA256_BYTE_LENGTH = 32;
const TYPED_ARRAY_PROTOTYPE: object = Object.getPrototypeOf(
  Uint8Array.prototype,
);
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteLength",
)?.get;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "buffer",
)?.get;
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get;
const DOM_EXCEPTION_CONSTRUCTOR = typeof DOMException === "undefined"
  ? undefined
  : DOMException;
const DOM_EXCEPTION_CODE_GETTER = DOM_EXCEPTION_CONSTRUCTOR === undefined
  ? undefined
  : Object.getOwnPropertyDescriptor(
    DOM_EXCEPTION_CONSTRUCTOR.prototype,
    "code",
  )?.get;

export interface FunctionMetadataSha256BudgetV1 {
  readonly maximumInputBytes: number;
}

export type FunctionMetadataSha256InputReasonV1 =
  | "invalidBudget"
  | "invalidBytes"
  | "inputBytesExceeded";

export class FunctionMetadataSha256InputV1Error extends Data.TaggedError(
  "FunctionMetadataSha256InputV1Error",
)<{
  readonly reason: FunctionMetadataSha256InputReasonV1;
  readonly maximumInputBytes?: number;
}> {}

export class FunctionMetadataSha256ResourceV1Error extends Data.TaggedError(
  "FunctionMetadataSha256ResourceV1Error",
)<{
  readonly reason: "unavailable" | "nativeRejected";
}> {}

export class FunctionMetadataSha256InvariantV1Defect extends Data.TaggedError(
  "FunctionMetadataSha256InvariantV1Defect",
)<{
  readonly reason: "invalidPlatformIntrinsic" | "invalidDigestOutput";
  readonly observedByteLength?: number;
}> {}

export type FunctionMetadataSha256V1Error =
  | FunctionMetadataSha256InputV1Error
  | FunctionMetadataSha256ResourceV1Error;

export type FunctionMetadataSha256ForeignDigestV1 = (
  ownedInput: ArrayBuffer,
) => PromiseLike<unknown>;

export type FunctionMetadataSha256V1 = (
  input: unknown,
  budget: unknown,
) => Effect.Effect<Uint8Array, FunctionMetadataSha256V1Error>;

class FunctionMetadataSha256ForeignV1Error extends Data.TaggedError(
  "FunctionMetadataSha256ForeignV1Error",
)<{
  readonly cause: unknown;
}> {}

class FunctionMetadataSha256LiveResolutionV1Defect extends Data.TaggedError(
  "FunctionMetadataSha256LiveResolutionV1Defect",
)<{
  readonly cause: unknown;
}> {}

const UNAVAILABLE = Object.freeze({
  tag: "FunctionMetadataSha256UnavailableV1" as const,
});
const NATIVE_RESOURCE_CAUSES = new WeakMap<
  FunctionMetadataSha256ResourceV1Error,
  DOMException
>();

export function createFunctionMetadataSha256V1(
  digest: FunctionMetadataSha256ForeignDigestV1,
): FunctionMetadataSha256V1 {
  return Effect.fn("FunctionMetadata.sha256V1")(function* (
    input: unknown,
    budget: unknown,
  ): Effect.fn.Return<Uint8Array, FunctionMetadataSha256V1Error> {
    const ownedInput = yield* Effect.fromResult(captureInput(input, budget));
    const foreignOutput = yield* Effect.tryPromise({
      try: () => digest(ownedInput),
      catch: (cause) => new FunctionMetadataSha256ForeignV1Error({ cause }),
    }).pipe(
      Effect.catchTag("FunctionMetadataSha256ForeignV1Error", (failure) => {
        if (failure.cause === UNAVAILABLE) {
          return Effect.fail(new FunctionMetadataSha256ResourceV1Error({
            reason: "unavailable",
          }));
        }
        if (isLiveResolutionDefect(failure.cause)) {
          return Effect.die(failure.cause.cause);
        }
        if (isDirectDomException(failure.cause)) {
          const resource = new FunctionMetadataSha256ResourceV1Error({
            reason: "nativeRejected",
          });
          NATIVE_RESOURCE_CAUSES.set(resource, failure.cause);
          return Effect.fail(resource);
        }
        return Effect.die(failure.cause);
      }),
    );
    return captureDigestOutput(foreignOutput);
  });
}

export const hashFunctionMetadataSha256V1 = createFunctionMetadataSha256V1(
  (ownedInput) => {
    let cryptoValue: unknown;
    try {
      cryptoValue = globalThis.crypto;
    } catch (cause) {
      throw new FunctionMetadataSha256LiveResolutionV1Defect({ cause });
    }
    if (!isNonArrayRecord(cryptoValue)) throw UNAVAILABLE;
    let subtle: unknown;
    try {
      subtle = cryptoValue.subtle;
    } catch (cause) {
      throw new FunctionMetadataSha256LiveResolutionV1Defect({ cause });
    }
    if (!isNonArrayRecord(subtle)) throw UNAVAILABLE;
    let digest: unknown;
    try {
      digest = subtle.digest;
    } catch (cause) {
      throw new FunctionMetadataSha256LiveResolutionV1Defect({ cause });
    }
    if (typeof digest !== "function") throw UNAVAILABLE;
    return Reflect.apply(digest, subtle, ["SHA-256", ownedInput]);
  },
);

export function inspectFunctionMetadataSha256NativeCauseV1(
  error: FunctionMetadataSha256ResourceV1Error,
): DOMException | undefined {
  return NATIVE_RESOURCE_CAUSES.get(error);
}

function captureInput(
  input: unknown,
  budget: unknown,
): Result.Result<ArrayBuffer, FunctionMetadataSha256InputV1Error> {
  return Result.gen(function* () {
    const maximumInputBytes = yield* decodeBudget(budget);
    if (!isUint8Array(input)) {
      return yield* Result.fail(inputError("invalidBytes"));
    }
    const byteLength = intrinsicUint8ArrayByteLength(input);
    if (byteLength === undefined || !hasOrdinaryReadableBuffer(input)) {
      return yield* Result.fail(inputError("invalidBytes"));
    }
    if (byteLength > maximumInputBytes) {
      return yield* Result.fail(new FunctionMetadataSha256InputV1Error({
        reason: "inputBytesExceeded",
        maximumInputBytes,
      }));
    }
    const ownedInput = new Uint8Array(byteLength);
    try {
      Uint8Array.prototype.set.call(ownedInput, input);
    } catch (cause) {
      if (cause instanceof TypeError) {
        return yield* Result.fail(inputError("invalidBytes"));
      }
      throw cause;
    }
    return ownedInput.buffer;
  });
}

function decodeBudget(
  input: unknown,
): Result.Result<number, FunctionMetadataSha256InputV1Error> {
  if (!isNonArrayRecord(input)) {
    return Result.fail(inputError("invalidBudget"));
  }
  const descriptor = Object.getOwnPropertyDescriptor(input, "maximumInputBytes");
  if (descriptor === undefined || !("value" in descriptor)) {
    return Result.fail(inputError("invalidBudget"));
  }
  const maximumInputBytes: unknown = descriptor.value;
  return typeof maximumInputBytes === "number" &&
      Number.isSafeInteger(maximumInputBytes) && maximumInputBytes >= 0
    ? Result.succeed(maximumInputBytes)
    : Result.fail(inputError("invalidBudget"));
}

function intrinsicUint8ArrayByteLength(input: Uint8Array): number | undefined {
  if (TYPED_ARRAY_BYTE_LENGTH_GETTER === undefined) {
    throw new FunctionMetadataSha256InvariantV1Defect({
      reason: "invalidPlatformIntrinsic",
    });
  }
  try {
    const byteLength: unknown = TYPED_ARRAY_BYTE_LENGTH_GETTER.call(input);
    return typeof byteLength === "number" ? byteLength : undefined;
  } catch {
    return undefined;
  }
}

function hasOrdinaryReadableBuffer(input: Uint8Array): boolean {
  if (
    TYPED_ARRAY_BUFFER_GETTER === undefined ||
    ARRAY_BUFFER_BYTE_LENGTH_GETTER === undefined
  ) {
    throw new FunctionMetadataSha256InvariantV1Defect({
      reason: "invalidPlatformIntrinsic",
    });
  }
  try {
    const buffer: unknown = TYPED_ARRAY_BUFFER_GETTER.call(input);
    ARRAY_BUFFER_BYTE_LENGTH_GETTER.call(buffer);
    Uint8Array.prototype.values.call(input).next();
    return true;
  } catch (cause) {
    if (cause instanceof TypeError) return false;
    throw cause;
  }
}

function captureDigestOutput(input: unknown): Uint8Array {
  if (ARRAY_BUFFER_BYTE_LENGTH_GETTER === undefined) {
    throw new FunctionMetadataSha256InvariantV1Defect({
      reason: "invalidPlatformIntrinsic",
    });
  }
  let observedByteLength: number | undefined;
  try {
    const byteLength: unknown = ARRAY_BUFFER_BYTE_LENGTH_GETTER.call(input);
    if (typeof byteLength === "number") observedByteLength = byteLength;
  } catch {
    throw new FunctionMetadataSha256InvariantV1Defect({
      reason: "invalidDigestOutput",
    });
  }
  if (observedByteLength !== SHA256_BYTE_LENGTH) {
    throw observedByteLength === undefined
      ? new FunctionMetadataSha256InvariantV1Defect({
        reason: "invalidDigestOutput",
      })
      : new FunctionMetadataSha256InvariantV1Defect({
        reason: "invalidDigestOutput",
        observedByteLength,
      });
  }
  if (!isIntrinsicArrayBuffer(input)) {
    throw new FunctionMetadataSha256InvariantV1Defect({
      reason: "invalidDigestOutput",
    });
  }
  const output = new Uint8Array(SHA256_BYTE_LENGTH);
  Uint8Array.prototype.set.call(output, new Uint8Array(input));
  return output;
}

function isIntrinsicArrayBuffer(input: unknown): input is ArrayBuffer {
  if (ARRAY_BUFFER_BYTE_LENGTH_GETTER === undefined) return false;
  try {
    return typeof ARRAY_BUFFER_BYTE_LENGTH_GETTER.call(input) === "number";
  } catch {
    return false;
  }
}

function isDirectDomException(input: unknown): input is DOMException {
  if (
    DOM_EXCEPTION_CONSTRUCTOR === undefined ||
    DOM_EXCEPTION_CODE_GETTER === undefined
  ) {
    return false;
  }
  try {
    if (!(input instanceof DOM_EXCEPTION_CONSTRUCTOR)) return false;
    return typeof DOM_EXCEPTION_CODE_GETTER.call(input) === "number";
  } catch {
    return false;
  }
}

function isLiveResolutionDefect(
  input: unknown,
): input is FunctionMetadataSha256LiveResolutionV1Defect {
  try {
    return input instanceof FunctionMetadataSha256LiveResolutionV1Defect;
  } catch {
    return false;
  }
}

function inputError(
  reason: Extract<
    FunctionMetadataSha256InputReasonV1,
    "invalidBudget" | "invalidBytes"
  >,
): FunctionMetadataSha256InputV1Error {
  return new FunctionMetadataSha256InputV1Error({ reason });
}
