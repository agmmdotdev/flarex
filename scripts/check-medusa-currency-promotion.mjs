// @ts-check
import { apiKeySourcePairs, verifyApiKeySelection, verifyApiKeySource } from "./check-medusa-api-key-source.mjs";
import { nativeLinkOperationSourcePairs, verifyNativeLinkOperationSelection } from "./check-medusa-link-operation-source.mjs";
import { paymentSessionSourcePairs, paymentSessionTypeSourcePairs, verifyPaymentSessionSelection,
  verifyPaymentSessionSource, verifyPaymentSessionTypeSource } from "./check-medusa-payment-session-source.mjs";
import { orderArchiveSourcePairs, verifyOrderArchiveSourceSelection, verifyOrderArchiveSource } from "./check-medusa-order-archive-source.mjs";
import { orderCompleteSourcePairs, verifyOrderCompleteSourceSelection, verifyOrderCompleteSource } from "./check-medusa-order-complete-source.mjs";
import { orderChangeUpdateSourcePairs, verifyOrderChangeUpdateSourceSelection, verifyOrderChangeUpdateSource } from "./check-medusa-order-change-update-source.mjs";
import { orderChangeDeclineSourcePairs, verifyOrderChangeDeclineSourceSelection, verifyOrderChangeDeclineSource } from "./check-medusa-order-change-decline-source.mjs";
import { orderChangeDeletionSourcePairs, verifyOrderChangeDeletionSourceSelection, verifyOrderChangeDeletionSource } from "./check-medusa-order-change-deletion-source.mjs";
import { orderChangeCancellationSourcePairs, verifyOrderChangeCancellationSourceSelection, verifyOrderChangeCancellationSource } from "./check-medusa-order-change-cancellation-source.mjs";
import { verifyOrderFinanceSelection, verifyOrderFinanceHelpers } from "./check-medusa-order-finance-source.mjs";
import { taxRateUpdateSourcePairs, updateMetadataSourcePairs, taxRuleCreatorTypeSourcePair, verifyTaxRuleCreatorType, verifyTaxRateUpdateCallbacks,
  verifyTaxRateUpdateSelection, verifyUpdateMetadataExtraction } from "./check-medusa-tax-rate-update-source.mjs";
import { taxRateDeletionSourcePairs, verifyTaxRateDeletionCallbacks,
  verifyTaxRateDeletionSelection } from "./check-medusa-tax-rate-delete-source.mjs";
import { taxRuleReplacementSourcePairs, verifyTaxRuleReplacementCallbacks,
  verifyTaxRuleReplacementSelection } from "./check-medusa-tax-rule-replacement-source.mjs";
import { taxLinesSourcePairs, verifyTaxLinesFork } from "./check-medusa-cart-prerequisite-source.mjs";
import { verifyPortableAwilixSource } from "./check-medusa-awilix-portable-source.mjs";
import { verifyTaxRegionCreateCallbacks, verifyTaxRuleDeleteCallbacks, verifyTaxRuleCreateCallbacks, verifyTaxRateCreateCallbacks, verifyPriceListPriceUpdatePolicySelection, verifyPriceListPriceUpdateSelection, verifyPriceListDeleteSelection, verifyPriceListDeleteCallbacks, verifyPriceListUpdateCallbacks, verifyNativePriceListRuleBuilder, verifyPriceListCreateCallbacks, verifyPricePreferenceDeleteCallbacks, verifyPricePreferenceUpdateCallbacks, verifyPricePreferenceCreateCallbacks, verifySalesChannelProductLinkCallbacks, verifyTestPort, verifyCsvNormalizerTests, verifyShippingProfileCreateTests, verifyPricingCreateTests, verifyPricingWorkflowSelection, verifyInventoryCreateTests, verifyInventoryUpdateTests, verifyInventoryLevelUpdateTests, verifyInventoryLevelDeleteCallbacks, verifyInventoryItemDeleteCallbacks, verifyInventoryLevelBatchCallbacks, verifyInventoryItemCreateCallbacks, verifyStoreDeleteCallbacks, verifyStoreCreateCallbacks, verifyStoreCreationTypes, verifyReservationLineItemDeletionCallbacks, verifyStoreUpdateCallbacks, verifyShippingProfileUpdateCallbacks, verifyShippingProfileCreateCallbacks, verifyShippingOptionRuleBatchCallbacks, verifyLocationFulfillmentSetCallbacks, verifyShippingProfileDeleteCallbacks, verifyShippingOptionTypeCreateCallbacks, verifyShippingOptionTypeUpdateCallbacks, verifyShippingOptionTypeDeleteCallbacks, verifyServiceZoneCreateCallbacks, verifyServiceZoneDeleteCallbacks, verifyFulfillmentSetDeleteCallbacks, verifyServiceZoneUpdateCallbacks, verifyNativeToManyInitialization, verifyNativeRelationScalarFields, verifyNativeFilterValue, verifyNativeJoinerFieldAlias, verifyNativeNullToOneInitialization } from "./check-medusa-test-port.mjs";
import { verifyShippingOptionCreateCallbacks, verifyShippingOptionUpdateCallbacks, verifyShippingOptionDeleteCallbacks, verifyFulfillmentCreationCallbacks, verifyReturnFulfillmentCreationCallbacks, verifyFulfillmentCancellationCallbacks, verifyFulfillmentShipmentCallbacks, verifyRegionManifestFork } from "./check-medusa-shipping-option-source.mjs";
import { deliverySourcePairs, verifyFulfillmentDeliveryCallbacks, verifyNativeSkipStepResponseType } from "./check-medusa-delivery-source.mjs";
import { verifyPricingNormalizationExtraction, verifyPricingCandidateConstraintExport } from "./check-medusa-pricing-normalization.mjs";
import { verifyNativeJsonAssignment } from "./check-medusa-json-assignment-source.mjs";
import { verifyNativeDatabaseConstraintSource } from "./check-medusa-db-error-source.mjs";
import { verifyNativeRequiredValidationSource } from "./check-medusa-required-validation-source.mjs";
import { pricingRepositoryNormalizationSource, verifyNativePriceListPriceNormalization, verifyPriceListPriceCreationCallbacks, verifyPriceListPriceCreationSelection, verifyPriceListPriceRemovalCallbacks, verifyPriceListPriceRemovalSelection, priceListPriceBatchSourcePair, verifyPriceListPriceBatchCallbacks, verifyPriceListPriceBatchSelection, verifyPriceListPriceBatchService } from "./check-medusa-price-list-prices-source.mjs";
import { verifyNativePriceListPriceUpdate, stripNativePriceListPriceUpdatePricingExtension } from "./check-medusa-price-list-price-update-source.mjs";
import { variantItemPricingSourcePairs, verifyVariantItemPricingSource } from "./check-medusa-variant-item-pricing-source.mjs";
import { cartPrerequisiteSourcePairs, workflowCacheSourcePairs, customerSelectionSourcePairs, verifyCustomerSelectionFork, verifyWorkflowCacheFork, verifyCartPrerequisiteSourceSelection, verifyPaymentJoinerFork } from "./check-medusa-cart-prerequisite-source.mjs";
import { inventoryConfirmationSourcePairs, inventoryAvailabilitySourcePair, verifyInventoryConfirmationSourceSelection,
  verifyInventoryConfirmationFork, verifyNativeInventoryAvailabilityExtraction, verifyInventoryConfirmationPreparationTest } from "./check-medusa-inventory-confirmation-source.mjs";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "@typescript/typescript6";

const manifestPath = "roadmaps/flarexdb-framework-integration/preflight/medusa-currency-promotion.json";
const sourcePrefix = "third_party/medusa/upstream/";
export const tax170SourcePairs = Object.freeze([
  {
    "source": "third_party/medusa/upstream/packages/core/utils/src/dal/mikro-orm/db-error-mapper.ts",
    "target": "packages/medusa-utils/src/dal/mikro-orm/db-error-mapper.ts",
    "classification": "nativeDatabaseConstraintFork"
  },
  {
    "source": "third_party/medusa/upstream/packages/core/core-flows/src/tax/workflows/create-tax-regions.ts",
    "target": "packages/medusa-core-flows/src/tax/workflows/create-tax-regions.ts",
    "classification": "taxRegionCreationFork"
  },
  {
    "source": "third_party/medusa/upstream/packages/core/core-flows/src/tax/steps/create-tax-regions.ts",
    "target": "packages/medusa-core-flows/src/tax/steps/create-tax-regions.ts",
    "classification": "taxRegionCreationFork"
  }
].map(pair => Object.freeze(pair)));

/** Every selected source/target/classification is mandatory exactly once.
 * These classifications grant no permission to adjacent files or aliases.
 * @param {readonly {source?:string,target:string,classification:string}[]} files */
export function verifyTax170SourceSelection(files) {
  const failure = "Tax170 outside its exact pinned source pairs";
  for (const pair of tax170SourcePairs) {
    if (files.filter(file => file.source === pair.source && file.target === pair.target &&
      file.classification === pair.classification).length !== 1) throw new Error(failure);
  }
  for (const file of files) {
    if (!tax170SourcePairs.some(pair => pair.classification === file.classification ||
      pair.source === file.source || pair.target === file.target)) continue;
    if (!tax170SourcePairs.some(pair => pair.source === file.source && pair.target === file.target &&
      pair.classification === file.classification)) throw new Error(failure);
  }
}

const revision = "48d5cc675e4e8bc821e22c20c88a751acc66fb5f";

/** Only the existing portable utility import and erased declarations may differ.
 * @param {string} source @param {string} target */
export function verifyModuleTypeFork(source, target) {
  const emit = (/** @type {string} */ text) => {
    const result = ts.transpileModule(text, { reportDiagnostics: true, compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
      experimentalDecorators: true, removeComments: true, newLine: ts.NewLineKind.LineFeed,
    } });
    if (result.diagnostics?.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error))
      throw new Error("Invalid module type adaptation syntax");
    return result.outputText;
  };
  const portableSource = source.replace('from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"');
  if (emit(portableSource) !== emit(target)) throw new Error("Module type adaptation changes runtime behavior");
}
/** @param {string} text */
function emitForkRuntime(text) {
    const result = ts.transpileModule(text, { reportDiagnostics: true, compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
      experimentalDecorators: true, removeComments: true, newLine: ts.NewLineKind.LineFeed,
    } });
    if (result.diagnostics?.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error))
      throw new Error("Invalid module type adaptation syntax");
    return result.outputText;
}

/** Only the approved nested cascade return-map selection may change in this
 * native method. Constructor/bootstrap and batch uniqueness have separate seams.
 * @param {string} source @param {string} target */
