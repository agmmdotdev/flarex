import {
  bytesEqualFullScan,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Result } from "effect";

import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  type DeclarativeV2VerifierBudgetDimensionV2,
  type DeclarativeV2VerifierDurableCommandKindV2,
} from "./declarative-v2-verifier-progress-v2";

export const DECLARATIVE_V2_TERMINAL_AUTHORITY_PROOF_IDENTITY_V1 =
  "flarex.declarative-v2/terminal_authority_proof/v1\0" as const;
export const DECLARATIVE_V2_TERMINAL_AUTHORITY_PROOF_VERSION_V1 = 1 as const;

const DIGEST_BYTES = 32;
const MAX_U64 = 0xffff_ffff_ffff_ffffn;
const DOMAIN_BYTES = new TextEncoder().encode(
  DECLARATIVE_V2_TERMINAL_AUTHORITY_PROOF_IDENTITY_V1,
);
const COMMAND_KIND_ID = Object.freeze({
  source_page: 1,
  parse_module: 2,
  link_page: 3,
  registration_page: 4,
} satisfies Record<DeclarativeV2VerifierDurableCommandKindV2, number>);
const COMMAND_KIND_BY_ID = new Map(
  Object.entries(COMMAND_KIND_ID).map(([kind, id]) => [
    id,
    // SAFETY: kind is a key of COMMAND_KIND_ID, whose keys are exactly the
    // durable command kind union.
    kind as DeclarativeV2VerifierDurableCommandKindV2,
  ]),
);
const AUTHORITY_KIND_ID = Object.freeze({
  exact_requirement: 1,
  capacity: 2,
} as const);
const FIXED_DIGEST_FIELD_COUNT = 17;
const BYTE_LENGTH =
  DOMAIN_BYTES.byteLength + 4 + 1 + 1 + 8 +
  DIGEST_BYTES * FIXED_DIGEST_FIELD_COUNT + 2 +
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.length * 8 * 2;

export type DeclarativeV2TerminalAuthorityVectorV1 = Readonly<
  Record<DeclarativeV2VerifierBudgetDimensionV2, bigint>
>;

export interface DeclarativeV2TerminalAuthorityProofV1 {
  readonly authorityKind: "exact_requirement" | "capacity";
  readonly commandKind: DeclarativeV2VerifierDurableCommandKindV2;
  readonly sequence: bigint;
  readonly attemptSha256: Uint8Array;
  readonly candidateSha256: Uint8Array;
  readonly reservationSha256: Uint8Array;
  readonly requestSha256: Uint8Array;
  readonly futureRegistrationIntentSha256: Uint8Array | null;
  readonly commandBudgetSha256: Uint8Array;
  readonly commandInputSha256: Uint8Array;
  readonly freshAuthenticatedInputSha256: Uint8Array;
  readonly rangeAndPredecessorTailsSha256: Uint8Array;
  readonly analyzerReleaseSha256: Uint8Array;
  readonly analyzerIdentitySha256: Uint8Array;
  readonly verifierIdentitySha256: Uint8Array;
  readonly currentProgressSha256: Uint8Array;
  readonly nextProgressSha256: Uint8Array;
  readonly outputManifestSha256: Uint8Array;
  readonly receiptSha256: Uint8Array;
  readonly predecessorReceiptSha256: Uint8Array | null;
  readonly authority: DeclarativeV2TerminalAuthorityVectorV1;
  readonly actual: DeclarativeV2TerminalAuthorityVectorV1;
}

export interface DeclarativeV2TerminalAuthorityProofEncodedV1 {
  readonly proof: DeclarativeV2TerminalAuthorityProofV1;
  readonly canonicalBytes: Uint8Array;
}

export class DeclarativeV2TerminalAuthorityProofV1Error
  extends Data.TaggedError("DeclarativeV2TerminalAuthorityProofV1Error")<{
    readonly operation: "encode" | "decode";
    readonly reason: "invalidInput" | "malformed" | "nonCanonical";
    readonly path?: string;
  }> {}

