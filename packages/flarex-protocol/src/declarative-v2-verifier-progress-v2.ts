import {
  bytesEqualFullScan,
  isUint8Array,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Result } from "effect";

import {
  DECLARATIVE_V2_MAX_SIGNED_INT64_V1,
  DECLARATIVE_V2_SHA256_BYTES_V1,
  type DeclarativeV2CommandKindV1,
  type DeclarativeV2VerifierPhaseV1,
} from "./declarative-v2-physical-v1";

export const DECLARATIVE_V2_VERIFIER_BUDGET_PROTOCOL_IDENTITY_V2 =
  "flarex.declarative-v2/verifier-budget/v2" as const;
export const DECLARATIVE_V2_VERIFIER_PROGRESS_PROTOCOL_IDENTITY_V2 =
  "flarex.declarative-v2/verifier-progress-static/v2" as const;
export const DECLARATIVE_V2_VERIFIER_EVIDENCE_PAGE_PROTOCOL_IDENTITY_V2 =
  "flarex.declarative-v2/verifier-evidence-page/v2" as const;

export const DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2 = [
  "calls",
  "objectCalls",
  "objectBodyBytes",
  "sourceBytes",
  "sourceMapBytes",
  "semanticBytes",
  "modules",
  "importEdges",
  "exports",
  "functions",
  "tokens",
  "tokenBytes",
  "parserStates",
  "nestingDepth",
  "schemaNodes",
  "validatorNodes",
  "graphNodes",
  "frontierEntries",
  "stringBytes",
  "tableBytes",
  "canonicalBytes",
  "frameBytes",
  "hashBytes",
  "diagnosticBytes",
  "outputBytes",
  "elapsedMilliseconds",
] as const;

export type DeclarativeV2VerifierBudgetDimensionV2 =
  typeof DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2[number];

export interface DeclarativeV2VerifierFrameBudgetV2 {
  readonly maximumFrameBytes: number;
  readonly maximumCanonicalBytes: number;
}

export interface DeclarativeV2VerifierFrameUsageV2 {
  readonly frameBytes: number;
  readonly canonicalBytes: number;
}

export type DeclarativeV2VerifierBudgetFrameV2 = Readonly<{
  readonly kind: "attempt_ceilings" | "attempt_usage" | "command_budget";
}> & Readonly<Record<DeclarativeV2VerifierBudgetDimensionV2, bigint>>;

export interface DeclarativeV2VerifierAttemptIdentityFrameV2 {
  readonly kind: "attempt_identity";
  readonly candidateSha256: Uint8Array;
  readonly progressProtocolIdentity:
    typeof DECLARATIVE_V2_VERIFIER_PROGRESS_PROTOCOL_IDENTITY_V2;
  readonly budgetProtocolIdentity:
    typeof DECLARATIVE_V2_VERIFIER_BUDGET_PROTOCOL_IDENTITY_V2;
  readonly ceilingsSha256: Uint8Array;
}

export interface DeclarativeV2VerifierProgressCursorFrameV2 {
  readonly kind: "progress_cursor";
  readonly phase: DeclarativeV2VerifierPhaseV1;
  readonly settledSequence: bigint;
  readonly moduleOrdinal: bigint;
  readonly edgeOrdinal: bigint;
  readonly pageOrdinal: bigint;
  readonly previousReceiptSha256: Uint8Array | null;
}

export type DeclarativeV2VerifierDurableCommandKindV2 = Exclude<
  DeclarativeV2CommandKindV1,
  "finalize"
>;

export interface DeclarativeV2VerifierCommandReservationFrameV2 {
  readonly kind: "command_reservation";
  readonly attemptSha256: Uint8Array;
  readonly candidateSha256: Uint8Array;
  readonly commandKind: DeclarativeV2VerifierDurableCommandKindV2;
  readonly sequence: bigint;
  readonly currentProgressSha256: Uint8Array;
  readonly predecessorReceiptSha256: Uint8Array | null;
  readonly commandBudgetSha256: Uint8Array;
  readonly commandInputSha256: Uint8Array;
  readonly freshAuthenticatedInputSha256: Uint8Array;
  readonly analyzerIdentitySha256: Uint8Array;
  readonly verifierIdentitySha256: Uint8Array;
  readonly rangeAndPredecessorTailsSha256: Uint8Array;
}

export interface DeclarativeV2VerifierCommandOutputManifestFrameV2 {
  readonly kind: "command_output_manifest";
  readonly reservationSha256: Uint8Array;
  readonly commandKind: DeclarativeV2VerifierDurableCommandKindV2;
  readonly sequence: bigint;
  readonly evidenceRootSha256: Uint8Array;
  readonly evidenceCount: bigint;
  readonly diagnosticsRootSha256: Uint8Array;
  readonly diagnosticCount: bigint;
  readonly nextProgressSha256: Uint8Array;
}

export interface DeclarativeV2VerifierCommandReceiptFrameV2 {
  readonly kind: "command_receipt";
  readonly reservationSha256: Uint8Array;
  readonly commandUsageSha256: Uint8Array;
  readonly resultingAttemptUsageSha256: Uint8Array;
  readonly outputManifestSha256: Uint8Array;
  readonly nextProgressSha256: Uint8Array;
}

export type DeclarativeV2VerifierRestartCommandKindV2 = Extract<
  DeclarativeV2VerifierDurableCommandKindV2,
  "parse_module" | "link_page"
>;

export interface DeclarativeV2VerifierEvidencePageManifestFrameV2 {
  readonly kind: "evidence_page_manifest";
  readonly reservationSha256: Uint8Array;
  readonly commandKind: DeclarativeV2VerifierRestartCommandKindV2;
  readonly sequence: bigint;
  readonly pageOrdinal: bigint;
  readonly firstEvidenceOrdinal: bigint;
  readonly evidenceCount: bigint;
  readonly firstDiagnosticOrdinal: bigint;
  readonly diagnosticCount: bigint;
  readonly predecessorPageSha256: Uint8Array | null;
  readonly payloadByteLength: bigint;
  readonly payloadSha256: Uint8Array;
  readonly cumulativeDiagnosticsRootSha256: Uint8Array;
}

export type DeclarativeV2VerifierProgressFrameV2 =
  | DeclarativeV2VerifierBudgetFrameV2
  | DeclarativeV2VerifierAttemptIdentityFrameV2
  | DeclarativeV2VerifierProgressCursorFrameV2
  | DeclarativeV2VerifierCommandReservationFrameV2
  | DeclarativeV2VerifierCommandOutputManifestFrameV2
  | DeclarativeV2VerifierCommandReceiptFrameV2
  | DeclarativeV2VerifierEvidencePageManifestFrameV2;

export interface DeclarativeV2VerifierEncodedFrameV2 {
  readonly frame: DeclarativeV2VerifierProgressFrameV2;
  readonly canonicalBytes: Uint8Array;
  readonly usage: DeclarativeV2VerifierFrameUsageV2;
}

export interface DeclarativeV2VerifierProgressFrameWorkV2 {
  /**
   * Protocol-observable backing-byte capacity admitted for a successful
   * operation. It is charged even when a caller reuses preallocated storage;
   * it is not a claim about JavaScript heap allocation. Fixed engine object
   * headers are intentionally excluded.
   */
  readonly byteStorageAllocationBytes: number;
  /** Bytes copied from existing protocol byte storage into a destination. */
  readonly byteCopyBytes: number;
  /** Bytes written to a destination. Copy writes are included. */
  readonly byteWriteBytes: number;
  /** Bytes compared or otherwise scanned without retaining an owned copy. */
  readonly byteScanBytes: number;
  /** Protocol byte transitions required for a successful operation. */
  readonly primitiveTransitions: number;
}

export interface DeclarativeV2VerifierProgressFrameEncodingPlanV2 {
  readonly canonicalByteLength: number;
  readonly successfulWork: DeclarativeV2VerifierProgressFrameWorkV2;
}

export interface DeclarativeV2VerifierProgressFrameVerificationPlanV2 {
  readonly admittedByteLength: number;
  /**
   * A successful-scan ceiling derived only from the admitted byte range.
   * Malformed input can fail before all of this work is performed.
   */
  readonly successfulWorkCeiling: DeclarativeV2VerifierProgressFrameWorkV2;
}

export interface DeclarativeV2VerifierProgressFrameByteRangeV2 {
  readonly bytes: Uint8Array;
  /** Offset relative to the visible `bytes` view. */
  readonly byteOffset: number;
  readonly byteLength: number;
}

export interface DeclarativeV2VerifierProgressFrameWrittenV2 {
  readonly range: DeclarativeV2VerifierProgressFrameByteRangeV2;
  readonly usage: DeclarativeV2VerifierFrameUsageV2;
  readonly work: DeclarativeV2VerifierProgressFrameWorkV2;
}

export interface DeclarativeV2VerifierProgressFrameVerifiedV2 {
  /**
   * Digest fields are immutable views into the caller-owned admitted range.
   * The caller must retain exclusive ownership for the lifetime of this value.
   */
  readonly frame: DeclarativeV2VerifierProgressFrameV2;
  readonly canonicalBytes: Uint8Array;
  readonly usage: DeclarativeV2VerifierFrameUsageV2;
  readonly work: DeclarativeV2VerifierProgressFrameWorkV2;
}

export type DeclarativeV2VerifierProgressFrameEncodeAdmissionV2<E> = (
  plan: DeclarativeV2VerifierProgressFrameEncodingPlanV2,
) => Result.Result<
  DeclarativeV2VerifierProgressFrameByteRangeV2,
  E
>;

export type DeclarativeV2VerifierProgressFrameVerifyAdmissionV2<E> = (
  plan: DeclarativeV2VerifierProgressFrameVerificationPlanV2,
) => Result.Result<void, E>;

declare const DECLARATIVE_V2_VERIFIER_PROGRESS_FRAME_ENCODER_CURSOR_V2:
  unique symbol;

export interface DeclarativeV2VerifierProgressFrameEncoderCursorV2 {
  readonly _tag: "DeclarativeV2VerifierProgressFrameEncoderCursorV2";
  readonly [DECLARATIVE_V2_VERIFIER_PROGRESS_FRAME_ENCODER_CURSOR_V2]: true;
}

export interface DeclarativeV2VerifierProgressFrameEncoderReceiptV2 {
  readonly consumedAllowance: number;
  readonly deltaWork: DeclarativeV2VerifierProgressFrameWorkV2;
  readonly aggregateWork: DeclarativeV2VerifierProgressFrameWorkV2;
}

export type DeclarativeV2VerifierProgressFrameEncoderStepV2 =
  | Readonly<{
    readonly status: "pending";
    readonly receipt: DeclarativeV2VerifierProgressFrameEncoderReceiptV2;
  }>
  | Readonly<{
    readonly status: "complete";
    readonly written: DeclarativeV2VerifierProgressFrameWrittenV2;
    readonly receipt: DeclarativeV2VerifierProgressFrameEncoderReceiptV2;
  }>;

export interface DeclarativeV2VerifierProgressFrameEncoderFactoryV2 {
  readonly create: (
    input: unknown,
    rawBudget: unknown,
  ) => Result.Result<
    Readonly<{
      readonly cursor: DeclarativeV2VerifierProgressFrameEncoderCursorV2;
      readonly plan: DeclarativeV2VerifierProgressFrameEncodingPlanV2;
      readonly receipt: DeclarativeV2VerifierProgressFrameEncoderReceiptV2;
    }>,
    DeclarativeV2VerifierProgressV2Error
  >;
  readonly admit: <E>(
    cursor: unknown,
    admit: DeclarativeV2VerifierProgressFrameEncodeAdmissionV2<E>,
  ) => Result.Result<
    DeclarativeV2VerifierProgressFrameEncoderReceiptV2,
    DeclarativeV2VerifierProgressV2Error | E
  >;
  readonly step: (
    cursor: unknown,
    allowance: unknown,
  ) => Result.Result<
    DeclarativeV2VerifierProgressFrameEncoderStepV2,
    DeclarativeV2VerifierProgressV2Error
  >;
  readonly close: (
    cursor: unknown,
  ) => Result.Result<
    DeclarativeV2VerifierProgressFrameEncoderReceiptV2,
    DeclarativeV2VerifierProgressV2Error
  >;
}

export class DeclarativeV2VerifierProgressV2Error extends Data.TaggedError(
  "DeclarativeV2VerifierProgressV2Error",
)<{
  readonly operation: "encode" | "decode";
  readonly reason:
    | "invalidInput"
    | "invalidBudget"
    | "frameBytesExceeded"
    | "canonicalBytesExceeded"
    | "malformed"
    | "nonCanonical"
    | "unsupportedVersion";
  readonly path?: string;
  readonly observed?: number;
  readonly maximum?: number;
}> {}

export class DeclarativeV2VerifierProgressV2InvariantDefect
  extends Data.TaggedError(
    "DeclarativeV2VerifierProgressV2InvariantDefect",
  )<{
    readonly reason: "reencodeFailed" | "invalidPlatformIntrinsic";
  }> {}

