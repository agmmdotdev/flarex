import { isUint8Array } from "@flarex/utils/bytes";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { Data, Result } from "effect";

export const DECLARATIVE_V2_ARTIFACT_MODULE_PATH_TRANSITION_QUANTUM_V1 = 1_024;
export const DECLARATIVE_V2_ARTIFACT_MODULE_PATH_MAX_ADDRESSABLE_BYTES_V1 =
  0xffff_ffff;

export type DeclarativeV2ArtifactModulePathOperationV1 =
  | "create"
  | "step"
  | "finish"
  | "read"
  | "revoke";

export type DeclarativeV2ArtifactModulePathErrorReasonV1 =
  | "invalidInput"
  | "invalidPath"
  | "budgetExceeded"
  | "addressabilityExceeded"
  | "closed";

export class DeclarativeV2ArtifactModulePathV1Error extends Data.TaggedError(
  "DeclarativeV2ArtifactModulePathV1Error",
)<{
  readonly operation: DeclarativeV2ArtifactModulePathOperationV1;
  readonly reason: DeclarativeV2ArtifactModulePathErrorReasonV1;
  readonly dimension?: "calls" | "stringBytes" | "outputBytes" | "transitions";
  readonly observed?: bigint;
  readonly maximum?: bigint;
}> {}

export interface DeclarativeV2ArtifactModulePathUsageV1 {
  readonly calls: bigint;
  readonly stringBytes: bigint;
  readonly outputBytes: bigint;
  readonly transitions: bigint;
}

export interface DeclarativeV2ArtifactModulePathValidatorV1 {
  readonly _tag: "DeclarativeV2ArtifactModulePathValidatorV1";
}

export interface DeclarativeV2ArtifactModulePathHandleV1 {
  /**
   * This handle proves only factory-local ownership of an exact canonical
   * spelling. It does not prove that an artifact exists or grant read authority.
   */
  readonly _tag: "DeclarativeV2ArtifactModulePathHandleV1";
}

export interface DeclarativeV2ArtifactModulePathStepReceiptV1 {
  readonly consumedBytes: number;
  readonly transitionCount: number;
  readonly deltaUsage: DeclarativeV2ArtifactModulePathUsageV1;
  readonly usage: DeclarativeV2ArtifactModulePathUsageV1;
}

export interface DeclarativeV2ArtifactModulePathFinishPendingV1 {
  readonly status: "pending";
  readonly transitionCount: 0;
  readonly deltaUsage: DeclarativeV2ArtifactModulePathUsageV1;
  readonly usage: DeclarativeV2ArtifactModulePathUsageV1;
}

export type DeclarativeV2ArtifactModulePathFinishResultV1 =
  | DeclarativeV2ArtifactModulePathFinishPendingV1
  | DeclarativeV2ArtifactModulePathHandleV1;

export interface DeclarativeV2ArtifactModulePathFactoryV1 {
  readonly create: (
    maximumCalls: unknown,
    maximumStringBytes: unknown,
    maximumOutputBytes: unknown,
  ) => Result.Result<
    DeclarativeV2ArtifactModulePathValidatorV1,
    DeclarativeV2ArtifactModulePathV1Error
  >;
  readonly step: (
    validator: unknown,
    bytes: unknown,
    maximumTransitions: unknown,
  ) => Result.Result<
    DeclarativeV2ArtifactModulePathStepReceiptV1,
    DeclarativeV2ArtifactModulePathV1Error
  >;
  readonly finish: (
    validator: unknown,
    maximumTransitions: unknown,
  ) => Result.Result<
    DeclarativeV2ArtifactModulePathFinishResultV1,
    DeclarativeV2ArtifactModulePathV1Error
  >;
  readonly capture: (
    handle: unknown,
  ) => Result.Result<
    DeclarativeV2ArtifactModulePathHandleV1,
    DeclarativeV2ArtifactModulePathV1Error
  >;
  readonly byteLength: (
    handle: unknown,
  ) => Result.Result<number, DeclarativeV2ArtifactModulePathV1Error>;
  readonly byteAt: (
    handle: unknown,
    offset: unknown,
  ) => Result.Result<number | undefined, DeclarativeV2ArtifactModulePathV1Error>;
  readonly usage: (
    handle: unknown,
  ) => Result.Result<
    DeclarativeV2ArtifactModulePathUsageV1,
    DeclarativeV2ArtifactModulePathV1Error
  >;
  readonly revoke: (
    handle: unknown,
  ) => Result.Result<void, DeclarativeV2ArtifactModulePathV1Error>;
}

