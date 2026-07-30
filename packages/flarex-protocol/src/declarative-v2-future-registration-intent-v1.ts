import {
  bytesEqualFullScan,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Result } from "effect";

export const DECLARATIVE_V2_FUTURE_REGISTRATION_INTENT_IDENTITY_V1 =
  "flarex.declarative-v2/future_registration_intent/v1\0" as const;
export const DECLARATIVE_V2_FUTURE_REGISTRATION_INTENT_VERSION_V1 = 1 as const;

const DIGEST_BYTES = 32;
const FIELD_COUNT = 13;
const MAX_U64 = 0xffff_ffff_ffff_ffffn;
const DOMAIN_BYTES = new TextEncoder().encode(
  DECLARATIVE_V2_FUTURE_REGISTRATION_INTENT_IDENTITY_V1,
);
const CANONICAL_BYTE_LENGTH =
  DOMAIN_BYTES.byteLength +
  4 +
  DIGEST_BYTES * 11 +
  8 * 2;

const FIELD_NAMES = [
  "attemptSha256",
  "candidateSha256",
  "linkReservationSha256",
  "linkSequence",
  "registrationSequence",
  "registrationCurrentProgressSha256",
  "registrationCommandBudgetSha256",
  "registrationCommandInputSha256",
  "freshAuthenticatedInputSha256",
  "parsePagesRootSha256",
  "analyzerReleaseSha256",
  "analyzerIdentitySha256",
  "verifierIdentitySha256",
] as const;

type DigestField = Exclude<
  typeof FIELD_NAMES[number],
  "linkSequence" | "registrationSequence"
>;

export interface DeclarativeV2FutureRegistrationIntentV1 {
  readonly attemptSha256: Uint8Array;
  readonly candidateSha256: Uint8Array;
  readonly linkReservationSha256: Uint8Array;
  readonly linkSequence: bigint;
  readonly registrationSequence: bigint;
  readonly registrationCurrentProgressSha256: Uint8Array;
  readonly registrationCommandBudgetSha256: Uint8Array;
  readonly registrationCommandInputSha256: Uint8Array;
  readonly freshAuthenticatedInputSha256: Uint8Array;
  readonly parsePagesRootSha256: Uint8Array;
  readonly analyzerReleaseSha256: Uint8Array;
  readonly analyzerIdentitySha256: Uint8Array;
  readonly verifierIdentitySha256: Uint8Array;
}

export interface DeclarativeV2FutureRegistrationIntentEncodedV1 {
  readonly intent: DeclarativeV2FutureRegistrationIntentV1;
  readonly canonicalBytes: Uint8Array;
}

export class DeclarativeV2FutureRegistrationIntentV1Error
  extends Data.TaggedError("DeclarativeV2FutureRegistrationIntentV1Error")<{
    readonly operation: "encode" | "decode";
    readonly reason:
      | "invalidInput"
      | "unsupportedVersion"
      | "malformed"
      | "nonCanonical";
    readonly path?: string;
  }> {}

export function encodeDeclarativeV2FutureRegistrationIntentV1(
  input: unknown,
): Result.Result<
  DeclarativeV2FutureRegistrationIntentEncodedV1,
  DeclarativeV2FutureRegistrationIntentV1Error
> {
  return captureIntent(input, "encode").pipe(
    Result.map(intent => {
      const bytes = new Uint8Array(CANONICAL_BYTE_LENGTH);
      let offset = 0;
      bytes.set(DOMAIN_BYTES, offset);
      offset += DOMAIN_BYTES.byteLength;
      writeU32(bytes, offset, FIELD_COUNT);
      offset += 4;
      offset = writeDigest(bytes, offset, intent.attemptSha256);
      offset = writeDigest(bytes, offset, intent.candidateSha256);
      offset = writeDigest(bytes, offset, intent.linkReservationSha256);
      offset = writeU64(bytes, offset, intent.linkSequence);
      offset = writeU64(bytes, offset, intent.registrationSequence);
      offset = writeDigest(
        bytes,
        offset,
        intent.registrationCurrentProgressSha256,
      );
      offset = writeDigest(
        bytes,
        offset,
        intent.registrationCommandBudgetSha256,
      );
      offset = writeDigest(
        bytes,
        offset,
        intent.registrationCommandInputSha256,
      );
      offset = writeDigest(
        bytes,
        offset,
        intent.freshAuthenticatedInputSha256,
      );
      offset = writeDigest(bytes, offset, intent.parsePagesRootSha256);
      offset = writeDigest(bytes, offset, intent.analyzerReleaseSha256);
      offset = writeDigest(bytes, offset, intent.analyzerIdentitySha256);
      writeDigest(bytes, offset, intent.verifierIdentitySha256);
      return Object.freeze({
        intent: copyIntent(intent),
        canonicalBytes: bytes,
      });
    }),
  );
}

export function decodeDeclarativeV2FutureRegistrationIntentV1(
  input: unknown,
): Result.Result<
  DeclarativeV2FutureRegistrationIntentEncodedV1,
  DeclarativeV2FutureRegistrationIntentV1Error
