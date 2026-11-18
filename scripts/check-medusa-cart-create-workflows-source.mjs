// @ts-check
import ts from "@typescript/typescript6";
import { readFileSync } from "node:fs";
import { adaptCartCreateDeclarations } from "./check-medusa-cart-create-declarations.mjs";
const core = ["cart/utils/schemas.ts", "cart/workflows/create-carts.ts", "cart/workflows/update-tax-lines.ts", "cart/workflows/update-cart-promotions.ts",
  ...["set-tax-lines-for-items", "create-line-item-adjustments", "create-shipping-method-adjustments", "remove-line-item-adjustments",
    "remove-shipping-method-adjustments", "get-actions-to-compute-from-promotions", "get-promotion-codes-to-apply",
    "prepare-adjustments-from-promotion-actions"].map(name => "cart/steps/" + name + ".ts"),
  "common/steps/get-translated-tax-lines.ts", "common/steps/get-translated-line-items.ts", "common/utils/apply-translations-to-items.ts"];
export const cartCreateWorkflowSourcePairs = Object.freeze([
  ...core.map(file => ({ source: "third_party/medusa/upstream/packages/core/core-flows/src/" + file,
    target: "packages/medusa-core-flows/src/" + file, classification: "cartCreationWorkflowFork" })),
  ...["apply-translations", "apply-translations-to-tax-lines"].map(name => ({
    source: "third_party/medusa/upstream/packages/core/utils/src/translations/" + name + ".ts",
    target: "packages/medusa-utils/src/translations/" + name + ".ts", classification: "cartCreationWorkflowFork" })),
  { source: "third_party/medusa/upstream/packages/modules/link-modules/src/definitions/readonly/cart-shipping-option.ts",
    target: "packages/medusa-link-modules/src/definitions/readonly/cart-shipping-option.ts", classification: "cartCreationWorkflowFork" },
]);
const stepFiles = new Map([
  ["createCartsStep", "create-carts"], ["findOneOrAnyRegionStep", "find-one-or-any-region"],
  ["findOrCreateCustomerStep", "find-or-create-customer"], ["findSalesChannelStep", "find-sales-channel"],
  ["validateCartStep", "validate-cart"], ["setTaxLinesForItemsStep", "set-tax-lines-for-items"],
  ["createLineItemAdjustmentsStep", "create-line-item-adjustments"], ["createShippingMethodAdjustmentsStep", "create-shipping-method-adjustments"],
  ["getActionsToComputeFromPromotionsStep", "get-actions-to-compute-from-promotions"], ["getPromotionCodesToApply", "get-promotion-codes-to-apply"],
  ["prepareAdjustmentsFromPromotionActionsStep", "prepare-adjustments-from-promotion-actions"],
  ["removeLineItemAdjustmentsStep", "remove-line-item-adjustments"], ["removeShippingMethodAdjustmentsStep", "remove-shipping-method-adjustments"],
]);
/** Exact import relocation and the existing atomic compensation declaration.
 * Pinned native callback bodies, including disabled translation branches,
 * remain complete and unchanged.
 * @param {string} source @param {string} target */
