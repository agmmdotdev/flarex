import {
  bytesEqualFullScan,
  copyBytes,
  uint8ArrayByteLength,
} from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Effect } from "effect";

export interface ImmutableR2Bucket {
  readonly put: (
    key: string,
    value: ArrayBuffer,
    options: Readonly<{
      readonly onlyIf: Readonly<{ readonly etagDoesNotMatch: "*" }>;
    }>,
  ) => PromiseLike<unknown>;
  readonly get: (key: string) => PromiseLike<unknown>;
}

export interface ImmutableR2ReadRequest<E> {
  readonly key: string;
  readonly expectedSha256: Uint8Array;
  readonly expectedByteLength?: number;
  readonly maximumBodyBytes?: number;
  readonly maximumHashBytes?: number;
  readonly admit?: (
    receipt: Readonly<{ readonly byteLength: number }>,
  ) => Effect.Effect<void, E>;
}

export interface ImmutableR2PutRequest {
  readonly key: string;
  readonly expectedSha256: Uint8Array;
  readonly bytes: Uint8Array;
  readonly maximumBodyBytes: number;
  readonly maximumHashBytes: number;
}

export interface ImmutableR2ReadResult {
  readonly bytes: Uint8Array;
  readonly byteLength: number;
}

export class ImmutableR2NotFoundError
  extends Data.TaggedError("ImmutableR2NotFoundError")<{
    readonly key: string;
  }> {}

export class ImmutableR2ResourceError
  extends Data.TaggedError("ImmutableR2ResourceError")<{
    readonly operation: "put" | "get" | "readBody";
    readonly key: string;
  }> {}

export class ImmutableR2CorruptionError
  extends Data.TaggedError("ImmutableR2CorruptionError")<{
    readonly key: string;
    readonly reason:
      | "digestMismatch"
      | "keyCollision"
      | "invalidBody"
      | "invalidMetadata"
      | "sizeMismatch";
  }> {}

export class ImmutableR2BodyBudgetExceededError
  extends Data.TaggedError("ImmutableR2BodyBudgetExceededError")<{
    readonly key: string;
    readonly observed: number;
    readonly maximum: number;
  }> {}

export class ImmutableR2SettlementUncertainError
  extends Data.TaggedError("ImmutableR2SettlementUncertainError")<{
    readonly key: string;
    readonly stage: "firstCreate" | "repeatCreate" | "reconcileRead";
  }> {}

export type ImmutableR2StoreError<HashError> =
  | ImmutableR2NotFoundError
  | ImmutableR2ResourceError
  | ImmutableR2BodyBudgetExceededError
  | ImmutableR2CorruptionError
  | ImmutableR2SettlementUncertainError
  | HashError;

export interface ImmutableR2ByteStore<HashError> {
  readonly putImmutable: (
    request: ImmutableR2PutRequest,
  ) => Effect.Effect<ImmutableR2ReadResult, ImmutableR2StoreError<HashError>>;
  readonly readImmutable: <E>(
    request: ImmutableR2ReadRequest<E>,
  ) => Effect.Effect<ImmutableR2ReadResult, ImmutableR2StoreError<HashError> | E>;
}

const resourceCauses = new WeakMap<ImmutableR2ResourceError, unknown>();
const uncertainCauses = new WeakMap<
  ImmutableR2SettlementUncertainError,
  unknown
>();

export function immutableR2ResourceCause(
  error: ImmutableR2ResourceError,
): unknown {
  return resourceCauses.get(error);
}

export function immutableR2SettlementUncertainCause(
  error: ImmutableR2SettlementUncertainError,
): unknown {
  return uncertainCauses.get(error);
}

class InvalidBody extends Error {}
class SizeMismatch extends Error {}