> {
  if (
    !isUint8ArrayWithByteLength(input, CANONICAL_BYTE_LENGTH) ||
    !bytesEqualFullScan(input.subarray(0, DOMAIN_BYTES.byteLength), DOMAIN_BYTES)
  ) {
    return Result.fail(intentError("decode", "malformed", "canonicalBytes"));
  }
  let offset = DOMAIN_BYTES.byteLength;
  if (readU32(input, offset) !== FIELD_COUNT) {
    return Result.fail(intentError("decode", "unsupportedVersion", "fieldCount"));
  }
  offset += 4;
  const attemptSha256 = readDigest(input, offset);
  offset += DIGEST_BYTES;
  const candidateSha256 = readDigest(input, offset);
  offset += DIGEST_BYTES;
  const linkReservationSha256 = readDigest(input, offset);
  offset += DIGEST_BYTES;
  const linkSequence = readU64(input, offset);
  offset += 8;
  const registrationSequence = readU64(input, offset);
  offset += 8;
  const registrationCurrentProgressSha256 = readDigest(input, offset);
  offset += DIGEST_BYTES;
  const registrationCommandBudgetSha256 = readDigest(input, offset);
  offset += DIGEST_BYTES;
  const registrationCommandInputSha256 = readDigest(input, offset);
  offset += DIGEST_BYTES;
  const freshAuthenticatedInputSha256 = readDigest(input, offset);
  offset += DIGEST_BYTES;
  const parsePagesRootSha256 = readDigest(input, offset);
  offset += DIGEST_BYTES;
  const analyzerReleaseSha256 = readDigest(input, offset);
  offset += DIGEST_BYTES;
  const analyzerIdentitySha256 = readDigest(input, offset);
  offset += DIGEST_BYTES;
  const verifierIdentitySha256 = readDigest(input, offset);
  return Result.gen(function* () {
    const captured = yield* captureIntent({
      attemptSha256,
      candidateSha256,
      linkReservationSha256,
      linkSequence,
      registrationSequence,
      registrationCurrentProgressSha256,
      registrationCommandBudgetSha256,
      registrationCommandInputSha256,
      freshAuthenticatedInputSha256,
      parsePagesRootSha256,
      analyzerReleaseSha256,
      analyzerIdentitySha256,
      verifierIdentitySha256,
    }, "decode");
    const encoded = yield* encodeDeclarativeV2FutureRegistrationIntentV1(
      captured,
    );
    if (!bytesEqualFullScan(encoded.canonicalBytes, input)) {
      return yield* Result.fail(
        intentError("decode", "nonCanonical", "canonicalBytes"),
      );
    }
    return Object.freeze({
      intent: copyIntent(captured),
      canonicalBytes: new Uint8Array(input),
    });
  });
}

function captureIntent(
  input: unknown,
  operation: "encode" | "decode",
): Result.Result<
  DeclarativeV2FutureRegistrationIntentV1,
  DeclarativeV2FutureRegistrationIntentV1Error
> {
  const snapshot = snapshotOwnDataProperties(input, FIELD_NAMES);
  if (snapshot === undefined) {
    return Result.fail(intentError(operation, "invalidInput", "intent"));
  }
  for (const field of FIELD_NAMES) {
    const value = snapshot[field];
    if (field === "linkSequence" || field === "registrationSequence") {
      if (
        typeof value !== "bigint" ||
        value < 1n ||
        value > MAX_U64
      ) {
        return Result.fail(intentError(operation, "invalidInput", field));
      }
      continue;
    }
    if (!isUint8ArrayWithByteLength(value, DIGEST_BYTES)) {
      return Result.fail(intentError(operation, "invalidInput", field));
    }
  }
  if (
    (snapshot.registrationSequence as bigint) !==
      (snapshot.linkSequence as bigint) + 1n
  ) {
    return Result.fail(
      intentError(operation, "invalidInput", "registrationSequence"),
    );
  }
  return Result.succeed(copyIntent(
    snapshot as unknown as DeclarativeV2FutureRegistrationIntentV1,
  ));
}

function snapshotOwnDataProperties(
  input: unknown,
  fields: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (!isNonArrayRecord(input) || Reflect.ownKeys(input).length !== fields.length) {
      return undefined;
    }
    const snapshot: Record<string, unknown> = {};
    for (const field of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(input, field);
      if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
        return undefined;
      }
      snapshot[field] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch {
    return undefined;
  }
}

function copyIntent(
  input: DeclarativeV2FutureRegistrationIntentV1,
): DeclarativeV2FutureRegistrationIntentV1 {
  const digests = Object.fromEntries(
    FIELD_NAMES
      .filter((field): field is DigestField =>
        field !== "linkSequence" && field !== "registrationSequence"
      )
      .map(field => [field, new Uint8Array(input[field])]),
  ) as Readonly<Record<DigestField, Uint8Array>>;
  return Object.freeze({
    ...digests,
    linkSequence: input.linkSequence,
    registrationSequence: input.registrationSequence,
  });
}

function intentError(
  operation: "encode" | "decode",
  reason: DeclarativeV2FutureRegistrationIntentV1Error["reason"],
  path?: string,
): DeclarativeV2FutureRegistrationIntentV1Error {
  return new DeclarativeV2FutureRegistrationIntentV1Error({
    operation,
    reason,
    ...(path === undefined ? {} : { path }),
  });
}

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x1_00_00_00 +
    bytes[offset + 1]! * 0x1_00_00 +
    bytes[offset + 2]! * 0x1_00 +
    bytes[offset + 3]!
  );
}

function writeU64(
  bytes: Uint8Array,
  offset: number,
  value: bigint,
): number {
  for (let index = 0; index < 8; index += 1) {
    bytes[offset + index] =
      Number((value >> BigInt((7 - index) * 8)) & 0xffn);
  }
  return offset + 8;
}

function readU64(bytes: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let index = 0; index < 8; index += 1) {
    value = (value << 8n) | BigInt(bytes[offset + index]!);
  }
  return value;
}

function writeDigest(
  bytes: Uint8Array,
  offset: number,
  value: Uint8Array,
): number {
  bytes.set(value, offset);
  return offset + DIGEST_BYTES;
}

function readDigest(bytes: Uint8Array, offset: number): Uint8Array {
  return new Uint8Array(bytes.subarray(offset, offset + DIGEST_BYTES));
}
