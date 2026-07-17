import { describe, expect, it } from "vitest";

import { isH05FullLowercaseGitCommit } from "../h05/gitCommit";

describe("H05 full lowercase Git commit format", () => {
  it("accepts exactly 40 lowercase hexadecimal characters", () => {
    expect(isH05FullLowercaseGitCommit("a".repeat(40))).toBe(true);
    expect(
      isH05FullLowercaseGitCommit(
        "0123456789abcdef".repeat(2) + "01234567",
      ),
    ).toBe(true);
  });

  it("keeps all-zero placeholder policy outside the format predicate", () => {
    expect(isH05FullLowercaseGitCommit("0".repeat(40))).toBe(true);
  });

  it.each([
    { value: "a".repeat(39), name: "a short commit" },
    { value: "a".repeat(41), name: "a long commit" },
    { value: "A".repeat(40), name: "uppercase hexadecimal" },
    { value: `${"a".repeat(39)}g`, name: "a non-hexadecimal character" },
    { value: `${"a".repeat(39)}\u00e9`, name: "a non-ASCII character" },
    { value: 0, name: "a number" },
    { value: null, name: "null" },
    { value: undefined, name: "undefined" },
    { value: ["a".repeat(40)], name: "an array" },
  ])("rejects $name", ({ value }) => {
    expect(isH05FullLowercaseGitCommit(value)).toBe(false);
  });
});
