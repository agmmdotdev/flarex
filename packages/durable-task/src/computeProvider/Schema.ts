import { Result, Schema } from "effect";
import { ReplacementScopeIdV1Schema } from "flarex-protocol/storage-authority";

import {
  TaskAttemptIdV1Schema,
  TaskAttemptNumberV1Schema,
  TaskCancellationGenerationV1Schema,
  TaskComputeProfileRefV1Schema,
  TaskDefinitionRevisionIdV1Schema,
  TaskDurationMsV1Schema,
  TaskExecutionFenceV1Schema,
  TaskLeaseVersionV1Schema,
  TaskRequestedEffectSequenceV1Schema,
  TaskRunIdV1Schema,
} from "../runAttempt/Schema.js";
import {
  InvalidTaskComputeProviderValueError,
  type TaskComputeProviderValidationOperationV1,
} from "./Errors.js";
import {
  TASK_COMPUTE_CANCELLATION_RECEIPT_VERSION_V1,
  TASK_COMPUTE_CANCELLATION_REQUEST_VERSION_V1,
  TASK_COMPUTE_DISPATCH_ACCEPTANCE_VERSION_V1,
  TASK_COMPUTE_DISPATCH_IDENTITY_VERSION_V1,
  TASK_COMPUTE_DISPATCH_REQUEST_VERSION_V1,
  type TaskComputeCancellationProjectionV1,
  type TaskComputeCancellationReceiptV1,
  type TaskComputeCancellationRequestV1,
  type TaskComputeDispatchAcceptanceV1,
  type TaskComputeDispatchIdentityV1,
  type TaskComputeDispatchRequestV1,
  type TaskComputeExecutionRefV1,
  type TaskComputeProviderDescriptorV1,
} from "./Model.js";

const STRICT_STRUCT_OPTIONS = {
  parseOptions: { onExcessProperty: "error" },
} as const;
const STRICT_PARSE_OPTIONS = { onExcessProperty: "error" } as const;

export const TaskComputeProviderNameV1Schema = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9_-]{0,63}$/),
).pipe(Schema.brand("FlarexDurableTask/TaskComputeProviderNameV1"));

const VisibleAsciiV1Schema = Schema.String.check(
  Schema.makeFilter((value) => /^[\x21-\x7e]+$/.test(value)
    ? undefined
    : "Expected nonempty visible ASCII"),
);

export const TaskComputeProviderVersionV1Schema = VisibleAsciiV1Schema.check(
  Schema.makeFilter((value) => value.length <= 128
    ? undefined
    : "Expected a provider version no greater than 128 characters"),
).pipe(Schema.brand("FlarexDurableTask/TaskComputeProviderVersionV1"));

export const TaskComputeExecutionIdV1Schema = VisibleAsciiV1Schema.check(
  Schema.makeFilter((value) => value.length <= 255
    ? undefined
    : "Expected an execution ID no greater than 255 characters"),
).pipe(Schema.brand("FlarexDurableTask/TaskComputeExecutionIdV1"));

const PositiveTaskDurationMsV1Schema = TaskDurationMsV1Schema.check(
  Schema.makeFilter((value) => value > 0
    ? undefined
    : "Expected a positive maximum duration"),
);
const ZeroCancellationGenerationV1Schema = TaskCancellationGenerationV1Schema.check(
  Schema.makeFilter((value) => value === 0n
    ? undefined
    : "Expected zero cancellation generation"),
);
const PositiveCancellationGenerationV1Schema = TaskCancellationGenerationV1Schema.check(
  Schema.makeFilter((value) => value > 0n
    ? undefined
    : "Expected a positive cancellation generation"),
);

export const TaskComputeProviderDescriptorV1Schema = Schema.Struct({
  provider: TaskComputeProviderNameV1Schema,
  providerVersion: TaskComputeProviderVersionV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);

export const TaskComputeDispatchIdentityV1Schema = Schema.Struct({
  version: Schema.Literal(TASK_COMPUTE_DISPATCH_IDENTITY_VERSION_V1),
  scopeId: ReplacementScopeIdV1Schema,
  runId: TaskRunIdV1Schema,
  requestedEffectSequence: TaskRequestedEffectSequenceV1Schema,
  attemptId: TaskAttemptIdV1Schema,
  executionFence: TaskExecutionFenceV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);

export const TaskComputeCancellationProjectionV1Schema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("not_requested"),
    generation: ZeroCancellationGenerationV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
  Schema.Struct({
    kind: Schema.Literal("requested"),
    generation: PositiveCancellationGenerationV1Schema,
  }).annotate(STRICT_STRUCT_OPTIONS),
]);

