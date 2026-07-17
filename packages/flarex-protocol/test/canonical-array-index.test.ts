import { describe, expect, it } from "vitest";

import { isCanonicalArrayIndex } from "../src/canonical-array-index";

describe("canonical array indexes", () => {
  it("accepts canonical decimal keys strictly below the array length", () => {
    expect(isCanonicalArrayIndex("0", 1)).toBe(true);
    expect(isCanonicalArrayIndex("1", 2)).toBe(true);
    expect(
      isCanonicalArrayIndex(
        String(Number.MAX_SAFE_INTEGER),
        Number.MAX_SAFE_INTEGER + 1,
      ),
    ).toBe(true);
  });

  it("rejects out-of-range, non-canonical, and unsafe keys", () => {
    const invalidCases = [
      ["0", 0],
      ["1", 1],
      ["", 1],
      ["00", 1],
      ["01", 2],
      ["+0", 1],
      ["-0", 1],
      [" 0", 1],
      ["0.0", 1],
      ["0e0", 1],
      [String(Number.MAX_SAFE_INTEGER + 1), Number.MAX_VALUE],
    ] satisfies ReadonlyArray<readonly [string, number]>;

    for (const [key, length] of invalidCases) {
      expect(isCanonicalArrayIndex(key, length)).toBe(false);
    }
  });
});
