// @ts-check
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { verifyNativePriceListPriceNormalization, verifyPriceListPriceCreationCallbacks, verifyPriceListPriceCreationSelection } from "./check-medusa-price-list-prices-source.mjs";
import { verifyCurrencyPromotion } from "./check-medusa-currency-promotion.mjs";

const read = (/** @type {string} */ file) => readFileSync(file, "utf8");
const nativeDal = read("third_party/medusa/upstream/packages/core/utils/src/dal/mikro-orm/mikro-orm-repository.ts");
const dalPath = "packages/medusa-utils/src/dal/mikro-orm/mikro-orm-repository.ts", dal = read(dalPath);
const planningPath = "packages/medusa-utils/src/dal/upsert-planning.ts", planning = read(planningPath);
const createPlanningPath = "packages/medusa-utils/src/dal/create-planning.ts", createPlanning = read(createPlanningPath);
const paths = ["price-list/workflows/create-price-list-prices.ts", "price-list/steps/create-price-list-prices.ts"];
const native = paths.map(file => read("third_party/medusa/upstream/packages/core/core-flows/src/" + file));
const promoted = paths.map(file => read("packages/medusa-core-flows/src/" + file));
const facade = read("packages/medusa-adapter/src/workflows/pricing/create-price-list-prices.ts");
const policy = read("packages/medusa-adapter/src/workflow/policy.ts");

describe("approved native PriceList Price normalization source", () => {
  it("admits only the approved upsert and positional create seams against the unchanged island", () => {
    expect(() => verifyNativePriceListPriceNormalization(nativeDal, dal, planning, createPlanning)).not.toThrow();
    expect(() => verifyNativePriceListPriceNormalization(nativeDal, nativeDal, planning, createPlanning)).toThrow();
  });
  it.each([
    ["live relation iteration", "Array.from(dataForRelation).map", "dataForRelation.map"],
    ["sorted normalization", "Array.from(dataForRelation).map", "Array.from(dataForRelation).sort().map"],
    ["persisted alias removal", "propDef.persist === false", "propDef.persist !== false"],
    ["relation owner", "propDef.kind === ReferenceKind.MANY_TO_ONE", "propDef.kind !== ReferenceKind.MANY_TO_ONE"],
    ["complete scalar proof", "propDef.joinColumns.every(", "propDef.joinColumns.some("],
    ["explicit null scalar", "dataToCreate[column] !== undefined", "dataToCreate[column] != null"],
    ["input mutation", "delete dataToCreate[key]", "delete data[key]"],
    ["original response", "...data,\n        ...(created", "...dataToCreate,\n        ...(created"],
    ["retained existing ID", "id: data.id ?? (created as any).id", "id: (created as any).id"],
  ])("rejects changed %s", (_label, before, after) => {
    const changed = dal.replace(before, after); expect(changed).not.toBe(dal);
    expect(() => verifyNativePriceListPriceNormalization(nativeDal, changed, planning, createPlanning)).toThrow("Changed approved native PriceList Price normalization");
  });
  it("refuses additional behavior outside the approved owner seams", () => {
    expect(() => verifyNativePriceListPriceNormalization(nativeDal, dal + "\nthrow new Error('extra');\n", planning, createPlanning)).toThrow();
  });
  it.each([
    ["last original source", "originalDataMap.set(mainEntity.id, entry)", "if (!originalDataMap.has(mainEntity.id)) originalDataMap.set(mainEntity.id, entry)"],
    ["first scalar write", "if (!uniqueEntriesMap.has(entry.id))", "if (true)"],
    ["unique response index", "reconstructedResponse[i]", "reconstructedResponse[0]"],
    ["last relation source", "originalDataMap.get(entityEntry.id)!", "originalDataMap.get(orderedEntities[0]!.id)!"],
    ["empty relation semantics", "item.entity[relationName] !== undefined", "Boolean(item.entity[relationName])"],
    ["skipped updates", "if (!skipUpdate)", "if (true)"],
  ])("refuses changed extracted planner %s", (_label, before, after) => {
    const changed = planning.replace(before, after); expect(changed).not.toBe(planning);
    expect(() => verifyNativePriceListPriceNormalization(nativeDal, dal, changed, createPlanning)).toThrow("Changed approved native PriceList Price normalization");
  });
  it("requires the genuine native repository to delegate to the planner", () => {
    const changed = dal.replace("uniqueUpsertEntries(entries)", "entries"); expect(changed).not.toBe(dal);
    expect(() => verifyNativePriceListPriceNormalization(nativeDal, changed, planning, createPlanning)).toThrow();
  });
  it.each([
    ["every raw create", "planCreateBatch(data, (data_)", "planCreateBatch(data.slice(0, 1), (data_)"],
    ["native normalizer", "manager.create(this.entity, data_)", "manager.create(this.entity, { ...data_ })"],
    ["full positional persistence", "manager.persist(entities)", "manager.persist([...new Set(entities)])"],
    ["final positional return", "return entities as InferRepositoryReturnType<T>[]", "return entities.slice(0, 1) as InferRepositoryReturnType<T>[]"],
  ])("refuses changed native create %s", (_label, before, after) => {
    const changed = dal.replace(before, after); expect(changed).not.toBe(dal);
    expect(() => verifyNativePriceListPriceNormalization(nativeDal, changed, planning, createPlanning)).toThrow();
  });
  it.each([
    ["raw normalizer order", "sources.map((source, index)", "sources.slice().reverse().map((source, index)"],
    ["reference identity", "indexes.get(entity)", "indexes.get({ ...entity })"],
    ["positional indexes", "positions.push(position)", "positions.push(0)"],
    ["canonical hydration", "canonical[name] == null", "canonical[name] === undefined"],
    ["falsy values", "value != null", "Boolean(value)"],
    ["first JSON value", "Object.assign(canonical, Object.fromEntries", "Object.assign(source, Object.fromEntries"],
  ])("refuses changed scalar create helper %s", (_label, before, after) => {
    const changed = createPlanning.replace(before, after); expect(changed).not.toBe(createPlanning);
    expect(() => verifyNativePriceListPriceNormalization(nativeDal, dal, planning, changed)).toThrow();
  });
});

