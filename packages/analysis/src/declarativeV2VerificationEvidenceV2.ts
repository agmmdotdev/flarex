import { isUint8ArrayWithByteLength } from "@flarex/utils/bytes";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { isNonEmptyString } from "@flarex/utils/strings";
import { Data, Encoding, Result } from "effect";
import type { Json } from "flarex-protocol/json";

import {
  createIncrementalCanonicalJsonDecoderV1,
  createIncrementalCanonicalJsonByteSinkEncoderV1,
  createIncrementalCanonicalJsonEncoderV1,
  makeIncrementalCanonicalJsonEventSinkV1,
  makeIncrementalCanonicalJsonEventSourceV1,
  makeIncrementalCanonicalJsonLimitsV1,
  type IncrementalCanonicalJsonDecodeStepV1,
  type IncrementalCanonicalJsonByteSinkEncodeStepV1,
  type IncrementalCanonicalJsonByteSinkV1,
  type IncrementalCanonicalJsonEncodeStepV1,
  type IncrementalCanonicalJsonEventSinkV1,
  type IncrementalCanonicalJsonEventV1,
  type IncrementalCanonicalJsonSinkEventV1,
  type IncrementalCanonicalJsonIssueV1,
  type IncrementalCanonicalJsonLimitsV1,
  type IncrementalCanonicalJsonReceiptV1,
} from "./declarativeV2IncrementalCanonicalJsonV1";

const MAX_SIGNED_INT64 = 9_223_372_036_854_775_807n;

const FRAME_WIRE_KEYS = Object.freeze({
  module_summary_v2: Object.freeze([
    "callCount",
    "domain",
    "exportCount",
    "functionCount",
    "importCount",
    "kind",
    "moduleOrdinal",
    "modulePath",
    "sourceByteLength",
    "sourceSha256",
    "valueFlowCount",
    "version",
  ]),
  import_call_v2: Object.freeze([
    "callerFunction",
    "domain",
    "edgeOrdinal",
    "kind",
    "moduleOrdinal",
    "targetKind",
    "targetModulePath",
    "targetName",
    "version",
  ]),
  value_flow_v2: Object.freeze([
    "capability",
    "catchability",
    "domain",
    "functionName",
    "kind",
    "moduleOrdinal",
    "operationName",
    "operationOrdinal",
    "version",
  ]),
  diagnostic_v2: Object.freeze([
    "byteOffset",
    "code",
    "diagnosticId",
    "domain",
    "kind",
    "message",
    "moduleOrdinal",
    "phase",
    "version",
  ]),
} as const);

export const DECLARATIVE_V2_VERIFICATION_EVIDENCE_CODEC_IDENTITY_V2 =
  "flarex.declarative-v2/verification-evidence/v2" as const;
export const DECLARATIVE_V2_VERIFICATION_EVIDENCE_PARSE_CAPACITY_BOUNDS_V2 =
  Object.freeze({
    maximumSourceDerivedTextFieldsPerFrame: 3,
    maximumFixedCanonicalBytesPerFrame: 1_024,
  });

export type DeclarativeV2VerificationEvidenceKindV2 =
  | "module_summary_v2"
  | "import_call_v2"
  | "value_flow_v2"
  | "diagnostic_v2";

export interface DeclarativeV2ModuleSummaryFrameV2 {
  readonly kind: "module_summary_v2";
  readonly moduleOrdinal: bigint;
  readonly modulePath: string;
  readonly sourceSha256: Uint8Array;
  readonly sourceByteLength: bigint;
  readonly importCount: bigint;
  readonly exportCount: bigint;
  readonly functionCount: bigint;
  readonly callCount: bigint;
  readonly valueFlowCount: bigint;
}

export interface DeclarativeV2ImportCallFrameV2 {
  readonly kind: "import_call_v2";
  readonly moduleOrdinal: bigint;
  readonly edgeOrdinal: bigint;
  readonly callerFunction: string;
  readonly targetKind: "local" | "artifactImport" | "platformImport" | "abi";
  readonly targetModulePath: string | null;
  readonly targetName: string;
}

export interface DeclarativeV2ValueFlowFrameV2 {
  readonly kind: "value_flow_v2";
  readonly moduleOrdinal: bigint;
  readonly functionName: string;
  readonly operationOrdinal: bigint;
  readonly operationName: string;
  readonly capability: string;
  readonly catchability: "application" | "mixed" | "host";
}

export interface DeclarativeV2DiagnosticFrameV2 {
  readonly kind: "diagnostic_v2";
  readonly phase:
    | "source"
    | "lexical"
    | "parse"
    | "valueFlow"
    | "link"
    | "registration"
    | "admission"
    | "diagnostic";
  readonly moduleOrdinal: bigint;
  readonly byteOffset: bigint;
  readonly diagnosticId: bigint;
  readonly code: string;
  readonly message: string;
}

export type DeclarativeV2VerificationEvidenceFrameV2 =
  | DeclarativeV2ModuleSummaryFrameV2
  | DeclarativeV2ImportCallFrameV2
  | DeclarativeV2ValueFlowFrameV2
  | DeclarativeV2DiagnosticFrameV2;

export interface DeclarativeV2VerificationEvidenceTextCursorV2 {
  readonly _tag: "DeclarativeV2VerificationEvidenceTextCursorV2";
}

export interface DeclarativeV2VerificationEvidenceCursorV2 {
  readonly _tag: "DeclarativeV2VerificationEvidenceCursorV2";
}

export type DeclarativeV2VerificationEvidenceFrameArgumentsV2 =
  | readonly [
    "module_summary_v2",
    unknown,
    unknown,
    unknown,
    unknown,
    unknown,
    unknown,
    unknown,
    unknown,
    unknown,
  ]
  | readonly [
    "import_call_v2",
    unknown,
    unknown,
    unknown,
    unknown,
    unknown,
    unknown,
  ]
  | readonly [
    "value_flow_v2",
    unknown,
    unknown,
    unknown,
    unknown,
    unknown,
    unknown,
  ]
  | readonly [
    "diagnostic_v2",
    unknown,
    unknown,
    unknown,
    unknown,
    unknown,
    unknown,
  ];

export type DeclarativeV2VerificationEvidenceV2ErrorReason =
  | "invalidInput"
  | "invalidUtf8"
  | "malformed"
  | "nonCanonical"
  | "budgetExceeded"
  | "wrongKind"
  | "unsupportedVersion";

export class DeclarativeV2VerificationEvidenceV2Error extends Data.TaggedError(
  "DeclarativeV2VerificationEvidenceV2Error",
)<{
  readonly operation: "encode" | "decode";
  readonly reason: DeclarativeV2VerificationEvidenceV2ErrorReason;
  readonly path?: string;
  readonly observed?: number;
  readonly maximum?: number;
}> {}

function evidenceError(
  operation: "encode" | "decode",
  reason: DeclarativeV2VerificationEvidenceV2ErrorReason,
  evidence?: Readonly<{
    readonly path?: string;
    readonly observed?: number;
    readonly maximum?: number;
  }>,
): DeclarativeV2VerificationEvidenceV2Error {
  return new DeclarativeV2VerificationEvidenceV2Error({
    operation,
    reason,
    ...(evidence?.path === undefined ? {} : { path: evidence.path }),
    ...(evidence?.observed === undefined
      ? {}
      : { observed: evidence.observed }),
    ...(evidence?.maximum === undefined
      ? {}
      : { maximum: evidence.maximum }),
  });
}

