import {
  bytesEqualFullScan,
  isUint8Array,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { Data, Result } from "effect";
import {
  encodeDeclarativeV2VerifierProgressFrameIntoV2,
  validateDeclarativeV2VerifierEvidencePageTransitionV2,
  validateDeclarativeV2VerifierFinalEvidencePageV2,
  verifyOwnedDeclarativeV2VerifierProgressFrameV2,
  type DeclarativeV2VerifierBudgetFrameV2,
  type DeclarativeV2VerifierCommandOutputManifestFrameV2,
  type DeclarativeV2VerifierDurableCommandKindV2,
  type DeclarativeV2VerifierEvidencePageManifestFrameV2,
  type DeclarativeV2VerifierProgressCursorFrameV2,
  type DeclarativeV2VerifierProgressFrameWorkV2,
  type DeclarativeV2VerifierProgressV2Error,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";

export const DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESPONSE_PROTOCOL_IDENTITY_V1 =
  "flarex.executor-http/declarative-v2-authenticated-command-response/v1" as const;
export const DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESPONSE_PROTOCOL_VERSION_V1 =
  1 as const;
export const DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESPONSE_MEDIA_TYPE_V1 =
  "application/vnd.flarex.declarative-v2-authenticated-command-response-v1" as const;
export const DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESPONSE_MAXIMUM_FRAMES_V1 =
  1_024;
export const DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESPONSE_PAYLOAD_QUANTUM_BYTES_V1 =
  998;

const U32_MAX = 0xffff_ffff;
const MAX_I64 = 9_223_372_036_854_775_807n;
const SHA256_BYTES = 32;
const UTF8_ENCODER = new TextEncoder();
const DOMAIN_BYTES = UTF8_ENCODER.encode(
  DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESPONSE_PROTOCOL_IDENTITY_V1,
);
const PREFIX_BYTES = 4 + DOMAIN_BYTES.byteLength + 4;
const FRAME_PREFIX_BYTES = 4;
const MAX_PROTOCOL_FRAME_BYTES = 1_023;
const EMPTY_BYTES = new Uint8Array(0);
const ALLOWANCE_PENDING = Object.freeze({
  _tag: "DeclarativeV2AuthenticatedCommandResponseAllowancePending",
});
type AllowancePending = typeof ALLOWANCE_PENDING;

function isAllowancePending(input: unknown): input is AllowancePending {
  return input === ALLOWANCE_PENDING;
}

const UINT8_ARRAY_BYTE_LENGTH_GETTER =
  Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(Uint8Array.prototype),
    "byteLength",
  )?.get;

export interface DeclarativeV2AuthenticatedCommandResponseBudgetV1 {
  readonly maximumBodyBytes: number;
  readonly maximumCanonicalBytes: number;
  readonly maximumFrameBytes: number;
  readonly maximumPayloadBytes: number;
  readonly maximumFrames: number;
  readonly maximumAllocationBytes: number;
  readonly maximumCopyBytes: number;
  readonly maximumTransitions: number;
}

export interface DeclarativeV2AuthenticatedCommandResponseUsageV1 {
  readonly bodyBytes: number;
  readonly canonicalBytes: number;
  readonly frameBytes: number;
  readonly payloadBytes: number;
  readonly frames: number;
  readonly allocationBytes: number;
  readonly copyBytes: number;
  readonly transitions: number;
}

export interface DeclarativeV2AuthenticatedCommandResponseReceiptV1 {
  readonly delta: DeclarativeV2AuthenticatedCommandResponseUsageV1;
  readonly aggregate: DeclarativeV2AuthenticatedCommandResponseUsageV1;
  readonly transitionCount: number;
}

export interface DeclarativeV2AuthenticatedCommandResponseHeaderV1 {
  readonly kind: "response_header";
  readonly requestSha256: Uint8Array;
  readonly reservationSha256: Uint8Array;
  readonly commandKind: DeclarativeV2VerifierDurableCommandKindV2;
  readonly sequence: bigint;
  readonly analyzerReleaseSha256: Uint8Array;
  readonly analyzerIdentitySha256: Uint8Array;
  readonly verifierIdentitySha256: Uint8Array;
  readonly rangeAndPredecessorTailsSha256: Uint8Array;
}

export interface DeclarativeV2AuthenticatedCommandResponseOutputV1 {
  readonly kind: "output_manifest";
  readonly frame: DeclarativeV2VerifierCommandOutputManifestFrameV2;
}

export interface DeclarativeV2AuthenticatedCommandResponseUsageFrameV1 {
  readonly kind: "actual_command_usage";
  readonly frame: DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "attempt_usage";
  };
}

export interface DeclarativeV2AuthenticatedCommandResponseProgressV1 {
  readonly kind: "next_progress";
  readonly frame: DeclarativeV2VerifierProgressCursorFrameV2;
}

export interface DeclarativeV2AuthenticatedCommandResponsePageManifestV1 {
  readonly kind: "page_manifest";
  readonly frame: DeclarativeV2VerifierEvidencePageManifestFrameV2;
}

export interface DeclarativeV2AuthenticatedCommandResponseTerminalV1 {
  readonly kind: "response_terminal";
  readonly pageCount: bigint;
  readonly pagePayloadByteLength: bigint;
  readonly evidenceByteLength: bigint;
  readonly diagnosticByteLength: bigint;
}

export interface DeclarativeV2AuthenticatedCommandResponsePayloadV1 {
  readonly kind: "payload";
  readonly role: "page" | "evidence" | "diagnostic";
  readonly ordinal: bigint;
  readonly offset: bigint;
  readonly bytes: Uint8Array;
}

export type DeclarativeV2AuthenticatedCommandResponseFrameV1 =
  | DeclarativeV2AuthenticatedCommandResponseHeaderV1
  | DeclarativeV2AuthenticatedCommandResponseOutputV1
  | DeclarativeV2AuthenticatedCommandResponseUsageFrameV1
  | DeclarativeV2AuthenticatedCommandResponseProgressV1
  | DeclarativeV2AuthenticatedCommandResponsePageManifestV1
  | DeclarativeV2AuthenticatedCommandResponseTerminalV1
  | DeclarativeV2AuthenticatedCommandResponsePayloadV1;

export interface DeclarativeV2AuthenticatedCommandResponseEncoderV1 {
  readonly _tag: "DeclarativeV2AuthenticatedCommandResponseEncoderV1";
}

export interface DeclarativeV2AuthenticatedCommandResponseDecoderV1 {
  readonly _tag: "DeclarativeV2AuthenticatedCommandResponseDecoderV1";
}

export interface DeclarativeV2AuthenticatedCommandResponseResultV1 {
  readonly _tag: "DeclarativeV2AuthenticatedCommandResponseResultV1";
}

export interface DeclarativeV2AuthenticatedCommandResponseCursorV1 {
  readonly _tag: "DeclarativeV2AuthenticatedCommandResponseCursorV1";
}

export type DeclarativeV2AuthenticatedCommandResponseStepV1 =
  | Readonly<{
    readonly status: "pending";
    readonly consumedBytes: number;
    readonly receipt: DeclarativeV2AuthenticatedCommandResponseReceiptV1;
  }>
  | Readonly<{
    readonly status: "accepted";
    readonly consumedBytes: number;
    readonly receipt: DeclarativeV2AuthenticatedCommandResponseReceiptV1;
  }>;

export type DeclarativeV2AuthenticatedCommandResponseFinishV1 =
  | Readonly<{
    readonly status: "pending";
    readonly receipt: DeclarativeV2AuthenticatedCommandResponseReceiptV1;
  }>
  | Readonly<{
    readonly status: "complete";
    readonly result: DeclarativeV2AuthenticatedCommandResponseResultV1;
    readonly receipt: DeclarativeV2AuthenticatedCommandResponseReceiptV1;
  }>;

export type DeclarativeV2AuthenticatedCommandResponseCursorStepV1 =
  | Readonly<{
    readonly status: "pending";
    readonly receipt: DeclarativeV2AuthenticatedCommandResponseReceiptV1;
  }>
  | Readonly<{
    readonly status: "chunk";
    readonly bytes: Uint8Array;
    readonly offset: number;
    readonly receipt: DeclarativeV2AuthenticatedCommandResponseReceiptV1;
  }>
  | Readonly<{
    readonly status: "complete";
    readonly receipt: DeclarativeV2AuthenticatedCommandResponseReceiptV1;
  }>;

export class DeclarativeV2AuthenticatedCommandResponseV1Error
  extends Data.TaggedError(
    "DeclarativeV2AuthenticatedCommandResponseV1Error",
  )<{
    readonly operation:
      | "createEncoder"
      | "append"
      | "finishEncoder"
      | "createDecoder"
      | "stepDecoder"
      | "finishDecoder"
      | "openCursor"
      | "stepCursor"
      | "close";
    readonly reason:
      | "invalidInput"
      | "invalidBudget"
      | "bodyBytesExceeded"
      | "canonicalBytesExceeded"
      | "frameBytesExceeded"
      | "payloadBytesExceeded"
      | "framesExceeded"
      | "allocationBytesExceeded"
      | "copyBytesExceeded"
      | "transitionsExceeded"
      | "malformed"
      | "nonCanonical"
      | "unsupportedVersion"
      | "invalidGrammar"
      | "identityMismatch"
      | "digestMismatch"
      | "lineageMismatch"
      | "staleAuthority"
      | "exhausted"
      | "closed";
    readonly path?: string;
    readonly observed?: number;
    readonly maximum?: number;
    readonly protocolCause?: DeclarativeV2VerifierProgressV2Error;
  }> {}

