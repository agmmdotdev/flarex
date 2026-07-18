import { Encoding, Result, Schema } from "effect";

const UNPADDED_BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Syntactic unpadded Base64URL text; canonical pad bits are decoded below. */
export const UnpaddedBase64UrlTextSchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isPattern(UNPADDED_BASE64URL_PATTERN),
);

export type CanonicalBase64UrlDecodeIssue =
  | Readonly<{ readonly reason: "invalidSyntax" }>
  | Readonly<{ readonly reason: "decodingFailed" }>
  | Readonly<{
      readonly reason: "tooLarge";
      readonly observedBytes: number;
      readonly maximumBytes: number;
    }>
  | Readonly<{ readonly reason: "nonCanonical" }>;

const INVALID_SYNTAX = Object.freeze({ reason: "invalidSyntax" } as const);
const DECODING_FAILED = Object.freeze({ reason: "decodingFailed" } as const);
const NON_CANONICAL = Object.freeze({ reason: "nonCanonical" } as const);

/**
 * Decodes one non-empty unpadded Base64URL value and proves its unique
 * canonical spelling by re-encoding the decoded bytes.
 *
 * The caller supplies its protocol-owned byte ceiling and maps the structural
 * issue into its own typed failure. The returned byte array is newly owned.
 */
export function decodeCanonicalBase64Url(
  value: string,
  maximumBytes: number,
): Result.Result<Uint8Array, CanonicalBase64UrlDecodeIssue> {
  if (
    !UNPADDED_BASE64URL_PATTERN.test(value) ||
    value.length % 4 === 1
  ) {
    return Result.fail(INVALID_SYNTAX);
  }
  const observedBytes = Math.floor((value.length * 3) / 4);
  if (observedBytes > maximumBytes) {
    return Result.fail(Object.freeze({
      reason: "tooLarge" as const,
      observedBytes,
      maximumBytes,
    }));
  }
  return Encoding.decodeBase64Url(value).pipe(
    Result.mapError(() => DECODING_FAILED),
    Result.flatMap((bytes): Result.Result<
      Uint8Array,
      CanonicalBase64UrlDecodeIssue
    > => {
      return Encoding.encodeBase64Url(bytes) === value
        ? Result.succeed(bytes)
        : Result.fail(NON_CANONICAL);
    }),
  );
}

/**
 * Returns the character length of the canonical unpadded Base64url encoding
 * for a byte sequence of the supplied length.
 *
 * The caller owns validation that `byteLength` is a non-negative integer in
 * its protocol-specific range.
 */
export function canonicalBase64UrlEncodedLength(byteLength: number): number {
  return Math.ceil((byteLength * 4) / 3);
}
