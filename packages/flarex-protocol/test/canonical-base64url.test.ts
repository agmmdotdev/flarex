import { Encoding, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  UnpaddedBase64UrlTextSchema,
  canonicalBase64UrlEncodedLength,
  decodeCanonicalBase64Url,
} from "../src/canonical-base64url";

describe("canonical Base64URL", () => {
  it("owns the shared non-empty unpadded text contract", () => {
    const decodeText = Schema.decodeUnknownSync(UnpaddedBase64UrlTextSchema);

    expect(decodeText("AQ")).toBe("AQ");
    expect(() => decodeText("")).toThrow();
    expect(() => decodeText("AA==")).toThrow();
    expect(() => decodeText("+/8")).toThrow();
  });

  it("decodes canonical spellings into newly owned bytes", () => {
    const first = Result.getOrThrow(decodeCanonicalBase64Url("AQI", 2));
    const second = Result.getOrThrow(decodeCanonicalBase64Url("AQI", 2));

    expect(first).toEqual(new Uint8Array([1, 2]));
    expect(first).not.toBe(second);
  });

  it("distinguishes syntax, size, and noncanonical pad bits", () => {
    expect(decodeCanonicalBase64Url("A", 8)).toMatchObject({
      failure: { reason: "invalidSyntax" },
    });
    expect(decodeCanonicalBase64Url("AA==", 8)).toMatchObject({
      failure: { reason: "invalidSyntax" },
    });
    expect(decodeCanonicalBase64Url("AQI", 1)).toMatchObject({
      failure: {
        reason: "tooLarge",
        observedBytes: 2,
        maximumBytes: 1,
      },
    });
    expect(decodeCanonicalBase64Url("AB", 8)).toMatchObject({
      failure: { reason: "nonCanonical" },
    });
  });

  it("matches canonical encoded lengths across each padding remainder", () => {
    for (const byteLength of [0, 1, 2, 3, 4, 63, 64, 512]) {
      const encoded = Encoding.encodeBase64Url(new Uint8Array(byteLength));

      expect(canonicalBase64UrlEncodedLength(byteLength)).toBe(
        encoded.length,
      );
    }
  });
});
