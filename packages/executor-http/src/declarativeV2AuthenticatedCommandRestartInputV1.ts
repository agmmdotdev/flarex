import {
  bytesEqualFullScan,
  isUint8Array,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { Data, Result } from "effect";
import {
  encodeDeclarativeV2VerifierProgressFrameIntoV2,
  validateDeclarativeV2VerifierFinalEvidencePageV2,
  verifyOwnedDeclarativeV2VerifierProgressFrameV2,
  type DeclarativeV2VerifierCommandOutputManifestFrameV2,
  type DeclarativeV2VerifierDurableCommandKindV2,
  type DeclarativeV2VerifierEvidencePageManifestFrameV2,
  type DeclarativeV2VerifierProgressFrameWorkV2,
  type DeclarativeV2VerifierProgressV2Error,
  type DeclarativeV2VerifierRestartCommandKindV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";

export const
  DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESTART_INPUT_PROTOCOL_IDENTITY_V1 =
    "flarex.executor-http/declarative-v2-authenticated-command-restart-input/v1" as const;
export const
  DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESTART_INPUT_PROTOCOL_VERSION_V1 =
    1 as const;
export const
  DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESTART_INPUT_MEDIA_TYPE_V1 =
    "application/vnd.flarex.declarative-v2-authenticated-command-restart-input-v1" as const;
export const
  DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESTART_INPUT_MAXIMUM_FRAMES_V1 =
    1_024;
export const
  DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESTART_INPUT_MAXIMUM_PAGES_V1 =
    1_024;
export const
  DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESTART_INPUT_PAYLOAD_QUANTUM_BYTES_V1 =
    224;

const U32_MAX = 0xffff_ffff;
const MAX_I64 = 9_223_372_036_854_775_807n;
const SHA256_BYTES = 32;
const FRAME_LENGTH_BYTES = 4;
const PAYLOAD_HEADER_BYTES = 21;
const HEADER_FRAME_BYTES = 339;
const TERMINAL_FRAME_BYTES = 113;
const MAX_PROTOCOL_FRAME_BYTES = 1_019;
const CLAIMED_SOURCE_FIXED_STATE_ALLOCATION_BYTES = 256;
const CLAIM_DIGEST_COUNT = 13;
const CLAIM_SCAN_BYTES = CLAIM_DIGEST_COUNT * SHA256_BYTES * 2;
const CLAIM_FIELD_COUNT = 19;
const CLAIM_TRANSITIONS =
  CLAIM_SCAN_BYTES + 1 + CLAIM_FIELD_COUNT + CLAIM_FIELD_COUNT + 1;
const UTF8_ENCODER = new TextEncoder();
const DOMAIN_BYTES = UTF8_ENCODER.encode(
  DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESTART_INPUT_PROTOCOL_IDENTITY_V1,
);
const PREFIX_BYTES = 4 + DOMAIN_BYTES.byteLength + 4;
const PREFIX = makePrefix();
const EMPTY_BYTES = new Uint8Array(0);
const UINT8_ARRAY_BYTE_LENGTH_GETTER =
  Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(Uint8Array.prototype),
    "byteLength",
  )?.get;

const ALLOWANCE_PENDING = Object.freeze({
  _tag: "DeclarativeV2AuthenticatedCommandRestartInputAllowancePending",
});
type AllowancePending = typeof ALLOWANCE_PENDING;

function isAllowancePending(input: unknown): input is AllowancePending {
  return input === ALLOWANCE_PENDING;
}

export interface DeclarativeV2AuthenticatedCommandRestartInputBudgetV1 {
  readonly maximumBodyBytes: number;
  readonly maximumCanonicalBytes: number;
  readonly maximumFrameBytes: number;
  readonly maximumPayloadBytes: number;
  readonly maximumFrames: number;
  readonly maximumPages: number;
  readonly maximumAllocationBytes: number;
  readonly maximumCopyBytes: number;
  readonly maximumScanBytes: number;
  readonly maximumHashBytes: number;
  readonly maximumTransitions: number;
}

export interface DeclarativeV2AuthenticatedCommandRestartInputUsageV1 {
  readonly bodyBytes: number;
  readonly canonicalBytes: number;
  readonly frameBytes: number;
  readonly payloadBytes: number;
  readonly frames: number;
  readonly pages: number;
  readonly allocationBytes: number;
  readonly copyBytes: number;
  readonly scanBytes: number;
  readonly hashBytes: number;
  readonly transitions: number;
}

export interface DeclarativeV2AuthenticatedCommandRestartInputReceiptV1 {
  readonly delta: DeclarativeV2AuthenticatedCommandRestartInputUsageV1;
  readonly aggregate: DeclarativeV2AuthenticatedCommandRestartInputUsageV1;
  readonly transitionCount: number;
}

export interface DeclarativeV2AuthenticatedCommandRestartInputHeaderV1 {
  readonly kind: "restart_header";
  readonly targetRequestSha256: Uint8Array;
  readonly targetReservationSha256: Uint8Array;
  readonly targetCommandKind: DeclarativeV2VerifierDurableCommandKindV2;
  readonly targetSequence: bigint;
  readonly analyzerReleaseSha256: Uint8Array;
  readonly analyzerIdentitySha256: Uint8Array;
  readonly verifierIdentitySha256: Uint8Array;
  readonly rangeAndPredecessorTailsSha256: Uint8Array;
  readonly sourceReservationSha256: Uint8Array;
  readonly sourceCommandKind: DeclarativeV2VerifierRestartCommandKindV2;
  readonly sourceSequence: bigint;
  readonly sourceAuthenticatedInputSha256: Uint8Array;
  readonly sourceOutputManifestSha256: Uint8Array;
  readonly sourceSettledReceiptSha256: Uint8Array;
}

export interface DeclarativeV2AuthenticatedCommandRestartInputOutputV1 {
  readonly kind: "source_output_manifest";
  readonly frame: DeclarativeV2VerifierCommandOutputManifestFrameV2;
}

export interface DeclarativeV2AuthenticatedCommandRestartInputPageV1 {
  readonly kind: "page_manifest";
  readonly frame: DeclarativeV2VerifierEvidencePageManifestFrameV2;
}

export interface DeclarativeV2AuthenticatedCommandRestartInputTerminalV1 {
  readonly kind: "restart_terminal";
  readonly pageCount: bigint;
  readonly payloadByteLength: bigint;
  readonly finalPageSha256: Uint8Array;
  readonly manifestSequenceSha256: Uint8Array;
  readonly payloadSha256: Uint8Array;
}

export interface DeclarativeV2AuthenticatedCommandRestartInputPayloadV1 {
  readonly kind: "payload";
  readonly pageOrdinal: bigint;
  readonly offset: bigint;
  readonly bytes: Uint8Array;
}

export type DeclarativeV2AuthenticatedCommandRestartInputFrameV1 =
  | DeclarativeV2AuthenticatedCommandRestartInputHeaderV1
  | DeclarativeV2AuthenticatedCommandRestartInputOutputV1
  | DeclarativeV2AuthenticatedCommandRestartInputPageV1
  | DeclarativeV2AuthenticatedCommandRestartInputTerminalV1
  | DeclarativeV2AuthenticatedCommandRestartInputPayloadV1;

export interface DeclarativeV2AuthenticatedCommandRestartInputEncoderV1 {
  readonly _tag: "DeclarativeV2AuthenticatedCommandRestartInputEncoderV1";
}

export interface DeclarativeV2AuthenticatedCommandRestartInputDecoderV1 {
  readonly _tag: "DeclarativeV2AuthenticatedCommandRestartInputDecoderV1";
}

export interface DeclarativeV2AuthenticatedCommandRestartInputSourceV1 {
  readonly _tag: "DeclarativeV2AuthenticatedCommandRestartInputSourceV1";
}

export interface DeclarativeV2AuthenticatedCommandRestartInputClaimedSourceV1 {
  readonly _tag:
    "DeclarativeV2AuthenticatedCommandRestartInputClaimedSourceV1";
}

export interface DeclarativeV2AuthenticatedCommandRestartInputClaimV1 {
  readonly targetRequestSha256: Uint8Array;
  readonly targetReservationSha256: Uint8Array;
  readonly targetCommandKind: DeclarativeV2VerifierDurableCommandKindV2;
  readonly targetSequence: bigint;
  readonly analyzerReleaseSha256: Uint8Array;
  readonly analyzerIdentitySha256: Uint8Array;
  readonly verifierIdentitySha256: Uint8Array;
  readonly rangeAndPredecessorTailsSha256: Uint8Array;
  readonly sourceReservationSha256: Uint8Array;
  readonly sourceCommandKind: DeclarativeV2VerifierRestartCommandKindV2;
  readonly sourceSequence: bigint;
  readonly sourceAuthenticatedInputSha256: Uint8Array;
  readonly sourceOutputManifestSha256: Uint8Array;
  readonly sourceSettledReceiptSha256: Uint8Array;
  readonly pageCount: bigint;
  readonly payloadByteLength: bigint;
  readonly finalPageSha256: Uint8Array;
  readonly manifestSequenceSha256: Uint8Array;
  readonly payloadSha256: Uint8Array;
}

export type DeclarativeV2AuthenticatedCommandRestartInputStepV1 =
  | Readonly<{
    readonly status: "pending";
    readonly consumedBytes: number;
    readonly receipt: DeclarativeV2AuthenticatedCommandRestartInputReceiptV1;
  }>
  | Readonly<{
    readonly status: "accepted";
    readonly consumedBytes: number;
    readonly receipt: DeclarativeV2AuthenticatedCommandRestartInputReceiptV1;
  }>;

export type DeclarativeV2AuthenticatedCommandRestartInputFinishV1 =
  | Readonly<{
    readonly status: "pending";
    readonly receipt: DeclarativeV2AuthenticatedCommandRestartInputReceiptV1;
  }>
  | Readonly<{
    readonly status: "complete";
    readonly source: DeclarativeV2AuthenticatedCommandRestartInputSourceV1;
    readonly receipt: DeclarativeV2AuthenticatedCommandRestartInputReceiptV1;
  }>;

export type DeclarativeV2AuthenticatedCommandRestartInputWireStepV1 =
  | Readonly<{
    readonly status: "pending";
    readonly receipt: DeclarativeV2AuthenticatedCommandRestartInputReceiptV1;
  }>
  | Readonly<{
    readonly status: "chunk";
    readonly bytes: Uint8Array;
    readonly offset: number;
    readonly receipt: DeclarativeV2AuthenticatedCommandRestartInputReceiptV1;
  }>
  | Readonly<{
    readonly status: "complete";
    readonly receipt: DeclarativeV2AuthenticatedCommandRestartInputReceiptV1;
  }>;

export type DeclarativeV2AuthenticatedCommandRestartInputClaimStepV1 =
  | Readonly<{
    readonly status: "pending";
    readonly receipt: DeclarativeV2AuthenticatedCommandRestartInputReceiptV1;
  }>
  | Readonly<{
    readonly status: "complete";
    readonly source:
      DeclarativeV2AuthenticatedCommandRestartInputClaimedSourceV1;
    readonly receipt: DeclarativeV2AuthenticatedCommandRestartInputReceiptV1;
  }>;

export type DeclarativeV2AuthenticatedCommandRestartInputMetadataStepV1 =
  | Readonly<{
    readonly status: "pending";
    readonly receipt: DeclarativeV2AuthenticatedCommandRestartInputReceiptV1;
  }>
  | Readonly<{
    readonly status: "metadata";
    readonly manifestBytes: Uint8Array;
    readonly manifestSha256: Uint8Array;
    readonly receipt: DeclarativeV2AuthenticatedCommandRestartInputReceiptV1;
  }>
  | Readonly<{
    readonly status: "complete";
    readonly receipt: DeclarativeV2AuthenticatedCommandRestartInputReceiptV1;
  }>;

export type DeclarativeV2AuthenticatedCommandRestartInputBodyStepV1 =
  | Readonly<{
    readonly status: "pending";
    readonly receipt: DeclarativeV2AuthenticatedCommandRestartInputReceiptV1;
  }>
  | Readonly<{
    readonly status: "body";
    readonly bytes: Uint8Array;
    readonly receipt: DeclarativeV2AuthenticatedCommandRestartInputReceiptV1;
  }>;

export class DeclarativeV2AuthenticatedCommandRestartInputV1Error
  extends Data.TaggedError(
    "DeclarativeV2AuthenticatedCommandRestartInputV1Error",
  )<{
    readonly operation:
      | "createEncoder"
      | "append"
      | "finishEncoder"
      | "createDecoder"
      | "stepDecoder"
      | "finishDecoder"
      | "claimSource"
      | "stepWire"
      | "metadata"
      | "body"
      | "close";
    readonly reason:
      | "invalidInput"
      | "invalidBudget"
      | "bodyBytesExceeded"
      | "canonicalBytesExceeded"
      | "frameBytesExceeded"
      | "payloadBytesExceeded"
      | "framesExceeded"
      | "pagesExceeded"
      | "allocationBytesExceeded"
      | "copyBytesExceeded"
      | "scanBytesExceeded"
      | "hashBytesExceeded"
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

export interface DeclarativeV2AuthenticatedCommandRestartInputFactoryV1 {
  readonly createEncoder: (input: unknown) => Result.Result<
    Readonly<{
      readonly encoder: DeclarativeV2AuthenticatedCommandRestartInputEncoderV1;
      readonly receipt:
        DeclarativeV2AuthenticatedCommandRestartInputReceiptV1;
    }>,
    DeclarativeV2AuthenticatedCommandRestartInputV1Error
  >;
  readonly append: (
    encoder: unknown,
    frame: unknown,
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2AuthenticatedCommandRestartInputStepV1,
    DeclarativeV2AuthenticatedCommandRestartInputV1Error
  >;
  readonly finishEncoder: (
    encoder: unknown,
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2AuthenticatedCommandRestartInputFinishV1,
    DeclarativeV2AuthenticatedCommandRestartInputV1Error
  >;
  readonly createDecoder: (input: unknown) => Result.Result<
    Readonly<{
      readonly decoder: DeclarativeV2AuthenticatedCommandRestartInputDecoderV1;
      readonly receipt:
        DeclarativeV2AuthenticatedCommandRestartInputReceiptV1;
    }>,
    DeclarativeV2AuthenticatedCommandRestartInputV1Error
  >;
  readonly stepDecoder: (
    decoder: unknown,
    bytes: unknown,
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2AuthenticatedCommandRestartInputStepV1,
    DeclarativeV2AuthenticatedCommandRestartInputV1Error
  >;
  readonly finishDecoder: (
    decoder: unknown,
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2AuthenticatedCommandRestartInputFinishV1,
    DeclarativeV2AuthenticatedCommandRestartInputV1Error
  >;
  readonly stepWire: (
    source: unknown,
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2AuthenticatedCommandRestartInputWireStepV1,
    DeclarativeV2AuthenticatedCommandRestartInputV1Error
  >;
  readonly claimSource: (
    source: unknown,
    claim: unknown,
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2AuthenticatedCommandRestartInputClaimStepV1,
    DeclarativeV2AuthenticatedCommandRestartInputV1Error
  >;
  readonly metadata: (
    source: DeclarativeV2AuthenticatedCommandRestartInputClaimedSourceV1,
    pageOrdinal: unknown,
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2AuthenticatedCommandRestartInputMetadataStepV1,
    DeclarativeV2AuthenticatedCommandRestartInputV1Error
  >;
  readonly body: (
    source: DeclarativeV2AuthenticatedCommandRestartInputClaimedSourceV1,
    pageOrdinal: unknown,
    admittedByteLength: unknown,
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2AuthenticatedCommandRestartInputBodyStepV1,
    DeclarativeV2AuthenticatedCommandRestartInputV1Error
  >;
  readonly close: (
    handle: unknown,
  ) => Result.Result<
    void,
    DeclarativeV2AuthenticatedCommandRestartInputV1Error
  >;
}

type MutableUsage = {
  -readonly [K in keyof DeclarativeV2AuthenticatedCommandRestartInputUsageV1]:
    number;
};

interface CapturedFrame {
  readonly frame: DeclarativeV2AuthenticatedCommandRestartInputFrameV1;
  readonly bytes: Uint8Array;
  readonly canonicalProtocolBytes?: Uint8Array;
  readonly canonicalProtocolSha256?: Uint8Array;
  readonly payloadBytes: number;
}

interface PendingProtocolFrame {
  readonly input: object;
  readonly kind: "source_output_manifest" | "page_manifest";
  readonly bytes: Uint8Array;
  readonly verified: VerifiedProtocolFrame | undefined;
}

interface VerifiedProtocolFrame {
  readonly frame:
    | DeclarativeV2VerifierCommandOutputManifestFrameV2
    | DeclarativeV2VerifierEvidencePageManifestFrameV2;
  readonly canonicalBytes: Uint8Array;
}

interface PageState {
  manifest: DeclarativeV2VerifierEvidencePageManifestFrameV2 | undefined;
  readonly payloadByteLength: bigint;
  manifestBytes: Uint8Array;
  manifestSha256: Uint8Array;
  readonly payloadHash: Sha256Accumulator;
  body: Uint8Array | undefined;
  bodyOffset: number;
}

interface GrammarState {
  header: DeclarativeV2AuthenticatedCommandRestartInputHeaderV1 | undefined;
  output: DeclarativeV2VerifierCommandOutputManifestFrameV2 | undefined;
  outputBytes: Uint8Array | undefined;
  pages: PageState[];
  terminal: DeclarativeV2AuthenticatedCommandRestartInputTerminalV1 | undefined;
  readonly manifestSequenceHash: Sha256Accumulator;
  readonly payloadHash: Sha256Accumulator;
  payloadByteLength: bigint;
  currentPayloadPageOrdinal: bigint;
  currentPayloadOffset: bigint;
  phase: "header" | "output" | "pages" | "payload" | "complete";
  validationIndex: number;
  validationPhase: "pages" | "terminal" | "complete";
}

interface EncoderState {
  readonly budget: DeclarativeV2AuthenticatedCommandRestartInputBudgetV1;
  readonly usage: MutableUsage;
  readonly grammar: GrammarState;
  wireChunks: Uint8Array[];
  pendingProtocolFrame: PendingProtocolFrame | undefined;
  terminal: "open" | "complete" | "failed" | "closed";
}

interface DecoderState {
  readonly budget: DeclarativeV2AuthenticatedCommandRestartInputBudgetV1;
  readonly usage: MutableUsage;
  readonly bodyByteLength: number;
  inputOffset: number;
  prefixOffset: number;
  readonly frameLengthBytes: Uint8Array;
  frameLengthOffset: number;
  frameLength: number | undefined;
  frameTag: number | undefined;
  metadataFrame: Uint8Array | undefined;
  metadataOffset: number;
  readonly payloadHeader: Uint8Array;
  payloadHeaderOffset: number;
  payloadBodyLength: number;
  payloadBodyOffset: number;
  pendingMetadataFrame: Uint8Array | undefined;
  pendingVerifiedProtocolFrame: VerifiedProtocolFrame | undefined;
  readonly grammar: GrammarState;
  terminal: "input" | "finish" | "complete" | "failed" | "closed";
}

interface WireSourceState {
  readonly mode: "wire";
  readonly budget: DeclarativeV2AuthenticatedCommandRestartInputBudgetV1;
  readonly usage: MutableUsage;
  chunks: Uint8Array[];
  chunkIndex: number;
  outputOffset: number;
  closed: boolean;
}

interface RawPageSourceState {
  readonly mode: "rawPages";
  readonly budget: DeclarativeV2AuthenticatedCommandRestartInputBudgetV1;
  readonly usage: MutableUsage;
  header: DeclarativeV2AuthenticatedCommandRestartInputHeaderV1 | undefined;
  terminal:
    | DeclarativeV2AuthenticatedCommandRestartInputTerminalV1
    | undefined;
  pages: PageState[];
  closed: boolean;
}

interface ClaimedPageSourceState {
  readonly mode: "claimedPages";
  readonly budget: DeclarativeV2AuthenticatedCommandRestartInputBudgetV1;
  readonly usage: MutableUsage;
  pages: PageState[];
  nextPageOrdinal: bigint;
  phase: "metadata" | "body";
  closed: boolean;
}

type SourceState =
  | WireSourceState
  | RawPageSourceState
  | ClaimedPageSourceState;

const BUDGET_KEYS = [
  "maximumBodyBytes",
  "maximumCanonicalBytes",
  "maximumFrameBytes",
  "maximumPayloadBytes",
  "maximumFrames",
  "maximumPages",
  "maximumAllocationBytes",
  "maximumCopyBytes",
  "maximumScanBytes",
  "maximumHashBytes",
  "maximumTransitions",
] as const;

const HEADER_KEYS = [
  "kind",
  "targetRequestSha256",
  "targetReservationSha256",
  "targetCommandKind",
  "targetSequence",
  "analyzerReleaseSha256",
  "analyzerIdentitySha256",
  "verifierIdentitySha256",
  "rangeAndPredecessorTailsSha256",
  "sourceReservationSha256",
  "sourceCommandKind",
  "sourceSequence",
  "sourceAuthenticatedInputSha256",
  "sourceOutputManifestSha256",
  "sourceSettledReceiptSha256",
] as const;

const CLAIM_KEYS = [
  "targetRequestSha256",
  "targetReservationSha256",
  "targetCommandKind",
  "targetSequence",
  "analyzerReleaseSha256",
  "analyzerIdentitySha256",
  "verifierIdentitySha256",
  "rangeAndPredecessorTailsSha256",
  "sourceReservationSha256",
  "sourceCommandKind",
  "sourceSequence",
  "sourceAuthenticatedInputSha256",
  "sourceOutputManifestSha256",
  "sourceSettledReceiptSha256",
  "pageCount",
  "payloadByteLength",
  "finalPageSha256",
  "manifestSequenceSha256",
  "payloadSha256",
] as const;

export function makeDeclarativeV2AuthenticatedCommandRestartInputFactoryV1():
  DeclarativeV2AuthenticatedCommandRestartInputFactoryV1 {
  const encoders = new WeakMap<object, EncoderState>();
  const decoders = new WeakMap<object, DecoderState>();
  const sources = new WeakMap<object, SourceState>();

  const createEncoder:
    DeclarativeV2AuthenticatedCommandRestartInputFactoryV1["createEncoder"] =
      input =>
        Result.gen(function* () {
          const record = yield* ownDataRecord(
            input,
            ["budget"],
            "createEncoder",
          );
          const budget = yield* captureBudget(record.budget, "createEncoder");
          const usage = zeroUsage();
          yield* chargeMany(
            usage,
            budget,
            [
              ["bodyBytes", PREFIX_BYTES],
              ["canonicalBytes", PREFIX_BYTES],
              ["frameBytes", PREFIX_BYTES],
              ["allocationBytes", PREFIX_BYTES],
              ["copyBytes", PREFIX_BYTES],
              ["transitions", PREFIX_BYTES],
            ],
            "createEncoder",
            "prefix",
          );
          // SAFETY: the handle is an inert identity token; all encoder
          // state lives in the factory-local map keyed by this object
          // identity, so the brand carries no behavioral claims.
          const handle = Object.freeze({
            _tag: "DeclarativeV2AuthenticatedCommandRestartInputEncoderV1",
          }) as DeclarativeV2AuthenticatedCommandRestartInputEncoderV1;
          encoders.set(handle, {
            budget,
            usage,
            grammar: newGrammar(),
            wireChunks: [new Uint8Array(PREFIX)],
            pendingProtocolFrame: undefined,
            terminal: "open",
          });
          return Object.freeze({
            encoder: handle,
            receipt: receipt(zeroUsage(), usage, PREFIX_BYTES),
          });
        });

  const append:
    DeclarativeV2AuthenticatedCommandRestartInputFactoryV1["append"] =
      (rawEncoder, rawFrame, rawAllowance) => {
        const stateResult = encoderState(encoders, rawEncoder, "append");
        if (Result.isFailure(stateResult)) return Result.fail(stateResult.failure);
        const state = stateResult.success;
        const allowance = captureAllowance(rawAllowance, "append");
        if (Result.isFailure(allowance)) {
          failEncoder(state);
          return Result.fail(allowance.failure);
        }
        const before = snapshotUsage(state.usage);
        if (allowance.success === 0) {
          return Result.succeed(Object.freeze({
            status: "pending",
            consumedBytes: 0,
            receipt: receipt(before, state.usage, 0),
          }));
        }
        const captured = state.pendingProtocolFrame === undefined
          ? captureEncoderFrame(rawFrame, state, allowance.success)
          : resumePendingProtocolFrame(rawFrame, state, allowance.success);
        if (Result.isFailure(captured)) {
          failEncoder(state);
          return Result.fail(captured.failure);
        }
        if (captured.success === null) {
          const transitions = state.usage.transitions - before.transitions;
          return Result.succeed(Object.freeze({
            status: "pending",
            consumedBytes: 0,
            receipt: receipt(before, state.usage, transitions),
          }));
        }
        const accepted = acceptFrame(state.grammar, captured.success, "append");
        if (Result.isFailure(accepted)) {
          failEncoder(state);
          return Result.fail(accepted.failure);
        }
        const lengthBytes = frameLengthPrefix(captured.success.bytes.byteLength);
        state.wireChunks.push(lengthBytes, captured.success.bytes);
        const transitions = state.usage.transitions - before.transitions;
        if (transitions > allowance.success) {
          throw new Error("A1b2c0b2c1a append allowance invariant violated.");
        }
        return Result.succeed(Object.freeze({
          status: "accepted",
          consumedBytes: captured.success.bytes.byteLength,
          receipt: receipt(before, state.usage, transitions),
        }));
      };

  const finishEncoder:
    DeclarativeV2AuthenticatedCommandRestartInputFactoryV1["finishEncoder"] =
      (rawEncoder, rawAllowance) => {
        const stateResult = encoderState(
          encoders,
          rawEncoder,
          "finishEncoder",
        );
        if (Result.isFailure(stateResult)) return Result.fail(stateResult.failure);
        const state = stateResult.success;
        const allowance = captureAllowance(rawAllowance, "finishEncoder");
        if (Result.isFailure(allowance)) {
          failEncoder(state);
          return Result.fail(allowance.failure);
        }
        const before = snapshotUsage(state.usage);
        if (allowance.success === 0) {
          return Result.succeed(Object.freeze({
            status: "pending",
            receipt: receipt(before, state.usage, 0),
          }));
        }
        const validated = validateFinish(
          state.grammar,
          state.usage,
          state.budget,
          allowance.success,
          "finishEncoder",
        );
        if (Result.isFailure(validated)) {
          failEncoder(state);
          return Result.fail(validated.failure);
        }
        if (!validated.success) {
          return Result.succeed(Object.freeze({
            status: "pending",
            receipt: receipt(
              before,
              state.usage,
              state.usage.transitions - before.transitions,
            ),
          }));
        }
        // SAFETY: the source is an inert identity token; all source state
        // lives in the factory-local map keyed by this object identity, so
        // the brand carries no behavioral claims.
        const source = Object.freeze({
          _tag: "DeclarativeV2AuthenticatedCommandRestartInputSourceV1",
        }) as DeclarativeV2AuthenticatedCommandRestartInputSourceV1;
        sources.set(source, {
          mode: "wire",
          budget: state.budget,
          usage: { ...state.usage },
          chunks: state.wireChunks,
          chunkIndex: 0,
          outputOffset: 0,
          closed: false,
        });
        state.terminal = "complete";
        state.wireChunks = [];
        clearGrammar(state.grammar);
        return Result.succeed(Object.freeze({
          status: "complete",
          source,
          receipt: receipt(before, state.usage, 0),
        }));
      };

  const createDecoder:
    DeclarativeV2AuthenticatedCommandRestartInputFactoryV1["createDecoder"] =
      input =>
        Result.gen(function* () {
          const record = yield* ownDataRecord(
            input,
            ["bodyByteLength", "budget"],
            "createDecoder",
          );
          const budget = yield* captureBudget(record.budget, "createDecoder");
          const bodyByteLength = record.bodyByteLength;
          if (
            !isNonNegativeSafeInteger(bodyByteLength) ||
            bodyByteLength <= PREFIX_BYTES ||
            bodyByteLength > U32_MAX
          ) {
            return yield* Result.fail(
              transportError("createDecoder", "invalidInput", "bodyByteLength"),
            );
          }
          const usage = zeroUsage();
          yield* chargeMany(
            usage,
            budget,
            [
              ["bodyBytes", bodyByteLength],
              ["canonicalBytes", bodyByteLength],
              ["allocationBytes", FRAME_LENGTH_BYTES + PAYLOAD_HEADER_BYTES],
            ],
            "createDecoder",
            "body",
          );
          // SAFETY: the handle is an inert identity token; all decoder
          // state lives in the factory-local map keyed by this object
          // identity, so the brand carries no behavioral claims.
          const handle = Object.freeze({
            _tag: "DeclarativeV2AuthenticatedCommandRestartInputDecoderV1",
          }) as DeclarativeV2AuthenticatedCommandRestartInputDecoderV1;
          decoders.set(handle, {
            budget,
            usage,
            bodyByteLength,
            inputOffset: 0,
            prefixOffset: 0,
            frameLengthBytes: new Uint8Array(FRAME_LENGTH_BYTES),
            frameLengthOffset: 0,
            frameLength: undefined,
            frameTag: undefined,
            metadataFrame: undefined,
            metadataOffset: 0,
            payloadHeader: new Uint8Array(PAYLOAD_HEADER_BYTES),
            payloadHeaderOffset: 0,
            payloadBodyLength: 0,
            payloadBodyOffset: 0,
            pendingMetadataFrame: undefined,
            pendingVerifiedProtocolFrame: undefined,
            grammar: newGrammar(),
            terminal: "input",
          });
          return Object.freeze({
            decoder: handle,
            receipt: receipt(zeroUsage(), usage, 0),
          });
        });

  const stepDecoder:
    DeclarativeV2AuthenticatedCommandRestartInputFactoryV1["stepDecoder"] =
      (rawDecoder, rawBytes, rawAllowance) => {
        const stateResult = decoderState(
          decoders,
          rawDecoder,
          "stepDecoder",
        );
        if (Result.isFailure(stateResult)) return Result.fail(stateResult.failure);
        const state = stateResult.success;
        const allowance = captureAllowance(rawAllowance, "stepDecoder");
        if (Result.isFailure(allowance)) {
          failDecoder(state);
          return Result.fail(allowance.failure);
        }
        const before = snapshotUsage(state.usage);
        if (allowance.success === 0) {
          return Result.succeed(Object.freeze({
            status: "pending",
            consumedBytes: 0,
            receipt: receipt(before, state.usage, 0),
          }));
        }
        if (!isUint8Array(rawBytes)) {
          failDecoder(state);
          return Result.fail(
            transportError("stepDecoder", "invalidInput", "bytes"),
          );
        }
        const visibleLength = intrinsicByteLength(rawBytes);
        if (visibleLength === undefined || visibleLength === 0) {
          failDecoder(state);
          return Result.fail(
            transportError("stepDecoder", "invalidInput", "bytes"),
          );
        }
        let consumed = 0;
        while (
          consumed < visibleLength &&
          state.usage.transitions - before.transitions < allowance.success
        ) {
          if (state.pendingMetadataFrame !== undefined) break;
          if (state.inputOffset >= state.bodyByteLength) {
            failDecoder(state);
            return Result.fail(
              transportError("stepDecoder", "malformed", "trailing"),
            );
          }
          const remainingAllowance = allowance.success -
            (state.usage.transitions - before.transitions);
          const advanced = consumeDecoderByte(
            state,
            rawBytes,
            consumed,
            remainingAllowance,
          );
          if (Result.isFailure(advanced)) {
            failDecoder(state);
            return Result.fail(advanced.failure);
          }
          if (!advanced.success) break;
          consumed += 1;
          state.inputOffset += 1;
        }
        if (state.inputOffset === state.bodyByteLength) {
          state.terminal = "finish";
        }
        return Result.succeed(Object.freeze({
          status: state.terminal === "finish" ? "accepted" : "pending",
          consumedBytes: consumed,
          receipt: receipt(
            before,
            state.usage,
            state.usage.transitions - before.transitions,
          ),
        }));
      };

  const finishDecoder:
    DeclarativeV2AuthenticatedCommandRestartInputFactoryV1["finishDecoder"] =
      (rawDecoder, rawAllowance) => {
        const stateResult = decoderState(
          decoders,
          rawDecoder,
          "finishDecoder",
          true,
        );
        if (Result.isFailure(stateResult)) return Result.fail(stateResult.failure);
        const state = stateResult.success;
        const allowance = captureAllowance(rawAllowance, "finishDecoder");
        if (Result.isFailure(allowance)) {
          failDecoder(state);
          return Result.fail(allowance.failure);
        }
        const before = snapshotUsage(state.usage);
        if (allowance.success === 0) {
          return Result.succeed(Object.freeze({
            status: "pending",
            receipt: receipt(before, state.usage, 0),
          }));
        }
        if (state.pendingMetadataFrame !== undefined) {
          const parsed = parsePendingDecoderMetadata(
            state,
            allowance.success,
          );
          if (Result.isFailure(parsed)) {
            failDecoder(state);
            return Result.fail(parsed.failure);
          }
          if (!parsed.success) {
            return Result.succeed(Object.freeze({
              status: "pending",
              receipt: receipt(
                before,
                state.usage,
                state.usage.transitions - before.transitions,
              ),
            }));
          }
        }
        if (
          state.terminal !== "finish" ||
          state.frameLengthOffset !== 0 ||
          state.frameLength !== undefined ||
          state.metadataFrame !== undefined ||
          state.payloadHeaderOffset !== 0 ||
          state.payloadBodyLength !== 0
        ) {
          if (state.terminal === "finish") {
            failDecoder(state);
            return Result.fail(
              transportError("finishDecoder", "invalidGrammar", "truncated"),
            );
          }
          return Result.succeed(Object.freeze({
            status: "pending",
            receipt: receipt(
              before,
              state.usage,
              state.usage.transitions - before.transitions,
            ),
          }));
        }
        const remainingAllowance = allowance.success -
          (state.usage.transitions - before.transitions);
        const validated = validateFinish(
          state.grammar,
          state.usage,
          state.budget,
          remainingAllowance,
          "finishDecoder",
        );
        if (Result.isFailure(validated)) {
          failDecoder(state);
          return Result.fail(validated.failure);
        }
        if (!validated.success) {
          return Result.succeed(Object.freeze({
            status: "pending",
            receipt: receipt(
              before,
              state.usage,
              state.usage.transitions - before.transitions,
            ),
          }));
        }
        // SAFETY: the source is an inert identity token; all source state
        // lives in the factory-local map keyed by this object identity, so
        // the brand carries no behavioral claims.
        const source = Object.freeze({
          _tag: "DeclarativeV2AuthenticatedCommandRestartInputSourceV1",
        }) as DeclarativeV2AuthenticatedCommandRestartInputSourceV1;
        const header = state.grammar.header!;
        const terminal = state.grammar.terminal!;
        const transferredPages = state.grammar.pages;
        state.grammar.pages = [];
        sources.set(source, {
          mode: "rawPages",
          budget: state.budget,
          usage: { ...state.usage },
          header,
          terminal,
          pages: transferredPages,
          closed: false,
        });
        state.terminal = "complete";
        state.pendingMetadataFrame = undefined;
        state.metadataFrame = undefined;
        state.grammar.header = undefined;
        state.grammar.output = undefined;
        state.grammar.outputBytes = undefined;
        state.grammar.terminal = undefined;
        state.grammar.manifestSequenceHash.clear();
        state.grammar.payloadHash.clear();
        return Result.succeed(Object.freeze({
          status: "complete",
          source,
          receipt: receipt(before, state.usage, 0),
        }));
      };

  const claimSource:
    DeclarativeV2AuthenticatedCommandRestartInputFactoryV1["claimSource"] =
      (rawSource, rawClaim, rawAllowance) => {
        const stateResult = sourceState(
          sources,
          rawSource,
          "claimSource",
          "rawPages",
        );
        if (Result.isFailure(stateResult)) return Result.fail(stateResult.failure);
        const state = stateResult.success;
        const claimed = Result.gen(function* () {
          const allowance = yield* captureAllowance(
            rawAllowance,
            "claimSource",
          );
          const before = snapshotUsage(state.usage);
          if (allowance < CLAIM_TRANSITIONS) {
            return Object.freeze({
              status: "pending",
              receipt: receipt(before, state.usage, 0),
            }) satisfies DeclarativeV2AuthenticatedCommandRestartInputClaimStepV1;
          }
          yield* chargeMany(
            state.usage,
            state.budget,
            [
              ["allocationBytes", CLAIMED_SOURCE_FIXED_STATE_ALLOCATION_BYTES],
              ["scanBytes", CLAIM_SCAN_BYTES],
              ["transitions", CLAIM_TRANSITIONS],
            ],
            "claimSource",
            "claim",
          );
          const claim = yield* captureClaim(rawClaim);
          yield* compareClaim(state, claim);
          // SAFETY: the claimed source is an inert identity token; all
          // state lives in the factory-local map keyed by this object
          // identity, so the brand carries no behavioral claims.
          const claimedSource = Object.freeze({
            _tag:
              "DeclarativeV2AuthenticatedCommandRestartInputClaimedSourceV1",
          }) as DeclarativeV2AuthenticatedCommandRestartInputClaimedSourceV1;
          const pages = state.pages;
          state.pages = [];
          state.header = undefined;
          state.terminal = undefined;
          state.closed = true;
          sources.set(claimedSource, {
            mode: "claimedPages",
            budget: state.budget,
            usage: state.usage,
            pages,
            nextPageOrdinal: 0n,
            phase: "metadata",
            closed: false,
          });
          return Object.freeze({
            status: "complete",
            source: claimedSource,
            receipt: receipt(before, state.usage, CLAIM_TRANSITIONS),
          }) satisfies DeclarativeV2AuthenticatedCommandRestartInputClaimStepV1;
        });
        if (Result.isFailure(claimed)) closeSource(state);
        return claimed;
      };

  const stepWire:
    DeclarativeV2AuthenticatedCommandRestartInputFactoryV1["stepWire"] =
      (rawSource, rawAllowance) => {
        const stateResult = sourceState(
          sources,
          rawSource,
          "stepWire",
          "wire",
        );
        if (Result.isFailure(stateResult)) return Result.fail(stateResult.failure);
        const state = stateResult.success;
        const allowance = captureAllowance(rawAllowance, "stepWire");
        if (Result.isFailure(allowance)) {
          closeSource(state);
          return Result.fail(allowance.failure);
        }
        const before = snapshotUsage(state.usage);
        if (allowance.success === 0) {
          return Result.succeed(Object.freeze({
            status: "pending",
            receipt: receipt(before, state.usage, 0),
          }));
        }
        if (state.chunkIndex >= state.chunks.length) {
          closeSource(state);
          return Result.succeed(Object.freeze({
            status: "complete",
            receipt: receipt(before, state.usage, 0),
          }));
        }
        const charged = charge(
          state.usage,
          state.budget,
          "transitions",
          1,
          "stepWire",
          "chunk",
        );
        if (Result.isFailure(charged)) {
          closeSource(state);
          return Result.fail(charged.failure);
        }
        const index = state.chunkIndex;
        const bytes = state.chunks[index]!;
        state.chunks[index] = EMPTY_BYTES;
        state.chunkIndex += 1;
        const offset = state.outputOffset;
        state.outputOffset += bytes.byteLength;
        return Result.succeed(Object.freeze({
          status: "chunk",
          bytes,
          offset,
          receipt: receipt(before, state.usage, 1),
        }));
      };

  const metadata:
    DeclarativeV2AuthenticatedCommandRestartInputFactoryV1["metadata"] =
      (rawSource, rawPageOrdinal, rawAllowance) => {
        const stateResult = sourceState(
          sources,
          rawSource,
          "metadata",
          "claimedPages",
        );
        if (Result.isFailure(stateResult)) return Result.fail(stateResult.failure);
        const state = stateResult.success;
        const allowance = captureAllowance(rawAllowance, "metadata");
        if (Result.isFailure(allowance)) {
          closeSource(state);
          return Result.fail(allowance.failure);
        }
        const pageOrdinal = captureU64(rawPageOrdinal, false);
        if (
          pageOrdinal === undefined ||
          pageOrdinal !== state.nextPageOrdinal ||
          state.phase !== "metadata"
        ) {
          closeSource(state);
          return Result.fail(
            transportError("metadata", "staleAuthority", "pageOrdinal"),
          );
        }
        const before = snapshotUsage(state.usage);
        if (allowance.success === 0) {
          return Result.succeed(Object.freeze({
            status: "pending",
            receipt: receipt(before, state.usage, 0),
          }));
        }
        if (pageOrdinal === BigInt(state.pages.length)) {
          closeSource(state);
          return Result.succeed(Object.freeze({
            status: "complete",
            receipt: receipt(before, state.usage, 0),
          }));
        }
        const charged = charge(
          state.usage,
          state.budget,
          "transitions",
          1,
          "metadata",
          "metadata",
        );
        if (Result.isFailure(charged)) {
          closeSource(state);
          return Result.fail(charged.failure);
        }
        const page = state.pages[Number(pageOrdinal)]!;
        const manifestBytes = page.manifestBytes;
        const manifestSha256 = page.manifestSha256;
        page.manifestBytes = EMPTY_BYTES;
        page.manifestSha256 = EMPTY_BYTES;
        page.manifest = undefined;
        state.phase = "body";
        return Result.succeed(Object.freeze({
          status: "metadata",
          manifestBytes,
          manifestSha256,
          receipt: receipt(before, state.usage, 1),
        }));
      };

  const body:
    DeclarativeV2AuthenticatedCommandRestartInputFactoryV1["body"] =
      (
        rawSource,
        rawPageOrdinal,
        rawAdmittedByteLength,
        rawAllowance,
      ) => {
        const stateResult = sourceState(
          sources,
          rawSource,
          "body",
          "claimedPages",
        );
        if (Result.isFailure(stateResult)) return Result.fail(stateResult.failure);
        const state = stateResult.success;
        const allowance = captureAllowance(rawAllowance, "body");
        if (Result.isFailure(allowance)) {
          closeSource(state);
          return Result.fail(allowance.failure);
        }
        const pageOrdinal = captureU64(rawPageOrdinal, false);
        const admittedByteLength = captureU64(rawAdmittedByteLength, true);
        const page = pageOrdinal === undefined
          ? undefined
          : state.pages[Number(pageOrdinal)];
        if (
          pageOrdinal === undefined ||
          admittedByteLength === undefined ||
          pageOrdinal !== state.nextPageOrdinal ||
          state.phase !== "body" ||
          page === undefined ||
          admittedByteLength !== page.payloadByteLength ||
          page.body === undefined
        ) {
          closeSource(state);
          return Result.fail(
            transportError("body", "staleAuthority", "pageOrdinal"),
          );
        }
        const before = snapshotUsage(state.usage);
        if (allowance.success === 0) {
          return Result.succeed(Object.freeze({
            status: "pending",
            receipt: receipt(before, state.usage, 0),
          }));
        }
        const charged = charge(
          state.usage,
          state.budget,
          "transitions",
          1,
          "body",
          "body",
        );
        if (Result.isFailure(charged)) {
          closeSource(state);
          return Result.fail(charged.failure);
        }
        const bytes = page.body;
        page.body = undefined;
        state.nextPageOrdinal += 1n;
        state.phase = "metadata";
        return Result.succeed(Object.freeze({
          status: "body",
          bytes,
          receipt: receipt(before, state.usage, 1),
        }));
      };

  const close:
    DeclarativeV2AuthenticatedCommandRestartInputFactoryV1["close"] =
      rawHandle => {
        if (typeof rawHandle !== "object" || rawHandle === null) {
          return Result.fail(transportError("close", "staleAuthority"));
        }
        const encoder = encoders.get(rawHandle);
        if (encoder !== undefined) {
          if (encoder.terminal === "closed") {
            return Result.fail(transportError("close", "closed"));
          }
          failEncoder(encoder, "closed");
          return Result.succeed(undefined);
        }
        const decoder = decoders.get(rawHandle);
        if (decoder !== undefined) {
          if (decoder.terminal === "closed") {
            return Result.fail(transportError("close", "closed"));
          }
          failDecoder(decoder, "closed");
          return Result.succeed(undefined);
        }
        const source = sources.get(rawHandle);
        if (source !== undefined) {
          if (source.closed) return Result.fail(transportError("close", "closed"));
          closeSource(source);
          return Result.succeed(undefined);
        }
        return Result.fail(transportError("close", "staleAuthority"));
      };

  return Object.freeze({
    createEncoder,
    append,
    finishEncoder,
    createDecoder,
    stepDecoder,
    finishDecoder,
    claimSource,
    stepWire,
    metadata,
    body,
    close,
  });
}

function newGrammar(): GrammarState {
  return {
    header: undefined,
    output: undefined,
    outputBytes: undefined,
    pages: [],
    terminal: undefined,
    manifestSequenceHash: new Sha256Accumulator(),
    payloadHash: new Sha256Accumulator(),
    payloadByteLength: 0n,
    currentPayloadPageOrdinal: 0n,
    currentPayloadOffset: 0n,
    phase: "header",
    validationIndex: 0,
    validationPhase: "pages",
  };
}

function captureEncoderFrame(
  input: unknown,
  state: EncoderState,
  allowance: number,
): Result.Result<
  CapturedFrame | null,
  DeclarativeV2AuthenticatedCommandRestartInputV1Error
> {
  const record = ownDataRecordLoose(input, "append", "frame");
  if (Result.isFailure(record)) return Result.fail(record.failure);
  const kind = record.success.kind;
  if (kind === "restart_header") {
    return captureHeader(input, state, allowance);
  }
  if (kind === "source_output_manifest" || kind === "page_manifest") {
    const exact = ownDataRecord(input, ["kind", "frame"], "append");
    if (Result.isFailure(exact)) return Result.fail(exact.failure);
    let wrapper: Uint8Array | undefined;
    const encoded = encodeDeclarativeV2VerifierProgressFrameIntoV2<
      DeclarativeV2AuthenticatedCommandRestartInputV1Error | AllowancePending
    >(
      exact.success.frame,
      progressFrameBudget(state.budget),
      plan => {
        const frameByteLength = 5 + plan.canonicalByteLength;
        const requiredTransitions = frameByteLength +
          plan.successfulWork.primitiveTransitions;
        if (
          frameByteLength > 5 + MAX_PROTOCOL_FRAME_BYTES ||
          requiredTransitions > allowance
        ) {
          return frameByteLength > 5 + MAX_PROTOCOL_FRAME_BYTES
            ? Result.fail(transportError(
              "append",
              "frameBytesExceeded",
              kind,
              frameByteLength,
              5 + MAX_PROTOCOL_FRAME_BYTES,
            ))
            : Result.fail(ALLOWANCE_PENDING);
        }
        const admitted = prechargeEncoderFrame(
          state,
          frameByteLength,
          0,
          0,
          plan.successfulWork,
          0,
          0,
          kind === "page_manifest" ? 1 : 0,
        );
        if (Result.isFailure(admitted)) return Result.fail(admitted.failure);
        try {
          wrapper = new Uint8Array(frameByteLength);
        } catch {
          return Result.fail(transportError(
            "append",
            "allocationBytesExceeded",
            kind,
            frameByteLength,
            state.budget.maximumAllocationBytes,
          ));
        }
        wrapper[0] = kind === "source_output_manifest" ? 2 : 3;
        writeU32(wrapper, 1, plan.canonicalByteLength);
        return Result.succeed(Object.freeze({
          bytes: wrapper,
          byteOffset: 5,
          byteLength: plan.canonicalByteLength,
        }));
      },
    );
    if (Result.isFailure(encoded)) {
      return isAllowancePending(encoded.failure)
        ? Result.succeed(null)
        : Result.fail(protocolOrTransportFailure("append", kind, encoded.failure));
    }
    // SAFETY: ownDataRecordLoose proved the input is a non-null non-array
    // object; it is retained only for identity comparison on resume.
    state.pendingProtocolFrame = Object.freeze({
      input: input as object,
      kind,
      bytes: encoded.success.range.bytes,
      verified: undefined,
    });
    return Result.succeed(null);
  }
  if (kind === "restart_terminal") {
    return captureTerminal(input, state, allowance);
  }
  if (kind === "payload") {
    return capturePayload(input, state, allowance);
  }
  return Result.fail(
    transportError("append", "invalidGrammar", "frame.kind"),
  );
}

function captureHeader(
  input: unknown,
  state: EncoderState,
  allowance: number,
): Result.Result<
  CapturedFrame | null,
  DeclarativeV2AuthenticatedCommandRestartInputV1Error
> {
  const record = ownDataRecord(input, HEADER_KEYS, "append");
  if (Result.isFailure(record)) return Result.fail(record.failure);
  const targetCommandKind = captureCommandKind(record.success.targetCommandKind);
  const sourceCommandKind = captureRestartKind(record.success.sourceCommandKind);
  const targetSequence = captureU64(record.success.targetSequence, true);
  const sourceSequence = captureU64(record.success.sourceSequence, true);
  if (
    targetCommandKind === undefined ||
    sourceCommandKind === undefined ||
    targetSequence === undefined ||
    sourceSequence === undefined
  ) {
    return Result.fail(transportError("append", "invalidInput", "header"));
  }
  const digestKeys = [
    "targetRequestSha256",
    "targetReservationSha256",
    "analyzerReleaseSha256",
    "analyzerIdentitySha256",
    "verifierIdentitySha256",
    "rangeAndPredecessorTailsSha256",
    "sourceReservationSha256",
    "sourceAuthenticatedInputSha256",
    "sourceOutputManifestSha256",
    "sourceSettledReceiptSha256",
  ] as const;
  for (const key of digestKeys) {
    if (!isUint8ArrayWithByteLength(record.success[key], SHA256_BYTES)) {
      return Result.fail(transportError("append", "invalidInput", key));
    }
  }
  const acceptanceTransitions = localAcceptanceTransitions(
    state.grammar,
    "restart_header",
  );
  const requiredTransitions = HEADER_FRAME_BYTES + acceptanceTransitions;
  if (requiredTransitions > allowance) return Result.succeed(null);
  const admitted = prechargeEncoderFrame(
    state,
    HEADER_FRAME_BYTES,
    0,
    SHA256_BYTES * digestKeys.length,
    undefined,
    0,
    0,
    0,
    acceptanceTransitions,
  );
  if (Result.isFailure(admitted)) return Result.fail(admitted.failure);
  const bytes = new Uint8Array(HEADER_FRAME_BYTES);
  bytes[0] = 1;
  let offset = 1;
  copyDigest(bytes, offset, record.success.targetRequestSha256);
  const targetRequestSha256 = bytes.subarray(offset, offset += SHA256_BYTES);
  copyDigest(bytes, offset, record.success.targetReservationSha256);
  const targetReservationSha256 = bytes.subarray(
    offset,
    offset += SHA256_BYTES,
  );
  bytes[offset++] = commandKindTag(targetCommandKind);
  writeU64(bytes, offset, targetSequence);
  offset += 8;
  copyDigest(bytes, offset, record.success.analyzerReleaseSha256);
  const analyzerReleaseSha256 = bytes.subarray(offset, offset += SHA256_BYTES);
  copyDigest(bytes, offset, record.success.analyzerIdentitySha256);
  const analyzerIdentitySha256 = bytes.subarray(offset, offset += SHA256_BYTES);
  copyDigest(bytes, offset, record.success.verifierIdentitySha256);
  const verifierIdentitySha256 = bytes.subarray(offset, offset += SHA256_BYTES);
  copyDigest(bytes, offset, record.success.rangeAndPredecessorTailsSha256);
  const rangeAndPredecessorTailsSha256 = bytes.subarray(
    offset,
    offset += SHA256_BYTES,
  );
  copyDigest(bytes, offset, record.success.sourceReservationSha256);
  const sourceReservationSha256 = bytes.subarray(
    offset,
    offset += SHA256_BYTES,
  );
  bytes[offset++] = commandKindTag(sourceCommandKind);
  writeU64(bytes, offset, sourceSequence);
  offset += 8;
  copyDigest(bytes, offset, record.success.sourceAuthenticatedInputSha256);
  const sourceAuthenticatedInputSha256 = bytes.subarray(
    offset,
    offset += SHA256_BYTES,
  );
  copyDigest(bytes, offset, record.success.sourceOutputManifestSha256);
  const sourceOutputManifestSha256 = bytes.subarray(
    offset,
    offset += SHA256_BYTES,
  );
  copyDigest(bytes, offset, record.success.sourceSettledReceiptSha256);
  const sourceSettledReceiptSha256 = bytes.subarray(
    offset,
    offset + SHA256_BYTES,
  );
  const frame = Object.freeze({
    kind: "restart_header",
    targetRequestSha256,
    targetReservationSha256,
    targetCommandKind,
    targetSequence,
    analyzerReleaseSha256,
    analyzerIdentitySha256,
    verifierIdentitySha256,
    rangeAndPredecessorTailsSha256,
    sourceReservationSha256,
    sourceCommandKind,
    sourceSequence,
    sourceAuthenticatedInputSha256,
    sourceOutputManifestSha256,
    sourceSettledReceiptSha256,
  }) satisfies DeclarativeV2AuthenticatedCommandRestartInputHeaderV1;
  return Result.succeed(Object.freeze({
    frame,
    bytes,
    payloadBytes: 0,
  }));
}

function captureTerminal(
  input: unknown,
  state: EncoderState,
  allowance: number,
): Result.Result<
  CapturedFrame | null,
  DeclarativeV2AuthenticatedCommandRestartInputV1Error
> {
  const record = ownDataRecord(
    input,
    [
      "kind",
      "pageCount",
      "payloadByteLength",
      "finalPageSha256",
      "manifestSequenceSha256",
      "payloadSha256",
    ],
    "append",
  );
  if (Result.isFailure(record)) return Result.fail(record.failure);
  const pageCount = captureU64(record.success.pageCount, true);
  const payloadByteLength = captureU64(
    record.success.payloadByteLength,
    true,
  );
  if (
    pageCount === undefined ||
    payloadByteLength === undefined ||
    !isUint8ArrayWithByteLength(record.success.finalPageSha256, SHA256_BYTES) ||
    !isUint8ArrayWithByteLength(
      record.success.manifestSequenceSha256,
      SHA256_BYTES,
    ) ||
    !isUint8ArrayWithByteLength(record.success.payloadSha256, SHA256_BYTES)
  ) {
    return Result.fail(transportError("append", "invalidInput", "terminal"));
  }
  const acceptanceTransitions = localAcceptanceTransitions(
    state.grammar,
    "restart_terminal",
  );
  if (
    TERMINAL_FRAME_BYTES + acceptanceTransitions > allowance
  ) return Result.succeed(null);
  const admitted = prechargeEncoderFrame(
    state,
    TERMINAL_FRAME_BYTES,
    0,
    SHA256_BYTES * 3,
    undefined,
    0,
    0,
    0,
    acceptanceTransitions,
  );
  if (Result.isFailure(admitted)) return Result.fail(admitted.failure);
  const bytes = new Uint8Array(TERMINAL_FRAME_BYTES);
  bytes[0] = 4;
  writeU64(bytes, 1, pageCount);
  writeU64(bytes, 9, payloadByteLength);
  copyDigest(bytes, 17, record.success.finalPageSha256);
  copyDigest(bytes, 49, record.success.manifestSequenceSha256);
  copyDigest(bytes, 81, record.success.payloadSha256);
  const frame = Object.freeze({
    kind: "restart_terminal",
    pageCount,
    payloadByteLength,
    finalPageSha256: bytes.subarray(17, 49),
    manifestSequenceSha256: bytes.subarray(49, 81),
    payloadSha256: bytes.subarray(81, 113),
  }) satisfies DeclarativeV2AuthenticatedCommandRestartInputTerminalV1;
  return Result.succeed(Object.freeze({
    frame,
    bytes,
    payloadBytes: 0,
  }));
}

function capturePayload(
  input: unknown,
  state: EncoderState,
  allowance: number,
): Result.Result<
  CapturedFrame | null,
  DeclarativeV2AuthenticatedCommandRestartInputV1Error
> {
  const record = ownDataRecord(
    input,
    ["kind", "pageOrdinal", "offset", "bytes"],
    "append",
  );
  if (Result.isFailure(record)) return Result.fail(record.failure);
  const pageOrdinal = captureU64(record.success.pageOrdinal, false);
  const offset = captureU64(record.success.offset, false);
  if (
    pageOrdinal === undefined ||
    offset === undefined ||
    !isUint8Array(record.success.bytes)
  ) {
    return Result.fail(transportError("append", "invalidInput", "payload"));
  }
  const payloadLength = intrinsicByteLength(record.success.bytes);
  if (
    payloadLength === undefined ||
    payloadLength === 0 ||
    payloadLength >
      DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESTART_INPUT_PAYLOAD_QUANTUM_BYTES_V1
  ) {
    return Result.fail(transportError(
      "append",
      "payloadBytesExceeded",
      "payload.bytes",
      payloadLength,
      DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESTART_INPUT_PAYLOAD_QUANTUM_BYTES_V1,
    ));
  }
  const frameByteLength = PAYLOAD_HEADER_BYTES + payloadLength;
  const acceptanceTransitions = localAcceptanceTransitions(
    state.grammar,
    "payload",
  );
  const requiredTransitions = frameByteLength +
    (payloadLength * 2) +
    acceptanceTransitions;
  if (requiredTransitions > allowance) return Result.succeed(null);
  const admitted = prechargeEncoderFrame(
    state,
    frameByteLength,
    payloadLength,
    payloadLength,
    undefined,
    0,
    payloadLength * 2,
    0,
    acceptanceTransitions,
  );
  if (Result.isFailure(admitted)) return Result.fail(admitted.failure);
  const bytes = new Uint8Array(frameByteLength);
  bytes[0] = 5;
  writeU64(bytes, 1, pageOrdinal);
  writeU64(bytes, 9, offset);
  writeU32(bytes, 17, payloadLength);
  try {
    bytes.set(record.success.bytes, PAYLOAD_HEADER_BYTES);
  } catch {
    return Result.fail(
      transportError("append", "invalidInput", "payload.bytes"),
    );
  }
  const owned = bytes.subarray(PAYLOAD_HEADER_BYTES);
  const frame = Object.freeze({
    kind: "payload",
    pageOrdinal,
    offset,
    bytes: owned,
  }) satisfies DeclarativeV2AuthenticatedCommandRestartInputPayloadV1;
  return Result.succeed(Object.freeze({
    frame,
    bytes,
    payloadBytes: payloadLength,
  }));
}

function protocolAcceptanceWork(
  state: GrammarState,
  kind: PendingProtocolFrame["kind"],
  canonicalByteLength: number,
): Readonly<{
  readonly allocationBytes: number;
  readonly scanBytes: number;
  readonly hashBytes: number;
  readonly transitions: number;
}> {
  const hasPredecessor = kind === "page_manifest" && state.pages.length > 0;
  const lineageScanBytes = kind === "source_output_manifest"
    ? SHA256_BYTES * 2
    : SHA256_BYTES + (hasPredecessor ? SHA256_BYTES * 2 : 0);
  const canonicalHashPasses = kind === "page_manifest" ? 2 : 1;
  const hashBytes = canonicalByteLength * canonicalHashPasses;
  const scanBytes = hashBytes + lineageScanBytes;
  const structuralTransitions = kind === "source_output_manifest"
    ? 3
    : hasPredecessor
    ? 12
    : 7;
  return Object.freeze({
    allocationBytes: SHA256_BYTES,
    scanBytes,
    hashBytes,
    transitions: scanBytes + structuralTransitions,
  });
}

function localAcceptanceTransitions(
  state: GrammarState,
  kind: "restart_header" | "restart_terminal" | "payload",
): number {
  return kind === "restart_header"
    ? 2
    : kind === "restart_terminal"
    ? 4 + state.pages.length
    : 6;
}

function resumePendingProtocolFrame(
  input: unknown,
  state: EncoderState,
  allowance: number,
): Result.Result<
  CapturedFrame | null,
  DeclarativeV2AuthenticatedCommandRestartInputV1Error
> {
  const pending = state.pendingProtocolFrame;
  if (pending === undefined) {
    throw new Error("Missing A1b2c0b2c1a pending protocol frame.");
  }
  if (input !== pending.input) {
    return Result.fail(
      transportError("append", "invalidInput", "frame.pendingIdentity"),
    );
  }
  const canonicalByteLength = pending.bytes.byteLength - 5;
  if (pending.verified !== undefined) {
    const acceptanceWork = protocolAcceptanceWork(
      state.grammar,
      pending.kind,
      canonicalByteLength,
    );
    if (acceptanceWork.transitions > allowance) return Result.succeed(null);
    const admitted = chargeMany(
      state.usage,
      state.budget,
      [
        ["allocationBytes", acceptanceWork.allocationBytes],
        ["scanBytes", acceptanceWork.scanBytes],
        ["hashBytes", acceptanceWork.hashBytes],
        ["transitions", acceptanceWork.transitions],
      ],
      "append",
      pending.kind,
    );
    if (Result.isFailure(admitted)) return Result.fail(admitted.failure);
    const digest = sha256(pending.verified.canonicalBytes);
    // SAFETY: pending.kind is one of the verified protocol frame kinds and
    // pending.verified.frame passed progress-frame verification, so the
    // pair satisfies the captured-frame union.
    const frame = Object.freeze({
      kind: pending.kind,
      frame: pending.verified.frame,
    }) as DeclarativeV2AuthenticatedCommandRestartInputFrameV1;
    state.pendingProtocolFrame = undefined;
    return Result.succeed(Object.freeze({
      frame,
      bytes: pending.bytes,
      canonicalProtocolBytes: pending.verified.canonicalBytes,
      canonicalProtocolSha256: digest,
      payloadBytes: 0,
    }));
  }
  const verified = verifyOwnedDeclarativeV2VerifierProgressFrameV2<
    DeclarativeV2AuthenticatedCommandRestartInputV1Error | AllowancePending
  >(
    Object.freeze({
      bytes: pending.bytes,
      byteOffset: 5,
      byteLength: canonicalByteLength,
    }),
    progressFrameBudget(state.budget),
    plan => {
      const requiredTransitions =
        plan.successfulWorkCeiling.primitiveTransitions;
      if (requiredTransitions > allowance) return Result.fail(ALLOWANCE_PENDING);
      return preflightWork(
        state.usage,
        state.budget,
        plan.successfulWorkCeiling,
        0,
        0,
        0,
        "append",
        pending.kind,
      );
    },
  );
  if (Result.isFailure(verified)) {
    return isAllowancePending(verified.failure)
      ? Result.succeed(null)
      : Result.fail(
        protocolOrTransportFailure("append", pending.kind, verified.failure),
      );
  }
  const settled = settleWork(
    state.usage,
    state.budget,
    verified.success.work,
    0,
    0,
    0,
    "append",
    pending.kind,
  );
  if (Result.isFailure(settled)) return Result.fail(settled.failure);
  const expectedKind = pending.kind === "source_output_manifest"
    ? "command_output_manifest"
    : "evidence_page_manifest";
  if (verified.success.frame.kind !== expectedKind) {
    return Result.fail(
      transportError("append", "invalidGrammar", pending.kind),
    );
  }
  state.pendingProtocolFrame = Object.freeze({
    ...pending,
    verified: Object.freeze({
      frame: verified.success.frame,
      canonicalBytes: verified.success.canonicalBytes,
    }),
  });
  return Result.succeed(null);
}

function acceptFrame(
  state: GrammarState,
  captured: CapturedFrame,
  operation: "append" | "finishDecoder",
): Result.Result<void, DeclarativeV2AuthenticatedCommandRestartInputV1Error> {
  const frame = captured.frame;
  if (state.phase === "header") {
    if (frame.kind !== "restart_header") {
      return Result.fail(
        transportError(operation, "invalidGrammar", "header"),
      );
    }
    state.header = frame;
    state.phase = "output";
    return Result.succeed(undefined);
  }
  if (state.phase === "output") {
    if (
      frame.kind !== "source_output_manifest" ||
      captured.canonicalProtocolBytes === undefined ||
      captured.canonicalProtocolSha256 === undefined
    ) {
      return Result.fail(
        transportError(operation, "invalidGrammar", "output"),
      );
    }
    const header = state.header!;
    if (
      frame.frame.commandKind !== header.sourceCommandKind ||
      frame.frame.sequence !== header.sourceSequence ||
      !bytesEqualFullScan(
        frame.frame.reservationSha256,
        header.sourceReservationSha256,
      ) ||
      !bytesEqualFullScan(
        captured.canonicalProtocolSha256,
        header.sourceOutputManifestSha256,
      )
    ) {
      return Result.fail(
        transportError(operation, "lineageMismatch", "output"),
      );
    }
    state.output = frame.frame;
    state.outputBytes = captured.canonicalProtocolBytes;
    state.phase = "pages";
    return Result.succeed(undefined);
  }
  if (state.phase === "pages") {
    if (frame.kind === "page_manifest") {
      if (
        captured.canonicalProtocolBytes === undefined ||
        captured.canonicalProtocolSha256 === undefined ||
        state.pages.length >=
          DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESTART_INPUT_MAXIMUM_PAGES_V1
      ) {
        return Result.fail(
          transportError(operation, "pagesExceeded", "pages"),
        );
      }
      const header = state.header!;
      if (
        frame.frame.commandKind !== header.sourceCommandKind ||
        frame.frame.sequence !== header.sourceSequence ||
        frame.frame.pageOrdinal !== BigInt(state.pages.length) ||
        !bytesEqualFullScan(
          frame.frame.reservationSha256,
          header.sourceReservationSha256,
        )
      ) {
        return Result.fail(
          transportError(operation, "lineageMismatch", "page"),
        );
      }
      const previous = state.pages.at(-1);
      if (
        previous === undefined
          ? frame.frame.predecessorPageSha256 !== null
          : !matchesEvidencePageTransition(
            previous.manifest!,
            previous.manifestSha256,
            frame.frame,
          )
      ) {
        return Result.fail(
          transportError(operation, "lineageMismatch", "page"),
        );
      }
      state.manifestSequenceHash.update(captured.canonicalProtocolBytes);
      state.pages.push({
        manifest: frame.frame,
        payloadByteLength: frame.frame.payloadByteLength,
        manifestBytes: captured.canonicalProtocolBytes,
        manifestSha256: captured.canonicalProtocolSha256,
        payloadHash: new Sha256Accumulator(),
        body: undefined,
        bodyOffset: 0,
      });
      return Result.succeed(undefined);
    }
    if (frame.kind !== "restart_terminal") {
      return Result.fail(
        transportError(operation, "invalidGrammar", "terminal"),
      );
    }
    if (
      state.pages.length === 0 ||
      frame.pageCount !== BigInt(state.pages.length) ||
      frame.payloadByteLength !== state.pages.reduce(
        (sum, page) => sum + page.payloadByteLength,
        0n,
      )
    ) {
      return Result.fail(
        transportError(operation, "lineageMismatch", "terminal"),
      );
    }
    state.terminal = frame;
    state.phase = "payload";
    return Result.succeed(undefined);
  }
  if (state.phase !== "payload" || frame.kind !== "payload") {
    return Result.fail(
      transportError(operation, "invalidGrammar", "payload"),
    );
  }
  const page = state.pages[Number(frame.pageOrdinal)];
  if (
    page === undefined ||
    frame.pageOrdinal !== state.currentPayloadPageOrdinal ||
    frame.offset !== state.currentPayloadOffset ||
    frame.offset + BigInt(frame.bytes.byteLength) >
      page.payloadByteLength
  ) {
    return Result.fail(
      transportError(operation, "lineageMismatch", "payload"),
    );
  }
  page.payloadHash.update(frame.bytes);
  state.payloadHash.update(frame.bytes);
  state.payloadByteLength += BigInt(frame.bytes.byteLength);
  state.currentPayloadOffset += BigInt(frame.bytes.byteLength);
  if (state.currentPayloadOffset === page.payloadByteLength) {
    state.currentPayloadPageOrdinal += 1n;
    state.currentPayloadOffset = 0n;
  }
  return Result.succeed(undefined);
}

function matchesEvidencePageTransition(
  previous: DeclarativeV2VerifierEvidencePageManifestFrameV2,
  previousPageSha256: Uint8Array,
  current: DeclarativeV2VerifierEvidencePageManifestFrameV2,
): boolean {
  return (
    current.reservationSha256 !== null &&
    current.predecessorPageSha256 !== null &&
    bytesEqualFullScan(
      previous.reservationSha256,
      current.reservationSha256,
    ) &&
    previous.commandKind === current.commandKind &&
    previous.sequence === current.sequence &&
    previous.pageOrdinal !== MAX_I64 &&
    current.pageOrdinal === previous.pageOrdinal + 1n &&
    current.firstEvidenceOrdinal ===
      previous.firstEvidenceOrdinal + previous.evidenceCount &&
    current.firstDiagnosticOrdinal ===
      previous.firstDiagnosticOrdinal + previous.diagnosticCount &&
    bytesEqualFullScan(
      current.predecessorPageSha256,
      previousPageSha256,
    )
  );
}

function consumeDecoderByte(
  state: DecoderState,
  input: Uint8Array,
  inputIndex: number,
  remainingAllowance: number,
): Result.Result<
  boolean,
  DeclarativeV2AuthenticatedCommandRestartInputV1Error
> {
  if (state.prefixOffset < PREFIX_BYTES) {
    if (remainingAllowance < 1) return Result.succeed(false);
    const admitted = chargeMany(
      state.usage,
      state.budget,
      [["scanBytes", 1], ["transitions", 1]],
      "stepDecoder",
      "prefix",
    );
    if (Result.isFailure(admitted)) return Result.fail(admitted.failure);
    let byte: number;
    try {
      byte = input[inputIndex]!;
    } catch {
      return Result.fail(
        transportError("stepDecoder", "invalidInput", "bytes"),
      );
    }
    if (byte !== PREFIX[state.prefixOffset]) {
      return Result.fail(transportError(
        "stepDecoder",
        state.prefixOffset >= 4 + DOMAIN_BYTES.byteLength
          ? "unsupportedVersion"
          : "malformed",
        "prefix",
      ));
    }
    state.prefixOffset += 1;
    return Result.succeed(true);
  }
  if (state.frameLength === undefined) {
    if (
      state.grammar.phase === "payload" &&
      state.grammar.currentPayloadPageOrdinal ===
        BigInt(state.grammar.pages.length) &&
      state.grammar.currentPayloadOffset === 0n &&
      state.grammar.terminal !== undefined &&
      state.grammar.payloadByteLength ===
        state.grammar.terminal.payloadByteLength
    ) {
      return Result.fail(
        transportError("stepDecoder", "malformed", "trailing"),
      );
    }
    if (remainingAllowance < 1) return Result.succeed(false);
    const admitted = chargeMany(
      state.usage,
      state.budget,
      [["copyBytes", 1], ["transitions", 1]],
      "stepDecoder",
      "frameLength",
    );
    if (Result.isFailure(admitted)) return Result.fail(admitted.failure);
    try {
      state.frameLengthBytes[state.frameLengthOffset] = input[inputIndex]!;
    } catch {
      return Result.fail(
        transportError("stepDecoder", "invalidInput", "bytes"),
      );
    }
    state.frameLengthOffset += 1;
    if (state.frameLengthOffset === FRAME_LENGTH_BYTES) {
      const length = readU32(state.frameLengthBytes, 0);
      if (length === undefined || length === 0 || length > U32_MAX) {
        return Result.fail(
          transportError("stepDecoder", "malformed", "frameLength"),
        );
      }
      state.frameLength = length;
      state.frameLengthOffset = 0;
    }
    return Result.succeed(true);
  }
  if (state.frameTag === undefined) {
    if (remainingAllowance < 1) return Result.succeed(false);
    const admitted = chargeMany(
      state.usage,
      state.budget,
      [["copyBytes", 1], ["transitions", 1]],
      "stepDecoder",
      "frameTag",
    );
    if (Result.isFailure(admitted)) return Result.fail(admitted.failure);
    let tag: number;
    try {
      tag = input[inputIndex]!;
    } catch {
      return Result.fail(
        transportError("stepDecoder", "invalidInput", "bytes"),
      );
    }
      const frameAdmission = chargeMany(
        state.usage,
        state.budget,
        [
          ["frameBytes", FRAME_LENGTH_BYTES + state.frameLength],
          ["frames", 1],
          ["pages", tag === 3 ? 1 : 0],
        ],
      "stepDecoder",
      "frame",
    );
    if (Result.isFailure(frameAdmission)) {
      return Result.fail(frameAdmission.failure);
    }
    state.frameTag = tag;
    if (tag === 5) {
      if (
        state.grammar.phase !== "payload" ||
        state.frameLength < PAYLOAD_HEADER_BYTES ||
        state.frameLength >
          PAYLOAD_HEADER_BYTES +
            DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESTART_INPUT_PAYLOAD_QUANTUM_BYTES_V1
      ) {
        return Result.fail(
          transportError("stepDecoder", "invalidGrammar", "payload"),
        );
      }
      state.payloadHeader[0] = tag;
      state.payloadHeaderOffset = 1;
    } else {
      if (state.grammar.phase === "payload") {
        return Result.fail(
          transportError("stepDecoder", "invalidGrammar", "metadata"),
        );
      }
      const allocated = charge(
        state.usage,
        state.budget,
        "allocationBytes",
        state.frameLength,
        "stepDecoder",
        "metadataFrame",
      );
      if (Result.isFailure(allocated)) return Result.fail(allocated.failure);
      try {
        state.metadataFrame = new Uint8Array(state.frameLength);
      } catch {
        return Result.fail(transportError(
          "stepDecoder",
          "allocationBytesExceeded",
          "metadataFrame",
          state.frameLength,
          state.budget.maximumAllocationBytes,
        ));
      }
      state.metadataFrame[0] = tag;
      state.metadataOffset = 1;
      if (state.frameLength === 1) {
        state.pendingMetadataFrame = state.metadataFrame;
        state.metadataFrame = undefined;
        resetDecoderFrame(state);
      }
    }
    return Result.succeed(true);
  }
  if (state.frameTag !== 5) {
    if (remainingAllowance < 1) return Result.succeed(false);
    const admitted = chargeMany(
      state.usage,
      state.budget,
      [["copyBytes", 1], ["transitions", 1]],
      "stepDecoder",
      "metadataFrame",
    );
    if (Result.isFailure(admitted)) return Result.fail(admitted.failure);
    try {
      state.metadataFrame![state.metadataOffset] = input[inputIndex]!;
    } catch {
      return Result.fail(
        transportError("stepDecoder", "invalidInput", "bytes"),
      );
    }
    state.metadataOffset += 1;
    if (state.metadataOffset === state.frameLength) {
      state.pendingMetadataFrame = state.metadataFrame;
      state.metadataFrame = undefined;
      state.metadataOffset = 0;
      resetDecoderFrame(state);
    }
    return Result.succeed(true);
  }
  if (state.payloadHeaderOffset < PAYLOAD_HEADER_BYTES) {
    const completesHeader =
      state.payloadHeaderOffset + 1 === PAYLOAD_HEADER_BYTES;
    const requiredTransitions = completesHeader
      ? 1 + localAcceptanceTransitions(state.grammar, "payload")
      : 1;
    if (remainingAllowance < requiredTransitions) return Result.succeed(false);
    const admitted = chargeMany(
      state.usage,
      state.budget,
      [["copyBytes", 1], ["transitions", requiredTransitions]],
      "stepDecoder",
      "payloadHeader",
    );
    if (Result.isFailure(admitted)) return Result.fail(admitted.failure);
    try {
      state.payloadHeader[state.payloadHeaderOffset] = input[inputIndex]!;
    } catch {
      return Result.fail(
        transportError("stepDecoder", "invalidInput", "bytes"),
      );
    }
    state.payloadHeaderOffset += 1;
    if (state.payloadHeaderOffset === PAYLOAD_HEADER_BYTES) {
      const prepared = prepareDecoderPayload(state);
      if (Result.isFailure(prepared)) return Result.fail(prepared.failure);
    }
    return Result.succeed(true);
  }
  if (remainingAllowance < 3) return Result.succeed(false);
  const admitted = chargeMany(
    state.usage,
    state.budget,
    [
      ["copyBytes", 1],
      ["hashBytes", 2],
      ["transitions", 3],
    ],
    "stepDecoder",
    "payload",
  );
  if (Result.isFailure(admitted)) return Result.fail(admitted.failure);
  const pageOrdinal = readU64(state.payloadHeader, 1)!;
  const page = state.grammar.pages[Number(pageOrdinal)]!;
  let byte: number;
  try {
    byte = input[inputIndex]!;
    page.body![page.bodyOffset] = byte;
  } catch {
    return Result.fail(
      transportError("stepDecoder", "invalidInput", "bytes"),
    );
  }
  const one = state.payloadHeader.subarray(0, 1);
  one[0] = byte;
  page.payloadHash.update(one);
  state.grammar.payloadHash.update(one);
  page.bodyOffset += 1;
  state.payloadBodyOffset += 1;
  state.grammar.payloadByteLength += 1n;
  if (state.payloadBodyOffset === state.payloadBodyLength) {
    state.grammar.currentPayloadOffset += BigInt(state.payloadBodyLength);
    if (
      state.grammar.currentPayloadOffset === page.payloadByteLength
    ) {
      state.grammar.currentPayloadPageOrdinal += 1n;
      state.grammar.currentPayloadOffset = 0n;
    }
    resetDecoderFrame(state);
  }
  return Result.succeed(true);
}

function prepareDecoderPayload(
  state: DecoderState,
): Result.Result<void, DeclarativeV2AuthenticatedCommandRestartInputV1Error> {
  const pageOrdinal = readU64(state.payloadHeader, 1);
  const offset = readU64(state.payloadHeader, 9);
  const payloadByteLength = readU32(state.payloadHeader, 17);
  const page = pageOrdinal === undefined
    ? undefined
    : state.grammar.pages[Number(pageOrdinal)];
  if (
    pageOrdinal === undefined ||
    offset === undefined ||
    payloadByteLength === undefined ||
    payloadByteLength === 0 ||
    payloadByteLength >
      DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESTART_INPUT_PAYLOAD_QUANTUM_BYTES_V1 ||
    state.frameLength !== PAYLOAD_HEADER_BYTES + payloadByteLength ||
    page === undefined ||
    pageOrdinal !== state.grammar.currentPayloadPageOrdinal ||
    offset !== state.grammar.currentPayloadOffset ||
    offset + BigInt(payloadByteLength) > page.payloadByteLength ||
    page.body === undefined
  ) {
    return Result.fail(
      transportError("stepDecoder", "lineageMismatch", "payload"),
    );
  }
  const admitted = charge(
    state.usage,
    state.budget,
    "payloadBytes",
    payloadByteLength,
    "stepDecoder",
    "payload",
  );
  if (Result.isFailure(admitted)) return Result.fail(admitted.failure);
  state.payloadBodyLength = payloadByteLength;
  state.payloadBodyOffset = 0;
  return Result.succeed(undefined);
}

function parsePendingDecoderMetadata(
  state: DecoderState,
  allowance: number,
): Result.Result<boolean, DeclarativeV2AuthenticatedCommandRestartInputV1Error> {
  const bytes = state.pendingMetadataFrame;
  if (bytes === undefined) return Result.succeed(true);
  const tag = bytes[0];
  if (tag === 2 || tag === 3) {
    const transportKind = tag === 2
      ? "source_output_manifest"
      : "page_manifest";
    const protocolLength = readU32(bytes, 1);
    if (
      protocolLength === undefined ||
      protocolLength !== bytes.byteLength - 5 ||
      protocolLength === 0
    ) {
      return Result.fail(
        transportError("finishDecoder", "malformed", "protocolFrame"),
      );
    }
    if (state.pendingVerifiedProtocolFrame === undefined) {
      const verified = verifyOwnedDeclarativeV2VerifierProgressFrameV2<
        DeclarativeV2AuthenticatedCommandRestartInputV1Error | AllowancePending
      >(
        Object.freeze({
          bytes,
          byteOffset: 5,
          byteLength: protocolLength,
        }),
        progressFrameBudget(state.budget),
        plan => {
          if (plan.successfulWorkCeiling.primitiveTransitions > allowance) {
            return Result.fail(ALLOWANCE_PENDING);
          }
          return preflightWork(
            state.usage,
            state.budget,
            plan.successfulWorkCeiling,
            0,
            0,
            0,
            "finishDecoder",
            transportKind,
          );
        },
      );
      if (Result.isFailure(verified)) {
        return isAllowancePending(verified.failure)
          ? Result.succeed(false)
          : Result.fail(protocolOrTransportFailure(
            "finishDecoder",
            transportKind,
            verified.failure,
          ));
      }
      const settled = settleWork(
        state.usage,
        state.budget,
        verified.success.work,
        0,
        0,
        0,
        "finishDecoder",
        transportKind,
      );
      if (Result.isFailure(settled)) return Result.fail(settled.failure);
      const expectedKind = tag === 2
        ? "command_output_manifest"
        : "evidence_page_manifest";
      if (verified.success.frame.kind !== expectedKind) {
        return Result.fail(
          transportError("finishDecoder", "invalidGrammar", expectedKind),
        );
      }
      state.pendingVerifiedProtocolFrame = Object.freeze({
        frame: verified.success.frame,
        canonicalBytes: verified.success.canonicalBytes,
      });
      return Result.succeed(false);
    }
    const acceptanceWork = protocolAcceptanceWork(
      state.grammar,
      transportKind,
      protocolLength,
    );
    if (acceptanceWork.transitions > allowance) return Result.succeed(false);
    const admitted = chargeMany(
      state.usage,
      state.budget,
      [
        ["allocationBytes", acceptanceWork.allocationBytes],
        ["scanBytes", acceptanceWork.scanBytes],
        ["hashBytes", acceptanceWork.hashBytes],
        ["transitions", acceptanceWork.transitions],
      ],
      "finishDecoder",
      transportKind,
    );
    if (Result.isFailure(admitted)) return Result.fail(admitted.failure);
    const verified = state.pendingVerifiedProtocolFrame;
    // SAFETY: transportKind is one of the verified protocol frame kinds and
    // verified.frame passed progress-frame verification, so the pair
    // satisfies the captured-frame union.
    const captured = Object.freeze({
      frame: Object.freeze({
        kind: transportKind,
        frame: verified.frame,
      }) as DeclarativeV2AuthenticatedCommandRestartInputFrameV1,
      bytes,
      canonicalProtocolBytes: verified.canonicalBytes,
      canonicalProtocolSha256: sha256(verified.canonicalBytes),
      payloadBytes: 0,
    });
    const accepted = acceptFrame(state.grammar, captured, "finishDecoder");
    if (Result.isFailure(accepted)) return Result.fail(accepted.failure);
    state.pendingVerifiedProtocolFrame = undefined;
    state.pendingMetadataFrame = undefined;
    return Result.succeed(true);
  }
  const acceptanceTransitions = tag === 1
    ? localAcceptanceTransitions(state.grammar, "restart_header")
    : tag === 4
    ? localAcceptanceTransitions(state.grammar, "restart_terminal")
    : 0;
  const requiredTransitions = bytes.byteLength + acceptanceTransitions;
  if (requiredTransitions > allowance) return Result.succeed(false);
  const scanned = chargeMany(
    state.usage,
    state.budget,
    [
      ["scanBytes", bytes.byteLength],
      ["transitions", requiredTransitions],
    ],
    "finishDecoder",
    tag === 1 ? "header" : "terminal",
  );
  if (Result.isFailure(scanned)) return Result.fail(scanned.failure);
  const captured = tag === 1
    ? decodeHeader(bytes)
    : tag === 4
    ? decodeTerminal(bytes)
    : Result.fail(
      transportError("finishDecoder", "invalidGrammar", "metadata"),
    );
  if (Result.isFailure(captured)) return Result.fail(captured.failure);
  const accepted = acceptFrame(
    state.grammar,
    captured.success,
    "finishDecoder",
  );
  if (Result.isFailure(accepted)) return Result.fail(accepted.failure);
  if (tag === 4) {
    const allocated = allocateDecoderPageBodies(state);
    if (Result.isFailure(allocated)) return Result.fail(allocated.failure);
  }
  state.pendingMetadataFrame = undefined;
  return Result.succeed(true);
}

function decodeHeader(
  bytes: Uint8Array,
): Result.Result<
  CapturedFrame,
  DeclarativeV2AuthenticatedCommandRestartInputV1Error
> {
  if (bytes.byteLength !== HEADER_FRAME_BYTES || bytes[0] !== 1) {
    return Result.fail(
      transportError("finishDecoder", "nonCanonical", "header"),
    );
  }
  let offset = 1;
  const targetRequestSha256 = bytes.subarray(offset, offset += SHA256_BYTES);
  const targetReservationSha256 = bytes.subarray(
    offset,
    offset += SHA256_BYTES,
  );
  const targetCommandKind = commandKindFromTag(bytes[offset++]!);
  const targetSequence = readU64(bytes, offset);
  offset += 8;
  const analyzerReleaseSha256 = bytes.subarray(offset, offset += SHA256_BYTES);
  const analyzerIdentitySha256 = bytes.subarray(offset, offset += SHA256_BYTES);
  const verifierIdentitySha256 = bytes.subarray(offset, offset += SHA256_BYTES);
  const rangeAndPredecessorTailsSha256 = bytes.subarray(
    offset,
    offset += SHA256_BYTES,
  );
  const sourceReservationSha256 = bytes.subarray(
    offset,
    offset += SHA256_BYTES,
  );
  const sourceCommandKind = restartKindFromTag(bytes[offset++]!);
  const sourceSequence = readU64(bytes, offset);
  offset += 8;
  const sourceAuthenticatedInputSha256 = bytes.subarray(
    offset,
    offset += SHA256_BYTES,
  );
  const sourceOutputManifestSha256 = bytes.subarray(
    offset,
    offset += SHA256_BYTES,
  );
  const sourceSettledReceiptSha256 = bytes.subarray(
    offset,
    offset + SHA256_BYTES,
  );
  if (
    targetCommandKind === undefined ||
    sourceCommandKind === undefined ||
    targetSequence === undefined ||
    targetSequence === 0n ||
    sourceSequence === undefined ||
    sourceSequence === 0n
  ) {
    return Result.fail(
      transportError("finishDecoder", "malformed", "header"),
    );
  }
  const frame = Object.freeze({
    kind: "restart_header",
    targetRequestSha256,
    targetReservationSha256,
    targetCommandKind,
    targetSequence,
    analyzerReleaseSha256,
    analyzerIdentitySha256,
    verifierIdentitySha256,
    rangeAndPredecessorTailsSha256,
    sourceReservationSha256,
    sourceCommandKind,
    sourceSequence,
    sourceAuthenticatedInputSha256,
    sourceOutputManifestSha256,
    sourceSettledReceiptSha256,
  }) satisfies DeclarativeV2AuthenticatedCommandRestartInputHeaderV1;
  return Result.succeed(Object.freeze({ frame, bytes, payloadBytes: 0 }));
}

function decodeTerminal(
  bytes: Uint8Array,
): Result.Result<
  CapturedFrame,
  DeclarativeV2AuthenticatedCommandRestartInputV1Error
> {
  if (bytes.byteLength !== TERMINAL_FRAME_BYTES || bytes[0] !== 4) {
    return Result.fail(
      transportError("finishDecoder", "nonCanonical", "terminal"),
    );
  }
  const pageCount = readU64(bytes, 1);
  const payloadByteLength = readU64(bytes, 9);
  if (
    pageCount === undefined ||
    pageCount === 0n ||
    payloadByteLength === undefined ||
    payloadByteLength === 0n
  ) {
    return Result.fail(
      transportError("finishDecoder", "malformed", "terminal"),
    );
  }
  const frame = Object.freeze({
    kind: "restart_terminal",
    pageCount,
    payloadByteLength,
    finalPageSha256: bytes.subarray(17, 49),
    manifestSequenceSha256: bytes.subarray(49, 81),
    payloadSha256: bytes.subarray(81, 113),
  }) satisfies DeclarativeV2AuthenticatedCommandRestartInputTerminalV1;
  return Result.succeed(Object.freeze({ frame, bytes, payloadBytes: 0 }));
}

function allocateDecoderPageBodies(
  state: DecoderState,
): Result.Result<void, DeclarativeV2AuthenticatedCommandRestartInputV1Error> {
  const total = state.grammar.pages.reduce(
    (sum, page) => sum + page.payloadByteLength,
    0n,
  );
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    return Result.fail(
      transportError("finishDecoder", "allocationBytesExceeded", "pages"),
    );
  }
  const totalNumber = Number(total);
  const admitted = charge(
    state.usage,
    state.budget,
    "allocationBytes",
    totalNumber,
    "finishDecoder",
    "pageBodies",
  );
  if (Result.isFailure(admitted)) return Result.fail(admitted.failure);
  try {
    for (const page of state.grammar.pages) {
      page.body = new Uint8Array(Number(page.payloadByteLength));
      page.bodyOffset = 0;
    }
  } catch {
    return Result.fail(transportError(
      "finishDecoder",
      "allocationBytesExceeded",
      "pageBodies",
      totalNumber,
      state.budget.maximumAllocationBytes,
    ));
  }
  return Result.succeed(undefined);
}

function validateFinish(
  state: GrammarState,
  usage: MutableUsage,
  budget: DeclarativeV2AuthenticatedCommandRestartInputBudgetV1,
  allowance: number,
  operation: "finishEncoder" | "finishDecoder",
): Result.Result<
  boolean,
  DeclarativeV2AuthenticatedCommandRestartInputV1Error
> {
  if (
    state.header === undefined ||
    state.output === undefined ||
    state.outputBytes === undefined ||
    state.terminal === undefined ||
    state.phase !== "payload" ||
    state.currentPayloadPageOrdinal !== BigInt(state.pages.length) ||
    state.currentPayloadOffset !== 0n ||
    state.payloadByteLength !== state.terminal.payloadByteLength
  ) {
    return Result.fail(
      transportError(operation, "invalidGrammar", "complete"),
    );
  }
  let remaining = allowance;
  while (
    state.validationPhase === "pages" &&
    state.validationIndex < state.pages.length
  ) {
    const work = 33;
    if (remaining < work) return Result.succeed(false);
    const charged = chargeMany(
      usage,
      budget,
      [["scanBytes", 32], ["transitions", work]],
      operation,
      "payloadSha256",
    );
    if (Result.isFailure(charged)) return Result.fail(charged.failure);
    const page = state.pages[state.validationIndex]!;
    if (
      page.payloadHash.byteLength !== Number(page.payloadByteLength) ||
      !bytesEqualFullScan(
        page.payloadHash.digest(),
        page.manifest!.payloadSha256,
      )
    ) {
      return Result.fail(
        transportError(operation, "digestMismatch", "page.payloadSha256"),
      );
    }
    state.validationIndex += 1;
    remaining -= work;
  }
  if (
    state.validationPhase === "pages" &&
    state.validationIndex === state.pages.length
  ) {
    state.validationPhase = "terminal";
  }
  if (state.validationPhase === "terminal") {
    const work = 193;
    if (remaining < work) return Result.succeed(false);
    const charged = chargeMany(
      usage,
      budget,
      [["scanBytes", 192], ["transitions", work]],
      operation,
      "terminal",
    );
    if (Result.isFailure(charged)) return Result.fail(charged.failure);
    const finalPage = state.pages.at(-1)!;
    const finalValidation = validateDeclarativeV2VerifierFinalEvidencePageV2(
      finalPage.manifest!,
      finalPage.manifestSha256,
      state.output,
    );
    if (
      Result.isFailure(finalValidation) ||
      !bytesEqualFullScan(
        finalPage.manifestSha256,
        state.terminal.finalPageSha256,
      ) ||
      !bytesEqualFullScan(
        state.manifestSequenceHash.digest(),
        state.terminal.manifestSequenceSha256,
      ) ||
      !bytesEqualFullScan(
        state.payloadHash.digest(),
        state.terminal.payloadSha256,
      )
    ) {
      return Result.fail(
        transportError(operation, "digestMismatch", "terminal"),
      );
    }
    state.validationPhase = "complete";
    state.phase = "complete";
  }
  return Result.succeed(state.validationPhase === "complete");
}

function prechargeEncoderFrame(
  state: EncoderState,
  frameByteLength: number,
  payloadByteLength: number,
  copyByteLength: number,
  protocolWork?: DeclarativeV2VerifierProgressFrameWorkV2,
  scanByteLength = 0,
  hashByteLength = 0,
  pageCount = 0,
  extraTransitions = 0,
): Result.Result<void, DeclarativeV2AuthenticatedCommandRestartInputV1Error> {
  const nextUsage = { ...state.usage };
  const charged = chargeMany(
    nextUsage,
    state.budget,
    [
      ["bodyBytes", FRAME_LENGTH_BYTES + frameByteLength],
      ["canonicalBytes", FRAME_LENGTH_BYTES + frameByteLength],
      ["frameBytes", FRAME_LENGTH_BYTES + frameByteLength],
      ["payloadBytes", payloadByteLength],
      ["frames", 1],
      ["pages", pageCount],
      [
        "allocationBytes",
        FRAME_LENGTH_BYTES + frameByteLength +
          (protocolWork?.byteStorageAllocationBytes ?? 0),
      ],
      ["copyBytes", copyByteLength + (protocolWork?.byteCopyBytes ?? 0)],
      ["scanBytes", scanByteLength + (protocolWork?.byteScanBytes ?? 0)],
      ["hashBytes", hashByteLength],
      [
        "transitions",
        frameByteLength +
          (protocolWork?.primitiveTransitions ?? 0) +
          Math.max(scanByteLength, hashByteLength) +
          extraTransitions,
      ],
    ],
    "append",
    "frame",
  );
  if (Result.isFailure(charged)) return Result.fail(charged.failure);
  Object.assign(state.usage, nextUsage);
  return Result.succeed(undefined);
}

function preflightWork(
  usage: MutableUsage,
  budget: DeclarativeV2AuthenticatedCommandRestartInputBudgetV1,
  work: DeclarativeV2VerifierProgressFrameWorkV2,
  scanBytes: number,
  hashBytes: number,
  extraTransitions: number,
  operation: "append" | "finishDecoder",
  path: string,
): Result.Result<void, DeclarativeV2AuthenticatedCommandRestartInputV1Error> {
  return applyWork(
    { ...usage },
    budget,
    work,
    scanBytes,
    hashBytes,
    extraTransitions,
    operation,
    path,
  );
}

function settleWork(
  usage: MutableUsage,
  budget: DeclarativeV2AuthenticatedCommandRestartInputBudgetV1,
  work: DeclarativeV2VerifierProgressFrameWorkV2,
  scanBytes: number,
  hashBytes: number,
  extraTransitions: number,
  operation: "append" | "finishDecoder",
  path: string,
): Result.Result<void, DeclarativeV2AuthenticatedCommandRestartInputV1Error> {
  const nextUsage = { ...usage };
  const settled = applyWork(
    nextUsage,
    budget,
    work,
    scanBytes,
    hashBytes,
    extraTransitions,
    operation,
    path,
  );
  if (Result.isFailure(settled)) return Result.fail(settled.failure);
  Object.assign(usage, nextUsage);
  return Result.succeed(undefined);
}

function applyWork(
  usage: MutableUsage,
  budget: DeclarativeV2AuthenticatedCommandRestartInputBudgetV1,
  work: DeclarativeV2VerifierProgressFrameWorkV2,
  scanBytes: number,
  hashBytes: number,
  extraTransitions: number,
  operation: "append" | "finishDecoder",
  path: string,
): Result.Result<void, DeclarativeV2AuthenticatedCommandRestartInputV1Error> {
  return chargeMany(
    usage,
    budget,
    [
      ["allocationBytes", work.byteStorageAllocationBytes],
      ["copyBytes", work.byteCopyBytes],
      ["scanBytes", work.byteScanBytes + scanBytes],
      ["hashBytes", hashBytes],
      [
        "transitions",
        work.primitiveTransitions +
          Math.max(scanBytes, hashBytes) +
          extraTransitions,
      ],
    ],
    operation,
    path,
  );
}

function captureBudget(
  input: unknown,
  operation: DeclarativeV2AuthenticatedCommandRestartInputV1Error["operation"],
): Result.Result<
  Readonly<DeclarativeV2AuthenticatedCommandRestartInputBudgetV1>,
  DeclarativeV2AuthenticatedCommandRestartInputV1Error
> {
  const record = ownDataRecord(input, BUDGET_KEYS, operation);
  if (Result.isFailure(record)) {
    return Result.fail(transportError(operation, "invalidBudget", "budget"));
  }
  for (const key of BUDGET_KEYS) {
    if (!isNonNegativeSafeInteger(record.success[key])) {
      return Result.fail(transportError(operation, "invalidBudget", key));
    }
  }
  // SAFETY: every budget value was validated as a non-negative safe
  // integer above, so the numeric comparisons and projections are sound.
  if (
    (record.success.maximumBodyBytes as number) > U32_MAX ||
    (record.success.maximumFrames as number) >
      DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESTART_INPUT_MAXIMUM_FRAMES_V1 ||
    (record.success.maximumPages as number) >
      DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESTART_INPUT_MAXIMUM_PAGES_V1
  ) {
    return Result.fail(transportError(operation, "invalidBudget", "budget"));
  }
  // SAFETY: every budget value was validated as a non-negative safe
  // integer above, so these projections are sound.
  return Result.succeed(Object.freeze({
    maximumBodyBytes: record.success.maximumBodyBytes as number,
    maximumCanonicalBytes: record.success.maximumCanonicalBytes as number,
    maximumFrameBytes: record.success.maximumFrameBytes as number,
    maximumPayloadBytes: record.success.maximumPayloadBytes as number,
    maximumFrames: record.success.maximumFrames as number,
    maximumPages: record.success.maximumPages as number,
    maximumAllocationBytes: record.success.maximumAllocationBytes as number,
    maximumCopyBytes: record.success.maximumCopyBytes as number,
    maximumScanBytes: record.success.maximumScanBytes as number,
    maximumHashBytes: record.success.maximumHashBytes as number,
    maximumTransitions: record.success.maximumTransitions as number,
  }));
}

function ownDataRecord<const Keys extends readonly string[]>(
  input: unknown,
  keys: Keys,
  operation: DeclarativeV2AuthenticatedCommandRestartInputV1Error["operation"],
): Result.Result<
  Readonly<Record<Keys[number], unknown>>,
  DeclarativeV2AuthenticatedCommandRestartInputV1Error
> {
  const loose = ownDataRecordLoose(input, operation, "record");
  if (Result.isFailure(loose)) return Result.fail(loose.failure);
  const actual = Object.keys(loose.success);
  if (
    actual.length !== keys.length ||
    actual.some(key => !keys.includes(key))
  ) {
    return Result.fail(transportError(operation, "invalidInput", "record"));
  }
  // SAFETY: the exact-key check above proved the loose record carries
  // exactly the requested keys.
  return Result.succeed(
    loose.success as Readonly<Record<Keys[number], unknown>>,
  );
}

function ownDataRecordLoose(
  input: unknown,
  operation: DeclarativeV2AuthenticatedCommandRestartInputV1Error["operation"],
  path: string,
): Result.Result<
  Readonly<Record<string, unknown>>,
  DeclarativeV2AuthenticatedCommandRestartInputV1Error
> {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return Result.fail(transportError(operation, "invalidInput", path));
    }
    const keys = Reflect.ownKeys(input);
    if (keys.length > 64) {
      return Result.fail(transportError(operation, "invalidInput", path));
    }
    // SAFETY: a freshly created null-prototype object is used as a mutable
    // string-keyed record; only validated own enumerable value properties
    // are copied into it.
    const output: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    for (const key of keys) {
      if (typeof key !== "string") {
        return Result.fail(transportError(operation, "invalidInput", path));
      }
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return Result.fail(transportError(operation, "invalidInput", path));
      }
      output[key] = descriptor.value;
    }
    return Result.succeed(Object.freeze(output));
  } catch {
    return Result.fail(transportError(operation, "invalidInput", path));
  }
}

function captureClaim(
  input: unknown,
): Result.Result<
  DeclarativeV2AuthenticatedCommandRestartInputClaimV1,
  DeclarativeV2AuthenticatedCommandRestartInputV1Error
> {
  const record = ownDataRecord(input, CLAIM_KEYS, "claimSource");
  if (Result.isFailure(record)) return Result.fail(record.failure);
  const targetCommandKind = captureCommandKind(record.success.targetCommandKind);
  const targetSequence = captureU64(record.success.targetSequence, true);
  const sourceCommandKind = captureRestartKind(record.success.sourceCommandKind);
  const sourceSequence = captureU64(record.success.sourceSequence, true);
  const pageCount = captureU64(record.success.pageCount, true);
  const payloadByteLength = captureU64(
    record.success.payloadByteLength,
    true,
  );
  if (
    targetCommandKind === undefined ||
    targetSequence === undefined ||
    sourceCommandKind === undefined ||
    sourceSequence === undefined ||
    pageCount === undefined ||
    payloadByteLength === undefined
  ) {
    return Result.fail(
      transportError("claimSource", "invalidInput", "claim"),
    );
  }
  const targetRequestSha256 = captureSha256(
    record.success.targetRequestSha256,
  );
  const targetReservationSha256 = captureSha256(
    record.success.targetReservationSha256,
  );
  const analyzerReleaseSha256 = captureSha256(
    record.success.analyzerReleaseSha256,
  );
  const analyzerIdentitySha256 = captureSha256(
    record.success.analyzerIdentitySha256,
  );
  const verifierIdentitySha256 = captureSha256(
    record.success.verifierIdentitySha256,
  );
  const rangeAndPredecessorTailsSha256 = captureSha256(
    record.success.rangeAndPredecessorTailsSha256,
  );
  const sourceReservationSha256 = captureSha256(
    record.success.sourceReservationSha256,
  );
  const sourceAuthenticatedInputSha256 = captureSha256(
    record.success.sourceAuthenticatedInputSha256,
  );
  const sourceOutputManifestSha256 = captureSha256(
    record.success.sourceOutputManifestSha256,
  );
  const sourceSettledReceiptSha256 = captureSha256(
    record.success.sourceSettledReceiptSha256,
  );
  const finalPageSha256 = captureSha256(record.success.finalPageSha256);
  const manifestSequenceSha256 = captureSha256(
    record.success.manifestSequenceSha256,
  );
  const payloadSha256 = captureSha256(record.success.payloadSha256);
  if (
    targetRequestSha256 === undefined ||
    targetReservationSha256 === undefined ||
    analyzerReleaseSha256 === undefined ||
    analyzerIdentitySha256 === undefined ||
    verifierIdentitySha256 === undefined ||
    rangeAndPredecessorTailsSha256 === undefined ||
    sourceReservationSha256 === undefined ||
    sourceAuthenticatedInputSha256 === undefined ||
    sourceOutputManifestSha256 === undefined ||
    sourceSettledReceiptSha256 === undefined ||
    finalPageSha256 === undefined ||
    manifestSequenceSha256 === undefined ||
    payloadSha256 === undefined
  ) {
    return Result.fail(
      transportError("claimSource", "invalidInput", "claim"),
    );
  }
  return Result.succeed(Object.freeze({
    targetRequestSha256,
    targetReservationSha256,
    targetCommandKind,
    targetSequence,
    analyzerReleaseSha256,
    analyzerIdentitySha256,
    verifierIdentitySha256,
    rangeAndPredecessorTailsSha256,
    sourceReservationSha256,
    sourceCommandKind,
    sourceSequence,
    sourceAuthenticatedInputSha256,
    sourceOutputManifestSha256,
    sourceSettledReceiptSha256,
    pageCount,
    payloadByteLength,
    finalPageSha256,
    manifestSequenceSha256,
    payloadSha256,
  }));
}

function captureSha256(input: unknown): Uint8Array | undefined {
  return isUint8ArrayWithByteLength(input, SHA256_BYTES) ? input : undefined;
}

function compareClaim(
  state: RawPageSourceState,
  claim: DeclarativeV2AuthenticatedCommandRestartInputClaimV1,
): Result.Result<void, DeclarativeV2AuthenticatedCommandRestartInputV1Error> {
  const header = state.header;
  const terminal = state.terminal;
  if (header === undefined || terminal === undefined) {
    throw new Error("Decoded restart source lost its authenticated claim tuple.");
  }
  const targetRequestMatches = bytesEqualFullScan(
    header.targetRequestSha256,
    claim.targetRequestSha256,
  );
  const targetReservationMatches = bytesEqualFullScan(
    header.targetReservationSha256,
    claim.targetReservationSha256,
  );
  const analyzerReleaseMatches = bytesEqualFullScan(
    header.analyzerReleaseSha256,
    claim.analyzerReleaseSha256,
  );
  const analyzerIdentityMatches = bytesEqualFullScan(
    header.analyzerIdentitySha256,
    claim.analyzerIdentitySha256,
  );
  const verifierIdentityMatches = bytesEqualFullScan(
    header.verifierIdentitySha256,
    claim.verifierIdentitySha256,
  );
  const rangeMatches = bytesEqualFullScan(
    header.rangeAndPredecessorTailsSha256,
    claim.rangeAndPredecessorTailsSha256,
  );
  const sourceReservationMatches = bytesEqualFullScan(
    header.sourceReservationSha256,
    claim.sourceReservationSha256,
  );
  const sourceAuthenticatedInputMatches = bytesEqualFullScan(
    header.sourceAuthenticatedInputSha256,
    claim.sourceAuthenticatedInputSha256,
  );
  const sourceOutputManifestMatches = bytesEqualFullScan(
    header.sourceOutputManifestSha256,
    claim.sourceOutputManifestSha256,
  );
  const sourceSettledReceiptMatches = bytesEqualFullScan(
    header.sourceSettledReceiptSha256,
    claim.sourceSettledReceiptSha256,
  );
  const finalPageMatches = bytesEqualFullScan(
    terminal.finalPageSha256,
    claim.finalPageSha256,
  );
  const manifestSequenceMatches = bytesEqualFullScan(
    terminal.manifestSequenceSha256,
    claim.manifestSequenceSha256,
  );
  const payloadMatches = bytesEqualFullScan(
    terminal.payloadSha256,
    claim.payloadSha256,
  );
  if (
    !targetRequestMatches ||
    !targetReservationMatches ||
    !analyzerReleaseMatches ||
    !analyzerIdentityMatches ||
    !verifierIdentityMatches ||
    !sourceReservationMatches ||
    !sourceAuthenticatedInputMatches ||
    !sourceOutputManifestMatches ||
    !sourceSettledReceiptMatches
  ) {
    return Result.fail(
      transportError("claimSource", "identityMismatch", "claim"),
    );
  }
  if (
    header.targetCommandKind !== claim.targetCommandKind ||
    header.targetSequence !== claim.targetSequence ||
    !rangeMatches ||
    header.sourceCommandKind !== claim.sourceCommandKind ||
    header.sourceSequence !== claim.sourceSequence ||
    terminal.pageCount !== claim.pageCount ||
    terminal.payloadByteLength !== claim.payloadByteLength
  ) {
    return Result.fail(
      transportError("claimSource", "lineageMismatch", "claim"),
    );
  }
  if (!finalPageMatches || !manifestSequenceMatches || !payloadMatches) {
    return Result.fail(
      transportError("claimSource", "digestMismatch", "claim"),
    );
  }
  return Result.succeed(undefined);
}

function captureAllowance(
  input: unknown,
  operation: DeclarativeV2AuthenticatedCommandRestartInputV1Error["operation"],
): Result.Result<
  number,
  DeclarativeV2AuthenticatedCommandRestartInputV1Error
> {
  return isNonNegativeSafeInteger(input) && input <= 1_024
    ? Result.succeed(input)
    : Result.fail(
      transportError(operation, "invalidInput", "allowance"),
    );
}

function chargeMany(
  usage: MutableUsage,
  budget: DeclarativeV2AuthenticatedCommandRestartInputBudgetV1,
  additions: readonly (
    readonly [
      keyof DeclarativeV2AuthenticatedCommandRestartInputUsageV1,
      number,
    ]
  )[],
  operation: DeclarativeV2AuthenticatedCommandRestartInputV1Error["operation"],
  path: string,
): Result.Result<void, DeclarativeV2AuthenticatedCommandRestartInputV1Error> {
  const nextUsage = { ...usage };
  for (const [dimension, amount] of additions) {
    const charged = charge(
      nextUsage,
      budget,
      dimension,
      amount,
      operation,
      path,
    );
    if (Result.isFailure(charged)) return Result.fail(charged.failure);
  }
  Object.assign(usage, nextUsage);
  return Result.succeed(undefined);
}

function charge(
  usage: MutableUsage,
  budget: DeclarativeV2AuthenticatedCommandRestartInputBudgetV1,
  dimension: keyof DeclarativeV2AuthenticatedCommandRestartInputUsageV1,
  amount: number,
  operation: DeclarativeV2AuthenticatedCommandRestartInputV1Error["operation"],
  path: string,
): Result.Result<void, DeclarativeV2AuthenticatedCommandRestartInputV1Error> {
  if (!isNonNegativeSafeInteger(amount)) {
    return Result.fail(transportError(operation, "invalidInput", path));
  }
  const next = usage[dimension] + amount;
  // SAFETY: every usage dimension has a matching `maximum<Capitalized>`
  // budget key by naming convention.
  const budgetKey = `maximum${dimension[0]!.toUpperCase()}${dimension.slice(1)}` as
    keyof DeclarativeV2AuthenticatedCommandRestartInputBudgetV1;
  const maximum = budget[budgetKey];
  if (!Number.isSafeInteger(next) || next > maximum) {
    return Result.fail(transportError(
      operation,
      // SAFETY: every usage dimension has a matching `<dimension>Exceeded`
      // error reason by naming convention.
      `${dimension}Exceeded` as
        DeclarativeV2AuthenticatedCommandRestartInputV1Error["reason"],
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
    pages: 0,
    allocationBytes: 0,
    copyBytes: 0,
    scanBytes: 0,
    hashBytes: 0,
    transitions: 0,
  };
}

function snapshotUsage(
  usage: MutableUsage,
): DeclarativeV2AuthenticatedCommandRestartInputUsageV1 {
  return Object.freeze({ ...usage });
}

function receipt(
  before: DeclarativeV2AuthenticatedCommandRestartInputUsageV1,
  usage: MutableUsage,
  transitionCount: number,
): DeclarativeV2AuthenticatedCommandRestartInputReceiptV1 {
  const aggregate = snapshotUsage(usage);
  return Object.freeze({
    delta: Object.freeze({
      bodyBytes: aggregate.bodyBytes - before.bodyBytes,
      canonicalBytes: aggregate.canonicalBytes - before.canonicalBytes,
      frameBytes: aggregate.frameBytes - before.frameBytes,
      payloadBytes: aggregate.payloadBytes - before.payloadBytes,
      frames: aggregate.frames - before.frames,
      pages: aggregate.pages - before.pages,
      allocationBytes: aggregate.allocationBytes - before.allocationBytes,
      copyBytes: aggregate.copyBytes - before.copyBytes,
      scanBytes: aggregate.scanBytes - before.scanBytes,
      hashBytes: aggregate.hashBytes - before.hashBytes,
      transitions: aggregate.transitions - before.transitions,
    }),
    aggregate,
    transitionCount,
  });
}

function encoderState(
  states: WeakMap<object, EncoderState>,
  input: unknown,
  operation: "append" | "finishEncoder",
): Result.Result<
  EncoderState,
  DeclarativeV2AuthenticatedCommandRestartInputV1Error
> {
  const state = typeof input === "object" && input !== null
    ? states.get(input)
    : undefined;
  if (state === undefined) {
    return Result.fail(transportError(operation, "staleAuthority"));
  }
  if (state.terminal === "closed" || state.terminal === "failed") {
    return Result.fail(transportError(operation, "closed"));
  }
  if (state.terminal === "complete") {
    return Result.fail(transportError(operation, "exhausted"));
  }
  return Result.succeed(state);
}

function decoderState(
  states: WeakMap<object, DecoderState>,
  input: unknown,
  operation: "stepDecoder" | "finishDecoder",
  permitFinish = false,
): Result.Result<
  DecoderState,
  DeclarativeV2AuthenticatedCommandRestartInputV1Error
> {
  const state = typeof input === "object" && input !== null
    ? states.get(input)
    : undefined;
  if (state === undefined) {
    return Result.fail(transportError(operation, "staleAuthority"));
  }
  if (state.terminal === "closed" || state.terminal === "failed") {
    return Result.fail(transportError(operation, "closed"));
  }
  if (state.terminal === "complete") {
    return Result.fail(transportError(operation, "exhausted"));
  }
  if (!permitFinish && state.terminal === "finish") {
    return Result.fail(transportError(operation, "exhausted"));
  }
  return Result.succeed(state);
}

function sourceState<const Mode extends SourceState["mode"]>(
  states: WeakMap<object, SourceState>,
  input: unknown,
  operation: "claimSource" | "stepWire" | "metadata" | "body",
  mode: Mode,
): Result.Result<
  Extract<SourceState, { readonly mode: Mode }>,
  DeclarativeV2AuthenticatedCommandRestartInputV1Error
> {
  const state = typeof input === "object" && input !== null
    ? states.get(input)
    : undefined;
  if (state === undefined) {
    return Result.fail(transportError(operation, "staleAuthority"));
  }
  if (state.closed) return Result.fail(transportError(operation, "closed"));
  if (state.mode !== mode) {
    if (
      state.mode === "rawPages" &&
      (operation === "metadata" || operation === "body")
    ) {
      closeSource(state);
    }
    return Result.fail(transportError(operation, "staleAuthority"));
  }
  // SAFETY: the mode equality check above narrows the state union to the
  // variant whose mode matches the requested mode.
  return Result.succeed(
    state as Extract<SourceState, { readonly mode: Mode }>,
  );
}

function failEncoder(
  state: EncoderState,
  terminal: "failed" | "closed" = "failed",
): void {
  state.terminal = terminal;
  state.wireChunks = [];
  state.pendingProtocolFrame = undefined;
  clearGrammar(state.grammar);
}

function failDecoder(
  state: DecoderState,
  terminal: "failed" | "closed" = "failed",
): void {
  state.terminal = terminal;
  state.metadataFrame = undefined;
  state.pendingMetadataFrame = undefined;
  state.pendingVerifiedProtocolFrame = undefined;
  clearGrammar(state.grammar);
}

function closeSource(state: SourceState): void {
  state.closed = true;
  if (state.mode === "wire") {
    state.chunks = [];
    return;
  }
  if (state.mode === "rawPages") {
    state.header = undefined;
    state.terminal = undefined;
  }
  for (const page of state.pages) {
    page.manifestBytes = EMPTY_BYTES;
    page.manifestSha256 = EMPTY_BYTES;
    page.manifest = undefined;
    page.body = undefined;
    page.payloadHash.clear();
  }
  state.pages = [];
}

function clearGrammar(state: GrammarState): void {
  state.header = undefined;
  state.output = undefined;
  state.outputBytes = undefined;
  state.terminal = undefined;
  for (const page of state.pages) {
    page.manifestBytes = EMPTY_BYTES;
    page.manifestSha256 = EMPTY_BYTES;
    page.manifest = undefined;
    page.body = undefined;
    page.payloadHash.clear();
  }
  state.pages.splice(0);
  state.manifestSequenceHash.clear();
  state.payloadHash.clear();
}

function resetDecoderFrame(state: DecoderState): void {
  state.frameLength = undefined;
  state.frameTag = undefined;
  state.metadataFrame = undefined;
  state.metadataOffset = 0;
  state.payloadHeaderOffset = 0;
  state.payloadBodyLength = 0;
  state.payloadBodyOffset = 0;
}

function progressFrameBudget(
  budget: DeclarativeV2AuthenticatedCommandRestartInputBudgetV1,
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

function makePrefix(): Uint8Array {
  const output = new Uint8Array(PREFIX_BYTES);
  writeU32(output, 0, DOMAIN_BYTES.byteLength);
  output.set(DOMAIN_BYTES, 4);
  writeU32(
    output,
    4 + DOMAIN_BYTES.byteLength,
    DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESTART_INPUT_PROTOCOL_VERSION_V1,
  );
  return output;
}

function frameLengthPrefix(byteLength: number): Uint8Array {
  const output = new Uint8Array(FRAME_LENGTH_BYTES);
  writeU32(output, 0, byteLength);
  return output;
}

function transportError(
  operation: DeclarativeV2AuthenticatedCommandRestartInputV1Error["operation"],
  reason: DeclarativeV2AuthenticatedCommandRestartInputV1Error["reason"],
  path?: string,
  observed?: number,
  maximum?: number,
): DeclarativeV2AuthenticatedCommandRestartInputV1Error {
  return new DeclarativeV2AuthenticatedCommandRestartInputV1Error({
    operation,
    reason,
    ...(path === undefined ? {} : { path }),
    ...(observed === undefined ? {} : { observed }),
    ...(maximum === undefined ? {} : { maximum }),
  });
}

function protocolOrTransportFailure(
  operation: "append" | "finishDecoder",
  path: string,
  failure:
    | DeclarativeV2VerifierProgressV2Error
    | DeclarativeV2AuthenticatedCommandRestartInputV1Error,
): DeclarativeV2AuthenticatedCommandRestartInputV1Error {
  if (
    failure instanceof DeclarativeV2AuthenticatedCommandRestartInputV1Error
  ) {
    return failure;
  }
  const reason = failure.reason === "invalidInput"
    ? operation === "append" ? "invalidInput" : "malformed"
    : failure.reason;
  return new DeclarativeV2AuthenticatedCommandRestartInputV1Error({
    operation,
    reason,
    path,
    ...(failure.observed === undefined ? {} : { observed: failure.observed }),
    ...(failure.maximum === undefined ? {} : { maximum: failure.maximum }),
    protocolCause: failure,
  });
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

function captureRestartKind(
  input: unknown,
): DeclarativeV2VerifierRestartCommandKindV2 | undefined {
  return input === "parse_module" || input === "link_page"
    ? input
    : undefined;
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

function restartKindFromTag(
  tag: number,
): DeclarativeV2VerifierRestartCommandKindV2 | undefined {
  return tag === 2 ? "parse_module" : tag === 3 ? "link_page" : undefined;
}

function captureU64(input: unknown, positive: boolean): bigint | undefined {
  return typeof input === "bigint" &&
      input >= (positive ? 1n : 0n) &&
      input <= MAX_I64
    ? input
    : undefined;
}

function intrinsicByteLength(value: Uint8Array): number | undefined {
  if (UINT8_ARRAY_BYTE_LENGTH_GETTER === undefined) return undefined;
  try {
    // SAFETY: the intrinsic Uint8Array.prototype byteLength getter returns
    // a number when applied to a Uint8Array receiver.
    return Reflect.apply(UINT8_ARRAY_BYTE_LENGTH_GETTER, value, []) as number;
  } catch {
    return undefined;
  }
}

function copyDigest(
  output: Uint8Array,
  offset: number,
  input: unknown,
): void {
  try {
    // SAFETY: every caller validated this value as a digest Uint8Array
    // before delegating the copy here.
    output.set(input as Uint8Array, offset);
  } catch {
    throw new Error("A1b2c0b2c1a validated digest copy failed.");
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
    ? input[offset]! * 0x1_00_00_00 +
      input[offset + 1]! * 0x1_00_00 +
      input[offset + 2]! * 0x1_00 +
      input[offset + 3]!
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
      block[offset]! * 0x1_00_00_00 +
      block[offset + 1]! * 0x1_00_00 +
      block[offset + 2]! * 0x1_00 +
      block[offset + 3]!
    ) >>> 0;
  }
  for (let index = 16; index < 64; index += 1) {
    const a = words[index - 15]!;
    const b = words[index - 2]!;
    const sigma0 = rotateRight(a, 7) ^ rotateRight(a, 18) ^ (a >>> 3);
    const sigma1 = rotateRight(b, 17) ^ rotateRight(b, 19) ^ (b >>> 10);
    words[index] = (
      words[index - 16]! +
      sigma0 +
      words[index - 7]! +
      sigma1
    ) >>> 0;
  }
  let a = hash[0]!;
  let b = hash[1]!;
  let c = hash[2]!;
  let d = hash[3]!;
  let e = hash[4]!;
  let f = hash[5]!;
  let g = hash[6]!;
  let h = hash[7]!;
  for (let index = 0; index < 64; index += 1) {
    const sigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^
      rotateRight(e, 25);
    const choice = (e & f) ^ (~e & g);
    const temporary1 = (
      h + sigma1 + choice + SHA256_ROUND_CONSTANTS[index]! + words[index]!
    ) >>> 0;
    const sigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^
      rotateRight(a, 22);
    const majority = (a & b) ^ (a & c) ^ (b & c);
    const temporary2 = (sigma0 + majority) >>> 0;
    h = g;
    g = f;
    f = e;
    e = (d + temporary1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (temporary1 + temporary2) >>> 0;
  }
  hash[0] = (hash[0]! + a) >>> 0;
  hash[1] = (hash[1]! + b) >>> 0;
  hash[2] = (hash[2]! + c) >>> 0;
  hash[3] = (hash[3]! + d) >>> 0;
  hash[4] = (hash[4]! + e) >>> 0;
  hash[5] = (hash[5]! + f) >>> 0;
  hash[6] = (hash[6]! + g) >>> 0;
  hash[7] = (hash[7]! + h) >>> 0;
}

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}

const SHA256_ROUND_CONSTANTS = new Uint32Array([
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
