import {
  bytesEqualFullScan,
  copyBytes,
  isUint8Array,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Effect, Result } from "effect";
import {
  declarativeV2RuntimeArtifactObjectKeyV1,
  makeDeclarativeV2RuntimeArtifactObjectReferenceV1,
  type DeclarativeV2RuntimeArtifactObjectKindV1,
  type DeclarativeV2RuntimeArtifactObjectReferenceV1,
} from "flarex-protocol/internal/declarative-v2-runtime-projection-v1";

import type {
  DeclarativeV2RuntimeArtifactSha256V1,
  DeclarativeV2RuntimeArtifactSha256V1Error,
} from "./DeclarativeV2RuntimeArtifactSha256";

const DIGEST_BYTES = 32;
const TYPED_ARRAY_PROTOTYPE: object = Object.getPrototypeOf(
  Uint8Array.prototype,
);
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteLength",
)?.get;

export interface DeclarativeV2RuntimeArtifactR2BucketV1 {
  put(
    key: string,
    value: ArrayBuffer,
    options: { readonly onlyIf: { readonly etagDoesNotMatch: string } },
  ): PromiseLike<unknown>;
  get(key: string): PromiseLike<unknown>;
}

export interface DeclarativeV2RuntimeArtifactR2BudgetV1 {
  readonly maximumBodyBytes: number;
  readonly maximumHashBytes: number;
}

export type DeclarativeV2RuntimeArtifactR2OperationV1 =
  | "putImmutable"
  | "readImmutable"
  | "readImmutableAdmitted";

export class DeclarativeV2RuntimeArtifactR2InputV1Error
  extends Data.TaggedError("DeclarativeV2RuntimeArtifactR2InputV1Error")<{
    readonly operation: DeclarativeV2RuntimeArtifactR2OperationV1;
    readonly field: "kind" | "digest" | "bytes" | "budget";
    readonly reason: "invalidInput" | "budgetExceeded";
  }> {}

export class DeclarativeV2RuntimeArtifactR2NotFoundV1Error
  extends Data.TaggedError("DeclarativeV2RuntimeArtifactR2NotFoundV1Error")<{
    readonly key: string;
  }> {}

export class DeclarativeV2RuntimeArtifactR2ResourceV1Error
  extends Data.TaggedError("DeclarativeV2RuntimeArtifactR2ResourceV1Error")<{
    readonly operation: "put" | "get" | "readBody";
    readonly key: string;
  }> {}

export class DeclarativeV2RuntimeArtifactR2CorruptionV1Error
  extends Data.TaggedError("DeclarativeV2RuntimeArtifactR2CorruptionV1Error")<{
    readonly key: string;
    readonly reason:
      | "digestMismatch"
      | "keyCollision"
      | "invalidBody"
      | "invalidMetadata"
      | "sizeMismatch";
  }> {}

export class DeclarativeV2RuntimeArtifactR2SettlementUncertainV1Error
  extends Data.TaggedError(
    "DeclarativeV2RuntimeArtifactR2SettlementUncertainV1Error",
  )<{
    readonly key: string;
    readonly stage: "firstCreate" | "repeatCreate" | "reconcileRead";
  }> {}

export type DeclarativeV2RuntimeArtifactR2V1Error =
  | DeclarativeV2RuntimeArtifactR2InputV1Error
  | DeclarativeV2RuntimeArtifactR2NotFoundV1Error
  | DeclarativeV2RuntimeArtifactR2ResourceV1Error
  | DeclarativeV2RuntimeArtifactR2CorruptionV1Error
  | DeclarativeV2RuntimeArtifactR2SettlementUncertainV1Error
  | DeclarativeV2RuntimeArtifactSha256V1Error;

export interface DeclarativeV2RuntimeArtifactR2ObjectV1 {
  readonly reference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
  readonly bytes: Uint8Array;
}

export interface DeclarativeV2RuntimeArtifactR2AdmissionV1 {
  readonly reference: DeclarativeV2RuntimeArtifactObjectReferenceV1;
}

