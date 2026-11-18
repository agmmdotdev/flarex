import { describe, expect, it } from "vitest";
import { Result } from "effect";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../src/value/decoder";
import { captureCategoryProjection } from "../src/modules/product/category-projection";
import { ProductCategoryCreateInput, ProductCategoryUpdateInput, ProductCategoryIds,
  decodeProductCategoryOutput, decodeProductCategoryPreimages } from "../src/modules/product/category-input";

const create = commerceDecoder(ProductCategoryCreateInput, "invalidInput");
const update = commerceDecoder(ProductCategoryUpdateInput, "invalidInput");
const ids = commerceDecoder(ProductCategoryIds, "invalidInput");
const project = (value: unknown) => Result.getOrThrow(captureCategoryProjection(value, defaultCommerceResources));
const row = { id: "root", name: "Root", description: "", handle: "root", mpath: "root", rank: 0,
  is_active: false, is_internal: false, parent_category_id: null, metadata: null };

describe("native Product Category workflow boundary", () => {
  it("keeps empty inputs and admits four native roots and four total Product references", () => {
    expect(Result.getOrThrow(create([]))).toEqual([]);
    const input = [0, 1, 2, 3].map(index => ({ name: "Category " + index, handle: index === 0 ? null : "",
      parent_category_id: index === 0 ? null : "parent", rank: 100,
      products: [{ id: "product-" + index }] }));
    expect(Result.getOrThrow(create(input))).toEqual(input);
    expect(Result.isFailure(create([...input, { name: "fifth" }]))).toBe(true);
    expect(Result.isFailure(create([{ name: "A", products: [{ id: "a" }, { id: "b" }, { id: "c" }] },
      { name: "B", products: [{ id: "d" }, { id: "e" }] }]))).toBe(true);
  });

  it("preserves selector duplicates and empty metadata replacement without admitting managed fields", () => {
    const input = { selector: { id: ["a", "b", "a"], is_active: true, parent_category_id: null },
      update: { metadata: {}, parent_category_id: "parent", rank: 100 } };
    expect(Result.getOrThrow(update(input))).toEqual(input);
    expect(Result.getOrThrow(update({ selector: {}, update: {} }))).toEqual({ selector: {}, update: {} });
    expect(Result.getOrThrow(ids(["a", "missing", "a", "b"]))).toEqual(["a", "missing", "a", "b"]);
    for (const value of [
      { selector: { id: ["1", "2", "3", "4", "5"] }, update: {} },
      { selector: { name: { $in: ["A"] } }, update: {} },
      { selector: {}, update: { id: "root" } }, { selector: {}, update: { mpath: "root.child" } },
      { selector: {}, update: { rank: -1 } }, { selector: {}, update: { rank: 0.5 } },
      { selector: {}, update: { products: [{ id: "product" }] } },
    ]) expect(Result.isFailure(update(value))).toBe(true);
    expect(Result.isFailure(create([{ name: "A", mpath: "root" }]))).toBe(true);
  });

  it("restores genuine preimage own undefined fields and validates the full write DTO", () => {
    const native = [{ id: "child", parent_category: undefined,
      metadata: { label: undefined, keep: null }, parent_category_id: "missing" }];
    const preimages = Result.getOrThrow(decodeProductCategoryPreimages(project(native)));
    expect(preimages).toEqual(native);
    expect(Object.hasOwn(preimages[0] ?? {}, "parent_category")).toBe(true);
    expect(Result.getOrThrow(decodeProductCategoryOutput(project([row])))).toEqual([row]);
    expect(Result.isFailure(decodeProductCategoryOutput(project([{ id: "root" }])))).toBe(true);
    // The pinned duplicate-deletion branch can decrement an active sibling to
    // a negative rank. Keep that returned value while refusing negative input.
    expect(Result.getOrThrow(decodeProductCategoryOutput(project([{ ...row, rank: -1 }])))).toEqual([{ ...row, rank: -1 }]);
    expect(Result.getOrThrow(decodeProductCategoryPreimages(project([{ ...row, rank: -1 }])))).toEqual([{ ...row, rank: -1 }]);
    expect(Result.isFailure(create([{ name: "A", rank: -1 }]))).toBe(true);
    expect(Result.isFailure(update({ selector: {}, update: { rank: -1 } }))).toBe(true);
    expect(Result.isFailure(decodeProductCategoryOutput(project([{ ...row, rank: Number.MIN_SAFE_INTEGER - 1 }])))).toBe(true);
    expect(Result.isFailure(decodeProductCategoryPreimages(project([{ id: "root", rank: Number.MIN_SAFE_INTEGER - 1 }])))).toBe(true);
    expect(Result.isFailure(decodeProductCategoryOutput(project([{ ...row, parent_category: undefined }])))).toBe(true);
    expect(Result.isFailure(decodeProductCategoryPreimages({ payload: [{ id: "root" }], omitted: [["0", "id"]] }))).toBe(true);
    expect(Result.isFailure(decodeProductCategoryPreimages(project([row, row, row, row, row])))).toBe(true);
  });
});
