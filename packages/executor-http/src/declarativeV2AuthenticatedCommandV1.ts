import {
  bytesEqualFullScan,
  isUint8Array,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { Data, Result } from "effect";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  decodeDeclarativeV2VerifierProgressFrameV2,
  encodeDeclarativeV2VerifierProgressFrameV2,
  type DeclarativeV2VerifierBudgetFrameV2,
  type DeclarativeV2VerifierCommandReservationFrameV2,
  type DeclarativeV2VerifierDurableCommandKindV2,
  type DeclarativeV2VerifierFrameBudgetV2,
  type DeclarativeV2VerifierProgressV2Error,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";

export const DECLARATIVE_V2_AUTHENTICATED_COMMAND_PROTOCOL_IDENTITY_V1 =
  "flarex.executor-http/declarative-v2-authenticated-command/v1" as const;
export const DECLARATIVE_V2_AUTHENTICATED_COMMAND_PROTOCOL_VERSION_V1 =
  1 as const;
export const DECLARATIVE_V2_AUTHENTICATED_COMMAND_MEDIA_TYPE_V1 =
  "application/vnd.flarex.declarative-v2-authenticated-command-v1" as const;
export const DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_FRAMES_V1 = 1_024;
export const DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_CHUNKS_V1 = 1_024;
export const DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_PAYLOAD_QUANTUM_BYTES_V1 =
  65_536;

const MAX_SIGNED_INT64 = 9_223_372_036_854_775_807n;
const U32_MAX = 0xffff_ffff;
const SHA256_BYTES = 32;
const UTF8_ENCODER = new TextEncoder();
const FATAL_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const DOMAIN_BYTES = UTF8_ENCODER.encode(
  DECLARATIVE_V2_AUTHENTICATED_COMMAND_PROTOCOL_IDENTITY_V1,
);
const COMMAND_RESERVATION_DOMAIN_BYTES = UTF8_ENCODER.encode(
  "flarex.declarative-v2/command_reservation/v2\0",
);
const COMMAND_BUDGET_DOMAIN_BYTES = UTF8_ENCODER.encode(
  "flarex.declarative-v2/command_budget/v2\0",
);
const COMMAND_RESERVATION_FIELD_COUNT = 12;
const COMMAND_BUDGET_FIELD_COUNT =
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.length;
const COMMAND_RESERVATION_BYTES_WITHOUT_PREDECESSOR =
  COMMAND_RESERVATION_DOMAIN_BYTES.byteLength + 4 + 32 + 32 + 1 + 8 + 32 + 1 +
  (6 * 32);
const COMMAND_RESERVATION_BYTES_WITH_PREDECESSOR =
  COMMAND_RESERVATION_BYTES_WITHOUT_PREDECESSOR + 32;
const COMMAND_BUDGET_BYTES =
  COMMAND_BUDGET_DOMAIN_BYTES.byteLength + 4 +
  (COMMAND_BUDGET_FIELD_COUNT * 8);
const REQUEST_PREFIX_BYTES = 4 + DOMAIN_BYTES.byteLength + 4 + 4;
const FRAME_LENGTH_PREFIX_BYTES = 4;
const CANONICAL_FRAME_PLAN_ALLOCATION_BYTES = 128;
const CANONICAL_FIXED_STATE_ALLOCATION_BYTES =
  COMMAND_BUDGET_FIELD_COUNT * 8;
const EMPTY_COMMAND_BYTES = new Uint8Array(0);

const UINT8_ARRAY_BYTE_LENGTH_GETTER =
  Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(Uint8Array.prototype),
    "byteLength",
  )?.get;

export interface DeclarativeV2AuthenticatedCommandTransportBudgetV1 {
  readonly maximumBodyBytes: number;
  readonly maximumCanonicalBytes: number;
  readonly maximumFrameBytes: number;
  readonly maximumPayloadBytes: number;
  readonly maximumFrames: number;
  readonly maximumTransitions: number;
}

export interface DeclarativeV2AuthenticatedCommandTransportUsageV1 {
  readonly bodyBytes: number;
  readonly canonicalBytes: number;
  readonly frameBytes: number;
  readonly payloadBytes: number;
  readonly frames: number;
  readonly transitions: number;
}

export interface DeclarativeV2AuthenticatedCommandHeaderFrameV1 {
  readonly kind: "command_header";
  readonly reservation: DeclarativeV2VerifierCommandReservationFrameV2;
  readonly commandBudget: DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "command_budget";
  };
}

export interface DeclarativeV2AuthenticatedCommandModuleMetadataFrameV1 {
  readonly kind: "module_metadata";
  readonly moduleOrdinal: bigint;
  readonly roles: number;
  readonly modulePathBytes: Uint8Array;
  readonly frameSha256: Uint8Array;
  readonly sourceSha256: Uint8Array;
  readonly sourceByteLength: bigint;
}

export interface DeclarativeV2AuthenticatedCommandSourceBytesFrameV1 {
  readonly kind: "source_bytes";
  readonly moduleOrdinal: bigint;
  readonly offset: bigint;
  readonly bytes: Uint8Array;
}

export interface DeclarativeV2AuthenticatedCommandSemanticBytesFrameV1 {
  readonly kind: "semantic_bytes";
  readonly offset: bigint;
  readonly bytes: Uint8Array;
}

export interface DeclarativeV2AuthenticatedCommandTerminalFrameV1 {
  readonly kind: "command_terminal";
  readonly firstModuleOrdinal: bigint;
  readonly moduleCount: bigint;
  readonly sourceByteLength: bigint;
  readonly semanticByteLength: bigint;
  readonly payloadFrameCount: bigint;
}

export type DeclarativeV2AuthenticatedCommandFrameV1 =
  | DeclarativeV2AuthenticatedCommandHeaderFrameV1
  | DeclarativeV2AuthenticatedCommandModuleMetadataFrameV1
  | DeclarativeV2AuthenticatedCommandSourceBytesFrameV1
  | DeclarativeV2AuthenticatedCommandSemanticBytesFrameV1
  | DeclarativeV2AuthenticatedCommandTerminalFrameV1;

export interface DeclarativeV2AuthenticatedCommandRequestV1 {
  readonly frames: readonly DeclarativeV2AuthenticatedCommandFrameV1[];
}

export interface DeclarativeV2AuthenticatedCommandEncodedRequestV1 {
  readonly request: DeclarativeV2AuthenticatedCommandRequestV1;
  readonly canonicalBytes: Uint8Array;
  readonly usage: DeclarativeV2AuthenticatedCommandTransportUsageV1;
}

export interface DeclarativeV2AuthenticatedCommandIncrementalBudgetV1
  extends DeclarativeV2AuthenticatedCommandTransportBudgetV1 {
  readonly maximumAllocationBytes: number;
  readonly maximumCopyBytes: number;
}

export interface DeclarativeV2AuthenticatedCommandIncrementalUsageV1
  extends DeclarativeV2AuthenticatedCommandTransportUsageV1 {
  readonly allocationBytes: number;
  readonly copyBytes: number;
}

export interface DeclarativeV2AuthenticatedCommandIncrementalReceiptV1 {
  readonly delta: DeclarativeV2AuthenticatedCommandIncrementalUsageV1;
  readonly aggregate: DeclarativeV2AuthenticatedCommandIncrementalUsageV1;
  readonly transitionCount: number;
}

export interface DeclarativeV2AuthenticatedCommandIncrementalDecoderV1 {
  readonly _tag: "DeclarativeV2AuthenticatedCommandIncrementalDecoderV1";
}

export interface DeclarativeV2AuthenticatedCommandDecodedCapabilityV1 {
  readonly _tag: "DeclarativeV2AuthenticatedCommandDecodedCapabilityV1";
}

export type DeclarativeV2AuthenticatedCommandIncrementalStepV1 = Readonly<{
  readonly status: "pending" | "ready";
  readonly consumedBytes: number;
  readonly receipt: DeclarativeV2AuthenticatedCommandIncrementalReceiptV1;
}>;

export type DeclarativeV2AuthenticatedCommandIncrementalFinishV1 =
  | Readonly<{
    readonly status: "pending";
    readonly receipt: DeclarativeV2AuthenticatedCommandIncrementalReceiptV1;
  }>
  | Readonly<{
    readonly status: "complete";
    readonly capability:
      DeclarativeV2AuthenticatedCommandDecodedCapabilityV1;
    readonly usage: DeclarativeV2AuthenticatedCommandTransportUsageV1;
    readonly receipt: DeclarativeV2AuthenticatedCommandIncrementalReceiptV1;
  }>;

export class DeclarativeV2AuthenticatedCommandIncrementalV1Error
  extends Data.TaggedError(
    "DeclarativeV2AuthenticatedCommandIncrementalV1Error",
  )<{
    readonly operation: "create" | "step" | "finish" | "close";
    readonly reason:
      | "invalidInput"
      | "invalidBudget"
      | "allocationBytesExceeded"
      | "copyBytesExceeded"
      | "bodyBytesExceeded"
      | "canonicalBytesExceeded"
      | "frameBytesExceeded"
      | "payloadBytesExceeded"
      | "framesExceeded"
      | "transitionsExceeded"
      | "malformed"
      | "invalidUtf8"
      | "nonCanonical"
      | "unsupportedVersion"
      | "invalidGrammar"
      | "staleAuthority"
      | "closed";
    readonly path?: string;
    readonly observed?: number;
    readonly maximum?: number;
    readonly protocolCause?: DeclarativeV2AuthenticatedCommandV1Error;
  }> {}

