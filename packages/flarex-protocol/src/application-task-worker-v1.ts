import { isUint8ArrayWithByteLength } from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Effect, Result, Schema } from "effect";

import {
  MAX_FLAREX_VALUE_ARRAY_ITEMS_V1,
  MAX_FLAREX_VALUE_NESTING_V1,
  MAX_FLAREX_VALUE_OBJECT_FIELDS_V1,
  FlarexValueRuntimeCoreV1Error,
  normalizeFlarexRuntimeValueWithLimitsV1,
  type CanonicalFlarexRuntimeValueV1,
  type FlarexValueLimitsV1,
  type NormalizedFlarexRuntimeValueV1,
} from "./value-runtime-core";
import { ReplacementScopeIdV1Schema } from "./storage-authority";

export const APPLICATION_TASK_WORKER_REQUEST_FORMAT_V1 =
  "flarex.application-task-worker-request" as const;
export const APPLICATION_TASK_WORKER_REQUEST_VERSION_V1 = 1 as const;
export const APPLICATION_TASK_WORKER_RESULT_FORMAT_V1 =
  "flarex.application-task-worker-result" as const;
export const APPLICATION_TASK_WORKER_RESULT_VERSION_V1 = 1 as const;
export const TASK_COMPUTE_DISPATCH_IDENTITY_VERSION_V1 =
  "flarex.task-compute-dispatch-identity.v1" as const;
export const TASK_COMPUTE_DISPATCH_REQUEST_VERSION_V1 =
  "flarex.task-compute-dispatch-request.v1" as const;
export const MAX_APPLICATION_TASK_WORKER_VALUE_SEMANTIC_BYTES_V1 =
  8 * 1_048_576;

export interface ApplicationTaskWorkerDispatchIdentityV1 {
  readonly version: typeof TASK_COMPUTE_DISPATCH_IDENTITY_VERSION_V1;
  readonly scopeId: typeof ReplacementScopeIdV1Schema.Type;
  readonly runId: string;
  readonly requestedEffectSequence: bigint;
  readonly attemptId: string;
  readonly executionFence: bigint;
}

export interface ApplicationTaskWorkerDispatchRequestV1 {
  readonly version: typeof TASK_COMPUTE_DISPATCH_REQUEST_VERSION_V1;
  readonly identity: ApplicationTaskWorkerDispatchIdentityV1;
  readonly applicationTaskRuntimeTargetSha256: Uint8Array;
  readonly attemptNumber: number;
  readonly leaseVersion: bigint;
  readonly computeProfile: string;
  readonly cancellation:
    | Readonly<{ readonly kind: "not_requested"; readonly generation: 0n }>
    | Readonly<{ readonly kind: "requested"; readonly generation: bigint }>;
  readonly maximumDurationMs: number;
}

export interface ApplicationTaskWorkerRequestV1 {
  readonly format: typeof APPLICATION_TASK_WORKER_REQUEST_FORMAT_V1;
  readonly version: typeof APPLICATION_TASK_WORKER_REQUEST_VERSION_V1;
  readonly dispatch: ApplicationTaskWorkerDispatchRequestV1;
}

export interface ApplicationTaskWorkerResultV1 {
  readonly format: typeof APPLICATION_TASK_WORKER_RESULT_FORMAT_V1;
  readonly version: typeof APPLICATION_TASK_WORKER_RESULT_VERSION_V1;
  readonly kind: "completed";
  readonly identity: ApplicationTaskWorkerDispatchIdentityV1;
  readonly value: CanonicalFlarexRuntimeValueV1;
  readonly valueSemanticBytes: number;
}

export interface ApplicationTaskWorkerInputCapabilityV1 {
  readonly read: () => unknown | PromiseLike<unknown>;
}

export class ApplicationTaskWorkerContractV1Error extends Data.TaggedError(
  "ApplicationTaskWorkerContractV1Error",
)<{
  readonly boundary: "request" | "result";
  readonly reason: "invalid_shape" | "invalid_value" | "value_size_mismatch";
  readonly path?: string;
  readonly cause?: unknown;
}> {}

