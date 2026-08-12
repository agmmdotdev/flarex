import {
  copyBytes,
  copyBytesToArrayBuffer,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { isNonBlankString } from "@flarex/utils/strings";
import { Data, Effect, Result, Schema } from "effect";

import {
  canonicalizeApplicationRuntimeTargetV1,
  type ApplicationRuntimeTargetV1,
} from "./application-runtime-target-v1";
import {
  decodeUserIdentityEffect,
  type UserIdentity,
} from "./auth";
import { CatalogTableIdSchema, type CatalogTableId } from "./catalog";
import {
  SchemaManifestAppTableNameSchema,
  type SchemaManifestAppTableName,
} from "./schema-manifest";
import {
  MAX_POINT_MUTATION_ARGUMENT_ARRAY_SEMANTIC_BYTES_V1,
  POINT_MUTATION_ARGUMENT_ARRAY_OVERHEAD_SEMANTIC_BYTES_V1,
} from "./point-mutation-start";
import {
  isCanonicalFlarexRuntimeObjectV1,
  MAX_FLAREX_VALUE_ARRAY_ITEMS_V1,
  MAX_FLAREX_VALUE_NESTING_V1,
  MAX_FLAREX_VALUE_OBJECT_FIELDS_V1,
  FlarexValueCodecV1Error,
  normalizeFlarexValueV1,
  type CanonicalFlarexRuntimeObjectV1,
  type CanonicalFlarexRuntimeValueV1,
  type NormalizedFlarexValueV1,
} from "./value";

export const APPLICATION_TRANSACTION_WORKER_REQUEST_FORMAT_V1 =
  "flarex.application-transaction-worker-request" as const;
export const APPLICATION_TRANSACTION_WORKER_REQUEST_VERSION_V1 = 1 as const;
export const APPLICATION_ACTION_WORKER_REQUEST_FORMAT_V1 =
  "flarex.application-action-worker-request" as const;
export const APPLICATION_ACTION_WORKER_REQUEST_VERSION_V1 = 1 as const;
export const APPLICATION_WORKER_RESULT_FORMAT_V1 =
  "flarex.application-worker-result" as const;
export const APPLICATION_WORKER_RESULT_VERSION_V1 = 1 as const;
export const APPLICATION_WORKER_RANDOM_SEED_BYTES_V1 = 32;
export const APPLICATION_ACTION_WORKER_HOST_POLICY_SHA256_BYTES_V1 = 32;
export const MAX_APPLICATION_WORKER_CONTEXT_TEXT_BYTES_V1 = 4_096;
export const MAX_APPLICATION_WORKER_AUTH_SEMANTIC_BYTES_V1 = 64 * 1_024;
export const MAX_APPLICATION_QUERY_ARGUMENT_SEMANTIC_BYTES_V1 = 1 << 20;
export const MAX_APPLICATION_ACTION_ARGUMENT_SEMANTIC_BYTES_V1 = 1 << 20;
export const MAX_APPLICATION_WRITE_ARGUMENT_SEMANTIC_BYTES_V1 =
  MAX_POINT_MUTATION_ARGUMENT_ARRAY_SEMANTIC_BYTES_V1 -
  POINT_MUTATION_ARGUMENT_ARRAY_OVERHEAD_SEMANTIC_BYTES_V1;
export const MAX_APPLICATION_WORKER_RESULT_SEMANTIC_BYTES_V1 = 8 * 1_048_576;
export const MAX_APPLICATION_WORKER_TABLES_V1 = 1_024;
export const MAX_APPLICATION_WORKER_VALUE_NODES_V1 = 65_536;
export const MAX_APPLICATION_WORKER_MEMBER_INSPECTIONS_V1 = 131_072;

const TEXT_ENCODER = new TextEncoder();
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get;
const VALUE_BUDGET_EXCEEDED = Symbol("applicationWorkerValueBudgetExceeded");
class ApplicationWorkerProtocolV1Defect extends Error {}
const decodeCatalogTableId = Schema.decodeUnknownResult(CatalogTableIdSchema);
const decodeAppTableName = Schema.decodeUnknownResult(
  SchemaManifestAppTableNameSchema,
);

export type ApplicationWorkerAuthV1 =
  | Readonly<{ readonly kind: "anonymous" }>
  | Readonly<{ readonly kind: "user"; readonly user: UserIdentity }>;

export interface ApplicationWorkerTableV1 {
  readonly tableId: CatalogTableId;
  readonly logicalName: SchemaManifestAppTableName;
}

export interface ApplicationTransactionQueryContextV1 {
  readonly mode: "query";
  readonly executionId: string;
  readonly randomSeed: Uint8Array;
  readonly executionTime: number;
  readonly snapshotCommitSeq: bigint;
}

export interface ApplicationTransactionWriteContextV1 {
  readonly mode: "write";
  readonly executionId: string;
  readonly logScopeId: string;
  readonly randomSeed: Uint8Array;
  readonly executionTime: number;
  readonly initialCreationTimeCursor: number;
}

export type ApplicationTransactionWorkerContextV1 =
  | ApplicationTransactionQueryContextV1
  | ApplicationTransactionWriteContextV1;

export interface ApplicationTransactionWorkerRequestV1 {
  readonly format: typeof APPLICATION_TRANSACTION_WORKER_REQUEST_FORMAT_V1;
  readonly version: typeof APPLICATION_TRANSACTION_WORKER_REQUEST_VERSION_V1;
  readonly target: ApplicationRuntimeTargetV1;
  readonly auth: ApplicationWorkerAuthV1;
  readonly arguments: CanonicalFlarexRuntimeObjectV1;
  readonly argumentSemanticBytes: number;
  readonly tables: ReadonlyArray<ApplicationWorkerTableV1>;
  readonly context: ApplicationTransactionWorkerContextV1;
}

export interface ApplicationActionWorkerContextV1 {
  readonly executionId: string;
  readonly invocationId: string;
  readonly executionGeneration: bigint;
  readonly executionTime: number;
  readonly executionDeadline: number;
  readonly randomSeed: Uint8Array;
  readonly hostPolicySha256: Uint8Array;
}

export interface ApplicationActionWorkerRequestV1 {
  readonly format: typeof APPLICATION_ACTION_WORKER_REQUEST_FORMAT_V1;
  readonly version: typeof APPLICATION_ACTION_WORKER_REQUEST_VERSION_V1;
  readonly target: ApplicationRuntimeTargetV1;
  readonly auth: ApplicationWorkerAuthV1;
  readonly arguments: CanonicalFlarexRuntimeObjectV1;
  readonly argumentSemanticBytes: number;
  readonly context: ApplicationActionWorkerContextV1;
}

export interface ApplicationWorkerResultV1 {
  readonly format: typeof APPLICATION_WORKER_RESULT_FORMAT_V1;
  readonly version: typeof APPLICATION_WORKER_RESULT_VERSION_V1;
  readonly value: CanonicalFlarexRuntimeValueV1;
}

export interface NormalizedApplicationWorkerArgumentsV1 {
  readonly value: CanonicalFlarexRuntimeObjectV1;
  readonly semanticSizeBytes: number;
}

export class ApplicationWorkerProtocolV1Error extends Data.TaggedError(
  "ApplicationWorkerProtocolV1Error",
)<{
  readonly boundary: "transactionRequest" | "actionRequest" | "result";
  readonly reason:
    | "invalidShape"
    | "invalidTarget"
    | "invalidTargetKind"
    | "invalidAuth"
    | "invalidArguments"
    | "argumentSizeMismatch"
    | "invalidResult";
  readonly path?: string;
  readonly cause?: unknown;
}> {}

/**
 * Own and normalize query arguments under the query-family traversal budget.
 * Request composers use this to derive the advertised semantic byte count
 * without first entering the broader general Value normalization ceiling.
 */
export const normalizeApplicationQueryArgumentsV1Effect = Effect.fn(
  "ApplicationWorkerProtocol.normalizeQueryArgumentsV1",
)((input: unknown): Effect.Effect<
  NormalizedApplicationWorkerArgumentsV1,
  ApplicationWorkerProtocolV1Error
> => decodeArguments(
  input,
  MAX_APPLICATION_QUERY_ARGUMENT_SEMANTIC_BYTES_V1,
  "transactionRequest",
));

export const decodeApplicationTransactionWorkerRequestV1Effect = Effect.fn(
  "ApplicationWorkerProtocol.decodeTransactionRequestV1",
)(function* (
  input: unknown,
): Effect.fn.Return<
  ApplicationTransactionWorkerRequestV1,
  ApplicationWorkerProtocolV1Error
> {
  const boundary = "transactionRequest" as const;
  const request = yield* decodeRecord(input, [
    "format",
    "version",
    "target",
    "auth",
    "arguments",
    "argumentSemanticBytes",
    "tables",
    "context",
  ], boundary, "$request");
  if (
    request.format !== APPLICATION_TRANSACTION_WORKER_REQUEST_FORMAT_V1 ||
    request.version !== APPLICATION_TRANSACTION_WORKER_REQUEST_VERSION_V1
  ) return yield* fail(boundary, "invalidShape", "$request");

  const target = yield* decodeTarget(request.target, boundary);
  if (target.function.kind === "action") {
    return yield* fail(boundary, "invalidTargetKind", "target.function.kind");
  }
  const maximumArgumentBytes = target.function.kind === "query"
    ? MAX_APPLICATION_QUERY_ARGUMENT_SEMANTIC_BYTES_V1
    : MAX_APPLICATION_WRITE_ARGUMENT_SEMANTIC_BYTES_V1;
  const advertisedArgumentBytes = yield* precheckArgumentSize(
    request.argumentSemanticBytes,
    maximumArgumentBytes,
    boundary,
  );
  const context = yield* decodeTransactionContext(request.context, boundary);
  if (
    (target.function.kind === "query" && context.mode !== "query") ||
    (target.function.kind !== "query" && context.mode !== "write")
  ) return yield* fail(boundary, "invalidTargetKind", "context.mode");
  const auth = yield* decodeAuth(request.auth, boundary);
  const normalizedArguments = yield* decodeArguments(
    request.arguments,
    maximumArgumentBytes,
    boundary,
  );
  const argumentSemanticBytes = yield* verifyArgumentSize(
    advertisedArgumentBytes,
    normalizedArguments.semanticSizeBytes,
    boundary,
  );
  const tables = yield* decodeTables(request.tables, boundary);

  return Object.freeze({
    format: APPLICATION_TRANSACTION_WORKER_REQUEST_FORMAT_V1,
    version: APPLICATION_TRANSACTION_WORKER_REQUEST_VERSION_V1,
    target,
    auth,
    arguments: normalizedArguments.value,
    argumentSemanticBytes,
    tables,
    context,
  });
});

export const decodeApplicationActionWorkerRequestV1Effect = Effect.fn(
  "ApplicationWorkerProtocol.decodeActionRequestV1",
)(function* (
  input: unknown,
): Effect.fn.Return<
  ApplicationActionWorkerRequestV1,
  ApplicationWorkerProtocolV1Error
> {
  const boundary = "actionRequest" as const;
  const request = yield* decodeRecord(input, [
    "format",
    "version",
    "target",
    "auth",
    "arguments",
    "argumentSemanticBytes",
    "context",
  ], boundary, "$request");
  if (
    request.format !== APPLICATION_ACTION_WORKER_REQUEST_FORMAT_V1 ||
    request.version !== APPLICATION_ACTION_WORKER_REQUEST_VERSION_V1
  ) return yield* fail(boundary, "invalidShape", "$request");

  const target = yield* decodeTarget(request.target, boundary);
  if (target.function.kind !== "action") {
    return yield* fail(boundary, "invalidTargetKind", "target.function.kind");
  }
  const advertisedArgumentBytes = yield* precheckArgumentSize(
    request.argumentSemanticBytes,
    MAX_APPLICATION_ACTION_ARGUMENT_SEMANTIC_BYTES_V1,
    boundary,
  );
  const auth = yield* decodeAuth(request.auth, boundary);
  const normalizedArguments = yield* decodeArguments(
    request.arguments,
    MAX_APPLICATION_ACTION_ARGUMENT_SEMANTIC_BYTES_V1,
    boundary,
  );
  const argumentSemanticBytes = yield* verifyArgumentSize(
    advertisedArgumentBytes,
    normalizedArguments.semanticSizeBytes,
    boundary,
  );
  const context = yield* decodeActionContext(request.context, boundary);

  return Object.freeze({
    format: APPLICATION_ACTION_WORKER_REQUEST_FORMAT_V1,
    version: APPLICATION_ACTION_WORKER_REQUEST_VERSION_V1,
    target,
    auth,
    arguments: normalizedArguments.value,
    argumentSemanticBytes,
    context,
  });
});

export const decodeApplicationWorkerResultV1Effect = Effect.fn(
  "ApplicationWorkerProtocol.decodeResultV1",
)(function* (
  input: unknown,
): Effect.fn.Return<
  ApplicationWorkerResultV1,
  ApplicationWorkerProtocolV1Error
> {
  const boundary = "result" as const;
  const result = yield* decodeRecord(input, [
    "format",
    "version",
    "value",
  ], boundary, "$result");
  if (
    result.format !== APPLICATION_WORKER_RESULT_FORMAT_V1 ||
    result.version !== APPLICATION_WORKER_RESULT_VERSION_V1
  ) return yield* fail(boundary, "invalidShape", "$result");
  const capturedValue = yield* captureValueWithinBudgetEffect(
    result.value,
    MAX_APPLICATION_WORKER_RESULT_SEMANTIC_BYTES_V1,
    boundary,
    "invalidResult",
    "value",
  );
  const normalized = yield* normalizeOwnedValueEffect(
    capturedValue,
    boundary,
    "invalidResult",
    "value",
  );
  return Object.freeze({
    format: APPLICATION_WORKER_RESULT_FORMAT_V1,
    version: APPLICATION_WORKER_RESULT_VERSION_V1,
    value: normalized.value,
  });
});

function decodeTarget(
  value: unknown,
  boundary: "transactionRequest" | "actionRequest",
): Effect.Effect<ApplicationRuntimeTargetV1, ApplicationWorkerProtocolV1Error> {
  return Effect.fromResult(
    canonicalizeApplicationRuntimeTargetV1(value).pipe(
      Result.map(canonical => canonical.target),
      Result.mapError(cause =>
        protocolError(boundary, "invalidTarget", "target", cause)
      ),
    ),
  );
}

function decodeAuth(
  value: unknown,
  boundary: "transactionRequest" | "actionRequest",
): Effect.Effect<ApplicationWorkerAuthV1, ApplicationWorkerProtocolV1Error> {
  return Effect.gen(function* () {
    const auth = yield* decodeRecordUnion(
      value,
      [["kind"], ["kind", "user"]],
      boundary,
      "auth",
      "invalidAuth",
    );
    if (auth.kind === "anonymous") {
      if (Object.hasOwn(auth, "user")) {
        return yield* fail(boundary, "invalidAuth", "auth");
      }
      return Object.freeze({ kind: "anonymous" as const });
    }
    if (auth.kind !== "user") {
      return yield* fail(boundary, "invalidAuth", "auth.kind");
    }
    const capturedUser = yield* captureValueWithinBudgetEffect(
      auth.user,
      MAX_APPLICATION_WORKER_AUTH_SEMANTIC_BYTES_V1,
      boundary,
      "invalidAuth",
      "auth.user",
    );
    const normalized = yield* normalizeOwnedValueEffect(
      capturedUser,
      boundary,
      "invalidAuth",
      "auth.user",
    );
    if (
      !isCanonicalFlarexRuntimeObjectV1(normalized.value) ||
      normalized.semanticSizeBytes >
        MAX_APPLICATION_WORKER_AUTH_SEMANTIC_BYTES_V1
    ) return yield* fail(boundary, "invalidAuth", "auth.user");
    const user = yield* decodeUserIdentityEffect(normalized.value).pipe(
      Effect.mapError(cause =>
        protocolError(boundary, "invalidAuth", "auth.user", cause)
      ),
    );
    return Object.freeze({ kind: "user" as const, user });
  });
}

function decodeArguments(
  value: unknown,
  maximumSemanticBytes: number,
  boundary: "transactionRequest" | "actionRequest",
): Effect.Effect<
  NormalizedApplicationWorkerArgumentsV1,
  ApplicationWorkerProtocolV1Error
> {
  return captureValueWithinBudgetEffect(
    value,
    maximumSemanticBytes,
    boundary,
    "invalidArguments",
    "arguments",
  ).pipe(Effect.flatMap(captured => normalizeOwnedValueEffect(
    captured,
    boundary,
    "invalidArguments",
    "arguments",
  )), Effect.flatMap(normalized =>
    isCanonicalFlarexRuntimeObjectV1(normalized.value) &&
        normalized.semanticSizeBytes <= maximumSemanticBytes
      ? Effect.succeed(Object.freeze({
        value: normalized.value,
        semanticSizeBytes: normalized.semanticSizeBytes,
      }))
      : fail(boundary, "invalidArguments", "arguments")
  ));
}

function captureValueWithinBudgetEffect(
  value: unknown,
  maximumSemanticBytes: number,
  boundary: "transactionRequest" | "actionRequest" | "result",
  reason: "invalidAuth" | "invalidArguments" | "invalidResult",
  path: string,
): Effect.Effect<unknown, ApplicationWorkerProtocolV1Error> {
  return Effect.fromResult(captureValueWithinBudget(
    value,
    maximumSemanticBytes,
  )).pipe(Effect.catch(cause =>
    cause instanceof ApplicationWorkerProtocolV1Defect
      ? Effect.die(cause)
      : Effect.fail(protocolError(boundary, reason, path, cause))
  ));
}

function captureValueWithinBudget(
  value: unknown,
  maximumSemanticBytes: number,
): Result.Result<unknown, unknown> {
  try {
    const captured = captureValueNode(
      value,
      maximumSemanticBytes,
      0,
      new WeakSet<object>(),
      {
        remainingNodes: MAX_APPLICATION_WORKER_VALUE_NODES_V1,
        remainingMemberInspections:
          MAX_APPLICATION_WORKER_MEMBER_INSPECTIONS_V1,
      },
    );
    return captured === VALUE_BUDGET_EXCEEDED
      ? Result.fail(VALUE_BUDGET_EXCEEDED)
      : Result.succeed(captured.value);
  } catch (cause) {
    return Result.fail(cause);
  }
}

/**
 * Establishes ownership while charging Value Codec V1 semantic bytes. The
 * operation-specific ceiling therefore bounds traversal and retained input
 * before the existing codec performs authoritative validation and
 * canonicalization on the owned snapshot.
 */
function captureValueNode(
  value: unknown,
  remaining: number,
  parentNesting: number,
  ancestors: WeakSet<object>,
  budget: CaptureBudget,
): CapturedBudgetNode | typeof VALUE_BUDGET_EXCEEDED {
  if (budget.remainingNodes < 1) return VALUE_BUDGET_EXCEEDED;
  budget.remainingNodes -= 1;
  if (value === null || typeof value === "boolean") {
    return captured(value, 1, remaining);
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return captured(value, 9, remaining);
  }
  if (typeof value === "string") {
    if (value.length + 2 > remaining) return VALUE_BUDGET_EXCEEDED;
    return captured(value, 2 + TEXT_ENCODER.encode(value).byteLength, remaining);
  }
  if (typeof value === "object" && value !== null && remaining < 2) {
    return VALUE_BUDGET_EXCEEDED;
  }
  if (
    typeof value === "object" && value !== null &&
    isIntrinsicArrayBuffer(value)
  ) {
    if (ARRAY_BUFFER_BYTE_LENGTH_GETTER === undefined) {
      throw new ApplicationWorkerProtocolV1Defect(
        "ArrayBuffer byte-length intrinsic is unavailable.",
      );
    }
    const byteLength: unknown = ARRAY_BUFFER_BYTE_LENGTH_GETTER.call(value);
    if (typeof byteLength !== "number") {
      throw new ApplicationWorkerProtocolV1Defect(
        "ArrayBuffer byte length is invalid.",
      );
    }
    const semanticSizeBytes = 2 + byteLength;
    if (semanticSizeBytes > remaining) return VALUE_BUDGET_EXCEEDED;
    const source = new Uint8Array(value);
    return {
      value: copyBytesToArrayBuffer(source),
      semanticSizeBytes,
    };
  }
  if (Array.isArray(value)) {
    return captureArrayNode(value, remaining, parentNesting, ancestors, budget);
  }
  if (typeof value === "object" && value !== null) {
    return captureObjectNode(value, remaining, parentNesting, ancestors, budget);
  }
  return { value, semanticSizeBytes: 0 };
}

function isIntrinsicArrayBuffer(value: object): value is ArrayBuffer {
  if (ARRAY_BUFFER_BYTE_LENGTH_GETTER === undefined) {
    throw new ApplicationWorkerProtocolV1Defect(
      "ArrayBuffer byte-length intrinsic is unavailable.",
    );
  }
  try {
    return typeof ARRAY_BUFFER_BYTE_LENGTH_GETTER.call(value) === "number";
  } catch {
    return false;
  }
}

interface CapturedBudgetNode {
  readonly value: unknown;
  readonly semanticSizeBytes: number;
}

interface CaptureBudget {
  remainingNodes: number;
  remainingMemberInspections: number;
}

function captureArrayNode(
  value: ReadonlyArray<unknown>,
  remaining: number,
  parentNesting: number,
  ancestors: WeakSet<object>,
  budget: CaptureBudget,
): CapturedBudgetNode | typeof VALUE_BUDGET_EXCEEDED {
  if (remaining < 2) return VALUE_BUDGET_EXCEEDED;
  const nesting = parentNesting + 1;
  if (nesting > MAX_FLAREX_VALUE_NESTING_V1) {
    throw new Error("Value nesting exceeds the general profile.");
  }
  if (!reserveMemberInspections(budget, 1)) {
    return VALUE_BUDGET_EXCEEDED;
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    lengthDescriptor === undefined || !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number" ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    lengthDescriptor.value > MAX_FLAREX_VALUE_ARRAY_ITEMS_V1
  ) throw new Error("Value array length is invalid.");
  const length = lengthDescriptor.value;
  if (!reserveMemberInspections(budget, length)) {
    return VALUE_BUDGET_EXCEEDED;
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1) {
    throw new Error("Value array is not exact and dense.");
  }
  if (ancestors.has(value)) throw new Error("Value is cyclic.");
  ancestors.add(value);
  try {
    let total = 2;
    const output: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      if (budget.remainingNodes < 1) return VALUE_BUDGET_EXCEEDED;
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor === undefined || !descriptor.enumerable ||
        !("value" in descriptor)
      ) throw new Error("Value array member is invalid.");
      const child = captureValueNode(
        descriptor.value,
        remaining - total,
        nesting,
        ancestors,
        budget,
      );
      if (child === VALUE_BUDGET_EXCEEDED) return child;
      total += child.semanticSizeBytes;
      output.push(child.value);
    }
    return {
      value: Object.freeze(output),
      semanticSizeBytes: total,
    };
  } finally {
    ancestors.delete(value);
  }
}

