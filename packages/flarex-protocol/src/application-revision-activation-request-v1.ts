import {
  bytesEqualFullScan,
  copyBytes,
  isUint8Array,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonBlankString } from "@flarex/utils/strings";
import { Data, Result } from "effect";

export const APPLICATION_REVISION_ACTIVATION_REQUEST_IDENTITY_V1 =
  "flarex.system/application-revision-activation-request/v1" as const;
export const MAX_APPLICATION_REVISION_ACTIVATION_REVISION_V1 =
  (1n << 63n) - 1n;

const DOMAIN = new TextEncoder().encode(
  `${APPLICATION_REVISION_ACTIVATION_REQUEST_IDENTITY_V1}\0`,
);
const UTF8 = new TextEncoder();
const FATAL_UTF8 = new TextDecoder("utf-8", { fatal: true });
const DIGEST_BYTES = 32;
const MAX_TEXT_BYTES = 1_024;
const MAX_CANONICAL_BYTES = 4_096;
const ACTION_ACTIVATE = 1;
const EXPECTED_HEAD_NULL = 0;
const EXPECTED_HEAD_ACTIVE = 1;

export interface ApplicationRevisionExpectedActiveV1 {
  readonly activationRevision: bigint;
  readonly activationHeadSha256: Uint8Array;
}

export interface ApplicationRevisionActivationRequestFrameV1 {
  readonly action: "activate";
  readonly scopeId: string;
  readonly revisionId: string;
  readonly candidateSha256: Uint8Array;
  readonly readinessReceiptSha256: Uint8Array;
  readonly expectedActiveRevision: ApplicationRevisionExpectedActiveV1 | null;
}

export interface ApplicationRevisionActivationRequestEncodedV1 {
  readonly frame: ApplicationRevisionActivationRequestFrameV1;
  readonly canonicalBytes: Uint8Array;
}

export class ApplicationRevisionActivationRequestV1Error
  extends Data.TaggedError("ApplicationRevisionActivationRequestV1Error")<{
    readonly operation: "encode" | "decode";
    readonly reason:
      | "invalidInput"
      | "boundsExceeded"
      | "malformed"
      | "nonCanonical";
    readonly path: string;
  }> {}

const FRAME_FIELDS = [
  "action",
  "scopeId",
  "revisionId",
  "candidateSha256",
  "readinessReceiptSha256",
  "expectedActiveRevision",
] as const;
const EXPECTED_FIELDS = [
  "activationRevision",
  "activationHeadSha256",
] as const;

export function encodeApplicationRevisionActivationRequestV1(
  input: unknown,
): Result.Result<
  ApplicationRevisionActivationRequestEncodedV1,
  ApplicationRevisionActivationRequestV1Error
> {
  return captureFrame(input, "encode").pipe(Result.flatMap((frame) => {
    const scopeBytes = UTF8.encode(frame.scopeId);
    const revisionBytes = UTF8.encode(frame.revisionId);
    const expectedBytes = frame.expectedActiveRevision === null
      ? 1
      : 1 + 8 + DIGEST_BYTES;
    const byteLength = DOMAIN.byteLength + 1 +
      4 + scopeBytes.byteLength +
      4 + revisionBytes.byteLength +
      DIGEST_BYTES + DIGEST_BYTES + expectedBytes;
    if (byteLength > MAX_CANONICAL_BYTES) {
      return Result.fail(error("encode", "boundsExceeded", "$bytes"));
    }
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    bytes.set(DOMAIN, offset);
    offset += DOMAIN.byteLength;
    bytes[offset++] = ACTION_ACTIVATE;
    offset = writeLengthAndBytes(bytes, offset, scopeBytes);
    offset = writeLengthAndBytes(bytes, offset, revisionBytes);
    bytes.set(frame.candidateSha256, offset);
    offset += DIGEST_BYTES;
    bytes.set(frame.readinessReceiptSha256, offset);
    offset += DIGEST_BYTES;
    if (frame.expectedActiveRevision === null) {
      bytes[offset] = EXPECTED_HEAD_NULL;
    } else {
      bytes[offset++] = EXPECTED_HEAD_ACTIVE;
      new DataView(bytes.buffer).setBigUint64(
        offset,
        frame.expectedActiveRevision.activationRevision,
        false,
      );
      offset += 8;
      bytes.set(frame.expectedActiveRevision.activationHeadSha256, offset);
    }
    return Result.succeed(Object.freeze({
      frame: copyFrame(frame),
      canonicalBytes: bytes,
    }));
  }));
}