export function verifyLinkCascadeReturnMapFork(source, target) {
  const message = "Changed native Link cascade return-map fork behavior";
  /** @param {string} text */
  const method = text => {
    emitForkRuntime(text);
    const parsed = ts.createSourceFile("link.ts", text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const classes = parsed.statements.filter(node => ts.isClassDeclaration(node) && node.name?.text === "Link");
    if (classes.length !== 1 || !ts.isClassDeclaration(classes[0])) throw new Error(message);
    const methods = classes[0].members.filter(node => ts.isMethodDeclaration(node)
      && ts.isIdentifier(node.name) && node.name.text === "executeCascade");
    if (methods.length !== 1 || !ts.isMethodDeclaration(methods[0]) || !methods[0].body) throw new Error(message);
    return methods[0].getText(parsed);
  };
  const before = `                const [mainKey] = returnFields

                if (!returnIdsList[serviceName]) {
                  returnIdsList[serviceName] = {}
                }
                if (!returnIdsList[serviceName][mainKey]) {
                  returnIdsList[serviceName][mainKey] = []
                }

                returnIdsList[serviceName][mainKey] = [
                  ...new Set(
                    returnIdsList[serviceName][mainKey].concat(
                      deletedEntities[mainKey]
                    )
                  ),
                ]`;
  const after = `                const mainKey = returnFields.find((field) =>
                  Object.prototype.hasOwnProperty.call(deletedEntities, field)
                )

                if (mainKey !== undefined) {
                  if (!returnIdsList[serviceName]) {
                    returnIdsList[serviceName] = {}
                  }
                  if (!returnIdsList[serviceName][mainKey]) {
                    returnIdsList[serviceName][mainKey] = []
                  }

                  returnIdsList[serviceName][mainKey] = [
                    ...new Set(
                      returnIdsList[serviceName][mainKey].concat(
                        deletedEntities[mainKey]
                      )
                    ),
                  ]
                }`;
  const original = method(source).replaceAll("\r\n", "\n");
  if (original.split(before).length !== 2) throw new Error(message);
  /** @param {string} body */
  const emit = body => emitForkRuntime("class LinkCascadeGuard {\n" + body + "\n}");
  if (emit(original.replace(before, after)) !== emit(method(target))) throw new Error(message);
}

/** The approved restore correction and exact portable arithmetic extraction.
 * @param {string} source @param {string} target @param {string} helper */
export function verifyInventoryReservationRestoreFork(source, target, helper) {
  target = verifyInventoryReservationArithmeticExtraction(source, target, helper);
  const message = "Changed native Inventory reservation restore fork behavior";
  const methodName = "restoreReservationItemsByLineItem_";
  /** @param {string} text */
  const select = text => {
    emitForkRuntime(text);
    const parsed = ts.createSourceFile("inventory-module.ts", text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const classes = parsed.statements.filter(node => ts.isClassDeclaration(node) && node.name?.text === "InventoryModuleService");
    if (classes.length !== 1 || !ts.isClassDeclaration(classes[0])) throw new Error(message);
    const methods = classes[0].members.filter(node => ts.isMethodDeclaration(node)
      && ts.isIdentifier(node.name) && node.name.text === methodName);
    if (methods.length !== 1 || !ts.isMethodDeclaration(methods[0]) || !methods[0].body) throw new Error(message);
    return { parsed, method: methods[0] };
  };
  const original = "@InjectTransactionManager()\nprotected async restoreReservationItemsByLineItem_(\n    lineItemId: string | string[],\n    @MedusaContext() context: Context = {}\n  ): Promise<void> {\n    const reservations: InventoryTypes.ReservationItemDTO[] =\n      await this.reservationItemService_.list(\n        { line_item_id: lineItemId },\n        {},\n        context\n      )\n\n    await this.reservationItemService_.restore(\n      { line_item_id: lineItemId },\n      context\n    )\n\n    await this.adjustInventoryLevelsForReservationsRestore(\n      reservations,\n      context\n    )\n  }";
  const corrected = "@InjectTransactionManager()\nprotected async restoreReservationItemsByLineItem_(\n    lineItemId: string | string[],\n    @MedusaContext() context: Context = {}\n  ): Promise<void> {\n    const reservations: InventoryTypes.ReservationItemDTO[] =\n      await this.reservationItemService_.list(\n        { line_item_id: lineItemId },\n        { withDeleted: true },\n        context\n      )\n\n    // Snapshot deleted preimages before restore can mutate managed entities.\n    const reservationsToRestore = reservations\n      .filter((reservation) => reservation.deleted_at !== null)\n      .map((reservation) => ({ ...reservation }))\n\n    await this.reservationItemService_.restore(\n      { line_item_id: lineItemId },\n      context\n    )\n\n    await this.adjustInventoryLevelsForReservationsRestore(\n      reservationsToRestore,\n      context\n    )\n  }";
  const native = select(source), adapted = select(target);
  /** @param {string} method */
  const emitMethod = method => emitForkRuntime("class InventoryRestoreGuard {\n" + method + "\n}");
  if (emitMethod(native.method.getText(native.parsed)) !== emitMethod(original)
    || emitMethod(adapted.method.getText(adapted.parsed)) !== emitMethod(corrected)) throw new Error(message);
  // Only the authenticated method is restored for whole-module runtime parity.
  const normalized = target.slice(0, adapted.method.getStart(adapted.parsed))
    + native.method.getText(native.parsed) + target.slice(adapted.method.end);
  verifyModuleTypeFork(source, normalized);
}

/** @param {string} source @param {string} target @param {string} helper */
export function verifyInventoryReservationArithmeticExtraction(source, target, helper) {
  const message = "Changed native Inventory Reservation arithmetic extraction";
  const methodName = "adjustInventoryLevelsForReservations_";
  /** @param {string} text */
  const parse = text => {
    emitForkRuntime(text);
    const parsed = ts.createSourceFile("inventory-arithmetic.ts", text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    return parsed;
  };
  /** @param {ts.SourceFile} parsed */
  const select = parsed => {
    const classes = parsed.statements.filter(node => ts.isClassDeclaration(node) && node.name?.text === "InventoryModuleService");
    if (classes.length !== 1 || !ts.isClassDeclaration(classes[0])) throw new Error(message);
    const methods = classes[0].members.filter(node => ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === methodName);
    if (methods.length !== 1 || !ts.isMethodDeclaration(methods[0]) || !methods[0].body) throw new Error(message);
    return methods[0];
  };
  const native = parse(source), adapted = parse(target), original = select(native), delegated = select(adapted);
  const body = original.body;
  if (!body) throw new Error(message);
  const statements = body.statements;
  if (statements?.length !== 5) throw new Error(message);
  const [multiplier, ensureLevels, grouping, updates, apply] = statements;
  if (!multiplier || !ensureLevels || !grouping || !updates || !apply || !ts.isVariableStatement(updates)
    || updates.declarationList.declarations.length !== 1) throw new Error(message);
  const update = updates.declarationList.declarations[0];
  if (!update || !ts.isIdentifier(update.name) || update.name.text !== "levelAdjustmentUpdates" || !update.initializer) throw new Error(message);
  const methodHeader = original.getText(native).slice(0, body.getStart(native) - original.getStart(native));
  const expectedMethod = methodHeader + "{\n" + ensureLevels.getText(native)
    + "\nconst levelAdjustmentUpdates = inventoryLevelReservationAdjustments(reservations, inventoryLevels, isDelete);\n"
    + apply.getText(native) + "\n}";
  /** @param {string} method */
  const emitMethod = method => emitForkRuntime("class InventoryArithmeticGuard {\n" + method + "\n}");
  if (emitMethod(delegated.getText(adapted)) !== emitMethod(expectedMethod)) throw new Error(message);
  const helperFile = parse(helper);
  const helperStatements = helperFile.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === "inventoryLevelReservationAdjustments");
  if (helperStatements.length !== 1 || !ts.isFunctionDeclaration(helperStatements[0])) throw new Error(message);
  const extracted = helperStatements[0];
  const expectedHelper = "export function inventoryLevelReservationAdjustments(reservations, inventoryLevels, isDelete) {\n"
    + multiplier.getText(native) + "\n" + grouping.getText(native) + "\nreturn " + update.initializer.getText(native) + ";\n}";
  if (emitForkRuntime(extracted.getText(helperFile)) !== emitForkRuntime(expectedHelper)) throw new Error(message);
  // The pre-existing availability extraction and utility import are unchanged.
  const beforeHelper = helper.slice(0, extracted.getStart(helperFile)) + helper.slice(extracted.end);
  const originalHelper = 'import { BigNumber, MathBN } from "@medusajs/framework/utils/portable"\n'
    + 'import type { BigNumberInput } from "@medusajs/framework/types"\n'
    + 'export function inventoryLevelAvailableQuantity(stocked: BigNumberInput, reserved: BigNumberInput) {\n'
    + 'return new BigNumber(MathBN.sub(stocked, reserved))\n}\n';
  if (emitForkRuntime(beforeHelper) !== emitForkRuntime(originalHelper)) throw new Error(message);
  const imports = adapted.statements.filter(node => ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
    && node.moduleSpecifier.text === "../utils/inventory-level-quantity");
  if (imports.length !== 1 || !ts.isImportDeclaration(imports[0])) throw new Error(message);
  const imported = imports[0], bindings = imported.importClause?.namedBindings;
  if (imported.importClause?.isTypeOnly || imported.importClause?.name || !bindings || !ts.isNamedImports(bindings)
    || bindings.elements.length !== 1 || bindings.elements[0]?.isTypeOnly || bindings.elements[0]?.propertyName
    || bindings.elements[0]?.name.text !== "inventoryLevelReservationAdjustments") throw new Error(message);
  // Restore the exact original method and erase its sole authenticated helper
  // import before the caller checks complete module runtime parity.
  const replacements = [{ start: delegated.getStart(adapted), end: delegated.end, text: original.getText(native) },
    { start: imported.getStart(adapted), end: imported.end, text: "" }].sort((left, right) => right.start - left.start);
  let normalized = target;
  for (const replacement of replacements) normalized = normalized.slice(0, replacement.start) + replacement.text + normalized.slice(replacement.end);
  return normalized;
}

const owners = new Map([
  ["packages/medusa-api-key", "@medusajs/api-key"],
  ["packages/medusa-order", "@medusajs/order"],
  ["packages/medusa-cart", "@medusajs/cart"],
  ["packages/medusa-customer", "@medusajs/customer"],
  ["packages/medusa-tax", "@medusajs/tax"],
  ["packages/medusa-payment", "@medusajs/payment"],
  ["packages/medusa-promotion", "@medusajs/promotion"],
  ["packages/medusa-currency", "@medusajs/currency"],
  ["packages/medusa-product", "@medusajs/product"],
  ["packages/medusa-sales-channel", "@medusajs/sales-channel"],
  ["packages/medusa-store", "@medusajs/store"],
  ["packages/medusa-fulfillment", "@medusajs/fulfillment"],
  ["packages/medusa-fulfillment-manual", "@medusajs/fulfillment-manual"],
  ["packages/medusa-locking", "@medusajs/locking"],
  ["packages/medusa-region", "@medusajs/region"],
  ["packages/medusa-pricing", "@medusajs/pricing"],
  ["packages/medusa-inventory", "@medusajs/inventory"],
  ["packages/medusa-stock-location", "@medusajs/stock-location"],
  ["packages/medusa-notification", "@medusajs/notification"],
  ["packages/medusa-notification-local", "@medusajs/notification-local"],
  ["packages/medusa-link-modules", "@medusajs/link-modules"],
  ["packages/medusa-core-flows", "@medusajs/core-flows"],
  ["packages/medusa-workflows-sdk", "@medusajs/workflows-sdk"],
  ["packages/medusa-orchestration", "@medusajs/orchestration"],
  ["packages/medusa-drizzle", "@medusajs/drizzle"],
  ["packages/medusa-types", "@medusajs/types"],
  ["packages/medusa-utils", "@medusajs/utils"],
  ["packages/medusa-framework", "@medusajs/framework"],
  ["packages/medusa-modules-sdk", "@medusajs/modules-sdk"],
  ["packages/medusa-deps", "@medusajs/deps"],
  ["packages/medusa-test-utils", "@medusajs/test-utils"],
  ["packages/medusa-adapter", "@flarex/medusa-adapter"],
]);

/** @typedef {{ target: string, targetSha256: string, source?: string, sourceSha256?: string, classification: string }} PromotionFile */
/** @typedef {{ path: string, name: string, dependencies: Record<string,string>, exports: string[] }} PromotionPackage */
/** @typedef {{ target: string, targetSha256: string, input: string }} BuildFile */
/** @typedef {{ importer: string, specifier: string, target: string, configuration: string }} TestAlias */
/** @typedef {{ files: PromotionFile[], buildFiles: BuildFile[], packages: PromotionPackage[], sourceCommit: string, testAliases: TestAlias[] }} Promotion */
/** @param {unknown} value @returns {value is Record<string, unknown>} */
const record = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
/** @param {unknown} value @returns {value is string} */
const string = (value) => typeof value === "string";
/** @param {unknown} value @returns {asserts value is Promotion} */
function assertPromotion(value) {
  if (!record(value) || value.sourceCommit !== revision || !Array.isArray(value.files) || !Array.isArray(value.packages)
    || !Array.isArray(value.buildFiles) || !value.buildFiles.every((file) => record(file) && string(file.target) && string(file.targetSha256) && string(file.input))
    || !Array.isArray(value.testAliases) || !value.testAliases.every((alias) => record(alias) && string(alias.importer) && string(alias.specifier) && string(alias.target) && string(alias.configuration))
    || !value.files.every((file) => record(file) && string(file.target) && string(file.targetSha256)
      && string(file.classification) && (file.source === undefined || string(file.source))
      && (file.sourceSha256 === undefined || string(file.sourceSha256)))
    || !value.packages.every((pkg) => record(pkg) && string(pkg.path) && string(pkg.name)
      && record(pkg.dependencies) && Object.values(pkg.dependencies).every(string)
      && Array.isArray(pkg.exports) && pkg.exports.every(string))) {
    throw new Error("Invalid Currency promotion manifest");
  }
}
/** @param {Uint8Array} bytes */
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
/** @param {string} relative */
function validPath(relative) {
  return !relative.includes("\\") && !path.posix.isAbsolute(relative) && !relative.includes(":")
    && relative.split("/").every((part) => part !== ".." && part !== "." && part !== "");
}
/** @param {string} root @param {string} relative */
function noSymlinks(root, relative) {
  let current = root;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error(`Promotion symlink: ${relative}`);
  }
}
/** @param {string} root @param {string} relative @returns {string[]} */
function inventory(root, relative) {
  return readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap((entry) => {
    if (["node_modules", "dist", ".vite"].includes(entry.name)) return [];
    const file = `${relative}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Promotion symlink: ${file}`);
    return entry.isDirectory() ? inventory(root, file) : [file];
  });
}
/** @param {string} root @param {unknown} supplied @returns {Promotion} */
export function verifyCurrencyPromotion(root, supplied = JSON.parse(readFileSync(path.join(root, manifestPath), "utf8"))) {
  assertPromotion(supplied);
  verifyTax170SourceSelection(supplied.files);
  verifyNativeDatabaseConstraintSource(root);
  verifyNativeRequiredValidationSource(root);
  verifyTaxRegionCreateCallbacks(
    readFileSync(path.join(root, "third_party/medusa/upstream/packages/core/core-flows/src/tax/workflows/create-tax-regions.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/tax/workflows/create-tax-regions.ts"), "utf8"),
    readFileSync(path.join(root, "third_party/medusa/upstream/packages/core/core-flows/src/tax/steps/create-tax-regions.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/tax/steps/create-tax-regions.ts"), "utf8"));
  verifyTaxRateDeletionCallbacks(
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/tax/workflows/delete-tax-rates.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/tax/workflows/delete-tax-rates.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/tax/steps/delete-tax-rates.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/tax/steps/delete-tax-rates.ts"), "utf8"));
  const awilixErrors = verifyPortableAwilixSource(pathToFileURL(path.resolve(root) + path.sep));
  if (awilixErrors.length) throw new Error(awilixErrors.join("\n"));
  verifyNativeJsonAssignment(root);
  verifyTaxRuleCreatorType(
    readFileSync(path.join(root, taxRuleCreatorTypeSourcePair.source), "utf8"),
    readFileSync(path.join(root, taxRuleCreatorTypeSourcePair.target), "utf8"));
  verifyTaxRateUpdateCallbacks(
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/tax/workflows/update-tax-rates.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/tax/workflows/update-tax-rates.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/tax/steps/update-tax-rates.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/tax/steps/update-tax-rates.ts"), "utf8"));
  verifyUpdateMetadataExtraction(
    readFileSync(path.join(root, sourcePrefix + "packages/core/utils/src/modules-sdk/medusa-internal-service.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-utils/src/modules-sdk/medusa-internal-service.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-utils/src/modules-sdk/prepare-update-metadata.ts"), "utf8"));
  verifyTaxRuleReplacementCallbacks(
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/tax/workflows/set-tax-rate-rules.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/tax/workflows/set-tax-rate-rules.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/tax/steps/list-tax-rate-rule-ids.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/tax/steps/list-tax-rate-rule-ids.ts"), "utf8"));
  verifyTaxRuleDeleteCallbacks(
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/tax/workflows/delete-tax-rate-rules.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/tax/workflows/delete-tax-rate-rules.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/tax/steps/delete-tax-rate-rules.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/tax/steps/delete-tax-rate-rules.ts"), "utf8"));
  verifyTaxRuleCreateCallbacks(
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/tax/workflows/create-tax-rate-rules.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/tax/workflows/create-tax-rate-rules.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/tax/steps/create-tax-rate-rules.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/tax/steps/create-tax-rate-rules.ts"), "utf8"));
  verifyTaxRateCreateCallbacks(
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/tax/workflows/create-tax-rates.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/tax/workflows/create-tax-rates.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/tax/steps/create-tax-rates.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/tax/steps/create-tax-rates.ts"), "utf8"));
  verifyPricingCandidateConstraintExport(
    readFileSync(path.join(root, sourcePrefix + "packages/modules/pricing/src/services/index.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-pricing/src/services/index.ts"), "utf8"));
  verifyNativePriceListPriceNormalization(
    readFileSync(path.join(root, pricingRepositoryNormalizationSource[1]), "utf8"),
    readFileSync(path.join(root, pricingRepositoryNormalizationSource[0]), "utf8"),
    readFileSync(path.join(root, "packages/medusa-utils/src/dal/upsert-planning.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-utils/src/dal/create-planning.ts"), "utf8"));
  verifyPriceListPriceCreationCallbacks(
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/price-list/workflows/create-price-list-prices.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/price-list/workflows/create-price-list-prices.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/price-list/steps/create-price-list-prices.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/price-list/steps/create-price-list-prices.ts"), "utf8"));
  verifyPriceListPriceCreationSelection(readFileSync(path.join(root, "packages/medusa-adapter/src/workflows/pricing/create-price-list-prices.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-adapter/src/workflow/policy.ts"), "utf8"));
  verifyPriceListPriceRemovalCallbacks(
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/price-list/workflows/remove-price-list-prices.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/price-list/workflows/remove-price-list-prices.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/price-list/steps/remove-price-list-prices.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/price-list/steps/remove-price-list-prices.ts"), "utf8"));
  verifyPriceListPriceRemovalSelection(readFileSync(path.join(root, "packages/medusa-adapter/src/workflows/pricing/remove-price-list-prices.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-adapter/src/workflow/policy.ts"), "utf8"));
  verifyPriceListPriceBatchCallbacks(readFileSync(path.join(root, priceListPriceBatchSourcePair.source), "utf8"),
    readFileSync(path.join(root, priceListPriceBatchSourcePair.target), "utf8"));
  verifyPriceListPriceBatchSelection(readFileSync(path.join(root, "packages/medusa-adapter/src/workflows/pricing/batch-price-list-prices.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-adapter/src/workflow/policy.ts"), "utf8"));
  verifyPriceListPriceBatchService(readFileSync(path.join(root, "packages/medusa-adapter/src/modules/pricing/price-list-price-batch-service.ts"), "utf8"));
  verifyVariantItemPricingSource(root);
  verifyPriceListPriceUpdatePolicySelection(readFileSync(path.join(root, "packages/medusa-adapter/src/modules/pricing/price-list-price-update-receipt.ts"), "utf8"));
  verifyPriceListPriceUpdateSelection(readFileSync(path.join(root, "packages/medusa-adapter/src/workflows/pricing/update-price-list-prices.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-adapter/src/workflow/policy.ts"), "utf8"));
  verifyPriceListDeleteSelection(
    readFileSync(path.join(root, "packages/medusa-adapter/src/workflows/pricing/delete-price-lists.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-adapter/src/workflow/policy.ts"), "utf8"));
  verifyPriceListDeleteCallbacks(
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/price-list/workflows/delete-price-lists.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/price-list/workflows/delete-price-lists.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/price-list/steps/delete-price-lists.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/price-list/steps/delete-price-lists.ts"), "utf8"));
  verifyPriceListUpdateCallbacks(
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/price-list/workflows/update-price-lists.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/price-list/workflows/update-price-lists.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/price-list/steps/update-price-lists.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/price-list/steps/update-price-lists.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/price-list/steps/validate-price-lists.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/price-list/steps/validate-price-lists.ts"), "utf8"));
  verifyNativePriceListRuleBuilder(
    readFileSync(path.join(root, sourcePrefix + "packages/core/utils/src/pricing/builders.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-utils/src/pricing/price-list-rules.ts"), "utf8"));
  verifyPriceListCreateCallbacks(
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/price-list/workflows/create-price-lists.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/price-list/workflows/create-price-lists.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/price-list/steps/create-price-lists.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/price-list/steps/create-price-lists.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/price-list/steps/validate-variant-price-links.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/price-list/steps/validate-variant-price-links.ts"), "utf8"));
  verifyPricePreferenceDeleteCallbacks(
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/pricing/workflows/delete-price-preferences.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/pricing/workflows/delete-price-preferences.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/pricing/steps/delete-price-preferences.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/pricing/steps/delete-price-preferences.ts"), "utf8"));
  verifyPricePreferenceUpdateCallbacks(
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/pricing/workflows/update-price-preferences.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/pricing/workflows/update-price-preferences.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/pricing/steps/update-price-preferences.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/pricing/steps/update-price-preferences.ts"), "utf8"));
  verifyPricePreferenceCreateCallbacks(
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/pricing/workflows/create-price-preferences.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/pricing/workflows/create-price-preferences.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/pricing/steps/create-price-preferences.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/pricing/steps/create-price-preferences.ts"), "utf8"));
  verifySalesChannelProductLinkCallbacks(
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/sales-channel/workflows/link-products-to-sales-channel.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/sales-channel/workflows/link-products-to-sales-channel.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/sales-channel/steps/associate-products-with-channels.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/sales-channel/steps/associate-products-with-channels.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/sales-channel/steps/detach-products-from-sales-channels.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/sales-channel/steps/detach-products-from-sales-channels.ts"), "utf8"));
  const promotion = supplied;
  verifyApiKeySelection(promotion.files);
  verifyNativeLinkOperationSelection(promotion.files);
  verifyCartPrerequisiteSourceSelection(promotion.files);
  verifyPaymentSessionSelection(promotion.files);
  verifyOrderArchiveSourceSelection(promotion.files);
  verifyOrderCompleteSourceSelection(promotion.files);
  verifyOrderChangeUpdateSourceSelection(promotion.files);
  verifyOrderChangeCancellationSourceSelection(promotion.files);
  verifyOrderChangeDeclineSourceSelection(promotion.files);
  verifyOrderChangeDeletionSourceSelection(promotion.files);
  verifyOrderFinanceSelection(promotion.files);
  verifyTaxRuleReplacementSelection(promotion.files);
  verifyInventoryConfirmationSourceSelection(promotion.files);
  const sums = readFileSync(path.join(root, "third_party/medusa/SOURCE_SHA256SUMS"));
  if (sha256(sums) !== "d20d4f16843cd4844b2f1c4807a5787488e0f08bc068bba9641926984f183017") {
    throw new Error("Changed pinned Medusa source manifest");
  }
  if (promotion.packages.length !== owners.size || new Set(promotion.packages.map((pkg) => pkg.path)).size !== owners.size) {
    throw new Error("Currency promotion must enumerate exactly the approved private packages");
  }
  const files = new Set(promotion.files.map((file) => file.target));
  /** @type {Array<{importer: string, configuration: string, target?: string}>} */
  const expectedAliases = [
    { importer: "packages/medusa-product/integration-tests/__tests__/product.spec.ts", configuration: "packages/medusa-adapter/vitest.product-upstream.config.ts", target: "packages/medusa-adapter/test/support/logical-product-runner.ts" },
    { importer: "packages/medusa-product/integration-tests/__tests__/product-category.spec.ts", configuration: "packages/medusa-adapter/vitest.product-internal-categories.config.ts", target: "packages/medusa-adapter/test/support/logical-internal-category-runner.ts" },
    { importer: "packages/medusa-currency/integration-tests/__tests__/currency-module-service.spec.ts", configuration: "packages/medusa-adapter/vitest.config.ts" },
    { importer: "packages/medusa-sales-channel/integration-tests/__tests__/services/sales-channel-module.spec.ts", configuration: "packages/medusa-adapter/vitest.sales-channel-upstream.config.ts", target: "packages/medusa-adapter/test/support/sales-channel-runner.ts" },
    ...["events.spec.ts", "products.spec.ts", "product-tags.spec.ts", "product-collections.spec.ts", "product-options.spec.ts", "product-variants.spec.ts"].map(name => ({ importer: "packages/medusa-product/integration-tests/__tests__/product-module-service/" + name, configuration: "packages/medusa-adapter/vitest.product-upstream.config.ts", target: "packages/medusa-adapter/test/support/logical-product-runner.ts" })),
    { importer: "packages/medusa-product/integration-tests/__tests__/product-module-service/product-types.spec.ts", configuration: "packages/medusa-adapter/vitest.product-types.config.ts", target: "packages/medusa-adapter/test/support/logical-public-type-runner.ts" },
    { importer: "packages/medusa-product/integration-tests/__tests__/product-module-service/product-categories.spec.ts", configuration: "packages/medusa-adapter/vitest.product-public-categories.config.ts", target: "packages/medusa-adapter/test/support/logical-public-category-runner.ts" },
  ];
  if (promotion.testAliases.length !== expectedAliases.length || expectedAliases.some(expected =>
    promotion.testAliases.filter(alias => alias.importer === expected.importer
      && alias.configuration === expected.configuration && alias.specifier === "@medusajs/test-utils"
      && alias.target === (expected.target ?? "packages/medusa-adapter/test/support/runner.ts")
      && [alias.importer, alias.target, alias.configuration].every(file => files.has(file))).length !== 1)) {
    throw new Error("Unadmitted module test harness alias");
  }
  if (files.size !== promotion.files.length) throw new Error("Duplicate promotion target");
  verifyPricingCreateTests(
    readFileSync(path.join(root, sourcePrefix + "packages/modules/pricing/integration-tests/__tests__/services/pricing-module/price-set.spec.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-adapter/test/support/pricing-native-tests.ts"), "utf8"),
  );
  verifyPricingWorkflowSelection(
    readFileSync(path.join(root, sourcePrefix + "packages/core/types/src/pricing/service.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-adapter/src/modules/pricing/service.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-adapter/src/modules/pricing/repository.ts"), "utf8"),
  );
  const pricingSource = readFileSync(path.join(root, sourcePrefix + "packages/modules/pricing/src/services/pricing-module.ts"), "utf8");
  const pricingTarget = readFileSync(path.join(root, "packages/medusa-pricing/src/services/pricing-module.ts"), "utf8");
  verifyNativePriceListPriceUpdate({ pricing: pricingTarget,
    step: readFileSync(path.join(root, "packages/medusa-core-flows/src/price-list/steps/update-price-list-prices.ts"), "utf8"),
    workflow: readFileSync(path.join(root, "packages/medusa-core-flows/src/price-list/workflows/update-price-list-prices.ts"), "utf8"),
    types: readFileSync(path.join(root, "packages/medusa-types/src/pricing/price-list-price-update.ts"), "utf8"),
    index: readFileSync(path.join(root, "packages/medusa-types/src/pricing/index.ts"), "utf8"),
  });
  verifyModuleTypeFork(pricingSource, verifyPricingNormalizationExtraction(pricingSource,
    stripNativePriceListPriceUpdatePricingExtension(pricingTarget),
    readFileSync(path.join(root, "packages/medusa-pricing/src/normalization.ts"), "utf8")));
  verifyShippingProfileCreateTests(
    readFileSync(path.join(root, sourcePrefix + "packages/modules/fulfillment/integration-tests/__tests__/fulfillment-module-service/shipping-profile.spec.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-adapter/test/support/shipping-profile-native-tests.ts"), "utf8"),
  );
  verifyTestPort(
    readFileSync(path.join(root, sourcePrefix + "packages/modules/fulfillment/integration-tests/__fixtures__/events.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-adapter/test/support/shipping-profile-events-fixture.ts"), "utf8"),
  );
  const sourceHashes = new Map(readFileSync(path.join(root, "third_party/medusa/SOURCE_SHA256SUMS"), "utf8")
    .split(/\r?\n/).filter(Boolean).map((line) => ["third_party/medusa/" + line.slice(66), line.slice(0, 64)]));
  verifyInventoryCreateTests(
    readFileSync(path.join(root, sourcePrefix + "packages/modules/inventory/integration-tests/__tests__/inventory-module-service.spec.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-adapter/test/support/inventory-native-tests.ts"), "utf8"),
  );
  verifyInventoryUpdateTests(
    readFileSync(path.join(root, sourcePrefix + "packages/modules/inventory/integration-tests/__tests__/inventory-module-service.spec.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-adapter/test/support/inventory-update-native-tests.ts"), "utf8"),
  );
  verifyInventoryLevelUpdateTests(
    readFileSync(path.join(root, sourcePrefix + "packages/modules/inventory/integration-tests/__tests__/inventory-module-service.spec.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-adapter/test/support/inventory-level-update-native-tests.ts"), "utf8"),
  );
  verifyInventoryLevelDeleteCallbacks(
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/inventory/workflows/delete-inventory-levels.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/inventory/workflows/delete-inventory-levels.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/common/steps/delete-entities.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/common/steps/delete-entities.ts"), "utf8"),
  );
  verifyInventoryItemDeleteCallbacks(
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/inventory/workflows/delete-inventory-items.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/inventory/workflows/delete-inventory-items.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/inventory/steps/delete-inventory-items.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/inventory/steps/delete-inventory-items.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/common/steps/remove-remote-links.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/common/steps/remove-remote-links.ts"), "utf8"),
  );
  verifyInventoryLevelBatchCallbacks(
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/inventory/workflows/batch-inventory-item-levels.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/inventory/workflows/batch-inventory-item-levels.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/inventory/steps/create-inventory-levels.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/inventory/steps/create-inventory-levels.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/inventory/steps/update-inventory-levels.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/inventory/steps/update-inventory-levels.ts"), "utf8"),
  );
  verifyReservationLineItemDeletionCallbacks(
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/reservation/workflows/delete-reservations-by-line-items.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/reservation/workflows/delete-reservations-by-line-items.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/reservation/steps/delete-reservations-by-line-items.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/reservation/steps/delete-reservations-by-line-items.ts"), "utf8"),
  );
  verifyServiceZoneUpdateCallbacks(
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/fulfillment/workflows/update-service-zones.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/fulfillment/workflows/update-service-zones.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/fulfillment/steps/update-service-zones.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/fulfillment/steps/update-service-zones.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/types/src/workflow/fulfillment/service-zones.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-types/src/workflow/fulfillment/service-zones.ts"), "utf8"),
  );
  verifyFulfillmentSetDeleteCallbacks(
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/fulfillment/workflows/delete-fulfillment-sets.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/fulfillment/workflows/delete-fulfillment-sets.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/fulfillment/steps/delete-fulfillment-sets.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/fulfillment/steps/delete-fulfillment-sets.ts"), "utf8"),
  );
  verifyServiceZoneDeleteCallbacks(
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/fulfillment/workflows/delete-service-zones.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/fulfillment/workflows/delete-service-zones.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/fulfillment/steps/delete-service-zones.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/fulfillment/steps/delete-service-zones.ts"), "utf8"),
  );
  verifyServiceZoneCreateCallbacks(
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/fulfillment/workflows/create-service-zones.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/fulfillment/workflows/create-service-zones.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/fulfillment/steps/create-service-zones.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/fulfillment/steps/create-service-zones.ts"), "utf8"),
    readFileSync(path.join(root, "third_party/medusa/upstream/packages/core/types/src/workflow/fulfillment/service-zones.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-types/src/workflow/fulfillment/service-zones.ts"), "utf8"),
  );
  verifyShippingOptionTypeDeleteCallbacks(
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/shipping-options/workflows/delete-shipping-option-types.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/shipping-options/workflows/delete-shipping-option-types.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/shipping-options/steps/delete-shipping-option-types.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/shipping-options/steps/delete-shipping-option-types.ts"), "utf8"),
  );
  verifyShippingOptionTypeUpdateCallbacks(
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/shipping-options/workflows/update-shipping-option-types.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/shipping-options/workflows/update-shipping-option-types.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/shipping-options/steps/update-shipping-option-types.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/shipping-options/steps/update-shipping-option-types.ts"), "utf8"),
  );
  verifyShippingOptionTypeCreateCallbacks(
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/shipping-options/workflows/create-shipping-option-types.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/shipping-options/workflows/create-shipping-option-types.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/shipping-options/steps/create-shipping-option-types.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/shipping-options/steps/create-shipping-option-types.ts"), "utf8"),
  );
  verifyNativeToManyInitialization(
    readFileSync(path.join(root, "third_party/medusa/upstream/packages/database/drizzle/src/medusa.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-drizzle/src/relation-query.ts"), "utf8"),
  );
  verifyNativeRelationScalarFields(
    readFileSync(path.join(root, "third_party/medusa/upstream/packages/database/drizzle/src/medusa.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-drizzle/src/relation-query.ts"), "utf8"),
  );
  verifyShippingProfileDeleteCallbacks(
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/shipping-profile/workflows/delete-shipping-profile.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/shipping-profile/workflows/delete-shipping-profile.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/shipping-profile/steps/delete-shipping-profile.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/shipping-profile/steps/delete-shipping-profile.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/common/steps/remove-remote-links.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/common/steps/remove-remote-links.ts"), "utf8"),
  );
  verifyLocationFulfillmentSetCallbacks(
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/stock-location/workflows/create-location-fulfillment-set.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/stock-location/workflows/create-location-fulfillment-set.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/fulfillment/steps/create-fulfillment-set.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/fulfillment/steps/create-fulfillment-set.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/stock-location/steps/associate-locations-with-fulfillment-sets.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/stock-location/steps/associate-locations-with-fulfillment-sets.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/modules/link-modules/src/definitions/fulfillment-set-location.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-link-modules/src/definitions/fulfillment-set-location.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/types/src/workflows/stock-locations/mutations.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-types/src/workflows/stock-locations/mutations.ts"), "utf8"),
  );
  verifyShippingOptionRuleBatchCallbacks(
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/fulfillment/workflows/batch-shipping-option-rules.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/fulfillment/workflows/batch-shipping-option-rules.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/fulfillment/steps/create-shipping-option-rules.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/fulfillment/steps/create-shipping-option-rules.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/fulfillment/steps/update-shipping-option-rules.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/fulfillment/steps/update-shipping-option-rules.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/fulfillment/steps/delete-shipping-option-rules.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/fulfillment/steps/delete-shipping-option-rules.ts"), "utf8"),
  );
  verifyShippingProfileCreateCallbacks(
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/fulfillment/workflows/create-shipping-profiles.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/fulfillment/workflows/create-shipping-profiles.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/fulfillment/steps/create-shipping-profiles.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/fulfillment/steps/create-shipping-profiles.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/types/src/workflow/fulfillment/shipping-profiles.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-types/src/workflow/fulfillment/shipping-profiles.ts"), "utf8"),
  );
  verifyShippingProfileUpdateCallbacks(
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/fulfillment/workflows/update-shipping-profiles.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/fulfillment/workflows/update-shipping-profiles.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/fulfillment/steps/update-shipping-profiles.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/fulfillment/steps/update-shipping-profiles.ts"), "utf8"),
  );
  verifyStoreUpdateCallbacks(
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/store/workflows/update-stores.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/store/workflows/update-stores.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/store/steps/update-stores.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/store/steps/update-stores.ts"), "utf8"),
  );
  verifyStoreCreateCallbacks(
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/store/workflows/create-stores.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/store/workflows/create-stores.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/store/steps/create-stores.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/store/steps/create-stores.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/pricing/steps/update-price-preferences-as-array.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/pricing/steps/update-price-preferences-as-array.ts"), "utf8"),
  );
  verifyStoreCreationTypes(
    readFileSync(path.join(root, sourcePrefix + "packages/core/types/src/workflow/store/index.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-types/src/workflow/store/index.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/types/src/workflow/pricing/index.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-types/src/workflow/pricing/index.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/types/src/http/store/admin/payloads.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-types/src/http/store/admin/payloads.ts"), "utf8"),
  );
  verifyStoreDeleteCallbacks(
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/store/workflows/delete-stores.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/store/workflows/delete-stores.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/store/steps/delete-stores.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/store/steps/delete-stores.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/common/steps/remove-remote-links.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/common/steps/remove-remote-links.ts"), "utf8"),
  );
  verifyInventoryItemCreateCallbacks(
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/inventory/workflows/create-inventory-items.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/inventory/workflows/create-inventory-items.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/inventory/steps/create-inventory-items.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/inventory/steps/create-inventory-items.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/inventory/workflows/create-inventory-levels.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/inventory/workflows/create-inventory-levels.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/inventory/steps/create-inventory-levels.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/inventory/steps/create-inventory-levels.ts"), "utf8"),
    readFileSync(path.join(root, sourcePrefix + "packages/core/core-flows/src/inventory/steps/validate-inventory-locations.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-core-flows/src/inventory/steps/validate-inventory-locations.ts"), "utf8"),
  );
  const csvSource = sourcePrefix + "packages/core/utils/src/product/__tests__/";
  const csvTarget = "packages/medusa-utils/src/product/__tests__/";
  const csvFixtures = ["multiple-products-multiple-variants.json", "same-product-multiple-rows.json",
    "same-product-multiple-variant-options.json", "single-row-create.json"];
  const fixtureText = (/** @type {string} */ prefix) => Object.fromEntries(csvFixtures.map(name =>
    [name, readFileSync(path.join(root, prefix, "__fixtures__", name), "utf8")]));
  verifyCsvNormalizerTests(readFileSync(path.join(root, csvSource, "csv-normalizer.spec.ts"), "utf8"),
    readFileSync(path.join(root, csvTarget, "csv-normalizer.spec.ts"), "utf8"),
    fixtureText(csvSource), fixtureText(csvTarget));
  verifyShippingOptionCreateCallbacks(root);
  verifyShippingOptionUpdateCallbacks(root);
  verifyShippingOptionDeleteCallbacks(root);
  verifyFulfillmentCreationCallbacks(root);
  verifyReturnFulfillmentCreationCallbacks(root);
  verifyFulfillmentCancellationCallbacks(root);
  verifyFulfillmentShipmentCallbacks(root);
  verifyFulfillmentDeliveryCallbacks(root);
  verifyNativeSkipStepResponseType(
    readFileSync(path.join(root, sourcePrefix + "packages/core/workflows-sdk/src/utils/composer/create-step.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-workflows-sdk/src/durable/utils/composer/create-step.ts"), "utf8"));
  verifyNativeFilterValue(
    readFileSync(path.join(root, sourcePrefix + "packages/database/drizzle/src/repository.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-drizzle/src/filter-value.ts"), "utf8"));
  verifyNativeJoinerFieldAlias(
    readFileSync(path.join(root, sourcePrefix + "packages/core/orchestration/src/joiner/remote-joiner.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-orchestration/src/joiner-field-alias.ts"), "utf8"));
  verifyNativeNullToOneInitialization(
    readFileSync(path.join(root, sourcePrefix + "packages/database/drizzle/src/medusa.ts"), "utf8"),
    readFileSync(path.join(root, "packages/medusa-drizzle/src/relation-query.ts"), "utf8"));
  /** @param {string} target @param {string} source @returns {[string, string]} */
  const shippingSourcePair = (target, source) => [target, source];
  const shippingNativeSources = new Map([
    ...["models/region.ts", "models/country.ts", "models/index.ts", "services/index.ts", "types/index.ts"].map(file =>
      shippingSourcePair("packages/medusa-region/src/" + file, "packages/modules/region/src/" + file)),
    ["packages/medusa-fulfillment-manual/src/services/manual-fulfillment.ts", "packages/modules/providers/fulfillment-manual/src/services/manual-fulfillment.ts"],
    ...["fulfillment-provider-location.ts", "shipping-option-price-set.ts"].map(file =>
      shippingSourcePair("packages/medusa-link-modules/src/definitions/" + file, "packages/modules/link-modules/src/definitions/" + file)),
  ]);
  const shippingUnchangedSources = new Map([
    ...["common.ts", "mutations.ts", "service.ts", "index.ts"].map(file =>
      shippingSourcePair("packages/medusa-types/src/region/" + file, "packages/core/types/src/region/" + file)),
    ...["create-shipping-options.ts", "update-shipping-options.ts", "delete-shipping-options.ts", "create-fulfillment.ts", "create-shipment.ts", "update-fulfillment.ts"].map(file =>
      shippingSourcePair("packages/medusa-types/src/workflow/fulfillment/" + file, "packages/core/types/src/workflow/fulfillment/" + file)),
    ["packages/medusa-utils/src/fulfillment/provider.ts", "packages/core/utils/src/fulfillment/provider.ts"],
    ["packages/medusa-utils/src/link/links.ts", "packages/core/utils/src/link/links.ts"],
  ]);
  const priceListDeleteSources = ["price-list/workflows/delete-price-lists.ts", "price-list/steps/delete-price-lists.ts"].map(relative =>
    ["packages/medusa-core-flows/src/" + relative, sourcePrefix + "packages/core/core-flows/src/" + relative]);
  const priceListUpdateSources = ["price-list/workflows/update-price-lists.ts", "price-list/steps/update-price-lists.ts",
    "price-list/steps/validate-price-lists.ts"].map(relative => ["packages/medusa-core-flows/src/" + relative,
      sourcePrefix + "packages/core/core-flows/src/" + relative]);
  const priceListRuleBuilderTarget = "packages/medusa-utils/src/pricing/price-list-rules.ts";
  const priceListRuleBuilderSource = sourcePrefix + "packages/core/utils/src/pricing/builders.ts";
  const priceListPriceSources = ["price-list/workflows/create-price-list-prices.ts", "price-list/steps/create-price-list-prices.ts"];
  const priceListPriceUpdateSources = ["price-list/workflows/update-price-list-prices.ts", "price-list/steps/update-price-list-prices.ts"];
  const priceListPriceRemovalSources = ["price-list/workflows/remove-price-list-prices.ts", "price-list/steps/remove-price-list-prices.ts"];
  for (const file of promotion.files) {
    const variantPricingPair = variantItemPricingSourcePairs.find(pair => file.target === pair.target || file.source === pair.source);
    if (variantPricingPair !== undefined && (file.target !== variantPricingPair.target || file.source !== variantPricingPair.source ||
      file.classification !== (file.target.endsWith("/cart/utils/fields.ts") || file.target.endsWith("/common/filter-object-by-keys.ts")
        ? "unchanged" : file.target.includes("/medusa-core-flows/") ? "workflowFork" : "variantItemPricingFork")))
      throw new Error("Variant Item pricing outside its exact pinned source pair");
    if (file.classification === "variantItemPricingFork" && variantPricingPair === undefined)
      throw new Error("Variant Item pricing fork outside its exact pinned source pair");
    const normalizationPair = file.source === pricingRepositoryNormalizationSource[1] &&
      (file.target === pricingRepositoryNormalizationSource[0] && file.classification === "nativeRepositoryFork" ||
        file.target === "packages/medusa-utils/src/dal/upsert-planning.ts" && file.classification === "selectedExportFacade");
    if (([pricingRepositoryNormalizationSource[0], "packages/medusa-utils/src/dal/upsert-planning.ts"].includes(file.target) || file.source === pricingRepositoryNormalizationSource[1] || file.classification === "nativeRepositoryFork") && !normalizationPair)
      throw new Error("Native Pricing normalization outside its exact promoted repository pair");
    const priceListPricePair = priceListPriceSources.find(relative => file.target === "packages/medusa-core-flows/src/" + relative || file.source === sourcePrefix + "packages/core/core-flows/src/" + relative);
    if (priceListPricePair !== undefined && (file.target !== "packages/medusa-core-flows/src/" + priceListPricePair || file.source !== sourcePrefix + "packages/core/core-flows/src/" + priceListPricePair || file.classification !== "workflowFork"))
      throw new Error("PriceList Price creation outside its exact pinned source pair");
    const priceListPriceUpdatePair = priceListPriceUpdateSources.find(relative => file.target === "packages/medusa-core-flows/src/" + relative || file.source === sourcePrefix + "packages/core/core-flows/src/" + relative);
    if (priceListPriceUpdatePair !== undefined && (file.target !== "packages/medusa-core-flows/src/" + priceListPriceUpdatePair || file.source !== sourcePrefix + "packages/core/core-flows/src/" + priceListPriceUpdatePair || file.classification !== "workflowFork"))
      throw new Error("PriceList Price update outside its exact pinned source pair");
    const priceListPriceRemovalPair = priceListPriceRemovalSources.find(relative => file.target === "packages/medusa-core-flows/src/" + relative || file.source === sourcePrefix + "packages/core/core-flows/src/" + relative);
    if (priceListPriceRemovalPair !== undefined && (file.target !== "packages/medusa-core-flows/src/" + priceListPriceRemovalPair || file.source !== sourcePrefix + "packages/core/core-flows/src/" + priceListPriceRemovalPair || file.classification !== "workflowFork"))
      throw new Error("PriceList Price removal outside its exact pinned source pair");
    if ((file.target === priceListPriceBatchSourcePair.target || file.source === priceListPriceBatchSourcePair.source) &&
      (file.target !== priceListPriceBatchSourcePair.target || file.source !== priceListPriceBatchSourcePair.source || file.classification !== "workflowFork"))
      throw new Error("PriceList Price batch outside its exact pinned source pair");
    // Bind both directions: neither a selected target nor its native source
    // can be relabeled, redirected, or reused as a different extraction.
    const priceListDeletePair = priceListDeleteSources.find(([target, source]) => file.target === target || file.source === source);
    if (priceListDeletePair !== undefined && (file.target !== priceListDeletePair[0] || file.source !== priceListDeletePair[1] ||
      file.classification !== "workflowFork")) throw new Error("PriceList deletion outside its exact pinned source pair");
    const priceListUpdatePair = priceListUpdateSources.find(([target, source]) => file.target === target || file.source === source);
    if (priceListUpdatePair !== undefined && (file.target !== priceListUpdatePair[0] || file.source !== priceListUpdatePair[1] ||
      file.classification !== "workflowFork")) throw new Error("PriceList update outside its exact pinned source pair");
    if ((file.target === priceListRuleBuilderTarget || file.source === priceListRuleBuilderSource) &&
      (file.target !== priceListRuleBuilderTarget || file.source !== priceListRuleBuilderSource || file.classification !== "selectedExportFacade"))
      throw new Error("PriceList rule builder outside its exact pinned source pair");
    const deliveryPair = deliverySourcePairs.find(([target]) => target === file.target);
    if (deliveryPair !== undefined && (file.source !== sourcePrefix + deliveryPair[1] || file.classification !== deliveryPair[2]))
      throw new Error("Native Delivery dependency outside its exact pinned source pair");
    if (file.classification === "lockingServiceFork" && file.target !== "packages/medusa-locking/src/services/locking-module.ts")
      throw new Error("Locking service adaptation outside its selected native service");
    const shippingNativeSource = shippingNativeSources.get(file.target);
    if (shippingNativeSource !== undefined && (file.source !== sourcePrefix + shippingNativeSource ||
      !["unchanged", "importRelocation"].includes(file.classification)))
      throw new Error("Native Shipping dependency outside its exact pinned source pair");
    const shippingUnchangedSource = shippingUnchangedSources.get(file.target);
    if (shippingUnchangedSource !== undefined && (file.source !== sourcePrefix + shippingUnchangedSource || file.classification !== "unchanged"))
      throw new Error("Native Shipping contract outside its unchanged pinned source pair");
    if (file.target.startsWith("packages/medusa-core-flows/src/fulfillment/") &&
      ["workflows/create-shipping-options.ts", "steps/upsert-shipping-options.ts", "steps/validate-fulfillment-providers.ts",
        "steps/validate-shipping-option-prices.ts", "steps/add-shipping-options-prices.ts", "steps/set-shipping-options-price-sets.ts",
        "workflows/update-shipping-options.ts", "steps/set-shipping-options-prices.ts",
        "workflows/delete-shipping-options.ts", "steps/delete-shipping-options.ts",
        "workflows/create-fulfillment.ts", "steps/create-fulfillment.ts",
        "workflows/create-return-fulfillment.ts", "steps/create-return-fulfillment.ts",
        "workflows/cancel-fulfillment.ts", "steps/cancel-fulfillment.ts",
        "workflows/create-shipment.ts", "workflows/update-fulfillment.ts", "steps/validate-shipment.ts", "steps/update-fulfillment.ts"]
        .includes(file.target.slice("packages/medusa-core-flows/src/fulfillment/".length)) &&
      (file.classification !== "workflowFork" || file.source !== sourcePrefix + "packages/core/core-flows/src/" + file.target.slice("packages/medusa-core-flows/src/".length)))
      throw new Error("Shipping Option workflow outside its exact pinned source pair");
    if (["packages/medusa-core-flows/src/stock-location/workflows/create-location-fulfillment-set.ts",
      "packages/medusa-core-flows/src/fulfillment/steps/create-fulfillment-set.ts",
      "packages/medusa-core-flows/src/stock-location/steps/associate-locations-with-fulfillment-sets.ts"].includes(file.target)
      && (file.classification !== "workflowFork" || file.source !== sourcePrefix + "packages/core/core-flows/src/" + file.target.slice("packages/medusa-core-flows/src/".length)))
      throw new Error("LocationFulfillmentSet workflow adaptation outside its exact pinned source pair");
    if (file.target === "packages/medusa-link-modules/src/definitions/fulfillment-set-location.ts"
      && (file.classification !== "linkFork" || file.source !== sourcePrefix + "packages/modules/link-modules/src/definitions/fulfillment-set-location.ts"))
      throw new Error("LocationFulfillmentSet definition adaptation outside its exact pinned source pair");
    if (file.target === "packages/medusa-types/src/workflows/stock-locations/mutations.ts"
      && (file.classification !== "unchanged" || file.source !== sourcePrefix + "packages/core/types/src/workflows/stock-locations/mutations.ts"))
      throw new Error("LocationFulfillmentSet workflow type outside its exact unchanged pinned source");
    if (["packages/medusa-core-flows/src/fulfillment/workflows/batch-shipping-option-rules.ts",
      ...["create", "update", "delete"].map(kind => "packages/medusa-core-flows/src/fulfillment/steps/" + kind + "-shipping-option-rules.ts")].includes(file.target)
      && (file.classification !== "workflowFork" || file.source !== sourcePrefix + "packages/core/core-flows/src/" + file.target.slice("packages/medusa-core-flows/src/".length)))
      throw new Error("ShippingOptionRule batch adaptation outside its exact pinned source pair");
    if (["packages/medusa-core-flows/src/fulfillment/workflows/create-shipping-profiles.ts", "packages/medusa-core-flows/src/fulfillment/steps/create-shipping-profiles.ts"].includes(file.target)
      && (file.classification !== "workflowFork" || file.source !== sourcePrefix + "packages/core/core-flows/src/" + file.target.slice("packages/medusa-core-flows/src/".length)))
      throw new Error("ShippingProfile creation adaptation outside its exact pinned source pair");
    if (["packages/medusa-core-flows/src/fulfillment/workflows/delete-fulfillment-sets.ts", "packages/medusa-core-flows/src/fulfillment/steps/delete-fulfillment-sets.ts"].includes(file.target)
      && (file.classification !== "workflowFork" || file.source !== sourcePrefix + "packages/core/core-flows/src/" + file.target.slice("packages/medusa-core-flows/src/".length)))
      throw new Error("FulfillmentSet deletion adaptation outside its exact pinned source pair");
    if (file.target === "packages/medusa-drizzle/src/relation-query.ts"
      && (file.classification !== "selectedExportFacade" || file.source !== sourcePrefix + "packages/database/drizzle/src/medusa.ts"))
      throw new Error("Native relation projection extraction outside its exact pinned source pair");
    if (["packages/medusa-core-flows/src/fulfillment/workflows/update-service-zones.ts", "packages/medusa-core-flows/src/fulfillment/steps/update-service-zones.ts"].includes(file.target)
      && (file.classification !== "workflowFork" || file.source !== sourcePrefix + "packages/core/core-flows/src/" + file.target.slice("packages/medusa-core-flows/src/".length)))
      throw new Error("ServiceZone update adaptation outside its exact pinned source pair");
    if (["packages/medusa-core-flows/src/fulfillment/workflows/delete-service-zones.ts", "packages/medusa-core-flows/src/fulfillment/steps/delete-service-zones.ts"].includes(file.target)
      && (file.classification !== "workflowFork" || file.source !== sourcePrefix + "packages/core/core-flows/src/" + file.target.slice("packages/medusa-core-flows/src/".length)))
      throw new Error("ServiceZone deletion adaptation outside its exact pinned source pair");
    if (["packages/medusa-core-flows/src/fulfillment/workflows/create-service-zones.ts", "packages/medusa-core-flows/src/fulfillment/steps/create-service-zones.ts"].includes(file.target)
      && (file.classification !== "workflowFork" || file.source !== sourcePrefix + "packages/core/core-flows/src/" + file.target.slice("packages/medusa-core-flows/src/".length)))
      throw new Error("ServiceZone creation adaptation outside its exact pinned source pair");
    if (file.target === "packages/medusa-types/src/workflow/fulfillment/service-zones.ts" && (file.classification !== "unchanged" || file.source !== "third_party/medusa/upstream/packages/core/types/src/workflow/fulfillment/service-zones.ts"))
      throw new Error("ServiceZone workflow type outside its exact unchanged pinned source");
    if (["packages/medusa-core-flows/src/shipping-options/workflows/delete-shipping-option-types.ts", "packages/medusa-core-flows/src/shipping-options/steps/delete-shipping-option-types.ts"].includes(file.target)
      && (file.classification !== "workflowFork" || file.source !== sourcePrefix + "packages/core/core-flows/src/" + file.target.slice("packages/medusa-core-flows/src/".length)))
      throw new Error("ShippingOptionType deletion adaptation outside its exact pinned source pair");
    if (["packages/medusa-core-flows/src/shipping-options/workflows/update-shipping-option-types.ts", "packages/medusa-core-flows/src/shipping-options/steps/update-shipping-option-types.ts"].includes(file.target)
      && (file.classification !== "workflowFork" || file.source !== sourcePrefix + "packages/core/core-flows/src/" + file.target.slice("packages/medusa-core-flows/src/".length)))
      throw new Error("ShippingOptionType update adaptation outside its exact pinned source pair");
    if (["packages/medusa-core-flows/src/shipping-options/workflows/create-shipping-option-types.ts", "packages/medusa-core-flows/src/shipping-options/steps/create-shipping-option-types.ts"].includes(file.target)
      && (file.classification !== "workflowFork" || file.source !== sourcePrefix + "packages/core/core-flows/src/" + file.target.slice("packages/medusa-core-flows/src/".length)))
      throw new Error("ShippingOptionType creation adaptation outside its exact pinned source pair");
    if (file.target === "packages/medusa-region/src/services/region-module.ts"
      && (file.classification !== "regionServiceFork" || file.source !== sourcePrefix + "packages/modules/region/src/services/region-module.ts"))
      throw new Error("Region service adaptation outside its exact pinned source pair");
    if (file.classification === "regionServiceFork" && file.target !== "packages/medusa-region/src/services/region-module.ts")
      throw new Error("Region service adaptation outside its selected native service");
    for (const [target, source] of [
      ["packages/medusa-types/src/pricing/index.ts", "packages/core/types/src/pricing/index.ts"],
      ["packages/medusa-drizzle/src/filter-value.ts", "packages/database/drizzle/src/repository.ts"],
      ["packages/medusa-orchestration/src/joiner-field-alias.ts", "packages/core/orchestration/src/joiner/remote-joiner.ts"],
      ["packages/medusa-region/src/static-manifest.ts", "packages/modules/region/src/static-manifest.ts"],
      ["packages/medusa-pricing/src/normalization.ts", "packages/modules/pricing/src/services/pricing-module.ts"],
    ]) if (file.target === target && (file.classification !== "selectedExportFacade" || file.source !== sourcePrefix + source))
      throw new Error("Shipping Option extraction outside its exact pinned source pair");
    const taxRuleDeleteTargets = ["packages/medusa-core-flows/src/tax/workflows/delete-tax-rate-rules.ts", "packages/medusa-core-flows/src/tax/steps/delete-tax-rate-rules.ts"];
    if ((file.classification === "taxRateDeletionFork" || taxRateDeletionSourcePairs.some(pair => pair.target === file.target)) &&
      !taxRateDeletionSourcePairs.some(pair => pair.target === file.target && pair.source === file.source && pair.classification === file.classification))
      throw new Error("Tax Rate deletion outside its exact pinned source pairs");
    if (file.classification === "taxRateUpdateFork" && !taxRateUpdateSourcePairs.some(pair =>
      pair.target === file.target && pair.source === file.source && pair.classification === file.classification))
      throw new Error("Tax Rate update outside its exact pinned source pairs");
    if (file.classification === "updateMetadataFork" && !updateMetadataSourcePairs.some(pair =>
      pair.target === file.target && pair.source === file.source && pair.classification === file.classification))
      throw new Error("Native update metadata extraction outside its exact pinned source pairs");
    if (file.classification === "taxRuleCreatorTypeFork" && (file.target !== taxRuleCreatorTypeSourcePair.target ||
      file.source !== taxRuleCreatorTypeSourcePair.source))
      throw new Error("Tax Rule creator type outside its exact pinned source pair");
    if (file.classification === "taxRuleReplacementFork" && !taxRuleReplacementSourcePairs.some(pair =>
      pair.target === file.target && pair.source === file.source && pair.classification === file.classification))
      throw new Error("Tax Rate Rule replacement outside its exact pinned source pairs");
    if ((taxRuleDeleteTargets.includes(file.target) || file.classification === "taxRuleDeletionFork") &&
      (!taxRuleDeleteTargets.includes(file.target) || file.classification !== "taxRuleDeletionFork" ||
        file.source !== sourcePrefix + "packages/core/core-flows/src/" + file.target.slice("packages/medusa-core-flows/src/".length)))
      throw new Error("Tax Rate Rule deletion outside its exact pinned source pairs");
    const taxRuleCreateTargets = ["packages/medusa-core-flows/src/tax/workflows/create-tax-rate-rules.ts", "packages/medusa-core-flows/src/tax/steps/create-tax-rate-rules.ts"];
    if ((taxRuleCreateTargets.includes(file.target) || file.classification === "taxRuleCreationFork") &&
      (!taxRuleCreateTargets.includes(file.target) || file.classification !== "taxRuleCreationFork" ||
        file.source !== sourcePrefix + "packages/core/core-flows/src/" + file.target.slice("packages/medusa-core-flows/src/".length)))
      throw new Error("Tax Rate Rule creation outside its exact pinned source pairs");
    const taxRateCreateTargets = ["packages/medusa-core-flows/src/tax/workflows/create-tax-rates.ts", "packages/medusa-core-flows/src/tax/steps/create-tax-rates.ts"];
    if ((taxRateCreateTargets.includes(file.target) || file.classification === "taxRateCreationFork") &&
      (!taxRateCreateTargets.includes(file.target) || file.classification !== "taxRateCreationFork" ||
        file.source !== sourcePrefix + "packages/core/core-flows/src/" + file.target.slice("packages/medusa-core-flows/src/".length)))
      throw new Error("Tax Rate creation outside its exact pinned source pairs");
    if (file.classification === "taxLinesFork" && !taxLinesSourcePairs.some(pair => pair.target === file.target && pair.source === file.source))
      throw new Error("Tax lines outside their exact native source pairs");
    if (file.classification === "paymentJoinerFork" && !cartPrerequisiteSourcePairs.some(pair => pair.target === file.target && pair.classification === "paymentJoinerFork"))
      throw new Error("Payment joiner adaptation outside its selected native source pair");
    if (file.classification === "workflowCacheFork" && !workflowCacheSourcePairs.some(pair => pair.target === file.target && pair.source === file.source && pair.classification === file.classification))
      throw new Error("Workflow cache adaptation outside its selected native source pair");
    if (file.classification === "customerSelectionFork" && !customerSelectionSourcePairs.some(pair => pair.target === file.target && pair.source === file.source && pair.classification === file.classification))
      throw new Error("Customer selection adaptation outside its selected native source pair");
    if (file.classification === "inventoryConfirmationFork" && !inventoryConfirmationSourcePairs.some(pair => pair.target === file.target && pair.source === file.source && pair.classification === file.classification))
      throw new Error("Inventory confirmation adaptation outside its selected native source pair");
    if (!["unchanged", "preserved", "unchangedTest", "importRelocation", "selectedExportFacade", "testHarnessPort", "testPort", "testFixturePort", "workflowFork", "linkFork", "productServiceFork", "inventoryServiceFork", "notificationServiceFork", "lockingServiceFork", "salesChannelTypeFork", "stockLocationTypeFork", "regionServiceFork", "pricingServiceFork", "nativeRepositoryFork", "storeTypeFork", "storeCreationTypeFork", "priceListCreationTypeFork", "shippingProfileWorkflowTypeFork", "csvNormalizerFork", "schemaCompilerFork", "variantItemPricingFork", "paymentJoinerFork", "workflowCacheFork", "customerSelectionFork", "inventoryConfirmationFork", "taxLinesFork", "taxRateCreationFork", "taxRegionCreationFork", "nativeDatabaseConstraintFork", "taxRuleCreationFork", "taxRuleDeletionFork", "taxRateDeletionFork", "taxRuleReplacementFork", "orderArchiveFork", "orderArchiveCompensationFork", "orderCompleteFork", "orderChangeUpdateFork", "orderChangeCancellationFork", "orderChangeDeclineFork", "orderChangeDeletionFork", "orderChangeCancellationRestoreFork", "paymentSessionTypeFork", "taxRateUpdateFork", "updateMetadataFork", "taxRuleCreatorTypeFork", "apiKeyFork", "authored"].includes(file.classification)) {
      throw new Error(`Unadmitted source transformation: ${file.target}`);
    }
    if (file.target === "packages/medusa-pricing/src/services/pricing-module.ts" || file.classification === "pricingServiceFork") {
      if (file.target !== "packages/medusa-pricing/src/services/pricing-module.ts" || file.classification !== "pricingServiceFork" ||
        file.source !== sourcePrefix + "packages/modules/pricing/src/services/pricing-module.ts")
        throw new Error("Pricing normalization delegation outside its exact pinned source pair");
    }
    if (file.classification === "workflowFork" && !(file.target.startsWith("packages/medusa-workflows-sdk/src/") || file.target.startsWith("packages/medusa-core-flows/src/") || file.target.startsWith("packages/medusa-orchestration/src/") || [
      "packages/medusa-utils/src/common/create-portable-id.ts",
      "packages/medusa-utils/src/common/is-error-like.ts",
      "packages/medusa-utils/src/common/serialize-error.ts",
      "packages/medusa-utils/src/common/parse-stringify-if-necessary.ts",
      "packages/medusa-utils/src/orchestration/types.ts",
      "packages/medusa-utils/src/orchestration/symbol.ts",
      "packages/medusa-adapter/test/workflow-composer-upstream.test.ts",
    ].includes(file.target))) {
      throw new Error("Workflow fork adaptation outside its approved source closure");
    }
    if (["packages/medusa-core-flows/src/price-list/workflows/create-price-lists.ts",
      "packages/medusa-core-flows/src/price-list/steps/create-price-lists.ts",
      "packages/medusa-core-flows/src/price-list/steps/validate-variant-price-links.ts"].includes(file.target)
      && (file.classification !== "workflowFork" || file.source !== sourcePrefix + "packages/core/core-flows/src/" + file.target.slice("packages/medusa-core-flows/src/".length)))
      throw new Error("PriceList creation outside its exact pinned source pair");
    if (["packages/medusa-core-flows/src/pricing/workflows/delete-price-preferences.ts",
      "packages/medusa-core-flows/src/pricing/steps/delete-price-preferences.ts"].includes(file.target)
      && (file.classification !== "workflowFork" || file.source !== sourcePrefix + "packages/core/core-flows/src/" + file.target.slice("packages/medusa-core-flows/src/".length)))
      throw new Error("PricePreference deletion outside its exact pinned source pair");
    if (["packages/medusa-core-flows/src/pricing/workflows/update-price-preferences.ts",
      "packages/medusa-core-flows/src/pricing/steps/update-price-preferences.ts"].includes(file.target)
      && (file.classification !== "workflowFork" || file.source !== sourcePrefix + "packages/core/core-flows/src/" + file.target.slice("packages/medusa-core-flows/src/".length)))
      throw new Error("PricePreference update outside its exact pinned source pair");
    if (["packages/medusa-core-flows/src/pricing/workflows/create-price-preferences.ts",
      "packages/medusa-core-flows/src/pricing/steps/create-price-preferences.ts"].includes(file.target)
      && (file.classification !== "workflowFork" || file.source !== sourcePrefix + "packages/core/core-flows/src/" + file.target.slice("packages/medusa-core-flows/src/".length)))
      throw new Error("PricePreference creation outside its exact pinned source pair");
    if (["packages/medusa-core-flows/src/sales-channel/workflows/link-products-to-sales-channel.ts",
      "packages/medusa-core-flows/src/sales-channel/steps/associate-products-with-channels.ts",
      "packages/medusa-core-flows/src/sales-channel/steps/detach-products-from-sales-channels.ts"].includes(file.target)
      && (file.classification !== "workflowFork" || file.source !== sourcePrefix + "packages/core/core-flows/src/" + file.target.slice("packages/medusa-core-flows/src/".length)))
      throw new Error("SalesChannel Product membership outside its exact pinned source pair");
    if (file.target === "packages/medusa-modules-sdk/src/link.ts"
      && (file.classification !== "linkFork" || file.source !== sourcePrefix + "packages/core/modules-sdk/src/link.ts"))
      throw new Error("Link cascade adaptation outside its exact pinned source pair");
    if (file.classification === "linkFork" && ![
      ...nativeLinkOperationSourcePairs.map(pair => pair.target),
      "packages/medusa-modules-sdk/src/link.ts",
      "packages/medusa-link-modules/src/utils/generate-entity.ts",
      "packages/medusa-link-modules/src/services/dynamic-service-class.ts",
      "packages/medusa-link-modules/src/services/link-module-service.ts",
      "packages/medusa-link-modules/src/definitions/product-sales-channel.ts",
      "packages/medusa-link-modules/src/definitions/product-shipping-profile.ts",
      "packages/medusa-link-modules/src/definitions/product-variant-price-set.ts",
      "packages/medusa-link-modules/src/definitions/product-variant-inventory-item.ts",
      "packages/medusa-link-modules/src/definitions/sales-channel-location.ts",
      "packages/medusa-link-modules/src/definitions/fulfillment-set-location.ts",
    ].includes(file.target)) throw new Error("Link adaptation outside its approved finite source closure");
    if (file.classification === "productServiceFork" && ![
      "packages/medusa-product/src/services/product-module-service.ts",
      "packages/medusa-product/src/services/product-category.ts",
    ].includes(file.target)) throw new Error("Product service adaptation outside its approved source files");
    if (file.classification === "inventoryServiceFork" && (file.target !== "packages/medusa-inventory/src/services/inventory-module.ts"
      || file.source !== "third_party/medusa/upstream/packages/modules/inventory/src/services/inventory-module.ts"))
      throw new Error("Inventory service adaptation outside its approved source file");
    if (file.classification === "notificationServiceFork" && ![
      "packages/medusa-notification/src/services/notification-module-service.ts",
      "packages/medusa-notification/src/services/notification-delivery.ts",
    ].includes(file.target)) throw new Error("Notification service adaptation outside its approved source files");
    if (file.classification === "salesChannelTypeFork" && ![
      "packages/medusa-types/src/sales-channel/service.ts",
      "packages/medusa-sales-channel/src/services/sales-channel-module.ts",
    ].includes(file.target)) throw new Error("Sales Channel type adaptation outside its approved source files");
    const priceListTypes = ["pricing/common/money-amount.ts", "pricing/common/price-list.ts", "pricing/workflows.ts"];
    if (file.classification === "priceListCreationTypeFork" && !priceListTypes.some(relative =>
      file.target === "packages/medusa-types/src/" + relative && file.source === sourcePrefix + "packages/core/types/src/" + relative))
      throw new Error("PriceList creation type adaptation outside its approved source files");
    if (priceListTypes.some(relative => file.target === "packages/medusa-types/src/" + relative)
      && (file.classification !== "priceListCreationTypeFork" || file.source !== sourcePrefix + "packages/core/types/src/" + file.target.slice("packages/medusa-types/src/".length)))
      throw new Error("PriceList creation type adaptation outside its exact pinned source pair");
    if (file.classification === "storeCreationTypeFork" && ![["packages/medusa-types/src/store/mutations/store.ts","packages/core/types/src/store/mutations/store.ts"],["packages/medusa-types/src/pricing/common/price-preference.ts","packages/core/types/src/pricing/common/price-preference.ts"],["packages/medusa-types/src/workflow/pricing/index.ts","packages/core/types/src/workflow/pricing/index.ts"]].some(([target, source]) => file.target === target && file.source === sourcePrefix + source))
      throw new Error("Store creation type adaptation outside its approved source files");
    if (file.classification === "shippingProfileWorkflowTypeFork" && (file.target !== "packages/medusa-types/src/workflow/fulfillment/shipping-profiles.ts" || file.source !== "third_party/medusa/upstream/packages/core/types/src/workflow/fulfillment/shipping-profiles.ts"))
      throw new Error("ShippingProfile workflow type adaptation outside its approved source file");
    if (file.classification === "storeTypeFork" && (file.target !== "packages/medusa-store/src/services/store-module-service.ts" || file.source !== sourcePrefix + "packages/modules/store/src/services/store-module-service.ts"))
      throw new Error("Store type adaptation outside its approved source file");
    if (file.classification === "stockLocationTypeFork" && ![
      "packages/medusa-types/src/stock-location/common.ts",
      "packages/medusa-types/src/stock-location/service.ts",
      "packages/medusa-stock-location/src/services/stock-location-module.ts",
    ].includes(file.target)) throw new Error("Stock Location type adaptation outside its approved source files");
    if (file.classification === "csvNormalizerFork" && file.target !== "packages/medusa-utils/src/product/csv-normalizer.ts")
      throw new Error("CSV normalizer adaptation outside its approved source file");
    if (file.classification === "schemaCompilerFork" && ![
      "packages/medusa-drizzle/src/dml-types.ts", "packages/medusa-drizzle/src/schema.ts",
    ].includes(file.target)) {
      throw new Error("Schema compiler adaptation outside its approved source files");
    }
    const owned = [...owners.keys()].some((owner) => file.target.startsWith(owner + "/"))
      || file.target === "tools/medusa/tsconfig.fork.json";
    if (!validPath(file.target) || !owned) throw new Error(`Unadmitted promotion target: ${file.target}`);
    noSymlinks(root, file.target);
    if (sha256(readFileSync(path.join(root, file.target))) !== file.targetSha256) throw new Error(`Changed promotion target: ${file.target}`);
    if (file.source !== undefined) {
      if (apiKeySourcePairs.some(pair => pair.target === file.target))
        verifyApiKeySource(readFileSync(path.join(root, file.source), "utf8"), readFileSync(path.join(root, file.target), "utf8"), file.target);
      if (!validPath(file.source) || !file.source.startsWith(sourcePrefix)
        || sourceHashes.get(file.source) !== file.sourceSha256) throw new Error(`Unpinned promotion source: ${file.source}`);
      noSymlinks(root, file.source);
      const hash = sha256(readFileSync(path.join(root, file.source)));
      if (hash !== file.sourceSha256) throw new Error(`Changed promotion source: ${file.source}`);
      if (shippingNativeSources.has(file.target))
        verifyModuleTypeFork(readFileSync(path.join(root, file.source), "utf8"), readFileSync(path.join(root, file.target), "utf8"));
      if (cartPrerequisiteSourcePairs.some(pair => pair.target === file.target && pair.classification === "importRelocation"))
        verifyModuleTypeFork(readFileSync(path.join(root, file.source), "utf8"), readFileSync(path.join(root, file.target), "utf8"));
      if (orderArchiveSourcePairs.some(pair => pair.target === file.target))
        verifyOrderArchiveSource(readFileSync(path.join(root, file.source), "utf8"), readFileSync(path.join(root, file.target), "utf8"), file.target);
      if (orderCompleteSourcePairs.some(pair => pair.target === file.target))
        verifyOrderCompleteSource(readFileSync(path.join(root, file.source), "utf8"), readFileSync(path.join(root, file.target), "utf8"), file.target);
      if (orderChangeUpdateSourcePairs.some(pair => pair.target === file.target))
        verifyOrderChangeUpdateSource(readFileSync(path.join(root, file.source), "utf8"), readFileSync(path.join(root, file.target), "utf8"), file.target);
      if (orderChangeDeclineSourcePairs.some(pair => pair.target === file.target && pair.classification === "orderChangeDeclineFork"))
        verifyOrderChangeDeclineSource(readFileSync(path.join(root, file.source), "utf8"), readFileSync(path.join(root, file.target), "utf8"), file.target);
      if (orderChangeDeletionSourcePairs.some(pair => pair.target === file.target && pair.classification === "orderChangeDeletionFork"))
        verifyOrderChangeDeletionSource(readFileSync(path.join(root, file.source), "utf8"), readFileSync(path.join(root, file.target), "utf8"), file.target);
      if (orderChangeCancellationSourcePairs.some(pair => pair.target === file.target))
        verifyOrderChangeCancellationSource(readFileSync(path.join(root, file.source), "utf8"), readFileSync(path.join(root, file.target), "utf8"), file.target);
      if (file.target === "packages/medusa-order/src/services/order-module-service.ts")
        verifyOrderFinanceHelpers(readFileSync(path.join(root, file.source), "utf8"),
          readFileSync(path.join(root, "packages/medusa-order/src/utils/payment-accounting.ts"), "utf8"),
          readFileSync(path.join(root, "packages/medusa-order/src/utils/totals-selection.ts"), "utf8"),
          readFileSync(path.join(root, "packages/medusa-order/src/utils/preview-details.ts"), "utf8"));
      if (paymentSessionSourcePairs.some(pair => pair.target === file.target))
        verifyPaymentSessionSource(readFileSync(path.join(root, file.source), "utf8"), readFileSync(path.join(root, file.target), "utf8"), file.target);
      if (paymentSessionTypeSourcePairs.some(pair => pair.target === file.target))
        verifyPaymentSessionTypeSource(readFileSync(path.join(root, file.source), "utf8"), readFileSync(path.join(root, file.target), "utf8"), file.target);
      if (file.classification === "taxLinesFork")
        verifyTaxLinesFork(readFileSync(path.join(root, file.source), "utf8"), readFileSync(path.join(root, file.target), "utf8"), file.target);
      if (file.classification === "paymentJoinerFork")
        verifyPaymentJoinerFork(readFileSync(path.join(root, file.source), "utf8"), readFileSync(path.join(root, file.target), "utf8"));
      if (file.classification === "workflowCacheFork")
        verifyWorkflowCacheFork(readFileSync(path.join(root, file.source), "utf8"), readFileSync(path.join(root, file.target), "utf8"), file.target);
      if (customerSelectionSourcePairs.some(pair => pair.target === file.target && pair.classification !== "testPort"))
        verifyCustomerSelectionFork(readFileSync(path.join(root, file.source), "utf8"), readFileSync(path.join(root, file.target), "utf8"), file.target);
      const inventoryConfirmationPair = inventoryConfirmationSourcePairs.find(pair => pair.target === file.target);
      if (inventoryConfirmationPair?.classification === "inventoryConfirmationFork" || inventoryConfirmationPair?.target === "packages/medusa-utils/src/common/deep-flat-map.ts")
        verifyInventoryConfirmationFork(readFileSync(path.join(root, file.source), "utf8"), readFileSync(path.join(root, file.target), "utf8"), file.target);
      if (inventoryConfirmationPair?.classification === "testPort")
        verifyInventoryConfirmationPreparationTest(readFileSync(path.join(root, file.source), "utf8"), readFileSync(path.join(root, file.target), "utf8"));
      if (file.target === inventoryAvailabilitySourcePair.target)
        verifyNativeInventoryAvailabilityExtraction(readFileSync(path.join(root, file.source), "utf8"), readFileSync(path.join(root, file.target), "utf8"));
      if (file.classification === "inventoryServiceFork")
        verifyInventoryReservationRestoreFork(readFileSync(path.join(root, file.source), "utf8"), readFileSync(path.join(root, file.target), "utf8"),
          readFileSync(path.join(root, "packages/medusa-inventory/src/utils/inventory-level-quantity.ts"), "utf8"));
      if (file.target === "packages/medusa-modules-sdk/src/link.ts") {
        verifyLinkCascadeReturnMapFork(readFileSync(path.join(root, file.source), "utf8"), readFileSync(path.join(root, file.target), "utf8"));
      }
      if (file.classification === "storeCreationTypeFork")
        verifyStoreCreationTypeFork(readFileSync(path.join(root, file.source), "utf8"), readFileSync(path.join(root, file.target), "utf8"), file.target);
      if (file.classification === "priceListCreationTypeFork")
        verifyPriceListCreationTypeFork(readFileSync(path.join(root, file.source), "utf8"), readFileSync(path.join(root, file.target), "utf8"), file.target);
      if (file.classification === "shippingProfileWorkflowTypeFork")
        verifyShippingProfileWorkflowTypeFork(readFileSync(path.join(root, file.source), "utf8"), readFileSync(path.join(root, file.target), "utf8"));
      if (file.classification === "storeTypeFork")
        verifyStoreTypeFork(readFileSync(path.join(root, file.source), "utf8"), readFileSync(path.join(root, file.target), "utf8"));
      if (file.classification === "salesChannelTypeFork" || file.classification === "stockLocationTypeFork" || file.classification === "regionServiceFork")
        verifyModuleTypeFork(readFileSync(path.join(root, file.source), "utf8"), readFileSync(path.join(root, file.target), "utf8"));
      if (file.target === "packages/medusa-region/src/static-manifest.ts")
        verifyRegionManifestFork(readFileSync(path.join(root, file.source), "utf8"), readFileSync(path.join(root, file.target), "utf8"));
      // The exact Inventory preparation pair above authenticates its complete
      // typed program and relocated imports at the adapter's normal test path.
      if ((file.classification === "testPort" || file.classification === "testFixturePort") && inventoryConfirmationPair?.classification !== "testPort") {
        if (!file.target.endsWith(".ts") || !(file.classification === "testPort" ? file.target.includes("/__tests__/") : file.target.includes("/integration-tests/__fixtures__/"))) throw new Error("Invalid test-port target");
        verifyTestPort(readFileSync(path.join(root, file.source), "utf8"), readFileSync(path.join(root, file.target), "utf8"), {
          currencyTimeout: file.target === "packages/medusa-currency/integration-tests/__tests__/currency-module-service.spec.ts",
          salesChannelTimeout: file.target === "packages/medusa-sales-channel/integration-tests/__tests__/services/sales-channel-module.spec.ts",
          currencyStaticImports: file.target === "packages/medusa-currency/src/__tests__/static-manifest.spec.ts",
        });
      }
      if (["unchanged", "preserved", "unchangedTest"].includes(file.classification) && hash !== file.targetSha256) {
        throw new Error(`Preserved source changed: ${file.target}`);
      }
    } else if (file.classification !== "authored") throw new Error(`Missing source provenance: ${file.target}`);
  }
  // Existing per-file source/class owners retain their first failure before
  // the new Tax selection closes the complete validated file cohort.
  verifyTaxRateUpdateSelection(promotion.files);
  verifyTaxRateDeletionSelection(promotion.files);
  for (const pkg of promotion.packages) {
    if (owners.get(pkg.path) !== pkg.name) throw new Error(`Unadmitted promotion package: ${pkg.path}`);
    const manifest = JSON.parse(readFileSync(path.join(root, pkg.path, "package.json"), "utf8"));
    if (manifest.name !== pkg.name || manifest.private !== true
      || (pkg.name.startsWith("@medusajs/") && manifest.version !== "2.13.4")) throw new Error(`Invalid private package: ${pkg.path}`);
    if (!record(manifest.exports) || JSON.stringify(Object.keys(manifest.exports).sort()) !== JSON.stringify([...pkg.exports].sort())) {
      throw new Error(`Changed promotion exports: ${pkg.path}`);
    }
    const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
    if (JSON.stringify(Object.entries(dependencies).sort()) !== JSON.stringify(Object.entries(pkg.dependencies).sort())) {
      throw new Error(`Changed promotion dependencies: ${pkg.path}`);
    }
    for (const [name, version] of Object.entries(pkg.dependencies)) {
      if (name.startsWith("@medusajs/") && (![...owners.values()].includes(name) || version !== "workspace:*")) {
        throw new Error(`Nonlocal Medusa dependency: ${pkg.path} -> ${name}`);
      }
    }
    for (const file of inventory(root, pkg.path)) if (!files.has(file)) throw new Error(`Unlisted promotion file: ${file}`);
    if (pkg.name.startsWith("@medusajs/") && !files.has(`${pkg.path}/LICENSE`)) throw new Error(`Missing MIT notice: ${pkg.path}`);
  }
  const buildFiles = new Set(promotion.buildFiles.map((file) => file.target));
  if (buildFiles.size !== promotion.buildFiles.length) throw new Error("Duplicate build target");
  for (const file of promotion.buildFiles) {
    const expectedInput = file.target.replace("/dist/", "/src/").replace(/(?:\.d\.ts|\.js)(?:\.map)?$/, ".ts");
    if (!validPath(file.target) || !file.target.includes("/dist/") || !files.has(file.input) || file.input !== expectedInput) {
      throw new Error(`Unadmitted build target: ${file.target}`);
    }
    noSymlinks(root, file.target);
    if (existsSync(path.join(root, file.target)) && sha256(readFileSync(path.join(root, file.target))) !== file.targetSha256) {
      throw new Error(`Changed build target: ${file.target}; rebuild the approved packages`);
    }
  }
  for (const pkg of promotion.packages) {
    const output = `${pkg.path}/dist`;
    if (existsSync(path.join(root, output))) for (const file of inventory(root, output)) {
      if (!buildFiles.has(file)) throw new Error(`Unlisted build output: ${file}`);
    }
  }
  return promotion;
}

/** @param {Promotion | undefined} promotion @param {string} file @param {string} specifier */
export function admitsCurrencyImport(promotion, file, specifier) {
  if (!promotion || ![...promotion.files, ...promotion.buildFiles].some((entry) => entry.target === file)) return false;
  if (promotion.testAliases.some((alias) => alias.importer === file && alias.specifier === specifier)) return true;
  // Exact verified wrappers register complete pinned files in their fixture.
  // This is not a runtime export or a general cross-package edge.
  const internalProductTarget = "packages/medusa-product/integration-tests/__tests__/product.spec.ts";
  if (file === "packages/medusa-adapter/test/product-upstream.test.ts" &&
    specifier === "../../medusa-product/integration-tests/__tests__/product.spec"
    && promotion.files.some(entry => entry.target === internalProductTarget && ["unchangedTest", "testPort"].includes(entry.classification))
    && promotion.testAliases.some(alias => alias.importer === internalProductTarget &&
      alias.configuration === "packages/medusa-adapter/vitest.product-upstream.config.ts")) return true;
  const internalCategoryTarget = "packages/medusa-product/integration-tests/__tests__/product-category.spec.ts";
  const internalCategoryConfig = file === "packages/medusa-adapter/test/product-internal-categories-upstream.test.ts"
    ? "vitest.product-internal-categories.config.ts" : undefined;
  if (internalCategoryConfig !== undefined && specifier === "../../medusa-product/integration-tests/__tests__/product-category.spec"
    && promotion.files.some(entry => entry.target === internalCategoryTarget && ["unchangedTest", "testPort"].includes(entry.classification))
    && promotion.testAliases.some(alias => alias.importer === internalCategoryTarget && alias.configuration === "packages/medusa-adapter/" + internalCategoryConfig)) return true;
  const wrapper = file === "packages/medusa-adapter/test/product-upstream.test.ts"
    ? { names: ["events", "products", "product-tags", "product-collections", "product-options", "product-variants"], configuration: "vitest.product-upstream.config.ts" }
    : file === "packages/medusa-adapter/test/product-types-upstream.test.ts"
      ? { names: ["product-types"], configuration: "vitest.product-types.config.ts" }
      : file === "packages/medusa-adapter/test/product-public-categories-upstream.test.ts"
        ? { names: ["product-categories"], configuration: "vitest.product-public-categories.config.ts" } : undefined;
  if (wrapper !== undefined) {
    for (const name of wrapper.names) {
      const target = `packages/medusa-product/integration-tests/__tests__/product-module-service/${name}.spec.ts`;
      if (specifier === `../../medusa-product/integration-tests/__tests__/product-module-service/${name}.spec`
        && promotion.files.some((entry) => entry.target === target && ["unchangedTest", "testPort"].includes(entry.classification))
        && promotion.testAliases.some((alias) => alias.importer === target
          && alias.configuration === "packages/medusa-adapter/" + wrapper.configuration)) return true;
    }
  }
  const importer = promotion.packages.find((pkg) => file.startsWith(pkg.path + "/"));
  const target = promotion.packages.find((pkg) => specifier === pkg.name || specifier.startsWith(pkg.name + "/"));
  if (!importer || !target || (target !== importer && importer.dependencies[target.name] !== "workspace:*")) return false;
  return target.exports.includes(specifier === target.name ? "." : "." + specifier.slice(target.name.length));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = verifyCurrencyPromotion(process.cwd());
  console.log(`Verified ${result.files.length} Currency promotion files across ${result.packages.length} private packages.`);
}

/** The private Store package exposes only its existing pure normalizer for
 * receipt correlation. Authenticate that sole erased visibility seam, retaining
 * the existing emitted-JS equality guard and every native method body/call site.
 * @param {string} source @param {string} target */
export function verifyStoreTypeFork(source, target) {
  verifyModuleTypeFork(source, target);
  const expected = source
    .replace('from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"')
    .replace("private static normalizeInput<", "static normalizeInput<");
  if (expected.replace(/\r\n/g, "\n") !== target.replace(/\r\n/g, "\n"))
    throw new Error("Changed native Store normalization visibility seam");
}

/** Native callbacks emit explicit undefined and the upstream non-exact optional
 * DTO contract admits it. Only these erased boundary declarations may differ.
 * @param {string} source @param {string} target @param {string} file */
export function verifyStoreCreationTypeFork(source, target, file) {
  verifyModuleTypeFork(source, target);
  let expected = source.replace(/\r\n/g, "\n");
  if (file === "packages/medusa-types/src/store/mutations/store.ts") {
    expected = expected.replace("  is_default?: boolean\n", "  is_default?: boolean | undefined\n")
      .replace("  metadata?: Record<string, any> | null\n", "  metadata?: Record<string, any> | null | undefined\n");
  } else if (file === "packages/medusa-types/src/pricing/common/price-preference.ts") {
    expected = expected.replace("  id?: string\n", "  id?: string | undefined\n")
      .replace("  attribute?: string | null\n", "  attribute?: string | null | undefined\n")
      .replace("  value?: string | null\n", "  value?: string | null | undefined\n")
      .replace("  is_tax_inclusive?: boolean\n", "  is_tax_inclusive?: boolean | undefined\n");
  } else if (file === "packages/medusa-types/src/workflow/pricing/index.ts") {
    expected = expected.replace("  is_tax_inclusive?: boolean\n}\n\nexport interface UpdatePricePreferencesWorkflowInput",
      "  is_tax_inclusive?: boolean | undefined\n}\n\nexport interface UpdatePricePreferencesWorkflowInput");
  } else throw new Error("Store creation type adaptation outside its approved source files");
  if (expected !== target.replace(/\r\n/g, "\n")) throw new Error("Changed native Store creation erased type seam");
}

/** Only native152's actual undefined boundary values may extend these exact
 * declarations. Required PriceSet identity and every other type remain pinned.
 * @param {string} source @param {string} target @param {string} file */
export function verifyPriceListCreationTypeFork(source, target, file) {
  verifyModuleTypeFork(source, target);
  const failure = "Changed native PriceList creation erased type seam";
  /** @type {string} */
  let declaration;
  /** @type {Array<[string,string]>} */
  let replacements;
  if (file === "packages/medusa-types/src/pricing/common/money-amount.ts") {
    declaration = "CreateMoneyAmountDTO";
    replacements = [["min_quantity?: BigNumberInput | null", "min_quantity?: BigNumberInput | null | undefined"],
      ["max_quantity?: BigNumberInput | null", "max_quantity?: BigNumberInput | null | undefined"]];
  } else if (file === "packages/medusa-types/src/pricing/common/price-list.ts") {
    declaration = "CreatePriceListPriceDTO";
    replacements = [["rules?: CreatePriceListPriceRules", "rules?: CreatePriceListPriceRules | undefined"]];
  } else if (file === "packages/medusa-types/src/pricing/workflows.ts") {
    declaration = "CreatePriceListsWorkflowStepDTO";
    replacements = [["variant_price_map: Record<string, string>", "variant_price_map: Record<string, string> | undefined"]];
  } else throw new Error("PriceList creation type adaptation outside its approved source files");
  const normalized = source.replaceAll("\r\n", "\n");
  const parsed = ts.createSourceFile("price-list-types.ts", normalized, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const matches = parsed.statements.filter(node => ts.isInterfaceDeclaration(node) && node.name.text === declaration);
  const selected = matches[0];
  if (matches.length !== 1 || selected === undefined) throw new Error(failure);
  const start = selected.getStart(parsed), end = selected.end;
  let body = normalized.slice(start, end);
  for (const [before, after] of replacements) {
    if (body.split(before).length !== 2) throw new Error(failure + ": missing native declaration anchor");
    body = body.replace(before, after);
  }
  const expected = normalized.slice(0, start) + body + normalized.slice(end);
  if (expected !== target.replaceAll("\r\n", "\n")) throw new Error(failure);
}

/** The existing native Admin route and update step accept metadata. Correct only
 * the erased workflow input declaration; preserve the native runtime program.
 * @param {string} source @param {string} target */
export function verifyShippingProfileWorkflowTypeFork(source, target) {
  verifyModuleTypeFork(source, target);
  const expected = source.replace(/\r\n/g, "\n")
    .replace("  type?: string\n}", "  type?: string\n  metadata?: Record<string, unknown> | null\n}");
  if (expected !== target.replace(/\r\n/g, "\n"))
    throw new Error("Changed native ShippingProfile workflow erased type seam");
}
