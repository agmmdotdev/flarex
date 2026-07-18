import { Encoding } from "effect";
import { describe, expect, it } from "vitest";

import { canonicalBase64UrlEncodedLength } from "../src/canonical-base64url";

describe("canonical unpadded Base64url length arithmetic", () => {
  it("matches canonical encodings across each padding remainder", () => {
    for (const byteLength of [0, 1, 2, 3, 4, 63, 64, 512]) {
      const encoded = Encoding.encodeBase64Url(new Uint8Array(byteLength));

      expect(canonicalBase64UrlEncodedLength(byteLength)).toBe(
        encoded.length,
      );
    }
  });
});
