import type { Json, JsonObject } from "flarex-protocol/json";
import { measureCanonicalJsonUtf8Bytes } from "flarex-protocol/json";
import { Data, Encoding, Result, Schema } from "effect";
import type {
  PersistedTaskRequestedEffectV1,
  TaskRunAttemptAggregateV1,
} from "./Model.js";
import {
  decodeTaskRunAttemptAggregateV1,
  encodeTaskRunAttemptAggregateV1,
  PersistedTaskRequestedEffectV1Schema,
} from "./Schema.js";

export const TASK_RUN_ATTEMPT_PERSISTED_JSON_CODEC_V1 =
  "flarex.task-run-attempt-persisted-json.v1" as const;
export const TASK_REQUESTED_EFFECT_PERSISTED_JSON_CODEC_V1 =
  "flarex.task-requested-effect-persisted-json.v1" as const;
export const TASK_PERSISTED_UINT8ARRAY_TAG_V1 =
  "$flarex.uint8array.v1" as const;

export const MAX_TASK_RUN_ATTEMPT_PERSISTED_JSON_BYTES_V1 = 1024 * 1024;
export const MAX_TASK_REQUESTED_EFFECT_PERSISTED_JSON_BYTES_V1 = 64 * 1024;
export const MAX_TASK_PERSISTED_JSON_NESTING_DEPTH_V1 = 128;

export interface PersistedTaskRunAttemptAggregateJsonV1 {
  readonly codec: typeof TASK_RUN_ATTEMPT_PERSISTED_JSON_CODEC_V1;
  readonly aggregate: JsonObject;
}

export interface PersistedTaskRequestedEffectJsonV1 {
  readonly codec: typeof TASK_REQUESTED_EFFECT_PERSISTED_JSON_CODEC_V1;
  readonly effect: JsonObject;
}

export type TaskPersistenceCodecOperationV1 =
  | "encode_aggregate"
  | "decode_aggregate"
  | "encode_requested_effect"
  | "decode_requested_effect";

export type TaskPersistenceCodecIssueV1 =
  | { readonly kind: "invalid_envelope" }
  | {
      readonly kind: "unsupported_codec";
      readonly observed: string | null;
    }
  | {
      readonly kind: "canonical_json_too_large";
      readonly observedBytes: number;
      readonly maximumBytes: number;
    }
  | { readonly kind: "invalid_extended_json_tag" }
  | { readonly kind: "invalid_byte_encoding" }
  | { readonly kind: "domain_encoding_not_json" }
  | {
      readonly kind: "domain_value_invalid";
      readonly cause: Schema.SchemaError;
    };

export class TaskPersistenceCodecErrorV1 extends Data.TaggedError(
  "TaskPersistenceCodecErrorV1",
)<{
  readonly operation: TaskPersistenceCodecOperationV1;
  readonly issue: TaskPersistenceCodecIssueV1;
}> {}

const STRICT_PARSE_OPTIONS = { onExcessProperty: "error" } as const;
const SHA256_BASE64URL_LENGTH = 43;

const encodePersistedRequestedEffectSchemaV1 = Schema.encodeUnknownResult(
  PersistedTaskRequestedEffectV1Schema,
  STRICT_PARSE_OPTIONS,
);
const decodePersistedRequestedEffectSchemaV1 = Schema.decodeUnknownResult(
  PersistedTaskRequestedEffectV1Schema,
  STRICT_PARSE_OPTIONS,
);

type JsonConversionIssueV1 =
  | { readonly kind: "invalid_extended_json_tag" }
  | { readonly kind: "invalid_byte_encoding" }
  | { readonly kind: "domain_encoding_not_json" };

type JsonCaptureIssueV1 =
  | { readonly kind: "invalid_envelope" }
  | {
      readonly kind: "canonical_json_too_large";
      readonly observedBytes: number;
      readonly maximumBytes: number;
    };

function persistenceCodecError(
  operation: TaskPersistenceCodecOperationV1,
  issue: TaskPersistenceCodecIssueV1,
): TaskPersistenceCodecErrorV1 {
  return new TaskPersistenceCodecErrorV1({ operation, issue });
}

function isPlainRecord(value: unknown): value is object {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function readOwnDataProperty(
  value: object,
  key: string,
): unknown | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && descriptor.enumerable && "value" in descriptor
    ? descriptor.value
    : undefined;
}