type FrameKind = DeclarativeV2VerifierProgressFrameV2["kind"];
type CapturedFrame = Readonly<Record<string, bigint | string | Uint8Array | null>> & {
  readonly kind: FrameKind;
};

type FrameEncodingSegment =
  | Readonly<{
    readonly kind: "bytes";
    readonly bytes: Uint8Array;
  }>
  | Readonly<{
    readonly kind: "byte";
    readonly value: number;
  }>
  | Readonly<{
    readonly kind: "u32";
    readonly value: number;
  }>
  | Readonly<{
    readonly kind: "u64";
    readonly value: bigint;
  }>;

type MutableProgressFrameWork = {
  byteStorageAllocationBytes: number;
  byteCopyBytes: number;
  byteWriteBytes: number;
  byteScanBytes: number;
  primitiveTransitions: number;
};

interface ProgressFrameEncoderCursorState {
  readonly frame: CapturedFrame;
  readonly plan: DeclarativeV2VerifierProgressFrameEncodingPlanV2;
  readonly segments: readonly FrameEncodingSegment[];
  readonly aggregateWork: MutableProgressFrameWork;
  inputIdentity: object | null;
  range: DeclarativeV2VerifierProgressFrameByteRangeV2 | undefined;
  phase: "created" | "admitting" | "admitted";
  segmentIndex: number;
  segmentOffset: number;
  outputOffset: number;
}

const UTF8_ENCODER = new TextEncoder();
const FATAL_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype);
const UINT8_ARRAY_BYTE_LENGTH_GETTER =
  Object.getOwnPropertyDescriptor(
    TYPED_ARRAY_PROTOTYPE,
    "byteLength",
  )?.get;
const UINT8_ARRAY_BYTE_OFFSET_GETTER =
  Object.getOwnPropertyDescriptor(
    TYPED_ARRAY_PROTOTYPE,
    "byteOffset",
  )?.get;
const UINT8_ARRAY_BUFFER_GETTER =
  Object.getOwnPropertyDescriptor(
    TYPED_ARRAY_PROTOTYPE,
    "buffer",
  )?.get;
const ARRAY_BUFFER_BYTE_LENGTH_GETTER =
  Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")?.get;
const SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER =
  typeof SharedArrayBuffer === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(
      SharedArrayBuffer.prototype,
      "byteLength",
    )?.get;
const U32_MAX = 0xffff_ffff;
const MAX_CAPTURED_OWN_KEYS =
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.length + 1;
const FRAME_KINDS = new Set<FrameKind>([
  "attempt_identity",
  "attempt_ceilings",
  "attempt_usage",
  "command_budget",
  "progress_cursor",
  "command_reservation",
  "command_output_manifest",
  "command_receipt",
  "evidence_page_manifest",
]);
const PHASES = new Set<DeclarativeV2VerifierPhaseV1>([
  "source",
  "parse",
  "link",
  "registration",
  "verdict",
]);
const DURABLE_COMMAND_KINDS = new Set<
  DeclarativeV2VerifierDurableCommandKindV2
>([
  "source_page",
  "parse_module",
  "link_page",
  "registration_page",
]);
const RESTART_COMMAND_KINDS = new Set<
  DeclarativeV2VerifierRestartCommandKindV2
>([
  "parse_module",
  "link_page",
]);
const FRAME_FIELDS = {
  attempt_identity: [
    "candidateSha256",
    "progressProtocolIdentity",
    "budgetProtocolIdentity",
    "ceilingsSha256",
  ],
  attempt_ceilings: DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  attempt_usage: DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  command_budget: DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  progress_cursor: [
    "phase",
    "settledSequence",
    "moduleOrdinal",
    "edgeOrdinal",
    "pageOrdinal",
    "previousReceiptSha256",
  ],
  command_reservation: [
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
  ],
  command_output_manifest: [
    "reservationSha256",
    "commandKind",
    "sequence",
    "evidenceRootSha256",
    "evidenceCount",
    "diagnosticsRootSha256",
    "diagnosticCount",
    "nextProgressSha256",
  ],
  command_receipt: [
    "reservationSha256",
    "commandUsageSha256",
    "resultingAttemptUsageSha256",
    "outputManifestSha256",
    "nextProgressSha256",
  ],
  evidence_page_manifest: [
    "reservationSha256",
    "commandKind",
    "sequence",
    "pageOrdinal",
    "firstEvidenceOrdinal",
    "evidenceCount",
    "firstDiagnosticOrdinal",
    "diagnosticCount",
    "predecessorPageSha256",
    "payloadByteLength",
    "payloadSha256",
    "cumulativeDiagnosticsRootSha256",
  ],
} as const satisfies Readonly<Record<FrameKind, readonly string[]>>;

const DOMAIN_BYTES = Object.freeze({
  attempt_identity: UTF8_ENCODER.encode(
    "flarex.declarative-v2/attempt_identity/v2\0",
  ),
  attempt_ceilings: UTF8_ENCODER.encode(
    "flarex.declarative-v2/attempt_ceilings/v2\0",
  ),
  attempt_usage: UTF8_ENCODER.encode(
    "flarex.declarative-v2/attempt_usage/v2\0",
  ),
  command_budget: UTF8_ENCODER.encode(
    "flarex.declarative-v2/command_budget/v2\0",
  ),
  progress_cursor: UTF8_ENCODER.encode(
    "flarex.declarative-v2/progress_cursor/v2\0",
  ),
  command_reservation: UTF8_ENCODER.encode(
    "flarex.declarative-v2/command_reservation/v2\0",
  ),
  command_output_manifest: UTF8_ENCODER.encode(
    "flarex.declarative-v2/command_output_manifest/v2\0",
  ),
  command_receipt: UTF8_ENCODER.encode(
    "flarex.declarative-v2/command_receipt/v2\0",
  ),
  evidence_page_manifest: UTF8_ENCODER.encode(
    "flarex.declarative-v2/evidence_page_manifest/v2\0",
  ),
} satisfies Readonly<Record<FrameKind, Uint8Array>>);
const PROGRESS_PROTOCOL_IDENTITY_BYTES = UTF8_ENCODER.encode(
  DECLARATIVE_V2_VERIFIER_PROGRESS_PROTOCOL_IDENTITY_V2,
);
const BUDGET_PROTOCOL_IDENTITY_BYTES = UTF8_ENCODER.encode(
  DECLARATIVE_V2_VERIFIER_BUDGET_PROTOCOL_IDENTITY_V2,
);
const ACTIVE_ADMISSION_INPUTS = new WeakSet<object>();

export function encodeDeclarativeV2VerifierProgressFrameV2(
  input: unknown,
  rawBudget: unknown,
): Result.Result<
  DeclarativeV2VerifierEncodedFrameV2,
  DeclarativeV2VerifierProgressV2Error
> {
  return Result.gen(function* () {
    const budget = yield* decodeFrameBudget(rawBudget, "encode");
    const ownedFrame = yield* captureFrame(input, "encode");
    const exactLength = frameByteLength(ownedFrame);
    if (exactLength > budget.maximumFrameBytes) {
      return yield* Result.fail(limitError(
        "encode",
        "frameBytesExceeded",
        exactLength,
        budget.maximumFrameBytes,
      ));
    }
    const canonicalBytes = new Uint8Array(exactLength);
    const work = encodingWork(ownedFrame, exactLength);
    const actual = writeCapturedFrame(
      Object.freeze({
        bytes: canonicalBytes,
        byteOffset: 0,
        byteLength: exactLength,
      }),
      ownedFrame,
    );
    assertExactSuccessfulWork(work, actual);
    // SAFETY: captureFrame validated the input against the frame schema, so
    // ownedFrame satisfies the public frame brand.
    return Object.freeze({
      frame: ownedFrame as DeclarativeV2VerifierProgressFrameV2,
      canonicalBytes,
      usage: Object.freeze({
        frameBytes: exactLength,
        canonicalBytes: 0,
      }),
    });
  });
}

/**
 * Encodes after a trusted synchronous admission hook approves exact observable
 * byte work and supplies the caller-owned destination range. The callback must
 * not mutate or re-enter with the inspected input, retain the plan for reuse,
 * or return storage overlapping a borrowed frame digest. Callback throws are
 * defects; a typed callback failure is returned unchanged.
 */
export function encodeDeclarativeV2VerifierProgressFrameIntoV2<E>(
  input: unknown,
  rawBudget: unknown,
  admit: DeclarativeV2VerifierProgressFrameEncodeAdmissionV2<E>,
): Result.Result<
  DeclarativeV2VerifierProgressFrameWrittenV2,
  DeclarativeV2VerifierProgressV2Error | E
> {
  return Result.map(
    encodeFrameIntoAdmittedRange(input, rawBudget, admit),
    ({ written }) => written,
  );
}

/**
 * Creates factory-local resumable encode-into cursors. The input and admitted
 * destination are borrowed until completion or close and must not be mutated,
 * detached, or reused by the trusted caller while the cursor is active.
 * Cursor identity is process-local WeakMap state; the visible tag is inert.
 */
