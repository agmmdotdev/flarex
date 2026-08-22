import {
  decodeTaskInputReferenceV1,
  makeTaskInputReferenceV1,
  MAX_TASK_INPUT_CANONICAL_BYTES_V1,
  type TaskInputReferenceV1,
} from "@flarex/durable-task/internal/run-creation-v1";
import {
  makeLivePrivateSha256V1,
  type PrivateSha256V1ErrorPolicy,
} from "@flarex/analysis/internal/private-sha256-v1";
import { copyBytes } from "@flarex/utils/bytes";
import { Data, Effect, Result } from "effect";
import {
  canonicalizeFlarexValueV1Effect,
  decodeCanonicalFlarexValueEvidenceV1Effect,
  FlarexValueCodecV1Error,
  FlarexValueEvidenceV1Error,
  type CanonicalFlarexRuntimeValueV1,
} from "flarex-protocol/value";

import {
  ImmutableR2BodyBudgetExceededError,
  ImmutableR2CorruptionError,
  ImmutableR2NotFoundError,
  ImmutableR2ResourceError,
  ImmutableR2SettlementUncertainError,
  immutableR2ResourceCause,
  immutableR2SettlementUncertainCause,
  makeImmutableR2ByteStore,
  type ImmutableR2Bucket,
} from "../immutableR2/ImmutableR2ByteStore.js";

export interface TaskInputStoreBucket extends ImmutableR2Bucket {}

export class TaskInputStoreInputError
  extends Data.TaggedError("TaskInputStoreInputError")<{
    readonly operation: "publish" | "read";
    readonly reason:
      | "invalidValue"
      | "canonicalByteBudgetExceeded"
      | "invalidReference";
  }> {}

export class TaskInputStoreNotFoundError
  extends Data.TaggedError("TaskInputStoreNotFoundError")<{
    readonly reference: TaskInputReferenceV1;
  }> {}

export class TaskInputStoreResourceError
  extends Data.TaggedError("TaskInputStoreResourceError")<{
    readonly operation: "put" | "get" | "readBody" | "hash";
    readonly reference: TaskInputReferenceV1;
  }> {}

export class TaskInputStoreCorruptionError
  extends Data.TaggedError("TaskInputStoreCorruptionError")<{
    readonly reference: TaskInputReferenceV1;
    readonly reason:
      | "digestMismatch"
      | "keyCollision"
      | "invalidBody"
      | "invalidMetadata"
      | "sizeMismatch"
      | "invalidCanonicalValue";
  }> {}

export class TaskInputStoreSettlementUncertainError
  extends Data.TaggedError("TaskInputStoreSettlementUncertainError")<{
    readonly reference: TaskInputReferenceV1;
    readonly stage: "firstCreate" | "repeatCreate" | "reconcileRead";
  }> {}

export type TaskInputStoreError =
  | TaskInputStoreInputError
  | TaskInputStoreNotFoundError
  | TaskInputStoreResourceError
  | TaskInputStoreCorruptionError
  | TaskInputStoreSettlementUncertainError;

export interface StoredTaskInput {
  readonly reference: TaskInputReferenceV1;
  readonly value: CanonicalFlarexRuntimeValueV1;
  readonly canonicalBytes: Uint8Array;
  readonly semanticSizeBytes: number;
}

export interface TaskInputStore {
  readonly publish: (
    value: unknown,
  ) => Effect.Effect<TaskInputReferenceV1, TaskInputStoreError>;
  readonly read: (
    reference: unknown,
  ) => Effect.Effect<StoredTaskInput, TaskInputStoreError>;
}

class TaskInputSha256InputError
  extends Data.TaggedError("TaskInputSha256InputError")<{
    readonly reason: "invalidBudget" | "invalidBytes" | "inputBytesExceeded";
  }> {}

class TaskInputReferenceInvariantDefect
  extends Data.TaggedError("TaskInputReferenceInvariantDefect")<{
    readonly cause: unknown;
  }> {}

export class TaskInputSha256ResourceError
  extends Data.TaggedError("TaskInputSha256ResourceError")<{
    readonly reason: "unavailable" | "nativeRejected";
  }> {}

