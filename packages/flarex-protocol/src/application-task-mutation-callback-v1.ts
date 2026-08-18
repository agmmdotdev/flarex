import {
  copyBytes,
  encodeBytesToLowercaseHex,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { isNonBlankString } from "@flarex/utils/strings";
import { Data, Result, Schema } from "effect";

import {
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
  type TransactionFunctionPathV1,
  type TransactionRequestKeyV1,
} from "./transaction-session";
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

export const APPLICATION_TASK_MUTATION_CALLBACK_FORMAT_V1 =
  "flarex.application-task-mutation-callback" as const;
export const APPLICATION_TASK_MUTATION_CALLBACK_VERSION_V1 = 1 as const;
export const APPLICATION_TASK_MUTATION_STABLE_KEY_IDENTITY_V1 =
  "flarex.system/application-task-mutation-stable-key/v1" as const;
export const APPLICATION_TASK_MUTATION_REQUEST_IDENTITY_V1 =
  "flarex.system/application-task-mutation-request/v1" as const;

export const MAX_APPLICATION_TASK_MUTATION_FUNCTION_PATH_BYTES_V1 = 512;
export const MAX_APPLICATION_TASK_MUTATION_ARGUMENT_BYTES_V1 = 1_048_576;
export const MAX_APPLICATION_TASK_MUTATION_RESULT_BYTES_V1 = 8 * 1_048_576;
export const MAX_APPLICATION_TASK_MUTATION_CALLS_V1 = 256;
export const MAX_APPLICATION_TASK_MUTATION_CALL_ID_LENGTH_V1 = 512;
export const MAX_APPLICATION_TASK_MUTATION_MILLISECONDS_V1 = 30_000;
export const MAX_APPLICATION_TASK_MUTATION_IDENTITY_TEXT_BYTES_V1 = 2_048;

const MAX_POSITIVE_INT64 = (1n << 63n) - 1n;
const DIGEST_BYTES = 32;
const UTF8 = new TextEncoder();
const ARGUMENT_LIMITS = valueLimits(
  MAX_APPLICATION_TASK_MUTATION_ARGUMENT_BYTES_V1,
);
const RESULT_LIMITS = valueLimits(MAX_APPLICATION_TASK_MUTATION_RESULT_BYTES_V1);
const STABLE_KEY_DOMAIN = UTF8.encode(
  `${APPLICATION_TASK_MUTATION_STABLE_KEY_IDENTITY_V1}\0`,
);
const REQUEST_IDENTITY_DOMAIN = UTF8.encode(
  `${APPLICATION_TASK_MUTATION_REQUEST_IDENTITY_V1}\0`,
);
const decodeTransactionFunctionPathV1 = Schema.decodeUnknownResult(
  TransactionFunctionPathV1Schema,
);
const decodeTransactionRequestKeyV1 = Schema.decodeUnknownResult(
  TransactionRequestKeyV1Schema,
);

export interface ApplicationTaskMutationCallbackRequestV1 {
  readonly format: typeof APPLICATION_TASK_MUTATION_CALLBACK_FORMAT_V1;
  readonly version: typeof APPLICATION_TASK_MUTATION_CALLBACK_VERSION_V1;
  readonly operation: "runMutation";
  readonly ordinal: bigint;
  readonly functionPath: TransactionFunctionPathV1;
  readonly arguments: CanonicalFlarexRuntimeValueV1;
  readonly argumentSemanticBytes: number;
}

export type ApplicationTaskMutationCallbackFailureReasonV1 =
  | "invalid_request"
  | "stale_launch"
  | "sequence_mismatch"
  | "replay_conflict"
  | "mutation_failed"
  | "outcome_uncertain"
  | "invalid_result"
  | "timed_out"
  | "interrupted"
  | "resource_exceeded";

export type ApplicationTaskMutationCallbackResultV1 =
  | Readonly<{
      readonly format: typeof APPLICATION_TASK_MUTATION_CALLBACK_FORMAT_V1;
      readonly version: typeof APPLICATION_TASK_MUTATION_CALLBACK_VERSION_V1;
      readonly kind: "success";
      readonly callId: string;
      readonly deadlineMs: number;
      readonly value: CanonicalFlarexRuntimeValueV1;
      readonly valueSemanticBytes: number;
    }>
  | Readonly<{
      readonly format: typeof APPLICATION_TASK_MUTATION_CALLBACK_FORMAT_V1;
      readonly version: typeof APPLICATION_TASK_MUTATION_CALLBACK_VERSION_V1;
      readonly kind: "failure";
      readonly callId: string;
      readonly deadlineMs: number;
      readonly reason: ApplicationTaskMutationCallbackFailureReasonV1;
    }>;

export interface ApplicationTaskMutationCallbackCapabilityV1 {
  readonly invoke: (request: unknown) => unknown | PromiseLike<unknown>;
}

export interface ApplicationTaskMutationStableKeyFrameV1 {
  readonly scopeId: string;
  readonly runId: string;
  readonly operationOrdinal: bigint;
}

export interface ApplicationTaskMutationRequestIdentityFrameV1 {
  readonly stableRequestKey: TransactionRequestKeyV1;
  readonly applicationTaskRuntimeTargetSha256: Uint8Array;
  readonly functionPath: TransactionFunctionPathV1;
  readonly argumentsSha256: Uint8Array;
  readonly identityAccessPolicySha256: Uint8Array;
}

export interface ApplicationTaskMutationIdentityPreimageV1<Frame> {
  readonly frame: Frame;
  readonly canonicalBytes: Uint8Array;
}

export class ApplicationTaskMutationCallbackContractV1Error extends
  Data.TaggedError("ApplicationTaskMutationCallbackContractV1Error")<{
    readonly boundary: "request" | "result";
    readonly reason:
      | "invalid_shape"
      | "invalid_value"
      | "value_size_mismatch"
      | "resource_exceeded";
    readonly path?: string;
    readonly cause?: unknown;
  }> {}

export class ApplicationTaskMutationIdentityV1Error extends Data.TaggedError(
  "ApplicationTaskMutationIdentityV1Error",
)<{
  readonly operation:
    | "stable_key_preimage"
    | "request_identity_preimage"
    | "request_key_from_digest";
  readonly reason: "invalid_input" | "resource_exceeded";
  readonly path: string;
}> {}

export function decodeApplicationTaskMutationCallbackRequestV1(
  input: unknown,
): Result.Result<
  ApplicationTaskMutationCallbackRequestV1,
  ApplicationTaskMutationCallbackContractV1Error
> {
  const record = captureExactRecord(input, [
    "format",
    "version",
    "operation",
    "ordinal",
    "functionPath",
    "arguments",
    "argumentSemanticBytes",
  ]);
  if (
    record === undefined ||
    record.format !== APPLICATION_TASK_MUTATION_CALLBACK_FORMAT_V1 ||
    record.version !== APPLICATION_TASK_MUTATION_CALLBACK_VERSION_V1 ||
    record.operation !== "runMutation" ||
    !isPositiveInt64(record.ordinal)
  ) {
    return Result.fail(callbackFailure("request", "invalid_shape"));
  }
  const ordinal = record.ordinal;
  const functionPath = record.functionPath;
  if (
    !isBoundedText(
      functionPath,
      MAX_APPLICATION_TASK_MUTATION_FUNCTION_PATH_BYTES_V1,
    ) ||
    !isSemanticSize(
      record.argumentSemanticBytes,
      MAX_APPLICATION_TASK_MUTATION_ARGUMENT_BYTES_V1,
    )
  ) {
    return Result.fail(callbackFailure("request", "invalid_shape"));
  }
  return decodeTransactionFunctionPathV1(functionPath).pipe(
    Result.mapError((cause) => callbackFailure(
      "request",
      "invalid_shape",
      "functionPath",
      cause,
    )),
    Result.flatMap((ownedFunctionPath) =>
      normalizeValue(record.arguments, "request", ARGUMENT_LIMITS).pipe(
        Result.flatMap((normalized) =>
          normalized.semanticSizeBytes === record.argumentSemanticBytes
            ? Result.succeed(Object.freeze({
                format: APPLICATION_TASK_MUTATION_CALLBACK_FORMAT_V1,
                version: APPLICATION_TASK_MUTATION_CALLBACK_VERSION_V1,
                operation: "runMutation" as const,
                ordinal,
                functionPath: ownedFunctionPath,
                arguments: normalized.value,
                argumentSemanticBytes: normalized.semanticSizeBytes,
              }))
            : Result.fail(callbackFailure(
                "request",
                "value_size_mismatch",
                "argumentSemanticBytes",
              ))
        ),
      )
    ),
  );
}

export function decodeApplicationTaskMutationCallbackResultV1(
  input: unknown,
): Result.Result<
  ApplicationTaskMutationCallbackResultV1,
  ApplicationTaskMutationCallbackContractV1Error
> {
  const record = captureResultRecord(input);
  if (
    record === undefined ||
    record.format !== APPLICATION_TASK_MUTATION_CALLBACK_FORMAT_V1 ||
    record.version !== APPLICATION_TASK_MUTATION_CALLBACK_VERSION_V1
  ) return Result.fail(callbackFailure("result", "invalid_shape"));
  const callId = record.callId;
  const deadlineMs = record.deadlineMs;
  if (!isCallId(callId) || !isDeadline(deadlineMs)) {
    return Result.fail(callbackFailure("result", "invalid_shape"));
  }
  if (record.kind === "failure") {
    return isFailureReason(record.reason)
      ? Result.succeed(Object.freeze({
          format: APPLICATION_TASK_MUTATION_CALLBACK_FORMAT_V1,
          version: APPLICATION_TASK_MUTATION_CALLBACK_VERSION_V1,
          kind: "failure" as const,
          callId,
          deadlineMs,
          reason: record.reason,
        }))
      : Result.fail(callbackFailure("result", "invalid_shape", "reason"));
  }
  if (
    record.kind !== "success" ||
    !isSemanticSize(
      record.valueSemanticBytes,
      MAX_APPLICATION_TASK_MUTATION_RESULT_BYTES_V1,
    )
  ) return Result.fail(callbackFailure("result", "invalid_shape"));
  return normalizeValue(record.value, "result", RESULT_LIMITS).pipe(
    Result.flatMap((normalized) =>
      normalized.semanticSizeBytes === record.valueSemanticBytes
        ? Result.succeed(Object.freeze({
            format: APPLICATION_TASK_MUTATION_CALLBACK_FORMAT_V1,
            version: APPLICATION_TASK_MUTATION_CALLBACK_VERSION_V1,
            kind: "success" as const,
            callId,
            deadlineMs,
            value: normalized.value,
            valueSemanticBytes: normalized.semanticSizeBytes,
          }))
        : Result.fail(callbackFailure(
            "result",
            "value_size_mismatch",
            "valueSemanticBytes",
          ))
    ),
  );
}

export function normalizeApplicationTaskMutationCallbackValueV1(
  input: unknown,
  boundary: "request" | "result",
): Result.Result<
  NormalizedFlarexRuntimeValueV1,
  ApplicationTaskMutationCallbackContractV1Error
> {
  return normalizeValue(
    input,
    boundary,
    boundary === "request" ? ARGUMENT_LIMITS : RESULT_LIMITS,
  );
}

export function encodeApplicationTaskMutationStableKeyPreimageV1(
  input: unknown,
): Result.Result<
  ApplicationTaskMutationIdentityPreimageV1<
    ApplicationTaskMutationStableKeyFrameV1
  >,
  ApplicationTaskMutationIdentityV1Error
> {
  const operation = "stable_key_preimage" as const;
  return Result.gen(function* () {
    const record = yield* captureIdentityRecord(input, [
      "scopeId",
      "runId",
      "operationOrdinal",
    ], operation);
    const scopeId = yield* captureIdentityText(record.scopeId, "scopeId", operation);
    const runId = yield* captureIdentityText(record.runId, "runId", operation);
    const operationOrdinal = yield* capturePositiveInt64(
      record.operationOrdinal,
      "operationOrdinal",
      operation,
    );
    const frame = Object.freeze({ scopeId, runId, operationOrdinal });
    return Object.freeze({
      frame,
      canonicalBytes: concatenate([
        STABLE_KEY_DOMAIN,
        lengthPrefixedText(scopeId),
        lengthPrefixedText(runId),
        u64(operationOrdinal),
      ]),
    });
  });
}

export function applicationTaskMutationRequestKeyV1FromDigest(
  input: unknown,
): Result.Result<TransactionRequestKeyV1, ApplicationTaskMutationIdentityV1Error> {
  if (!isUint8ArrayWithByteLength(input, DIGEST_BYTES)) {
    return identityFailure(
      "request_key_from_digest",
      "invalid_input",
      "sha256",
    );
  }
  let ownedDigest: Uint8Array;
  try {
    ownedDigest = copyBytes(input);
  } catch {
    return identityFailure(
      "request_key_from_digest",
      "invalid_input",
      "sha256",
    );
  }
  const requestKey = `task-mutation:v1:${encodeBytesToLowercaseHex(ownedDigest)}`;
  return decodeTransactionRequestKeyV1(requestKey).pipe(
    Result.mapError(() => new ApplicationTaskMutationIdentityV1Error({
      operation: "request_key_from_digest",
      reason: "invalid_input",
      path: "sha256",
    })),
  );
}

export function encodeApplicationTaskMutationRequestIdentityPreimageV1(
  input: unknown,
): Result.Result<
  ApplicationTaskMutationIdentityPreimageV1<
    ApplicationTaskMutationRequestIdentityFrameV1
  >,
  ApplicationTaskMutationIdentityV1Error
> {
  const operation = "request_identity_preimage" as const;
  return Result.gen(function* () {
    const record = yield* captureIdentityRecord(input, [
      "stableRequestKey",
      "applicationTaskRuntimeTargetSha256",
      "functionPath",
      "argumentsSha256",
      "identityAccessPolicySha256",
    ], operation);
    const stableRequestKeyText = yield* captureIdentityText(
      record.stableRequestKey,
      "stableRequestKey",
      operation,
    ).pipe(
      Result.filterOrFail(
        isApplicationTaskMutationRequestKey,
        () => new ApplicationTaskMutationIdentityV1Error({
          operation,
          reason: "invalid_input",
          path: "stableRequestKey",
        }),
      ),
    );
    const stableRequestKey = yield* decodeTransactionRequestKeyV1(
      stableRequestKeyText,
    ).pipe(
      Result.mapError(() => new ApplicationTaskMutationIdentityV1Error({
        operation,
        reason: "invalid_input",
        path: "stableRequestKey",
      })),
    );
    const applicationTaskRuntimeTargetSha256 = yield* captureDigest(
      record.applicationTaskRuntimeTargetSha256,
      "applicationTaskRuntimeTargetSha256",
      operation,
    );
    const functionPathText = yield* captureIdentityText(
      record.functionPath,
      "functionPath",
      operation,
      MAX_APPLICATION_TASK_MUTATION_FUNCTION_PATH_BYTES_V1,
    );
    const functionPath = yield* decodeTransactionFunctionPathV1(
      functionPathText,
    ).pipe(
      Result.mapError(() => new ApplicationTaskMutationIdentityV1Error({
        operation,
        reason: "invalid_input",
        path: "functionPath",
      })),
    );
    const argumentsSha256 = yield* captureDigest(
      record.argumentsSha256,
      "argumentsSha256",
      operation,
    );
    const identityAccessPolicySha256 = yield* captureDigest(
      record.identityAccessPolicySha256,
      "identityAccessPolicySha256",
      operation,
    );
    const frame = Object.freeze({
      stableRequestKey,
      applicationTaskRuntimeTargetSha256,
      functionPath,
      argumentsSha256,
      identityAccessPolicySha256,
    });
    return Object.freeze({
      frame,
      canonicalBytes: concatenate([
        REQUEST_IDENTITY_DOMAIN,
        lengthPrefixedText(stableRequestKey),
        applicationTaskRuntimeTargetSha256,
        lengthPrefixedText(functionPath),
        argumentsSha256,
        identityAccessPolicySha256,
      ]),
    });
  });
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
  ApplicationTaskMutationCallbackContractV1Error
> {
  try {
    return Result.succeed(normalizeFlarexRuntimeValueWithLimitsV1(input, limits));
  } catch (cause) {
    if (cause instanceof FlarexValueRuntimeCoreV1Error) {
      return Result.fail(callbackFailure(
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
  const failureRecord = captureExactRecord(input, [
    "format",
    "version",
    "kind",
    "callId",
    "deadlineMs",
    "reason",
  ]);
  if (failureRecord !== undefined) return failureRecord;
  return captureExactRecord(input, [
    "format",
    "version",
    "kind",
    "callId",
    "deadlineMs",
    "value",
    "valueSemanticBytes",
  ]);
}

function captureExactRecord(input: unknown, keys: ReadonlyArray<string>) {
  try {
    if (!isNonArrayRecord(input)) return undefined;
    const observed = Reflect.ownKeys(input);
    if (
      observed.length !== keys.length ||
      observed.some((key) => typeof key !== "string" || !keys.includes(key))
    ) return undefined;
    const captured: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        descriptor === undefined || !descriptor.enumerable ||
        !("value" in descriptor)
      ) return undefined;
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

function captureIdentityRecord<const Keys extends ReadonlyArray<string>>(
  input: unknown,
  keys: Keys,
  operation: ApplicationTaskMutationIdentityV1Error["operation"],
): Result.Result<Readonly<Record<Keys[number], unknown>>, ApplicationTaskMutationIdentityV1Error> {
  const record = captureExactRecord(input, keys);
  if (record === undefined) {
    return identityFailure(operation, "invalid_input", "$input");
  }
  // SAFETY: captureExactRecord proved that every requested literal key is an
  // own enumerable data property and rejected every additional key.
  return Result.succeed(record as Readonly<Record<Keys[number], unknown>>);
}

function captureIdentityText(
  input: unknown,
  path: string,
  operation: ApplicationTaskMutationIdentityV1Error["operation"],
  maximum = MAX_APPLICATION_TASK_MUTATION_IDENTITY_TEXT_BYTES_V1,
): Result.Result<string, ApplicationTaskMutationIdentityV1Error> {
  if (
    typeof input !== "string" || input.length > maximum ||
    !isNonBlankString(input) ||
    input.includes("\0") || !isWellFormedUnicode(input)
  ) {
    return identityFailure(operation, "invalid_input", path);
  }
  const byteLength = UTF8.encode(input).byteLength;
  return byteLength <= maximum
    ? Result.succeed(input)
    : identityFailure(operation, "resource_exceeded", path);
}

function captureDigest(
  input: unknown,
  path: string,
  operation: ApplicationTaskMutationIdentityV1Error["operation"],
): Result.Result<Uint8Array, ApplicationTaskMutationIdentityV1Error> {
  if (!isUint8ArrayWithByteLength(input, DIGEST_BYTES)) {
    return identityFailure(operation, "invalid_input", path);
  }
  try {
    return Result.succeed(copyBytes(input));
  } catch {
    return identityFailure(operation, "invalid_input", path);
  }
}

function capturePositiveInt64(
  input: unknown,
  path: string,
  operation: ApplicationTaskMutationIdentityV1Error["operation"],
): Result.Result<bigint, ApplicationTaskMutationIdentityV1Error> {
  return isPositiveInt64(input)
    ? Result.succeed(input)
    : identityFailure(operation, "invalid_input", path);
}

function concatenate(segments: ReadonlyArray<Uint8Array>): Uint8Array {
  const byteLength = segments.reduce(
    (total, segment) => total + segment.byteLength,
    0,
  );
  const output = new Uint8Array(byteLength);
  let offset = 0;
  for (const segment of segments) {
    output.set(segment, offset);
    offset += segment.byteLength;
  }
  return output;
}

function lengthPrefixedText(value: string): Uint8Array {
  const bytes = UTF8.encode(value);
  const output = new Uint8Array(4 + bytes.byteLength);
  new DataView(output.buffer).setUint32(0, bytes.byteLength, false);
  output.set(bytes, 4);
  return output;
}

function u64(value: bigint): Uint8Array {
  const output = new Uint8Array(8);
  new DataView(output.buffer).setBigUint64(0, value, false);
  return output;
}

function isPositiveInt64(value: unknown): value is bigint {
  return typeof value === "bigint" && value >= 1n && value <= MAX_POSITIVE_INT64;
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length <= maximum &&
    isNonBlankString(value) &&
    !value.includes("\0") && isWellFormedUnicode(value) &&
    UTF8.encode(value).byteLength <= maximum;
}

function isApplicationTaskMutationRequestKey(value: string): boolean {
  return /^task-mutation:v1:[0-9a-f]{64}$/.test(value);
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
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
    value.length <= MAX_APPLICATION_TASK_MUTATION_CALL_ID_LENGTH_V1;
}

function isFailureReason(
  value: unknown,
): value is ApplicationTaskMutationCallbackFailureReasonV1 {
  return value === "invalid_request" || value === "stale_launch" ||
    value === "sequence_mismatch" || value === "replay_conflict" ||
    value === "mutation_failed" || value === "outcome_uncertain" ||
    value === "invalid_result" || value === "timed_out" ||
    value === "interrupted" || value === "resource_exceeded";
}

function callbackFailure(
  boundary: "request" | "result",
  reason: ApplicationTaskMutationCallbackContractV1Error["reason"],
  path?: string,
  cause?: unknown,
) {
  return new ApplicationTaskMutationCallbackContractV1Error({
    boundary,
    reason,
    ...(path === undefined ? {} : { path }),
    ...(cause === undefined ? {} : { cause }),
  });
}

function identityFailure(
  operation: ApplicationTaskMutationIdentityV1Error["operation"],
  reason: ApplicationTaskMutationIdentityV1Error["reason"],
  path: string,
): Result.Result<never, ApplicationTaskMutationIdentityV1Error> {
  return Result.fail(new ApplicationTaskMutationIdentityV1Error({
    operation,
    reason,
    path,
  }));
}