export function makeDeclarativeV2VerifierProgressFrameEncoderFactoryV2():
  DeclarativeV2VerifierProgressFrameEncoderFactoryV2 {
  const cursors = new WeakMap<object, ProgressFrameEncoderCursorState>();

  const create:
    DeclarativeV2VerifierProgressFrameEncoderFactoryV2["create"] =
      (input, rawBudget) => Result.gen(function* () {
        const budget = yield* decodeFrameBudget(rawBudget, "encode");
        if (
          typeof input === "object" &&
          input !== null &&
          ACTIVE_ADMISSION_INPUTS.has(input)
        ) {
          return yield* Result.fail(
            progressError("encode", "invalidInput", "admission.reentrantInput"),
          );
        }
        const frame = yield* captureFrame(input, "encode", false);
        if (hasSharedBorrowedFrameStorage(frame)) {
          return yield* Result.fail(
            progressError("encode", "invalidInput", "frame.sharedByteStorage"),
          );
        }
        const exactLength = frameByteLength(frame);
        if (exactLength > budget.maximumFrameBytes) {
          return yield* Result.fail(limitError(
            "encode",
            "frameBytesExceeded",
            exactLength,
            budget.maximumFrameBytes,
          ));
        }
        const work = encodingWork(frame, exactLength);
        const plan = Object.freeze({
          canonicalByteLength: exactLength,
          successfulWork: work,
        });
        const segments = frameEncodingSegments(frame);
        assertExactEncodingSegments(frame, exactLength, segments);
        // SAFETY: the cursor object is an inert identity token; all real
        // cursor state lives in the factory-local WeakMap keyed by this
        // object identity, so the brand carries no behavioral claims.
        const cursor = Object.freeze({
          _tag: "DeclarativeV2VerifierProgressFrameEncoderCursorV2",
        }) as DeclarativeV2VerifierProgressFrameEncoderCursorV2;
        const aggregateWork = mutableZeroProgressFrameWork();
        cursors.set(cursor, {
          frame,
          plan,
          segments,
          aggregateWork,
          inputIdentity: typeof input === "object" && input !== null
            ? input
            : null,
          range: undefined,
          phase: "created",
          segmentIndex: 0,
          segmentOffset: 0,
          outputOffset: 0,
        });
        return Object.freeze({
          cursor,
          plan,
          receipt: progressFrameEncoderReceipt(
            zeroProgressFrameWork(),
            aggregateWork,
            0,
          ),
        });
      });

  const admit:
    DeclarativeV2VerifierProgressFrameEncoderFactoryV2["admit"] =
      (rawCursor, admission) => Result.gen(function* () {
        const state = yield* progressFrameEncoderCursorState(
          cursors,
          rawCursor,
          "admit",
        );
        if (state.phase !== "created") {
          revokeProgressFrameEncoderCursor(cursors, rawCursor);
          return yield* Result.fail(
            progressError("encode", "invalidInput", "cursor.reused"),
          );
        }
        state.phase = "admitting";
        const identity = state.inputIdentity;
        if (identity !== null) ACTIVE_ADMISSION_INPUTS.add(identity);
        let admitted: ReturnType<typeof admission>;
        try {
          admitted = admission(state.plan);
        } catch (defect) {
          revokeProgressFrameEncoderCursor(cursors, rawCursor);
          throw defect;
        } finally {
          if (identity !== null) ACTIVE_ADMISSION_INPUTS.delete(identity);
        }
        if (
          // SAFETY: progressFrameEncoderCursorState already resolved this
          // raw cursor to live state, so it is an object key of the map.
          cursors.get(rawCursor as object) !== state ||
          state.phase !== "admitting"
        ) {
          revokeProgressFrameEncoderCursor(cursors, rawCursor);
          return yield* Result.fail(
            progressError("encode", "invalidInput", "cursor.reentrant"),
          );
        }
        const admittedRange = yield* Result.mapError(
          admitted,
          failure => {
            revokeProgressFrameEncoderCursor(cursors, rawCursor);
            return failure;
          },
        );
        const range = yield* Result.mapError(
          captureByteRange(admittedRange, "encode"),
          failure => {
            revokeProgressFrameEncoderCursor(cursors, rawCursor);
            return failure;
          },
        );
        if (range.byteLength !== state.plan.canonicalByteLength) {
          revokeProgressFrameEncoderCursor(cursors, rawCursor);
          return yield* Result.fail(
            progressError("encode", "invalidInput", "destination.byteLength"),
          );
        }
        if (overlapsBorrowedFrameStorage(state.frame, range)) {
          revokeProgressFrameEncoderCursor(cursors, rawCursor);
          return yield* Result.fail(
            progressError("encode", "invalidInput", "destination.overlap"),
          );
        }
        state.inputIdentity = null;
        state.range = range;
        state.phase = "admitted";
        const delta = Object.freeze({
          byteStorageAllocationBytes: range.byteLength,
          byteCopyBytes: 0,
          byteWriteBytes: 0,
          byteScanBytes: 0,
          primitiveTransitions: 0,
        });
        addProgressFrameWork(state.aggregateWork, delta);
        return progressFrameEncoderReceipt(
          delta,
          state.aggregateWork,
          0,
        );
      });

  const step:
    DeclarativeV2VerifierProgressFrameEncoderFactoryV2["step"] =
      (rawCursor, rawAllowance) => Result.gen(function* () {
        const state = yield* progressFrameEncoderCursorState(
          cursors,
          rawCursor,
          "step",
        );
        if (state.phase !== "admitted") {
          revokeProgressFrameEncoderCursor(cursors, rawCursor);
          return yield* Result.fail(
            progressError("encode", "invalidInput", "cursor.notAdmitted"),
          );
        }
        if (
          !isNonNegativeSafeInteger(rawAllowance) ||
          rawAllowance > 1024
        ) {
          revokeProgressFrameEncoderCursor(cursors, rawCursor);
          return yield* Result.fail(
            progressError("encode", "invalidBudget", "cursor.allowance"),
          );
        }
        const before = snapshotProgressFrameWork(state.aggregateWork);
        if (rawAllowance === 0) {
          return Object.freeze({
            status: "pending",
            receipt: progressFrameEncoderReceipt(
              zeroProgressFrameWork(),
              state.aggregateWork,
              0,
            ),
          });
        }
        const range = state.range;
        if (
          range === undefined ||
          !isCurrentProgressFrameDestination(range)
        ) {
          revokeProgressFrameEncoderCursor(cursors, rawCursor);
          return yield* Result.fail(
            progressError("encode", "invalidInput", "cursor.destination"),
          );
        }
        let consumedAllowance = 0;
        let copied = 0;
        while (
          consumedAllowance < rawAllowance &&
          state.outputOffset < state.plan.canonicalByteLength
        ) {
          const segment = state.segments[state.segmentIndex];
          if (segment === undefined) {
            revokeProgressFrameEncoderCursor(cursors, rawCursor);
            throw new DeclarativeV2VerifierProgressV2InvariantDefect({
              reason: "reencodeFailed",
            });
          }
          const next = frameEncodingSegmentByte(
            segment,
            state.segmentOffset,
          );
          if (next === undefined) {
            revokeProgressFrameEncoderCursor(cursors, rawCursor);
            return yield* Result.fail(
              progressError(
                "encode",
                "invalidInput",
                "cursor.borrowedByteStorage",
              ),
            );
          }
          range.bytes[range.byteOffset + state.outputOffset] = next;
          if (segment.kind === "bytes") copied += 1;
          state.outputOffset += 1;
          state.segmentOffset += 1;
          consumedAllowance += 1;
          if (
            state.segmentOffset === frameEncodingSegmentLength(segment)
          ) {
            state.segmentIndex += 1;
            state.segmentOffset = 0;
          }
        }
        const delta = Object.freeze({
          byteStorageAllocationBytes: 0,
          byteCopyBytes: copied,
          byteWriteBytes: consumedAllowance,
          byteScanBytes: 0,
          primitiveTransitions: consumedAllowance,
        });
        addProgressFrameWork(state.aggregateWork, delta);
        const receipt = progressFrameEncoderReceipt(
          subtractProgressFrameWork(
            snapshotProgressFrameWork(state.aggregateWork),
            before,
          ),
          state.aggregateWork,
          consumedAllowance,
        );
        if (
          state.outputOffset <
            state.plan.canonicalByteLength
        ) {
          return Object.freeze({
            status: "pending",
            receipt,
          });
        }
        const aggregate = snapshotProgressFrameWork(
          state.aggregateWork,
        );
        assertExactSuccessfulWork(
          state.plan.successfulWork,
          aggregate,
        );
        const written = Object.freeze({
          range,
          usage: Object.freeze({
            frameBytes: range.byteLength,
            canonicalBytes: 0,
          }),
          work: aggregate,
        });
        revokeProgressFrameEncoderCursor(cursors, rawCursor);
        return Object.freeze({
          status: "complete",
          written,
          receipt,
        });
      });

  const close:
    DeclarativeV2VerifierProgressFrameEncoderFactoryV2["close"] =
      rawCursor =>
        Result.map(
          progressFrameEncoderCursorState(
          cursors,
          rawCursor,
          "close",
          ),
          state => {
            const aggregate = snapshotProgressFrameWork(state.aggregateWork);
            revokeProgressFrameEncoderCursor(cursors, rawCursor);
            return progressFrameEncoderReceipt(
              zeroProgressFrameWork(),
              aggregate,
              0,
            );
          },
        );

  return Object.freeze({ create, admit, step, close });
}

/**
 * Verifies a caller-owned byte range without a defensive byte copy. Admission
 * occurs before parsing or canonical comparison. Digest fields in the returned
 * frame are views into the admitted range and therefore remain inert evidence,
 * not independently owned capability state.
 */
export function verifyOwnedDeclarativeV2VerifierProgressFrameV2<E>(
  rawRange: unknown,
  rawBudget: unknown,
  admit: DeclarativeV2VerifierProgressFrameVerifyAdmissionV2<E>,
): Result.Result<
  DeclarativeV2VerifierProgressFrameVerifiedV2,
  DeclarativeV2VerifierProgressV2Error | E
> {
  return Result.gen(function* () {
    const budget = yield* decodeFrameBudget(rawBudget, "decode");
    const range = yield* captureByteRange(rawRange, "decode");
    if (range.byteLength === 0) {
      return yield* Result.fail(progressError("decode", "invalidInput"));
    }
    if (range.byteLength > budget.maximumFrameBytes) {
      return yield* Result.fail(limitError(
        "decode",
        "frameBytesExceeded",
        range.byteLength,
        budget.maximumFrameBytes,
      ));
    }
    const work = verificationWork(range.byteLength);
    const plan = Object.freeze({
      admittedByteLength: range.byteLength,
      successfulWorkCeiling: work,
    });
    yield* admit(plan);
    const visibleLengthAfterAdmission = intrinsicByteLength(range.bytes);
    if (
      visibleLengthAfterAdmission === undefined ||
      range.byteOffset > visibleLengthAfterAdmission ||
      range.byteLength > visibleLengthAfterAdmission - range.byteOffset
    ) {
      return yield* Result.fail(
        progressError("decode", "invalidInput", "admission.mutatedByteRange"),
      );
    }
    const input = range.byteOffset === 0 &&
        range.byteLength === visibleLengthAfterAdmission
      ? range.bytes
      : range.bytes.subarray(
        range.byteOffset,
        range.byteOffset + range.byteLength,
      );
    const parsed = yield* parseOwnedFrame(input, false);
    if (frameByteLength(parsed) !== input.byteLength) {
      return yield* Result.fail(progressError("decode", "nonCanonical"));
    }
    const comparison = compareCapturedFrame(input, parsed);
    if (!comparison.matches) {
      return yield* Result.fail(progressError("decode", "nonCanonical"));
    }
    if (
      comparison.work.byteStorageAllocationBytes !== 0 ||
      comparison.work.byteCopyBytes !== 0 ||
      comparison.work.byteWriteBytes !== 0 ||
      comparison.work.byteScanBytes > work.byteScanBytes ||
      comparison.work.primitiveTransitions > work.primitiveTransitions
    ) {
      throw new DeclarativeV2VerifierProgressV2InvariantDefect({
        reason: "reencodeFailed",
      });
    }
    // SAFETY: parseOwnedFrame succeeded, so parsed is a captured frame that
    // satisfies the public frame brand.
    return Object.freeze({
      frame: parsed as DeclarativeV2VerifierProgressFrameV2,
      canonicalBytes: input,
      usage: Object.freeze({
        frameBytes: input.byteLength,
        canonicalBytes: 0,
      }),
      work: comparison.work,
    });
  });
}

interface EncodedAdmittedRangeV2 {
  readonly written: DeclarativeV2VerifierProgressFrameWrittenV2;
}

function encodeFrameIntoAdmittedRange<E>(
  input: unknown,
  rawBudget: unknown,
  admit: DeclarativeV2VerifierProgressFrameEncodeAdmissionV2<E>,
): Result.Result<
  EncodedAdmittedRangeV2,
  DeclarativeV2VerifierProgressV2Error | E
> {
  const factory = makeDeclarativeV2VerifierProgressFrameEncoderFactoryV2();
  return Result.gen(function* () {
    const created = yield* factory.create(input, rawBudget);
    yield* factory.admit(created.cursor, admit);
    while (true) {
      const stepped = yield* factory.step(created.cursor, 1024);
      if (stepped.status === "complete") {
        return Object.freeze({
          written: stepped.written,
        });
      }
    }
  });
}

export function decodeDeclarativeV2VerifierProgressFrameV2(
  input: unknown,
  rawBudget: unknown,
): Result.Result<
  DeclarativeV2VerifierEncodedFrameV2,
  DeclarativeV2VerifierProgressV2Error
> {
  return Result.gen(function* () {
    const budget = yield* decodeFrameBudget(rawBudget, "decode");
    if (!isUint8Array(input)) {
      return yield* Result.fail(progressError("decode", "invalidInput"));
    }
    const length = intrinsicByteLength(input);
    if (length === undefined || length === 0) {
      return yield* Result.fail(progressError("decode", "invalidInput"));
    }
    if (length > budget.maximumFrameBytes) {
      return yield* Result.fail(limitError(
        "decode",
        "frameBytesExceeded",
        length,
        budget.maximumFrameBytes,
      ));
    }
    let owned: Uint8Array;
    try {
      owned = new Uint8Array(input);
    } catch {
      return yield* Result.fail(progressError("decode", "invalidInput"));
    }
    const parsed = yield* parseOwnedFrame(owned);
    const encoded = encodeDeclarativeV2VerifierProgressFrameV2(parsed, budget);
    const canonical = Result.match(encoded, {
      onSuccess: (frame) => frame.canonicalBytes,
      onFailure: () => {
        throw new DeclarativeV2VerifierProgressV2InvariantDefect({
          reason: "reencodeFailed",
        });
      },
    });
    if (!bytesEqualFullScan(owned, canonical)) {
      return yield* Result.fail(progressError("decode", "nonCanonical"));
    }
    // SAFETY: parseOwnedFrame succeeded, so parsed is a captured frame that
    // satisfies the public frame brand.
    return Object.freeze({
      frame: parsed as DeclarativeV2VerifierProgressFrameV2,
      canonicalBytes: owned,
      usage: Object.freeze({ frameBytes: owned.byteLength, canonicalBytes: 0 }),
    });
  });
}

export function requireDeclarativeV2VerifierProtocolIdentitiesV2(
  input: unknown,
): Result.Result<
  Readonly<{
    readonly budgetProtocolIdentity:
      typeof DECLARATIVE_V2_VERIFIER_BUDGET_PROTOCOL_IDENTITY_V2;
    readonly progressProtocolIdentity:
      typeof DECLARATIVE_V2_VERIFIER_PROGRESS_PROTOCOL_IDENTITY_V2;
  }>,
  DeclarativeV2VerifierProgressV2Error
> {
  const captured = captureOwnDataRecord(input);
  if (
    captured === undefined ||
    !hasExactCapturedKeys(captured, [
      "budgetProtocolIdentity",
      "progressProtocolIdentity",
    ])
  ) {
    return Result.fail(progressError("decode", "invalidInput", "identities"));
  }
  const budgetProtocolIdentity = captured.budgetProtocolIdentity;
  const progressProtocolIdentity = captured.progressProtocolIdentity;
  if (
    budgetProtocolIdentity !== DECLARATIVE_V2_VERIFIER_BUDGET_PROTOCOL_IDENTITY_V2 ||
    progressProtocolIdentity !== DECLARATIVE_V2_VERIFIER_PROGRESS_PROTOCOL_IDENTITY_V2
  ) {
    return Result.fail(
      progressError("decode", "unsupportedVersion", "identities"),
    );
  }
  return Result.succeed(Object.freeze({
    budgetProtocolIdentity,
    progressProtocolIdentity,
  }));
}

