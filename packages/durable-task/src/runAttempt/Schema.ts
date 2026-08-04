// Adapted from Trigger.dev commit f10bc23785e569e5d917318cf2033aabdbe96a0b,
// upstream/packages/core/src/v3/schemas/schemas.ts. See trigger-source-map.json and THIRD_PARTY_NOTICES.md.
import { Result, Schema, SchemaTransformation } from "effect";
import { InvalidRunAttemptCommandError } from "./Errors.js";
import { decideFailurePolicyV1 } from "./Policy.js";
import type {
  CompleteAttemptCommandV1,
  HandleLeaseExpiryCommandV1,
  HeartbeatAttemptCommandV1,
  InspectCurrentAttemptCommandV1,
  RequestCancellationCommandV1,
  RunAttemptCommandV1,
  RunAttemptInspectionV1,
  RunAttemptOperationV1,
  RunAttemptStateV1,
  StartAttemptCommandV1,
  TaskAttemptCompletionV1,
  TaskAttemptIdV1,
  TaskAttemptNumberV1,
  TaskCancellationGenerationV1,
  TaskCancellationReasonV1,
  TaskComputeProfileRefV1,
  TaskDatabaseTimeMsV1,
  TaskDefinitionRevisionIdV1,
  TaskDurationMsV1,
  TaskExecutionDurationMsV1,
  TaskExecutionFailureV1,
  TaskExecutionFenceV1,
  TaskFailureMessageV1,
  TaskHeartbeatSequenceV1,
  TaskLeaseVersionV1,
  TaskRequestedEffectSequenceV1,
  TaskResultCommitmentV1,
  TaskRetryDirectiveV1,
  TaskRetryJitterV1,
  TaskRunIdV1,
  TaskRunAttemptAggregateV1,
  TaskRunAttemptEvidenceV1,
  TaskRunVersionV1,
} from "./Model.js";
import { snapshotTaskRunAttemptAggregateV1 } from "./Model.js";

const STRICT_STRUCT_OPTIONS = {
  parseOptions: { onExcessProperty: "error" },
} as const;
const STRICT_PARSE_OPTIONS = { onExcessProperty: "error" } as const;
const POSTGRES_SIGNED_BIGINT_MAX = 9_223_372_036_854_775_807n;

function persistedValueEqualV1(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left instanceof Uint8Array && right instanceof Uint8Array) {
    if (left.byteLength !== right.byteLength) return false;
    for (let index = 0; index < left.byteLength; index += 1) {
      if (left[index] !== right[index]) return false;
    }
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => persistedValueEqualV1(value, right[index]));
  }
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) =>
    Object.hasOwn(right, key) && persistedValueEqualV1(
      Object.getOwnPropertyDescriptor(left, key)?.value,
      Object.getOwnPropertyDescriptor(right, key)?.value,
    ));
}

function terminalAttemptRefEqualV1(
  left: { readonly attemptId: string; readonly attemptNumber: number; readonly executionFence: bigint },
  right: { readonly attemptId: string; readonly attemptNumber: number; readonly executionFence: bigint },
): boolean {
  return left.attemptId === right.attemptId && left.attemptNumber === right.attemptNumber &&
    left.executionFence === right.executionFence;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const first = value.charCodeAt(index);
    if (first <= 0x7f) {
      bytes += 1;
    } else if (first <= 0x7ff) {
      bytes += 2;
    } else if (first >= 0xd800 && first <= 0xdbff) {
      const second = value.charCodeAt(index + 1);
      if (second >= 0xdc00 && second <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

const CanonicalUnsignedDecimalStringSchema = Schema.String.check(
  Schema.isPattern(/^(?:0|[1-9][0-9]*)$/),
);
const PositivePostgresBigIntSchema = Schema.BigInt.check(
  Schema.makeFilter((value) => value >= 1n && value <= POSTGRES_SIGNED_BIGINT_MAX
    ? undefined
    : "Expected a positive signed-64-bit integer"),
);
const NonNegativePostgresBigIntSchema = Schema.BigInt.check(
  Schema.makeFilter((value) => value >= 0n && value <= POSTGRES_SIGNED_BIGINT_MAX
    ? undefined
    : "Expected a nonnegative signed-64-bit integer"),
);
const CanonicalPositivePostgresBigIntFromString = CanonicalUnsignedDecimalStringSchema.pipe(
  Schema.decodeTo(PositivePostgresBigIntSchema, SchemaTransformation.bigintFromString),
);
const CanonicalNonNegativePostgresBigIntFromString = CanonicalUnsignedDecimalStringSchema.pipe(
  Schema.decodeTo(NonNegativePostgresBigIntSchema, SchemaTransformation.bigintFromString),
);

function positiveBigIntBrand<Name extends string>(name: Name) {
  return CanonicalPositivePostgresBigIntFromString.pipe(Schema.brand(name));
}
function nonNegativeBigIntBrand<Name extends string>(name: Name) {
  return CanonicalNonNegativePostgresBigIntFromString.pipe(Schema.brand(name));
}
function safeIntegerBrand<Name extends string>(name: Name, minimum: number) {
  return Schema.Number.check(
    Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= minimum
      ? undefined
      : `Expected a safe integer no less than ${minimum}`),
  ).pipe(Schema.brand(name));
}

export const TaskDefinitionRevisionIdV1Schema = Schema.String.check(
  Schema.isPattern(/^taskdef_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
).pipe(Schema.brand("FlarexDurableTask/TaskDefinitionRevisionIdV1"));
export const TaskRunIdV1Schema = Schema.String.check(
  Schema.isPattern(/^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
).pipe(Schema.brand("FlarexDurableTask/TaskRunIdV1"));
export const TaskAttemptIdV1Schema = Schema.String.check(
  Schema.isPattern(/^attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
).pipe(Schema.brand("FlarexDurableTask/TaskAttemptIdV1"));

export const TaskAttemptNumberV1Schema = safeIntegerBrand(
  "FlarexDurableTask/TaskAttemptNumberV1",
  1,
);
export const TaskHeartbeatSequenceV1Schema = safeIntegerBrand(
  "FlarexDurableTask/TaskHeartbeatSequenceV1",
  1,
);
export const TaskDatabaseTimeMsV1Schema = safeIntegerBrand(
  "FlarexDurableTask/TaskDatabaseTimeMsV1",
  0,
);
export const TaskDurationMsV1Schema = safeIntegerBrand(
  "FlarexDurableTask/TaskDurationMsV1",
  0,
);
export const TaskExecutionDurationMsV1Schema = safeIntegerBrand(
  "FlarexDurableTask/TaskExecutionDurationMsV1",
  0,
);
export const TaskRetryJitterV1Schema = Schema.Number.check(
  Schema.makeFilter((value) => Number.isFinite(value) && value >= 0 && value < 1
    ? undefined
    : "Expected finite retry jitter in [0, 1)"),
).pipe(Schema.brand("FlarexDurableTask/TaskRetryJitterV1"));

export const TaskExecutionFenceV1Schema = positiveBigIntBrand(
  "FlarexDurableTask/TaskExecutionFenceV1",
);
export const TaskRunVersionV1Schema = positiveBigIntBrand(
  "FlarexDurableTask/TaskRunVersionV1",
);
export const TaskLeaseVersionV1Schema = positiveBigIntBrand(
  "FlarexDurableTask/TaskLeaseVersionV1",
);
export const TaskCancellationGenerationV1Schema = nonNegativeBigIntBrand(
  "FlarexDurableTask/TaskCancellationGenerationV1",
);
export const TaskRequestedEffectSequenceV1Schema = positiveBigIntBrand(
  "FlarexDurableTask/TaskRequestedEffectSequenceV1",
);
export const TaskComputeProfileRefV1Schema = Schema.String.check(
  Schema.makeFilter((value) => value.length > 0 && utf8ByteLength(value) <= 255
    ? undefined
    : "Expected a nonempty compute-profile reference no greater than 255 UTF-8 bytes"),
).pipe(Schema.brand("FlarexDurableTask/TaskComputeProfileRefV1"));
export const TaskMaximumAttemptsV1Schema = Schema.Number.check(
  Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= 1 && value <= 250
    ? undefined
    : "Expected an attempt ceiling from 1 through 250"),
).pipe(Schema.brand("FlarexDurableTask/TaskMaximumAttemptsV1"));
export const TaskRetryFactorV1Schema = Schema.Number.check(
  Schema.makeFilter((value) => Number.isFinite(value) && value >= 1
    ? undefined
    : "Expected a finite retry factor no less than one"),
).pipe(Schema.brand("FlarexDurableTask/TaskRetryFactorV1"));

const SafeMessageSchema = Schema.String.check(
  Schema.makeFilter((value) => {
    if (value.length === 0 || utf8ByteLength(value) > 1_024) {
      return "Expected a nonempty message no greater than 1024 UTF-8 bytes";
    }
    return /[\u0000-\u001f\u007f-\u009f]/u.test(value)
      ? "Expected a message without control characters"
      : undefined;
  }),
);
export const TaskFailureMessageV1Schema = SafeMessageSchema.pipe(
  Schema.brand("FlarexDurableTask/TaskFailureMessageV1"),
);
export const TaskCancellationMessageV1Schema = SafeMessageSchema.pipe(
  Schema.brand("FlarexDurableTask/TaskCancellationMessageV1"),
);

export const TaskCancellationReasonV1Schema = Schema.Struct({
  code: Schema.Literals(["requested", "execution_cancelled", "policy_cancelled"]),
  message: Schema.NullOr(TaskCancellationMessageV1Schema),
}).annotate(STRICT_STRUCT_OPTIONS);

const Sha256Schema = Schema.Uint8Array.check(
  Schema.makeFilter((value) => value.byteLength === 32
    ? undefined
    : "Expected a 32-byte SHA-256 digest"),
);
const TaskResultCommitmentShapeV1Schema = Schema.Struct({
  codec: Schema.Literal("flarex.task-result.v1"),
  byteLength: Schema.Number.check(
    Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= 0
      ? undefined
      : "Expected a nonnegative safe integer byte length"),
  ),
  sha256: Sha256Schema,
}).annotate(STRICT_STRUCT_OPTIONS);
export const TaskResultCommitmentV1Schema = TaskResultCommitmentShapeV1Schema.pipe(
  Schema.decodeTo(
    TaskResultCommitmentShapeV1Schema,
    SchemaTransformation.transform({
      decode: (commitment): TaskResultCommitmentV1 => ({
        ...commitment,
        sha256: commitment.sha256.slice(),
      }),
      encode: (commitment) => commitment,
    }),
  ),
);

export const TaskRetryDirectiveV1Schema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("use_bound_policy") }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({ kind: Schema.Literal("do_not_retry") }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    kind: Schema.Literal("override_delay"),
    delayMs: TaskDurationMsV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
]);

const TaskFailureCodeSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("task_failure"),
    code: Schema.Literals(["uncaught_exception", "input_validation_failed", "output_validation_failed", "middleware_failed", "handler_failed"]),
    message: Schema.NullOr(TaskFailureMessageV1Schema),
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    kind: Schema.Literal("system_failure"),
    code: Schema.Literals(["attempt_dispatch_failed", "runtime_start_failed", "execution_lost", "execution_aborted", "provider_evicted", "provider_failure", "task_binding_unavailable", "configuration_invalid", "internal_invariant"]),
    message: Schema.NullOr(TaskFailureMessageV1Schema),
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    kind: Schema.Literal("resource_exhaustion"),
    code: Schema.Literals(["out_of_memory", "possible_out_of_memory", "process_crashed", "disk_exhausted"]),
    message: Schema.NullOr(TaskFailureMessageV1Schema),
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    kind: Schema.Literal("timed_out"),
    code: Schema.Literal("maximum_duration_exceeded"),
    message: Schema.NullOr(TaskFailureMessageV1Schema),
  }).annotate(STRICT_STRUCT_OPTIONS),
]);
export const TaskExecutionFailureV1Schema = TaskFailureCodeSchema;

const TaskSucceededCompletionV1Schema = Schema.Struct({
    kind: Schema.Literal("succeeded"),
    result: Schema.NullOr(TaskResultCommitmentV1Schema),
    executionDurationMs: Schema.NullOr(TaskExecutionDurationMsV1Schema),
  }).annotate(STRICT_STRUCT_OPTIONS);
const TaskFailedCompletionV1Schema = Schema.Struct({
    kind: Schema.Literal("failed"),
    failure: TaskExecutionFailureV1Schema,
    retry: TaskRetryDirectiveV1Schema,
    executionDurationMs: Schema.NullOr(TaskExecutionDurationMsV1Schema),
  }).annotate(STRICT_STRUCT_OPTIONS);
const TaskCancellationAcknowledgedCompletionV1Schema = Schema.Struct({
    kind: Schema.Literal("cancellation_acknowledged"),
    cancellationGeneration: TaskCancellationGenerationV1Schema,
    executionDurationMs: Schema.NullOr(TaskExecutionDurationMsV1Schema),
  }).annotate(STRICT_STRUCT_OPTIONS);
export const TaskAttemptCompletionV1Schema = Schema.Union([
  TaskSucceededCompletionV1Schema,
  TaskFailedCompletionV1Schema,
  TaskCancellationAcknowledgedCompletionV1Schema,
]);

