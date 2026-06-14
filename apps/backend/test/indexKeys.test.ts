import { describe, expect, it } from "vitest";
import {
  encodeIndexValues,
  indexBoundsForExpressions,
  indexKeyAfterPrefix,
  indexKeyForDocument,
  indexKeyInRange,
} from "../src/indexKeys";

describe("index keys", () => {
  it("extracts nested fields in declared order", () => {
    expect(
      indexKeyForDocument(
        { fields: ["userId", "profile.score"] },
        { userId: "u1", profile: { score: 42 } },
        "1:doc",
      ),
    ).toBe(encodeIndexValues(["u1", 42, "1:doc"]));
  });

  it("orders numbers, strings, and compound tuples correctly", () => {
    expect(encodeIndexValues([2]) < encodeIndexValues([10])).toBe(true);
    expect(encodeIndexValues([-10]) < encodeIndexValues([-2])).toBe(true);
    expect(encodeIndexValues(["a"]) < encodeIndexValues(["aa"])).toBe(true);
    expect(encodeIndexValues(["u1", 2]) < encodeIndexValues(["u1", 10])).toBe(true);
  });

  it("builds half-open prefix and inequality bounds", () => {
    const prefix = encodeIndexValues(["u1"]);
    expect(indexBoundsForExpressions(["userId", "score"], [
      { op: "eq", field: "userId", value: "u1" },
    ])).toEqual({
      lower: prefix,
      upper: indexKeyAfterPrefix(prefix),
    });

    const bounds = indexBoundsForExpressions(["userId", "score"], [
      { op: "eq", field: "userId", value: "u1" },
      { op: "gte", field: "score", value: 2 },
      { op: "lt", field: "score", value: 10 },
    ]);
    expect(indexKeyInRange(encodeIndexValues(["u1", 2]), bounds.lower, bounds.upper)).toBe(true);
    expect(indexKeyInRange(encodeIndexValues(["u1", 9]), bounds.lower, bounds.upper)).toBe(true);
    expect(indexKeyInRange(encodeIndexValues(["u1", 10]), bounds.lower, bounds.upper)).toBe(false);
  });
});
