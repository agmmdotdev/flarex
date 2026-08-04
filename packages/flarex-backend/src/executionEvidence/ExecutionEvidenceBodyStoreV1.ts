import {
  bytesEqualFullScan,
  copyBytes,
  isUint8Array,
} from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Effect, Result } from "effect";
import {
  decodeExecutionEvidenceBodyReferenceV1,
  makeExecutionEvidenceBodyReferenceV1,
  type ExecutionEvidenceBodyKindV1,
  type ExecutionEvidenceBodyReferenceV1,
} from "flarex-protocol/internal/execution-evidence-v1";

export interface ExecutionEvidenceBodyR2BucketV1 {
  readonly put: (
    key: string,
    value: ArrayBuffer,
    options: Readonly<{ readonly onlyIf: Readonly<{ readonly etagDoesNotMatch: "*" }> }>,
  ) => PromiseLike<unknown>;
  readonly get: (key: string) => PromiseLike<unknown>;
}

export interface ExecutionEvidenceBodyBudgetV1 {
  readonly maximumBodyBytes: number;
  readonly maximumHashBytes: number;
}

export interface ExecutionEvidenceBodySha256V1<E> {
  readonly hash: (
    bytes: Uint8Array,
    maximumInputBytes: number,
  ) => Effect.Effect<Uint8Array, E>;
}

export interface ExecutionEvidenceCanonicalBodyVerifierV1<E> {
  readonly verify: (
    kind: ExecutionEvidenceBodyKindV1,
    bytes: Uint8Array,
  ) => Effect.Effect<void, E>;
}

export class ExecutionEvidenceBodyInputV1Error extends Data.TaggedError(
  "ExecutionEvidenceBodyInputV1Error",
)<{
  readonly operation: "putImmutable" | "readImmutable";
  readonly field: "kind" | "bytes" | "reference" | "budget";
  readonly reason: "invalidInput" | "budgetExceeded";
}> {}

export class ExecutionEvidenceBodyNotFoundV1Error extends Data.TaggedError(
  "ExecutionEvidenceBodyNotFoundV1Error",
)<{ readonly key: string }> {}

export class ExecutionEvidenceBodyResourceV1Error extends Data.TaggedError(
  "ExecutionEvidenceBodyResourceV1Error",
)<{
  readonly operation: "put" | "get" | "readBody";
  readonly key: string;
}> {}

export class ExecutionEvidenceBodyCorruptionV1Error extends Data.TaggedError(
  "ExecutionEvidenceBodyCorruptionV1Error",
)<{
  readonly key: string;
  readonly reason:
    | "invalidMetadata"
    | "invalidBody"
    | "sizeMismatch"
    | "digestMismatch"
    | "nonCanonical"
    | "keyCollision";
}> {}

export class ExecutionEvidenceBodySettlementUncertainV1Error
  extends Data.TaggedError("ExecutionEvidenceBodySettlementUncertainV1Error")<{
    readonly key: string;
    readonly stage: "create" | "reconcileRead";
  }> {}

export interface ExecutionEvidenceBodyObjectV1 {
  readonly reference: ExecutionEvidenceBodyReferenceV1;
  readonly bytes: Uint8Array;
}

export type ExecutionEvidenceBodyStoreV1Error<HashError, CanonicalError> =
  | ExecutionEvidenceBodyInputV1Error
  | ExecutionEvidenceBodyNotFoundV1Error
  | ExecutionEvidenceBodyResourceV1Error
  | ExecutionEvidenceBodyCorruptionV1Error
  | ExecutionEvidenceBodySettlementUncertainV1Error
  | HashError
  | CanonicalError;

export interface ExecutionEvidenceBodyStoreV1<HashError, CanonicalError> {
  readonly putImmutable: (
    kind: ExecutionEvidenceBodyKindV1,
    bytes: unknown,
    budget: unknown,
  ) => Effect.Effect<
    ExecutionEvidenceBodyReferenceV1,
    ExecutionEvidenceBodyStoreV1Error<HashError, CanonicalError>
  >;
  readonly readImmutable: (
    reference: unknown,
    budget: unknown,
  ) => Effect.Effect<
    ExecutionEvidenceBodyObjectV1,
    ExecutionEvidenceBodyStoreV1Error<HashError, CanonicalError>
  >;
}