export function validateDeclarativeV2VerifierEvidencePageTransitionV2(
  previousInput: unknown,
  previousPageSha256Input: unknown,
  currentInput: unknown,
): Result.Result<
  void,
  DeclarativeV2VerifierProgressV2Error
> {
  return Result.gen(function* () {
    const previous = yield* captureFrame(previousInput, "decode");
    const current = yield* captureFrame(currentInput, "decode");
    if (
      previous.kind !== "evidence_page_manifest" ||
      current.kind !== "evidence_page_manifest" ||
      !isDigest(previousPageSha256Input) ||
      current.reservationSha256 === null ||
      current.predecessorPageSha256 === null ||
      // SAFETY: captureFrame validated both frames as evidence_page_manifest
      // manifests whose digest and u64 counter fields hold the cast types;
      // nullable members were excluded by the guards above.
      !bytesEqualFullScan(
        previous.reservationSha256 as Uint8Array,
        current.reservationSha256 as Uint8Array,
      ) ||
      previous.commandKind !== current.commandKind ||
      previous.sequence !== current.sequence ||
      previous.pageOrdinal === DECLARATIVE_V2_MAX_SIGNED_INT64_V1 ||
      // SAFETY: captureFrame validated the ordinal and count fields of both
      // evidence_page_manifest frames as u64 bigints, so they are non-null.
      current.pageOrdinal !== (previous.pageOrdinal as bigint) + 1n ||
      current.firstEvidenceOrdinal !==
        // SAFETY: captureFrame validated the ordinal and count fields of
        // both evidence_page_manifest frames as u64 bigints.
        (previous.firstEvidenceOrdinal as bigint) +
          (previous.evidenceCount as bigint) ||
      current.firstDiagnosticOrdinal !==
        // SAFETY: captureFrame validated these counter fields as u64
        // bigints.
        (previous.firstDiagnosticOrdinal as bigint) +
          (previous.diagnosticCount as bigint) ||
      // SAFETY: predecessorPageSha256 was proven non-null above and holds a
      // validated digest value.
      !bytesEqualFullScan(
        current.predecessorPageSha256 as Uint8Array,
        previousPageSha256Input,
      )
    ) {
      return yield* Result.fail(
        progressError("decode", "invalidInput", "evidencePageTransition"),
      );
    }
  });
}

export function validateDeclarativeV2VerifierFinalEvidencePageV2(
  finalPageInput: unknown,
  finalPageSha256Input: unknown,
  outputManifestInput: unknown,
): Result.Result<
  void,
  DeclarativeV2VerifierProgressV2Error
> {
  return Result.gen(function* () {
    const finalPage = yield* captureFrame(finalPageInput, "decode");
    const output = yield* captureFrame(outputManifestInput, "decode");
    if (
      finalPage.kind !== "evidence_page_manifest" ||
      output.kind !== "command_output_manifest" ||
      !isDigest(finalPageSha256Input) ||
      // SAFETY: captureFrame validated both frames against their kind
      // schemas, so digest fields hold Uint8Array and counter fields hold
      // non-null u64 bigints.
      !bytesEqualFullScan(
        finalPage.reservationSha256 as Uint8Array,
        output.reservationSha256 as Uint8Array,
      ) ||
      finalPage.commandKind !== output.commandKind ||
      finalPage.sequence !== output.sequence ||
      // SAFETY: captureFrame validated the ordinal and count fields of
      // both frames as non-null u64 bigints.
      (finalPage.firstEvidenceOrdinal as bigint) +
          (finalPage.evidenceCount as bigint) !== output.evidenceCount ||
      // SAFETY: captureFrame validated these counter fields as non-null
      // u64 bigints.
      (finalPage.firstDiagnosticOrdinal as bigint) +
          (finalPage.diagnosticCount as bigint) !== output.diagnosticCount ||
      // SAFETY: captureFrame validated evidenceRootSha256 as a digest
      // Uint8Array.
      !bytesEqualFullScan(
        finalPageSha256Input,
        output.evidenceRootSha256 as Uint8Array,
      ) ||
      // SAFETY: captureFrame validated cumulativeDiagnosticsRootSha256 as
      // a digest Uint8Array.
      !bytesEqualFullScan(
        finalPage.cumulativeDiagnosticsRootSha256 as Uint8Array,
        output.diagnosticsRootSha256 as Uint8Array,
      )
    ) {
      return yield* Result.fail(
        progressError("decode", "invalidInput", "finalEvidencePage"),
      );
    }
  });
}

function decodeFrameBudget(
  input: unknown,
  operation: "encode" | "decode",
): Result.Result<
  Readonly<DeclarativeV2VerifierFrameBudgetV2>,
  DeclarativeV2VerifierProgressV2Error
> {
  const captured = captureOwnDataRecord(input);
  if (
    captured === undefined ||
    !hasExactCapturedKeys(captured, [
      "maximumFrameBytes",
      "maximumCanonicalBytes",
    ])
  ) {
    return Result.fail(progressError(operation, "invalidBudget"));
  }
  const maximumFrameBytes = captured.maximumFrameBytes;
  const maximumCanonicalBytes = captured.maximumCanonicalBytes;
  if (
    !isNonNegativeSafeInteger(maximumFrameBytes) ||
    !isNonNegativeSafeInteger(maximumCanonicalBytes)
  ) {
    return Result.fail(progressError(operation, "invalidBudget"));
  }
  return Result.succeed(Object.freeze({
    maximumFrameBytes,
    maximumCanonicalBytes,
  }));
}

function captureFrame(
  input: unknown,
  operation: "encode" | "decode",
  copyByteFields = true,
): Result.Result<CapturedFrame, DeclarativeV2VerifierProgressV2Error> {
  const captured = captureOwnDataRecord(input);
  if (captured === undefined) {
    return Result.fail(progressError(operation, "invalidInput"));
  }
  const rawKind = captured.kind;
  // SAFETY: rawKind is proven to be a plain string before the membership
  // test; the cast only narrows it to the set's element type.
  if (typeof rawKind !== "string" || !FRAME_KINDS.has(rawKind as FrameKind)) {
    return Result.fail(progressError(operation, "invalidInput", "kind"));
  }
  // SAFETY: the membership test above proved rawKind is a known frame
  // kind.
  const kind = rawKind as FrameKind;
  const fields = FRAME_FIELDS[kind];
  if (!hasExactCapturedKeys(captured, ["kind", ...fields])) {
    return Result.fail(progressError(operation, "invalidInput", kind));
  }
  if (
    kind === "attempt_ceilings" ||
    kind === "attempt_usage" ||
    kind === "command_budget"
  ) {
    const result: Record<string, bigint | string> = { kind };
    for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
      const value = captured[dimension];
      if (!isU64(value)) {
        return Result.fail(progressError(
          operation,
          "invalidInput",
          `${kind}.${dimension}`,
        ));
      }
      result[dimension] = value;
    }
    // SAFETY: every dimension was validated as a u64 above and the record
    // carries the validated kind, so it satisfies CapturedFrame.
    return Result.succeed(Object.freeze(result) as CapturedFrame);
  }
  if (kind === "attempt_identity") {
    const candidateSha256 = captured.candidateSha256;
    const progressProtocolIdentity = captured.progressProtocolIdentity;
    const budgetProtocolIdentity = captured.budgetProtocolIdentity;
    const ceilingsSha256 = captured.ceilingsSha256;
    if (
      !isUint8ArrayWithByteLength(
        candidateSha256,
        DECLARATIVE_V2_SHA256_BYTES_V1,
      ) ||
      progressProtocolIdentity !==
        DECLARATIVE_V2_VERIFIER_PROGRESS_PROTOCOL_IDENTITY_V2 ||
      budgetProtocolIdentity !==
        DECLARATIVE_V2_VERIFIER_BUDGET_PROTOCOL_IDENTITY_V2 ||
      !isUint8ArrayWithByteLength(
        ceilingsSha256,
        DECLARATIVE_V2_SHA256_BYTES_V1,
      )
    ) {
      return Result.fail(
        progressError(operation, "invalidInput", "attempt_identity"),
      );
    }
    return Result.succeed(Object.freeze({
      kind,
      candidateSha256: retainDigest(candidateSha256, copyByteFields),
      progressProtocolIdentity,
      budgetProtocolIdentity,
      ceilingsSha256: retainDigest(ceilingsSha256, copyByteFields),
    }));
  }
  if (kind === "command_reservation") {
    return captureCommandReservation(captured, operation, copyByteFields);
  }
  if (kind === "command_output_manifest") {
    return captureCommandOutputManifest(captured, operation, copyByteFields);
  }
  if (kind === "command_receipt") {
    return captureCommandReceipt(captured, operation, copyByteFields);
  }
  if (kind === "evidence_page_manifest") {
    return captureEvidencePageManifest(captured, operation, copyByteFields);
  }
  const phase = captured.phase;
  const settledSequence = captured.settledSequence;
  const moduleOrdinal = captured.moduleOrdinal;
  const edgeOrdinal = captured.edgeOrdinal;
  const pageOrdinal = captured.pageOrdinal;
  const previousReceiptSha256 = captured.previousReceiptSha256;
  if (
    // SAFETY: phase is proven to be a plain string before the membership
    // test; the cast only narrows it to the set's element type.
    typeof phase !== "string" ||
    !PHASES.has(phase as DeclarativeV2VerifierPhaseV1) ||
    !isU64(settledSequence) ||
    !isU64(moduleOrdinal) ||
    !isU64(edgeOrdinal) ||
    !isU64(pageOrdinal) ||
    !(
      previousReceiptSha256 === null ||
      isUint8ArrayWithByteLength(
        previousReceiptSha256,
        DECLARATIVE_V2_SHA256_BYTES_V1,
      )
    )
  ) {
    return Result.fail(
      progressError(operation, "invalidInput", "progress_cursor"),
    );
  }
  return Result.succeed(Object.freeze({
    kind,
    phase,
    settledSequence,
    moduleOrdinal,
    edgeOrdinal,
    pageOrdinal,
    previousReceiptSha256: previousReceiptSha256 === null
      ? null
      : retainDigest(previousReceiptSha256, copyByteFields),
  }));
}

function captureCommandReservation(
  input: Readonly<Record<string, unknown>>,
  operation: "encode" | "decode",
  copyByteFields = true,
): Result.Result<CapturedFrame, DeclarativeV2VerifierProgressV2Error> {
  const commandKind = input.commandKind;
  const sequence = input.sequence;
  const predecessorReceiptSha256 = input.predecessorReceiptSha256;
  const digestFields = [
    "attemptSha256",
    "candidateSha256",
    "currentProgressSha256",
    "commandBudgetSha256",
    "commandInputSha256",
    "freshAuthenticatedInputSha256",
    "analyzerIdentitySha256",
    "verifierIdentitySha256",
    "rangeAndPredecessorTailsSha256",
  ] as const;
  if (
    !isDurableCommandKind(commandKind) ||
    !isPositiveU64(sequence) ||
    !(
      predecessorReceiptSha256 === null ||
      isDigest(predecessorReceiptSha256)
    ) ||
    digestFields.some((field) => !isDigest(input[field]))
  ) {
    return Result.fail(
      progressError(operation, "invalidInput", "command_reservation"),
    );
  }
  return Result.succeed(Object.freeze({
    kind: "command_reservation",
    attemptSha256: retainDigest(input.attemptSha256, copyByteFields),
    candidateSha256: retainDigest(input.candidateSha256, copyByteFields),
    commandKind,
    sequence,
    currentProgressSha256: retainDigest(
      input.currentProgressSha256,
      copyByteFields,
    ),
    predecessorReceiptSha256: predecessorReceiptSha256 === null
      ? null
      : retainDigest(predecessorReceiptSha256, copyByteFields),
    commandBudgetSha256: retainDigest(input.commandBudgetSha256, copyByteFields),
    commandInputSha256: retainDigest(input.commandInputSha256, copyByteFields),
    freshAuthenticatedInputSha256: retainDigest(
      input.freshAuthenticatedInputSha256,
      copyByteFields,
    ),
    analyzerIdentitySha256: retainDigest(
      input.analyzerIdentitySha256,
      copyByteFields,
    ),
    verifierIdentitySha256: retainDigest(
      input.verifierIdentitySha256,
      copyByteFields,
    ),
    rangeAndPredecessorTailsSha256: retainDigest(
      input.rangeAndPredecessorTailsSha256,
      copyByteFields,
    ),
  }));
}

