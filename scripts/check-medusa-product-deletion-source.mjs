// @ts-check
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const failure = "Changed parent-qualified native Product deletion source";
const workflow = "packages/medusa-core-flows/src/product/workflows/delete-product-options.ts";
const step = "packages/medusa-core-flows/src/product/steps/delete-product-options.ts";
const optionClassification = "parentQualifiedOptionDeletionFork";
export const optionDeletionSourcePairs = Object.freeze([
  { target: workflow, source: "third_party/medusa/upstream/packages/core/core-flows/src/product/workflows/delete-product-options.ts", classification: optionClassification },
  { target: step, source: "third_party/medusa/upstream/packages/core/core-flows/src/product/steps/delete-product-options.ts", classification: optionClassification },
]);
/** One declaration file has one owner for both approved selector overloads. */
export const productDeletionServiceSourcePair = Object.freeze({ target: "packages/medusa-types/src/product/service.ts",
  source: "third_party/medusa/upstream/packages/core/types/src/product/service.ts", classification: "parentQualifiedProductDeletionTypeFork" });
const pairs = [...optionDeletionSourcePairs, productDeletionServiceSourcePair];

/** Only the exact Option root/step and shared service declaration receive these
 * classifications. Variant runtime remains under its independent exact guard.
 * @param {readonly {source?: string, target: string, classification: string}[]} files */
export function verifyProductDeletionSourceSelection(files) {
  for (const pair of pairs) {
    const selected = files.filter(file => file.target === pair.target || file.source === pair.source);
    if (selected.length !== 1 || selected[0]?.target !== pair.target || selected[0]?.source !== pair.source ||
      selected[0]?.classification !== pair.classification) throw new Error(failure + ": exact source pair " + pair.target);
  }
  for (const file of files) {
    if (pairs.some(pair => pair.classification === file.classification) && !pairs.some(pair =>
      pair.target === file.target && pair.source === file.source && pair.classification === file.classification))
      throw new Error(failure + ": unselected closure " + file.target);
  }
}

/** @param {string} text @param {string} before @param {string} after */
function replace(text, before, after) {
  if (text.split(before).length !== 2) throw new Error(failure + ": adaptation anchor");
  return text.replace(before, after);
}

/** Preserve the full pinned source with only the two exact selector overloads,
 * or the approved scoped Option deletion. Unscoped requests do not query and
 * retain original ID order/duplicates. Scoped IDs feed the final parent
 * selector, hook, Link dispatch and events, retaining native mutation-before-
 * hook-before-parallel-dispatch order and ID-array compensation.
 * @param {string} source @param {string} target @param {string} destination */