function hasExactEnumerableDataKeys(
  value: object,
  expected: ReadonlyArray<string>,
): boolean {
  let keys: ReadonlyArray<PropertyKey>;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return false;
  }
  if (keys.length !== expected.length) return false;
  const expectedKeys = new Set(expected);
  return keys.every((key) => {
    if (typeof key !== "string" || !expectedKeys.has(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && descriptor.enumerable && "value" in descriptor;
  });
}

function isTaskResultCommitmentRecord(value: object): boolean {
  return hasExactEnumerableDataKeys(value, ["codec", "byteLength", "sha256"]) &&
    readOwnDataProperty(value, "codec") === "flarex.task-result.v1";
}

function freezeOwnedJsonObject(
  entries: ReadonlyArray<readonly [string, Json]>,
): JsonObject {
  const owned = Object.create(null) as Record<string, Json>;
  for (const [key, value] of entries) owned[key] = value;
  return Object.freeze(owned);
}

type JsonCaptureTargetV1 =
  | { readonly kind: "root" }
  | {
      readonly kind: "array";
      readonly output: Json[];
      readonly index: number;
    }
  | {
      readonly kind: "object";
      readonly output: Record<string, Json>;
      readonly key: string;
    };

type JsonCaptureFrameV1 =
  | {
      readonly kind: "value";
      readonly input: unknown;
      readonly target: JsonCaptureTargetV1;
      readonly depth: number;
    }
  | {
      readonly kind: "finish_array";
      readonly input: object;
      readonly output: Json[];
    }
  | {
      readonly kind: "finish_object";
      readonly input: object;
      readonly output: Record<string, Json>;
    };

interface JsonCaptureBudgetV1 {
  readonly maximumBytes: number;
  usedBytes: number;
}

function captureOwnedJsonValueV1(
  input: unknown,
  maximumBytes: number,
): Result.Result<Json, JsonCaptureIssueV1> {
  return Result.gen(function* () {
    const budget: JsonCaptureBudgetV1 = { maximumBytes, usedBytes: 0 };
    const ancestors = new WeakSet<object>();
    const frames: JsonCaptureFrameV1[] = [{
      kind: "value",
      input,
      target: { kind: "root" },
      depth: 0,
    }];
    let root: Json | undefined;
    while (frames.length > 0) {
      const frame = frames.pop();
      if (frame === undefined) {
        return yield* Result.fail({ kind: "invalid_envelope" as const });
      }
      if (frame.kind === "finish_array") {
        ancestors.delete(frame.input);
        Object.freeze(frame.output);
        continue;
      }
      if (frame.kind === "finish_object") {
        ancestors.delete(frame.input);
        Object.freeze(frame.output);
        continue;
      }
      const value = frame.input;
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "boolean" ||
        typeof value === "number"
      ) {
        const charge = chargeCapturedJsonPrimitiveV1(value, budget);
        if (charge !== undefined) return yield* Result.fail(charge);
        root = assignCapturedJsonV1(frame.target, value, root);
        continue;
      }
      if (typeof value !== "object") {
        return yield* Result.fail({ kind: "invalid_envelope" as const });
      }
      if (frame.depth > MAX_TASK_PERSISTED_JSON_NESTING_DEPTH_V1) {
        return yield* Result.fail({ kind: "invalid_envelope" as const });
      }
      let prototype: object | null;
      let array: boolean;
      let keys: ReadonlyArray<PropertyKey>;
      try {
        prototype = Object.getPrototypeOf(value);
        array = Array.isArray(value);
        keys = Reflect.ownKeys(value);
      } catch {
        return yield* Result.fail({ kind: "invalid_envelope" as const });
      }
      if (
        (!array && prototype !== Object.prototype && prototype !== null) ||
        ancestors.has(value)
      ) {
        return yield* Result.fail({ kind: "invalid_envelope" as const });
      }
      const container = yield* (array
        ? captureJsonArrayContainerV1(value, keys, budget, frame.depth)
        : captureJsonObjectContainerV1(value, keys, budget, frame.depth));
      ancestors.add(value);
      root = assignCapturedJsonV1(frame.target, container.output, root);
      frames.push(container.finish);
      for (let index = container.children.length - 1; index >= 0; index -= 1) {
        const child = container.children[index];
        if (child === undefined) {
          return yield* Result.fail({ kind: "invalid_envelope" as const });
        }
        frames.push(child);
      }
    }
    if (root === undefined) {
      return yield* Result.fail({ kind: "invalid_envelope" as const });
    }
    return root;
  });
}