export interface DeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1 {
  readonly create: (input: unknown) => Result.Result<
    Readonly<{
      readonly decoder:
        DeclarativeV2AuthenticatedCommandIncrementalDecoderV1;
      readonly receipt:
        DeclarativeV2AuthenticatedCommandIncrementalReceiptV1;
    }>,
    DeclarativeV2AuthenticatedCommandIncrementalV1Error
  >;
  readonly step: (
    decoder: unknown,
    input: unknown,
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2AuthenticatedCommandIncrementalStepV1,
    DeclarativeV2AuthenticatedCommandIncrementalV1Error
  >;
  readonly finish: (
    decoder: unknown,
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2AuthenticatedCommandIncrementalFinishV1,
    DeclarativeV2AuthenticatedCommandIncrementalV1Error
  >;
  readonly close: (
    handle: unknown,
  ) => Result.Result<
    void,
    DeclarativeV2AuthenticatedCommandIncrementalV1Error
  >;
}

export class DeclarativeV2AuthenticatedCommandV1Error extends Data.TaggedError(
  "DeclarativeV2AuthenticatedCommandV1Error",
)<{
  readonly operation: "encode" | "decode";
  readonly reason:
    | "invalidInput"
    | "invalidBudget"
    | "bodyBytesExceeded"
    | "canonicalBytesExceeded"
    | "frameBytesExceeded"
    | "payloadBytesExceeded"
    | "framesExceeded"
    | "chunksExceeded"
    | "transitionsExceeded"
    | "malformed"
    | "invalidUtf8"
    | "nonCanonical"
    | "unsupportedVersion"
    | "invalidGrammar";
  readonly path?: string;
  readonly observed?: number;
  readonly maximum?: number;
}> {}

type Operation = DeclarativeV2AuthenticatedCommandV1Error["operation"];
type FrameKind = DeclarativeV2AuthenticatedCommandFrameV1["kind"];

interface CapturedHeaderFrameV1
  extends DeclarativeV2AuthenticatedCommandHeaderFrameV1 {
  readonly reservationBytes: Uint8Array;
  readonly commandBudgetBytes: Uint8Array;
}

type CapturedFrameV1 =
  | CapturedHeaderFrameV1
  | Exclude<
    DeclarativeV2AuthenticatedCommandFrameV1,
    DeclarativeV2AuthenticatedCommandHeaderFrameV1
  >;

type IncrementalMutableUsageV1 = {
  -readonly [K in keyof DeclarativeV2AuthenticatedCommandIncrementalUsageV1]:
    number;
};

interface IncrementalDecoderStateV1 {
  readonly budget: DeclarativeV2AuthenticatedCommandIncrementalBudgetV1;
  body: Uint8Array;
  canonical: Uint8Array;
  readonly usage: IncrementalMutableUsageV1;
  inputOffset: number;
  validationOffset: number;
  canonicalOffset: number;
  canonicalFrameIndex: number;
  readonly structural: IncrementalStructuralStateV1;
  phase: "input" | "validate" | "canonical" | "complete" | "failed";
  closed: boolean;
}

interface IncrementalCapabilityStateV1 {
  readonly decoder: object;
  canonical: Uint8Array;
  closed: boolean;
}

type IncrementalStructuralModeV1 =
  | "domainLength"
  | "domain"
  | "version"
  | "frameCount"
  | "frameLength"
  | "admitFrame"
  | "frameBody"
  | "admitPayload"
  | "finalizeFrame"
  | "done";

interface IncrementalUtf8StateV1 {
  remaining: number;
  nextMinimum: number;
  nextMaximum: number;
}

interface IncrementalCanonicalFrameBaseV1 {
  readonly frameStart: number;
  readonly frameLength: number;
}

type IncrementalCanonicalFramePlanV1 =
  | (IncrementalCanonicalFrameBaseV1 & {
    readonly kind: "command_header";
    readonly reservationHasPredecessor: boolean;
    readonly commandKind: DeclarativeV2VerifierDurableCommandKindV2;
    readonly sequence: bigint;
    readonly commandBudget: readonly bigint[];
  })
  | (IncrementalCanonicalFrameBaseV1 & {
    readonly kind: "module_metadata";
    readonly moduleOrdinal: bigint;
    readonly roles: number;
    readonly modulePathLength: number;
    readonly sourceByteLength: bigint;
  })
  | (IncrementalCanonicalFrameBaseV1 & {
    readonly kind: "source_bytes";
    readonly moduleOrdinal: bigint;
    readonly sourceOffset: bigint;
    readonly payloadLength: number;
  })
  | (IncrementalCanonicalFrameBaseV1 & {
    readonly kind: "semantic_bytes";
    readonly semanticOffset: bigint;
    readonly payloadLength: number;
  })
  | (IncrementalCanonicalFrameBaseV1 & {
    readonly kind: "command_terminal";
    readonly firstModuleOrdinal: bigint;
    readonly moduleCount: bigint;
    readonly sourceByteLength: bigint;
    readonly semanticByteLength: bigint;
    readonly payloadFrameCount: bigint;
  });

interface IncrementalStructuralStateV1 {
  mode: IncrementalStructuralModeV1;
  accumulator: number;
  accumulatorBytes: number;
  domainOffset: number;
  frameCount: number;
  frameIndex: number;
  frameLength: number;
  frameStart: number;
  frameOffset: number;
  frameTag: number;
  pendingPayloadBytes: number;
  pendingPayloadReturnMode: "frameBody" | "finalizeFrame";
  firstEmbeddedLength: number;
  secondEmbeddedLength: number;
  reservationHasPredecessor: boolean;
  reservationSequenceNonZero: boolean;
  reservationSequence: bigint;
  readonly commandBudgetValues: bigint[];
  modulePathLength: number;
  framePayloadLength: number;
  frameU64A: bigint;
  frameU64B: bigint;
  frameU64C: bigint;
  frameU64D: bigint;
  frameU64E: bigint;
  frameU32A: number;
  readonly utf8: IncrementalUtf8StateV1;
  commandKind: DeclarativeV2VerifierDurableCommandKindV2 | undefined;
  bodyFrameCount: number;
  firstModuleOrdinal: bigint | undefined;
  nextModuleOrdinal: bigint | undefined;
  parseModuleOrdinal: bigint | undefined;
  parseSourceLength: bigint | undefined;
  nextSourceOffset: bigint;
  nextSemanticOffset: bigint;
  readonly canonicalFrames: IncrementalCanonicalFramePlanV1[];
}

const FRAME_TAGS = Object.freeze({
  command_header: 1,
  module_metadata: 2,
  source_bytes: 3,
  semantic_bytes: 4,
  command_terminal: 5,
}) satisfies Readonly<Record<FrameKind, number>>;

const BUDGET_KEYS = [
  "maximumBodyBytes",
  "maximumCanonicalBytes",
  "maximumFrameBytes",
  "maximumPayloadBytes",
  "maximumFrames",
  "maximumTransitions",
] as const satisfies readonly (keyof DeclarativeV2AuthenticatedCommandTransportBudgetV1)[];

const RESERVATION_KEYS = [
  "kind",
  "attemptSha256",
  "candidateSha256",
  "commandKind",
  "sequence",
  "currentProgressSha256",
  "predecessorReceiptSha256",
  "commandBudgetSha256",
  "commandInputSha256",
  "freshAuthenticatedInputSha256",
  "analyzerIdentitySha256",
  "verifierIdentitySha256",
  "rangeAndPredecessorTailsSha256",
] as const;

const COMMAND_BUDGET_KEYS = [
  "kind",
  ...DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
] as const;

export function captureDeclarativeV2AuthenticatedCommandTransportBudgetV1(
  input: unknown,
): Result.Result<
  Readonly<DeclarativeV2AuthenticatedCommandTransportBudgetV1>,
  DeclarativeV2AuthenticatedCommandV1Error
> {
  const captured = captureOwnDataRecord(
    input,
    BUDGET_KEYS,
    "encode",
    "budget",
  );
  if (Result.isFailure(captured)) {
    return Result.fail(commandError("encode", "invalidBudget", "budget"));
  }
  const values = captured.success;
  for (const key of BUDGET_KEYS) {
    if (!isNonNegativeSafeInteger(values[key])) {
      return Result.fail(commandError("encode", "invalidBudget", key));
    }
  }
  if (
    (values.maximumBodyBytes as number) > U32_MAX ||
    (values.maximumCanonicalBytes as number) > U32_MAX ||
    (values.maximumFrameBytes as number) > U32_MAX ||
    (values.maximumPayloadBytes as number) > U32_MAX ||
    (values.maximumFrames as number) >
      DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_FRAMES_V1
  ) {
    return Result.fail(commandError("encode", "invalidBudget", "budget"));
  }
  return Result.succeed(Object.freeze({
    maximumBodyBytes: values.maximumBodyBytes as number,
    maximumCanonicalBytes: values.maximumCanonicalBytes as number,
    maximumFrameBytes: values.maximumFrameBytes as number,
    maximumPayloadBytes: values.maximumPayloadBytes as number,
    maximumFrames: values.maximumFrames as number,
    maximumTransitions: values.maximumTransitions as number,
  }));
}

export function encodeDeclarativeV2AuthenticatedCommandRequestV1(
  input: unknown,
  rawBudget: unknown,
): Result.Result<
  DeclarativeV2AuthenticatedCommandEncodedRequestV1,
  DeclarativeV2AuthenticatedCommandV1Error
> {
  return encodeRequest(input, rawBudget, "encode");
}

export function decodeDeclarativeV2AuthenticatedCommandRequestV1(
  input: unknown,
  rawBudget: unknown,
): Result.Result<
  DeclarativeV2AuthenticatedCommandEncodedRequestV1,
  DeclarativeV2AuthenticatedCommandV1Error
> {
  return decodeDeclarativeV2AuthenticatedCommandRequestChunksV1(
    [input],
    rawBudget,
  );
}

export function decodeDeclarativeV2AuthenticatedCommandRequestChunksV1(
  chunksInput: unknown,
  rawBudget: unknown,
): Result.Result<
  DeclarativeV2AuthenticatedCommandEncodedRequestV1,
  DeclarativeV2AuthenticatedCommandV1Error
> {
  return Result.gen(function* () {
    const budget = yield* captureBudget(rawBudget, "decode");
    const chunks = yield* captureChunkArray(chunksInput);
    let bodyBytes = 0;
    for (let index = 0; index < chunks.length; index += 1) {
      const length = intrinsicByteLength(chunks[index]!);
      if (length === undefined) {
        return yield* Result.fail(
          commandError("decode", "invalidInput", `chunks.${index}`),
        );
      }
      bodyBytes = yield* checkedAdd(
        bodyBytes,
        length,
        "decode",
        "bodyBytes",
      );
      yield* requireLimit(
        "decode",
        "bodyBytesExceeded",
        bodyBytes,
        budget.maximumBodyBytes,
        "bodyBytes",
      );
    }
    const owned = new Uint8Array(bodyBytes);
    let writeOffset = 0;
    try {
      for (const chunk of chunks) {
        owned.set(chunk, writeOffset);
        writeOffset += intrinsicByteLength(chunk)!;
      }
    } catch {
      return yield* Result.fail(
        commandError("decode", "invalidInput", "chunks"),
      );
    }
    const decoded = yield* parseOwnedRequest(owned, budget);
    const reencoded = yield* Result.mapError(
      encodeRequest(decoded, budget, "decode"),
      preserveDecodeLimitOrMalformed,
    );
    if (!bytesEqualFullScan(owned, reencoded.canonicalBytes)) {
      return yield* Result.fail(
        commandError("decode", "nonCanonical", "request"),
      );
    }
    return Object.freeze({
      request: reencoded.request,
      canonicalBytes: owned,
      usage: reencoded.usage,
    });
  });
}

export function makeDeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1():
  DeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1 {
  const decoders = new WeakMap<object, IncrementalDecoderStateV1>();
  const capabilities = new WeakMap<object, IncrementalCapabilityStateV1>();

  const create:
    DeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1["create"] =
      input => {
        const captured = captureIncrementalCreateInput(input);
        if (Result.isFailure(captured)) return Result.fail(captured.failure);
        const { bodyByteLength, budget } = captured.success;
        const usage = zeroIncrementalUsage();
        const admitted = chargeIncremental(
          usage,
          budget,
          "allocationBytes",
          (bodyByteLength * 2) + CANONICAL_FIXED_STATE_ALLOCATION_BYTES,
          "create",
        );
        if (Result.isFailure(admitted)) return Result.fail(admitted.failure);
        const transitioned = chargeIncremental(
          usage,
          budget,
          "transitions",
          1,
          "create",
        );
        if (Result.isFailure(transitioned)) {
          return Result.fail(transitioned.failure);
        }
        let body: Uint8Array;
        let canonical: Uint8Array;
        try {
          const storage = new ArrayBuffer(bodyByteLength * 2);
          body = new Uint8Array(storage, 0, bodyByteLength);
          canonical = new Uint8Array(
            storage,
            bodyByteLength,
            bodyByteLength,
          );
        } catch {
          return Result.fail(incrementalError(
            "create",
            "allocationBytesExceeded",
            "bodyByteLength",
            bodyByteLength,
            budget.maximumAllocationBytes,
          ));
        }
        const handle = Object.freeze({
          _tag: "DeclarativeV2AuthenticatedCommandIncrementalDecoderV1",
        }) as DeclarativeV2AuthenticatedCommandIncrementalDecoderV1;
        decoders.set(handle, {
          budget,
          body,
          canonical,
          usage,
          inputOffset: 0,
          validationOffset: 0,
          canonicalOffset: 0,
          canonicalFrameIndex: 0,
          structural: newIncrementalStructuralState(),
          phase: bodyByteLength === 0 ? "validate" : "input",
          closed: false,
        });
        return Result.succeed(Object.freeze({
          decoder: handle,
          receipt: incrementalReceipt(
            zeroIncrementalUsage(),
            usage,
            1,
          ),
        }));
      };

  const step:
    DeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1["step"] =
      (rawDecoder, rawInput, rawAllowance) => {
        const state = incrementalDecoderState(decoders, rawDecoder, "step");
        if (Result.isFailure(state)) return Result.fail(state.failure);
        const admittedAllowance = incrementalAllowance(rawAllowance, "step");
        if (Result.isFailure(admittedAllowance)) {
          failIncremental(state.success);
          return Result.fail(admittedAllowance.failure);
        }
        const before = snapshotIncrementalUsage(state.success.usage);
        if (admittedAllowance.success === 0) {
          return Result.succeed(Object.freeze({
            status: state.success.phase === "input" ? "pending" : "ready",
            consumedBytes: 0,
            receipt: incrementalReceipt(before, state.success.usage, 0),
          }));
        }
        if (!isUint8Array(rawInput)) {
          failIncremental(state.success);
          return Result.fail(incrementalError(
            "step",
            "invalidInput",
            "input",
          ));
        }
        const inputLength = intrinsicByteLength(rawInput);
        if (inputLength === undefined || inputLength === 0) {
          failIncremental(state.success);
          return Result.fail(incrementalError(
            "step",
            "invalidInput",
            "input",
          ));
        }
        if (state.success.phase !== "input") {
          failIncremental(state.success);
          return Result.fail(incrementalError(
            "step",
            "malformed",
            "trailing",
            inputLength,
            0,
          ));
        }
        const remaining = state.success.body.byteLength -
          state.success.inputOffset;
        if (inputLength > remaining) {
          failIncremental(state.success);
          return Result.fail(incrementalError(
            "step",
            "malformed",
            "trailing",
            inputLength,
            remaining,
          ));
        }
        let consumedBytes = 0;
        let transitions = 0;
        while (
          transitions < admittedAllowance.success &&
          consumedBytes < inputLength &&
          state.success.inputOffset < state.success.body.byteLength
        ) {
          const copied = chargeIncremental(
            state.success.usage,
            state.success.budget,
            "copyBytes",
            1,
            "step",
          );
          if (Result.isFailure(copied)) {
            failIncremental(state.success);
            return Result.fail(copied.failure);
          }
          const body = chargeIncremental(
            state.success.usage,
            state.success.budget,
            "bodyBytes",
            1,
            "step",
          );
          if (Result.isFailure(body)) {
            failIncremental(state.success);
            return Result.fail(body.failure);
          }
          const transition = chargeIncremental(
            state.success.usage,
            state.success.budget,
            "transitions",
            1,
            "step",
          );
          if (Result.isFailure(transition)) {
            failIncremental(state.success);
            return Result.fail(transition.failure);
          }
          const byte = rawInput[consumedBytes];
          if (byte === undefined) {
            failIncremental(state.success);
            return Result.fail(incrementalError(
              "step",
              "invalidInput",
              "input",
            ));
          }
          state.success.body[state.success.inputOffset] = byte;
          state.success.inputOffset += 1;
          consumedBytes += 1;
          transitions += 1;
        }
        if (state.success.inputOffset === state.success.body.byteLength) {
          state.success.phase = "validate";
        }
        return Result.succeed(Object.freeze({
          status: state.success.phase === "input" ? "pending" : "ready",
          consumedBytes,
          receipt: incrementalReceipt(
            before,
            state.success.usage,
            transitions,
          ),
        }));
      };

  const finish:
    DeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1["finish"] =
      (rawDecoder, rawAllowance) => {
        const stateResult = incrementalDecoderState(
          decoders,
          rawDecoder,
          "finish",
        );
        if (Result.isFailure(stateResult)) {
          return Result.fail(stateResult.failure);
        }
        const state = stateResult.success;
        const admittedAllowance = incrementalAllowance(rawAllowance, "finish");
        if (Result.isFailure(admittedAllowance)) {
          failIncremental(state);
          return Result.fail(admittedAllowance.failure);
        }
        const before = snapshotIncrementalUsage(state.usage);
        if (admittedAllowance.success === 0) {
          return Result.succeed(Object.freeze({
            status: "pending",
            receipt: incrementalReceipt(before, state.usage, 0),
          }));
        }
        let transitions = 0;
        while (
          transitions < admittedAllowance.success &&
          state.phase !== "complete" &&
          state.phase !== "failed"
        ) {
          if (state.phase === "input") {
            failIncremental(state);
            return Result.fail(incrementalError(
              "finish",
              "malformed",
              "bodyByteLength",
              state.inputOffset,
              state.body.byteLength,
            ));
          }
          const transitioned = chargeIncremental(
            state.usage,
            state.budget,
            "transitions",
            1,
            "finish",
          );
          if (Result.isFailure(transitioned)) {
            failIncremental(state);
            return Result.fail(transitioned.failure);
          }
          transitions += 1;
          if (state.phase === "validate") {
            const advanced = advanceIncrementalStructure(state);
            if (Result.isFailure(advanced)) {
              failIncremental(state);
              return Result.fail(advanced.failure);
            }
            if (state.structural.mode === "done") {
              state.phase = "canonical";
            }
            continue;
          }
          if (state.phase === "canonical") {
            if (state.canonicalOffset >= state.body.byteLength) {
              failIncremental(state);
              return Result.fail(incrementalError(
                "finish",
                "malformed",
                "canonicalBytes",
              ));
            }
            const canonical = chargeIncremental(
              state.usage,
              state.budget,
              "canonicalBytes",
              1,
              "finish",
            );
            if (Result.isFailure(canonical)) {
              failIncremental(state);
              return Result.fail(canonical.failure);
            }
            const copied = chargeIncremental(
              state.usage,
              state.budget,
              "copyBytes",
              1,
              "finish",
            );
            if (Result.isFailure(copied)) {
              failIncremental(state);
              return Result.fail(copied.failure);
            }
            const expected = expectedIncrementalCanonicalByte(state);
            if (Result.isFailure(expected)) {
              failIncremental(state);
              return Result.fail(expected.failure);
            }
            if (expected.success !== state.body[state.canonicalOffset]) {
              failIncremental(state);
              return Result.fail(incrementalError(
                "finish",
                "nonCanonical",
                "canonicalBytes",
              ));
            }
            state.canonical[state.canonicalOffset] = expected.success;
            state.canonicalOffset += 1;
            if (state.canonicalOffset === state.body.byteLength) {
              state.phase = "complete";
            }
          }
        }
        if (state.phase !== "complete") {
          return Result.succeed(Object.freeze({
            status: "pending",
            receipt: incrementalReceipt(before, state.usage, transitions),
          }));
        }
        const capability = Object.freeze({
          _tag: "DeclarativeV2AuthenticatedCommandDecodedCapabilityV1",
        }) as DeclarativeV2AuthenticatedCommandDecodedCapabilityV1;
        capabilities.set(capability, {
          decoder: rawDecoder as object,
          canonical: state.canonical,
          closed: false,
        });
        state.closed = true;
        const transportUsage = Object.freeze({
          bodyBytes: state.body.byteLength,
          canonicalBytes: state.canonical.byteLength,
          frameBytes: state.usage.frameBytes,
          payloadBytes: state.usage.payloadBytes,
          frames: state.usage.frames,
          transitions: state.body.byteLength + state.usage.frames,
        });
        return Result.succeed(Object.freeze({
          status: "complete",
          capability,
          usage: transportUsage,
          receipt: incrementalReceipt(before, state.usage, transitions),
        }));
      };

  const close:
    DeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1["close"] =
      rawHandle => {
        if (rawHandle === null || typeof rawHandle !== "object") {
          return Result.fail(incrementalError(
            "close",
            "staleAuthority",
          ));
        }
        const decoder = decoders.get(rawHandle);
        if (decoder !== undefined) {
          if (decoder.closed) {
            return Result.fail(incrementalError("close", "closed"));
          }
          failIncremental(decoder);
          return Result.succeed(undefined);
        }
        const capability = capabilities.get(rawHandle);
        if (capability === undefined) {
          return Result.fail(incrementalError(
            "close",
            "staleAuthority",
          ));
        }
        if (capability.closed) {
          return Result.fail(incrementalError("close", "closed"));
        }
        capability.closed = true;
        capability.canonical = EMPTY_COMMAND_BYTES;
        const owner = decoders.get(capability.decoder);
        if (owner !== undefined) {
          owner.body = EMPTY_COMMAND_BYTES;
          owner.canonical = EMPTY_COMMAND_BYTES;
        }
        return Result.succeed(undefined);
      };

  return Object.freeze({ create, step, finish, close });
}

const INCREMENTAL_BUDGET_KEYS = [
  ...BUDGET_KEYS,
  "maximumAllocationBytes",
  "maximumCopyBytes",
] as const satisfies readonly (
  keyof DeclarativeV2AuthenticatedCommandIncrementalBudgetV1
)[];

function captureIncrementalCreateInput(
  input: unknown,
): Result.Result<
  Readonly<{
    readonly bodyByteLength: number;
    readonly budget: DeclarativeV2AuthenticatedCommandIncrementalBudgetV1;
  }>,
  DeclarativeV2AuthenticatedCommandIncrementalV1Error
> {
  const record = captureOwnDataRecord(
    input,
    ["bodyByteLength", "budget"] as const,
    "decode",
    "create",
  );
  if (Result.isFailure(record)) {
    return Result.fail(incrementalError("create", "invalidInput", "create"));
  }
  const budgetRecord = captureOwnDataRecord(
    record.success.budget,
    INCREMENTAL_BUDGET_KEYS,
    "decode",
    "budget",
  );
  if (Result.isFailure(budgetRecord)) {
    return Result.fail(incrementalError(
      "create",
      "invalidBudget",
      "budget",
    ));
  }
  if (!isNonNegativeSafeInteger(record.success.bodyByteLength)) {
    return Result.fail(incrementalError(
      "create",
      "invalidInput",
      "bodyByteLength",
    ));
  }
  for (const key of INCREMENTAL_BUDGET_KEYS) {
    if (!isNonNegativeSafeInteger(budgetRecord.success[key])) {
      return Result.fail(incrementalError(
        "create",
        "invalidBudget",
        `budget.${key}`,
      ));
    }
  }
  if (
    (budgetRecord.success.maximumBodyBytes as number) > U32_MAX ||
    (budgetRecord.success.maximumCanonicalBytes as number) > U32_MAX ||
    (budgetRecord.success.maximumFrameBytes as number) > U32_MAX ||
    (budgetRecord.success.maximumPayloadBytes as number) > U32_MAX ||
    (budgetRecord.success.maximumFrames as number) >
      DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_FRAMES_V1
  ) {
    return Result.fail(incrementalError(
      "create",
      "invalidBudget",
      "budget",
    ));
  }
  const budget = Object.freeze({
    maximumBodyBytes: budgetRecord.success.maximumBodyBytes as number,
    maximumCanonicalBytes:
      budgetRecord.success.maximumCanonicalBytes as number,
    maximumFrameBytes: budgetRecord.success.maximumFrameBytes as number,
    maximumPayloadBytes: budgetRecord.success.maximumPayloadBytes as number,
    maximumFrames: budgetRecord.success.maximumFrames as number,
    maximumTransitions: budgetRecord.success.maximumTransitions as number,
    maximumAllocationBytes:
      budgetRecord.success.maximumAllocationBytes as number,
    maximumCopyBytes: budgetRecord.success.maximumCopyBytes as number,
  });
  const bodyByteLength = record.success.bodyByteLength as number;
  if (bodyByteLength > U32_MAX) {
    return Result.fail(incrementalError(
      "create",
      "invalidInput",
      "bodyByteLength",
      bodyByteLength,
      U32_MAX,
    ));
  }
  if (bodyByteLength > budget.maximumBodyBytes) {
    return Result.fail(incrementalError(
      "create",
      "bodyBytesExceeded",
      "bodyByteLength",
      bodyByteLength,
      budget.maximumBodyBytes,
    ));
  }
  if (bodyByteLength > budget.maximumCanonicalBytes) {
    return Result.fail(incrementalError(
      "create",
      "canonicalBytesExceeded",
      "bodyByteLength",
      bodyByteLength,
      budget.maximumCanonicalBytes,
    ));
  }
  return Result.succeed(Object.freeze({ bodyByteLength, budget }));
}

function zeroIncrementalUsage():
  IncrementalMutableUsageV1 {
  return {
    bodyBytes: 0,
    canonicalBytes: 0,
    frameBytes: 0,
    payloadBytes: 0,
    frames: 0,
    transitions: 0,
    allocationBytes: 0,
    copyBytes: 0,
  };
}

function snapshotIncrementalUsage(
  usage: Readonly<IncrementalMutableUsageV1>,
): IncrementalMutableUsageV1 {
  return { ...usage };
}

function freezeIncrementalUsage(
  usage: Readonly<IncrementalMutableUsageV1>,
): DeclarativeV2AuthenticatedCommandIncrementalUsageV1 {
  return Object.freeze({ ...usage });
}

function incrementalReceipt(
  before: Readonly<IncrementalMutableUsageV1>,
  after: Readonly<IncrementalMutableUsageV1>,
  transitionCount: number,
): DeclarativeV2AuthenticatedCommandIncrementalReceiptV1 {
  const delta = zeroIncrementalUsage();
  for (
    const key of Object.keys(delta) as readonly (
      keyof IncrementalMutableUsageV1
    )[]
  ) {
    delta[key] = after[key] - before[key];
  }
  return Object.freeze({
    delta: freezeIncrementalUsage(delta),
    aggregate: freezeIncrementalUsage(after),
    transitionCount,
  });
}

function incrementalError(
  operation: DeclarativeV2AuthenticatedCommandIncrementalV1Error["operation"],
  reason: DeclarativeV2AuthenticatedCommandIncrementalV1Error["reason"],
  path?: string,
  observed?: number,
  maximum?: number,
  protocolCause?: DeclarativeV2AuthenticatedCommandV1Error,
): DeclarativeV2AuthenticatedCommandIncrementalV1Error {
  return new DeclarativeV2AuthenticatedCommandIncrementalV1Error({
    operation,
    reason,
    ...(path === undefined ? {} : { path }),
    ...(observed === undefined ? {} : { observed }),
    ...(maximum === undefined ? {} : { maximum }),
    ...(protocolCause === undefined ? {} : { protocolCause }),
  });
}

function incrementalAllowance(
  input: unknown,
  operation: "step" | "finish",
): Result.Result<
  number,
  DeclarativeV2AuthenticatedCommandIncrementalV1Error
> {
  return isNonNegativeSafeInteger(input) && input <= 1_024
    ? Result.succeed(input)
    : Result.fail(incrementalError(
      operation,
      "invalidInput",
      "allowance",
      typeof input === "number" ? input : undefined,
      1_024,
    ));
}

function incrementalDecoderState(
  decoders: WeakMap<object, IncrementalDecoderStateV1>,
  input: unknown,
  operation: "step" | "finish",
): Result.Result<
  IncrementalDecoderStateV1,
  DeclarativeV2AuthenticatedCommandIncrementalV1Error
> {
  const state = input !== null && typeof input === "object"
    ? decoders.get(input)
    : undefined;
  return state === undefined
    ? Result.fail(incrementalError(operation, "staleAuthority"))
    : state.closed
    ? Result.fail(incrementalError(operation, "closed"))
    : Result.succeed(state);
}

function failIncremental(state: IncrementalDecoderStateV1): void {
  state.phase = "failed";
  state.closed = true;
  state.body = EMPTY_COMMAND_BYTES;
  state.canonical = EMPTY_COMMAND_BYTES;
}

function incrementalMaximum(
  budget: Readonly<DeclarativeV2AuthenticatedCommandIncrementalBudgetV1>,
  dimension: keyof IncrementalMutableUsageV1,
): number {
  switch (dimension) {
    case "bodyBytes":
      return budget.maximumBodyBytes;
    case "canonicalBytes":
      return budget.maximumCanonicalBytes;
    case "frameBytes":
      return budget.maximumFrameBytes;
    case "payloadBytes":
      return budget.maximumPayloadBytes;
    case "frames":
      return Math.min(
        budget.maximumFrames,
        DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_FRAMES_V1,
      );
    case "transitions":
      return budget.maximumTransitions;
    case "allocationBytes":
      return budget.maximumAllocationBytes;
    case "copyBytes":
      return budget.maximumCopyBytes;
  }
}

function incrementalExceededReason(
  dimension: keyof IncrementalMutableUsageV1,
): DeclarativeV2AuthenticatedCommandIncrementalV1Error["reason"] {
  switch (dimension) {
    case "bodyBytes":
      return "bodyBytesExceeded";
    case "canonicalBytes":
      return "canonicalBytesExceeded";
    case "frameBytes":
      return "frameBytesExceeded";
    case "payloadBytes":
      return "payloadBytesExceeded";
    case "frames":
      return "framesExceeded";
    case "transitions":
      return "transitionsExceeded";
    case "allocationBytes":
      return "allocationBytesExceeded";
    case "copyBytes":
      return "copyBytesExceeded";
  }
}

function chargeIncremental(
  usage: IncrementalMutableUsageV1,
  budget: Readonly<DeclarativeV2AuthenticatedCommandIncrementalBudgetV1>,
  dimension: keyof IncrementalMutableUsageV1,
  amount: number,
  operation: DeclarativeV2AuthenticatedCommandIncrementalV1Error["operation"],
): Result.Result<
  void,
  DeclarativeV2AuthenticatedCommandIncrementalV1Error
> {
  const observed = usage[dimension] + amount;
  const maximum = incrementalMaximum(budget, dimension);
  if (!Number.isSafeInteger(observed) || observed > maximum) {
    return Result.fail(incrementalError(
      operation,
      incrementalExceededReason(dimension),
      dimension,
      observed,
      maximum,
    ));
  }
  usage[dimension] = observed;
  return Result.succeed(undefined);
}

function expectedIncrementalCanonicalByte(
  state: IncrementalDecoderStateV1,
): Result.Result<
  number,
  DeclarativeV2AuthenticatedCommandIncrementalV1Error
> {
  const offset = state.canonicalOffset;
  if (offset < 4) {
    return Result.succeed(u32CanonicalByte(DOMAIN_BYTES.byteLength, offset));
  }
  const domainStart = 4;
  const versionStart = domainStart + DOMAIN_BYTES.byteLength;
  if (offset < versionStart) {
    return canonicalOpaqueByte(DOMAIN_BYTES, offset - domainStart);
  }
  if (offset < versionStart + 4) {
    return Result.succeed(u32CanonicalByte(
      DECLARATIVE_V2_AUTHENTICATED_COMMAND_PROTOCOL_VERSION_V1,
      offset - versionStart,
    ));
  }
  const frameCountStart = versionStart + 4;
  if (offset < frameCountStart + 4) {
    return Result.succeed(u32CanonicalByte(
      state.structural.frameCount,
      offset - frameCountStart,
    ));
  }

  let plan = state.structural.canonicalFrames[state.canonicalFrameIndex];
  if (
    plan !== undefined &&
    offset === plan.frameStart + plan.frameLength
  ) {
    state.canonicalFrameIndex += 1;
    plan = state.structural.canonicalFrames[state.canonicalFrameIndex];
  }
  if (plan === undefined) {
    return Result.fail(incrementalError(
      "finish",
      "malformed",
      "canonicalPlan",
    ));
  }
  const lengthStart = plan.frameStart - FRAME_LENGTH_PREFIX_BYTES;
  if (offset >= lengthStart && offset < plan.frameStart) {
    return Result.succeed(u32CanonicalByte(
      plan.frameLength,
      offset - lengthStart,
    ));
  }
  const localOffset = offset - plan.frameStart;
  if (localOffset < 0 || localOffset >= plan.frameLength) {
    return Result.fail(incrementalError(
      "finish",
      "malformed",
      `frames.${state.canonicalFrameIndex}`,
    ));
  }
  return expectedIncrementalCanonicalFrameByte(
    state.body,
    plan,
    localOffset,
  );
}

function expectedIncrementalCanonicalFrameByte(
  body: Uint8Array,
  plan: IncrementalCanonicalFramePlanV1,
  localOffset: number,
): Result.Result<
  number,
  DeclarativeV2AuthenticatedCommandIncrementalV1Error
> {
  if (localOffset === 0) {
    return Result.succeed(FRAME_TAGS[plan.kind]);
  }
  if (plan.kind === "command_header") {
    return expectedIncrementalCanonicalHeaderByte(body, plan, localOffset);
  }
  if (plan.kind === "module_metadata") {
    if (localOffset <= 8) {
      return Result.succeed(u64CanonicalByte(
        plan.moduleOrdinal,
        localOffset - 1,
      ));
    }
    if (localOffset <= 12) {
      return Result.succeed(u32CanonicalByte(plan.roles, localOffset - 9));
    }
    if (localOffset <= 16) {
      return Result.succeed(u32CanonicalByte(
        plan.modulePathLength,
        localOffset - 13,
      ));
    }
    const pathEnd = 17 + plan.modulePathLength;
    if (localOffset < pathEnd + (2 * SHA256_BYTES)) {
      return canonicalOpaqueByte(body, plan.frameStart + localOffset);
    }
    return Result.succeed(u64CanonicalByte(
      plan.sourceByteLength,
      localOffset - pathEnd - (2 * SHA256_BYTES),
    ));
  }
  if (plan.kind === "source_bytes") {
    if (localOffset <= 8) {
      return Result.succeed(u64CanonicalByte(
        plan.moduleOrdinal,
        localOffset - 1,
      ));
    }
    if (localOffset <= 16) {
      return Result.succeed(u64CanonicalByte(
        plan.sourceOffset,
        localOffset - 9,
      ));
    }
    if (localOffset <= 20) {
      return Result.succeed(u32CanonicalByte(
        plan.payloadLength,
        localOffset - 17,
      ));
    }
    return canonicalOpaqueByte(body, plan.frameStart + localOffset);
  }
  if (plan.kind === "semantic_bytes") {
    if (localOffset <= 8) {
      return Result.succeed(u64CanonicalByte(
        plan.semanticOffset,
        localOffset - 1,
      ));
    }
    if (localOffset <= 12) {
      return Result.succeed(u32CanonicalByte(
        plan.payloadLength,
        localOffset - 9,
      ));
    }
    return canonicalOpaqueByte(body, plan.frameStart + localOffset);
  }
  const terminalValues = [
    plan.firstModuleOrdinal,
    plan.moduleCount,
    plan.sourceByteLength,
    plan.semanticByteLength,
    plan.payloadFrameCount,
  ] as const;
  const valueIndex = Math.floor((localOffset - 1) / 8);
  const value = terminalValues[valueIndex];
  return value === undefined
    ? Result.fail(incrementalError(
      "finish",
      "malformed",
      "command_terminal",
    ))
    : Result.succeed(u64CanonicalByte(value, (localOffset - 1) % 8));
}

function expectedIncrementalCanonicalHeaderByte(
  body: Uint8Array,
  plan: Extract<
    IncrementalCanonicalFramePlanV1,
    { readonly kind: "command_header" }
  >,
  localOffset: number,
): Result.Result<
  number,
  DeclarativeV2AuthenticatedCommandIncrementalV1Error
> {
  const reservationLength = plan.reservationHasPredecessor
    ? COMMAND_RESERVATION_BYTES_WITH_PREDECESSOR
    : COMMAND_RESERVATION_BYTES_WITHOUT_PREDECESSOR;
  if (localOffset <= 4) {
    return Result.succeed(u32CanonicalByte(
      reservationLength,
      localOffset - 1,
    ));
  }
  const reservationStart = 5;
  const reservationOffset = localOffset - reservationStart;
  if (reservationOffset >= 0 && reservationOffset < reservationLength) {
    const domainLength = COMMAND_RESERVATION_DOMAIN_BYTES.byteLength;
    if (reservationOffset < domainLength) {
      return canonicalOpaqueByte(
        COMMAND_RESERVATION_DOMAIN_BYTES,
        reservationOffset,
      );
    }
    if (reservationOffset < domainLength + 4) {
      return Result.succeed(u32CanonicalByte(
        COMMAND_RESERVATION_FIELD_COUNT,
        reservationOffset - domainLength,
      ));
    }
    const attemptStart = domainLength + 4;
    const commandTagOffset = attemptStart + (2 * SHA256_BYTES);
    if (reservationOffset < commandTagOffset) {
      return canonicalOpaqueByte(
        body,
        plan.frameStart + reservationStart + reservationOffset,
      );
    }
    if (reservationOffset === commandTagOffset) {
      return Result.succeed(durableCommandKindIncrementalTag(
        plan.commandKind,
      ));
    }
    const sequenceStart = commandTagOffset + 1;
    if (reservationOffset < sequenceStart + 8) {
      return Result.succeed(u64CanonicalByte(
        plan.sequence,
        reservationOffset - sequenceStart,
      ));
    }
    const currentProgressStart = sequenceStart + 8;
    const predecessorTagOffset = currentProgressStart + SHA256_BYTES;
    if (reservationOffset < predecessorTagOffset) {
      return canonicalOpaqueByte(
        body,
        plan.frameStart + reservationStart + reservationOffset,
      );
    }
    if (reservationOffset === predecessorTagOffset) {
      return Result.succeed(plan.reservationHasPredecessor ? 1 : 0);
    }
    return canonicalOpaqueByte(
      body,
      plan.frameStart + reservationStart + reservationOffset,
    );
  }

  const budgetLengthStart = reservationStart + reservationLength;
  if (localOffset < budgetLengthStart + 4) {
    return Result.succeed(u32CanonicalByte(
      COMMAND_BUDGET_BYTES,
      localOffset - budgetLengthStart,
    ));
  }
  const budgetStart = budgetLengthStart + 4;
  const budgetOffset = localOffset - budgetStart;
  const budgetDomainLength = COMMAND_BUDGET_DOMAIN_BYTES.byteLength;
  if (budgetOffset < budgetDomainLength) {
    return canonicalOpaqueByte(COMMAND_BUDGET_DOMAIN_BYTES, budgetOffset);
  }
  if (budgetOffset < budgetDomainLength + 4) {
    return Result.succeed(u32CanonicalByte(
      COMMAND_BUDGET_FIELD_COUNT,
      budgetOffset - budgetDomainLength,
    ));
  }
  const valueOffset = budgetOffset - budgetDomainLength - 4;
  const dimensionIndex = Math.floor(valueOffset / 8);
  const value = plan.commandBudget[dimensionIndex];
  return value === undefined
    ? Result.fail(incrementalError(
      "finish",
      "malformed",
      "command_header.commandBudget",
    ))
    : Result.succeed(u64CanonicalByte(value, valueOffset % 8));
}

function canonicalOpaqueByte(
  bytes: Uint8Array,
  offset: number,
): Result.Result<
  number,
  DeclarativeV2AuthenticatedCommandIncrementalV1Error
> {
  const byte = bytes[offset];
  return byte === undefined
    ? Result.fail(incrementalError(
      "finish",
      "malformed",
      "canonicalBytes",
    ))
    : Result.succeed(byte);
}

function u32CanonicalByte(value: number, byteOffset: number): number {
  return (value >>> ((3 - byteOffset) * 8)) & 0xff;
}

function u64CanonicalByte(value: bigint, byteOffset: number): number {
  return Number((value >> BigInt((7 - byteOffset) * 8)) & 0xffn);
}

function newIncrementalStructuralState(): IncrementalStructuralStateV1 {
  return {
    mode: "domainLength",
    accumulator: 0,
    accumulatorBytes: 0,
    domainOffset: 0,
    frameCount: 0,
    frameIndex: 0,
    frameLength: 0,
    frameStart: 0,
    frameOffset: 0,
    frameTag: 0,
    pendingPayloadBytes: 0,
    pendingPayloadReturnMode: "frameBody",
    firstEmbeddedLength: 0,
    secondEmbeddedLength: 0,
    reservationHasPredecessor: false,
    reservationSequenceNonZero: false,
    reservationSequence: 0n,
    commandBudgetValues: new Array<bigint>(
      COMMAND_BUDGET_FIELD_COUNT,
    ).fill(0n),
    modulePathLength: 0,
    framePayloadLength: 0,
    frameU64A: 0n,
    frameU64B: 0n,
    frameU64C: 0n,
    frameU64D: 0n,
    frameU64E: 0n,
    frameU32A: 0,
    utf8: {
      remaining: 0,
      nextMinimum: 0x80,
      nextMaximum: 0xbf,
    },
    commandKind: undefined,
    bodyFrameCount: 0,
    firstModuleOrdinal: undefined,
    nextModuleOrdinal: undefined,
    parseModuleOrdinal: undefined,
    parseSourceLength: undefined,
    nextSourceOffset: 0n,
    nextSemanticOffset: 0n,
    canonicalFrames: [],
  };
}

function advanceIncrementalStructure(
  state: IncrementalDecoderStateV1,
): Result.Result<void, DeclarativeV2AuthenticatedCommandIncrementalV1Error> {
  const structural = state.structural;
  switch (structural.mode) {
    case "domainLength":
    case "version":
    case "frameCount":
    case "frameLength":
      return advanceIncrementalU32(state);
    case "domain":
      return advanceIncrementalDomain(state);
    case "admitFrame":
      return admitIncrementalFrame(state);
    case "frameBody":
      return advanceIncrementalFrameBody(state);
    case "admitPayload":
      return admitIncrementalPayload(state);
    case "finalizeFrame":
      return finalizeIncrementalFrame(state);
    case "done":
      return Result.succeed(undefined);
  }
}

function advanceIncrementalU32(
  state: IncrementalDecoderStateV1,
): Result.Result<void, DeclarativeV2AuthenticatedCommandIncrementalV1Error> {
  const structural = state.structural;
  const byte = state.body[state.validationOffset];
  if (byte === undefined) {
    return Result.fail(incrementalError("finish", "malformed", structural.mode));
  }
  structural.accumulator = (structural.accumulator * 256) + byte;
  structural.accumulatorBytes += 1;
  state.validationOffset += 1;
  if (structural.accumulatorBytes < 4) return Result.succeed(undefined);
  const value = structural.accumulator;
  structural.accumulator = 0;
  structural.accumulatorBytes = 0;
  switch (structural.mode) {
    case "domainLength":
      if (value !== DOMAIN_BYTES.byteLength) {
        return Result.fail(incrementalError(
          "finish",
          "unsupportedVersion",
          "protocolIdentity",
        ));
      }
      structural.mode = "domain";
      return Result.succeed(undefined);
    case "version":
      if (
        value !== DECLARATIVE_V2_AUTHENTICATED_COMMAND_PROTOCOL_VERSION_V1
      ) {
        return Result.fail(incrementalError(
          "finish",
          "unsupportedVersion",
          "protocolVersion",
        ));
      }
      structural.mode = "frameCount";
      return Result.succeed(undefined);
    case "frameCount": {
      const maximum = Math.min(
        state.budget.maximumFrames,
        DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_FRAMES_V1,
      );
      if (value < 2 || value > maximum) {
        return Result.fail(incrementalError(
          "finish",
          value > maximum ? "framesExceeded" : "malformed",
          "frameCount",
          value,
          maximum,
        ));
      }
      structural.frameCount = value;
      structural.mode = "frameLength";
      return Result.succeed(undefined);
    }
    case "frameLength":
      if (
        value === 0 ||
        state.validationOffset + value > state.body.byteLength
      ) {
        return Result.fail(incrementalError(
          "finish",
          "malformed",
          `frames.${structural.frameIndex}`,
        ));
      }
      if (value > state.budget.maximumFrameBytes) {
        return Result.fail(incrementalError(
          "finish",
          "frameBytesExceeded",
          `frames.${structural.frameIndex}`,
          value,
          state.budget.maximumFrameBytes,
        ));
      }
      structural.frameLength = value;
      structural.frameStart = state.validationOffset;
      structural.frameOffset = 0;
      structural.frameTag = 0;
      structural.firstEmbeddedLength = 0;
      structural.secondEmbeddedLength = 0;
      structural.reservationHasPredecessor = false;
      structural.reservationSequenceNonZero = false;
      structural.reservationSequence = 0n;
      structural.modulePathLength = 0;
      structural.framePayloadLength = 0;
      structural.frameU64A = 0n;
      structural.frameU64B = 0n;
      structural.frameU64C = 0n;
      structural.frameU64D = 0n;
      structural.frameU64E = 0n;
      structural.frameU32A = 0;
      resetIncrementalUtf8(structural.utf8);
      structural.mode = "admitFrame";
      return Result.succeed(undefined);
    default:
      return Result.fail(incrementalError(
        "finish",
        "malformed",
        "structuralState",
      ));
  }
}

function advanceIncrementalDomain(
  state: IncrementalDecoderStateV1,
): Result.Result<void, DeclarativeV2AuthenticatedCommandIncrementalV1Error> {
  const structural = state.structural;
  const byte = state.body[state.validationOffset];
  if (byte === undefined || byte !== DOMAIN_BYTES[structural.domainOffset]) {
    return Result.fail(incrementalError(
      "finish",
      "unsupportedVersion",
      "protocolIdentity",
    ));
  }
  structural.domainOffset += 1;
  state.validationOffset += 1;
  if (structural.domainOffset === DOMAIN_BYTES.byteLength) {
    structural.mode = "version";
  }
  return Result.succeed(undefined);
}

function admitIncrementalFrame(
  state: IncrementalDecoderStateV1,
): Result.Result<void, DeclarativeV2AuthenticatedCommandIncrementalV1Error> {
  const structural = state.structural;
  const frameBytes = chargeIncremental(
    state.usage,
    state.budget,
    "frameBytes",
    FRAME_LENGTH_PREFIX_BYTES + structural.frameLength,
    "finish",
  );
  if (Result.isFailure(frameBytes)) return frameBytes;
  const frames = chargeIncremental(
    state.usage,
    state.budget,
    "frames",
    1,
    "finish",
  );
  if (Result.isFailure(frames)) return frames;
  structural.mode = "frameBody";
  return Result.succeed(undefined);
}

function advanceIncrementalFrameBody(
  state: IncrementalDecoderStateV1,
): Result.Result<void, DeclarativeV2AuthenticatedCommandIncrementalV1Error> {
  const structural = state.structural;
  const byte = state.body[state.validationOffset];
  if (
    byte === undefined ||
    structural.frameOffset >= structural.frameLength
  ) {
    return Result.fail(incrementalError(
      "finish",
      "malformed",
      `frames.${structural.frameIndex}`,
    ));
  }
  const localOffset = structural.frameOffset;
  if (localOffset === 0) {
    if (
      byte !== FRAME_TAGS.command_header &&
      byte !== FRAME_TAGS.module_metadata &&
      byte !== FRAME_TAGS.source_bytes &&
      byte !== FRAME_TAGS.semantic_bytes &&
      byte !== FRAME_TAGS.command_terminal
    ) {
      return Result.fail(incrementalError(
        "finish",
        "malformed",
        `frames.${structural.frameIndex}.kind`,
      ));
    }
    const isFirst = structural.frameIndex === 0;
    const isLast = structural.frameIndex === structural.frameCount - 1;
    if (
      (isFirst && byte !== FRAME_TAGS.command_header) ||
      (!isFirst && byte === FRAME_TAGS.command_header) ||
      (isLast && byte !== FRAME_TAGS.command_terminal) ||
      (!isLast && byte === FRAME_TAGS.command_terminal)
    ) {
      return Result.fail(incrementalError(
        "finish",
        "invalidGrammar",
        `frames.${structural.frameIndex}`,
      ));
    }
    structural.frameTag = byte;
  } else {
    const inspected = inspectIncrementalFrameByte(state, localOffset, byte);
    if (Result.isFailure(inspected)) return inspected;
  }
  structural.frameOffset += 1;
  state.validationOffset += 1;
  if (structural.mode === "admitPayload") return Result.succeed(undefined);
  if (structural.frameOffset === structural.frameLength) {
    if (structural.frameTag === FRAME_TAGS.module_metadata) {
      if (structural.utf8.remaining !== 0) {
        return Result.fail(incrementalError(
          "finish",
          "invalidUtf8",
          `frames.${structural.frameIndex}.modulePathBytes`,
        ));
      }
    }
    structural.mode = "finalizeFrame";
  }
  return Result.succeed(undefined);
}

function inspectIncrementalFrameByte(
  state: IncrementalDecoderStateV1,
  localOffset: number,
  byte: number,
): Result.Result<void, DeclarativeV2AuthenticatedCommandIncrementalV1Error> {
  const structural = state.structural;
  if (structural.frameTag === FRAME_TAGS.command_header) {
    const reservationStart = 5;
    const reservationEnd = reservationStart + structural.firstEmbeddedLength;
    if (
      structural.firstEmbeddedLength > 0 &&
      localOffset >= reservationStart &&
      localOffset < reservationEnd
    ) {
      return validateIncrementalReservationByte(
        structural,
        localOffset - reservationStart,
        byte,
      );
    }
    const budgetStart = 9 + structural.firstEmbeddedLength;
    const budgetEnd = budgetStart + structural.secondEmbeddedLength;
    if (
      structural.secondEmbeddedLength > 0 &&
      localOffset >= budgetStart &&
      localOffset < budgetEnd
    ) {
      return validateIncrementalBudgetByte(
        structural,
        localOffset - budgetStart,
        byte,
      );
    }
    if (localOffset >= 1 && localOffset <= 4) {
      accumulateIncrementalField(structural, byte, localOffset === 1);
      if (localOffset === 4) {
        structural.firstEmbeddedLength = structural.accumulator;
        resetIncrementalAccumulator(structural);
        if (
          structural.firstEmbeddedLength !==
            COMMAND_RESERVATION_BYTES_WITHOUT_PREDECESSOR &&
          structural.firstEmbeddedLength !==
            COMMAND_RESERVATION_BYTES_WITH_PREDECESSOR
        ) {
          return Result.fail(incrementalError(
            "finish",
            "malformed",
            `frames.${structural.frameIndex}.reservation`,
          ));
        }
        structural.reservationHasPredecessor =
          structural.firstEmbeddedLength ===
            COMMAND_RESERVATION_BYTES_WITH_PREDECESSOR;
        scheduleIncrementalPayload(
          structural,
          structural.firstEmbeddedLength,
          "frameBody",
        );
      }
      return Result.succeed(undefined);
    }
    const secondLengthStart = 5 + structural.firstEmbeddedLength;
    if (
      localOffset >= secondLengthStart &&
      localOffset < secondLengthStart + 4
    ) {
      accumulateIncrementalField(
        structural,
        byte,
        localOffset === secondLengthStart,
      );
      if (localOffset === secondLengthStart + 3) {
        structural.secondEmbeddedLength = structural.accumulator;
        resetIncrementalAccumulator(structural);
        if (
          structural.secondEmbeddedLength !== COMMAND_BUDGET_BYTES ||
          9 + structural.firstEmbeddedLength +
              structural.secondEmbeddedLength !== structural.frameLength
        ) {
          return Result.fail(incrementalError(
            "finish",
            "malformed",
            `frames.${structural.frameIndex}.commandBudget`,
          ));
        }
        scheduleIncrementalPayload(
          structural,
          structural.secondEmbeddedLength,
          "frameBody",
        );
      }
    }
    return Result.succeed(undefined);
  }
  if (structural.frameTag === FRAME_TAGS.module_metadata) {
    if (localOffset >= 1 && localOffset <= 8) {
      const accumulated = accumulateIncrementalU64Value(
        structural.frameU64A,
        localOffset - 1,
        byte,
        `frames.${structural.frameIndex}.moduleOrdinal`,
      );
      if (Result.isFailure(accumulated)) {
        return Result.fail(accumulated.failure);
      }
      structural.frameU64A = accumulated.success;
      return Result.succeed(undefined);
    }
    if (localOffset >= 9 && localOffset <= 12) {
      structural.frameU32A = localOffset === 9
        ? byte
        : (structural.frameU32A * 256) + byte;
      return Result.succeed(undefined);
    }
    if (localOffset >= 13 && localOffset <= 16) {
      accumulateIncrementalField(structural, byte, localOffset === 13);
      if (localOffset === 16) {
        structural.modulePathLength = structural.accumulator;
        resetIncrementalAccumulator(structural);
        if (
          structural.modulePathLength === 0 ||
          structural.modulePathLength >
            DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_PAYLOAD_QUANTUM_BYTES_V1 ||
          17 + structural.modulePathLength + 32 + 32 + 8 !==
            structural.frameLength
        ) {
          return Result.fail(incrementalError(
            "finish",
            "malformed",
            `frames.${structural.frameIndex}.modulePathBytes`,
          ));
        }
        scheduleIncrementalPayload(
          structural,
          structural.modulePathLength,
          "frameBody",
        );
      }
      return Result.succeed(undefined);
    }
    if (
      localOffset >= 17 &&
      localOffset < 17 + structural.modulePathLength
    ) {
      return advanceIncrementalUtf8(
        structural.utf8,
        byte,
        `frames.${structural.frameIndex}.modulePathBytes`,
      );
    }
    const sourceLengthStart = structural.frameLength - 8;
    if (localOffset >= sourceLengthStart) {
      const accumulated = accumulateIncrementalU64Value(
        structural.frameU64B,
        localOffset - sourceLengthStart,
        byte,
        `frames.${structural.frameIndex}.sourceByteLength`,
      );
      if (Result.isFailure(accumulated)) {
        return Result.fail(accumulated.failure);
      }
      structural.frameU64B = accumulated.success;
    }
    return Result.succeed(undefined);
  }
  if (structural.frameTag === FRAME_TAGS.source_bytes) {
    if (localOffset >= 1 && localOffset <= 8) {
      const accumulated = accumulateIncrementalU64Value(
        structural.frameU64A,
        localOffset - 1,
        byte,
        `frames.${structural.frameIndex}.moduleOrdinal`,
      );
      if (Result.isFailure(accumulated)) {
        return Result.fail(accumulated.failure);
      }
      structural.frameU64A = accumulated.success;
      return Result.succeed(undefined);
    }
    if (localOffset >= 9 && localOffset <= 16) {
      const accumulated = accumulateIncrementalU64Value(
        structural.frameU64B,
        localOffset - 9,
        byte,
        `frames.${structural.frameIndex}.offset`,
      );
      if (Result.isFailure(accumulated)) {
        return Result.fail(accumulated.failure);
      }
      structural.frameU64B = accumulated.success;
      return Result.succeed(undefined);
    }
  }
  if (
    structural.frameTag === FRAME_TAGS.semantic_bytes &&
    localOffset >= 1 &&
    localOffset <= 8
  ) {
    const accumulated = accumulateIncrementalU64Value(
      structural.frameU64A,
      localOffset - 1,
      byte,
      `frames.${structural.frameIndex}.offset`,
    );
    if (Result.isFailure(accumulated)) {
      return Result.fail(accumulated.failure);
    }
    structural.frameU64A = accumulated.success;
    return Result.succeed(undefined);
  }
  if (
    structural.frameTag === FRAME_TAGS.command_terminal &&
    localOffset >= 1 &&
    localOffset <= 40
  ) {
    const fieldIndex = Math.floor((localOffset - 1) / 8);
    const fieldOffset = (localOffset - 1) % 8;
    const current = fieldIndex === 0
      ? structural.frameU64A
      : fieldIndex === 1
      ? structural.frameU64B
      : fieldIndex === 2
      ? structural.frameU64C
      : fieldIndex === 3
      ? structural.frameU64D
      : structural.frameU64E;
    const accumulated = accumulateIncrementalU64Value(
      current,
      fieldOffset,
      byte,
      `frames.${structural.frameIndex}.terminal`,
    );
    if (Result.isFailure(accumulated)) {
      return Result.fail(accumulated.failure);
    }
    if (fieldIndex === 0) structural.frameU64A = accumulated.success;
    else if (fieldIndex === 1) structural.frameU64B = accumulated.success;
    else if (fieldIndex === 2) structural.frameU64C = accumulated.success;
    else if (fieldIndex === 3) structural.frameU64D = accumulated.success;
    else structural.frameU64E = accumulated.success;
    return Result.succeed(undefined);
  }
  const lengthStart = structural.frameTag === FRAME_TAGS.source_bytes
    ? 17
    : structural.frameTag === FRAME_TAGS.semantic_bytes
    ? 9
    : -1;
  if (lengthStart >= 0 && localOffset >= lengthStart && localOffset < lengthStart + 4) {
    accumulateIncrementalField(
      structural,
      byte,
      localOffset === lengthStart,
    );
    if (localOffset === lengthStart + 3) {
      structural.framePayloadLength = structural.accumulator;
      resetIncrementalAccumulator(structural);
      if (
        structural.framePayloadLength === 0 ||
        structural.framePayloadLength >
          DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_PAYLOAD_QUANTUM_BYTES_V1 ||
        lengthStart + 4 + structural.framePayloadLength !==
          structural.frameLength
      ) {
        return Result.fail(incrementalError(
          "finish",
          "malformed",
          `frames.${structural.frameIndex}.bytes`,
        ));
      }
      scheduleIncrementalPayload(
        structural,
        structural.framePayloadLength,
        "frameBody",
      );
    }
  }
  return Result.succeed(undefined);
}

function validateIncrementalReservationByte(
  structural: IncrementalStructuralStateV1,
  offset: number,
  byte: number,
): Result.Result<void, DeclarativeV2AuthenticatedCommandIncrementalV1Error> {
  const domainLength = COMMAND_RESERVATION_DOMAIN_BYTES.byteLength;
  if (offset < domainLength) {
    return byte === COMMAND_RESERVATION_DOMAIN_BYTES[offset]
      ? Result.succeed(undefined)
      : Result.fail(incrementalError(
        "finish",
        "malformed",
        `frames.${structural.frameIndex}.reservation`,
      ));
  }
  if (offset < domainLength + 4) {
    const fieldOffset = offset - domainLength;
    const expected = (COMMAND_RESERVATION_FIELD_COUNT >>>
      ((3 - fieldOffset) * 8)) & 0xff;
    return byte === expected
      ? Result.succeed(undefined)
      : Result.fail(incrementalError(
        "finish",
        "malformed",
        `frames.${structural.frameIndex}.reservation.fieldCount`,
      ));
  }
  const commandTagOffset = domainLength + 4 + 32 + 32;
  if (offset === commandTagOffset) {
    structural.commandKind = durableCommandKindFromIncrementalTag(byte);
    return structural.commandKind === undefined
      ? Result.fail(incrementalError(
        "finish",
        "malformed",
        `frames.${structural.frameIndex}.reservation.commandKind`,
      ))
      : Result.succeed(undefined);
  }
  const sequenceStart = commandTagOffset + 1;
  if (offset >= sequenceStart && offset < sequenceStart + 8) {
    const accumulated = accumulateIncrementalU64Value(
      structural.reservationSequence,
      offset - sequenceStart,
      byte,
      `frames.${structural.frameIndex}.reservation.sequence`,
    );
    if (Result.isFailure(accumulated)) {
      return Result.fail(accumulated.failure);
    }
    structural.reservationSequence = accumulated.success;
    if (byte !== 0) structural.reservationSequenceNonZero = true;
    return Result.succeed(undefined);
  }
  const predecessorTagOffset = sequenceStart + 8 + 32;
  if (offset === predecessorTagOffset) {
    const expected = structural.reservationHasPredecessor ? 1 : 0;
    return byte === expected
      ? Result.succeed(undefined)
      : Result.fail(incrementalError(
        "finish",
        "malformed",
        `frames.${structural.frameIndex}.reservation.predecessor`,
      ));
  }
  return Result.succeed(undefined);
}

function validateIncrementalBudgetByte(
  structural: IncrementalStructuralStateV1,
  offset: number,
  byte: number,
): Result.Result<void, DeclarativeV2AuthenticatedCommandIncrementalV1Error> {
  const domainLength = COMMAND_BUDGET_DOMAIN_BYTES.byteLength;
  if (offset < domainLength) {
    return byte === COMMAND_BUDGET_DOMAIN_BYTES[offset]
      ? Result.succeed(undefined)
      : Result.fail(incrementalError(
        "finish",
        "malformed",
        `frames.${structural.frameIndex}.commandBudget`,
      ));
  }
  if (offset < domainLength + 4) {
    // The independent canonical emitter owns the field-count spelling proof.
    // The exact admitted frame length still fixes the number of budget fields.
    return Result.succeed(undefined);
  }
  const valueOffset = offset - domainLength - 4;
  const dimensionIndex = Math.floor(valueOffset / 8);
  const dimensionByteOffset = valueOffset % 8;
  const accumulated = accumulateIncrementalU64Value(
    structural.commandBudgetValues[dimensionIndex] ?? 0n,
    dimensionByteOffset,
    byte,
    `frames.${structural.frameIndex}.commandBudget`,
  );
  if (Result.isFailure(accumulated)) {
    return Result.fail(accumulated.failure);
  }
  structural.commandBudgetValues[dimensionIndex] = accumulated.success;
  return Result.succeed(undefined);
}

function durableCommandKindFromIncrementalTag(
  tag: number,
): DeclarativeV2VerifierDurableCommandKindV2 | undefined {
  switch (tag) {
    case 1:
      return "source_page";
    case 2:
      return "parse_module";
    case 3:
      return "link_page";
    case 4:
      return "registration_page";
    default:
      return undefined;
  }
}

function durableCommandKindIncrementalTag(
  kind: DeclarativeV2VerifierDurableCommandKindV2,
): number {
  switch (kind) {
    case "source_page":
      return 1;
    case "parse_module":
      return 2;
    case "link_page":
      return 3;
    case "registration_page":
      return 4;
  }
}

function accumulateIncrementalU64Value(
  current: bigint,
  byteOffset: number,
  byte: number,
  path: string,
): Result.Result<
  bigint,
  DeclarativeV2AuthenticatedCommandIncrementalV1Error
> {
  if (byteOffset === 0 && byte > 0x7f) {
    return Result.fail(incrementalError("finish", "malformed", path));
  }
  return Result.succeed((current << 8n) | BigInt(byte));
}

function admitIncrementalPayload(
  state: IncrementalDecoderStateV1,
): Result.Result<void, DeclarativeV2AuthenticatedCommandIncrementalV1Error> {
  const structural = state.structural;
  const admitted = chargeIncremental(
    state.usage,
    state.budget,
    "payloadBytes",
    structural.pendingPayloadBytes,
    "finish",
  );
  if (Result.isFailure(admitted)) return admitted;
  structural.pendingPayloadBytes = 0;
  structural.mode = structural.pendingPayloadReturnMode;
  return Result.succeed(undefined);
}

function finalizeIncrementalFrame(
  state: IncrementalDecoderStateV1,
): Result.Result<void, DeclarativeV2AuthenticatedCommandIncrementalV1Error> {
  const structural = state.structural;
  const index = structural.frameIndex;
  const isFirst = index === 0;
  const isLast = index === structural.frameCount - 1;
  if (
    (isFirst && structural.frameTag !== FRAME_TAGS.command_header) ||
    (!isFirst && structural.frameTag === FRAME_TAGS.command_header) ||
    (isLast && structural.frameTag !== FRAME_TAGS.command_terminal) ||
    (!isLast && structural.frameTag === FRAME_TAGS.command_terminal)
  ) {
    return Result.fail(incrementalError(
      "finish",
      "invalidGrammar",
      `frames.${index}`,
    ));
  }
  if (
    isFirst &&
    (
      structural.commandKind === undefined ||
      !structural.reservationSequenceNonZero
    )
  ) {
    return Result.fail(incrementalError(
      "finish",
      "malformed",
      "command_header.reservation",
    ));
  }
  if (!isFirst && !isLast) {
    const bodyResult = finalizeIncrementalBodyFrame(state);
    if (Result.isFailure(bodyResult)) return bodyResult;
    structural.bodyFrameCount += 1;
  } else if (isLast) {
    const terminal = validateIncrementalTerminal(state);
    if (Result.isFailure(terminal)) return terminal;
  }
  const capturedPlan = captureIncrementalCanonicalFramePlan(state);
  if (Result.isFailure(capturedPlan)) return capturedPlan;
  structural.frameIndex += 1;
  if (structural.frameIndex === structural.frameCount) {
    if (state.validationOffset !== state.body.byteLength) {
      return Result.fail(incrementalError("finish", "malformed", "trailing"));
    }
    structural.mode = "done";
    return Result.succeed(undefined);
  }
  if (state.validationOffset >= state.body.byteLength) {
    return Result.fail(incrementalError("finish", "malformed", "frames"));
  }
  structural.mode = "frameLength";
  structural.accumulator = 0;
  structural.accumulatorBytes = 0;
  return Result.succeed(undefined);
}

function captureIncrementalCanonicalFramePlan(
  state: IncrementalDecoderStateV1,
): Result.Result<void, DeclarativeV2AuthenticatedCommandIncrementalV1Error> {
  const structural = state.structural;
  const allocated = chargeIncremental(
    state.usage,
    state.budget,
    "allocationBytes",
    CANONICAL_FRAME_PLAN_ALLOCATION_BYTES,
    "finish",
  );
  if (Result.isFailure(allocated)) return allocated;
  const base = {
    frameStart: structural.frameStart,
    frameLength: structural.frameLength,
  } as const;
  let plan: IncrementalCanonicalFramePlanV1;
  if (structural.frameTag === FRAME_TAGS.command_header) {
    if (structural.commandKind === undefined) {
      return Result.fail(incrementalError(
        "finish",
        "malformed",
        "command_header",
      ));
    }
    plan = Object.freeze({
      ...base,
      kind: "command_header",
      reservationHasPredecessor: structural.reservationHasPredecessor,
      commandKind: structural.commandKind,
      sequence: structural.reservationSequence,
      commandBudget: Object.freeze(structural.commandBudgetValues),
    });
  } else if (structural.frameTag === FRAME_TAGS.module_metadata) {
    plan = Object.freeze({
      ...base,
      kind: "module_metadata",
      moduleOrdinal: structural.frameU64A,
      roles: structural.frameU32A,
      modulePathLength: structural.modulePathLength,
      sourceByteLength: structural.frameU64B,
    });
  } else if (structural.frameTag === FRAME_TAGS.source_bytes) {
    plan = Object.freeze({
      ...base,
      kind: "source_bytes",
      moduleOrdinal: structural.frameU64A,
      sourceOffset: structural.frameU64B,
      payloadLength: structural.framePayloadLength,
    });
  } else if (structural.frameTag === FRAME_TAGS.semantic_bytes) {
    plan = Object.freeze({
      ...base,
      kind: "semantic_bytes",
      semanticOffset: structural.frameU64A,
      payloadLength: structural.framePayloadLength,
    });
  } else if (structural.frameTag === FRAME_TAGS.command_terminal) {
    plan = Object.freeze({
      ...base,
      kind: "command_terminal",
      firstModuleOrdinal: structural.frameU64A,
      moduleCount: structural.frameU64B,
      sourceByteLength: structural.frameU64C,
      semanticByteLength: structural.frameU64D,
      payloadFrameCount: structural.frameU64E,
    });
  } else {
    return Result.fail(incrementalError(
      "finish",
      "malformed",
      `frames.${structural.frameIndex}`,
    ));
  }
  structural.canonicalFrames[structural.frameIndex] = plan;
  return Result.succeed(undefined);
}

function finalizeIncrementalBodyFrame(
  state: IncrementalDecoderStateV1,
): Result.Result<void, DeclarativeV2AuthenticatedCommandIncrementalV1Error> {
  const structural = state.structural;
  const commandKind = structural.commandKind;
  if (commandKind === undefined) {
    return Result.fail(incrementalError("finish", "invalidGrammar", "header"));
  }
  if (structural.frameTag === FRAME_TAGS.module_metadata) {
    const ordinal = structural.frameU64A;
    const sourceLength = structural.frameU64B;
    if (commandKind === "source_page") {
      if (structural.nextModuleOrdinal === undefined) {
        structural.firstModuleOrdinal = ordinal;
        structural.nextModuleOrdinal = ordinal;
      }
      if (ordinal !== structural.nextModuleOrdinal) {
        return Result.fail(incrementalError(
          "finish",
          "invalidGrammar",
          "source_page.moduleOrdinal",
        ));
      }
      structural.nextModuleOrdinal += 1n;
      return Result.succeed(undefined);
    }
    if (
      commandKind === "parse_module" &&
      structural.bodyFrameCount === 0 &&
      structural.parseModuleOrdinal === undefined
    ) {
      structural.firstModuleOrdinal = ordinal;
      structural.parseModuleOrdinal = ordinal;
      structural.parseSourceLength = sourceLength;
      return Result.succeed(undefined);
    }
    return Result.fail(incrementalError(
      "finish",
      "invalidGrammar",
      commandKind,
    ));
  }
  if (structural.frameTag === FRAME_TAGS.source_bytes) {
    const ordinal = structural.frameU64A;
    const offset = structural.frameU64B;
    if (
      commandKind !== "parse_module" ||
      ordinal !== structural.parseModuleOrdinal ||
      offset !== structural.nextSourceOffset
    ) {
      return Result.fail(incrementalError(
        "finish",
        "invalidGrammar",
        "parse_module.source_bytes",
      ));
    }
    structural.nextSourceOffset += BigInt(structural.framePayloadLength);
    return Result.succeed(undefined);
  }
  if (structural.frameTag === FRAME_TAGS.semantic_bytes) {
    const offset = structural.frameU64A;
    if (
      commandKind !== "registration_page" ||
      offset !== structural.nextSemanticOffset
    ) {
      return Result.fail(incrementalError(
        "finish",
        "invalidGrammar",
        "registration_page.semantic_bytes",
      ));
    }
    structural.nextSemanticOffset += BigInt(structural.framePayloadLength);
    return Result.succeed(undefined);
  }
  return Result.fail(incrementalError(
    "finish",
    "invalidGrammar",
    commandKind,
  ));
}

function validateIncrementalTerminal(
  state: IncrementalDecoderStateV1,
): Result.Result<void, DeclarativeV2AuthenticatedCommandIncrementalV1Error> {
  const structural = state.structural;
  if (structural.frameLength !== 41 || structural.commandKind === undefined) {
    return Result.fail(incrementalError(
      "finish",
      "invalidGrammar",
      "command_terminal",
    ));
  }
  const firstModuleOrdinal = structural.frameU64A;
  const moduleCount = structural.frameU64B;
  const sourceByteLength = structural.frameU64C;
  const semanticByteLength = structural.frameU64D;
  const payloadFrameCount = structural.frameU64E;
  if (payloadFrameCount !== BigInt(structural.bodyFrameCount)) {
    return Result.fail(incrementalError(
      "finish",
      "invalidGrammar",
      "command_terminal",
    ));
  }
  const valid = structural.commandKind === "source_page"
    ? structural.bodyFrameCount > 0 &&
      firstModuleOrdinal === structural.firstModuleOrdinal &&
      moduleCount === BigInt(structural.bodyFrameCount) &&
      sourceByteLength === 0n &&
      semanticByteLength === 0n
    : structural.commandKind === "parse_module"
    ? structural.parseModuleOrdinal !== undefined &&
      firstModuleOrdinal === structural.parseModuleOrdinal &&
      moduleCount === 1n &&
      sourceByteLength === structural.parseSourceLength &&
      sourceByteLength === structural.nextSourceOffset &&
      semanticByteLength === 0n
    : structural.commandKind === "link_page"
    ? structural.bodyFrameCount === 0 &&
      firstModuleOrdinal === 0n &&
      moduleCount === 0n &&
      sourceByteLength === 0n &&
      semanticByteLength === 0n
    : firstModuleOrdinal === 0n &&
      moduleCount === 0n &&
      sourceByteLength === 0n &&
      semanticByteLength === structural.nextSemanticOffset;
  return valid
    ? Result.succeed(undefined)
    : Result.fail(incrementalError(
      "finish",
      "invalidGrammar",
      structural.commandKind,
    ));
}

function accumulateIncrementalField(
  structural: IncrementalStructuralStateV1,
  byte: number,
  reset: boolean,
): void {
  if (reset) resetIncrementalAccumulator(structural);
  structural.accumulator = (structural.accumulator * 256) + byte;
  structural.accumulatorBytes += 1;
}

function resetIncrementalAccumulator(
  structural: IncrementalStructuralStateV1,
): void {
  structural.accumulator = 0;
  structural.accumulatorBytes = 0;
}

function scheduleIncrementalPayload(
  structural: IncrementalStructuralStateV1,
  byteLength: number,
  returnMode: "frameBody" | "finalizeFrame",
): void {
  structural.pendingPayloadBytes = byteLength;
  structural.pendingPayloadReturnMode = returnMode;
  structural.mode = "admitPayload";
}

function resetIncrementalUtf8(state: IncrementalUtf8StateV1): void {
  state.remaining = 0;
  state.nextMinimum = 0x80;
  state.nextMaximum = 0xbf;
}

function advanceIncrementalUtf8(
  state: IncrementalUtf8StateV1,
  byte: number,
  path: string,
): Result.Result<void, DeclarativeV2AuthenticatedCommandIncrementalV1Error> {
  if (state.remaining > 0) {
    if (byte < state.nextMinimum || byte > state.nextMaximum) {
      return Result.fail(incrementalError("finish", "invalidUtf8", path));
    }
    state.remaining -= 1;
    state.nextMinimum = 0x80;
    state.nextMaximum = 0xbf;
    return Result.succeed(undefined);
  }
  if (byte === 0) {
    return Result.fail(incrementalError("finish", "invalidUtf8", path));
  }
  if (byte <= 0x7f) return Result.succeed(undefined);
  if (byte >= 0xc2 && byte <= 0xdf) {
    state.remaining = 1;
    return Result.succeed(undefined);
  }
  if (byte === 0xe0) {
    state.remaining = 2;
    state.nextMinimum = 0xa0;
    return Result.succeed(undefined);
  }
  if ((byte >= 0xe1 && byte <= 0xec) || (byte >= 0xee && byte <= 0xef)) {
    state.remaining = 2;
    return Result.succeed(undefined);
  }
  if (byte === 0xed) {
    state.remaining = 2;
    state.nextMaximum = 0x9f;
    return Result.succeed(undefined);
  }
  if (byte === 0xf0) {
    state.remaining = 3;
    state.nextMinimum = 0x90;
    return Result.succeed(undefined);
  }
  if (byte >= 0xf1 && byte <= 0xf3) {
    state.remaining = 3;
    return Result.succeed(undefined);
  }
  if (byte === 0xf4) {
    state.remaining = 3;
    state.nextMaximum = 0x8f;
    return Result.succeed(undefined);
  }
  return Result.fail(incrementalError("finish", "invalidUtf8", path));
}

function encodeRequest(
  input: unknown,
  rawBudget: unknown,
  operation: Operation,
): Result.Result<
  DeclarativeV2AuthenticatedCommandEncodedRequestV1,
  DeclarativeV2AuthenticatedCommandV1Error
> {
  return Result.gen(function* () {
    const budget = yield* captureBudget(rawBudget, operation);
    const requestRecord = yield* captureOwnDataRecord(
      input,
      ["frames"] as const,
      operation,
      "request",
    );
    const frameInputs = yield* captureArray(
      requestRecord.frames,
      operation,
      "frames",
      Math.min(
        budget.maximumFrames,
        DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_FRAMES_V1,
      ),
      "framesExceeded",
    );
    yield* requireFrameCount(frameInputs.length, budget, operation);

    const capturedFrames: CapturedFrameV1[] = [];
    const frameLengths: number[] = [];
    let frameBytes = 0;
    let payloadBytes = 0;
    for (let index = 0; index < frameInputs.length; index += 1) {
      const frame = yield* captureFrame(
        frameInputs[index],
        budget,
        operation,
        index,
      );
      const length = frameByteLength(frame);
      yield* requireLimit(
        operation,
        "frameBytesExceeded",
        length,
        budget.maximumFrameBytes,
        `frames.${index}`,
      );
      frameBytes = yield* checkedAdd(
        frameBytes,
        FRAME_LENGTH_PREFIX_BYTES + length,
        operation,
        "frameBytes",
      );
      payloadBytes = yield* checkedAdd(
        payloadBytes,
        framePayloadByteLength(frame),
        operation,
        "payloadBytes",
      );
      capturedFrames.push(frame);
      frameLengths.push(length);
    }
    yield* validateGrammar(capturedFrames, operation);

    const bodyBytes = yield* checkedAdd(
      REQUEST_PREFIX_BYTES,
      frameBytes,
      operation,
      "bodyBytes",
    );
    const transitions = yield* checkedAdd(
      bodyBytes,
      capturedFrames.length,
      operation,
      "transitions",
    );
    yield* requireUsage(
      {
        bodyBytes,
        canonicalBytes: bodyBytes,
        frameBytes,
        payloadBytes,
        frames: capturedFrames.length,
        transitions,
      },
      budget,
      operation,
    );

    const output = new Uint8Array(bodyBytes);
    let offset = 0;
    writeU32(output, offset, DOMAIN_BYTES.byteLength);
    offset += 4;
    output.set(DOMAIN_BYTES, offset);
    offset += DOMAIN_BYTES.byteLength;
    writeU32(
      output,
      offset,
      DECLARATIVE_V2_AUTHENTICATED_COMMAND_PROTOCOL_VERSION_V1,
    );
    offset += 4;
    writeU32(output, offset, capturedFrames.length);
    offset += 4;
    for (let index = 0; index < capturedFrames.length; index += 1) {
      const frame = capturedFrames[index]!;
      const length = frameLengths[index]!;
      writeU32(output, offset, length);
      offset += 4;
      encodeFrame(frame, output.subarray(offset, offset + length));
      offset += length;
    }
    const publicFrames = capturedFrames.map(toPublicFrame);
    return Object.freeze({
      request: Object.freeze({
        frames: Object.freeze(publicFrames),
      }),
      canonicalBytes: output,
      usage: Object.freeze({
        bodyBytes,
        canonicalBytes: bodyBytes,
        frameBytes,
        payloadBytes,
        frames: capturedFrames.length,
        transitions,
      }),
    });
  });
}

function parseOwnedRequest(
  input: Uint8Array,
  budget: Readonly<DeclarativeV2AuthenticatedCommandTransportBudgetV1>,
): Result.Result<
  DeclarativeV2AuthenticatedCommandRequestV1,
  DeclarativeV2AuthenticatedCommandV1Error
> {
  return Result.gen(function* () {
    if (input.byteLength < REQUEST_PREFIX_BYTES) {
      return yield* Result.fail(
        commandError("decode", "malformed", "request"),
      );
    }
    const domainLength = readU32(input, 0);
    if (
      domainLength !== DOMAIN_BYTES.byteLength ||
      4 + domainLength + 8 > input.byteLength ||
      !bytesEqualFullScan(
        input.subarray(4, 4 + domainLength),
        DOMAIN_BYTES,
      )
    ) {
      return yield* Result.fail(
        commandError("decode", "unsupportedVersion", "protocolIdentity"),
      );
    }
    let offset = 4 + domainLength;
    const version = readU32(input, offset);
    offset += 4;
    if (
      version !==
      DECLARATIVE_V2_AUTHENTICATED_COMMAND_PROTOCOL_VERSION_V1
    ) {
      return yield* Result.fail(
        commandError("decode", "unsupportedVersion", "protocolVersion"),
      );
    }
    const frameCount = readU32(input, offset);
    offset += 4;
    if (frameCount === undefined) {
      return yield* Result.fail(
        commandError("decode", "malformed", "frameCount"),
      );
    }
    yield* requireFrameCount(frameCount, budget, "decode");
    const frames: DeclarativeV2AuthenticatedCommandFrameV1[] = [];
    for (let index = 0; index < frameCount; index += 1) {
      const length = readU32(input, offset);
      if (
        length === undefined ||
        length === 0 ||
        offset + 4 + length > input.byteLength
      ) {
        return yield* Result.fail(
          commandError("decode", "malformed", `frames.${index}`),
        );
      }
      yield* requireLimit(
        "decode",
        "frameBytesExceeded",
        length,
        budget.maximumFrameBytes,
        `frames.${index}`,
      );
      offset += 4;
      const frame = yield* parseFrame(
        input.subarray(offset, offset + length),
        budget,
        index,
      );
      frames.push(frame);
      offset += length;
    }
    if (offset !== input.byteLength) {
      return yield* Result.fail(
        commandError("decode", "malformed", "trailing"),
      );
    }
    return Object.freeze({ frames: Object.freeze(frames) });
  });
}

function captureFrame(
  input: unknown,
  budget: Readonly<DeclarativeV2AuthenticatedCommandTransportBudgetV1>,
  operation: Operation,
  index: number,
): Result.Result<CapturedFrameV1, DeclarativeV2AuthenticatedCommandV1Error> {
  const kind = ownDataValue(input, "kind");
  if (Result.isFailure(kind) || typeof kind.success !== "string") {
    return Result.fail(
      commandError(operation, "invalidInput", `frames.${index}.kind`),
    );
  }
  switch (kind.success) {
    case "command_header":
      return captureHeaderFrame(input, budget, operation, index);
    case "module_metadata":
      return captureModuleMetadataFrame(input, operation, index);
    case "source_bytes":
      return captureSourceBytesFrame(input, operation, index);
    case "semantic_bytes":
      return captureSemanticBytesFrame(input, operation, index);
    case "command_terminal":
      return captureTerminalFrame(input, operation, index);
    default:
      return Result.fail(
        commandError(operation, "invalidInput", `frames.${index}.kind`),
      );
  }
}

function captureHeaderFrame(
  input: unknown,
  budget: Readonly<DeclarativeV2AuthenticatedCommandTransportBudgetV1>,
  operation: Operation,
  index: number,
): Result.Result<CapturedHeaderFrameV1, DeclarativeV2AuthenticatedCommandV1Error> {
  return Result.gen(function* () {
    const record = yield* captureOwnDataRecord(
      input,
      ["kind", "reservation", "commandBudget"] as const,
      operation,
      `frames.${index}`,
    );
    if (record.kind !== "command_header") {
      return yield* Result.fail(
        commandError(operation, "invalidInput", `frames.${index}.kind`),
      );
    }
    const progressBudget = progressFrameBudget(budget);
    const reservationInput = yield* captureOwnDataRecord(
      record.reservation,
      RESERVATION_KEYS,
      operation,
      `frames.${index}.reservation`,
    );
    const reservationEncoded = yield* Result.mapError(
      encodeDeclarativeV2VerifierProgressFrameV2(
        reservationInput,
        progressBudget,
      ),
      (error) => mapProgressFrameError(
        error,
        operation,
        "invalidInput",
        `frames.${index}.reservation`,
      ),
    );
    if (reservationEncoded.frame.kind !== "command_reservation") {
      return yield* Result.fail(
        commandError(
          operation,
          "invalidInput",
          `frames.${index}.reservation`,
        ),
      );
    }
    const commandBudgetInput = yield* captureOwnDataRecord(
      record.commandBudget,
      COMMAND_BUDGET_KEYS,
      operation,
      `frames.${index}.commandBudget`,
    );
    const commandBudgetEncoded = yield* Result.mapError(
      encodeDeclarativeV2VerifierProgressFrameV2(
        commandBudgetInput,
        progressBudget,
      ),
      (error) => mapProgressFrameError(
        error,
        operation,
        "invalidInput",
        `frames.${index}.commandBudget`,
      ),
    );
    if (commandBudgetEncoded.frame.kind !== "command_budget") {
      return yield* Result.fail(
        commandError(
          operation,
          "invalidInput",
          `frames.${index}.commandBudget`,
        ),
      );
    }
    return Object.freeze({
      kind: "command_header",
      reservation:
        reservationEncoded.frame as
          DeclarativeV2VerifierCommandReservationFrameV2,
      commandBudget:
        commandBudgetEncoded.frame as
          DeclarativeV2VerifierBudgetFrameV2 & {
            readonly kind: "command_budget";
          },
      reservationBytes: reservationEncoded.canonicalBytes,
      commandBudgetBytes: commandBudgetEncoded.canonicalBytes,
    });
  });
}

function captureModuleMetadataFrame(
  input: unknown,
  operation: Operation,
  index: number,
): Result.Result<
  DeclarativeV2AuthenticatedCommandModuleMetadataFrameV1,
  DeclarativeV2AuthenticatedCommandV1Error
> {
  return Result.gen(function* () {
    const record = yield* captureOwnDataRecord(
      input,
      [
        "kind",
        "moduleOrdinal",
        "roles",
        "modulePathBytes",
        "frameSha256",
        "sourceSha256",
        "sourceByteLength",
      ] as const,
      operation,
      `frames.${index}`,
    );
    if (
      record.kind !== "module_metadata" ||
      !isU64(record.moduleOrdinal) ||
      !isNonNegativeSafeInteger(record.roles) ||
      (record.roles as number) > U32_MAX ||
      !isU64(record.sourceByteLength)
    ) {
      return yield* Result.fail(
        commandError(operation, "invalidInput", `frames.${index}`),
      );
    }
    const modulePathBytes = yield* captureBytes(
      record.modulePathBytes,
      operation,
      `frames.${index}.modulePathBytes`,
      1,
      DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_PAYLOAD_QUANTUM_BYTES_V1,
    );
    yield* validateUtf8(modulePathBytes, operation, index);
    const frameSha256 = yield* captureDigest(
      record.frameSha256,
      operation,
      `frames.${index}.frameSha256`,
    );
    const sourceSha256 = yield* captureDigest(
      record.sourceSha256,
      operation,
      `frames.${index}.sourceSha256`,
    );
    return Object.freeze({
      kind: "module_metadata",
      moduleOrdinal: record.moduleOrdinal as bigint,
      roles: record.roles as number,
      modulePathBytes,
      frameSha256,
      sourceSha256,
      sourceByteLength: record.sourceByteLength as bigint,
    });
  });
}

function captureSourceBytesFrame(
  input: unknown,
  operation: Operation,
  index: number,
): Result.Result<
  DeclarativeV2AuthenticatedCommandSourceBytesFrameV1,
  DeclarativeV2AuthenticatedCommandV1Error
> {
  return Result.gen(function* () {
    const record = yield* captureOwnDataRecord(
      input,
      ["kind", "moduleOrdinal", "offset", "bytes"] as const,
      operation,
      `frames.${index}`,
    );
    if (
      record.kind !== "source_bytes" ||
      !isU64(record.moduleOrdinal) ||
      !isU64(record.offset)
    ) {
      return yield* Result.fail(
        commandError(operation, "invalidInput", `frames.${index}`),
      );
    }
    const bytes = yield* captureBytes(
      record.bytes,
      operation,
      `frames.${index}.bytes`,
      1,
      DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_PAYLOAD_QUANTUM_BYTES_V1,
    );
    return Object.freeze({
      kind: "source_bytes",
      moduleOrdinal: record.moduleOrdinal as bigint,
      offset: record.offset as bigint,
      bytes,
    });
  });
}

function captureSemanticBytesFrame(
  input: unknown,
  operation: Operation,
  index: number,
): Result.Result<
  DeclarativeV2AuthenticatedCommandSemanticBytesFrameV1,
  DeclarativeV2AuthenticatedCommandV1Error
> {
  return Result.gen(function* () {
    const record = yield* captureOwnDataRecord(
      input,
      ["kind", "offset", "bytes"] as const,
      operation,
      `frames.${index}`,
    );
    if (
      record.kind !== "semantic_bytes" ||
      !isU64(record.offset)
    ) {
      return yield* Result.fail(
        commandError(operation, "invalidInput", `frames.${index}`),
      );
    }
    const bytes = yield* captureBytes(
      record.bytes,
      operation,
      `frames.${index}.bytes`,
      1,
      DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_PAYLOAD_QUANTUM_BYTES_V1,
    );
    return Object.freeze({
      kind: "semantic_bytes",
      offset: record.offset as bigint,
      bytes,
    });
  });
}

function captureTerminalFrame(
  input: unknown,
  operation: Operation,
  index: number,
): Result.Result<
  DeclarativeV2AuthenticatedCommandTerminalFrameV1,
  DeclarativeV2AuthenticatedCommandV1Error
> {
  return Result.gen(function* () {
    const record = yield* captureOwnDataRecord(
      input,
      [
        "kind",
        "firstModuleOrdinal",
        "moduleCount",
        "sourceByteLength",
        "semanticByteLength",
        "payloadFrameCount",
      ] as const,
      operation,
      `frames.${index}`,
    );
    if (
      record.kind !== "command_terminal" ||
      !isU64(record.firstModuleOrdinal) ||
      !isU64(record.moduleCount) ||
      !isU64(record.sourceByteLength) ||
      !isU64(record.semanticByteLength) ||
      !isU64(record.payloadFrameCount)
    ) {
      return yield* Result.fail(
        commandError(operation, "invalidInput", `frames.${index}`),
      );
    }
    return Object.freeze({
      kind: "command_terminal",
      firstModuleOrdinal: record.firstModuleOrdinal as bigint,
      moduleCount: record.moduleCount as bigint,
      sourceByteLength: record.sourceByteLength as bigint,
      semanticByteLength: record.semanticByteLength as bigint,
      payloadFrameCount: record.payloadFrameCount as bigint,
    });
  });
}

function parseFrame(
  input: Uint8Array,
  budget: Readonly<DeclarativeV2AuthenticatedCommandTransportBudgetV1>,
  index: number,
): Result.Result<
  DeclarativeV2AuthenticatedCommandFrameV1,
  DeclarativeV2AuthenticatedCommandV1Error
> {
  return Result.gen(function* () {
    const tag = input[0];
    if (tag === undefined) {
      return yield* Result.fail(
        commandError("decode", "malformed", `frames.${index}`),
      );
    }
    let offset = 1;
    if (tag === FRAME_TAGS.command_header) {
      const reservationBytes = yield* readLengthFramedBytes(
        input,
        offset,
        `frames.${index}.reservation`,
      );
      offset = reservationBytes.offset;
      const commandBudgetBytes = yield* readLengthFramedBytes(
        input,
        offset,
        `frames.${index}.commandBudget`,
      );
      offset = commandBudgetBytes.offset;
      if (offset !== input.byteLength) {
        return yield* Result.fail(
          commandError("decode", "malformed", `frames.${index}`),
        );
      }
      const progressBudget = progressFrameBudget(budget);
      const reservation = yield* Result.mapError(
        decodeDeclarativeV2VerifierProgressFrameV2(
          reservationBytes.value,
          progressBudget,
        ),
        (error) => mapProgressFrameError(
          error,
          "decode",
          "malformed",
          `frames.${index}.reservation`,
        ),
      );
      if (reservation.frame.kind !== "command_reservation") {
        return yield* Result.fail(
          commandError(
            "decode",
            "malformed",
            `frames.${index}.reservation`,
          ),
        );
      }
      const commandBudget = yield* Result.mapError(
        decodeDeclarativeV2VerifierProgressFrameV2(
          commandBudgetBytes.value,
          progressBudget,
        ),
        (error) => mapProgressFrameError(
          error,
          "decode",
          "malformed",
          `frames.${index}.commandBudget`,
        ),
      );
      if (commandBudget.frame.kind !== "command_budget") {
        return yield* Result.fail(
          commandError("decode", "malformed", `frames.${index}`),
        );
      }
      return Object.freeze({
        kind: "command_header",
        reservation:
          reservation.frame as
            DeclarativeV2VerifierCommandReservationFrameV2,
        commandBudget:
          commandBudget.frame as
            DeclarativeV2VerifierBudgetFrameV2 & {
              readonly kind: "command_budget";
            },
      });
    }
    if (tag === FRAME_TAGS.module_metadata) {
      const moduleOrdinal = readU64(input, offset);
      offset += 8;
      const roles = readU32(input, offset);
      offset += 4;
      const path = yield* readLengthFramedBytes(
        input,
        offset,
        `frames.${index}.modulePathBytes`,
      );
      offset = path.offset;
      const frameSha256 = readDigest(input, offset);
      offset += SHA256_BYTES;
      const sourceSha256 = readDigest(input, offset);
      offset += SHA256_BYTES;
      const sourceByteLength = readU64(input, offset);
      offset += 8;
      if (
        moduleOrdinal === undefined ||
        roles === undefined ||
        path.value.byteLength === 0 ||
        path.value.byteLength >
          DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_PAYLOAD_QUANTUM_BYTES_V1 ||
        frameSha256 === undefined ||
        sourceSha256 === undefined ||
        sourceByteLength === undefined ||
        offset !== input.byteLength
      ) {
        return yield* Result.fail(
          commandError("decode", "malformed", `frames.${index}`),
        );
      }
      yield* validateUtf8(path.value, "decode", index);
      return Object.freeze({
        kind: "module_metadata",
        moduleOrdinal,
        roles,
        modulePathBytes: path.value,
        frameSha256,
        sourceSha256,
        sourceByteLength,
      });
    }
    if (tag === FRAME_TAGS.source_bytes) {
      const moduleOrdinal = readU64(input, offset);
      offset += 8;
      const sourceOffset = readU64(input, offset);
      offset += 8;
      const bytes = yield* readLengthFramedBytes(
        input,
        offset,
        `frames.${index}.bytes`,
      );
      offset = bytes.offset;
      if (
        moduleOrdinal === undefined ||
        sourceOffset === undefined ||
        bytes.value.byteLength === 0 ||
        bytes.value.byteLength >
          DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_PAYLOAD_QUANTUM_BYTES_V1 ||
        offset !== input.byteLength
      ) {
        return yield* Result.fail(
          commandError("decode", "malformed", `frames.${index}`),
        );
      }
      return Object.freeze({
        kind: "source_bytes",
        moduleOrdinal,
        offset: sourceOffset,
        bytes: bytes.value,
      });
    }
    if (tag === FRAME_TAGS.semantic_bytes) {
      const semanticOffset = readU64(input, offset);
      offset += 8;
      const bytes = yield* readLengthFramedBytes(
        input,
        offset,
        `frames.${index}.bytes`,
      );
      offset = bytes.offset;
      if (
        semanticOffset === undefined ||
        bytes.value.byteLength === 0 ||
        bytes.value.byteLength >
          DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_PAYLOAD_QUANTUM_BYTES_V1 ||
        offset !== input.byteLength
      ) {
        return yield* Result.fail(
          commandError("decode", "malformed", `frames.${index}`),
        );
      }
      return Object.freeze({
        kind: "semantic_bytes",
        offset: semanticOffset,
        bytes: bytes.value,
      });
    }
    if (tag === FRAME_TAGS.command_terminal) {
      const firstModuleOrdinal = readU64(input, offset);
      offset += 8;
      const moduleCount = readU64(input, offset);
      offset += 8;
      const sourceByteLength = readU64(input, offset);
      offset += 8;
      const semanticByteLength = readU64(input, offset);
      offset += 8;
      const payloadFrameCount = readU64(input, offset);
      offset += 8;
      if (
        firstModuleOrdinal === undefined ||
        moduleCount === undefined ||
        sourceByteLength === undefined ||
        semanticByteLength === undefined ||
        payloadFrameCount === undefined ||
        offset !== input.byteLength
      ) {
        return yield* Result.fail(
          commandError("decode", "malformed", `frames.${index}`),
        );
      }
      return Object.freeze({
        kind: "command_terminal",
        firstModuleOrdinal,
        moduleCount,
        sourceByteLength,
        semanticByteLength,
        payloadFrameCount,
      });
    }
    return yield* Result.fail(
      commandError("decode", "malformed", `frames.${index}.kind`),
    );
  });
}

function validateGrammar(
  frames: readonly CapturedFrameV1[],
  operation: Operation,
): Result.Result<void, DeclarativeV2AuthenticatedCommandV1Error> {
  return Result.gen(function* () {
    if (
      frames.length < 2 ||
      frames[0]?.kind !== "command_header" ||
      frames[frames.length - 1]?.kind !== "command_terminal"
    ) {
      return yield* grammarFailure(operation, "frames");
    }
    const header = frames[0] as CapturedHeaderFrameV1;
    const terminal =
      frames[frames.length - 1] as
        DeclarativeV2AuthenticatedCommandTerminalFrameV1;
    const body = frames.slice(1, -1);
    if (terminal.payloadFrameCount !== BigInt(body.length)) {
      return yield* grammarFailure(operation, "command_terminal.payloadFrameCount");
    }
    switch (header.reservation.commandKind) {
      case "source_page":
        return yield* validateSourcePage(body, terminal, operation);
      case "parse_module":
        return yield* validateParseModule(body, terminal, operation);
      case "link_page":
        return yield* validateLinkPage(body, terminal, operation);
      case "registration_page":
        return yield* validateRegistrationPage(body, terminal, operation);
    }
  });
}

function validateSourcePage(
  body: readonly CapturedFrameV1[],
  terminal: DeclarativeV2AuthenticatedCommandTerminalFrameV1,
  operation: Operation,
): Result.Result<void, DeclarativeV2AuthenticatedCommandV1Error> {
  if (
    body.length === 0 ||
    body.some((frame) => frame.kind !== "module_metadata") ||
    terminal.moduleCount !== BigInt(body.length) ||
    terminal.sourceByteLength !== 0n ||
    terminal.semanticByteLength !== 0n
  ) {
    return grammarFailure(operation, "source_page");
  }
  let ordinal = terminal.firstModuleOrdinal;
  for (const frame of body) {
    if (
      frame.kind !== "module_metadata" ||
      frame.moduleOrdinal !== ordinal
    ) {
      return grammarFailure(operation, "source_page.moduleOrdinal");
    }
    ordinal += 1n;
  }
  return Result.succeed(undefined);
}

function validateParseModule(
  body: readonly CapturedFrameV1[],
  terminal: DeclarativeV2AuthenticatedCommandTerminalFrameV1,
  operation: Operation,
): Result.Result<void, DeclarativeV2AuthenticatedCommandV1Error> {
  const module = body[0];
  if (
    module?.kind !== "module_metadata" ||
    terminal.moduleCount !== 1n ||
    terminal.firstModuleOrdinal !== module.moduleOrdinal ||
    terminal.semanticByteLength !== 0n ||
    terminal.sourceByteLength !== module.sourceByteLength
  ) {
    return grammarFailure(operation, "parse_module");
  }
  let offset = 0n;
  for (let index = 1; index < body.length; index += 1) {
    const frame = body[index];
    if (
      frame?.kind !== "source_bytes" ||
      frame.moduleOrdinal !== module.moduleOrdinal ||
      frame.offset !== offset
    ) {
      return grammarFailure(operation, "parse_module.source_bytes");
    }
    offset += BigInt(frame.bytes.byteLength);
  }
  return offset === module.sourceByteLength
    ? Result.succeed(undefined)
    : grammarFailure(operation, "parse_module.sourceByteLength");
}

function validateLinkPage(
  body: readonly CapturedFrameV1[],
  terminal: DeclarativeV2AuthenticatedCommandTerminalFrameV1,
  operation: Operation,
): Result.Result<void, DeclarativeV2AuthenticatedCommandV1Error> {
  return body.length === 0 &&
      terminal.firstModuleOrdinal === 0n &&
      terminal.moduleCount === 0n &&
      terminal.sourceByteLength === 0n &&
      terminal.semanticByteLength === 0n
    ? Result.succeed(undefined)
    : grammarFailure(operation, "link_page");
}

function validateRegistrationPage(
  body: readonly CapturedFrameV1[],
  terminal: DeclarativeV2AuthenticatedCommandTerminalFrameV1,
  operation: Operation,
): Result.Result<void, DeclarativeV2AuthenticatedCommandV1Error> {
  if (
    body.some((frame) => frame.kind !== "semantic_bytes") ||
    terminal.firstModuleOrdinal !== 0n ||
    terminal.moduleCount !== 0n ||
    terminal.sourceByteLength !== 0n
  ) {
    return grammarFailure(operation, "registration_page");
  }
  let offset = 0n;
  for (const frame of body) {
    if (frame.kind !== "semantic_bytes" || frame.offset !== offset) {
      return grammarFailure(operation, "registration_page.semantic_bytes");
    }
    offset += BigInt(frame.bytes.byteLength);
  }
  return offset === terminal.semanticByteLength
    ? Result.succeed(undefined)
    : grammarFailure(operation, "registration_page.semanticByteLength");
}

function frameByteLength(frame: CapturedFrameV1): number {
  switch (frame.kind) {
    case "command_header":
      return 1 + 4 + frame.reservationBytes.byteLength +
        4 + frame.commandBudgetBytes.byteLength;
    case "module_metadata":
      return 1 + 8 + 4 + 4 + frame.modulePathBytes.byteLength +
        SHA256_BYTES + SHA256_BYTES + 8;
    case "source_bytes":
      return 1 + 8 + 8 + 4 + frame.bytes.byteLength;
    case "semantic_bytes":
      return 1 + 8 + 4 + frame.bytes.byteLength;
    case "command_terminal":
      return 1 + (5 * 8);
  }
}

function framePayloadByteLength(frame: CapturedFrameV1): number {
  switch (frame.kind) {
    case "command_header":
      return frame.reservationBytes.byteLength +
        frame.commandBudgetBytes.byteLength;
    case "module_metadata":
      return frame.modulePathBytes.byteLength;
    case "source_bytes":
    case "semantic_bytes":
      return frame.bytes.byteLength;
    case "command_terminal":
      return 0;
  }
}

function encodeFrame(frame: CapturedFrameV1, output: Uint8Array): void {
  output[0] = FRAME_TAGS[frame.kind];
  let offset = 1;
  switch (frame.kind) {
    case "command_header":
      offset = writeLengthFramedBytes(output, offset, frame.reservationBytes);
      writeLengthFramedBytes(output, offset, frame.commandBudgetBytes);
      return;
    case "module_metadata":
      writeU64(output, offset, frame.moduleOrdinal);
      offset += 8;
      writeU32(output, offset, frame.roles);
      offset += 4;
      offset = writeLengthFramedBytes(output, offset, frame.modulePathBytes);
      output.set(frame.frameSha256, offset);
      offset += SHA256_BYTES;
      output.set(frame.sourceSha256, offset);
      offset += SHA256_BYTES;
      writeU64(output, offset, frame.sourceByteLength);
      return;
    case "source_bytes":
      writeU64(output, offset, frame.moduleOrdinal);
      offset += 8;
      writeU64(output, offset, frame.offset);
      offset += 8;
      writeLengthFramedBytes(output, offset, frame.bytes);
      return;
    case "semantic_bytes":
      writeU64(output, offset, frame.offset);
      offset += 8;
      writeLengthFramedBytes(output, offset, frame.bytes);
      return;
    case "command_terminal":
      for (const value of [
        frame.firstModuleOrdinal,
        frame.moduleCount,
        frame.sourceByteLength,
        frame.semanticByteLength,
        frame.payloadFrameCount,
      ]) {
        writeU64(output, offset, value);
        offset += 8;
      }
  }
}

function toPublicFrame(
  frame: CapturedFrameV1,
): DeclarativeV2AuthenticatedCommandFrameV1 {
  if (frame.kind !== "command_header") return frame;
  return Object.freeze({
    kind: "command_header",
    reservation: frame.reservation,
    commandBudget: frame.commandBudget,
  });
}

function captureBudget(
  input: unknown,
  operation: Operation,
): Result.Result<
  Readonly<DeclarativeV2AuthenticatedCommandTransportBudgetV1>,
  DeclarativeV2AuthenticatedCommandV1Error
> {
  const result =
    captureDeclarativeV2AuthenticatedCommandTransportBudgetV1(input);
  return Result.mapError(
    result,
    () => commandError(operation, "invalidBudget", "budget"),
  );
}

function progressFrameBudget(
  budget: Readonly<DeclarativeV2AuthenticatedCommandTransportBudgetV1>,
): DeclarativeV2VerifierFrameBudgetV2 {
  return Object.freeze({
    maximumFrameBytes: budget.maximumFrameBytes,
    maximumCanonicalBytes: budget.maximumCanonicalBytes,
  });
}

function requireFrameCount(
  observed: number,
  budget: Readonly<DeclarativeV2AuthenticatedCommandTransportBudgetV1>,
  operation: Operation,
): Result.Result<void, DeclarativeV2AuthenticatedCommandV1Error> {
  const maximum = Math.min(
    budget.maximumFrames,
    DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_FRAMES_V1,
  );
  return requireLimit(
    operation,
    "framesExceeded",
    observed,
    maximum,
    "frames",
  );
}

function preserveDecodeLimitOrMalformed(
  error: DeclarativeV2AuthenticatedCommandV1Error,
): DeclarativeV2AuthenticatedCommandV1Error {
  switch (error.reason) {
    case "bodyBytesExceeded":
    case "canonicalBytesExceeded":
    case "frameBytesExceeded":
    case "payloadBytesExceeded":
    case "framesExceeded":
    case "chunksExceeded":
    case "transitionsExceeded":
      return error;
    default:
      return commandError("decode", "malformed", "reencode");
  }
}

function mapProgressFrameError(
  error: DeclarativeV2VerifierProgressV2Error,
  operation: Operation,
  invalidReason: "invalidInput" | "malformed",
  path: string,
): DeclarativeV2AuthenticatedCommandV1Error {
  switch (error.reason) {
    case "frameBytesExceeded":
    case "canonicalBytesExceeded":
      return commandError(
        operation,
        error.reason,
        path,
        error.observed,
        error.maximum,
      );
    default:
      return commandError(operation, invalidReason, path);
  }
}

function requireUsage(
  usage: DeclarativeV2AuthenticatedCommandTransportUsageV1,
  budget: Readonly<DeclarativeV2AuthenticatedCommandTransportBudgetV1>,
  operation: Operation,
): Result.Result<void, DeclarativeV2AuthenticatedCommandV1Error> {
  return Result.gen(function* () {
    yield* requireLimit(
      operation,
      "bodyBytesExceeded",
      usage.bodyBytes,
      budget.maximumBodyBytes,
      "bodyBytes",
    );
    yield* requireLimit(
      operation,
      "canonicalBytesExceeded",
      usage.canonicalBytes,
      budget.maximumCanonicalBytes,
      "canonicalBytes",
    );
    yield* requireLimit(
      operation,
      "frameBytesExceeded",
      usage.frameBytes,
      budget.maximumFrameBytes,
      "frameBytes",
    );
    yield* requireLimit(
      operation,
      "payloadBytesExceeded",
      usage.payloadBytes,
      budget.maximumPayloadBytes,
      "payloadBytes",
    );
    yield* requireFrameCount(usage.frames, budget, operation);
    yield* requireLimit(
      operation,
      "transitionsExceeded",
      usage.transitions,
      budget.maximumTransitions,
      "transitions",
    );
  });
}

function requireLimit(
  operation: Operation,
  reason:
    | "bodyBytesExceeded"
    | "canonicalBytesExceeded"
    | "frameBytesExceeded"
    | "payloadBytesExceeded"
    | "framesExceeded"
    | "transitionsExceeded",
  observed: number,
  maximum: number,
  path: string,
): Result.Result<void, DeclarativeV2AuthenticatedCommandV1Error> {
  return observed <= maximum
    ? Result.succeed(undefined)
    : Result.fail(commandError(
      operation,
      reason,
      path,
      observed,
      maximum,
    ));
}

function captureOwnDataRecord<const Keys extends readonly string[]>(
  input: unknown,
  keys: Keys,
  operation: Operation,
  path: string,
): Result.Result<
  Readonly<Record<Keys[number], unknown>>,
  DeclarativeV2AuthenticatedCommandV1Error
> {
  if (typeof input !== "object" || input === null) {
    return Result.fail(commandError(operation, "invalidInput", path));
  }
  let ownKeys: readonly PropertyKey[];
  try {
    ownKeys = Reflect.ownKeys(input);
  } catch {
    return Result.fail(commandError(operation, "invalidInput", path));
  }
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
  ) {
    return Result.fail(commandError(operation, "invalidInput", path));
  }
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(input, key);
    } catch {
      return Result.fail(
        commandError(operation, "invalidInput", `${path}.${key}`),
      );
    }
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, "value") ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined
    ) {
      return Result.fail(
        commandError(operation, "invalidInput", `${path}.${key}`),
      );
    }
    output[key] = descriptor.value;
  }
  return Result.succeed(Object.freeze(output) as Readonly<
    Record<Keys[number], unknown>
  >);
}

