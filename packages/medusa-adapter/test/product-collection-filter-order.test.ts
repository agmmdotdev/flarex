import { describe, expect, it } from "vitest";
import { preservePrimaryKeyOrFilterOrder } from "@medusajs/drizzle/relation-query";

describe("pinned native Collection filter order", () => {
  it("retains direct ID-array and nested OR order under the native default/id-ASC ordering", () => {
    for (const where of [{ id: ["c", "a", "b"] }, { $or: [{ id: "c" }, { $or: [{ id: ["a", "b"] }] }] }]) {
      const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
      expect(preservePrimaryKeyOrFilterOrder(rows, where, ["id"], [["id", "ASC"]])).toBe(rows);
      expect(rows.map(row => row.id)).toEqual(["c", "a", "b"]);
    }
  });
  it("keeps native database order for IN operators, explicit descending/non-key order and composite keys", () => {
    for (const [where, keys, order] of [
      [{ id: { $in: ["b", "a"] } }, ["id"], [["id", "ASC"]]],
      [{ id: ["b", "a"] }, ["id"], [["id", "DESC"]]],
      [{ id: ["b", "a"] }, ["id"], [["title", "ASC"]]],
      [{ id: ["b", "a"] }, ["id", "other"], []],
    ] as const) expect(preservePrimaryKeyOrFilterOrder([{ id: "a" }, { id: "b" }], where, keys, order).map(row => row.id)).toEqual(["a", "b"]);
  });
  it("preserves native last-duplicate rank and unmatched-row stability", () => {
    const rows = [{ id: "outside-a" }, { id: "a" }, { id: "b" }, { id: "outside-b" }];
    expect(preservePrimaryKeyOrFilterOrder(rows, { id: ["a", "b", "a"] }, ["id"], []).map(row => row.id))
      .toEqual(["b", "a", "outside-a", "outside-b"]);
  });
});