function chargeCapturedJsonPrimitiveV1(
  value: null | string | boolean | number,
  budget: JsonCaptureBudgetV1,
): JsonCaptureIssueV1 | undefined {
  const remaining = budget.maximumBytes - budget.usedBytes;
  const measured = measureCanonicalJsonUtf8Bytes(value, remaining);
  if (measured.kind === "invalid") return { kind: "invalid_envelope" };
  if (measured.kind === "exceeded") {
    return {
      kind: "canonical_json_too_large",
      observedBytes: budget.usedBytes + measured.observed,
      maximumBytes: budget.maximumBytes,
    };
  }
  budget.usedBytes += measured.bytes;
  return undefined;
}

function chargeCapturedJsonBytesV1(
  bytes: number,
  budget: JsonCaptureBudgetV1,
): JsonCaptureIssueV1 | undefined {
  if (
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    bytes > budget.maximumBytes - budget.usedBytes
  ) {
    return {
      kind: "canonical_json_too_large",
      observedBytes: budget.maximumBytes + 1,
      maximumBytes: budget.maximumBytes,
    };
  }
  budget.usedBytes += bytes;
  return undefined;
}

function assignCapturedJsonV1(
  target: JsonCaptureTargetV1,
  value: Json,
  root: Json | undefined,
): Json | undefined {
  switch (target.kind) {
    case "root":
      return value;
    case "array":
      target.output[target.index] = value;
      return root;
    case "object":
      target.output[target.key] = value;
      return root;
  }
}

interface CapturedJsonContainerV1 {
  readonly output: Json[] | Record<string, Json>;
  readonly finish: Extract<JsonCaptureFrameV1, {
    readonly kind: "finish_array" | "finish_object";
  }>;
  readonly children: ReadonlyArray<Extract<JsonCaptureFrameV1, {
    readonly kind: "value";
  }>>;
}

function captureJsonArrayContainerV1(
  input: object,
  keys: ReadonlyArray<PropertyKey>,
  budget: JsonCaptureBudgetV1,
  depth: number,
): Result.Result<CapturedJsonContainerV1, JsonCaptureIssueV1> {
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    lengthDescriptor = Object.getOwnPropertyDescriptor(input, "length");
  } catch {
    return Result.fail({ kind: "invalid_envelope" });
  }
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    keys.length !== lengthDescriptor.value + 1
  ) {
    return Result.fail({ kind: "invalid_envelope" });
  }
  const structuralBytes = 2 + Math.max(0, lengthDescriptor.value - 1);
  const structuralIssue = chargeCapturedJsonBytesV1(structuralBytes, budget);
  if (structuralIssue !== undefined) return Result.fail(structuralIssue);
  const output = new Array<Json>(lengthDescriptor.value);
  const children: Array<Extract<JsonCaptureFrameV1, { readonly kind: "value" }>> = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    } catch {
      return Result.fail({ kind: "invalid_envelope" });
    }
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      return Result.fail({ kind: "invalid_envelope" });
    }
    children.push({
      kind: "value",
      input: descriptor.value,
      target: { kind: "array", output, index },
      depth: depth + 1,
    });
  }
  return Result.succeed({
    output,
    finish: { kind: "finish_array", input, output },
    children,
  });
}

