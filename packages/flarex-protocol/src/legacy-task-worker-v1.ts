import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Effect, Result, Schema } from "effect";

import {
  MAX_APPLICATION_TASK_WORKER_VALUE_SEMANTIC_BYTES_V1,
  normalizeApplicationTaskWorkerValueV1,
  type ApplicationTaskWorkerInputCapabilityV1,
  type ApplicationTaskWorkerDispatchIdentityV1,
} from "./application-task-worker-v1";
import type { CanonicalFlarexRuntimeValueV1 } from "./value-runtime-core";
import { ReplacementScopeIdV1Schema } from "./storage-authority";

export const LEGACY_TASK_WORKER_REQUEST_FORMAT_V1 =
  "flarex.legacy-task-worker-request" as const;
export const LEGACY_TASK_WORKER_REQUEST_VERSION_V1 = 1 as const;
export const LEGACY_TASK_WORKER_RESULT_FORMAT_V1 =
  "flarex.legacy-task-worker-result" as const;
export const LEGACY_TASK_WORKER_RESULT_VERSION_V1 = 1 as const;
export const TASK_COMPUTE_DISPATCH_IDENTITY_VERSION_V1 =
  "flarex.task-compute-dispatch-identity.v1" as const;
export const TASK_COMPUTE_DISPATCH_REQUEST_VERSION_V1 =
  "flarex.task-compute-dispatch-request.v1" as const;

export type LegacyTaskWorkerDispatchIdentityV1 =
  ApplicationTaskWorkerDispatchIdentityV1;

export interface LegacyTaskWorkerDispatchRequestV1 {
  readonly version: typeof TASK_COMPUTE_DISPATCH_REQUEST_VERSION_V1;
  readonly identity: LegacyTaskWorkerDispatchIdentityV1;
  readonly taskDefinitionRevisionId: string;
  readonly attemptNumber: number;
  readonly leaseVersion: bigint;
  readonly computeProfile: string;
  readonly cancellation:
    | Readonly<{ readonly kind: "not_requested"; readonly generation: 0n }>
    | Readonly<{ readonly kind: "requested"; readonly generation: bigint }>;
  readonly maximumDurationMs: number;
}

export interface LegacyTaskWorkerRequestV1 {
  readonly format: typeof LEGACY_TASK_WORKER_REQUEST_FORMAT_V1;
  readonly version: typeof LEGACY_TASK_WORKER_REQUEST_VERSION_V1;
  readonly dispatch: LegacyTaskWorkerDispatchRequestV1;
}

export interface LegacyTaskWorkerResultV1 {
  readonly format: typeof LEGACY_TASK_WORKER_RESULT_FORMAT_V1;
  readonly version: typeof LEGACY_TASK_WORKER_RESULT_VERSION_V1;
  readonly kind: "completed";
  readonly identity: LegacyTaskWorkerDispatchIdentityV1;
  readonly value: CanonicalFlarexRuntimeValueV1;
  readonly valueSemanticBytes: number;
}

export type LegacyTaskWorkerInputCapabilityV1 =
  ApplicationTaskWorkerInputCapabilityV1;

export class LegacyTaskWorkerContractV1Error extends Data.TaggedError(
  "LegacyTaskWorkerContractV1Error",
)<{
  readonly boundary: "request" | "result";
  readonly reason: "invalid_shape" | "invalid_value" | "value_size_mismatch";
  readonly path?: string;
  readonly cause?: unknown;
}> {}