export type TaskInputSha256 = (
  bytes: Uint8Array,
  maximumInputBytes: number,
) => Effect.Effect<Uint8Array, TaskInputSha256ResourceError>;

const resourceCauses = new WeakMap<TaskInputStoreResourceError, unknown>();
const hashResourceCauses = new WeakMap<TaskInputSha256ResourceError, unknown>();
const uncertainCauses = new WeakMap<
  TaskInputStoreSettlementUncertainError,
  unknown
>();

export function taskInputStoreResourceCause(
  error: TaskInputStoreResourceError,
): unknown {
  return resourceCauses.get(error);
}

export function taskInputStoreSettlementUncertainCause(
  error: TaskInputStoreSettlementUncertainError,
): unknown {
  return uncertainCauses.get(error);
}

export function makeTaskInputStore(
  bucket: TaskInputStoreBucket,
  sha256: TaskInputSha256 = makeLiveTaskInputSha256(),
): TaskInputStore {
  const core = makeImmutableR2ByteStore(bucket, sha256);

  const publish: TaskInputStore["publish"] = Effect.fn(
    "TaskInputStore.publish",
  )(function* (value) {
    const canonical = yield* canonicalizeFlarexValueV1Effect(value).pipe(
      Effect.mapError((_error: FlarexValueCodecV1Error) =>
        new TaskInputStoreInputError({
          operation: "publish",
          reason: "invalidValue",
        })
      ),
    );
    if (canonical.canonicalBytes.byteLength > MAX_TASK_INPUT_CANONICAL_BYTES_V1) {
      return yield* new TaskInputStoreInputError({
        operation: "publish",
        reason: "canonicalByteBudgetExceeded",
      });
    }
    const referenceResult = makeTaskInputReferenceV1(
      canonical.sha256,
      canonical.canonicalBytes.byteLength,
    );
    if (Result.isFailure(referenceResult)) {
      return yield* Effect.die(new TaskInputReferenceInvariantDefect({
        cause: referenceResult.failure,
      }));
    }
    const reference = referenceResult.success;
    const stored = yield* core.putImmutable({
      key: reference.objectKey,
      expectedSha256: reference.sha256,
      bytes: canonical.canonicalBytes,
      maximumBodyBytes: MAX_TASK_INPUT_CANONICAL_BYTES_V1,
      maximumHashBytes: MAX_TASK_INPUT_CANONICAL_BYTES_V1,
    }).pipe(Effect.mapError(error => mapCoreError(reference, error)));
    if (stored.byteLength !== reference.byteLength) {
      return yield* new TaskInputStoreCorruptionError({
        reference: copyReference(reference),
        reason: "sizeMismatch",
      });
    }
    return copyReference(reference);
  });

  const read: TaskInputStore["read"] = Effect.fn(
    "TaskInputStore.read",
  )(function* (referenceInput) {
    const reference = yield* Effect.fromResult(
      decodeTaskInputReferenceV1(referenceInput).pipe(
        Result.mapError(() => new TaskInputStoreInputError({
          operation: "read",
          reason: "invalidReference",
        })),
      ),
    );
    const stored = yield* core.readImmutable<never>({
      key: reference.objectKey,
      expectedSha256: reference.sha256,
      expectedByteLength: reference.byteLength,
      maximumBodyBytes: MAX_TASK_INPUT_CANONICAL_BYTES_V1,
      maximumHashBytes: MAX_TASK_INPUT_CANONICAL_BYTES_V1,
    }).pipe(Effect.mapError(error => mapCoreError(reference, error)));
    const canonical = yield* decodeCanonicalFlarexValueEvidenceV1Effect({
      canonicalBytes: stored.bytes,
      sha256: reference.sha256,
    }).pipe(Effect.mapError((error:
      | FlarexValueCodecV1Error
      | FlarexValueEvidenceV1Error) =>
      new TaskInputStoreCorruptionError({
        reference: copyReference(reference),
        reason: "invalidCanonicalValue",
      })
    ));
    return Object.freeze({
      reference: copyReference(reference),
      value: canonical.value,
      canonicalBytes: copyBytes(canonical.canonicalBytes),
      semanticSizeBytes: canonical.semanticSizeBytes,
    });
  });

  return Object.freeze({ publish, read });
}

