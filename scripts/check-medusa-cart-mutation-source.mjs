// @ts-check
import ts from "@typescript/typescript6";

const prefix = "third_party/medusa/upstream/packages/core/core-flows/src/";
const targetPrefix = "packages/medusa-core-flows/src/";
const selected = [
  "cart/workflows/list-shipping-options-for-cart.ts",
  "cart/workflows/add-shipping-method-to-cart.ts",
  "cart/steps/add-shipping-method-to-cart.ts",
  "cart/steps/validate-cart-shipping-options.ts",
  "cart/steps/validate-shipping-methods-data.ts",
  "cart/steps/validate-shipping-options-price.ts",
  "cart/workflows/update-cart.ts",
  "cart/workflows/add-to-cart.ts",
  "cart/workflows/update-line-item-in-cart.ts",
  "line-item/workflows/delete-line-items.ts",
  "line-item/steps/delete-line-items.ts",
  "cart/workflows/refresh-cart-items.ts",
  "cart/steps/create-line-items.ts",
  "cart/steps/get-line-item-actions.ts",
  "cart/steps/update-line-items.ts",
  "cart/steps/validate-line-item-prices.ts",
  "line-item/steps/update-line-items.ts",
  "cart/steps/validate-variant-prices.ts",
  "cart/steps/update-cart-items-translations.ts",
  "cart/workflows/refresh-cart-shipping-methods.ts",
  "cart/workflows/upsert-tax-lines.ts",
  "cart/steps/remove-shipping-method-from-cart.ts",
  "cart/steps/update-shipping-methods.ts",
  "cart/workflows/list-shipping-options-for-cart-with-pricing.ts",
  "cart/steps/upsert-tax-lines-for-items.ts",
  "common/steps/validate-presence-of.ts",
  "fulfillment/steps/calculate-shipping-options-prices.ts",
  "common/steps/get-translated-shipping-option.ts"
];
const removeUndefinedPair = Object.freeze({ source: "third_party/medusa/upstream/packages/core/utils/src/common/remove-undefined.ts",
  target: "packages/medusa-utils/src/common/remove-undefined.ts", classification: "cartMutationFork" });
