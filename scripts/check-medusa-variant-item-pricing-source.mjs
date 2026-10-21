// @ts-check
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "@typescript/typescript6";

const failure = "Changed native Variant Item pricing source";
const nativePrefix = "third_party/medusa/upstream/";
/** Exact executing owners. The enclosing promotion verifier authenticates the
 * immutable source manifest and each pair's classification separately. */
export const variantItemPricingSourcePairs = [
  ...["cart/workflows/get-variants-and-items-with-prices.ts", "cart/steps/get-variant-price-sets.ts",
    "cart/utils/fields.ts", "cart/utils/prepare-line-item-data.ts"].map(file => ({
    source: nativePrefix + "packages/core/core-flows/src/" + file,
    target: "packages/medusa-core-flows/src/" + file,
  })),
  ...["cart/mutations.ts", "cart/workflows.ts", "customer/common.ts", "workflow/order/items.ts"].map(file => ({
    source: nativePrefix + "packages/core/types/src/" + file,
    target: "packages/medusa-types/src/" + file,
  })),
  { source: nativePrefix + "packages/core/utils/src/common/filter-object-by-keys.ts",
    target: "packages/medusa-utils/src/common/filter-object-by-keys.ts" },
  { source: nativePrefix + "packages/modules/link-modules/src/definitions/readonly/inventory-level-stock-location.ts",
    target: "packages/medusa-link-modules/src/definitions/readonly/inventory-level-stock-location.ts" },
];

/** A selected native statement joins an existing authored row-selector leaf;
 * this is not a whole-repository promotion or a whole-leaf native claim. */
export const variantItemPricingRequiredCurrencySource = Object.freeze({
  source: nativePrefix + "packages/modules/pricing/src/repositories/pricing.ts",
  target: "packages/medusa-pricing/src/calculation/select-rows.ts",
  nativeClass: "PricingRepository", nativeMethod: "calculatePrices", exportedFunction: "validatePricingCurrencyCode",
});

/** Never normalize an absent or duplicated adaptation anchor silently.
 * @param {string} text @param {string} before @param {string} after */
function replaceChecked(text, before, after) {
  if (text.split(before).length !== 2) throw new Error(failure + ": adaptation anchor");
  return text.replace(before, after);
}

/** Use the established complete typed/emitted AST comparison. This retains
 * operators, declaration modifiers, property order, imports and type ownership;
 * comments and printer layout do not supply authority.
 * @param {string} text @param {boolean} includeTypes */
function authorityProgram(text, includeTypes = true) {
  const emitted = ts.transpileModule(text, { reportDiagnostics: true, compilerOptions: {
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, removeComments: true,
    newLine: ts.NewLineKind.LineFeed, moduleDetection: ts.ModuleDetectionKind.Force,
  } });
  if (emitted.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error))
    throw new Error(failure + ": syntax");
  /** @param {ts.Node} node @returns {unknown} */
  const shape = node => {
    /** @type {unknown[]} */ const children = [];
    ts.forEachChild(node, child => { children.push(shape(child)); });
    return [node.kind, ts.isIdentifier(node) || ts.isLiteralExpression(node) ? node.text : undefined,
      ts.isVariableDeclarationList(node) ? node.flags & ts.NodeFlags.BlockScoped : undefined,
      ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node) ? node.operator : undefined,
      ts.isTemplateLiteralToken(node) ? node.rawText : undefined,
      ts.isMetaProperty(node) ? node.keywordToken : undefined,
      ts.isImportAttributes(node) ? node.token : undefined,
      ts.isImportClause(node) || ts.isImportSpecifier(node) || ts.isExportDeclaration(node) || ts.isExportSpecifier(node)
        ? node.isTypeOnly : undefined, children];
  };
  const emittedShape = shape(ts.createSourceFile("native159.js", emitted.outputText, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS));
  return JSON.stringify(includeTypes ? [
    shape(ts.createSourceFile("native159.ts", text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)), emittedShape,
  ] : emittedShape);
}

