import {
  decodeReplacementScopeDirectoryContinuationV1,
  type ReplacementScopeDirectoryContinuationV1,
} from "@flarex/persistence-postgres/internal/replacement-scope-directory-discovery-v1";
import {
  decodeTaskComputeDeliveryContinuationV1,
  type TaskComputeDeliveryContinuationV1,
  type TaskComputeDeliveryOperation,
} from "@flarex/persistence-postgres/internal/task-compute-delivery-discovery";
import { bytesEqual, isUint8Array } from "@flarex/utils/bytes";
import { Data, Effect, Result, Schema } from "effect";
import {
  encodeCanonicalJson,
  isJsonObjectFromUnknown,
} from "flarex-protocol/json";
import {
  ReplacementScopeIdV1Schema,
  ScopeIdSchema,
  type ReplacementScopeIdV1,
  type ScopeId,
} from "flarex-protocol/storage-authority";

export const TASK_COMPUTE_DELIVERY_CONNECTED_CONTINUATION_CODEC_V1 = 1;
export const MAX_TASK_COMPUTE_DELIVERY_CONNECTED_CONTINUATION_BYTES_V1 =
  16 * 1_024;
export const MAX_TASK_COMPUTE_DELIVERY_SCOPE_PAGE_CHARGES = 100;

export type TaskComputeDeliveryConnectedDirectoryStateV1 =
  | Readonly<{ readonly kind: "unstarted" }>
  | Readonly<{
      readonly kind: "continuing";
      readonly continuation: ReplacementScopeDirectoryContinuationV1;
    }>
  | Readonly<{
      readonly kind: "exhausted";
      readonly highWaterScopeId: ScopeId;
    }>;

export type TaskComputeDeliveryConnectedDirectoryAfterV1 = Exclude<
  TaskComputeDeliveryConnectedDirectoryStateV1,
  { readonly kind: "unstarted" }
>;

export type TaskComputeDeliveryConnectedOperationStateV1<
  Operation extends TaskComputeDeliveryOperation,
> =
  | Readonly<{ readonly kind: "unstarted" }>
  | Readonly<{
      readonly kind: "continuing";
      readonly continuation: TaskComputeDeliveryContinuationV1<Operation>;
    }>
  | Readonly<{ readonly kind: "exhausted" }>;

export interface TaskComputeDeliveryConnectedActiveScopeV1 {
  readonly expectedDeploymentId: string;
  readonly expectedScopeId: ReplacementScopeIdV1;
  readonly directoryAfter: TaskComputeDeliveryConnectedDirectoryAfterV1;
  readonly nextOperation: TaskComputeDeliveryOperation;
  readonly dispatch: TaskComputeDeliveryConnectedOperationStateV1<"dispatch">;
  readonly cancellation:
    TaskComputeDeliveryConnectedOperationStateV1<"cancellation">;
  readonly dispatchPagesCharged: number;
  readonly cancellationPagesCharged: number;
}

export interface TaskComputeDeliveryConnectedContinuationV1 {
  readonly version: "flarex.task-compute-delivery-connected-continuation.v1";
  readonly directory: TaskComputeDeliveryConnectedDirectoryStateV1;
  readonly activeScope: TaskComputeDeliveryConnectedActiveScopeV1 | null;
}

export interface EncodedTaskComputeDeliveryConnectedContinuationV1 {
  readonly codecVersion:
    typeof TASK_COMPUTE_DELIVERY_CONNECTED_CONTINUATION_CODEC_V1;
  readonly canonicalBytes: Uint8Array;
  readonly sha256: Uint8Array;
}

const CONNECTED_CONTINUATION_EVIDENCE_SNAPSHOTS = new WeakMap<
  object,
  Readonly<{
    readonly canonicalBytes: Uint8Array;
    readonly sha256: Uint8Array;
  }>
>();

export type TaskComputeDeliveryConnectedContinuationCodecOperationV1 =
  | "encode"
  | "decode";

export type TaskComputeDeliveryConnectedContinuationCodecReasonV1 =
  | "invalid_input"
  | "invalid_bytes"
  | "invalid_digest"
  | "invalid_utf8"
  | "invalid_json"
  | "non_canonical"
  | "size_exceeded"
  | "crypto_failed"
  | "invalid_correlation";

export class TaskComputeDeliveryConnectedContinuationCodecV1Error<
  Operation extends TaskComputeDeliveryConnectedContinuationCodecOperationV1 =
    TaskComputeDeliveryConnectedContinuationCodecOperationV1,
