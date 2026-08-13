import {
  makeLivePrivateSha256V1,
  type PrivateSha256V1ErrorPolicy,
} from "@flarex/analysis/internal/private-sha256-v1";
import {
  MAX_TASK_INPUT_CANONICAL_BYTES_V1,
  decodeTaskInputReferenceV1,
  makeTaskInputReferenceV1,
  type TaskInputReferenceV1,
  type TaskInputSha256V1,
} from "@flarex/durable-task/internal/run-creation-v1";
import { copyBytes } from "@flarex/utils/bytes";
import { Data, Effect } from "effect";
import {
  canonicalizeFlarexValueV1Effect,
  decodeCanonicalFlarexValueEvidenceV1Effect,
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

export interface TaskRunInputStoreBucket extends ImmutableR2Bucket {}

export class TaskRunInputStoreInputError
  extends Data.TaggedError("TaskRunInputStoreInputError")<{
    readonly operation: "publish" | "read";
    readonly reason:
      | "invalid_value"
      | "invalid_reference"
      | "body_budget_exceeded";
  }> {}

export class TaskRunInputStoreNotFoundError
  extends Data.TaggedError("TaskRunInputStoreNotFoundError")<{
    readonly reference: TaskInputReferenceV1;
  }> {}

export class TaskRunInputStoreResourceError
  extends Data.TaggedError("TaskRunInputStoreResourceError")<{
    readonly operation: "put" | "get" | "readBody" | "hash";
    readonly reference: TaskInputReferenceV1;
  }> {}

export class TaskRunInputStoreCorruptionError
  extends Data.TaggedError("TaskRunInputStoreCorruptionError")<{
    readonly reference: TaskInputReferenceV1;
    readonly reason:
      | "digestMismatch"
      | "keyCollision"
      | "invalidBody"
      | "invalidMetadata"
      | "sizeMismatch"
      | "invalidCanonicalEvidence";
  }> {}

export class TaskRunInputStoreSettlementUncertainError
  extends Data.TaggedError("TaskRunInputStoreSettlementUncertainError")<{
    readonly reference: TaskInputReferenceV1;
    readonly stage: "firstCreate" | "repeatCreate" | "reconcileRead";
  }> {}

export type TaskRunInputStoreError =
  | TaskRunInputStoreInputError
  | TaskRunInputStoreNotFoundError
  | TaskRunInputStoreResourceError
  | TaskRunInputStoreCorruptionError
  | TaskRunInputStoreSettlementUncertainError;

export interface TaskRunInputObject {
  readonly reference: TaskInputReferenceV1;
  readonly canonicalBytes: Uint8Array;
  readonly value: CanonicalFlarexRuntimeValueV1;
}

export interface TaskRunInputStore {
  readonly publish: (
    value: unknown,
  ) => Effect.Effect<TaskInputReferenceV1, TaskRunInputStoreError>;
  readonly read: (
    reference: unknown,
  ) => Effect.Effect<TaskRunInputObject, TaskRunInputStoreError>;
}

export type TaskRunInputSha256 = (
  bytes: unknown,
  budget: unknown,
) => Effect.Effect<Uint8Array, TaskRunInputHashError>;

export interface TaskRunInputStoreOptions {
  readonly sha256?: TaskRunInputSha256;
}

export class TaskRunInputHashError extends Data.TaggedError(
  "TaskRunInputHashError",
)<{
  readonly reason:
    | "invalid_budget"
    | "invalid_bytes"
    | "input_bytes_exceeded"
    | "unavailable"
    | "native_rejected";
  readonly observed?: number;
  readonly maximum?: number;
}> {}

class TaskRunInputHashInvariantDefect extends Error {
  constructor(readonly observedByteLength: number | undefined) {
    super("Task run-input SHA-256 returned an invalid digest.");
  }
}

const resourceCauses = new WeakMap<TaskRunInputStoreResourceError, unknown>();
const uncertainCauses = new WeakMap<
  TaskRunInputStoreSettlementUncertainError,
  unknown
>();
const inputCauses = new WeakMap<TaskRunInputStoreInputError, unknown>();
const hashCauses = new WeakMap<TaskRunInputHashError, unknown>();

export function taskRunInputStoreResourceCause(
  error: TaskRunInputStoreResourceError,
): unknown {
  return resourceCauses.get(error);
}

export function taskRunInputStoreSettlementUncertainCause(
  error: TaskRunInputStoreSettlementUncertainError,
): unknown {
  return uncertainCauses.get(error);
}

export function taskRunInputStoreInputCause(
  error: TaskRunInputStoreInputError,
): unknown {
  return inputCauses.get(error);
}

export function makeTaskRunInputStore(
  bucket: TaskRunInputStoreBucket,
  options: TaskRunInputStoreOptions = {},
): TaskRunInputStore {
  const sha256 = options.sha256 ?? makeLiveTaskRunInputSha256();
  const core = makeImmutableR2ByteStore(
    bucket,
    (bytes, maximumInputBytes) => sha256(bytes, { maximumInputBytes }),
  );

  const publish: TaskRunInputStore["publish"] = Effect.fn(
    "TaskRunInputStore.publish",
  )(function* (value) {
    const canonical = yield* canonicalizeFlarexValueV1Effect(value).pipe(
      Effect.mapError(cause => inputErrorValue(
        "publish",
        "invalid_value",
        cause,
      )),
    );
    const byteLength = canonical.canonicalBytes.byteLength;
    if (
      byteLength < 1
      || byteLength > MAX_TASK_INPUT_CANONICAL_BYTES_V1
    ) {
      return yield* inputError("publish", "body_budget_exceeded");
    }
    const reference = yield* Effect.fromResult(
      makeTaskInputReferenceV1(canonical.sha256, byteLength),
    ).pipe(Effect.mapError(cause => inputErrorValue(
      "publish",
      "invalid_reference",
      cause,
    )));
    const stored = yield* core.putImmutable({
      key: reference.objectKey,
      expectedSha256: reference.sha256,
      bytes: canonical.canonicalBytes,
      maximumBodyBytes: MAX_TASK_INPUT_CANONICAL_BYTES_V1,
      maximumHashBytes: MAX_TASK_INPUT_CANONICAL_BYTES_V1,
    }).pipe(Effect.mapError(error => mapCoreError(reference, error)));
    if (stored.byteLength !== reference.byteLength) {
      return yield* new TaskRunInputStoreCorruptionError({
        reference: copyReference(reference),
        reason: "sizeMismatch",
      });
    }
    return copyReference(reference);
  });

  const read: TaskRunInputStore["read"] = Effect.fn(
    "TaskRunInputStore.read",
  )(function* (referenceInput) {
    const reference = yield* Effect.fromResult(
      decodeTaskInputReferenceV1(referenceInput),
    ).pipe(Effect.mapError(cause => inputErrorValue(
      "read",
      "invalid_reference",
      cause,
    )));
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
    }).pipe(Effect.mapError(() =>
      new TaskRunInputStoreCorruptionError({
        reference: copyReference(reference),
        reason: "invalidCanonicalEvidence",
      })
    ));
    return Object.freeze({
      reference: copyReference(reference),
      canonicalBytes: copyBytes(canonical.canonicalBytes),
      value: canonical.value,
    });
  });

  return Object.freeze({ publish, read });
}