export interface DeclarativeV2VerificationEvidenceBudgetV2 {
  readonly maximumFrameBytes: number;
  readonly maximumCanonicalBytes: number;
}

const OWNED_EVIDENCE_BUDGETS = new WeakMap<
  object,
  DeclarativeV2VerificationEvidenceBudgetV2
>();
const OWNED_EVIDENCE_FRAMES = new WeakMap<
  object,
  DeclarativeV2VerificationEvidenceFrameV2
>();
type EvidenceTextCursorPullV2 = () => number | undefined;
type EvidenceTextCursorStateV2 = {
  readonly byteLength: number;
  readonly pull: EvidenceTextCursorPullV2;
  claimed: boolean;
};
const OWNED_EVIDENCE_TEXT_CURSORS = new WeakMap<
  object,
  EvidenceTextCursorStateV2
>();

type EvidenceTextValueV2 = string | EvidenceTextCursorStateV2;
type EvidenceCursorFrameV2 =
  | Readonly<{
    readonly kind: "module_summary_v2";
    readonly moduleOrdinal: bigint;
    readonly modulePath: EvidenceTextCursorStateV2;
    readonly sourceSha256: Uint8Array;
    readonly sourceByteLength: bigint;
    readonly importCount: bigint;
    readonly exportCount: bigint;
    readonly functionCount: bigint;
    readonly callCount: bigint;
    readonly valueFlowCount: bigint;
  }>
  | Readonly<{
    readonly kind: "import_call_v2";
    readonly moduleOrdinal: bigint;
    readonly edgeOrdinal: bigint;
    readonly callerFunction: EvidenceTextCursorStateV2;
    readonly targetKind:
      | "local"
      | "artifactImport"
      | "platformImport"
      | "abi";
    readonly targetModulePath: EvidenceTextCursorStateV2 | null;
    readonly targetName: EvidenceTextCursorStateV2;
  }>
  | Readonly<{
    readonly kind: "value_flow_v2";
    readonly moduleOrdinal: bigint;
    readonly functionName: EvidenceTextCursorStateV2;
    readonly operationOrdinal: bigint;
    readonly operationName: string;
    readonly capability: string;
    readonly catchability: "application" | "mixed" | "host";
  }>
  | Readonly<{
    readonly kind: "diagnostic_v2";
    readonly phase: DeclarativeV2DiagnosticFrameV2["phase"];
    readonly moduleOrdinal: bigint;
    readonly byteOffset: bigint;
    readonly diagnosticId: bigint;
    readonly code: string;
    readonly message: string;
  }>;

type EvidenceCursorStateV2 = {
  readonly frame: EvidenceCursorFrameV2;
  claimed: boolean;
};
const OWNED_EVIDENCE_CURSORS = new WeakMap<object, EvidenceCursorStateV2>();

export interface DeclarativeV2VerificationEvidenceUsageV2 {
  readonly frameBytes: number;
  readonly canonicalBytes: number;
}

export interface DeclarativeV2EncodedVerificationEvidenceV2 {
  readonly bytes: Uint8Array;
  readonly usage: DeclarativeV2VerificationEvidenceUsageV2;
}

export interface DeclarativeV2DecodedVerificationEvidenceV2 {
  readonly frame: DeclarativeV2VerificationEvidenceFrameV2;
  readonly usage: DeclarativeV2VerificationEvidenceUsageV2;
}

export interface DeclarativeV2VerificationEvidencePendingV2 {
  readonly status: "pending";
  readonly mechanical: IncrementalCanonicalJsonReceiptV1;
}

export interface DeclarativeV2VerificationEvidenceDecodePendingV2
  extends DeclarativeV2VerificationEvidencePendingV2 {
  readonly consumedInputBytes: number;
}

export interface DeclarativeV2VerificationEvidenceEncodeCompleteV2
  extends DeclarativeV2EncodedVerificationEvidenceV2 {
  readonly status: "complete";
  readonly mechanical: IncrementalCanonicalJsonReceiptV1;
}

export interface DeclarativeV2VerificationEvidenceDecodeCompleteV2
  extends DeclarativeV2DecodedVerificationEvidenceV2 {
  readonly status: "complete";
  readonly consumedInputBytes: number;
  readonly mechanical: IncrementalCanonicalJsonReceiptV1;
}

export type DeclarativeV2VerificationEvidenceEncodeStepV2 =
  | DeclarativeV2VerificationEvidencePendingV2
  | DeclarativeV2VerificationEvidenceEncodeCompleteV2;

export type DeclarativeV2VerificationEvidenceDecodeStepV2 =
  | DeclarativeV2VerificationEvidenceDecodePendingV2
  | DeclarativeV2VerificationEvidenceDecodeCompleteV2;

export interface DeclarativeV2VerificationEvidenceEncoderV2 {
  readonly step: (
    maximumTransitions: unknown,
  ) => Result.Result<
    DeclarativeV2VerificationEvidenceEncodeStepV2,
    DeclarativeV2VerificationEvidenceV2Error
  >;
  readonly finish: (
    maximumTransitions: unknown,
  ) => Result.Result<
    DeclarativeV2VerificationEvidenceEncodeStepV2,
    DeclarativeV2VerificationEvidenceV2Error
  >;
}

export interface DeclarativeV2VerificationEvidenceSinkCompleteV2 {
  readonly status: "complete";
  readonly canonicalByteLength: number;
  readonly usage: DeclarativeV2VerificationEvidenceUsageV2;
  readonly mechanical: IncrementalCanonicalJsonReceiptV1;
}

export type DeclarativeV2VerificationEvidenceSinkEncodeStepV2 =
  | DeclarativeV2VerificationEvidencePendingV2
  | DeclarativeV2VerificationEvidenceSinkCompleteV2;

export interface DeclarativeV2VerificationEvidenceSinkEncoderV2 {
  readonly step: (
    maximumTransitions: unknown,
  ) => Result.Result<
    DeclarativeV2VerificationEvidenceSinkEncodeStepV2,
    DeclarativeV2VerificationEvidenceV2Error
  >;
  readonly finish: (
    maximumTransitions: unknown,
  ) => Result.Result<
    DeclarativeV2VerificationEvidenceSinkEncodeStepV2,
    DeclarativeV2VerificationEvidenceV2Error
  >;
}

export interface DeclarativeV2VerificationEvidenceDecoderV2 {
  readonly step: (
    input: unknown,
    maximumTransitions: unknown,
  ) => Result.Result<
    DeclarativeV2VerificationEvidenceDecodeStepV2,
    DeclarativeV2VerificationEvidenceV2Error
  >;
  readonly finish: (
    maximumTransitions: unknown,
  ) => Result.Result<
    DeclarativeV2VerificationEvidenceDecodeStepV2,
    DeclarativeV2VerificationEvidenceV2Error
  >;
}

