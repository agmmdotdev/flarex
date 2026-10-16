// @ts-check
import { verifyTestPort, verifyInventoryLevelDeleteCallbacks, verifyInventoryItemDeleteCallbacks, verifyInventoryLevelBatchCallbacks } from "./check-medusa-test-port.mjs";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { admitsCurrencyImport, verifyCurrencyPromotion, verifyModuleTypeFork } from "./check-medusa-currency-promotion.mjs";
import { analyzeMedusaSourceIslandBoundary } from "./check-medusa-source-island-boundary.mjs";

const root = process.cwd();
const promotion = verifyCurrencyPromotion(root);
const source = "packages/medusa-currency/src/models/currency.ts";

describe("native Inventory Level deletion callback provenance", () => {
  const nativeWorkflow = readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/inventory/workflows/delete-inventory-levels.ts", "utf8");
  const nativeStep = readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/common/steps/delete-entities.ts", "utf8");
  const workflow = readFileSync("packages/medusa-core-flows/src/inventory/workflows/delete-inventory-levels.ts", "utf8");
  const step = readFileSync("packages/medusa-core-flows/src/common/steps/delete-entities.ts", "utf8");
  it("permits only erased type changes in the genuine inline guard and both generic callbacks", () => {
    expect(() => verifyInventoryLevelDeleteCallbacks(nativeWorkflow, workflow, nativeStep, step)).not.toThrow();
  });
  it.each([
    ["incoming predicate", "i.incoming_quantity! > 0", "i.incoming_quantity! >= 0"],
    ["reservation guard skip", "if (undeleteableDueToReservation.length)", "if (false)"],
    ["reservation before stock classification", "i.reserved_quantity > 0 || i.incoming_quantity! > 0", "i.reserved_quantity > 0 || i.incoming_quantity! > 0 || !force && i.stocked_quantity > 0"],
    ["stock guard skip", "if (undeleteableDueToStock.length)", "if (false)"],
    ["force inversion", "!force && i.stocked_quantity > 0", "force && i.stocked_quantity > 0"],
  ])("rejects changed native %s", (_name, before, after) => {
    const changed = workflow.replace(before, after);
    expect(changed).not.toBe(workflow);
    expect(() => verifyInventoryLevelDeleteCallbacks(nativeWorkflow, changed, nativeStep, step))
      .toThrow("Changed native Inventory Level deletion callback behavior");
  });
  it.each([
    ["deletion skip", "data.length ? await module[invokeMethod]!(data) : []", "false ? await module[invokeMethod]!(data) : []"],
    ["result-map exposure", "return new StepResponse(void 0,", "return new StepResponse(data,"],
    ["compensation identity drift", "entityIdentifiers: input.data", "entityIdentifiers: []"],
    ["compensation invocation drift", "await module[compensateMethod]!(entityIdentifiers)", "await module[compensateMethod]!([])"],
    ["undefined compensation guard", "} = compensateInput!", "} = compensateInput ?? {}"],
  ])("rejects changed native %s", (_name, before, after) => {
    const changed = step.replace(before, after);
    expect(changed).not.toBe(step);
    expect(() => verifyInventoryLevelDeleteCallbacks(nativeWorkflow, workflow, nativeStep, changed))
      .toThrow("Changed native Inventory Level deletion callback behavior");
  });
});

