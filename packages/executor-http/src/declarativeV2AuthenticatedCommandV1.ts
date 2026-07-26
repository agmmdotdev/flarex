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
const REQUEST_PREFIX_BYTES = 4 + DOMAIN_BYTES.byteLength + 4 + 4;
const FRAME_LENGTH_PREFIX_BYTES = 4;

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