const POSTGRES_SIGNED_BIGINT_MAX = 9_223_372_036_854_775_807n;
const MAX_COMPUTE_PROFILE_UTF8_BYTES = 255;
const UTF8 = new TextEncoder();
const RUN_ID = /^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ATTEMPT_ID = /^attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PositiveBigInt = Schema.BigInt.check(Schema.makeFilter(value =>
  value >= 1n && value <= POSTGRES_SIGNED_BIGINT_MAX
    ? undefined
    : "Expected a positive signed 64-bit integer"
));
const PositiveSafeInteger = Schema.Number.check(Schema.isInt(), Schema.isBetween({
  minimum: 1,
  maximum: Number.MAX_SAFE_INTEGER,
}));
const RunId = Schema.String.check(Schema.makeFilter(value =>
  RUN_ID.test(value) ? undefined : "Expected a canonical task run id"
));
const AttemptId = Schema.String.check(Schema.makeFilter(value =>
  ATTEMPT_ID.test(value) ? undefined : "Expected a canonical task attempt id"
));
const ComputeProfile = Schema.String.check(Schema.makeFilter(value =>
  value.length >= 1 && UTF8.encode(value).byteLength <= MAX_COMPUTE_PROFILE_UTF8_BYTES
    ? undefined
    : "Expected a bounded nonempty compute profile"
));
const Digest = Schema.declare((value): value is Uint8Array =>
  isUint8ArrayWithByteLength(value, 32),
);
const Identity = Schema.Struct({
  version: Schema.Literal(TASK_COMPUTE_DISPATCH_IDENTITY_VERSION_V1),
  scopeId: ReplacementScopeIdV1Schema,
  runId: RunId,
  requestedEffectSequence: PositiveBigInt,
  attemptId: AttemptId,
  executionFence: PositiveBigInt,
});
const Dispatch = Schema.Struct({
  version: Schema.Literal(TASK_COMPUTE_DISPATCH_REQUEST_VERSION_V1),
  identity: Identity,
  applicationTaskRuntimeTargetSha256: Digest,
  attemptNumber: PositiveSafeInteger,
  leaseVersion: PositiveBigInt,
  computeProfile: ComputeProfile,
  cancellation: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("not_requested"), generation: Schema.Literal(0n) }),
    Schema.Struct({ kind: Schema.Literal("requested"), generation: PositiveBigInt }),
  ]),
  maximumDurationMs: PositiveSafeInteger,
});
const decodeDispatch = Schema.decodeUnknownResult(Schema.toType(Dispatch), {
  onExcessProperty: "error",
});
const decodeIdentity = Schema.decodeUnknownResult(Schema.toType(Identity), {
  onExcessProperty: "error",
});
const TASK_WORKER_VALUE_LIMITS = Object.freeze({
  profile: "generalValue" as const,
  maxSemanticBytes: MAX_APPLICATION_TASK_WORKER_VALUE_SEMANTIC_BYTES_V1,
  maxNesting: MAX_FLAREX_VALUE_NESTING_V1,
  maxArrayItems: MAX_FLAREX_VALUE_ARRAY_ITEMS_V1,
  maxObjectFields: MAX_FLAREX_VALUE_OBJECT_FIELDS_V1,
  requireDocumentObject: false,
}) satisfies FlarexValueLimitsV1;

export function decodeApplicationTaskWorkerRequestV1(
  input: unknown,
): Result.Result<
  ApplicationTaskWorkerRequestV1,
  ApplicationTaskWorkerContractV1Error
> {
  const record = captureExactRecord(input, ["format", "version", "dispatch"]);
  if (record === undefined ||
    record.format !== APPLICATION_TASK_WORKER_REQUEST_FORMAT_V1 ||
    record.version !== APPLICATION_TASK_WORKER_REQUEST_VERSION_V1) {
    return Result.fail(failure("request", "invalid_shape"));
  }
  const dispatch = captureDispatch(record.dispatch);
  if (dispatch === undefined) {
    return Result.fail(failure("request", "invalid_shape", "dispatch"));
  }
  return decodeDispatch(dispatch).pipe(
    Result.mapError(cause => failure("request", "invalid_shape", "dispatch", cause)),
    Result.map((decodedDispatch) => Object.freeze({
      format: APPLICATION_TASK_WORKER_REQUEST_FORMAT_V1,
      version: APPLICATION_TASK_WORKER_REQUEST_VERSION_V1,
      dispatch: snapshotDispatch(decodedDispatch),
    })),
  );
}

export const decodeApplicationTaskWorkerRequestV1Effect = Effect.fn(
  "ApplicationTaskWorker.decodeRequestV1",
)((input: unknown) => Effect.fromResult(decodeApplicationTaskWorkerRequestV1(input)));

export function decodeApplicationTaskWorkerResultV1(
  input: unknown,
): Result.Result<
  ApplicationTaskWorkerResultV1,
  ApplicationTaskWorkerContractV1Error
> {
  const record = captureExactRecord(input, [
    "format", "version", "kind", "identity", "value", "valueSemanticBytes",
  ]);
  if (record === undefined ||
    record.format !== APPLICATION_TASK_WORKER_RESULT_FORMAT_V1 ||
    record.version !== APPLICATION_TASK_WORKER_RESULT_VERSION_V1 ||
    record.kind !== "completed" || !isSemanticSize(record.valueSemanticBytes)) {
    return Result.fail(failure("result", "invalid_shape"));
  }
  return Result.gen(function* () {
    const capturedIdentity = captureIdentity(record.identity);
    if (capturedIdentity === undefined) {
      return yield* Result.fail(failure(
        "result", "invalid_shape", "identity",
      ));
    }
    const identity = yield* decodeIdentity(capturedIdentity).pipe(
      Result.mapError(cause => failure("result", "invalid_shape", "identity", cause)),
      Result.map(snapshotIdentity),
    );
    const normalized = yield* normalizeValue(record.value, "result");
    if (normalized.semanticSizeBytes !== record.valueSemanticBytes) {
      return yield* Result.fail(failure(
        "result", "value_size_mismatch", "valueSemanticBytes",
      ));
    }
    return Object.freeze({
      format: APPLICATION_TASK_WORKER_RESULT_FORMAT_V1,
      version: APPLICATION_TASK_WORKER_RESULT_VERSION_V1,
      kind: "completed" as const,
      identity,
      value: normalized.value,
      valueSemanticBytes: normalized.semanticSizeBytes,
    });
  });
}