function captureJsonObjectContainerV1(
  input: object,
  keys: ReadonlyArray<PropertyKey>,
  budget: JsonCaptureBudgetV1,
  depth: number,
): Result.Result<CapturedJsonContainerV1, JsonCaptureIssueV1> {
  const structuralIssue = chargeCapturedJsonBytesV1(
    2 + Math.max(0, keys.length - 1),
    budget,
  );
  if (structuralIssue !== undefined) return Result.fail(structuralIssue);
  const output = Object.create(null) as Record<string, Json>;
  const children: Array<Extract<JsonCaptureFrameV1, { readonly kind: "value" }>> = [];
  for (const key of keys) {
    if (typeof key !== "string") {
      return Result.fail({ kind: "invalid_envelope" });
    }
    const keyIssue = chargeCapturedJsonPrimitiveV1(key, budget) ??
      chargeCapturedJsonBytesV1(1, budget);
    if (keyIssue !== undefined) return Result.fail(keyIssue);
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(input, key);
    } catch {
      return Result.fail({ kind: "invalid_envelope" });
    }
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      return Result.fail({ kind: "invalid_envelope" });
    }
    children.push({
      kind: "value",
      input: descriptor.value,
      target: { kind: "object", output, key },
      depth: depth + 1,
    });
  }
  return Result.succeed({
    output,
    finish: { kind: "finish_object", input, output },
    children,
  });
}

function encodeOwnedPersistenceJsonValueV1(
  input: unknown,
  bytePosition: boolean,
): Result.Result<Json, JsonConversionIssueV1> {
  if (
    input === null ||
    typeof input === "string" ||
    typeof input === "boolean" ||
    (typeof input === "number" && Number.isFinite(input))
  ) {
    return Result.succeed(input);
  }
  if (input instanceof Uint8Array) {
    return bytePosition
      ? Result.succeed(freezeOwnedJsonObject([
          [TASK_PERSISTED_UINT8ARRAY_TAG_V1, Encoding.encodeBase64Url(input)],
        ]))
      : Result.fail({ kind: "domain_encoding_not_json" });
  }
  if (Array.isArray(input)) {
    const lengthDescriptor = Object.getOwnPropertyDescriptor(input, "length");
    if (
      lengthDescriptor === undefined ||
      !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      Reflect.ownKeys(input).length !== lengthDescriptor.value + 1
    ) {
      return Result.fail({ kind: "domain_encoding_not_json" });
    }
    return Result.gen(function* () {
      const owned: Json[] = [];
      for (let index = 0; index < lengthDescriptor.value; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
        if (
          descriptor === undefined ||
          !descriptor.enumerable ||
          !("value" in descriptor)
        ) {
          return yield* Result.fail({
            kind: "domain_encoding_not_json" as const,
          });
        }
        owned.push(yield* encodeOwnedPersistenceJsonValueV1(
          descriptor.value,
          false,
        ));
      }
      return Object.freeze(owned);
    });
  }
  if (!isPlainRecord(input)) {
    return Result.fail({ kind: "domain_encoding_not_json" });
  }
  const keys = Reflect.ownKeys(input);
  if (keys.some((key) => typeof key !== "string")) {
    return Result.fail({ kind: "domain_encoding_not_json" });
  }
  if (keys.some((key) =>
    typeof key === "string" && key.startsWith("$flarex."))) {
    return Result.fail({ kind: "invalid_extended_json_tag" });
  }
  return Result.gen(function* () {
    const commitment = isTaskResultCommitmentRecord(input);
    const entries: Array<readonly [string, Json]> = [];
    for (const key of keys) {
      if (typeof key !== "string") {
        return yield* Result.fail({
          kind: "domain_encoding_not_json" as const,
        });
      }
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return yield* Result.fail({
          kind: "domain_encoding_not_json" as const,
        });
      }
      entries.push([key, yield* encodeOwnedPersistenceJsonValueV1(
        descriptor.value,
        commitment && key === "sha256",
      )]);
    }
    return freezeOwnedJsonObject(entries);
  });
}

function decodeTaskResultSha256WrapperV1(
  input: unknown,
): Result.Result<Uint8Array, JsonConversionIssueV1> {
  if (
    !isPlainRecord(input) ||
    !hasExactEnumerableDataKeys(input, [TASK_PERSISTED_UINT8ARRAY_TAG_V1])
  ) {
    return Result.fail({ kind: "invalid_byte_encoding" });
  }
  const spelling = readOwnDataProperty(input, TASK_PERSISTED_UINT8ARRAY_TAG_V1);
  if (
    typeof spelling !== "string" ||
    spelling.length !== SHA256_BASE64URL_LENGTH
  ) {
    return Result.fail({ kind: "invalid_byte_encoding" });
  }
  return Encoding.decodeBase64Url(spelling).pipe(
    Result.mapError((): JsonConversionIssueV1 => ({
      kind: "invalid_byte_encoding",
    })),
    Result.flatMap((bytes): Result.Result<Uint8Array, JsonConversionIssueV1> =>
      bytes.byteLength === 32 && Encoding.encodeBase64Url(bytes) === spelling
        ? Result.succeed(bytes)
        : Result.fail({ kind: "invalid_byte_encoding" as const })),
  );
}

