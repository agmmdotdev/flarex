import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { normalizeRelationalRealValue } from "../../src/values/relationalReal";

describe("native REAL decimal rounding and shortest presentation", () => {
  it.each([[16777217, 16777216], [1.0000000596046448, 1.0000001], [1e-45, 1e-45],
    [1.262177448353619e-29, 1.2621775e-29],
    [230198584, 230198590],
    [0.1, 0.1], [3.4028235e38, 3.4028235e38], [1.1754944e-38, 1.1754944e-38]])(
    "converts submitted %s to canonical %s", (submitted, canonical) => {
      expect(Result.getOrThrow(normalizeRelationalRealValue(submitted))).toBe(canonical);
      expect(Result.getOrThrow(normalizeRelationalRealValue(-submitted))).toBe(-canonical);
      expect(Result.getOrThrow(normalizeRelationalRealValue(canonical))).toBe(canonical);
    });
  it("does not double round the submitted decimal through binary64", () => {
    const submitted = 1.0000000596046448;
    expect(Math.fround(submitted)).toBe(1);
    expect(Result.getOrThrow(normalizeRelationalRealValue(submitted))).toBe(1.0000001);
  });
  it("rounds an exact decimal midpoint to its even binary32 neighbor", () => {
    expect(Result.getOrThrow(normalizeRelationalRealValue(91001.53515625))).toBe(91001.53);
    expect(Result.getOrThrow(normalizeRelationalRealValue(-91001.53515625))).toBe(-91001.53);
  });
  it("canonicalizes either submitted zero spelling", () => {
    expect(Object.is(Result.getOrThrow(normalizeRelationalRealValue(-0)), 0)).toBe(true);
    expect(Object.is(Result.getOrThrow(normalizeRelationalRealValue(0)), 0)).toBe(true);
  });
  it.each([1e-46, -1e-46, 3.5e38, -3.5e38, Number.MIN_VALUE, Number.MAX_VALUE])(
    "refuses native REAL range %s", value => {
      expect(normalizeRelationalRealValue(value)).toMatchObject({ _tag: "Failure", failure: { reason: "outOfRange" } });
    });
  it.each([null, undefined, "1", Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "refuses non-finite or nonnumeric input %s", value => {
      expect(normalizeRelationalRealValue(value)).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    });
});