const POSTGRES_SIGNED_BIGINT_MAX = 9_223_372_036_854_775_807n;
const MAX_TEXT_UTF8_BYTES = 255;
const UTF8 = new TextEncoder();
const RUN_ID = /^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ATTEMPT_ID = /^attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TASK_DEFINITION_REVISION_ID = /^taskdef_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PositiveBigInt = Schema.BigInt.check(Schema.makeFilter(value =>
  value >= 1n && value <= POSTGRES_SIGNED_BIGINT_MAX
    ? undefined
    : "Expected a positive signed 64-bit integer"
));
const PositiveSafeInteger = Schema.Number.check(Schema.isInt(), Schema.isBetween({
  minimum: 1,
  maximum: Number.MAX_SAFE_INTEGER,
}));
const BoundedText = Schema.String.check(Schema.makeFilter(value =>
  value.length >= 1 && UTF8.encode(value).byteLength <= MAX_TEXT_UTF8_BYTES
    ? undefined
    : "Expected bounded nonempty text"
));
const TaskDefinitionRevisionId = Schema.String.check(Schema.makeFilter(value =>
  TASK_DEFINITION_REVISION_ID.test(value)
    ? undefined
    : "Expected canonical task definition revision id"
));
const Identity = Schema.Struct({
  version: Schema.Literal(TASK_COMPUTE_DISPATCH_IDENTITY_VERSION_V1),
  scopeId: ReplacementScopeIdV1Schema,
  runId: Schema.String.check(Schema.makeFilter(value =>
    RUN_ID.test(value) ? undefined : "Expected canonical task run id"
  )),
  requestedEffectSequence: PositiveBigInt,
  attemptId: Schema.String.check(Schema.makeFilter(value =>
    ATTEMPT_ID.test(value) ? undefined : "Expected canonical task attempt id"
  )),
  executionFence: PositiveBigInt,
});
const Dispatch = Schema.Struct({
  version: Schema.Literal(TASK_COMPUTE_DISPATCH_REQUEST_VERSION_V1),
  identity: Identity,
  taskDefinitionRevisionId: TaskDefinitionRevisionId,
  attemptNumber: PositiveSafeInteger,
  leaseVersion: PositiveBigInt,
  computeProfile: BoundedText,
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

export function decodeLegacyTaskWorkerRequestV1(
  input: unknown,
): Result.Result<LegacyTaskWorkerRequestV1, LegacyTaskWorkerContractV1Error> {
  const record = captureExactRecord(input, ["format", "version", "dispatch"]);
  if (record === undefined || record.format !== LEGACY_TASK_WORKER_REQUEST_FORMAT_V1 ||
    record.version !== LEGACY_TASK_WORKER_REQUEST_VERSION_V1) {
    return Result.fail(failure("request", "invalid_shape"));
  }
  const dispatch = captureDispatch(record.dispatch);
  if (dispatch === undefined) {
    return Result.fail(failure("request", "invalid_shape", "dispatch"));
  }
  return decodeDispatch(dispatch).pipe(
    Result.mapError(cause => failure("request", "invalid_shape", "dispatch", cause)),
    Result.map(value => Object.freeze({
      format: LEGACY_TASK_WORKER_REQUEST_FORMAT_V1,
      version: LEGACY_TASK_WORKER_REQUEST_VERSION_V1,
      dispatch: snapshotDispatch(value),
    })),
  );
}

export const decodeLegacyTaskWorkerRequestV1Effect = Effect.fn(
  "LegacyTaskWorker.decodeRequestV1",
)((input: unknown) => Effect.fromResult(decodeLegacyTaskWorkerRequestV1(input)));

export function decodeLegacyTaskWorkerResultV1(
  input: unknown,
): Result.Result<LegacyTaskWorkerResultV1, LegacyTaskWorkerContractV1Error> {
  const record = captureExactRecord(input, [
    "format", "version", "kind", "identity", "value", "valueSemanticBytes",
  ]);
  if (record === undefined || record.format !== LEGACY_TASK_WORKER_RESULT_FORMAT_V1 ||
    record.version !== LEGACY_TASK_WORKER_RESULT_VERSION_V1 ||
    record.kind !== "completed" || !isSemanticSize(record.valueSemanticBytes)) {
    return Result.fail(failure("result", "invalid_shape"));
  }
  return Result.gen(function* () {
    const capturedIdentity = captureIdentity(record.identity);
    if (capturedIdentity === undefined) {
      return yield* Result.fail(failure("result", "invalid_shape", "identity"));
    }
    const identity = yield* decodeIdentity(capturedIdentity).pipe(
      Result.mapError(cause => failure("result", "invalid_shape", "identity", cause)),
      Result.map(snapshotIdentity),
    );
    const normalized = yield* normalizeApplicationTaskWorkerValueV1(
      record.value,
      "result",
    ).pipe(Result.mapError(cause => failure(
      "result",
      "invalid_value",
      "value",
      cause,
    )));
    if (normalized.semanticSizeBytes !== record.valueSemanticBytes) {
      return yield* Result.fail(failure(
        "result", "value_size_mismatch", "valueSemanticBytes",
      ));
    }
    return Object.freeze({
      format: LEGACY_TASK_WORKER_RESULT_FORMAT_V1,
      version: LEGACY_TASK_WORKER_RESULT_VERSION_V1,
      kind: "completed" as const,
      identity,
      value: normalized.value,
      valueSemanticBytes: normalized.semanticSizeBytes,
    });
  });
}

export const decodeLegacyTaskWorkerResultV1Effect = Effect.fn(
  "LegacyTaskWorker.decodeResultV1",
)((input: unknown) => Effect.fromResult(decodeLegacyTaskWorkerResultV1(input)));

function captureDispatch(input: unknown): unknown | undefined {
  const outer = captureExactRecord(input, [
    "version", "identity", "taskDefinitionRevisionId", "attemptNumber",
    "leaseVersion", "computeProfile", "cancellation", "maximumDurationMs",
  ]);
  if (outer === undefined) return undefined;
  const identity = captureIdentity(outer.identity);
  const cancellation = captureCancellation(outer.cancellation);
  if (identity === undefined || cancellation === undefined) return undefined;
  return Object.freeze({ ...outer, identity, cancellation });
}

function captureIdentity(input: unknown): unknown | undefined {
  const value = captureExactRecord(input, [
    "version", "scopeId", "runId", "requestedEffectSequence", "attemptId",
    "executionFence",
  ]);
  return value === undefined ? undefined : Object.freeze({ ...value });
}

function captureCancellation(input: unknown): unknown | undefined {
  const value = captureExactRecord(input, ["kind", "generation"]);
  return value === undefined ? undefined : Object.freeze({ ...value });
}

function captureExactRecord(
  input: unknown,
  expectedKeys: ReadonlyArray<string>,
): Readonly<Record<string, unknown>> | undefined {
  return Result.try({
    try: () => {
      if (!isNonArrayRecord(input)) return undefined;
      const keys = Reflect.ownKeys(input);
      if (keys.length !== expectedKeys.length || keys.some(key =>
        typeof key !== "string" || !expectedKeys.includes(key)
      )) return undefined;
      const output: Record<string, unknown> = Object.create(null);
      for (const key of expectedKeys) {
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (descriptor === undefined || !("value" in descriptor) ||
          !descriptor.enumerable) return undefined;
        output[key] = descriptor.value;
      }
      return Object.freeze(output);
    },
    catch: () => undefined,
  }).pipe(Result.getOrElse(() => undefined));
}

function snapshotDispatch(value: typeof Dispatch.Type): LegacyTaskWorkerDispatchRequestV1 {
  return Object.freeze({
    ...value,
    identity: snapshotIdentity(value.identity),
    cancellation: Object.freeze({ ...value.cancellation }),
  });
}

function snapshotIdentity(
  value: typeof Identity.Type,
): LegacyTaskWorkerDispatchIdentityV1 {
  return Object.freeze({ ...value });
}

function isSemanticSize(value: unknown): value is number {
  // SAFETY: Number.isSafeInteger proved value is a number before the
  // range comparisons.
  return Number.isSafeInteger(value) && (value as number) >= 0 &&
    (value as number) <= MAX_APPLICATION_TASK_WORKER_VALUE_SEMANTIC_BYTES_V1;
}

function failure(
  boundary: LegacyTaskWorkerContractV1Error["boundary"],
  reason: LegacyTaskWorkerContractV1Error["reason"],
  path?: string,
  cause?: unknown,
): LegacyTaskWorkerContractV1Error {
  return new LegacyTaskWorkerContractV1Error({
    boundary,
    reason,
    ...(path === undefined ? {} : { path }),
    ...(cause === undefined ? {} : { cause }),
  });
}