export const cartMutationSourcePairs = Object.freeze([...selected.map(file => Object.freeze({ source: prefix + file, target: targetPrefix + file, classification: "cartMutationFork" })), removeUndefinedPair]);
/** @type {Readonly<Record<string, readonly string[]>>} */
const imports = {
  "cart/workflows/list-shipping-options-for-cart.ts": [
    "import { createHook, createWorkflow, transform, WorkflowResponse, } from \"@medusajs/workflows-sdk\";",
    "import { useCartShippingListQueryGraphStep as useQueryGraphStep } from \"../../common/steps/cart-mutation-query-views\";",
    "import { useCartShippingRemoteQueryStep as useRemoteQueryStep } from \"../../common/steps/use-remote-query\";",
    "import { validatePresenceOfStep } from \"../../common/steps/validate-presence-of\";",
    "import { cartFieldsForPricingContext } from \"../utils/fields\";",
    "import { deduplicate, filterObjectByKeys, isDefined, } from \"@medusajs/framework/utils/portable\";",
    "import { pricingContextResult, shippingOptionsContextResult, } from \"../utils/schemas\";",
    "import { getTranslatedShippingOptionsStep } from \"../../common/steps/get-translated-shipping-option\";"
],
  "cart/workflows/add-shipping-method-to-cart.ts": [
    "import { CartWorkflowEvents, MedusaError } from \"@medusajs/framework/utils/portable\";",
    "import { createHook, createWorkflow, nativeCartMutationProfile, parallelize, transform, WorkflowResponse, } from \"@medusajs/workflows-sdk\";",
    "import { emitEventStep } from \"../../common/steps/emit-event\";",
    "import { useCartMutationRemoteQueryStep as useRemoteQueryStep } from \"../../common/steps/use-remote-query\";",
    "import { acquireLockStep } from \"../../locking/steps/acquire-lock\";",
    "import { releaseLockStep } from \"../../locking/steps/release-lock\";",
    "import { addShippingMethodToCartStep } from \"../steps/add-shipping-method-to-cart\";",
    "import { removeShippingMethodFromCartStep } from \"../steps/remove-shipping-method-from-cart\";",
    "import { validateCartShippingOptionsStep } from \"../steps/validate-cart-shipping-options\";",
    "import { validateCartStep } from \"../steps/validate-cart\";",
    "import { validateAndReturnShippingMethodsDataStep } from \"../steps/validate-shipping-methods-data\";",
    "import { validateCartShippingOptionsPriceStep } from \"../steps/validate-shipping-options-price\";",
    "import { cartFieldsForRefreshSteps } from \"../utils/fields\";",
    "import { listShippingOptionsForCartWithPricingWorkflow } from \"./list-shipping-options-for-cart-with-pricing\";",
    "import { refreshCartItemsWorkflow } from \"./refresh-cart-items\";"
],
  "cart/steps/add-shipping-method-to-cart.ts": [
    "import { Modules } from \"@medusajs/framework/utils/portable\";",
    "import { StepResponse, createStep } from \"@medusajs/workflows-sdk\";"
],
  "cart/steps/validate-cart-shipping-options.ts": [
    "import { arrayDifference, MedusaError, Modules, } from \"@medusajs/framework/utils/portable\";",
    "import { createStep, StepResponse } from \"@medusajs/workflows-sdk\";"
],
  "cart/steps/validate-shipping-methods-data.ts": [
    "import { Modules, promiseAll } from \"@medusajs/framework/utils/portable\";",
    "import { createStep, StepResponse } from \"@medusajs/workflows-sdk\";"
],
  "cart/steps/validate-shipping-options-price.ts": [
    "import { isDefined, MedusaError } from \"@medusajs/framework/utils/portable\";",
    "import { createStep, StepResponse } from \"@medusajs/workflows-sdk\";"
],

  "cart/workflows/update-cart.ts": [
    "import { CartWorkflowEvents, isDefined, MedusaError, } from \"@medusajs/framework/utils/portable\";",
    "import { acquireLockStep } from \"../../locking/steps/acquire-lock\";",
    "import { createHook, createWorkflow, nativeCartMutationProfile, parallelize, transform, when, WorkflowResponse, } from \"@medusajs/workflows-sdk\";",
    "import { deleteLineItemsStep } from \"../../line-item/steps/delete-line-items\";",
    "import { emitEventStep } from \"../../common/steps/emit-event\";",
    "import { findOrCreateCustomerStep } from \"../steps/find-or-create-customer\";",
    "import { findSalesChannelStep } from \"../steps/find-sales-channel\";",
    "import { refreshCartItemsWorkflow } from \"./refresh-cart-items\";",
    "import { releaseLockStep } from \"../../locking/steps/release-lock\";",
    "import { updateCartsStep } from \"../steps/update-carts\";",
    "import { useCartUpdateQueryGraphStep as useQueryGraphStep } from \"../../common/steps/cart-mutation-query-views\";",
    "import { validateCartStep } from \"../steps/validate-cart\";",
    "import { validateSalesChannelStep } from \"../steps/validate-sales-channel\";"
  ],
  "cart/workflows/add-to-cart.ts": [
    "import { CartWorkflowEvents, deduplicate, isDefined, } from \"@medusajs/framework/utils/portable\";",
    "import { acquireLockStep } from \"../../locking/steps/acquire-lock\";",
    "import { cartFieldsForPricingContext, productVariantsFields, } from \"../utils/fields\";",
    "import { confirmVariantInventoryWorkflow } from \"./confirm-variant-inventory\";",
    "import { createHook, createWorkflow, nativeCartMutationProfile, parallelize, transform, when, WorkflowResponse, } from \"@medusajs/workflows-sdk\";",
    "import { createLineItemsStep } from \"../steps/create-line-items\";",
    "import { emitEventStep } from \"../../common/steps/emit-event\";",
    "import { getLineItemActionsStep } from \"../steps/get-line-item-actions\";",
    "import { getTranslatedLineItemsStep } from \"../../common/steps/get-translated-line-items\";",
    "import { getVariantsAndItemsWithPrices } from \"./get-variants-and-items-with-prices\";",
    "import { prepareLineItemData, } from \"../utils/prepare-line-item-data\";",
    "import { pricingContextResult } from \"../utils/schemas\";",
    "import { refreshCartItemsWorkflow } from \"./refresh-cart-items\";",
    "import { releaseLockStep } from \"../../locking/steps/release-lock\";",
    "import { requiredVariantFieldsForInventoryConfirmation } from \"../utils/prepare-confirm-inventory-input\";",
    "import { updateLineItemsStep } from \"../steps/update-line-items\";",
    "import { useAddToCartQueryGraphStep as useQueryGraphStep } from \"../../common/steps/cart-mutation-query-views\";",
    "import { validateCartStep } from \"../steps/validate-cart\";",
    "import { validateLineItemPricesStep } from \"../steps/validate-line-item-prices\";"
  ],
  "cart/workflows/update-line-item-in-cart.ts": [
    "import { CartWorkflowEvents, deduplicate, filterObjectByKeys, isDefined, MathBN, MedusaError } from \"@medusajs/framework/utils/portable\";",
    "import { QueryContext } from \"@medusajs/utils/modules-sdk/query-context\";",
    "import { acquireLockStep } from \"../../locking/steps/acquire-lock\";",
    "import { cartFieldsForPricingContext, productVariantsFields, } from \"../utils/fields\";",
    "import { confirmVariantInventoryWorkflow } from \"./confirm-variant-inventory\";",
    "import { createHook, createWorkflow, nativeCartMutationProfile, parallelize, transform, when, WorkflowResponse, } from \"@medusajs/workflows-sdk\";",
    "import { deleteLineItemsWorkflow } from \"../../line-item/workflows/delete-line-items\";",
    "import { emitEventStep } from \"../../common/steps/emit-event\";",
    "import { pricingContextResult } from \"../utils/schemas\";",
    "import { refreshCartItemsWorkflow } from \"./refresh-cart-items\";",
    "import { releaseLockStep } from \"../../locking/steps/release-lock\";",
    "import { requiredVariantFieldsForInventoryConfirmation } from \"../utils/prepare-confirm-inventory-input\";",
    "import { updateLineItemsStepWithSelector } from \"../../line-item/steps/update-line-items\";",
    "import { useItemUpdateQueryGraphStep as useQueryGraphStep } from \"../../common/steps/cart-mutation-query-views\";",
    "import { validateCartStep } from \"../steps/validate-cart\";",
    "import { validateVariantPricesStep } from \"../steps/validate-variant-prices\";"
  ],
  "line-item/workflows/delete-line-items.ts": [
    "import { CartWorkflowEvents } from \"@medusajs/framework/utils/portable\";",
    "import { acquireLockStep } from \"../../locking/steps/acquire-lock\";",
    "import { createWorkflow, nativeCartMutationProfile, parallelize, } from \"@medusajs/workflows-sdk\";",
    "import { deleteLineItemsStep } from \"../steps/delete-line-items\";",
    "import { emitEventStep } from \"../../common/steps/emit-event\";",
    "import { refreshCartItemsWorkflow } from \"../../cart/workflows/refresh-cart-items\";",
    "import { releaseLockStep } from \"../../locking/steps/release-lock\";"
  ],
  "line-item/steps/delete-line-items.ts": [
    "import { Modules } from \"@medusajs/framework/utils/portable\";",
    "import { StepResponse, createStep } from \"@medusajs/workflows-sdk\";"
  ],
  "cart/workflows/refresh-cart-items.ts": [
    "import { acquireLockStep } from \"../../locking/steps/acquire-lock\";",
    "import { cartFieldsForRefreshSteps } from \"../utils/fields\";",
    "import { createHook, createWorkflow, nativeCartMutationProfile, transform, when, WorkflowResponse, } from \"@medusajs/workflows-sdk\";",
    "import { getVariantsAndItemsWithPrices } from \"./get-variants-and-items-with-prices\";",
    "import { isDefined, PromotionActions } from \"@medusajs/framework/utils/portable\";",
    "import { pricingContextResult } from \"../utils/schemas\";",
    "import { refreshCartShippingMethodsWorkflow } from \"./refresh-cart-shipping-methods\";",
    "import { refreshPaymentCollectionForCartWorkflow } from \"./refresh-payment-collection\";",
    "import { releaseLockStep } from \"../../locking/steps/release-lock\";",
    "import { updateCartItemsTranslationsStep } from \"../steps/update-cart-items-translations\";",
    "import { updateCartPromotionsWorkflow } from \"./update-cart-promotions\";",
    "import { updateLineItemsStep } from \"../steps/update-line-items\";",
    "import { updateTaxLinesWorkflow } from \"./update-tax-lines\";",
    "import { upsertTaxLinesWorkflow } from \"./upsert-tax-lines\";",
    "import { useCartRefreshQueryGraphStep as useQueryGraphStep } from \"../../common/steps/cart-mutation-query-views\";",
    "import { validateCartStep } from \"../steps/validate-cart\";"
  ],
  "cart/steps/create-line-items.ts": [
    "import { Modules } from \"@medusajs/framework/utils/portable\";",
    "import { StepResponse, createStep } from \"@medusajs/workflows-sdk\";"
  ],
  "cart/steps/get-line-item-actions.ts": [
    "import { MathBN, Modules, deepEqualObj, isPresent, } from \"@medusajs/framework/utils/portable\";",
    "import { StepResponse, createStep } from \"@medusajs/workflows-sdk\";",
    "import { snapshotNativeNumber } from \"@medusajs/utils/totals/native-number\";"
  ],
  "cart/steps/update-line-items.ts": [
    "import { Modules, getSelectsAndRelationsFromObjectArray, } from \"@medusajs/framework/utils/portable\";",
    "import { StepResponse, createStep } from \"@medusajs/workflows-sdk\";"
  ],
  "cart/steps/validate-line-item-prices.ts": [
    "import { MedusaError, isPresent } from \"@medusajs/framework/utils/portable\";",
    "import { createStep } from \"@medusajs/workflows-sdk\";"
  ],
  "line-item/steps/update-line-items.ts": [
    "import { Modules, getSelectsAndRelationsFromObjectArray, promiseAll, removeUndefined, } from \"@medusajs/framework/utils/portable\";",
    "import { StepResponse, createStep } from \"@medusajs/workflows-sdk\";"
  ],
  "cart/steps/validate-variant-prices.ts": [
    "import { MedusaError, isPresent } from \"@medusajs/framework/utils/portable\";",
    "import { createStep } from \"@medusajs/workflows-sdk\";"
  ],
  "cart/steps/update-cart-items-translations.ts": [
    "import { ContainerRegistrationKeys, deduplicate, FeatureFlag, Modules, } from \"@medusajs/framework/utils/portable\";",
    "import { applyTranslationsToItems } from \"../../common/utils/apply-translations-to-items\";",
    "import { createStep, StepResponse } from \"@medusajs/workflows-sdk\";",
    "import { productVariantsFields } from \"../utils/fields\";"
  ],
  "cart/workflows/refresh-cart-shipping-methods.ts": [
    "import { acquireLockStep } from \"../../locking/steps/acquire-lock\";",
    "import { createHook, createWorkflow, parallelize, transform, when, WorkflowResponse, } from \"@medusajs/workflows-sdk\";",
    "import { isDefined, isPresent } from \"@medusajs/framework/utils/portable\";",
    "import { listShippingOptionsForCartWithPricingWorkflow } from \"./list-shipping-options-for-cart-with-pricing\";",
    "import { releaseLockStep } from \"../../locking/steps/release-lock\";",
    "import { removeShippingMethodFromCartStep } from \"../steps/remove-shipping-method-from-cart\";",
    "import { updateShippingMethodsStep } from \"../steps/update-shipping-methods\";",
    "import { useCartShippingQueryGraphStep as useQueryGraphStep } from \"../../common/steps/cart-mutation-query-views\";",
    "import { validateCartStep } from \"../steps/validate-cart\";"
  ],
  "cart/workflows/upsert-tax-lines.ts": [
    "import { createWorkflow, transform, when, } from \"@medusajs/workflows-sdk\";",
    "import { getItemTaxLinesStep } from \"../../tax/steps/get-item-tax-lines\";",
    "import { getTranslatedTaxLinesStep } from \"../../common/steps/get-translated-tax-lines\";",
    "import { upsertTaxLinesForItemsStep } from \"../steps/upsert-tax-lines-for-items\";",
    "import { useQueryGraphStep } from \"../../common/steps/use-query-graph\";",
    "import { validateCartStep } from \"../steps/validate-cart\";"
  ],
  "cart/steps/remove-shipping-method-from-cart.ts": [
    "import { Modules } from \"@medusajs/framework/utils/portable\";",
    "import { StepResponse, createStep } from \"@medusajs/workflows-sdk\";"
  ],
  "cart/steps/update-shipping-methods.ts": [
    "import { Modules, getSelectsAndRelationsFromObjectArray, } from \"@medusajs/framework/utils/portable\";",
    "import { StepResponse, createStep } from \"@medusajs/workflows-sdk\";"
  ],
  "cart/workflows/list-shipping-options-for-cart-with-pricing.ts": [
    "import { QueryContext } from \"@medusajs/utils/modules-sdk/query-context\";",
    "import { calculateShippingOptionsPricesStep } from \"../../fulfillment/steps/calculate-shipping-options-prices\";",
    "import { cartFieldsForCalculateShippingOptionsPrices } from \"../utils/fields\";",
    "import { createHook, createWorkflow, parallelize, transform, WorkflowResponse, } from \"@medusajs/workflows-sdk\";",
    "import { getTranslatedShippingOptionsStep } from \"../../common/steps/get-translated-shipping-option\";",
    "import { isDefined, ShippingOptionPriceType } from \"@medusajs/framework/utils/portable\";",
    "import { shippingOptionsContextResult } from \"../utils/schemas\";",
    "import { useCartShippingOptionsQueryGraphStep as useQueryGraphStep } from \"../../common/steps/cart-mutation-query-views\";",
    "import { useCartShippingRemoteQueryStep as useRemoteQueryStep } from \"../../common/steps/use-remote-query\";",
    "import { validatePresenceOfStep } from \"../../common/steps/validate-presence-of\";"
  ],
  "cart/steps/upsert-tax-lines-for-items.ts": [
    "import { Modules, promiseAll } from \"@medusajs/framework/utils/portable\";",
    "import { StepResponse, createStep } from \"@medusajs/workflows-sdk\";"
  ],
  "common/steps/validate-presence-of.ts": [
    "import { createStep } from \"@medusajs/workflows-sdk\";",
    "import { isPresent, MedusaError } from \"@medusajs/framework/utils/portable\";"
  ],
  "fulfillment/steps/calculate-shipping-options-prices.ts": [
    "import { decodeNativeShippingPrices } from \"../../common/steps/cart-mutation-shipping-query-views\";",
    "import { Modules } from \"@medusajs/framework/utils/portable\";",
    "import { StepResponse, createStep } from \"@medusajs/workflows-sdk\";"
  ],
  "common/steps/get-translated-shipping-option.ts": [
    "import { applyTranslations } from \"@medusajs/utils/translations/apply-translations\";",
    "import { createStep, StepResponse } from \"@medusajs/workflows-sdk\";",
    "import { decodeNativePricedShippingOptions } from \"./cart-mutation-shipping-query-views\";"
  ]
};
/** @param {string} text */
function program(text) {
  const emitted = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, removeComments: true } }).outputText;
  const file = ts.createSourceFile("cart-mutation.js", emitted, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
  const normalized = ts.transform(file, [context => node => {
    /** @param {import("@typescript/typescript6").Node} child @returns {import("@typescript/typescript6").VisitResult<import("@typescript/typescript6").Node>} */
    const visit = child => ts.isShorthandPropertyAssignment(child) && child.objectAssignmentInitializer === undefined
      ? ts.factory.createPropertyAssignment(child.name, child.name) : ts.visitEachChild(child, visit, context);
    return ts.visitEachChild(node, visit, context);
  }]);
  try {
    const body = normalized.transformed[0];
    if (body === undefined || !ts.isSourceFile(body)) throw new Error("Missing normalized native Cart source");
    return { imports: file.statements.filter(ts.isImportDeclaration).map(node => printer.printNode(ts.EmitHint.Unspecified, node, file)).sort(),
      body: body.statements.filter(node => !ts.isImportDeclaration(node)).map(node => printer.printNode(ts.EmitHint.Unspecified, node, body)).join("\n") };
  } finally { normalized.dispose(); }
}
/** @param {string} text */
const parse = text => ts.createSourceFile("cart-mutation.ts", text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
/** @param {string} text @param {string} file */
function expected(text, file) {
  let value = text.replaceAll("\r\n", "\n");
  const source = parse(value);
  /** @type {{start: number, end: number, text: string}[]} */
  const edits = [];
  /** @param {import("@typescript/typescript6").Node} node */
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "createStep" && node.arguments.length === 3) {
      const argument = node.arguments[0];
      if (argument === undefined) throw new Error("Missing native Cart compensation declaration");
      edits.push({ start: argument.getStart(source), end: argument.end,
        text: `{ name: ${argument.getText(source)}, compensation: "transactionCovered" }` });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const edit of edits.sort((left,right) => right.start-left.start)) value = value.slice(0,edit.start)+edit.text+value.slice(edit.end);
  if (["cart/workflows/update-cart.ts", "cart/workflows/add-to-cart.ts", "cart/workflows/update-line-item-in-cart.ts", "cart/workflows/refresh-cart-items.ts", "line-item/workflows/delete-line-items.ts"].includes(file))
    value = value.replace("    idempotent: false,", "    idempotent: false,\n    constructionProfile: nativeCartMutationProfile,");
  if (file === "cart/workflows/add-shipping-method-to-cart.ts") value = value.replace(
    "  addShippingMethodToCartWorkflowId,", "  { name: addShippingMethodToCartWorkflowId, constructionProfile: nativeCartMutationProfile },");
  if (file === "cart/steps/get-line-item-actions.ts") value = value.replace("const quantity = MathBN.sum(\n          existingItem.quantity as number,\n          item.quantity ?? 1\n        )",
    "const quantity = snapshotNativeNumber(MathBN.sum(\n          existingItem.quantity as number,\n          item.quantity ?? 1\n        ))!.json");
  if (file === "fulfillment/steps/calculate-shipping-options-prices.ts") value = value.replace(
    "const prices = await service.calculateShippingOptionsPrices(input)",
    "const prices = decodeNativeShippingPrices(await Reflect.apply(service.calculateShippingOptionsPrices, service, [input]))");
  if (file === "common/steps/get-translated-shipping-option.ts") value = value
    .replace("    await applyTranslations({", "    const shippingOptions = decodeNativePricedShippingOptions(data.shippingOptions)\n    await applyTranslations({")
    .replaceAll("objects: data.shippingOptions", "objects: shippingOptions")
    .replace("new StepResponse(data.shippingOptions)", "new StepResponse(shippingOptions)");
  if (file === "cart/workflows/refresh-cart-shipping-methods.ts") value = value.replace(
    "return fetchCart ?? input.cart", "return (fetchCart ?? input.cart)!");
  return value;
}
/** Exact source pairs and a closed classification prevent redirected forks.
 * @param {readonly {source?:string,target:string,classification:string}[]} files */
