import {
  makeLivePrivateSha256V1,
  type PrivateSha256V1ErrorPolicy,
} from "@flarex/analysis/internal/private-sha256-v1";
import {
  decodeTaskExecutionPrincipalReferenceV1,
  makeTaskExecutionPrincipalReferenceV1,
  MAX_TASK_EXECUTION_PRINCIPAL_CANONICAL_BYTES_V1,
  type TaskExecutionPrincipalReferenceV1,
} from "@flarex/durable-task/internal/run-creation-v1";
import { copyBytes } from "@flarex/utils/bytes";
import { Data, Effect, Result, Schema } from "effect";
import {
  decodeExecutionIdentityEffect,
  type ExecutionIdentity,
  UserIdentitySchema,
} from "flarex-protocol/auth";
import type { Json } from "flarex-protocol/json";
import {
  ReplacementScopeIdV1Schema,
  type ReplacementScopeIdV1,
} from "flarex-protocol/storage-authority";
import {
  canonicalizeFlarexValueV1Effect,
  decodeCanonicalFlarexValueEvidenceV1Effect,
  FlarexValueCodecV1Error,
  FlarexValueEvidenceV1Error,
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

export type TaskExecutionPrincipalIdentity = Extract<
  ExecutionIdentity,
  { readonly kind: "user" }
>;

export interface TaskExecutionPrincipalObjectV1 {
  readonly version: 1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly executionIdentity: TaskExecutionPrincipalIdentity;
}

export interface StoredTaskExecutionPrincipal {
  readonly reference: TaskExecutionPrincipalReferenceV1;
  readonly object: TaskExecutionPrincipalObjectV1;
  readonly canonicalBytes: Uint8Array;
}

export class TaskExecutionPrincipalStoreInputError extends Data.TaggedError(
  "TaskExecutionPrincipalStoreInputError",
)<{
  readonly operation: "create" | "issue" | "read";
  readonly reason:
    | "invalidScope"
    | "invalidIdentity"
    | "anonymousIdentity"
    | "canonicalByteBudgetExceeded"
    | "invalidReference";
}> {}

export class TaskExecutionPrincipalStoreNotFoundError extends Data.TaggedError(
  "TaskExecutionPrincipalStoreNotFoundError",
)<{ readonly reference: TaskExecutionPrincipalReferenceV1 }> {}

export class TaskExecutionPrincipalStoreResourceError extends Data.TaggedError(
  "TaskExecutionPrincipalStoreResourceError",
)<{
  readonly operation: "put" | "get" | "readBody" | "hash";
  readonly reference: TaskExecutionPrincipalReferenceV1;
}> {}

export class TaskExecutionPrincipalStoreCorruptionError extends Data.TaggedError(
  "TaskExecutionPrincipalStoreCorruptionError",
)<{
  readonly reference: TaskExecutionPrincipalReferenceV1;
  readonly reason:
    | "digestMismatch"
    | "keyCollision"
    | "invalidBody"
    | "invalidMetadata"
    | "sizeMismatch"
    | "invalidCanonicalPrincipal"
    | "scopeMismatch";
}> {}

export class TaskExecutionPrincipalStoreSettlementUncertainError
  extends Data.TaggedError("TaskExecutionPrincipalStoreSettlementUncertainError")<{
    readonly reference: TaskExecutionPrincipalReferenceV1;
    readonly stage: "firstCreate" | "repeatCreate" | "reconcileRead";
  }> {}

export type TaskExecutionPrincipalStoreError =
  | TaskExecutionPrincipalStoreInputError
  | TaskExecutionPrincipalStoreNotFoundError
  | TaskExecutionPrincipalStoreResourceError
  | TaskExecutionPrincipalStoreCorruptionError
  | TaskExecutionPrincipalStoreSettlementUncertainError;

export interface TaskExecutionPrincipalIssuer {
  readonly scopeId: ReplacementScopeIdV1;
  readonly issueAuthenticatedUser: (
    identity: unknown,
  ) => Effect.Effect<
    TaskExecutionPrincipalReferenceV1,
    TaskExecutionPrincipalStoreError
  >;
}

export interface TaskExecutionPrincipalReader {
  readonly scopeId: ReplacementScopeIdV1;
  readonly read: (
    reference: unknown,
  ) => Effect.Effect<StoredTaskExecutionPrincipal, TaskExecutionPrincipalStoreError>;
}

export interface TaskExecutionPrincipalStore
  extends TaskExecutionPrincipalIssuer, TaskExecutionPrincipalReader {}

export interface TaskExecutionPrincipalStoreBucket extends ImmutableR2Bucket {}

class TaskExecutionPrincipalSha256InputError extends Data.TaggedError(
  "TaskExecutionPrincipalSha256InputError",
)<{ readonly reason: "invalidBudget" | "invalidBytes" | "inputBytesExceeded" }> {}

export class TaskExecutionPrincipalSha256ResourceError extends Data.TaggedError(
  "TaskExecutionPrincipalSha256ResourceError",
)<{ readonly reason: "unavailable" | "nativeRejected" }> {}

export type TaskExecutionPrincipalSha256 = (
  bytes: Uint8Array,
  maximumInputBytes: number,
) => Effect.Effect<Uint8Array, TaskExecutionPrincipalSha256ResourceError>;

const decodeScopeId = Schema.decodeUnknownResult(ReplacementScopeIdV1Schema);
const STRICT_PARSE_OPTIONS = { onExcessProperty: "error" } as const;
const PrincipalObjectSchema = Schema.Struct({
  version: Schema.Literal(1),
  scopeId: ReplacementScopeIdV1Schema,
  executionIdentity: Schema.Struct({
    kind: Schema.Literal("user"),
    user: UserIdentitySchema,
  }).annotate({ parseOptions: STRICT_PARSE_OPTIONS }),
}).annotate({ parseOptions: STRICT_PARSE_OPTIONS });
const decodePrincipalObject = Schema.decodeUnknownResult(
  PrincipalObjectSchema,
  STRICT_PARSE_OPTIONS,
);
const resourceCauses = new WeakMap<
  TaskExecutionPrincipalStoreResourceError,
  unknown
>();
const uncertainCauses = new WeakMap<
  TaskExecutionPrincipalStoreSettlementUncertainError,
  unknown
>();

export function taskExecutionPrincipalStoreResourceCause(
  error: TaskExecutionPrincipalStoreResourceError,
): unknown {
  return resourceCauses.get(error);
}

export function taskExecutionPrincipalStoreSettlementUncertainCause(
  error: TaskExecutionPrincipalStoreSettlementUncertainError,
): unknown {
  return uncertainCauses.get(error);
}

export function makeTaskExecutionPrincipalStore(
  scopeIdInput: unknown,
  bucket: TaskExecutionPrincipalStoreBucket,
  sha256: TaskExecutionPrincipalSha256 = makeLiveTaskExecutionPrincipalSha256(),
): Result.Result<TaskExecutionPrincipalStore, TaskExecutionPrincipalStoreInputError> {
  return decodeScopeId(scopeIdInput).pipe(
    Result.mapError(() => inputErrorValue("create", "invalidScope")),
    Result.map(scopeId => makeStore(scopeId, bucket, sha256)),
  );
}

export function decodeTaskExecutionPrincipalObjectV1(
  input: unknown,
): Result.Result<TaskExecutionPrincipalObjectV1, void> {
  return decodePrincipalObject(input).pipe(
    Result.map(ownPrincipalObject),
    Result.mapError(() => undefined),
  );
}

function makeStore(
  scopeId: ReplacementScopeIdV1,
  bucket: TaskExecutionPrincipalStoreBucket,
  sha256: TaskExecutionPrincipalSha256,
): TaskExecutionPrincipalStore {
  const core = makeImmutableR2ByteStore(bucket, sha256);
  const issueAuthenticatedUser: TaskExecutionPrincipalIssuer[
    "issueAuthenticatedUser"
  ] = Effect.fn("TaskExecutionPrincipalStore.issueAuthenticatedUser")(
    function* (identityInput) {
      const capturedIdentity = yield* captureIdentityInput(identityInput);
      const identity = yield* decodeExecutionIdentityEffect(capturedIdentity).pipe(
        Effect.mapError(() => inputErrorValue("issue", "invalidIdentity")),
      );
      if (identity.kind !== "user") {
        return yield* inputError("issue", "anonymousIdentity");
      }
      const object = ownPrincipalObject({
        version: 1,
        scopeId,
        executionIdentity: identity,
      });
      const canonical = yield* canonicalizeFlarexValueV1Effect(object).pipe(
        Effect.mapError(() => inputErrorValue("issue", "invalidIdentity")),
      );
      if (
        canonical.canonicalBytes.byteLength >
          MAX_TASK_EXECUTION_PRINCIPAL_CANONICAL_BYTES_V1
      ) {
        return yield* inputError("issue", "canonicalByteBudgetExceeded");
      }
      const reference = yield* Effect.fromResult(
        makeTaskExecutionPrincipalReferenceV1(
          canonical.sha256,
          canonical.canonicalBytes.byteLength,
        ),
      ).pipe(Effect.mapError(() => inputErrorValue("issue", "invalidIdentity")));
      const stored = yield* core.putImmutable({
        key: reference.objectKey,
        expectedSha256: reference.sha256,
        bytes: canonical.canonicalBytes,
        maximumBodyBytes: MAX_TASK_EXECUTION_PRINCIPAL_CANONICAL_BYTES_V1,
        maximumHashBytes: MAX_TASK_EXECUTION_PRINCIPAL_CANONICAL_BYTES_V1,
      }).pipe(Effect.mapError(error => mapCoreError(reference, error)));
      if (stored.byteLength !== reference.byteLength) {
        return yield* new TaskExecutionPrincipalStoreCorruptionError({
          reference: copyReference(reference),
          reason: "sizeMismatch",
        });
      }
      return copyReference(reference);
    },
  );

  const read: TaskExecutionPrincipalReader["read"] = Effect.fn(
    "TaskExecutionPrincipalStore.read",
  )(function* (referenceInput) {
    const reference = yield* Effect.fromResult(
      decodeTaskExecutionPrincipalReferenceV1(referenceInput),
    ).pipe(Effect.mapError(() => inputErrorValue("read", "invalidReference")));
    const stored = yield* core.readImmutable<never>({
      key: reference.objectKey,
      expectedSha256: reference.sha256,
      expectedByteLength: reference.byteLength,
      maximumBodyBytes: MAX_TASK_EXECUTION_PRINCIPAL_CANONICAL_BYTES_V1,
      maximumHashBytes: MAX_TASK_EXECUTION_PRINCIPAL_CANONICAL_BYTES_V1,
    }).pipe(Effect.mapError(error => mapCoreError(reference, error)));
    const canonical = yield* decodeCanonicalFlarexValueEvidenceV1Effect({
      canonicalBytes: stored.bytes,
      sha256: reference.sha256,
    }).pipe(Effect.mapError((error:
      | FlarexValueCodecV1Error
      | FlarexValueEvidenceV1Error) =>
        new TaskExecutionPrincipalStoreCorruptionError({
          reference: copyReference(reference),
          reason: "invalidCanonicalPrincipal",
        })
    ));
    const decoded = yield* Effect.fromResult(
      decodeTaskExecutionPrincipalObjectV1(canonical.value),
    ).pipe(Effect.mapError(() =>
      new TaskExecutionPrincipalStoreCorruptionError({
        reference: copyReference(reference),
        reason: "invalidCanonicalPrincipal",
      })
    ));
    if (decoded.scopeId !== scopeId) {
      return yield* new TaskExecutionPrincipalStoreCorruptionError({
        reference: copyReference(reference),
        reason: "scopeMismatch",
      });
    }
    return Object.freeze({
      reference: copyReference(reference),
      object: decoded,
      canonicalBytes: copyBytes(canonical.canonicalBytes),
    });
  });

  return Object.freeze({ scopeId, issueAuthenticatedUser, read });
}

export function makeLiveTaskExecutionPrincipalSha256(): TaskExecutionPrincipalSha256 {
  const policy: PrivateSha256V1ErrorPolicy<
    TaskExecutionPrincipalSha256InputError
      | TaskExecutionPrincipalSha256ResourceError
  > = {
    invalidBudget: () =>
      new TaskExecutionPrincipalSha256InputError({ reason: "invalidBudget" }),
    invalidBytes: () =>
      new TaskExecutionPrincipalSha256InputError({ reason: "invalidBytes" }),
    inputBytesExceeded: () =>
      new TaskExecutionPrincipalSha256InputError({
        reason: "inputBytesExceeded",
      }),
    unavailable: () => hashResourceError("unavailable", undefined),
    nativeRejected: cause => hashResourceError("nativeRejected", cause),
    invalidDigestOutput: observedByteLength =>
      new Error(
        `Task principal SHA-256 returned ${String(observedByteLength)} bytes.`,
      ),
  };
  const digest = makeLivePrivateSha256V1(policy);
  return Effect.fn("TaskExecutionPrincipalStore.sha256")(
    (bytes, maximumInputBytes) => digest(bytes, { maximumInputBytes }).pipe(
      Effect.catchTag("TaskExecutionPrincipalSha256InputError", Effect.die),
    ),
  );
}

function captureIdentityInput(
  input: unknown,
): Effect.Effect<unknown, TaskExecutionPrincipalStoreInputError> {
  return Effect.try({
    try: () => structuredClone(input),
    catch: () => inputErrorValue("issue", "invalidIdentity"),
  });
}

function ownPrincipalObject(
  input: TaskExecutionPrincipalObjectV1,
): TaskExecutionPrincipalObjectV1 {
  const executionIdentity = structuredClone(input.executionIdentity);
  for (const value of Object.values(executionIdentity.user)) {
    if (value !== undefined) freezeJson(value);
  }
  Object.freeze(executionIdentity.user);
  Object.freeze(executionIdentity);
  return Object.freeze({
    version: 1,
    scopeId: input.scopeId,
    executionIdentity,
  });
}

function freezeJson(value: Json): void {
  if (Array.isArray(value)) {
    for (const member of value) freezeJson(member);
    Object.freeze(value);
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const member of Object.values(value)) freezeJson(member);
    Object.freeze(value);
  }
}