function captureCommandOutputManifest(
  input: Readonly<Record<string, unknown>>,
  operation: "encode" | "decode",
  copyByteFields = true,
): Result.Result<CapturedFrame, DeclarativeV2VerifierProgressV2Error> {
  const commandKind = input.commandKind;
  const sequence = input.sequence;
  const evidenceCount = input.evidenceCount;
  const diagnosticCount = input.diagnosticCount;
  const digestFields = [
    "reservationSha256",
    "evidenceRootSha256",
    "diagnosticsRootSha256",
    "nextProgressSha256",
  ] as const;
  if (
    !isDurableCommandKind(commandKind) ||
    !isPositiveU64(sequence) ||
    !isU64(evidenceCount) ||
    !isU64(diagnosticCount) ||
    digestFields.some((field) => !isDigest(input[field]))
  ) {
    return Result.fail(
      progressError(operation, "invalidInput", "command_output_manifest"),
    );
  }
  return Result.succeed(Object.freeze({
    kind: "command_output_manifest",
    reservationSha256: retainDigest(input.reservationSha256, copyByteFields),
    commandKind,
    sequence,
    evidenceRootSha256: retainDigest(input.evidenceRootSha256, copyByteFields),
    evidenceCount,
    diagnosticsRootSha256: retainDigest(
      input.diagnosticsRootSha256,
      copyByteFields,
    ),
    diagnosticCount,
    nextProgressSha256: retainDigest(input.nextProgressSha256, copyByteFields),
  }));
}

function captureCommandReceipt(
  input: Readonly<Record<string, unknown>>,
  operation: "encode" | "decode",
  copyByteFields = true,
): Result.Result<CapturedFrame, DeclarativeV2VerifierProgressV2Error> {
  const digestFields = [
    "reservationSha256",
    "commandUsageSha256",
    "resultingAttemptUsageSha256",
    "outputManifestSha256",
    "nextProgressSha256",
  ] as const;
  if (digestFields.some((field) => !isDigest(input[field]))) {
    return Result.fail(
      progressError(operation, "invalidInput", "command_receipt"),
    );
  }
  return Result.succeed(Object.freeze({
    kind: "command_receipt",
    reservationSha256: retainDigest(input.reservationSha256, copyByteFields),
    commandUsageSha256: retainDigest(input.commandUsageSha256, copyByteFields),
    resultingAttemptUsageSha256: retainDigest(
      input.resultingAttemptUsageSha256,
      copyByteFields,
    ),
    outputManifestSha256: retainDigest(
      input.outputManifestSha256,
      copyByteFields,
    ),
    nextProgressSha256: retainDigest(input.nextProgressSha256, copyByteFields),
  }));
}

function captureEvidencePageManifest(
  input: Readonly<Record<string, unknown>>,
  operation: "encode" | "decode",
  copyByteFields = true,
): Result.Result<CapturedFrame, DeclarativeV2VerifierProgressV2Error> {
  const commandKind = input.commandKind;
  const sequence = input.sequence;
  const pageOrdinal = input.pageOrdinal;
  const firstEvidenceOrdinal = input.firstEvidenceOrdinal;
  const evidenceCount = input.evidenceCount;
  const firstDiagnosticOrdinal = input.firstDiagnosticOrdinal;
  const diagnosticCount = input.diagnosticCount;
  const predecessorPageSha256 = input.predecessorPageSha256;
  const payloadByteLength = input.payloadByteLength;
  if (
    !isRestartCommandKind(commandKind) ||
    !isPositiveU64(sequence) ||
    !isU64(pageOrdinal) ||
    !isU64(firstEvidenceOrdinal) ||
    !isPositiveU64(evidenceCount) ||
    !isU64(firstDiagnosticOrdinal) ||
    !isU64(diagnosticCount) ||
    !isPositiveU64(payloadByteLength) ||
    !isDigest(input.reservationSha256) ||
    !isDigest(input.payloadSha256) ||
    !isDigest(input.cumulativeDiagnosticsRootSha256) ||
    !(
      predecessorPageSha256 === null ||
      isDigest(predecessorPageSha256)
    ) ||
    (pageOrdinal === 0n) !== (predecessorPageSha256 === null) ||
    !isCheckedU64Range(firstEvidenceOrdinal, evidenceCount) ||
    !isCheckedU64Range(firstDiagnosticOrdinal, diagnosticCount) ||
    diagnosticCount > evidenceCount ||
    (
      pageOrdinal === 0n &&
      (firstEvidenceOrdinal !== 0n || firstDiagnosticOrdinal !== 0n)
    )
  ) {
    return Result.fail(
      progressError(operation, "invalidInput", "evidence_page_manifest"),
    );
  }
  return Result.succeed(Object.freeze({
    kind: "evidence_page_manifest",
    reservationSha256: retainDigest(input.reservationSha256, copyByteFields),
    commandKind,
    sequence,
    pageOrdinal,
    firstEvidenceOrdinal,
    evidenceCount,
    firstDiagnosticOrdinal,
    diagnosticCount,
    predecessorPageSha256: predecessorPageSha256 === null
      ? null
      : retainDigest(predecessorPageSha256, copyByteFields),
    payloadByteLength,
    payloadSha256: retainDigest(input.payloadSha256, copyByteFields),
    cumulativeDiagnosticsRootSha256: retainDigest(
      input.cumulativeDiagnosticsRootSha256,
      copyByteFields,
    ),
  }));
}

function frameEncodingSegments(
  frame: CapturedFrame,
): readonly FrameEncodingSegment[] {
  const segments: FrameEncodingSegment[] = [];
  const bytes = (value: Uint8Array): void => {
    segments.push(Object.freeze({ kind: "bytes", bytes: value }));
  };
  const byte = (value: number): void => {
    segments.push(Object.freeze({ kind: "byte", value }));
  };
  const u32 = (value: number): void => {
    segments.push(Object.freeze({ kind: "u32", value }));
  };
  const u64 = (value: bigint): void => {
    segments.push(Object.freeze({ kind: "u64", value }));
  };
  bytes(DOMAIN_BYTES[frame.kind]);
  u32(FRAME_FIELDS[frame.kind].length);
  if (
    frame.kind === "attempt_ceilings" ||
    frame.kind === "attempt_usage" ||
    frame.kind === "command_budget"
  ) {
    for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
      // SAFETY: captureFrame validated every budget dimension as a u64.
      u64(frame[dimension] as bigint);
    }
    return Object.freeze(segments);
  }
  if (frame.kind === "attempt_identity") {
    // SAFETY: captureFrame validated candidateSha256 as a digest.
    bytes(frame.candidateSha256 as Uint8Array);
    u32(PROGRESS_PROTOCOL_IDENTITY_BYTES.byteLength);
    bytes(PROGRESS_PROTOCOL_IDENTITY_BYTES);
    u32(BUDGET_PROTOCOL_IDENTITY_BYTES.byteLength);
    bytes(BUDGET_PROTOCOL_IDENTITY_BYTES);
    // SAFETY: captureFrame validated ceilingsSha256 as a digest.
    bytes(frame.ceilingsSha256 as Uint8Array);
    return Object.freeze(segments);
  }
  if (frame.kind === "command_reservation") {
    // SAFETY: captureFrame validated attemptSha256 as a digest.
    bytes(frame.attemptSha256 as Uint8Array);
    // SAFETY: captureFrame validated candidateSha256 as a digest.
    bytes(frame.candidateSha256 as Uint8Array);
    // SAFETY: captureFrame validated commandKind as a durable kind.
    byte(durableCommandKindTag(
      frame.commandKind as DeclarativeV2VerifierDurableCommandKindV2,
    ));
    // SAFETY: captureFrame validated sequence as a non-null u64 bigint.
    u64(frame.sequence as bigint);
    // SAFETY: captureFrame validated currentProgressSha256 as a digest.
    bytes(frame.currentProgressSha256 as Uint8Array);
    // SAFETY: captureFrame validated predecessorReceiptSha256 as a digest
    // or null.
    const predecessorReceiptSha256 = frame.predecessorReceiptSha256 as
      | Uint8Array
      | null;
    byte(predecessorReceiptSha256 === null ? 0 : 1);
    if (predecessorReceiptSha256 !== null) bytes(predecessorReceiptSha256);
    for (const field of [
      "commandBudgetSha256",
      "commandInputSha256",
      "freshAuthenticatedInputSha256",
      "analyzerIdentitySha256",
      "verifierIdentitySha256",
      "rangeAndPredecessorTailsSha256",
    ] as const) {
      // SAFETY: captureFrame validated these command_reservation digest
      // fields as Uint8Array.
      bytes(frame[field] as Uint8Array);
    }
    return Object.freeze(segments);
  }
  if (frame.kind === "command_output_manifest") {
    // SAFETY: captureFrame validated reservationSha256 as a digest.
    bytes(frame.reservationSha256 as Uint8Array);
    // SAFETY: captureFrame validated commandKind as a durable kind.
    byte(durableCommandKindTag(
      frame.commandKind as DeclarativeV2VerifierDurableCommandKindV2,
    ));
    // SAFETY: captureFrame validated sequence as a non-null u64 bigint.
    u64(frame.sequence as bigint);
    // SAFETY: captureFrame validated evidenceRootSha256 as a digest.
    bytes(frame.evidenceRootSha256 as Uint8Array);
    // SAFETY: captureFrame validated evidenceCount as a non-null u64
    // bigint.
    u64(frame.evidenceCount as bigint);
    // SAFETY: captureFrame validated diagnosticsRootSha256 as a digest.
    bytes(frame.diagnosticsRootSha256 as Uint8Array);
    // SAFETY: captureFrame validated diagnosticCount as a non-null u64
    // bigint.
    u64(frame.diagnosticCount as bigint);
    // SAFETY: captureFrame validated nextProgressSha256 as a digest.
    bytes(frame.nextProgressSha256 as Uint8Array);
    return Object.freeze(segments);
  }
  if (frame.kind === "command_receipt") {
    for (const field of [
      "reservationSha256",
      "commandUsageSha256",
      "resultingAttemptUsageSha256",
      "outputManifestSha256",
      "nextProgressSha256",
    ] as const) {
      // SAFETY: captureFrame validated these command_receipt digest fields
      // as Uint8Array.
      bytes(frame[field] as Uint8Array);
    }
    return Object.freeze(segments);
  }
  if (frame.kind === "evidence_page_manifest") {
    // SAFETY: captureFrame validated reservationSha256 as a digest.
    bytes(frame.reservationSha256 as Uint8Array);
    // SAFETY: captureFrame validated commandKind as a restart kind.
    byte(restartCommandKindTag(
      frame.commandKind as DeclarativeV2VerifierRestartCommandKindV2,
    ));
    for (const field of [
      "sequence",
      "pageOrdinal",
      "firstEvidenceOrdinal",
      "evidenceCount",
      "firstDiagnosticOrdinal",
      "diagnosticCount",
    ] as const) {
      // SAFETY: captureFrame validated this counter as a u64 bigint.
      u64(frame[field] as bigint);
    }
    // SAFETY: captureFrame validated predecessorPageSha256 as a digest or
    // null.
    const predecessorPageSha256 = frame.predecessorPageSha256 as
      | Uint8Array
      | null;
    byte(predecessorPageSha256 === null ? 0 : 1);
    if (predecessorPageSha256 !== null) bytes(predecessorPageSha256);
    // SAFETY: captureFrame validated payloadByteLength as a non-null u64
    // bigint.
    u64(frame.payloadByteLength as bigint);
    // SAFETY: captureFrame validated payloadSha256 as a digest.
    bytes(frame.payloadSha256 as Uint8Array);
    // SAFETY: captureFrame validated cumulativeDiagnosticsRootSha256 as a
    // digest.
    bytes(frame.cumulativeDiagnosticsRootSha256 as Uint8Array);
    return Object.freeze(segments);
  }
  // SAFETY: captureFrame validated phase as a known verifier phase.
  byte(phaseTag(frame.phase as DeclarativeV2VerifierPhaseV1));
  for (const field of [
    "settledSequence",
    "moduleOrdinal",
    "edgeOrdinal",
    "pageOrdinal",
  ] as const) {
    // SAFETY: captureFrame validated this counter as a u64 bigint.
    u64(frame[field] as bigint);
  }
  // SAFETY: captureFrame validated previousReceiptSha256 as a digest or
  // null.
  const previousReceiptSha256 = frame.previousReceiptSha256 as
    | Uint8Array
    | null;
  byte(previousReceiptSha256 === null ? 0 : 1);
  if (previousReceiptSha256 !== null) bytes(previousReceiptSha256);
  return Object.freeze(segments);
}

function assertExactEncodingSegments(
  frame: CapturedFrame,
  canonicalByteLength: number,
  segments: readonly FrameEncodingSegment[],
): void {
  let length = 0;
  let copied = 0;
  for (const segment of segments) {
    const segmentLength = frameEncodingSegmentLength(segment);
    length = checkedLength(length, segmentLength);
    if (segment.kind === "bytes") {
      copied = checkedLength(copied, segmentLength);
    }
  }
  if (
    length !== canonicalByteLength ||
    copied !== frameByteCopyLength(frame)
  ) {
    throw new DeclarativeV2VerifierProgressV2InvariantDefect({
      reason: "reencodeFailed",
    });
  }
}

function frameEncodingSegmentLength(segment: FrameEncodingSegment): number {
  switch (segment.kind) {
    case "bytes": {
      const length = intrinsicByteLength(segment.bytes);
      if (length === undefined) {
        throw new DeclarativeV2VerifierProgressV2InvariantDefect({
          reason: "invalidPlatformIntrinsic",
        });
      }
      return length;
    }
    case "byte":
      return 1;
    case "u32":
      return 4;
    case "u64":
      return 8;
  }
}