const DIGEST_FIELDS = [
  "attemptSha256",
  "candidateSha256",
  "reservationSha256",
  "requestSha256",
  "commandBudgetSha256",
  "commandInputSha256",
  "freshAuthenticatedInputSha256",
  "rangeAndPredecessorTailsSha256",
  "analyzerReleaseSha256",
  "analyzerIdentitySha256",
  "verifierIdentitySha256",
  "currentProgressSha256",
  "nextProgressSha256",
  "outputManifestSha256",
  "receiptSha256",
] as const;

const PROOF_FIELDS = [
  "authorityKind",
  "commandKind",
  "sequence",
  ...DIGEST_FIELDS,
  "futureRegistrationIntentSha256",
  "predecessorReceiptSha256",
  "authority",
  "actual",
] as const;

export function encodeDeclarativeV2TerminalAuthorityProofV1(
  input: unknown,
): Result.Result<
  DeclarativeV2TerminalAuthorityProofEncodedV1,
  DeclarativeV2TerminalAuthorityProofV1Error
> {
  return captureProof(input, "encode").pipe(
    Result.map(proof => {
      const bytes = new Uint8Array(BYTE_LENGTH);
      let offset = 0;
      bytes.set(DOMAIN_BYTES, offset);
      offset += DOMAIN_BYTES.byteLength;
      writeU32(bytes, offset, PROOF_FIELDS.length);
      offset += 4;
      bytes[offset++] = AUTHORITY_KIND_ID[proof.authorityKind];
      bytes[offset++] = COMMAND_KIND_ID[proof.commandKind];
      offset = writeU64(bytes, offset, proof.sequence);
      for (const field of DIGEST_FIELDS) {
        offset = writeDigest(bytes, offset, proof[field]);
      }
      offset = writeOptionalDigest(
        bytes,
        offset,
        proof.futureRegistrationIntentSha256,
      );
      offset = writeOptionalDigest(
        bytes,
        offset,
        proof.predecessorReceiptSha256,
      );
      offset = writeVector(bytes, offset, proof.authority);
      writeVector(bytes, offset, proof.actual);
      return Object.freeze({
        proof: copyProof(proof),
        canonicalBytes: bytes,
      });
    }),
  );
}

export function decodeDeclarativeV2TerminalAuthorityProofV1(
  input: unknown,
): Result.Result<
  DeclarativeV2TerminalAuthorityProofEncodedV1,
  DeclarativeV2TerminalAuthorityProofV1Error
> {
  if (
    !isUint8ArrayWithByteLength(input, BYTE_LENGTH) ||
    !bytesEqualFullScan(input.subarray(0, DOMAIN_BYTES.byteLength), DOMAIN_BYTES)
  ) {
    return Result.fail(error("decode", "malformed", "canonicalBytes"));
  }
  let offset = DOMAIN_BYTES.byteLength;
  if (readU32(input, offset) !== PROOF_FIELDS.length) {
    return Result.fail(error("decode", "malformed", "fieldCount"));
  }
  offset += 4;
  const authorityKind = input[offset++] === 1
    ? "exact_requirement"
    : input[offset - 1] === 2
    ? "capacity"
    : undefined;
  const commandKind = COMMAND_KIND_BY_ID.get(input[offset++]!);
  const sequence = readU64(input, offset);
  offset += 8;
  const digests: Record<string, Uint8Array> = {};
  for (const field of DIGEST_FIELDS) {
    digests[field] = readDigest(input, offset);
    offset += DIGEST_BYTES;
  }
  const intent = readOptionalDigest(input, offset);
  if (intent === undefined) {
    return Result.fail(error("decode", "malformed", "futureRegistrationIntentSha256"));
  }
  offset += 1 + DIGEST_BYTES;
  const predecessor = readOptionalDigest(input, offset);
  if (predecessor === undefined) {
    return Result.fail(error("decode", "malformed", "predecessorReceiptSha256"));
  }
  offset += 1 + DIGEST_BYTES;
  const authority = readVector(input, offset);
  offset += DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.length * 8;
  const actual = readVector(input, offset);
  if (authorityKind === undefined || commandKind === undefined) {
    return Result.fail(error("decode", "malformed", "kind"));
  }
  return Result.gen(function* () {
    const captured = yield* captureProof({
      authorityKind,
      commandKind,
      sequence,
      ...digests,
      futureRegistrationIntentSha256: intent,
      predecessorReceiptSha256: predecessor,
      authority,
      actual,
    }, "decode");
    const encoded = yield* encodeDeclarativeV2TerminalAuthorityProofV1(
      captured,
    );
    if (!bytesEqualFullScan(encoded.canonicalBytes, input)) {
      return yield* Result.fail(
        error("decode", "nonCanonical", "canonicalBytes"),
      );
    }
    return Object.freeze({
      proof: copyProof(captured),
      canonicalBytes: new Uint8Array(input),
    });
  });
}

