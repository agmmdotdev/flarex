import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Result, Schema } from "effect";

import {
  decodeApplicationTaskWorkerRequestV1,
  type ApplicationTaskWorkerDispatchIdentityV1,
  type ApplicationTaskWorkerRequestV1,
} from "./application-task-worker-v1";
import {
  decodeLegacyTaskWorkerRequestV1,
  type LegacyTaskWorkerRequestV1,
} from "./legacy-task-worker-v1";
import { ReplacementScopeIdV1Schema } from "./storage-authority";

export const TASK_WORKER_SESSION_START_FORMAT_V1 =
  "flarex.task-worker-session-start" as const;
export const TASK_WORKER_SESSION_START_VERSION_V1 = 1 as const;
export const TASK_WORKER_SESSION_ACCEPTANCE_FORMAT_V1 =
  "flarex.task-worker-session-acceptance" as const;
export const TASK_WORKER_SESSION_ACCEPTANCE_VERSION_V1 = 1 as const;
export const TASK_WORKER_SESSION_INTERRUPTION_FORMAT_V1 =
  "flarex.task-worker-session-interruption" as const;
export const TASK_WORKER_SESSION_INTERRUPTION_VERSION_V1 = 1 as const;
export const TASK_WORKER_SESSION_SETTLEMENT_FORMAT_V1 =
  "flarex.task-worker-session-settlement" as const;
export const TASK_WORKER_SESSION_SETTLEMENT_VERSION_V1 = 1 as const;

export type TaskWorkerSessionGenerationV1 =
  | "legacy_dynamic_worker_v1"
  | "application_v1";

interface TaskWorkerSessionStartBaseV1 {
  readonly format: typeof TASK_WORKER_SESSION_START_FORMAT_V1;
  readonly version: typeof TASK_WORKER_SESSION_START_VERSION_V1;
  readonly executionId: string;
}

export type TaskWorkerSessionStartRequestV1 =
  | TaskWorkerSessionStartBaseV1 & Readonly<{
      readonly generation: "legacy_dynamic_worker_v1";
      readonly request: LegacyTaskWorkerRequestV1;
    }>
  | TaskWorkerSessionStartBaseV1 & Readonly<{
      readonly generation: "application_v1";
      readonly request: ApplicationTaskWorkerRequestV1;
    }>;

export interface TaskWorkerSessionAcceptanceV1 {
  readonly format: typeof TASK_WORKER_SESSION_ACCEPTANCE_FORMAT_V1;
  readonly version: typeof TASK_WORKER_SESSION_ACCEPTANCE_VERSION_V1;
  readonly kind: "accepted";
  readonly generation: TaskWorkerSessionGenerationV1;
  readonly identity: ApplicationTaskWorkerDispatchIdentityV1;
  readonly executionId: string;
  readonly cancellationGeneration: bigint;
}

export interface TaskWorkerSessionInterruptionRequestV1 {
  readonly format: typeof TASK_WORKER_SESSION_INTERRUPTION_FORMAT_V1;
  readonly version: typeof TASK_WORKER_SESSION_INTERRUPTION_VERSION_V1;
  readonly generation: TaskWorkerSessionGenerationV1;
  readonly identity: ApplicationTaskWorkerDispatchIdentityV1;
  readonly executionId: string;
  readonly cancellationGeneration: bigint;
}

export interface TaskWorkerSessionInterruptionAcceptanceV1 {
  readonly format: typeof TASK_WORKER_SESSION_INTERRUPTION_FORMAT_V1;
  readonly version: typeof TASK_WORKER_SESSION_INTERRUPTION_VERSION_V1;
  readonly kind: "interruption_requested";
  readonly generation: TaskWorkerSessionGenerationV1;
  readonly identity: ApplicationTaskWorkerDispatchIdentityV1;
  readonly executionId: string;
  readonly cancellationGeneration: bigint;
}

export interface TaskWorkerSessionSettlementV1 {
  readonly format: typeof TASK_WORKER_SESSION_SETTLEMENT_FORMAT_V1;
  readonly version: typeof TASK_WORKER_SESSION_SETTLEMENT_VERSION_V1;
  readonly kind: "settled";
  readonly generation: TaskWorkerSessionGenerationV1;
  readonly identity: ApplicationTaskWorkerDispatchIdentityV1;
  readonly executionId: string;
}

export class TaskWorkerSessionContractV1Error extends Data.TaggedError(
  "TaskWorkerSessionContractV1Error",
)<{
  readonly boundary: "start" | "acceptance" | "interruption" | "settlement";
  readonly reason: "invalid_shape" | "identity_mismatch" | "stale_generation";
  readonly path?: string;
  readonly cause?: unknown;
}> {}

