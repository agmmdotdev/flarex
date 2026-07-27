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
  const budget = decodeFrameBudget(rawBudget, "encode");
  if (Result.isFailure(budget)) return Result.fail(budget.failure);
  const ownedFrame = captureFrame(input, "encode");
  if (Result.isFailure(ownedFrame)) return Result.fail(ownedFrame.failure);
  const exactLength = frameByteLength(ownedFrame.success);
  if (exactLength > budget.success.maximumFrameBytes) {
    return Result.fail(limitError(
      "encode",
      "frameBytesExceeded",
      exactLength,
      budget.success.maximumFrameBytes,
    ));
  }
  const canonicalBytes = new Uint8Array(exactLength);
  const work = encodingWork(ownedFrame.success, exactLength);
  const actual = writeCapturedFrame(
    Object.freeze({
      bytes: canonicalBytes,
      byteOffset: 0,
      byteLength: exactLength,
    }),
    ownedFrame.success,
  );
  assertExactSuccessfulWork(work, actual);
  return Result.succeed(Object.freeze({
    frame: ownedFrame.success as DeclarativeV2VerifierProgressFrameV2,
    canonicalBytes,
    usage: Object.freeze({
      frameBytes: exactLength,
      canonicalBytes: 0,
    }),
  }));
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
  const encoded = encodeFrameIntoAdmittedRange(input, rawBudget, admit);
  return Result.isFailure(encoded)
    ? Result.fail(encoded.failure)
    : Result.succeed(encoded.success.written);
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
  const budget = decodeFrameBudget(rawBudget, "decode");
  if (Result.isFailure(budget)) return Result.fail(budget.failure);
  const capturedRange = captureByteRange(rawRange, "decode");
  if (Result.isFailure(capturedRange)) {
    return Result.fail(capturedRange.failure);
  }
  const range = capturedRange.success;
  if (range.byteLength === 0) {
    return Result.fail(progressError("decode", "invalidInput"));
  }
  if (range.byteLength > budget.success.maximumFrameBytes) {
    return Result.fail(limitError(
      "decode",
      "frameBytesExceeded",
      range.byteLength,
      budget.success.maximumFrameBytes,
    ));
  }
  const work = verificationWork(range.byteLength);
  const plan = Object.freeze({
    admittedByteLength: range.byteLength,
    successfulWorkCeiling: work,
  });
  const admitted = admit(plan);
  if (Result.isFailure(admitted)) return Result.fail(admitted.failure);
  const visibleLengthAfterAdmission = intrinsicByteLength(range.bytes);
  if (
    visibleLengthAfterAdmission === undefined ||
    range.byteOffset > visibleLengthAfterAdmission ||
    range.byteLength > visibleLengthAfterAdmission - range.byteOffset
  ) {
    return Result.fail(
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
  const parsed = parseOwnedFrame(input, false);
  if (Result.isFailure(parsed)) return Result.fail(parsed.failure);
  if (frameByteLength(parsed.success) !== input.byteLength) {
    return Result.fail(progressError("decode", "nonCanonical"));
  }
  const comparison = compareCapturedFrame(input, parsed.success);
  if (!comparison.matches) {
    return Result.fail(progressError("decode", "nonCanonical"));
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
  return Result.succeed(Object.freeze({
    frame: parsed.success as DeclarativeV2VerifierProgressFrameV2,
    canonicalBytes: input,
    usage: Object.freeze({
      frameBytes: input.byteLength,
      canonicalBytes: 0,
    }),
    work: comparison.work,
  }));
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
  const budget = decodeFrameBudget(rawBudget, "encode");
  if (Result.isFailure(budget)) return Result.fail(budget.failure);
  if (
    typeof input === "object" &&
    input !== null &&
    ACTIVE_ADMISSION_INPUTS.has(input)
  ) {
    return Result.fail(
      progressError("encode", "invalidInput", "admission.reentrantInput"),
    );
  }
  const frame = captureFrame(input, "encode", false);
  if (Result.isFailure(frame)) return Result.fail(frame.failure);
  if (hasSharedBorrowedFrameStorage(frame.success)) {
    return Result.fail(
      progressError("encode", "invalidInput", "frame.sharedByteStorage"),
    );
  }
  const exactLength = frameByteLength(frame.success);
  if (exactLength > budget.success.maximumFrameBytes) {
    return Result.fail(limitError(
      "encode",
      "frameBytesExceeded",
      exactLength,
      budget.success.maximumFrameBytes,
    ));
  }
  const work = encodingWork(frame.success, exactLength);
  const plan = Object.freeze({
    canonicalByteLength: exactLength,
    successfulWork: work,
  });
  const identity = typeof input === "object" && input !== null ? input : null;
  if (identity !== null) ACTIVE_ADMISSION_INPUTS.add(identity);
  let admitted: Result.Result<
    DeclarativeV2VerifierProgressFrameByteRangeV2,
    E
  >;
  try {
    admitted = admit(plan);
  } finally {
    if (identity !== null) ACTIVE_ADMISSION_INPUTS.delete(identity);
  }
  if (Result.isFailure(admitted)) return Result.fail(admitted.failure);
  const capturedRange = captureByteRange(admitted.success, "encode");
  if (Result.isFailure(capturedRange)) {
    return Result.fail(capturedRange.failure);
  }
  const range = capturedRange.success;
  if (range.byteLength !== exactLength) {
    return Result.fail(
      progressError("encode", "invalidInput", "destination.byteLength"),
    );
  }
  if (overlapsBorrowedFrameStorage(frame.success, range)) {
    return Result.fail(
      progressError("encode", "invalidInput", "destination.overlap"),
    );
  }
  const actual = writeCapturedFrame(range, frame.success);
  assertExactSuccessfulWork(work, actual);
  return Result.succeed(Object.freeze({
    written: Object.freeze({
      range,
      usage: Object.freeze({
        frameBytes: exactLength,
        canonicalBytes: 0,
      }),
      work: actual,
    }),
  }));
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
    if (Result.isFailure(encoded)) {
      throw new DeclarativeV2VerifierProgressV2InvariantDefect({
        reason: "reencodeFailed",
      });
    }
    if (!bytesEqualFullScan(owned, encoded.success.canonicalBytes)) {
      return yield* Result.fail(progressError("decode", "nonCanonical"));
    }
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
      !bytesEqualFullScan(
        previous.reservationSha256 as Uint8Array,
        current.reservationSha256 as Uint8Array,
      ) ||
      previous.commandKind !== current.commandKind ||
      previous.sequence !== current.sequence ||
      previous.pageOrdinal === DECLARATIVE_V2_MAX_SIGNED_INT64_V1 ||
      current.pageOrdinal !== (previous.pageOrdinal as bigint) + 1n ||
      current.firstEvidenceOrdinal !==
        (previous.firstEvidenceOrdinal as bigint) +
          (previous.evidenceCount as bigint) ||
      current.firstDiagnosticOrdinal !==
        (previous.firstDiagnosticOrdinal as bigint) +
          (previous.diagnosticCount as bigint) ||
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
      !bytesEqualFullScan(
        finalPage.reservationSha256 as Uint8Array,
        output.reservationSha256 as Uint8Array,
      ) ||
      finalPage.commandKind !== output.commandKind ||
      finalPage.sequence !== output.sequence ||
      (finalPage.firstEvidenceOrdinal as bigint) +
          (finalPage.evidenceCount as bigint) !== output.evidenceCount ||
      (finalPage.firstDiagnosticOrdinal as bigint) +
          (finalPage.diagnosticCount as bigint) !== output.diagnosticCount ||
      !bytesEqualFullScan(
        finalPageSha256Input,
        output.evidenceRootSha256 as Uint8Array,
      ) ||
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
  if (typeof rawKind !== "string" || !FRAME_KINDS.has(rawKind as FrameKind)) {
    return Result.fail(progressError(operation, "invalidInput", "kind"));
  }
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
  let offset = emitBytes(emitByte, 0, DOMAIN_BYTES[frame.kind]);
  emitU32(emitByte, offset, FRAME_FIELDS[frame.kind].length);
  offset += 4;
  if (
    frame.kind === "attempt_ceilings" ||
    frame.kind === "attempt_usage" ||
    frame.kind === "command_budget"
  ) {
    for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
      emitU64(emitByte, offset, frame[dimension] as bigint);
      offset += 8;
    }
    return offset;
  }
  if (frame.kind === "attempt_identity") {
    offset = emitBytes(
      emitByte,
      offset,
      frame.candidateSha256 as Uint8Array,
    );
    offset = emitSizedBytes(
      emitByte,
      offset,
      PROGRESS_PROTOCOL_IDENTITY_BYTES,
    );
    offset = emitSizedBytes(
      emitByte,
      offset,
      BUDGET_PROTOCOL_IDENTITY_BYTES,
    );
    offset = emitBytes(
      emitByte,
      offset,
      frame.ceilingsSha256 as Uint8Array,
    );
    return offset;
  }
  if (frame.kind === "command_reservation") {
    offset = emitBytes(
      emitByte,
      offset,
      frame.attemptSha256 as Uint8Array,
    );
    offset = emitBytes(
      emitByte,
      offset,
      frame.candidateSha256 as Uint8Array,
    );
    emitByte(offset, durableCommandKindTag(
      frame.commandKind as DeclarativeV2VerifierDurableCommandKindV2,
    ), false);
    offset += 1;
    emitU64(emitByte, offset, frame.sequence as bigint);
    offset += 8;
    offset = emitBytes(
      emitByte,
      offset,
      frame.currentProgressSha256 as Uint8Array,
    );
    const predecessorReceiptSha256 = frame.predecessorReceiptSha256 as
      | Uint8Array
      | null;
    if (predecessorReceiptSha256 === null) {
      emitByte(offset, 0, false);
      offset += 1;
    } else {
      emitByte(offset, 1, false);
      offset = emitBytes(
        emitByte,
        offset + 1,
        predecessorReceiptSha256,
      );
    }
    for (const field of [
      "commandBudgetSha256",
      "commandInputSha256",
      "freshAuthenticatedInputSha256",
      "analyzerIdentitySha256",
      "verifierIdentitySha256",
      "rangeAndPredecessorTailsSha256",
    ] as const) {
      offset = emitBytes(
        emitByte,
        offset,
        frame[field] as Uint8Array,
      );
    }
    return offset;
  }
  if (frame.kind === "command_output_manifest") {
    offset = emitBytes(
      emitByte,
      offset,
      frame.reservationSha256 as Uint8Array,
    );
    emitByte(offset, durableCommandKindTag(
      frame.commandKind as DeclarativeV2VerifierDurableCommandKindV2,
    ), false);
    offset += 1;
    emitU64(emitByte, offset, frame.sequence as bigint);
    offset += 8;
    offset = emitBytes(
      emitByte,
      offset,
      frame.evidenceRootSha256 as Uint8Array,
    );
    emitU64(emitByte, offset, frame.evidenceCount as bigint);
    offset += 8;
    offset = emitBytes(
      emitByte,
      offset,
      frame.diagnosticsRootSha256 as Uint8Array,
    );
    emitU64(emitByte, offset, frame.diagnosticCount as bigint);
    offset += 8;
    offset = emitBytes(
      emitByte,
      offset,
      frame.nextProgressSha256 as Uint8Array,
    );
    return offset;
  }
  if (frame.kind === "command_receipt") {
    for (const field of [
      "reservationSha256",
      "commandUsageSha256",
      "resultingAttemptUsageSha256",
      "outputManifestSha256",
      "nextProgressSha256",
    ] as const) {
      offset = emitBytes(
        emitByte,
        offset,
        frame[field] as Uint8Array,
      );
    }
    return offset;
  }
  if (frame.kind === "evidence_page_manifest") {
    offset = emitBytes(
      emitByte,
      offset,
      frame.reservationSha256 as Uint8Array,
    );
    emitByte(offset, restartCommandKindTag(
      frame.commandKind as DeclarativeV2VerifierRestartCommandKindV2,
    ), false);
    offset += 1;
    for (const field of [
      "sequence",
      "pageOrdinal",
      "firstEvidenceOrdinal",
      "evidenceCount",
      "firstDiagnosticOrdinal",
      "diagnosticCount",
    ] as const) {
      emitU64(emitByte, offset, frame[field] as bigint);
      offset += 8;
    }
    const predecessorPageSha256 = frame.predecessorPageSha256 as
      | Uint8Array
      | null;
    if (predecessorPageSha256 === null) {
      emitByte(offset, 0, false);
      offset += 1;
    } else {
      emitByte(offset, 1, false);
      offset = emitBytes(emitByte, offset + 1, predecessorPageSha256);
    }
    emitU64(emitByte, offset, frame.payloadByteLength as bigint);
    offset += 8;
    offset = emitBytes(
      emitByte,
      offset,
      frame.payloadSha256 as Uint8Array,
    );
    offset = emitBytes(
      emitByte,
      offset,
      frame.cumulativeDiagnosticsRootSha256 as Uint8Array,
    );
    return offset;
  }
  emitByte(
    offset,
    phaseTag(frame.phase as DeclarativeV2VerifierPhaseV1),
    false,
  );
  offset += 1;
  for (const field of [
    "settledSequence",
    "moduleOrdinal",
    "edgeOrdinal",
    "pageOrdinal",
  ] as const) {
    emitU64(emitByte, offset, frame[field] as bigint);
    offset += 8;
  }
  const previousReceiptSha256 = frame.previousReceiptSha256 as
    | Uint8Array
    | null;
  if (previousReceiptSha256 === null) {
    emitByte(offset, 0, false);
    offset += 1;
  } else {
    emitByte(offset, 1, false);
    offset = emitBytes(emitByte, offset + 1, previousReceiptSha256);
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
  if (!FRAME_KINDS.has(rawKind as FrameKind)) {
    return Result.fail(progressError("decode", "malformed", "domain"));
  }
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
  return typeof value === "string" &&
    DURABLE_COMMAND_KINDS.has(
      value as DeclarativeV2VerifierDurableCommandKindV2,
    );
}

function isRestartCommandKind(
  value: unknown,
): value is DeclarativeV2VerifierRestartCommandKindV2 {
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

function emitBytes(
  emitByte: (offset: number, value: number, copied: boolean) => void,
  offset: number,
  bytes: Uint8Array,
): number {
  for (let index = 0; index < bytes.byteLength; index += 1) {
    emitByte(offset + index, bytes[index]!, true);
  }
  return checkedLength(offset, bytes.byteLength);
}

function emitSizedBytes(
  emitByte: (offset: number, value: number, copied: boolean) => void,
  offset: number,
  bytes: Uint8Array,
): number {
  emitU32(emitByte, offset, bytes.byteLength);
  return emitBytes(emitByte, offset + 4, bytes);
}

function emitU32(
  emitByte: (offset: number, value: number, copied: boolean) => void,
  offset: number,
  value: number,
): void {
  emitByte(offset, (value >>> 24) & 0xff, false);
  emitByte(offset + 1, (value >>> 16) & 0xff, false);
  emitByte(offset + 2, (value >>> 8) & 0xff, false);
  emitByte(offset + 3, value & 0xff, false);
}

function emitU64(
  emitByte: (offset: number, value: number, copied: boolean) => void,
  offset: number,
  value: bigint,
): void {
  for (let index = 7; index >= 0; index -= 1) {
    emitByte(offset + index, Number(value & 0xffn), false);
    value >>= 8n;
  }
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