/** Preserve the exact native truthiness, error instance/type and message at the
 * existing pure selection leaf. Only the new function's erased signature is
 * authored; its complete executing statement comes from the pinned method.
 * @param {string} source @param {string} actual */
export function verifyNativeRequiredCurrencyGuard(source, actual) {
  const owner = variantItemPricingRequiredCurrencySource;
  const native = ts.createSourceFile("native-pricing.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const classes = native.statements.filter(node => ts.isClassDeclaration(node) && node.name?.text === owner.nativeClass);
  const nativeClass = classes[0];
  if (classes.length !== 1 || nativeClass === undefined || !ts.isClassDeclaration(nativeClass)) throw new Error(failure + ": currency native class");
  const methods = nativeClass.members.filter(node => ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === owner.nativeMethod);
  const method = methods[0];
  if (methods.length !== 1 || method === undefined || !ts.isMethodDeclaration(method) || method.body === undefined)
    throw new Error(failure + ": currency native method");
  const currencyDeclarations = method.body.statements.map((node, index) => ({ node, index })).filter(({ node }) =>
    ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration =>
      ts.isIdentifier(declaration.name) && declaration.name.text === "currencyCode"));
  const selected = currencyDeclarations[0];
  const deletion = selected === undefined ? undefined : method.body.statements[selected.index + 1];
  const guard = selected === undefined ? undefined : method.body.statements[selected.index + 2];
  if (currencyDeclarations.length !== 1 || selected === undefined || deletion === undefined || guard === undefined || !ts.isIfStatement(guard) ||
    authorityProgram(selected.node.getText(native)) !== authorityProgram("const currencyCode = context.currency_code") ||
    authorityProgram(deletion.getText(native)) !== authorityProgram("delete context.currency_code"))
    throw new Error(failure + ": currency native extraction");
  const target = ts.createSourceFile("selection.ts", actual, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const definitions = target.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === owner.exportedFunction);
  const definition = definitions[0];
  const imports = target.statements.filter(ts.isImportDeclaration).filter(node => node.importClause?.namedBindings !== undefined &&
    ts.isNamedImports(node.importClause.namedBindings) && node.importClause.namedBindings.elements.some(specifier =>
      specifier.name.text === "MedusaError" || specifier.propertyName?.text === "MedusaError"));
  const imported = imports[0];
  const specifiers = imported?.importClause?.namedBindings !== undefined && ts.isNamedImports(imported.importClause.namedBindings)
    ? imported.importClause.namedBindings.elements.filter(node => node.name.text === "MedusaError" || node.propertyName?.text === "MedusaError") : [];
  const specifier = specifiers[0];
  if (definitions.length !== 1 || definition === undefined || imports.length !== 1 || imported === undefined ||
    !ts.isStringLiteral(imported.moduleSpecifier) || imported.moduleSpecifier.text !== "@medusajs/framework/utils/portable" ||
    imported.importClause?.isTypeOnly || specifiers.length !== 1 || specifier === undefined || specifier.isTypeOnly ||
    specifier.name.text !== "MedusaError" || specifier.propertyName !== undefined ||
    authorityProgram(definition.getText(target)) !== authorityProgram(
      `export function ${owner.exportedFunction}(currencyCode: unknown): void { ${guard.getText(native)} }`))
    throw new Error(failure + ": required currency guard");
}

/** Only exact portable package/leaf imports and the actual SDK container's
 * erased resolve surface may differ. No callback expression is rewritten.
 * @param {string} source @param {string} target */