export function verifyProductDeletionSource(source, target, destination) {
  if (!pairs.some(pair => pair.target === destination)) throw new Error(failure + ": unknown target");
  let expected = source.replaceAll("\r\n", "\n");
  if (destination === productDeletionServiceSourcePair.target) {
    for (const [method, ids] of [["softDeleteProductOptions", "optionIds"], ["softDeleteProductVariants", "variantIds"]]) {
      const original = `  ${method}<TReturnableLinkableKeys extends string = string>(
    ${ids}: string[],
    config?: SoftDeleteReturn<TReturnableLinkableKeys>,
    sharedContext?: Context
  ): Promise<Record<string, string[]> | void>`;
      expected = replace(expected, original, original + `

  /** Retain Product ownership in the trusted native deletion selector. */
  ${method}<TReturnableLinkableKeys extends string = string>(
    selector: { id: string[]; product_id: string },
    config?: SoftDeleteReturn<TReturnableLinkableKeys>,
    sharedContext?: Context
  ): Promise<Record<string, string[]> | void>`);
    }
    for (const method of ["addImageToVariant", "removeImageFromVariant"]) {
      expected = replace(expected, `  ${method}(\n    data: { image_id: string; variant_id: string }[],`,
        `  ${method}(\n    data: { image_id: string; variant_id: string; product_id?: string }[],`);
    }
  } else {
    expected = replace(expected, 'from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"');
    if (destination === step) {
      expected = replace(expected, 'from "@medusajs/framework/types"', 'from "@medusajs/types"');
      expected = replace(expected, 'from "@medusajs/framework/utils"', 'from "@medusajs/utils/modules-sdk/definition"');
      expected = replace(expected, "export type DeleteProductOptionsStepInput = string[]",
        "export type DeleteProductOptionsStepInput = string[] | { id: string[]; product_id: string }");
      expected = replace(expected, "  deleteProductOptionsStepId,", '  { name: deleteProductOptionsStepId, compensation: "transactionCovered" },');
      expected = replace(expected, "async (ids: DeleteProductOptionsStepInput, { container })", "async (input: DeleteProductOptionsStepInput, { container })");
      expected = replace(expected, "    await service.softDeleteProductOptions(ids)", `    const ids = Array.isArray(input) ? input : input.id
    if (Array.isArray(input)) {
      await service.softDeleteProductOptions(input)
    } else {
      await service.softDeleteProductOptions(input)
    }`);
    } else {
      expected = replace(expected, 'import { Modules, ProductOptionWorkflowEvents } from "@medusajs/framework/utils"',
        'import { Modules } from "@medusajs/utils/modules-sdk/definition"\nimport { ProductOptionWorkflowEvents } from "@medusajs/utils/core-flows/events"');
      expected = replace(expected, "  transform,\n", "  transform,\n  when,\n");
      expected = replace(expected, 'import { deleteProductOptionsStep } from "../steps"',
        'import { useQueryGraphStep } from "../../common/steps/use-query-graph"\nimport { deleteProductOptionsStep, type DeleteProductOptionsStepInput } from "../steps/delete-product-options"');
      expected = replace(expected, "  ids: string[]\n}", `  ids: string[]
  /** Restrict the complete deletion graph to options owned by this Product. */
  product_id?: string
}`);
      expected = replace(expected, '    const deletedProductOptions = deleteProductOptionsStep(input.ids)\n    const productOptionsDeleted = createHook("productOptionsDeleted", {\n      ids: input.ids,', `    const scopedOptions = when("query-option-deletion-parent", { input }, ({ input }) => input.product_id !== undefined).then(() =>
      useQueryGraphStep({
        entity: "product_option",
        fields: ["id"],
        filters: transform({ input }, ({ input }) => input.product_id === undefined
          ? { id: input.ids }
          : { id: input.ids, product_id: input.product_id }),
      })
    )
    const effectiveIds = transform({ input, scopedOptions }, ({ input, scopedOptions }) => {
      if (input.product_id === undefined) return input.ids
      const matchingIds = new Set(scopedOptions?.data.map(option => option.id))
      return input.ids.filter(id => matchingIds.has(id))
    })
    const optionDeletionInput = transform(
      { input, effectiveIds },
      ({ input, effectiveIds }): DeleteProductOptionsStepInput => input.product_id === undefined
        ? effectiveIds
        : { id: effectiveIds, product_id: input.product_id }
    )
    const deletedProductOptions = deleteProductOptionsStep(optionDeletionInput)
    const productOptionsDeleted = createHook<"productOptionsDeleted", Pick<DeleteProductOptionsWorkflowInput, "ids">>("productOptionsDeleted", {
      ids: effectiveIds,`);
      expected = replace(expected, "transform({ input }, ({ input }) => {\n      return input.ids?.map((id) => {", "transform({ effectiveIds }, ({ effectiveIds }) => {\n      return effectiveIds?.map((id) => {");
      expected = replace(expected, "[Modules.PRODUCT]: { product_option_id: input.ids }", "[Modules.PRODUCT]: { product_option_id: effectiveIds }");
    }
  }
  if (expected !== target.replaceAll("\r\n", "\n")) throw new Error(failure + ": complete source " + destination);
}

/** The central promotion guard authenticates pinned source bytes before calling
 * this full-source comparison. @param {string} root */
export function verifyProductDeletionFiles(root) {
  for (const pair of pairs) verifyProductDeletionSource(readFileSync(path.join(root, pair.source), "utf8"),
    readFileSync(path.join(root, pair.target), "utf8"), pair.target);
  return { sourcePairs: pairs.length };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = verifyProductDeletionFiles(process.cwd());
  process.stdout.write(`Verified ${result.sourcePairs} parent-qualified native Product deletion source pairs.\n`);
}
