import { Result, Schema } from "effect";

import {
  MAX_TASK_RESULT_CANONICAL_BYTES_V1,
  TASK_RESULT_CODEC_V1,
} from "../runAttempt/Model.js";
import {
  TaskAttemptNumberV1Schema,
  TaskComputeProfileRefV1Schema,
  TaskDatabaseTimeMsV1Schema,
  TaskExecutionDurationMsV1Schema,
  TaskRunIdV1Schema,
  TaskRunVersionV1Schema,
} from "../runAttempt/Schema.js";

const STRICT_PARSE_OPTIONS = { onExcessProperty: "error" } as const;
const STRICT_STRUCT_OPTIONS = {
  parseOptions: STRICT_PARSE_OPTIONS,
} as const;

const NotCancelledSchema = Schema.Struct({
  kind: Schema.Literal("not_requested"),
}).annotate(STRICT_STRUCT_OPTIONS);

const RequestedCancellationSchema = Schema.Struct({
  kind: Schema.Literal("requested"),
  code: Schema.Literals([
    "requested",
    "execution_cancelled",
    "policy_cancelled",
  ]),
  requestedAtMs: TaskDatabaseTimeMsV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);

function resolvedCancellationSchema<
  Resolution extends
    | "without_active_attempt"
    | "acknowledged"
    | "lease_expired"
    | "superseded_by_completion",
>(resolution: Resolution) {
  return Schema.Struct({
    kind: Schema.Literal("resolved"),
    code: Schema.Literals([
      "requested",
      "execution_cancelled",
      "policy_cancelled",
    ]),
    requestedAtMs: TaskDatabaseTimeMsV1Schema,
    resolvedAtMs: TaskDatabaseTimeMsV1Schema,
    resolution: Schema.Literal(resolution),
  }).annotate(STRICT_STRUCT_OPTIONS);
}

const AttemptSchema = Schema.Struct({
  attemptNumber: TaskAttemptNumberV1Schema,
  computeProfile: TaskComputeProfileRefV1Schema,
  grantedAtMs: TaskDatabaseTimeMsV1Schema,
  leaseExpiresAtMs: TaskDatabaseTimeMsV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);

const FailureSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("task_failure"),
    code: Schema.Literals([
      "uncaught_exception",
      "input_validation_failed",
      "output_validation_failed",
      "middleware_failed",
      "handler_failed",
    ]),
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    kind: Schema.Literal("system_failure"),
    code: Schema.Literals([
      "attempt_dispatch_failed",
      "runtime_start_failed",
      "execution_lost",
      "execution_aborted",
      "provider_evicted",
      "provider_failure",
      "task_binding_unavailable",
      "configuration_invalid",
      "internal_invariant",
    ]),
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    kind: Schema.Literal("resource_exhaustion"),
    code: Schema.Literals([
      "out_of_memory",
      "possible_out_of_memory",
      "process_crashed",
      "disk_exhausted",
    ]),
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    kind: Schema.Literal("timed_out"),
    code: Schema.Literal("maximum_duration_exceeded"),
  }).annotate(STRICT_STRUCT_OPTIONS),
]);

const RetrySchema = Schema.Struct({
  previousAttemptNumber: TaskAttemptNumberV1Schema,
  acceptedAtMs: TaskDatabaseTimeMsV1Schema,
  eligibleAtMs: TaskDatabaseTimeMsV1Schema,
  nextComputeProfile: TaskComputeProfileRefV1Schema,
  cause: Schema.Struct({
    kind: Schema.Literals([
      "failed_completion",
      "lease_expired_before_heartbeat",
      "lease_expired_after_heartbeat",
    ]),
    failure: FailureSchema,
  }).annotate(STRICT_STRUCT_OPTIONS),
}).annotate(STRICT_STRUCT_OPTIONS);

const ResultMetadataSchema = Schema.Struct({
  codec: Schema.Literal(TASK_RESULT_CODEC_V1),
  byteLength: Schema.Number.check(
    Schema.makeFilter(value =>
      Number.isSafeInteger(value) && value >= 1 &&
          value <= MAX_TASK_RESULT_CANONICAL_BYTES_V1
        ? undefined
        : "Expected a bounded Task result byte length"
    ),
  ),
  sha256Hex: Schema.String.check(
    Schema.isPattern(/^[0-9a-f]{64}$/),
  ),
}).annotate(STRICT_STRUCT_OPTIONS);