export interface DeclarativeV2RuntimeArtifactR2StoreV1 {
  readonly putImmutable: (
    kind: DeclarativeV2RuntimeArtifactObjectKindV1,
    digest: unknown,
    bytes: unknown,
    budget: unknown,
  ) => Effect.Effect<
    DeclarativeV2RuntimeArtifactObjectReferenceV1,
    DeclarativeV2RuntimeArtifactR2V1Error
  >;
  readonly readImmutable: (
    kind: DeclarativeV2RuntimeArtifactObjectKindV1,
    digest: unknown,
    budget: unknown,
  ) => Effect.Effect<
    DeclarativeV2RuntimeArtifactR2ObjectV1,
    DeclarativeV2RuntimeArtifactR2V1Error
  >;
  readonly readImmutableAdmitted: <E>(
    kind: DeclarativeV2RuntimeArtifactObjectKindV1,
    digest: unknown,
    admit: (
      receipt: DeclarativeV2RuntimeArtifactR2AdmissionV1,
    ) => Effect.Effect<void, E>,
  ) => Effect.Effect<
    DeclarativeV2RuntimeArtifactR2ObjectV1,
    DeclarativeV2RuntimeArtifactR2V1Error | E
  >;
}

const resourceCauses = new WeakMap<
  DeclarativeV2RuntimeArtifactR2ResourceV1Error,
  unknown
>();
const uncertainCauses = new WeakMap<
  DeclarativeV2RuntimeArtifactR2SettlementUncertainV1Error,
  unknown
>();

export function declarativeV2RuntimeArtifactR2ResourceCauseV1(
  error: DeclarativeV2RuntimeArtifactR2ResourceV1Error,
): unknown {
  return resourceCauses.get(error);
}

export function declarativeV2RuntimeArtifactR2UncertainCauseV1(
  error: DeclarativeV2RuntimeArtifactR2SettlementUncertainV1Error,
): unknown {
  return uncertainCauses.get(error);
}

class InvalidBody extends Error {}
class SizeMismatch extends Error {}