export function decodeApplicationRevisionActivationRequestV1(
  input: unknown,
): Result.Result<
  ApplicationRevisionActivationRequestEncodedV1,
  ApplicationRevisionActivationRequestV1Error
> {
  if (!isUint8Array(input)) {
    return Result.fail(error("decode", "invalidInput", "$bytes"));
  }
  if (input.byteLength > MAX_CANONICAL_BYTES) {
    return Result.fail(error("decode", "boundsExceeded", "$bytes"));
  }
  if (
    input.byteLength < DOMAIN.byteLength + 1 + 4 + 1 + 4 + 1 + 64 + 1 ||
    !bytesEqualFullScan(input.subarray(0, DOMAIN.byteLength), DOMAIN)
  ) {
    return Result.fail(error("decode", "malformed", "$domain"));
  }
  return Result.gen(function* () {
    let offset = DOMAIN.byteLength;
    if (input[offset++] !== ACTION_ACTIVATE) {
      return yield* Result.fail(error("decode", "malformed", "action"));
    }
    const scope = yield* readText(input, offset, "scopeId");
    offset = scope.offset;
    const revision = yield* readText(input, offset, "revisionId");
    offset = revision.offset;
    if (offset + DIGEST_BYTES * 2 + 1 > input.byteLength) {
      return yield* Result.fail(error("decode", "malformed", "$bytes"));
    }
    const candidateSha256 = copyBytes(
      input.subarray(offset, offset + DIGEST_BYTES),
    );
    offset += DIGEST_BYTES;
    const readinessReceiptSha256 = copyBytes(
      input.subarray(offset, offset + DIGEST_BYTES),
    );
    offset += DIGEST_BYTES;
    const tag = input[offset++];
    let expectedActiveRevision: ApplicationRevisionExpectedActiveV1 | null;
    if (tag === EXPECTED_HEAD_NULL) {
      expectedActiveRevision = null;
    } else if (
      tag === EXPECTED_HEAD_ACTIVE &&
      offset + 8 + DIGEST_BYTES === input.byteLength
    ) {
      const activationRevision = new DataView(
        input.buffer,
        input.byteOffset,
        input.byteLength,
      ).getBigUint64(offset, false);
      offset += 8;
      expectedActiveRevision = Object.freeze({
        activationRevision,
        activationHeadSha256: copyBytes(
          input.subarray(offset, offset + DIGEST_BYTES),
        ),
      });
      offset += DIGEST_BYTES;
    } else {
      return yield* Result.fail(
        error("decode", "malformed", "expectedActiveRevision"),
      );
    }
    if (offset !== input.byteLength) {
      return yield* Result.fail(error("decode", "malformed", "$trailing"));
    }
    const frame = yield* captureFrame({
      action: "activate",
      scopeId: scope.value,
      revisionId: revision.value,
      candidateSha256,
      readinessReceiptSha256,
      expectedActiveRevision,
    }, "decode");
    const encoded = yield* encodeApplicationRevisionActivationRequestV1(frame);
    if (!bytesEqualFullScan(encoded.canonicalBytes, input)) {
      return yield* Result.fail(error("decode", "nonCanonical", "$bytes"));
    }
    return encoded;
  });
}

function captureFrame(
  input: unknown,
  operation: "encode" | "decode",
): Result.Result<
  ApplicationRevisionActivationRequestFrameV1,
  ApplicationRevisionActivationRequestV1Error