const resourceCauses = new WeakMap<ExecutionEvidenceBodyResourceV1Error, unknown>();
const uncertainCauses = new WeakMap<
  ExecutionEvidenceBodySettlementUncertainV1Error,
  unknown
>();

export function executionEvidenceBodyResourceCauseV1(
  error: ExecutionEvidenceBodyResourceV1Error,
): unknown {
  return resourceCauses.get(error);
}

export function executionEvidenceBodySettlementUncertainCauseV1(
  error: ExecutionEvidenceBodySettlementUncertainV1Error,
): unknown {
  return uncertainCauses.get(error);
}

export function makeExecutionEvidenceBodyStoreV1<HashError, CanonicalError>(
  bucket: ExecutionEvidenceBodyR2BucketV1,
  sha256: ExecutionEvidenceBodySha256V1<HashError>,
  canonical: ExecutionEvidenceCanonicalBodyVerifierV1<CanonicalError>,
): ExecutionEvidenceBodyStoreV1<HashError, CanonicalError> {
  const readImmutable: ExecutionEvidenceBodyStoreV1<
    HashError,
    CanonicalError
  >["readImmutable"] = Effect.fn(
    "ExecutionEvidenceBodyStore.readImmutableV1",
  )(function* (referenceInput, budgetInput) {
    const reference = yield* Effect.fromResult(
      decodeExecutionEvidenceBodyReferenceV1(referenceInput),
    ).pipe(Effect.mapError(() => inputError(
      "readImmutable",
      "reference",
      "invalidInput",
    )));
    const budget = yield* decodeBudget("readImmutable", budgetInput);
    if (reference.byteLength > BigInt(budget.maximumBodyBytes)) {
      return yield* inputError("readImmutable", "budget", "budgetExceeded");
    }
    const object = yield* getObject(bucket, reference.objectKey);
    const size = yield* readSize(reference.objectKey, object);
    if (BigInt(size) !== reference.byteLength) {
      return yield* new ExecutionEvidenceBodyCorruptionV1Error({
        key: reference.objectKey,
        reason: "sizeMismatch",
      });
    }
    const bytes = yield* readBody(reference.objectKey, object);
    if (bytes.byteLength !== size) {
      return yield* new ExecutionEvidenceBodyCorruptionV1Error({
        key: reference.objectKey,
        reason: "sizeMismatch",
      });
    }
    yield* verify(reference, bytes, budget, sha256, canonical);
    return Object.freeze({ reference, bytes: copyBytes(bytes) });
  });

  const putImmutable: ExecutionEvidenceBodyStoreV1<
    HashError,
    CanonicalError
  >["putImmutable"] = Effect.fn(
    "ExecutionEvidenceBodyStore.putImmutableV1",
  )(function* (kind, bytesInput, budgetInput) {
    const budget = yield* decodeBudget("putImmutable", budgetInput);
    const bytes = yield* captureBody(kind, bytesInput, budget.maximumBodyBytes);
    yield* canonical.verify(kind, copyBytes(bytes));
    const digest = yield* sha256.hash(copyBytes(bytes), budget.maximumHashBytes);
    const reference = yield* Effect.fromResult(
      makeExecutionEvidenceBodyReferenceV1(kind, digest, bytes.byteLength),
    ).pipe(Effect.mapError(() => inputError(
      "putImmutable",
      "kind",
      "invalidInput",
    )));
    return yield* Effect.uninterruptible(Effect.gen(function* () {
      const writeFailure: ExecutionEvidenceBodyResourceV1Error | null =
        yield* create(bucket, reference.objectKey, bytes).pipe(
          Effect.as(null),
          Effect.catch(error => Effect.succeed(error)),
        );
      if (writeFailure === null) {
        const stored = yield* readImmutable(reference, budget);
        return stored.reference;
      }
      const reconciliation = yield* readImmutable(reference, budget).pipe(
        Effect.map(stored =>
          bytesEqualFullScan(stored.bytes, bytes)
            ? stored.reference
            : new ExecutionEvidenceBodyCorruptionV1Error({
                key: reference.objectKey,
                reason: "keyCollision",
              })
        ),
        Effect.catch(error => {
          if (error instanceof ExecutionEvidenceBodyNotFoundV1Error) {
            return Effect.succeed(null);
          }
          if (error instanceof ExecutionEvidenceBodyResourceV1Error) {
            const uncertain = new ExecutionEvidenceBodySettlementUncertainV1Error({
              key: reference.objectKey,
              stage: "reconcileRead",
            });
            uncertainCauses.set(uncertain, Object.freeze({
              create: resourceCauses.get(writeFailure),
              read: resourceCauses.get(error),
            }));
            return Effect.fail(uncertain);
          }
          return Effect.fail(error);
        }),
      );
      if (reconciliation instanceof ExecutionEvidenceBodyCorruptionV1Error) {
        return yield* reconciliation;
      }
      if (reconciliation !== null) return reconciliation;
      const uncertain = new ExecutionEvidenceBodySettlementUncertainV1Error({
        key: reference.objectKey,
        stage: "create",
      });
      uncertainCauses.set(uncertain, resourceCauses.get(writeFailure));
      return yield* uncertain;
    }));
  });

  return Object.freeze({ putImmutable, readImmutable });
}