export function makeDeclarativeV2RuntimeArtifactR2StoreV1(
  bucket: DeclarativeV2RuntimeArtifactR2BucketV1,
  sha256: DeclarativeV2RuntimeArtifactSha256V1,
): DeclarativeV2RuntimeArtifactR2StoreV1 {
  const getObject = Effect.fn(
    "DeclarativeV2RuntimeArtifactR2.getObjectV1",
  )(function* (
    key: string,
  ): Effect.fn.Return<
    Readonly<Record<PropertyKey, unknown>>,
    DeclarativeV2RuntimeArtifactR2NotFoundV1Error |
      DeclarativeV2RuntimeArtifactR2ResourceV1Error |
      DeclarativeV2RuntimeArtifactR2CorruptionV1Error
  > {
    const object = yield* Effect.tryPromise({
      try: () => Reflect.apply(bucket.get, bucket, [key]) as PromiseLike<unknown>,
      catch: cause => resourceFailure("get", key, cause),
    });
    if (object === null) {
      return yield* new DeclarativeV2RuntimeArtifactR2NotFoundV1Error({ key });
    }
    if (!isNonArrayRecord(object)) {
      return yield* new DeclarativeV2RuntimeArtifactR2CorruptionV1Error({
        key,
        reason: "invalidMetadata",
      });
    }
    return object;
  });

  const readImmutableAdmitted = Effect.fn(
    "DeclarativeV2RuntimeArtifactR2.readImmutableAdmittedV1",
  )(function* <E>(
    kind: DeclarativeV2RuntimeArtifactObjectKindV1,
    digestInput: unknown,
    admit: (
      receipt: DeclarativeV2RuntimeArtifactR2AdmissionV1,
    ) => Effect.Effect<void, E>,
  ): Effect.fn.Return<
    DeclarativeV2RuntimeArtifactR2ObjectV1,
    DeclarativeV2RuntimeArtifactR2V1Error | E
  > {
    const digest = yield* decodeDigest(
      "readImmutableAdmitted",
      digestInput,
    );
    const key = yield* keyFor("readImmutableAdmitted", kind, digest);
    const object = yield* getObject(key);
    const byteLength = yield* objectSize(key, object);
    const reference = yield* referenceFor(kind, digest, byteLength);
    yield* admit(Object.freeze({ reference }));
    const bytes = yield* readObjectBody(key, object, byteLength, true);
    yield* verifyDigest(key, bytes, digest, byteLength, sha256);
    return Object.freeze({ reference, bytes: copyBytes(bytes) });
  });

  const readImmutable = Effect.fn(
    "DeclarativeV2RuntimeArtifactR2.readImmutableV1",
  )(function* (
    kind: DeclarativeV2RuntimeArtifactObjectKindV1,
    digestInput: unknown,
    budgetInput: unknown,
  ): Effect.fn.Return<
    DeclarativeV2RuntimeArtifactR2ObjectV1,
    DeclarativeV2RuntimeArtifactR2V1Error
  > {
    const digest = yield* decodeDigest("readImmutable", digestInput);
    const budget = yield* decodeBudget("readImmutable", budgetInput);
    const key = yield* keyFor("readImmutable", kind, digest);
    const object = yield* getObject(key);
    const byteLength = yield* objectSize(key, object);
    if (byteLength > budget.maximumBodyBytes) {
      return yield* inputFailure(
        "readImmutable",
        "budget",
        "budgetExceeded",
      );
    }
    const bytes = yield* readObjectBody(
      key,
      object,
      budget.maximumBodyBytes,
      false,
    );
    if (bytes.byteLength !== byteLength) {
      return yield* new DeclarativeV2RuntimeArtifactR2CorruptionV1Error({
        key,
        reason: "sizeMismatch",
      });
    }
    yield* verifyDigest(key, bytes, digest, budget.maximumHashBytes, sha256);
    return Object.freeze({
      reference: yield* referenceFor(kind, digest, bytes.byteLength),
      bytes: copyBytes(bytes),
    });
  });

  const putImmutable = Effect.fn(
    "DeclarativeV2RuntimeArtifactR2.putImmutableV1",
  )(function* (
    kind: DeclarativeV2RuntimeArtifactObjectKindV1,
    digestInput: unknown,
    bytesInput: unknown,
    budgetInput: unknown,
  ): Effect.fn.Return<
    DeclarativeV2RuntimeArtifactObjectReferenceV1,
    DeclarativeV2RuntimeArtifactR2V1Error
  > {
    const digest = yield* decodeDigest("putImmutable", digestInput);
    const budget = yield* decodeBudget("putImmutable", budgetInput);
    const bytes = yield* captureBytes(
      "putImmutable",
      bytesInput,
      budget.maximumBodyBytes,
    );
    const key = yield* keyFor("putImmutable", kind, digest);
    yield* verifyDigest(key, bytes, digest, budget.maximumHashBytes, sha256);
    return yield* Effect.uninterruptible(Effect.gen(function* () {
      const first = yield* createConditional(bucket, key, bytes).pipe(
        Effect.map(() => null),
        Effect.catchTag(
          "DeclarativeV2RuntimeArtifactR2ResourceV1Error",
          Effect.succeed,
        ),
      );
      if (first === null) {
        return yield* verifyStored(kind, digest, bytes, budget, readImmutable);
      }
      const reconciled = yield* reconcile(
        kind,
        digest,
        bytes,
        budget,
        readImmutable,
        "firstCreate",
        first,
      );
      if (reconciled !== null) return reconciled;
      const repeated = yield* createConditional(bucket, key, bytes).pipe(
        Effect.map(() => null),
        Effect.catchTag(
          "DeclarativeV2RuntimeArtifactR2ResourceV1Error",
          Effect.succeed,
        ),
      );
      if (repeated === null) {
        return yield* verifyStored(kind, digest, bytes, budget, readImmutable);
      }
      const repeatedReconciliation = yield* reconcile(
        kind,
        digest,
        bytes,
        budget,
        readImmutable,
        "repeatCreate",
        repeated,
      );
      if (repeatedReconciliation !== null) return repeatedReconciliation;
      const uncertain = new DeclarativeV2RuntimeArtifactR2SettlementUncertainV1Error({
        key,
        stage: "repeatCreate",
      });
      uncertainCauses.set(uncertain, resourceCauses.get(repeated));
      return yield* uncertain;
    }));
  });

  return Object.freeze({ putImmutable, readImmutable, readImmutableAdmitted });
}

