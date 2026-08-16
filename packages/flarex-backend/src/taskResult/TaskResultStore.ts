import {
  makeLivePrivateSha256V1,
  type PrivateSha256V1ErrorPolicy,
} from "@flarex/analysis/internal/private-sha256-v1";
import {
  decodeTaskResultCommitmentV1,
  MAX_TASK_RESULT_CANONICAL_BYTES_V1,
  taskResultObjectKeyV1,
  TASK_RESULT_CODEC_V1,
  type TaskResultCommitmentV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { copyBytes } from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import {
  MAX_APPLICATION_TASK_WORKER_VALUE_SEMANTIC_BYTES_V1,
} from "flarex-protocol/internal/application-task-worker-v1";
import {
  canonicalizeFlarexValueV1Effect,
  decodeCanonicalFlarexValueEvidenceV1Effect,
  FlarexValueCodecV1Error,
  FlarexValueEvidenceV1Error,
  type CanonicalFlarexRuntimeValueV1,
} from "flarex-protocol/value";
import { Data, Effect, Result } from "effect";

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

export interface TaskResultStoreBucket extends ImmutableR2Bucket {}

export class TaskResultStoreInputError
  extends Data.TaggedError("TaskResultStoreInputError")<{
    readonly operation: "publish" | "read";
    readonly reason:
      | "invalidValue"
      | "semanticBudgetExceeded"
      | "canonicalByteBudgetExceeded"
      | "invalidCommitment";
  }> {}

export class TaskResultStoreNotFoundError
  extends Data.TaggedError("TaskResultStoreNotFoundError")<{
    readonly commitment: TaskResultCommitmentV1;
  }> {}

export class TaskResultStoreResourceError
  extends Data.TaggedError("TaskResultStoreResourceError")<{
    readonly operation: "put" | "get" | "readBody" | "hash";
    readonly commitment: TaskResultCommitmentV1;
  }> {}

export class TaskResultStoreCorruptionError
  extends Data.TaggedError("TaskResultStoreCorruptionError")<{
    readonly commitment: TaskResultCommitmentV1;
    readonly reason:
      | "digestMismatch"
      | "keyCollision"
      | "invalidBody"
      | "invalidMetadata"
      | "sizeMismatch"
      | "invalidCanonicalValue";
  }> {}

export class TaskResultStoreSettlementUncertainError
  extends Data.TaggedError("TaskResultStoreSettlementUncertainError")<{
    readonly commitment: TaskResultCommitmentV1;
    readonly stage: "firstCreate" | "repeatCreate" | "reconcileRead";
  }> {}

export type TaskResultStoreError =
  | TaskResultStoreInputError
  | TaskResultStoreNotFoundError
  | TaskResultStoreResourceError
  | TaskResultStoreCorruptionError
  | TaskResultStoreSettlementUncertainError;

export interface StoredTaskResult {
  readonly commitment: TaskResultCommitmentV1;
  readonly objectKey: string;
  readonly value: CanonicalFlarexRuntimeValueV1;
  readonly canonicalBytes: Uint8Array;
  readonly semanticSizeBytes: number;
}

export interface TaskResultStore {
  readonly publish: (
    value: unknown,
  ) => Effect.Effect<TaskResultCommitmentV1, TaskResultStoreError>;
  readonly read: (
    commitment: unknown,
  ) => Effect.Effect<StoredTaskResult, TaskResultStoreError>;
}

class TaskResultSha256InputError
  extends Data.TaggedError("TaskResultSha256InputError")<{
    readonly reason: "invalidBudget" | "invalidBytes" | "inputBytesExceeded";
  }> {}

export class TaskResultSha256ResourceError
  extends Data.TaggedError("TaskResultSha256ResourceError")<{
    readonly reason: "unavailable" | "nativeRejected";
  }> {}

export type TaskResultSha256 = (
  bytes: Uint8Array,
  maximumInputBytes: number,
) => Effect.Effect<Uint8Array, TaskResultSha256ResourceError>;

const resourceCauses = new WeakMap<TaskResultStoreResourceError, unknown>();
const hashResourceCauses = new WeakMap<TaskResultSha256ResourceError, unknown>();
const uncertainCauses = new WeakMap<
  TaskResultStoreSettlementUncertainError,
  unknown
>();

export function taskResultStoreResourceCause(
  error: TaskResultStoreResourceError,
): unknown {
  return resourceCauses.get(error);
}

export function taskResultStoreSettlementUncertainCause(
  error: TaskResultStoreSettlementUncertainError,
): unknown {
  return uncertainCauses.get(error);
}

export function makeTaskResultStore(
  bucket: TaskResultStoreBucket,
  sha256: TaskResultSha256 = makeLiveTaskResultSha256(),
): TaskResultStore {
  const core = makeImmutableR2ByteStore(bucket, sha256);

  const publish: TaskResultStore["publish"] = Effect.fn(
    "TaskResultStore.publish",
  )(function* (value) {
    const canonical = yield* canonicalizeFlarexValueV1Effect(value).pipe(
      Effect.mapError((error: FlarexValueCodecV1Error) =>
        new TaskResultStoreInputError({
          operation: "publish",
          reason: "invalidValue",
        })
      ),
    );
    if (
      canonical.semanticSizeBytes >
        MAX_APPLICATION_TASK_WORKER_VALUE_SEMANTIC_BYTES_V1
    ) {
      return yield* new TaskResultStoreInputError({
        operation: "publish",
        reason: "semanticBudgetExceeded",
      });
    }
    if (canonical.canonicalBytes.byteLength > MAX_TASK_RESULT_CANONICAL_BYTES_V1) {
      return yield* new TaskResultStoreInputError({
        operation: "publish",
        reason: "canonicalByteBudgetExceeded",
      });
    }
    const commitment = ownCommitment({
      codec: TASK_RESULT_CODEC_V1,
      byteLength: canonical.canonicalBytes.byteLength,
      sha256: canonical.sha256,
    });
    const stored = yield* core.putImmutable({
      key: taskResultObjectKeyV1(commitment.sha256),
      expectedSha256: commitment.sha256,
      bytes: canonical.canonicalBytes,
      maximumBodyBytes: MAX_TASK_RESULT_CANONICAL_BYTES_V1,
      maximumHashBytes: MAX_TASK_RESULT_CANONICAL_BYTES_V1,
    }).pipe(Effect.mapError(error => mapCoreError(commitment, error)));
    if (stored.byteLength !== commitment.byteLength) {
      return yield* new TaskResultStoreCorruptionError({
        commitment,
        reason: "sizeMismatch",
      });
    }
    return copyCommitment(commitment);
  });

  const read: TaskResultStore["read"] = Effect.fn(
    "TaskResultStore.read",
  )(function* (commitmentInput) {
    const commitment = yield* captureCommitment(commitmentInput);
    const objectKey = taskResultObjectKeyV1(commitment.sha256);
    const stored = yield* core.readImmutable<never>({
      key: objectKey,
      expectedSha256: commitment.sha256,
      expectedByteLength: commitment.byteLength,
      maximumBodyBytes: MAX_TASK_RESULT_CANONICAL_BYTES_V1,
      maximumHashBytes: MAX_TASK_RESULT_CANONICAL_BYTES_V1,
    }).pipe(Effect.mapError(error => mapCoreError(commitment, error)));
    const canonical = yield* decodeCanonicalFlarexValueEvidenceV1Effect({
      canonicalBytes: stored.bytes,
      sha256: commitment.sha256,
    }).pipe(Effect.mapError((error:
      | FlarexValueCodecV1Error
      | FlarexValueEvidenceV1Error) =>
      new TaskResultStoreCorruptionError({
        commitment: copyCommitment(commitment),
        reason: "invalidCanonicalValue",
      })
    ));
    if (
      canonical.semanticSizeBytes >
        MAX_APPLICATION_TASK_WORKER_VALUE_SEMANTIC_BYTES_V1
    ) {
      return yield* new TaskResultStoreCorruptionError({
        commitment: copyCommitment(commitment),
        reason: "invalidCanonicalValue",
      });
    }
    return Object.freeze({
      commitment: copyCommitment(commitment),
      objectKey,
      value: canonical.value,
      canonicalBytes: copyBytes(canonical.canonicalBytes),
      semanticSizeBytes: canonical.semanticSizeBytes,
    });
  });

  return Object.freeze({ publish, read });
}

export function makeLiveTaskResultSha256(): TaskResultSha256 {
  const policy: PrivateSha256V1ErrorPolicy<
    TaskResultSha256InputError | TaskResultSha256ResourceError
  > = {
    invalidBudget: () => new TaskResultSha256InputError({ reason: "invalidBudget" }),
    invalidBytes: () => new TaskResultSha256InputError({ reason: "invalidBytes" }),
    inputBytesExceeded: () =>
      new TaskResultSha256InputError({ reason: "inputBytesExceeded" }),
    unavailable: () => hashResourceError("unavailable", undefined),
    nativeRejected: cause => hashResourceError("nativeRejected", cause),
    invalidDigestOutput: observedByteLength =>
      new Error(`Task result SHA-256 returned ${String(observedByteLength)} bytes.`),
  };
  const digest = makeLivePrivateSha256V1(policy);
  return Effect.fn("TaskResultStore.sha256")((bytes, maximumInputBytes) =>
    digest(bytes, { maximumInputBytes }).pipe(
      Effect.catchTag("TaskResultSha256InputError", Effect.die),
    )
  );
}

const captureCommitment = Effect.fn("TaskResultStore.captureCommitment")(
  (input: unknown): Effect.Effect<
    TaskResultCommitmentV1,
    TaskResultStoreInputError
  > => Effect.fromResult(captureCommitmentResult(input)).pipe(
    Effect.mapError(() => new TaskResultStoreInputError({
      operation: "read",
      reason: "invalidCommitment",
    })),
  ),
);

function captureCommitmentResult(
  input: unknown,
): Result.Result<TaskResultCommitmentV1, void> {
  return Result.try({
    try: () => {
      if (!isNonArrayRecord(input)) throw new Error("invalid commitment");
      const expected = ["codec", "byteLength", "sha256"] as const;
      const keys = Reflect.ownKeys(input);
      if (
        keys.length !== expected.length ||
        expected.some(key => !keys.includes(key))
      ) throw new Error("invalid commitment");
      const captured = Object.create(null) as Record<string, unknown>;
      for (const key of expected) {
        const descriptor = Reflect.getOwnPropertyDescriptor(input, key);
        if (
          descriptor === undefined || !("value" in descriptor) ||
          descriptor.enumerable !== true
        ) throw new Error("invalid commitment");
        captured[key] = descriptor.value;
      }
      return captured;
    },
    catch: () => undefined,
  }).pipe(
    Result.flatMap(captured => decodeTaskResultCommitmentV1(captured).pipe(
      Result.mapError(() => undefined),
    )),
    Result.map(ownCommitment),
  );
}

function ownCommitment(
  commitment: TaskResultCommitmentV1,
): TaskResultCommitmentV1 {
  return Object.freeze({
    codec: commitment.codec,
    byteLength: commitment.byteLength,
    sha256: copyBytes(commitment.sha256),
  });
}

function copyCommitment(
  commitment: TaskResultCommitmentV1,
): TaskResultCommitmentV1 {
  return ownCommitment(commitment);
}

function mapCoreError(
  commitment: TaskResultCommitmentV1,
  error:
    | ImmutableR2NotFoundError
    | ImmutableR2ResourceError
    | ImmutableR2BodyBudgetExceededError
    | ImmutableR2CorruptionError
    | ImmutableR2SettlementUncertainError
    | TaskResultSha256ResourceError,
): TaskResultStoreError {
  if (error instanceof ImmutableR2NotFoundError) {
    return new TaskResultStoreNotFoundError({
      commitment: copyCommitment(commitment),
    });
  }
  if (error instanceof ImmutableR2ResourceError) {
    return resourceError(
      error.operation,
      commitment,
      immutableR2ResourceCause(error),
    );
  }
  if (error instanceof ImmutableR2BodyBudgetExceededError) {
    return new TaskResultStoreCorruptionError({
      commitment: copyCommitment(commitment),
      reason: "sizeMismatch",
    });
  }
  if (error instanceof ImmutableR2CorruptionError) {
    return new TaskResultStoreCorruptionError({
      commitment: copyCommitment(commitment),
      reason: error.reason,
    });
  }
  if (error instanceof ImmutableR2SettlementUncertainError) {
    const mapped = new TaskResultStoreSettlementUncertainError({
      commitment: copyCommitment(commitment),
      stage: error.stage,
    });
    uncertainCauses.set(mapped, immutableR2SettlementUncertainCause(error));
    return mapped;
  }
  return resourceError("hash", commitment, hashResourceCauses.get(error));
}

function resourceError(
  operation: TaskResultStoreResourceError["operation"],
  commitment: TaskResultCommitmentV1,
  cause: unknown,
): TaskResultStoreResourceError {
  const error = new TaskResultStoreResourceError({
    operation,
    commitment: copyCommitment(commitment),
  });
  resourceCauses.set(error, cause);
  return error;
}

function hashResourceError(
  reason: TaskResultSha256ResourceError["reason"],
  cause: unknown,
): TaskResultSha256ResourceError {
  const error = new TaskResultSha256ResourceError({ reason });
  hashResourceCauses.set(error, cause);
  return error;
}