export function makeImmutableR2ByteStore<HashError>(
  bucket: ImmutableR2Bucket,
  sha256: (
    bytes: Uint8Array,
    maximumInputBytes: number,
  ) => Effect.Effect<Uint8Array, HashError>,
): ImmutableR2ByteStore<HashError> {
  const readImmutable: ImmutableR2ByteStore<HashError>["readImmutable"] =
    Effect.fn("ImmutableR2ByteStore.readImmutable")(function* <E>(
      request: ImmutableR2ReadRequest<E>,
    ) {
      const object = yield* getObject(bucket, request.key);
      const byteLength = yield* objectSize(request.key, object);
      if (
        request.expectedByteLength !== undefined &&
        byteLength !== request.expectedByteLength
      ) {
        return yield* new ImmutableR2CorruptionError({
          key: request.key,
          reason: "sizeMismatch",
        });
      }
      if (
        request.maximumBodyBytes !== undefined &&
        byteLength > request.maximumBodyBytes
      ) {
        return yield* new ImmutableR2BodyBudgetExceededError({
          key: request.key,
          observed: byteLength,
          maximum: request.maximumBodyBytes,
        });
      }
      if (request.admit !== undefined) {
        yield* request.admit(Object.freeze({ byteLength }));
      }
      const bytes = yield* readObjectBody(request.key, object, byteLength);
      const actual = yield* sha256(
        copyBytes(bytes),
        request.maximumHashBytes ?? byteLength,
      );
      if (!bytesEqualFullScan(actual, request.expectedSha256)) {
        return yield* new ImmutableR2CorruptionError({
          key: request.key,
          reason: "digestMismatch",
        });
      }
      return Object.freeze({ bytes: copyBytes(bytes), byteLength });
    });

  const putImmutable: ImmutableR2ByteStore<HashError>["putImmutable"] =
    Effect.fn("ImmutableR2ByteStore.putImmutable")(function* (request) {
      const expected = copyBytes(request.bytes);
      const actual = yield* sha256(
        copyBytes(expected),
        request.maximumHashBytes,
      );
      if (!bytesEqualFullScan(actual, request.expectedSha256)) {
        return yield* new ImmutableR2CorruptionError({
          key: request.key,
          reason: "digestMismatch",
        });
      }
      if (expected.byteLength > request.maximumBodyBytes) {
        return yield* new ImmutableR2CorruptionError({
          key: request.key,
          reason: "sizeMismatch",
        });
      }
      return yield* Effect.uninterruptible(Effect.gen(function* () {
        const first = yield* createConditional(bucket, request.key, expected)
          .pipe(
            Effect.as(null),
            Effect.catchTag("ImmutableR2ResourceError", Effect.succeed),
          );
        if (first === null) {
          return yield* verifyStored(request, expected, readImmutable<never>);
        }
        const reconciled = yield* reconcile(
          request,
          expected,
          readImmutable<never>,
          "firstCreate",
          first,
        );
        if (reconciled !== null) return reconciled;
        const repeated = yield* createConditional(bucket, request.key, expected)
          .pipe(
            Effect.as(null),
            Effect.catchTag("ImmutableR2ResourceError", Effect.succeed),
          );
        if (repeated === null) {
          return yield* verifyStored(request, expected, readImmutable<never>);
        }
        const repeatedReconciliation = yield* reconcile(
          request,
          expected,
          readImmutable<never>,
          "repeatCreate",
          repeated,
        );
        if (repeatedReconciliation !== null) return repeatedReconciliation;
        const uncertain = new ImmutableR2SettlementUncertainError({
          key: request.key,
          stage: "repeatCreate",
        });
        uncertainCauses.set(uncertain, resourceCauses.get(repeated));
        return yield* uncertain;
      }));
    });

  return Object.freeze({ putImmutable, readImmutable });
}

function getObject(
  bucket: ImmutableR2Bucket,
  key: string,
): Effect.Effect<
  Readonly<Record<PropertyKey, unknown>>,
  ImmutableR2NotFoundError | ImmutableR2ResourceError | ImmutableR2CorruptionError