function createConditional(
  bucket: DeclarativeV2RuntimeArtifactR2BucketV1,
  key: string,
  bytes: Uint8Array,
): Effect.Effect<void, DeclarativeV2RuntimeArtifactR2ResourceV1Error> {
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
      : Effect.die(new Error(
        "R2 conditional put returned an invalid result.",
      ))
  ));
}

function decodeBudget(
  operation: DeclarativeV2RuntimeArtifactR2OperationV1,
  value: unknown,
): Effect.Effect<
  DeclarativeV2RuntimeArtifactR2BudgetV1,
  DeclarativeV2RuntimeArtifactR2InputV1Error
> {
  if (
    !isNonArrayRecord(value) ||
    typeof value.maximumBodyBytes !== "number" ||
    !Number.isSafeInteger(value.maximumBodyBytes) ||
    value.maximumBodyBytes < 1 ||
    typeof value.maximumHashBytes !== "number" ||
    !Number.isSafeInteger(value.maximumHashBytes) ||
    value.maximumHashBytes < 1
  ) {
    return inputFailure(operation, "budget", "invalidInput");
  }
  return Effect.succeed(Object.freeze({
    maximumBodyBytes: value.maximumBodyBytes,
    maximumHashBytes: value.maximumHashBytes,
  }));
}

function decodeDigest(
  operation: DeclarativeV2RuntimeArtifactR2OperationV1,
  value: unknown,
): Effect.Effect<Uint8Array, DeclarativeV2RuntimeArtifactR2InputV1Error> {
  return isUint8ArrayWithByteLength(value, DIGEST_BYTES)
    ? Effect.succeed(copyBytes(value))
    : inputFailure(operation, "digest", "invalidInput");
}

function captureBytes(
  operation: DeclarativeV2RuntimeArtifactR2OperationV1,
  value: unknown,
  maximum: number,
): Effect.Effect<Uint8Array, DeclarativeV2RuntimeArtifactR2InputV1Error> {
  const byteLength = intrinsicByteLength(value);
  if (byteLength === undefined || byteLength < 1 || byteLength > maximum) {
    return inputFailure(
      operation,
      "bytes",
      byteLength !== undefined && byteLength > maximum
        ? "budgetExceeded"
        : "invalidInput",
    );
  }
  return Effect.succeed(copyBytes(value as Uint8Array));
}

function keyFor(
  operation: DeclarativeV2RuntimeArtifactR2OperationV1,
  kind: DeclarativeV2RuntimeArtifactObjectKindV1,
  digest: Uint8Array,
): Effect.Effect<string, DeclarativeV2RuntimeArtifactR2InputV1Error> {
  return Effect.fromResult(
    declarativeV2RuntimeArtifactObjectKeyV1(kind, digest).pipe(
      Result.mapError(() => new DeclarativeV2RuntimeArtifactR2InputV1Error({
        operation,
        field: "kind",
        reason: "invalidInput",
      })),
    ),
  );
}

function referenceFor(
  kind: DeclarativeV2RuntimeArtifactObjectKindV1,
  digest: Uint8Array,
  byteLength: number,
): Effect.Effect<DeclarativeV2RuntimeArtifactObjectReferenceV1, never> {
  return Effect.fromResult(
    makeDeclarativeV2RuntimeArtifactObjectReferenceV1(
      kind,
      digest,
      byteLength,
    ),
  ).pipe(Effect.orDie);
}