>
  extends Data.TaggedError(
    "TaskComputeDeliveryConnectedContinuationCodecV1Error",
  )<{
    readonly operation: Operation;
    readonly reason: TaskComputeDeliveryConnectedContinuationCodecReasonV1;
    readonly observedBytes?: number;
    readonly maximumBytes?: number;
    readonly cause?: unknown;
  }> {}

const NonBlankStringSchema = Schema.String.check(Schema.makeFilter((value) =>
  value.trim().length > 0 ? undefined : "Expected a nonblank string"
));
const PageChargeSchema = Schema.Int.check(Schema.isBetween({
  minimum: 0,
  maximum: MAX_TASK_COMPUTE_DELIVERY_SCOPE_PAGE_CHARGES,
}));
const RawDirectoryContinuationSchema = Schema.Struct({
  kind: Schema.Literal("continuing"),
  continuation: Schema.Unknown,
});
const RawDirectoryAfterSchema = Schema.Union([
  RawDirectoryContinuationSchema,
  Schema.Struct({
    kind: Schema.Literal("exhausted"),
    highWaterScopeId: ScopeIdSchema,
  }),
]);
const RawDirectoryStateSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("unstarted") }),
  RawDirectoryContinuationSchema,
  Schema.Struct({
    kind: Schema.Literal("exhausted"),
    highWaterScopeId: ScopeIdSchema,
  }),
]);
const rawOperationStateSchema = (operation: TaskComputeDeliveryOperation) =>
  Schema.Union([
    Schema.Struct({ kind: Schema.Literal("unstarted") }),
    Schema.Struct({
      kind: Schema.Literal("continuing"),
      continuation: Schema.Unknown,
    }),
    Schema.Struct({ kind: Schema.Literal("exhausted") }),
  ]).annotate({ identifier: `TaskComputeDelivery${operation}StateV1` });
const RawActiveScopeSchema = Schema.Struct({
  expectedDeploymentId: NonBlankStringSchema,
  expectedScopeId: ReplacementScopeIdV1Schema,
  directoryAfter: RawDirectoryAfterSchema,
  nextOperation: Schema.Literals(["dispatch", "cancellation"]),
  dispatch: rawOperationStateSchema("dispatch"),
  cancellation: rawOperationStateSchema("cancellation"),
  dispatchPagesCharged: PageChargeSchema,
  cancellationPagesCharged: PageChargeSchema,
});
const RawContinuationSchema = Schema.Struct({
  version: Schema.Literal(
    "flarex.task-compute-delivery-connected-continuation.v1",
  ),
  directory: RawDirectoryStateSchema,
  activeScope: Schema.NullOr(RawActiveScopeSchema),
});
const decodeRawContinuation = Schema.decodeUnknownResult(
  RawContinuationSchema,
  { onExcessProperty: "error" },
);

export const encodeTaskComputeDeliveryConnectedContinuationV1 = Effect.fn(
  "TaskComputeDeliveryConnectedContinuation.encode",
)(function* (input: unknown) {
  const value = yield* Effect.fromResult(decodeContinuation(input, "encode"));
  const canonicalBytes = yield* canonicalContinuationBytes(value, "encode");
  const sha256 = yield* digest(canonicalBytes, "encode");
  return captureEvidence(canonicalBytes, sha256);
});

export const decodeTaskComputeDeliveryConnectedContinuationV1 = Effect.fn(
  "TaskComputeDeliveryConnectedContinuation.decode",
)(function* (input: unknown) {
  const evidence = yield* Effect.fromResult(captureEvidenceResult(input));
  const parsed = yield* Effect.try({
    try: () => JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(evidence.canonicalBytes),
    ) as unknown,
    catch: (cause) => codecFailure(
      "decode",
      cause instanceof TypeError ? "invalid_utf8" : "invalid_json",
      cause,
    ),
  });
  const value = yield* Effect.fromResult(decodeContinuation(parsed, "decode"));
  const canonicalBytes = yield* canonicalContinuationBytes(value, "decode");
  if (!bytesEqual(canonicalBytes, evidence.canonicalBytes)) {
    return yield* codecFailure("decode", "non_canonical");
  }
  const sha256 = yield* digest(canonicalBytes, "decode");
  if (!bytesEqual(sha256, evidence.sha256)) {
    return yield* codecFailure("decode", "invalid_digest");
  }
  return captureContinuation(value);
});

function decodeContinuation<
  Operation extends TaskComputeDeliveryConnectedContinuationCodecOperationV1,