export function makeDeclarativeV2VerificationEvidenceBudgetV2(
  maximumFrameBytes: unknown,
  maximumCanonicalBytes: unknown,
): Result.Result<
  DeclarativeV2VerificationEvidenceBudgetV2,
  DeclarativeV2VerificationEvidenceV2Error
> {
  if (
    !isNonNegativeSafeInteger(maximumFrameBytes) ||
    !isNonNegativeSafeInteger(maximumCanonicalBytes)
  ) {
    return Result.fail(evidenceError("decode", "invalidInput", {
      path: "budget",
    }));
  }
  const budget = Object.freeze({
    maximumFrameBytes,
    maximumCanonicalBytes,
  } satisfies DeclarativeV2VerificationEvidenceBudgetV2);
  OWNED_EVIDENCE_BUDGETS.set(budget, budget);
  return Result.succeed(budget);
}

function captureBudget(
  value: unknown,
): DeclarativeV2VerificationEvidenceBudgetV2 | undefined {
  return value !== null && typeof value === "object"
    ? OWNED_EVIDENCE_BUDGETS.get(value)
    : undefined;
}

function isU64(value: unknown): value is bigint {
  return typeof value === "bigint" &&
    value >= 0n &&
    value <= MAX_SIGNED_INT64;
}

function isCanonicalText(value: unknown): value is string {
  return isNonEmptyString(value);
}

function captureDigest(value: unknown): Uint8Array | undefined {
  if (!isUint8ArrayWithByteLength(value, 32)) return undefined;
  try {
    return new Uint8Array(value);
  } catch {
    return undefined;
  }
}

function ownFrameFromArguments(
  input: DeclarativeV2VerificationEvidenceFrameArgumentsV2,
): DeclarativeV2VerificationEvidenceFrameV2 | undefined {
  switch (input[0]) {
    case "module_summary_v2": {
      const [
        kind,
        moduleOrdinal,
        modulePath,
        sourceSha256,
        sourceByteLength,
        importCount,
        exportCount,
        functionCount,
        callCount,
        valueFlowCount,
      ] = input;
      const visibleDigest = captureDigest(sourceSha256);
      if (
        visibleDigest === undefined ||
        !isU64(moduleOrdinal) ||
        !isCanonicalText(modulePath) ||
        !isU64(sourceByteLength) ||
        !isU64(importCount) ||
        !isU64(exportCount) ||
        !isU64(functionCount) ||
        !isU64(callCount) ||
        !isU64(valueFlowCount)
      ) {
        return undefined;
      }
      const visible = Object.freeze({
        kind,
        moduleOrdinal,
        modulePath,
        sourceSha256: visibleDigest,
        sourceByteLength,
        importCount,
        exportCount,
        functionCount,
        callCount,
        valueFlowCount,
      } satisfies DeclarativeV2ModuleSummaryFrameV2);
      const hidden = Object.freeze({
        ...visible,
        sourceSha256: new Uint8Array(visibleDigest),
      } satisfies DeclarativeV2ModuleSummaryFrameV2);
      OWNED_EVIDENCE_FRAMES.set(visible, hidden);
      return visible;
    }
    case "import_call_v2": {
      const [
        kind,
        moduleOrdinal,
        edgeOrdinal,
        callerFunction,
        targetKind,
        targetModulePath,
        targetName,
      ] = input;
      if (
        !isU64(moduleOrdinal) ||
        !isU64(edgeOrdinal) ||
        !isCanonicalText(callerFunction) ||
        !(
          targetKind === "local" ||
          targetKind === "artifactImport" ||
          targetKind === "platformImport" ||
          targetKind === "abi"
        ) ||
        !(targetModulePath === null || isCanonicalText(targetModulePath)) ||
        !isCanonicalText(targetName)
      ) {
        return undefined;
      }
      const frame = Object.freeze({
        kind,
        moduleOrdinal,
        edgeOrdinal,
        callerFunction,
        targetKind,
        targetModulePath,
        targetName,
      } satisfies DeclarativeV2ImportCallFrameV2);
      OWNED_EVIDENCE_FRAMES.set(frame, frame);
      return frame;
    }
    case "value_flow_v2": {
      const [
        kind,
        moduleOrdinal,
        functionName,
        operationOrdinal,
        operationName,
        capability,
        catchability,
      ] = input;
      if (
        !isU64(moduleOrdinal) ||
        !isCanonicalText(functionName) ||
        !isU64(operationOrdinal) ||
        !isCanonicalText(operationName) ||
        !isCanonicalText(capability) ||
        !(
          catchability === "application" ||
          catchability === "mixed" ||
          catchability === "host"
        )
      ) {
        return undefined;
      }
      const frame = Object.freeze({
        kind,
        moduleOrdinal,
        functionName,
        operationOrdinal,
        operationName,
        capability,
        catchability,
      } satisfies DeclarativeV2ValueFlowFrameV2);
      OWNED_EVIDENCE_FRAMES.set(frame, frame);
      return frame;
    }
    case "diagnostic_v2": {
      const [
        kind,
        phase,
        moduleOrdinal,
        byteOffset,
        diagnosticId,
        code,
        message,
      ] = input;
      if (
        !(
          phase === "source" ||
          phase === "lexical" ||
          phase === "parse" ||
          phase === "valueFlow" ||
          phase === "link" ||
          phase === "registration" ||
          phase === "admission" ||
          phase === "diagnostic"
        ) ||
        !isU64(moduleOrdinal) ||
        !isU64(byteOffset) ||
        !isU64(diagnosticId) ||
        !isCanonicalText(code) ||
        !isCanonicalText(message)
      ) {
        return undefined;
      }
      const frame = Object.freeze({
        kind,
        phase,
        moduleOrdinal,
        byteOffset,
        diagnosticId,
        code,
        message,
      } satisfies DeclarativeV2DiagnosticFrameV2);
      OWNED_EVIDENCE_FRAMES.set(frame, frame);
      return frame;
    }
  }
}

export function makeDeclarativeV2VerificationEvidenceFrameV2(
  ...input: DeclarativeV2VerificationEvidenceFrameArgumentsV2
): Result.Result<
  DeclarativeV2VerificationEvidenceFrameV2,
  DeclarativeV2VerificationEvidenceV2Error
> {
  const frame = ownFrameFromArguments(input);
  return frame === undefined
    ? Result.fail(evidenceError("encode", "invalidInput"))
    : Result.succeed(frame);
}

function captureFrame(
  value: unknown,
): DeclarativeV2VerificationEvidenceFrameV2 | undefined {
  return value !== null && typeof value === "object"
    ? OWNED_EVIDENCE_FRAMES.get(value)
    : undefined;
}

export function makeDeclarativeV2VerificationEvidenceTextCursorV2(
  byteLength: unknown,
  pull: EvidenceTextCursorPullV2,
): Result.Result<
  DeclarativeV2VerificationEvidenceTextCursorV2,
  DeclarativeV2VerificationEvidenceV2Error