function inputFailure(
  operation: DeclarativeV2RuntimeArtifactR2OperationV1,
  field: DeclarativeV2RuntimeArtifactR2InputV1Error["field"],
  reason: DeclarativeV2RuntimeArtifactR2InputV1Error["reason"],
): Effect.Effect<never, DeclarativeV2RuntimeArtifactR2InputV1Error> {
  return Effect.fail(new DeclarativeV2RuntimeArtifactR2InputV1Error({
    operation,
    field,
    reason,
  }));
}

function intrinsicByteLength(value: unknown): number | undefined {
  if (!isUint8Array(value) || TYPED_ARRAY_BYTE_LENGTH_GETTER === undefined) {
    return undefined;
  }
  try {
    const length: unknown = Reflect.apply(
      TYPED_ARRAY_BYTE_LENGTH_GETTER,
      value,
      [],
    );
    return typeof length === "number" ? length : undefined;
  } catch {
    return undefined;
  }
}

function verifyDigest(
  key: string,
  bytes: Uint8Array,
  expected: Uint8Array,
  maximumHashBytes: number,
  sha256: DeclarativeV2RuntimeArtifactSha256V1,
): Effect.Effect<
  void,
  DeclarativeV2RuntimeArtifactSha256V1Error |
    DeclarativeV2RuntimeArtifactR2CorruptionV1Error
> {
  return sha256(bytes, { maximumInputBytes: maximumHashBytes }).pipe(
    Effect.flatMap(actual =>
      bytesEqualFullScan(actual, expected)
        ? Effect.void
        : Effect.fail(new DeclarativeV2RuntimeArtifactR2CorruptionV1Error({
          key,
          reason: "digestMismatch",
        }))
    ),
  );
}

function resourceFailure(
  operation: DeclarativeV2RuntimeArtifactR2ResourceV1Error["operation"],
  key: string,
  cause: unknown,
): DeclarativeV2RuntimeArtifactR2ResourceV1Error {
  const error = new DeclarativeV2RuntimeArtifactR2ResourceV1Error({
    operation,
    key,
  });
  resourceCauses.set(error, cause);
  return error;
}

function objectSize(
  key: string,
  object: Readonly<Record<PropertyKey, unknown>>,
): Effect.Effect<
  number,
  DeclarativeV2RuntimeArtifactR2ResourceV1Error |
    DeclarativeV2RuntimeArtifactR2CorruptionV1Error
> {
  let size: unknown;
  try {
    size = object.size;
  } catch (cause) {
    return Effect.fail(resourceFailure("readBody", key, cause));
  }
  return typeof size === "number" && Number.isSafeInteger(size) && size >= 1
    ? Effect.succeed(size)
    : Effect.fail(new DeclarativeV2RuntimeArtifactR2CorruptionV1Error({
      key,
      reason: "invalidMetadata",
    }));
}

function readObjectBody(
  key: string,
  object: Readonly<Record<PropertyKey, unknown>>,
  maximum: number,
  exactSize: boolean,
): Effect.Effect<
  Uint8Array,
  DeclarativeV2RuntimeArtifactR2ResourceV1Error |
    DeclarativeV2RuntimeArtifactR2CorruptionV1Error
> {
  let body: unknown;
  try {
    body = object.body;
  } catch (cause) {
    return Effect.fail(resourceFailure("readBody", key, cause));
  }
  if (!isNonArrayRecord(body)) {
    return Effect.fail(new DeclarativeV2RuntimeArtifactR2CorruptionV1Error({
      key,
      reason: "invalidBody",
    }));
  }
  return Effect.tryPromise({
    try: signal => readBodyBounded(body, maximum, signal, exactSize),
    catch: cause =>
      cause instanceof SizeMismatch
        ? new DeclarativeV2RuntimeArtifactR2CorruptionV1Error({
          key,
          reason: "sizeMismatch",
        })
        : cause instanceof InvalidBody
          ? new DeclarativeV2RuntimeArtifactR2CorruptionV1Error({
            key,
            reason: "invalidBody",
          })
          : resourceFailure("readBody", key, cause),
  });
}

