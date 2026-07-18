import { describe, expect, it } from "vitest";

import { uniqueSorted } from "../src/uniqueSorted";

describe("uniqueSorted", () => {
  it("deduplicates and sorts strings by JavaScript relational order", () => {
    expect(uniqueSorted(["2", "10", "2", "a"])).toEqual([
      "10",
      "2",
      "a",
    ]);
  });

  it("deduplicates and sorts numbers numerically without mutating input", () => {
    const input = [10, 2, 10, 1] as const;

    expect(uniqueSorted(input)).toEqual([1, 2, 10]);
    expect(input).toEqual([10, 2, 10, 1]);
  });

  it("retains Set semantics for negative zero and NaN", () => {
    const values = uniqueSorted([-0, 0, Number.NaN, Number.NaN]);

    expect(values).toHaveLength(2);
    expect(Object.is(values[0], 0)).toBe(true);
    expect(Number.isNaN(values[1])).toBe(true);
  });
});
