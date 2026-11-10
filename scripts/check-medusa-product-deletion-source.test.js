// @ts-check
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { optionDeletionSourcePairs, productDeletionServiceSourcePair, verifyProductDeletionSource, verifyProductDeletionSourceSelection } from "./check-medusa-product-deletion-source.mjs";

const pairs = [...optionDeletionSourcePairs, productDeletionServiceSourcePair];
const source = pairs.map(pair => readFileSync(pair.source, "utf8"));
const promoted = pairs.map(pair => readFileSync(pair.target, "utf8"));

describe("parent-qualified native Option deletion and shared Product service declaration", () => {
  it.each(pairs.map((pair, index) => ({ ...pair, index })))("retains the exact approved fork: $target", pair => {
    expect(() => verifyProductDeletionSource(source[pair.index], promoted[pair.index], pair.target)).not.toThrow();
    expect(() => verifyProductDeletionSource(source[pair.index], promoted[pair.index] + "\nglobalThis.productDeletionDrift = true", pair.target))
      .toThrow("Changed parent-qualified native Product deletion source");
  });

  it.each([
    [0, '({ input }) => input.product_id !== undefined).then', '({ input }) => true).then'],
    [0, 'entity: "product_option"', 'entity: "product"'],
    [0, 'fields: ["id"]', 'fields: ["title"]'],
    [0, ': { id: input.ids, product_id: input.product_id }', ': { id: input.ids }'],
    [0, 'if (input.product_id === undefined) return input.ids', 'if (input.product_id === undefined) return []'],
    [0, 'return input.ids.filter(id => matchingIds.has(id))', 'return Array.from(matchingIds)'],
    [0, 'return input.ids.filter(id => matchingIds.has(id))', 'return input.ids'],
    [0, ': { id: effectiveIds, product_id: input.product_id }', ': { id: effectiveIds }'],
    [0, 'deleteProductOptionsStep(optionDeletionInput)', 'deleteProductOptionsStep(input.ids)'],
    [0, '"ids">>("productOptionsDeleted", {\n      ids: effectiveIds,', '"ids">>("productOptionsDeleted", {\n      ids: input.ids,'],
    [0, 'transform({ effectiveIds }, ({ effectiveIds }) => {\n      return effectiveIds?.map', 'transform({ input }, ({ input }) => {\n      return input.ids?.map'],
    [0, '[Modules.PRODUCT]: { product_option_id: effectiveIds }', '[Modules.PRODUCT]: { product_option_id: input.ids }'],
    [0, '    parallelize(\n', '    transform(\n'],
    [1, 'const ids = Array.isArray(input) ? input : input.id', 'const ids = Array.isArray(input) ? input : []'],
    [1, 'await service.softDeleteProductOptions(input)', 'await service.softDeleteProductOptions(ids)'],
    [1, 'return new StepResponse(void 0, ids)', 'return new StepResponse(void 0, input)'],
    [1, 'compensation: "transactionCovered"', 'compensation: "native"'],
    [1, 'await service.restoreProductOptions(prevIds)', 'await service.restoreProductOptions([])'],
  ])("rejects query, parent, effective-ID, ordering or compensation drift %s %s", (index, before, after) => {
    expect(promoted[index]).toContain(before);
    expect(() => verifyProductDeletionSource(source[index], promoted[index].replace(before, after), pairs[index].target))
      .toThrow("Changed parent-qualified native Product deletion source");
  });

  it.each(["Options", "Variants"])("guards the exact %s selector overload and original array signature", kind => {
    const method = `softDeleteProduct${kind}<TReturnableLinkableKeys extends string = string>(`;
    const ids = kind === "Options" ? "optionIds" : "variantIds";
    const original = `${method}\n    ${ids}: string[],`;
    const selector = `${method}\n    selector: { id: string[]; product_id: string },`;
    const overload = `\n\n  /** Retain Product ownership in the trusted native deletion selector. */
  ${method}
    selector: { id: string[]; product_id: string },
    config?: SoftDeleteReturn<TReturnableLinkableKeys>,
    sharedContext?: Context
  ): Promise<Record<string, string[]> | void>`;
    for (const [before, after] of [[selector, selector.replace("product_id:", "product_id?:")],
      [selector, `${method}\n    selector: Record<string, unknown>,`],
      [original, `${method}\n    ${ids}: string,`], [overload, ""]]) {
      expect(promoted[2]).toContain(before);
      expect(() => verifyProductDeletionSource(source[2], promoted[2].replace(before, after), productDeletionServiceSourcePair.target))
        .toThrow("Changed parent-qualified native Product deletion source");
    }
  });

  it.each(["addImageToVariant", "removeImageFromVariant"])("guards the exact optional parent in the %s semantic pair declaration", method => {
    const declaration = `${method}(\n    data: { image_id: string; variant_id: string; product_id?: string }[],`;
    for (const replacement of [declaration.replace("; product_id?: string", ""), declaration.replace("product_id?: string", "product_id?: unknown")]) {
      expect(promoted[2]).toContain(declaration);
      expect(() => verifyProductDeletionSource(source[2], promoted[2].replace(declaration, replacement), productDeletionServiceSourcePair.target))
        .toThrow("Changed parent-qualified native Product deletion source");
    }
  });

  it("requires exactly two Option runtime pairs and the one shared declaration pair", () => {
    expect(() => verifyProductDeletionSourceSelection(pairs)).not.toThrow();
    for (const pair of pairs) {
      for (const change of [{ source: pairs.find(candidate => candidate !== pair)?.source }, { target: "packages/medusa-core-flows/src/product/workflows/delete-products.ts" }, { classification: "workflowFork" }]) {
        expect(() => verifyProductDeletionSourceSelection(pairs.map(candidate => candidate === pair ? { ...candidate, ...change } : candidate)))
          .toThrow("exact source pair");
      }
      expect(() => verifyProductDeletionSourceSelection(pairs.filter(candidate => candidate !== pair))).toThrow("exact source pair");
      expect(() => verifyProductDeletionSourceSelection([...pairs, pair])).toThrow("exact source pair");
    }
    for (const classification of [pairs[0].classification, productDeletionServiceSourcePair.classification]) {
      expect(() => verifyProductDeletionSourceSelection([...pairs, { source: "third_party/medusa/upstream/unselected.ts", target: "packages/medusa-core-flows/src/unselected.ts", classification }]))
        .toThrow("unselected closure");
    }
    expect(() => verifyProductDeletionSourceSelection(pairs.map(pair => pair === productDeletionServiceSourcePair
      ? { ...pair, classification: "parentQualifiedVariantDeletionFork" } : pair))).toThrow("exact source pair");
  });
});
