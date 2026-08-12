import {
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
import {
  DeclarativeV2RuntimeArtifactSha256InputV1Error,
  DeclarativeV2RuntimeArtifactSha256ResourceV1Error,
} from "./DeclarativeV2RuntimeArtifactSha256";
import {
  ImmutableR2CorruptionError,
  ImmutableR2BodyBudgetExceededError,
  ImmutableR2NotFoundError,
  ImmutableR2ResourceError,
  ImmutableR2SettlementUncertainError,
  immutableR2ResourceCause,
  immutableR2SettlementUncertainCause,
  makeImmutableR2ByteStore,
} from "../immutableR2/ImmutableR2ByteStore.js";

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

export function makeDeclarativeV2RuntimeArtifactR2StoreV1(
  bucket: DeclarativeV2RuntimeArtifactR2BucketV1,
  sha256: DeclarativeV2RuntimeArtifactSha256V1,
): DeclarativeV2RuntimeArtifactR2StoreV1 {
  const immutable = makeImmutableR2ByteStore(
    bucket,
    (bytes, maximumInputBytes) =>
      sha256(bytes, { maximumInputBytes }),
  );
  const mapError = (
    key: string,
    error:
      | ImmutableR2NotFoundError
      | ImmutableR2ResourceError
      | ImmutableR2BodyBudgetExceededError
      | ImmutableR2CorruptionError
      | ImmutableR2SettlementUncertainError
      | DeclarativeV2RuntimeArtifactSha256V1Error,
  ): DeclarativeV2RuntimeArtifactR2V1Error => {
    if (error instanceof ImmutableR2NotFoundError) {
      return new DeclarativeV2RuntimeArtifactR2NotFoundV1Error({ key });
    }
    if (error instanceof ImmutableR2ResourceError) {
      return resourceFailure(error.operation, key, immutableR2ResourceCause(error));
    }
    if (error instanceof ImmutableR2BodyBudgetExceededError) {
      return new DeclarativeV2RuntimeArtifactR2InputV1Error({
        operation: "readImmutable",
        field: "budget",
        reason: "budgetExceeded",
      });
    }
    if (error instanceof ImmutableR2CorruptionError) {
      return new DeclarativeV2RuntimeArtifactR2CorruptionV1Error({
        key,
        reason: error.reason,
      });
    }
    if (error instanceof ImmutableR2SettlementUncertainError) {
      const mapped = new DeclarativeV2RuntimeArtifactR2SettlementUncertainV1Error({
        key,
        stage: error.stage,
      });
      uncertainCauses.set(mapped, immutableR2SettlementUncertainCause(error));
      return mapped;
    }
    return error;
  };

  const sharedReadImmutableAdmitted = Effect.fn(
    "DeclarativeV2RuntimeArtifactR2.sharedReadImmutableAdmittedV1",
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
    const digest = yield* decodeDigest("readImmutableAdmitted", digestInput);
    const key = yield* keyFor("readImmutableAdmitted", kind, digest);
    let admittedReference:
      DeclarativeV2RuntimeArtifactObjectReferenceV1 | undefined;
    const sharedRead = immutable.readImmutable<E>({
      key,
      expectedSha256: digest,
      admit: receipt => referenceFor(kind, digest, receipt.byteLength).pipe(
        Effect.flatMap(reference => {
          admittedReference = reference;
          return admit(Object.freeze({ reference }));
        }),
      ),
    });
    const stored = yield* Effect.matchEffect(sharedRead, {
      onSuccess: Effect.succeed,
      onFailure: (
        error: E | ImmutableR2NotFoundError | ImmutableR2ResourceError |
          ImmutableR2CorruptionError | ImmutableR2SettlementUncertainError |
          ImmutableR2BodyBudgetExceededError |
          DeclarativeV2RuntimeArtifactSha256V1Error,
      ): Effect.Effect<
        never,
        E | DeclarativeV2RuntimeArtifactR2V1Error
      > => {
        if (error instanceof ImmutableR2NotFoundError ||
          error instanceof ImmutableR2ResourceError ||
          error instanceof ImmutableR2CorruptionError ||
          error instanceof ImmutableR2BodyBudgetExceededError ||
          error instanceof ImmutableR2SettlementUncertainError ||
          error instanceof DeclarativeV2RuntimeArtifactSha256InputV1Error ||
          error instanceof DeclarativeV2RuntimeArtifactSha256ResourceV1Error) {
          return Effect.fail(mapError(key, error));
        }
        return Effect.fail(error);
      },
    });
    const reference = admittedReference ??
      (yield* referenceFor(kind, digest, stored.byteLength));
    return Object.freeze({ reference, bytes: copyBytes(stored.bytes) });
  });

  const sharedReadImmutable = Effect.fn(
    "DeclarativeV2RuntimeArtifactR2.sharedReadImmutableV1",
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
    const stored = yield* immutable.readImmutable<never>({
      key,
      expectedSha256: digest,
      maximumBodyBytes: budget.maximumBodyBytes,
      maximumHashBytes: budget.maximumHashBytes,
    }).pipe(Effect.mapError(error => mapError(key, error)));
    return Object.freeze({
      reference: yield* referenceFor(kind, digest, stored.byteLength),
      bytes: copyBytes(stored.bytes),
    });
  });

  const sharedPutImmutable = Effect.fn(
    "DeclarativeV2RuntimeArtifactR2.sharedPutImmutableV1",
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
    const stored = yield* immutable.putImmutable({
      key,
      expectedSha256: digest,
      bytes,
      maximumBodyBytes: budget.maximumBodyBytes,
      maximumHashBytes: budget.maximumHashBytes,
    }).pipe(Effect.mapError(error => mapError(key, error)));
    return yield* referenceFor(kind, digest, stored.byteLength);
  });

  return Object.freeze({
    putImmutable: sharedPutImmutable,
    readImmutable: sharedReadImmutable,
    readImmutableAdmitted: sharedReadImmutableAdmitted,
  });

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