function ownDataValue(
  input: unknown,
  key: string,
): Result.Result<unknown, void> {
  if (typeof input !== "object" || input === null) {
    return Result.fail(undefined);
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    return descriptor !== undefined &&
        Object.hasOwn(descriptor, "value") &&
        descriptor.get === undefined &&
        descriptor.set === undefined
      ? Result.succeed(descriptor.value)
      : Result.fail(undefined);
  } catch {
    return Result.fail(undefined);
  }
}

function captureArray(
  input: unknown,
  operation: Operation,
  path: string,
  maximumLength: number,
  exceededReason: "framesExceeded" | "chunksExceeded",
): Result.Result<readonly unknown[], DeclarativeV2AuthenticatedCommandV1Error> {
  let isArray = false;
  try {
    isArray = Array.isArray(input);
  } catch {
    return Result.fail(commandError(operation, "invalidInput", path));
  }
  if (!isArray) {
    return Result.fail(commandError(operation, "invalidInput", path));
  }
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    lengthDescriptor = Object.getOwnPropertyDescriptor(input, "length");
  } catch {
    return Result.fail(commandError(operation, "invalidInput", path));
  }
  const length = lengthDescriptor?.value;
  if (
    lengthDescriptor === undefined ||
    !Object.hasOwn(lengthDescriptor, "value") ||
    lengthDescriptor.get !== undefined ||
    lengthDescriptor.set !== undefined ||
    !isNonNegativeSafeInteger(length)
  ) {
    return Result.fail(commandError(operation, "invalidInput", path));
  }
  const admittedLength = length as number;
  if (admittedLength > maximumLength) {
    return Result.fail(commandError(
      operation,
      exceededReason,
      path,
      admittedLength,
      maximumLength,
    ));
  }
  let ownKeyCount: number;
  try {
    ownKeyCount = Reflect.ownKeys(input as object).length;
  } catch {
    return Result.fail(commandError(operation, "invalidInput", path));
  }
  if (ownKeyCount !== admittedLength + 1) {
    return Result.fail(commandError(operation, "invalidInput", path));
  }
  const output = new Array<unknown>(admittedLength);
  for (let index = 0; index < admittedLength; index += 1) {
    const key = String(index);
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(input, key);
    } catch {
      return Result.fail(commandError(operation, "invalidInput", path));
    }
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, "value") ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined
    ) {
      return Result.fail(
        commandError(operation, "invalidInput", `${path}.${index}`),
      );
    }
    output[index] = descriptor.value;
  }
  return Result.succeed(Object.freeze(output));
}