> {
  if (
    !isNonNegativeSafeInteger(byteLength) ||
    byteLength === 0 ||
    byteLength > 0xffff_ffff ||
    typeof pull !== "function"
  ) {
    return Result.fail(evidenceError("encode", "invalidInput"));
  }
  const cursor = Object.freeze({
    _tag: "DeclarativeV2VerificationEvidenceTextCursorV2",
  } as const);
  OWNED_EVIDENCE_TEXT_CURSORS.set(cursor, {
    byteLength,
    pull,
    claimed: false,
  });
  return Result.succeed(cursor);
}

function captureTextCursor(
  value: unknown,
): EvidenceTextCursorStateV2 | undefined {
  const cursor = value !== null && typeof value === "object"
    ? OWNED_EVIDENCE_TEXT_CURSORS.get(value)
    : undefined;
  return cursor?.claimed === false ? cursor : undefined;
}

function ownEvidenceCursor(
  frame: EvidenceCursorFrameV2,
  textCursors: ReadonlyArray<EvidenceTextCursorStateV2>,
): DeclarativeV2VerificationEvidenceCursorV2 | undefined {
  for (let index = 0; index < textCursors.length; index += 1) {
    const cursor = textCursors[index]!;
    if (cursor.claimed) return undefined;
    for (let previous = 0; previous < index; previous += 1) {
      if (textCursors[previous] === cursor) return undefined;
    }
  }
  for (const cursor of textCursors) cursor.claimed = true;
  const handle = Object.freeze({
    _tag: "DeclarativeV2VerificationEvidenceCursorV2",
  } as const);
  OWNED_EVIDENCE_CURSORS.set(handle, { frame, claimed: false });
  return handle;
}

function cursorResult(
  value: DeclarativeV2VerificationEvidenceCursorV2 | undefined,
): Result.Result<
  DeclarativeV2VerificationEvidenceCursorV2,
  DeclarativeV2VerificationEvidenceV2Error
> {
  return value === undefined
    ? Result.fail(evidenceError("encode", "invalidInput"))
    : Result.succeed(value);
}

export function makeDeclarativeV2ModuleSummaryEvidenceCursorV2(
  moduleOrdinal: unknown,
  modulePath: unknown,
  sourceSha256: unknown,
  sourceByteLength: unknown,
  importCount: unknown,
  exportCount: unknown,
  functionCount: unknown,
  callCount: unknown,
  valueFlowCount: unknown,
): Result.Result<
  DeclarativeV2VerificationEvidenceCursorV2,
  DeclarativeV2VerificationEvidenceV2Error
> {
  const path = captureTextCursor(modulePath);
  const digest = captureDigest(sourceSha256);
  if (
    path === undefined ||
    digest === undefined ||
    !isU64(moduleOrdinal) ||
    !isU64(sourceByteLength) ||
    !isU64(importCount) ||
    !isU64(exportCount) ||
    !isU64(functionCount) ||
    !isU64(callCount) ||
    !isU64(valueFlowCount)
  ) {
    return cursorResult(undefined);
  }
  return cursorResult(ownEvidenceCursor(Object.freeze({
    kind: "module_summary_v2",
    moduleOrdinal,
    modulePath: path,
    sourceSha256: digest,
    sourceByteLength,
    importCount,
    exportCount,
    functionCount,
    callCount,
    valueFlowCount,
  }), [path]));
}

export function makeDeclarativeV2ImportCallEvidenceCursorV2(
  moduleOrdinal: unknown,
  edgeOrdinal: unknown,
  callerFunction: unknown,
  targetKind: unknown,
  targetModulePath: unknown,
  targetName: unknown,
): Result.Result<
  DeclarativeV2VerificationEvidenceCursorV2,
  DeclarativeV2VerificationEvidenceV2Error
> {
  const caller = captureTextCursor(callerFunction);
  const targetPath = targetModulePath === null
    ? null
    : captureTextCursor(targetModulePath);
  const name = captureTextCursor(targetName);
  if (
    caller === undefined ||
    targetPath === undefined ||
    name === undefined ||
    !isU64(moduleOrdinal) ||
    !isU64(edgeOrdinal) ||
    !(
      targetKind === "local" ||
      targetKind === "artifactImport" ||
      targetKind === "platformImport" ||
      targetKind === "abi"
    )
  ) {
    return cursorResult(undefined);
  }
  const cursors = targetPath === null
    ? [caller, name]
    : [caller, targetPath, name];
  return cursorResult(ownEvidenceCursor(Object.freeze({
    kind: "import_call_v2",
    moduleOrdinal,
    edgeOrdinal,
    callerFunction: caller,
    targetKind,
    targetModulePath: targetPath,
    targetName: name,
  }), cursors));
}

export function makeDeclarativeV2ValueFlowEvidenceCursorV2(
  moduleOrdinal: unknown,
  functionName: unknown,
  operationOrdinal: unknown,
  operationName: unknown,
  capability: unknown,
  catchability: unknown,
): Result.Result<
  DeclarativeV2VerificationEvidenceCursorV2,
  DeclarativeV2VerificationEvidenceV2Error
> {
  const name = captureTextCursor(functionName);
  if (
    name === undefined ||
    !isU64(moduleOrdinal) ||
    !isU64(operationOrdinal) ||
    !isCanonicalText(operationName) ||
    !isCanonicalText(capability) ||
    !(
      catchability === "application" ||
      catchability === "mixed" ||
      catchability === "host"
    )
  ) {
    return cursorResult(undefined);
  }
  return cursorResult(ownEvidenceCursor(Object.freeze({
    kind: "value_flow_v2",
    moduleOrdinal,
    functionName: name,
    operationOrdinal,
    operationName,
    capability,
    catchability,
  }), [name]));
}

export function makeDeclarativeV2DiagnosticEvidenceCursorV2(
  phase: unknown,
  moduleOrdinal: unknown,
  byteOffset: unknown,
  diagnosticId: unknown,
  code: unknown,
  message: unknown,
): Result.Result<
  DeclarativeV2VerificationEvidenceCursorV2,
  DeclarativeV2VerificationEvidenceV2Error
> {
  if (
    !(
      phase === "source" ||
      phase === "lexical" ||
      phase === "parse" ||
      phase === "valueFlow" ||
      phase === "link" ||
      phase === "registration" ||
      phase === "admission" ||
      phase === "diagnostic"
    ) ||
    !isU64(moduleOrdinal) ||
    !isU64(byteOffset) ||
    !isU64(diagnosticId) ||
    !isCanonicalText(code) ||
    !isCanonicalText(message)
  ) {
    return cursorResult(undefined);
  }
  return cursorResult(ownEvidenceCursor(Object.freeze({
    kind: "diagnostic_v2",
    phase,
    moduleOrdinal,
    byteOffset,
    diagnosticId,
    code,
    message,
  }), []));
}

function digestHex(bytes: Uint8Array): string {
  return Encoding.encodeHex(bytes).toLowerCase();
}

type EvidenceWireScalar = EvidenceTextValueV2 | number | boolean | null;