export function makeLiveTaskInputSha256(): TaskInputSha256 {
  const policy: PrivateSha256V1ErrorPolicy<
    TaskInputSha256InputError | TaskInputSha256ResourceError
  > = {
    invalidBudget: () => new TaskInputSha256InputError({ reason: "invalidBudget" }),
    invalidBytes: () => new TaskInputSha256InputError({ reason: "invalidBytes" }),
    inputBytesExceeded: () =>
      new TaskInputSha256InputError({ reason: "inputBytesExceeded" }),
    unavailable: () => hashResourceError("unavailable", undefined),
    nativeRejected: cause => hashResourceError("nativeRejected", cause),
    invalidDigestOutput: observedByteLength =>
      new Error(`Task input SHA-256 returned ${String(observedByteLength)} bytes.`),
  };
  const digest = makeLivePrivateSha256V1(policy);
  return Effect.fn("TaskInputStore.sha256")((bytes, maximumInputBytes) =>
    digest(bytes, { maximumInputBytes }).pipe(
      Effect.catchTag("TaskInputSha256InputError", Effect.die),
    )
  );
}

function copyReference(reference: TaskInputReferenceV1): TaskInputReferenceV1 {
  return Object.freeze({
    codec: reference.codec,
    store: reference.store,
    valueCodec: reference.valueCodec,
    objectKey: reference.objectKey,
    byteLength: reference.byteLength,
    // SAFETY: the copied bytes preserve the already-decoded 32-byte input digest.
    sha256: copyBytes(reference.sha256) as typeof reference.sha256,
    retention: Object.freeze({ kind: reference.retention.kind }),
  });
}

function mapCoreError(
  reference: TaskInputReferenceV1,
  error:
    | ImmutableR2NotFoundError
    | ImmutableR2ResourceError
    | ImmutableR2BodyBudgetExceededError
    | ImmutableR2CorruptionError
    | ImmutableR2SettlementUncertainError
    | TaskInputSha256ResourceError,
): TaskInputStoreError {
  if (error instanceof ImmutableR2NotFoundError) {
    return new TaskInputStoreNotFoundError({
      reference: copyReference(reference),
    });
  }
  if (error instanceof ImmutableR2ResourceError) {
    return resourceError(
      error.operation,
      reference,
      immutableR2ResourceCause(error),
    );
  }
  if (error instanceof ImmutableR2BodyBudgetExceededError) {
    return new TaskInputStoreCorruptionError({
      reference: copyReference(reference),
      reason: "sizeMismatch",
    });
  }
  if (error instanceof ImmutableR2CorruptionError) {
    return new TaskInputStoreCorruptionError({
      reference: copyReference(reference),
      reason: error.reason,
    });
  }
  if (error instanceof ImmutableR2SettlementUncertainError) {
    const mapped = new TaskInputStoreSettlementUncertainError({
      reference: copyReference(reference),
      stage: error.stage,
    });
    uncertainCauses.set(mapped, immutableR2SettlementUncertainCause(error));
    return mapped;
  }
  return resourceError("hash", reference, hashResourceCauses.get(error));
}

function resourceError(
  operation: TaskInputStoreResourceError["operation"],
  reference: TaskInputReferenceV1,
  cause: unknown,
): TaskInputStoreResourceError {
  const error = new TaskInputStoreResourceError({
    operation,
    reference: copyReference(reference),
  });
  resourceCauses.set(error, cause);
  return error;
}

function hashResourceError(
  reason: TaskInputSha256ResourceError["reason"],
  cause: unknown,
): TaskInputSha256ResourceError {
  const error = new TaskInputSha256ResourceError({ reason });
  if (cause !== undefined) {
    // The public error remains redacted; the store maps this exact instance.
    hashResourceCauses.set(error, cause);
  }
  return error;
}
