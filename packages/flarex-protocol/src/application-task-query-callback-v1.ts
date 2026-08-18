import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Result } from "effect";

import {
  FlarexValueRuntimeCoreV1Error,
  MAX_FLAREX_VALUE_ARRAY_ITEMS_V1,
  MAX_FLAREX_VALUE_NESTING_V1,
  MAX_FLAREX_VALUE_OBJECT_FIELDS_V1,
  normalizeFlarexRuntimeValueWithLimitsV1,
  type CanonicalFlarexRuntimeValueV1,
  type FlarexValueLimitsV1,
  type NormalizedFlarexRuntimeValueV1,
} from "./value-runtime-core";

export const APPLICATION_TASK_QUERY_CALLBACK_FORMAT_V1 =
  "flarex.application-task-query-callback" as const;
export const APPLICATION_TASK_QUERY_CALLBACK_VERSION_V1 = 1 as const;
export const MAX_APPLICATION_TASK_QUERY_FUNCTION_PATH_BYTES_V1 = 512;
export const MAX_APPLICATION_TASK_QUERY_ARGUMENT_BYTES_V1 = 1_048_576;
export const MAX_APPLICATION_TASK_QUERY_RESULT_BYTES_V1 = 8 * 1_048_576;
export const MAX_APPLICATION_TASK_QUERY_CALLS_V1 = 256;
export const MAX_APPLICATION_TASK_QUERY_CALL_ID_LENGTH_V1 = 512;
export const MAX_APPLICATION_TASK_QUERY_MILLISECONDS_V1 = 30_000;

export interface ApplicationTaskQueryCallbackRequestV1 {
  readonly format: typeof APPLICATION_TASK_QUERY_CALLBACK_FORMAT_V1;
  readonly version: typeof APPLICATION_TASK_QUERY_CALLBACK_VERSION_V1;
  readonly operation: "runQuery";
  readonly functionPath: string;
  readonly arguments: CanonicalFlarexRuntimeValueV1;
  readonly argumentSemanticBytes: number;
}

export type ApplicationTaskQueryCallbackFailureReasonV1 =
  | "invalid_request"
  | "stale_launch"
  | "query_failed"
  | "invalid_result"
  | "timed_out"
  | "interrupted"
  | "resource_exceeded";

export type ApplicationTaskQueryCallbackResultV1 =
  | Readonly<{
      readonly format: typeof APPLICATION_TASK_QUERY_CALLBACK_FORMAT_V1;
      readonly version: typeof APPLICATION_TASK_QUERY_CALLBACK_VERSION_V1;
      readonly kind: "success";
      readonly callId: string;
      readonly deadlineMs: number;
      readonly value: CanonicalFlarexRuntimeValueV1;
      readonly valueSemanticBytes: number;
    }>
  | Readonly<{
      readonly format: typeof APPLICATION_TASK_QUERY_CALLBACK_FORMAT_V1;
      readonly version: typeof APPLICATION_TASK_QUERY_CALLBACK_VERSION_V1;
      readonly kind: "failure";
      readonly callId: string;
      readonly deadlineMs: number;
      readonly reason: ApplicationTaskQueryCallbackFailureReasonV1;
    }>;

export interface ApplicationTaskQueryCallbackCapabilityV1 {
  readonly invoke: (request: unknown) => unknown | PromiseLike<unknown>;
}

export class ApplicationTaskQueryCallbackContractV1Error extends Data.TaggedError(
  "ApplicationTaskQueryCallbackContractV1Error",
)<{
  readonly boundary: "request" | "result";
  readonly reason:
    | "invalid_shape"
    | "invalid_value"
    | "value_size_mismatch"
    | "resource_exceeded";
  readonly path?: string;
  readonly cause?: unknown;
}> {}

const UTF8 = new TextEncoder();
const ARGUMENT_LIMITS = valueLimits(MAX_APPLICATION_TASK_QUERY_ARGUMENT_BYTES_V1);
const RESULT_LIMITS = valueLimits(MAX_APPLICATION_TASK_QUERY_RESULT_BYTES_V1);