>(
  input: unknown,
  operation: Operation,
): Result.Result<
  TaskComputeDeliveryConnectedContinuationV1,
  TaskComputeDeliveryConnectedContinuationCodecV1Error<Operation>
> {
  const captured = capturePlainData(input);
  if (captured === INVALID_CAPTURE) {
    return Result.fail(codecFailure(operation, "invalid_input"));
  }
  return decodeRawContinuation(captured).pipe(
    Result.mapError((cause) => codecFailure(operation, "invalid_input", cause)),
    Result.flatMap((raw) => Result.gen(function* () {
      const directory = yield* decodeDirectory(raw.directory, operation);
      const activeScope = raw.activeScope === null
        ? null
        : yield* decodeActiveScope(raw.activeScope, operation);
      yield* validateCorrelation(directory, activeScope, operation);
      return Object.freeze({
        version:
          "flarex.task-compute-delivery-connected-continuation.v1" as const,
        directory,
        activeScope,
      });
    })),
  );
}

function decodeDirectory<
  Operation extends TaskComputeDeliveryConnectedContinuationCodecOperationV1,
>(
  raw: typeof RawDirectoryStateSchema.Type,
  operation: Operation,
): Result.Result<
  TaskComputeDeliveryConnectedDirectoryStateV1,
  TaskComputeDeliveryConnectedContinuationCodecV1Error<Operation>
> {
  if (raw.kind === "unstarted") {
    return Result.succeed(Object.freeze({ kind: "unstarted" as const }));
  }
  if (raw.kind === "exhausted") {
    return Result.succeed(Object.freeze({
      kind: "exhausted" as const,
      highWaterScopeId: raw.highWaterScopeId,
    }));
  }
  return decodeReplacementScopeDirectoryContinuationV1(
    raw.continuation,
  ).pipe(
    Result.mapError((cause) => codecFailure(operation, "invalid_input", cause)),
    Result.map((continuation) => Object.freeze({
      kind: "continuing" as const,
      continuation: captureDirectoryContinuation(continuation),
    })),
  );
}

function decodeActiveScope<
  Operation extends TaskComputeDeliveryConnectedContinuationCodecOperationV1,
>(
  raw: Exclude<typeof RawActiveScopeSchema.Type, null>,
  operation: Operation,
): Result.Result<
  TaskComputeDeliveryConnectedActiveScopeV1,
  TaskComputeDeliveryConnectedContinuationCodecV1Error<Operation>
> {
  return Result.gen(function* () {
    const directoryAfter = yield* decodeDirectoryAfter(
      raw.directoryAfter,
      operation,
    );
    const dispatch = yield* decodeOperationState(
      "dispatch",
      raw.dispatch,
      operation,
    );
    const cancellation = yield* decodeOperationState(
      "cancellation",
      raw.cancellation,
      operation,
    );
    return Object.freeze({
      expectedDeploymentId: raw.expectedDeploymentId,
      expectedScopeId: raw.expectedScopeId,
      directoryAfter,
      nextOperation: raw.nextOperation,
      dispatch,
      cancellation,
      dispatchPagesCharged: raw.dispatchPagesCharged,
      cancellationPagesCharged: raw.cancellationPagesCharged,
    });
  });
}

function decodeDirectoryAfter<
  Operation extends TaskComputeDeliveryConnectedContinuationCodecOperationV1,
>(
  raw: typeof RawDirectoryAfterSchema.Type,
  operation: Operation,
): Result.Result<
  TaskComputeDeliveryConnectedDirectoryAfterV1,
  TaskComputeDeliveryConnectedContinuationCodecV1Error<Operation>
> {
  return raw.kind === "exhausted"
    ? Result.succeed(Object.freeze({
      kind: "exhausted" as const,
      highWaterScopeId: raw.highWaterScopeId,
    }))
    : decodeReplacementScopeDirectoryContinuationV1(raw.continuation).pipe(
      Result.mapError((cause) =>
        codecFailure(operation, "invalid_input", cause)
      ),
      Result.map((continuation) => Object.freeze({
        kind: "continuing" as const,
        continuation: captureDirectoryContinuation(continuation),
      })),
    );
}

function decodeOperationState<
  DeliveryOperation extends TaskComputeDeliveryOperation,
  CodecOperation extends TaskComputeDeliveryConnectedContinuationCodecOperationV1,