export const TaskComputeDispatchRequestV1Schema = Schema.Struct({
  version: Schema.Literal(TASK_COMPUTE_DISPATCH_REQUEST_VERSION_V1),
  identity: TaskComputeDispatchIdentityV1Schema,
  taskDefinitionRevisionId: TaskDefinitionRevisionIdV1Schema,
  attemptNumber: TaskAttemptNumberV1Schema,
  leaseVersion: TaskLeaseVersionV1Schema,
  computeProfile: TaskComputeProfileRefV1Schema,
  cancellation: TaskComputeCancellationProjectionV1Schema,
  maximumDurationMs: PositiveTaskDurationMsV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);

export const TaskComputeExecutionRefV1Schema = Schema.Struct({
  provider: TaskComputeProviderNameV1Schema,
  providerVersion: TaskComputeProviderVersionV1Schema,
  executionId: TaskComputeExecutionIdV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);

export const TaskComputeDispatchAcceptanceV1Schema = Schema.Struct({
  version: Schema.Literal(TASK_COMPUTE_DISPATCH_ACCEPTANCE_VERSION_V1),
  kind: Schema.Literal("accepted"),
  identity: TaskComputeDispatchIdentityV1Schema,
  execution: TaskComputeExecutionRefV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);

export const TaskComputeCancellationRequestV1Schema = Schema.Struct({
  version: Schema.Literal(TASK_COMPUTE_CANCELLATION_REQUEST_VERSION_V1),
  identity: TaskComputeDispatchIdentityV1Schema,
  execution: TaskComputeExecutionRefV1Schema,
  cancellationGeneration: PositiveCancellationGenerationV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);

export const TaskComputeCancellationReceiptV1Schema = Schema.Struct({
  version: Schema.Literal(TASK_COMPUTE_CANCELLATION_RECEIPT_VERSION_V1),
  kind: Schema.Literal("interruption_requested"),
  identity: TaskComputeDispatchIdentityV1Schema,
  execution: TaskComputeExecutionRefV1Schema,
  cancellationGeneration: PositiveCancellationGenerationV1Schema,
}).annotate(STRICT_STRUCT_OPTIONS);

const decodeProviderDescriptor = Schema.decodeUnknownResult(
  TaskComputeProviderDescriptorV1Schema,
  STRICT_PARSE_OPTIONS,
);
const decodeDispatchRequest = Schema.decodeUnknownResult(
  TaskComputeDispatchRequestV1Schema,
  STRICT_PARSE_OPTIONS,
);
const validateDispatchRequest = Schema.decodeUnknownResult(
  Schema.toType(TaskComputeDispatchRequestV1Schema),
  STRICT_PARSE_OPTIONS,
);
const decodeDispatchAcceptance = Schema.decodeUnknownResult(
  TaskComputeDispatchAcceptanceV1Schema,
  STRICT_PARSE_OPTIONS,
);
const validateDispatchAcceptance = Schema.decodeUnknownResult(
  Schema.toType(TaskComputeDispatchAcceptanceV1Schema),
  STRICT_PARSE_OPTIONS,
);
const decodeCancellationRequest = Schema.decodeUnknownResult(
  TaskComputeCancellationRequestV1Schema,
  STRICT_PARSE_OPTIONS,
);
const validateCancellationRequest = Schema.decodeUnknownResult(
  Schema.toType(TaskComputeCancellationRequestV1Schema),
  STRICT_PARSE_OPTIONS,
);
const decodeCancellationReceipt = Schema.decodeUnknownResult(
  TaskComputeCancellationReceiptV1Schema,
  STRICT_PARSE_OPTIONS,
);
const validateCancellationReceipt = Schema.decodeUnknownResult(
  Schema.toType(TaskComputeCancellationReceiptV1Schema),
  STRICT_PARSE_OPTIONS,
);

const encodeDispatchRequest = Schema.encodeResult(TaskComputeDispatchRequestV1Schema);
const encodeDispatchAcceptance = Schema.encodeResult(TaskComputeDispatchAcceptanceV1Schema);
const encodeCancellationRequest = Schema.encodeResult(TaskComputeCancellationRequestV1Schema);
const encodeCancellationReceipt = Schema.encodeResult(TaskComputeCancellationReceiptV1Schema);

export function decodeTaskComputeProviderDescriptorV1(
  input: unknown,
): Result.Result<
  TaskComputeProviderDescriptorV1,
  InvalidTaskComputeProviderValueError<"decode_provider_descriptor">
> {
  const candidate = captureProviderDescriptor(input);
  return candidate === undefined
    ? Result.fail(invalid("decode_provider_descriptor"))
    : decodeProviderDescriptor(candidate).pipe(
      Result.map(snapshotTaskComputeProviderDescriptorV1),
      Result.mapError(() => invalid("decode_provider_descriptor")),
    );
}

export function decodeTaskComputeDispatchRequestV1(
  input: unknown,
): Result.Result<
  TaskComputeDispatchRequestV1,
  InvalidTaskComputeProviderValueError<"decode_dispatch_request">
> {
  return decodeCaptured(
    captureDispatchRequest(input),
    decodeDispatchRequest,
    "decode_dispatch_request",
    snapshotTaskComputeDispatchRequestV1,
  );
}

export function validateTaskComputeDispatchRequestV1(
  input: unknown,
): Result.Result<
  TaskComputeDispatchRequestV1,
  InvalidTaskComputeProviderValueError<"decode_dispatch_request">
> {
  return decodeCaptured(
    captureDispatchRequest(input),
    validateDispatchRequest,
    "decode_dispatch_request",
    snapshotTaskComputeDispatchRequestV1,
  );
}

export function decodeTaskComputeDispatchAcceptanceV1(
  input: unknown,
): Result.Result<
  TaskComputeDispatchAcceptanceV1,
  InvalidTaskComputeProviderValueError<"decode_dispatch_acceptance">
> {
  return decodeCaptured(
    captureDispatchAcceptance(input),
    decodeDispatchAcceptance,
    "decode_dispatch_acceptance",
    snapshotTaskComputeDispatchAcceptanceV1,
  );
}

export function validateTaskComputeDispatchAcceptanceV1(
  input: unknown,
): Result.Result<
  TaskComputeDispatchAcceptanceV1,
  InvalidTaskComputeProviderValueError<"decode_dispatch_acceptance">
> {
  return decodeCaptured(
    captureDispatchAcceptance(input),
    validateDispatchAcceptance,
    "decode_dispatch_acceptance",
    snapshotTaskComputeDispatchAcceptanceV1,
  );
}

export function decodeTaskComputeCancellationRequestV1(
  input: unknown,
): Result.Result<
  TaskComputeCancellationRequestV1,
  InvalidTaskComputeProviderValueError<"decode_cancellation_request">
> {
  return decodeCaptured(
    captureCancellationRequest(input),
    decodeCancellationRequest,
    "decode_cancellation_request",
    snapshotTaskComputeCancellationRequestV1,
  );
}

export function validateTaskComputeCancellationRequestV1(
  input: unknown,
): Result.Result<
  TaskComputeCancellationRequestV1,
  InvalidTaskComputeProviderValueError<"decode_cancellation_request">
> {
  return decodeCaptured(
    captureCancellationRequest(input),
    validateCancellationRequest,
    "decode_cancellation_request",
    snapshotTaskComputeCancellationRequestV1,
  );
}

export function decodeTaskComputeCancellationReceiptV1(
  input: unknown,
): Result.Result<
  TaskComputeCancellationReceiptV1,
  InvalidTaskComputeProviderValueError<"decode_cancellation_receipt">
> {
  return decodeCaptured(
    captureCancellationReceipt(input),
    decodeCancellationReceipt,
    "decode_cancellation_receipt",
    snapshotTaskComputeCancellationReceiptV1,
  );
}

export function validateTaskComputeCancellationReceiptV1(
  input: unknown,
): Result.Result<
  TaskComputeCancellationReceiptV1,
  InvalidTaskComputeProviderValueError<"decode_cancellation_receipt">
> {
  return decodeCaptured(
    captureCancellationReceipt(input),
    validateCancellationReceipt,
    "decode_cancellation_receipt",
    snapshotTaskComputeCancellationReceiptV1,
  );
}

export function encodeTaskComputeDispatchRequestV1(
  input: TaskComputeDispatchRequestV1,
): Result.Result<
  unknown,
  InvalidTaskComputeProviderValueError<"encode_dispatch_request">
> {
  return validateTaskComputeDispatchRequestV1(input).pipe(
    Result.mapError(() => invalid("encode_dispatch_request")),
    Result.flatMap((value) => encodeDispatchRequest(value).pipe(
      Result.mapError(() => invalid("encode_dispatch_request")),
    )),
  );
}

export function encodeTaskComputeDispatchAcceptanceV1(
  input: TaskComputeDispatchAcceptanceV1,
): Result.Result<
  unknown,
  InvalidTaskComputeProviderValueError<"encode_dispatch_acceptance">
> {
  return validateTaskComputeDispatchAcceptanceV1(input).pipe(
    Result.mapError(() => invalid("encode_dispatch_acceptance")),
    Result.flatMap((value) => encodeDispatchAcceptance(value).pipe(
      Result.mapError(() => invalid("encode_dispatch_acceptance")),
    )),
  );
}

export function encodeTaskComputeCancellationRequestV1(
  input: TaskComputeCancellationRequestV1,
): Result.Result<
  unknown,
  InvalidTaskComputeProviderValueError<"encode_cancellation_request">
> {
  return validateTaskComputeCancellationRequestV1(input).pipe(
    Result.mapError(() => invalid("encode_cancellation_request")),
    Result.flatMap((value) => encodeCancellationRequest(value).pipe(
      Result.mapError(() => invalid("encode_cancellation_request")),
    )),
  );
}

export function encodeTaskComputeCancellationReceiptV1(
  input: TaskComputeCancellationReceiptV1,
): Result.Result<
  unknown,
  InvalidTaskComputeProviderValueError<"encode_cancellation_receipt">
> {
  return validateTaskComputeCancellationReceiptV1(input).pipe(
    Result.mapError(() => invalid("encode_cancellation_receipt")),
    Result.flatMap((value) => encodeCancellationReceipt(value).pipe(
      Result.mapError(() => invalid("encode_cancellation_receipt")),
    )),
  );
}

export function snapshotTaskComputeProviderDescriptorV1(
  value: TaskComputeProviderDescriptorV1,
): TaskComputeProviderDescriptorV1 {
  return Object.freeze({ ...value });
}

export function snapshotTaskComputeDispatchIdentityV1(
  value: TaskComputeDispatchIdentityV1,
): TaskComputeDispatchIdentityV1 {
  return Object.freeze({ ...value });
}

export function snapshotTaskComputeExecutionRefV1(
  value: TaskComputeExecutionRefV1,
): TaskComputeExecutionRefV1 {
  return Object.freeze({ ...value });
}

export function snapshotTaskComputeDispatchRequestV1(
  value: TaskComputeDispatchRequestV1,
): TaskComputeDispatchRequestV1 {
  return Object.freeze({
    ...value,
    identity: snapshotTaskComputeDispatchIdentityV1(value.identity),
    cancellation: Object.freeze({ ...value.cancellation }),
  });
}

export function snapshotTaskComputeDispatchAcceptanceV1(
  value: TaskComputeDispatchAcceptanceV1,
): TaskComputeDispatchAcceptanceV1 {
  return Object.freeze({
    ...value,
    identity: snapshotTaskComputeDispatchIdentityV1(value.identity),
    execution: snapshotTaskComputeExecutionRefV1(value.execution),
  });
}

export function snapshotTaskComputeCancellationRequestV1(
  value: TaskComputeCancellationRequestV1,
): TaskComputeCancellationRequestV1 {
  return Object.freeze({
    ...value,
    identity: snapshotTaskComputeDispatchIdentityV1(value.identity),
    execution: snapshotTaskComputeExecutionRefV1(value.execution),
  });
}

export function snapshotTaskComputeCancellationReceiptV1(
  value: TaskComputeCancellationReceiptV1,
): TaskComputeCancellationReceiptV1 {
  return Object.freeze({
    ...value,
    identity: snapshotTaskComputeDispatchIdentityV1(value.identity),
    execution: snapshotTaskComputeExecutionRefV1(value.execution),
  });
}

type UnknownDecoder<Value> = (
  input: unknown,
) => Result.Result<Value, unknown>;

function decodeCaptured<Value, Operation extends TaskComputeProviderValidationOperationV1>(
  candidate: unknown | undefined,
  decoder: UnknownDecoder<Value>,
  operation: Operation,
  snapshot: (value: Value) => Value,
): Result.Result<Value, InvalidTaskComputeProviderValueError<Operation>> {
  return candidate === undefined
    ? Result.fail(invalid(operation))
    : decoder(candidate).pipe(
      Result.map(snapshot),
      Result.mapError(() => invalid(operation)),
    );
}

function invalid<Operation extends TaskComputeProviderValidationOperationV1>(
  operation: Operation,
): InvalidTaskComputeProviderValueError<Operation> {
  return new InvalidTaskComputeProviderValueError({
    operation,
    reason: "invalid_shape",
  });
}

function captureProviderDescriptor(input: unknown): unknown | undefined {
  return captureExactDataRecord(input, ["provider", "providerVersion"]);
}

function captureIdentity(input: unknown): unknown | undefined {
  return captureExactDataRecord(input, [
    "version",
    "scopeId",
    "runId",
    "requestedEffectSequence",
    "attemptId",
    "executionFence",
  ]);
}

function captureCancellationProjection(input: unknown): unknown | undefined {
  return captureExactDataRecord(input, ["kind", "generation"]);
}

function captureExecution(input: unknown): unknown | undefined {
  return captureExactDataRecord(input, [
    "provider",
    "providerVersion",
    "executionId",
  ]);
}

function captureDispatchRequest(input: unknown): unknown | undefined {
  const outer = captureExactDataRecord(input, [
    "version",
    "identity",
    "taskDefinitionRevisionId",
    "attemptNumber",
    "leaseVersion",
    "computeProfile",
    "cancellation",
    "maximumDurationMs",
  ]);
  if (outer === undefined) return undefined;
  const identity = captureIdentity(outer.identity);
  const cancellation = captureCancellationProjection(outer.cancellation);
  return identity === undefined || cancellation === undefined
    ? undefined
    : { ...outer, identity, cancellation };
}

function captureDispatchAcceptance(input: unknown): unknown | undefined {
  const outer = captureExactDataRecord(input, [
    "version",
    "kind",
    "identity",
    "execution",
  ]);
  if (outer === undefined) return undefined;
  const identity = captureIdentity(outer.identity);
  const execution = captureExecution(outer.execution);
  return identity === undefined || execution === undefined
    ? undefined
    : { ...outer, identity, execution };
}

function captureCancellationRequest(input: unknown): unknown | undefined {
  const outer = captureExactDataRecord(input, [
    "version",
    "identity",
    "execution",
    "cancellationGeneration",
  ]);
  if (outer === undefined) return undefined;
  const identity = captureIdentity(outer.identity);
  const execution = captureExecution(outer.execution);
  return identity === undefined || execution === undefined
    ? undefined
    : { ...outer, identity, execution };
}

function captureCancellationReceipt(input: unknown): unknown | undefined {
  const outer = captureExactDataRecord(input, [
    "version",
    "kind",
    "identity",
    "execution",
    "cancellationGeneration",
  ]);
  if (outer === undefined) return undefined;
  const identity = captureIdentity(outer.identity);
  const execution = captureExecution(outer.execution);
  return identity === undefined || execution === undefined
    ? undefined
    : { ...outer, identity, execution };
}

function captureExactDataRecord(
  input: unknown,
  expectedKeys: ReadonlyArray<string>,
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return undefined;
    }
    const keys = Reflect.ownKeys(input);
    if (keys.length !== expectedKeys.length) return undefined;
    const expected = new Set(expectedKeys);
    const captured: Record<string, unknown> = {};
    for (const key of keys) {
      if (typeof key !== "string" || !expected.has(key)) return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        descriptor === undefined ||
        descriptor.enumerable !== true ||
        !("value" in descriptor)
      ) return undefined;
      captured[key] = descriptor.value;
    }
    return captured;
  } catch {
    return undefined;
  }
}
