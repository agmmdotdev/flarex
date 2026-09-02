import {
  copyBytes,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { finiteDateMilliseconds } from "@flarex/utils/dates";
import { Encoding, Result } from "effect";

const MAX_POSTGRES_INT64 = 9_223_372_036_854_775_807n;
const SHA256_BYTE_LENGTH = 32;

export interface StoredCanonicalMetadataColumns {
  readonly frameFormat: unknown;
  readonly frameVersion: unknown;
  readonly canonicalByteLength: unknown;
  readonly observedCanonicalByteLength: unknown;
  readonly canonicalBytes: unknown;
}

export interface StoredCanonicalMetadataContract {
  readonly format: string;
  readonly version: number;
  readonly maximumCanonicalBytes: number;
}

export interface DecodedStoredCanonicalMetadata {
  readonly sha256Hex: string;
  readonly canonicalByteLength: number;
  readonly canonicalBytes: Uint8Array;
  readonly canonicalJson: string;
}

/**
 * Package-private driver-shape normalization shared by framework metadata
 * restorers. Domain modules retain their exact projections and error types.
 */
export function decodeStoredCanonicalMetadataResult<Error>(
  columns: StoredCanonicalMetadataColumns,
  sha256Bytes: unknown,
  contract: StoredCanonicalMetadataContract,
  storedCorruption: () => Error,
): Result.Result<DecodedStoredCanonicalMetadata, Error> {
  return Result.gen(function* () {
    const sha256Hex = yield* decodeStoredSha256HexResult(
      sha256Bytes,
      storedCorruption,
    );
    if (
      columns.frameFormat !== contract.format ||
      columns.frameVersion !== contract.version ||
      !isPositiveSafeIntegerAtMost(
        columns.canonicalByteLength,
        contract.maximumCanonicalBytes,
      ) ||
      columns.observedCanonicalByteLength !== columns.canonicalByteLength ||
      !isUint8ArrayWithByteLength(
        columns.canonicalBytes,
        columns.canonicalByteLength,
      )
    ) {
      return yield* Result.fail(storedCorruption());
    }
    const canonicalBytes = copyBytes(columns.canonicalBytes);
    const canonicalJson = yield* Result.try({
      try: () => new TextDecoder("utf-8", { fatal: true }).decode(
        canonicalBytes,
      ),
      catch: storedCorruption,
    });
    return Object.freeze({
      sha256Hex,
      canonicalByteLength: columns.canonicalByteLength,
      canonicalBytes,
      canonicalJson,
    });
  });
}

export function decodeStoredStorageIdResult<Error>(
  input: unknown,
  storedCorruption: () => Error,
): Result.Result<bigint, Error> {
  return typeof input === "bigint" && input >= 1n &&
      input <= MAX_POSTGRES_INT64
    ? Result.succeed(input)
    : Result.fail(storedCorruption());
}

export function decodeStoredSha256HexResult<Error>(
  input: unknown,
  storedCorruption: () => Error,
): Result.Result<string, Error> {
  return isUint8ArrayWithByteLength(input, SHA256_BYTE_LENGTH)
    ? Result.succeed(Encoding.encodeHex(copyBytes(input)))
    : Result.fail(storedCorruption());
}

export function decodeStoredNonNegativeInt64TextResult<Error>(
  input: unknown,
  storedCorruption: () => Error,
): Result.Result<string, Error> {
  return typeof input === "bigint" && input >= 0n &&
      input <= MAX_POSTGRES_INT64
    ? Result.succeed(String(input))
    : Result.fail(storedCorruption());
}

export function decodeStoredPositiveInt64TextResult<Error>(
  input: unknown,
  storedCorruption: () => Error,
): Result.Result<string, Error> {
  return typeof input === "bigint" && input >= 1n &&
      input <= MAX_POSTGRES_INT64
    ? Result.succeed(String(input))
    : Result.fail(storedCorruption());
}

export function isStoredNonNegativeSafeInteger(
  input: unknown,
  maximum: number,
): input is number {
  return typeof input === "number" && Number.isSafeInteger(input) &&
    input >= 0 && input <= maximum;
}

export function storedDateMatchesCanonicalInstant(
  input: unknown,
  canonicalInstant: string,
): boolean {
  const milliseconds = finiteDateMilliseconds(input);
  if (milliseconds === undefined) return false;
  return new Date(milliseconds).toISOString() === canonicalInstant;
}

function isPositiveSafeIntegerAtMost(
  input: unknown,
  maximum: number,
): input is number {
  return typeof input === "number" && Number.isSafeInteger(input) &&
    input >= 1 && input <= maximum;
}
