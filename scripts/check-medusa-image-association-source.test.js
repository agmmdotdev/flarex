// @ts-check
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { imageAssociationSourcePairs, verifyImageAssociationSource, verifyImageAssociationSourceSelection } from "./check-medusa-image-association-source.mjs";
import { verifyAdminProductImageBatchSource } from "./check-medusa-currency-promotion.mjs";

const pairs = imageAssociationSourcePairs;
const source = pairs.map(pair => readFileSync(pair.source, "utf8"));
const promoted = pairs.map(pair => readFileSync(pair.target, "utf8"));

describe("parent-qualified native Image association source", () => {
  it.each(pairs.map((pair, index) => ({ ...pair, index })))("retains the exact approved native source: $target", pair => {
    expect(() => verifyImageAssociationSource(source[pair.index], promoted[pair.index], pair.target)).not.toThrow();
    if (pair.index !== 7) expect(() => verifyImageAssociationSource(source[pair.index], promoted[pair.index] + "\nglobalThis.imageAssociationDrift = true", pair.target))
      .toThrow("Changed parent-qualified native Image association source");
  });

  it.each([
    [0, 'product_id?: string', 'product_id: string'],
    [0, 'variant_id: data.input.variant_id,\n        ...(data.input.product_id === undefined ? {} : { product_id: data.input.product_id }),', 'variant_id: data.input.variant_id,'],
    [0, 'id: data.input.variant_id,\n          ...(data.input.product_id === undefined ? {} : { product_id: data.input.product_id }),', 'id: data.input.variant_id,'],
    [0, 'id: data.input.remove ?? [],\n          ...(data.input.product_id === undefined ? {} : { product_id: data.input.product_id }),', 'id: data.input.remove ?? [],'],
    [0, 'filters: variantFilter,', 'filters: { id: normalizedInput.variant_id },'],
    [0, 'filters: normalizedInput.removedImagesFilter,', 'filters: { id: normalizedInput.remove },'],
    [0, 'selector: normalizedInput.variantSelector,', 'selector: { id: input.variant_id },'],
    [0, 'filters: variantFilter,', 'filters: transform({ variantFilter }, data => data.variantFilter),'],
    [0, 'return data.normalizedInput.variantSelector', 'return data.normalizedInput.variant_id'],
    [0, 'if (data.variant === undefined)', 'if (false)'],
    [0, 'const res = [\n      addImagesToVariantStep(normalizedInput),\n      removeImagesFromVariantStep(normalizedInput),\n    ]', 'const res = parallelize(addImagesToVariantStep(normalizedInput), removeImagesFromVariantStep(normalizedInput))'],
    [1, 'const res = parallelize(', 'const res = transform('],
    [1, '"should-remove-variants"', '"other-preparation"'],
    [1, 'id: data.input.image_id,\n          ...(data.input.product_id === undefined ? {} : { product_id: data.input.product_id }),', 'id: data.input.image_id,'],
    [1, 'filters: imageFilter,', 'filters: { id: normalizedInput.image_id },'],
    [1, 'filters: normalizedInput.variantsFilter,', 'filters: { id: normalizedInput.remove },'],
    [1, 'filters: imageFilter,', 'filters: transform({ imageFilter }, data => data.imageFilter),'],
    [1, 'return data.normalizedInput.imageSelector', 'return data.normalizedInput.image_id'],
    [1, 'id: data.normalizedInput.remove,\n              ...(data.normalizedInput.product_id === undefined ? {} : { product_id: data.normalizedInput.product_id }),', 'id: data.normalizedInput.remove,'],
    [1, 'added: data.res[0] ?? []', 'added: Array.from(new Set(data.res[0] ?? []))'],
    [2, 'if (!input.add.length)', 'if (false)'],
    [2, 'variant_id: input.variant_id,\n      ...(input.product_id === undefined ? {} : { product_id: input.product_id }),', 'variant_id: input.variant_id,'],
    [2, 'variant_id: compensationData.variant_id,\n      ...(compensationData.product_id === undefined ? {} : { product_id: compensationData.product_id }),', 'variant_id: compensationData.variant_id,'],
    [3, 'compensation: "transactionCovered"', 'compensation: "native"'],
    [3, 'await productModuleService.removeImageFromVariant(data)', 'await productModuleService.addImageToVariant(data)'],
    [4, 'image_id: input.image_id,\n      ...(input.product_id === undefined ? {} : { product_id: input.product_id }),', 'image_id: input.image_id,'],
    [5, 'image_id: compensationData.image_id,\n      ...(compensationData.product_id === undefined ? {} : { product_id: compensationData.product_id }),', 'image_id: compensationData.image_id,'],
    [6, '  product_id?: string', '  product_id?: unknown'],
    [7, 'const pairs = await this.prepareVariantImagePairs_(data, sharedContext)', 'const pairs = data'],
    [7, 'const validatedData = await this.prepareVariantImagePairs_(data, sharedContext)', 'const validatedData = data'],
    [7, '.create(pairs, sharedContext)', '.create(data, sharedContext)'],
    [7, 'if (groups.size === 0) return data', 'if (groups.size === 0) return []'],
    [7, 'pair.image_id))), product_id: productId', 'pair.image_id)))'],
    [7, 'pair.variant_id))), product_id: productId', 'pair.variant_id)))'],
    [7, '{ select: ["id", "product_id"] },\n        sharedContext', '{ select: ["id", "product_id"] },\n        {}'],
    [7, '!imageIds.has(pair.image_id) || !variantIds.has(pair.variant_id)', '!imageIds.has(pair.image_id) && !variantIds.has(pair.variant_id)'],
    [7, 'MedusaError.Types.INVALID_DATA,\n          "Product Image', 'MedusaError.Types.NOT_FOUND,\n          "Product Image'],
    [7, 'return pairs.map(({ product_id, ...pair }) => pair)', 'return pairs'],
    [7, 'export default class ProductModuleService', 'export default class OtherService'],
  ])("rejects parent, endpoint, branch, compensation or return drift %s %s", (index, before, after) => {
    expect(promoted[index]).toContain(before);
    expect(() => verifyImageAssociationSource(source[index], promoted[index].replace(before, after), pairs[index].target))
      .toThrow("Changed parent-qualified native Image association source");
  });

  it("retains the broader existing Product service fork outside this exact seam", () => {
    const unrelated = promoted[7].replace('"images", "product", "product.images"', '"images", "product", "product.images", "other-existing-fork"');
    expect(unrelated).not.toBe(promoted[7]);
    expect(() => verifyImageAssociationSource(source[7], unrelated, pairs[7].target)).not.toThrow();
  });

  it("requires the exact eight source/classification pairs and no neighboring closure", () => {
    expect(() => verifyImageAssociationSourceSelection(pairs)).not.toThrow();
    for (const pair of pairs) {
      for (const change of [{ source: pairs.find(candidate => candidate !== pair)?.source }, { classification: "workflowFork" }])
        expect(() => verifyImageAssociationSourceSelection(pairs.map(candidate => candidate === pair ? { ...candidate, ...change } : candidate))).toThrow("exact source pair");
      expect(() => verifyImageAssociationSourceSelection(pairs.filter(candidate => candidate !== pair))).toThrow("exact source pair");
    }
    expect(() => verifyImageAssociationSourceSelection([...pairs, { source: "third_party/medusa/upstream/unselected.ts", target: "packages/medusa-core-flows/src/unselected.ts", classification: pairs[0].classification }]))
      .toThrow("unselected closure");
  });
});

describe("native Admin Product Image batch source", () => {
  it.each([false, true])("retains the native POST and rejects missing parent or changed raw results (inverse=%s)", inverse => {
    const relative = inverse ? "[id]/images/[image_id]/variants/batch/route.ts" : "[id]/variants/[variant_id]/images/batch/route.ts";
    const native = readFileSync("third_party/medusa/upstream/packages/medusa/src/api/admin/products/" + relative, "utf8");
    const target = readFileSync("packages/medusa-http/src/api/admin/products/" + relative, "utf8");
    expect(() => verifyAdminProductImageBatchSource(native, target, inverse)).not.toThrow();
    for (const [before, after] of [["      product_id: req.params.id,", ""], ["await workflowEngine.run", "workflowEngine.run"],
      ["added: result.added", "added: []"], ["removed: result.removed", "removed: []"]]) {
      expect(target).toContain(before);
      expect(() => verifyAdminProductImageBatchSource(native, target.replace(before, after), inverse)).toThrow("Changed native Admin Product Image association route behavior");
    }
    expect(() => verifyAdminProductImageBatchSource(native, target + "\nglobalThis.imageHttpDrift = true", inverse)).toThrow("Changed native Admin Product Image association route behavior");
  });
});
