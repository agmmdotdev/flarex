import { describe, expect, it } from "vitest";
import { Result } from "effect";
import { commerceDecoder } from "../src/value/decoder";
import { ProductOptionCreateInput, ProductOptionUpdateInput, ProductOptionIds, ProductOptionSoftDeleteOutput,
  decodeProductOptionOutput, decodeProductOptionPreimages } from "../src/modules/product/option-input";

const create = commerceDecoder(ProductOptionCreateInput, "invalidInput");
const update = commerceDecoder(ProductOptionUpdateInput, "invalidInput");
const ids = commerceDecoder(ProductOptionIds, "invalidInput");
const deleted = commerceDecoder(ProductOptionSoftDeleteOutput, "storedCorruption");
const row = { id: "option", title: "Size", product_id: "product", metadata: null,
  values: [{ id: "small", value: "Small", option_id: "option", metadata: null }] };

describe("native Product Option workflow boundary", () => {
  it("retains empty requests and admits four roots with four string Values each", () => {
    expect(Result.getOrThrow(create([]))).toEqual([]);
    const input = [0, 1, 2, 3].map(index => ({ title: "Option " + index, product_id: "product-" + index,
      values: ["a", "b", "c", "d"], metadata: {} }));
    expect(Result.getOrThrow(create(input))).toEqual(input);
    expect(Result.isFailure(create([...input, { title: "fifth", product_id: "product" }]))).toBe(true);
    expect(Result.isFailure(create([{ title: "Size", product_id: "product", values: ["a", "b", "c", "d", "e"] }]))).toBe(true);
    expect(Result.isFailure(create([{ title: "Size", product_id: "product", values: [{ value: "Small" }] }]))).toBe(true);
    expect(Result.isFailure(create([{ title: "Size" }]))).toBe(true);
    expect(Result.isFailure(create([{ title: "Size", product_id: "product", created_at: "managed" }]))).toBe(true);
  });

  it("preserves omitted versus empty Values, metadata replacement, and raw selector duplicates", () => {
    for (const data of [{}, { values: [] }, { metadata: {} }, { metadata: null }, { values: ["a", "a"] }]) {
      const input = { selector: { id: ["b", "a", "b"], product_id: "product", title: "Size" }, update: data };
      expect(Result.getOrThrow(update(input))).toEqual(input);
    }
    expect(Result.getOrThrow(ids(["a", "missing", "a", "b"]))).toEqual(["a", "missing", "a", "b"]);
    for (const data of [{ product_id: "other" }, { id: "other" }, { deleted_at: null }, { values: ["a", "b", "c", "d", "e"] }])
      expect(Result.isFailure(update({ selector: {}, update: data }))).toBe(true);
    expect(Result.isFailure(update({ selector: { id: ["1", "2", "3", "4", "5"] }, update: {} }))).toBe(true);
  });

  it("requires complete write DTOs while retaining native fields and partial preimages", () => {
    expect(Result.getOrThrow(decodeProductOptionOutput([row]))).toEqual([row]);
    const projected = [{ id: "option", values: [{ id: "small" }] }];
    expect(Result.getOrThrow(decodeProductOptionPreimages(projected))).toEqual(projected);
    expect(Result.getOrThrow(decodeProductOptionPreimages([{ id: "option" }]))).toEqual([{ id: "option" }]);
    for (const value of [[{ id: "option" }], [{ ...row, values: [{ id: "small", option_id: "option" }] }],
      Array.from({ length: 5 }, () => row), [{ ...row, values: Array.from({ length: 5 }, () => row.values[0]) }]])
      expect(Result.isFailure(decodeProductOptionOutput(value))).toBe(true);
    expect(Result.isFailure(decodeProductOptionPreimages(Array.from({ length: 5 }, () => ({ id: "option" }))))).toBe(true);
  });

  it("bounds the actual native mapped cascade without replacing it by requested IDs", () => {
    const result = { product_option_id: ["option"], product_option_value_id: Array.from({ length: 16 }, (_, n) => "value-" + n) };
    expect(Result.getOrThrow(deleted(result))).toEqual(result);
    expect(Result.getOrThrow(deleted({}))).toEqual({});
    expect(Result.isFailure(deleted({ ...result, product_option_value_id: [...result.product_option_value_id, "seventeenth"] }))).toBe(true);
    expect(Result.isFailure(deleted({ ...result, product_id: ["product"] }))).toBe(true);
    expect(Result.isFailure(deleted(null))).toBe(true);
  });
});
