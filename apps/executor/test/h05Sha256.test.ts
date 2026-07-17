import { describe, expect, it } from "vitest";

import { isH05LowercaseSha256Digest } from "../h05/sha256";

describe("H05 lowercase SHA-256 format", () => {
  it("accepts exactly 64 lowercase hexadecimal characters", () => {
    expect(isH05LowercaseSha256Digest("a".repeat(64))).toBe(true);
    expect(isH05LowercaseSha256Digest("0123456789abcdef".repeat(4))).toBe(
      true,
    );
  });

  it("keeps all-zero placeholder policy outside the format predicate", () => {
    expect(isH05LowercaseSha256Digest("0".repeat(64))).toBe(true);
  });

  it.each([
    { value: "a".repeat(63), name: "a short digest" },
    { value: "a".repeat(65), name: "a long digest" },
    { value: "A".repeat(64), name: "uppercase hexadecimal" },
    { value: `${"a".repeat(63)}g`, name: "a non-hexadecimal character" },
    { value: `${"a".repeat(63)}é`, name: "a non-ASCII character" },
    { value: 0, name: "a number" },
    { value: null, name: "null" },
    { value: undefined, name: "undefined" },
    { value: ["a".repeat(64)], name: "an array" },
  ])("rejects $name", ({ value }) => {
    expect(isH05LowercaseSha256Digest(value)).toBe(false);
  });
});
