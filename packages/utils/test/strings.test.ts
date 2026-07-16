import { describe, expect, it } from "vitest";

import { compareUtf16Strings } from "@flarex/utils/strings";

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
