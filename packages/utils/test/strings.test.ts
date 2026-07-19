import { describe, expect, it } from "vitest";

import {
  compareUtf16Strings,
  isLowercaseUuidText,
  isNonBlankString,
  trimToNonBlankOrNull,
} from "@flarex/utils/strings";

describe("compareUtf16Strings", () => {
  it("returns zero for equal strings", () => {
    expect(compareUtf16Strings("same", "same")).toBe(0);
  });

  it("orders prefixes before longer strings", () => {
    expect(compareUtf16Strings("field", "fields")).toBe(-1);
    expect(compareUtf16Strings("fields", "field")).toBe(1);
  });

  it("uses lexicographic code-unit order", () => {
    expect(compareUtf16Strings("A", "a")).toBe(-1);
  });

  it("compares UTF-16 code units rather than Unicode code points", () => {
    expect(compareUtf16Strings("\u{1f600}", "\ue000")).toBe(-1);
  });
});

describe("isNonBlankString", () => {
  it("rejects non-string values and ECMAScript whitespace-only strings", () => {
    expect(isNonBlankString(undefined)).toBe(false);
    expect(isNonBlankString(null)).toBe(false);
    expect(isNonBlankString(1)).toBe(false);
    expect(isNonBlankString("")).toBe(false);
    expect(isNonBlankString(" \t\r\n")).toBe(false);
    expect(isNonBlankString("\u00a0\ufeff")).toBe(false);
  });

  it("accepts strings without normalizing or imposing domain text policy", () => {
    expect(isNonBlankString("value")).toBe(true);
    expect(isNonBlankString("  value  ")).toBe(true);
    expect(isNonBlankString("\u200b")).toBe(true);
    expect(isNonBlankString("\u0000")).toBe(true);
  });
});

describe("isLowercaseUuidText", () => {
  it("accepts the exact lowercase hexadecimal 8-4-4-4-12 spelling", () => {
    expect(isLowercaseUuidText("00000000-0000-0000-0000-000000000000"))
      .toBe(true);
    expect(isLowercaseUuidText("abcdef12-3456-7890-abcd-ef1234567890"))
      .toBe(true);
  });

  it("rejects alternate spellings without imposing UUID version policy", () => {
    expect(isLowercaseUuidText("ABCDEF12-3456-7890-ABCD-EF1234567890"))
      .toBe(false);
    expect(isLowercaseUuidText("abcdef1234567890abcdef1234567890"))
      .toBe(false);
    expect(isLowercaseUuidText("{abcdef12-3456-7890-abcd-ef1234567890}"))
      .toBe(false);
    expect(isLowercaseUuidText("abcdef12-3456-7890-abcd-ef123456789g"))
      .toBe(false);

    // The spelling predicate deliberately accepts values without RFC
    // version or variant bits set.
    expect(isLowercaseUuidText("ffffffff-ffff-ffff-ffff-ffffffffffff"))
      .toBe(true);
  });
});

describe("trimToNonBlankOrNull", () => {
  it("merges missing and ECMAScript whitespace-only input into null", () => {
    expect(trimToNonBlankOrNull(undefined)).toBeNull();
    expect(trimToNonBlankOrNull("")).toBeNull();
    expect(trimToNonBlankOrNull(" \t\r\n")).toBeNull();
    expect(trimToNonBlankOrNull("\u00a0\ufeff")).toBeNull();
  });

  it("returns the trimmed nonblank spelling without domain normalization", () => {
    expect(trimToNonBlankOrNull("value")).toBe("value");
    expect(trimToNonBlankOrNull("  value  ")).toBe("value");
    expect(trimToNonBlankOrNull("\u200b")).toBe("\u200b");
    expect(trimToNonBlankOrNull(" \u0000 ")).toBe("\u0000");
  });
});