function captureChunkArray(
  input: unknown,
): Result.Result<
  readonly Uint8Array[],
  DeclarativeV2AuthenticatedCommandV1Error
> {
  return Result.gen(function* () {
    const values = yield* captureArray(
      input,
      "decode",
      "chunks",
      DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_CHUNKS_V1,
      "chunksExceeded",
    );
    const chunks: Uint8Array[] = [];
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index];
      if (!isUint8Array(value)) {
        return yield* Result.fail(
          commandError("decode", "invalidInput", `chunks.${index}`),
        );
      }
      chunks.push(value);
    }
    return Object.freeze(chunks);
  });
}

function captureBytes(
  input: unknown,
  operation: Operation,
  path: string,
  minimum: number,
  maximum: number,
): Result.Result<Uint8Array, DeclarativeV2AuthenticatedCommandV1Error> {
  if (!isUint8Array(input)) {
    return Result.fail(commandError(operation, "invalidInput", path));
  }
  const length = intrinsicByteLength(input);
  if (
    length === undefined ||
    length < minimum ||
    length > maximum
  ) {
    return Result.fail(commandError(operation, "invalidInput", path));
  }
  try {
    return Result.succeed(new Uint8Array(input));
  } catch {
    return Result.fail(commandError(operation, "invalidInput", path));
  }
}