export const RunAttemptPolicyV1Schema = Schema.Struct({
  version: Schema.Literal(1),
  retry: Schema.Struct({
    maxAttempts: TaskMaximumAttemptsV1Schema,
    factor: TaskRetryFactorV1Schema,
    minTimeoutInMs: TaskDurationMsV1Schema,
    maxTimeoutInMs: TaskDurationMsV1Schema,
    randomize: Schema.Boolean,
  }).annotate(STRICT_STRUCT_OPTIONS),
  outOfMemory: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("disabled") }).annotate(STRICT_STRUCT_OPTIONS),
    Schema.Struct({
      kind: Schema.Literal("escalate_once"),
      computeProfile: TaskComputeProfileRefV1Schema,
    }).annotate(STRICT_STRUCT_OPTIONS),
  ]),
}).annotate(STRICT_STRUCT_OPTIONS).check(
  Schema.makeFilter((policy) => policy.retry.minTimeoutInMs <= policy.retry.maxTimeoutInMs
    ? undefined
    : "Expected retry minimum timeout no greater than maximum timeout"),
);

export const TaskRunAttemptBoundPolicyV1Schema = Schema.Struct({
  runAttempt: RunAttemptPolicyV1Schema,
  maximumDurationMs: TaskDurationMsV1Schema,
  initialComputeProfile: TaskComputeProfileRefV1Schema,
  leaseDurationMs: TaskDurationMsV1Schema,
  immediateRetryThresholdMs: TaskDurationMsV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS).check(
  Schema.makeFilter((policy) => policy.maximumDurationMs > 0 && policy.leaseDurationMs > 0
    ? undefined
    : "Expected positive maximum and lease durations"),
);

export const TaskAttemptHistoryCursorV1Schema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("none") }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    kind: Schema.Literal("issued"),
    lastAttemptNumber: TaskAttemptNumberV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
]);
export const TaskLeaseHistoryCursorV1Schema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("none") }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    kind: Schema.Literal("issued"),
    lastLeaseVersion: TaskLeaseVersionV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
]);
export const TaskRequestedEffectCursorV1Schema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("none") }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    kind: Schema.Literal("issued"),
    lastSequence: TaskRequestedEffectSequenceV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
]);

const TaskCancellationNotRequestedV1Schema = Schema.Struct({
  kind: Schema.Literal("not_requested"),
  generation: TaskCancellationGenerationV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS).check(
  Schema.makeFilter((cancellation) => cancellation.generation === 0n
    ? undefined
    : "Expected not-requested cancellation generation zero"),
);
const TaskCancellationRequestedV1Schema = Schema.Struct({
  kind: Schema.Literal("requested"),
  generation: TaskCancellationGenerationV1Schema,
  reason: TaskCancellationReasonV1Schema,
  requestedAtMs: TaskDatabaseTimeMsV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS).check(
  Schema.makeFilter((cancellation) => cancellation.generation > 0n
    ? undefined
    : "Expected requested cancellation generation positive"),
);
const TaskCancellationResolvedBaseFieldsV1 = {
  kind: Schema.Literal("resolved"),
  generation: TaskCancellationGenerationV1Schema,
  reason: TaskCancellationReasonV1Schema,
  requestedAtMs: TaskDatabaseTimeMsV1Schema,
  resolvedAtMs: TaskDatabaseTimeMsV1Schema,
};
const TaskCancellationResolvedV1Schema = Schema.Struct({
  ...TaskCancellationResolvedBaseFieldsV1,
  resolution: Schema.Literals([
    "without_active_attempt", "acknowledged", "lease_expired", "superseded_by_completion",
  ]),
}).annotate(STRICT_STRUCT_OPTIONS).check(
  Schema.makeFilter((cancellation) => cancellation.generation > 0n &&
    cancellation.resolvedAtMs >= cancellation.requestedAtMs
    ? undefined
    : "Expected positive resolved cancellation generation and ordered timestamps"),
);
const TaskCancellationResolvedWithoutAttemptV1Schema = Schema.Struct({
  ...TaskCancellationResolvedBaseFieldsV1,
  resolution: Schema.Literal("without_active_attempt"),
}).annotate(STRICT_STRUCT_OPTIONS).check(
  Schema.makeFilter((cancellation) => cancellation.generation > 0n &&
    cancellation.resolvedAtMs >= cancellation.requestedAtMs
    ? undefined
    : "Expected positive resolved cancellation generation and ordered timestamps"),
);
const TaskCancellationResolvedAcknowledgedV1Schema = Schema.Struct({
  ...TaskCancellationResolvedBaseFieldsV1,
  resolution: Schema.Literal("acknowledged"),
}).annotate(STRICT_STRUCT_OPTIONS).check(
  Schema.makeFilter((cancellation) => cancellation.generation > 0n &&
    cancellation.resolvedAtMs >= cancellation.requestedAtMs
    ? undefined
    : "Expected positive resolved cancellation generation and ordered timestamps"),
);
const TaskCancellationResolvedLeaseExpiredV1Schema = Schema.Struct({
  ...TaskCancellationResolvedBaseFieldsV1,
  resolution: Schema.Literal("lease_expired"),
}).annotate(STRICT_STRUCT_OPTIONS).check(
  Schema.makeFilter((cancellation) => cancellation.generation > 0n &&
    cancellation.resolvedAtMs >= cancellation.requestedAtMs
    ? undefined
    : "Expected positive resolved cancellation generation and ordered timestamps"),
);
const TaskCancellationResolvedSupersededV1Schema = Schema.Struct({
  ...TaskCancellationResolvedBaseFieldsV1,
  resolution: Schema.Literal("superseded_by_completion"),
}).annotate(STRICT_STRUCT_OPTIONS).check(
  Schema.makeFilter((cancellation) => cancellation.generation > 0n &&
    cancellation.resolvedAtMs >= cancellation.requestedAtMs
    ? undefined
    : "Expected positive resolved cancellation generation and ordered timestamps"),
);
export const TaskCancellationStateV1Schema = Schema.Union([
  TaskCancellationNotRequestedV1Schema,
  TaskCancellationRequestedV1Schema,
  TaskCancellationResolvedV1Schema,
]);

export const TaskTerminalAttemptRefV1Schema = Schema.Struct({
  attemptId: TaskAttemptIdV1Schema,
  attemptNumber: TaskAttemptNumberV1Schema,
  executionFence: TaskExecutionFenceV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);
export const TaskAttemptLeaseV1Schema = Schema.Struct({
  version: TaskLeaseVersionV1Schema,
  renewedAtMs: TaskDatabaseTimeMsV1Schema,
  expiresAtMs: TaskDatabaseTimeMsV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS).check(
  Schema.makeFilter((lease) => lease.expiresAtMs > lease.renewedAtMs
    ? undefined
    : "Expected lease expiry later than renewal"),
);
export const TaskCurrentAttemptV1Schema = Schema.Struct({
  attemptId: TaskAttemptIdV1Schema,
  attemptNumber: TaskAttemptNumberV1Schema,
  executionFence: TaskExecutionFenceV1Schema,
  grantBasisRunVersion: TaskRunVersionV1Schema,
  computeProfile: TaskComputeProfileRefV1Schema,
  retryJitter: TaskRetryJitterV1Schema,
  grantedAtMs: TaskDatabaseTimeMsV1Schema,
  lease: TaskAttemptLeaseV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);
export const TaskAttemptHeartbeatStateV1Schema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("none_accepted") }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    kind: Schema.Literal("accepted"),
    highestSequence: TaskHeartbeatSequenceV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
]);

export const TaskRetryCauseV1Schema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("failed_completion"),
    failure: TaskExecutionFailureV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    kind: Schema.Literal("lease_expired_before_heartbeat"),
    failure: TaskExecutionFailureV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    kind: Schema.Literal("lease_expired_after_heartbeat"),
    failure: TaskExecutionFailureV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
]);
export const TaskAcceptedRetryV1Schema = Schema.Struct({
  previousAttempt: TaskTerminalAttemptRefV1Schema,
  acceptedAtMs: TaskDatabaseTimeMsV1Schema,
  notBeforeMs: TaskDatabaseTimeMsV1Schema,
  nextComputeProfile: TaskComputeProfileRefV1Schema,
  cause: TaskRetryCauseV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS).check(
  Schema.makeFilter((retry) => retry.notBeforeMs >= retry.acceptedAtMs
    ? undefined
    : "Expected retry eligibility no earlier than acceptance"),
);
export const TaskRunReadyStateV1Schema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("initial"),
    eligibleAtMs: TaskDatabaseTimeMsV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    kind: Schema.Literal("immediate_retry"),
    eligibleAtMs: TaskDatabaseTimeMsV1Schema,
    acceptedRetry: TaskAcceptedRetryV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS).check(
    Schema.makeFilter((ready) => ready.eligibleAtMs === ready.acceptedRetry.notBeforeMs
      ? undefined
      : "Expected immediate retry eligibility to match accepted retry"),
  ),
]);