const POSTGRES_SIGNED_BIGINT_MAX = 9_223_372_036_854_775_807n;
const EXECUTION_ID = /^[\x21-\x7e]{1,255}$/;
const RUN_ID = /^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ATTEMPT_ID = /^attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const Generation = Schema.Literals([
  "legacy_dynamic_worker_v1",
  "application_v1",
]);
const ExecutionId = Schema.String.check(Schema.makeFilter(value =>
  EXECUTION_ID.test(value) ? undefined : "Expected a bounded visible ASCII execution ID"
));
const NonNegativeBigInt = Schema.BigInt.check(Schema.makeFilter(value =>
  value >= 0n && value <= POSTGRES_SIGNED_BIGINT_MAX
    ? undefined
    : "Expected a non-negative signed 64-bit integer"
));
const PositiveBigInt = Schema.BigInt.check(Schema.makeFilter(value =>
  value >= 1n && value <= POSTGRES_SIGNED_BIGINT_MAX
    ? undefined
    : "Expected a positive signed 64-bit integer"
));
const Identity = Schema.Struct({
  version: Schema.Literal("flarex.task-compute-dispatch-identity.v1"),
  scopeId: ReplacementScopeIdV1Schema,
  runId: Schema.String.check(Schema.makeFilter(value =>
    RUN_ID.test(value) ? undefined : "Expected a canonical task run id"
  )),
  requestedEffectSequence: PositiveBigInt,
  attemptId: Schema.String.check(Schema.makeFilter(value =>
    ATTEMPT_ID.test(value) ? undefined : "Expected a canonical task attempt id"
  )),
  executionFence: PositiveBigInt,
});
const Acceptance = Schema.Struct({
  format: Schema.Literal(TASK_WORKER_SESSION_ACCEPTANCE_FORMAT_V1),
  version: Schema.Literal(TASK_WORKER_SESSION_ACCEPTANCE_VERSION_V1),
  kind: Schema.Literal("accepted"),
  generation: Generation,
  identity: Identity,
  executionId: ExecutionId,
  cancellationGeneration: NonNegativeBigInt,
});
const InterruptionRequest = Schema.Struct({
  format: Schema.Literal(TASK_WORKER_SESSION_INTERRUPTION_FORMAT_V1),
  version: Schema.Literal(TASK_WORKER_SESSION_INTERRUPTION_VERSION_V1),
  generation: Generation,
  identity: Identity,
  executionId: ExecutionId,
  cancellationGeneration: PositiveBigInt,
});
const InterruptionAcceptance = Schema.Struct({
  format: Schema.Literal(TASK_WORKER_SESSION_INTERRUPTION_FORMAT_V1),
  version: Schema.Literal(TASK_WORKER_SESSION_INTERRUPTION_VERSION_V1),
  kind: Schema.Literal("interruption_requested"),
  generation: Generation,
  identity: Identity,
  executionId: ExecutionId,
  cancellationGeneration: PositiveBigInt,
});
const Settlement = Schema.Struct({
  format: Schema.Literal(TASK_WORKER_SESSION_SETTLEMENT_FORMAT_V1),
  version: Schema.Literal(TASK_WORKER_SESSION_SETTLEMENT_VERSION_V1),
  kind: Schema.Literal("settled"),
  generation: Generation,
  identity: Identity,
  executionId: ExecutionId,
});
const STRICT = { onExcessProperty: "error" } as const;
const decodeAcceptanceShape = Schema.decodeUnknownResult(Schema.toType(Acceptance), STRICT);
const decodeInterruptionRequestShape = Schema.decodeUnknownResult(
  Schema.toType(InterruptionRequest), STRICT,
);
const decodeInterruptionAcceptanceShape = Schema.decodeUnknownResult(
  Schema.toType(InterruptionAcceptance), STRICT,
);
const decodeSettlementShape = Schema.decodeUnknownResult(Schema.toType(Settlement), STRICT);

export function decodeTaskWorkerSessionStartRequestV1(
  input: unknown,
): Result.Result<TaskWorkerSessionStartRequestV1, TaskWorkerSessionContractV1Error> {
  const record = captureExactRecord(input, [
    "format", "version", "generation", "executionId", "request",
  ]);
  if (record === undefined || record.format !== TASK_WORKER_SESSION_START_FORMAT_V1 ||
    record.version !== TASK_WORKER_SESSION_START_VERSION_V1 ||
    typeof record.executionId !== "string" || !EXECUTION_ID.test(record.executionId)) {
    return Result.fail(failure("start", "invalid_shape"));
  }
  if (record.generation === "legacy_dynamic_worker_v1") {
    return decodeLegacyTaskWorkerRequestV1(record.request).pipe(
      Result.mapError(cause => failure("start", "invalid_shape", "request", cause)),
      Result.map(request => Object.freeze({
        format: TASK_WORKER_SESSION_START_FORMAT_V1,
        version: TASK_WORKER_SESSION_START_VERSION_V1,
        generation: "legacy_dynamic_worker_v1" as const,
        executionId: record.executionId as string,
        request,
      })),
    );
  }
  if (record.generation === "application_v1") {
    return decodeApplicationTaskWorkerRequestV1(record.request).pipe(
      Result.mapError(cause => failure("start", "invalid_shape", "request", cause)),
      Result.map(request => Object.freeze({
        format: TASK_WORKER_SESSION_START_FORMAT_V1,
        version: TASK_WORKER_SESSION_START_VERSION_V1,
        generation: "application_v1" as const,
        executionId: record.executionId as string,
        request,
      })),
    );
  }
  return Result.fail(failure("start", "invalid_shape", "generation"));
}

