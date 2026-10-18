// @ts-check
import { verifyTestPort, verifyCsvNormalizerTests, verifyShippingProfileCreateTests, verifyPricingCreateTests, verifyPricingWorkflowSelection, verifyInventoryCreateTests, verifyInventoryUpdateTests, verifyInventoryLevelUpdateTests, verifyInventoryLevelDeleteCallbacks, verifyInventoryItemDeleteCallbacks, verifyInventoryLevelBatchCallbacks, verifyInventoryItemCreateCallbacks, verifyStoreDeleteCallbacks, verifyStoreCreateCallbacks, verifyStoreCreationTypes, verifyReservationLineItemDeletionCallbacks, verifyStoreUpdateCallbacks, verifyShippingProfileUpdateCallbacks, verifyShippingProfileCreateCallbacks, verifyShippingProfileDeleteCallbacks, verifyShippingOptionTypeCreateCallbacks, verifyShippingOptionTypeUpdateCallbacks, verifyShippingOptionTypeDeleteCallbacks, verifyServiceZoneCreateCallbacks, verifyServiceZoneDeleteCallbacks, verifyFulfillmentSetDeleteCallbacks, verifyServiceZoneUpdateCallbacks, verifyNativeToManyInitialization, verifyNativeRelationScalarFields } from "./check-medusa-test-port.mjs";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "@typescript/typescript6";

const manifestPath = "roadmaps/flarexdb-framework-integration/preflight/medusa-currency-promotion.json";
const sourcePrefix = "third_party/medusa/upstream/";
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
function emitInventoryRestoreRuntime(text) {
    const result = ts.transpileModule(text, { reportDiagnostics: true, compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
      experimentalDecorators: true, removeComments: true, newLine: ts.NewLineKind.LineFeed,
    } });
    if (result.diagnostics?.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error))
      throw new Error("Invalid module type adaptation syntax");
    return result.outputText;
}

/** The approved restore correction and exact portable arithmetic extraction.
 * @param {string} source @param {string} target @param {string} helper */
export function verifyInventoryReservationRestoreFork(source, target, helper) {
  target = verifyInventoryReservationArithmeticExtraction(source, target, helper);
  const message = "Changed native Inventory reservation restore fork behavior";
  const methodName = "restoreReservationItemsByLineItem_";
  /** @param {string} text */
  const select = text => {
    emitInventoryRestoreRuntime(text);
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
  const emitMethod = method => emitInventoryRestoreRuntime("class InventoryRestoreGuard {\n" + method + "\n}");
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
    emitInventoryRestoreRuntime(text);
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
  const emitMethod = method => emitInventoryRestoreRuntime("class InventoryArithmeticGuard {\n" + method + "\n}");
  if (emitMethod(delegated.getText(adapted)) !== emitMethod(expectedMethod)) throw new Error(message);
  const helperFile = parse(helper);
  const helperStatements = helperFile.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === "inventoryLevelReservationAdjustments");
  if (helperStatements.length !== 1 || !ts.isFunctionDeclaration(helperStatements[0])) throw new Error(message);
  const extracted = helperStatements[0];
  const expectedHelper = "export function inventoryLevelReservationAdjustments(reservations, inventoryLevels, isDelete) {\n"
    + multiplier.getText(native) + "\n" + grouping.getText(native) + "\nreturn " + update.initializer.getText(native) + ";\n}";
  if (emitInventoryRestoreRuntime(extracted.getText(helperFile)) !== emitInventoryRestoreRuntime(expectedHelper)) throw new Error(message);
  // The pre-existing availability extraction and utility import are unchanged.
  const beforeHelper = helper.slice(0, extracted.getStart(helperFile)) + helper.slice(extracted.end);
  const originalHelper = 'import { BigNumber, MathBN } from "@medusajs/framework/utils/portable"\n'
    + 'import type { BigNumberInput } from "@medusajs/framework/types"\n'
    + 'export function inventoryLevelAvailableQuantity(stocked: BigNumberInput, reserved: BigNumberInput) {\n'
    + 'return new BigNumber(MathBN.sub(stocked, reserved))\n}\n';
  if (emitInventoryRestoreRuntime(beforeHelper) !== emitInventoryRestoreRuntime(originalHelper)) throw new Error(message);
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
  ["packages/medusa-currency", "@medusajs/currency"],
  ["packages/medusa-product", "@medusajs/product"],
  ["packages/medusa-sales-channel", "@medusajs/sales-channel"],
  ["packages/medusa-store", "@medusajs/store"],
  ["packages/medusa-fulfillment", "@medusajs/fulfillment"],
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
  const promotion = supplied;
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
  for (const file of promotion.files) {
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
    if (!["unchanged", "preserved", "unchangedTest", "importRelocation", "selectedExportFacade", "testHarnessPort", "testPort", "testFixturePort", "workflowFork", "linkFork", "productServiceFork", "inventoryServiceFork", "notificationServiceFork", "salesChannelTypeFork", "stockLocationTypeFork", "storeTypeFork", "storeCreationTypeFork", "shippingProfileWorkflowTypeFork", "csvNormalizerFork", "schemaCompilerFork", "authored"].includes(file.classification)) {
      throw new Error(`Unadmitted source transformation: ${file.target}`);
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
    if (file.classification === "linkFork" && ![
      "packages/medusa-modules-sdk/src/link.ts",
      "packages/medusa-link-modules/src/utils/generate-entity.ts",
      "packages/medusa-link-modules/src/services/dynamic-service-class.ts",
      "packages/medusa-link-modules/src/services/link-module-service.ts",
      "packages/medusa-link-modules/src/definitions/product-sales-channel.ts",
      "packages/medusa-link-modules/src/definitions/product-shipping-profile.ts",
      "packages/medusa-link-modules/src/definitions/product-variant-price-set.ts",
      "packages/medusa-link-modules/src/definitions/product-variant-inventory-item.ts",
      "packages/medusa-link-modules/src/definitions/sales-channel-location.ts",
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
      if (!validPath(file.source) || !file.source.startsWith(sourcePrefix)
        || sourceHashes.get(file.source) !== file.sourceSha256) throw new Error(`Unpinned promotion source: ${file.source}`);
      noSymlinks(root, file.source);
      const hash = sha256(readFileSync(path.join(root, file.source)));
      if (hash !== file.sourceSha256) throw new Error(`Changed promotion source: ${file.source}`);
      if (file.classification === "inventoryServiceFork")
        verifyInventoryReservationRestoreFork(readFileSync(path.join(root, file.source), "utf8"), readFileSync(path.join(root, file.target), "utf8"),
          readFileSync(path.join(root, "packages/medusa-inventory/src/utils/inventory-level-quantity.ts"), "utf8"));
      if (file.classification === "storeCreationTypeFork")
        verifyStoreCreationTypeFork(readFileSync(path.join(root, file.source), "utf8"), readFileSync(path.join(root, file.target), "utf8"), file.target);
      if (file.classification === "shippingProfileWorkflowTypeFork")
        verifyShippingProfileWorkflowTypeFork(readFileSync(path.join(root, file.source), "utf8"), readFileSync(path.join(root, file.target), "utf8"));
      if (file.classification === "storeTypeFork")
        verifyStoreTypeFork(readFileSync(path.join(root, file.source), "utf8"), readFileSync(path.join(root, file.target), "utf8"));
      if (file.classification === "salesChannelTypeFork" || file.classification === "stockLocationTypeFork")
        verifyModuleTypeFork(readFileSync(path.join(root, file.source), "utf8"), readFileSync(path.join(root, file.target), "utf8"));
      if (file.classification === "testPort" || file.classification === "testFixturePort") {
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
