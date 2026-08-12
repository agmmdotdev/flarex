import {
  makeLiveStandardApplicationTaskSha256V1,
  MAX_TASK_RUNTIME_PUBLICATION_CANONICAL_BYTES_V1,
  taskRuntimeObjectKeyV1,
  TASK_RUNTIME_ENTRY_CODEC_V1,
  TASK_RUNTIME_GROUP_MANIFEST_CODEC_V1,
  TASK_RUNTIME_MATERIALIZATION_SPEC_CODEC_V1,
  TASK_RUNTIME_OBJECT_STORE_V1,
  TASK_RUNTIME_PROJECTION_CODEC_V1,
  TASK_RUNTIME_PROJECTION_MODULE_CODEC_V1,
  type PreparedTaskRuntimeObjectV1,
  type PublishedTaskRuntimeObjectV1,
  type StandardApplicationTaskSha256InputV1Error,
  type StandardApplicationTaskSha256ResourceV1Error,
  type StandardApplicationTaskSha256V1,
  type TaskRuntimePublicationReceiptAuthorityV1,
  type TaskDefinitionSha256V1,
  type TaskRuntimeObjectReferenceV1,
  type TaskRuntimeObjectRoleV1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import {
  copyBytes,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Effect, Encoding, Result } from "effect";

import {
  ImmutableR2CorruptionError,
  ImmutableR2BodyBudgetExceededError,
  ImmutableR2NotFoundError,
  ImmutableR2ResourceError,
  ImmutableR2SettlementUncertainError,
  immutableR2ResourceCause,
  immutableR2SettlementUncertainCause,
  makeImmutableR2ByteStore,
  type ImmutableR2Bucket,
} from "../immutableR2/ImmutableR2ByteStore.js";

export interface TaskRuntimeObjectStoreBucket extends ImmutableR2Bucket {}

export class TaskRuntimeObjectStoreInputError
  extends Data.TaggedError("TaskRuntimeObjectStoreInputError")<{
    readonly operation: "publish" | "read";
    readonly field: "object" | "reference";
    readonly reason: "invalidInput" | "bodyBudgetExceeded";
  }> {}

export class TaskRuntimeObjectStoreNotFoundError
  extends Data.TaggedError("TaskRuntimeObjectStoreNotFoundError")<{
    readonly reference: TaskRuntimeObjectReferenceV1;
  }> {}

export class TaskRuntimeObjectStoreResourceError
  extends Data.TaggedError("TaskRuntimeObjectStoreResourceError")<{
    readonly operation: "put" | "get" | "readBody" | "hash";
    readonly reference: TaskRuntimeObjectReferenceV1;
  }> {}

export class TaskRuntimeObjectStoreCorruptionError
  extends Data.TaggedError("TaskRuntimeObjectStoreCorruptionError")<{
    readonly reference: TaskRuntimeObjectReferenceV1;
    readonly reason:
      | "digestMismatch"
      | "keyCollision"
      | "invalidBody"
      | "invalidMetadata"
      | "sizeMismatch";
  }> {}

export class TaskRuntimeObjectStoreSettlementUncertainError
  extends Data.TaggedError("TaskRuntimeObjectStoreSettlementUncertainError")<{
    readonly reference: TaskRuntimeObjectReferenceV1;
    readonly stage: "firstCreate" | "repeatCreate" | "reconcileRead";
  }> {}

export type TaskRuntimeObjectStoreError =
  | TaskRuntimeObjectStoreInputError
  | TaskRuntimeObjectStoreNotFoundError
  | TaskRuntimeObjectStoreResourceError
  | TaskRuntimeObjectStoreCorruptionError
  | TaskRuntimeObjectStoreSettlementUncertainError;

export interface TaskRuntimeObjectStoreObject {
  readonly reference: TaskRuntimeObjectReferenceV1;
  readonly bytes: Uint8Array;
}

export interface TaskRuntimeObjectStore {
  readonly publish: (
    object: PreparedTaskRuntimeObjectV1,
  ) => Effect.Effect<TaskRuntimeObjectReferenceV1, TaskRuntimeObjectStoreError>;
  readonly publishConfirmed: (
    object: PreparedTaskRuntimeObjectV1,
  ) => Effect.Effect<PublishedTaskRuntimeObjectV1, TaskRuntimeObjectStoreError>;
  readonly read: (
    reference: unknown,
  ) => Effect.Effect<TaskRuntimeObjectStoreObject, TaskRuntimeObjectStoreError>;
}

const resourceCauses = new WeakMap<TaskRuntimeObjectStoreResourceError, unknown>();
const uncertainCauses = new WeakMap<
  TaskRuntimeObjectStoreSettlementUncertainError,
  unknown
>();

export function taskRuntimeObjectStoreResourceCause(
  error: TaskRuntimeObjectStoreResourceError,
): unknown {
  return resourceCauses.get(error);
}

export function taskRuntimeObjectStoreSettlementUncertainCause(
  error: TaskRuntimeObjectStoreSettlementUncertainError,
): unknown {
  return uncertainCauses.get(error);
}

export function makeTaskRuntimeObjectStore(
  bucket: TaskRuntimeObjectStoreBucket,
  sha256: StandardApplicationTaskSha256V1 =
    makeLiveStandardApplicationTaskSha256V1(),
  receiptAuthority?: Pick<
    TaskRuntimePublicationReceiptAuthorityV1,
    "confirmPublishedObject"
  >,
): TaskRuntimeObjectStore {
  const core = makeImmutableR2ByteStore(
    bucket,
    (bytes, maximumInputBytes) => sha256(bytes, { maximumInputBytes }),
  );

  const publish: TaskRuntimeObjectStore["publish"] = Effect.fn(
    "TaskRuntimeObjectStore.publish",
  )(function* (objectInput) {
    const captured = yield* capturePreparedObject(objectInput);
    const stored = yield* core.putImmutable({
      key: captured.reference.objectKey,
      expectedSha256: captured.reference.sha256,
      bytes: captured.bytes,
      maximumBodyBytes: Number(captured.reference.byteLength),
      maximumHashBytes: Number(captured.reference.byteLength),
    }).pipe(Effect.mapError(error => mapCoreError(captured.reference, error)));
    if (BigInt(stored.byteLength) !== captured.reference.byteLength) {
      return yield* new TaskRuntimeObjectStoreCorruptionError({
        reference: captured.reference,
        reason: "sizeMismatch",
      });
    }
    return copyReference(captured.reference);
  });

  const publishConfirmed: TaskRuntimeObjectStore["publishConfirmed"] = Effect.fn(
    "TaskRuntimeObjectStore.publishConfirmed",
  )(function* (object) {
    if (receiptAuthority === undefined) {
      return yield* inputError("publish", "object", "invalidInput");
    }
    const reference = yield* publish(object);
    return yield* Effect.fromResult(
      receiptAuthority.confirmPublishedObject(object, reference),
    ).pipe(Effect.mapError(() => new TaskRuntimeObjectStoreCorruptionError({
      reference,
      reason: "digestMismatch",
    })));
  });

  const read: TaskRuntimeObjectStore["read"] = Effect.fn(
    "TaskRuntimeObjectStore.read",
  )(function* (referenceInput) {
    const reference = yield* decodeReference(referenceInput, "read");
    const byteLength = Number(reference.byteLength);
    const stored = yield* core.readImmutable<never>({
      key: reference.objectKey,
      expectedSha256: reference.sha256,
      expectedByteLength: byteLength,
      maximumBodyBytes: byteLength,
      maximumHashBytes: byteLength,
    }).pipe(Effect.mapError(error => mapCoreError(reference, error)));
    return Object.freeze({
      reference: copyReference(reference),
      bytes: copyBytes(stored.bytes),
    });
  });

  return Object.freeze({ publish, publishConfirmed, read });
}

function capturePreparedObject(
  input: PreparedTaskRuntimeObjectV1,
): Effect.Effect<
  Readonly<{ reference: TaskRuntimeObjectReferenceV1; bytes: Uint8Array }>,
  TaskRuntimeObjectStoreInputError
> {
  return Effect.gen(function* () {
    let referenceInput: unknown;
    let bytesInput: unknown;
    let roleInput: unknown;
    let codecIdentityInput: unknown;
    let ordinalInput: unknown;
    try {
      const readReference = input.readReference;
      const readCanonicalBytes = input.readCanonicalBytes;
      if (
        typeof readReference !== "function" ||
        typeof readCanonicalBytes !== "function"
      ) {
        return yield* inputError("publish", "object", "invalidInput");
      }
      referenceInput = Reflect.apply(readReference, input, []);
      bytesInput = Reflect.apply(readCanonicalBytes, input, []);
      roleInput = input.role;
      codecIdentityInput = input.codecIdentity;
      ordinalInput = input.ordinal;
    } catch {
      return yield* inputError("publish", "object", "invalidInput");
    }
    const reference = yield* decodeReference(referenceInput, "publish").pipe(
      Effect.mapError(() => inputErrorValue("publish", "object", "invalidInput")),
    );
    if (
      roleInput !== reference.role ||
      codecIdentityInput !== codecIdentityForRole(reference.role) ||
      typeof ordinalInput !== "bigint" || ordinalInput < 0n ||
      !isUint8ArrayWithByteLength(bytesInput, Number(reference.byteLength))
    ) {
      return yield* inputError("publish", "object", "invalidInput");
    }
    return Object.freeze({ reference, bytes: copyBytes(bytesInput) });
  });
}

function codecIdentityForRole(role: TaskRuntimeObjectRoleV1): string {
  switch (role) {
    case "runtime_projection_module":
      return TASK_RUNTIME_PROJECTION_MODULE_CODEC_V1;
    case "task_runtime_projection":
      return TASK_RUNTIME_PROJECTION_CODEC_V1;
    case "task_runtime_entry":
      return TASK_RUNTIME_ENTRY_CODEC_V1;
    case "task_runtime_group_manifest":
      return TASK_RUNTIME_GROUP_MANIFEST_CODEC_V1;
    case "task_runtime_materialization_spec":
      return TASK_RUNTIME_MATERIALIZATION_SPEC_CODEC_V1;
  }
}

function decodeReference(
  input: unknown,
  operation: "publish" | "read",
): Effect.Effect<TaskRuntimeObjectReferenceV1, TaskRuntimeObjectStoreInputError> {
  return Effect.fromResult(decodeReferenceResult(input)).pipe(
    Effect.mapError(() => inputErrorValue(operation, "reference", "invalidInput")),
  );
}

function decodeReferenceResult(
  input: unknown,
): Result.Result<TaskRuntimeObjectReferenceV1, void> {
  return captureReferenceData(input).pipe(Result.flatMap(captured => Result.gen(function* () {
    const storeIdentity = yield* captured.storeIdentity === TASK_RUNTIME_OBJECT_STORE_V1
      ? Result.succeed(TASK_RUNTIME_OBJECT_STORE_V1)
      : Result.fail(undefined);
    const role = yield* decodeRole(captured.role);
    const byteLength = yield* typeof captured.byteLength === "bigint" &&
        captured.byteLength >= 1n &&
        captured.byteLength <=
          BigInt(MAX_TASK_RUNTIME_PUBLICATION_CANONICAL_BYTES_V1)
      ? Result.succeed(captured.byteLength)
      : Result.fail(undefined);
    const sha256 = yield* isUint8ArrayWithByteLength(captured.sha256, 32)
      ? Result.succeed(copyBytes(captured.sha256) as TaskDefinitionSha256V1)
      : Result.fail(undefined);
    const digestHex = Encoding.encodeHex(sha256);
    const objectKey = taskRuntimeObjectKeyV1(role, digestHex);
    if (captured.objectKey !== objectKey) return yield* Result.fail(undefined);
    return Object.freeze({ storeIdentity, role, objectKey, byteLength, sha256 });
  })));
}

function captureReferenceData(
  input: unknown,
): Result.Result<Readonly<Record<string, unknown>>, void> {
  return Result.try({
    try: () => {
      if (!isNonArrayRecord(input)) throw new Error("invalid reference");
      const expected = [
        "storeIdentity",
        "role",
        "objectKey",
        "byteLength",
        "sha256",
      ];
      const keys = Reflect.ownKeys(input);
      if (
        keys.length !== expected.length ||
        expected.some(key => !keys.includes(key))
      ) throw new Error("invalid reference");
      const captured = Object.create(null) as Record<string, unknown>;
      for (const key of expected) {
        const descriptor = Reflect.getOwnPropertyDescriptor(input, key);
        if (
          descriptor === undefined ||
          !("value" in descriptor) ||
          descriptor.enumerable !== true
        ) throw new Error("invalid reference");
        captured[key] = descriptor.value;
      }
      return Object.freeze(captured);
    },
    catch: () => undefined,
  });
}

function decodeRole(value: unknown): Result.Result<TaskRuntimeObjectRoleV1, void> {
  switch (value) {
    case "runtime_projection_module":
    case "task_runtime_projection":
    case "task_runtime_entry":
    case "task_runtime_group_manifest":
    case "task_runtime_materialization_spec":
      return Result.succeed(value);
    default:
      return Result.fail(undefined);
  }
}

function mapCoreError(
  reference: TaskRuntimeObjectReferenceV1,
  error:
    | ImmutableR2NotFoundError
    | ImmutableR2ResourceError
    | ImmutableR2CorruptionError
    | ImmutableR2BodyBudgetExceededError
    | ImmutableR2SettlementUncertainError
    | StandardApplicationTaskSha256InputV1Error
    | StandardApplicationTaskSha256ResourceV1Error,
): TaskRuntimeObjectStoreError {
  if (error instanceof ImmutableR2NotFoundError) {
    return new TaskRuntimeObjectStoreNotFoundError({
      reference: copyReference(reference),
    });
  }
  if (error instanceof ImmutableR2ResourceError) {
    return resourceError(error.operation, reference, immutableR2ResourceCause(error));
  }
  if (error instanceof ImmutableR2CorruptionError) {
    return new TaskRuntimeObjectStoreCorruptionError({
      reference: copyReference(reference),
      reason: error.reason,
    });
  }
  if (error instanceof ImmutableR2BodyBudgetExceededError) {
    return new TaskRuntimeObjectStoreCorruptionError({
      reference: copyReference(reference),
      reason: "sizeMismatch",
    });
  }
  if (error instanceof ImmutableR2SettlementUncertainError) {
    const mapped = new TaskRuntimeObjectStoreSettlementUncertainError({
      reference: copyReference(reference),
      stage: error.stage,
    });
    uncertainCauses.set(mapped, immutableR2SettlementUncertainCause(error));
    return mapped;
  }
  return resourceError("hash", reference, error);
}

function resourceError(
  operation: TaskRuntimeObjectStoreResourceError["operation"],
  reference: TaskRuntimeObjectReferenceV1,
  cause: unknown,
): TaskRuntimeObjectStoreResourceError {
  const error = new TaskRuntimeObjectStoreResourceError({
    operation,
    reference: copyReference(reference),
  });
  resourceCauses.set(error, cause);
  return error;
}

function inputError(
  operation: TaskRuntimeObjectStoreInputError["operation"],
  field: TaskRuntimeObjectStoreInputError["field"],
  reason: TaskRuntimeObjectStoreInputError["reason"],
): Effect.Effect<never, TaskRuntimeObjectStoreInputError> {
  return Effect.fail(inputErrorValue(operation, field, reason));
}

function inputErrorValue(
  operation: TaskRuntimeObjectStoreInputError["operation"],
  field: TaskRuntimeObjectStoreInputError["field"],
  reason: TaskRuntimeObjectStoreInputError["reason"],
): TaskRuntimeObjectStoreInputError {
  return new TaskRuntimeObjectStoreInputError({ operation, field, reason });
}

function copyReference(
  reference: TaskRuntimeObjectReferenceV1,
): TaskRuntimeObjectReferenceV1 {
  return Object.freeze({ ...reference, sha256: copyBytes(reference.sha256) as TaskDefinitionSha256V1 });
}