export function verifyCartMutationSourceSelection(files) {
  for (const pair of cartMutationSourcePairs) {
    const matched = files.filter(file => file.target === pair.target || file.source === pair.source);
    if (matched.length !== 1 || matched[0]?.target !== pair.target || matched[0]?.source !== pair.source || matched[0]?.classification !== pair.classification)
      throw new Error("Changed native Cart mutation source selection: " + pair.target);
  }
  for (const file of files) if (file.classification === "cartMutationFork" && !cartMutationSourcePairs.some(pair => pair.target === file.target))
    throw new Error("Unselected native Cart mutation fork: " + file.target);
}

/** The issued mutation closure selects one source-counted shared allowance;
 * creation and participant resources keep their existing512-call profile.
 * @param {string} mutationSource @param {string} creationSource */
export function verifyCartMutationOperationSelection(mutationSource, creationSource) {
  const failure = "Changed source-counted Cart mutation operation selection";
  /** @param {string} source @param {string} name */
  const declaration = (source, name) => {
    const file = parse(source);
    /** @type {import("@typescript/typescript6").VariableDeclaration[]} */
    const found = [];
    /** @param {import("@typescript/typescript6").Node} node */
    const visit = node => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) found.push(node);
      ts.forEachChild(node, visit);
    };
    visit(file);
    const value = found[0];
    if (found.length !== 1 || value?.initializer === undefined || !ts.isVariableDeclarationList(value.parent) || !(value.parent.flags & ts.NodeFlags.Const))
      throw new Error(failure);
    return { file, value: value.initializer };
  };
  const allowance = declaration(mutationSource, "cartMutationRequestCallLimit");
  const resources = declaration(creationSource, "cartCreationResources");
  const composition = declaration(mutationSource, "composition");
  if (allowance.value.getText(allowance.file) !== "1065" || resources.value.getText(resources.file).replace(/\s/g, "") !==
    "Object.freeze({...defaultCommerceResources,calls:512})" || !ts.isObjectLiteralExpression(composition.value) ||
    composition.value.properties.some(property => (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) || !ts.isIdentifier(property.name)))
    throw new Error(failure);
  const calls = composition.value.properties.filter(ts.isPropertyAssignment).filter(property => property.name.getText(composition.file) === "requestCallLimit");
  const modules = composition.value.properties.filter(ts.isPropertyAssignment).filter(property => property.name.getText(composition.file) === "modules");
  if (calls.length !== 1 || calls[0]?.initializer.getText(composition.file) !== "cartMutationRequestCallLimit" || modules.length !== 1 ||
    modules[0]?.initializer.getText(composition.file).replace(/\s/g, "") !==
    "{...others,inventory_graph:inventory,cart:{...modules.cart,logicalResources:cartCreationResources},promotion:{...modules.promotion,logicalResources:promotionComputeResources}}")
    throw new Error(failure);
}
/** Native algorithms and inverse callbacks remain source-preserved. Runtime
 * imports and the exact foreign-result projection seams are enumerated; DTO
 * views are checked by tsrs and their owning contract tests. The numeric seam
 * snapshots the native arithmetic quantity's exact JSON output.
 * @param {string} source @param {string} target @param {string} destination */
