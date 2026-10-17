// @ts-check
import { describe, expect, it } from "vitest";
import { verifyTestPort, verifyShippingProfileCreateTests, verifyPricingCreateTests, verifyPricingWorkflowSelection, verifyInventoryCreateTests, verifyInventoryUpdateTests, verifyInventoryLevelUpdateTests, verifyCsvNormalizerTests } from "./check-medusa-test-port.mjs";
import { readFileSync } from "node:fs";

const source = `import { runner } from "./runner";
describe("suite", () => {
  beforeEach(async () => { await runner.create({ title: "fixture" }); });
  it("case", async () => { const rows = await runner.list(); expect(rows[0].id).toEqual("id"); });
});`;

describe("maintained Medusa test ports", () => {
  it("preserves the complete native CSV suite, snapshots and exact fixtures", () => {
    const nativeRoot = "../third_party/medusa/upstream/packages/core/utils/src/product/__tests__/";
    const targetRoot = "../packages/medusa-utils/src/product/__tests__/";
    const original = readFileSync(new URL(nativeRoot + "csv-normalizer.spec.ts", import.meta.url), "utf8");
    const selected = readFileSync(new URL(targetRoot + "csv-normalizer.spec.ts", import.meta.url), "utf8");
    const names = ["multiple-products-multiple-variants.json", "same-product-multiple-rows.json",
      "same-product-multiple-variant-options.json", "single-row-create.json"];
    const sourceFixtures = Object.fromEntries(names.map(name => [name,
      readFileSync(new URL(nativeRoot + "__fixtures__/" + name, import.meta.url), "utf8")]));
    const targetFixtures = Object.fromEntries(names.map(name => [name,
      readFileSync(new URL(targetRoot + "__fixtures__/" + name, import.meta.url), "utf8")]));
    expect(() => verifyCsvNormalizerTests(original, selected, sourceFixtures, targetFixtures)).not.toThrow();
    const mutations = [
      selected.replace("should process a CSV row", "renamed native case"),
      selected.replace('it("should process a CSV row"', 'it.skip("should process a CSV row"'),
      selected.replace('"title": "Medusa Sweatshirt"', '"title": "Changed snapshot"'),
      selected.replace('readFile(join(__dirname, "__fixtures__", fileName)', 'readFile(join(__dirname, "other", fileName)'),
      selected.replace('from "../csv-normalizer"', 'from "../fake-normalizer"'),
      selected.replace('describe, expect, it', 'describe, expect, it, vi'),
      selected.replace('describe, expect, it', 'describe, expect as check, it'),
      selected.replace('const csvData: any[]', 'const csvData: unknown[]'),
      selected + '\nit("extra", () => {});',
    ];
    for (const changed of mutations) {
      expect(changed).not.toBe(selected);
      expect(() => verifyCsvNormalizerTests(original, changed, sourceFixtures, targetFixtures)).toThrow();
    }
    for (const name of names) {
      expect(() => verifyCsvNormalizerTests(original, selected, sourceFixtures,
        { ...targetFixtures, [name]: targetFixtures[name] + " " })).toThrow("Changed native CSV fixtures");
    }
    const missing = { ...targetFixtures }; delete missing[names[0]];
    expect(() => verifyCsvNormalizerTests(original, selected, sourceFixtures, missing)).toThrow("Changed native CSV fixtures");
    expect(() => verifyCsvNormalizerTests(original, selected, sourceFixtures,
      { ...targetFixtures, "extra.json": "{}" })).toThrow("Changed native CSV fixtures");
  });
  it("preserves both selected native Inventory item creation bodies", () => {
    const original = readFileSync(new URL("../third_party/medusa/upstream/packages/modules/inventory/integration-tests/__tests__/inventory-module-service.spec.ts", import.meta.url), "utf8");
    const selected = readFileSync(new URL("../packages/medusa-adapter/test/support/inventory-native-tests.ts", import.meta.url), "utf8");
    expect(() => verifyInventoryCreateTests(original, selected)).not.toThrow();
    for (const changed of [selected.replace('...data[1]', '...data[0]'), selected.replace('await service.createInventoryItems(data)', 'service.createInventoryItems(data)'),
      selected.replace('it("should create an inventory item"', 'it.skip("should create an inventory item"'),
      selected + 'it("unselected", () => {});']) expect(() => verifyInventoryCreateTests(original, changed)).toThrow();
  });
  it("preserves both native Inventory item update bodies and their seed", () => {
    const original = readFileSync(new URL("../third_party/medusa/upstream/packages/modules/inventory/integration-tests/__tests__/inventory-module-service.spec.ts", import.meta.url), "utf8");
    const selected = readFileSync(new URL("../packages/medusa-adapter/test/support/inventory-update-native-tests.ts", import.meta.url), "utf8");
    expect(() => verifyInventoryUpdateTests(original, selected)).not.toThrow();
    for (const changed of [selected.replace('origin_country: "test-country"', 'origin_country: "changed"'),
      selected.replace('await service.updateInventoryItems(update)', 'service.updateInventoryItems(update)'),
      selected.replace('it("should update the inventory item"', 'it.skip("should update the inventory item"'),
      selected + 'it("unselected", () => {});']) expect(() => verifyInventoryUpdateTests(original, changed)).toThrow();
  });
  it("preserves both native absolute Inventory Level update bodies and their seed", () => {
    const original = readFileSync(new URL("../third_party/medusa/upstream/packages/modules/inventory/integration-tests/__tests__/inventory-module-service.spec.ts", import.meta.url), "utf8");
    const selected = readFileSync(new URL("../packages/medusa-adapter/test/support/inventory-level-update-native-tests.ts", import.meta.url), "utf8");
    expect(() => verifyInventoryLevelUpdateTests(original, selected)).not.toThrow();
    for (const changed of [selected.replace('stocked_quantity: 2', 'stocked_quantity: 3'),
      selected.replace('incoming_quantity: 4', 'incoming_quantity: 5'),
      selected.replace('it("should update inventory level"', 'it.skip("should update inventory level"'),
      selected + 'it("unselected", () => {});']) expect(() => verifyInventoryLevelUpdateTests(original, changed)).toThrow();
  });
  it("preserves the finite native Pricing workflow selection", () => {
    const original = readFileSync(new URL("../third_party/medusa/upstream/packages/core/types/src/pricing/service.ts", import.meta.url), "utf8");
    const selected = readFileSync(new URL("../packages/medusa-adapter/src/modules/pricing/service.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const repository = readFileSync(new URL("../packages/medusa-adapter/src/modules/pricing/repository.ts", import.meta.url), "utf8");
    expect(() => verifyPricingWorkflowSelection(original, selected, repository)).not.toThrow();
    const methods = 'methods: { ...(preferences ? { listPricePreferences, upsertPricePreferences, deletePricePreferences } : {}),\n        ...(!preferences ? { createPriceSets, createPriceLists, createPricePreferences, ...(mutable ? { upsertPriceSets, updatePriceSets, listPriceSets } : {}), ...(lifecycle ? { softDeletePriceSets } : {}) } : {}) }';
    expect(selected).toContain(methods);
    expect(() => verifyPricingWorkflowSelection(original, selected.replace(methods, 'methods: {}'), repository)).toThrow();
    expect(() => verifyPricingWorkflowSelection(original, selected.replace(methods, 'methods: { createPriceSets, createPriceLists, createPricePreferences, calculatePrices }'), repository)).toThrow();
    expect(() => verifyPricingWorkflowSelection(original, selected.replace(methods, 'methods: { createPriceLists, createPricePreferences }'), repository)).toThrow();
    expect(() => verifyPricingWorkflowSelection(original, selected.replace(methods, 'methods: { createPriceSets, createPricePreferences }'), repository)).toThrow();
    expect(() => verifyPricingWorkflowSelection(original, selected.replace(methods, 'methods: { createPriceSets, createPriceLists }'), repository)).toThrow();
    for (const override of ['...{ methods: { calculatePrices } }', '["methods"]: { calculatePrices }',
      'get methods() { return { calculatePrices }; }', 'methods']) {
      expect(() => verifyPricingWorkflowSelection(original, selected.replace(methods,
        `${methods}, ${override}`), repository)).toThrow();
    }
    for (const changed of [
      selected.replace('const mutable = admission === "variant-updates" || admission === "product-updates"', 'const mutable = true'),
      selected.replace('lifecycle = admission === "product-updates"', 'lifecycle = true'),
      selected.replace('...(lifecycle ? { softDeletePriceSets } : {})', '...(mutable ? { softDeletePriceSets } : {})'),
      selected.replace('...(lifecycle ? { softDeletePriceSets } : {})', '...(lifecycle ? { softDeletePriceSets, calculatePrices } : {})'),
      selected.replace('...(lifecycle ? { softDeletePriceSets } : {})', '...(lifecycle ? { softDeletePriceSets } : { softDeletePriceSets })'),
      selected.replace('= "create")', '= "variant-updates")'),
      selected.replace('...(mutable ? { upsertPriceSets', '...(true ? { upsertPriceSets'),
      selected.replace('upsertPriceSets, updatePriceSets, listPriceSets } : {}', 'upsertPriceSets, updatePriceSets, listPriceSets, calculatePrices } : {}'),
      selected.replace('upsertPriceSets, updatePriceSets, listPriceSets } : {}', 'get upsertPriceSets() { return calculatePrices; }, updatePriceSets, listPriceSets } : {}'),
      selected.replace('upsertPriceSets, updatePriceSets, listPriceSets } : {}', 'upsertPriceSets, updatePriceSets, ["listPriceSets"]: listPriceSets } : {}'),
      selected.replace('upsertPriceSets, updatePriceSets, listPriceSets } : {}', 'upsertPriceSets, updatePriceSets, listPriceSets } : { calculatePrices }'),
    ]) {
      expect(changed).not.toBe(selected);
      expect(() => verifyPricingWorkflowSelection(original, changed, repository)).toThrow();
    }
  });
  it("preserves all selected Pricing statements and the actual rule-bearing seed", () => {
    const original = readFileSync(new URL("../third_party/medusa/upstream/packages/modules/pricing/integration-tests/__tests__/services/pricing-module/price-set.spec.ts", import.meta.url), "utf8");
    const selected = readFileSync(new URL("../packages/medusa-adapter/test/support/pricing-native-tests.ts", import.meta.url), "utf8");
    expect(() => verifyPricingCreateTests(original, selected)).not.toThrow();
    for (const changed of [selected.replace('amount: 500', 'amount: 1'), selected.replace('currency_code: "CAD"', 'currency_code: "USD"'),
      selected.replace('await service.createPriceSets(priceSets)', 'service.createPriceSets(priceSets)'),
      selected.replace('it("should create a priceSet successfully"', 'it.skip("should create a priceSet successfully"'),
      selected.replace('amount: 200', 'amount: 201'), selected + 'it("additional", () => {});']) {
      expect(() => verifyPricingCreateTests(original, changed)).toThrow();
    }
  });
  it("preserves exactly the two selected ShippingProfile bodies without admitting deferred tests", () => {
    const create = 'it("should create a new shipping profile", async () => { expect(await service.create(data)).toEqual(data); });';
    const many = 'it("should create multiple new shipping profiles", async () => { expect(await service.create([data])).toHaveLength(1); });';
    const selected = create + many;
    const original = selected + 'it("duplicate", () => {}); it("delete", () => {}); it("associated delete", () => {});';
    expect(() => verifyShippingProfileCreateTests(original, selected)).not.toThrow();
    expect(() => verifyShippingProfileCreateTests(original, selected.replace("toHaveLength(1)", "toHaveLength(0)"))).toThrow();
    expect(() => verifyShippingProfileCreateTests(original, create)).toThrow();
    expect(() => verifyShippingProfileCreateTests(original, selected + 'it("duplicate", () => {});')).toThrow();
    expect(() => verifyShippingProfileCreateTests(original, selected.replace('it("should create a new', 'it.skip("should create a new'))).toThrow();
  });
  it("permits only erased types and explicit Vitest globals around the same program", () => {
    const target = 'import { beforeEach, describe, expect, it } from "vitest";\n' + source
      .replace("const rows =", "const rows: { id: string }[] =").replace("rows[0].id", "rows[0]!.id");
    expect(() => verifyTestPort(source, target)).not.toThrow();
  });
  it.each([
    ["assertion", source.replace('toEqual("id")', 'toEqual("other")')],
    ["fixture", source.replace('title: "fixture"', 'title: "different"')],
    ["title", source.replace('it("case"', 'it("renamed"')],
    ["skip", source.replace('it("case"', 'it.skip("case"')],
    ["await", source.replace("await runner.create", "runner.create")],
    ["runtime import", source.replace('"./runner"', '"./fake-runner"')],
    ["missing assertion", source.replace('expect(rows[0].id).toEqual("id");', '')],
    ["extra case", source + 'it("extra", () => expect(true).toBe(true));'],
  ])("rejects a changed %s", (_label, target) => {
    expect(() => verifyTestPort(source, target)).toThrow("changed executable");
  });
  it("preserves the original unused fixture result without hiding evaluation", () => {
    const before = "async function setup() { const result = await create(); }";
    expect(() => verifyTestPort(before, before.replace("await create();", "await create(); void result;"))).not.toThrow();
    expect(() => verifyTestPort(before, before.replace("const result", "void result; const result"))).toThrow();
    expect(() => verifyTestPort(before, before.replace("await create();", "await create(); void destroy();"))).toThrow();
  });
  it.each([
    ["prefix sign", "expect(-1).toBe(-1);", "expect(+1).toBe(-1);"],
    ["prefix operator", "expect(!result).toBe(true);", "expect(~result).toBe(true);"],
    ["postfix increment", "for (let i = 0; i < 2; i++) create(i);", "for (let i = 0; i < 2; i--) create(i);"],
    ["template raw text", "expect(String.raw`\\n`).toBe(value);", "expect(String.raw`\n`).toBe(value);"],
    ["template span raw text", "expect(String.raw`x${value}\\n`).toBe(value);", "expect(String.raw`x${value}\n`).toBe(value);"],
  ])("rejects changed executable %s", (_label, before, after) => {
    expect(() => verifyTestPort(before, after)).toThrow("changed executable");
  });
  it("requires the exact explicitly selected Currency timeout", () => {
    expect(() => verifyTestPort("jest.setTimeout(100000);", "", { currencyTimeout: true })).not.toThrow();
    expect(() => verifyTestPort("jest.setTimeout(100000);", "")).toThrow();
    expect(() => verifyTestPort("jest.setTimeout(200000);", "", { currencyTimeout: true })).toThrow();
  });
  it("allows only the exact Currency static import relocations", () => {
    const before = 'import value from "../index"; expect(value).toBeDefined();';
    const after = before.replace('"../index"', '"@medusajs/currency/index"');
    expect(() => verifyTestPort(before, after, { currencyStaticImports: true })).not.toThrow();
    expect(() => verifyTestPort(before, after)).toThrow();
  });
  it("requires the exact explicitly selected Sales Channel timeout", () => {
    expect(() => verifyTestPort("jest.setTimeout(30000);", "", { salesChannelTimeout: true })).not.toThrow();
    expect(() => verifyTestPort("jest.setTimeout(30000);", "")).toThrow();
    expect(() => verifyTestPort("jest.setTimeout(100000);", "", { salesChannelTimeout: true })).toThrow();
  });
  it("refuses renamed Vitest bindings and syntax errors", () => {
    expect(() => verifyTestPort(source, 'import { expect as check } from "vitest";' + source)).toThrow("Unadmitted Vitest");
    expect(() => verifyTestPort(source, "const = ;")).toThrow("Invalid test-port syntax");
  });
});