function captureProof(
  input: unknown,
  operation: "encode" | "decode",
): Result.Result<
  DeclarativeV2TerminalAuthorityProofV1,
  DeclarativeV2TerminalAuthorityProofV1Error
> {
  const snapshot = snapshotOwnDataProperties(input, PROOF_FIELDS);
  if (snapshot === undefined) {
    return Result.fail(error(operation, "invalidInput", "proof"));
  }
  if (
    snapshot.authorityKind !== "exact_requirement" &&
    snapshot.authorityKind !== "capacity"
  ) {
    return Result.fail(error(operation, "invalidInput", "authorityKind"));
  }
  // SAFETY: snapshot.commandKind is a plain unknown value; the cast only
  // narrows it to a PropertyKey for the ownership check below.
  if (!Object.hasOwn(COMMAND_KIND_ID, snapshot.commandKind as PropertyKey)) {
    return Result.fail(error(operation, "invalidInput", "commandKind"));
  }
  if (
    typeof snapshot.sequence !== "bigint" ||
    snapshot.sequence < 1n ||
    snapshot.sequence > MAX_U64
  ) {
    return Result.fail(error(operation, "invalidInput", "sequence"));
  }
  for (const field of DIGEST_FIELDS) {
    if (!isUint8ArrayWithByteLength(snapshot[field], DIGEST_BYTES)) {
      return Result.fail(error(operation, "invalidInput", field));
    }
  }
  for (const field of [
    "futureRegistrationIntentSha256",
    "predecessorReceiptSha256",
  ] as const) {
    if (
      snapshot[field] !== null &&
      !isUint8ArrayWithByteLength(snapshot[field], DIGEST_BYTES)
    ) {
      return Result.fail(error(operation, "invalidInput", field));
    }
  }
  const authority = captureVector(snapshot.authority);
  const actual = captureVector(snapshot.actual);
  if (authority === undefined || actual === undefined) {
    return Result.fail(error(operation, "invalidInput", "usage"));
  }
  // SAFETY: the Object.hasOwn check above proved commandKind is a key of
  // COMMAND_KIND_ID, whose keys are the durable command kind union.
  const commandKind =
    snapshot.commandKind as DeclarativeV2VerifierDurableCommandKindV2;
  const expectsIntent =
    commandKind === "link_page" || commandKind === "registration_page";
  if (expectsIntent !== (snapshot.futureRegistrationIntentSha256 !== null)) {
    return Result.fail(
      error(operation, "invalidInput", "futureRegistrationIntentSha256"),
    );
  }
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    if (actual[dimension] > authority[dimension]) {
      return Result.fail(error(operation, "invalidInput", `actual.${dimension}`));
    }
  }
  // SAFETY: every field was validated above against the proof contract, so
  // the assembled object satisfies the terminal authority proof brand.
  return Result.succeed(copyProof({
    authorityKind: snapshot.authorityKind,
    commandKind,
    sequence: snapshot.sequence,
    ...Object.fromEntries(
      DIGEST_FIELDS.map(field => [field, snapshot[field]]),
    ),
    futureRegistrationIntentSha256:
      snapshot.futureRegistrationIntentSha256 as Uint8Array | null,
    predecessorReceiptSha256:
      snapshot.predecessorReceiptSha256 as Uint8Array | null,
    authority,
    actual,
  } as DeclarativeV2TerminalAuthorityProofV1));
}