export const decodeApplicationTaskWorkerResultV1Effect = Effect.fn(
  "ApplicationTaskWorker.decodeResultV1",
)((input: unknown) => Effect.fromResult(decodeApplicationTaskWorkerResultV1(input)));

export function normalizeApplicationTaskWorkerValueV1(
  input: unknown,
  boundary: "request" | "result",
): Result.Result<Readonly<{
  readonly value: CanonicalFlarexRuntimeValueV1;
  readonly semanticSizeBytes: number;
}>, ApplicationTaskWorkerContractV1Error> {
  return normalizeValue(input, boundary).pipe(Result.map(normalized =>
    Object.freeze({
      value: normalized.value,
      semanticSizeBytes: normalized.semanticSizeBytes,
    })
  ));
}

function normalizeValue(input: unknown, boundary: "request" | "result"):
  Result.Result<NormalizedFlarexRuntimeValueV1, ApplicationTaskWorkerContractV1Error> {
  try {
    return Result.succeed(normalizeFlarexRuntimeValueWithLimitsV1(
      input,
      TASK_WORKER_VALUE_LIMITS,
    ));
  } catch (cause) {
    if (cause instanceof FlarexValueRuntimeCoreV1Error) {
      return Result.fail(failure(boundary, "invalid_value", "value", cause));
    }
    throw cause;
  }
}

function snapshotDispatch(value: typeof Dispatch.Type): ApplicationTaskWorkerDispatchRequestV1 {
  return Object.freeze({
    version: value.version,
    identity: snapshotIdentity(value.identity),
    applicationTaskRuntimeTargetSha256:
      new Uint8Array(value.applicationTaskRuntimeTargetSha256),
    attemptNumber: value.attemptNumber,
    leaseVersion: value.leaseVersion,
    computeProfile: value.computeProfile,
    cancellation: Object.freeze({ ...value.cancellation }),
    maximumDurationMs: value.maximumDurationMs,
  });
}

function snapshotIdentity(value: typeof Identity.Type): ApplicationTaskWorkerDispatchIdentityV1 {
  return Object.freeze({ ...value });
}

function isSemanticSize(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 &&
    value <= MAX_APPLICATION_TASK_WORKER_VALUE_SEMANTIC_BYTES_V1;
}

function captureExactRecord(input: unknown, keys: ReadonlyArray<string>) {
  try {
    if (!isNonArrayRecord(input)) return undefined;
    const observed = Reflect.ownKeys(input);
    if (observed.length !== keys.length || observed.some(key =>
      typeof key !== "string" || !keys.includes(key))) return undefined;
    const captured: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (descriptor === undefined || !descriptor.enumerable ||
        !("value" in descriptor)) return undefined;
      Object.defineProperty(captured, key, {
        configurable: false,
        enumerable: true,
        writable: false,
        value: descriptor.value,
      });
    }
    return Object.freeze(captured);
  } catch {
    return undefined;
  }
}

function captureDispatch(input: unknown): unknown | undefined {
  const dispatch = captureExactRecord(input, [
    "version",
    "identity",
    "applicationTaskRuntimeTargetSha256",
    "attemptNumber",
    "leaseVersion",
    "computeProfile",
    "cancellation",
    "maximumDurationMs",
  ]);
  if (dispatch === undefined) return undefined;
  const identity = captureIdentity(dispatch.identity);
  const cancellation = captureCancellation(dispatch.cancellation);
  if (identity === undefined || cancellation === undefined) return undefined;
  return Object.freeze({ ...dispatch, identity, cancellation });
}

function captureIdentity(input: unknown): unknown | undefined {
  return captureExactRecord(input, [
    "version",
    "scopeId",
    "runId",
    "requestedEffectSequence",
    "attemptId",
    "executionFence",
  ]);
}

function captureCancellation(input: unknown): unknown | undefined {
  return captureExactRecord(input, ["kind", "generation"]);
}

function failure(
  boundary: "request" | "result",
  reason: ApplicationTaskWorkerContractV1Error["reason"],
  path?: string,
  cause?: unknown,
) {
  return new ApplicationTaskWorkerContractV1Error({
    boundary,
    reason,
    ...(path === undefined ? {} : { path }),
    ...(cause === undefined ? {} : { cause }),
  });
}
