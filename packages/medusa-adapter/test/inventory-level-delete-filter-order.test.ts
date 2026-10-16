import { describe, expect, it } from "vitest";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { preservePrimaryKeyOrFilterOrder } from "@medusajs/drizzle/relation-query";

/** Genuine native normalization precedes the storage-independent native order
 * helper. Direct ID-array duplicates and repeated OR branches differ here. */
describe("native Inventory Level deletion filter ordering", () => {
  it("deduplicates direct ID-array values at their first occurrence before native filter ordering", () => {
    const filters = { id: ["b", "missing", "a", "b"] };
    const query = buildQuery(filters, { order: { id: "ASC" } });
    expect(query.where).toEqual({ id: ["b", "missing", "a"] });
    expect(preservePrimaryKeyOrFilterOrder([{ id: "a" }, { id: "b" }], query.where, ["id"], [["id", "ASC"]]))
      .toEqual([{ id: "b" }, { id: "a" }]);
    expect(filters).toEqual({ id: ["b", "missing", "a", "b"] });
  });
  it("preserves repeated OR branches so native ordering retains their final repeated-ID rank", () => {
    const filters = { $or: [{ id: "b" }, { id: "missing" }, { id: "a" }, { id: "b" }] };
    const query = buildQuery(filters, { order: { id: "ASC" } });
    expect(query.where).toEqual(filters);
    expect(preservePrimaryKeyOrFilterOrder([{ id: "a" }, { id: "b" }], query.where, ["id"], [["id", "ASC"]]))
      .toEqual([{ id: "a" }, { id: "b" }]);
  });
});