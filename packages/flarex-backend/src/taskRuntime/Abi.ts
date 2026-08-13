import {
  TaskComputeDispatchIdentityV1Schema,
  TaskComputeExecutionIdV1Schema,
  type TaskComputeDispatchIdentityV1,
  type TaskComputeDispatchRequestV1,
  type TaskComputeExecutionIdV1,
  validateTaskComputeDispatchRequestV1,
} from "@flarex/durable-task/internal/compute-provider-v1";
import {
  TaskCancellationGenerationV1Schema,
  type TaskCancellationGenerationV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import {
  decodeTaskInputReferenceV1,
  type TaskInputReferenceV1,
} from "@flarex/durable-task/internal/run-creation-v1";
import { isNonArrayRecord } from "@flarex/utils/records";
import {
  decodeTaskDefinitionRuntimeBindingV1,
  TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
  type TaskDefinitionRuntimeBindingV1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import { Data, Result, Schema } from "effect";

export const TASK_RUNTIME_START_REQUEST_VERSION_V1 = 1 as const;
export const TASK_RUNTIME_START_ACCEPTANCE_VERSION_V1 = 1 as const;
export const TASK_RUNTIME_CANCELLATION_REQUEST_VERSION_V1 = 1 as const;
export const TASK_RUNTIME_CANCELLATION_ACCEPTANCE_VERSION_V1 = 1 as const;

export interface TaskRuntimeStartRequestV1 {
  readonly version: typeof TASK_RUNTIME_START_REQUEST_VERSION_V1;
  readonly bridgeAbiIdentity: typeof TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1;
  readonly dispatch: TaskComputeDispatchRequestV1;
  readonly executionId: TaskComputeExecutionIdV1;
  readonly runtimeBinding: TaskDefinitionRuntimeBindingV1;
  readonly inputReference: TaskInputReferenceV1;
  readonly correlationToken: string;
}

export interface TaskRuntimeStartAcceptanceV1 {
  readonly version: typeof TASK_RUNTIME_START_ACCEPTANCE_VERSION_V1;
  readonly bridgeAbiIdentity: typeof TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1;
  readonly kind: "accepted";
  readonly identity: TaskComputeDispatchIdentityV1;
  readonly executionId: TaskComputeExecutionIdV1;
  readonly correlationToken: string;
}

export interface TaskRuntimeCancellationRequestV1 {
  readonly version: typeof TASK_RUNTIME_CANCELLATION_REQUEST_VERSION_V1;
  readonly bridgeAbiIdentity: typeof TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1;
  readonly identity: TaskComputeDispatchIdentityV1;
  readonly executionId: TaskComputeExecutionIdV1;
  readonly cancellationGeneration: TaskCancellationGenerationV1;
  readonly correlationToken: string;
}

export interface TaskRuntimeCancellationAcceptanceV1 {
  readonly version: typeof TASK_RUNTIME_CANCELLATION_ACCEPTANCE_VERSION_V1;
  readonly bridgeAbiIdentity: typeof TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1;
  readonly kind: "interruption_requested";
  readonly identity: TaskComputeDispatchIdentityV1;
  readonly executionId: TaskComputeExecutionIdV1;
  readonly cancellationGeneration: TaskCancellationGenerationV1;
  readonly correlationToken: string;
}

export type TaskRuntimeAbiOperation =
  | "decode_start_request"
  | "encode_start_request"
  | "decode_start_acceptance"
  | "encode_start_acceptance"
  | "decode_cancellation_request"
  | "encode_cancellation_request"
  | "decode_cancellation_acceptance"
  | "encode_cancellation_acceptance";

export class TaskRuntimeAbiError<
  Operation extends TaskRuntimeAbiOperation = TaskRuntimeAbiOperation,
> extends Data.TaggedError("TaskRuntimeAbiError")<{
  readonly operation: Operation;
  readonly reason:
    | "invalid_shape"
    | "invalid_dispatch"
    | "invalid_identity"
    | "invalid_execution_id"
    | "invalid_runtime_binding"
    | "invalid_input_reference"
    | "invalid_cancellation_generation"
    | "invalid_correlation_token";
  readonly path?: string;
  readonly cause?: unknown;
}> {}

const STRICT_PARSE_OPTIONS = { onExcessProperty: "error" } as const;
const decodeDispatchIdentity = Schema.decodeUnknownResult(
  Schema.toType(TaskComputeDispatchIdentityV1Schema),
  STRICT_PARSE_OPTIONS,
);
const decodeExecutionId = Schema.decodeUnknownResult(
  Schema.toType(TaskComputeExecutionIdV1Schema),
  STRICT_PARSE_OPTIONS,
);
const validateCancellationGeneration = Schema.decodeUnknownResult(
  Schema.toType(TaskCancellationGenerationV1Schema),
  STRICT_PARSE_OPTIONS,
);

const START_REQUEST_KEYS = [
  "version",
  "bridgeAbiIdentity",
  "dispatch",
  "executionId",
  "runtimeBinding",
  "inputReference",
  "correlationToken",
] as const;
const START_ACCEPTANCE_KEYS = [
  "version",
  "bridgeAbiIdentity",
  "kind",
  "identity",
  "executionId",
  "correlationToken",
] as const;
const CANCELLATION_REQUEST_KEYS = [
  "version",
  "bridgeAbiIdentity",
  "identity",
  "executionId",
  "cancellationGeneration",
  "correlationToken",
] as const;
const CANCELLATION_ACCEPTANCE_KEYS = [
  "version",
  "bridgeAbiIdentity",
  "kind",
  "identity",
  "executionId",
  "cancellationGeneration",
  "correlationToken",
] as const;

export function decodeTaskRuntimeStartRequestV1(
  input: unknown,
): Result.Result<
  TaskRuntimeStartRequestV1,
  TaskRuntimeAbiError<"decode_start_request">
> {
  return parseStartRequest(input, "decode_start_request");
}

export function encodeTaskRuntimeStartRequestV1(
  input: TaskRuntimeStartRequestV1,
): Result.Result<
  TaskRuntimeStartRequestV1,
  TaskRuntimeAbiError<"encode_start_request">
> {
  return parseStartRequest(input, "encode_start_request");
}

export function decodeTaskRuntimeStartAcceptanceV1(
  input: unknown,
): Result.Result<
  TaskRuntimeStartAcceptanceV1,
  TaskRuntimeAbiError<"decode_start_acceptance">
> {
  return parseStartAcceptance(input, "decode_start_acceptance");
}

export function encodeTaskRuntimeStartAcceptanceV1(
  input: TaskRuntimeStartAcceptanceV1,
): Result.Result<
  TaskRuntimeStartAcceptanceV1,
  TaskRuntimeAbiError<"encode_start_acceptance">
> {
  return parseStartAcceptance(input, "encode_start_acceptance");
}

export function decodeTaskRuntimeCancellationRequestV1(
  input: unknown,
): Result.Result<
  TaskRuntimeCancellationRequestV1,
  TaskRuntimeAbiError<"decode_cancellation_request">
> {
  return parseCancellationRequest(input, "decode_cancellation_request");
}

export function encodeTaskRuntimeCancellationRequestV1(
  input: TaskRuntimeCancellationRequestV1,
): Result.Result<
  TaskRuntimeCancellationRequestV1,
  TaskRuntimeAbiError<"encode_cancellation_request">
> {
  return parseCancellationRequest(input, "encode_cancellation_request");
}

export function decodeTaskRuntimeCancellationAcceptanceV1(
  input: unknown,
): Result.Result<
  TaskRuntimeCancellationAcceptanceV1,
  TaskRuntimeAbiError<"decode_cancellation_acceptance">
> {
  return parseCancellationAcceptance(input, "decode_cancellation_acceptance");
}

export function encodeTaskRuntimeCancellationAcceptanceV1(
  input: TaskRuntimeCancellationAcceptanceV1,
): Result.Result<
  TaskRuntimeCancellationAcceptanceV1,
  TaskRuntimeAbiError<"encode_cancellation_acceptance">
> {
  return parseCancellationAcceptance(input, "encode_cancellation_acceptance");
}

function parseStartRequest<Operation extends
  | "decode_start_request"
  | "encode_start_request">(
  input: unknown,
  operation: Operation,
): Result.Result<TaskRuntimeStartRequestV1, TaskRuntimeAbiError<Operation>> {
  return Result.gen(function* () {
    const value = yield* captureExactRecord(
      input,
      START_REQUEST_KEYS,
      operation,
    );
    if (
      value.version !== TASK_RUNTIME_START_REQUEST_VERSION_V1 ||
      value.bridgeAbiIdentity !== TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1
    ) return yield* invalid(operation, "invalid_shape");
    const dispatch = yield* validateTaskComputeDispatchRequestV1(
      value.dispatch,
    ).pipe(Result.mapError((cause) => abiError(
      operation,
      "invalid_dispatch",
      "dispatch",
      cause,
    )));
    const executionId = yield* decodeExecutionId(value.executionId).pipe(
      Result.mapError((cause) => abiError(
        operation,
        "invalid_execution_id",
        "executionId",
        cause,
      )),
    );
    const runtimeBinding = yield* decodeTaskDefinitionRuntimeBindingV1(
      value.runtimeBinding,
    ).pipe(Result.mapError((cause) => abiError(
      operation,
      "invalid_runtime_binding",
      "runtimeBinding",
      cause,
    )));
    const inputReference = yield* decodeTaskInputReferenceV1(
      value.inputReference,
    ).pipe(Result.mapError((cause) => abiError(
      operation,
      "invalid_input_reference",
      "inputReference",
      cause,
    )));
    const correlationToken = yield* captureCorrelationToken(
      value.correlationToken,
      operation,
    );
    return Object.freeze({
      version: TASK_RUNTIME_START_REQUEST_VERSION_V1,
      bridgeAbiIdentity: TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
      dispatch,
      executionId,
      runtimeBinding,
      inputReference,
      correlationToken,
    });
  });
}

function parseStartAcceptance<Operation extends
  | "decode_start_acceptance"
  | "encode_start_acceptance">(
  input: unknown,
  operation: Operation,
): Result.Result<TaskRuntimeStartAcceptanceV1, TaskRuntimeAbiError<Operation>> {
  return Result.gen(function* () {
    const value = yield* captureExactRecord(
      input,
      START_ACCEPTANCE_KEYS,
      operation,
    );
    if (
      value.version !== TASK_RUNTIME_START_ACCEPTANCE_VERSION_V1 ||
      value.bridgeAbiIdentity !== TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1 ||
      value.kind !== "accepted"
    ) return yield* invalid(operation, "invalid_shape");
    const identity = yield* captureIdentity(value.identity, operation);
    const executionId = yield* captureExecutionId(value.executionId, operation);
    const correlationToken = yield* captureCorrelationToken(
      value.correlationToken,
      operation,
    );
    return Object.freeze({
      version: TASK_RUNTIME_START_ACCEPTANCE_VERSION_V1,
      bridgeAbiIdentity: TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
      kind: "accepted" as const,
      identity,
      executionId,
      correlationToken,
    });
  });
}

function parseCancellationRequest<Operation extends
  | "decode_cancellation_request"
  | "encode_cancellation_request">(
  input: unknown,
  operation: Operation,
): Result.Result<
  TaskRuntimeCancellationRequestV1,
  TaskRuntimeAbiError<Operation>
> {
  return Result.gen(function* () {
    const value = yield* captureExactRecord(
      input,
      CANCELLATION_REQUEST_KEYS,
      operation,
    );
    if (
      value.version !== TASK_RUNTIME_CANCELLATION_REQUEST_VERSION_V1 ||
      value.bridgeAbiIdentity !== TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1
    ) return yield* invalid(operation, "invalid_shape");
    const identity = yield* captureIdentity(value.identity, operation);
    const executionId = yield* captureExecutionId(value.executionId, operation);
    const cancellationGeneration = yield* captureCancellationGeneration(
      value.cancellationGeneration,
      operation,
    );
    const correlationToken = yield* captureCorrelationToken(
      value.correlationToken,
      operation,
    );
    return Object.freeze({
      version: TASK_RUNTIME_CANCELLATION_REQUEST_VERSION_V1,
      bridgeAbiIdentity: TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
      identity,
      executionId,
      cancellationGeneration,
      correlationToken,
    });
  });
}

function parseCancellationAcceptance<Operation extends
  | "decode_cancellation_acceptance"
  | "encode_cancellation_acceptance">(
  input: unknown,
  operation: Operation,
): Result.Result<
  TaskRuntimeCancellationAcceptanceV1,
  TaskRuntimeAbiError<Operation>
> {
  return Result.gen(function* () {
    const value = yield* captureExactRecord(
      input,
      CANCELLATION_ACCEPTANCE_KEYS,
      operation,
    );
    if (
      value.version !== TASK_RUNTIME_CANCELLATION_ACCEPTANCE_VERSION_V1 ||
      value.bridgeAbiIdentity !== TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1 ||
      value.kind !== "interruption_requested"
    ) return yield* invalid(operation, "invalid_shape");
    const identity = yield* captureIdentity(value.identity, operation);
    const executionId = yield* captureExecutionId(value.executionId, operation);
    const cancellationGeneration = yield* captureCancellationGeneration(
      value.cancellationGeneration,
      operation,
    );
    const correlationToken = yield* captureCorrelationToken(
      value.correlationToken,
      operation,
    );
    return Object.freeze({
      version: TASK_RUNTIME_CANCELLATION_ACCEPTANCE_VERSION_V1,
      bridgeAbiIdentity: TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
      kind: "interruption_requested" as const,
      identity,
      executionId,
      cancellationGeneration,
      correlationToken,
    });
  });
}

function captureIdentity<Operation extends TaskRuntimeAbiOperation>(
  input: unknown,
  operation: Operation,
): Result.Result<TaskComputeDispatchIdentityV1, TaskRuntimeAbiError<Operation>> {
  return decodeDispatchIdentity(input).pipe(Result.mapError((cause) => abiError(
    operation,
    "invalid_identity",
    "identity",
    cause,
  )));
}

function captureExecutionId<Operation extends TaskRuntimeAbiOperation>(
  input: unknown,
  operation: Operation,
): Result.Result<TaskComputeExecutionIdV1, TaskRuntimeAbiError<Operation>> {
  return decodeExecutionId(input).pipe(Result.mapError((cause) => abiError(
    operation,
    "invalid_execution_id",
    "executionId",
    cause,
  )));
}

function captureCancellationGeneration<Operation extends TaskRuntimeAbiOperation>(
  input: unknown,
  operation: Operation,
): Result.Result<
  TaskCancellationGenerationV1,
  TaskRuntimeAbiError<Operation>
> {
  return validateCancellationGeneration(input).pipe(
    Result.filterOrFail(
      (generation) => generation > 0n,
      () => abiError(
        operation,
        "invalid_cancellation_generation",
        "cancellationGeneration",
      ),
    ),
    Result.mapError((cause) => cause instanceof TaskRuntimeAbiError
      ? cause
      : abiError(
        operation,
        "invalid_cancellation_generation",
        "cancellationGeneration",
        cause,
      )),
  );
}

function captureCorrelationToken<Operation extends TaskRuntimeAbiOperation>(
  input: unknown,
  operation: Operation,
): Result.Result<string, TaskRuntimeAbiError<Operation>> {
  if (
    typeof input !== "string" || input.length < 1 || input.length > 255 ||
    !/^[!-~]+$/.test(input)
  ) {
    return invalid(
      operation,
      "invalid_correlation_token",
      "correlationToken",
    );
  }
  return Result.succeed(input);
}

function captureExactRecord<Operation extends TaskRuntimeAbiOperation>(
  input: unknown,
  expectedKeys: ReadonlyArray<string>,
  operation: Operation,
): Result.Result<
  Readonly<Record<string, unknown>>,
  TaskRuntimeAbiError<Operation>
> {
  return Result.try({
    try: () => {
      if (!isNonArrayRecord(input)) throw new TypeError("not_record");
      const keys = Reflect.ownKeys(input);
      if (
        keys.length !== expectedKeys.length ||
        keys.some((key) => typeof key !== "string") ||
        !expectedKeys.every((key) => keys.includes(key))
      ) throw new TypeError("keys");
      const capturedEntries: Array<readonly [string, unknown]> = [];
      for (const key of expectedKeys) {
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (
          descriptor === undefined || !("value" in descriptor) ||
          descriptor.enumerable !== true
        ) throw new TypeError("property");
        capturedEntries.push([key, descriptor.value]);
      }
      return Object.freeze(Object.fromEntries(capturedEntries));
    },
    catch: (cause) => abiError(operation, "invalid_shape", undefined, cause),
  });
}

function invalid<Operation extends TaskRuntimeAbiOperation>(
  operation: Operation,
  reason: TaskRuntimeAbiError<Operation>["reason"],
  path?: string,
): Result.Result<never, TaskRuntimeAbiError<Operation>> {
  return Result.fail(abiError(operation, reason, path));
}

function abiError<Operation extends TaskRuntimeAbiOperation>(
  operation: Operation,
  reason: TaskRuntimeAbiError<Operation>["reason"],
  path?: string,
  cause?: unknown,
): TaskRuntimeAbiError<Operation> {
  return new TaskRuntimeAbiError({
    operation,
    reason,
    ...(path === undefined ? {} : { path }),
    ...(cause === undefined ? {} : { cause }),
  });
}