function frameEncodingSegmentByte(
  segment: FrameEncodingSegment,
  offset: number,
): number | undefined {
  if (!isNonNegativeSafeInteger(offset)) return undefined;
  switch (segment.kind) {
    case "bytes": {
      const length = intrinsicByteLength(segment.bytes);
      if (length === undefined || offset >= length) return undefined;
      return segment.bytes[offset];
    }
    case "byte":
      return offset === 0 ? segment.value : undefined;
    case "u32":
      return offset < 4
        ? Math.floor(segment.value / (2 ** ((3 - offset) * 8))) & 0xff
        : undefined;
    case "u64":
      return offset < 8
        ? Number((segment.value >> BigInt((7 - offset) * 8)) & 0xffn)
        : undefined;
  }
}

function mutableZeroProgressFrameWork(): MutableProgressFrameWork {
  return {
    byteStorageAllocationBytes: 0,
    byteCopyBytes: 0,
    byteWriteBytes: 0,
    byteScanBytes: 0,
    primitiveTransitions: 0,
  };
}

function zeroProgressFrameWork():
  DeclarativeV2VerifierProgressFrameWorkV2 {
  return Object.freeze({
    byteStorageAllocationBytes: 0,
    byteCopyBytes: 0,
    byteWriteBytes: 0,
    byteScanBytes: 0,
    primitiveTransitions: 0,
  });
}

function snapshotProgressFrameWork(
  work: DeclarativeV2VerifierProgressFrameWorkV2,
): DeclarativeV2VerifierProgressFrameWorkV2 {
  return Object.freeze({
    byteStorageAllocationBytes: work.byteStorageAllocationBytes,
    byteCopyBytes: work.byteCopyBytes,
    byteWriteBytes: work.byteWriteBytes,
    byteScanBytes: work.byteScanBytes,
    primitiveTransitions: work.primitiveTransitions,
  });
}

function addProgressFrameWork(
  target: MutableProgressFrameWork,
  delta: DeclarativeV2VerifierProgressFrameWorkV2,
): void {
  target.byteStorageAllocationBytes = checkedWorkCount(
    target.byteStorageAllocationBytes,
    delta.byteStorageAllocationBytes,
  );
  target.byteCopyBytes = checkedWorkCount(
    target.byteCopyBytes,
    delta.byteCopyBytes,
  );
  target.byteWriteBytes = checkedWorkCount(
    target.byteWriteBytes,
    delta.byteWriteBytes,
  );
  target.byteScanBytes = checkedWorkCount(
    target.byteScanBytes,
    delta.byteScanBytes,
  );
  target.primitiveTransitions = checkedWorkCount(
    target.primitiveTransitions,
    delta.primitiveTransitions,
  );
}

function subtractProgressFrameWork(
  after: DeclarativeV2VerifierProgressFrameWorkV2,
  before: DeclarativeV2VerifierProgressFrameWorkV2,
): DeclarativeV2VerifierProgressFrameWorkV2 {
  if (
    after.byteStorageAllocationBytes < before.byteStorageAllocationBytes ||
    after.byteCopyBytes < before.byteCopyBytes ||
    after.byteWriteBytes < before.byteWriteBytes ||
    after.byteScanBytes < before.byteScanBytes ||
    after.primitiveTransitions < before.primitiveTransitions
  ) {
    throw new DeclarativeV2VerifierProgressV2InvariantDefect({
      reason: "reencodeFailed",
    });
  }
  return Object.freeze({
    byteStorageAllocationBytes:
      after.byteStorageAllocationBytes - before.byteStorageAllocationBytes,
    byteCopyBytes: after.byteCopyBytes - before.byteCopyBytes,
    byteWriteBytes: after.byteWriteBytes - before.byteWriteBytes,
    byteScanBytes: after.byteScanBytes - before.byteScanBytes,
    primitiveTransitions:
      after.primitiveTransitions - before.primitiveTransitions,
  });
}

function progressFrameEncoderReceipt(
  deltaWork: DeclarativeV2VerifierProgressFrameWorkV2,
  aggregateWork: DeclarativeV2VerifierProgressFrameWorkV2,
  consumedAllowance: number,
): DeclarativeV2VerifierProgressFrameEncoderReceiptV2 {
  return Object.freeze({
    consumedAllowance,
    deltaWork: snapshotProgressFrameWork(deltaWork),
    aggregateWork: snapshotProgressFrameWork(aggregateWork),
  });
}

function progressFrameEncoderCursorState(
  cursors: WeakMap<object, ProgressFrameEncoderCursorState>,
  cursor: unknown,
  operation: "admit" | "step" | "close",
): Result.Result<
  ProgressFrameEncoderCursorState,
  DeclarativeV2VerifierProgressV2Error
> {
  if (typeof cursor !== "object" || cursor === null) {
    return Result.fail(
      progressError("encode", "invalidInput", `cursor.${operation}`),
    );
  }
  const state = cursors.get(cursor);
  return state === undefined
    ? Result.fail(
      progressError("encode", "invalidInput", `cursor.${operation}`),
    )
    : Result.succeed(state);
}

function revokeProgressFrameEncoderCursor(
  cursors: WeakMap<object, ProgressFrameEncoderCursorState>,
  cursor: unknown,
): void {
  if (typeof cursor === "object" && cursor !== null) cursors.delete(cursor);
}

function isCurrentProgressFrameDestination(
  range: DeclarativeV2VerifierProgressFrameByteRangeV2,
): boolean {
  const visibleLength = intrinsicByteLength(range.bytes);
  return visibleLength !== undefined &&
    !isSharedArrayBufferStorage(range.bytes) &&
    range.byteOffset <= visibleLength &&
    range.byteLength <= visibleLength - range.byteOffset;
}

function frameByteLength(frame: CapturedFrame): number {
  const domainLength = DOMAIN_BYTES[frame.kind].byteLength;
  if (
    frame.kind === "attempt_ceilings" ||
    frame.kind === "attempt_usage" ||
    frame.kind === "command_budget"
  ) {
    return checkedLength(
      domainLength,
      4,
      DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.length * 8,
    );
  }
  if (frame.kind === "attempt_identity") {
    return checkedLength(
      domainLength,
      4,
      32,
      4,
      PROGRESS_PROTOCOL_IDENTITY_BYTES.byteLength,
      4,
      BUDGET_PROTOCOL_IDENTITY_BYTES.byteLength,
      32,
    );
  }
  if (frame.kind === "command_reservation") {
    return checkedLength(
      domainLength,
      4,
      32,
      32,
      1,
      8,
      32,
      frame.predecessorReceiptSha256 === null ? 1 : 33,
      32,
      32,
      32,
      32,
      32,
      32,
    );
  }
  if (frame.kind === "command_output_manifest") {
    return checkedLength(
      domainLength,
      4,
      32,
      1,
      8,
      32,
      8,
      32,
      8,
      32,
    );
  }
  if (frame.kind === "command_receipt") {
    return checkedLength(domainLength, 4, 32, 32, 32, 32, 32);
  }
  if (frame.kind === "evidence_page_manifest") {
    return checkedLength(
      domainLength,
      4,
      32,
      1,
      8,
      8,
      8,
      8,
      8,
      8,
      frame.predecessorPageSha256 === null ? 1 : 33,
      8,
      32,
      32,
    );
  }
  return checkedLength(
    domainLength,
    4,
    1,
    8,
    8,
    8,
    8,
    frame.previousReceiptSha256 === null ? 1 : 33,
  );
}

function encodingWork(
  frame: CapturedFrame,
  canonicalByteLength: number,
): DeclarativeV2VerifierProgressFrameWorkV2 {
  return Object.freeze({
    byteStorageAllocationBytes: canonicalByteLength,
    byteCopyBytes: frameByteCopyLength(frame),
    byteWriteBytes: canonicalByteLength,
    byteScanBytes: 0,
    primitiveTransitions: canonicalByteLength,
  });
}

function verificationWork(
  canonicalByteLength: number,
): DeclarativeV2VerifierProgressFrameWorkV2 {
  const successfulScanCeiling = checkedWorkCount(
    canonicalByteLength,
    canonicalByteLength,
    canonicalByteLength,
  );
  return Object.freeze({
    byteStorageAllocationBytes: 0,
    byteCopyBytes: 0,
    byteWriteBytes: 0,
    byteScanBytes: successfulScanCeiling,
    primitiveTransitions: successfulScanCeiling,
  });
}

function assertExactSuccessfulWork(
  expected: DeclarativeV2VerifierProgressFrameWorkV2,
  actual: DeclarativeV2VerifierProgressFrameWorkV2,
): void {
  if (
    actual.byteStorageAllocationBytes !== expected.byteStorageAllocationBytes ||
    actual.byteCopyBytes !== expected.byteCopyBytes ||
    actual.byteWriteBytes !== expected.byteWriteBytes ||
    actual.byteScanBytes !== expected.byteScanBytes ||
    actual.primitiveTransitions !== expected.primitiveTransitions
  ) {
    throw new DeclarativeV2VerifierProgressV2InvariantDefect({
      reason: "reencodeFailed",
    });
  }
}

function frameByteCopyLength(frame: CapturedFrame): number {
  let result = DOMAIN_BYTES[frame.kind].byteLength;
  if (frame.kind === "attempt_identity") {
    return checkedLength(
      result,
      DECLARATIVE_V2_SHA256_BYTES_V1 * 2,
      PROGRESS_PROTOCOL_IDENTITY_BYTES.byteLength,
      BUDGET_PROTOCOL_IDENTITY_BYTES.byteLength,
    );
  }
  for (const field of FRAME_FIELDS[frame.kind]) {
    if (isDigest(frame[field])) {
      result = checkedLength(result, DECLARATIVE_V2_SHA256_BYTES_V1);
    }
  }
  return result;
}

function writeCapturedFrame(
  range: DeclarativeV2VerifierProgressFrameByteRangeV2,
  frame: CapturedFrame,
): DeclarativeV2VerifierProgressFrameWorkV2 {
  let copied = 0;
  let written = 0;
  const emitted = emitCapturedFrame(frame, (offset, value, isCopied) => {
    range.bytes[range.byteOffset + offset] = value;
    written += 1;
    if (isCopied) copied += 1;
  });
  if (emitted !== range.byteLength) {
    throw new DeclarativeV2VerifierProgressV2InvariantDefect({
      reason: "reencodeFailed",
    });
  }
  return Object.freeze({
    byteStorageAllocationBytes: range.byteLength,
    byteCopyBytes: copied,
    byteWriteBytes: written,
    byteScanBytes: 0,
    primitiveTransitions: written,
  });
}

function compareCapturedFrame(
  input: Uint8Array,
  frame: CapturedFrame,
): Readonly<{
  readonly matches: boolean;
  readonly work: DeclarativeV2VerifierProgressFrameWorkV2;
}> {
  let matches = true;
  let scanned = 0;
  const emitted = emitCapturedFrame(frame, (offset, value) => {
    if (input[offset] !== value) matches = false;
    scanned += 1;
  });
  if (emitted !== input.byteLength) matches = false;
  const successfulScanBytes = checkedWorkCount(
    input.byteLength,
    scanned,
    DOMAIN_BYTES[frame.kind].byteLength,
  );
  return Object.freeze({
    matches,
    work: Object.freeze({
      byteStorageAllocationBytes: 0,
      byteCopyBytes: 0,
      byteWriteBytes: 0,
      byteScanBytes: successfulScanBytes,
      primitiveTransitions: successfulScanBytes,
    }),
  });
}

function emitCapturedFrame(
  frame: CapturedFrame,
  emitByte: (offset: number, value: number, copied: boolean) => void,
): number {
  const segments = frameEncodingSegments(frame);
  const expectedLength = frameByteLength(frame);
  assertExactEncodingSegments(frame, expectedLength, segments);
  let offset = 0;
  for (const segment of segments) {
    const length = frameEncodingSegmentLength(segment);
    for (let segmentOffset = 0; segmentOffset < length; segmentOffset += 1) {
      const value = frameEncodingSegmentByte(segment, segmentOffset);
      if (value === undefined) {
        throw new DeclarativeV2VerifierProgressV2InvariantDefect({
          reason: "reencodeFailed",
        });
      }
      emitByte(offset, value, segment.kind === "bytes");
      offset += 1;
    }
  }
  return offset;
}