function captureObjectNode(
  value: object,
  remaining: number,
  parentNesting: number,
  ancestors: WeakSet<object>,
  budget: CaptureBudget,
): CapturedBudgetNode | typeof VALUE_BUDGET_EXCEEDED {
  if (remaining < 2) return VALUE_BUDGET_EXCEEDED;
  const nesting = parentNesting + 1;
  if (nesting > MAX_FLAREX_VALUE_NESTING_V1) {
    throw new Error("Value nesting exceeds the general profile.");
  }
  const prototype = Object.getPrototypeOf(value);
  if (
    prototype !== Object.prototype && prototype !== null &&
    !isCrossRealmObjectPrototype(prototype)
  ) throw new Error("Value object prototype is invalid.");
  const keys = Reflect.ownKeys(value);
  if (keys.length > MAX_FLAREX_VALUE_OBJECT_FIELDS_V1) {
    throw new Error("Value object has too many own properties.");
  }
  if (!reserveMemberInspections(budget, keys.length)) {
    return VALUE_BUDGET_EXCEEDED;
  }
  if (ancestors.has(value)) throw new Error("Value is cyclic.");
  ancestors.add(value);
  try {
    let total = 2;
    let definedFields = 0;
    const output: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      if (typeof key !== "string") {
        throw new Error("Value object symbol keys are unsupported.");
      }
      if (budget.remainingNodes < 1) return VALUE_BUDGET_EXCEEDED;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined || !descriptor.enumerable ||
        !("value" in descriptor)
      ) throw new Error("Value object member is invalid.");
      if (descriptor.value === undefined) continue;
      definedFields += 1;
      if (definedFields > MAX_FLAREX_VALUE_OBJECT_FIELDS_V1) {
        throw new Error("Value object has too many fields.");
      }
      const fieldCharge = key.length + 1;
      if (fieldCharge > remaining - total) return VALUE_BUDGET_EXCEEDED;
      total += fieldCharge;
      const child = captureValueNode(
        descriptor.value,
        remaining - total,
        nesting,
        ancestors,
        budget,
      );
      if (child === VALUE_BUDGET_EXCEEDED) return child;
      total += child.semanticSizeBytes;
      Object.defineProperty(output, key, {
        value: child.value,
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return {
      value: Object.freeze(output),
      semanticSizeBytes: total,
    };
  } finally {
    ancestors.delete(value);
  }
}

function reserveMemberInspections(
  budget: CaptureBudget,
  count: number,
): boolean {
  if (count > budget.remainingMemberInspections) return false;
  budget.remainingMemberInspections -= count;
  return true;
}

function captured(
  value: unknown,
  charge: number,
  remaining: number,
): CapturedBudgetNode | typeof VALUE_BUDGET_EXCEEDED {
  return charge <= remaining
    ? { value, semanticSizeBytes: charge }
    : VALUE_BUDGET_EXCEEDED;
}

function isCrossRealmObjectPrototype(value: object): boolean {
  const constructor = Object.getOwnPropertyDescriptor(value, "constructor");
  if (
    constructor === undefined || !("value" in constructor) ||
    typeof constructor.value !== "function"
  ) return false;
  const name = Object.getOwnPropertyDescriptor(constructor.value, "name");
  return name !== undefined && "value" in name && name.value === "Object";
}

function normalizeOwnedValueEffect(
  value: unknown,
  boundary: ApplicationWorkerProtocolV1Error["boundary"],
  reason: "invalidAuth" | "invalidArguments" | "invalidResult",
  path?: string,
): Effect.Effect<NormalizedFlarexValueV1, ApplicationWorkerProtocolV1Error> {
  return Effect.try({
    try: () => normalizeFlarexValueV1(value),
    catch: cause => cause,
  }).pipe(Effect.catch(cause =>
    cause instanceof FlarexValueCodecV1Error
      ? Effect.fail(protocolError(boundary, reason, path, cause))
      : Effect.die(cause)
  ));
}

function precheckArgumentSize(
  value: unknown,
  maximum: number,
  boundary: "transactionRequest" | "actionRequest",
): Effect.Effect<number, ApplicationWorkerProtocolV1Error> {
  return typeof value === "number" && Number.isSafeInteger(value) &&
      value >= 1 && value <= maximum
    ? Effect.succeed(value)
    : fail(boundary, "argumentSizeMismatch", "argumentSemanticBytes");
}

function verifyArgumentSize(
  advertised: number,
  observed: number,
  boundary: "transactionRequest" | "actionRequest",
): Effect.Effect<number, ApplicationWorkerProtocolV1Error> {
  return advertised === observed
    ? Effect.succeed(advertised)
    : fail(boundary, "argumentSizeMismatch", "argumentSemanticBytes");
}

function decodeTables(
  value: unknown,
  boundary: "transactionRequest",
): Effect.Effect<
  ReadonlyArray<ApplicationWorkerTableV1>,
  ApplicationWorkerProtocolV1Error
> {
  return Effect.fromResult(captureExactArray(value, MAX_APPLICATION_WORKER_TABLES_V1)).pipe(
    Effect.mapError(cause =>
      protocolError(boundary, "invalidShape", "tables", cause)
    ),
    Effect.flatMap(items => Effect.gen(function* () {
      const ids = new Set<number>();
      const names = new Set<string>();
      const output: ApplicationWorkerTableV1[] = [];
      for (let index = 0; index < items.length; index += 1) {
        const table = yield* decodeRecord(
          items[index],
          ["tableId", "logicalName"],
          boundary,
          `tables[${index}]`,
        );
        const tableId = yield* Effect.fromResult(
          decodeCatalogTableId(table.tableId).pipe(
            Result.mapError(cause => protocolError(
              boundary,
              "invalidShape",
              `tables[${index}].tableId`,
              cause,
            )),
          ),
        );
        const logicalName = yield* Effect.fromResult(
          decodeAppTableName(table.logicalName).pipe(
            Result.mapError(cause => protocolError(
              boundary,
              "invalidShape",
              `tables[${index}].logicalName`,
              cause,
            )),
          ),
        );
        if (ids.has(tableId) || names.has(logicalName)) {
          return yield* fail(boundary, "invalidShape", `tables[${index}]`);
        }
        ids.add(tableId);
        names.add(logicalName);
        output.push(Object.freeze({
          tableId,
          logicalName,
        }));
      }
      return Object.freeze(output);
    })),
  );
}

function decodeTransactionContext(
  value: unknown,
  boundary: "transactionRequest",
): Effect.Effect<
  ApplicationTransactionWorkerContextV1,
  ApplicationWorkerProtocolV1Error
> {
  return Effect.gen(function* () {
    const context = yield* decodeRecordUnion(value, [[
      "mode",
      "executionId",
      "randomSeed",
      "executionTime",
      "snapshotCommitSeq",
    ], [
      "mode",
      "executionId",
      "logScopeId",
      "randomSeed",
      "executionTime",
      "initialCreationTimeCursor",
    ]], boundary, "context");
    if (context.mode === "query") {
      const randomSeed = yield* decodeBytes(
        context.randomSeed,
        APPLICATION_WORKER_RANDOM_SEED_BYTES_V1,
        boundary,
        "context.randomSeed",
      );
      if (
        !isBoundedText(context.executionId) ||
        !isFiniteNumber(context.executionTime) ||
        typeof context.snapshotCommitSeq !== "bigint" ||
        context.snapshotCommitSeq < 0n
      ) return yield* fail(boundary, "invalidShape", "context");
      return Object.freeze({
        mode: "query" as const,
        executionId: context.executionId,
        randomSeed,
        executionTime: context.executionTime,
        snapshotCommitSeq: context.snapshotCommitSeq,
      });
    }
    if (context.mode !== "write") {
      return yield* fail(boundary, "invalidShape", "context.mode");
    }
    const randomSeed = yield* decodeBytes(
      context.randomSeed,
      APPLICATION_WORKER_RANDOM_SEED_BYTES_V1,
      boundary,
      "context.randomSeed",
    );
    if (
      !isBoundedText(context.executionId) ||
      !isBoundedText(context.logScopeId) ||
      !isAppCreationTime(context.executionTime) ||
      !isAppCreationTime(context.initialCreationTimeCursor)
    ) return yield* fail(boundary, "invalidShape", "context");
    return Object.freeze({
      mode: "write" as const,
      executionId: context.executionId,
      logScopeId: context.logScopeId,
      randomSeed,
      executionTime: context.executionTime,
      initialCreationTimeCursor: context.initialCreationTimeCursor,
    });
  });
}

function decodeActionContext(
  value: unknown,
  boundary: "actionRequest",
): Effect.Effect<ApplicationActionWorkerContextV1, ApplicationWorkerProtocolV1Error> {
  return Effect.gen(function* () {
    const context = yield* decodeRecord(value, [
      "executionId",
      "invocationId",
      "executionGeneration",
      "executionTime",
      "executionDeadline",
      "randomSeed",
      "hostPolicySha256",
    ], boundary, "context");
    const randomSeed = yield* decodeBytes(
      context.randomSeed,
      APPLICATION_WORKER_RANDOM_SEED_BYTES_V1,
      boundary,
      "context.randomSeed",
    );
    const hostPolicySha256 = yield* decodeBytes(
      context.hostPolicySha256,
      APPLICATION_ACTION_WORKER_HOST_POLICY_SHA256_BYTES_V1,
      boundary,
      "context.hostPolicySha256",
    );
    if (
      !isBoundedText(context.executionId) ||
      !isBoundedText(context.invocationId) ||
      typeof context.executionGeneration !== "bigint" ||
      context.executionGeneration < 1n ||
      !isFiniteNumber(context.executionTime) ||
      !isFiniteNumber(context.executionDeadline) ||
      context.executionDeadline < context.executionTime
    ) return yield* fail(boundary, "invalidShape", "context");
    return Object.freeze({
      executionId: context.executionId,
      invocationId: context.invocationId,
      executionGeneration: context.executionGeneration,
      executionTime: context.executionTime,
      executionDeadline: context.executionDeadline,
      randomSeed,
      hostPolicySha256,
    });
  });
}

function decodeBytes(
  value: unknown,
  length: number,
  boundary: "transactionRequest" | "actionRequest",
  path: string,
): Effect.Effect<Uint8Array, ApplicationWorkerProtocolV1Error> {
  return Effect.try({
    try: () => {
      if (!isUint8ArrayWithByteLength(value, length)) {
        throw new Error(`Expected ${length} bytes.`);
      }
      return copyBytes(value);
    },
    catch: cause => protocolError(boundary, "invalidShape", path, cause),
  });
}

function decodeRecord(
  value: unknown,
  keys: ReadonlyArray<string>,
  boundary: "transactionRequest" | "actionRequest" | "result",
  path: string,
  reason: ApplicationWorkerProtocolV1Error["reason"] = "invalidShape",
): Effect.Effect<
  Readonly<Record<string, unknown>>,
  ApplicationWorkerProtocolV1Error
> {
  return Effect.fromResult(captureExactRecord(value, keys)).pipe(
    Effect.mapError(cause => protocolError(boundary, reason, path, cause)),
  );
}

function decodeRecordUnion(
  value: unknown,
  keySets: ReadonlyArray<ReadonlyArray<string>>,
  boundary: "transactionRequest" | "actionRequest" | "result",
  path: string,
  reason: ApplicationWorkerProtocolV1Error["reason"] = "invalidShape",
): Effect.Effect<
  Readonly<Record<string, unknown>>,
  ApplicationWorkerProtocolV1Error
> {
  return Effect.fromResult(captureExactRecordUnion(value, keySets)).pipe(
    Effect.mapError(cause => protocolError(boundary, reason, path, cause)),
  );
}

function captureExactRecord(
  value: unknown,
  expectedKeys: ReadonlyArray<string>,
): Result.Result<Readonly<Record<string, unknown>>, unknown> {
  return captureExactRecordUnion(value, [expectedKeys]);
}

function captureExactRecordUnion(
  value: unknown,
  expectedKeySets: ReadonlyArray<ReadonlyArray<string>>,
): Result.Result<Readonly<Record<string, unknown>>, unknown> {
  try {
    if (!isNonArrayRecord(value)) return Result.fail("record");
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return Result.fail("recordPrototype");
    }
    const keys = Reflect.ownKeys(value);
    const candidateKeySets = expectedKeySets.filter(
      expectedKeys => expectedKeys.length === keys.length,
    );
    if (candidateKeySets.length === 0) return Result.fail("recordKeys");
    const output: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      if (typeof key !== "string") return Result.fail("recordKey");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined || !descriptor.enumerable ||
        !("value" in descriptor)
      ) return Result.fail("recordMember");
      Object.defineProperty(output, key, {
        value: descriptor.value,
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    const actual = new Set(keys);
    const matches = candidateKeySets.some(expectedKeys =>
      expectedKeys.every(key => actual.has(key))
    );
    return matches
      ? Result.succeed(Object.freeze(output))
      : Result.fail("recordKeys");
  } catch (cause) {
    return Result.fail(cause);
  }
}

function captureExactArray(
  value: unknown,
  maximumLength: number,
): Result.Result<ReadonlyArray<unknown>, unknown> {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      return Result.fail("array");
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      lengthDescriptor === undefined || !("value" in lengthDescriptor) ||
      typeof lengthDescriptor.value !== "number" ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 || lengthDescriptor.value > maximumLength
    ) return Result.fail("arrayLength");
    const length = lengthDescriptor.value;
    if (Reflect.ownKeys(value).length !== length + 1) {
      return Result.fail("arrayKeys");
    }
    const output: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor === undefined || !descriptor.enumerable ||
        !("value" in descriptor)
      ) return Result.fail("arrayMember");
      output.push(descriptor.value);
    }
    return Result.succeed(Object.freeze(output));
  } catch (cause) {
    return Result.fail(cause);
  }
}

function isBoundedText(value: unknown): value is string {
  return typeof value === "string" &&
    value.length <= MAX_APPLICATION_WORKER_CONTEXT_TEXT_BYTES_V1 &&
    isNonBlankString(value) &&
    !value.includes("\0") &&
    TEXT_ENCODER.encode(value).byteLength <=
      MAX_APPLICATION_WORKER_CONTEXT_TEXT_BYTES_V1;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isAppCreationTime(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0 && value < 2 ** 53;
}

function fail(
  boundary: ApplicationWorkerProtocolV1Error["boundary"],
  reason: ApplicationWorkerProtocolV1Error["reason"],
  path?: string,
  cause?: unknown,
): Effect.Effect<never, ApplicationWorkerProtocolV1Error> {
  return Effect.fail(protocolError(boundary, reason, path, cause));
}

function protocolError(
  boundary: ApplicationWorkerProtocolV1Error["boundary"],
  reason: ApplicationWorkerProtocolV1Error["reason"],
  path?: string,
  cause?: unknown,
): ApplicationWorkerProtocolV1Error {
  return new ApplicationWorkerProtocolV1Error({
    boundary,
    reason,
    ...(path === undefined ? {} : { path }),
    ...(cause === undefined ? {} : { cause }),
  });
}
