import { describe, expect, it } from "vitest";

import { normalizeDateString } from "../src/dateStringNormalization";

describe("backend date string normalization", () => {
  it("normalizes finite host-parseable date text", () => {
    expect(normalizeDateString("2026-01-02")).toBe(
      "2026-01-02T00:00:00.000Z",
    );
    expect(normalizeDateString("2026-01-02T03:04:05.006Z")).toBe(
      "2026-01-02T03:04:05.006Z",
    );
  });

  it("rejects text without a finite Date instant", () => {
    expect(normalizeDateString("not-a-date")).toBeUndefined();
    expect(normalizeDateString("+999999-01-01T00:00:00.000Z"))
      .toBeUndefined();
  });
});
