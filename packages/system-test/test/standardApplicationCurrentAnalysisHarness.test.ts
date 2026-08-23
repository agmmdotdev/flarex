import { describe, expect, it } from "vitest";

import {
  decodeStandardApplicationCurrentSourceTextV1,
} from "../support/standardApplicationCurrentAnalysisHarness";

describe("Standard Application current-analysis source text", () => {
  it("rejects malformed UTF-8 instead of analyzing replacement text", () => {
    expect(() => decodeStandardApplicationCurrentSourceTextV1(
      Uint8Array.of(0xc3, 0x28),
    )).toThrow();
  });

  it("preserves a leading UTF-8 BOM like production source admission", () => {
    expect(decodeStandardApplicationCurrentSourceTextV1(
      Uint8Array.of(0xef, 0xbb, 0xbf, 0x61),
    )).toBe("\ufeffa");
  });
});