export function verifyCartMutationSource(source, target, destination) {
  if (destination === removeUndefinedPair.target) {
    const mapped = `type WithoutUndefined<T> = {
      [Key in keyof T as undefined extends T[Key] ? never : Key]: T[Key]
    } & {
      [Key in keyof T as undefined extends T[Key] ? Key : never]?: Exclude<T[Key], undefined>
    }\n`;
    const expected = mapped + source.replace('(obj: T): T =>', '(obj: T): WithoutUndefined<T> =>').replace(' as T', ' as WithoutUndefined<T>');
    const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
    if (printer.printFile(parse(expected)) !== printer.printFile(parse(target)))
      throw new Error("Changed native undefined-omission type adaptation");
    return;
  }
  const file = destination.slice(targetPrefix.length);
  if (!destination.startsWith(targetPrefix) || !selected.includes(file)) throw new Error("Unselected native Cart mutation source");
  const actual = program(target), native = program(expected(source,file));
  const permittedFile = ts.createSourceFile("permitted.js", imports[file].join("\n"), ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
  const permitted = permittedFile.statements.filter(ts.isImportDeclaration).map(node => printer.printNode(ts.EmitHint.Unspecified, node, permittedFile)).sort();
  if (actual.body !== native.body || JSON.stringify(actual.imports) !== JSON.stringify(permitted))
    throw new Error("Changed native Cart mutation algorithm or import: " + destination);
}