function copyReference(
  reference: TaskExecutionPrincipalReferenceV1,
): TaskExecutionPrincipalReferenceV1 {
  return Object.freeze({
    principalKind: reference.principalKind,
    codec: reference.codec,
    store: reference.store,
    valueCodec: reference.valueCodec,
    objectKey: reference.objectKey,
    byteLength: reference.byteLength,
    // SAFETY: the copied bytes preserve the already-decoded 32-byte principal digest.
    sha256: copyBytes(reference.sha256) as typeof reference.sha256,
    retention: Object.freeze({ kind: reference.retention.kind }),
  });
}

function mapCoreError(
  reference: TaskExecutionPrincipalReferenceV1,
  error:
    | ImmutableR2NotFoundError
    | ImmutableR2ResourceError
    | ImmutableR2BodyBudgetExceededError
    | ImmutableR2CorruptionError
    | ImmutableR2SettlementUncertainError
    | TaskExecutionPrincipalSha256ResourceError,
): TaskExecutionPrincipalStoreError {
  if (error instanceof ImmutableR2NotFoundError) {
    return new TaskExecutionPrincipalStoreNotFoundError({
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
    return new TaskExecutionPrincipalStoreCorruptionError({
      reference: copyReference(reference),
      reason: "sizeMismatch",
    });
  }
  if (error instanceof ImmutableR2CorruptionError) {
    return new TaskExecutionPrincipalStoreCorruptionError({
      reference: copyReference(reference),
      reason: error.reason,
    });
  }
  if (error instanceof ImmutableR2SettlementUncertainError) {
    const mapped = new TaskExecutionPrincipalStoreSettlementUncertainError({
      reference: copyReference(reference),
      stage: error.stage,
    });
    uncertainCauses.set(mapped, immutableR2SettlementUncertainCause(error));
    return mapped;
  }
  return resourceError("hash", reference, hashResourceCauses.get(error));
}

function resourceError(
  operation: TaskExecutionPrincipalStoreResourceError["operation"],
  reference: TaskExecutionPrincipalReferenceV1,
  cause: unknown,
): TaskExecutionPrincipalStoreResourceError {
  const error = new TaskExecutionPrincipalStoreResourceError({
    operation,
    reference: copyReference(reference),
  });
  resourceCauses.set(error, cause);
  return error;
}

function hashResourceError(
  reason: TaskExecutionPrincipalSha256ResourceError["reason"],
  cause: unknown,
): TaskExecutionPrincipalSha256ResourceError {
  const error = new TaskExecutionPrincipalSha256ResourceError({ reason });
  if (cause !== undefined) {
    // The public error remains redacted; the store maps this exact instance.
    hashResourceCauses.set(error, cause);
  }
  return error;
}

const hashResourceCauses = new WeakMap<
  TaskExecutionPrincipalSha256ResourceError,
  unknown
>();

function inputError(
  operation: TaskExecutionPrincipalStoreInputError["operation"],
  reason: TaskExecutionPrincipalStoreInputError["reason"],
): Effect.Effect<never, TaskExecutionPrincipalStoreInputError> {
  return Effect.fail(inputErrorValue(operation, reason));
}

function inputErrorValue(
  operation: TaskExecutionPrincipalStoreInputError["operation"],
  reason: TaskExecutionPrincipalStoreInputError["reason"],
): TaskExecutionPrincipalStoreInputError {
  return new TaskExecutionPrincipalStoreInputError({ operation, reason });
}
