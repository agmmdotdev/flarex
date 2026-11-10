// @ts-check
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "@typescript/typescript6";

const failure = "Changed parent-qualified native Image association source";
const root = "packages/medusa-core-flows/src/product/";
const sourceRoot = "third_party/medusa/upstream/packages/core/core-flows/src/product/";
const serviceTarget = "packages/medusa-product/src/services/product-module-service.ts";
const typeTarget = "packages/medusa-product/src/types/index.ts";
const files = ["workflows/batch-variant-images.ts", "workflows/batch-image-variants.ts",
  "steps/add-images-to-variant.ts", "steps/remove-images-from-variant.ts", "steps/add-image-to-variants.ts", "steps/remove-image-from-variants.ts"];
export const imageAssociationSourcePairs = Object.freeze([
  ...files.map(file => ({ source: sourceRoot + file, target: root + file, classification: "parentQualifiedImageAssociationFork" })),
  { source: "third_party/medusa/upstream/packages/modules/product/src/types/index.ts", target: typeTarget, classification: "parentQualifiedImageAssociationTypeFork" },
  // Retain the existing broader Product service fork and guard only this seam.
  { source: "third_party/medusa/upstream/packages/modules/product/src/services/product-module-service.ts", target: serviceTarget, classification: "productServiceFork" },
]);

/** @param {readonly {source?: string, target: string, classification: string}[]} selected */
export function verifyImageAssociationSourceSelection(selected) {
  for (const pair of imageAssociationSourcePairs) {
    const entries = selected.filter(file => file.target === pair.target || file.source === pair.source);
    if (entries.length !== 1 || entries[0]?.source !== pair.source || entries[0]?.target !== pair.target || entries[0]?.classification !== pair.classification)
      throw new Error(failure + ": exact source pair " + pair.target);
  }
  for (const file of selected) {
    if (["parentQualifiedImageAssociationFork", "parentQualifiedImageAssociationTypeFork"].includes(file.classification) &&
      !imageAssociationSourcePairs.some(pair => pair.target === file.target && pair.source === file.source && pair.classification === file.classification))
      throw new Error(failure + ": unselected closure " + file.target);
  }
}

/** @param {string} text @param {string} before @param {string} after @param {number} [count] */
function replace(text, before, after, count = 1) {
  if (text.split(before).length !== count + 1) throw new Error(failure + ": adaptation anchor " + before);
  return text.replaceAll(before, after);
}
/** Compare all tokens including declarations; comments and formatting grant no
 * permission to change algorithms, imports, parent types or module effects.
 * @param {string} text */
function tokens(text) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  const result = [];
  while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) result.push(scanner.getTokenText());
  return JSON.stringify(result);
}
/** @param {string} text @param {string} name */
function method(text, name) {
  const parsed = ts.createSourceFile("product.ts", text, ts.ScriptTarget.Latest, true);
  const owners = parsed.statements.filter(ts.isClassDeclaration).filter(declaration => declaration.name?.text === "ProductModuleService");
  if (owners.length !== 1) throw new Error(failure + ": exact native service owner");
  const members = owners[0].members
    .filter(member => ts.isMethodDeclaration(member) && member.name.getText(parsed) === name);
  if (members.length !== 1) throw new Error(failure + ": exact native method " + name);
  return members[0].getText(parsed);
}

const parentHelper = `private async prepareVariantImagePairs_(
    data: VariantImageInputArray,
    sharedContext: Context
  ): Promise<VariantImageInputArray> {
    const pairs = Array.isArray(data) ? data : [data]
    const groups = new Map<string, VariantImageInputArray>()
    for (const pair of pairs) {
      if (pair.product_id === undefined) continue
      const group = groups.get(pair.product_id) ?? []
      group.push(pair)
      groups.set(pair.product_id, group)
    }
    if (groups.size === 0) return data
    for (const [productId, group] of groups) {
      const images = await this.productImageService_.list(
        { id: Array.from(new Set(group.map(pair => pair.image_id))), product_id: productId },
        { select: ["id", "product_id"] }, sharedContext
      )
      const variants = await this.productVariantService_.list(
        { id: Array.from(new Set(group.map(pair => pair.variant_id))), product_id: productId },
        { select: ["id", "product_id"] }, sharedContext
      )
      const imageIds = new Set(images.map(image => image.id))
      const variantIds = new Set(variants.map(variant => variant.id))
      if (group.some(pair => !imageIds.has(pair.image_id) || !variantIds.has(pair.variant_id))) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA,
          "Product Image and Variant must belong to the specified Product")
      }
    }
    return pairs.map(({ product_id, ...pair }) => pair)
  }`;