type MutableUsageV1 = {
  calls: bigint;
  stringBytes: bigint;
  outputBytes: bigint;
  transitions: bigint;
};

interface ValidatorStateV1 {
  readonly maximumCalls: bigint;
  readonly maximumStringBytes: bigint;
  readonly maximumOutputBytes: bigint;
  readonly bytes: Uint8Array;
  readonly usage: MutableUsageV1;
  phase: "accepting" | "complete" | "failed";
  byteLength: number;
  segmentByteLength: number;
  segmentFirstByte: number;
  segmentSecondByte: number;
  remainingContinuationBytes: number;
  nextContinuationMinimum: number;
  nextContinuationMaximum: number;
}

interface HandleStateV1 {
  readonly bytes: Uint8Array;
  readonly byteLength: number;
  readonly usage: DeclarativeV2ArtifactModulePathUsageV1;
  revoked: boolean;
}

const usageSnapshot = (
  usage: MutableUsageV1,
): DeclarativeV2ArtifactModulePathUsageV1 =>
  Object.freeze({
    calls: usage.calls,
    stringBytes: usage.stringBytes,
    outputBytes: usage.outputBytes,
    transitions: usage.transitions,
  });

const zeroUsage = (): DeclarativeV2ArtifactModulePathUsageV1 =>
  Object.freeze({
    calls: 0n,
    stringBytes: 0n,
    outputBytes: 0n,
    transitions: 0n,
  });

const differenceUsage = (
  after: MutableUsageV1,
  before: DeclarativeV2ArtifactModulePathUsageV1,
): DeclarativeV2ArtifactModulePathUsageV1 =>
  Object.freeze({
    calls: after.calls - before.calls,
    stringBytes: after.stringBytes - before.stringBytes,
    outputBytes: after.outputBytes - before.outputBytes,
    transitions: after.transitions - before.transitions,
  });

const pathError = (
  operation: DeclarativeV2ArtifactModulePathOperationV1,
  reason: DeclarativeV2ArtifactModulePathErrorReasonV1,
  evidence?: Readonly<{
    readonly dimension?: DeclarativeV2ArtifactModulePathV1Error["dimension"];
    readonly observed?: bigint;
    readonly maximum?: bigint;
  }>,
): DeclarativeV2ArtifactModulePathV1Error =>
  new DeclarativeV2ArtifactModulePathV1Error({
    operation,
    reason,
    ...(evidence?.dimension === undefined
      ? {}
      : { dimension: evidence.dimension }),
    ...(evidence?.observed === undefined
      ? {}
      : { observed: evidence.observed }),
    ...(evidence?.maximum === undefined
      ? {}
      : { maximum: evidence.maximum }),
  });

const isCompletedSegmentInvalid = (state: ValidatorStateV1): boolean =>
  state.segmentByteLength === 0 ||
  state.segmentByteLength === 1 && state.segmentFirstByte === 0x2e ||
  state.segmentByteLength === 2 &&
    state.segmentFirstByte === 0x2e &&
    state.segmentSecondByte === 0x2e;

const failValidator = <A>(
  state: ValidatorStateV1,
  error: DeclarativeV2ArtifactModulePathV1Error,
): Result.Result<A, DeclarativeV2ArtifactModulePathV1Error> => {
  state.phase = "failed";
  return Result.fail(error);
};

const intrinsicByteLength = (value: Uint8Array): number | undefined => {
  try {
    const typedArrayPrototype: object = Object.getPrototypeOf(
      Uint8Array.prototype,
    );
    const getter = Object.getOwnPropertyDescriptor(
      typedArrayPrototype,
      "byteLength",
    )?.get;
    const observed = getter?.call(value) as unknown;
    return typeof observed === "number" ? observed : undefined;
  } catch {
    return undefined;
  }
};

