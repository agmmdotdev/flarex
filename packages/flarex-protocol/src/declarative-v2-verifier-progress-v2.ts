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

export type DeclarativeV2VerifierProgressFrameV2 =
  | DeclarativeV2VerifierBudgetFrameV2
  | DeclarativeV2VerifierAttemptIdentityFrameV2
  | DeclarativeV2VerifierProgressCursorFrameV2
  | DeclarativeV2VerifierCommandReservationFrameV2
  | DeclarativeV2VerifierCommandOutputManifestFrameV2
  | DeclarativeV2VerifierCommandReceiptFrameV2;

export interface DeclarativeV2VerifierEncodedFrameV2 {
  readonly frame: DeclarativeV2VerifierProgressFrameV2;
  readonly canonicalBytes: Uint8Array;
  readonly usage: DeclarativeV2VerifierFrameUsageV2;
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

const UTF8_ENCODER = new TextEncoder();
const FATAL_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const UINT8_ARRAY_BYTE_LENGTH_GETTER =
  Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(Uint8Array.prototype),
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
} as const satisfies Readonly<Record<FrameKind, readonly string[]>>;

export function encodeDeclarativeV2VerifierProgressFrameV2(
  input: unknown,
  rawBudget: unknown,
): Result.Result<
  DeclarativeV2VerifierEncodedFrameV2,
  DeclarativeV2VerifierProgressV2Error
> {
  return Result.gen(function* () {
    const budget = yield* decodeFrameBudget(rawBudget, "encode");
    const frame = yield* captureFrame(input, "encode");
    const exactLength = frameByteLength(frame);
    if (exactLength > budget.maximumFrameBytes) {
      return yield* Result.fail(limitError(
        "encode",
        "frameBytesExceeded",
        exactLength,
        budget.maximumFrameBytes,
      ));
    }
    const bytes = encodeCapturedFrame(frame, exactLength);
    return Object.freeze({
      frame: frame as DeclarativeV2VerifierProgressFrameV2,
      canonicalBytes: bytes,
      usage: Object.freeze({
        frameBytes: exactLength,
        canonicalBytes: 0,
      }),
    });
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
      candidateSha256: new Uint8Array(candidateSha256),
      progressProtocolIdentity,
      budgetProtocolIdentity,
      ceilingsSha256: new Uint8Array(ceilingsSha256),
    }));
  }
  if (kind === "command_reservation") {
    return captureCommandReservation(captured, operation);
  }
  if (kind === "command_output_manifest") {
    return captureCommandOutputManifest(captured, operation);
  }
  if (kind === "command_receipt") {
    return captureCommandReceipt(captured, operation);
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
      : new Uint8Array(previousReceiptSha256),
  }));
}

function captureCommandReservation(
  input: Readonly<Record<string, unknown>>,
  operation: "encode" | "decode",
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
    attemptSha256: copyDigest(input.attemptSha256),
    candidateSha256: copyDigest(input.candidateSha256),
    commandKind,
    sequence,
    currentProgressSha256: copyDigest(input.currentProgressSha256),
    predecessorReceiptSha256: predecessorReceiptSha256 === null
      ? null
      : copyDigest(predecessorReceiptSha256),
    commandBudgetSha256: copyDigest(input.commandBudgetSha256),
    commandInputSha256: copyDigest(input.commandInputSha256),
    freshAuthenticatedInputSha256: copyDigest(
      input.freshAuthenticatedInputSha256,
    ),
    analyzerIdentitySha256: copyDigest(input.analyzerIdentitySha256),
    verifierIdentitySha256: copyDigest(input.verifierIdentitySha256),
    rangeAndPredecessorTailsSha256: copyDigest(
      input.rangeAndPredecessorTailsSha256,
    ),
  }));
}

function captureCommandOutputManifest(
  input: Readonly<Record<string, unknown>>,
  operation: "encode" | "decode",
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
    reservationSha256: copyDigest(input.reservationSha256),
    commandKind,
    sequence,
    evidenceRootSha256: copyDigest(input.evidenceRootSha256),
    evidenceCount,
    diagnosticsRootSha256: copyDigest(input.diagnosticsRootSha256),
    diagnosticCount,
    nextProgressSha256: copyDigest(input.nextProgressSha256),
  }));
}

function captureCommandReceipt(
  input: Readonly<Record<string, unknown>>,
  operation: "encode" | "decode",
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
    reservationSha256: copyDigest(input.reservationSha256),
    commandUsageSha256: copyDigest(input.commandUsageSha256),
    resultingAttemptUsageSha256: copyDigest(
      input.resultingAttemptUsageSha256,
    ),
    outputManifestSha256: copyDigest(input.outputManifestSha256),
    nextProgressSha256: copyDigest(input.nextProgressSha256),
  }));
}