const CompletionCancellationSchema = Schema.Union([
  NotCancelledSchema,
  resolvedCancellationSchema("superseded_by_completion"),
]);

const TaskRunListStateSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("ready"),
    eligibleAtMs: TaskDatabaseTimeMsV1Schema,
    retry: Schema.NullOr(RetrySchema),
    cancellation: NotCancelledSchema,
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    kind: Schema.Literal("attempt_granted"),
    attempt: AttemptSchema,
    cancellation: Schema.Union([
      NotCancelledSchema,
      RequestedCancellationSchema,
    ]),
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    kind: Schema.Literal("executing"),
    attempt: AttemptSchema,
    cancellation: Schema.Union([
      NotCancelledSchema,
      RequestedCancellationSchema,
    ]),
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    kind: Schema.Literal("retry_waiting"),
    retry: RetrySchema,
    cancellation: NotCancelledSchema,
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    kind: Schema.Literal("succeeded"),
    completedAtMs: TaskDatabaseTimeMsV1Schema,
    attemptNumber: TaskAttemptNumberV1Schema,
    executionDurationMs: Schema.NullOr(TaskExecutionDurationMsV1Schema),
    result: Schema.NullOr(ResultMetadataSchema),
    cancellation: CompletionCancellationSchema,
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    kind: Schema.Literal("failed"),
    completedAtMs: TaskDatabaseTimeMsV1Schema,
    attemptNumber: Schema.NullOr(TaskAttemptNumberV1Schema),
    executionDurationMs: Schema.NullOr(TaskExecutionDurationMsV1Schema),
    failure: FailureSchema,
    cancellation: CompletionCancellationSchema,
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    kind: Schema.Literal("cancelled"),
    completedAtMs: TaskDatabaseTimeMsV1Schema,
    attemptNumber: Schema.Null,
    executionDurationMs: Schema.Null,
    cancellation: resolvedCancellationSchema("without_active_attempt"),
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    kind: Schema.Literal("cancelled"),
    completedAtMs: TaskDatabaseTimeMsV1Schema,
    attemptNumber: TaskAttemptNumberV1Schema,
    executionDurationMs: Schema.NullOr(TaskExecutionDurationMsV1Schema),
    cancellation: resolvedCancellationSchema("acknowledged"),
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    kind: Schema.Literal("cancelled"),
    completedAtMs: TaskDatabaseTimeMsV1Schema,
    attemptNumber: TaskAttemptNumberV1Schema,
    executionDurationMs: Schema.Null,
    cancellation: resolvedCancellationSchema("lease_expired"),
  }).annotate(STRICT_STRUCT_OPTIONS),
]);

export const TaskRunListStoreItemSchema = Schema.Struct({
  runId: TaskRunIdV1Schema,
  createdAtMs: TaskDatabaseTimeMsV1Schema,
  runVersion: Schema.toType(TaskRunVersionV1Schema),
  state: TaskRunListStateSchema,
}).annotate(STRICT_STRUCT_OPTIONS);

/**
 * Bounded projection input for one list row. Unlike the lifecycle aggregate,
 * this shape contains no histories, messages, evidence, or result body.
 */
export type TaskRunListStoreItem = typeof TaskRunListStoreItemSchema.Type;

const decodeTaskRunListStoreItemSchema = Schema.decodeUnknownResult(
  TaskRunListStoreItemSchema,
  STRICT_PARSE_OPTIONS,
);

export function decodeTaskRunListStoreItem(
  input: unknown,
): Result.Result<TaskRunListStoreItem, Schema.SchemaError> {
  return decodeTaskRunListStoreItemSchema(input);
}

export type TaskRunListStoreItemSemanticIssue =
  | "event_precedes_creation"
  | "event_after_observation"
  | "time_order_invalid"
  | "state_correlation_invalid";