describe("native PriceList Price workflow callback source", () => {
  const verify = (/** @type {string[]} */ values) => verifyPriceListPriceCreationCallbacks(native[0], values[0], native[1], values[1]);
  it("retains both parallel validators and the original physical inverse", () => expect(() => verify(promoted)).not.toThrow());
  it.each([
    [0, "List validation", "validatePriceListsStep(input.data)", "validatePriceListsStep([])"],
    [0, "raw Variant selection", "validateVariantPriceLinksStep(input.data)", "validateVariantPriceLinksStep([])"],
    [1, "native entry grouping", "if (pricesToAdd.length)", "if (true)"],
    [1, "required Pricing resolve", "Modules.PRICING", '"product"'],
    [1, "native PriceSet map", "variantPriceSetMap![price.variant_id!]", '"other_price_set"'],
    [1, "actual empty map type", "variant_price_map: Record<string, string> | undefined", "variant_price_map: Record<string, string>"],
    [1, "missing map runtime refusal", "variantPriceSetMap![price.variant_id!]", "variantPriceSetMap?.[price.variant_id!]"],
    [1, "fabricated empty map", "variant_price_map: variantPriceSetMap }", "variant_price_map: variantPriceSetMap = {} }"],
    [1, "native retained IDs", "createdPrices.map((p) => p.id)", "[...new Set(createdPrices.map((p) => p.id))]"],
    [1, "physical inverse", "pricingModule.removePrices(createdIds)", "pricingModule.softDeletePrices(createdIds)"],
    [1, "empty inverse guard", "if (!createdIds?.length)", "if (false)"],
  ])("rejects changed %s %s", (index, _label, before, after) => {
    const changed = promoted.slice(), selected = Number(index); changed[selected] = changed[selected].replace(String(before), String(after));
    expect(changed[selected]).not.toBe(promoted[selected]); expect(() => verify(changed)).toThrow("Changed native PriceList Price callback behavior");
  });
});