function verifyStored(
  kind: DeclarativeV2RuntimeArtifactObjectKindV1,
  digest: Uint8Array,
  expected: Uint8Array,
  budget: DeclarativeV2RuntimeArtifactR2BudgetV1,
  read: DeclarativeV2RuntimeArtifactR2StoreV1["readImmutable"],
): Effect.Effect<
  DeclarativeV2RuntimeArtifactObjectReferenceV1,
  DeclarativeV2RuntimeArtifactR2V1Error
> {
  return read(kind, digest, budget).pipe(
    Effect.flatMap(object =>
      bytesEqualFullScan(object.bytes, expected)
        ? Effect.succeed(object.reference)
        : Effect.fail(new DeclarativeV2RuntimeArtifactR2CorruptionV1Error({
          key: object.reference.objectKey,
          reason: "keyCollision",
        }))
    ),
  );
}

function reconcile(
  kind: DeclarativeV2RuntimeArtifactObjectKindV1,
  digest: Uint8Array,
  expected: Uint8Array,
  budget: DeclarativeV2RuntimeArtifactR2BudgetV1,
  read: DeclarativeV2RuntimeArtifactR2StoreV1["readImmutable"],
  stage: "firstCreate" | "repeatCreate",
  primary: DeclarativeV2RuntimeArtifactR2ResourceV1Error,
): Effect.Effect<
  DeclarativeV2RuntimeArtifactObjectReferenceV1 | null,
  DeclarativeV2RuntimeArtifactR2V1Error
> {
  return read(kind, digest, budget).pipe(
    Effect.flatMap(object =>
      bytesEqualFullScan(object.bytes, expected)
        ? Effect.succeed(object.reference)
        : Effect.fail(new DeclarativeV2RuntimeArtifactR2CorruptionV1Error({
          key: object.reference.objectKey,
          reason: "keyCollision",
        }))
    ),
    Effect.catchTag(
      "DeclarativeV2RuntimeArtifactR2NotFoundV1Error",
      () => Effect.succeed(null),
    ),
    Effect.catchTag(
      "DeclarativeV2RuntimeArtifactR2ResourceV1Error",
      secondary => {
        const error = new DeclarativeV2RuntimeArtifactR2SettlementUncertainV1Error({
          key: primary.key,
          stage: "reconcileRead",
        });
        uncertainCauses.set(error, Object.freeze({
          primary: resourceCauses.get(primary),
          secondary: resourceCauses.get(secondary),
          createStage: stage,
        }));
        return Effect.fail(error);
      },
    ),
  );
}

async function readBodyBounded(
  body: Readonly<Record<PropertyKey, unknown>>,
  maximum: number,
  signal: AbortSignal,
  exactSize: boolean,
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
        const item = await Reflect.apply(read, reader, []) as unknown;
        if (!isNonArrayRecord(item) || typeof item.done !== "boolean") {
          throw new InvalidBody();
        }
        if (item.done) break;
        const length = intrinsicByteLength(item.value);
        if (length === undefined) throw new InvalidBody();
        const next = total + length;
        if (!Number.isSafeInteger(next) || next > maximum) {
          throw exactSize ? new SizeMismatch() : new InvalidBody();
        }
        chunks.push(copyBytes(item.value as Uint8Array));
        total = next;
      }
      if (exactSize && total !== maximum) throw new SizeMismatch();
    } catch (cause) {
      primaryFailure = true;
      throw cause;
    }
  } finally {
    signal.removeEventListener("abort", abort);
    if (primaryFailure && typeof cancel === "function") {
      try {
        void Promise.resolve(
          Reflect.apply(cancel, reader, ["invalid runtime artifact body"]),
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
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