function frameByteLength(frame: CapturedFrame): number {
  const domainLength = domainBytes(frame.kind).byteLength;
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
    const progress = UTF8_ENCODER.encode(
      DECLARATIVE_V2_VERIFIER_PROGRESS_PROTOCOL_IDENTITY_V2,
    );
    const budget = UTF8_ENCODER.encode(
      DECLARATIVE_V2_VERIFIER_BUDGET_PROTOCOL_IDENTITY_V2,
    );
    return checkedLength(
      domainLength,
      4,
      32,
      4,
      progress.byteLength,
      4,
      budget.byteLength,
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

function encodeCapturedFrame(
  frame: CapturedFrame,
  exactLength: number,
): Uint8Array {
  const output = new Uint8Array(exactLength);
  let offset = writeBytes(output, 0, domainBytes(frame.kind));
  writeU32(output, offset, FRAME_FIELDS[frame.kind].length);
  offset += 4;
  if (
    frame.kind === "attempt_ceilings" ||
    frame.kind === "attempt_usage" ||
    frame.kind === "command_budget"
  ) {
    for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
      writeU64(output, offset, frame[dimension] as bigint);
      offset += 8;
    }
    return output;
  }
  if (frame.kind === "attempt_identity") {
    offset = writeBytes(
      output,
      offset,
      frame.candidateSha256 as Uint8Array,
    );
    offset = writeString(
      output,
      offset,
      frame.progressProtocolIdentity as string,
    );
    offset = writeString(
      output,
      offset,
      frame.budgetProtocolIdentity as string,
    );
    writeBytes(output, offset, frame.ceilingsSha256 as Uint8Array);
    return output;
  }
  if (frame.kind === "command_reservation") {
    offset = writeBytes(output, offset, frame.attemptSha256 as Uint8Array);
    offset = writeBytes(output, offset, frame.candidateSha256 as Uint8Array);
    output[offset] = durableCommandKindTag(
      frame.commandKind as DeclarativeV2VerifierDurableCommandKindV2,
    );
    offset += 1;
    writeU64(output, offset, frame.sequence as bigint);
    offset += 8;
    offset = writeBytes(
      output,
      offset,
      frame.currentProgressSha256 as Uint8Array,
    );
    const predecessorReceiptSha256 = frame.predecessorReceiptSha256 as
      | Uint8Array
      | null;
    if (predecessorReceiptSha256 === null) {
      output[offset] = 0;
      offset += 1;
    } else {
      output[offset] = 1;
      offset = writeBytes(output, offset + 1, predecessorReceiptSha256);
    }
    for (const field of [
      "commandBudgetSha256",
      "commandInputSha256",
      "freshAuthenticatedInputSha256",
      "analyzerIdentitySha256",
      "verifierIdentitySha256",
      "rangeAndPredecessorTailsSha256",
    ] as const) {
      offset = writeBytes(output, offset, frame[field] as Uint8Array);
    }
    return output;
  }
  if (frame.kind === "command_output_manifest") {
    offset = writeBytes(
      output,
      offset,
      frame.reservationSha256 as Uint8Array,
    );
    output[offset] = durableCommandKindTag(
      frame.commandKind as DeclarativeV2VerifierDurableCommandKindV2,
    );
    offset += 1;
    writeU64(output, offset, frame.sequence as bigint);
    offset += 8;
    offset = writeBytes(
      output,
      offset,
      frame.evidenceRootSha256 as Uint8Array,
    );
    writeU64(output, offset, frame.evidenceCount as bigint);
    offset += 8;
    offset = writeBytes(
      output,
      offset,
      frame.diagnosticsRootSha256 as Uint8Array,
    );
    writeU64(output, offset, frame.diagnosticCount as bigint);
    offset += 8;
    writeBytes(output, offset, frame.nextProgressSha256 as Uint8Array);
    return output;
  }
  if (frame.kind === "command_receipt") {
    for (const field of [
      "reservationSha256",
      "commandUsageSha256",
      "resultingAttemptUsageSha256",
      "outputManifestSha256",
      "nextProgressSha256",
    ] as const) {
      offset = writeBytes(output, offset, frame[field] as Uint8Array);
    }
    return output;
  }
  output[offset] = phaseTag(frame.phase as DeclarativeV2VerifierPhaseV1);
  offset += 1;
  for (const field of [
    "settledSequence",
    "moduleOrdinal",
    "edgeOrdinal",
    "pageOrdinal",
  ] as const) {
    writeU64(output, offset, frame[field] as bigint);
    offset += 8;
  }
  const previousReceiptSha256 = frame.previousReceiptSha256 as
    | Uint8Array
    | null;
  if (previousReceiptSha256 === null) {
    output[offset] = 0;
  } else {
    output[offset] = 1;
    writeBytes(output, offset + 1, previousReceiptSha256);
  }
  return output;
}

function parseOwnedFrame(
  input: Uint8Array,
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
      const candidateSha256 = readDigest(input, offset);
      if (candidateSha256 === undefined) {
        return yield* Result.fail(progressError("decode", "malformed"));
      }
      offset += 32;
      const progress = yield* readString(input, offset);
      offset = progress.offset;
      const budget = yield* readString(input, offset);
      offset = budget.offset;
      const ceilingsSha256 = readDigest(input, offset);
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
      const attempt = yield* readRequiredDigest(input, offset, kind);
      offset = attempt.offset;
      const candidate = yield* readRequiredDigest(input, offset, kind);
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
      const currentProgress = yield* readRequiredDigest(input, offset, kind);
      offset = currentProgress.offset;
      const predecessor = yield* readOptionalDigest(input, offset, kind);
      offset = predecessor.offset;
      const commandBudget = yield* readRequiredDigest(input, offset, kind);
      offset = commandBudget.offset;
      const commandInput = yield* readRequiredDigest(input, offset, kind);
      offset = commandInput.offset;
      const authenticatedInput = yield* readRequiredDigest(input, offset, kind);
      offset = authenticatedInput.offset;
      const analyzerIdentity = yield* readRequiredDigest(input, offset, kind);
      offset = analyzerIdentity.offset;
      const verifierIdentity = yield* readRequiredDigest(input, offset, kind);
      offset = verifierIdentity.offset;
      const rangeAndTails = yield* readRequiredDigest(input, offset, kind);
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
      const reservation = yield* readRequiredDigest(input, offset, kind);
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
      const evidenceRoot = yield* readRequiredDigest(input, offset, kind);
      offset = evidenceRoot.offset;
      const evidenceCount = readU64(input, offset);
      if (evidenceCount === undefined) {
        return yield* Result.fail(
          progressError("decode", "malformed", `${kind}.evidenceCount`),
        );
      }
      offset += 8;
      const diagnosticsRoot = yield* readRequiredDigest(input, offset, kind);
      offset = diagnosticsRoot.offset;
      const diagnosticCount = readU64(input, offset);
      if (diagnosticCount === undefined) {
        return yield* Result.fail(
          progressError("decode", "malformed", `${kind}.diagnosticCount`),
        );
      }
      offset += 8;
      const nextProgress = yield* readRequiredDigest(input, offset, kind);
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
        const digest = yield* readRequiredDigest(input, offset, kind);
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
      previousReceiptSha256 = readDigest(input, offset) ?? null;
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

function domainBytes(kind: FrameKind): Uint8Array {
  return UTF8_ENCODER.encode(`flarex.declarative-v2/${kind}/v2\0`);
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

function isDigest(value: unknown): value is Uint8Array {
  return isUint8ArrayWithByteLength(value, DECLARATIVE_V2_SHA256_BYTES_V1);
}

function copyDigest(value: unknown): Uint8Array {
  if (!isDigest(value)) {
    throw new DeclarativeV2VerifierProgressV2InvariantDefect({
      reason: "invalidPlatformIntrinsic",
    });
  }
  return new Uint8Array(value);
}

function intrinsicByteLength(value: Uint8Array): number | undefined {
  if (UINT8_ARRAY_BYTE_LENGTH_GETTER === undefined) return undefined;
  try {
    return Reflect.apply(UINT8_ARRAY_BYTE_LENGTH_GETTER, value, []);
  } catch {
    return undefined;
  }
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

function writeBytes(
  output: Uint8Array,
  offset: number,
  bytes: Uint8Array,
): number {
  output.set(bytes, offset);
  return offset + bytes.byteLength;
}

function writeString(
  output: Uint8Array,
  offset: number,
  value: string,
): number {
  const bytes = UTF8_ENCODER.encode(value);
  writeU32(output, offset, bytes.byteLength);
  return writeBytes(output, offset + 4, bytes);
}

function writeU32(output: Uint8Array, offset: number, value: number): void {
  output[offset] = (value >>> 24) & 0xff;
  output[offset + 1] = (value >>> 16) & 0xff;
  output[offset + 2] = (value >>> 8) & 0xff;
  output[offset + 3] = value & 0xff;
}

function writeU64(output: Uint8Array, offset: number, value: bigint): void {
  for (let index = 7; index >= 0; index -= 1) {
    output[offset + index] = Number(value & 0xffn);
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
): Uint8Array | undefined {
  return offset + DECLARATIVE_V2_SHA256_BYTES_V1 <= input.byteLength
    ? new Uint8Array(
      input.subarray(offset, offset + DECLARATIVE_V2_SHA256_BYTES_V1),
    )
    : undefined;
}

function readRequiredDigest(
  input: Uint8Array,
  offset: number,
  path: string,
): Result.Result<
  Readonly<{ readonly value: Uint8Array; readonly offset: number }>,
  DeclarativeV2VerifierProgressV2Error
> {
  const value = readDigest(input, offset);
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
  const value = readDigest(input, offset + 1);
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

export type DeclarativeV2VerifierCommandKindV2 =
  DeclarativeV2CommandKindV1;
