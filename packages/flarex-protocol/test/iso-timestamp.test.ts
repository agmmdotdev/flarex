import { describe, expect, it } from "vitest";

import { isCanonicalIsoTimestamp } from "flarex-protocol/iso-timestamp";

describe("canonical ECMAScript ISO timestamps", () => {
  it("accepts exact UTC millisecond and signed extended-year spellings", () => {
    expect(isCanonicalIsoTimestamp("2026-07-18T10:00:00.000Z")).toBe(true);
    expect(
      isCanonicalIsoTimestamp(
        new Date(253_402_300_800_000).toISOString(),
      ),
    ).toBe(true);
    expect(
      isCanonicalIsoTimestamp(
        new Date(-62_198_755_200_000).toISOString(),
      ),
    ).toBe(true);
  });

  it.each([
    { value: "2026-07-18T10:00:00.000+00:00", name: "a UTC offset" },
    { value: "2026-07-18T10:00:00Z", name: "missing milliseconds" },
    { value: "2026-07-18", name: "a date-only spelling" },
    { value: "2026-02-30T10:00:00.000Z", name: "a normalized invalid date" },
    { value: "2026-07-18T10:00:00.000z", name: "a lowercase UTC suffix" },
    { value: " 2026-07-18T10:00:00.000Z", name: "leading whitespace" },
    { value: "not-a-timestamp", name: "an invalid string" },
  ])("rejects $name", ({ value }) => {
    expect(isCanonicalIsoTimestamp(value)).toBe(false);
  });
});