/** Validates the projection-relevant timeline omitted from structural Schema. */
export function validateTaskRunListStoreItemSemantics(
  observedAtMs: typeof TaskDatabaseTimeMsV1Schema.Type,
  item: TaskRunListStoreItem,
): Result.Result<TaskRunListStoreItem, TaskRunListStoreItemSemanticIssue> {
  if (item.createdAtMs > observedAtMs) {
    return Result.fail("event_after_observation");
  }
  const { state } = item;
  switch (state.kind) {
    case "ready": {
      if (state.eligibleAtMs < item.createdAtMs) {
        return Result.fail("time_order_invalid");
      }
      if (state.retry === null) return Result.succeed(item);
      const issue = validateRetry(
        item.createdAtMs,
        observedAtMs,
        state.retry,
      );
      if (issue !== undefined) return Result.fail(issue);
      return state.eligibleAtMs === state.retry.eligibleAtMs
        ? Result.succeed(item)
        : Result.fail("state_correlation_invalid");
    }
    case "attempt_granted":
    case "executing": {
      const grantIssue = validateObservedEvent(
        item.createdAtMs,
        observedAtMs,
        state.attempt.grantedAtMs,
      );
      if (grantIssue !== undefined) return Result.fail(grantIssue);
      if (state.attempt.leaseExpiresAtMs < state.attempt.grantedAtMs) {
        return Result.fail("time_order_invalid");
      }
      if (state.cancellation.kind === "not_requested") {
        return Result.succeed(item);
      }
      const cancellationIssue = validateObservedEvent(
        state.attempt.grantedAtMs,
        observedAtMs,
        state.cancellation.requestedAtMs,
      );
      return cancellationIssue === undefined
        ? Result.succeed(item)
        : Result.fail(cancellationIssue);
    }
    case "retry_waiting": {
      const issue = validateRetry(
        item.createdAtMs,
        observedAtMs,
        state.retry,
      );
      return issue === undefined
        ? Result.succeed(item)
        : Result.fail(issue);
    }
    case "succeeded":
    case "failed": {
      const completionIssue = validateObservedEvent(
        item.createdAtMs,
        observedAtMs,
        state.completedAtMs,
      );
      if (completionIssue !== undefined) return Result.fail(completionIssue);
      if (state.cancellation.kind === "not_requested") {
        return Result.succeed(item);
      }
      return validateTerminalCancellation(item, observedAtMs);
    }
    case "cancelled": {
      const completionIssue = validateObservedEvent(
        item.createdAtMs,
        observedAtMs,
        state.completedAtMs,
      );
      if (completionIssue !== undefined) return Result.fail(completionIssue);
      return validateTerminalCancellation(item, observedAtMs);
    }
  }
}

function validateRetry(
  createdAtMs: TaskRunListStoreItem["createdAtMs"],
  observedAtMs: TaskRunListStoreItem["createdAtMs"],
  retry: Extract<
    TaskRunListStoreItem["state"],
    { readonly kind: "retry_waiting" }
  >["retry"],
): TaskRunListStoreItemSemanticIssue | undefined {
  const acceptanceIssue = validateObservedEvent(
    createdAtMs,
    observedAtMs,
    retry.acceptedAtMs,
  );
  if (acceptanceIssue !== undefined) return acceptanceIssue;
  return retry.eligibleAtMs < retry.acceptedAtMs
    ? "time_order_invalid"
    : undefined;
}

function validateTerminalCancellation(
  item: TaskRunListStoreItem,
  observedAtMs: TaskRunListStoreItem["createdAtMs"],
): Result.Result<TaskRunListStoreItem, TaskRunListStoreItemSemanticIssue> {
  const state = item.state;
  if (
    state.kind !== "succeeded" &&
    state.kind !== "failed" &&
    state.kind !== "cancelled"
  ) {
    return Result.fail("state_correlation_invalid");
  }
  const cancellation = state.cancellation;
  if (cancellation.kind !== "resolved") {
    return Result.fail("state_correlation_invalid");
  }
  const requestIssue = validateObservedEvent(
    item.createdAtMs,
    observedAtMs,
    cancellation.requestedAtMs,
  );
  if (requestIssue !== undefined) return Result.fail(requestIssue);
  if (cancellation.resolvedAtMs < cancellation.requestedAtMs) {
    return Result.fail("time_order_invalid");
  }
  return cancellation.resolvedAtMs === state.completedAtMs
    ? Result.succeed(item)
    : Result.fail("state_correlation_invalid");
}

function validateObservedEvent(
  earliestAtMs: TaskRunListStoreItem["createdAtMs"],
  observedAtMs: TaskRunListStoreItem["createdAtMs"],
  eventAtMs: TaskRunListStoreItem["createdAtMs"],
): TaskRunListStoreItemSemanticIssue | undefined {
  if (eventAtMs < earliestAtMs) return "event_precedes_creation";
  return eventAtMs > observedAtMs ? "event_after_observation" : undefined;
}
