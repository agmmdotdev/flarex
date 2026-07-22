import {
  bytesEqualFullScan,
  isUint8Array,
} from "@flarex/utils/bytes";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Result } from "effect";
import {
  encodeCanonicalJson,
  type Json,
  type JsonObject,
} from "flarex-protocol/json";
import { isCanonicalIsoTimestamp } from "flarex-protocol/iso-timestamp";

export const deploymentProjectScopeLookupPathV1 =
  "/internal/v1/deployment-project-scope/lookup";
export const deploymentProjectScopeLookupMediaTypeV1 =
  "application/vnd.flarex.deployment-project-scope-lookup-v1+json";

export const deploymentProjectScopeLookupBudgetHeaderV1 =
  "x-flarex-deployment-project-scope-budget-v1";
export const deploymentProjectScopeLookupBudgetFailureHeaderV1 =
  "x-flarex-deployment-project-scope-budget-failure-v1";

export interface DeploymentProjectScopeLookupBudgetV1 {
  readonly maximumLookupCalls: number;
  readonly maximumInputBytes: number;
  readonly maximumBodyBytes: number;
  readonly maximumCanonicalBytes: number;
  readonly maximumFrameBytes: number;
  readonly maximumElapsedMilliseconds: number;
}

export interface DeploymentProjectScopeLookupUsageV1 {
  readonly lookupCalls: number;
  readonly inputBytes: number;
  readonly bodyBytes: number;
  readonly canonicalBytes: number;
  readonly frameBytes: number;
  readonly elapsedMilliseconds: number;
}

export type DeploymentProjectScopeLookupBudgetFieldV1 =
  keyof DeploymentProjectScopeLookupUsageV1;

export interface DeploymentProjectScopeLookupRequestV1 extends JsonObject {
  readonly codecVersion: 1;
  readonly deploymentId: string;
  readonly projectId: string;
}

export type DeploymentProjectScopeLookupResponseV1 =
  | DeploymentProjectScopeLookupMatchedResponseV1
  | DeploymentProjectScopeLookupClosedResponseV1;

export interface DeploymentProjectScopeLookupMatchedResponseV1 extends JsonObject {
      readonly codecVersion: 1;
      readonly kind: "matched";
      readonly deploymentId: string;
      readonly projectId: string;
      readonly deploymentCreatedAt: string;
}

export interface DeploymentProjectScopeLookupClosedResponseV1 extends JsonObject {
      readonly codecVersion: 1;
      readonly kind: "notFound" | "projectMismatch" | "resourceFailure";
      readonly deploymentId: string;
}

export interface DeploymentProjectScopeLookupCodecSuccessV1<A> {
  readonly value: A;
  readonly bytes: Uint8Array;
  readonly usage: DeploymentProjectScopeLookupUsageV1;
}