function makeLiveTaskRunInputSha256(): TaskRunInputSha256 {
  return makeLivePrivateSha256V1(hashPolicy);
}

function mapCoreError(
  reference: TaskInputReferenceV1,
  error:
    | ImmutableR2NotFoundError
    | ImmutableR2ResourceError
    | ImmutableR2CorruptionError
    | ImmutableR2BodyBudgetExceededError
    | ImmutableR2SettlementUncertainError
    | TaskRunInputHashError,
): TaskRunInputStoreError {
  if (error instanceof ImmutableR2NotFoundError) {
    return new TaskRunInputStoreNotFoundError({
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
  if (error instanceof ImmutableR2CorruptionError) {
    return new TaskRunInputStoreCorruptionError({
      reference: copyReference(reference),
      reason: error.reason,
    });
  }
  if (error instanceof ImmutableR2BodyBudgetExceededError) {
    return new TaskRunInputStoreCorruptionError({
      reference: copyReference(reference),
      reason: "sizeMismatch",
    });
  }
  if (error instanceof ImmutableR2SettlementUncertainError) {
    const mapped = new TaskRunInputStoreSettlementUncertainError({
      reference: copyReference(reference),
      stage: error.stage,
    });
    uncertainCauses.set(mapped, immutableR2SettlementUncertainCause(error));
    return mapped;
  }
  return resourceError("hash", reference, hashCauses.get(error) ?? error);
}

function resourceError(
  operation: TaskRunInputStoreResourceError["operation"],
  reference: TaskInputReferenceV1,
  cause: unknown,
): TaskRunInputStoreResourceError {
  const error = new TaskRunInputStoreResourceError({
    operation,
    reference: copyReference(reference),
  });
  resourceCauses.set(error, cause);
  return error;
}

function inputError(
  operation: TaskRunInputStoreInputError["operation"],
  reason: TaskRunInputStoreInputError["reason"],
): Effect.Effect<never, TaskRunInputStoreInputError> {
  return Effect.fail(inputErrorValue(operation, reason));
}

function inputErrorValue(
  operation: TaskRunInputStoreInputError["operation"],
  reason: TaskRunInputStoreInputError["reason"],
  cause?: unknown,
): TaskRunInputStoreInputError {
  const error = new TaskRunInputStoreInputError({ operation, reason });
  if (cause !== undefined) inputCauses.set(error, cause);
  return error;
}

function copyReference(
  reference: TaskInputReferenceV1,
): TaskInputReferenceV1 {
  return Object.freeze({
    ...reference,
    sha256: copyBytes(reference.sha256) as TaskInputSha256V1,
    retention: Object.freeze({ ...reference.retention }),
  });
}

const hashPolicy: PrivateSha256V1ErrorPolicy<TaskRunInputHashError> = {
  invalidBudget: () =>
    new TaskRunInputHashError({ reason: "invalid_budget" }),
  invalidBytes: () =>
    new TaskRunInputHashError({ reason: "invalid_bytes" }),
  inputBytesExceeded: (observed, maximum) =>
    new TaskRunInputHashError({
      reason: "input_bytes_exceeded",
      observed,
      maximum,
    }),
  unavailable: () =>
    new TaskRunInputHashError({ reason: "unavailable" }),
  nativeRejected: cause => {
    const error = new TaskRunInputHashError({ reason: "native_rejected" });
    hashCauses.set(error, cause);
    return error;
  },
  invalidDigestOutput: observedByteLength =>
    new TaskRunInputHashInvariantDefect(observedByteLength),
};