function decodeBudget(
  operation: ExecutionEvidenceBodyInputV1Error["operation"],
  value: unknown,
): Effect.Effect<ExecutionEvidenceBodyBudgetV1, ExecutionEvidenceBodyInputV1Error> {
  if (
    !isNonArrayRecord(value) ||
    typeof value.maximumBodyBytes !== "number" ||
    !Number.isSafeInteger(value.maximumBodyBytes) ||
    value.maximumBodyBytes < 1 ||
    typeof value.maximumHashBytes !== "number" ||
    !Number.isSafeInteger(value.maximumHashBytes) ||
    value.maximumHashBytes < value.maximumBodyBytes
  ) return inputError(operation, "budget", "invalidInput");
  return Effect.succeed(Object.freeze({
    maximumBodyBytes: value.maximumBodyBytes,
    maximumHashBytes: value.maximumHashBytes,
  }));
}

function captureBody(
  kind: unknown,
  value: unknown,
  maximum: number,
): Effect.Effect<Uint8Array, ExecutionEvidenceBodyInputV1Error> {
  if (
    (kind !== "action_arguments" && kind !== "action_result" &&
      kind !== "application_error_detail" &&
      kind !== "outbound_http_request" && kind !== "outbound_http_response")
  ) return inputError("putImmutable", "kind", "invalidInput");
  if (!isUint8Array(value) || value.byteLength < 1) {
    return inputError("putImmutable", "bytes", "invalidInput");
  }
  if (value.byteLength > maximum) {
    return inputError("putImmutable", "bytes", "budgetExceeded");
  }
  return Effect.succeed(copyBytes(value));
}

function getObject(
  bucket: ExecutionEvidenceBodyR2BucketV1,
  key: string,
): Effect.Effect<
  Readonly<Record<PropertyKey, unknown>>,
  ExecutionEvidenceBodyResourceV1Error |
    ExecutionEvidenceBodyNotFoundV1Error |
    ExecutionEvidenceBodyCorruptionV1Error
> {
  return Effect.gen(function* () {
    const value = yield* Effect.tryPromise({
      try: () => Reflect.apply(bucket.get, bucket, [key]) as PromiseLike<unknown>,
      catch: cause => resourceError("get", key, cause),
    });
    if (value === null) {
      return yield* new ExecutionEvidenceBodyNotFoundV1Error({ key });
    }
    if (!isNonArrayRecord(value)) {
      return yield* new ExecutionEvidenceBodyCorruptionV1Error({
        key,
        reason: "invalidMetadata",
      });
    }
    return value;
  });
}