function frameEntries(
  value:
    | DeclarativeV2VerificationEvidenceFrameV2
    | EvidenceCursorFrameV2,
): ReadonlyArray<readonly [string, EvidenceWireScalar]> {
  switch (value.kind) {
    case "module_summary_v2":
      return [
        ["callCount", value.callCount.toString()],
        ["domain", DECLARATIVE_V2_VERIFICATION_EVIDENCE_CODEC_IDENTITY_V2],
        ["exportCount", value.exportCount.toString()],
        ["functionCount", value.functionCount.toString()],
        ["importCount", value.importCount.toString()],
        ["kind", value.kind],
        ["moduleOrdinal", value.moduleOrdinal.toString()],
        ["modulePath", value.modulePath],
        ["sourceByteLength", value.sourceByteLength.toString()],
        ["sourceSha256", digestHex(value.sourceSha256)],
        ["valueFlowCount", value.valueFlowCount.toString()],
        ["version", 2],
      ];
    case "import_call_v2":
      return [
        ["callerFunction", value.callerFunction],
        ["domain", DECLARATIVE_V2_VERIFICATION_EVIDENCE_CODEC_IDENTITY_V2],
        ["edgeOrdinal", value.edgeOrdinal.toString()],
        ["kind", value.kind],
        ["moduleOrdinal", value.moduleOrdinal.toString()],
        ["targetKind", value.targetKind],
        ["targetModulePath", value.targetModulePath],
        ["targetName", value.targetName],
        ["version", 2],
      ];
    case "value_flow_v2":
      return [
        ["capability", value.capability],
        ["catchability", value.catchability],
        ["domain", DECLARATIVE_V2_VERIFICATION_EVIDENCE_CODEC_IDENTITY_V2],
        ["functionName", value.functionName],
        ["kind", value.kind],
        ["moduleOrdinal", value.moduleOrdinal.toString()],
        ["operationName", value.operationName],
        ["operationOrdinal", value.operationOrdinal.toString()],
        ["version", 2],
      ];
    case "diagnostic_v2":
      return [
        ["byteOffset", value.byteOffset.toString()],
        ["code", value.code],
        ["diagnosticId", value.diagnosticId.toString()],
        ["domain", DECLARATIVE_V2_VERIFICATION_EVIDENCE_CODEC_IDENTITY_V2],
        ["kind", value.kind],
        ["message", value.message],
        ["moduleOrdinal", value.moduleOrdinal.toString()],
        ["phase", value.phase],
        ["version", 2],
      ];
  }
}

function createEvidenceEventSource(
  value:
    | DeclarativeV2VerificationEvidenceFrameV2
    | EvidenceCursorFrameV2,
) {
  const entries = frameEntries(value);
  let entryIndex = 0;
  let text: EvidenceTextValueV2 = "";
  let textIndex = 0;
  let textByteOffset = 0;
  let textRole: "key" | "value" = "key";
  let phase:
    | "objectStart"
    | "keyStart"
    | "keyScalar"
    | "keyEnd"
    | "value"
    | "valueScalar"
    | "valueEnd"
    | "objectEnd"
    | "end"
    | "closed" = "objectStart";
  const pull = (): IncrementalCanonicalJsonEventV1 => {
    switch (phase) {
      case "objectStart":
        phase = entries.length === 0 ? "objectEnd" : "keyStart";
        return { kind: "objectStart" };
      case "keyStart":
        text = entries[entryIndex]![0];
        textIndex = 0;
        textByteOffset = 0;
        textRole = "key";
        phase = "keyScalar";
        return { kind: "stringStart", role: "key" };
      case "keyScalar":
      case "valueScalar": {
        const cursorScalar = typeof text === "string"
          ? undefined
          : text.pull();
        const textComplete = typeof text === "string"
          ? textIndex >= text.length
          : cursorScalar === undefined &&
            textByteOffset === text.byteLength;
        if (textComplete) {
          if (textRole === "key") {
            phase = "value";
            return { kind: "stringEnd", role: "key" };
          }
          phase = entryIndex + 1 < entries.length ? "keyStart" : "objectEnd";
          entryIndex += 1;
          return { kind: "stringEnd", role: "value" };
        }
        if (
          typeof text !== "string" &&
          (
            cursorScalar === undefined ||
            !Number.isInteger(cursorScalar) ||
            cursorScalar < 0 ||
            cursorScalar > 0x10ffff ||
            (cursorScalar >= 0xd800 && cursorScalar <= 0xdfff)
          )
        ) {
          return {
            kind: "stringScalar",
            role: textRole,
            value: "",
            codePoint: -1,
          };
        }
        const codePoint = typeof text === "string"
          ? text.codePointAt(textIndex)!
          : cursorScalar!;
        const scalar = String.fromCodePoint(codePoint);
        if (typeof text === "string") {
          textIndex += scalar.length;
        } else {
          textByteOffset += codePoint <= 0x7f
            ? 1
            : codePoint <= 0x7ff
            ? 2
            : codePoint <= 0xffff
            ? 3
            : 4;
          if (textByteOffset > text.byteLength) {
            return {
              kind: "stringScalar",
              role: textRole,
              value: "",
              codePoint: -1,
            };
          }
        }
        return {
          kind: "stringScalar",
          role: textRole,
          value: scalar,
          codePoint,
        };
      }
      case "keyEnd":
        throw new Error("unreachable evidence key-end state");
      case "value": {
        const current = entries[entryIndex]![1];
        if (typeof current === "string") {
          text = current;
          textIndex = 0;
          textByteOffset = 0;
          textRole = "value";
          phase = "valueScalar";
          return { kind: "stringStart", role: "value" };
        }
        if (
          current !== null &&
          typeof current === "object" &&
          "pull" in current
        ) {
          text = current;
          textIndex = 0;
          textByteOffset = 0;
          textRole = "value";
          phase = "valueScalar";
          return { kind: "stringStart", role: "value" };
        }
        phase = entryIndex + 1 < entries.length ? "keyStart" : "objectEnd";
        entryIndex += 1;
        return current === null
          ? { kind: "null" }
          : typeof current === "boolean"
          ? { kind: "boolean", value: current }
          : { kind: "number", value: current };
      }
      case "valueEnd":
        throw new Error("unreachable evidence value-end state");
      case "objectEnd":
        phase = "end";
        return { kind: "objectEnd" };
      case "end":
        phase = "closed";
        return { kind: "end" };
      case "closed":
        throw new Error("verification evidence source was pulled after end");
    }
  };
  return makeIncrementalCanonicalJsonEventSourceV1(pull);
}

