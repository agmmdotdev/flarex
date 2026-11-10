// @ts-check
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const failure = "Changed parent-qualified native Variant deletion source";
const classification = "parentQualifiedVariantDeletionFork";
const workflow = "packages/medusa-core-flows/src/product/workflows/delete-product-variants.ts";
const step = "packages/medusa-core-flows/src/product/steps/delete-product-variants.ts";

export const variantDeletionSourcePairs = Object.freeze([
  { target: workflow, source: "third_party/medusa/upstream/packages/core/core-flows/src/product/workflows/delete-product-variants.ts", classification },
  { target: step, source: "third_party/medusa/upstream/packages/core/core-flows/src/product/steps/delete-product-variants.ts", classification },
]);

/** The approved selector correction belongs only to this native root and step.
 * The shared Product service declaration has its own exact overload owner.
 * @param {readonly {source?: string, target: string, classification: string}[]} files */
export function verifyVariantDeletionSourceSelection(files) {
  for (const pair of variantDeletionSourcePairs) {
    const selected = files.filter(file => file.target === pair.target || file.source === pair.source);
    if (selected.length !== 1 || selected[0]?.target !== pair.target || selected[0]?.source !== pair.source ||
      selected[0]?.classification !== pair.classification) throw new Error(failure + ": exact source pair " + pair.target);
  }
  for (const file of files) {
    if (file.classification === classification && !variantDeletionSourcePairs.some(pair =>
      pair.target === file.target && pair.source === file.source && pair.classification === file.classification))
      throw new Error(failure + ": unselected closure " + file.target);
  }
}

/** @param {string} text @param {string} before @param {string} after */
function replace(text, before, after) {
  if (text.split(before).length !== 2) throw new Error(failure + ": adaptation anchor");
  return text.replace(before, after);
}

/** Preserve the complete native program except the approved parent-qualified
 * selection. The unscoped branch retains requested IDs, including duplicate or
 * absent IDs, while scoped cascade, Inventory, final mutation, events and hook
 * consume effective IDs. Final mutation retains the Product; compensation is
 * still its corresponding ID array under the existing transaction owner.
 * @param {string} source @param {string} target @param {string} destination */
export function verifyVariantDeletionSource(source, target, destination) {
  if (!variantDeletionSourcePairs.some(pair => pair.target === destination)) throw new Error(failure + ": unknown target");
  let expected = source.replaceAll("\r\n", "\n");
    expected = replace(expected, 'from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"');
    expected = replace(expected, 'from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"');
    if (destination === step) {
      expected = replace(expected, "export type DeleteProductVariantsStepInput = string[]",
        "export type DeleteProductVariantsStepInput = string[] | { id: string[]; product_id: string }");
      expected = replace(expected, "  deleteProductVariantsStepId,", '  { name: deleteProductVariantsStepId, compensation: "transactionCovered" },');
      expected = replace(expected, "async (ids: DeleteProductVariantsStepInput, { container })", "async (input: DeleteProductVariantsStepInput, { container })");
      expected = replace(expected, "    await service.softDeleteProductVariants(ids)", `    const ids = Array.isArray(input) ? input : input.id
    if (Array.isArray(input)) {
      await service.softDeleteProductVariants(input)
    } else {
      await service.softDeleteProductVariants(input)
    }`);
    } else {
      expected = replace(expected, `import {
  emitEventStep,
  removeRemoteLinkStep,
  useQueryGraphStep,
} from "../../common"`, `import { emitEventStep } from "../../common/steps/emit-event"
import { removeRemoteLinkStep } from "../../common/steps/remove-remote-links"
import { useQueryGraphStep } from "../../common/steps/use-query-graph"
import { deletionVariantRows } from "./product-deletion-query"`);
      expected = replace(expected, 'import { deleteProductVariantsStep } from "../steps"',
        'import { deleteProductVariantsStep, type DeleteProductVariantsStepInput } from "../steps/delete-product-variants"');
      expected = replace(expected, 'from "../../inventory"', 'from "../../inventory/workflows/delete-inventory-items"');
      expected = replace(expected, "  ids: string[]\n}", `  ids: string[]
  /** Restrict the complete deletion graph to variants owned by this Product. */
  product_id?: string
}`);
      expected = replace(expected, "const variantsWithInventoryStepResponse = useQueryGraphStep({", "const variantsWithInventoryStepResponse = transform(useQueryGraphStep({");
      expected = replace(expected, `      filters: {
        id: input.ids,
      },
    })`, `      filters: transform({ input }, ({ input }) => input.product_id === undefined
        ? { id: input.ids }
        : { id: input.ids, product_id: input.product_id }),
    }), response => ({ ...response, data: deletionVariantRows(response.data) }))

    const effectiveIds = transform(
      { input, variants: variantsWithInventoryStepResponse.data },
      ({ input, variants }) => {
        if (input.product_id === undefined) return input.ids
        const matchingIds = new Set(variants.map(variant => variant.id))
        return input.ids.filter(id => matchingIds.has(id))
      }
    )`);
      expected = replace(expected, "[Modules.PRODUCT]: { variant_id: input.ids }", "[Modules.PRODUCT]: { variant_id: effectiveIds }");
      expected = replace(expected, "{ variants: variantsWithInventoryStepResponse.data },", "{ input, effectiveIds, variants: variantsWithInventoryStepResponse.data },");
      expected = replace(expected, "        const variants = data.variants || []", `        const variants = data.input.product_id === undefined
          ? data.variants || []
          : (data.variants || []).filter(variant => data.effectiveIds.includes(variant.id))`);
      expected = replace(expected, "    const deletedProductVariants = deleteProductVariantsStep(input.ids)", `    const variantDeletionInput = transform(
      { input, effectiveIds },
      ({ input, effectiveIds }): DeleteProductVariantsStepInput => input.product_id === undefined
        ? effectiveIds
        : { id: effectiveIds, product_id: input.product_id }
    )
    const deletedProductVariants = deleteProductVariantsStep(variantDeletionInput)`);
      expected = replace(expected, "transform({ input }, ({ input }) => {\n      return input.ids?.map((id) => {", "transform({ effectiveIds }, ({ effectiveIds }) => {\n      return effectiveIds?.map((id) => {");
      expected = replace(expected, 'createHook("productVariantsDeleted", {\n      ids: input.ids,', 'createHook("productVariantsDeleted", {\n      ids: effectiveIds,');
    }
  if (expected !== target.replaceAll("\r\n", "\n")) throw new Error(failure + ": complete source " + destination);
}

/** Source bytes are authenticated by the promotion manifest's existing pin
 * before this complete comparison runs in the central guard.
 * @param {string} root */
export function verifyVariantDeletionFiles(root) {
  for (const pair of variantDeletionSourcePairs) verifyVariantDeletionSource(readFileSync(path.join(root, pair.source), "utf8"),
    readFileSync(path.join(root, pair.target), "utf8"), pair.target);
  return { sourcePairs: variantDeletionSourcePairs.length };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = verifyVariantDeletionFiles(process.cwd());
  process.stdout.write(`Verified ${result.sourcePairs} parent-qualified native Variant deletion source pairs.\n`);
}