>(
  expected: DeliveryOperation,
  raw: typeof RawActiveScopeSchema.Type[DeliveryOperation],
  operation: CodecOperation,
): Result.Result<
  TaskComputeDeliveryConnectedOperationStateV1<DeliveryOperation>,
  TaskComputeDeliveryConnectedContinuationCodecV1Error<CodecOperation>
> {
  if (raw.kind !== "continuing") {
    return Result.succeed(Object.freeze({ kind: raw.kind }));
  }
  return decodeTaskComputeDeliveryContinuationV1(raw.continuation).pipe(
    Result.mapError((cause) => codecFailure(operation, "invalid_input", cause)),
    Result.flatMap((continuation) => continuationForOperation(
      continuation,
      expected,
    )
      ? Result.succeed(Object.freeze({
        kind: "continuing" as const,
        continuation: captureOperationContinuation(continuation, expected),
      }))
      : Result.fail(codecFailure(operation, "invalid_correlation"))),
  );
}

function continuationForOperation<
  Operation extends TaskComputeDeliveryOperation,
>(
  continuation: TaskComputeDeliveryContinuationV1,
  expected: Operation,
): continuation is TaskComputeDeliveryContinuationV1<Operation> {
  return continuation.operation === expected;
}

function validateCorrelation<
  Operation extends TaskComputeDeliveryConnectedContinuationCodecOperationV1,
>(
  directory: TaskComputeDeliveryConnectedDirectoryStateV1,
  active: TaskComputeDeliveryConnectedActiveScopeV1 | null,
  operation: Operation,
): Result.Result<
  void,
  TaskComputeDeliveryConnectedContinuationCodecV1Error<Operation>
> {
  if (active === null) return Result.succeed(undefined);
  const afterHighWater = active.directoryAfter.kind === "exhausted"
    ? active.directoryAfter.highWaterScopeId
    : active.directoryAfter.continuation.highWaterScopeId;
  const afterMatches = active.directoryAfter.kind === "exhausted"
    ? active.directoryAfter.highWaterScopeId === active.expectedScopeId
    : active.directoryAfter.continuation.lastScopeId === active.expectedScopeId;
  const outerMatches = directory.kind === "unstarted"
    || directory.kind === "continuing"
      && directory.continuation.highWaterScopeId === afterHighWater
      && directory.continuation.lastScopeId < active.expectedScopeId;
  const dispatchDone = active.dispatch.kind === "exhausted";
  const cancellationDone = active.cancellation.kind === "exhausted";
  const chargesMatchProgress =
    (active.dispatch.kind === "unstarted"
      || active.dispatchPagesCharged > 0)
    && (active.cancellation.kind === "unstarted"
      || active.cancellationPagesCharged > 0);
  const turnValid = !(dispatchDone && cancellationDone)
    && (active.nextOperation === "dispatch" ? !dispatchDone : !cancellationDone);
  return afterMatches && outerMatches && chargesMatchProgress && turnValid
    ? Result.succeed(undefined)
    : Result.fail(codecFailure(operation, "invalid_correlation"));
}

function canonicalContinuationBytes<
  Operation extends TaskComputeDeliveryConnectedContinuationCodecOperationV1,
>(
  value: TaskComputeDeliveryConnectedContinuationV1,
  operation: Operation,
): Effect.Effect<
  Uint8Array,
  TaskComputeDeliveryConnectedContinuationCodecV1Error<Operation>
> {
  if (!isJsonObjectFromUnknown(value)) {
    return Effect.fail(codecFailure(operation, "invalid_input"));
  }
  const bytes = new TextEncoder().encode(encodeCanonicalJson(value, (cause) => {
    throw cause;
  }));
  return bytes.byteLength >= 1
      && bytes.byteLength <=
        MAX_TASK_COMPUTE_DELIVERY_CONNECTED_CONTINUATION_BYTES_V1
    ? Effect.succeed(bytes)
    : Effect.fail(codecFailure(
      operation,
      "size_exceeded",
      undefined,
      bytes.byteLength,
    ));
}

function digest<
  Operation extends TaskComputeDeliveryConnectedContinuationCodecOperationV1,
>(
  bytes: Uint8Array,
  operation: Operation,
): Effect.Effect<
  Uint8Array,
  TaskComputeDeliveryConnectedContinuationCodecV1Error<Operation>
> {
  const owned = new Uint8Array(bytes);
  return Effect.tryPromise({
    try: async () => new Uint8Array(await crypto.subtle.digest("SHA-256", owned)),
    catch: (cause) => codecFailure(operation, "crypto_failed", cause),
  });
}