function captureDigest(
  input: unknown,
  operation: Operation,
  path: string,
): Result.Result<Uint8Array, DeclarativeV2AuthenticatedCommandV1Error> {
  if (!isUint8ArrayWithByteLength(input, SHA256_BYTES)) {
    return Result.fail(commandError(operation, "invalidInput", path));
  }
  try {
    return Result.succeed(new Uint8Array(input));
  } catch {
    return Result.fail(commandError(operation, "invalidInput", path));
  }
}

function validateUtf8(
  input: Uint8Array,
  operation: Operation,
  index: number,
): Result.Result<void, DeclarativeV2AuthenticatedCommandV1Error> {
  try {
    const value = FATAL_UTF8_DECODER.decode(input);
    if (
      value.includes("\0") ||
      !bytesEqualFullScan(UTF8_ENCODER.encode(value), input)
    ) {
      return Result.fail(
        commandError(
          operation,
          "invalidUtf8",
          `frames.${index}.modulePathBytes`,
        ),
      );
    }
    return Result.succeed(undefined);
  } catch {
    return Result.fail(
      commandError(
        operation,
        "invalidUtf8",
        `frames.${index}.modulePathBytes`,
      ),
    );
  }
}

function readLengthFramedBytes(
  input: Uint8Array,
  offset: number,
  path: string,
): Result.Result<
  Readonly<{ readonly value: Uint8Array; readonly offset: number }>,
  DeclarativeV2AuthenticatedCommandV1Error