function readSize(
  key: string,
  object: Readonly<Record<PropertyKey, unknown>>,
): Effect.Effect<number, ExecutionEvidenceBodyCorruptionV1Error> {
  let size: unknown;
  try {
    size = object.size;
  } catch {
    return Effect.fail(new ExecutionEvidenceBodyCorruptionV1Error({
      key,
      reason: "invalidMetadata",
    }));
  }
  return typeof size === "number" && Number.isSafeInteger(size) && size >= 1
    ? Effect.succeed(size)
    : Effect.fail(new ExecutionEvidenceBodyCorruptionV1Error({
        key,
        reason: "invalidMetadata",
      }));
}

function readBody(
  key: string,
  object: Readonly<Record<PropertyKey, unknown>>,
): Effect.Effect<
  Uint8Array,
  ExecutionEvidenceBodyResourceV1Error | ExecutionEvidenceBodyCorruptionV1Error
> {
  let arrayBuffer: unknown;
  try {
    arrayBuffer = object.arrayBuffer;
  } catch (cause) {
    return Effect.fail(resourceError("readBody", key, cause));
  }
  if (typeof arrayBuffer !== "function") {
    return Effect.fail(new ExecutionEvidenceBodyCorruptionV1Error({
      key,
      reason: "invalidBody",
    }));
  }
  return Effect.tryPromise({
    try: () => Reflect.apply(arrayBuffer, object, []) as PromiseLike<unknown>,
    catch: cause => resourceError("readBody", key, cause),
  }).pipe(Effect.flatMap(value =>
    value instanceof ArrayBuffer
      ? Effect.succeed(new Uint8Array(value.slice(0)))
      : Effect.fail(new ExecutionEvidenceBodyCorruptionV1Error({
          key,
          reason: "invalidBody",
        }))
  ));
}

function create(
  bucket: ExecutionEvidenceBodyR2BucketV1,
  key: string,
  bytes: Uint8Array,
): Effect.Effect<void, ExecutionEvidenceBodyResourceV1Error> {
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return Effect.tryPromise({
    try: () => Reflect.apply(bucket.put, bucket, [
      key,
      body,
      { onlyIf: { etagDoesNotMatch: "*" } },
    ]) as PromiseLike<unknown>,
    catch: cause => resourceError("put", key, cause),
  }).pipe(Effect.asVoid);
}

function verify<HashError, CanonicalError>(
  reference: ExecutionEvidenceBodyReferenceV1,
  bytes: Uint8Array,
  budget: ExecutionEvidenceBodyBudgetV1,
  sha256: ExecutionEvidenceBodySha256V1<HashError>,
  canonical: ExecutionEvidenceCanonicalBodyVerifierV1<CanonicalError>,
): Effect.Effect<
  void,
  HashError | CanonicalError | ExecutionEvidenceBodyCorruptionV1Error
> {
  return Effect.gen(function* () {
    const digest = yield* sha256.hash(copyBytes(bytes), budget.maximumHashBytes);
    if (!bytesEqualFullScan(digest, reference.sha256)) {
      return yield* new ExecutionEvidenceBodyCorruptionV1Error({
        key: reference.objectKey,
        reason: "digestMismatch",
      });
    }
    yield* canonical.verify(reference.kind, copyBytes(bytes)).pipe(
      Effect.mapError(() => new ExecutionEvidenceBodyCorruptionV1Error({
        key: reference.objectKey,
        reason: "nonCanonical",
      })),
    );
  });
}

function inputError(
  operation: ExecutionEvidenceBodyInputV1Error["operation"],
  field: ExecutionEvidenceBodyInputV1Error["field"],
  reason: ExecutionEvidenceBodyInputV1Error["reason"],
): ExecutionEvidenceBodyInputV1Error {
  return new ExecutionEvidenceBodyInputV1Error({ operation, field, reason });
}

function resourceError(
  operation: ExecutionEvidenceBodyResourceV1Error["operation"],
  key: string,
  cause: unknown,
): ExecutionEvidenceBodyResourceV1Error {
  const error = new ExecutionEvidenceBodyResourceV1Error({ operation, key });
  resourceCauses.set(error, cause);
  return error;
}
