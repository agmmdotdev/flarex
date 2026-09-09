import { describe, expect, it } from "vitest";
import { Result } from "effect";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCategoryProjection, decodeCategoryProjection } from "../src/product-category-projection";
import { captureCommerceInput } from "../src/commerce-input";

describe("Category projection representation", () => {
  it("round trips own undefined properties without changing null, absence or caller data", () => {
    const input = [{ id: "child", parent_category: undefined, metadata: { label: undefined, keep: null, omitted: ["payload"] } }];
    const encoded = Result.getOrThrow(captureCategoryProjection(input, defaultCommerceResources));
    expect(encoded).toEqual({ payload: [{ id: "child", metadata: { keep: null, omitted: ["payload"] } }], omitted: [["0", "parent_category"], ["0", "metadata", "label"]] });
    const result = Result.getOrThrow(decodeCategoryProjection(encoded));
    expect(result).toStrictEqual(input);
    expect(result).not.toBe(input);
    expect(Result.getOrThrow(decodeCategoryProjection([encoded, 1]))).toStrictEqual([input, 1]);
    expect(Object.hasOwn(input[0] ?? {}, "parent_category")).toBe(true);
    expect(Result.getOrThrow(captureCommerceInput(input))).toEqual(encoded.payload);
  });
  it("rejects corrupt omission paths and preserves accessor refusal", () => {
    for (const input of [
      { payload: {}, omitted: [[]] }, { payload: {}, omitted: [["missing", "parent_category"]] },
      { payload: { parent_category: null }, omitted: [["parent_category"]] },
      { payload: {}, omitted: [["parent_category"], ["parent_category"]] },
    ]) expect(decodeCategoryProjection(input)).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
    let invoked = false;
    const input = { get parent_category() { invoked = true; return undefined; } };
    expect(captureCategoryProjection(input, defaultCommerceResources)).toMatchObject({ _tag: "Failure" });
    expect(invoked).toBe(false);
  });
});
