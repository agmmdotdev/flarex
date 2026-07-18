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
