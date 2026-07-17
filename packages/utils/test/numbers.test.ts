import { describe, expect, it } from "vitest";

import {
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
} from "../src/numbers";

describe("number utilities", () => {
  it("identifies only positive JavaScript safe integers", () => {
    for (const value of [1, Number.MAX_SAFE_INTEGER]) {
      expect(isPositiveSafeInteger(value)).toBe(true);
    }

    for (const value of [
      undefined,
      null,
      false,
      "1",
      1n,
      Number.NaN,
      Number.NEGATIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.MIN_SAFE_INTEGER,
      -1,
      -0,
      0,
      0.5,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(isPositiveSafeInteger(value)).toBe(false);
    }
  });

  it("identifies non-negative JavaScript safe integers including negative zero", () => {
    for (const value of [-0, 0, 1, Number.MAX_SAFE_INTEGER]) {
      expect(isNonNegativeSafeInteger(value)).toBe(true);
    }

    for (const value of [
      undefined,
      null,
      false,
      "0",
      0n,
      Number.NaN,
      Number.NEGATIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.MIN_SAFE_INTEGER,
      -1,
      0.5,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(isNonNegativeSafeInteger(value)).toBe(false);
    }
  });

  it("does not coerce unknown objects", () => {
    const value = {
      valueOf(): never {
        throw new Error("must not be called");
      },
    };

    expect(isNonNegativeSafeInteger(value)).toBe(false);
    expect(isPositiveSafeInteger(value)).toBe(false);
  });
});
