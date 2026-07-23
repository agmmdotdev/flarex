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

export type DeclarativeV2VerifierProgressFrameV2 =
  | DeclarativeV2VerifierBudgetFrameV2
  | DeclarativeV2VerifierAttemptIdentityFrameV2
  | DeclarativeV2VerifierProgressCursorFrameV2;

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
const FRAME_KINDS = new Set<FrameKind>([
  "attempt_identity",
  "attempt_ceilings",
  "attempt_usage",
  "command_budget",
  "progress_cursor",
]);
const PHASES = new Set<DeclarativeV2VerifierPhaseV1>([
  "source",
  "parse",
  "link",
  "registration",
  "verdict",
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
  if (
    !isNonArrayRecord(input) ||
    !hasExactOwnDataKeys(input, [
      "budgetProtocolIdentity",
      "progressProtocolIdentity",
    ])
  ) {
    return Result.fail(progressError("decode", "invalidInput", "identities"));
  }
  const budgetProtocolIdentity = ownDataValue(input, "budgetProtocolIdentity");
  const progressProtocolIdentity = ownDataValue(
    input,
    "progressProtocolIdentity",
  );
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
  if (
    !isNonArrayRecord(input) ||
    !hasExactOwnDataKeys(input, [
      "maximumFrameBytes",
      "maximumCanonicalBytes",
    ])
  ) {
    return Result.fail(progressError(operation, "invalidBudget"));
  }
  const maximumFrameBytes = ownDataValue(input, "maximumFrameBytes");
  const maximumCanonicalBytes = ownDataValue(input, "maximumCanonicalBytes");
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
  if (
    !isNonArrayRecord(input)
  ) {
    return Result.fail(progressError(operation, "invalidInput"));
  }
  const rawKind = ownDataValue(input, "kind");
  if (typeof rawKind !== "string" || !FRAME_KINDS.has(rawKind as FrameKind)) {
    return Result.fail(progressError(operation, "invalidInput", "kind"));
  }
  const kind = rawKind as FrameKind;
  const fields = FRAME_FIELDS[kind];
  if (!hasExactOwnDataKeys(input, ["kind", ...fields])) {
    return Result.fail(progressError(operation, "invalidInput", kind));
  }
  if (
    kind === "attempt_ceilings" ||
    kind === "attempt_usage" ||
    kind === "command_budget"
  ) {
    const result: Record<string, bigint | string> = { kind };
    for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
      const value = ownDataValue(input, dimension);
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
    const candidateSha256 = ownDataValue(input, "candidateSha256");
    const progressProtocolIdentity = ownDataValue(
      input,
      "progressProtocolIdentity",
    );
    const budgetProtocolIdentity = ownDataValue(
      input,
      "budgetProtocolIdentity",
    );
    const ceilingsSha256 = ownDataValue(input, "ceilingsSha256");
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
  const phase = ownDataValue(input, "phase");
  const settledSequence = ownDataValue(input, "settledSequence");
  const moduleOrdinal = ownDataValue(input, "moduleOrdinal");
  const edgeOrdinal = ownDataValue(input, "edgeOrdinal");
  const pageOrdinal = ownDataValue(input, "pageOrdinal");
  const previousReceiptSha256 = ownDataValue(
    input,
    "previousReceiptSha256",
  );
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

function ownDataValue(
  value: Readonly<Record<string, unknown>>,
  key: string,
): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return undefined;
  }
  return descriptor !== undefined &&
      descriptor.enumerable &&
      "value" in descriptor
    ? descriptor.value
    : undefined;
}

function hasExactOwnDataKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
    return keys.length === expected.length &&
      keys.every((key) => {
        if (typeof key !== "string" || !expected.includes(key)) return false;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor !== undefined &&
          descriptor.enumerable &&
          "value" in descriptor;
      });
  } catch {
    return false;
  }
}

function isU64(value: unknown): value is bigint {
  return typeof value === "bigint" &&
    value >= 0n &&
    value <= DECLARATIVE_V2_MAX_SIGNED_INT64_V1;
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

export type DeclarativeV2VerifierCommandKindV2 =
  DeclarativeV2CommandKindV1;