function createEvidenceEventSink(): Readonly<{
  readonly sink: IncrementalCanonicalJsonEventSinkV1;
  readonly value: () => Json | undefined;
}> {
  type Frame =
    | { readonly kind: "array"; readonly value: Json[] }
    | {
        readonly kind: "object";
        readonly value: Record<string, Json>;
        currentKey: string | undefined;
      };
  const frames: Frame[] = [];
  let root: Json | undefined;
  let hasRoot = false;
  let role: "key" | "value" | undefined;
  let text = "";
  const attach = (value: Json): void => {
    const frame = frames[frames.length - 1];
    if (frame === undefined) {
      if (hasRoot) throw new Error("evidence sink received two root values");
      root = value;
      hasRoot = true;
      return;
    }
    if (frame.kind === "array") {
      const index = frame.value.length;
      Object.defineProperty(frame.value, String(index), {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      });
      return;
    }
    if (frame.currentKey === undefined) {
      throw new Error("evidence sink received a value without a key");
    }
    Object.defineProperty(frame.value, frame.currentKey, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
    frame.currentKey = undefined;
  };
  const push = (event: IncrementalCanonicalJsonSinkEventV1): void => {
    switch (event.kind) {
      case "null":
        attach(null);
        return;
      case "boolean":
      case "number":
        attach(event.value);
        return;
      case "stringStart":
        if (role !== undefined) {
          throw new Error("evidence sink received invalid string start");
        }
        role = event.role;
        text = "";
        return;
      case "stringScalar":
        if (role !== event.role) {
          throw new Error("evidence sink received mismatched scalar");
        }
        text += event.value;
        return;
      case "stringEnd": {
        if (role !== event.role) {
          throw new Error("evidence sink received mismatched string end");
        }
        const captured = text;
        role = undefined;
        text = "";
        if (event.role === "value") {
          attach(captured);
          return;
        }
        const frame = frames[frames.length - 1];
        if (frame?.kind !== "object") {
          throw new Error("evidence sink received a key outside an object");
        }
        frame.currentKey = captured;
        return;
      }
      case "arrayStart": {
        const value: Json[] = [];
        attach(value);
        frames.push({ kind: "array", value });
        return;
      }
      case "objectStart": {
        const value: Record<string, Json> = {};
        attach(value);
        frames.push({ kind: "object", value, currentKey: undefined });
        return;
      }
      case "arrayEnd":
      case "objectEnd": {
        const frame = frames.pop();
        if (
          frame === undefined ||
          (event.kind === "arrayEnd" && frame.kind !== "array") ||
          (event.kind === "objectEnd" && frame.kind !== "object") ||
          (frame.kind === "object" && frame.currentKey !== undefined)
        ) {
          throw new Error("evidence sink received a mismatched container end");
        }
        return;
      }
      case "memberFinalize": {
        const frame = frames[frames.length - 1];
        if (frame === undefined || frame.kind !== event.container) {
          throw new Error("evidence sink received invalid member finalization");
        }
        const descriptor = Object.getOwnPropertyDescriptor(
          frame.value,
          event.key,
        );
        if (descriptor === undefined || !("value" in descriptor)) {
          throw new Error("evidence sink received missing member");
        }
        Object.defineProperty(frame.value, event.key, {
          configurable: false,
          enumerable: true,
          value: descriptor.value,
          writable: false,
        });
        return;
      }
      case "arrayLengthFinalize": {
        const frame = frames[frames.length - 1];
        if (frame?.kind !== "array") {
          throw new Error("evidence sink received invalid array length");
        }
        Object.defineProperty(frame.value, "length", { writable: false });
        return;
      }
      case "containerSeal": {
        const frame = frames[frames.length - 1];
        if (frame === undefined || frame.kind !== event.container) {
          throw new Error("evidence sink received invalid container seal");
        }
        Object.preventExtensions(frame.value);
        return;
      }
    }
  };
  return Object.freeze({
    sink: makeIncrementalCanonicalJsonEventSinkV1(push),
    value: () => hasRoot && frames.length === 0 ? root : undefined,
  });
}

function decimalU64(value: unknown): bigint | undefined {
  if (
    typeof value !== "string" ||
    value.length > 19 ||
    !/^(?:0|[1-9][0-9]*)$/u.test(value)
  ) {
    return undefined;
  }
  const parsed = BigInt(value);
  return parsed <= MAX_SIGNED_INT64 ? parsed : undefined;
}

function decodeDigest(value: unknown): Uint8Array | undefined {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    return undefined;
  }
  const decoded = Encoding.decodeHex(value);
  return Result.isSuccess(decoded) &&
      isUint8ArrayWithByteLength(decoded.success, 32)
    ? new Uint8Array(decoded.success)
    : undefined;
}

function isParsedObject(
  value: Json,
): value is Readonly<Record<string, Json>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExpectedParsedFields(
  value: Readonly<Record<string, Json>>,
  expected: ReadonlyArray<string>,
  rootObjectMemberCount: number | undefined,
): boolean {
  if (rootObjectMemberCount !== expected.length) return false;
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) return false;
  }
  return true;
}

function parsedFrame(
  value: Json,
  rootObjectMemberCount: number | undefined,
): DeclarativeV2VerificationEvidenceFrameV2 | undefined {
  if (
    !isParsedObject(value) ||
    value.domain !== DECLARATIVE_V2_VERIFICATION_EVIDENCE_CODEC_IDENTITY_V2 ||
    value.version !== 2 ||
    typeof value.kind !== "string"
  ) {
    return undefined;
  }
  switch (value.kind) {
    case "module_summary_v2":
      if (!hasExpectedParsedFields(
        value,
        FRAME_WIRE_KEYS.module_summary_v2,
        rootObjectMemberCount,
      )) return undefined;
      return ownFrameFromArguments([
        value.kind,
        decimalU64(value.moduleOrdinal),
        value.modulePath,
        decodeDigest(value.sourceSha256),
        decimalU64(value.sourceByteLength),
        decimalU64(value.importCount),
        decimalU64(value.exportCount),
        decimalU64(value.functionCount),
        decimalU64(value.callCount),
        decimalU64(value.valueFlowCount),
      ]);
    case "import_call_v2":
      if (!hasExpectedParsedFields(
        value,
        FRAME_WIRE_KEYS.import_call_v2,
        rootObjectMemberCount,
      )) return undefined;
      return ownFrameFromArguments([
        value.kind,
        decimalU64(value.moduleOrdinal),
        decimalU64(value.edgeOrdinal),
        value.callerFunction,
        value.targetKind,
        value.targetModulePath,
        value.targetName,
      ]);
    case "value_flow_v2":
      if (!hasExpectedParsedFields(
        value,
        FRAME_WIRE_KEYS.value_flow_v2,
        rootObjectMemberCount,
      )) return undefined;
      return ownFrameFromArguments([
        value.kind,
        decimalU64(value.moduleOrdinal),
        value.functionName,
        decimalU64(value.operationOrdinal),
        value.operationName,
        value.capability,
        value.catchability,
      ]);
    case "diagnostic_v2":
      if (!hasExpectedParsedFields(
        value,
        FRAME_WIRE_KEYS.diagnostic_v2,
        rootObjectMemberCount,
      )) return undefined;
      return ownFrameFromArguments([
        value.kind,
        value.phase,
        decimalU64(value.moduleOrdinal),
        decimalU64(value.byteOffset),
        decimalU64(value.diagnosticId),
        value.code,
        value.message,
      ]);
    default:
      return undefined;
  }
}

function jsonLimits(
  budget: DeclarativeV2VerificationEvidenceBudgetV2,
  operation: "encode" | "decode",
): IncrementalCanonicalJsonLimitsV1 | undefined {
  const owned = makeIncrementalCanonicalJsonLimitsV1(
    budget.maximumFrameBytes,
    operation === "encode"
      ? Math.min(
        budget.maximumFrameBytes,
        budget.maximumCanonicalBytes,
      )
      : budget.maximumCanonicalBytes,
    budget.maximumFrameBytes,
    budget.maximumFrameBytes,
    budget.maximumFrameBytes,
  );
  return Result.isSuccess(owned) ? owned.success : undefined;
}