> {
  return Effect.gen(function* () {
    const object = yield* Effect.tryPromise({
      try: () => Reflect.apply(bucket.get, bucket, [key]) as PromiseLike<unknown>,
      catch: cause => resourceFailure("get", key, cause),
    });
    if (object === null) return yield* new ImmutableR2NotFoundError({ key });
    if (!isNonArrayRecord(object)) {
      return yield* new ImmutableR2CorruptionError({
        key,
        reason: "invalidMetadata",
      });
    }
    return object;
  });
}

function createConditional(
  bucket: ImmutableR2Bucket,
  key: string,
  bytes: Uint8Array,
): Effect.Effect<void, ImmutableR2ResourceError> {
  return Effect.tryPromise({
    try: () => {
      const body = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(body).set(bytes);
      return Reflect.apply(bucket.put, bucket, [
        key,
        body,
        { onlyIf: { etagDoesNotMatch: "*" } },
      ]) as PromiseLike<unknown>;
    },
    catch: cause => resourceFailure("put", key, cause),
  }).pipe(Effect.flatMap(result =>
    result === null || isNonArrayRecord(result)
      ? Effect.void
      : Effect.die(new Error("R2 conditional put returned an invalid result."))
  ));
}

function objectSize(
  key: string,
  object: Readonly<Record<PropertyKey, unknown>>,
): Effect.Effect<number, ImmutableR2ResourceError | ImmutableR2CorruptionError> {
  let size: unknown;
  try {
    size = object.size;
  } catch (cause) {
    return Effect.fail(resourceFailure("readBody", key, cause));
  }
  return typeof size === "number" && Number.isSafeInteger(size) && size >= 1
    ? Effect.succeed(size)
    : Effect.fail(new ImmutableR2CorruptionError({
      key,
      reason: "invalidMetadata",
    }));
}

function readObjectBody(
  key: string,
  object: Readonly<Record<PropertyKey, unknown>>,
  exactSize: number,
): Effect.Effect<Uint8Array, ImmutableR2ResourceError | ImmutableR2CorruptionError> {
  let body: unknown;
  try {
    body = object.body;
  } catch (cause) {
    return Effect.fail(resourceFailure("readBody", key, cause));
  }
  if (!isNonArrayRecord(body)) {
    return Effect.fail(new ImmutableR2CorruptionError({
      key,
      reason: "invalidBody",
    }));
  }
  return Effect.tryPromise({
    try: signal => readBodyBounded(body, exactSize, signal),
    catch: cause => cause instanceof SizeMismatch
      ? new ImmutableR2CorruptionError({ key, reason: "sizeMismatch" })
      : cause instanceof InvalidBody
        ? new ImmutableR2CorruptionError({ key, reason: "invalidBody" })
        : resourceFailure("readBody", key, cause),
  });
}

function verifyStored<HashError>(
  request: ImmutableR2PutRequest,
  expected: Uint8Array,
  read: (
    request: ImmutableR2ReadRequest<never>,
  ) => Effect.Effect<ImmutableR2ReadResult, ImmutableR2StoreError<HashError>>,
): Effect.Effect<ImmutableR2ReadResult, ImmutableR2StoreError<HashError>> {
  return read({
    key: request.key,
    expectedSha256: request.expectedSha256,
    expectedByteLength: expected.byteLength,
    maximumBodyBytes: request.maximumBodyBytes,
    maximumHashBytes: request.maximumHashBytes,
  }).pipe(Effect.flatMap(stored =>
    bytesEqualFullScan(stored.bytes, expected)
      ? Effect.succeed(stored)
      : Effect.fail(new ImmutableR2CorruptionError({
        key: request.key,
        reason: "keyCollision",
      }))
  ));
}