export interface DeclarativeV2AuthenticatedCommandResponseFactoryV1 {
  readonly createEncoder: (input: unknown) => Result.Result<
    Readonly<{
      readonly encoder: DeclarativeV2AuthenticatedCommandResponseEncoderV1;
      readonly receipt: DeclarativeV2AuthenticatedCommandResponseReceiptV1;
    }>,
    DeclarativeV2AuthenticatedCommandResponseV1Error
  >;
  readonly append: (
    encoder: unknown,
    frame: unknown,
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2AuthenticatedCommandResponseStepV1,
    DeclarativeV2AuthenticatedCommandResponseV1Error
  >;
  readonly finishEncoder: (
    encoder: unknown,
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2AuthenticatedCommandResponseFinishV1,
    DeclarativeV2AuthenticatedCommandResponseV1Error
  >;
  readonly createDecoder: (input: unknown) => Result.Result<
    Readonly<{
      readonly decoder: DeclarativeV2AuthenticatedCommandResponseDecoderV1;
      readonly receipt: DeclarativeV2AuthenticatedCommandResponseReceiptV1;
    }>,
    DeclarativeV2AuthenticatedCommandResponseV1Error
  >;
  readonly stepDecoder: (
    decoder: unknown,
    bytes: unknown,
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2AuthenticatedCommandResponseStepV1,
    DeclarativeV2AuthenticatedCommandResponseV1Error
  >;
  readonly finishDecoder: (
    decoder: unknown,
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2AuthenticatedCommandResponseFinishV1,
    DeclarativeV2AuthenticatedCommandResponseV1Error
  >;
  readonly openCursor: (
    result: unknown,
  ) => Result.Result<
    Readonly<{
      readonly cursor: DeclarativeV2AuthenticatedCommandResponseCursorV1;
      readonly receipt: DeclarativeV2AuthenticatedCommandResponseReceiptV1;
    }>,
    DeclarativeV2AuthenticatedCommandResponseV1Error
  >;
  readonly stepCursor: (
    result: unknown,
    cursor: unknown,
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2AuthenticatedCommandResponseCursorStepV1,
    DeclarativeV2AuthenticatedCommandResponseV1Error
  >;
  readonly close: (
    handle: unknown,
  ) => Result.Result<void, DeclarativeV2AuthenticatedCommandResponseV1Error>;
}

type MutableUsage = {
  -readonly [K in keyof DeclarativeV2AuthenticatedCommandResponseUsageV1]:
    number;
};

interface CapturedFrame {
  readonly frame: DeclarativeV2AuthenticatedCommandResponseFrameV1;
  readonly bytes: Uint8Array;
  readonly payloadBytes: number;
}

interface PendingEncodedProgressFrame {
  readonly input: object;
  readonly kind:
    | "output_manifest"
    | "actual_command_usage"
    | "next_progress"
    | "page_manifest";
  readonly bytes: Uint8Array;
}

interface PendingDecodedFrame {
  readonly bytes: Uint8Array;
  readonly payloadBytes: number;
  readonly wireOffset: number;
  readonly wireByteLength: number;
}

interface PendingEncodedPayloadFrame {
  readonly input: object;
  readonly captured: CapturedFrame;
}

interface PendingDecodedPayloadFrame {
  readonly captured: CapturedFrame;
  readonly wireOffset: number;
  readonly wireByteLength: number;
}

type ValidationPhase = "initial" | "pages" | "terminal" | "complete";

interface GrammarState {
  header: DeclarativeV2AuthenticatedCommandResponseHeaderV1 | undefined;
  output: DeclarativeV2VerifierCommandOutputManifestFrameV2 | undefined;
  usage: (DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "attempt_usage";
  }) | undefined;
  progress: DeclarativeV2VerifierProgressCursorFrameV2 | undefined;
  readonly pages: DeclarativeV2VerifierEvidencePageManifestFrameV2[];
  readonly pageCanonicalBytes: Uint8Array[];
  readonly pagePayloadHashes: Sha256Accumulator[];
  readonly evidenceHash: Sha256Accumulator;
  readonly diagnosticHash: Sha256Accumulator;
  terminal: DeclarativeV2AuthenticatedCommandResponseTerminalV1 | undefined;
  progressCanonicalBytes: Uint8Array | undefined;
  pagePayloadBytes: bigint;
  evidenceBytes: bigint;
  diagnosticBytes: bigint;
  lastPagePayloadOrdinal: bigint | undefined;
  lastPagePayloadOffset: bigint;
  evidenceOffset: bigint;
  diagnosticOffset: bigint;
  phase: "header" | "output" | "usage" | "progress" | "metadata" | "payload";
}

interface EncoderState {
  readonly budget: DeclarativeV2AuthenticatedCommandResponseBudgetV1;
  readonly usage: MutableUsage;
  readonly grammar: GrammarState;
  readonly frames: CapturedFrame[];
  wireChunks: Uint8Array[];
  pendingProgressFrame: PendingEncodedProgressFrame | undefined;
  pendingPayloadFrame: PendingEncodedPayloadFrame | undefined;
  validationPhase: ValidationPhase;
  finishIndex: number;
  terminal: "open" | "complete" | "closed" | "failed";
}

interface DecoderState {
  readonly budget: DeclarativeV2AuthenticatedCommandResponseBudgetV1;
  readonly usage: MutableUsage;
  body: Uint8Array;
  inputOffset: number;
  parseOffset: number;
  prefixDone: boolean;
  readonly grammar: GrammarState;
  readonly frames: CapturedFrame[];
  wireChunks: Uint8Array[];
  pendingFrame: PendingDecodedFrame | undefined;
  pendingPayloadFrame: PendingDecodedPayloadFrame | undefined;
  validationPhase: ValidationPhase;
  finishIndex: number;
  terminal: "input" | "parse" | "complete" | "closed" | "failed";
}

interface ResultState {
  readonly budget: DeclarativeV2AuthenticatedCommandResponseBudgetV1;
  readonly usage: MutableUsage;
  chunks: Uint8Array[];
  closed: boolean;
  cursorOpened: boolean;
}

interface CursorState {
  readonly owner: DeclarativeV2AuthenticatedCommandResponseResultV1;
  chunkIndex: number;
  chunkOffset: number;
  outputOffset: number;
  readonly usage: MutableUsage;
  closed: boolean;
}

const BUDGET_KEYS = [
  "maximumBodyBytes",
  "maximumCanonicalBytes",
  "maximumFrameBytes",
  "maximumPayloadBytes",
  "maximumFrames",
  "maximumAllocationBytes",
  "maximumCopyBytes",
  "maximumTransitions",
] as const;

const HEADER_KEYS = [
  "kind",
  "requestSha256",
  "reservationSha256",
  "commandKind",
  "sequence",
  "analyzerReleaseSha256",
  "analyzerIdentitySha256",
  "verifierIdentitySha256",
  "rangeAndPredecessorTailsSha256",
] as const;

export function makeDeclarativeV2AuthenticatedCommandResponseFactoryV1():
  DeclarativeV2AuthenticatedCommandResponseFactoryV1 {
  const encoders = new WeakMap<object, EncoderState>();
  const decoders = new WeakMap<object, DecoderState>();
  const results = new WeakMap<object, ResultState>();
  const cursors = new WeakMap<object, CursorState>();

  const createEncoder:
    DeclarativeV2AuthenticatedCommandResponseFactoryV1["createEncoder"] =
      input => {
        const record = ownDataRecord(input, ["budget"], "createEncoder");
        if (Result.isFailure(record)) return Result.fail(record.failure);
        const budget = captureBudget(record.success.budget, "createEncoder");
        if (Result.isFailure(budget)) return Result.fail(budget.failure);
        const usage = zeroUsage();
        const charged = charge(
          usage,
          budget.success,
          "allocationBytes",
          PREFIX_BYTES,
          "createEncoder",
          "prefix",
        );
        if (Result.isFailure(charged)) return Result.fail(charged.failure);
        const transitioned = charge(
          usage,
          budget.success,
          "transitions",
          1,
          "createEncoder",
          "prefix",
        );
        if (Result.isFailure(transitioned)) {
          return Result.fail(transitioned.failure);
        }
        const handle = Object.freeze({
          _tag: "DeclarativeV2AuthenticatedCommandResponseEncoderV1",
        }) as DeclarativeV2AuthenticatedCommandResponseEncoderV1;
        encoders.set(handle, {
          budget: budget.success,
          usage,
          grammar: newGrammar(),
          frames: [],
          wireChunks: [encodePrefix()],
          pendingProgressFrame: undefined,
          pendingPayloadFrame: undefined,
          validationPhase: "initial",
          finishIndex: 0,
          terminal: "open",
        });
        return Result.succeed(Object.freeze({
          encoder: handle,
          receipt: receipt(zeroUsage(), usage, 1),
        }));
      };

  const append:
    DeclarativeV2AuthenticatedCommandResponseFactoryV1["append"] =
      (rawEncoder, rawFrame, rawAllowance) => {
        const stateResult = encoderState(encoders, rawEncoder, "append");
        if (Result.isFailure(stateResult)) {
          return Result.fail(stateResult.failure);
        }
        if (
          stateResult.success.validationPhase !== "initial" ||
          stateResult.success.finishIndex !== 0
        ) {
          failEncoder(stateResult.success);
          return Result.fail(error("append", "exhausted"));
        }
        const allowance = captureAllowance(rawAllowance, "append");
        if (Result.isFailure(allowance)) {
          failEncoder(stateResult.success);
          return Result.fail(allowance.failure);
        }
        const before = snapshotUsage(stateResult.success.usage);
        if (allowance.success === 0) {
          return Result.succeed(Object.freeze({
            status: "pending",
            consumedBytes: 0,
            receipt: receipt(before, stateResult.success.usage, 0),
          }));
        }
        if (allowance.success < 1_024) {
          return Result.succeed(Object.freeze({
            status: "pending",
            consumedBytes: 0,
            receipt: receipt(before, stateResult.success.usage, 0),
          }));
        }
        const resumingPayload =
          stateResult.success.pendingPayloadFrame !== undefined;
        const captured = resumingPayload
          ? resumePendingPayloadFrame(
            rawFrame,
            stateResult.success,
            allowance.success,
          )
          : stateResult.success.pendingProgressFrame === undefined
          ? captureFrame(rawFrame, stateResult.success, allowance.success)
          : resumePendingProgressFrame(
            rawFrame,
            stateResult.success,
            allowance.success,
          );
        if (Result.isFailure(captured)) {
          failEncoder(stateResult.success);
          return Result.fail(captured.failure);
        }
        if (captured.success === null) {
          const transitionCount =
            stateResult.success.usage.transitions - before.transitions;
          return Result.succeed(Object.freeze({
            status: "pending",
            consumedBytes: 0,
            receipt: receipt(
              before,
              stateResult.success.usage,
              transitionCount,
            ),
          }));
        }
        if (!resumingPayload && captured.success.frame.kind === "payload") {
          stateResult.success.pendingPayloadFrame = Object.freeze({
            input: rawFrame as object,
            captured: captured.success,
          });
          const transitionCount =
            stateResult.success.usage.transitions - before.transitions;
          return Result.succeed(Object.freeze({
            status: "pending",
            consumedBytes: 0,
            receipt: receipt(
              before,
              stateResult.success.usage,
              transitionCount,
            ),
          }));
        }
        const transitionCount =
          stateResult.success.usage.transitions - before.transitions;
        if (transitionCount > allowance.success) {
          throw new Error("A1b2c0b2c0 append allowance invariant violated.");
        }
        const grammar = acceptFrame(
          stateResult.success.grammar,
          captured.success,
          "append",
        );
        if (Result.isFailure(grammar)) {
          failEncoder(stateResult.success);
          return Result.fail(grammar.failure);
        }
        stateResult.success.frames.push(captured.success);
        stateResult.success.wireChunks.push(
          frameLengthPrefix(captured.success.bytes.byteLength),
          captured.success.bytes,
        );
        return Result.succeed(Object.freeze({
          status: "accepted",
          consumedBytes: captured.success.bytes.byteLength,
          receipt: receipt(
            before,
            stateResult.success.usage,
            transitionCount,
          ),
        }));
      };

  const finishEncoder:
    DeclarativeV2AuthenticatedCommandResponseFactoryV1["finishEncoder"] =
      (rawEncoder, rawAllowance) => {
        const stateResult = encoderState(
          encoders,
          rawEncoder,
          "finishEncoder",
        );
        if (Result.isFailure(stateResult)) {
          return Result.fail(stateResult.failure);
        }
        const allowance = captureAllowance(rawAllowance, "finishEncoder");
        if (Result.isFailure(allowance)) {
          failEncoder(stateResult.success);
          return Result.fail(allowance.failure);
        }
        const before = snapshotUsage(stateResult.success.usage);
        if (allowance.success === 0) {
          return Result.succeed(Object.freeze({
            status: "pending",
            receipt: receipt(before, stateResult.success.usage, 0),
          }));
        }
        const validation = runValidationStep(
          stateResult.success,
          allowance.success,
          "finishEncoder",
        );
        if (Result.isFailure(validation)) {
          failEncoder(stateResult.success);
          return Result.fail(validation.failure);
        }
        if (!validation.success.complete) {
          return Result.succeed(Object.freeze({
            status: "pending",
            receipt: receipt(
              before,
              stateResult.success.usage,
              validation.success.transitions,
            ),
          }));
        }
        const finalized = finalizeResult(
          stateResult.success.budget,
          stateResult.success.usage,
          stateResult.success.wireChunks,
          results,
          true,
          "finishEncoder",
        );
        if (Result.isFailure(finalized)) {
          failEncoder(stateResult.success);
          return Result.fail(finalized.failure);
        }
        stateResult.success.terminal = "complete";
        stateResult.success.wireChunks = [];
        stateResult.success.frames.splice(0);
        clearGrammar(stateResult.success.grammar);
        return Result.succeed(Object.freeze({
          status: "complete",
          result: finalized.success,
          receipt: receipt(
            before,
            stateResult.success.usage,
            0,
          ),
        }));
      };

  const createDecoder:
    DeclarativeV2AuthenticatedCommandResponseFactoryV1["createDecoder"] =
      input => {
        const record = ownDataRecord(
          input,
          ["bodyByteLength", "budget"],
          "createDecoder",
        );
        if (Result.isFailure(record)) return Result.fail(record.failure);
        const budget = captureBudget(record.success.budget, "createDecoder");
        if (Result.isFailure(budget)) return Result.fail(budget.failure);
        const bodyByteLength = record.success.bodyByteLength;
        if (
          !isNonNegativeSafeInteger(bodyByteLength) ||
          bodyByteLength === 0 ||
          bodyByteLength > U32_MAX
        ) {
          return Result.fail(error("createDecoder", "invalidInput", "bodyByteLength"));
        }
        const usage = zeroUsage();
        const allocated = charge(
          usage,
          budget.success,
          "allocationBytes",
          bodyByteLength,
          "createDecoder",
          "body",
        );
        if (Result.isFailure(allocated)) return Result.fail(allocated.failure);
        const admitted = charge(
          usage,
          budget.success,
          "bodyBytes",
          bodyByteLength,
          "createDecoder",
          "body",
        );
        if (Result.isFailure(admitted)) return Result.fail(admitted.failure);
        let body: Uint8Array;
        try {
          body = new Uint8Array(bodyByteLength);
        } catch {
          return Result.fail(error(
            "createDecoder",
            "allocationBytesExceeded",
            "body",
            bodyByteLength,
            budget.success.maximumAllocationBytes,
          ));
        }
        const handle = Object.freeze({
          _tag: "DeclarativeV2AuthenticatedCommandResponseDecoderV1",
        }) as DeclarativeV2AuthenticatedCommandResponseDecoderV1;
        decoders.set(handle, {
          budget: budget.success,
          usage,
          body,
          inputOffset: 0,
          parseOffset: 0,
          prefixDone: false,
          grammar: newGrammar(),
          frames: [],
          wireChunks: [body.subarray(0, PREFIX_BYTES)],
          pendingFrame: undefined,
          pendingPayloadFrame: undefined,
          validationPhase: "initial",
          finishIndex: 0,
          terminal: "input",
        });
        return Result.succeed(Object.freeze({
          decoder: handle,
          receipt: receipt(zeroUsage(), usage, 0),
        }));
      };

  const stepDecoder:
    DeclarativeV2AuthenticatedCommandResponseFactoryV1["stepDecoder"] =
      (rawDecoder, rawBytes, rawAllowance) => {
        const stateResult = decoderState(
          decoders,
          rawDecoder,
          "stepDecoder",
        );
        if (Result.isFailure(stateResult)) {
          return Result.fail(stateResult.failure);
        }
        const allowance = captureAllowance(rawAllowance, "stepDecoder");
        if (Result.isFailure(allowance)) {
          failDecoder(stateResult.success);
          return Result.fail(allowance.failure);
        }
        const before = snapshotUsage(stateResult.success.usage);
        if (allowance.success === 0) {
          return Result.succeed(Object.freeze({
            status: "pending",
            consumedBytes: 0,
            receipt: receipt(before, stateResult.success.usage, 0),
          }));
        }
        if (!isUint8Array(rawBytes)) {
          failDecoder(stateResult.success);
          return Result.fail(error("stepDecoder", "invalidInput", "bytes"));
        }
        const byteLength = intrinsicByteLength(rawBytes);
        if (byteLength === undefined || byteLength === 0) {
          failDecoder(stateResult.success);
          return Result.fail(error("stepDecoder", "invalidInput", "bytes"));
        }
        const remaining = stateResult.success.body.byteLength -
          stateResult.success.inputOffset;
        const consumed = Math.min(byteLength, allowance.success, remaining);
        for (let index = 0; index < consumed; index += 1) {
          const candidate = { ...stateResult.success.usage };
          const copied = charge(
            candidate,
            stateResult.success.budget,
            "copyBytes",
            1,
            "stepDecoder",
            "bytes",
          );
          if (Result.isFailure(copied)) {
            failDecoder(stateResult.success);
            return Result.fail(copied.failure);
          }
          const transitioned = charge(
            candidate,
            stateResult.success.budget,
            "transitions",
            1,
            "stepDecoder",
            "bytes",
          );
          if (Result.isFailure(transitioned)) {
            failDecoder(stateResult.success);
            return Result.fail(transitioned.failure);
          }
          Object.assign(stateResult.success.usage, candidate);
          try {
            stateResult.success.body[stateResult.success.inputOffset] =
              rawBytes[index]!;
          } catch {
            failDecoder(stateResult.success);
            return Result.fail(error("stepDecoder", "invalidInput", "bytes"));
          }
          stateResult.success.inputOffset += 1;
        }
        if (byteLength > consumed && consumed === remaining) {
          failDecoder(stateResult.success);
          return Result.fail(error("stepDecoder", "malformed", "trailing"));
        }
        if (stateResult.success.inputOffset === stateResult.success.body.byteLength) {
          stateResult.success.terminal = "parse";
        }
        return Result.succeed(Object.freeze({
          status: stateResult.success.terminal === "parse"
            ? "accepted"
            : "pending",
          consumedBytes: consumed,
          receipt: receipt(before, stateResult.success.usage, consumed),
        }));
      };

  const finishDecoder:
    DeclarativeV2AuthenticatedCommandResponseFactoryV1["finishDecoder"] =
      (rawDecoder, rawAllowance) => {
        const stateResult = decoderState(
          decoders,
          rawDecoder,
          "finishDecoder",
          true,
        );
        if (Result.isFailure(stateResult)) {
          return Result.fail(stateResult.failure);
        }
        const allowance = captureAllowance(rawAllowance, "finishDecoder");
        if (Result.isFailure(allowance)) {
          failDecoder(stateResult.success);
          return Result.fail(allowance.failure);
        }
        const before = snapshotUsage(stateResult.success.usage);
        if (
          allowance.success === 0 ||
          stateResult.success.terminal === "input"
        ) {
          return Result.succeed(Object.freeze({
            status: "pending",
            receipt: receipt(before, stateResult.success.usage, 0),
          }));
        }
        const readyForValidation = stateResult.success.prefixDone &&
          stateResult.success.parseOffset >= stateResult.success.body.byteLength;
        if (!readyForValidation) {
          const parsed = parseNextDecoderUnit(
          stateResult.success,
          allowance.success,
          );
          if (Result.isFailure(parsed)) {
            failDecoder(stateResult.success);
            return Result.fail(parsed.failure);
          }
          return Result.succeed(Object.freeze({
            status: "pending",
            receipt: receipt(
              before,
              stateResult.success.usage,
              parsed.success,
            ),
          }));
        }
        const validation = runValidationStep(
          stateResult.success,
          allowance.success,
          "finishDecoder",
        );
        if (Result.isFailure(validation)) {
          failDecoder(stateResult.success);
          return Result.fail(validation.failure);
        }
        if (!validation.success.complete) {
          return Result.succeed(Object.freeze({
            status: "pending",
            receipt: receipt(
              before,
              stateResult.success.usage,
              validation.success.transitions,
            ),
          }));
        }
        const finalized = finalizeResult(
          stateResult.success.budget,
          stateResult.success.usage,
          stateResult.success.wireChunks,
          results,
          false,
          "finishDecoder",
        );
        if (Result.isFailure(finalized)) {
          failDecoder(stateResult.success);
          return Result.fail(finalized.failure);
        }
        stateResult.success.terminal = "complete";
        stateResult.success.body = EMPTY_BYTES;
        stateResult.success.wireChunks = [];
        stateResult.success.frames.splice(0);
        clearGrammar(stateResult.success.grammar);
        return Result.succeed(Object.freeze({
          status: "complete",
          result: finalized.success,
          receipt: receipt(
            before,
            stateResult.success.usage,
            0,
          ),
        }));
      };

  const openCursor:
    DeclarativeV2AuthenticatedCommandResponseFactoryV1["openCursor"] =
      rawResult => {
        const state = resultState(results, rawResult, "openCursor");
        if (Result.isFailure(state)) return Result.fail(state.failure);
        if (state.success.cursorOpened) {
          return Result.fail(error("openCursor", "exhausted"));
        }
        const before = snapshotUsage(state.success.usage);
        const candidate = { ...state.success.usage };
        const allocated = charge(
          candidate,
          state.success.budget,
          "allocationBytes",
          64,
          "openCursor",
          "cursor",
        );
        if (Result.isFailure(allocated)) return Result.fail(allocated.failure);
        const transitioned = charge(
          candidate,
          state.success.budget,
          "transitions",
          1,
          "openCursor",
          "cursor",
        );
        if (Result.isFailure(transitioned)) {
          return Result.fail(transitioned.failure);
        }
        Object.assign(state.success.usage, candidate);
        state.success.cursorOpened = true;
        const handle = Object.freeze({
          _tag: "DeclarativeV2AuthenticatedCommandResponseCursorV1",
        }) as DeclarativeV2AuthenticatedCommandResponseCursorV1;
        cursors.set(handle, {
          owner: rawResult as DeclarativeV2AuthenticatedCommandResponseResultV1,
          chunkIndex: 0,
          chunkOffset: 0,
          outputOffset: 0,
          usage: { ...state.success.usage },
          closed: false,
        });
        return Result.succeed(Object.freeze({
          cursor: handle,
          receipt: receipt(before, state.success.usage, 1),
        }));
      };

  const stepCursor:
    DeclarativeV2AuthenticatedCommandResponseFactoryV1["stepCursor"] =
      (rawResult, rawCursor, rawAllowance) => {
        const state = resultState(results, rawResult, "stepCursor");
        if (Result.isFailure(state)) return Result.fail(state.failure);
        const cursor = cursorState(
          cursors,
          rawCursor,
          rawResult,
          "stepCursor",
        );
        if (Result.isFailure(cursor)) return Result.fail(cursor.failure);
        const allowance = captureAllowance(rawAllowance, "stepCursor");
        if (Result.isFailure(allowance)) {
          closeCursorAndResult(cursor.success, state.success);
          return Result.fail(allowance.failure);
        }
        const before = snapshotUsage(cursor.success.usage);
        if (allowance.success === 0) {
          return Result.succeed(Object.freeze({
            status: "pending",
            receipt: receipt(before, cursor.success.usage, 0),
          }));
        }
        if (cursor.success.chunkIndex >= state.success.chunks.length) {
          cursor.success.closed = true;
          state.success.closed = true;
          state.success.chunks = [];
          return Result.succeed(Object.freeze({
            status: "complete",
            receipt: receipt(before, cursor.success.usage, 0),
          }));
        }
        const source = state.success.chunks[cursor.success.chunkIndex]!;
        const count = Math.min(
          allowance.success,
          DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESPONSE_PAYLOAD_QUANTUM_BYTES_V1,
          source.byteLength - cursor.success.chunkOffset,
        );
        const candidate = { ...cursor.success.usage };
        const allocation = charge(
          candidate,
          state.success.budget,
          "allocationBytes",
          count,
          "stepCursor",
          "chunk",
        );
        if (Result.isFailure(allocation)) {
          closeCursorAndResult(cursor.success, state.success);
          return Result.fail(allocation.failure);
        }
        const copy = charge(
          candidate,
          state.success.budget,
          "copyBytes",
          count,
          "stepCursor",
          "chunk",
        );
        if (Result.isFailure(copy)) {
          closeCursorAndResult(cursor.success, state.success);
          return Result.fail(copy.failure);
        }
        const transitions = charge(
          candidate,
          state.success.budget,
          "transitions",
          count,
          "stepCursor",
          "chunk",
        );
        if (Result.isFailure(transitions)) {
          closeCursorAndResult(cursor.success, state.success);
          return Result.fail(transitions.failure);
        }
        Object.assign(cursor.success.usage, candidate);
        const bytes = source.slice(
          cursor.success.chunkOffset,
          cursor.success.chunkOffset + count,
        );
        const offset = cursor.success.outputOffset;
        cursor.success.chunkOffset += count;
        cursor.success.outputOffset += count;
        if (cursor.success.chunkOffset === source.byteLength) {
          cursor.success.chunkIndex += 1;
          cursor.success.chunkOffset = 0;
        }
        return Result.succeed(Object.freeze({
          status: "chunk",
          bytes,
          offset,
          receipt: receipt(before, cursor.success.usage, count),
        }));
      };

  const close:
    DeclarativeV2AuthenticatedCommandResponseFactoryV1["close"] =
      rawHandle => {
        if (typeof rawHandle !== "object" || rawHandle === null) {
          return Result.fail(error("close", "staleAuthority"));
        }
        const encoder = encoders.get(rawHandle);
        if (encoder !== undefined) {
          if (encoder.terminal === "closed") {
            return Result.fail(error("close", "closed"));
          }
          failEncoder(encoder, "closed");
          return Result.succeed(undefined);
        }
        const decoder = decoders.get(rawHandle);
        if (decoder !== undefined) {
          if (decoder.terminal === "closed") {
            return Result.fail(error("close", "closed"));
          }
          failDecoder(decoder, "closed");
          return Result.succeed(undefined);
        }
        const result = results.get(rawHandle);
        if (result !== undefined) {
          if (result.closed) return Result.fail(error("close", "closed"));
          result.closed = true;
          result.chunks = [];
          return Result.succeed(undefined);
        }
        const cursor = cursors.get(rawHandle);
        if (cursor !== undefined) {
          if (cursor.closed) return Result.fail(error("close", "closed"));
          cursor.closed = true;
          const owner = results.get(cursor.owner);
          if (owner !== undefined) {
            owner.closed = true;
            owner.chunks = [];
          }
          return Result.succeed(undefined);
        }
        return Result.fail(error("close", "staleAuthority"));
      };

  return Object.freeze({
    createEncoder,
    append,
    finishEncoder,
    createDecoder,
    stepDecoder,
    finishDecoder,
    openCursor,
    stepCursor,
    close,
  });
}

function newGrammar(): GrammarState {
  return {
    header: undefined,
    output: undefined,
    usage: undefined,
    progress: undefined,
    pages: [],
    pageCanonicalBytes: [],
    pagePayloadHashes: [],
    evidenceHash: new Sha256Accumulator(),
    diagnosticHash: new Sha256Accumulator(),
    terminal: undefined,
    progressCanonicalBytes: undefined,
    pagePayloadBytes: 0n,
    evidenceBytes: 0n,
    diagnosticBytes: 0n,
    lastPagePayloadOrdinal: undefined,
    lastPagePayloadOffset: 0n,
    evidenceOffset: 0n,
    diagnosticOffset: 0n,
    phase: "header",
  };
}

function captureFrame(
  input: unknown,
  state: EncoderState,
  allowance: number,
): Result.Result<
  CapturedFrame | null,
  DeclarativeV2AuthenticatedCommandResponseV1Error
> {
  const kindRecord = ownDataRecordLoose(input, "append", "frame");
  if (Result.isFailure(kindRecord)) return Result.fail(kindRecord.failure);
  const kind = kindRecord.success.kind;
  if (kind === "response_header") {
    const record = ownDataRecord(input, HEADER_KEYS, "append");
    if (Result.isFailure(record)) return Result.fail(record.failure);
    const commandKind = captureCommandKind(record.success.commandKind);
    const sequence = captureU64(record.success.sequence, true);
    if (commandKind === undefined || sequence === undefined) {
      return Result.fail(error("append", "invalidInput", "header"));
    }
    const digests = [
      "requestSha256",
      "reservationSha256",
      "analyzerReleaseSha256",
      "analyzerIdentitySha256",
      "verifierIdentitySha256",
      "rangeAndPredecessorTailsSha256",
    ] as const;
    const rawDigests: Uint8Array[] = [];
    for (const key of digests) {
      if (!isUint8ArrayWithByteLength(record.success[key], SHA256_BYTES)) {
        return Result.fail(error("append", "invalidInput", key));
      }
      rawDigests.push(record.success[key]);
    }
    const byteLength = 1 + (6 * SHA256_BYTES) + 1 + 8;
    const admitted = prechargeCapturedFrame(
      state,
      byteLength,
      0,
      6 * SHA256_BYTES,
    );
    if (Result.isFailure(admitted)) return Result.fail(admitted.failure);
    const bytes = new Uint8Array(byteLength);
    bytes[0] = 1;
    let offset = 1;
    for (const digest of rawDigests.slice(0, 2)) {
      bytes.set(digest, offset);
      offset += SHA256_BYTES;
    }
    bytes[offset] = commandKindTag(commandKind);
    offset += 1;
    writeU64(bytes, offset, sequence);
    offset += 8;
    for (const digest of rawDigests.slice(2)) {
      bytes.set(digest, offset);
      offset += SHA256_BYTES;
    }
    offset = 1;
    const requestSha256 = bytes.subarray(offset, offset += SHA256_BYTES);
    const reservationSha256 = bytes.subarray(offset, offset += SHA256_BYTES);
    offset += 1 + 8;
    const analyzerReleaseSha256 = bytes.subarray(
      offset,
      offset += SHA256_BYTES,
    );
    const analyzerIdentitySha256 = bytes.subarray(
      offset,
      offset += SHA256_BYTES,
    );
    const verifierIdentitySha256 = bytes.subarray(
      offset,
      offset += SHA256_BYTES,
    );
    const rangeAndPredecessorTailsSha256 = bytes.subarray(
      offset,
      offset + SHA256_BYTES,
    );
    const frame = Object.freeze({
      kind,
      requestSha256,
      reservationSha256,
      commandKind,
      sequence,
      analyzerReleaseSha256,
      analyzerIdentitySha256,
      verifierIdentitySha256,
      rangeAndPredecessorTailsSha256,
    }) satisfies DeclarativeV2AuthenticatedCommandResponseHeaderV1;
    return capturedLocalFrame(frame, bytes);
  }
  if (
    kind === "output_manifest" ||
    kind === "actual_command_usage" ||
    kind === "next_progress" ||
    kind === "page_manifest"
  ) {
    const record = ownDataRecord(input, ["kind", "frame"], "append");
    if (Result.isFailure(record)) return Result.fail(record.failure);
    let wrapperBytes: Uint8Array | undefined;
    const encoded = encodeDeclarativeV2VerifierProgressFrameIntoV2<
      DeclarativeV2AuthenticatedCommandResponseV1Error | AllowancePending
    >(
      record.success.frame,
      progressFrameBudget(state.budget),
      plan => {
        const byteLength = 1 + 4 + plan.canonicalByteLength;
        if (byteLength > MAX_PROTOCOL_FRAME_BYTES) {
          return Result.fail(error(
            "append",
            "frameBytesExceeded",
            "frame",
            byteLength,
            MAX_PROTOCOL_FRAME_BYTES,
          ));
        }
        const phaseTransitions = byteLength + 1 +
          plan.successfulWork.primitiveTransitions;
        if (phaseTransitions > allowance) {
          return Result.fail(ALLOWANCE_PENDING);
        }
        const admitted = prechargeCapturedFrame(
          state,
          byteLength,
          0,
          0,
          plan.successfulWork,
        );
        if (Result.isFailure(admitted)) {
          return Result.fail(admitted.failure);
        }
        try {
          wrapperBytes = new Uint8Array(byteLength);
        } catch {
          return Result.fail(error(
            "append",
            "allocationBytesExceeded",
            "frame",
            byteLength,
            state.budget.maximumAllocationBytes,
          ));
        }
        wrapperBytes[0] = kind === "output_manifest"
          ? 2
          : kind === "actual_command_usage"
          ? 3
          : kind === "next_progress"
          ? 4
          : 5;
        writeU32(wrapperBytes, 1, plan.canonicalByteLength);
        return Result.succeed(Object.freeze({
          bytes: wrapperBytes,
          byteOffset: 5,
          byteLength: plan.canonicalByteLength,
        }));
      },
    );
    if (Result.isFailure(encoded)) {
      if (isAllowancePending(encoded.failure)) return Result.succeed(null);
      return Result.fail(protocolOrResponseFailure(
        "append",
        kind,
        encoded.failure,
      ));
    }
    state.pendingProgressFrame = Object.freeze({
      input: input as object,
      kind,
      bytes: encoded.success.range.bytes,
    });
    return Result.succeed(null);
  }
  if (kind === "response_terminal") {
    const record = ownDataRecord(
      input,
      [
        "kind",
        "pageCount",
        "pagePayloadByteLength",
        "evidenceByteLength",
        "diagnosticByteLength",
      ],
      "append",
    );
    if (Result.isFailure(record)) return Result.fail(record.failure);
    const values = [
      captureU64(record.success.pageCount, false),
      captureU64(record.success.pagePayloadByteLength, false),
      captureU64(record.success.evidenceByteLength, false),
      captureU64(record.success.diagnosticByteLength, false),
    ];
    if (values.some(value => value === undefined)) {
      return Result.fail(error("append", "invalidInput", "terminal"));
    }
    const frame = Object.freeze({
      kind,
      pageCount: values[0]!,
      pagePayloadByteLength: values[1]!,
      evidenceByteLength: values[2]!,
      diagnosticByteLength: values[3]!,
    }) satisfies DeclarativeV2AuthenticatedCommandResponseTerminalV1;
    const admitted = prechargeCapturedFrame(state, 33, 0, 0);
    if (Result.isFailure(admitted)) return Result.fail(admitted.failure);
    const bytes = new Uint8Array(33);
    bytes[0] = 6;
    values.forEach((value, index) => writeU64(bytes, 1 + (index * 8), value!));
    return capturedLocalFrame(frame, bytes);
  }
  if (kind === "payload") {
    const record = ownDataRecord(
      input,
      ["kind", "role", "ordinal", "offset", "bytes"],
      "append",
    );
    if (Result.isFailure(record)) return Result.fail(record.failure);
    const role = record.success.role;
    const ordinal = captureU64(record.success.ordinal, false);
    const offset = captureU64(record.success.offset, false);
    if (
      (role !== "page" && role !== "evidence" && role !== "diagnostic") ||
      ordinal === undefined ||
      offset === undefined ||
      !isUint8Array(record.success.bytes)
    ) {
      return Result.fail(error("append", "invalidInput", "payload"));
    }
    const length = intrinsicByteLength(record.success.bytes);
    if (
      length === undefined ||
      length === 0 ||
      length > DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESPONSE_PAYLOAD_QUANTUM_BYTES_V1
    ) {
      return Result.fail(error(
        "append",
        "payloadBytesExceeded",
        "payload.bytes",
        length,
        DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESPONSE_PAYLOAD_QUANTUM_BYTES_V1,
      ));
    }
    const byteLength = 1 + 1 + 8 + 8 + 4 + length;
    const admitted = prechargeCapturedFrame(
      state,
      byteLength,
      length,
      length,
    );
    if (Result.isFailure(admitted)) return Result.fail(admitted.failure);
    const bytes = new Uint8Array(byteLength);
    try {
      bytes.set(record.success.bytes, 22);
    } catch {
      return Result.fail(error("append", "invalidInput", "payload.bytes"));
    }
    const owned = bytes.subarray(22);
    const frame = Object.freeze({
      kind,
      role,
      ordinal,
      offset,
      bytes: owned,
    }) satisfies DeclarativeV2AuthenticatedCommandResponsePayloadV1;
    bytes[0] = 7;
    bytes[1] = role === "page" ? 1 : role === "evidence" ? 2 : 3;
    writeU64(bytes, 2, ordinal);
    writeU64(bytes, 10, offset);
    writeU32(bytes, 18, owned.byteLength);
    return Result.succeed(Object.freeze({
      frame,
      bytes,
      payloadBytes: owned.byteLength,
    }));
  }
  return Result.fail(error("append", "invalidGrammar", "frame.kind"));
}

function resumePendingProgressFrame(
  input: unknown,
  state: EncoderState,
  allowance: number,
): Result.Result<
  CapturedFrame | null,
  DeclarativeV2AuthenticatedCommandResponseV1Error
> {
  const pending = state.pendingProgressFrame;
  if (pending === undefined) {
    throw new Error("Missing pending A1b2c0b2c0 progress frame.");
  }
  if (input !== pending.input) {
    return Result.fail(error("append", "invalidInput", "frame.pendingIdentity"));
  }
  const verified = verifyOwnedDeclarativeV2VerifierProgressFrameV2<
    DeclarativeV2AuthenticatedCommandResponseV1Error | AllowancePending
  >(
    Object.freeze({
      bytes: pending.bytes,
      byteOffset: 5,
      byteLength: pending.bytes.byteLength - 5,
    }),
    progressFrameBudget(state.budget),
    plan => {
      if (plan.successfulWorkCeiling.primitiveTransitions > allowance) {
        return Result.fail(ALLOWANCE_PENDING);
      }
      return preflightProtocolWork(
        state,
        plan.successfulWorkCeiling,
        "append",
        pending.kind,
      );
    },
  );
  if (Result.isFailure(verified)) {
    if (isAllowancePending(verified.failure)) return Result.succeed(null);
    return Result.fail(protocolOrResponseFailure(
      "append",
      pending.kind,
      verified.failure,
    ));
  }
  const settled = settleProtocolWork(
    state,
    verified.success.work,
    "append",
    pending.kind,
  );
  if (Result.isFailure(settled)) return Result.fail(settled.failure);
  const expectedKind = pending.kind === "output_manifest"
    ? "command_output_manifest"
    : pending.kind === "actual_command_usage"
    ? "attempt_usage"
    : pending.kind === "next_progress"
    ? "progress_cursor"
    : "evidence_page_manifest";
  if (verified.success.frame.kind !== expectedKind) {
    return Result.fail(error("append", "invalidGrammar", pending.kind));
  }
  const frame = Object.freeze({
    kind: pending.kind,
    frame: verified.success.frame,
  }) as DeclarativeV2AuthenticatedCommandResponseFrameV1;
  state.pendingProgressFrame = undefined;
  state.pendingPayloadFrame = undefined;
  return capturedLocalFrame(frame, pending.bytes);
}

function resumePendingPayloadFrame(
  input: unknown,
  state: EncoderState,
  allowance: number,
): Result.Result<
  CapturedFrame | null,
  DeclarativeV2AuthenticatedCommandResponseV1Error
> {
  const pending = state.pendingPayloadFrame;
  if (pending === undefined) {
    throw new Error("Missing pending A1b2c0b2c0 payload frame.");
  }
  if (input !== pending.input) {
    return Result.fail(error("append", "invalidInput", "frame.pendingIdentity"));
  }
  const transitions = pending.captured.payloadBytes;
  if (transitions > allowance) return Result.succeed(null);
  const charged = charge(
    state.usage,
    state.budget,
    "transitions",
    transitions,
    "append",
    "payloadHash",
  );
  if (Result.isFailure(charged)) return Result.fail(charged.failure);
  state.pendingPayloadFrame = undefined;
  return Result.succeed(pending.captured);
}

function capturedLocalFrame(
  frame: DeclarativeV2AuthenticatedCommandResponseFrameV1,
  bytes: Uint8Array,
): Result.Result<CapturedFrame, DeclarativeV2AuthenticatedCommandResponseV1Error> {
  return bytes.byteLength > MAX_PROTOCOL_FRAME_BYTES
    ? Result.fail(error(
      "append",
      "frameBytesExceeded",
      "frame",
      bytes.byteLength,
      MAX_PROTOCOL_FRAME_BYTES,
    ))
    : Result.succeed(Object.freeze({ frame, bytes, payloadBytes: 0 }));
}

function acceptFrame(
  state: GrammarState,
  captured: CapturedFrame,
  operation: "append" | "finishDecoder",
): Result.Result<void, DeclarativeV2AuthenticatedCommandResponseV1Error> {
  const frame = captured.frame;
  if (state.phase === "header") {
    if (frame.kind !== "response_header") {
      return Result.fail(error(operation, "invalidGrammar", "header"));
    }
    state.header = frame;
    state.phase = "output";
    return Result.succeed(undefined);
  }
  if (state.phase === "output") {
    if (frame.kind !== "output_manifest") {
      return Result.fail(error(operation, "invalidGrammar", "output"));
    }
    state.output = frame.frame;
    state.phase = "usage";
    return Result.succeed(undefined);
  }
  if (state.phase === "usage") {
    if (frame.kind !== "actual_command_usage") {
      return Result.fail(error(operation, "invalidGrammar", "usage"));
    }
    state.usage = frame.frame;
    state.phase = "progress";
    return Result.succeed(undefined);
  }
  if (state.phase === "progress") {
    if (frame.kind !== "next_progress") {
      return Result.fail(error(operation, "invalidGrammar", "progress"));
    }
    state.progress = frame.frame;
    state.progressCanonicalBytes = captured.bytes.subarray(5);
    state.phase = "metadata";
    return Result.succeed(undefined);
  }
  if (state.phase === "metadata") {
    if (frame.kind === "page_manifest") {
      if (state.pages.length >= DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESPONSE_MAXIMUM_FRAMES_V1) {
        return Result.fail(error(operation, "framesExceeded", "pages"));
      }
      state.pages.push(frame.frame);
      state.pageCanonicalBytes.push(captured.bytes.subarray(5));
      state.pagePayloadHashes.push(new Sha256Accumulator());
      return Result.succeed(undefined);
    }
    if (frame.kind !== "response_terminal") {
      return Result.fail(error(operation, "invalidGrammar", "terminal"));
    }
    state.terminal = frame;
    state.phase = "payload";
    return Result.succeed(undefined);
  }
  if (state.phase !== "payload" || frame.kind !== "payload") {
    return Result.fail(error(operation, "invalidGrammar", "payload"));
  }
  if (frame.role === "page") {
    if (state.lastPagePayloadOrdinal === undefined) {
      if (frame.ordinal !== 0n) {
        return Result.fail(error(operation, "lineageMismatch", "pagePayload"));
      }
      state.lastPagePayloadOrdinal = frame.ordinal;
      state.lastPagePayloadOffset = 0n;
    } else if (frame.ordinal !== state.lastPagePayloadOrdinal) {
      const previous = state.pages[Number(state.lastPagePayloadOrdinal)];
      if (
        previous === undefined ||
        state.lastPagePayloadOffset !== previous.payloadByteLength ||
        frame.ordinal !== state.lastPagePayloadOrdinal + 1n
      ) {
        return Result.fail(error(operation, "lineageMismatch", "pagePayload"));
      }
      state.lastPagePayloadOrdinal = frame.ordinal;
      state.lastPagePayloadOffset = 0n;
    }
    if (
      frame.ordinal >= BigInt(state.pages.length) ||
      frame.offset !== state.lastPagePayloadOffset
    ) {
      return Result.fail(error(operation, "lineageMismatch", "pagePayload"));
    }
    state.lastPagePayloadOffset += BigInt(frame.bytes.byteLength);
    state.pagePayloadBytes += BigInt(frame.bytes.byteLength);
    state.pagePayloadHashes[Number(frame.ordinal)]!.update(frame.bytes);
  } else if (frame.role === "evidence") {
    if (frame.ordinal !== 0n || frame.offset !== state.evidenceOffset) {
      return Result.fail(error(operation, "lineageMismatch", "evidencePayload"));
    }
    state.evidenceOffset += BigInt(frame.bytes.byteLength);
    state.evidenceBytes += BigInt(frame.bytes.byteLength);
    state.evidenceHash.update(frame.bytes);
  } else {
    if (frame.ordinal !== 0n || frame.offset !== state.diagnosticOffset) {
      return Result.fail(error(operation, "lineageMismatch", "diagnosticPayload"));
    }
    state.diagnosticOffset += BigInt(frame.bytes.byteLength);
    state.diagnosticBytes += BigInt(frame.bytes.byteLength);
    state.diagnosticHash.update(frame.bytes);
  }
  return Result.succeed(undefined);
}

function initialValidationTransitionCount(state: GrammarState): number {
  return (state.progressCanonicalBytes?.byteLength ?? 0) + 74;
}

function pageValidationTransitionCount(
  state: GrammarState,
  index: number,
): number {
  return 129 + (index > 0
    ? state.pageCanonicalBytes[index - 1]?.byteLength ?? 0
    : 0);
}

function terminalValidationTransitionCount(state: GrammarState): number {
  return state.pages.length === 0
    ? 65
    : 129 + (state.pageCanonicalBytes[state.pages.length - 1]?.byteLength ?? 0);
}

function validateInitialGrammar(
  state: GrammarState,
  operation: "finishEncoder" | "finishDecoder",
): Result.Result<void, DeclarativeV2AuthenticatedCommandResponseV1Error> {
  const header = state.header;
  const output = state.output;
  const progress = state.progress;
  const progressCanonicalBytes = state.progressCanonicalBytes;
  const terminal = state.terminal;
  if (
    header === undefined ||
    output === undefined ||
    state.usage === undefined ||
    progress === undefined ||
    progressCanonicalBytes === undefined ||
    terminal === undefined ||
    state.phase !== "payload"
  ) {
    return Result.fail(error(operation, "invalidGrammar", "response"));
  }
  if (
    !bytesEqualFullScan(header.reservationSha256, output.reservationSha256) ||
    header.commandKind !== output.commandKind ||
    header.sequence !== output.sequence
  ) {
    return Result.fail(error(operation, "identityMismatch", "output"));
  }
  const progressDigest = sha256(progressCanonicalBytes);
  if (
    !bytesEqualFullScan(progressDigest, output.nextProgressSha256) ||
    progress.settledSequence !== header.sequence
  ) {
    return Result.fail(error(operation, "digestMismatch", "nextProgress"));
  }
  const restart = header.commandKind === "parse_module" ||
    header.commandKind === "link_page";
  if (
    restart !== (state.pages.length > 0) ||
    BigInt(state.pages.length) !== terminal.pageCount ||
    state.pagePayloadBytes !== terminal.pagePayloadByteLength ||
    state.evidenceBytes !== terminal.evidenceByteLength ||
    state.diagnosticBytes !== terminal.diagnosticByteLength
  ) {
    return Result.fail(error(operation, "invalidGrammar", "terminal"));
  }
  if (restart && (state.evidenceBytes !== 0n || state.diagnosticBytes !== 0n)) {
    return Result.fail(error(operation, "invalidGrammar", "restartPayload"));
  }
  if (!restart && state.pagePayloadBytes !== 0n) {
    return Result.fail(error(operation, "invalidGrammar", "pagePayload"));
  }
  return Result.succeed(undefined);
}

function validatePageGrammar(
  state: GrammarState,
  index: number,
  operation: "finishEncoder" | "finishDecoder",
): Result.Result<void, DeclarativeV2AuthenticatedCommandResponseV1Error> {
  const header = state.header;
  const page = state.pages[index];
  if (header === undefined || page === undefined) {
    return Result.fail(error(operation, "invalidGrammar", `pages.${index}`));
  }
  if (
    !bytesEqualFullScan(page.reservationSha256, header.reservationSha256) ||
    page.commandKind !== header.commandKind ||
    page.sequence !== header.sequence ||
    page.pageOrdinal !== BigInt(index) ||
    page.payloadByteLength !==
      BigInt(state.pagePayloadHashes[index]!.byteLength) ||
    !bytesEqualFullScan(
      page.payloadSha256,
      state.pagePayloadHashes[index]!.digest(),
    )
  ) {
    return Result.fail(error(operation, "lineageMismatch", `pages.${index}`));
  }
  if (index === 0) {
    return page.predecessorPageSha256 === null
      ? Result.succeed(undefined)
      : Result.fail(error(operation, "lineageMismatch", "pages.0"));
  }
  const previousBytes = state.pageCanonicalBytes[index - 1];
  const previous = state.pages[index - 1];
  if (previousBytes === undefined || previous === undefined) {
    return Result.fail(error(operation, "lineageMismatch", `pages.${index}`));
  }
  const transition = validateDeclarativeV2VerifierEvidencePageTransitionV2(
    previous,
    sha256(previousBytes),
    page,
  );
  return Result.isFailure(transition)
    ? Result.fail(error(operation, "lineageMismatch", `pages.${index}`))
    : Result.succeed(undefined);
}

function validateTerminalGrammar(
  state: GrammarState,
  operation: "finishEncoder" | "finishDecoder",
): Result.Result<void, DeclarativeV2AuthenticatedCommandResponseV1Error> {
  const output = state.output;
  if (output === undefined) {
    return Result.fail(error(operation, "invalidGrammar", "output"));
  }
  if (state.pages.length > 0) {
    const finalIndex = state.pages.length - 1;
    const final = validateDeclarativeV2VerifierFinalEvidencePageV2(
      state.pages[finalIndex],
      sha256(state.pageCanonicalBytes[finalIndex]!),
      output,
    );
    return Result.isFailure(final)
      ? Result.fail(error(operation, "digestMismatch", "finalPage"))
      : Result.succeed(undefined);
  }
  if (
    !bytesEqualFullScan(
      output.evidenceRootSha256,
      state.evidenceHash.digest(),
    ) ||
    !bytesEqualFullScan(
      output.diagnosticsRootSha256,
      state.diagnosticHash.digest(),
    )
  ) {
    return Result.fail(error(operation, "digestMismatch", "payloadRoots"));
  }
  return Result.succeed(undefined);
}

function runValidationStep(
  state: EncoderState | DecoderState,
  allowance: number,
  operation: "finishEncoder" | "finishDecoder",
): Result.Result<
  Readonly<{ readonly complete: boolean; readonly transitions: number }>,
  DeclarativeV2AuthenticatedCommandResponseV1Error
> {
  if (state.validationPhase === "complete") {
    return Result.succeed(Object.freeze({ complete: true, transitions: 0 }));
  }
  const transitions = state.validationPhase === "initial"
    ? initialValidationTransitionCount(state.grammar)
    : state.validationPhase === "pages"
    ? pageValidationTransitionCount(state.grammar, state.finishIndex)
    : terminalValidationTransitionCount(state.grammar);
  if (transitions > allowance) {
    return Result.succeed(Object.freeze({ complete: false, transitions: 0 }));
  }
  const precharged = charge(
    state.usage,
    state.budget,
    "transitions",
    transitions,
    operation,
    "validation",
  );
  if (Result.isFailure(precharged)) return Result.fail(precharged.failure);
  const validated = state.validationPhase === "initial"
    ? validateInitialGrammar(state.grammar, operation)
    : state.validationPhase === "pages"
    ? validatePageGrammar(state.grammar, state.finishIndex, operation)
    : validateTerminalGrammar(state.grammar, operation);
  if (Result.isFailure(validated)) return Result.fail(validated.failure);
  if (state.validationPhase === "initial") {
    state.validationPhase = state.grammar.pages.length === 0
      ? "terminal"
      : "pages";
  } else if (state.validationPhase === "pages") {
    state.finishIndex += 1;
    if (state.finishIndex >= state.grammar.pages.length) {
      state.validationPhase = "terminal";
    }
  } else {
    state.validationPhase = "complete";
  }
  return Result.succeed(Object.freeze({ complete: false, transitions }));
}

function prechargeCapturedFrame(
  state: EncoderState,
  frameByteLength: number,
  payloadByteLength: number,
  copyByteLength: number,
  protocolWork?: DeclarativeV2VerifierProgressFrameWorkV2,
): Result.Result<void, DeclarativeV2AuthenticatedCommandResponseV1Error> {
  const candidate = { ...state.usage };
  const additions = [
    ["bodyBytes", FRAME_PREFIX_BYTES + frameByteLength],
    ["canonicalBytes", FRAME_PREFIX_BYTES + frameByteLength],
    ["frameBytes", FRAME_PREFIX_BYTES + frameByteLength],
    ["payloadBytes", payloadByteLength],
    ["frames", 1],
    [
      "allocationBytes",
      FRAME_PREFIX_BYTES + frameByteLength +
      (protocolWork?.byteStorageAllocationBytes ?? 0),
    ],
    ["copyBytes", copyByteLength + (protocolWork?.byteCopyBytes ?? 0)],
    [
      "transitions",
      frameByteLength + 1 + (protocolWork?.primitiveTransitions ?? 0),
    ],
  ] as const;
  for (const [dimension, amount] of additions) {
    const charged = charge(
      candidate,
      state.budget,
      dimension,
      amount,
      "append",
      "frame",
    );
    if (Result.isFailure(charged)) return charged;
  }
  Object.assign(state.usage, candidate);
  return Result.succeed(undefined);
}

function preflightProtocolWork(
  state: EncoderState | DecoderState,
  work: DeclarativeV2VerifierProgressFrameWorkV2,
  operation: "append" | "finishDecoder",
  path: string,
): Result.Result<void, DeclarativeV2AuthenticatedCommandResponseV1Error> {
  return applyProtocolWork(
    { ...state.usage },
    state.budget,
    work,
    operation,
    path,
  );
}

function settleProtocolWork(
  state: EncoderState | DecoderState,
  work: DeclarativeV2VerifierProgressFrameWorkV2,
  operation: "append" | "finishDecoder",
  path: string,
): Result.Result<void, DeclarativeV2AuthenticatedCommandResponseV1Error> {
  const candidate = { ...state.usage };
  const settled = applyProtocolWork(
    candidate,
    state.budget,
    work,
    operation,
    path,
  );
  if (Result.isFailure(settled)) return settled;
  Object.assign(state.usage, candidate);
  return Result.succeed(undefined);
}

function applyProtocolWork(
  usage: MutableUsage,
  budget: DeclarativeV2AuthenticatedCommandResponseBudgetV1,
  work: DeclarativeV2VerifierProgressFrameWorkV2,
  operation: "append" | "finishDecoder",
  path: string,
): Result.Result<void, DeclarativeV2AuthenticatedCommandResponseV1Error> {
  for (const [dimension, amount] of [
    ["allocationBytes", work.byteStorageAllocationBytes],
    ["copyBytes", work.byteCopyBytes],
    ["transitions", work.primitiveTransitions],
  ] as const) {
    const charged = charge(
      usage,
      budget,
      dimension,
      amount,
      operation,
      path,
    );
    if (Result.isFailure(charged)) return charged;
  }
  return Result.succeed(undefined);
}

function finalizeResult(
  budget: DeclarativeV2AuthenticatedCommandResponseBudgetV1,
  usage: MutableUsage,
  chunks: Uint8Array[],
  results: WeakMap<object, ResultState>,
  chargePrefix: boolean,
  operation: "finishEncoder" | "finishDecoder",
): Result.Result<
  DeclarativeV2AuthenticatedCommandResponseResultV1,
  DeclarativeV2AuthenticatedCommandResponseV1Error
> {
  if (chargePrefix) {
    const candidate = { ...usage };
    const prefixBody = charge(
      candidate,
      budget,
      "bodyBytes",
      PREFIX_BYTES,
      operation,
      "prefix",
    );
    if (Result.isFailure(prefixBody)) return Result.fail(prefixBody.failure);
    const prefixCanonical = charge(
      candidate,
      budget,
      "canonicalBytes",
      PREFIX_BYTES,
      operation,
      "prefix",
    );
    if (Result.isFailure(prefixCanonical)) {
      return Result.fail(prefixCanonical.failure);
    }
    Object.assign(usage, candidate);
  }
  const handle = Object.freeze({
    _tag: "DeclarativeV2AuthenticatedCommandResponseResultV1",
  }) as DeclarativeV2AuthenticatedCommandResponseResultV1;
  results.set(handle, {
    budget,
    usage: { ...usage },
    chunks,
    closed: false,
    cursorOpened: false,
  });
  return Result.succeed(handle);
}

function parseNextDecoderUnit(
  state: DecoderState,
  allowance: number,
): Result.Result<number, DeclarativeV2AuthenticatedCommandResponseV1Error> {
  if (!state.prefixDone) {
    if (allowance < PREFIX_BYTES) return Result.succeed(0);
    const domainLength = readU32(state.body, 0);
    if (
      domainLength !== DOMAIN_BYTES.byteLength ||
      !bytesEqualFullScan(
        state.body.subarray(4, 4 + DOMAIN_BYTES.byteLength),
        DOMAIN_BYTES,
      )
    ) {
      return Result.fail(error("finishDecoder", "malformed", "prefix"));
    }
    const version = readU32(state.body, 4 + DOMAIN_BYTES.byteLength);
    if (
      version !== DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESPONSE_PROTOCOL_VERSION_V1
    ) {
      return Result.fail(error("finishDecoder", "unsupportedVersion", "version"));
    }
    state.prefixDone = true;
    state.parseOffset = PREFIX_BYTES;
    const charged = charge(
      state.usage,
      state.budget,
      "canonicalBytes",
      PREFIX_BYTES,
      "finishDecoder",
      "prefix",
    );
    if (Result.isFailure(charged)) return Result.fail(charged.failure);
    return Result.succeed(PREFIX_BYTES);
  }
  if (state.pendingPayloadFrame !== undefined) {
    const pending = state.pendingPayloadFrame;
    const transitions = pending.captured.payloadBytes;
    if (transitions > allowance) return Result.succeed(0);
    const charged = charge(
      state.usage,
      state.budget,
      "transitions",
      transitions,
      "finishDecoder",
      "payloadHash",
    );
    if (Result.isFailure(charged)) return Result.fail(charged.failure);
    const accepted = acceptFrame(
      state.grammar,
      pending.captured,
      "finishDecoder",
    );
    if (Result.isFailure(accepted)) return Result.fail(accepted.failure);
    state.frames.push(pending.captured);
    state.wireChunks.push(
      state.body.subarray(
        pending.wireOffset,
        pending.wireOffset + pending.wireByteLength,
      ),
    );
    state.parseOffset += pending.wireByteLength;
    state.pendingPayloadFrame = undefined;
    return Result.succeed(transitions);
  }
  if (state.pendingFrame !== undefined) {
    const pending = state.pendingFrame;
    const beforeTransitions = state.usage.transitions;
    const captured = decodeCapturedFrame(pending.bytes, state, allowance);
    if (Result.isFailure(captured)) return Result.fail(captured.failure);
    if (captured.success === null) return Result.succeed(0);
    if (captured.success.payloadBytes !== pending.payloadBytes) {
      return Result.fail(error("finishDecoder", "malformed", "payloadLength"));
    }
    if (captured.success.frame.kind === "payload") {
      state.pendingPayloadFrame = Object.freeze({
        captured: captured.success,
        wireOffset: pending.wireOffset,
        wireByteLength: pending.wireByteLength,
      });
      state.pendingFrame = undefined;
      return Result.succeed(state.usage.transitions - beforeTransitions);
    }
    const accepted = acceptFrame(state.grammar, captured.success, "finishDecoder");
    if (Result.isFailure(accepted)) return Result.fail(accepted.failure);
    state.frames.push(captured.success);
    state.wireChunks.push(
      state.body.subarray(
        pending.wireOffset,
        pending.wireOffset + pending.wireByteLength,
      ),
    );
    state.parseOffset += pending.wireByteLength;
    state.pendingFrame = undefined;
    return Result.succeed(state.usage.transitions - beforeTransitions);
  }
  if (state.parseOffset >= state.body.byteLength) return Result.succeed(1);
  const frameLength = readU32(state.body, state.parseOffset);
  if (
    frameLength === undefined ||
    frameLength === 0 ||
    frameLength > MAX_PROTOCOL_FRAME_BYTES ||
    state.parseOffset + FRAME_PREFIX_BYTES + frameLength > state.body.byteLength
  ) {
    return Result.fail(error("finishDecoder", "malformed", "frame"));
  }
  const transitions = FRAME_PREFIX_BYTES + frameLength;
  if (transitions > allowance) return Result.succeed(0);
  const frameStart = state.parseOffset + FRAME_PREFIX_BYTES;
  const tag = state.body[frameStart];
  const payloadBytes = tag === 7
    ? Math.max(0, frameLength - 22)
    : 0;
  const candidate = { ...state.usage };
  const additions = [
    ["canonicalBytes", transitions],
    ["frameBytes", transitions],
    ["payloadBytes", payloadBytes],
    ["frames", 1],
    ["allocationBytes", frameLength],
    ["copyBytes", frameLength],
    ["transitions", transitions],
  ] as const;
  for (const [dimension, amount] of additions) {
    const charged = charge(
      candidate,
      state.budget,
      dimension,
      amount,
      "finishDecoder",
      "frame",
    );
    if (Result.isFailure(charged)) return Result.fail(charged.failure);
  }
  Object.assign(state.usage, candidate);
  const frameBytes = state.body.slice(
    frameStart,
    frameStart + frameLength,
  );
  state.pendingFrame = Object.freeze({
    bytes: frameBytes,
    payloadBytes,
    wireOffset: state.parseOffset,
    wireByteLength: transitions,
  });
  return Result.succeed(transitions);
}

function decodeCapturedFrame(
  bytes: Uint8Array,
  state: DecoderState,
  allowance: number,
): Result.Result<
  CapturedFrame | null,
  DeclarativeV2AuthenticatedCommandResponseV1Error
> {
  const tag = bytes[0];
  if (!(tag !== undefined && tag >= 2 && tag <= 5)) {
    const localTransitions = bytes.byteLength + 1;
    if (localTransitions > allowance) return Result.succeed(null);
    const charged = charge(
      state.usage,
      state.budget,
      "transitions",
      localTransitions,
      "finishDecoder",
      "frameCanonicality",
    );
    if (Result.isFailure(charged)) return Result.fail(charged.failure);
  }
  if (tag === 1) {
    if (bytes.byteLength !== 1 + (6 * SHA256_BYTES) + 1 + 8) {
      return Result.fail(error("finishDecoder", "malformed", "header"));
    }
    let offset = 1;
    const requestSha256 = bytes.subarray(offset, offset += SHA256_BYTES);
    const reservationSha256 = bytes.subarray(offset, offset += SHA256_BYTES);
    const commandKind = commandKindFromTag(bytes[offset++]!);
    const sequence = readU64(bytes, offset);
    offset += 8;
    if (commandKind === undefined || sequence === undefined || sequence === 0n) {
      return Result.fail(error("finishDecoder", "malformed", "header"));
    }
    const analyzerReleaseSha256 = bytes.subarray(offset, offset += SHA256_BYTES);
    const analyzerIdentitySha256 = bytes.subarray(offset, offset += SHA256_BYTES);
    const verifierIdentitySha256 = bytes.subarray(offset, offset += SHA256_BYTES);
    const rangeAndPredecessorTailsSha256 = bytes.subarray(
      offset,
      offset + SHA256_BYTES,
    );
    const frame = Object.freeze({
      kind: "response_header",
      requestSha256,
      reservationSha256,
      commandKind,
      sequence,
      analyzerReleaseSha256,
      analyzerIdentitySha256,
      verifierIdentitySha256,
      rangeAndPredecessorTailsSha256,
    }) satisfies DeclarativeV2AuthenticatedCommandResponseHeaderV1;
    return compareHeaderCanonicalBytes(bytes, frame)
      ? Result.succeed(Object.freeze({ frame, bytes, payloadBytes: 0 }))
      : Result.fail(error("finishDecoder", "nonCanonical", "header"));
  }
  if (tag >= 2 && tag <= 5) {
    const length = readU32(bytes, 1);
    if (length === undefined || length + 5 !== bytes.byteLength) {
      return Result.fail(error("finishDecoder", "malformed", "progressFrame"));
    }
    const decoded = verifyOwnedDeclarativeV2VerifierProgressFrameV2<
      DeclarativeV2AuthenticatedCommandResponseV1Error | AllowancePending
    >(
      Object.freeze({
        bytes,
        byteOffset: 5,
        byteLength: length,
      }),
      progressFrameBudget(state.budget),
      plan => {
        if (plan.successfulWorkCeiling.primitiveTransitions > allowance) {
          return Result.fail(ALLOWANCE_PENDING);
        }
        return preflightProtocolWork(
          state,
          plan.successfulWorkCeiling,
          "finishDecoder",
          "progressFrame",
        );
      },
    );
    if (Result.isFailure(decoded)) {
      if (isAllowancePending(decoded.failure)) return Result.succeed(null);
      return Result.fail(protocolOrResponseFailure(
        "finishDecoder",
        "progressFrame",
        decoded.failure,
      ));
    }
    const settled = settleProtocolWork(
      state,
      decoded.success.work,
      "finishDecoder",
      "progressFrame",
    );
    if (Result.isFailure(settled)) return Result.fail(settled.failure);
    const expectedKinds = [
      "command_output_manifest",
      "attempt_usage",
      "progress_cursor",
      "evidence_page_manifest",
    ] as const;
    if (decoded.success.frame.kind !== expectedKinds[tag - 2]) {
      return Result.fail(error("finishDecoder", "invalidGrammar", "progressFrame"));
    }
    const kinds = [
      "output_manifest",
      "actual_command_usage",
      "next_progress",
      "page_manifest",
    ] as const;
    const frame = Object.freeze({
      kind: kinds[tag - 2]!,
      frame: decoded.success.frame,
    }) as DeclarativeV2AuthenticatedCommandResponseFrameV1;
    return Result.succeed(Object.freeze({ frame, bytes, payloadBytes: 0 }));
  }
  if (tag === 6) {
    if (bytes.byteLength !== 33) {
      return Result.fail(error("finishDecoder", "malformed", "terminal"));
    }
    const values = [1, 9, 17, 25].map(offset => readU64(bytes, offset));
    if (values.some(value => value === undefined)) {
      return Result.fail(error("finishDecoder", "malformed", "terminal"));
    }
    const frame = Object.freeze({
      kind: "response_terminal",
      pageCount: values[0]!,
      pagePayloadByteLength: values[1]!,
      evidenceByteLength: values[2]!,
      diagnosticByteLength: values[3]!,
    }) satisfies DeclarativeV2AuthenticatedCommandResponseTerminalV1;
    return Result.succeed(Object.freeze({ frame, bytes, payloadBytes: 0 }));
  }
  if (tag === 7) {
    const role = bytes[1] === 1
      ? "page"
      : bytes[1] === 2
      ? "evidence"
      : bytes[1] === 3
      ? "diagnostic"
      : undefined;
    const ordinal = readU64(bytes, 2);
    const offset = readU64(bytes, 10);
    const length = readU32(bytes, 18);
    if (
      role === undefined ||
      ordinal === undefined ||
      offset === undefined ||
      length === undefined ||
      length === 0 ||
      length > DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESPONSE_PAYLOAD_QUANTUM_BYTES_V1 ||
      length + 22 !== bytes.byteLength
    ) {
      return Result.fail(error("finishDecoder", "malformed", "payload"));
    }
    const frame = Object.freeze({
      kind: "payload",
      role,
      ordinal,
      offset,
      bytes: bytes.subarray(22),
    }) satisfies DeclarativeV2AuthenticatedCommandResponsePayloadV1;
    return Result.succeed(Object.freeze({
      frame,
      bytes,
      payloadBytes: length,
    }));
  }
  return Result.fail(error("finishDecoder", "malformed", "tag"));
}

function compareHeaderCanonicalBytes(
  input: Uint8Array,
  frame: DeclarativeV2AuthenticatedCommandResponseHeaderV1,
): boolean {
  let offset = 0;
  let matches = input[offset++] === 1;
  for (const digest of [
    frame.requestSha256,
    frame.reservationSha256,
  ]) {
    for (let index = 0; index < digest.byteLength; index += 1) {
      if (input[offset++] !== digest[index]) matches = false;
    }
  }
  if (input[offset++] !== commandKindTag(frame.commandKind)) matches = false;
  for (let index = 0; index < 8; index += 1) {
    const shift = BigInt((7 - index) * 8);
    const expected = Number((frame.sequence >> shift) & 0xffn);
    if (input[offset++] !== expected) matches = false;
  }
  for (const digest of [
    frame.analyzerReleaseSha256,
    frame.analyzerIdentitySha256,
    frame.verifierIdentitySha256,
    frame.rangeAndPredecessorTailsSha256,
  ]) {
    for (let index = 0; index < digest.byteLength; index += 1) {
      if (input[offset++] !== digest[index]) matches = false;
    }
  }
  return matches && offset === input.byteLength;
}

function captureBudget(
  input: unknown,
  operation: DeclarativeV2AuthenticatedCommandResponseV1Error["operation"],
): Result.Result<
  Readonly<DeclarativeV2AuthenticatedCommandResponseBudgetV1>,
  DeclarativeV2AuthenticatedCommandResponseV1Error
> {
  const record = ownDataRecord(input, BUDGET_KEYS, operation);
  if (Result.isFailure(record)) {
    return Result.fail(error(operation, "invalidBudget", "budget"));
  }
  for (const key of BUDGET_KEYS) {
    if (!isNonNegativeSafeInteger(record.success[key])) {
      return Result.fail(error(operation, "invalidBudget", key));
    }
  }
  if (
    (record.success.maximumBodyBytes as number) > U32_MAX ||
    (record.success.maximumFrames as number) >
      DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESPONSE_MAXIMUM_FRAMES_V1
  ) {
    return Result.fail(error(operation, "invalidBudget", "budget"));
  }
  return Result.succeed(Object.freeze({
    maximumBodyBytes: record.success.maximumBodyBytes as number,
    maximumCanonicalBytes: record.success.maximumCanonicalBytes as number,
    maximumFrameBytes: record.success.maximumFrameBytes as number,
    maximumPayloadBytes: record.success.maximumPayloadBytes as number,
    maximumFrames: record.success.maximumFrames as number,
    maximumAllocationBytes: record.success.maximumAllocationBytes as number,
    maximumCopyBytes: record.success.maximumCopyBytes as number,
    maximumTransitions: record.success.maximumTransitions as number,
  }));
}

function ownDataRecord<const Keys extends readonly string[]>(
  input: unknown,
  keys: Keys,
  operation: DeclarativeV2AuthenticatedCommandResponseV1Error["operation"],
): Result.Result<
  Readonly<Record<Keys[number], unknown>>,
  DeclarativeV2AuthenticatedCommandResponseV1Error
> {
  const loose = ownDataRecordLoose(input, operation, "record");
  if (Result.isFailure(loose)) return loose;
  const actual = Object.keys(loose.success);
  if (
    actual.length !== keys.length ||
    actual.some(key => !keys.includes(key))
  ) {
    return Result.fail(error(operation, "invalidInput", "record"));
  }
  return Result.succeed(loose.success as Readonly<Record<Keys[number], unknown>>);
}

function ownDataRecordLoose(
  input: unknown,
  operation: DeclarativeV2AuthenticatedCommandResponseV1Error["operation"],
  path: string,
): Result.Result<
  Readonly<Record<string, unknown>>,
  DeclarativeV2AuthenticatedCommandResponseV1Error
> {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return Result.fail(error(operation, "invalidInput", path));
    }
    const keys = Reflect.ownKeys(input);
    if (keys.length > 64) {
      return Result.fail(error(operation, "invalidInput", path));
    }
    const output: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    for (const key of keys) {
      if (typeof key !== "string") {
        return Result.fail(error(operation, "invalidInput", path));
      }
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return Result.fail(error(operation, "invalidInput", path));
      }
      output[key] = descriptor.value;
    }
    return Result.succeed(Object.freeze(output));
  } catch {
    return Result.fail(error(operation, "invalidInput", path));
  }
}

function captureAllowance(
  input: unknown,
  operation: DeclarativeV2AuthenticatedCommandResponseV1Error["operation"],
): Result.Result<number, DeclarativeV2AuthenticatedCommandResponseV1Error> {
  return isNonNegativeSafeInteger(input) && input <= 1_024
    ? Result.succeed(input)
    : Result.fail(error(operation, "invalidInput", "allowance"));
}

function captureU64(input: unknown, positive: boolean): bigint | undefined {
  return typeof input === "bigint" &&
      input >= (positive ? 1n : 0n) &&
      input <= MAX_I64
    ? input
    : undefined;
}

function captureCommandKind(
  input: unknown,
): DeclarativeV2VerifierDurableCommandKindV2 | undefined {
  return input === "source_page" ||
      input === "parse_module" ||
      input === "link_page" ||
      input === "registration_page"
    ? input
    : undefined;
}

function charge(
  usage: MutableUsage,
  budget: DeclarativeV2AuthenticatedCommandResponseBudgetV1,
  dimension: keyof DeclarativeV2AuthenticatedCommandResponseUsageV1,
  amount: number,
  operation: DeclarativeV2AuthenticatedCommandResponseV1Error["operation"],
  path: string,
): Result.Result<void, DeclarativeV2AuthenticatedCommandResponseV1Error> {
  const next = usage[dimension] + amount;
  const budgetKey = `maximum${dimension[0]!.toUpperCase()}${dimension.slice(1)}` as
    keyof DeclarativeV2AuthenticatedCommandResponseBudgetV1;
  const maximum = budget[budgetKey];
  if (
    !isNonNegativeSafeInteger(amount) ||
    !isNonNegativeSafeInteger(next) ||
    next > maximum
  ) {
    return Result.fail(error(
      operation,
      `${dimension}Exceeded` as DeclarativeV2AuthenticatedCommandResponseV1Error["reason"],
      path,
      next,
      maximum,
    ));
  }
  usage[dimension] = next;
  return Result.succeed(undefined);
}

function zeroUsage(): MutableUsage {
  return {
    bodyBytes: 0,
    canonicalBytes: 0,
    frameBytes: 0,
    payloadBytes: 0,
    frames: 0,
    allocationBytes: 0,
    copyBytes: 0,
    transitions: 0,
  };
}

function snapshotUsage(
  usage: DeclarativeV2AuthenticatedCommandResponseUsageV1,
): DeclarativeV2AuthenticatedCommandResponseUsageV1 {
  return Object.freeze({ ...usage });
}

function receipt(
  before: DeclarativeV2AuthenticatedCommandResponseUsageV1,
  after: DeclarativeV2AuthenticatedCommandResponseUsageV1,
  transitionCount: number,
): DeclarativeV2AuthenticatedCommandResponseReceiptV1 {
  return Object.freeze({
    delta: Object.freeze({
      bodyBytes: after.bodyBytes - before.bodyBytes,
      canonicalBytes: after.canonicalBytes - before.canonicalBytes,
      frameBytes: after.frameBytes - before.frameBytes,
      payloadBytes: after.payloadBytes - before.payloadBytes,
      frames: after.frames - before.frames,
      allocationBytes: after.allocationBytes - before.allocationBytes,
      copyBytes: after.copyBytes - before.copyBytes,
      transitions: after.transitions - before.transitions,
    }),
    aggregate: snapshotUsage(after),
    transitionCount,
  });
}

function encoderState(
  states: WeakMap<object, EncoderState>,
  input: unknown,
  operation: DeclarativeV2AuthenticatedCommandResponseV1Error["operation"],
): Result.Result<EncoderState, DeclarativeV2AuthenticatedCommandResponseV1Error> {
  if (typeof input !== "object" || input === null) {
    return Result.fail(error(operation, "staleAuthority"));
  }
  const state = states.get(input);
  if (state === undefined) return Result.fail(error(operation, "staleAuthority"));
  if (state.terminal === "closed") return Result.fail(error(operation, "closed"));
  if (state.terminal !== "open") return Result.fail(error(operation, "exhausted"));
  return Result.succeed(state);
}

function decoderState(
  states: WeakMap<object, DecoderState>,
  input: unknown,
  operation: DeclarativeV2AuthenticatedCommandResponseV1Error["operation"],
  allowParse = false,
): Result.Result<DecoderState, DeclarativeV2AuthenticatedCommandResponseV1Error> {
  if (typeof input !== "object" || input === null) {
    return Result.fail(error(operation, "staleAuthority"));
  }
  const state = states.get(input);
  if (state === undefined) return Result.fail(error(operation, "staleAuthority"));
  if (state.terminal === "closed") return Result.fail(error(operation, "closed"));
  if (state.terminal === "complete" || state.terminal === "failed") {
    return Result.fail(error(operation, "exhausted"));
  }
  if (!allowParse && state.terminal !== "input") {
    return Result.fail(error(operation, "exhausted"));
  }
  return Result.succeed(state);
}

function resultState(
  states: WeakMap<object, ResultState>,
  input: unknown,
  operation: DeclarativeV2AuthenticatedCommandResponseV1Error["operation"],
): Result.Result<ResultState, DeclarativeV2AuthenticatedCommandResponseV1Error> {
  if (typeof input !== "object" || input === null) {
    return Result.fail(error(operation, "staleAuthority"));
  }
  const state = states.get(input);
  if (state === undefined) return Result.fail(error(operation, "staleAuthority"));
  return state.closed
    ? Result.fail(error(operation, "closed"))
    : Result.succeed(state);
}

function cursorState(
  states: WeakMap<object, CursorState>,
  input: unknown,
  owner: unknown,
  operation: DeclarativeV2AuthenticatedCommandResponseV1Error["operation"],
): Result.Result<CursorState, DeclarativeV2AuthenticatedCommandResponseV1Error> {
  if (typeof input !== "object" || input === null) {
    return Result.fail(error(operation, "staleAuthority"));
  }
  const state = states.get(input);
  if (state === undefined || state.owner !== owner) {
    return Result.fail(error(operation, "staleAuthority"));
  }
  return state.closed
    ? Result.fail(error(operation, "closed"))
    : Result.succeed(state);
}

function failEncoder(
  state: EncoderState,
  terminal: "failed" | "closed" = "failed",
): void {
  state.terminal = terminal;
  state.pendingProgressFrame = undefined;
  state.frames.splice(0);
  state.wireChunks.splice(0);
  clearGrammar(state.grammar);
}

function failDecoder(
  state: DecoderState,
  terminal: "failed" | "closed" = "failed",
): void {
  state.terminal = terminal;
  state.body = EMPTY_BYTES;
  state.pendingFrame = undefined;
  state.pendingPayloadFrame = undefined;
  state.frames.splice(0);
  state.wireChunks.splice(0);
  clearGrammar(state.grammar);
}

function clearGrammar(state: GrammarState): void {
  state.header = undefined;
  state.output = undefined;
  state.usage = undefined;
  state.progress = undefined;
  state.progressCanonicalBytes = undefined;
  state.terminal = undefined;
  state.pages.splice(0);
  state.pageCanonicalBytes.splice(0);
  state.pagePayloadHashes.splice(0);
  state.evidenceHash.clear();
  state.diagnosticHash.clear();
}

function closeCursorAndResult(
  cursor: CursorState,
  result: ResultState,
): void {
  cursor.closed = true;
  result.closed = true;
  result.chunks = [];
}

function encodePrefix(): Uint8Array {
  const prefix = new Uint8Array(PREFIX_BYTES);
  writeU32(prefix, 0, DOMAIN_BYTES.byteLength);
  prefix.set(DOMAIN_BYTES, 4);
  writeU32(
    prefix,
    4 + DOMAIN_BYTES.byteLength,
    DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESPONSE_PROTOCOL_VERSION_V1,
  );
  return prefix;
}

function frameLengthPrefix(byteLength: number): Uint8Array {
  const output = new Uint8Array(FRAME_PREFIX_BYTES);
  writeU32(output, 0, byteLength);
  return output;
}

function error(
  operation: DeclarativeV2AuthenticatedCommandResponseV1Error["operation"],
  reason: DeclarativeV2AuthenticatedCommandResponseV1Error["reason"],
  path?: string,
  observed?: number,
  maximum?: number,
): DeclarativeV2AuthenticatedCommandResponseV1Error {
  return new DeclarativeV2AuthenticatedCommandResponseV1Error({
    operation,
    reason,
    ...(path === undefined ? {} : { path }),
    ...(observed === undefined ? {} : { observed }),
    ...(maximum === undefined ? {} : { maximum }),
  });
}

function protocolFailure(
  operation: "append" | "finishDecoder",
  path: string,
  cause: DeclarativeV2VerifierProgressV2Error,
): DeclarativeV2AuthenticatedCommandResponseV1Error {
  const reason = cause.reason === "invalidInput"
    ? operation === "append" ? "invalidInput" : "malformed"
    : cause.reason;
  return new DeclarativeV2AuthenticatedCommandResponseV1Error({
    operation,
    reason,
    path,
    ...(cause.observed === undefined ? {} : { observed: cause.observed }),
    ...(cause.maximum === undefined ? {} : { maximum: cause.maximum }),
    protocolCause: cause,
  });
}

function protocolOrResponseFailure(
  operation: "append" | "finishDecoder",
  path: string,
  failure:
    | DeclarativeV2VerifierProgressV2Error
    | DeclarativeV2AuthenticatedCommandResponseV1Error,
): DeclarativeV2AuthenticatedCommandResponseV1Error {
  return failure instanceof DeclarativeV2AuthenticatedCommandResponseV1Error
    ? failure
    : protocolFailure(operation, path, failure);
}

function progressFrameBudget(
  budget: DeclarativeV2AuthenticatedCommandResponseBudgetV1,
): Readonly<{
  readonly maximumFrameBytes: number;
  readonly maximumCanonicalBytes: number;
}> {
  return Object.freeze({
    maximumFrameBytes: Math.min(
      budget.maximumFrameBytes,
      MAX_PROTOCOL_FRAME_BYTES,
    ),
    maximumCanonicalBytes: Math.min(
      budget.maximumCanonicalBytes,
      MAX_PROTOCOL_FRAME_BYTES,
    ),
  });
}

function intrinsicByteLength(value: Uint8Array): number | undefined {
  if (UINT8_ARRAY_BYTE_LENGTH_GETTER === undefined) return undefined;
  try {
    return Reflect.apply(UINT8_ARRAY_BYTE_LENGTH_GETTER, value, []);
  } catch {
    return undefined;
  }
}

function commandKindTag(kind: DeclarativeV2VerifierDurableCommandKindV2): number {
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

function commandKindFromTag(
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

function writeU32(output: Uint8Array, offset: number, value: number): void {
  output[offset] = (value >>> 24) & 0xff;
  output[offset + 1] = (value >>> 16) & 0xff;
  output[offset + 2] = (value >>> 8) & 0xff;
  output[offset + 3] = value & 0xff;
}

function readU32(input: Uint8Array, offset: number): number | undefined {
  return offset + 4 <= input.byteLength
    ? (
      input[offset]! * 0x1_00_00_00 +
      input[offset + 1]! * 0x1_00_00 +
      input[offset + 2]! * 0x1_00 +
      input[offset + 3]!
    )
    : undefined;
}

function writeU64(output: Uint8Array, offset: number, value: bigint): void {
  for (let index = 7; index >= 0; index -= 1) {
    output[offset + index] = Number(value & 0xffn);
    value >>= 8n;
  }
}

function readU64(input: Uint8Array, offset: number): bigint | undefined {
  if (offset + 8 > input.byteLength) return undefined;
  let value = 0n;
  for (let index = 0; index < 8; index += 1) {
    value = (value << 8n) | BigInt(input[offset + index]!);
  }
  return value <= MAX_I64 ? value : undefined;
}

class Sha256Accumulator {
  private readonly hash = new Uint32Array([
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19,
  ]);
  private readonly block = new Uint8Array(64);
  private blockLength = 0;
  private totalBytes = 0;

  get byteLength(): number {
    return this.totalBytes;
  }

  update(input: Uint8Array): void {
    for (let index = 0; index < input.byteLength; index += 1) {
      this.block[this.blockLength] = input[index]!;
      this.blockLength += 1;
      this.totalBytes += 1;
      if (this.blockLength === 64) {
        compressSha256(this.hash, this.block);
        this.blockLength = 0;
        this.block.fill(0);
      }
    }
  }

  digest(): Uint8Array {
    const hash = new Uint32Array(this.hash);
    const finalBlock = new Uint8Array(128);
    finalBlock.set(this.block.subarray(0, this.blockLength));
    finalBlock[this.blockLength] = 0x80;
    const finalLength = this.blockLength < 56 ? 64 : 128;
    let bitLength = BigInt(this.totalBytes) * 8n;
    for (let index = 0; index < 8; index += 1) {
      finalBlock[finalLength - 1 - index] = Number(bitLength & 0xffn);
      bitLength >>= 8n;
    }
    compressSha256(hash, finalBlock.subarray(0, 64));
    if (finalLength === 128) {
      compressSha256(hash, finalBlock.subarray(64, 128));
    }
    const output = new Uint8Array(SHA256_BYTES);
    for (let index = 0; index < hash.length; index += 1) {
      writeU32(output, index * 4, hash[index]!);
    }
    return output;
  }

  clear(): void {
    this.hash.fill(0);
    this.block.fill(0);
    this.blockLength = 0;
    this.totalBytes = 0;
  }
}

// Pure synchronous SHA-256 keeps this capability-free codec independent of a
// host crypto service. It is used only over already-admitted bounded metadata.
function sha256(input: Uint8Array): Uint8Array {
  const accumulator = new Sha256Accumulator();
  accumulator.update(input);
  return accumulator.digest();
}

function compressSha256(hash: Uint32Array, block: Uint8Array): void {
  const words = new Uint32Array(64);
  for (let index = 0; index < 16; index += 1) {
      const offset = index * 4;
      words[index] = (
        (block[offset]! << 24) |
        (block[offset + 1]! << 16) |
        (block[offset + 2]! << 8) |
        block[offset + 3]!
      ) >>> 0;
  }
  for (let index = 16; index < 64; index += 1) {
      const a = words[index - 15]!;
      const b = words[index - 2]!;
      const s0 = rotateRight(a, 7) ^ rotateRight(a, 18) ^ (a >>> 3);
      const s1 = rotateRight(b, 17) ^ rotateRight(b, 19) ^ (b >>> 10);
      words[index] = (
        words[index - 16]! + s0 + words[index - 7]! + s1
      ) >>> 0;
  }
  let [a, b, c, d, e, f, g, h] = hash;
  for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e!, 6) ^ rotateRight(e!, 11) ^ rotateRight(e!, 25);
      const choice = (e! & f!) ^ (~e! & g!);
      const first = (
        h! + s1 + choice + SHA256_CONSTANTS[index]! + words[index]!
      ) >>> 0;
      const s0 = rotateRight(a!, 2) ^ rotateRight(a!, 13) ^ rotateRight(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const second = (s0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d! + first) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (first + second) >>> 0;
  }
  hash[0] = (hash[0]! + a!) >>> 0;
  hash[1] = (hash[1]! + b!) >>> 0;
  hash[2] = (hash[2]! + c!) >>> 0;
  hash[3] = (hash[3]! + d!) >>> 0;
  hash[4] = (hash[4]! + e!) >>> 0;
  hash[5] = (hash[5]! + f!) >>> 0;
  hash[6] = (hash[6]! + g!) >>> 0;
  hash[7] = (hash[7]! + h!) >>> 0;
}

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}

const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