export class DeploymentProjectScopeLookupCodecV1Error extends Data.TaggedError(
  "DeploymentProjectScopeLookupCodecV1Error",
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
const BUDGET_FIELD_NAMES = [
  "maximumLookupCalls",
  "maximumInputBytes",
  "maximumBodyBytes",
  "maximumCanonicalBytes",
  "maximumFrameBytes",
  "maximumElapsedMilliseconds",
] as const satisfies readonly (keyof DeploymentProjectScopeLookupBudgetV1)[];
const BUDGET_FAILURE_FIELD_NAMES = [
  "lookupCalls",
  "inputBytes",
  "bodyBytes",
  "canonicalBytes",
  "frameBytes",
  "elapsedMilliseconds",
] as const satisfies readonly DeploymentProjectScopeLookupBudgetFieldV1[];

export function captureDeploymentProjectScopeLookupBudgetV1(
  value: unknown,
): Result.Result<
  DeploymentProjectScopeLookupBudgetV1,
  DeploymentProjectScopeLookupCodecV1Error
> {
  if (!isNonArrayRecord(value)) {
    return Result.fail(codecFailure("budget", "invalidBudget", "budget"));
  }
  if (!hasExactKeys(value, BUDGET_FIELD_NAMES)) {
    return Result.fail(codecFailure("budget", "invalidBudget", "budget"));
  }
  const captured: Record<keyof DeploymentProjectScopeLookupBudgetV1, number> = {
    maximumLookupCalls: 0,
    maximumInputBytes: 0,
    maximumBodyBytes: 0,
    maximumCanonicalBytes: 0,
    maximumFrameBytes: 0,
    maximumElapsedMilliseconds: 0,
  };
  for (const field of BUDGET_FIELD_NAMES) {
    const fieldValue = value[field];
    if (!isNonNegativeSafeInteger(fieldValue)) {
      return Result.fail(codecFailure("budget", "invalidBudget", field));
    }
    captured[field] = fieldValue;
  }
  return Result.succeed(Object.freeze({ ...captured }));
}

export function deploymentProjectScopeLookupBudgetFitsV1(
  admission: DeploymentProjectScopeLookupBudgetV1,
  ceiling: DeploymentProjectScopeLookupBudgetV1,
): boolean {
  return BUDGET_FIELD_NAMES.every((field) => admission[field] <= ceiling[field]);
}

export function encodeDeploymentProjectScopeLookupBudgetHeaderV1(
  budgetInput: unknown,
): Result.Result<string, DeploymentProjectScopeLookupCodecV1Error> {
  return Result.map(
    captureDeploymentProjectScopeLookupBudgetV1(budgetInput),
    (budget) => BUDGET_FIELD_NAMES.map((field) => String(budget[field])).join(","),
  );
}

export function decodeDeploymentProjectScopeLookupBudgetHeaderV1(
  value: unknown,
): Result.Result<
  DeploymentProjectScopeLookupBudgetV1,
  DeploymentProjectScopeLookupCodecV1Error
> {
  if (typeof value !== "string") {
    return Result.fail(codecFailure("budgetHeader", "invalidBudgetHeader", "header"));
  }
  const parts = value.split(",");
  if (parts.length !== BUDGET_FIELD_NAMES.length) {
    return Result.fail(codecFailure("budgetHeader", "invalidBudgetHeader", "header"));
  }
  const decoded: Record<keyof DeploymentProjectScopeLookupBudgetV1, number> = {
    maximumLookupCalls: 0,
    maximumInputBytes: 0,
    maximumBodyBytes: 0,
    maximumCanonicalBytes: 0,
    maximumFrameBytes: 0,
    maximumElapsedMilliseconds: 0,
  };
  for (let index = 0; index < BUDGET_FIELD_NAMES.length; index += 1) {
    const field = BUDGET_FIELD_NAMES[index];
    const text = parts[index];
    if (field === undefined || text === undefined || !/^(0|[1-9][0-9]*)$/.test(text)) {
      return Result.fail(codecFailure("budgetHeader", "invalidBudgetHeader", "header"));
    }
    const parsed = Number(text);
    if (!isNonNegativeSafeInteger(parsed)) {
      return Result.fail(codecFailure("budgetHeader", "invalidBudgetHeader", field));
    }
    decoded[field] = parsed;
  }
  return captureDeploymentProjectScopeLookupBudgetV1(decoded);
}

export function encodeDeploymentProjectScopeLookupBudgetFailureHeaderV1(
  value: unknown,
): Result.Result<
  DeploymentProjectScopeLookupBudgetFieldV1,
  DeploymentProjectScopeLookupCodecV1Error
> {
  for (const field of BUDGET_FAILURE_FIELD_NAMES) {
    if (value === field) return Result.succeed(field);
  }
  return Result.fail(codecFailure(
    "budgetFailureHeader",
    "invalidBudgetFailureHeader",
    "header",
  ));
}

export function decodeDeploymentProjectScopeLookupBudgetFailureHeaderV1(
  value: unknown,
): Result.Result<
  DeploymentProjectScopeLookupBudgetFieldV1,
  DeploymentProjectScopeLookupCodecV1Error
> {
  return encodeDeploymentProjectScopeLookupBudgetFailureHeaderV1(value);
}

export function encodeDeploymentProjectScopeLookupRequestV1(
  value: unknown,
  budgetInput: unknown,
): Result.Result<
  DeploymentProjectScopeLookupCodecSuccessV1<DeploymentProjectScopeLookupRequestV1>,
  DeploymentProjectScopeLookupCodecV1Error
> {
  return Result.gen(function* () {
    const budget = yield* captureDeploymentProjectScopeLookupBudgetV1(budgetInput);
    const request = yield* decodeRequestUnknown(value, "encodeRequest");
    return yield* encodeProjection("encodeRequest", request, budget);
  });
}

export function decodeDeploymentProjectScopeLookupRequestV1(
  bytesInput: unknown,
  budgetInput: unknown,
): Result.Result<
  DeploymentProjectScopeLookupCodecSuccessV1<DeploymentProjectScopeLookupRequestV1>,
  DeploymentProjectScopeLookupCodecV1Error
> {
  return decodeStoredProjection(
    "decodeRequest",
    bytesInput,
    budgetInput,
    (value) => decodeRequestUnknown(value, "decodeRequest"),
  );
}

export function encodeDeploymentProjectScopeLookupResponseV1(
  value: unknown,
  budgetInput: unknown,
): Result.Result<
  DeploymentProjectScopeLookupCodecSuccessV1<DeploymentProjectScopeLookupResponseV1>,
  DeploymentProjectScopeLookupCodecV1Error
> {
  return Result.gen(function* () {
    const budget = yield* captureDeploymentProjectScopeLookupBudgetV1(budgetInput);
    const response = yield* decodeResponseUnknown(value, "encodeResponse");
    return yield* encodeProjection("encodeResponse", response, budget);
  });
}

export function decodeDeploymentProjectScopeLookupResponseV1(
  bytesInput: unknown,
  budgetInput: unknown,
): Result.Result<
  DeploymentProjectScopeLookupCodecSuccessV1<DeploymentProjectScopeLookupResponseV1>,
  DeploymentProjectScopeLookupCodecV1Error
> {
  return decodeStoredProjection(
    "decodeResponse",
    bytesInput,
    budgetInput,
    (value) => decodeResponseUnknown(value, "decodeResponse"),
  );
}

function decodeStoredProjection<A extends Json>(
  operation: "decodeRequest" | "decodeResponse",
  bytesInput: unknown,
  budgetInput: unknown,
  decode: (
    value: unknown,
  ) => Result.Result<A, DeploymentProjectScopeLookupCodecV1Error>,
): Result.Result<
  DeploymentProjectScopeLookupCodecSuccessV1<A>,
  DeploymentProjectScopeLookupCodecV1Error
> {
  return Result.gen(function* () {
    const budget = yield* captureDeploymentProjectScopeLookupBudgetV1(budgetInput);
    const bytes = yield* captureInputBytes(bytesInput, operation, budget.maximumBodyBytes);
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
    const encoded = yield* encodeProjection(operation, value, budget);
    if (!bytesEqualFullScan(bytes, encoded.bytes)) {
      return yield* Result.fail(codecFailure(operation, "nonCanonical", "body"));
    }
    return Object.freeze({
      value: encoded.value,
      bytes: new Uint8Array(encoded.bytes),
      usage: Object.freeze({
        ...encoded.usage,
        bodyBytes: bytes.byteLength,
        frameBytes: bytes.byteLength,
      }),
    });
  });
}

function encodeProjection<A extends Json>(
  operation:
    | "encodeRequest"
    | "decodeRequest"
    | "encodeResponse"
    | "decodeResponse",
  value: A,
  budget: DeploymentProjectScopeLookupBudgetV1,
): Result.Result<
  DeploymentProjectScopeLookupCodecSuccessV1<A>,
  DeploymentProjectScopeLookupCodecV1Error
> {
  return Result.gen(function* () {
    const inputBytes = projectionInputBytes(value);
    yield* requireWithin(operation, "inputBytes", inputBytes, budget.maximumInputBytes);
    const canonicalText = encodeCanonicalJson(value, canonicalInvariantDefect);
    const canonicalBytes = UTF8_ENCODER.encode(canonicalText);
    yield* requireWithin(
      operation,
      "canonicalBytes",
      canonicalBytes.byteLength,
      budget.maximumCanonicalBytes,
    );
    yield* requireWithin(
      operation,
      "frameBytes",
      canonicalBytes.byteLength,
      budget.maximumFrameBytes,
    );
    yield* requireWithin(
      operation,
      "bodyBytes",
      canonicalBytes.byteLength,
      budget.maximumBodyBytes,
    );
    const bytes = new Uint8Array(canonicalBytes);
    return Object.freeze({
      value,
      bytes,
      usage: Object.freeze({
        lookupCalls: 0,
        inputBytes,
        bodyBytes: bytes.byteLength,
        canonicalBytes: canonicalBytes.byteLength,
        frameBytes: bytes.byteLength,
        elapsedMilliseconds: 0,
      }),
    });
  });
}

function decodeRequestUnknown(
  value: unknown,
  operation: "encodeRequest" | "decodeRequest",
): Result.Result<
  DeploymentProjectScopeLookupRequestV1,
  DeploymentProjectScopeLookupCodecV1Error
> {
  if (!isNonArrayRecord(value) || !hasExactKeys(value, [
    "codecVersion",
    "deploymentId",
    "projectId",
  ])) {
    return Result.fail(codecFailure(operation, "invalidInput", "request"));
  }
  if (value.codecVersion !== 1) {
    return Result.fail(codecFailure(operation, "invalidInput", "codecVersion"));
  }
  if (typeof value.deploymentId !== "string" || value.deploymentId.length === 0) {
    return Result.fail(codecFailure(operation, "invalidInput", "deploymentId"));
  }
  if (typeof value.projectId !== "string" || value.projectId.length === 0) {
    return Result.fail(codecFailure(operation, "invalidInput", "projectId"));
  }
  return Result.succeed(Object.freeze({
    codecVersion: 1,
    deploymentId: value.deploymentId,
    projectId: value.projectId,
  }));
}

function decodeResponseUnknown(
  value: unknown,
  operation: "encodeResponse" | "decodeResponse",
): Result.Result<
  DeploymentProjectScopeLookupResponseV1,
  DeploymentProjectScopeLookupCodecV1Error
> {
  if (!isNonArrayRecord(value) || value.codecVersion !== 1) {
    return Result.fail(codecFailure(operation, "invalidInput", "response"));
  }
  if (typeof value.deploymentId !== "string" || value.deploymentId.length === 0) {
    return Result.fail(codecFailure(operation, "invalidInput", "deploymentId"));
  }
  if (value.kind === "matched") {
    if (!hasExactKeys(value, [
      "codecVersion",
      "deploymentCreatedAt",
      "deploymentId",
      "kind",
      "projectId",
    ])) {
      return Result.fail(codecFailure(operation, "invalidInput", "response"));
    }
    if (typeof value.projectId !== "string" || value.projectId.length === 0) {
      return Result.fail(codecFailure(operation, "invalidInput", "projectId"));
    }
    if (
      typeof value.deploymentCreatedAt !== "string" ||
      !isCanonicalIsoTimestamp(value.deploymentCreatedAt)
    ) {
      return Result.fail(codecFailure(operation, "invalidInput", "deploymentCreatedAt"));
    }
    return Result.succeed(Object.freeze({
      codecVersion: 1,
      kind: "matched",
      deploymentId: value.deploymentId,
      projectId: value.projectId,
      deploymentCreatedAt: value.deploymentCreatedAt,
    }));
  }
  if (
    value.kind !== "notFound" &&
    value.kind !== "projectMismatch" &&
    value.kind !== "resourceFailure"
  ) {
    return Result.fail(codecFailure(operation, "invalidInput", "kind"));
  }
  if (!hasExactKeys(value, ["codecVersion", "deploymentId", "kind"])) {
    return Result.fail(codecFailure(operation, "invalidInput", "response"));
  }
  return Result.succeed(Object.freeze({
    codecVersion: 1,
    kind: value.kind,
    deploymentId: value.deploymentId,
  }));
}

function captureInputBytes(
  value: unknown,
  operation: "decodeRequest" | "decodeResponse",
  maximumBodyBytes: number,
): Result.Result<Uint8Array, DeploymentProjectScopeLookupCodecV1Error> {
  if (!isUint8Array(value)) {
    return Result.fail(codecFailure(operation, "invalidInput", "body"));
  }
  let captured: Uint8Array;
  try {
    captured = new Uint8Array(Uint8Array.prototype.values.call(value));
  } catch {
    return Result.fail(codecFailure(operation, "invalidInput", "body"));
  }
  if (captured.byteLength > maximumBodyBytes) {
    return Result.fail(codecFailure(operation, "budgetExhausted", "bodyBytes"));
  }
  return Result.succeed(captured);
}

function projectionInputBytes(value: Json): number {
  if (!isNonArrayRecord(value)) return 0;
  let total = 0;
  for (const field of ["deploymentId", "projectId", "deploymentCreatedAt"] as const) {
    const member = value[field];
    if (typeof member !== "string") continue;
    const next = total + UTF8_ENCODER.encode(member).byteLength;
    if (!Number.isSafeInteger(next)) {
      throw new Error("Deployment-scope lookup input byte accounting overflowed.");
    }
    total = next;
  }
  return total;
}

function requireWithin(
  operation:
    | "encodeRequest"
    | "decodeRequest"
    | "encodeResponse"
    | "decodeResponse",
  field: "inputBytes" | "bodyBytes" | "canonicalBytes" | "frameBytes",
  used: number,
  maximum: number,
): Result.Result<void, DeploymentProjectScopeLookupCodecV1Error> {
  return used <= maximum
    ? Result.succeed(undefined)
    : Result.fail(codecFailure(operation, "budgetExhausted", field));
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length &&
    keys.every((key, index) => key === sortedExpected[index]);
}

function codecFailure(
  operation: DeploymentProjectScopeLookupCodecV1Error["operation"],
  reason: DeploymentProjectScopeLookupCodecV1Error["reason"],
  field: string,
): DeploymentProjectScopeLookupCodecV1Error {
  return new DeploymentProjectScopeLookupCodecV1Error({ operation, reason, field });
}

function canonicalInvariantDefect(): never {
  throw new Error("Validated deployment-scope lookup evidence lost canonical JSON membership.");
}
