import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";

/** Hashes UTF-8 text with the host Web Crypto implementation. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return encodeBytesToLowercaseHex(new Uint8Array(digest));
}