describe("native Inventory Item deletion callback provenance", () => {
  const nativeWorkflow = readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/inventory/workflows/delete-inventory-items.ts", "utf8");
  const workflow = readFileSync("packages/medusa-core-flows/src/inventory/workflows/delete-inventory-items.ts", "utf8");
  const nativeStep = readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/inventory/steps/delete-inventory-items.ts", "utf8");
  const step = readFileSync("packages/medusa-core-flows/src/inventory/steps/delete-inventory-items.ts", "utf8");
  const nativeLink = readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/common/steps/remove-remote-links.ts", "utf8");
  const link = readFileSync("packages/medusa-core-flows/src/common/steps/remove-remote-links.ts", "utf8");
  it("permits only erased callback types and the exact existing eight-row checked projection seam", () => {
    expect(() => verifyInventoryItemDeleteCallbacks(nativeWorkflow, workflow, nativeStep, step, nativeLink, link)).not.toThrow();
  });
  it.each([
    ["raw guard lookup", "id: input,", "id: [],"],
    ["guard execution", "validateInventoryDeleteStep({ inventory_items: inventoryItemsToDelete })", "validateInventoryDeleteStep({ inventory_items: [] })"],
    ["raw lifecycle IDs", "deleteInventoryItemStep(input)", "deleteInventoryItemStep([])"],
    ["raw Link endpoints", "inventory_item_id: input", "inventory_item_id: []"],
    ["raw array response", "return new WorkflowResponse(input)", "return new WorkflowResponse([])"],
    ["projection completeness bound", "Schema.isMaxLength(8)", "Schema.isMaxLength(4)"],
    ["computed finite decoder", "Schema.Number.check(Schema.isFinite())", "Schema.Number"],
    ["projection excess fields", 'onExcessProperty: "error"', 'onExcessProperty: "ignore"'],
    ["guard row order", ").map(row => ({ ...row })))", ").map(row => ({ ...row })).reverse())"],
    ["query field omission", '["id", "reserved_quantity"]', '["id"]'],
  ])("rejects changed native %s", (_name, before, after) => {
    const changed = workflow.replace(before, after); expect(changed).not.toBe(workflow);
    expect(() => verifyInventoryItemDeleteCallbacks(nativeWorkflow, changed, nativeStep, step, nativeLink, link))
      .toThrow("Changed native Inventory Item deletion callback behavior");
  });
  it.each([
    ["reservation predicate", "MathBN.gt(inventoryItem.reserved_quantity, 0)", "MathBN.gt(inventoryItem.reserved_quantity, 1)"],
    ["reservation order", ".map((inventoryItem) => inventoryItem.id)", ".reverse().map((inventoryItem) => inventoryItem.id)"],
    ["native Item empty call", "await inventoryService.softDeleteInventoryItems(ids)", "if (ids.length) await inventoryService.softDeleteInventoryItems(ids)"],
    ["Item map projection", "new StepResponse(void 0, ids)", "new StepResponse(ids, ids)"],
    ["Item inverse payload", "new StepResponse(void 0, ids)", "new StepResponse(void 0, [])"],
    ["Item inverse empty resolution", "if (!prevInventoryItemIds?.length)", "if (!prevInventoryItemIds)"],
    ["Item inverse invocation", "restoreInventoryItems(prevInventoryItemIds)", "restoreInventoryItems([])"],
  ])("rejects changed native %s", (_name, before, after) => {
    const changed = step.replace(before, after); expect(changed).not.toBe(step);
    expect(() => verifyInventoryItemDeleteCallbacks(nativeWorkflow, workflow, nativeStep, changed, nativeLink, link))
      .toThrow("Changed native Inventory Item deletion callback behavior");
  });
  it.each([
    ["grouped empty Link invocation", "await link.delete(grouped)", "if (Object.values(grouped).some(Boolean)) await link.delete(grouped)"],
    ["Link grouping order", "currentKeys.concat(incomingKeys)", "incomingKeys.concat(currentKeys)"],
    ["Link inverse payload", "new StepResponse(grouped, grouped)", "new StepResponse(grouped, {})"],
    ["grouped empty inverse resolution", "if (!removedLinks)", "if (!removedLinks || !Object.keys(removedLinks).length)"],
    ["Link inverse invocation", "await link.restore(removedLinks)", "await link.restore({})"],
  ])("rejects changed native %s", (_name, before, after) => {
    const changed = link.replace(before, after); expect(changed).not.toBe(link);
    expect(() => verifyInventoryItemDeleteCallbacks(nativeWorkflow, workflow, nativeStep, step, nativeLink, changed))
      .toThrow("Changed native Inventory Item deletion callback behavior");
  });
});