> {
  const length = readU32(input, offset);
  if (
    length === undefined ||
    offset + 4 + length > input.byteLength
  ) {
    return Result.fail(commandError("decode", "malformed", path));
  }
  return Result.succeed(Object.freeze({
    value: input.slice(offset + 4, offset + 4 + length),
    offset: offset + 4 + length,
  }));
}

function writeLengthFramedBytes(
  output: Uint8Array,
  offset: number,
  bytes: Uint8Array,
): number {
  writeU32(output, offset, bytes.byteLength);
  output.set(bytes, offset + 4);
  return offset + 4 + bytes.byteLength;
}

function readDigest(
  input: Uint8Array,
  offset: number,
): Uint8Array | undefined {
  return offset + SHA256_BYTES <= input.byteLength
    ? input.slice(offset, offset + SHA256_BYTES)
    : undefined;
}

function readU32(input: Uint8Array, offset: number): number | undefined {
  if (offset + 4 > input.byteLength) return undefined;
  return (
    ((input[offset]! << 24) >>> 0) |
    (input[offset + 1]! << 16) |
    (input[offset + 2]! << 8) |
    input[offset + 3]!
  ) >>> 0;
}

function writeU32(output: Uint8Array, offset: number, value: number): void {
  output[offset] = (value >>> 24) & 0xff;
  output[offset + 1] = (value >>> 16) & 0xff;
  output[offset + 2] = (value >>> 8) & 0xff;
  output[offset + 3] = value & 0xff;
}