function adaptCallback(source, target) {
  let expected = source.replaceAll("\r\n", "\n");
  expected = replaceChecked(expected, 'from "@medusajs/framework/types"', 'from "@medusajs/types"');
  // Each selected file has exactly one DTO import. Keep its import type marker
  // in the expected tree rather than disregarding every erased import.
  const parsed = ts.createSourceFile("native159.ts", expected, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const dtoImports = parsed.statements.filter(node => ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
    && node.moduleSpecifier.text === "@medusajs/types");
  const dtoImport = dtoImports[0];
  if (dtoImports.length !== 1 || dtoImport === undefined || !ts.isImportDeclaration(dtoImport)) throw new Error(failure + ": DTO import");
  expected = replaceChecked(expected, dtoImport.getText(parsed), dtoImport.getText(parsed).replace(/^import \{/, "import type {"));
  expected = replaceChecked(expected, 'from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"');
  if (target.endsWith("/get-variants-and-items-with-prices.ts") || target.endsWith("/get-variant-price-sets.ts"))
    expected = replaceChecked(expected, 'from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"');
  let runtimeExpected = expected;
  if (target.endsWith("/get-variants-and-items-with-prices.ts")) {
    expected = replaceChecked(expected, 'import { useQueryGraphStep } from "../../common"',
      'import { useQueryGraphStep } from "../../common/steps/use-query-graph"');
    expected = replaceChecked(expected, 'import { getVariantPriceSetsStep } from "../steps"',
      'import { getVariantPriceSetsStep } from "../steps/get-variant-price-sets"');
    runtimeExpected = expected;
    // The159 adapter owns complete field-profile decoding. Preserve the native
    // in-place mutation while restoring its original staged DTO authoring type.
    expected = replaceChecked(expected, '    }).config({ name: "fetch-variants" })',
      '    }).config({ name: "fetch-variants" }) as unknown as WorkflowData<{\n      data: NonNullable<PrepareLineItemDataInput["variant"]>[]\n    }>');
    expected = replaceChecked(expected, "variant.calculated_price = calculatedPriceSet",
      'variant.calculated_price = calculatedPriceSet as NonNullable<PrepareLineItemDataInput["variant"]>["calculated_price"]');
    expected = replaceChecked(expected, "input.unitPrice = calculatedPriceSet.calculated_amount",
      "input.unitPrice = calculatedPriceSet!.calculated_amount!");
    expected = replaceChecked(expected, "              calculatedPriceSet.is_calculated_price_tax_inclusive",
      "              calculatedPriceSet!.is_calculated_price_tax_inclusive!");
  }
  if (target.endsWith("/get-variant-price-sets.ts")) {
    expected = replaceChecked(expected, 'import { MedusaContainer, Query } from "@medusajs/framework"',
      'import type { WorkflowContainer as MedusaContainer } from "@medusajs/workflows-sdk"\n' +
      'import type { QueryGraphFunction } from "@medusajs/types"\n\ntype Query = { graph: QueryGraphFunction }');
    expected = replaceChecked(expected, "groupItems[0].context", "groupItems[0]!.context");
    const start = expected.indexOf("interface PriceCalculationItem {"), end = expected.indexOf("\n}", start);
    if (start === -1 || end === -1) throw new Error(failure + ": calculation item type");
    const original = expected.slice(start, end);
    const adapted = replaceChecked(replaceChecked(original, "id?: string", "id?: string | undefined"),
      "context?: Record<string, unknown>", "context?: Record<string, unknown> | undefined");
    expected = replaceChecked(expected, original, adapted);
    expected = replaceChecked(expected, "    { container }\n  ) => {",
      "    { container }\n  ): Promise<StepResponse<GetVariantPriceSetsStepOutput>> => {");
    if (expected.split("new StepResponse({})").length !== 3) throw new Error(failure + ": empty response type");
    expected = expected.replaceAll("new StepResponse({})", "new StepResponse<GetVariantPriceSetsStepOutput>({})");
  }
  if (target.endsWith("/prepare-line-item-data.ts")) {
    expected = replaceChecked(expected, "  variant?: PrepareVariantLineItemInput", "  variant?: PrepareVariantLineItemInput | undefined");
    expected = replaceChecked(expected, "  cartId?: string", "  cartId?: string | undefined");
  }
  return { expected, runtimeExpected };
}

/** The existing Customer DTO needs only its native Address DTO. The unrelated
 * legacy customer type would expand Address ownership and is not promoted.
 * Compare the complete target to exactly these original nodes; a second copy,
 * alias, import, reference alteration or extra declaration cannot disappear.
 * @param {string} source */
function selectedCustomerTypes(source) {
  const parsed = ts.createSourceFile("customer.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const names = ["CustomerAddressDTO", "CustomerDTO"];
  return names.map(name => {
    const nodes = parsed.statements.filter(node => ts.isInterfaceDeclaration(node) && node.name.text === name);
    const node = nodes[0];
    if (nodes.length !== 1 || node === undefined) throw new Error(failure + ": Customer native type owner");
    return node.getText(parsed);
  }).join("\n\n");
}

/** Full pure-type programs retain all original DTOs. Their imports are erased
 * explicitly; only existing Customer/Payment leaf ownership is relocated.
 * @param {string} source @param {string} target */
function adaptPureTypes(source, target) {
  let expected = source.replaceAll("\r\n", "\n").replace(/^import \{/gm, "import type {");
  if (target.endsWith("/cart/workflows.ts")) {
    expected = replaceChecked(expected, 'from "../customer"', 'from "../customer/common"');
    expected = replaceChecked(expected, 'from "../payment"', 'from "../payment/common"');
  }
  return expected;
}

/** Focused entry point for the enclosing provenance checker and negative tests.
 * @param {string} target @param {string} source @param {string} actual */
export function verifyVariantItemPricingSourcePair(target, source, actual) {
  if (!variantItemPricingSourcePairs.some(pair => pair.target === target)) throw new Error(failure + ": unknown pair");
  if (target.endsWith("/cart/utils/fields.ts") || target.endsWith("/common/filter-object-by-keys.ts")) {
    if (source !== actual) throw new Error(failure + ": exact native bytes " + target);
    return;
  }
  if (target.endsWith("/definitions/readonly/inventory-level-stock-location.ts")) {
    const expected = replaceChecked(source, 'from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"');
    if (authorityProgram(expected) !== authorityProgram(actual)) throw new Error(failure + ": readonly native Link");
    return;
  }
  if (target.includes("/medusa-core-flows/")) {
    const { expected, runtimeExpected } = adaptCallback(source, target);
    if (authorityProgram(expected) !== authorityProgram(actual)) throw new Error(failure + ": typed callback " + target);
    if (authorityProgram(runtimeExpected, false) !== authorityProgram(actual, false)) throw new Error(failure + ": emitted callback " + target);
    return;
  }
  const expected = target.endsWith("/customer/common.ts") ? selectedCustomerTypes(source) : adaptPureTypes(source, target);
  if (authorityProgram(expected) !== authorityProgram(actual)) throw new Error(failure + ": " + target);
}

/** Complete connected source closure. Overrides are only negative test input;
 * unknown owners fail closed instead of selecting unguarded programs.
 * @param {string} root @param {Record<string, {source?: string, target?: string}>} overrides */
export function verifyVariantItemPricingSource(root, overrides = {}) {
  if (Object.keys(overrides).some(target => target !== variantItemPricingRequiredCurrencySource.target && !variantItemPricingSourcePairs.some(pair => pair.target === target)))
    throw new Error(failure + ": unknown override");
  for (const pair of variantItemPricingSourcePairs) verifyVariantItemPricingSourcePair(pair.target,
    overrides[pair.target]?.source ?? readFileSync(path.join(root, pair.source), "utf8"),
    overrides[pair.target]?.target ?? readFileSync(path.join(root, pair.target), "utf8"));
  const currency = variantItemPricingRequiredCurrencySource;
  verifyNativeRequiredCurrencyGuard(overrides[currency.target]?.source ?? readFileSync(path.join(root, currency.source), "utf8"),
    overrides[currency.target]?.target ?? readFileSync(path.join(root, currency.target), "utf8"));
}