export function makeDeclarativeV2ArtifactModulePathFactoryV1():
  DeclarativeV2ArtifactModulePathFactoryV1 {
  const validators = new WeakMap<object, ValidatorStateV1>();
  const handles = new WeakMap<object, HandleStateV1>();

  const isOwnedHandle = (
    value: unknown,
  ): value is DeclarativeV2ArtifactModulePathHandleV1 =>
    value !== null && typeof value === "object" && handles.has(value);

  const validatorState = (
    value: unknown,
    operation: "step" | "finish",
  ): Result.Result<ValidatorStateV1, DeclarativeV2ArtifactModulePathV1Error> => {
    const state = value !== null && typeof value === "object"
      ? validators.get(value)
      : undefined;
    return state === undefined
      ? Result.fail(pathError(operation, "invalidInput"))
      : state.phase !== "accepting"
      ? Result.fail(pathError(operation, "closed"))
      : Result.succeed(state);
  };

  const handleState = (
    value: unknown,
    operation: "read" | "revoke",
  ): Result.Result<HandleStateV1, DeclarativeV2ArtifactModulePathV1Error> => {
    const state = value !== null && typeof value === "object"
      ? handles.get(value)
      : undefined;
    return state === undefined
      ? Result.fail(pathError(operation, "invalidInput"))
      : state.revoked
      ? Result.fail(pathError(operation, "closed"))
      : Result.succeed(state);
  };

  const create: DeclarativeV2ArtifactModulePathFactoryV1["create"] = (
    maximumCalls,
    maximumStringBytes,
    maximumOutputBytes,
  ) => {
    if (
      !isNonNegativeSafeInteger(maximumCalls) ||
      !isNonNegativeSafeInteger(maximumStringBytes) ||
      !isNonNegativeSafeInteger(maximumOutputBytes)
    ) {
      return Result.fail(pathError("create", "invalidInput"));
    }
    if (maximumCalls < 1) {
      return Result.fail(pathError("create", "budgetExceeded", {
        dimension: "calls",
        observed: 1n,
        maximum: BigInt(maximumCalls),
      }));
    }
    for (const [dimension, maximum] of [
      ["stringBytes", maximumStringBytes],
      ["outputBytes", maximumOutputBytes],
    ] as const) {
      if (
        maximum >
          DECLARATIVE_V2_ARTIFACT_MODULE_PATH_MAX_ADDRESSABLE_BYTES_V1
      ) {
        return Result.fail(pathError("create", "addressabilityExceeded", {
          dimension,
          observed: BigInt(maximum),
          maximum: BigInt(
            DECLARATIVE_V2_ARTIFACT_MODULE_PATH_MAX_ADDRESSABLE_BYTES_V1,
          ),
        }));
      }
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(
        Math.min(maximumStringBytes, maximumOutputBytes),
      );
    } catch (cause) {
      if (cause instanceof RangeError) {
        return Result.fail(pathError("create", "budgetExceeded", {
          dimension: "outputBytes",
        }));
      }
      throw cause;
    }
    const state: ValidatorStateV1 = {
      maximumCalls: BigInt(maximumCalls),
      maximumStringBytes: BigInt(maximumStringBytes),
      maximumOutputBytes: BigInt(maximumOutputBytes),
      bytes,
      usage: {
        calls: 1n,
        stringBytes: 0n,
        outputBytes: 0n,
        transitions: 0n,
      },
      phase: "accepting",
      byteLength: 0,
      segmentByteLength: 0,
      segmentFirstByte: 0,
      segmentSecondByte: 0,
      remainingContinuationBytes: 0,
      nextContinuationMinimum: 0x80,
      nextContinuationMaximum: 0xbf,
    };
    const validator = Object.freeze({
      _tag: "DeclarativeV2ArtifactModulePathValidatorV1",
    } satisfies DeclarativeV2ArtifactModulePathValidatorV1);
    validators.set(validator, state);
    return Result.succeed(validator);
  };

  const prechargeCall = (
    state: ValidatorStateV1,
    operation: "step" | "finish",
  ): Result.Result<void, DeclarativeV2ArtifactModulePathV1Error> => {
    const observed = state.usage.calls + 1n;
    if (observed > state.maximumCalls) {
      return failValidator(state, pathError(operation, "budgetExceeded", {
        dimension: "calls",
        observed,
        maximum: state.maximumCalls,
      }));
    }
    state.usage.calls = observed;
    return Result.succeed(undefined);
  };

  const step: DeclarativeV2ArtifactModulePathFactoryV1["step"] = (
    validator,
    rawBytes,
    maximumTransitions,
  ) => {
    const stateResult = validatorState(validator, "step");
    if (Result.isFailure(stateResult)) {
      return Result.fail(stateResult.failure);
    }
    const state = stateResult.success;
    if (
      !isNonNegativeSafeInteger(maximumTransitions) ||
      maximumTransitions >
        DECLARATIVE_V2_ARTIFACT_MODULE_PATH_TRANSITION_QUANTUM_V1
    ) {
      return failValidator(state, pathError("step", "invalidInput"));
    }
    if (maximumTransitions === 0) {
      return Result.succeed(Object.freeze({
        consumedBytes: 0,
        transitionCount: 0,
        deltaUsage: zeroUsage(),
        usage: usageSnapshot(state.usage),
      }));
    }
    if (!isUint8Array(rawBytes)) {
      return failValidator(state, pathError("step", "invalidInput"));
    }
    const byteLength = intrinsicByteLength(rawBytes);
    if (byteLength === undefined) {
      return failValidator(state, pathError("step", "invalidInput"));
    }
    const before = usageSnapshot(state.usage);
    const callCharge = prechargeCall(state, "step");
    if (Result.isFailure(callCharge)) {
      return Result.fail(callCharge.failure);
    }
    let consumedBytes = 0;
    while (
      consumedBytes < byteLength &&
      consumedBytes < maximumTransitions
    ) {
      const nextStringBytes = state.usage.stringBytes + 1n;
      if (nextStringBytes > state.maximumStringBytes) {
        return failValidator(state, pathError("step", "budgetExceeded", {
          dimension: "stringBytes",
          observed: nextStringBytes,
          maximum: state.maximumStringBytes,
        }));
      }
      const nextOutputBytes = state.usage.outputBytes + 1n;
      if (nextOutputBytes > state.maximumOutputBytes) {
        return failValidator(state, pathError("step", "budgetExceeded", {
          dimension: "outputBytes",
          observed: nextOutputBytes,
          maximum: state.maximumOutputBytes,
        }));
      }
      const byte = rawBytes[consumedBytes]!;
      const isSeparator =
        state.remainingContinuationBytes === 0 && byte === 0x2f;
      if (state.remainingContinuationBytes > 0) {
        if (
          byte < state.nextContinuationMinimum ||
          byte > state.nextContinuationMaximum
        ) {
          return failValidator(state, pathError("step", "invalidPath"));
        }
        state.remainingContinuationBytes -= 1;
        state.nextContinuationMinimum = 0x80;
        state.nextContinuationMaximum = 0xbf;
      } else if (byte <= 0x7f) {
        if (byte === 0x5c) {
          return failValidator(state, pathError("step", "invalidPath"));
        }
        if (byte === 0x2f) {
          if (isCompletedSegmentInvalid(state)) {
            return failValidator(state, pathError("step", "invalidPath"));
          }
          state.segmentByteLength = 0;
          state.segmentFirstByte = 0;
          state.segmentSecondByte = 0;
        }
      } else if (byte >= 0xc2 && byte <= 0xdf) {
        state.remainingContinuationBytes = 1;
      } else if (byte === 0xe0) {
        state.remainingContinuationBytes = 2;
        state.nextContinuationMinimum = 0xa0;
        state.nextContinuationMaximum = 0xbf;
      } else if (
        byte >= 0xe1 && byte <= 0xec ||
        byte >= 0xee && byte <= 0xef
      ) {
        state.remainingContinuationBytes = 2;
      } else if (byte === 0xed) {
        state.remainingContinuationBytes = 2;
        state.nextContinuationMinimum = 0x80;
        state.nextContinuationMaximum = 0x9f;
      } else if (byte === 0xf0) {
        state.remainingContinuationBytes = 3;
        state.nextContinuationMinimum = 0x90;
        state.nextContinuationMaximum = 0xbf;
      } else if (byte >= 0xf1 && byte <= 0xf3) {
        state.remainingContinuationBytes = 3;
      } else if (byte === 0xf4) {
        state.remainingContinuationBytes = 3;
        state.nextContinuationMinimum = 0x80;
        state.nextContinuationMaximum = 0x8f;
      } else {
        return failValidator(state, pathError("step", "invalidPath"));
      }
      if (!isSeparator) {
        if (state.segmentByteLength === 0) state.segmentFirstByte = byte;
        else if (state.segmentByteLength === 1) state.segmentSecondByte = byte;
        state.segmentByteLength += 1;
      }
      state.bytes[state.byteLength] = byte;
      state.byteLength += 1;
      state.usage.stringBytes = nextStringBytes;
      state.usage.outputBytes = nextOutputBytes;
      state.usage.transitions += 1n;
      consumedBytes += 1;
    }
    return Result.succeed(Object.freeze({
      consumedBytes,
      transitionCount: consumedBytes,
      deltaUsage: differenceUsage(state.usage, before),
      usage: usageSnapshot(state.usage),
    }));
  };

  const finish: DeclarativeV2ArtifactModulePathFactoryV1["finish"] = (
    validator,
    maximumTransitions,
  ) => {
    const stateResult = validatorState(validator, "finish");
    if (Result.isFailure(stateResult)) {
      return Result.fail(stateResult.failure);
    }
    const state = stateResult.success;
    if (
      !isNonNegativeSafeInteger(maximumTransitions) ||
      maximumTransitions >
        DECLARATIVE_V2_ARTIFACT_MODULE_PATH_TRANSITION_QUANTUM_V1
    ) {
      return failValidator(state, pathError("finish", "invalidInput"));
    }
    if (maximumTransitions === 0) {
      return Result.succeed(Object.freeze({
        status: "pending",
        transitionCount: 0,
        deltaUsage: zeroUsage(),
        usage: usageSnapshot(state.usage),
      }));
    }
    const callCharge = prechargeCall(state, "finish");
    if (Result.isFailure(callCharge)) {
      return Result.fail(callCharge.failure);
    }
    state.usage.transitions += 1n;
    if (
      state.byteLength === 0 ||
      state.remainingContinuationBytes !== 0 ||
      isCompletedSegmentInvalid(state)
    ) {
      return failValidator(state, pathError("finish", "invalidPath"));
    }
    const handle = Object.freeze({
      _tag: "DeclarativeV2ArtifactModulePathHandleV1",
    } satisfies DeclarativeV2ArtifactModulePathHandleV1);
    handles.set(handle, {
      bytes: state.bytes,
      byteLength: state.byteLength,
      usage: usageSnapshot(state.usage),
      revoked: false,
    });
    state.phase = "complete";
    return Result.succeed(handle);
  };

  const capture: DeclarativeV2ArtifactModulePathFactoryV1["capture"] = (
    handle,
  ) => {
    if (!isOwnedHandle(handle)) {
      return Result.fail(pathError("read", "invalidInput"));
    }
    const state = handles.get(handle);
    return state === undefined
      ? Result.fail(pathError("read", "invalidInput"))
      : state.revoked
      ? Result.fail(pathError("read", "closed"))
      : Result.succeed(handle);
  };

  const byteLength: DeclarativeV2ArtifactModulePathFactoryV1["byteLength"] = (
    handle,
  ) => {
    const state = handleState(handle, "read");
    return Result.isFailure(state)
      ? Result.fail(state.failure)
      : Result.succeed(state.success.byteLength);
  };

  const byteAt: DeclarativeV2ArtifactModulePathFactoryV1["byteAt"] = (
    handle,
    offset,
  ) => {
    const state = handleState(handle, "read");
    if (Result.isFailure(state)) return Result.fail(state.failure);
    if (!isNonNegativeSafeInteger(offset)) {
      return Result.fail(pathError("read", "invalidInput"));
    }
    return Result.succeed(
      offset >= state.success.byteLength
        ? undefined
        : state.success.bytes[offset],
    );
  };

  const revoke: DeclarativeV2ArtifactModulePathFactoryV1["revoke"] = (
    handle,
  ) => {
    const state = handleState(handle, "revoke");
    if (Result.isFailure(state)) return Result.fail(state.failure);
    state.success.revoked = true;
    return Result.succeed(undefined);
  };

  const usage: DeclarativeV2ArtifactModulePathFactoryV1["usage"] = (handle) => {
    const state = handleState(handle, "read");
    return Result.isFailure(state)
      ? Result.fail(state.failure)
      : Result.succeed(state.success.usage);
  };

  return Object.freeze({
    create,
    step,
    finish,
    capture,
    byteLength,
    byteAt,
    usage,
    revoke,
  });
}

export const DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1 =
  makeDeclarativeV2ArtifactModulePathFactoryV1();