/** Whole native workflow/step/type, or the exact two service methods and their
 * single helper. Other existing Product service adaptations retain their owner.
 * @param {string} source @param {string} target @param {string} destination */
export function verifyImageAssociationSource(source, target, destination) {
  if (!imageAssociationSourcePairs.some(pair => pair.target === destination)) throw new Error(failure + ": unknown target");
  let expected = source.replaceAll("\r\n", "\n");
  if (destination === serviceTarget) {
    const add = replace(replace(method(expected, "addImageToVariant_"),
      "    // TODO: consider validation that image and variant are on the same product",
      "    const pairs = await this.prepareVariantImagePairs_(data, sharedContext)"),
    "this.productVariantProductImageService_.create(data, sharedContext)", "this.productVariantProductImageService_.create(pairs, sharedContext)");
    const remove = replace(method(expected, "removeImageFromVariant_"),
      "const pairs = Array.isArray(data) ? data : [data]", "const validatedData = await this.prepareVariantImagePairs_(data, sharedContext)\n    const pairs = Array.isArray(validatedData) ? validatedData : [validatedData]");
    if (tokens(add) !== tokens(method(target, "addImageToVariant_")) || tokens(remove) !== tokens(method(target, "removeImageFromVariant_")) ||
      tokens(parentHelper) !== tokens(method(target, "prepareVariantImagePairs_"))) throw new Error(failure + ": native service seam");
    return;
  }
  if (destination === typeTarget) {
    expected = replace(expected, "export type VariantImageInput = {\n  image_id: string\n  variant_id: string\n}",
      "export type VariantImageInput = {\n  image_id: string\n  variant_id: string\n  product_id?: string\n}");
  } else {
    expected = replace(expected, 'from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"');
    if (destination.includes("/steps/")) {
      expected = replace(expected, 'from "@medusajs/framework/types"', 'from "@medusajs/types"');
      expected = replace(expected, 'from "@medusajs/framework/utils"', 'from "@medusajs/utils/modules-sdk/definition"');
      const variant = destination.endsWith("images-to-variant.ts") || destination.endsWith("images-from-variant.ts");
      const primary = variant ? "variant_id" : "image_id";
      const action = destination.includes("/add-") ? "add" : "remove";
      const result = action === "add" ? "added" : "removed";
      const id = variant ? action === "add" ? "addImagesToVariantStepId" : "removeImagesFromVariantStepId"
        : action === "add" ? "addImageToVariantsStepId" : "removeImageFromVariantsStepId";
      expected = replace(expected, `  ${id},`, `  { name: ${id}, compensation: "transactionCovered" },`);
      expected = replace(expected, `input: { ${primary}: string; ${action}: string[] }`, `input: { ${primary}: string; ${action}: string[]; product_id?: string }`);
      expected = replace(expected, `compensationData: { ${result}: string[]; ${primary}: string }`, `compensationData: { ${result}: string[]; ${primary}: string; product_id?: string }`);
      expected = replace(expected, `new StepResponse([], { ${result}: [], ${primary}: input.${primary} })`,
        `new StepResponse([], { ${result}: [], ${primary}: input.${primary}, ...(input.product_id === undefined ? {} : { product_id: input.product_id }) })`);
      expected = replace(expected, `      ${primary}: input.${primary},`,
        `      ${primary}: input.${primary},\n      ...(input.product_id === undefined ? {} : { product_id: input.product_id }),`, 2);
      expected = replace(expected, `      ${primary}: compensationData.${primary},`,
        `      ${primary}: compensationData.${primary},\n      ...(compensationData.product_id === undefined ? {} : { product_id: compensationData.product_id }),`);
    } else {
      const forward = destination.endsWith("batch-variant-images.ts");
      const primary = forward ? "variant_id" : "image_id";
      const primaryVariable = forward ? "variantId" : "imageId";
      const primaryFilter = forward ? "variantFilter" : "imageFilter";
      const selectorName = forward ? "variantSelector" : "imageSelector";
      const removalFilter = forward ? "removedImagesFilter" : "variantsFilter";
      const interfaceName = forward ? "BatchVariantImagesWorkflowInput" : "BatchImageVariantsWorkflowInput";
      const add = forward ? "addImagesToVariantStep" : "addImageToVariantsStep";
      const remove = forward ? "removeImagesFromVariantStep" : "removeImageFromVariantsStep";
      expected = replace(expected, `import {\n  ${add},\n  ${remove},\n  updateProductVariantsStep,\n} from "../steps"`,
        `import { ${add} } from "../steps/${forward ? "add-images-to-variant" : "add-image-to-variants"}"\nimport { ${remove} } from "../steps/${forward ? "remove-images-from-variant" : "remove-image-from-variants"}"\nimport { updateProductVariantsStep } from "../steps/update-product-variants"`);
      expected = replace(expected, 'from "../../common"', 'from "../../common/steps/use-query-graph"');
      expected = replace(expected, `export interface ${interfaceName} {`, `export interface ${interfaceName} {\n  /** Constrain every association and thumbnail mutation to this Product. */\n  product_id?: string`);
      expected = replace(expected, `        ${primary}: data.input.${primary},`, `        ${primary}: data.input.${primary},\n        ...(data.input.product_id === undefined ? {} : { product_id: data.input.product_id }),`);
      const selector = `        ${selectorName}: {\n          id: data.input.${primary},\n          ...(data.input.product_id === undefined ? {} : { product_id: data.input.product_id }),\n        },`;
      const removals = `        ${removalFilter}: {\n          id: data.input.remove ?? [],\n          ...(data.input.product_id === undefined ? {} : { product_id: data.input.product_id }),\n        },`;
      expected = replace(expected, "        remove: data.input.remove ?? [],",
        "        remove: data.input.remove ?? [],\n" + (forward ? selector + "\n" + removals : removals + "\n" + selector));
      // Retain the pre-existing scalar extractor's callback/capture boundary,
      // now returning its complete filter. Added parent constraints must not
      // insert unconditional transform callbacks into unscoped execution.
      expected = replace(expected, `      const ${primaryVariable} = transform({ normalizedInput }, (data) => {\n        return data.normalizedInput.${primary}\n      })`,
        `      const ${primaryFilter} = transform({ normalizedInput }, (data) => {\n        return data.normalizedInput.${selectorName}\n      })`);
      expected = replace(expected, `        filters: {\n          id: ${primaryVariable},\n        },`,
        `        filters: ${primaryFilter},`);
      expected = replace(expected, "        filters: {\n          id: normalizedInput.remove,\n        },",
        `        filters: normalizedInput.${removalFilter},`);
      if (forward) {
        expected = replace(expected, "  parallelize,\n", "");
        expected = replace(expected, 'import { ProductVariantDTO } from "@medusajs/types"', 'import { WorkflowDefinitionError } from "@medusajs/workflows-sdk"');
        expected = replace(expected, `    const res = parallelize(\n      ${add}(normalizedInput),\n      ${remove}(normalizedInput)\n    )`,
          `    // Native fork: one transaction executes add, then remove in source order.\n    const res = [\n      ${add}(normalizedInput),\n      ${remove}(normalizedInput),\n    ]`);
        expected = replace(expected, "          return !!urls.includes((data.variant as ProductVariantDTO).thumbnail)", `          if (data.variant === undefined) {
            throw new WorkflowDefinitionError({ reason: "invalidDefinition", detail: "Cannot check the thumbnail of a missing variant" })
          }
          return urls.includes(data.variant.thumbnail)`);
        expected = replace(expected, "selector: { id: input.variant_id },", "selector: normalizedInput.variantSelector,");
      } else {
        expected = replace(expected, 'import { ProductTypes } from "@medusajs/framework/types"', 'import type { ProductTypes } from "@medusajs/types"');
        expected = replace(expected, "          image: image,", "          image: image,\n          normalizedInput,");
        expected = replace(expected, "              id: normalizedInput.remove,", "              id: data.normalizedInput.remove,\n              ...(data.normalizedInput.product_id === undefined ? {} : { product_id: data.normalizedInput.product_id }),");
      }
    }
  }
  if (tokens(expected) !== tokens(target)) throw new Error(failure + ": complete source " + destination);
}

/** Central promotion authenticates source hashes before these comparisons.
 * @param {string} repoRoot */
export function verifyImageAssociationFiles(repoRoot) {
  for (const pair of imageAssociationSourcePairs) verifyImageAssociationSource(readFileSync(path.join(repoRoot, pair.source), "utf8"),
    readFileSync(path.join(repoRoot, pair.target), "utf8"), pair.target);
  return { sourcePairs: imageAssociationSourcePairs.length };
}
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = verifyImageAssociationFiles(process.cwd());
  process.stdout.write(`Verified ${result.sourcePairs} parent-qualified native Image association source pairs.\n`);
}