describe("PriceList Price workflow authority selection", () => {
  it("admits only the named128 resources, exact profile and narrow Pricing/Link views", () => expect(() => verifyPriceListPriceCreationSelection(facade, policy)).not.toThrow());
  it.each([
    ["profile", '"pricing-price-list-price-creations"', '"pricing-price-list-creations"'],
    ["outer annotation", "export const prepareCreatePriceListPricesWorkflow =", "export const prepareCreatePriceListPricesWorkflow: any ="],
    ["outer declaration modifier", "export const prepareCreatePriceListPricesWorkflow =", "export declare const prepareCreatePriceListPricesWorkflow ="],
    ["Pricing graph", '"removePrices"], graph: false', '"removePrices"], graph: true'],
    ["extra method", '"removePrices"], graph: false', '"removePrices", "deletePriceLists"], graph: false'],
    ["Link exposure", "graph: true, expose: false", "graph: true, expose: true"],
    ["resource guard", "!jsonEqual(binding.logicalResources, priceListPriceCreationResources)", "jsonEqual(binding.logicalResources, priceListPriceCreationResources)"],
    ["mixed owner", 'logicalPublication: "mixed" as const', 'logicalPublication: undefined'],
    ["named participant limits", "logicalResources: priceListPriceCreationResources", "logicalResources: defaultCommerceResources"],
    ["Link participant limits", "link: { ...installed.link, logicalResources: priceListPriceCreationResources }", "link: { ...installed.link, logicalResources: defaultCommerceResources }"],
    ["cross-wired deletion limits", "logicalResources: priceListPriceCreationResources", "logicalResources: priceListDeletionResources"],
    ["root allowance", "requestCallLimit: priceListPriceCreationResources.calls,", ""],
    ["caller allowance", "requestCallLimit: priceListPriceCreationResources.calls", "requestCallLimit: options.requestCallLimit"],
    ["caller allowance admission", '["execution", "modules", "revision", "subscribers"].includes(key)', '["execution", "modules", "revision", "subscribers", "requestCallLimit"].includes(key)'],
    ["required internal queue", 'modules, operationScheduling: "queued",', "modules,"],
    ["caller queue override", 'modules, operationScheduling: "queued",', 'modules, operationScheduling: options.operationScheduling,'],
    ["required internal borrowed queue", 'borrowedOperationScheduling: "queued",', ""],
    ["caller borrowed queue override", 'borrowedOperationScheduling: "queued",', 'borrowedOperationScheduling: options.borrowedOperationScheduling,'],
    ["caller borrowed queue admission", '["execution", "modules", "revision", "subscribers"].includes(key)', '["execution", "modules", "revision", "subscribers", "borrowedOperationScheduling"].includes(key)'],
    ["caller queue admission", '["execution", "modules", "revision", "subscribers"].includes(key)', '["execution", "modules", "revision", "subscribers", "operationScheduling"].includes(key)'],
    ["input decoder", "input: PriceListPriceCreationWorkflowInput", "input: OtherInput"],
    ["resource import", 'from "@flarex/persistence-postgres/internal/commerce-values"', 'from "./other-resources"'],
  ])("rejects changed %s", (_label, before, after) => {
    const changed = facade.replace(before, after); expect(changed).not.toBe(facade);
    expect(() => verifyPriceListPriceCreationSelection(changed, policy)).toThrow("Changed PriceList Price creation resource selection");
  });
  it("refuses extra authority code beside the declaration", () => expect(() => verifyPriceListPriceCreationSelection(facade + "\nthrow new Error('extra');\n", policy)).toThrow());
  it("accepts equivalent typed AST layout while retaining the complete typed facade and allowance", () => {
    expect(() => verifyPriceListPriceCreationSelection(facade.replace("readonly revision: string;", "readonly revision : string ;"),
      policy.replace("priceListPriceCreationResources = Object.freeze({ ...defaultCommerceResources, calls: 128 });",
        "priceListPriceCreationResources = Object.freeze({ ...defaultCommerceResources, calls : 128\n});"))).not.toThrow();
    expect(() => verifyPriceListPriceCreationSelection(facade.replace("readonly revision: string;", "readonly revision: number;"), policy)).toThrow();
    expect(() => verifyPriceListPriceCreationSelection(facade.replace("import type { AtomicCommerceEvents }", "import { AtomicCommerceEvents }"), policy)).toThrow();
    expect(() => verifyPriceListPriceCreationSelection(facade.replace("module: modules.link.module, methods: [], graph: true, expose: false",
      "module: modules.link.module,\nmethods: [],\ngraph: true,\nexpose: false"), policy)).not.toThrow();
  });
  it.each([
    ["root default64", "calls: 128", "calls: 64"],
    ["root129", "calls: 128", "calls: 129"],
    ["event enlargement", "calls: 128", "calls: 128, eventMessages: 128"],
    ["row enlargement", "calls: 128", "calls: 128, queryRows: 1024"],
    ["byte enlargement", "calls: 128", "calls: 128, commandBytes: 2097152"],
    ["unfrozen selection", "Object.freeze({ ...defaultCommerceResources, calls: 128 })", "({ ...defaultCommerceResources, calls: 128 })"],
    ["missing defaults", "...defaultCommerceResources, calls: 128", "calls: 128"],
    ["default overwrite", "...defaultCommerceResources, calls: 128", "calls: 128, ...defaultCommerceResources"],
    ["wrong default owner", '@flarex/persistence-postgres/internal/commerce-values', './other-defaults'],
    ["mutable declaration", "export const priceListPriceCreationResources", "export let priceListPriceCreationResources"],
    ["outer annotation", "priceListPriceCreationResources =", "priceListPriceCreationResources: any ="],
    ["outer declaration modifier", "export const priceListPriceCreationResources", "export declare const priceListPriceCreationResources"],
  ])("refuses policy %s", (_label, before, after) => {
    // Select only155's named declaration, leaving other named workloads intact.
    const anchor = "export const priceListPriceCreationResources = Object.freeze({ ...defaultCommerceResources, calls: 128 });";
    const changed = before === '@flarex/persistence-postgres/internal/commerce-values'
      ? policy.replace(before, after) : policy.replace(anchor, anchor.replace(before, after));
    expect(changed).not.toBe(policy);
    expect(() => verifyPriceListPriceCreationSelection(facade, changed)).toThrow("Changed PriceList Price creation resource selection");
  });
  it("refuses duplicate named allowance declarations", () => expect(() => verifyPriceListPriceCreationSelection(facade,
    policy + "\nexport const priceListPriceCreationResources = Object.freeze({ ...defaultCommerceResources, calls: 128 });\n")).toThrow());
});

describe("PriceList Price promotion provenance", () => {
  const promotion = JSON.parse(read("roadmaps/flarexdb-framework-integration/preflight/medusa-currency-promotion.json"));
  // Complete native AST and emitted-source verification precedes the manifest
  // pair check. Keep that integration proof under a local expensive-case cap.
  it.each([dalPath, planningPath, ...paths.map(file => "packages/medusa-core-flows/src/" + file)])("refuses removed source ownership for %s", target => {
    expect(promotion.files.some((/** @type {{target:string}} */ entry) => entry.target === target)).toBe(true);
    const changed = { ...promotion, files: promotion.files.map((/** @type {{target:string}} */ entry) => entry.target === target ? { ...entry, classification: "authored", source: undefined } : entry) };
    expect(() => verifyCurrencyPromotion(process.cwd(), changed)).toThrow([dalPath, planningPath].includes(target) ? "Native Pricing normalization outside its exact promoted repository pair" : "PriceList Price creation outside its exact pinned source pair");
  }, 15_000);
});
