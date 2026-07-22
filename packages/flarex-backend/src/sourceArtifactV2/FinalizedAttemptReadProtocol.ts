import { bytesEqualFullScan, isUint8Array } from "@flarex/utils/bytes";
import { isNonNegativeSafeInteger, isPositiveSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import { isNonEmptyString } from "@flarex/utils/strings";
import { Data, Result } from "effect";
import {
  encodeCanonicalJson,
  type Json,
  type JsonObject,
} from "flarex-protocol/json";
import { sourceArtifactV2CanonicalJsonUtf8ByteLength } from "./CanonicalJson";

export const sourceArtifactV2FinalizedAttemptReadPathV1 =
  "/internal/source-artifact-v2/v1/finalized-attempt/read";
export const sourceArtifactV2FinalizedAttemptReadMediaTypeV1 =
  "application/vnd.flarex.source-artifact-v2-finalized-attempt-read-v1+json";
export const sourceArtifactV2FinalizedAttemptReadBudgetHeaderV1 =
  "x-flarex-source-artifact-v2-finalized-read-budget-v1";
export const sourceArtifactV2FinalizedAttemptReadBudgetFailureHeaderV1 =
  "x-flarex-source-artifact-v2-finalized-read-budget-failure-v1";
export const sourceArtifactV2FinalizedAttemptReadUsageHeaderV1 =
  "x-flarex-source-artifact-v2-finalized-read-usage-v1";

export interface SourceArtifactV2FinalizedAttemptReadBudgetV1 {
  readonly maximumCalls: number;
  readonly maximumInputBytes: number;
  readonly maximumBodyBytes: number;
  readonly maximumCanonicalBytes: number;
  readonly maximumFrameBytes: number;
  readonly maximumHashBytes: number;
  readonly maximumElapsedMilliseconds: number;
}

export interface SourceArtifactV2FinalizedAttemptReadUsageV1 {
  readonly calls: number;
  readonly inputBytes: number;
  readonly bodyBytes: number;
  readonly canonicalBytes: number;
  readonly frameBytes: number;
  readonly hashBytes: number;
  readonly elapsedMilliseconds: number;
}

export type SourceArtifactV2FinalizedAttemptReadBudgetFieldV1 =
  keyof SourceArtifactV2FinalizedAttemptReadUsageV1;

export interface SourceArtifactV2FinalizedAttemptReadRequestV1 {
  readonly codecVersion: 1;
  readonly sourceArtifactCodecVersion: 1;
  readonly requestId: string;
  readonly deploymentId: string;
  readonly uploadId: string;
  readonly expectedGeneration: number;
  readonly expectedMutationFence: number;
}

interface SourceArtifactV2FinalizedAttemptReadResponseBaseV1 {
  readonly codecVersion: 1;
  readonly sourceArtifactCodecVersion: 1;
  readonly requestId: string;
  readonly deploymentId: string;
  readonly uploadId: string;
  readonly expectedGeneration: number;
  readonly expectedMutationFence: number;
}

export interface SourceArtifactV2FinalizedAttemptReadMatchedResponseV1
  extends SourceArtifactV2FinalizedAttemptReadResponseBaseV1 {
  readonly kind: "finalized";
  readonly generation: number;
  readonly mutationFence: number;
  readonly completedRootDigest: string;
  readonly completedSelectorDigest: string;
}

export interface SourceArtifactV2FinalizedAttemptReadClosedResponseV1
  extends SourceArtifactV2FinalizedAttemptReadResponseBaseV1 {
  readonly kind:
    | "notFound"
    | "staleGeneration"
    | "staleFence"
    | "lifecycleMismatch"
    | "resourceFailure"
    | "corruption";
}

export type SourceArtifactV2FinalizedAttemptReadResponseV1 =
  | SourceArtifactV2FinalizedAttemptReadMatchedResponseV1
  | SourceArtifactV2FinalizedAttemptReadClosedResponseV1;

export interface SourceArtifactV2FinalizedAttemptReadCodecSuccessV1<A> {
  readonly value: A;
  readonly bytes: Uint8Array;
  readonly usage: SourceArtifactV2FinalizedAttemptReadUsageV1;
}

export class SourceArtifactV2FinalizedAttemptReadCodecV1Error extends Data.TaggedError(
  "SourceArtifactV2FinalizedAttemptReadCodecV1Error",
)<{
  readonly operation:
    | "budget"
    | "budgetHeader"
    | "budgetFailureHeader"
    | "encodeRequest"
    | "decodeRequest"
    | "encodeResponse"
    | "decodeResponse";
  readonly reason:
    | "invalidBudget"
    | "invalidBudgetHeader"
    | "invalidBudgetFailureHeader"
    | "invalidInput"
    | "invalidUtf8"
    | "invalidJson"
    | "nonCanonical"
    | "budgetExhausted";
  readonly field: string;
}> {}

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const LOWER_HEX_DIGEST = /^[0-9a-f]{64}$/;
const BUDGET_FIELDS = [
  "maximumCalls",
  "maximumInputBytes",
  "maximumBodyBytes",
  "maximumCanonicalBytes",
  "maximumFrameBytes",
  "maximumHashBytes",
  "maximumElapsedMilliseconds",
] as const satisfies readonly (keyof SourceArtifactV2FinalizedAttemptReadBudgetV1)[];
const USAGE_FIELDS = [
  "calls",
  "inputBytes",
  "bodyBytes",
  "canonicalBytes",
  "frameBytes",
  "hashBytes",
  "elapsedMilliseconds",
] as const satisfies readonly SourceArtifactV2FinalizedAttemptReadBudgetFieldV1[];

export function captureSourceArtifactV2FinalizedAttemptReadBudgetV1(
  value: unknown,
): Result.Result<
  SourceArtifactV2FinalizedAttemptReadBudgetV1,
  SourceArtifactV2FinalizedAttemptReadCodecV1Error
> {
  if (!isNonArrayRecord(value) || !hasExactKeys(value, BUDGET_FIELDS)) {
    return Result.fail(codecFailure("budget", "invalidBudget", "budget"));
  }
  const captured = {} as Record<keyof SourceArtifactV2FinalizedAttemptReadBudgetV1, number>;
  for (const field of BUDGET_FIELDS) {
    const member = value[field];
    if (!isNonNegativeSafeInteger(member)) {
      return Result.fail(codecFailure("budget", "invalidBudget", field));
    }
    captured[field] = member;
  }
  return Result.succeed(Object.freeze({ ...captured }));
}

export function sourceArtifactV2FinalizedAttemptReadBudgetFitsV1(
  admission: SourceArtifactV2FinalizedAttemptReadBudgetV1,
  ceiling: SourceArtifactV2FinalizedAttemptReadBudgetV1,
): boolean {
  return BUDGET_FIELDS.every(field => admission[field] <= ceiling[field]);
}

export function encodeSourceArtifactV2FinalizedAttemptReadBudgetHeaderV1(
  value: unknown,
): Result.Result<string, SourceArtifactV2FinalizedAttemptReadCodecV1Error> {
  return Result.map(
    captureSourceArtifactV2FinalizedAttemptReadBudgetV1(value),
    budget => BUDGET_FIELDS.map(field => String(budget[field])).join(","),
  );
}

export function decodeSourceArtifactV2FinalizedAttemptReadBudgetHeaderV1(
  value: unknown,
): Result.Result<
  SourceArtifactV2FinalizedAttemptReadBudgetV1,
  SourceArtifactV2FinalizedAttemptReadCodecV1Error
> {
  if (typeof value !== "string") {
    return Result.fail(codecFailure("budgetHeader", "invalidBudgetHeader", "header"));
  }
  const pieces = value.split(",");
  if (pieces.length !== BUDGET_FIELDS.length) {
    return Result.fail(codecFailure("budgetHeader", "invalidBudgetHeader", "header"));
  }
  const decoded = {} as Record<keyof SourceArtifactV2FinalizedAttemptReadBudgetV1, number>;
  for (let index = 0; index < BUDGET_FIELDS.length; index += 1) {
    const field = BUDGET_FIELDS[index];
    const text = pieces[index];
    if (field === undefined || text === undefined || !/^(0|[1-9][0-9]*)$/.test(text)) {
      return Result.fail(codecFailure("budgetHeader", "invalidBudgetHeader", "header"));
    }
    const parsed = Number(text);
    if (!isNonNegativeSafeInteger(parsed)) {
      return Result.fail(codecFailure("budgetHeader", "invalidBudgetHeader", field));
    }
    decoded[field] = parsed;
  }
  return captureSourceArtifactV2FinalizedAttemptReadBudgetV1(decoded);
}

export function encodeSourceArtifactV2FinalizedAttemptReadBudgetFailureHeaderV1(
  value: unknown,
): Result.Result<
  SourceArtifactV2FinalizedAttemptReadBudgetFieldV1,
  SourceArtifactV2FinalizedAttemptReadCodecV1Error
> {
  for (const field of USAGE_FIELDS) {
    if (value === field) return Result.succeed(field);
  }
  return Result.fail(codecFailure(
    "budgetFailureHeader",
    "invalidBudgetFailureHeader",
    "header",
  ));
}

export const decodeSourceArtifactV2FinalizedAttemptReadBudgetFailureHeaderV1 =
  encodeSourceArtifactV2FinalizedAttemptReadBudgetFailureHeaderV1;

export function encodeSourceArtifactV2FinalizedAttemptReadUsageHeaderV1(
  value: unknown,
): Result.Result<string, SourceArtifactV2FinalizedAttemptReadCodecV1Error> {
  return Result.map(
    decodeUsage(value, "encodeResponse"),
    usage => USAGE_FIELDS.map(field => String(usage[field])).join(","),
  );
}

export function decodeSourceArtifactV2FinalizedAttemptReadUsageHeaderV1(
  value: unknown,
): Result.Result<
  SourceArtifactV2FinalizedAttemptReadUsageV1,
  SourceArtifactV2FinalizedAttemptReadCodecV1Error
> {
  if (typeof value !== "string") {
    return Result.fail(codecFailure("decodeResponse", "invalidInput", "usageHeader"));
  }
  const pieces = value.split(",");
  if (pieces.length !== USAGE_FIELDS.length) {
    return Result.fail(codecFailure("decodeResponse", "invalidInput", "usageHeader"));
  }
  const decoded = {} as Record<keyof SourceArtifactV2FinalizedAttemptReadUsageV1, number>;
  for (let index = 0; index < USAGE_FIELDS.length; index += 1) {
    const field = USAGE_FIELDS[index];
    const text = pieces[index];
    if (field === undefined || text === undefined || !/^(0|[1-9][0-9]*)$/.test(text)) {
      return Result.fail(codecFailure("decodeResponse", "invalidInput", "usageHeader"));
    }
    const parsed = Number(text);
    if (!isNonNegativeSafeInteger(parsed)) {
      return Result.fail(codecFailure("decodeResponse", "invalidInput", field));
    }
    decoded[field] = parsed;
  }
  return Result.succeed(Object.freeze({ ...decoded }));
}

export function encodeSourceArtifactV2FinalizedAttemptReadRequestV1(
  value: unknown,
  budgetInput: unknown,
): Result.Result<
  SourceArtifactV2FinalizedAttemptReadCodecSuccessV1<
    SourceArtifactV2FinalizedAttemptReadRequestV1
  >,
  SourceArtifactV2FinalizedAttemptReadCodecV1Error
> {
  return Result.gen(function* () {
    const budget = yield* captureSourceArtifactV2FinalizedAttemptReadBudgetV1(budgetInput);
    const request = yield* decodeRequestUnknown(value, "encodeRequest");
    return yield* encodeProjection("encodeRequest", requestJson(request), request, budget);
  });
}

export function decodeSourceArtifactV2FinalizedAttemptReadRequestV1(
  bytes: unknown,
  budgetInput: unknown,
): Result.Result<
  SourceArtifactV2FinalizedAttemptReadCodecSuccessV1<
    SourceArtifactV2FinalizedAttemptReadRequestV1
  >,
  SourceArtifactV2FinalizedAttemptReadCodecV1Error
> {
  return decodeProjection(
    "decodeRequest",
    bytes,
    budgetInput,
    value => decodeRequestUnknown(value, "decodeRequest"),
    requestJson,
  );
}

export function encodeSourceArtifactV2FinalizedAttemptReadResponseV1(
  value: unknown,
  budgetInput: unknown,
): Result.Result<
  SourceArtifactV2FinalizedAttemptReadCodecSuccessV1<
    SourceArtifactV2FinalizedAttemptReadResponseV1
  >,
  SourceArtifactV2FinalizedAttemptReadCodecV1Error
> {
  return Result.gen(function* () {
    const budget = yield* captureSourceArtifactV2FinalizedAttemptReadBudgetV1(budgetInput);
    const response = yield* decodeResponseUnknown(value, "encodeResponse");
    return yield* encodeProjection("encodeResponse", responseJson(response), response, budget);
  });
}

export function decodeSourceArtifactV2FinalizedAttemptReadResponseV1(
  bytes: unknown,
  budgetInput: unknown,
): Result.Result<
  SourceArtifactV2FinalizedAttemptReadCodecSuccessV1<
    SourceArtifactV2FinalizedAttemptReadResponseV1
  >,
  SourceArtifactV2FinalizedAttemptReadCodecV1Error
> {
  return decodeProjection(
    "decodeResponse",
    bytes,
    budgetInput,
    value => decodeResponseUnknown(value, "decodeResponse"),
    responseJson,
  );
}

function decodeProjection<A>(
  operation: "decodeRequest" | "decodeResponse",
  bytesInput: unknown,
  budgetInput: unknown,
  decode: (value: unknown) => Result.Result<A, SourceArtifactV2FinalizedAttemptReadCodecV1Error>,
  project: (value: A) => JsonObject,
): Result.Result<
  SourceArtifactV2FinalizedAttemptReadCodecSuccessV1<A>,
  SourceArtifactV2FinalizedAttemptReadCodecV1Error
> {
  return Result.gen(function* () {
    const budget = yield* captureSourceArtifactV2FinalizedAttemptReadBudgetV1(budgetInput);
    const bytes = yield* captureBytes(bytesInput, operation, budget.maximumBodyBytes);
    yield* requireWithin(operation, "inputBytes", bytes.byteLength, budget.maximumInputBytes);
    yield* requireWithin(
      operation,
      "canonicalBytes",
      bytes.byteLength,
      budget.maximumCanonicalBytes,
    );
    yield* requireWithin(operation, "frameBytes", bytes.byteLength, budget.maximumFrameBytes);
    let text: string;
    try {
      text = UTF8_DECODER.decode(bytes);
    } catch {
      return yield* Result.fail(codecFailure(operation, "invalidUtf8", "body"));
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return yield* Result.fail(codecFailure(operation, "invalidJson", "body"));
    }
    const value = yield* decode(parsed);
    const encoded = yield* encodeProjection(operation, project(value), value, budget);
    if (!bytesEqualFullScan(bytes, encoded.bytes)) {
      return yield* Result.fail(codecFailure(operation, "nonCanonical", "body"));
    }
    return Object.freeze({
      value: encoded.value,
      bytes: new Uint8Array(encoded.bytes),
      usage: Object.freeze({ ...encoded.usage, bodyBytes: bytes.byteLength }),
    });
  });
}

function encodeProjection<A>(
  operation: "encodeRequest" | "decodeRequest" | "encodeResponse" | "decodeResponse",
  projection: JsonObject,
  value: A,
  budget: SourceArtifactV2FinalizedAttemptReadBudgetV1,
): Result.Result<
  SourceArtifactV2FinalizedAttemptReadCodecSuccessV1<A>,
  SourceArtifactV2FinalizedAttemptReadCodecV1Error
> {
  return Result.gen(function* () {
    const projectedBytes = sourceArtifactV2CanonicalJsonUtf8ByteLength(projection, {
      invalidMembership: canonicalInvariantDefect,
      overflow: canonicalLengthOverflowDefect,
    });
    yield* requireWithin(operation, "inputBytes", projectedBytes, budget.maximumInputBytes);
    yield* requireWithin(operation, "canonicalBytes", projectedBytes, budget.maximumCanonicalBytes);
    yield* requireWithin(operation, "frameBytes", projectedBytes, budget.maximumFrameBytes);
    yield* requireWithin(operation, "bodyBytes", projectedBytes, budget.maximumBodyBytes);
    const canonical = encodeCanonicalJson(projection, canonicalInvariantDefect);
    const bytes = UTF8_ENCODER.encode(canonical);
    if (bytes.byteLength !== projectedBytes) return canonicalInvariantDefect();
    return Object.freeze({
      value,
      bytes: new Uint8Array(bytes),
      usage: zeroUsage({
        inputBytes: projectedBytes,
        bodyBytes: projectedBytes,
        canonicalBytes: projectedBytes,
        frameBytes: projectedBytes,
      }),
    });
  });
}

function decodeRequestUnknown(
  value: unknown,
  operation: "encodeRequest" | "decodeRequest",
): Result.Result<
  SourceArtifactV2FinalizedAttemptReadRequestV1,
  SourceArtifactV2FinalizedAttemptReadCodecV1Error
> {
  if (!isNonArrayRecord(value) || !hasExactKeys(value, [
    "codecVersion",
    "deploymentId",
    "expectedGeneration",
    "expectedMutationFence",
    "requestId",
    "sourceArtifactCodecVersion",
    "uploadId",
  ])) return Result.fail(codecFailure(operation, "invalidInput", "request"));
  if (value.codecVersion !== 1 || value.sourceArtifactCodecVersion !== 1) {
    return Result.fail(codecFailure(operation, "invalidInput", "codecVersion"));
  }
  for (const field of ["requestId", "deploymentId", "uploadId"] as const) {
    if (!isNonEmptyString(value[field])) {
      return Result.fail(codecFailure(operation, "invalidInput", field));
    }
  }
  if (!isPositiveSafeInteger(value.expectedGeneration)) {
    return Result.fail(codecFailure(operation, "invalidInput", "expectedGeneration"));
  }
  if (!isPositiveSafeInteger(value.expectedMutationFence)) {
    return Result.fail(codecFailure(operation, "invalidInput", "expectedMutationFence"));
  }
  return Result.succeed(Object.freeze({
    codecVersion: 1,
    sourceArtifactCodecVersion: 1,
    requestId: value.requestId as string,
    deploymentId: value.deploymentId as string,
    uploadId: value.uploadId as string,
    expectedGeneration: value.expectedGeneration as number,
    expectedMutationFence: value.expectedMutationFence as number,
  }));
}

function decodeResponseUnknown(
  value: unknown,
  operation: "encodeResponse" | "decodeResponse",
): Result.Result<
  SourceArtifactV2FinalizedAttemptReadResponseV1,
  SourceArtifactV2FinalizedAttemptReadCodecV1Error
> {
  if (!isNonArrayRecord(value) || value.codecVersion !== 1) {
    return Result.fail(codecFailure(operation, "invalidInput", "response"));
  }
  for (const field of ["requestId", "deploymentId", "uploadId"] as const) {
    if (!isNonEmptyString(value[field])) {
      return Result.fail(codecFailure(operation, "invalidInput", field));
    }
  }
  if (
    value.sourceArtifactCodecVersion !== 1 ||
    !isPositiveSafeInteger(value.expectedGeneration) ||
    !isPositiveSafeInteger(value.expectedMutationFence)
  ) return Result.fail(codecFailure(operation, "invalidInput", "bindingEvidence"));
  const base = {
    codecVersion: 1 as const,
    sourceArtifactCodecVersion: 1 as const,
    requestId: value.requestId as string,
    deploymentId: value.deploymentId as string,
    uploadId: value.uploadId as string,
    expectedGeneration: value.expectedGeneration,
    expectedMutationFence: value.expectedMutationFence,
  };
  if (value.kind === "finalized") {
    if (!hasExactKeys(value, [
      "codecVersion", "completedRootDigest", "completedSelectorDigest", "deploymentId",
      "expectedGeneration", "expectedMutationFence", "generation", "kind", "mutationFence",
      "requestId", "sourceArtifactCodecVersion", "uploadId",
    ])) return Result.fail(codecFailure(operation, "invalidInput", "response"));
    if (!isPositiveSafeInteger(value.generation) || !isPositiveSafeInteger(value.mutationFence)) {
      return Result.fail(codecFailure(operation, "invalidInput", "attemptIdentity"));
    }
    if (
      typeof value.completedRootDigest !== "string" ||
      !LOWER_HEX_DIGEST.test(value.completedRootDigest) ||
      typeof value.completedSelectorDigest !== "string" ||
      !LOWER_HEX_DIGEST.test(value.completedSelectorDigest)
    ) return Result.fail(codecFailure(operation, "invalidInput", "digest"));
    return Result.succeed(Object.freeze({
      ...base,
      kind: "finalized",
      generation: value.generation,
      mutationFence: value.mutationFence,
      completedRootDigest: value.completedRootDigest,
      completedSelectorDigest: value.completedSelectorDigest,
    }));
  }
  if (!isClosedKind(value.kind) || !hasExactKeys(value, [
    "codecVersion", "deploymentId", "expectedGeneration", "expectedMutationFence", "kind",
    "requestId", "sourceArtifactCodecVersion", "uploadId",
  ])) return Result.fail(codecFailure(operation, "invalidInput", "response"));
  return Result.succeed(Object.freeze({ ...base, kind: value.kind }));
}

function decodeUsage(
  value: unknown,
  operation: "encodeResponse" | "decodeResponse",
): Result.Result<
  SourceArtifactV2FinalizedAttemptReadUsageV1,
  SourceArtifactV2FinalizedAttemptReadCodecV1Error
> {
  if (!isNonArrayRecord(value) || !hasExactKeys(value, USAGE_FIELDS)) {
    return Result.fail(codecFailure(operation, "invalidInput", "usage"));
  }
  const captured = {} as Record<keyof SourceArtifactV2FinalizedAttemptReadUsageV1, number>;
  for (const field of USAGE_FIELDS) {
    const member = value[field];
    if (!isNonNegativeSafeInteger(member)) {
      return Result.fail(codecFailure(operation, "invalidInput", field));
    }
    captured[field] = member;
  }
  return Result.succeed(Object.freeze({ ...captured }));
}

function requestJson(value: SourceArtifactV2FinalizedAttemptReadRequestV1): JsonObject {
  return {
    codecVersion: 1,
    deploymentId: value.deploymentId,
    expectedGeneration: value.expectedGeneration,
    expectedMutationFence: value.expectedMutationFence,
    requestId: value.requestId,
    sourceArtifactCodecVersion: 1,
    uploadId: value.uploadId,
  };
}

function responseJson(value: SourceArtifactV2FinalizedAttemptReadResponseV1): JsonObject {
  const base: JsonObject = {
    codecVersion: 1,
    deploymentId: value.deploymentId,
    expectedGeneration: value.expectedGeneration,
    expectedMutationFence: value.expectedMutationFence,
    kind: value.kind,
    requestId: value.requestId,
    sourceArtifactCodecVersion: 1,
    uploadId: value.uploadId,
  };
  return value.kind === "finalized"
    ? {
        ...base,
        completedRootDigest: value.completedRootDigest,
        completedSelectorDigest: value.completedSelectorDigest,
        generation: value.generation,
        mutationFence: value.mutationFence,
      }
    : base;
}

function captureBytes(
  value: unknown,
  operation: "decodeRequest" | "decodeResponse",
  maximumBodyBytes: number,
): Result.Result<Uint8Array, SourceArtifactV2FinalizedAttemptReadCodecV1Error> {
  if (!isUint8Array(value)) {
    return Result.fail(codecFailure(operation, "invalidInput", "body"));
  }
  const items: number[] = [];
  try {
    for (const byte of Uint8Array.prototype.values.call(value)) {
      if (items.length >= maximumBodyBytes) {
        return Result.fail(codecFailure(operation, "budgetExhausted", "bodyBytes"));
      }
      items.push(byte);
    }
  } catch {
    return Result.fail(codecFailure(operation, "invalidInput", "body"));
  }
  return Result.succeed(Uint8Array.from(items));
}

function requireWithin(
  operation: "encodeRequest" | "decodeRequest" | "encodeResponse" | "decodeResponse",
  field: "inputBytes" | "bodyBytes" | "canonicalBytes" | "frameBytes",
  used: number,
  maximum: number,
): Result.Result<void, SourceArtifactV2FinalizedAttemptReadCodecV1Error> {
  return used <= maximum
    ? Result.succeed(undefined)
    : Result.fail(codecFailure(operation, "budgetExhausted", field));
}

function zeroUsage(
  overrides: Partial<SourceArtifactV2FinalizedAttemptReadUsageV1> = {},
): SourceArtifactV2FinalizedAttemptReadUsageV1 {
  return Object.freeze({
    calls: 0,
    inputBytes: 0,
    bodyBytes: 0,
    canonicalBytes: 0,
    frameBytes: 0,
    hashBytes: 0,
    elapsedMilliseconds: 0,
    ...overrides,
  });
}

function isClosedKind(
  value: unknown,
): value is SourceArtifactV2FinalizedAttemptReadClosedResponseV1["kind"] {
  return value === "notFound" || value === "staleGeneration" || value === "staleFence" ||
    value === "lifecycleMismatch" || value === "resourceFailure" || value === "corruption";
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  return keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index]);
}

function codecFailure(
  operation: SourceArtifactV2FinalizedAttemptReadCodecV1Error["operation"],
  reason: SourceArtifactV2FinalizedAttemptReadCodecV1Error["reason"],
  field: string,
): SourceArtifactV2FinalizedAttemptReadCodecV1Error {
  return new SourceArtifactV2FinalizedAttemptReadCodecV1Error({ operation, reason, field });
}

function canonicalInvariantDefect(): never {
  throw new Error("Validated finalized-attempt read evidence lost canonical JSON membership.");
}

function canonicalLengthOverflowDefect(): never {
  throw new Error("Finalized-attempt read canonical JSON byte preflight overflowed.");
}