export function expectedCartCreateWorkflow(source, target) {
  const pair = cartCreateWorkflowSourcePairs.find(pair => pair.target === target);
  if (pair === undefined) throw new Error("Unselected native Cart creation workflow");
  const text = source.replaceAll("\r\n", "\n");
  const parsed = ts.createSourceFile(target, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  let result = text;
  for (const node of [...parsed.statements].reverse()) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
    const specifier = node.moduleSpecifier.text, clause = node.importClause;
    const names = clause?.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)
      ? clause.namedBindings.elements.map(element => element.getText(parsed)) : [];
    let replacement;
    if (specifier === "@medusajs/framework/zod") replacement = node.getText(parsed).replace(specifier, "@medusajs/deps/zod");
    else if (specifier === "@medusajs/framework/workflows-sdk") replacement = node.getText(parsed).replace(specifier, "@medusajs/workflows-sdk");
    else if (specifier === "@medusajs/framework/utils") {
      const translations = names.filter(name => ["applyTranslations", "applyTranslationsToTaxLines"].includes(name));
      if (!translations.length) replacement = node.getText(parsed).replace(specifier, "@medusajs/framework/utils/portable");
      else replacement = [
        ...translations.map(name => `import { ${name} } from "@medusajs/utils/translations/${name === "applyTranslations" ? "apply-translations" : "apply-translations-to-tax-lines"}"`),
        `import { ${names.filter(name => !translations.includes(name)).join(", ")} } from "@medusajs/framework/utils/portable"`,
      ].join("\n");
    } else if (specifier === "../steps") replacement = names.map(name => {
      const file = stepFiles.get(name);
      if (file === undefined) throw new Error("Unselected Cart step barrel member");
      return `import { ${name} } from "../steps/${file}"`;
    }).join("\n");
    else if (specifier === "../../common") replacement = names.map(name => {
      const file = name === "useQueryGraphStep" ? "use-query-graph" : name === "getTranslatedLineItemsStep" ? "get-translated-line-items" : undefined;
      if (file === undefined) throw new Error("Unselected Cart common member");
      return `import { ${name} } from "../../common/steps/${file}"`;
    }).join("\n");
    else if (specifier === "../../locking") replacement = names.map(name => {
      const file = name === "acquireLockStep" ? "acquire-lock" : name === "releaseLockStep" ? "release-lock" : undefined;
      if (file === undefined) throw new Error("Unselected Cart lock member");
      return `import { ${name} } from "../../locking/steps/${file}"`;
    }).join("\n");
    if (replacement !== undefined) result = result.slice(0, node.getStart(parsed)) + replacement + result.slice(node.end);
  }
  const covered = new Map([["set-tax-lines-for-items", "setTaxLinesForItemsStepId"], ["create-line-item-adjustments", "createLineItemAdjustmentsStepId"],
    ["create-shipping-method-adjustments", "createShippingMethodAdjustmentsStepId"], ["remove-line-item-adjustments", "removeLineItemAdjustmentsStepId"], ["remove-shipping-method-adjustments", "removeShippingMethodAdjustmentsStepId"]]);
  for (const [file, id] of covered) if (target.endsWith("/steps/" + file + ".ts")) {
    const anchor = "  " + id + ",";
    if (result.split(anchor).length !== 2) throw new Error("Changed transaction-covered native Cart step");
    result = result.replace(anchor, "  { name: " + id + ", compensation: \"transactionCovered\" },");
  }
  if (target.endsWith("/cart/utils/schemas.ts")) result = result.replace(
    "export const pricingContextResult = z.record(z.string(), z.any()).optional()",
    'export { nativePricingContextResult as pricingContextResult } from "@medusajs/workflows-sdk"');
  if (target.endsWith("/cart/workflows/update-tax-lines.ts")) result = result.replace('  "shipping_address.region_code",\n', "");
  if (target.endsWith("/cart/workflows/create-carts.ts")) {
    if (result.split("  createWorkflow,\n").length !== 2 || result.split("  createCartWorkflowId,\n").length !== 2)
      throw new Error("Changed native Cart construction profile anchor");
    result = result.replace("  createWorkflow,\n", "  createWorkflow,\n  nativeCartCreationProfile,\n")
      .replace("  createCartWorkflowId,\n", "  { name: createCartWorkflowId, constructionProfile: nativeCartCreationProfile },\n");
  }
  const adapted = adaptCartCreateDeclarations(result, target);
  // Normalize only inherited blank/comment trailing spaces in these pinned leaves.
  return target.endsWith("/cart/steps/get-actions-to-compute-from-promotions.ts") ||
    target.endsWith("/common/steps/get-translated-tax-lines.ts") ? adapted.replace(/[ \t]+$/gm, "") : adapted;
}
/** Verify the exact extracted native validator declaration independently of
 * its inert public marker. @param {string} source @param {string} target */
export function verifyNativePricingContextExtraction(source, target) {
  const native = ts.createSourceFile("native-cart-schemas.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const portable = ts.createSourceFile("native-pricing-context.ts", target, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  /** @param {import("@typescript/typescript6").SourceFile} parsed @param {string} name */
  const initializer = (parsed, name) => {
    const declarations = parsed.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations])
      .filter(node => ts.isIdentifier(node.name) && node.name.text === name);
    if (declarations.length !== 1 || declarations[0]?.initializer === undefined) throw new Error("Changed native pricing validator declaration");
    return declarations[0].initializer.getText(parsed);
  };
  if (initializer(native, "pricingContextResult") !== initializer(portable, "schema")) throw new Error("Changed extracted native pricing validator");
}
/** @param {string} source @param {string} target @param {string} file */
export function verifyCartCreateWorkflowSource(source, target, file) {
  if (file.endsWith("/cart/utils/schemas.ts")) verifyNativePricingContextExtraction(source,
    readFileSync(new URL("../packages/medusa-workflows-sdk/src/native-pricing-context.ts", import.meta.url), "utf8"));
  if (expectedCartCreateWorkflow(source, file).trim() !== target.replaceAll("\r\n", "\n").trim())
    throw new Error("Changed native Cart creation workflow program");
}
/** @param {readonly {source?: string;target:string;classification:string}[]} files */
export function verifyCartCreateWorkflowSelection(files) {
  for (const pair of cartCreateWorkflowSourcePairs) {
    const matches = files.filter(file => file.target === pair.target || file.source === pair.source);
    if (matches.length !== 1 || matches[0]?.target !== pair.target || matches[0]?.source !== pair.source || matches[0]?.classification !== pair.classification)
      throw new Error("Redirected native Cart creation workflow source");
  }
  for (const file of files) {
    if (file.classification === "cartCreationWorkflowFork" && !cartCreateWorkflowSourcePairs.some(pair =>
      pair.source === file.source && pair.target === file.target && pair.classification === file.classification))
      throw new Error("Unselected native Cart creation workflow source");
  }
}