function captureVector(
  value: unknown,
): DeclarativeV2TerminalAuthorityVectorV1 | undefined {
  const snapshot = snapshotOwnDataProperties(
    value,
    DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  );
  if (snapshot === undefined) return undefined;
  const output: Partial<Record<DeclarativeV2VerifierBudgetDimensionV2, bigint>> =
    {};
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    const amount = snapshot[dimension];
    if (typeof amount !== "bigint" || amount < 0n || amount > MAX_U64) {
      return undefined;
    }
    output[dimension] = amount;
  }
  // SAFETY: every budget dimension was validated as a u64 above, so the
  // record satisfies the terminal authority vector brand.
  return Object.freeze(output) as DeclarativeV2TerminalAuthorityVectorV1;
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

function copyProof(
  proof: DeclarativeV2TerminalAuthorityProofV1,
): DeclarativeV2TerminalAuthorityProofV1 {
  // SAFETY: the spread fields below reproduce the validated proof shape
  // exactly, so the copy satisfies the proof brand.
  return Object.freeze({
    authorityKind: proof.authorityKind,
    commandKind: proof.commandKind,
    sequence: proof.sequence,
    ...Object.fromEntries(
      DIGEST_FIELDS.map(field => [field, new Uint8Array(proof[field])]),
    ),
    futureRegistrationIntentSha256:
      proof.futureRegistrationIntentSha256 === null
        ? null
        : new Uint8Array(proof.futureRegistrationIntentSha256),
    predecessorReceiptSha256: proof.predecessorReceiptSha256 === null
      ? null
      : new Uint8Array(proof.predecessorReceiptSha256),
    authority: Object.freeze({ ...proof.authority }),
    actual: Object.freeze({ ...proof.actual }),
  }) as DeclarativeV2TerminalAuthorityProofV1;
}

function writeVector(
  bytes: Uint8Array,
  offset: number,
  vector: DeclarativeV2TerminalAuthorityVectorV1,
): number {
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    offset = writeU64(bytes, offset, vector[dimension]);
  }
  return offset;
}

function readVector(
  bytes: Uint8Array,
  offset: number,
): DeclarativeV2TerminalAuthorityVectorV1 {
  const output: Partial<Record<DeclarativeV2VerifierBudgetDimensionV2, bigint>> =
    {};
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    output[dimension] = readU64(bytes, offset);
    offset += 8;
  }
  // SAFETY: every budget dimension was read as a u64 above, so the record
  // satisfies the terminal authority vector brand.
  return Object.freeze(output) as DeclarativeV2TerminalAuthorityVectorV1;
}

function writeOptionalDigest(
  bytes: Uint8Array,
  offset: number,
  digest: Uint8Array | null,
): number {
  bytes[offset++] = digest === null ? 0 : 1;
  if (digest !== null) bytes.set(digest, offset);
  return offset + DIGEST_BYTES;
}

function readOptionalDigest(
  bytes: Uint8Array,
  offset: number,
): Uint8Array | null | undefined {
  const tag = bytes[offset];
  if (tag !== 0 && tag !== 1) return undefined;
  const digest = readDigest(bytes, offset + 1);
  if (tag === 0 && digest.some(byte => byte !== 0)) return undefined;
  return tag === 0 ? null : digest;
}

function writeDigest(
  bytes: Uint8Array,
  offset: number,
  digest: Uint8Array,
): number {
  bytes.set(digest, offset);
  return offset + DIGEST_BYTES;
}

function readDigest(bytes: Uint8Array, offset: number): Uint8Array {
  return new Uint8Array(bytes.subarray(offset, offset + DIGEST_BYTES));
}

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! * 0x1_00_00_00 +
    bytes[offset + 1]! * 0x1_00_00 +
    bytes[offset + 2]! * 0x1_00 +
    bytes[offset + 3]!;
}

function writeU64(bytes: Uint8Array, offset: number, value: bigint): number {
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

function error(
  operation: "encode" | "decode",
  reason: DeclarativeV2TerminalAuthorityProofV1Error["reason"],
  path?: string,
): DeclarativeV2TerminalAuthorityProofV1Error {
  return new DeclarativeV2TerminalAuthorityProofV1Error({
    operation,
    reason,
    ...(path === undefined ? {} : { path }),
  });
}