describe("native Inventory Level batch callback provenance", () => {
  const nativeWorkflow = readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/inventory/workflows/batch-inventory-item-levels.ts", "utf8");
  const workflow = readFileSync("packages/medusa-core-flows/src/inventory/workflows/batch-inventory-item-levels.ts", "utf8");
  const nativeCreate = readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/inventory/steps/create-inventory-levels.ts", "utf8");
  const create = readFileSync("packages/medusa-core-flows/src/inventory/steps/create-inventory-levels.ts", "utf8");
  const nativeUpdate = readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/inventory/steps/update-inventory-levels.ts", "utf8");
  const update = readFileSync("packages/medusa-core-flows/src/inventory/steps/update-inventory-levels.ts", "utf8");
  it("permits erased type/import seams while preserving all three parallel branches and retained callbacks", () => {
    expect(() => verifyInventoryLevelBatchCallbacks(nativeWorkflow, workflow, nativeCreate, create, nativeUpdate, update)).not.toThrow();
  });
  it.each([
    ["root identity", '"batch-inventory-item-levels-workflow"', '"batch-other-workflow"'],
    ["create omission fallback", "data.create || []", "data.create"],
    ["update omission fallback", "data.update || []", "data.update"],
    ["delete omission fallback", "data.delete || []", "data.delete"],
    ["false force normalization", "data.force ?? false", "data.force ?? true"],
    ["native create input", "createInventoryLevelsStep(createInput)", "createInventoryLevelsStep([])"],
    ["native update input", "updateInventoryLevelsStep(updateInput)", "updateInventoryLevelsStep([])"],
    ["actual deletion child", "input: deleteInput", "input: {}"],
    ["parallel branch grouping", "const res = parallelize(", "const res = ordered("],
    ["created tuple position", "created: data.res[0]", "created: data.res[1]"],
    ["updated tuple position", "updated: data.res[1]", "updated: data.res[0]"],
    ["raw delete omission", "deleted: data.input.delete", "deleted: data.input.delete ?? []"],
  ])("rejects changed native %s", (_name, before, after) => {
    const changed = workflow.replace(before, after); expect(changed).not.toBe(workflow);
    expect(() => verifyInventoryLevelBatchCallbacks(nativeWorkflow, changed, nativeCreate, create, nativeUpdate, update))
      .toThrow("Changed native Inventory Level batch callback behavior");
  });
  it.each([
    ["create empty invocation", "await service.createInventoryLevels(data)", "data.length ? await service.createInventoryLevels(data) : []"],
    ["generated inverse IDs", "inventoryLevels.map((level) => level.id)", "[]"],
    ["create inverse empty resolution", "if (!ids?.length)", "if (!ids)"],
    ["physical inverse method", "await service.deleteInventoryLevels(ids)", "await service.softDeleteInventoryLevels(ids)"],
    ["physical inverse IDs", "await service.deleteInventoryLevels(ids)", "await service.deleteInventoryLevels([])"],
    ["transaction-covered inverse", 'compensation: "transactionCovered"', 'compensation: undefined'],
  ])("rejects changed native %s", (_name, before, after) => {
    const changed = create.replace(before, after); expect(changed).not.toBe(create);
    expect(() => verifyInventoryLevelBatchCallbacks(nativeWorkflow, workflow, nativeCreate, changed, nativeUpdate, update))
      .toThrow("Changed native Inventory Level batch callback behavior");
  });
  it.each([
    ["empty update before resolution", "if (!input.length)", "if (false)"],
    ["preimage pair lookup", "$or: input.map", "$or: [].map"],
    ["native update payload", "await inventoryService.updateInventoryLevels(input)", "await inventoryService.updateInventoryLevels([])"],
    ["preimage capture", "      dataBeforeUpdate,", "      dataBeforeUpdate: [],"],
    ["update inverse omission", "if (!revertInput?.dataBeforeUpdate?.length)", "if (!revertInput)"],
    ["inverse selected field conversion", "convertItemResponseToUpdateRequest(data, selects, relations)", "convertItemResponseToUpdateRequest(data, [], [])"],
  ])("rejects changed native %s", (_name, before, after) => {
    const changed = update.replace(before, after); expect(changed).not.toBe(update);
    expect(() => verifyInventoryLevelBatchCallbacks(nativeWorkflow, workflow, nativeCreate, create, nativeUpdate, changed))
      .toThrow("Changed native Inventory Level batch callback behavior");
  });
});