const TaskRunSucceededTerminalV1Schema = Schema.Struct({
  kind: Schema.Literal("succeeded"),
  completedAtMs: TaskDatabaseTimeMsV1Schema,
  attempt: TaskTerminalAttemptRefV1Schema,
  result: Schema.NullOr(TaskResultCommitmentV1Schema),
  executionDurationMs: Schema.NullOr(TaskExecutionDurationMsV1Schema),
}).annotate(STRICT_STRUCT_OPTIONS);
const TaskRunCancelledTerminalBaseFieldsV1 = {
  kind: Schema.Literal("cancelled"),
  completedAtMs: TaskDatabaseTimeMsV1Schema,
  cancellationGeneration: TaskCancellationGenerationV1Schema,
  reason: TaskCancellationReasonV1Schema,
};
const TaskRunCancelledWithoutAttemptTerminalV1Schema = Schema.Struct({
  ...TaskRunCancelledTerminalBaseFieldsV1,
  attempt: Schema.Null,
  resolution: Schema.Literal("without_active_attempt"),
  executionDurationMs: Schema.Null,
}).annotate(STRICT_STRUCT_OPTIONS);
const TaskRunAcknowledgedCancellationTerminalV1Schema = Schema.Struct({
  ...TaskRunCancelledTerminalBaseFieldsV1,
  attempt: TaskTerminalAttemptRefV1Schema,
  resolution: Schema.Literal("acknowledged"),
  executionDurationMs: Schema.NullOr(TaskExecutionDurationMsV1Schema),
}).annotate(STRICT_STRUCT_OPTIONS);
const TaskRunLeaseExpiredCancellationTerminalV1Schema = Schema.Struct({
  ...TaskRunCancelledTerminalBaseFieldsV1,
  attempt: TaskTerminalAttemptRefV1Schema,
  resolution: Schema.Literal("lease_expired"),
  executionDurationMs: Schema.Null,
}).annotate(STRICT_STRUCT_OPTIONS);
const TaskRunCancelledTerminalV1Schema = Schema.Union([
  TaskRunCancelledWithoutAttemptTerminalV1Schema,
  TaskRunAcknowledgedCancellationTerminalV1Schema,
  TaskRunLeaseExpiredCancellationTerminalV1Schema,
]);
const TaskRunFailedTerminalBaseFieldsV1 = {
  kind: Schema.Literal("failed"),
  completedAtMs: TaskDatabaseTimeMsV1Schema,
  classification: Schema.Literals(["task_failure", "system_failure", "resource_exhaustion", "timed_out"]),
  failure: TaskExecutionFailureV1Schema,
  executionDurationMs: Schema.NullOr(TaskExecutionDurationMsV1Schema),
};
const TaskRunFailedTerminalV1Schema = Schema.Struct({
  ...TaskRunFailedTerminalBaseFieldsV1,
  attempt: Schema.NullOr(TaskTerminalAttemptRefV1Schema),
}).annotate(STRICT_STRUCT_OPTIONS).check(
  Schema.makeFilter((terminal) => terminal.classification === terminal.failure.kind
    ? undefined
    : "Expected terminal classification to match failure kind"),
);
const TaskRunAttemptFailedTerminalV1Schema = Schema.Struct({
  ...TaskRunFailedTerminalBaseFieldsV1,
  attempt: TaskTerminalAttemptRefV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS).check(
  Schema.makeFilter((terminal) => terminal.classification === terminal.failure.kind
    ? undefined
    : "Expected terminal classification to match failure kind"),
);
export const TaskRunTerminalOutcomeV1Schema = Schema.Union([
  TaskRunSucceededTerminalV1Schema,
  TaskRunCancelledTerminalV1Schema,
  TaskRunFailedTerminalV1Schema,
]);

const RunAttemptStateBaseFieldsV1 = {
  version: Schema.Literal("flarex.run-attempt-state.v1"),
  runId: TaskRunIdV1Schema,
  taskDefinitionRevisionId: TaskDefinitionRevisionIdV1Schema,
  runVersion: TaskRunVersionV1Schema,
};
const TaskActiveAttemptProjectionV1Schema = Schema.Struct({
  attempt: TaskTerminalAttemptRefV1Schema,
  computeProfile: TaskComputeProfileRefV1Schema,
  grantedAtMs: TaskDatabaseTimeMsV1Schema,
  lease: TaskAttemptLeaseV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);
export const RunAttemptStateV1Schema = Schema.Union([
  Schema.Struct({
    ...RunAttemptStateBaseFieldsV1,
    phase: Schema.Literal("ready"),
    ready: TaskRunReadyStateV1Schema,
    cancellation: TaskCancellationNotRequestedV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    ...RunAttemptStateBaseFieldsV1,
    phase: Schema.Literal("attempt_granted"),
    currentAttempt: TaskActiveAttemptProjectionV1Schema,
    heartbeat: Schema.Struct({ kind: Schema.Literal("none_accepted") }).annotate(STRICT_STRUCT_OPTIONS),
    cancellation: Schema.Union([TaskCancellationNotRequestedV1Schema, TaskCancellationRequestedV1Schema]),
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    ...RunAttemptStateBaseFieldsV1,
    phase: Schema.Literal("executing"),
    currentAttempt: TaskActiveAttemptProjectionV1Schema,
    heartbeat: Schema.Struct({
      kind: Schema.Literal("accepted"),
      highestSequence: TaskHeartbeatSequenceV1Schema,
    }).annotate(STRICT_STRUCT_OPTIONS),
    cancellation: Schema.Union([TaskCancellationNotRequestedV1Schema, TaskCancellationRequestedV1Schema]),
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    ...RunAttemptStateBaseFieldsV1,
    phase: Schema.Literal("retry_waiting"),
    retry: TaskAcceptedRetryV1Schema,
    cancellation: TaskCancellationNotRequestedV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    ...RunAttemptStateBaseFieldsV1,
    phase: Schema.Literal("terminal"),
    terminal: Schema.Union([TaskRunSucceededTerminalV1Schema, TaskRunFailedTerminalV1Schema]),
    cancellation: Schema.Union([
      TaskCancellationNotRequestedV1Schema,
      TaskCancellationResolvedSupersededV1Schema,
    ]),
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    ...RunAttemptStateBaseFieldsV1,
    phase: Schema.Literal("terminal"),
    terminal: TaskRunCancelledWithoutAttemptTerminalV1Schema,
    cancellation: TaskCancellationResolvedWithoutAttemptV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    ...RunAttemptStateBaseFieldsV1,
    phase: Schema.Literal("terminal"),
    terminal: TaskRunAcknowledgedCancellationTerminalV1Schema,
    cancellation: TaskCancellationResolvedAcknowledgedV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    ...RunAttemptStateBaseFieldsV1,
    phase: Schema.Literal("terminal"),
    terminal: TaskRunLeaseExpiredCancellationTerminalV1Schema,
    cancellation: TaskCancellationResolvedLeaseExpiredV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
]).check(
  Schema.makeFilter((state) => {
    if (state.phase !== "terminal") return undefined;
    const { terminal, cancellation } = state;
    if (terminal.kind === "succeeded" || terminal.kind === "failed") {
      return cancellation.kind === "not_requested" ||
        (cancellation.resolution === "superseded_by_completion" &&
          cancellation.resolvedAtMs === terminal.completedAtMs)
        ? undefined
        : "Expected terminal completion cancellation state";
    }
    return cancellation.kind === "resolved" && cancellation.resolution === terminal.resolution &&
      cancellation.generation === terminal.cancellationGeneration &&
      persistedValueEqualV1(cancellation.reason, terminal.reason) &&
      cancellation.resolvedAtMs === terminal.completedAtMs
      ? undefined
      : "Expected terminal cancellation projection fields to agree";
  }),
);
export const RunAttemptInspectionV1Schema = Schema.Struct({
  version: Schema.Literal("flarex.run-attempt-inspection.v1"),
  observedAtMs: TaskDatabaseTimeMsV1Schema,
  state: RunAttemptStateV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);

export const TaskAttemptGrantV1Schema = Schema.Struct({
  runId: TaskRunIdV1Schema,
  taskDefinitionRevisionId: TaskDefinitionRevisionIdV1Schema,
  acceptedRunVersion: TaskRunVersionV1Schema,
  attempt: TaskTerminalAttemptRefV1Schema,
  computeProfile: TaskComputeProfileRefV1Schema,
  grantedAtMs: TaskDatabaseTimeMsV1Schema,
  lease: TaskAttemptLeaseV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);

const StartAttemptAcceptedOutcomeV1Schema = Schema.Struct({
  kind: Schema.Literal("attempt_granted"),
  grant: TaskAttemptGrantV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);
export const StartAttemptOutcomeV1Schema = Schema.Union([
  StartAttemptAcceptedOutcomeV1Schema,
  Schema.Struct({
    kind: Schema.Literal("current"),
    reason: Schema.Literals(["stale_run_version", "not_yet_eligible", "phase_not_startable"]),
    state: RunAttemptStateV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
]);
const HeartbeatAttemptAcceptedOutcomeV1Schema = Schema.Struct({
  kind: Schema.Literal("lease_renewed"),
  attempt: TaskTerminalAttemptRefV1Schema,
  heartbeatSequence: TaskHeartbeatSequenceV1Schema,
  enteredExecuting: Schema.Boolean,
  lease: TaskAttemptLeaseV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);
export const HeartbeatAttemptOutcomeV1Schema = Schema.Union([
  HeartbeatAttemptAcceptedOutcomeV1Schema,
  Schema.Struct({
    kind: Schema.Literal("current"),
    reason: Schema.Literals(["phase_not_active", "stale_attempt", "stale_fence", "lease_expired", "heartbeat_not_advanced"]),
    state: RunAttemptStateV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
]);

const CompletionTerminalCancellationStateV1Schema = Schema.Union([
  TaskCancellationNotRequestedV1Schema,
  TaskCancellationResolvedSupersededV1Schema,
]);
const CompleteAttemptSucceededOutcomeV1Schema = Schema.Struct({
  kind: Schema.Literal("terminal_succeeded"),
  terminal: TaskRunSucceededTerminalV1Schema,
  cancellation: CompletionTerminalCancellationStateV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);
const CompleteAttemptRetryOutcomeV1Schema = Schema.Struct({
  kind: Schema.Literal("retry_scheduled"),
  delivery: Schema.Literals(["immediate", "durable"]),
  retry: TaskAcceptedRetryV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);
const CompleteAttemptFailedOutcomeV1Schema = Schema.Struct({
  kind: Schema.Literal("terminal_failed"),
  terminal: TaskRunAttemptFailedTerminalV1Schema,
  cancellation: CompletionTerminalCancellationStateV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);
const CompleteAttemptCancelledOutcomeV1Schema = Schema.Struct({
  kind: Schema.Literal("terminal_cancelled"),
  terminal: TaskRunAcknowledgedCancellationTerminalV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);
export const CompleteAttemptOutcomeV1Schema = Schema.Union([
  CompleteAttemptSucceededOutcomeV1Schema,
  CompleteAttemptRetryOutcomeV1Schema,
  CompleteAttemptFailedOutcomeV1Schema,
  CompleteAttemptCancelledOutcomeV1Schema,
  Schema.Struct({
    kind: Schema.Literal("current"),
    reason: Schema.Literals(["phase_not_active", "stale_attempt", "stale_fence", "lease_expired"]),
    state: RunAttemptStateV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
]);

const RequestCancellationRequestedOutcomeV1Schema = Schema.Struct({
  kind: Schema.Literal("cancellation_requested"),
  attempt: TaskTerminalAttemptRefV1Schema,
  cancellation: TaskCancellationRequestedV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);
const RequestCancellationTerminalOutcomeV1Schema = Schema.Struct({
  kind: Schema.Literal("terminal_cancelled"),
  terminal: TaskRunCancelledWithoutAttemptTerminalV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);
export const RequestCancellationOutcomeV1Schema = Schema.Union([
  RequestCancellationRequestedOutcomeV1Schema,
  RequestCancellationTerminalOutcomeV1Schema,
  Schema.Struct({
    kind: Schema.Literal("current"),
    reason: Schema.Literals(["already_requested", "already_terminal"]),
    state: RunAttemptStateV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
]);

const HandleLeaseExpiryRetryOutcomeV1Schema = Schema.Struct({
  kind: Schema.Literal("retry_scheduled"),
  delivery: Schema.Literal("durable"),
  retry: TaskAcceptedRetryV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);
const HandleLeaseExpiryFailedOutcomeV1Schema = Schema.Struct({
  kind: Schema.Literal("terminal_failed"),
  terminal: TaskRunAttemptFailedTerminalV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);
const HandleLeaseExpiryCancelledOutcomeV1Schema = Schema.Struct({
  kind: Schema.Literal("terminal_cancelled"),
  terminal: TaskRunLeaseExpiredCancellationTerminalV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);
export const HandleLeaseExpiryOutcomeV1Schema = Schema.Union([
  HandleLeaseExpiryRetryOutcomeV1Schema,
  HandleLeaseExpiryFailedOutcomeV1Schema,
  HandleLeaseExpiryCancelledOutcomeV1Schema,
  Schema.Struct({
    kind: Schema.Literal("current"),
    reason: Schema.Literals(["phase_not_active", "stale_attempt", "stale_fence", "stale_lease_version", "lease_not_expired"]),
    state: RunAttemptStateV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
]);

export const TaskFailurePolicyDecisionEvidenceV1Schema = Schema.Struct({
  failure: TaskExecutionFailureV1Schema,
  currentAttemptNumber: TaskAttemptNumberV1Schema,
  maximumAttempts: TaskMaximumAttemptsV1Schema,
  directive: Schema.Struct({
    source: Schema.Literals(["completion", "synthesized_bound_policy"]),
    value: TaskRetryDirectiveV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
  storedRetryJitter: TaskRetryJitterV1Schema,
  jitterUsed: Schema.Boolean,
  decision: Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("retry_accepted"),
      eligibility: Schema.Literals(["ordinary", "oom_escalation", "lease_loss"]),
      delaySource: Schema.Literals(["bound_policy", "override_delay"]),
      delayMs: TaskDurationMsV1Schema,
      notBeforeMs: TaskDatabaseTimeMsV1Schema,
      delivery: Schema.Struct({
        kind: Schema.Literals(["immediate", "durable"]),
        reason: Schema.Literals([
          "below_immediate_threshold", "failure_code_forced_durable",
          "at_or_above_immediate_threshold", "oom_forced_durable", "lease_loss_forced_durable",
        ]),
      }).annotate(STRICT_STRUCT_OPTIONS),
      computeEscalation: Schema.NullOr(Schema.Struct({
        previous: TaskComputeProfileRefV1Schema,
        next: TaskComputeProfileRefV1Schema,
      }).annotate(STRICT_STRUCT_OPTIONS)),
    }).annotate(STRICT_STRUCT_OPTIONS),
    Schema.Struct({
      kind: Schema.Literal("retry_rejected"),
      reason: Schema.Literals([
        "cancellation_requested", "directive_do_not_retry", "attempt_limit_reached",
        "failure_not_retryable", "oom_escalation_disabled", "oom_escalation_already_applied",
      ]),
      terminalClassification: Schema.Literals(["task_failure", "system_failure", "resource_exhaustion", "timed_out"]),
    }).annotate(STRICT_STRUCT_OPTIONS),
  ]),
}).annotate(STRICT_STRUCT_OPTIONS);

export const TaskLifecycleEventProjectionV1Schema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("attempt_granted"), attemptNumber: TaskAttemptNumberV1Schema }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({ kind: Schema.Literal("execution_observed"), attemptNumber: TaskAttemptNumberV1Schema }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    kind: Schema.Literal("cancellation_requested"),
    attemptNumber: TaskAttemptNumberV1Schema,
    generation: TaskCancellationGenerationV1Schema,
    reasonCode: Schema.Literals(["requested", "execution_cancelled", "policy_cancelled"]),
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    kind: Schema.Literal("retry_scheduled"),
    previousAttemptNumber: TaskAttemptNumberV1Schema,
    retry: Schema.Union([
      Schema.Struct({
        source: Schema.Literal("failed_completion"),
        delivery: Schema.Literals(["immediate", "durable"]),
      }).annotate(STRICT_STRUCT_OPTIONS),
      Schema.Struct({ source: Schema.Literal("lease_expiry"), delivery: Schema.Literal("durable") }).annotate(STRICT_STRUCT_OPTIONS),
    ]),
    notBeforeMs: TaskDatabaseTimeMsV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    kind: Schema.Literal("run_succeeded"),
    attemptNumber: TaskAttemptNumberV1Schema,
    hasResult: Schema.Boolean,
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    kind: Schema.Literal("run_cancelled"),
    generation: TaskCancellationGenerationV1Schema,
    reasonCode: Schema.Literals(["requested", "execution_cancelled", "policy_cancelled"]),
    cancellation: Schema.Union([
      Schema.Struct({ attemptNumber: Schema.Null, resolution: Schema.Literal("without_active_attempt") }).annotate(STRICT_STRUCT_OPTIONS),
      Schema.Struct({
        attemptNumber: TaskAttemptNumberV1Schema,
        resolution: Schema.Literals(["acknowledged", "lease_expired"]),
      }).annotate(STRICT_STRUCT_OPTIONS),
    ]),
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    kind: Schema.Literal("run_failed"),
    attemptNumber: Schema.NullOr(TaskAttemptNumberV1Schema),
    failure: Schema.Union([
      Schema.Struct({ kind: Schema.Literal("task_failure"), code: Schema.Literals(["uncaught_exception", "input_validation_failed", "output_validation_failed", "middleware_failed", "handler_failed"]) }).annotate(STRICT_STRUCT_OPTIONS),
      Schema.Struct({ kind: Schema.Literal("system_failure"), code: Schema.Literals(["attempt_dispatch_failed", "runtime_start_failed", "execution_lost", "execution_aborted", "provider_evicted", "provider_failure", "task_binding_unavailable", "configuration_invalid", "internal_invariant"]) }).annotate(STRICT_STRUCT_OPTIONS),
      Schema.Struct({ kind: Schema.Literal("resource_exhaustion"), code: Schema.Literals(["out_of_memory", "possible_out_of_memory", "process_crashed", "disk_exhausted"]) }).annotate(STRICT_STRUCT_OPTIONS),
      Schema.Struct({ kind: Schema.Literal("timed_out"), code: Schema.Literal("maximum_duration_exceeded") }).annotate(STRICT_STRUCT_OPTIONS),
    ]),
  }).annotate(STRICT_STRUCT_OPTIONS),
]);

const TaskRequestedEffectBaseFieldsV1 = {
  version: Schema.Literal("flarex.task-requested-effect.v1"),
  runId: TaskRunIdV1Schema,
  acceptedRunVersion: TaskRunVersionV1Schema,
};
export const TaskRequestedEffectV1Schema = Schema.Union([
  Schema.Struct({
    ...TaskRequestedEffectBaseFieldsV1,
    kind: Schema.Literal("dispatch_attempt"),
    taskDefinitionRevisionId: TaskDefinitionRevisionIdV1Schema,
    attempt: TaskTerminalAttemptRefV1Schema,
    leaseVersion: TaskLeaseVersionV1Schema,
    computeProfile: TaskComputeProfileRefV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    ...TaskRequestedEffectBaseFieldsV1,
    kind: Schema.Literals(["continue_retry", "wake_retry"]),
    expectedRunVersion: TaskRunVersionV1Schema,
    notBeforeMs: TaskDatabaseTimeMsV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    ...TaskRequestedEffectBaseFieldsV1,
    kind: Schema.Literal("wake_lease_expiry"),
    attemptId: TaskAttemptIdV1Schema,
    executionFence: TaskExecutionFenceV1Schema,
    expectedLeaseVersion: TaskLeaseVersionV1Schema,
    notBeforeMs: TaskDatabaseTimeMsV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    ...TaskRequestedEffectBaseFieldsV1,
    kind: Schema.Literal("request_execution_cancellation"),
    attemptId: TaskAttemptIdV1Schema,
    executionFence: TaskExecutionFenceV1Schema,
    cancellationGeneration: TaskCancellationGenerationV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    ...TaskRequestedEffectBaseFieldsV1,
    kind: Schema.Literal("release_queue_ownership"),
    cause: Schema.Literals([
      "succeeded_completion", "failed_completion", "cancellation_acknowledged",
      "lease_expired_before_heartbeat", "lease_expired_after_heartbeat", "cancellation_lease_expired",
    ]),
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    ...TaskRequestedEffectBaseFieldsV1,
    kind: Schema.Literal("publish_lifecycle_event"),
    observedAtMs: TaskDatabaseTimeMsV1Schema,
    event: TaskLifecycleEventProjectionV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({ ...TaskRequestedEffectBaseFieldsV1, kind: Schema.Literal("notify_current_state") }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    ...TaskRequestedEffectBaseFieldsV1,
    kind: Schema.Literal("cancel_obsolete_lease_wake"),
    attemptId: TaskAttemptIdV1Schema,
    executionFence: TaskExecutionFenceV1Schema,
    obsoleteLeaseVersion: TaskLeaseVersionV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
]);
export const PersistedTaskRequestedEffectV1Schema = Schema.Struct({
  sequence: TaskRequestedEffectSequenceV1Schema,
  effect: TaskRequestedEffectV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);

const TaskRunAttemptEvidenceBaseFieldsV1 = {
  version: Schema.Literal("flarex.task-run-attempt-evidence.v1"),
  runId: TaskRunIdV1Schema,
  acceptedRunVersion: TaskRunVersionV1Schema,
  recordedAtMs: TaskDatabaseTimeMsV1Schema,
  resultingPhase: Schema.Literals(["ready", "attempt_granted", "executing", "retry_waiting", "terminal"]),
};
export const TaskRunAttemptEvidenceV1Schema = Schema.Union([
  Schema.Struct({
    ...TaskRunAttemptEvidenceBaseFieldsV1,
    kind: Schema.Literal("attempt_granted"),
    fromPhase: Schema.Literals(["ready", "retry_waiting"]),
    grant: TaskAttemptGrantV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    ...TaskRunAttemptEvidenceBaseFieldsV1,
    kind: Schema.Literal("heartbeat_accepted"),
    attempt: TaskTerminalAttemptRefV1Schema,
    heartbeatSequence: TaskHeartbeatSequenceV1Schema,
    previousLeaseVersion: TaskLeaseVersionV1Schema,
    renewedLease: TaskAttemptLeaseV1Schema,
    enteredExecuting: Schema.Boolean,
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    ...TaskRunAttemptEvidenceBaseFieldsV1,
    kind: Schema.Literal("completion_succeeded"),
    attempt: TaskTerminalAttemptRefV1Schema,
    completion: TaskSucceededCompletionV1Schema,
    outcome: CompleteAttemptSucceededOutcomeV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    ...TaskRunAttemptEvidenceBaseFieldsV1,
    kind: Schema.Literal("completion_failed"),
    attempt: TaskTerminalAttemptRefV1Schema,
    completion: TaskFailedCompletionV1Schema,
    policy: TaskFailurePolicyDecisionEvidenceV1Schema,
    outcome: Schema.Union([CompleteAttemptRetryOutcomeV1Schema, CompleteAttemptFailedOutcomeV1Schema]),
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    ...TaskRunAttemptEvidenceBaseFieldsV1,
    kind: Schema.Literal("completion_cancellation_acknowledged"),
    attempt: TaskTerminalAttemptRefV1Schema,
    completion: TaskCancellationAcknowledgedCompletionV1Schema,
    outcome: CompleteAttemptCancelledOutcomeV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    ...TaskRunAttemptEvidenceBaseFieldsV1,
    kind: Schema.Literal("cancellation_requested"),
    attempt: TaskTerminalAttemptRefV1Schema,
    cancellation: TaskCancellationRequestedV1Schema,
    outcome: RequestCancellationRequestedOutcomeV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    ...TaskRunAttemptEvidenceBaseFieldsV1,
    kind: Schema.Literal("cancellation_resolved_without_attempt"),
    attempt: Schema.Null,
    cancellation: TaskCancellationResolvedWithoutAttemptV1Schema,
    outcome: RequestCancellationTerminalOutcomeV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    ...TaskRunAttemptEvidenceBaseFieldsV1,
    kind: Schema.Literal("lease_expiry_recovered"),
    attempt: TaskTerminalAttemptRefV1Schema,
    expiredLeaseVersion: TaskLeaseVersionV1Schema,
    sourcePhase: Schema.Literals(["attempt_granted", "executing"]),
    policy: TaskFailurePolicyDecisionEvidenceV1Schema,
    outcome: Schema.Union([HandleLeaseExpiryRetryOutcomeV1Schema, HandleLeaseExpiryFailedOutcomeV1Schema]),
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    ...TaskRunAttemptEvidenceBaseFieldsV1,
    kind: Schema.Literal("lease_expiry_cancelled"),
    attempt: TaskTerminalAttemptRefV1Schema,
    expiredLeaseVersion: TaskLeaseVersionV1Schema,
    sourcePhase: Schema.Literals(["attempt_granted", "executing"]),
    outcome: HandleLeaseExpiryCancelledOutcomeV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
]);

const AcceptedReceiptBaseFieldsV1 = {
  observedAtMs: TaskDatabaseTimeMsV1Schema,
  acceptedRunVersion: TaskRunVersionV1Schema,
  resultingPhase: Schema.Literals(["ready", "attempt_granted", "executing", "retry_waiting", "terminal"]),
  evidence: Schema.Array(TaskRunAttemptEvidenceV1Schema).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(1),
  ),
  requestedEffects: Schema.Array(PersistedTaskRequestedEffectV1Schema).check(
    Schema.isMinLength(2),
    Schema.isMaxLength(5),
  ),
};
const AcceptedStartReceiptV1Schema = Schema.Struct({
  ...AcceptedReceiptBaseFieldsV1,
  outcome: StartAttemptAcceptedOutcomeV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);
const AcceptedHeartbeatReceiptV1Schema = Schema.Struct({
  ...AcceptedReceiptBaseFieldsV1,
  outcome: HeartbeatAttemptAcceptedOutcomeV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);
const AcceptedCompleteReceiptV1Schema = Schema.Struct({
  ...AcceptedReceiptBaseFieldsV1,
  outcome: Schema.Union([
    CompleteAttemptSucceededOutcomeV1Schema,
    CompleteAttemptRetryOutcomeV1Schema,
    CompleteAttemptFailedOutcomeV1Schema,
    CompleteAttemptCancelledOutcomeV1Schema,
  ]),
}).annotate(STRICT_STRUCT_OPTIONS);
const AcceptedCancellationReceiptV1Schema = Schema.Struct({
  ...AcceptedReceiptBaseFieldsV1,
  outcome: Schema.Union([
    RequestCancellationRequestedOutcomeV1Schema,
    RequestCancellationTerminalOutcomeV1Schema,
  ]),
}).annotate(STRICT_STRUCT_OPTIONS);
const AcceptedLeaseExpiryReceiptV1Schema = Schema.Struct({
  ...AcceptedReceiptBaseFieldsV1,
  outcome: Schema.Union([
    HandleLeaseExpiryRetryOutcomeV1Schema,
    HandleLeaseExpiryFailedOutcomeV1Schema,
    HandleLeaseExpiryCancelledOutcomeV1Schema,
  ]),
}).annotate(STRICT_STRUCT_OPTIONS);

export const TaskRunAttemptMutationAcceptanceV1Schema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("start_attempt"),
    command: Schema.Struct({
      kind: Schema.Literal("start_attempt"),
      expectedRunVersion: TaskRunVersionV1Schema,
    }).annotate(STRICT_STRUCT_OPTIONS),
    accepted: AcceptedStartReceiptV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    kind: Schema.Literal("heartbeat_attempt"),
    command: Schema.Struct({
      kind: Schema.Literal("heartbeat_attempt"),
      attemptId: TaskAttemptIdV1Schema,
      executionFence: TaskExecutionFenceV1Schema,
      heartbeatSequence: TaskHeartbeatSequenceV1Schema,
    }).annotate(STRICT_STRUCT_OPTIONS),
    accepted: AcceptedHeartbeatReceiptV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    kind: Schema.Literal("complete_attempt"),
    attemptId: TaskAttemptIdV1Schema,
    executionFence: TaskExecutionFenceV1Schema,
    accepted: AcceptedCompleteReceiptV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    kind: Schema.Literal("request_cancellation"),
    command: Schema.Struct({
      kind: Schema.Literal("request_cancellation"),
      reason: TaskCancellationReasonV1Schema,
    }).annotate(STRICT_STRUCT_OPTIONS),
    accepted: AcceptedCancellationReceiptV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    kind: Schema.Literal("handle_lease_expiry"),
    command: Schema.Struct({
      kind: Schema.Literal("handle_lease_expiry"),
      attemptId: TaskAttemptIdV1Schema,
      executionFence: TaskExecutionFenceV1Schema,
      expectedLeaseVersion: TaskLeaseVersionV1Schema,
    }).annotate(STRICT_STRUCT_OPTIONS),
    accepted: AcceptedLeaseExpiryReceiptV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
]);
export const TaskAttemptCompletionReplayV1Schema = Schema.Struct({
  attempt: TaskTerminalAttemptRefV1Schema,
  completion: TaskAttemptCompletionV1Schema,
  accepted: AcceptedCompleteReceiptV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);

function completionOutcomePhaseV1(
  outcome: TaskRunAttemptAggregateV1["completionReplays"][number]["accepted"]["outcome"],
): "ready" | "retry_waiting" | "terminal" {
  return outcome.kind === "retry_scheduled"
    ? outcome.delivery === "immediate" ? "ready" : "retry_waiting"
    : "terminal";
}

function recomputedFailurePolicyMatchesV1(input: {
  readonly aggregate: TaskRunAttemptAggregateV1;
  readonly attempt: TaskRunAttemptAggregateV1["completionReplays"][number]["attempt"];
  readonly observedAtMs: TaskDatabaseTimeMsV1;
  readonly evidence: Extract<TaskRunAttemptEvidenceV1, {
    readonly kind: "completion_failed" | "lease_expiry_recovered";
  }>["policy"];
  readonly failure: TaskExecutionFailureV1;
  readonly directive: TaskRetryDirectiveV1;
  readonly directiveSource: "completion" | "synthesized_bound_policy";
  readonly leaseExpiry: boolean;
  readonly cancellationRequested: boolean;
  readonly nextComputeProfile: TaskComputeProfileRefV1 | null;
}): boolean {
  const leaseVersion = input.aggregate.leaseHistory.kind === "issued"
    ? input.aggregate.leaseHistory.lastLeaseVersion
    : null;
  if (leaseVersion === null) return false;
  const escalation = input.evidence.decision.kind === "retry_accepted"
    ? input.evidence.decision.computeEscalation
    : null;
  const oomPolicy = input.aggregate.boundPolicy.runAttempt.outOfMemory;
  const currentComputeProfile = escalation?.previous ??
    (input.evidence.decision.kind === "retry_rejected" &&
      input.evidence.decision.reason === "oom_escalation_already_applied" &&
      oomPolicy.kind === "escalate_once"
      ? oomPolicy.computeProfile
      : input.nextComputeProfile ?? input.aggregate.boundPolicy.initialComputeProfile);
  const recomputed = decideFailurePolicyV1({
    operation: input.leaseExpiry ? "handle_lease_expiry" : "complete_attempt",
    runId: input.aggregate.runId,
    databaseNowMs: input.observedAtMs,
    boundPolicy: input.aggregate.boundPolicy,
    currentAttempt: {
      ...input.attempt,
      grantBasisRunVersion: input.aggregate.runVersion,
      computeProfile: currentComputeProfile,
      retryJitter: input.evidence.storedRetryJitter,
      grantedAtMs: input.observedAtMs,
      lease: {
        version: leaseVersion,
        renewedAtMs: input.observedAtMs,
        expiresAtMs: input.observedAtMs,
      },
    },
    failure: input.failure,
    directive: input.directive,
    directiveSource: input.directiveSource,
    cancellationRequested: input.cancellationRequested,
    leaseExpiry: input.leaseExpiry,
  });
  return Result.isSuccess(recomputed) && persistedValueEqualV1(recomputed.success.evidence, input.evidence);
}

function completionEffectPlanMatchesV1(
  replay: TaskRunAttemptAggregateV1["completionReplays"][number],
): boolean {
  const { accepted } = replay;
  const effects = accepted.requestedEffects.map((persisted) => persisted.effect);
  const expectedKinds = accepted.outcome.kind === "retry_scheduled"
    ? ["cancel_obsolete_lease_wake", "release_queue_ownership", accepted.outcome.delivery === "immediate" ? "continue_retry" : "wake_retry", "publish_lifecycle_event", "notify_current_state"]
    : ["cancel_obsolete_lease_wake", "release_queue_ownership", "publish_lifecycle_event", "notify_current_state"];
  if (effects.length !== expectedKinds.length || effects.some((effect, index) => effect.kind !== expectedKinds[index])) {
    return false;
  }
  const cancelLeaseWake = effects[0];
  const release = effects[1];
  const publish = effects.at(-2);
  const notify = effects.at(-1);
  if (cancelLeaseWake?.kind !== "cancel_obsolete_lease_wake" ||
    cancelLeaseWake.attemptId !== replay.attempt.attemptId ||
    cancelLeaseWake.executionFence !== replay.attempt.executionFence ||
    release?.kind !== "release_queue_ownership" || publish?.kind !== "publish_lifecycle_event" ||
    publish.observedAtMs !== accepted.observedAtMs || notify?.kind !== "notify_current_state") return false;
  const outcome = accepted.outcome;
  if (outcome.kind === "terminal_succeeded") {
    return release.cause === "succeeded_completion" && publish.event.kind === "run_succeeded" &&
      publish.event.attemptNumber === replay.attempt.attemptNumber &&
      publish.event.hasResult === (outcome.terminal.result !== null);
  }
  if (outcome.kind === "terminal_failed") {
    return release.cause === "failed_completion" && publish.event.kind === "run_failed" &&
      publish.event.attemptNumber === replay.attempt.attemptNumber &&
      publish.event.failure.kind === outcome.terminal.failure.kind &&
      publish.event.failure.code === outcome.terminal.failure.code;
  }
  if (outcome.kind === "terminal_cancelled") {
    return release.cause === "cancellation_acknowledged" && publish.event.kind === "run_cancelled" &&
      publish.event.generation === outcome.terminal.cancellationGeneration &&
      persistedValueEqualV1(publish.event.reasonCode, outcome.terminal.reason.code) &&
      publish.event.cancellation.resolution === "acknowledged" &&
      publish.event.cancellation.attemptNumber === replay.attempt.attemptNumber;
  }
  const deliveryEffect = effects[2];
  return release.cause === "failed_completion" &&
    (deliveryEffect?.kind === "continue_retry" || deliveryEffect?.kind === "wake_retry") &&
    deliveryEffect.expectedRunVersion === accepted.acceptedRunVersion &&
    deliveryEffect.notBeforeMs === outcome.retry.notBeforeMs &&
    publish.event.kind === "retry_scheduled" &&
    publish.event.previousAttemptNumber === replay.attempt.attemptNumber &&
    publish.event.retry.source === "failed_completion" && publish.event.retry.delivery === outcome.delivery &&
    publish.event.notBeforeMs === outcome.retry.notBeforeMs;
}

function completionReplayCorrelatesV1(
  replay: TaskRunAttemptAggregateV1["completionReplays"][number],
  aggregate: TaskRunAttemptAggregateV1,
): boolean {
  const maximumAttempts = aggregate.boundPolicy.runAttempt.retry.maxAttempts;
  const evidence = replay.accepted.evidence[0];
  if (evidence === undefined ||
    (evidence.kind !== "completion_succeeded" && evidence.kind !== "completion_failed" &&
      evidence.kind !== "completion_cancellation_acknowledged") ||
    !terminalAttemptRefEqualV1(evidence.attempt, replay.attempt) ||
    !persistedValueEqualV1(evidence.completion, replay.completion) ||
    !persistedValueEqualV1(evidence.outcome, replay.accepted.outcome) ||
    replay.accepted.resultingPhase !== completionOutcomePhaseV1(replay.accepted.outcome)) return false;
  if (replay.completion.kind === "succeeded" && evidence.kind !== "completion_succeeded") return false;
  if (replay.completion.kind === "failed" && evidence.kind !== "completion_failed") return false;
  if (replay.completion.kind === "cancellation_acknowledged" &&
    evidence.kind !== "completion_cancellation_acknowledged") return false;
  if (evidence.kind === "completion_succeeded" &&
    (evidence.outcome.kind !== "terminal_succeeded" ||
      !persistedValueEqualV1(evidence.completion.result, evidence.outcome.terminal.result) ||
      evidence.completion.executionDurationMs !== evidence.outcome.terminal.executionDurationMs)) return false;
  if (evidence.kind === "completion_cancellation_acknowledged" &&
    (evidence.outcome.kind !== "terminal_cancelled" ||
      evidence.completion.cancellationGeneration !== evidence.outcome.terminal.cancellationGeneration ||
      evidence.completion.executionDurationMs !== evidence.outcome.terminal.executionDurationMs)) return false;
  if (evidence.kind === "completion_failed" && evidence.outcome.kind === "terminal_failed" &&
    evidence.completion.executionDurationMs !== evidence.outcome.terminal.executionDurationMs) return false;
  if (replay.accepted.outcome.kind === "retry_scheduled") {
    if (replay.accepted.outcome.retry.acceptedAtMs !== replay.accepted.observedAtMs ||
      !terminalAttemptRefEqualV1(replay.attempt, replay.accepted.outcome.retry.previousAttempt)) return false;
  } else if (replay.accepted.outcome.terminal.attempt === null ||
    replay.accepted.outcome.terminal.completedAtMs !== replay.accepted.observedAtMs ||
    !terminalAttemptRefEqualV1(replay.attempt, replay.accepted.outcome.terminal.attempt)) return false;
  if (evidence.kind === "completion_failed") {
    const policy = evidence.policy;
    if (!persistedValueEqualV1(policy.failure, evidence.completion.failure) ||
      policy.currentAttemptNumber !== replay.attempt.attemptNumber ||
      policy.maximumAttempts !== maximumAttempts || policy.directive.source !== "completion" ||
      !persistedValueEqualV1(policy.directive.value, evidence.completion.retry)) return false;
    const nextComputeProfile = evidence.outcome.kind === "retry_scheduled"
      ? evidence.outcome.retry.nextComputeProfile
      : null;
    if (!recomputedFailurePolicyMatchesV1({
      aggregate,
      attempt: replay.attempt,
      observedAtMs: replay.accepted.observedAtMs,
      evidence: policy,
      failure: evidence.completion.failure,
      directive: evidence.completion.retry,
      directiveSource: "completion",
      leaseExpiry: false,
      cancellationRequested: policy.decision.kind === "retry_rejected" &&
        policy.decision.reason === "cancellation_requested",
      nextComputeProfile,
    })) return false;
    if (policy.decision.kind === "retry_accepted") {
      if (evidence.outcome.kind !== "retry_scheduled" ||
        evidence.outcome.delivery !== policy.decision.delivery.kind ||
        evidence.outcome.retry.notBeforeMs !== policy.decision.notBeforeMs ||
        evidence.outcome.retry.acceptedAtMs + policy.decision.delayMs !== policy.decision.notBeforeMs ||
        !persistedValueEqualV1(evidence.outcome.retry.cause.failure, evidence.completion.failure) ||
        (policy.decision.computeEscalation !== null &&
          evidence.outcome.retry.nextComputeProfile !== policy.decision.computeEscalation.next) ||
        policy.jitterUsed !== (policy.decision.delaySource === "bound_policy" &&
          aggregate.boundPolicy.runAttempt.retry.randomize)) return false;
    } else if (evidence.outcome.kind !== "terminal_failed" || policy.jitterUsed ||
      evidence.outcome.terminal.classification !== policy.decision.terminalClassification ||
      !persistedValueEqualV1(evidence.outcome.terminal.failure, evidence.completion.failure)) return false;
  }
  return completionEffectPlanMatchesV1(replay);
}

function requestedEffectKindsEqualV1(
  accepted: {
    readonly requestedEffects: readonly {
      readonly effect: { readonly kind: string };
    }[];
  },
  expected: readonly string[],
): boolean {
  return accepted.requestedEffects.length === expected.length &&
    accepted.requestedEffects.every((persisted, index) => persisted.effect.kind === expected[index]);
}

function leaseFailurePolicyCorrelatesV1(
  aggregate: TaskRunAttemptAggregateV1,
  evidence: Extract<TaskRunAttemptAggregateV1["lastLifecycleAcceptance"], { readonly kind: "handle_lease_expiry" }>["accepted"]["evidence"][number] &
    { readonly kind: "lease_expiry_recovered" },
): boolean {
  const { policy, outcome } = evidence;
  const expectedFailure = {
    kind: "system_failure" as const,
    code: evidence.sourcePhase === "attempt_granted" ? "attempt_dispatch_failed" as const : "execution_lost" as const,
    message: null,
  };
  if (!persistedValueEqualV1(policy.failure, expectedFailure) ||
    policy.currentAttemptNumber !== evidence.attempt.attemptNumber ||
    policy.maximumAttempts !== aggregate.boundPolicy.runAttempt.retry.maxAttempts ||
    policy.directive.source !== "synthesized_bound_policy" || policy.directive.value.kind !== "use_bound_policy") {
    return false;
  }
  if (!recomputedFailurePolicyMatchesV1({
    aggregate,
    attempt: evidence.attempt,
    observedAtMs: evidence.recordedAtMs,
    evidence: policy,
    failure: expectedFailure,
    directive: policy.directive.value,
    directiveSource: "synthesized_bound_policy",
    leaseExpiry: true,
    cancellationRequested: false,
    nextComputeProfile: outcome.kind === "retry_scheduled" ? outcome.retry.nextComputeProfile : null,
  })) return false;
  if (policy.decision.kind === "retry_accepted") {
    return outcome.kind === "retry_scheduled" && outcome.delivery === "durable" &&
      policy.decision.eligibility === "lease_loss" && policy.decision.delivery.kind === "durable" &&
      policy.decision.delaySource === "bound_policy" &&
      evidence.recordedAtMs + policy.decision.delayMs === policy.decision.notBeforeMs &&
      outcome.retry.acceptedAtMs === evidence.recordedAtMs &&
      outcome.retry.notBeforeMs === policy.decision.notBeforeMs &&
      persistedValueEqualV1(outcome.retry.cause.failure, expectedFailure) &&
      policy.jitterUsed === aggregate.boundPolicy.runAttempt.retry.randomize;
  }
  return outcome.kind === "terminal_failed" && !policy.jitterUsed &&
    outcome.terminal.classification === policy.decision.terminalClassification &&
    persistedValueEqualV1(outcome.terminal.failure, expectedFailure);
}

function latestAcceptanceCorrelatesV1(
  aggregate: TaskRunAttemptAggregateV1,
  acceptance: NonNullable<TaskRunAttemptAggregateV1["lastLifecycleAcceptance"]>,
): boolean {
  const accepted = acceptance.accepted;
  const evidence = accepted.evidence[0];
  if (evidence === undefined) return false;
  switch (acceptance.kind) {
    case "start_attempt": {
      if (aggregate.phase !== "attempt_granted" || evidence.kind !== "attempt_granted" ||
        accepted.outcome.kind !== "attempt_granted" || acceptance.command.expectedRunVersion + 1n !== accepted.acceptedRunVersion ||
        (accepted.outcome.grant.attempt.attemptNumber === 1 && evidence.fromPhase !== "ready") ||
        !persistedValueEqualV1(evidence.grant, accepted.outcome.grant) ||
        accepted.outcome.grant.acceptedRunVersion !== accepted.acceptedRunVersion ||
        accepted.outcome.grant.runId !== aggregate.runId ||
        accepted.outcome.grant.taskDefinitionRevisionId !== aggregate.taskDefinitionRevisionId ||
        accepted.outcome.grant.grantedAtMs !== accepted.observedAtMs ||
        aggregate.currentAttempt.grantBasisRunVersion !== acceptance.command.expectedRunVersion ||
        !terminalAttemptRefEqualV1(accepted.outcome.grant.attempt, aggregate.currentAttempt) ||
        aggregate.currentAttempt.grantedAtMs !== accepted.outcome.grant.grantedAtMs ||
        !persistedValueEqualV1(accepted.outcome.grant.lease, aggregate.currentAttempt.lease) ||
        accepted.outcome.grant.computeProfile !== aggregate.currentAttempt.computeProfile ||
        aggregate.cancellation.kind !== "not_requested") return false;
      if (!requestedEffectKindsEqualV1(accepted, [
        "dispatch_attempt", "wake_lease_expiry", "publish_lifecycle_event", "notify_current_state",
      ])) return false;
      const [dispatch, wake, publish] = accepted.requestedEffects.map((item) => item.effect);
      return dispatch?.kind === "dispatch_attempt" && wake?.kind === "wake_lease_expiry" &&
        publish?.kind === "publish_lifecycle_event" &&
        dispatch.taskDefinitionRevisionId === aggregate.taskDefinitionRevisionId &&
        terminalAttemptRefEqualV1(dispatch.attempt, accepted.outcome.grant.attempt) &&
        dispatch.leaseVersion === accepted.outcome.grant.lease.version &&
        dispatch.computeProfile === accepted.outcome.grant.computeProfile &&
        wake.attemptId === accepted.outcome.grant.attempt.attemptId &&
        wake.executionFence === accepted.outcome.grant.attempt.executionFence &&
        wake.expectedLeaseVersion === accepted.outcome.grant.lease.version &&
        wake.notBeforeMs === accepted.outcome.grant.lease.expiresAtMs &&
        publish.observedAtMs === accepted.observedAtMs && publish.event.kind === "attempt_granted" &&
        publish.event.attemptNumber === accepted.outcome.grant.attempt.attemptNumber;
    }
    case "heartbeat_attempt": {
      if (aggregate.phase !== "executing" || evidence.kind !== "heartbeat_accepted" ||
        accepted.outcome.kind !== "lease_renewed" ||
        acceptance.command.attemptId !== evidence.attempt.attemptId ||
        acceptance.command.executionFence !== evidence.attempt.executionFence ||
        acceptance.command.heartbeatSequence !== evidence.heartbeatSequence ||
        !terminalAttemptRefEqualV1(evidence.attempt, accepted.outcome.attempt) ||
        !persistedValueEqualV1(evidence.renewedLease, accepted.outcome.lease) ||
        evidence.renewedLease.renewedAtMs !== accepted.observedAtMs ||
        evidence.previousLeaseVersion + 1n !== evidence.renewedLease.version ||
        evidence.enteredExecuting !== accepted.outcome.enteredExecuting ||
        !terminalAttemptRefEqualV1(evidence.attempt, aggregate.currentAttempt) ||
        aggregate.heartbeat.highestSequence !== evidence.heartbeatSequence ||
        !persistedValueEqualV1(aggregate.currentAttempt.lease, evidence.renewedLease)) return false;
      if (!requestedEffectKindsEqualV1(accepted, accepted.outcome.enteredExecuting
        ? ["cancel_obsolete_lease_wake", "wake_lease_expiry", "publish_lifecycle_event", "notify_current_state"]
        : ["cancel_obsolete_lease_wake", "wake_lease_expiry", "notify_current_state"])) return false;
      const [cancelWake, wake, possiblePublish] = accepted.requestedEffects.map((item) => item.effect);
      if (cancelWake?.kind !== "cancel_obsolete_lease_wake" || wake?.kind !== "wake_lease_expiry" ||
        cancelWake.attemptId !== evidence.attempt.attemptId ||
        cancelWake.executionFence !== evidence.attempt.executionFence ||
        cancelWake.obsoleteLeaseVersion !== evidence.previousLeaseVersion ||
        wake.attemptId !== evidence.attempt.attemptId || wake.executionFence !== evidence.attempt.executionFence ||
        wake.expectedLeaseVersion !== evidence.renewedLease.version ||
        wake.notBeforeMs !== evidence.renewedLease.expiresAtMs) return false;
      return !accepted.outcome.enteredExecuting ||
        (possiblePublish?.kind === "publish_lifecycle_event" &&
          possiblePublish.observedAtMs === accepted.observedAtMs &&
          possiblePublish.event.kind === "execution_observed" &&
          possiblePublish.event.attemptNumber === evidence.attempt.attemptNumber);
    }
    case "complete_attempt": {
      const replay = aggregate.completionReplays.find((candidate) =>
        candidate.attempt.attemptId === acceptance.attemptId &&
        candidate.attempt.executionFence === acceptance.executionFence);
      if (replay === undefined || !persistedValueEqualV1(replay.accepted, accepted)) return false;
      const outcome = replay.accepted.outcome;
      if (outcome.kind === "retry_scheduled") {
        if (outcome.retry.acceptedAtMs !== accepted.observedAtMs) return false;
        return outcome.delivery === "immediate"
          ? aggregate.phase === "ready" && aggregate.ready.kind === "immediate_retry" &&
            persistedValueEqualV1(aggregate.ready.acceptedRetry, outcome.retry)
          : aggregate.phase === "retry_waiting" &&
            persistedValueEqualV1(aggregate.retry, outcome.retry);
      }
      return outcome.terminal.completedAtMs === accepted.observedAtMs && aggregate.phase === "terminal" &&
        persistedValueEqualV1(aggregate.terminal, outcome.terminal);
    }
    case "request_cancellation": {
      if (evidence.kind === "cancellation_requested" && accepted.outcome.kind === "cancellation_requested") {
        if (!((aggregate.phase === "attempt_granted" || aggregate.phase === "executing") &&
          persistedValueEqualV1(evidence.outcome, accepted.outcome) &&
          persistedValueEqualV1(evidence.cancellation, aggregate.cancellation) &&
          persistedValueEqualV1(evidence.cancellation.reason, acceptance.command.reason) &&
          evidence.cancellation.requestedAtMs === accepted.observedAtMs &&
          terminalAttemptRefEqualV1(evidence.attempt, accepted.outcome.attempt) &&
          terminalAttemptRefEqualV1(evidence.attempt, aggregate.currentAttempt) &&
          requestedEffectKindsEqualV1(accepted, [
            "request_execution_cancellation", "publish_lifecycle_event", "notify_current_state",
          ]))) return false;
        const [request, publish] = accepted.requestedEffects.map((item) => item.effect);
        return request?.kind === "request_execution_cancellation" &&
          request.attemptId === evidence.attempt.attemptId &&
          request.executionFence === evidence.attempt.executionFence &&
          request.cancellationGeneration === evidence.cancellation.generation &&
          publish?.kind === "publish_lifecycle_event" && publish.observedAtMs === accepted.observedAtMs &&
          publish.event.kind === "cancellation_requested" &&
          publish.event.attemptNumber === evidence.attempt.attemptNumber &&
          publish.event.generation === evidence.cancellation.generation &&
          publish.event.reasonCode === evidence.cancellation.reason.code;
      }
      if (!(evidence.kind === "cancellation_resolved_without_attempt" &&
        accepted.outcome.kind === "terminal_cancelled" && aggregate.phase === "terminal" &&
        aggregate.terminal.kind === "cancelled" && aggregate.terminal.resolution === "without_active_attempt" &&
        persistedValueEqualV1(evidence.outcome, accepted.outcome) &&
        persistedValueEqualV1(evidence.cancellation, aggregate.cancellation) &&
        persistedValueEqualV1(evidence.cancellation.reason, acceptance.command.reason) &&
        evidence.cancellation.requestedAtMs === accepted.observedAtMs &&
        evidence.cancellation.resolvedAtMs === accepted.observedAtMs &&
        accepted.outcome.terminal.completedAtMs === accepted.observedAtMs &&
        persistedValueEqualV1(accepted.outcome.terminal, aggregate.terminal) &&
        requestedEffectKindsEqualV1(accepted, ["publish_lifecycle_event", "notify_current_state"]))) return false;
      const publish = accepted.requestedEffects[0]?.effect;
      return publish?.kind === "publish_lifecycle_event" && publish.observedAtMs === accepted.observedAtMs &&
        publish.event.kind === "run_cancelled" && publish.event.generation === aggregate.terminal.cancellationGeneration &&
        publish.event.reasonCode === aggregate.terminal.reason.code &&
        publish.event.cancellation.attemptNumber === null &&
        publish.event.cancellation.resolution === "without_active_attempt";
    }
    case "handle_lease_expiry": {
      if ((evidence.kind !== "lease_expiry_recovered" && evidence.kind !== "lease_expiry_cancelled") ||
        acceptance.command.attemptId !== evidence.attempt.attemptId ||
        acceptance.command.executionFence !== evidence.attempt.executionFence ||
        acceptance.command.expectedLeaseVersion !== evidence.expiredLeaseVersion ||
        aggregate.leaseHistory.kind !== "issued" ||
        aggregate.leaseHistory.lastLeaseVersion !== evidence.expiredLeaseVersion ||
        !persistedValueEqualV1(evidence.outcome, accepted.outcome)) return false;
      if (evidence.kind === "lease_expiry_recovered" && !leaseFailurePolicyCorrelatesV1(aggregate, evidence)) {
        return false;
      }
      const effects = accepted.requestedEffects.map((item) => item.effect);
      const release = effects[0];
      const publish = effects.at(-2);
      if (release?.kind !== "release_queue_ownership" || publish?.kind !== "publish_lifecycle_event" ||
        publish.observedAtMs !== accepted.observedAtMs) return false;
      if (accepted.outcome.kind === "retry_scheduled") {
        const wake = effects[1];
        return accepted.outcome.retry.acceptedAtMs === accepted.observedAtMs &&
          aggregate.phase === "retry_waiting" && persistedValueEqualV1(aggregate.retry, accepted.outcome.retry) &&
          terminalAttemptRefEqualV1(evidence.attempt, accepted.outcome.retry.previousAttempt) &&
          release.cause === (evidence.sourcePhase === "attempt_granted"
            ? "lease_expired_before_heartbeat" : "lease_expired_after_heartbeat") &&
          wake?.kind === "wake_retry" && wake.expectedRunVersion === accepted.acceptedRunVersion &&
          wake.notBeforeMs === accepted.outcome.retry.notBeforeMs &&
          publish.event.kind === "retry_scheduled" &&
          publish.event.previousAttemptNumber === evidence.attempt.attemptNumber &&
          publish.event.retry.source === "lease_expiry" && publish.event.retry.delivery === "durable" &&
          publish.event.notBeforeMs === accepted.outcome.retry.notBeforeMs &&
          requestedEffectKindsEqualV1(accepted, [
            "release_queue_ownership", "wake_retry", "publish_lifecycle_event", "notify_current_state",
          ]);
      }
      if (accepted.outcome.kind === "terminal_failed") {
        return accepted.outcome.terminal.completedAtMs === accepted.observedAtMs &&
          aggregate.phase === "terminal" && persistedValueEqualV1(aggregate.terminal, accepted.outcome.terminal) &&
          accepted.outcome.terminal.attempt !== null &&
          terminalAttemptRefEqualV1(evidence.attempt, accepted.outcome.terminal.attempt) &&
          release.cause === (evidence.sourcePhase === "attempt_granted"
            ? "lease_expired_before_heartbeat" : "lease_expired_after_heartbeat") &&
          publish.event.kind === "run_failed" &&
          publish.event.attemptNumber === evidence.attempt.attemptNumber &&
          publish.event.failure.kind === accepted.outcome.terminal.failure.kind &&
          publish.event.failure.code === accepted.outcome.terminal.failure.code &&
          requestedEffectKindsEqualV1(accepted, [
            "release_queue_ownership", "publish_lifecycle_event", "notify_current_state",
          ]);
      }
      return accepted.outcome.kind === "terminal_cancelled" &&
        accepted.outcome.terminal.completedAtMs === accepted.observedAtMs && aggregate.phase === "terminal" &&
        persistedValueEqualV1(aggregate.terminal, accepted.outcome.terminal) &&
        accepted.outcome.terminal.attempt !== null &&
        terminalAttemptRefEqualV1(evidence.attempt, accepted.outcome.terminal.attempt) &&
        release.cause === "cancellation_lease_expired" && publish.event.kind === "run_cancelled" &&
        publish.event.generation === accepted.outcome.terminal.cancellationGeneration &&
        publish.event.reasonCode === accepted.outcome.terminal.reason.code &&
        publish.event.cancellation.attemptNumber === evidence.attempt.attemptNumber &&
        publish.event.cancellation.resolution === "lease_expired" &&
        requestedEffectKindsEqualV1(accepted, [
          "release_queue_ownership", "publish_lifecycle_event", "notify_current_state",
        ]);
    }
  }
}

function terminalCancellationCorrelatesV1(
  aggregate: Extract<TaskRunAttemptAggregateV1, { readonly phase: "terminal" }>,
): boolean {
  const { cancellation, terminal } = aggregate;
  if (terminal.kind === "succeeded" || terminal.kind === "failed") {
    return cancellation.kind === "not_requested" ||
      (cancellation.resolution === "superseded_by_completion" &&
        cancellation.resolvedAtMs === terminal.completedAtMs);
  }
  return cancellation.kind === "resolved" && cancellation.resolution === terminal.resolution &&
    cancellation.generation === terminal.cancellationGeneration &&
    persistedValueEqualV1(cancellation.reason, terminal.reason) &&
    cancellation.resolvedAtMs === terminal.completedAtMs;
}

const TaskRunAttemptAggregateBaseFieldsV1 = {
  version: Schema.Literal("flarex.task-run-attempt-aggregate.v1"),
  runId: TaskRunIdV1Schema,
  taskDefinitionRevisionId: TaskDefinitionRevisionIdV1Schema,
  createdAtMs: TaskDatabaseTimeMsV1Schema,
  runVersion: TaskRunVersionV1Schema,
  boundPolicy: TaskRunAttemptBoundPolicyV1Schema,
  attemptHistory: TaskAttemptHistoryCursorV1Schema,
  leaseHistory: TaskLeaseHistoryCursorV1Schema,
  lastLifecycleAcceptance: Schema.NullOr(TaskRunAttemptMutationAcceptanceV1Schema),
  completionReplays: Schema.Array(TaskAttemptCompletionReplayV1Schema).check(
    Schema.isMaxLength(250),
  ),
  requestedEffectCursor: TaskRequestedEffectCursorV1Schema,
};
export const TaskRunAttemptAggregateV1Schema: Schema.Codec<
  TaskRunAttemptAggregateV1,
  unknown,
  never,
  never
> = Schema.Union([
  Schema.Struct({
    ...TaskRunAttemptAggregateBaseFieldsV1,
    phase: Schema.Literal("ready"),
    ready: TaskRunReadyStateV1Schema,
    cancellation: TaskCancellationNotRequestedV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    ...TaskRunAttemptAggregateBaseFieldsV1,
    phase: Schema.Literal("attempt_granted"),
    currentAttempt: TaskCurrentAttemptV1Schema,
    heartbeat: Schema.Struct({ kind: Schema.Literal("none_accepted") }).annotate(STRICT_STRUCT_OPTIONS),
    cancellation: Schema.Union([TaskCancellationNotRequestedV1Schema, TaskCancellationRequestedV1Schema]),
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    ...TaskRunAttemptAggregateBaseFieldsV1,
    phase: Schema.Literal("executing"),
    currentAttempt: TaskCurrentAttemptV1Schema,
    heartbeat: Schema.Struct({
      kind: Schema.Literal("accepted"),
      highestSequence: TaskHeartbeatSequenceV1Schema,
    }).annotate(STRICT_STRUCT_OPTIONS),
    cancellation: Schema.Union([TaskCancellationNotRequestedV1Schema, TaskCancellationRequestedV1Schema]),
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    ...TaskRunAttemptAggregateBaseFieldsV1,
    phase: Schema.Literal("retry_waiting"),
    retry: TaskAcceptedRetryV1Schema,
    cancellation: TaskCancellationNotRequestedV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    ...TaskRunAttemptAggregateBaseFieldsV1,
    phase: Schema.Literal("terminal"),
    terminal: Schema.Union([TaskRunSucceededTerminalV1Schema, TaskRunFailedTerminalV1Schema]),
    cancellation: CompletionTerminalCancellationStateV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    ...TaskRunAttemptAggregateBaseFieldsV1,
    phase: Schema.Literal("terminal"),
    terminal: TaskRunCancelledWithoutAttemptTerminalV1Schema,
    cancellation: TaskCancellationResolvedWithoutAttemptV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    ...TaskRunAttemptAggregateBaseFieldsV1,
    phase: Schema.Literal("terminal"),
    terminal: TaskRunAcknowledgedCancellationTerminalV1Schema,
    cancellation: TaskCancellationResolvedAcknowledgedV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    ...TaskRunAttemptAggregateBaseFieldsV1,
    phase: Schema.Literal("terminal"),
    terminal: TaskRunLeaseExpiredCancellationTerminalV1Schema,
    cancellation: TaskCancellationResolvedLeaseExpiredV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
]).check(
  Schema.makeFilter((aggregate) => {
    const maximumAttempts = aggregate.boundPolicy.runAttempt.retry.maxAttempts;
    const lastAttempt = aggregate.attemptHistory.kind === "none" ? null : aggregate.attemptHistory.lastAttemptNumber;
    if ((aggregate.attemptHistory.kind === "none") !== (aggregate.leaseHistory.kind === "none")) {
      return "Expected attempt and lease histories to be issued together";
    }
    if (lastAttempt !== null && lastAttempt > maximumAttempts) {
      return "Expected attempt history not to exceed the bound attempt limit";
    }
    if (aggregate.phase === "attempt_granted" || aggregate.phase === "executing") {
      if (lastAttempt === null || aggregate.leaseHistory.kind !== "issued" ||
        aggregate.currentAttempt.attemptNumber !== lastAttempt ||
        aggregate.currentAttempt.lease.version !== aggregate.leaseHistory.lastLeaseVersion) {
        return "Expected active attempt and lease to equal their history cursors";
      }
      if (aggregate.currentAttempt.grantBasisRunVersion >= aggregate.runVersion ||
        aggregate.currentAttempt.grantedAtMs < aggregate.createdAtMs ||
        aggregate.currentAttempt.lease.renewedAtMs < aggregate.currentAttempt.grantedAtMs ||
        aggregate.currentAttempt.lease.expiresAtMs - aggregate.currentAttempt.lease.renewedAtMs !==
          aggregate.boundPolicy.leaseDurationMs) {
        return "Expected active grant and lease timestamps to agree with the bound policy";
      }
    }
    if (aggregate.phase === "ready") {
      if (aggregate.ready.kind === "initial") {
        if (lastAttempt !== null || aggregate.leaseHistory.kind !== "none" ||
          aggregate.lastLifecycleAcceptance !== null || aggregate.completionReplays.length !== 0) {
          return "Expected initial ready aggregate to have no lifecycle history";
        }
      } else if (aggregate.ready.eligibleAtMs < aggregate.createdAtMs || lastAttempt === null ||
        aggregate.ready.acceptedRetry.previousAttempt.attemptNumber !== lastAttempt || lastAttempt >= maximumAttempts) {
        return "Expected immediate retry to name the last attempt and leave a next attempt";
      }
    }
    if (aggregate.phase === "retry_waiting" && (aggregate.retry.acceptedAtMs < aggregate.createdAtMs ||
      aggregate.retry.notBeforeMs < aggregate.retry.acceptedAtMs || lastAttempt === null ||
      aggregate.retry.previousAttempt.attemptNumber !== lastAttempt || lastAttempt >= maximumAttempts)) {
      return "Expected durable retry to name the last attempt and leave a next attempt";
    }
    if (aggregate.phase === "terminal") {
      const terminalAttempt = aggregate.terminal.attempt;
      if ((terminalAttempt === null && aggregate.terminal.kind === "failed" && lastAttempt !== null) ||
        (terminalAttempt !== null && (lastAttempt === null || terminalAttempt.attemptNumber !== lastAttempt))) {
        return "Expected terminal attempt to agree with the last issued attempt";
      }
      if (!terminalCancellationCorrelatesV1(aggregate)) {
        return "Expected terminal outcome and cancellation resolution to agree exactly";
      }
      if (aggregate.terminal.completedAtMs < aggregate.createdAtMs) {
        return "Expected terminal completion not to precede run creation";
      }
    }
    if (aggregate.cancellation.kind !== "not_requested" &&
      aggregate.cancellation.requestedAtMs < aggregate.createdAtMs) {
      return "Expected cancellation request not to precede run creation";
    }
    if (aggregate.cancellation.kind === "resolved" &&
      aggregate.cancellation.resolvedAtMs < aggregate.cancellation.requestedAtMs) {
      return "Expected cancellation resolution not to precede its request";
    }
    if (aggregate.lastLifecycleAcceptance !== null &&
      aggregate.lastLifecycleAcceptance.accepted.acceptedRunVersion > aggregate.runVersion) {
      return "Expected accepted receipt version not to exceed aggregate version";
    }
    const expectedCursor = aggregate.requestedEffectCursor.kind === "none"
      ? 0n
      : aggregate.requestedEffectCursor.lastSequence;
    const acceptance = aggregate.lastLifecycleAcceptance;
    if (acceptance === null) {
      if (aggregate.phase !== "ready" || aggregate.ready.kind !== "initial" ||
        aggregate.completionReplays.length !== 0) {
        return "Expected only an initial ready aggregate to omit lifecycle acceptance";
      }
    } else {
      const accepted = acceptance.accepted;
      if (accepted.acceptedRunVersion !== aggregate.runVersion || accepted.resultingPhase !== aggregate.phase ||
        accepted.observedAtMs < aggregate.createdAtMs) {
        return "Expected latest acceptance to agree with aggregate version and phase";
      }
      const evidence = accepted.evidence[0];
      if (evidence === undefined || evidence.runId !== aggregate.runId ||
        evidence.acceptedRunVersion !== accepted.acceptedRunVersion ||
        evidence.recordedAtMs !== accepted.observedAtMs ||
        evidence.resultingPhase !== accepted.resultingPhase) {
        return "Expected latest acceptance evidence to agree with its receipt";
      }
      const firstAcceptedEffect = accepted.requestedEffects[0];
      if (firstAcceptedEffect === undefined) return "Expected latest acceptance to contain requested effects";
      for (let index = 0; index < accepted.requestedEffects.length; index += 1) {
        const persisted = accepted.requestedEffects[index];
        if (persisted === undefined || persisted.sequence !== firstAcceptedEffect.sequence + BigInt(index) ||
          persisted.effect.runId !== aggregate.runId ||
          persisted.effect.acceptedRunVersion !== accepted.acceptedRunVersion) {
          return "Expected latest acceptance effects to be contiguous and receipt-bound";
        }
      }
      if (accepted.requestedEffects.at(-1)?.sequence !== expectedCursor) {
        return "Expected latest accepted effect sequence to equal aggregate cursor";
      }
      if (!latestAcceptanceCorrelatesV1(aggregate, acceptance)) {
        return "Expected latest lifecycle acceptance to agree with its command and aggregate outcome";
      }
    }
    const replayKeys = new Set<string>();
    let previousReplayAttempt = 0;
    let previousReplayAcceptedVersion = 0n;
    let previousReplayEffectSequence = 0n;
    for (const replay of aggregate.completionReplays) {
      const key = `${replay.attempt.attemptId}:${replay.attempt.executionFence}`;
      if (replayKeys.has(key)) return "Expected one completion replay per attempt and fence";
      replayKeys.add(key);
      if (lastAttempt === null || replay.attempt.attemptNumber <= previousReplayAttempt ||
        replay.attempt.attemptNumber > lastAttempt || replay.attempt.attemptNumber > maximumAttempts) {
        return "Expected completion replay attempts to be unique, ordered, and within attempt history";
      }
      previousReplayAttempt = replay.attempt.attemptNumber;
      if (replay.accepted.acceptedRunVersion <= previousReplayAcceptedVersion ||
        replay.accepted.acceptedRunVersion > aggregate.runVersion ||
        replay.accepted.observedAtMs < aggregate.createdAtMs) {
        return "Expected completion replay versions and timestamps to increase within the run lifetime";
      }
      previousReplayAcceptedVersion = replay.accepted.acceptedRunVersion;
      const evidence = replay.accepted.evidence[0];
      if (evidence === undefined || evidence.runId !== aggregate.runId ||
        evidence.acceptedRunVersion !== replay.accepted.acceptedRunVersion ||
        evidence.recordedAtMs !== replay.accepted.observedAtMs ||
        evidence.resultingPhase !== replay.accepted.resultingPhase ||
        !("attempt" in evidence) || evidence.attempt === null ||
        evidence.attempt.attemptId !== replay.attempt.attemptId ||
        evidence.attempt.executionFence !== replay.attempt.executionFence ||
        evidence.attempt.attemptNumber !== replay.attempt.attemptNumber) {
        return "Expected completion replay evidence to agree with its receipt and attempt";
      }
      const firstReplayEffect = replay.accepted.requestedEffects[0];
      if (firstReplayEffect === undefined) return "Expected completion replay to contain requested effects";
      if (firstReplayEffect.sequence <= previousReplayEffectSequence) {
        return "Expected completion replay effect ranges to increase without overlap";
      }
      for (let index = 0; index < replay.accepted.requestedEffects.length; index += 1) {
        const persisted = replay.accepted.requestedEffects[index];
        if (persisted === undefined || persisted.sequence !== firstReplayEffect.sequence + BigInt(index) ||
          persisted.effect.runId !== aggregate.runId ||
          persisted.effect.acceptedRunVersion !== replay.accepted.acceptedRunVersion) {
          return "Expected completion replay effects to be contiguous and receipt-bound";
        }
      }
      const lastReplayEffect = replay.accepted.requestedEffects.at(-1);
      if (lastReplayEffect === undefined || lastReplayEffect.sequence > expectedCursor) {
        return "Expected completion replay effects not to exceed aggregate cursor";
      }
      previousReplayEffectSequence = lastReplayEffect.sequence;
      if (!completionReplayCorrelatesV1(replay, aggregate)) {
        return "Expected completion replay, evidence, outcome, and effect plan to agree";
      }
    }
    if (acceptance !== null && acceptance.kind !== "complete_attempt" &&
      acceptance.accepted.requestedEffects[0] !== undefined &&
      acceptance.accepted.requestedEffects[0].sequence <= previousReplayEffectSequence) {
      return "Expected completion replay effects to precede the latest non-completion acceptance";
    }
    return undefined;
  }),
);

const decodeTaskRunAttemptAggregateSchemaV1: (
  input: unknown,
) => Result.Result<TaskRunAttemptAggregateV1, Schema.SchemaError> = Schema.decodeUnknownResult(
  TaskRunAttemptAggregateV1Schema,
  STRICT_PARSE_OPTIONS,
);
export const decodeTaskRunAttemptAggregateV1 = (
  input: unknown,
): Result.Result<TaskRunAttemptAggregateV1, Schema.SchemaError> =>
  decodeTaskRunAttemptAggregateSchemaV1(input).pipe(Result.map(snapshotTaskRunAttemptAggregateV1));
export const encodeTaskRunAttemptAggregateV1: (
  input: unknown,
) => Result.Result<unknown, Schema.SchemaError> = Schema.encodeUnknownResult(
  TaskRunAttemptAggregateV1Schema,
  STRICT_PARSE_OPTIONS,
);
export const decodeRunAttemptStateV1: (
  input: unknown,
) => Result.Result<RunAttemptStateV1, Schema.SchemaError> = Schema.decodeUnknownResult(
  RunAttemptStateV1Schema,
  STRICT_PARSE_OPTIONS,
);
export const decodeRunAttemptInspectionV1: (
  input: unknown,
) => Result.Result<RunAttemptInspectionV1, Schema.SchemaError> = Schema.decodeUnknownResult(
  RunAttemptInspectionV1Schema,
  STRICT_PARSE_OPTIONS,
);

export const StartAttemptCommandV1Schema = Schema.Struct({
  type: Schema.Literal("start_attempt"),
  runId: TaskRunIdV1Schema,
  expectedRunVersion: TaskRunVersionV1Schema,
  retryJitter: TaskRetryJitterV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);
export const HeartbeatAttemptCommandV1Schema = Schema.Struct({
  type: Schema.Literal("heartbeat_attempt"),
  runId: TaskRunIdV1Schema,
  attemptId: TaskAttemptIdV1Schema,
  executionFence: TaskExecutionFenceV1Schema,
  heartbeatSequence: TaskHeartbeatSequenceV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);
export const CompleteAttemptCommandV1Schema = Schema.Struct({
  type: Schema.Literal("complete_attempt"),
  runId: TaskRunIdV1Schema,
  attemptId: TaskAttemptIdV1Schema,
  executionFence: TaskExecutionFenceV1Schema,
  completion: TaskAttemptCompletionV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);
export const RequestCancellationCommandV1Schema = Schema.Struct({
  type: Schema.Literal("request_cancellation"),
  runId: TaskRunIdV1Schema,
  reason: TaskCancellationReasonV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);
export const HandleLeaseExpiryCommandV1Schema = Schema.Struct({
  type: Schema.Literal("handle_lease_expiry"),
  runId: TaskRunIdV1Schema,
  attemptId: TaskAttemptIdV1Schema,
  executionFence: TaskExecutionFenceV1Schema,
  expectedLeaseVersion: TaskLeaseVersionV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);
export const InspectCurrentAttemptCommandV1Schema = Schema.Struct({
  type: Schema.Literal("inspect_current_attempt"),
  runId: TaskRunIdV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);
export const RunAttemptCommandV1Schema = Schema.Union([
  StartAttemptCommandV1Schema,
  HeartbeatAttemptCommandV1Schema,
  CompleteAttemptCommandV1Schema,
  RequestCancellationCommandV1Schema,
  HandleLeaseExpiryCommandV1Schema,
  InspectCurrentAttemptCommandV1Schema,
]);

export const decodeTaskDefinitionRevisionIdV1 = Schema.decodeUnknownResult(
  TaskDefinitionRevisionIdV1Schema,
  STRICT_PARSE_OPTIONS,
);
export const decodeTaskRunIdV1 = Schema.decodeUnknownResult(TaskRunIdV1Schema, STRICT_PARSE_OPTIONS);
export const decodeTaskAttemptIdV1 = Schema.decodeUnknownResult(TaskAttemptIdV1Schema, STRICT_PARSE_OPTIONS);
export const decodeTaskAttemptNumberV1 = Schema.decodeUnknownResult(TaskAttemptNumberV1Schema, STRICT_PARSE_OPTIONS);
export const decodeTaskExecutionFenceV1 = Schema.decodeUnknownResult(TaskExecutionFenceV1Schema, STRICT_PARSE_OPTIONS);
export const decodeTaskRunVersionV1 = Schema.decodeUnknownResult(TaskRunVersionV1Schema, STRICT_PARSE_OPTIONS);
export const decodeTaskLeaseVersionV1 = Schema.decodeUnknownResult(TaskLeaseVersionV1Schema, STRICT_PARSE_OPTIONS);
export const decodeTaskCancellationGenerationV1 = Schema.decodeUnknownResult(TaskCancellationGenerationV1Schema, STRICT_PARSE_OPTIONS);
export const decodeTaskRequestedEffectSequenceV1 = Schema.decodeUnknownResult(TaskRequestedEffectSequenceV1Schema, STRICT_PARSE_OPTIONS);
export const decodeTaskHeartbeatSequenceV1 = Schema.decodeUnknownResult(TaskHeartbeatSequenceV1Schema, STRICT_PARSE_OPTIONS);
export const decodeTaskDatabaseTimeMsV1 = Schema.decodeUnknownResult(TaskDatabaseTimeMsV1Schema, STRICT_PARSE_OPTIONS);
export const decodeTaskDurationMsV1 = Schema.decodeUnknownResult(TaskDurationMsV1Schema, STRICT_PARSE_OPTIONS);
export const decodeTaskExecutionDurationMsV1 = Schema.decodeUnknownResult(TaskExecutionDurationMsV1Schema, STRICT_PARSE_OPTIONS);
export const decodeTaskRetryJitterV1 = Schema.decodeUnknownResult(TaskRetryJitterV1Schema, STRICT_PARSE_OPTIONS);
export const decodeTaskRetryDirectiveV1 = Schema.decodeUnknownResult(TaskRetryDirectiveV1Schema, STRICT_PARSE_OPTIONS);
export const decodeTaskCancellationReasonV1 = Schema.decodeUnknownResult(TaskCancellationReasonV1Schema, STRICT_PARSE_OPTIONS);
export const decodeTaskExecutionFailureV1 = Schema.decodeUnknownResult(TaskExecutionFailureV1Schema, STRICT_PARSE_OPTIONS);
export const decodeTaskAttemptCompletionV1 = Schema.decodeUnknownResult(TaskAttemptCompletionV1Schema, STRICT_PARSE_OPTIONS);

function ownCompletion(completion: TaskAttemptCompletionV1): TaskAttemptCompletionV1 {
  if (completion.kind !== "succeeded" || completion.result === null) return completion;
  return {
    ...completion,
    result: { ...completion.result, sha256: completion.result.sha256.slice() },
  };
}

type DecodedCommand =
  | StartAttemptCommandV1
  | HeartbeatAttemptCommandV1
  | CompleteAttemptCommandV1
  | RequestCancellationCommandV1
  | HandleLeaseExpiryCommandV1
  | InspectCurrentAttemptCommandV1;

const startCommandDecoder = Schema.decodeUnknownResult(StartAttemptCommandV1Schema, STRICT_PARSE_OPTIONS);
const heartbeatCommandDecoder = Schema.decodeUnknownResult(HeartbeatAttemptCommandV1Schema, STRICT_PARSE_OPTIONS);
const completeCommandDecoder = Schema.decodeUnknownResult(CompleteAttemptCommandV1Schema, STRICT_PARSE_OPTIONS);
const cancellationCommandDecoder = Schema.decodeUnknownResult(RequestCancellationCommandV1Schema, STRICT_PARSE_OPTIONS);
const leaseExpiryCommandDecoder = Schema.decodeUnknownResult(HandleLeaseExpiryCommandV1Schema, STRICT_PARSE_OPTIONS);
const inspectionCommandDecoder = Schema.decodeUnknownResult(InspectCurrentAttemptCommandV1Schema, STRICT_PARSE_OPTIONS);

function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function commandIssue(
  operation: RunAttemptOperationV1,
  input: unknown,
): InvalidRunAttemptCommandError["issue"] {
  if (!isUnknownRecord(input)) return "invalid_shape";
  if (input.type !== operation) return "invalid_shape";
  if (Result.isFailure(decodeTaskRunIdV1(input.runId))) return "invalid_identifier";
  switch (operation) {
    case "start_attempt":
      return Result.isFailure(decodeTaskRunVersionV1(input.expectedRunVersion)) ||
        Result.isFailure(decodeTaskRetryJitterV1(input.retryJitter))
        ? "invalid_number"
        : "invalid_shape";
    case "heartbeat_attempt":
      return Result.isFailure(decodeTaskAttemptIdV1(input.attemptId)) ||
        Result.isFailure(decodeTaskExecutionFenceV1(input.executionFence))
        ? "invalid_identifier"
        : Result.isFailure(decodeTaskHeartbeatSequenceV1(input.heartbeatSequence))
          ? "invalid_number"
          : "invalid_shape";
    case "complete_attempt":
      return Result.isFailure(decodeTaskAttemptIdV1(input.attemptId)) ||
        Result.isFailure(decodeTaskExecutionFenceV1(input.executionFence))
        ? "invalid_identifier"
        : Result.isFailure(decodeTaskAttemptCompletionV1(input.completion))
          ? "invalid_completion"
          : "invalid_shape";
    case "request_cancellation":
      return Result.isFailure(decodeTaskCancellationReasonV1(input.reason))
        ? "invalid_cancellation_reason"
        : "invalid_shape";
    case "handle_lease_expiry":
      return Result.isFailure(decodeTaskAttemptIdV1(input.attemptId)) ||
        Result.isFailure(decodeTaskExecutionFenceV1(input.executionFence))
        ? "invalid_identifier"
        : Result.isFailure(decodeTaskLeaseVersionV1(input.expectedLeaseVersion))
          ? "invalid_number"
          : "invalid_shape";
    case "inspect_current_attempt":
      return "invalid_shape";
  }
}

function decodeForOperation(
  operation: RunAttemptOperationV1,
  input: unknown,
): Result.Result<DecodedCommand, Schema.SchemaError> {
  switch (operation) {
    case "start_attempt": return startCommandDecoder(input);
    case "heartbeat_attempt": return heartbeatCommandDecoder(input);
    case "complete_attempt": return completeCommandDecoder(input);
    case "request_cancellation": return cancellationCommandDecoder(input);
    case "handle_lease_expiry": return leaseExpiryCommandDecoder(input);
    case "inspect_current_attempt": return inspectionCommandDecoder(input);
  }
}

export function decodeRunAttemptCommandV1(
  operation: RunAttemptOperationV1,
  input: unknown,
): Result.Result<RunAttemptCommandV1, InvalidRunAttemptCommandError> {
  return decodeForOperation(operation, input).pipe(
    Result.map((command): DecodedCommand => command.type === "complete_attempt"
      ? { ...command, completion: ownCompletion(command.completion) }
      : command),
    Result.mapError(() => new InvalidRunAttemptCommandError({
      operation,
      issue: commandIssue(operation, input),
    })),
  );
}

export type {
  CompleteAttemptCommandV1,
  HandleLeaseExpiryCommandV1,
  HeartbeatAttemptCommandV1,
  InspectCurrentAttemptCommandV1,
  RequestCancellationCommandV1,
  RunAttemptCommandV1,
  StartAttemptCommandV1,
  TaskAttemptCompletionV1,
  TaskAttemptIdV1,
  TaskAttemptNumberV1,
  TaskCancellationGenerationV1,
  TaskCancellationReasonV1,
  TaskDatabaseTimeMsV1,
  TaskDefinitionRevisionIdV1,
  TaskDurationMsV1,
  TaskExecutionDurationMsV1,
  TaskExecutionFailureV1,
  TaskExecutionFenceV1,
  TaskFailureMessageV1,
  TaskHeartbeatSequenceV1,
  TaskLeaseVersionV1,
  TaskRequestedEffectSequenceV1,
  TaskResultCommitmentV1,
  TaskRetryDirectiveV1,
  TaskRetryJitterV1,
  TaskRunIdV1,
  TaskRunVersionV1,
};