export function decodeTaskWorkerSessionAcceptanceV1(input: unknown) {
  const captured = captureSessionEnvelope(input);
  if (captured === undefined) {
    return Result.fail(failure("acceptance", "invalid_shape"));
  }
  return decodeAcceptanceShape(captured).pipe(
    Result.mapError(cause => failure("acceptance", "invalid_shape", undefined, cause)),
    Result.map(value => Object.freeze({
      ...value,
      identity: Object.freeze({ ...value.identity }),
    })),
  );
}

export function decodeTaskWorkerSessionInterruptionRequestV1(input: unknown) {
  const captured = captureSessionEnvelope(input);
  if (captured === undefined) {
    return Result.fail(failure("interruption", "invalid_shape"));
  }
  return decodeInterruptionRequestShape(captured).pipe(
    Result.mapError(cause => failure("interruption", "invalid_shape", undefined, cause)),
    Result.map(value => Object.freeze({
      ...value,
      identity: Object.freeze({ ...value.identity }),
    })),
  );
}

export function decodeTaskWorkerSessionInterruptionAcceptanceV1(input: unknown) {
  const captured = captureSessionEnvelope(input);
  if (captured === undefined) {
    return Result.fail(failure("interruption", "invalid_shape"));
  }
  return decodeInterruptionAcceptanceShape(captured).pipe(
    Result.mapError(cause => failure("interruption", "invalid_shape", undefined, cause)),
    Result.map(value => Object.freeze({
      ...value,
      identity: Object.freeze({ ...value.identity }),
    })),
  );
}

export function decodeTaskWorkerSessionSettlementV1(input: unknown) {
  const captured = captureSessionEnvelope(input);
  if (captured === undefined) {
    return Result.fail(failure("settlement", "invalid_shape"));
  }
  return decodeSettlementShape(captured).pipe(
    Result.mapError(cause => failure("settlement", "invalid_shape", undefined, cause)),
    Result.map(value => Object.freeze({
      ...value,
      identity: Object.freeze({ ...value.identity }),
    })),
  );
}

export function taskWorkerSessionIdentitiesEqualV1(
  left: ApplicationTaskWorkerDispatchIdentityV1,
  right: ApplicationTaskWorkerDispatchIdentityV1,
): boolean {
  return left.version === right.version && left.scopeId === right.scopeId &&
    left.runId === right.runId &&
    left.requestedEffectSequence === right.requestedEffectSequence &&
    left.attemptId === right.attemptId && left.executionFence === right.executionFence;
}

function captureUnknownRecord(input: unknown): Readonly<Record<string, unknown>> | undefined {
  try {
    if (!isNonArrayRecord(input)) return undefined;
    const captured: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(input)) {
      if (typeof key !== "string") return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
        return undefined;
      }
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

function captureSessionEnvelope(
  input: unknown,
): Readonly<Record<string, unknown>> | undefined {
  const envelope = captureUnknownRecord(input);
  if (envelope === undefined) return undefined;
  const identity = captureExactRecord(envelope.identity, [
    "version",
    "scopeId",
    "runId",
    "requestedEffectSequence",
    "attemptId",
    "executionFence",
  ]);
  if (identity === undefined) return undefined;
  return Object.freeze({ ...envelope, identity });
}

function captureExactRecord(input: unknown, keys: readonly string[]) {
  const record = captureUnknownRecord(input);
  if (record === undefined) return undefined;
  const observed = Reflect.ownKeys(record);
  return observed.length === keys.length && observed.every(key =>
      typeof key === "string" && keys.includes(key)
    )
    ? record
    : undefined;
}

function failure(
  boundary: TaskWorkerSessionContractV1Error["boundary"],
  reason: TaskWorkerSessionContractV1Error["reason"],
  path?: string,
  cause?: unknown,
): TaskWorkerSessionContractV1Error {
  return new TaskWorkerSessionContractV1Error({
    boundary,
    reason,
    ...(path === undefined ? {} : { path }),
    ...(cause === undefined ? {} : { cause }),
  });
}