function parseOwnedFrame(
  input: Uint8Array,
  copyByteFields = true,
): Result.Result<CapturedFrame, DeclarativeV2VerifierProgressV2Error> {
  return Result.gen(function* () {
    const parsedDomain = yield* readDomain(input);
    const kind = parsedDomain.kind;
    let offset = parsedDomain.offset;
    const fieldCount = readU32(input, offset);
    if (fieldCount === undefined || fieldCount !== FRAME_FIELDS[kind].length) {
      return yield* Result.fail(
        progressError("decode", "malformed", "fieldCount"),
      );
    }
    offset += 4;
    if (
      kind === "attempt_ceilings" ||
      kind === "attempt_usage" ||
      kind === "command_budget"
    ) {
      const values: Record<string, string | bigint> = { kind };
      for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
        const value = readU64(input, offset);
        if (value === undefined) {
          return yield* Result.fail(
            progressError("decode", "malformed", `${kind}.${dimension}`),
          );
        }
        values[dimension] = value;
        offset += 8;
      }
      if (offset !== input.byteLength) {
        return yield* Result.fail(progressError("decode", "malformed", "trailing"));
      }
      // SAFETY: every budget dimension was decoded as a u64 above and the
      // record carries the validated kind, so it satisfies CapturedFrame.
      return Object.freeze(values) as CapturedFrame;
    }
    if (kind === "attempt_identity") {
      const candidateSha256 = readDigest(input, offset, copyByteFields);
      if (candidateSha256 === undefined) {
        return yield* Result.fail(progressError("decode", "malformed"));
      }
      offset += 32;
      const progress = yield* readString(input, offset);
      offset = progress.offset;
      const budget = yield* readString(input, offset);
      offset = budget.offset;
      const ceilingsSha256 = readDigest(input, offset, copyByteFields);
      if (
        ceilingsSha256 === undefined ||
        offset + 32 !== input.byteLength
      ) {
        return yield* Result.fail(
          progressError("decode", "malformed", "attempt_identity"),
        );
      }
      if (
        progress.value !==
          DECLARATIVE_V2_VERIFIER_PROGRESS_PROTOCOL_IDENTITY_V2 ||
        budget.value !==
          DECLARATIVE_V2_VERIFIER_BUDGET_PROTOCOL_IDENTITY_V2
      ) {
        return yield* Result.fail(
          progressError("decode", "unsupportedVersion", "attempt_identity"),
        );
      }
      return Object.freeze({
        kind,
        candidateSha256,
        progressProtocolIdentity: progress.value,
        budgetProtocolIdentity: budget.value,
        ceilingsSha256,
      });
    }
    if (kind === "command_reservation") {
      const attempt = yield* readRequiredDigest(
        input,
        offset,
        kind,
        copyByteFields,
      );
      offset = attempt.offset;
      const candidate = yield* readRequiredDigest(
        input,
        offset,
        kind,
        copyByteFields,
      );
      offset = candidate.offset;
      const commandKind = durableCommandKindFromTag(input[offset] ?? 0);
      if (commandKind === undefined) {
        return yield* Result.fail(
          progressError("decode", "malformed", `${kind}.commandKind`),
        );
      }
      offset += 1;
      const sequence = readU64(input, offset);
      if (sequence === undefined || sequence === 0n) {
        return yield* Result.fail(
          progressError("decode", "malformed", `${kind}.sequence`),
        );
      }
      offset += 8;
      const currentProgress = yield* readRequiredDigest(
        input,
        offset,
        kind,
        copyByteFields,
      );
      offset = currentProgress.offset;
      const predecessor = yield* readOptionalDigest(
        input,
        offset,
        kind,
        copyByteFields,
      );
      offset = predecessor.offset;
      const commandBudget = yield* readRequiredDigest(
        input,
        offset,
        kind,
        copyByteFields,
      );
      offset = commandBudget.offset;
      const commandInput = yield* readRequiredDigest(
        input,
        offset,
        kind,
        copyByteFields,
      );
      offset = commandInput.offset;
      const authenticatedInput = yield* readRequiredDigest(
        input,
        offset,
        kind,
        copyByteFields,
      );
      offset = authenticatedInput.offset;
      const analyzerIdentity = yield* readRequiredDigest(
        input,
        offset,
        kind,
        copyByteFields,
      );
      offset = analyzerIdentity.offset;
      const verifierIdentity = yield* readRequiredDigest(
        input,
        offset,
        kind,
        copyByteFields,
      );
      offset = verifierIdentity.offset;
      const rangeAndTails = yield* readRequiredDigest(
        input,
        offset,
        kind,
        copyByteFields,
      );
      offset = rangeAndTails.offset;
      if (offset !== input.byteLength) {
        return yield* Result.fail(
          progressError("decode", "malformed", "trailing"),
        );
      }
      return Object.freeze({
        kind,
        attemptSha256: attempt.value,
        candidateSha256: candidate.value,
        commandKind,
        sequence,
        currentProgressSha256: currentProgress.value,
        predecessorReceiptSha256: predecessor.value,
        commandBudgetSha256: commandBudget.value,
        commandInputSha256: commandInput.value,
        freshAuthenticatedInputSha256: authenticatedInput.value,
        analyzerIdentitySha256: analyzerIdentity.value,
        verifierIdentitySha256: verifierIdentity.value,
        rangeAndPredecessorTailsSha256: rangeAndTails.value,
      });
    }
    if (kind === "command_output_manifest") {
      const reservation = yield* readRequiredDigest(
        input,
        offset,
        kind,
        copyByteFields,
      );
      offset = reservation.offset;
      const commandKind = durableCommandKindFromTag(input[offset] ?? 0);
      if (commandKind === undefined) {
        return yield* Result.fail(
          progressError("decode", "malformed", `${kind}.commandKind`),
        );
      }
      offset += 1;
      const sequence = readU64(input, offset);
      if (sequence === undefined || sequence === 0n) {
        return yield* Result.fail(
          progressError("decode", "malformed", `${kind}.sequence`),
        );
      }
      offset += 8;
      const evidenceRoot = yield* readRequiredDigest(
        input,
        offset,
        kind,
        copyByteFields,
      );
      offset = evidenceRoot.offset;
      const evidenceCount = readU64(input, offset);
      if (evidenceCount === undefined) {
        return yield* Result.fail(
          progressError("decode", "malformed", `${kind}.evidenceCount`),
        );
      }
      offset += 8;
      const diagnosticsRoot = yield* readRequiredDigest(
        input,
        offset,
        kind,
        copyByteFields,
      );
      offset = diagnosticsRoot.offset;
      const diagnosticCount = readU64(input, offset);
      if (diagnosticCount === undefined) {
        return yield* Result.fail(
          progressError("decode", "malformed", `${kind}.diagnosticCount`),
        );
      }
      offset += 8;
      const nextProgress = yield* readRequiredDigest(
        input,
        offset,
        kind,
        copyByteFields,
      );
      offset = nextProgress.offset;
      if (offset !== input.byteLength) {
        return yield* Result.fail(
          progressError("decode", "malformed", "trailing"),
        );
      }
      return Object.freeze({
        kind,
        reservationSha256: reservation.value,
        commandKind,
        sequence,
        evidenceRootSha256: evidenceRoot.value,
        evidenceCount,
        diagnosticsRootSha256: diagnosticsRoot.value,
        diagnosticCount,
        nextProgressSha256: nextProgress.value,
      });
    }
    if (kind === "command_receipt") {
      const values: Record<string, Uint8Array | string> = { kind };
      for (const field of FRAME_FIELDS.command_receipt) {
        const digest = yield* readRequiredDigest(
          input,
          offset,
          kind,
          copyByteFields,
        );
        values[field] = digest.value;
        offset = digest.offset;
      }
      if (offset !== input.byteLength) {
        return yield* Result.fail(
          progressError("decode", "malformed", "trailing"),
        );
      }
      // SAFETY: every command_receipt digest was decoded above and the
      // record carries the validated kind, so it satisfies CapturedFrame.
      return Object.freeze(values) as CapturedFrame;
    }
    if (kind === "evidence_page_manifest") {
      const reservation = yield* readRequiredDigest(
        input,
        offset,
        kind,
        copyByteFields,
      );
      offset = reservation.offset;
      const commandKind = restartCommandKindFromTag(input[offset] ?? 0);
      if (commandKind === undefined) {
        return yield* Result.fail(
          progressError("decode", "malformed", `${kind}.commandKind`),
        );
      }
      offset += 1;
      const counters: bigint[] = [];
      for (let index = 0; index < 6; index += 1) {
        const value = readU64(input, offset);
        if (value === undefined) {
          return yield* Result.fail(
            progressError("decode", "malformed", kind),
          );
        }
        counters.push(value);
        offset += 8;
      }
      if (counters[0] === 0n || counters[3] === 0n) {
        return yield* Result.fail(
          progressError("decode", "malformed", kind),
        );
      }
      const predecessor = yield* readOptionalDigest(
        input,
        offset,
        kind,
        copyByteFields,
      );
      offset = predecessor.offset;
      const payloadByteLength = readU64(input, offset);
      if (payloadByteLength === undefined || payloadByteLength === 0n) {
        return yield* Result.fail(
          progressError("decode", "malformed", `${kind}.payloadByteLength`),
        );
      }
      offset += 8;
      const payload = yield* readRequiredDigest(
        input,
        offset,
        kind,
        copyByteFields,
      );
      offset = payload.offset;
      const diagnostics = yield* readRequiredDigest(
        input,
        offset,
        kind,
        copyByteFields,
      );
      offset = diagnostics.offset;
      const parsed = yield* captureEvidencePageManifest(
        Object.freeze({
          kind,
          reservationSha256: reservation.value,
          commandKind,
          sequence: counters[0]!,
          pageOrdinal: counters[1]!,
          firstEvidenceOrdinal: counters[2]!,
          evidenceCount: counters[3]!,
          firstDiagnosticOrdinal: counters[4]!,
          diagnosticCount: counters[5]!,
          predecessorPageSha256: predecessor.value,
          payloadByteLength,
          payloadSha256: payload.value,
          cumulativeDiagnosticsRootSha256: diagnostics.value,
        }),
        "decode",
        copyByteFields,
      );
      if (offset !== input.byteLength) {
        return yield* Result.fail(
          progressError("decode", "malformed", "trailing"),
        );
      }
      return parsed;
    }
    if (offset >= input.byteLength) {
      return yield* Result.fail(progressError("decode", "malformed"));
    }
    const phase = phaseFromTag(input[offset]!);
    if (phase === undefined) {
      return yield* Result.fail(
        progressError("decode", "malformed", "progress_cursor.phase"),
      );
    }
    offset += 1;
    const counters: bigint[] = [];
    for (let index = 0; index < 4; index += 1) {
      const counter = readU64(input, offset);
      if (counter === undefined) {
        return yield* Result.fail(progressError("decode", "malformed"));
      }
      counters.push(counter);
      offset += 8;
    }
    if (offset >= input.byteLength) {
      return yield* Result.fail(progressError("decode", "malformed"));
    }
    const optionTag = input[offset]!;
    offset += 1;
    let previousReceiptSha256: Uint8Array | null;
    if (optionTag === 0) {
      previousReceiptSha256 = null;
    } else if (optionTag === 1) {
      previousReceiptSha256 = readDigest(
        input,
        offset,
        copyByteFields,
      ) ?? null;
      if (previousReceiptSha256 === null) {
        return yield* Result.fail(progressError("decode", "malformed"));
      }
      offset += 32;
    } else {
      return yield* Result.fail(progressError("decode", "malformed"));
    }
    if (offset !== input.byteLength) {
      return yield* Result.fail(progressError("decode", "malformed", "trailing"));
    }
    return Object.freeze({
      kind,
      phase,
      settledSequence: counters[0]!,
      moduleOrdinal: counters[1]!,
      edgeOrdinal: counters[2]!,
      pageOrdinal: counters[3]!,
      previousReceiptSha256,
    });
  });
}

function readDomain(
  input: Uint8Array,
): Result.Result<
  Readonly<{ readonly kind: FrameKind; readonly offset: number }>,
  DeclarativeV2VerifierProgressV2Error
> {
  const nul = input.indexOf(0);
  if (nul < 0 || nul > 128) {
    return Result.fail(progressError("decode", "malformed", "domain"));
  }
  let domain: string;
  try {
    domain = FATAL_UTF8_DECODER.decode(input.subarray(0, nul + 1));
  } catch {
    return Result.fail(progressError("decode", "malformed", "domain"));
  }
  const prefix = "flarex.declarative-v2/";
  const suffix = "/v2\0";
  if (!domain.startsWith(prefix) || !domain.endsWith(suffix)) {
    return Result.fail(progressError("decode", "unsupportedVersion", "domain"));
  }
  const rawKind = domain.slice(prefix.length, -suffix.length);
  // SAFETY: rawKind is a plain string from the decoded domain; the cast
  // only narrows it to the set's element type.
  if (!FRAME_KINDS.has(rawKind as FrameKind)) {
    return Result.fail(progressError("decode", "malformed", "domain"));
  }
  // SAFETY: the membership test above proved rawKind is a known frame
  // kind.
  return Result.succeed(Object.freeze({
    kind: rawKind as FrameKind,
    offset: nul + 1,
  }));
}

function progressError(
  operation: "encode" | "decode",
  reason: DeclarativeV2VerifierProgressV2Error["reason"],
  path?: string,
): DeclarativeV2VerifierProgressV2Error {
  return new DeclarativeV2VerifierProgressV2Error({
    operation,
    reason,
    ...(path === undefined ? {} : { path }),
  });
}