function decodeOwnedPersistenceJsonValueV1(
  input: Json,
): Result.Result<unknown, JsonConversionIssueV1> {
  if (
    input === null ||
    typeof input === "string" ||
    typeof input === "boolean" ||
    typeof input === "number"
  ) {
    return Result.succeed(input);
  }
  if (Array.isArray(input)) {
    return Result.gen(function* () {
      const owned: unknown[] = [];
      for (let index = 0; index < input.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
        if (
          descriptor === undefined ||
          !descriptor.enumerable ||
          !("value" in descriptor)
        ) {
          return yield* Result.fail({
            kind: "domain_encoding_not_json" as const,
          });
        }
        owned.push(yield* decodeOwnedPersistenceJsonValueV1(
          descriptor.value as Json,
        ));
      }
      return owned;
    });
  }
  const commitment = isTaskResultCommitmentRecord(input);
  const keys = Reflect.ownKeys(input);
  if (keys.some((key) =>
    typeof key === "string" && key.startsWith("$flarex."))) {
    return Result.fail({ kind: "invalid_extended_json_tag" });
  }
  return Result.gen(function* () {
    const owned: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      if (typeof key !== "string") {
        return yield* Result.fail({
          kind: "domain_encoding_not_json" as const,
        });
      }
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return yield* Result.fail({
          kind: "domain_encoding_not_json" as const,
        });
      }
      owned[key] = commitment && key === "sha256"
        ? yield* decodeTaskResultSha256WrapperV1(descriptor.value)
        : yield* decodeOwnedPersistenceJsonValueV1(descriptor.value as Json);
    }
    return owned;
  });
}

function measureEnvelopeV1(
  input: unknown,
  maximumBytes: number,
  operation: TaskPersistenceCodecOperationV1,
): Result.Result<void, TaskPersistenceCodecErrorV1> {
  const measured = measureCanonicalJsonUtf8Bytes(input, maximumBytes);
  switch (measured.kind) {
    case "success":
      return Result.succeed(undefined);
    case "exceeded":
      return Result.fail(persistenceCodecError(operation, {
        kind: "canonical_json_too_large",
        observedBytes: measured.observed,
        maximumBytes,
      }));
    case "invalid":
      return Result.fail(persistenceCodecError(operation, {
        kind: "invalid_envelope",
      }));
  }
}

function decodeEnvelopePayloadV1(
  input: unknown,
  operation: TaskPersistenceCodecOperationV1,
  codec: string,
  payloadKey: "aggregate" | "effect",
  maximumBytes: number,
): Result.Result<unknown, TaskPersistenceCodecErrorV1> {
  return Result.gen(function* () {
    const captured = yield* captureOwnedJsonValueV1(
      input,
      maximumBytes,
    ).pipe(Result.mapError((issue) => persistenceCodecError(operation, issue)));
    yield* measureEnvelopeV1(captured, maximumBytes, operation);
    if (!isPlainRecord(captured)) {
      return yield* Result.fail(persistenceCodecError(operation, {
        kind: "invalid_envelope",
      }));
    }
    const observedCodec = readOwnDataProperty(captured, "codec");
    if (observedCodec !== codec) {
      return yield* Result.fail(persistenceCodecError(operation, {
        kind: "unsupported_codec",
        observed: typeof observedCodec === "string" ? observedCodec : null,
      }));
    }
    if (!hasExactEnumerableDataKeys(captured, ["codec", payloadKey])) {
      return yield* Result.fail(persistenceCodecError(operation, {
        kind: "invalid_envelope",
      }));
    }
    const payload = readOwnDataProperty(captured, payloadKey);
    if (!isPlainRecord(payload)) {
      return yield* Result.fail(persistenceCodecError(operation, {
        kind: "invalid_envelope",
      }));
    }
    return yield* decodeOwnedPersistenceJsonValueV1(payload as JsonObject).pipe(
      Result.mapError((issue) => persistenceCodecError(operation, issue)),
    );
  });
}

