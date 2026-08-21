import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Result, Schema } from "effect";

import {
  decodeApplicationTaskWorkerResultV1,
  decodeApplicationTaskWorkerRequestV1,
  type ApplicationTaskWorkerDispatchIdentityV1,
  type ApplicationTaskWorkerRequestV1,
  type ApplicationTaskWorkerResultV1,
} from "./application-task-worker-v1";
import {
  decodeLegacyTaskWorkerResultV1,
  decodeLegacyTaskWorkerRequestV1,
  type LegacyTaskWorkerRequestV1,
  type LegacyTaskWorkerResultV1,
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

export type TaskWorkerSessionInterruptionReasonV1 =
  | "cancellation_requested"
  | "maximum_duration"
  | "host_shutdown";

export type TaskWorkerSessionFailureCodeV1 =
  | "input_validation_failed"
  | "output_validation_failed"
  | "handler_failed"
  | "runtime_input_unavailable"
  | "configuration_invalid"
  | "internal_invariant";

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
  readonly reason: TaskWorkerSessionInterruptionReasonV1;
}

export interface TaskWorkerSessionInterruptionAcceptanceV1 {
  readonly format: typeof TASK_WORKER_SESSION_INTERRUPTION_FORMAT_V1;
  readonly version: typeof TASK_WORKER_SESSION_INTERRUPTION_VERSION_V1;
  readonly kind: "interruption_requested";
  readonly generation: TaskWorkerSessionGenerationV1;
  readonly identity: ApplicationTaskWorkerDispatchIdentityV1;
  readonly executionId: string;
  readonly cancellationGeneration: bigint;
  readonly reason: TaskWorkerSessionInterruptionReasonV1;
}

interface TaskWorkerSessionSettlementBaseV1 {
  readonly format: typeof TASK_WORKER_SESSION_SETTLEMENT_FORMAT_V1;
  readonly version: typeof TASK_WORKER_SESSION_SETTLEMENT_VERSION_V1;
  readonly kind: "settled";
  readonly identity: ApplicationTaskWorkerDispatchIdentityV1;
  readonly executionId: string;
}

export type TaskWorkerSessionSettlementOutcomeV1 =
  | Readonly<{
      readonly kind: "completed";
      readonly result: ApplicationTaskWorkerResultV1 | LegacyTaskWorkerResultV1;
    }>
  | Readonly<{
      readonly kind: "failed";
      readonly failure: Readonly<{
        readonly code: TaskWorkerSessionFailureCodeV1;
        readonly message: null;
      }>;
    }>
  | Readonly<{
      readonly kind: "interrupted";
      readonly interruption: Readonly<{
        readonly cancellationGeneration: bigint;
        readonly reason: TaskWorkerSessionInterruptionReasonV1;
      }>;
    }>;

export type TaskWorkerSessionSettlementV1 =
  | TaskWorkerSessionSettlementBaseV1 & Readonly<{
      readonly generation: "application_v1";
      readonly outcome:
        | Extract<TaskWorkerSessionSettlementOutcomeV1, { readonly kind: "failed" | "interrupted" }>
        | Readonly<{
            readonly kind: "completed";
            readonly result: ApplicationTaskWorkerResultV1;
          }>;
    }>
  | TaskWorkerSessionSettlementBaseV1 & Readonly<{
      readonly generation: "legacy_dynamic_worker_v1";
      readonly outcome:
        | Extract<TaskWorkerSessionSettlementOutcomeV1, { readonly kind: "failed" | "interrupted" }>
        | Readonly<{
            readonly kind: "completed";
            readonly result: LegacyTaskWorkerResultV1;
          }>;
    }>;

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
const InterruptionReason = Schema.Literals([
  "cancellation_requested",
  "maximum_duration",
  "host_shutdown",
]);
const FailureCode = Schema.Literals([
  "input_validation_failed",
  "output_validation_failed",
  "handler_failed",
  "runtime_input_unavailable",
  "configuration_invalid",
  "internal_invariant",
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
  reason: InterruptionReason,
});
const InterruptionAcceptance = Schema.Struct({
  format: Schema.Literal(TASK_WORKER_SESSION_INTERRUPTION_FORMAT_V1),
  version: Schema.Literal(TASK_WORKER_SESSION_INTERRUPTION_VERSION_V1),
  kind: Schema.Literal("interruption_requested"),
  generation: Generation,
  identity: Identity,
  executionId: ExecutionId,
  cancellationGeneration: PositiveBigInt,
  reason: InterruptionReason,
});
const SettlementBase = Schema.Struct({
  format: Schema.Literal(TASK_WORKER_SESSION_SETTLEMENT_FORMAT_V1),
  version: Schema.Literal(TASK_WORKER_SESSION_SETTLEMENT_VERSION_V1),
  kind: Schema.Literal("settled"),
  generation: Generation,
  identity: Identity,
  executionId: ExecutionId,
  outcome: Schema.Unknown,
});
const FailedOutcome = Schema.Struct({
  kind: Schema.Literal("failed"),
  failure: Schema.Struct({
    code: FailureCode,
    message: Schema.Null,
  }),
});
const InterruptedOutcome = Schema.Struct({
  kind: Schema.Literal("interrupted"),
  interruption: Schema.Struct({
    cancellationGeneration: PositiveBigInt,
    reason: InterruptionReason,
  }),
});
const STRICT = { onExcessProperty: "error" } as const;
const decodeAcceptanceShape = Schema.decodeUnknownResult(Schema.toType(Acceptance), STRICT);
const decodeInterruptionRequestShape = Schema.decodeUnknownResult(
  Schema.toType(InterruptionRequest), STRICT,
);
const decodeInterruptionAcceptanceShape = Schema.decodeUnknownResult(
  Schema.toType(InterruptionAcceptance), STRICT,
);
const decodeSettlementBaseShape = Schema.decodeUnknownResult(
  Schema.toType(SettlementBase), STRICT,
);
const decodeFailedOutcomeShape = Schema.decodeUnknownResult(
  Schema.toType(FailedOutcome), STRICT,
);
const decodeInterruptedOutcomeShape = Schema.decodeUnknownResult(
  Schema.toType(InterruptedOutcome), STRICT,
);

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
        // SAFETY: the guard above validated executionId as a string
        // matching the execution-id grammar.
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
        // SAFETY: the guard above validated executionId as a string
        // matching the execution-id grammar.
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