describe("exact Currency promotion", () => {
  it("authenticates source, transformed inputs, package exports, and available build outputs", () => {
    expect(promotion.packages).toHaveLength(22);
    expect(promotion.packages.some((pkg) => pkg.path === "packages/medusa-store")).toBe(true);
    expect(promotion.packages.some((pkg) => pkg.path === "packages/medusa-orchestration")).toBe(true);
    expect(promotion.packages.some((pkg) => pkg.path === "packages/medusa-inventory")).toBe(true);
    expect(promotion.packages.some((pkg) => pkg.path === "packages/medusa-stock-location")).toBe(true);
    expect(promotion.packages.some((pkg) => pkg.path === "packages/medusa-notification")).toBe(true);
    expect(promotion.packages.some((pkg) => pkg.path === "packages/medusa-notification-local")).toBe(true);
    expect(promotion.packages.some((pkg) => pkg.path === "packages/medusa-fulfillment")).toBe(true);
    expect(promotion.packages.some((pkg) => pkg.path === "packages/medusa-pricing")).toBe(true);
    expect(promotion.files.some((file) => file.target === source && file.classification === "unchanged")).toBe(true);
  });
  it.each([
    ["changed target", { ...promotion, files: promotion.files.map((file) => file.target === source ? { ...file, targetSha256: "0".repeat(64) } : file) }],
    ["changed source", { ...promotion, files: promotion.files.map((file) => file.target === source ? { ...file, sourceSha256: "0".repeat(64) } : file) }],
    ["missing input", { ...promotion, files: promotion.files.filter((file) => file.target !== source) }],
    ["unapproved owner", { ...promotion, packages: promotion.packages.map((pkg) => ({ ...pkg, path: "packages/executor" })) }],
    ["misclassified preserved source", { ...promotion, files: promotion.files.map((file) => file.target === source ? { ...file, classification: "workflowFork" } : file) }],
    ["misclassified Link adaptation", { ...promotion, files: promotion.files.map((file) => file.target === source ? { ...file, classification: "linkFork" } : file) }],
    ["misclassified Product adaptation", { ...promotion, files: promotion.files.map((file) => file.target === source ? { ...file, classification: "productServiceFork" } : file) }],
    ["misclassified Notification adaptation", { ...promotion, files: promotion.files.map((file) => file.target === source ? { ...file, classification: "notificationServiceFork" } : file) }],
    ["misclassified Sales Channel type adaptation", { ...promotion, files: promotion.files.map((file) => file.target === source ? { ...file, classification: "salesChannelTypeFork" } : file) }],
    ["misclassified Stock Location type adaptation", { ...promotion, files: promotion.files.map((file) => file.target === source ? { ...file, classification: "stockLocationTypeFork" } : file) }],
    ["misclassified CSV adaptation", { ...promotion, files: promotion.files.map((file) => file.target === source ? { ...file, classification: "csvNormalizerFork" } : file) }],
    ["misclassified schema compiler adaptation", { ...promotion, files: promotion.files.map((file) => file.target === source ? { ...file, classification: "schemaCompilerFork" } : file) }],
    ["unapproved transform", { ...promotion, files: promotion.files.map((file) => ({ ...file, classification: "anything" })) }],
  ])("rejects %s", (_name, input) => {
    expect(() => verifyCurrencyPromotion(root, input)).toThrow();
  });
  it.skipIf(!promotion.buildFiles.some((file) => existsSync(file.target)))("rejects changed available build outputs", () => {
    expect(() => verifyCurrencyPromotion(root, { ...promotion,
      buildFiles: promotion.buildFiles.map((file) => ({ ...file, targetSha256: "0".repeat(64) })),
    })).toThrow("Changed build target");
  });

  it("admits only a listed importer, dependency edge, and exact export", () => {
    expect(admitsCurrencyImport(promotion, source, "@medusajs/utils/dml/model")).toBe(true);
    expect(admitsCurrencyImport(promotion, source, "@medusajs/utils/private")).toBe(false);
    expect(admitsCurrencyImport(promotion, source, "@medusajs/test-utils/pglite-module-test-persistence-adapter")).toBe(false);
    expect(admitsCurrencyImport(promotion, "packages/medusa-currency/src/unlisted.ts", "@medusajs/utils/dml/model")).toBe(false);
    expect(admitsCurrencyImport(promotion, "packages/executor/src/index.ts", "@medusajs/utils/dml/model")).toBe(false);
  });

  it.each([
    "packages/medusa-types/src/sales-channel/service.ts",
    "packages/medusa-sales-channel/src/services/sales-channel-module.ts",
    "packages/medusa-types/src/stock-location/common.ts",
    "packages/medusa-types/src/stock-location/service.ts",
    "packages/medusa-stock-location/src/services/stock-location-module.ts",
  ])("keeps module type adaptations runtime-identical: %s", target => {
    const file = promotion.files.find(file => file.target === target);
    if (file?.source === undefined) throw new Error("Missing pinned module source");
    const native = readFileSync(file.source, "utf8"), adapted = readFileSync(target, "utf8");
    expect(() => verifyModuleTypeFork(native, adapted)).not.toThrow();
    expect(() => verifyModuleTypeFork(native, adapted + "\nexport const changedRuntime = true;\n"))
      .toThrow("changes runtime behavior");
    if (target.includes("medusa-sales-channel/"))
      expect(() => verifyModuleTypeFork(native, adapted.replace("Array.isArray(data) ? result : result[0]", "result")))
        .toThrow("changes runtime behavior");
    if (target.includes("medusa-stock-location/"))
      expect(() => verifyModuleTypeFork(native, adapted.replace("Array.isArray(data) ? serialized : serialized[0]", "serialized")))
        .toThrow("changes runtime behavior");
  });

  it.each([
    "@medusajs/currency/models",
    "@medusajs/product/models",
    "@medusajs/drizzle/schema",
    "@flarex/medusa-adapter/internal/product-schema",
    "@flarex/medusa-adapter/internal/currency-schema",
    "../../medusa-currency/src/models/currency",
    "../../Medusa-Currency/dist/models/index.js",
    "file:///workspace/packages/medusa-currency/dist/models/currency.js",
    "file:///workspace/PACKAGES/Medusa-Currency/dist/models/currency.js",
    "C:/workspace/PACKAGES/Medusa-Currency/dist/models/currency.js",
  ])("keeps kernel imports forbidden: %s", (specifier) => {
    const result = analyzeMedusaSourceIslandBoundary({
      currencyPromotion: promotion,
      rootManifests: [], islandManifests: [], islandSources: [],
      rootWorkspaceText: "packages:\n  - packages/*\n  - apps/*\n", rootScripts: {},
      rootSources: [{ relativePath: "packages/executor/src/index.ts", text: `import value from ${JSON.stringify(specifier)};` }],
    });
    expect(result.errors).toHaveLength(1);
  });

  it("retains the executable original compatibility scenarios and assertions", () => {
    const tests = promotion.files.filter((file) => file.classification === "testPort");
    expect(tests).toHaveLength(18);
    for (const file of tests) {
      const original = file.source;
      if (!original) throw new Error("Missing original test source");
      expect(() => verifyTestPort(readFileSync(original, "utf8"), readFileSync(file.target, "utf8"), {
        currencyTimeout: file.target.endsWith("currency-module-service.spec.ts"),
        salesChannelTimeout: file.target.endsWith("sales-channel-module.spec.ts"),
        currencyStaticImports: file.target === "packages/medusa-currency/src/__tests__/static-manifest.spec.ts",
      })).not.toThrow();
    }
  });
  it("admits only the verified Product wrappers across the test package boundary", () => {
    const wrapper = "packages/medusa-adapter/test/product-upstream.test.ts";
    const specifier = "../../medusa-product/integration-tests/__tests__/product-module-service/events.spec";
    /** @param {string} file @param {string} imported @param {import("./check-medusa-currency-promotion.mjs").Promotion} manifest */
    const check = (file, imported, manifest = promotion) => analyzeMedusaSourceIslandBoundary({
      currencyPromotion: manifest, rootManifests: [], islandManifests: [], islandSources: [],
      rootWorkspaceText: "packages:\n  - packages/*\n  - apps/*\n", rootScripts: {},
      rootSources: [{ relativePath: file, text: `import ${JSON.stringify(imported)};` }],
    }).errors;
    expect(check(wrapper, specifier)).toEqual([]);
    const internal = "../../medusa-product/integration-tests/__tests__/product-category.spec";
    expect(check(wrapper, internal)).toHaveLength(1);
    expect(check("packages/medusa-adapter/test/product-internal-categories-upstream.test.ts", internal)).toEqual([]);
    expect(check("packages/medusa-adapter/test/product-internal-categories-upstream.test.ts", specifier)).toHaveLength(1);
    expect(check("packages/medusa-adapter/test/product-categories-upstream.test.ts", internal)).toHaveLength(1);
    expect(check(wrapper, specifier.replace("events.spec", "products.spec"))).toEqual([]);
    expect(check(wrapper, specifier.replace("events.spec", "product-types.spec"))).toHaveLength(1);
    expect(check("packages/medusa-adapter/test/product-types-upstream.test.ts", specifier.replace("events.spec", "product-types.spec"))).toEqual([]);
    expect(check(wrapper, specifier.replace("events.spec", "product-tags.spec"))).toEqual([]);
    expect(check(wrapper, specifier.replace("events.spec", "product-collections.spec"))).toEqual([]);
    expect(check("packages/medusa-adapter/test/product-internal-upstream.test.ts",
      "../../medusa-product/integration-tests/__tests__/product.spec")).toHaveLength(1);
    expect(check(wrapper, specifier.replace("events.spec", "product-options.spec"))).toEqual([]);
    expect(check(wrapper, specifier.replace("events.spec", "product-variants.spec"))).toEqual([]);
    expect(check(wrapper, specifier.replace("events.spec", "product-categories.spec"))).toHaveLength(1);
    expect(check("packages/medusa-adapter/test/product-public-categories-upstream.test.ts", specifier.replace("events.spec", "product-categories.spec"))).toEqual([]);
    expect(check("packages/medusa-adapter/test/product-categories-upstream.test.ts", specifier.replace("events.spec", "product-categories.spec"))).toHaveLength(1);
    expect(check("packages/medusa-adapter/test/product-categories-upstream.test.ts", specifier)).toHaveLength(1);
    expect(check("packages/medusa-adapter/test/product-variants-upstream.test.ts", specifier.replace("events.spec", "product-variants.spec"))).toHaveLength(1);
    expect(check("packages/medusa-adapter/test/product-variants-upstream.test.ts", specifier)).toHaveLength(1);
    expect(check("packages/medusa-adapter/test/product-options-upstream.test.ts", specifier.replace("events.spec", "product-options.spec"))).toHaveLength(1);
    expect(check("packages/medusa-adapter/test/product-collections-upstream.test.ts", specifier.replace("events.spec", "product-collections.spec"))).toHaveLength(1);
    expect(check("packages/medusa-adapter/test/product-collections-upstream.test.ts", specifier)).toHaveLength(1);
    expect(check("packages/medusa-adapter/test/product-tags-upstream.test.ts", specifier.replace("events.spec", "product-tags.spec"))).toHaveLength(1);
    expect(check("packages/medusa-adapter/test/product-types-upstream.test.ts", specifier.replace("events.spec", "product-types.spec"))).toEqual([]);
    for (const [file, imported] of [["packages/medusa-adapter/test/product-types-upstream.test.ts", specifier], ["packages/medusa-adapter/test/product-query.test.ts", specifier], ["packages/medusa-adapter/src/modules/product/service.ts", specifier.replace("../../medusa-product/", "../../../../medusa-product/")],
      [wrapper, specifier.replace("events.spec", "variants.spec")], [wrapper, specifier + ".ts"]]) {
      expect(check(file, imported)).toHaveLength(1);
    }
    expect(check(wrapper, specifier, { ...promotion, files: promotion.files.filter(file => file.target !== wrapper) })).toHaveLength(1);
    expect(check(wrapper, specifier, { ...promotion, files: promotion.files.filter(file => file.target !== "packages/medusa-product/integration-tests/__tests__/product-module-service/events.spec.ts") })).toHaveLength(1);
    expect(check(wrapper, specifier, { ...promotion, testAliases: [] })).toHaveLength(1);
  });
});