function mapJsonIssue(
  operation: "encode" | "decode",
  value: IncrementalCanonicalJsonIssueV1,
  budget?: DeclarativeV2VerificationEvidenceBudgetV2,
): DeclarativeV2VerificationEvidenceV2Error {
  switch (value.reason) {
    case "invalidUtf8":
      return evidenceError(operation, "invalidUtf8");
    case "malformed":
      return evidenceError(operation, "malformed");
    case "budgetExceeded": {
      const frameControlsCanonicalOutput =
        operation === "encode" &&
        value.dimension === "canonicalBytes" &&
        budget !== undefined &&
        budget.maximumFrameBytes <= budget.maximumCanonicalBytes &&
        value.maximum === budget.maximumFrameBytes;
      const canonical =
        value.dimension === "canonicalBytes" && !frameControlsCanonicalOutput;
      return evidenceError(operation, "budgetExceeded", {
        path: canonical ? "canonicalBytes" : "frameBytes",
        ...(value.observed === undefined ? {} : { observed: value.observed }),
        ...(value.maximum === undefined ? {} : { maximum: value.maximum }),
      });
    }
    case "invalidInput":
    case "invalidBudget":
    case "closed":
      return evidenceError(operation, "invalidInput");
  }
}

function encodedStep(
  value: IncrementalCanonicalJsonEncodeStepV1,
  budget: DeclarativeV2VerificationEvidenceBudgetV2,
): Result.Result<
  DeclarativeV2VerificationEvidenceEncodeStepV2,
  DeclarativeV2VerificationEvidenceV2Error
> {
  if (value.status === "pending") {
    return Result.succeed(Object.freeze({
      status: "pending",
      mechanical: value.receipt,
    }));
  }
  const byteLength = value.bytes.byteLength;
  if (byteLength > budget.maximumFrameBytes) {
    return Result.fail(evidenceError("encode", "budgetExceeded", {
      path: "frameBytes",
      observed: byteLength,
      maximum: budget.maximumFrameBytes,
    }));
  }
  return Result.succeed(Object.freeze({
    status: "complete",
    bytes: value.bytes,
    usage: Object.freeze({
      frameBytes: byteLength,
      canonicalBytes: byteLength,
    }),
    mechanical: value.receipt,
  }));
}

function encodedSinkStep(
  value: IncrementalCanonicalJsonByteSinkEncodeStepV1,
  budget: DeclarativeV2VerificationEvidenceBudgetV2,
): Result.Result<
  DeclarativeV2VerificationEvidenceSinkEncodeStepV2,
  DeclarativeV2VerificationEvidenceV2Error
> {
  if (value.status === "pending") {
    return Result.succeed(Object.freeze({
      status: "pending",
      mechanical: value.receipt,
    }));
  }
  if (value.canonicalByteLength > budget.maximumFrameBytes) {
    return Result.fail(evidenceError("encode", "budgetExceeded", {
      path: "frameBytes",
      observed: value.canonicalByteLength,
      maximum: budget.maximumFrameBytes,
    }));
  }
  return Result.succeed(Object.freeze({
    status: "complete",
    canonicalByteLength: value.canonicalByteLength,
    usage: Object.freeze({
      frameBytes: value.canonicalByteLength,
      canonicalBytes: value.canonicalByteLength,
    }),
    mechanical: value.receipt,
  }));
}

function captureEvidenceSourceFrame(
  value: unknown,
): Readonly<{
  readonly frame:
    | DeclarativeV2VerificationEvidenceFrameV2
    | EvidenceCursorFrameV2;
  readonly cursor?: EvidenceCursorStateV2;
}> | undefined {
  const frame = captureFrame(value);
  if (frame !== undefined) return { frame };
  const cursor = value !== null && typeof value === "object"
    ? OWNED_EVIDENCE_CURSORS.get(value)
    : undefined;
  if (cursor === undefined || cursor.claimed) return undefined;
  return { frame: cursor.frame, cursor };
}

export function createDeclarativeV2VerificationEvidenceEncoderV2(
  input: unknown,
  rawBudget: unknown,
): Result.Result<
  DeclarativeV2VerificationEvidenceEncoderV2,
  DeclarativeV2VerificationEvidenceV2Error
> {
  const budget = captureBudget(rawBudget);
  if (budget === undefined) {
    return Result.fail(evidenceError("encode", "invalidInput", {
      path: "budget",
    }));
  }
  const frame = captureFrame(input);
  if (frame === undefined) {
    return Result.fail(evidenceError("encode", "invalidInput"));
  }
  const limits = jsonLimits(budget, "encode");
  if (limits === undefined) {
    return Result.fail(evidenceError("encode", "invalidInput", {
      path: "budget",
    }));
  }
  const created = createIncrementalCanonicalJsonEncoderV1(
    createEvidenceEventSource(frame),
    limits,
  );
  if (Result.isFailure(created)) {
    return Result.fail(mapJsonIssue("encode", created.failure, budget));
  }
  const map = (
    value: Result.Result<
      IncrementalCanonicalJsonEncodeStepV1,
      IncrementalCanonicalJsonIssueV1
    >,
  ): Result.Result<
    DeclarativeV2VerificationEvidenceEncodeStepV2,
    DeclarativeV2VerificationEvidenceV2Error
  > =>
    Result.isFailure(value)
      ? Result.fail(mapJsonIssue("encode", value.failure, budget))
      : encodedStep(value.success, budget);
  return Result.succeed(Object.freeze({
    step: (maximumTransitions: unknown) =>
      map(created.success.step(maximumTransitions)),
    finish: (maximumTransitions: unknown) =>
      map(created.success.finish(maximumTransitions)),
  }));
}

export function createDeclarativeV2VerificationEvidenceSinkEncoderV2(
  input: unknown,
  rawBudget: unknown,
  sink: IncrementalCanonicalJsonByteSinkV1,
): Result.Result<
  DeclarativeV2VerificationEvidenceSinkEncoderV2,
  DeclarativeV2VerificationEvidenceV2Error
> {
  const budget = captureBudget(rawBudget);
  if (budget === undefined) {
    return Result.fail(evidenceError("encode", "invalidInput", {
      path: "budget",
    }));
  }
  const source = captureEvidenceSourceFrame(input);
  if (source === undefined) {
    return Result.fail(evidenceError("encode", "invalidInput"));
  }
  const limits = jsonLimits(budget, "encode");
  if (limits === undefined) {
    return Result.fail(evidenceError("encode", "invalidInput", {
      path: "budget",
    }));
  }
  const created = createIncrementalCanonicalJsonByteSinkEncoderV1(
    createEvidenceEventSource(source.frame),
    sink,
    limits,
  );
  if (Result.isFailure(created)) {
    return Result.fail(mapJsonIssue("encode", created.failure, budget));
  }
  if (source.cursor !== undefined) source.cursor.claimed = true;
  const map = (
    value: Result.Result<
      IncrementalCanonicalJsonByteSinkEncodeStepV1,
      IncrementalCanonicalJsonIssueV1
    >,
  ): Result.Result<
    DeclarativeV2VerificationEvidenceSinkEncodeStepV2,
    DeclarativeV2VerificationEvidenceV2Error
  > =>
    Result.isFailure(value)
      ? Result.fail(mapJsonIssue("encode", value.failure, budget))
      : encodedSinkStep(value.success, budget);
  return Result.succeed(Object.freeze({
    step: (maximumTransitions: unknown) =>
      map(created.success.step(maximumTransitions)),
    finish: (maximumTransitions: unknown) =>
      map(created.success.finish(maximumTransitions)),
  }));
}