function limitError(
  operation: "encode" | "decode",
  reason: "frameBytesExceeded" | "canonicalBytesExceeded",
  observed: number,
  maximum: number,
): DeclarativeV2VerifierProgressV2Error {
  return new DeclarativeV2VerifierProgressV2Error({
    operation,
    reason,
    observed,
    maximum,
  });
}

function captureOwnDataRecord(
  input: unknown,
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (!isNonArrayRecord(input)) return undefined;
    const keys = Reflect.ownKeys(input);
    if (keys.length > MAX_CAPTURED_OWN_KEYS) return undefined;
    // SAFETY: a freshly created null-prototype object is used as a mutable
    // string-keyed record; only validated own enumerable value properties
    // are copied into it.
    const captured: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    for (const key of keys) {
      if (typeof key !== "string") return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return undefined;
      }
      captured[key] = descriptor.value;
    }
    return Object.freeze(captured);
  } catch {
    return undefined;
  }
}

function hasExactCapturedKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length &&
    keys.every((key) => expected.includes(key));
}

function isU64(value: unknown): value is bigint {
  return typeof value === "bigint" &&
    value >= 0n &&
    value <= DECLARATIVE_V2_MAX_SIGNED_INT64_V1;
}

function isPositiveU64(value: unknown): value is bigint {
  return isU64(value) && value > 0n;
}

function isDurableCommandKind(
  value: unknown,
): value is DeclarativeV2VerifierDurableCommandKindV2 {
  // SAFETY: value is proven to be a plain string before the membership
  // test; the cast only narrows it to the set's element type.
  return typeof value === "string" &&
    DURABLE_COMMAND_KINDS.has(
      value as DeclarativeV2VerifierDurableCommandKindV2,
    );
}

function isRestartCommandKind(
  value: unknown,
): value is DeclarativeV2VerifierRestartCommandKindV2 {
  // SAFETY: value is proven to be a plain string before the membership
  // test; the cast only narrows it to the set's element type.
  return typeof value === "string" &&
    RESTART_COMMAND_KINDS.has(
      value as DeclarativeV2VerifierRestartCommandKindV2,
    );
}

function isCheckedU64Range(first: bigint, count: bigint): boolean {
  return first <= DECLARATIVE_V2_MAX_SIGNED_INT64_V1 - count;
}

function isDigest(value: unknown): value is Uint8Array {
  return isUint8ArrayWithByteLength(value, DECLARATIVE_V2_SHA256_BYTES_V1);
}

function retainDigest(value: unknown, copy: boolean): Uint8Array {
  if (!isDigest(value)) {
    throw new DeclarativeV2VerifierProgressV2InvariantDefect({
      reason: "invalidPlatformIntrinsic",
    });
  }
  return copy ? new Uint8Array(value) : value;
}

function captureByteRange(
  input: unknown,
  operation: "encode" | "decode",
): Result.Result<
  DeclarativeV2VerifierProgressFrameByteRangeV2,
  DeclarativeV2VerifierProgressV2Error
> {
  const captured = captureOwnDataRecord(input);
  if (
    captured === undefined ||
    !hasExactCapturedKeys(captured, [
      "bytes",
      "byteOffset",
      "byteLength",
    ])
  ) {
    return Result.fail(
      progressError(operation, "invalidInput", "byteRange"),
    );
  }
  const bytes = captured.bytes;
  const byteOffset = captured.byteOffset;
  const byteLength = captured.byteLength;
  if (
    !isUint8Array(bytes) ||
    !isNonNegativeSafeInteger(byteOffset) ||
    !isNonNegativeSafeInteger(byteLength)
  ) {
    return Result.fail(
      progressError(operation, "invalidInput", "byteRange"),
    );
  }
  const visibleLength = intrinsicByteLength(bytes);
  if (
    visibleLength === undefined ||
    isSharedArrayBufferStorage(bytes) ||
    byteOffset > visibleLength ||
    byteLength > visibleLength - byteOffset
  ) {
    return Result.fail(
      progressError(operation, "invalidInput", "byteRange"),
    );
  }
  return Result.succeed(Object.freeze({ bytes, byteOffset, byteLength }));
}

function intrinsicByteLength(value: Uint8Array): number | undefined {
  if (UINT8_ARRAY_BYTE_LENGTH_GETTER === undefined) return undefined;
  try {
    return Reflect.apply(UINT8_ARRAY_BYTE_LENGTH_GETTER, value, []);
  } catch {
    return undefined;
  }
}

function intrinsicByteOffset(value: Uint8Array): number | undefined {
  if (UINT8_ARRAY_BYTE_OFFSET_GETTER === undefined) return undefined;
  try {
    const result = Reflect.apply(UINT8_ARRAY_BYTE_OFFSET_GETTER, value, []);
    return isNonNegativeSafeInteger(result) ? result : undefined;
  } catch {
    return undefined;
  }
}

function intrinsicBuffer(value: Uint8Array): ArrayBufferLike | undefined {
  if (UINT8_ARRAY_BUFFER_GETTER === undefined) return undefined;
  try {
    const result = Reflect.apply(UINT8_ARRAY_BUFFER_GETTER, value, []);
    return intrinsicBufferKind(result) === undefined ? undefined : result;
  } catch {
    return undefined;
  }
}

function isSharedArrayBufferStorage(value: Uint8Array): boolean {
  const buffer = intrinsicBuffer(value);
  return buffer !== undefined && intrinsicBufferKind(buffer) === "shared";
}

function intrinsicBufferKind(
  value: unknown,
): "array" | "shared" | undefined {
  if (ARRAY_BUFFER_BYTE_LENGTH_GETTER !== undefined) {
    try {
      Reflect.apply(ARRAY_BUFFER_BYTE_LENGTH_GETTER, value, []);
      return "array";
    } catch {
      // Continue to the distinct SharedArrayBuffer intrinsic brand check.
    }
  }
  if (SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER !== undefined) {
    try {
      Reflect.apply(SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER, value, []);
      return "shared";
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function hasSharedBorrowedFrameStorage(frame: CapturedFrame): boolean {
  for (const field of FRAME_FIELDS[frame.kind]) {
    const value = frame[field];
    if (isUint8Array(value) && isSharedArrayBufferStorage(value)) return true;
  }
  return false;
}

function overlapsBorrowedFrameStorage(
  frame: CapturedFrame,
  destination: DeclarativeV2VerifierProgressFrameByteRangeV2,
): boolean {
  const destinationBuffer = intrinsicBuffer(destination.bytes);
  const destinationViewOffset = intrinsicByteOffset(destination.bytes);
  if (
    destinationBuffer === undefined ||
    destinationViewOffset === undefined
  ) {
    return true;
  }
  const destinationStart = destinationViewOffset + destination.byteOffset;
  const destinationEnd = destinationStart + destination.byteLength;
  for (const field of FRAME_FIELDS[frame.kind]) {
    const source = frame[field];
    if (!isUint8Array(source)) continue;
    const sourceBuffer = intrinsicBuffer(source);
    const sourceOffset = intrinsicByteOffset(source);
    const sourceLength = intrinsicByteLength(source);
    if (
      sourceBuffer === undefined ||
      sourceOffset === undefined ||
      sourceLength === undefined
    ) {
      return true;
    }
    if (
      sourceBuffer === destinationBuffer &&
      sourceOffset < destinationEnd &&
      destinationStart < sourceOffset + sourceLength
    ) {
      return true;
    }
  }
  return false;
}

function checkedLength(...values: readonly number[]): number {
  let result = 0;
  for (const value of values) {
    if (
      !isNonNegativeSafeInteger(value) ||
      result > U32_MAX - value
    ) {
      throw new DeclarativeV2VerifierProgressV2InvariantDefect({
        reason: "invalidPlatformIntrinsic",
      });
    }
    result += value;
  }
  return result;
}

function checkedWorkCount(...values: readonly number[]): number {
  let result = 0;
  for (const value of values) {
    if (
      !isNonNegativeSafeInteger(value) ||
      result > Number.MAX_SAFE_INTEGER - value
    ) {
      throw new DeclarativeV2VerifierProgressV2InvariantDefect({
        reason: "invalidPlatformIntrinsic",
      });
    }
    result += value;
  }
  return result;
}

function readU32(input: Uint8Array, offset: number): number | undefined {
  if (offset + 4 > input.byteLength) return undefined;
  return (
    input[offset]! * 0x1_00_00_00 +
    input[offset + 1]! * 0x1_00_00 +
    input[offset + 2]! * 0x1_00 +
    input[offset + 3]!
  );
}

function readU64(input: Uint8Array, offset: number): bigint | undefined {
  if (offset + 8 > input.byteLength) return undefined;
  let value = 0n;
  for (let index = 0; index < 8; index += 1) {
    value = (value << 8n) | BigInt(input[offset + index]!);
  }
  return value <= DECLARATIVE_V2_MAX_SIGNED_INT64_V1 ? value : undefined;
}

function readDigest(
  input: Uint8Array,
  offset: number,
  copyByteFields = true,
): Uint8Array | undefined {
  return offset + DECLARATIVE_V2_SHA256_BYTES_V1 <= input.byteLength
    ? copyByteFields
      ? new Uint8Array(
        input.subarray(offset, offset + DECLARATIVE_V2_SHA256_BYTES_V1),
      )
      : input.subarray(offset, offset + DECLARATIVE_V2_SHA256_BYTES_V1)
    : undefined;
}

function readRequiredDigest(
  input: Uint8Array,
  offset: number,
  path: string,
  copyByteFields = true,
): Result.Result<
  Readonly<{ readonly value: Uint8Array; readonly offset: number }>,
  DeclarativeV2VerifierProgressV2Error
> {
  const value = readDigest(input, offset, copyByteFields);
  return value === undefined
    ? Result.fail(progressError("decode", "malformed", path))
    : Result.succeed(Object.freeze({
      value,
      offset: offset + DECLARATIVE_V2_SHA256_BYTES_V1,
    }));
}

function readOptionalDigest(
  input: Uint8Array,
  offset: number,
  path: string,
  copyByteFields = true,
): Result.Result<
  Readonly<{ readonly value: Uint8Array | null; readonly offset: number }>,
  DeclarativeV2VerifierProgressV2Error
> {
  if (offset >= input.byteLength) {
    return Result.fail(progressError("decode", "malformed", path));
  }
  const optionTag = input[offset]!;
  if (optionTag === 0) {
    return Result.succeed(Object.freeze({ value: null, offset: offset + 1 }));
  }
  if (optionTag !== 1) {
    return Result.fail(progressError("decode", "malformed", path));
  }
  const value = readDigest(input, offset + 1, copyByteFields);
  return value === undefined
    ? Result.fail(progressError("decode", "malformed", path))
    : Result.succeed(Object.freeze({
      value,
      offset: offset + 1 + DECLARATIVE_V2_SHA256_BYTES_V1,
    }));
}

function readString(
  input: Uint8Array,
  offset: number,
): Result.Result<
  Readonly<{ readonly value: string; readonly offset: number }>,
  DeclarativeV2VerifierProgressV2Error
> {
  const length = readU32(input, offset);
  if (
    length === undefined ||
    length === 0 ||
    offset + 4 + length > input.byteLength
  ) {
    return Result.fail(progressError("decode", "malformed", "string"));
  }
  let value: string;
  try {
    value = FATAL_UTF8_DECODER.decode(
      input.subarray(offset + 4, offset + 4 + length),
    );
  } catch {
    return Result.fail(progressError("decode", "malformed", "string"));
  }
  if (value.includes("\0")) {
    return Result.fail(progressError("decode", "malformed", "string"));
  }
  return Result.succeed(Object.freeze({
    value,
    offset: offset + 4 + length,
  }));
}

function phaseTag(phase: DeclarativeV2VerifierPhaseV1): number {
  switch (phase) {
    case "source":
      return 1;
    case "parse":
      return 2;
    case "link":
      return 3;
    case "registration":
      return 4;
    case "verdict":
      return 5;
  }
}

function phaseFromTag(tag: number): DeclarativeV2VerifierPhaseV1 | undefined {
  switch (tag) {
    case 1:
      return "source";
    case 2:
      return "parse";
    case 3:
      return "link";
    case 4:
      return "registration";
    case 5:
      return "verdict";
    default:
      return undefined;
  }
}

function durableCommandKindTag(
  commandKind: DeclarativeV2VerifierDurableCommandKindV2,
): number {
  switch (commandKind) {
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

function durableCommandKindFromTag(
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

function restartCommandKindTag(
  commandKind: DeclarativeV2VerifierRestartCommandKindV2,
): number {
  return commandKind === "parse_module" ? 1 : 2;
}

function restartCommandKindFromTag(
  tag: number,
): DeclarativeV2VerifierRestartCommandKindV2 | undefined {
  switch (tag) {
    case 1:
      return "parse_module";
    case 2:
      return "link_page";
    default:
      return undefined;
  }
}

export type DeclarativeV2VerifierCommandKindV2 =
  DeclarativeV2CommandKindV1;
