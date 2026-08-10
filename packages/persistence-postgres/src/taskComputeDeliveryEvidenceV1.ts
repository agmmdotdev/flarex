import {
  decodeTaskComputeCancellationReceiptV1,
  decodeTaskComputeCancellationRequestV1,
  decodeTaskComputeDispatchAcceptanceV1,
  decodeTaskComputeDispatchRequestV1,
  encodeTaskComputeCancellationReceiptV1,
  encodeTaskComputeCancellationRequestV1,
  encodeTaskComputeDispatchAcceptanceV1,
  encodeTaskComputeDispatchRequestV1,
  type TaskComputeCancellationReceiptV1,
  type TaskComputeCancellationRequestV1,
  type TaskComputeDispatchAcceptanceV1,
  type TaskComputeDispatchRequestV1,
  validateTaskComputeCancellationReceiptV1,
  validateTaskComputeCancellationRequestV1,
  validateTaskComputeDispatchAcceptanceV1,
  validateTaskComputeDispatchRequestV1,
} from "@flarex/durable-task/internal/compute-provider-v1";
import {
  decodeTaskInputReferenceV1,
  type TaskInputReferenceV1,
} from "@flarex/durable-task/internal/run-creation-v1";
import {
  TaskComputeProfileRefV1Schema,
  type TaskComputeProfileRefV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import {
  decodeTaskDefinitionRuntimeBindingCommitmentV1,
  type TaskDefinitionRuntimeBindingCommitmentV1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import { bytesEqual, isUint8Array } from "@flarex/utils/bytes";
import { Data, Effect, Result, Schema } from "effect";
import {
  encodeCanonicalJson,
  isJsonObjectFromUnknown,
} from "flarex-protocol/json";

export const TASK_COMPUTE_DELIVERY_EVIDENCE_CODEC_V1 = 1 as const;
export const MAX_TASK_COMPUTE_DELIVERY_EVIDENCE_BYTES_V1 = 16_384;
export const MAX_TASK_COMPUTE_DELIVERY_REASON_CODE_UTF8_BYTES_V1 = 64;
export const TASK_COMPUTE_PROFILE_STORAGE_CODEC_V1 = 1 as const;
export const MAX_TASK_COMPUTE_PROFILE_STORAGE_BYTES_V1 = 510;
export const TASK_COMPUTE_PREPARED_EXECUTION_VERSION_V1 =
  "flarex.task-compute-prepared-execution.v1" as const;

export type TaskComputeDispatchDeliveryStateV1 =
  | "prepared"
  | "delivering"
  | "accepted"
  | "retry_wait"
  | "rejected"
  | "obsolete"
  | "quarantined";

export type TaskComputeCancellationDeliveryStateV1 =
  | "waiting_dispatch"
  | "prepared"
  | "delivering"
  | "delivered"
  | "retry_wait"
  | "rejected"
  | "obsolete"
  | "quarantined";

export type TaskComputeDeliveryEvidenceOperationV1 =
  | "encode_dispatch_request"
  | "decode_dispatch_request"
  | "encode_dispatch_acceptance"
  | "decode_dispatch_acceptance"
  | "encode_cancellation_request"
  | "decode_cancellation_request"
  | "encode_cancellation_receipt"
  | "decode_cancellation_receipt";

export type TaskComputeDeliveryEvidenceFailureReasonV1 =
  | "invalid_input"
  | "invalid_evidence"
  | "invalid_bytes"
  | "size_exceeded"
  | "invalid_digest"
  | "invalid_utf8"
  | "invalid_json"
  | "non_canonical"
  | "crypto_failed";

export class TaskComputeDeliveryEvidenceV1Error<
  Operation extends TaskComputeDeliveryEvidenceOperationV1 =
    TaskComputeDeliveryEvidenceOperationV1,
> extends Data.TaggedError(
  "TaskComputeDeliveryEvidenceV1Error",
)<{
  readonly operation: Operation;
  readonly reason: TaskComputeDeliveryEvidenceFailureReasonV1;
  readonly observedBytes?: number;
  readonly maximumBytes?: number;
  readonly cause?: unknown;
}> {}

export class InvalidTaskComputePreparedExecutionV1Error extends Data.TaggedError(
  "InvalidTaskComputePreparedExecutionV1Error",
)<{
  readonly reason:
    | "invalid_shape"
    | "invalid_dispatch_request"
    | "invalid_runtime_binding_commitment"
    | "invalid_input_reference";
}> {}

export class TaskComputeProfileStorageV1Error<
  Operation extends "encode_compute_profile" | "decode_compute_profile" =
    "encode_compute_profile" | "decode_compute_profile",
> extends Data.TaggedError(
  "TaskComputeProfileStorageV1Error",
)<{
  readonly operation: Operation;
  readonly reason: "invalid_profile" | "invalid_bytes";
}> {}

export interface TaskComputeDeliveryEvidenceV1 {
  readonly codecVersion: typeof TASK_COMPUTE_DELIVERY_EVIDENCE_CODEC_V1;
  readonly byteLength: number;
  readonly canonicalBytes: Uint8Array;
  readonly sha256: Uint8Array;
}

/**
 * Owned preparation evidence only. This value grants no trusted scope,
 * lifecycle, persistence, provider, runtime, or application authority.
 */
export interface TaskComputePreparedExecutionV1 {
  readonly version: typeof TASK_COMPUTE_PREPARED_EXECUTION_VERSION_V1;
  readonly dispatchRequest: TaskComputeDispatchRequestV1;
  readonly runtimeBindingCommitment: TaskDefinitionRuntimeBindingCommitmentV1;
  readonly inputReference: TaskInputReferenceV1;
}

type DomainDecoder<Value> = (
  input: unknown,
) => Result.Result<Value, unknown>;
type DomainEncoder<Value> = (
  input: Value,
) => Result.Result<unknown, unknown>;

interface DeliveryEvidenceCodecOptions<
  Value,
  EncodeOperation extends TaskComputeDeliveryEvidenceOperationV1,
  DecodeOperation extends TaskComputeDeliveryEvidenceOperationV1,
> {
  readonly encodeOperation: EncodeOperation;
  readonly decodeOperation: DecodeOperation;
  readonly validateValue: DomainDecoder<Value>;
  readonly decodeValue: DomainDecoder<Value>;
  readonly encodeValue: DomainEncoder<Value>;
}

const dispatchRequestCodecOptions = Object.freeze({
  encodeOperation: "encode_dispatch_request",
  decodeOperation: "decode_dispatch_request",
  validateValue: validateTaskComputeDispatchRequestV1,
  decodeValue: decodeTaskComputeDispatchRequestV1,
  encodeValue: encodeTaskComputeDispatchRequestV1,
});
const dispatchRequestCodec = makeDeliveryEvidenceCodec(
  dispatchRequestCodecOptions,
);

const dispatchAcceptanceCodecOptions = Object.freeze({
  encodeOperation: "encode_dispatch_acceptance",
  decodeOperation: "decode_dispatch_acceptance",
  validateValue: validateTaskComputeDispatchAcceptanceV1,
  decodeValue: decodeTaskComputeDispatchAcceptanceV1,
  encodeValue: encodeTaskComputeDispatchAcceptanceV1,
});
const dispatchAcceptanceCodec = makeDeliveryEvidenceCodec(
  dispatchAcceptanceCodecOptions,
);

const cancellationRequestCodec = makeDeliveryEvidenceCodec({
  encodeOperation: "encode_cancellation_request",
  decodeOperation: "decode_cancellation_request",
  validateValue: validateTaskComputeCancellationRequestV1,
  decodeValue: decodeTaskComputeCancellationRequestV1,
  encodeValue: encodeTaskComputeCancellationRequestV1,
});

const cancellationReceiptCodec = makeDeliveryEvidenceCodec({
  encodeOperation: "encode_cancellation_receipt",
  decodeOperation: "decode_cancellation_receipt",
  validateValue: validateTaskComputeCancellationReceiptV1,
  decodeValue: decodeTaskComputeCancellationReceiptV1,
  encodeValue: encodeTaskComputeCancellationReceiptV1,
});
const decodeTaskComputeProfileRefResultV1 = Schema.decodeUnknownResult(
  TaskComputeProfileRefV1Schema,
);

export const encodeTaskComputeDispatchRequestEvidenceV1 =
  dispatchRequestCodec.encode;
export const decodeTaskComputeDispatchRequestEvidenceV1 =
  dispatchRequestCodec.decode;
export const encodeTaskComputeDispatchAcceptanceEvidenceV1 =
  dispatchAcceptanceCodec.encode;
export const decodeTaskComputeDispatchAcceptanceEvidenceV1 =
  dispatchAcceptanceCodec.decode;
export const encodeTaskComputeCancellationRequestEvidenceV1 =
  cancellationRequestCodec.encode;
export const decodeTaskComputeCancellationRequestEvidenceV1 =
  cancellationRequestCodec.decode;
export const encodeTaskComputeCancellationReceiptEvidenceV1 =
  cancellationReceiptCodec.encode;
export const decodeTaskComputeCancellationReceiptEvidenceV1 =
  cancellationReceiptCodec.decode;

/** Canonical bytes for persistence-owned transaction preparation. */
export function encodeTaskComputeDispatchRequestCanonicalBytesV1(
  input: unknown,
): Result.Result<
  Uint8Array,
  TaskComputeDeliveryEvidenceV1Error<"encode_dispatch_request">
> {
  return validateTaskComputeDispatchRequestV1(input).pipe(
    Result.mapError((cause) => evidenceFailure(
      "encode_dispatch_request",
      "invalid_input",
      { cause },
    )),
    Result.flatMap((value) => encodeCanonicalDomainBytesResult(
      value,
      dispatchRequestCodecOptions,
      "encode_dispatch_request",
    )),
  );
}

export function encodeTaskComputeDispatchAcceptanceCanonicalBytesV1(
  input: unknown,
): Result.Result<
  Uint8Array,
  TaskComputeDeliveryEvidenceV1Error<"encode_dispatch_acceptance">
> {
  return validateTaskComputeDispatchAcceptanceV1(input).pipe(
    Result.mapError((cause) => evidenceFailure(
      "encode_dispatch_acceptance",
      "invalid_input",
      { cause },
    )),
    Result.flatMap((value) => encodeCanonicalDomainBytesResult(
      value,
      dispatchAcceptanceCodecOptions,
      "encode_dispatch_acceptance",
    )),
  );
}

export function decodeTaskComputePreparedExecutionV1(
  input: unknown,
): Result.Result<
  TaskComputePreparedExecutionV1,
  InvalidTaskComputePreparedExecutionV1Error
> {
  const outer = captureExactDataRecord(input, [
    "version",
    "dispatchRequest",
    "runtimeBindingCommitment",
    "inputReference",
  ]);
  if (
    outer === undefined ||
    outer.version !== TASK_COMPUTE_PREPARED_EXECUTION_VERSION_V1
  ) {
    return Result.fail(preparedFailure("invalid_shape"));
  }
  return Result.gen(function* () {
    const dispatchRequest = yield* validateTaskComputeDispatchRequestV1(
      outer.dispatchRequest,
    ).pipe(
      Result.mapError(() => preparedFailure("invalid_dispatch_request")),
    );
    const runtimeBindingCommitment = yield*
      decodeTaskDefinitionRuntimeBindingCommitmentV1(
        outer.runtimeBindingCommitment,
      ).pipe(
        Result.mapError(() => preparedFailure(
          "invalid_runtime_binding_commitment",
        )),
      );
    const inputReference = yield* decodeTaskInputReferenceV1(
      outer.inputReference,
    ).pipe(
      Result.mapError(() => preparedFailure("invalid_input_reference")),
    );
    return Object.freeze({
      version: TASK_COMPUTE_PREPARED_EXECUTION_VERSION_V1,
      dispatchRequest,
      runtimeBindingCommitment,
      inputReference,
    });
  });
}

/** Lossless, platform-independent big-endian JavaScript UTF-16 code units. */
export function encodeTaskComputeProfileStorageBytesV1(
  input: unknown,
): Result.Result<
  Uint8Array,
  TaskComputeProfileStorageV1Error<"encode_compute_profile">
> {
  return decodeTaskComputeProfileRefResultV1(input).pipe(
    Result.mapError(() => new TaskComputeProfileStorageV1Error<
      "encode_compute_profile"
    >({
      operation: "encode_compute_profile",
      reason: "invalid_profile",
    })),
    Result.map(encodeUtf16CodeUnits),
  );
}

export function decodeTaskComputeProfileStorageBytesV1(
  input: unknown,
): Result.Result<
  TaskComputeProfileRefV1,
  TaskComputeProfileStorageV1Error<"decode_compute_profile">
> {
  if (!isUint8Array(input) || input.byteLength < 2
    || input.byteLength > MAX_TASK_COMPUTE_PROFILE_STORAGE_BYTES_V1
    || input.byteLength % 2 !== 0) {
    return Result.fail(new TaskComputeProfileStorageV1Error<
      "decode_compute_profile"
    >({
      operation: "decode_compute_profile",
      reason: "invalid_bytes",
    }));
  }
  const profile = decodeUtf16CodeUnits(new Uint8Array(input));
  return decodeTaskComputeProfileRefResultV1(profile).pipe(
    Result.mapError(() => new TaskComputeProfileStorageV1Error<
      "decode_compute_profile"
    >({
      operation: "decode_compute_profile",
      reason: "invalid_profile",
    })),
  );
}

function makeDeliveryEvidenceCodec<
  Value,
  const EncodeOperation extends TaskComputeDeliveryEvidenceOperationV1,
  const DecodeOperation extends TaskComputeDeliveryEvidenceOperationV1,
>(
  options: DeliveryEvidenceCodecOptions<
    Value,
    EncodeOperation,
    DecodeOperation
  >,
) {
  const encode = Effect.fn(
    `TaskComputeDeliveryEvidence.${options.encodeOperation}`,
  )(function* (
    input: unknown,
  ): Effect.fn.Return<
    TaskComputeDeliveryEvidenceV1,
    TaskComputeDeliveryEvidenceV1Error<EncodeOperation>
  > {
    const value = yield* Effect.fromResult(
      options.validateValue(input).pipe(
        Result.mapError((cause) => evidenceFailure(
          options.encodeOperation,
          "invalid_input",
          { cause },
        )),
      ),
    );
    const canonicalBytes = yield* Effect.fromResult(
      encodeCanonicalDomainBytesResult(
        value,
        options,
        options.encodeOperation,
      ),
    );
    const sha256 = yield* hashEvidence(canonicalBytes, options.encodeOperation);
    return captureEvidence(canonicalBytes, sha256);
  });

  const decode = Effect.fn(
    `TaskComputeDeliveryEvidence.${options.decodeOperation}`,
  )(function* (
    input: unknown,
  ): Effect.fn.Return<Value, TaskComputeDeliveryEvidenceV1Error<DecodeOperation>> {
    const evidence = yield* Effect.fromResult(
      captureEvidenceResult(input, options.decodeOperation),
    );
    const observedDigest = yield* hashEvidence(
      evidence.canonicalBytes,
      options.decodeOperation,
    );
    if (!bytesEqual(observedDigest, evidence.sha256)) {
      return yield* Effect.fail(evidenceFailure(
        options.decodeOperation,
        "invalid_digest",
      ));
    }
    const parsed = yield* decodeJson(
      evidence.canonicalBytes,
      options.decodeOperation,
    );
    const value = yield* Effect.fromResult(
      options.decodeValue(parsed).pipe(
        Result.mapError((cause) => evidenceFailure(
          options.decodeOperation,
          "invalid_json",
          { cause },
        )),
      ),
    );
    const canonicalBytes = yield* Effect.fromResult(
      encodeCanonicalDomainBytesResult(
        value,
        options,
        options.decodeOperation,
      ),
    );
    if (!bytesEqual(canonicalBytes, evidence.canonicalBytes)) {
      return yield* Effect.fail(evidenceFailure(
        options.decodeOperation,
        "non_canonical",
      ));
    }
    return value;
  });

  return Object.freeze({ encode, decode });
}

function encodeCanonicalDomainBytesResult<
  Value,
  EncodeOperation extends TaskComputeDeliveryEvidenceOperationV1,
  DecodeOperation extends TaskComputeDeliveryEvidenceOperationV1,
  Operation extends TaskComputeDeliveryEvidenceOperationV1,
>(
  value: Value,
  options: DeliveryEvidenceCodecOptions<
    Value,
    EncodeOperation,
    DecodeOperation
  >,
  operation: Operation,
): Result.Result<Uint8Array, TaskComputeDeliveryEvidenceV1Error<Operation>> {
  return options.encodeValue(value).pipe(
    Result.mapError((cause) => evidenceFailure(
      operation,
      "invalid_input",
      { cause },
    )),
    Result.flatMap((encoded) => {
      if (!isJsonObjectFromUnknown(encoded)) {
        return Result.fail(evidenceFailure(operation, "invalid_input"));
      }
      let canonicalText: string;
      try {
        canonicalText = encodeCanonicalJson(encoded, (cause) => {
          throw cause;
        });
      } catch (cause) {
        return Result.fail(evidenceFailure(
          operation,
          "invalid_input",
          { cause },
        ));
      }
      const canonicalBytes = UTF8_ENCODER.encode(canonicalText);
      if (
        canonicalBytes.byteLength < 1 ||
        canonicalBytes.byteLength > MAX_TASK_COMPUTE_DELIVERY_EVIDENCE_BYTES_V1
      ) {
        return Result.fail(evidenceFailure(
          operation,
          "size_exceeded",
          { observedBytes: canonicalBytes.byteLength },
        ));
      }
      return Result.succeed(canonicalBytes);
    }),
  );
}

function captureEvidenceResult<
  Operation extends TaskComputeDeliveryEvidenceOperationV1,
>(
  input: unknown,
  operation: Operation,
): Result.Result<
  TaskComputeDeliveryEvidenceV1,
  TaskComputeDeliveryEvidenceV1Error<Operation>
> {
  if (typeof input === "object" && input !== null) {
    const owned = EVIDENCE_SNAPSHOTS.get(input);
    if (owned !== undefined) {
      return Result.succeed(captureEvidence(
        owned.canonicalBytes,
        owned.sha256,
      ));
    }
  }
  const outer = captureExactDataRecord(input, [
    "codecVersion",
    "byteLength",
    "canonicalBytes",
    "sha256",
  ]);
  if (
    outer === undefined ||
    outer.codecVersion !== TASK_COMPUTE_DELIVERY_EVIDENCE_CODEC_V1 ||
    !Number.isSafeInteger(outer.byteLength) ||
    typeof outer.byteLength !== "number"
  ) {
    return Result.fail(evidenceFailure(operation, "invalid_evidence"));
  }
  const canonicalBytes = outer.canonicalBytes;
  if (!isUint8Array(canonicalBytes)) {
    return Result.fail(evidenceFailure(operation, "invalid_bytes"));
  }
  if (
    outer.byteLength !== canonicalBytes.byteLength ||
    canonicalBytes.byteLength < 1 ||
    canonicalBytes.byteLength > MAX_TASK_COMPUTE_DELIVERY_EVIDENCE_BYTES_V1
  ) {
    return Result.fail(evidenceFailure(operation, "size_exceeded", {
      observedBytes: canonicalBytes.byteLength,
    }));
  }
  const sha256 = outer.sha256;
  if (!isUint8Array(sha256) || sha256.byteLength !== 32) {
    return Result.fail(evidenceFailure(operation, "invalid_digest"));
  }
  return Result.succeed(captureEvidence(canonicalBytes, sha256));
}

function decodeJson<Operation extends TaskComputeDeliveryEvidenceOperationV1>(
  bytes: Uint8Array,
  operation: Operation,
): Effect.Effect<unknown, TaskComputeDeliveryEvidenceV1Error<Operation>> {
  return Effect.try({
    try: () => JSON.parse(FATAL_UTF8_DECODER.decode(bytes)) as unknown,
    catch: (cause) => evidenceFailure(
      operation,
      cause instanceof TypeError ? "invalid_utf8" : "invalid_json",
      { cause },
    ),
  });
}

function hashEvidence<Operation extends TaskComputeDeliveryEvidenceOperationV1>(
  bytes: Uint8Array,
  operation: Operation,
): Effect.Effect<Uint8Array, TaskComputeDeliveryEvidenceV1Error<Operation>> {
  const input = new Uint8Array(bytes);
  return Effect.tryPromise({
    try: async () => new Uint8Array(
      await globalThis.crypto.subtle.digest("SHA-256", input),
    ),
    catch: (cause) => evidenceFailure(operation, "crypto_failed", { cause }),
  });
}

function captureEvidence(
  canonicalBytes: Uint8Array,
  sha256: Uint8Array,
): TaskComputeDeliveryEvidenceV1 {
  const ownedBytes = new Uint8Array(canonicalBytes);
  const ownedDigest = new Uint8Array(sha256);
  const evidence = Object.freeze({
    codecVersion: TASK_COMPUTE_DELIVERY_EVIDENCE_CODEC_V1,
    byteLength: ownedBytes.byteLength,
    get canonicalBytes() {
      return new Uint8Array(ownedBytes);
    },
    get sha256() {
      return new Uint8Array(ownedDigest);
    },
  });
  EVIDENCE_SNAPSHOTS.set(evidence, Object.freeze({
    canonicalBytes: ownedBytes,
    sha256: ownedDigest,
  }));
  return evidence;
}

function evidenceFailure<Operation extends TaskComputeDeliveryEvidenceOperationV1>(
  operation: Operation,
  reason: TaskComputeDeliveryEvidenceFailureReasonV1,
  detail: Readonly<{
    readonly cause?: unknown;
    readonly observedBytes?: number;
  }> = {},
): TaskComputeDeliveryEvidenceV1Error<Operation> {
  return new TaskComputeDeliveryEvidenceV1Error<Operation>({
    operation,
    reason,
    maximumBytes: MAX_TASK_COMPUTE_DELIVERY_EVIDENCE_BYTES_V1,
    ...detail,
  });
}

function preparedFailure(
  reason: InvalidTaskComputePreparedExecutionV1Error["reason"],
): InvalidTaskComputePreparedExecutionV1Error {
  return new InvalidTaskComputePreparedExecutionV1Error({ reason });
}

function captureExactDataRecord(
  input: unknown,
  expectedKeys: ReadonlyArray<string>,
): Readonly<Record<string, unknown>> | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return undefined;
  }
  try {
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

const UTF8_ENCODER = new TextEncoder();
const FATAL_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const EVIDENCE_SNAPSHOTS = new WeakMap<
  object,
  Readonly<{
    readonly canonicalBytes: Uint8Array;
    readonly sha256: Uint8Array;
  }>
>();

function encodeUtf16CodeUnits(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length * 2);
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    bytes[index * 2] = codeUnit >>> 8;
    bytes[index * 2 + 1] = codeUnit & 0xff;
  }
  return bytes;
}

function decodeUtf16CodeUnits(bytes: Uint8Array): string {
  const codeUnits = new Array<number>(bytes.byteLength / 2);
  for (let index = 0; index < codeUnits.length; index += 1) {
    codeUnits[index] = (bytes[index * 2] ?? 0) << 8
      | (bytes[index * 2 + 1] ?? 0);
  }
  return String.fromCharCode(...codeUnits);
}