function reconcile<HashError>(
  request: ImmutableR2PutRequest,
  expected: Uint8Array,
  read: (
    request: ImmutableR2ReadRequest<never>,
  ) => Effect.Effect<ImmutableR2ReadResult, ImmutableR2StoreError<HashError>>,
  stage: "firstCreate" | "repeatCreate",
  primary: ImmutableR2ResourceError,
): Effect.Effect<
  ImmutableR2ReadResult | null,
  ImmutableR2StoreError<HashError>
> {
  return verifyStored(request, expected, read).pipe(
    Effect.matchEffect({
      onSuccess: value =>
        Effect.succeed<ImmutableR2ReadResult | null>(value),
      onFailure: (error: ImmutableR2StoreError<HashError>) => {
      if (error instanceof ImmutableR2NotFoundError) {
        return Effect.succeed(null);
      }
      if (error instanceof ImmutableR2ResourceError) {
        const uncertain = new ImmutableR2SettlementUncertainError({
          key: request.key,
          stage: "reconcileRead",
        });
        uncertainCauses.set(uncertain, Object.freeze({
          primary: resourceCauses.get(primary),
          secondary: resourceCauses.get(error),
          createStage: stage,
        }));
        return Effect.fail(uncertain);
      }
      return Effect.fail(error);
      },
    }),
  );
}

function resourceFailure(
  operation: ImmutableR2ResourceError["operation"],
  key: string,
  cause: unknown,
): ImmutableR2ResourceError {
  const error = new ImmutableR2ResourceError({ operation, key });
  resourceCauses.set(error, cause);
  return error;
}

async function readBodyBounded(
  body: Readonly<Record<PropertyKey, unknown>>,
  exactSize: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  let reader: unknown;
  try {
    const getReader = body.getReader;
    if (typeof getReader !== "function") throw new InvalidBody();
    reader = Reflect.apply(getReader, body, []);
  } catch (cause) {
    if (cause instanceof InvalidBody) throw cause;
    throw new InvalidBody();
  }
  if (!isNonArrayRecord(reader)) throw new InvalidBody();
  const read = reader.read;
  const cancel = reader.cancel;
  const releaseLock = reader.releaseLock;
  if (
    typeof read !== "function" ||
    !(cancel === undefined || typeof cancel === "function") ||
    !(releaseLock === undefined || typeof releaseLock === "function")
  ) throw new InvalidBody();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const abort = () => {
    if (typeof cancel !== "function") return;
    try {
      void Promise.resolve(Reflect.apply(cancel, reader, ["interrupted"]))
        .catch(() => undefined);
    } catch {
      // Preserve the interruption Cause; cancellation is best effort.
    }
  };
  signal.addEventListener("abort", abort, { once: true });
  let primaryFailure = false;
  try {
    try {
      while (true) {
        const result = await Reflect.apply(read, reader, []);
        if (!isNonArrayRecord(result) || typeof result.done !== "boolean") {
          throw new InvalidBody();
        }
        if (result.done) break;
        const length = uint8ArrayByteLength(result.value);
        if (length === undefined) throw new InvalidBody();
        const next = total + length;
        if (!Number.isSafeInteger(next) || next > exactSize) {
          throw new SizeMismatch();
        }
        chunks.push(copyBytes(result.value as Uint8Array));
        total = next;
      }
      if (total !== exactSize) throw new SizeMismatch();
    } catch (cause) {
      primaryFailure = true;
      throw cause;
    }
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  } finally {
    signal.removeEventListener("abort", abort);
    if (primaryFailure && typeof cancel === "function") {
      try {
        void Promise.resolve(
          Reflect.apply(cancel, reader, ["invalid immutable object body"]),
        ).catch(() => undefined);
      } catch {
        // Preserve the primary corruption or resource failure.
      }
    }
    if (typeof releaseLock === "function") {
      try {
        Reflect.apply(releaseLock, reader, []);
      } catch (cause) {
        if (!primaryFailure) throw cause;
      }
    }
  }
}