function captureEvidenceResult(
  input: unknown,
): Result.Result<
  EncodedTaskComputeDeliveryConnectedContinuationV1,
  TaskComputeDeliveryConnectedContinuationCodecV1Error<"decode">
> {
  if (typeof input === "object" && input !== null) {
    const owned = CONNECTED_CONTINUATION_EVIDENCE_SNAPSHOTS.get(
      input,
    );
    if (owned !== undefined) {
      return Result.succeed(captureEvidence(
        owned.canonicalBytes,
        owned.sha256,
      ));
    }
  }
  const captured = captureExactEvidence(input);
  if (captured === INVALID_CAPTURE) {
    return Result.fail(codecFailure("decode", "invalid_input"));
  }
  return Result.gen(function* () {
    const canonicalBytesInput = captured.canonicalBytes;
    if (!isUint8Array(canonicalBytesInput)) {
      return yield* Result.fail(codecFailure("decode", "invalid_bytes"));
    }
    const canonicalBytes = yield* Result.try({
      try: () => new Uint8Array(canonicalBytesInput),
      catch: (cause) => codecFailure("decode", "invalid_bytes", cause),
    });
    if (
      canonicalBytes.byteLength < 1
      || canonicalBytes.byteLength >
        MAX_TASK_COMPUTE_DELIVERY_CONNECTED_CONTINUATION_BYTES_V1
    ) {
      return yield* Result.fail(codecFailure(
        "decode",
        "size_exceeded",
        undefined,
        canonicalBytes.byteLength,
      ));
    }
    const sha256Input = captured.sha256;
    if (!isUint8Array(sha256Input)) {
      return yield* Result.fail(codecFailure("decode", "invalid_digest"));
    }
    const sha256 = yield* Result.try({
      try: () => new Uint8Array(sha256Input),
      catch: (cause) => codecFailure("decode", "invalid_digest", cause),
    });
    if (sha256.byteLength !== 32) {
      return yield* Result.fail(codecFailure("decode", "invalid_digest"));
    }
    return captureEvidence(canonicalBytes, sha256);
  });
}

function captureEvidence(
  canonicalBytes: Uint8Array,
  sha256: Uint8Array,
): EncodedTaskComputeDeliveryConnectedContinuationV1 {
  const bytes = new Uint8Array(canonicalBytes);
  const digestBytes = new Uint8Array(sha256);
  const evidence = Object.freeze({
    codecVersion: TASK_COMPUTE_DELIVERY_CONNECTED_CONTINUATION_CODEC_V1,
    get canonicalBytes() {
      return new Uint8Array(bytes);
    },
    get sha256() {
      return new Uint8Array(digestBytes);
    },
  });
  CONNECTED_CONTINUATION_EVIDENCE_SNAPSHOTS.set(evidence, Object.freeze({
    canonicalBytes: bytes,
    sha256: digestBytes,
  }));
  return evidence;
}

function captureContinuation(
  value: TaskComputeDeliveryConnectedContinuationV1,
): TaskComputeDeliveryConnectedContinuationV1 {
  return Object.freeze({
    version: value.version,
    directory: captureDirectory(value.directory),
    activeScope: value.activeScope === null
      ? null
      : Object.freeze({
        ...value.activeScope,
        directoryAfter: captureDirectoryAfter(value.activeScope.directoryAfter),
        dispatch: captureOperationState(value.activeScope.dispatch),
        cancellation: captureOperationState(value.activeScope.cancellation),
      }),
  });
}

function captureDirectory(
  value: TaskComputeDeliveryConnectedDirectoryStateV1,
): TaskComputeDeliveryConnectedDirectoryStateV1 {
  if (value.kind === "unstarted") return Object.freeze({ kind: "unstarted" });
  return value.kind === "exhausted"
    ? Object.freeze({ kind: "exhausted", highWaterScopeId: value.highWaterScopeId })
    : Object.freeze({
      kind: "continuing",
      continuation: captureDirectoryContinuation(value.continuation),
    });
}

function captureDirectoryAfter(
  value: TaskComputeDeliveryConnectedDirectoryAfterV1,
): TaskComputeDeliveryConnectedDirectoryAfterV1 {
  return value.kind === "exhausted"
    ? Object.freeze({ kind: "exhausted", highWaterScopeId: value.highWaterScopeId })
    : Object.freeze({
      kind: "continuing",
      continuation: captureDirectoryContinuation(value.continuation),
    });
}