export function decodeApplicationTaskQueryCallbackRequestV1(
  input: unknown,
): Result.Result<
  ApplicationTaskQueryCallbackRequestV1,
  ApplicationTaskQueryCallbackContractV1Error
> {
  const record = captureExactRecord(input, [
    "format", "version", "operation", "functionPath", "arguments",
    "argumentSemanticBytes",
  ]);
  if (record === undefined ||
    record.format !== APPLICATION_TASK_QUERY_CALLBACK_FORMAT_V1 ||
    record.version !== APPLICATION_TASK_QUERY_CALLBACK_VERSION_V1 ||
    record.operation !== "runQuery") {
    return Result.fail(failure("request", "invalid_shape"));
  }
  const functionPath = record.functionPath;
  if (typeof functionPath !== "string" || functionPath.trim().length === 0 ||
    UTF8.encode(functionPath).byteLength >
      MAX_APPLICATION_TASK_QUERY_FUNCTION_PATH_BYTES_V1 ||
    !isSemanticSize(
      record.argumentSemanticBytes,
      MAX_APPLICATION_TASK_QUERY_ARGUMENT_BYTES_V1,
    )) {
    return Result.fail(failure("request", "invalid_shape"));
  }
  return normalizeValue(record.arguments, "request", ARGUMENT_LIMITS).pipe(
    Result.flatMap(normalized => normalized.semanticSizeBytes ===
        record.argumentSemanticBytes
      ? Result.succeed(Object.freeze({
          format: APPLICATION_TASK_QUERY_CALLBACK_FORMAT_V1,
          version: APPLICATION_TASK_QUERY_CALLBACK_VERSION_V1,
          operation: "runQuery" as const,
          functionPath,
          arguments: normalized.value,
          argumentSemanticBytes: normalized.semanticSizeBytes,
        }))
      : Result.fail(failure(
          "request", "value_size_mismatch", "argumentSemanticBytes",
        ))),
  );
}

export function decodeApplicationTaskQueryCallbackResultV1(
  input: unknown,
): Result.Result<
  ApplicationTaskQueryCallbackResultV1,
  ApplicationTaskQueryCallbackContractV1Error
> {
  const record = captureResultRecord(input);
  if (record === undefined ||
    record.format !== APPLICATION_TASK_QUERY_CALLBACK_FORMAT_V1 ||
    record.version !== APPLICATION_TASK_QUERY_CALLBACK_VERSION_V1) {
    return Result.fail(failure("result", "invalid_shape"));
  }
  const callId = record.callId;
  const deadlineMs = record.deadlineMs;
  if (!isCallId(callId) || !isDeadline(deadlineMs)) {
    return Result.fail(failure("result", "invalid_shape"));
  }
  if (record.kind === "failure") {
    return isFailureReason(record.reason)
      ? Result.succeed(Object.freeze({
          format: APPLICATION_TASK_QUERY_CALLBACK_FORMAT_V1,
          version: APPLICATION_TASK_QUERY_CALLBACK_VERSION_V1,
          kind: "failure" as const,
          callId,
          deadlineMs,
          reason: record.reason,
        }))
      : Result.fail(failure("result", "invalid_shape", "reason"));
  }
  if (record.kind !== "success" ||
    !isSemanticSize(
      record.valueSemanticBytes,
      MAX_APPLICATION_TASK_QUERY_RESULT_BYTES_V1,
    )) return Result.fail(failure("result", "invalid_shape"));
  return normalizeValue(record.value, "result", RESULT_LIMITS).pipe(
    Result.flatMap(normalized => normalized.semanticSizeBytes ===
        record.valueSemanticBytes
      ? Result.succeed(Object.freeze({
          format: APPLICATION_TASK_QUERY_CALLBACK_FORMAT_V1,
          version: APPLICATION_TASK_QUERY_CALLBACK_VERSION_V1,
          kind: "success" as const,
          callId,
          deadlineMs,
          value: normalized.value,
          valueSemanticBytes: normalized.semanticSizeBytes,
        }))
      : Result.fail(failure(
          "result", "value_size_mismatch", "valueSemanticBytes",
        ))),
  );
}