export function decodeTaskWorkerSessionSettlementV1(
  input: unknown,
): Result.Result<TaskWorkerSessionSettlementV1, TaskWorkerSessionContractV1Error> {
  const captured = captureSessionEnvelope(input);
  if (captured === undefined) {
    return Result.fail(failure("settlement", "invalid_shape"));
  }
  return Result.gen(function* () {
    const settlement = yield* decodeSettlementBaseShape(captured).pipe(
      Result.mapError(cause => failure(
        "settlement", "invalid_shape", undefined, cause,
      )),
    );
    const identity = Object.freeze({ ...settlement.identity });
    const outcomeRecord = captureUnknownRecord(settlement.outcome);
    const outcomeKind = outcomeRecord?.kind;
    if (outcomeKind === "completed") {
      const completed = captureExactRecord(outcomeRecord, ["kind", "result"]);
      if (completed === undefined) {
        return yield* Result.fail(failure(
          "settlement", "invalid_shape", "outcome",
        ));
      }
      if (settlement.generation === "application_v1") {
        const result = yield* decodeApplicationTaskWorkerResultV1(completed.result).pipe(
          Result.mapError(cause => failure(
            "settlement", "invalid_shape", "outcome.result", cause,
          )),
        );
        if (!taskWorkerSessionIdentitiesEqualV1(result.identity, identity)) {
          return yield* Result.fail(failure(
            "settlement", "identity_mismatch", "outcome.result.identity",
          ));
        }
        return Object.freeze({
          ...settlement,
          generation: "application_v1" as const,
          identity,
          outcome: Object.freeze({ kind: "completed" as const, result }),
        });
      }
      const result = yield* decodeLegacyTaskWorkerResultV1(completed.result).pipe(
        Result.mapError(cause => failure(
          "settlement", "invalid_shape", "outcome.result", cause,
        )),
      );
      if (!taskWorkerSessionIdentitiesEqualV1(result.identity, identity)) {
        return yield* Result.fail(failure(
          "settlement", "identity_mismatch", "outcome.result.identity",
        ));
      }
      return Object.freeze({
        ...settlement,
        generation: "legacy_dynamic_worker_v1" as const,
        identity,
        outcome: Object.freeze({ kind: "completed" as const, result }),
      });
    }
    if (outcomeKind === "failed") {
      const failed = captureExactRecord(outcomeRecord, ["kind", "failure"]);
      const capturedFailure = captureExactRecord(failed?.failure, ["code", "message"]);
      if (failed === undefined || capturedFailure === undefined) {
        return yield* Result.fail(failure(
          "settlement", "invalid_shape", "outcome.failure",
        ));
      }
      const outcome = yield* decodeFailedOutcomeShape(Object.freeze({
        ...failed,
        failure: capturedFailure,
      })).pipe(
        Result.mapError(cause => failure(
          "settlement", "invalid_shape", "outcome", cause,
        )),
      );
      const owned = Object.freeze({
        ...settlement,
        identity,
        outcome: Object.freeze({
          kind: "failed" as const,
          failure: Object.freeze({ ...outcome.failure }),
        }),
      });
      return settlement.generation === "application_v1"
        ? Object.freeze({ ...owned, generation: "application_v1" as const })
        : Object.freeze({ ...owned, generation: "legacy_dynamic_worker_v1" as const });
    }
    if (outcomeKind === "interrupted") {
      const interrupted = captureExactRecord(outcomeRecord, ["kind", "interruption"]);
      const capturedInterruption = captureExactRecord(
        interrupted?.interruption,
        ["cancellationGeneration", "reason"],
      );
      if (interrupted === undefined || capturedInterruption === undefined) {
        return yield* Result.fail(failure(
          "settlement", "invalid_shape", "outcome.interruption",
        ));
      }
      const outcome = yield* decodeInterruptedOutcomeShape(Object.freeze({
        ...interrupted,
        interruption: capturedInterruption,
      })).pipe(
        Result.mapError(cause => failure(
          "settlement", "invalid_shape", "outcome", cause,
        )),
      );
      const owned = Object.freeze({
        ...settlement,
        identity,
        outcome: Object.freeze({
          kind: "interrupted" as const,
          interruption: Object.freeze({ ...outcome.interruption }),
        }),
      });
      return settlement.generation === "application_v1"
        ? Object.freeze({ ...owned, generation: "application_v1" as const })
        : Object.freeze({ ...owned, generation: "legacy_dynamic_worker_v1" as const });
    }
    return yield* Result.fail(failure(
      "settlement", "invalid_shape", "outcome.kind",
    ));
  });
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