function decodedStep(
  value: Extract<
    IncrementalCanonicalJsonDecodeStepV1,
    { readonly status: "complete" }
  >,
  parsed: Json | undefined,
  mechanical: IncrementalCanonicalJsonReceiptV1,
  consumedInputBytes: number,
): Result.Result<
  DeclarativeV2VerificationEvidenceDecodeStepV2,
  DeclarativeV2VerificationEvidenceV2Error
> {
  if (parsed === undefined) {
    return Result.fail(evidenceError("decode", "malformed"));
  }
  if (
    value.jsonMembership &&
    value.wellFormedUnicode &&
    isParsedObject(parsed) &&
    parsed.domain === DECLARATIVE_V2_VERIFICATION_EVIDENCE_CODEC_IDENTITY_V2 &&
    parsed.version !== 2
  ) {
    return Result.fail(evidenceError("decode", "unsupportedVersion"));
  }
  const candidate = parsedFrame(parsed, value.rootObjectMemberCount);
  if (candidate === undefined) {
    return Result.fail(evidenceError("decode", "malformed"));
  }
  if (!value.jsonMembership || !value.wellFormedUnicode) {
    return Result.fail(evidenceError("decode", "malformed"));
  }
  if (!value.canonical) {
    return Result.fail(evidenceError("decode", "nonCanonical"));
  }
  const frameBytes = value.receipt.aggregate.inputBytes;
  return Result.succeed(Object.freeze({
    status: "complete",
    consumedInputBytes,
    frame: candidate,
    usage: Object.freeze({
      frameBytes,
      canonicalBytes: value.receipt.aggregate.canonicalBytes,
    }),
    mechanical,
  }));
}

export function createDeclarativeV2VerificationEvidenceDecoderV2(
  rawBudget: unknown,
): Result.Result<
  DeclarativeV2VerificationEvidenceDecoderV2,
  DeclarativeV2VerificationEvidenceV2Error
> {
  const budget = captureBudget(rawBudget);
  if (budget === undefined) {
    return Result.fail(evidenceError("decode", "invalidInput", {
      path: "budget",
    }));
  }
  const limits = jsonLimits(budget, "decode");
  if (limits === undefined) {
    return Result.fail(evidenceError("decode", "invalidInput", {
      path: "budget",
    }));
  }
  const materializer = createEvidenceEventSink();
  const created = createIncrementalCanonicalJsonDecoderV1(
    limits,
    materializer.sink,
  );
  if (Result.isFailure(created)) {
    return Result.fail(mapJsonIssue("decode", created.failure));
  }
  let closed = false;
  let finishRequested = false;
  let domainTransitions = 0;
  let pendingDecoded:
    | Extract<
      IncrementalCanonicalJsonDecodeStepV1,
      { readonly status: "complete" }
    >
    | undefined;
  let lastAggregate: IncrementalCanonicalJsonReceiptV1["aggregate"] =
    Object.freeze({
      inputBytes: 0,
      canonicalBytes: 0,
      stringBytes: 0,
      members: 0,
      depth: 0,
      transitions: 0,
    });
  const adjustedReceipt = (
    value: IncrementalCanonicalJsonReceiptV1,
    domainDelta: number,
  ): IncrementalCanonicalJsonReceiptV1 => {
    lastAggregate = value.aggregate;
    return Object.freeze({
      delta: Object.freeze({
        ...value.delta,
        transitions: value.delta.transitions + domainDelta,
      }),
      aggregate: Object.freeze({
        ...value.aggregate,
        transitions: value.aggregate.transitions + domainTransitions,
      }),
    });
  };
  const pendingReceipt = (
    domainDelta: number,
  ): IncrementalCanonicalJsonReceiptV1 =>
    Object.freeze({
      delta: Object.freeze({
        inputBytes: 0,
        canonicalBytes: 0,
        stringBytes: 0,
        members: 0,
        depth: 0,
        transitions: domainDelta,
      }),
      aggregate: Object.freeze({
        ...lastAggregate,
        transitions: lastAggregate.transitions + domainTransitions,
      }),
    });
  const mapShared = (
    value: Result.Result<
      IncrementalCanonicalJsonDecodeStepV1,
      IncrementalCanonicalJsonIssueV1
    >,
  ): Result.Result<
    DeclarativeV2VerificationEvidenceDecodeStepV2,
    DeclarativeV2VerificationEvidenceV2Error
  > => {
    if (Result.isFailure(value)) {
      closed = true;
      return Result.fail(mapJsonIssue("decode", value.failure));
    }
    const mechanical = adjustedReceipt(value.success.receipt, 0);
    if (value.success.status === "pending") {
      return Result.succeed(Object.freeze({
        status: "pending",
        consumedInputBytes: value.success.consumedInputBytes,
        mechanical,
      }));
    }
    pendingDecoded = value.success;
    return Result.succeed(Object.freeze({
      status: "pending",
      consumedInputBytes: value.success.consumedInputBytes,
      mechanical,
    }));
  };
  const closedFailure = (): Result.Result<
    never,
    DeclarativeV2VerificationEvidenceV2Error
  > => Result.fail(evidenceError("decode", "invalidInput"));
  const advanceDomain = (
    maximumTransitions: unknown,
  ): Result.Result<
    DeclarativeV2VerificationEvidenceDecodeStepV2,
    DeclarativeV2VerificationEvidenceV2Error
  > => {
    if (
      !isNonNegativeSafeInteger(maximumTransitions) ||
      maximumTransitions > 1_024
    ) {
      closed = true;
      return Result.fail(evidenceError("decode", "invalidInput"));
    }
    if (maximumTransitions === 0) {
      return Result.succeed(Object.freeze({
        status: "pending",
        consumedInputBytes: 0,
        mechanical: pendingReceipt(0),
      }));
    }
    const decoded = pendingDecoded;
    if (decoded === undefined) return closedFailure();
    pendingDecoded = undefined;
    domainTransitions += 1;
    const projected = decodedStep(
      decoded,
      materializer.value(),
      pendingReceipt(1),
      0,
    );
    closed = true;
    return projected;
  };
  return Result.succeed(Object.freeze({
    step: (input: unknown, maximumTransitions: unknown) => {
      if (closed || finishRequested) return closedFailure();
      return pendingDecoded === undefined
        ? mapShared(created.success.step(input, maximumTransitions))
        : advanceDomain(maximumTransitions);
    },
    finish: (maximumTransitions: unknown) => {
      if (closed) return closedFailure();
      finishRequested = true;
      return pendingDecoded === undefined
        ? mapShared(created.success.finish(maximumTransitions))
        : advanceDomain(maximumTransitions);
    },
  }));
}