export function normalizeApplicationTaskQueryCallbackValueV1(
  input: unknown,
  boundary: "request" | "result",
) {
  return normalizeValue(
    input,
    boundary,
    boundary === "request" ? ARGUMENT_LIMITS : RESULT_LIMITS,
  );
}

function valueLimits(maxSemanticBytes: number): FlarexValueLimitsV1 {
  return Object.freeze({
    profile: "generalValue" as const,
    maxSemanticBytes,
    maxNesting: MAX_FLAREX_VALUE_NESTING_V1,
    maxArrayItems: MAX_FLAREX_VALUE_ARRAY_ITEMS_V1,
    maxObjectFields: MAX_FLAREX_VALUE_OBJECT_FIELDS_V1,
    requireDocumentObject: false,
  });
}

function normalizeValue(
  input: unknown,
  boundary: "request" | "result",
  limits: FlarexValueLimitsV1,
): Result.Result<
  NormalizedFlarexRuntimeValueV1,
  ApplicationTaskQueryCallbackContractV1Error
> {
  try {
    return Result.succeed(normalizeFlarexRuntimeValueWithLimitsV1(input, limits));
  } catch (cause) {
    if (cause instanceof FlarexValueRuntimeCoreV1Error) {
      return Result.fail(failure(
        boundary,
        isResourceIssue(cause.issue.reason)
          ? "resource_exceeded"
          : "invalid_value",
        boundary === "request" ? "arguments" : "value",
        cause,
      ));
    }
    throw cause;
  }
}

function isResourceIssue(reason: string): boolean {
  return reason === "nestingTooDeep" || reason === "semanticBytesExceeded" ||
    reason === "arrayTooLong" || reason === "objectTooLarge";
}

function captureResultRecord(input: unknown) {
  const common = captureExactRecord(input, [
    "format", "version", "kind", "callId", "deadlineMs", "reason",
  ]);
  if (common !== undefined) return common;
  return captureExactRecord(input, [
    "format", "version", "kind", "callId", "deadlineMs", "value",
    "valueSemanticBytes",
  ]);
}

function captureExactRecord(input: unknown, keys: ReadonlyArray<string>) {
  try {
    if (!isNonArrayRecord(input)) return undefined;
    const observed = Reflect.ownKeys(input);
    if (observed.length !== keys.length || observed.some(key =>
      typeof key !== "string" || !keys.includes(key))) return undefined;
    const captured: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (descriptor === undefined || !descriptor.enumerable ||
        !("value" in descriptor)) return undefined;
      Object.defineProperty(captured, key, {
        enumerable: true,
        value: descriptor.value,
      });
    }
    return Object.freeze(captured);
  } catch {
    return undefined;
  }
}

function isSemanticSize(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) &&
    value >= 1 && value <= maximum;
}

function isDeadline(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isCallId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 &&
    value.length <= MAX_APPLICATION_TASK_QUERY_CALL_ID_LENGTH_V1;
}

function isFailureReason(
  value: unknown,
): value is ApplicationTaskQueryCallbackFailureReasonV1 {
  return value === "invalid_request" || value === "stale_launch" ||
    value === "query_failed" || value === "invalid_result" ||
    value === "timed_out" || value === "interrupted" ||
    value === "resource_exceeded";
}

function failure(
  boundary: "request" | "result",
  reason: ApplicationTaskQueryCallbackContractV1Error["reason"],
  path?: string,
  cause?: unknown,
) {
  return new ApplicationTaskQueryCallbackContractV1Error({
    boundary,
    reason,
    ...(path === undefined ? {} : { path }),
    ...(cause === undefined ? {} : { cause }),
  });
}
