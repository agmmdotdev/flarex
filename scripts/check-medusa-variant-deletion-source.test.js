// @ts-check
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { variantDeletionSourcePairs, verifyVariantDeletionSource, verifyVariantDeletionSourceSelection } from "./check-medusa-variant-deletion-source.mjs";

const pairs = variantDeletionSourcePairs;
const source = pairs.map(pair => readFileSync(pair.source, "utf8"));
const promoted = pairs.map(pair => readFileSync(pair.target, "utf8"));

describe("parent-qualified native Variant deletion source", () => {
  it.each(pairs.map((pair, index) => ({ ...pair, index })))("retains the exact approved fork: $target", pair => {
    expect(() => verifyVariantDeletionSource(source[pair.index], promoted[pair.index], pair.target)).not.toThrow();
    expect(() => verifyVariantDeletionSource(source[pair.index], promoted[pair.index] + "\nglobalThis.variantDeletionDrift = true", pair.target))
      .toThrow("Changed parent-qualified native Variant deletion source");
  });

  it.each([
    [0, ': { id: input.ids, product_id: input.product_id }', ': { id: input.ids }'],
    [0, 'if (input.product_id === undefined) return input.ids', 'if (input.product_id === undefined) return []'],
    [0, 'return input.ids.filter(id => matchingIds.has(id))', 'return Array.from(matchingIds)'],
    [0, 'return input.ids.filter(id => matchingIds.has(id))', 'return input.ids'],
    [0, '[Modules.PRODUCT]: { variant_id: effectiveIds }', '[Modules.PRODUCT]: { variant_id: input.ids }'],
    [0, 'const variants = data.input.product_id === undefined', 'const variants = true'],
    [0, 'data.effectiveIds.includes(variant.id)', 'data.input.ids.includes(variant.id)'],
    [0, ': { id: effectiveIds, product_id: input.product_id }', ': { id: effectiveIds }'],
    [0, 'deleteProductVariantsStep(variantDeletionInput)', 'deleteProductVariantsStep(input.ids)'],
    [0, 'transform({ effectiveIds }, ({ effectiveIds }) => {\n      return effectiveIds?.map', 'transform({ input }, ({ input }) => {\n      return input.ids?.map'],
    [0, 'createHook("productVariantsDeleted", {\n      ids: effectiveIds,', 'createHook("productVariantsDeleted", {\n      ids: input.ids,'],
    [0, 'inventoryItem.variants.every((v) => variantsMap.has(v.id))', 'true'],
    [0, 'data: deletionVariantRows(response.data)', 'data: response.data'],
    [1, 'const ids = Array.isArray(input) ? input : input.id', 'const ids = Array.isArray(input) ? input : []'],
    [1, 'await service.softDeleteProductVariants(input)', 'await service.softDeleteProductVariants(ids)'],
    [1, 'return new StepResponse(void 0, ids)', 'return new StepResponse(void 0, input)'],
    [1, 'compensation: "transactionCovered"', 'compensation: "native"'],
    [1, 'await service.restoreProductVariants(prevIds)', 'await service.restoreProductVariants([])'],
    [2, 'selector: { id: string[]; product_id: string }', 'selector: { id: string[]; product_id?: string }'],
    [2, 'selector: { id: string[]; product_id: string }', 'selector: Record<string, unknown>'],
    [2, 'variantIds: string[],\n    config?: SoftDeleteReturn', 'variantIds: string,\n    config?: SoftDeleteReturn'],
  ])("rejects parent, effective-ID, compensation or public-type drift %s %s", (index, before, after) => {
    const pair = pairs[index];
    expect(promoted[index]).toContain(before);
    expect(() => verifyVariantDeletionSource(source[index], promoted[index].replace(before, after), pair.target))
      .toThrow("Changed parent-qualified native Variant deletion source");
  });

  it("requires exactly the three pinned source/classification pairs", () => {
    expect(() => verifyVariantDeletionSourceSelection(pairs)).not.toThrow();
    for (const pair of pairs) {
      for (const change of [{ source: pairs.find(candidate => candidate !== pair)?.source }, { target: "packages/medusa-core-flows/src/product/workflows/delete-products.ts" }, { classification: "workflowFork" }]) {
        expect(() => verifyVariantDeletionSourceSelection(pairs.map(candidate => candidate === pair ? { ...candidate, ...change } : candidate)))
          .toThrow("exact source pair");
      }
      expect(() => verifyVariantDeletionSourceSelection(pairs.filter(candidate => candidate !== pair))).toThrow("exact source pair");
      expect(() => verifyVariantDeletionSourceSelection([...pairs, pair])).toThrow("exact source pair");
    }
    expect(() => verifyVariantDeletionSourceSelection([...pairs, { source: "third_party/medusa/upstream/unselected.ts", target: "packages/medusa-core-flows/src/unselected.ts", classification: pairs[0].classification }]))
      .toThrow("unselected closure");
  });
});
