const SOURCE_ARTIFACT_V2_DIGEST_BYTES = 32;
const SOURCE_ARTIFACT_V2_LOWER_HEX_DIGEST = /^[0-9a-f]{64}$/;

/**
 * Decodes trusted, already-validated stored digest evidence into owned bytes.
 * Invalid evidence is an invariant defect; untrusted boundaries must validate
 * and map corruption before calling this helper.
 */
export function sourceArtifactV2DigestBytesFromLowerHex(value: string): Uint8Array {
  if (!SOURCE_ARTIFACT_V2_LOWER_HEX_DIGEST.test(value)) {
    throw new Error("Stored source-artifact digest is not canonical lowercase hexadecimal.");
  }
  const bytes = new Uint8Array(SOURCE_ARTIFACT_V2_DIGEST_BYTES);
  for (let index = 0; index < bytes.length; index += 1) {
    const pair = value.slice(index * 2, index * 2 + 2);
    const byte = Number.parseInt(pair, 16);
    if (!Number.isSafeInteger(byte)) {
      throw new Error("Stored source-artifact digest is invalid.");
    }
    bytes[index] = byte;
  }
  return bytes;
}