> {
  return Result.gen(function* () {
    const frame = yield* snapshotOwnDataProperties(
      input,
      FRAME_FIELDS,
      operation,
      "$",
    );
    if (frame.action !== "activate") {
      return yield* Result.fail(error(operation, "invalidInput", "action"));
    }
    if (!isBoundedText(frame.scopeId)) {
      return yield* Result.fail(error(operation, "invalidInput", "scopeId"));
    }
    if (!isBoundedText(frame.revisionId)) {
      return yield* Result.fail(error(operation, "invalidInput", "revisionId"));
    }
    if (!isUint8ArrayWithByteLength(frame.candidateSha256, DIGEST_BYTES)) {
      return yield* Result.fail(
        error(operation, "invalidInput", "candidateSha256"),
      );
    }
    if (!isUint8ArrayWithByteLength(
      frame.readinessReceiptSha256,
      DIGEST_BYTES,
    )) {
      return yield* Result.fail(
        error(operation, "invalidInput", "readinessReceiptSha256"),
      );
    }
    let expectedActiveRevision: ApplicationRevisionExpectedActiveV1 | null;
    if (frame.expectedActiveRevision === null) {
      expectedActiveRevision = null;
    } else {
      const expected = yield* snapshotOwnDataProperties(
        frame.expectedActiveRevision,
        EXPECTED_FIELDS,
        operation,
        "expectedActiveRevision",
      );
      if (
        typeof expected.activationRevision !== "bigint" ||
        expected.activationRevision < 1n ||
        expected.activationRevision >
          MAX_APPLICATION_REVISION_ACTIVATION_REVISION_V1
      ) {
        return yield* Result.fail(error(
          operation,
          "invalidInput",
          "expectedActiveRevision.activationRevision",
        ));
      }
      if (!isUint8ArrayWithByteLength(
        expected.activationHeadSha256,
        DIGEST_BYTES,
      )) {
        return yield* Result.fail(error(
          operation,
          "invalidInput",
          "expectedActiveRevision.activationHeadSha256",
        ));
      }
      expectedActiveRevision = Object.freeze({
        activationRevision: expected.activationRevision,
        activationHeadSha256: copyBytes(expected.activationHeadSha256),
      });
    }
    return Object.freeze({
      action: "activate" as const,
      scopeId: frame.scopeId,
      revisionId: frame.revisionId,
      candidateSha256: copyBytes(frame.candidateSha256),
      readinessReceiptSha256: copyBytes(frame.readinessReceiptSha256),
      expectedActiveRevision,
    });
  });
}

function copyFrame(
  frame: ApplicationRevisionActivationRequestFrameV1,
): ApplicationRevisionActivationRequestFrameV1 {
  return Object.freeze({
    action: "activate",
    scopeId: frame.scopeId,
    revisionId: frame.revisionId,
    candidateSha256: copyBytes(frame.candidateSha256),
    readinessReceiptSha256: copyBytes(frame.readinessReceiptSha256),
    expectedActiveRevision: frame.expectedActiveRevision === null
      ? null
      : Object.freeze({
          activationRevision: frame.expectedActiveRevision.activationRevision,
          activationHeadSha256: copyBytes(
            frame.expectedActiveRevision.activationHeadSha256,
          ),
        }),
  });
}

function snapshotOwnDataProperties<Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
  operation: "encode" | "decode",
  path: string,
): Result.Result<
  Readonly<Record<Keys[number], unknown>>,
  ApplicationRevisionActivationRequestV1Error
> {
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return Result.fail(error(operation, "invalidInput", path));
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
  ) {
    return Result.fail(error(operation, "invalidInput", path));
  }
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined || !("value" in descriptor) ||
      !descriptor.enumerable
    ) {
      return Result.fail(error(operation, "invalidInput", `${path}.${key}`));
    }
    result[key] = descriptor.value;
  }
  return Result.succeed(result as Readonly<Record<Keys[number], unknown>>);
}

function isBoundedText(value: unknown): value is string {
  return typeof value === "string" && isNonBlankString(value) &&
    !value.includes("\0") && UTF8.encode(value).byteLength <= MAX_TEXT_BYTES;
}

function writeLengthAndBytes(
  output: Uint8Array,
  offset: number,
  value: Uint8Array,
): number {
  new DataView(output.buffer).setUint32(offset, value.byteLength, false);
  output.set(value, offset + 4);
  return offset + 4 + value.byteLength;
}

function readText(
  source: Uint8Array,
  offset: number,
  path: string,
): Result.Result<
  Readonly<{ readonly value: string; readonly offset: number }>,
  ApplicationRevisionActivationRequestV1Error
> {
  if (offset + 4 > source.byteLength) {
    return Result.fail(error("decode", "malformed", path));
  }
  const length = new DataView(
    source.buffer,
    source.byteOffset,
    source.byteLength,
  ).getUint32(offset, false);
  const start = offset + 4;
  const end = start + length;
  if (length > MAX_TEXT_BYTES || end > source.byteLength) {
    return Result.fail(error("decode", "boundsExceeded", path));
  }
  let value: string;
  try {
    value = FATAL_UTF8.decode(source.subarray(start, end));
  } catch {
    return Result.fail(error("decode", "malformed", path));
  }
  return Result.succeed(Object.freeze({ value, offset: end }));
}

function error(
  operation: "encode" | "decode",
  reason: ApplicationRevisionActivationRequestV1Error["reason"],
  path: string,
): ApplicationRevisionActivationRequestV1Error {
  return new ApplicationRevisionActivationRequestV1Error({
    operation,
    reason,
    path,
  });
}