function captureDirectoryContinuation(
  value: ReplacementScopeDirectoryContinuationV1,
): ReplacementScopeDirectoryContinuationV1 {
  return Object.freeze({
    codecVersion: value.codecVersion,
    highWaterScopeId: value.highWaterScopeId,
    lastScopeId: value.lastScopeId,
  });
}

function captureOperationState<Operation extends TaskComputeDeliveryOperation>(
  value: TaskComputeDeliveryConnectedOperationStateV1<Operation>,
): TaskComputeDeliveryConnectedOperationStateV1<Operation> {
  return value.kind === "continuing"
    ? Object.freeze({
      kind: "continuing",
      continuation: captureOperationContinuation(
        value.continuation,
        value.continuation.operation,
      ),
    })
    : Object.freeze({ kind: value.kind });
}

function captureOperationContinuation<Operation extends TaskComputeDeliveryOperation>(
  value: TaskComputeDeliveryContinuationV1<Operation>,
  operation: Operation,
): TaskComputeDeliveryContinuationV1<Operation> {
  return Object.freeze({
    codecVersion: 1,
    operation,
    databaseTimeBound: value.databaseTimeBound,
    highWater: Object.freeze({ ...value.highWater }),
    last: Object.freeze({ ...value.last }),
  });
}

const INVALID_CAPTURE = Symbol("invalid connected continuation capture");

function capturePlainData(input: unknown): unknown | typeof INVALID_CAPTURE {
  const seen = new Set<object>();
  const visit = (value: unknown): unknown | typeof INVALID_CAPTURE => {
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) return INVALID_CAPTURE;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null && !Array.isArray(value)) {
      return INVALID_CAPTURE;
    }
    seen.add(value);
    try {
      if (Array.isArray(value)) {
        const array: unknown[] = [];
        for (let index = 0; index < value.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          if (descriptor === undefined || !("value" in descriptor)) return INVALID_CAPTURE;
          const nested = visit(descriptor.value);
          if (nested === INVALID_CAPTURE) return INVALID_CAPTURE;
          array.push(nested);
        }
        return array;
      }
      const captured = Object.create(null) as Record<string, unknown>;
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== "string") return INVALID_CAPTURE;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
          return INVALID_CAPTURE;
        }
        const nested = visit(descriptor.value);
        if (nested === INVALID_CAPTURE) return INVALID_CAPTURE;
        Object.defineProperty(captured, key, {
          value: nested,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return captured;
    } catch {
      return INVALID_CAPTURE;
    } finally {
      seen.delete(value);
    }
  };
  try {
    return visit(input);
  } catch {
    return INVALID_CAPTURE;
  }
}

function captureExactEvidence(input: unknown): Readonly<{
  readonly canonicalBytes: unknown;
  readonly sha256: unknown;
}> | typeof INVALID_CAPTURE {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return INVALID_CAPTURE;
    }
    const keys = Reflect.ownKeys(input);
    if (
      keys.length !== 3 || !keys.includes("codecVersion")
      || !keys.includes("canonicalBytes") || !keys.includes("sha256")
    ) return INVALID_CAPTURE;
    const version = Object.getOwnPropertyDescriptor(input, "codecVersion");
    const bytes = Object.getOwnPropertyDescriptor(input, "canonicalBytes");
    const sha = Object.getOwnPropertyDescriptor(input, "sha256");
    if (
      version === undefined || !("value" in version)
      || version.value !== TASK_COMPUTE_DELIVERY_CONNECTED_CONTINUATION_CODEC_V1
      || bytes === undefined || !("value" in bytes)
      || sha === undefined || !("value" in sha)
    ) return INVALID_CAPTURE;
    return Object.freeze({ canonicalBytes: bytes.value, sha256: sha.value });
  } catch {
    return INVALID_CAPTURE;
  }
}

function codecFailure<
  Operation extends TaskComputeDeliveryConnectedContinuationCodecOperationV1,
>(
  operation: Operation,
  reason: TaskComputeDeliveryConnectedContinuationCodecReasonV1,
  cause?: unknown,
  observedBytes?: number,
): TaskComputeDeliveryConnectedContinuationCodecV1Error<Operation> {
  return new TaskComputeDeliveryConnectedContinuationCodecV1Error<Operation>({
    operation,
    reason,
    ...(cause === undefined ? {} : { cause }),
    ...(observedBytes === undefined ? {} : {
      observedBytes,
      maximumBytes: MAX_TASK_COMPUTE_DELIVERY_CONNECTED_CONTINUATION_BYTES_V1,
    }),
  });
}