function readU64(input: Uint8Array, offset: number): bigint | undefined {
  if (offset + 8 > input.byteLength) return undefined;
  let value = 0n;
  for (let index = 0; index < 8; index += 1) {
    value = (value << 8n) | BigInt(input[offset + index]!);
  }
  return value <= MAX_SIGNED_INT64 ? value : undefined;
}

function writeU64(output: Uint8Array, offset: number, value: bigint): void {
  let remaining = value;
  for (let index = 7; index >= 0; index -= 1) {
    output[offset + index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
}

function isU64(input: unknown): input is bigint {
  return typeof input === "bigint" &&
    input >= 0n &&
    input <= MAX_SIGNED_INT64;
}

function intrinsicByteLength(input: Uint8Array): number | undefined {
  if (UINT8_ARRAY_BYTE_LENGTH_GETTER === undefined) return undefined;
  try {
    return Reflect.apply(
      UINT8_ARRAY_BYTE_LENGTH_GETTER,
      input,
      [],
    ) as number;
  } catch {
    return undefined;
  }
}

function checkedAdd(
  left: number,
  right: number,
  operation: Operation,
  path: string,
): Result.Result<number, DeclarativeV2AuthenticatedCommandV1Error> {
  const sum = left + right;
  return Number.isSafeInteger(sum) && sum >= 0 && sum <= U32_MAX
    ? Result.succeed(sum)
    : Result.fail(commandError(operation, "invalidInput", path));
}

function grammarFailure(
  operation: Operation,
  path: string,
): Result.Result<never, DeclarativeV2AuthenticatedCommandV1Error> {
  return Result.fail(commandError(operation, "invalidGrammar", path));
}

function commandError(
  operation: Operation,
  reason: DeclarativeV2AuthenticatedCommandV1Error["reason"],
  path?: string,
  observed?: number,
  maximum?: number,
): DeclarativeV2AuthenticatedCommandV1Error {
  return new DeclarativeV2AuthenticatedCommandV1Error({
    operation,
    reason,
    ...(path === undefined ? {} : { path }),
    ...(observed === undefined ? {} : { observed }),
    ...(maximum === undefined ? {} : { maximum }),
  });
}