function encodeDomainPayloadV1(
  encoded: Result.Result<unknown, Schema.SchemaError>,
  operation: TaskPersistenceCodecOperationV1,
): Result.Result<JsonObject, TaskPersistenceCodecErrorV1> {
  return Result.gen(function* () {
    const domainValue = yield* encoded.pipe(
      Result.mapError((cause) => persistenceCodecError(operation, {
        kind: "domain_value_invalid",
        cause,
      })),
    );
    const json = yield* encodeOwnedPersistenceJsonValueV1(
      domainValue,
      false,
    ).pipe(Result.mapError((issue) => persistenceCodecError(operation, issue)));
    if (!isPlainRecord(json)) {
      return yield* Result.fail(persistenceCodecError(operation, {
        kind: "domain_encoding_not_json",
      }));
    }
    return json as JsonObject;
  });
}

export function encodePersistedTaskRunAttemptAggregateJsonV1(
  aggregate: TaskRunAttemptAggregateV1,
): Result.Result<
  PersistedTaskRunAttemptAggregateJsonV1,
  TaskPersistenceCodecErrorV1
> {
  const operation = "encode_aggregate" as const;
  return Result.gen(function* () {
    const payload = yield* encodeDomainPayloadV1(
      encodeTaskRunAttemptAggregateV1(aggregate),
      operation,
    );
    const envelope = Object.freeze({
      codec: TASK_RUN_ATTEMPT_PERSISTED_JSON_CODEC_V1,
      aggregate: payload,
    });
    yield* measureEnvelopeV1(
      envelope,
      MAX_TASK_RUN_ATTEMPT_PERSISTED_JSON_BYTES_V1,
      operation,
    );
    return envelope;
  });
}

export function decodePersistedTaskRunAttemptAggregateJsonV1(
  input: unknown,
): Result.Result<TaskRunAttemptAggregateV1, TaskPersistenceCodecErrorV1> {
  const operation = "decode_aggregate" as const;
  return Result.gen(function* () {
    const payload = yield* decodeEnvelopePayloadV1(
      input,
      operation,
      TASK_RUN_ATTEMPT_PERSISTED_JSON_CODEC_V1,
      "aggregate",
      MAX_TASK_RUN_ATTEMPT_PERSISTED_JSON_BYTES_V1,
    );
    return yield* decodeTaskRunAttemptAggregateV1(payload).pipe(
      Result.mapError((cause) => persistenceCodecError(operation, {
        kind: "domain_value_invalid",
        cause,
      })),
    );
  });
}

export function encodePersistedTaskRequestedEffectJsonV1(
  effect: PersistedTaskRequestedEffectV1,
): Result.Result<
  PersistedTaskRequestedEffectJsonV1,
  TaskPersistenceCodecErrorV1
> {
  const operation = "encode_requested_effect" as const;
  return Result.gen(function* () {
    const payload = yield* encodeDomainPayloadV1(
      encodePersistedRequestedEffectSchemaV1(effect),
      operation,
    );
    const envelope = Object.freeze({
      codec: TASK_REQUESTED_EFFECT_PERSISTED_JSON_CODEC_V1,
      effect: payload,
    });
    yield* measureEnvelopeV1(
      envelope,
      MAX_TASK_REQUESTED_EFFECT_PERSISTED_JSON_BYTES_V1,
      operation,
    );
    return envelope;
  });
}

export function decodePersistedTaskRequestedEffectJsonV1(
  input: unknown,
): Result.Result<PersistedTaskRequestedEffectV1, TaskPersistenceCodecErrorV1> {
  const operation = "decode_requested_effect" as const;
  return Result.gen(function* () {
    const payload = yield* decodeEnvelopePayloadV1(
      input,
      operation,
      TASK_REQUESTED_EFFECT_PERSISTED_JSON_CODEC_V1,
      "effect",
      MAX_TASK_REQUESTED_EFFECT_PERSISTED_JSON_BYTES_V1,
    );
    return yield* decodePersistedRequestedEffectSchemaV1(payload).pipe(
      Result.mapError((cause) => persistenceCodecError(operation, {
        kind: "domain_value_invalid",
        cause,
      })),
    );
  });
}
