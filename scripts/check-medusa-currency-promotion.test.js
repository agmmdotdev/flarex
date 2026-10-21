// @ts-check
import { verifyPriceListDeleteSelection, verifyPriceListDeleteCallbacks, verifyPriceListUpdateCallbacks, verifyNativePriceListRuleBuilder, verifyPriceListCreateCallbacks, verifyPricePreferenceDeleteCallbacks, verifyPricePreferenceUpdateCallbacks, verifyPricePreferenceCreateCallbacks, verifySalesChannelProductLinkCallbacks, verifyTestPort, verifyPricingWorkflowSelection, verifyInventoryLevelDeleteCallbacks, verifyInventoryItemDeleteCallbacks, verifyInventoryLevelBatchCallbacks, verifyInventoryItemCreateCallbacks, verifyStoreDeleteCallbacks, verifyStoreCreateCallbacks, verifyStoreCreationTypes, verifyReservationLineItemDeletionCallbacks, verifyStoreUpdateCallbacks, verifyShippingProfileUpdateCallbacks, verifyShippingProfileCreateCallbacks, verifyShippingOptionRuleBatchCallbacks, verifyLocationFulfillmentSetCallbacks, verifyShippingProfileDeleteCallbacks, verifyShippingOptionTypeCreateCallbacks, verifyShippingOptionTypeUpdateCallbacks, verifyShippingOptionTypeDeleteCallbacks, verifyServiceZoneCreateCallbacks, verifyServiceZoneDeleteCallbacks, verifyFulfillmentSetDeleteCallbacks, verifyServiceZoneUpdateCallbacks, verifyNativeToManyInitialization, verifyNativeRelationScalarFields } from "./check-medusa-test-port.mjs";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { admitsCurrencyImport, verifyCurrencyPromotion, verifyModuleTypeFork, verifyStoreTypeFork, verifyInventoryReservationRestoreFork, verifyStoreCreationTypeFork, verifyPriceListCreationTypeFork, verifyShippingProfileWorkflowTypeFork, verifyLinkCascadeReturnMapFork } from "./check-medusa-currency-promotion.mjs";
import { analyzeMedusaSourceIslandBoundary } from "./check-medusa-source-island-boundary.mjs";

const root = process.cwd();
const promotion = verifyCurrencyPromotion(root);
const source = "packages/medusa-currency/src/models/currency.ts";

describe("native PriceList creation erased type provenance", () => {
  const files = ["pricing/common/money-amount.ts", "pricing/common/price-list.ts", "pricing/workflows.ts"];
  const originals = files.map(file => readFileSync("third_party/medusa/upstream/packages/core/types/src/" + file, "utf8"));
  const targets = files.map(file => readFileSync("packages/medusa-types/src/" + file, "utf8"));
  it.each(files)("admits only the exact erased declarations in %s", file => {
    const index = files.indexOf(file);
    expect(() => verifyPriceListCreationTypeFork(originals[index], targets[index], "packages/medusa-types/src/" + file)).not.toThrow();
  });
  it.each([
    [0, "min_quantity?: BigNumberInput | null | undefined", "min_quantity?: BigNumberInput | null"],
    [0, "max_quantity?: BigNumberInput | null | undefined", "max_quantity?: number"],
    [1, "rules?: CreatePriceListPriceRules | undefined", "rules?: CreatePriceListPriceRules"],
    [1, "price_set_id: string", "price_set_id: string | undefined"],
    [2, "variant_price_map: Record<string, string> | undefined", "variant_price_map: Record<string, string>"],
    [2, "variant_price_map: Record<string, string> | undefined", "variant_price_map?: Record<string, string> | undefined"],
  ])("refuses erased-contract mutation %s: %s", (index, before, after) => {
    const selected = Number(index), target = targets[selected].replace(String(before), String(after));
    expect(target).not.toBe(targets[selected]);
    expect(() => verifyPriceListCreationTypeFork(originals[selected], target, "packages/medusa-types/src/" + files[selected]))
      .toThrow("Changed native PriceList creation erased type seam");
  });
  it("rejects unrelated owners and additional runtime behavior", () => {
    expect(() => verifyPriceListCreationTypeFork(originals[0], targets[0], "unrelated.ts")).toThrow();
    for (const index of [0, 1, 2]) {
      expect(() => verifyPriceListCreationTypeFork(originals[index], targets[index] + "\nglobalThis.changedPriceListType = true;",
        "packages/medusa-types/src/" + files[index])).toThrow();
    }
  });
  it.each(files)("rejects provenance removal for %s", file => {
    const changed = structuredClone(promotion);
    const entry = changed.files.find(row => row.target === "packages/medusa-types/src/" + file);
    if (entry === undefined) throw new Error("Missing PriceList type promotion");
    entry.classification = "authored";
    expect(() => verifyCurrencyPromotion(root, changed)).toThrow("PriceList creation type adaptation outside its exact pinned source pair");
  });
});

describe("native PriceList deletion promotion provenance", () => {
  const paths = ["price-list/workflows/delete-price-lists.ts", "price-list/steps/delete-price-lists.ts"];
  const native = paths.map(file => readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/" + file, "utf8"));
  const targets = paths.map(file => readFileSync("packages/medusa-core-flows/src/" + file, "utf8"));
  /** @param {string[]} values */
  const verify = values => verifyPriceListDeleteCallbacks(native[0], values[0], native[1], values[1]);
  it("admits the original direct void result, required Link call and retained inverse", () => {
    expect(() => verify(targets)).not.toThrow();
  });
  it.each([
    [0, "root result", "return deletedPriceLists", "return undefined"],
    [0, "raw Link IDs", "price_list_id: input.ids", "price_list_id: [...new Set(input.ids)]"],
    [0, "public ID contract", "ids: string[]", "ids: unknown[]"],
    [1, "forward empty call", "await pricingModule.softDeletePriceLists(ids)", "if (ids.length) await pricingModule.softDeletePriceLists(ids)"],
    [1, "raw retained IDs", "new StepResponse(void 0, ids)", "new StepResponse(void 0, [...new Set(ids)])"],
    [1, "guarded inverse", "if (!idsToRestore?.length)", "if (false)"],
    [1, "native restore", "restorePriceLists(idsToRestore)", "softDeletePriceLists(idsToRestore)"],
  ])("rejects changed %s %s", (index, _label, before, after) => {
    const values = targets.slice(), selected = Number(index);
    values[selected] = values[selected].replace(String(before), String(after));
    expect(values[selected]).not.toBe(targets[selected]);
    expect(() => verify(values)).toThrow("Changed native PriceList deletion callback behavior");
  });
  it.each(paths.flatMap(file => [
    { file, field: "classification", mutation: { classification: "authored", source: undefined } },
    { file, field: "source", mutation: { source: "third_party/medusa/upstream/packages/core/core-flows/src/price-list/steps/create-price-lists.ts" } },
    { file, field: "reverse source ownership", mutation: { target: "packages/medusa-core-flows/src/price-list/steps/unadmitted-delete.ts" } },
  ]))("pins both directions of $field for $file", ({ file, mutation }) => {
    const target = "packages/medusa-core-flows/src/" + file;
    expect(promotion.files.some(entry => entry.target === target)).toBe(true);
    expect(() => verifyCurrencyPromotion(root, { ...promotion, files: promotion.files.map(entry => entry.target === target ? { ...entry, ...mutation } : entry) }))
      .toThrow("PriceList deletion outside its exact pinned source pair");
  });
});

describe("PriceList deletion Pricing admission", () => {
  const original = readFileSync("third_party/medusa/upstream/packages/core/types/src/pricing/service.ts", "utf8");
  const selected = readFileSync("packages/medusa-adapter/src/modules/pricing/service.ts", "utf8").replaceAll("\r\n", "\n");
  const repository = readFileSync("packages/medusa-adapter/src/modules/pricing/repository.ts", "utf8").replaceAll("\r\n", "\n");
  it("admits only the two native lifecycle commands under their named profile", () => {
    expect(() => verifyPricingWorkflowSelection(original, selected, repository)).not.toThrow();
  });
  it.each([
    ["predicate", 'listDeletions = admission === "price-list-deletions"', 'listDeletions = true'],
    ["profile", 'listDeletions ? "pricing-price-list-deletions"', 'listDeletions ? "pricing-price-list-creations"'],
    ["read overgrant", 'listDeletions ? [listSoftDelete, listRestore]', 'listDeletions ? [listSoftDelete, listRestore, list]'],
    ["create overgrant", 'listDeletions ? [listSoftDelete, listRestore]', 'listDeletions ? [listSoftDelete, listRestore, createList]'],
    ["physical delete overgrant", 'listDeletions ? [listSoftDelete, listRestore]', 'listDeletions ? [listSoftDelete, listRestore, deleteList]'],
    ["method overgrant", 'listDeletions ? { softDeletePriceLists, restorePriceLists }', 'listDeletions ? { softDeletePriceLists, restorePriceLists, updatePriceLists }'],
    ["native soft-delete crosswire", 'listDeletions ? native.softDeletePriceLists.bind(native)', 'listDeletions ? native.deletePriceLists.bind(native)'],
    ["native restore crosswire", 'listDeletions ? native.restorePriceLists.bind(native)', 'listDeletions ? native.restorePriceSets.bind(native)'],
    ["repository model", 'listCreations || listUpdates || listDeletions ? model === PriceList ? bound.listRepository : bound.denied', 'listCreations || listUpdates || listDeletions ? bound.repository'],
    ["graph exposure", 'preferences || listCreations || listUpdates || listDeletions || listPrices ? { aliases: [], reads: [] }', 'preferences || listCreations || listUpdates ? { aliases: [], reads: [] }'],
    ["complete output", 'output: listDeletionContracts.decodeOutput', 'output: listContracts.decodeOutput'],
    ["DML owner", 'compilePriceListDeletionContracts(metadata.frame)', 'compilePriceListDeletionContracts(otherFrame)'],
    ["policy", 'listDeletions ? pricingListDeletionPolicy(listDeletionContracts)', 'listDeletions ? existingPolicy'],
    ["soft-delete raw IDs", 'Reflect.apply(service.softDeletePriceLists, service, [[...ids], {}, context])', 'Reflect.apply(service.softDeletePriceLists, service, [[], {}, context])'],
    ["restore raw IDs", 'Reflect.apply(service.restorePriceLists, service, [[...ids], {}, context])', 'Reflect.apply(service.restorePriceLists, service, [[...new Set(ids)], {}, context])'],
    ["restore events", 'command: listRestore,\n      arguments: decodePriceListDeletionArguments, encode: ([ids]) => ids, output: listDeletionContracts.decodeOutput', 'command: listRestore,\n      arguments: decodePriceListDeletionArguments, encode: ([ids]) => ids, output: listDeletionContracts.decodeOutput, moduleEvents: ["pricing.price_list.restored"]'],
  ])("rejects changed %s", (_label, before, after) => {
    const changed = selected.replace(before, after); expect(changed).not.toBe(selected);
    expect(() => verifyPricingWorkflowSelection(original, changed, repository)).toThrow();
  });
  it.each([
    ["predicate", 'listDeletions = admission === "price-list-deletions"', 'listDeletions = true'],
    ["contract", 'compilePriceListDeletionContracts(metadata)', 'compilePriceListDeletionContracts(otherMetadata)'],
    ["lifecycle binding", 'priceListLifecycleMethods(listDeletionContracts, bridge, events)', 'priceListLifecycleMethods(listDeletionContracts, bridge, otherEvents)'],
    ["lifecycle refusal", '...(listLifecycle === undefined ? {} : listLifecycle)', '...listLifecycle'],
    ["creation overgrant", 'create: listUpdates || listDeletions || listPriceCreations || listPriceUpdates || listPriceRemovals ? refuse :', 'create: listUpdates ? refuse :'],
    ["physical inverse overgrant", 'delete: listCreations ?', 'delete: listCreations || listDeletions ?'],
    ["admission union", '"price-list-deletions" | "price-list-price-creations" | "price-list-price-updates" | "price-list-price-removals" | "shipping-options"', '"price-list-deletions" | "unbounded" | "price-list-price-creations" | "price-list-price-updates" | "shipping-options"'],
  ])("rejects repository %s", (_label, before, after) => {
    const changed = repository.replace(before, after); expect(changed).not.toBe(repository);
    expect(() => verifyPricingWorkflowSelection(original, selected, changed)).toThrow();
  });
  it.each(["softDeletePriceLists", "restorePriceLists"])("requires original native %s", method => {
    const changed = original.replace(new RegExp("\\b" + method + "(?=\\s*[<(])", "g"), method + "Unadmitted");
    expect(changed).not.toBe(original);
    expect(() => verifyPricingWorkflowSelection(changed, selected, repository)).toThrow("Missing native Pricing admitted methods");
  });
});

describe("PriceList deletion trusted resource provenance", () => {
  const facade = readFileSync("packages/medusa-adapter/src/workflows/pricing/delete-price-lists.ts", "utf8").replaceAll("\r\n", "\n");
  const policy = readFileSync("packages/medusa-adapter/src/workflow/policy.ts", "utf8").replaceAll("\r\n", "\n");
  it("keeps the resource selection private and bound to the deletion profile", () => {
    expect(() => verifyPriceListDeleteSelection(facade, policy)).not.toThrow();
  });
  it.each([
    ["public override", '["execution", "pricing", "link", "revision", "subscribers"]', '["execution", "pricing", "link", "revision", "subscribers", "requestCallLimit"]'],
    ["profile crosswire", '"pricing-price-list-deletions"', '"pricing-price-list-creations"'],
    ["participant mismatch refusal", '!jsonEqual(installed.pricing.logicalResources, priceListDeletionResources)', 'false'],
    ["request identity selection", 'requestCallLimit: priceListDeletionResources.calls', 'requestCallLimit: options.requestCallLimit'],
    ["participant identity selection", 'logicalResources: priceListDeletionResources', 'logicalResources: { ...priceListDeletionResources, eventMessages: 128 }'],
  ])("rejects %s", (_label, before, after) => {
    const changed = facade.replace(before, after); expect(changed).not.toBe(facade);
    expect(() => verifyPriceListDeleteSelection(changed, policy)).toThrow("Changed PriceList deletion resource selection");
  });
  it("rejects an event allowance increase in the named call-only policy", () => {
    const before = 'export const priceListDeletionResources = Object.freeze({ ...defaultCommerceResources, calls: 128 });';
    const changed = policy.replace(before, before.replace('calls: 128', 'calls: 128, eventMessages: 128'));
    expect(changed).not.toBe(policy);
    expect(() => verifyPriceListDeleteSelection(facade, changed)).toThrow("Changed PriceList deletion resource selection");
  });
});

describe("native PriceList update promotion provenance", () => {
  const paths = ["price-list/workflows/update-price-lists.ts", "price-list/steps/update-price-lists.ts", "price-list/steps/validate-price-lists.ts"];
  const native = paths.map(file => readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/" + file, "utf8"));
  const targets = paths.map(file => readFileSync("packages/medusa-core-flows/src/" + file, "utf8"));
  /** @param {string[]} values */
  const verify = values => verifyPriceListUpdateCallbacks(native[0], values[0], native[1], values[1], native[2], values[2]);
  it("admits the complete root, both steps and their exact portable adaptations", () => {
    expect(() => verify(targets)).not.toThrow();
  });
  it.each([
    [0, "root void result", "): void => {", "): WorkflowData<void> => {"],
    [0, "validation branch", "validatePriceListsStep(input.price_lists_data)", "validatePriceListsStep([])"],
    [0, "write branch", "updatePriceListsStep(input.price_lists_data)", "updatePriceListsStep([])"],
    [1, "retained preimage", "dataBeforeUpdate,\n      selects,", "dataBeforeUpdate: [],\n      selects,"],
    [1, "covered inverse", 'compensation: "transactionCovered"', 'compensation: "noCompensation"'],
    [1, "original rules inverse", "buildPriceListRules(priceListRules)!", "buildPriceListRules(priceListRules) ?? {}"],
    [1, "sparse snapshot", "{ relations: relationsClone, select: selectsClone }", "{}"],
    [2, "empty guard", "if (!data.length)", "if (false)"],
    [2, "native missing guard", "if (diff.length)", "if (false)"],
  ])("rejects changed %s %s", (index, _label, before, after) => {
    const selected = Number(index), values = targets.slice();
    values[selected] = values[selected].replace(String(before), String(after));
    expect(values[selected]).not.toBe(targets[selected]);
    expect(() => verify(values)).toThrow("Changed native PriceList update callback behavior");
  });
  it.each(paths.flatMap(file => [
    { file, field: "classification", mutation: { classification: "authored", source: undefined } },
    { file, field: "source", mutation: { source: "third_party/medusa/upstream/packages/core/core-flows/src/price-list/steps/create-price-lists.ts" } },
    { file, field: "reverse source ownership", mutation: { target: "packages/medusa-core-flows/src/price-list/steps/unadmitted-update.ts" } },
  ]))("pins both directions of $field for $file", ({ file, mutation }) => {
    const target = "packages/medusa-core-flows/src/" + file;
    expect(promotion.files.some(entry => entry.target === target)).toBe(true);
    expect(() => verifyCurrencyPromotion(root, { ...promotion, files: promotion.files.map(entry => entry.target === target ? { ...entry, ...mutation } : entry) }))
      .toThrow("PriceList update outside its exact pinned source pair");
  });
});

describe("native PriceList rule builder promotion provenance", () => {
  const source = "third_party/medusa/upstream/packages/core/utils/src/pricing/builders.ts";
  const target = "packages/medusa-utils/src/pricing/price-list-rules.ts";
  const native = readFileSync(source, "utf8"), helper = readFileSync(target, "utf8");
  it("admits only the selected complete original helper and exact erased import", () => {
    expect(() => verifyNativePriceListRuleBuilder(native, helper)).not.toThrow();
  });
  it.each([
    ["last duplicate wins", "acc[ruleAttribute] = ruleValues", "acc[ruleAttribute] ??= ruleValues"],
    ["native absence", "priceListRules?.reduce", "priceListRules.reduce"],
    ["native falsy fallback", "curr.value || []", "curr.value ?? []"],
    ["native public types", "PriceListRuleDTO[]", "unknown[]"],
    ["exact erased import", 'from "@medusajs/types"', 'from "@medusajs/framework/types"'],
  ])("rejects changed %s", (_label, before, after) => {
    const changed = helper.replace(before, after); expect(changed).not.toBe(helper);
    expect(() => verifyNativePriceListRuleBuilder(native, changed)).toThrow("Changed native PriceList rule builder extraction");
  });
  it("rejects an incomplete native selection and extra target behavior", () => {
    expect(() => verifyNativePriceListRuleBuilder(native.replace("function buildPriceListRules(", "function otherRules("), helper)).toThrow();
    expect(() => verifyNativePriceListRuleBuilder(native, helper + "\nexport const extra = true;\n")).toThrow();
  });
  it.each([
    ["classification", { classification: "authored", source: undefined }],
    ["whole module classification", { classification: "unchanged" }],
    ["source", { source: "third_party/medusa/upstream/packages/core/utils/src/pricing/index.ts" }],
    ["reverse source ownership", { target: "packages/medusa-utils/src/pricing/unadmitted-rules.ts" }],
  ])("pins both directions of %s", (_label, mutation) => {
    expect(promotion.files.some(entry => entry.target === target)).toBe(true);
    expect(() => verifyCurrencyPromotion(root, { ...promotion, files: promotion.files.map(entry => entry.target === target ? { ...entry, ...mutation } : entry) }))
      .toThrow("PriceList rule builder outside its exact pinned source pair");
  });
});

describe("native PricePreference deletion callback provenance", () => {
  const paths = ["pricing/workflows/delete-price-preferences.ts", "pricing/steps/delete-price-preferences.ts"];
  const originals = paths.map(file => readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/" + file, "utf8"));
  const targets = paths.map(file => readFileSync("packages/medusa-core-flows/src/" + file, "utf8"));
  const verify = (workflow = targets[0], step = targets[1]) => verifyPricePreferenceDeleteCallbacks(originals[0], workflow, originals[1], step);
  it("admits the complete original workflow, public inputs and retained callbacks", () => {
    expect(() => verify()).not.toThrow();
  });
  /** @type {Array<[number,string,string,string]>} */
  const mutations = [
    [0, "root identity", '"delete-price-preferences"', '"other-preferences"'],
    [0, "public raw input", "DeletePricePreferencesWorkflowInput = string[]", "DeletePricePreferencesWorkflowInput = unknown[]"],
    [0, "child raw input", "deletePricePreferencesStep(input)", "deletePricePreferencesStep([])"],
    [0, "required Link module", "[Modules.PRICING]", "[Modules.PRODUCT]"],
    [0, "Link endpoint", "price_preference_id: input,", "price_id: input,"],
    [0, "Link raw IDs", "price_preference_id: input,", "price_preference_id: [],"],
    [0, "required Link call", "removeRemoteLinkStep({", "void ({"],
    [0, "public result", "return deletedPricePreferences", "return void 0"],
    [0, "leaf import", 'from "../steps/delete-price-preferences"', 'from "../steps"'],
    [1, "covered metadata", 'compensation: "transactionCovered"', 'compensation: "noCompensation"'],
    [1, "public raw step input", "DeletePricePreferencesStepInput = string[]", "DeletePricePreferencesStepInput = unknown[]"],
    [1, "Pricing capability", "Modules.PRICING", "Modules.REGION"],
    [1, "native forward method", "service.softDeletePricePreferences(ids)", "service.deletePricePreferences(ids)"],
    [1, "forward raw IDs", "service.softDeletePricePreferences(ids)", "service.softDeletePricePreferences([])"],
    [1, "awaited forward", "await service.softDeletePricePreferences(ids)", "service.softDeletePricePreferences(ids)"],
    [1, "retained raw IDs", "new StepResponse(void 0, ids)", "new StepResponse(void 0, [])"],
    [1, "empty inverse guard", "if (!prevIds?.length)", "if (!prevIds)"],
    [1, "original inverse", "service.restorePricePreferences(prevIds)", "service.softDeletePricePreferences(prevIds)"],
    [1, "inverse raw IDs", "service.restorePricePreferences(prevIds)", "service.restorePricePreferences([])"],
    [1, "awaited inverse", "await service.restorePricePreferences(prevIds)", "service.restorePricePreferences(prevIds)"],
  ];
  it.each(mutations)("rejects changed member %i %s", (index, _name, before, after) => {
    expect(targets[index]).toContain(before);
    const changed = targets.map((text, slot) => slot === index ? text.replace(before, after) : text);
    expect(() => verify(changed[0], changed[1])).toThrow("Changed native PricePreference deletion callback behavior");
  });
  it("rejects extra whole-module behavior and missing native adaptation anchors", () => {
    expect(() => verify(targets[0] + '\nthrow new Error("extra");', targets[1])).toThrow();
    expect(() => verify(targets[0], targets[1] + '\nthrow new Error("extra");')).toThrow();
    expect(() => verifyPricePreferenceDeleteCallbacks(originals[0].replace('from "../steps"', 'from "other"'), targets[0], originals[1], targets[1]))
      .toThrow("missing native adaptation anchor");
  });
  it.each(paths.flatMap(file => [
    { file, field: "classification", mutation: { classification: "authored", source: undefined } },
    { file, field: "source", mutation: { source: "third_party/medusa/upstream/packages/core/core-flows/src/pricing/steps/create-price-preferences.ts" } },
  ]))("pins the exact $field for $file", ({ file, mutation }) => {
    const target = "packages/medusa-core-flows/src/" + file;
    expect(() => verifyCurrencyPromotion(root, { ...promotion, files: promotion.files.map(entry => entry.target === target ? { ...entry, ...mutation } : entry) }))
      .toThrow("PricePreference deletion outside its exact pinned source pair");
  });
});

describe("native PricePreference update callback provenance", () => {
  const paths = ["pricing/workflows/update-price-preferences.ts", "pricing/steps/update-price-preferences.ts"];
  const originals = paths.map(file => readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/" + file, "utf8"));
  const targets = paths.map(file => readFileSync("packages/medusa-core-flows/src/" + file, "utf8"));
  const verify = (workflow = targets[0], step = targets[1]) => verifyPricePreferenceUpdateCallbacks(originals[0], workflow, originals[1], step);
  it("admits the whole native public contract and callbacks through the portable seams", () => {
    expect(() => verify()).not.toThrow();
  });
  /** @type {Array<[number,string,string,string]>} */
  const mutations = [
    [0, "root identity", '"update-price-preferences"', '"other-preferences"'],
    [0, "child input", "updatePricePreferencesStep(input)", "updatePricePreferencesStep({})"],
    [0, "full output", "new WorkflowResponse(updatePricePreferencesStep(input))", "new WorkflowResponse([])"],
    [0, "public workflow input", "PricingWorkflow.UpdatePricePreferencesWorkflowInput", "unknown"],
    [0, "leaf import", 'from "../steps/update-price-preferences"', 'from "../steps"'],
    [1, "covered metadata", 'compensation: "transactionCovered"', 'compensation: "noCompensation"'],
    [1, "Pricing capability", "Modules.PRICING", "Modules.REGION"],
    [1, "preimage selector", "listPricePreferences(input.selector,", "listPricePreferences({},"],
    [1, "sparse selection", "select: selects,", 'select: ["id"],'],
    [1, "native relations", "      relations,", "      relations: [],"],
    [1, "native selection derivation", "      input.update,", "      {},"],
    [1, "forward selector", "      input.selector,", "      {},"],
    [1, "forward update", "      input.update\n", "      {}\n"],
    [1, "full returned rows", "new StepResponse(updatedPricePreferences, prevData)", "new StepResponse([], prevData)"],
    [1, "retained preimage", "new StepResponse(updatedPricePreferences, prevData)", "new StepResponse(updatedPricePreferences, updatedPricePreferences)"],
    [1, "empty inverse guard", "if (!prevData?.length)", "if (!prevData)"],
    [1, "inverse method", "service.upsertPricePreferences(prevData)", "service.updatePricePreferences(prevData)"],
    [1, "inverse input", "service.upsertPricePreferences(prevData)", "service.upsertPricePreferences([])"],
    [1, "awaited inverse", "await service.upsertPricePreferences(prevData)", "service.upsertPricePreferences(prevData)"],
    [1, "public step input", "input: PricingWorkflow.UpdatePricePreferencesWorkflowInput", "input: unknown"],
  ];
  it.each(mutations)("rejects changed member %i %s", (index, _name, before, after) => {
    expect(targets[index]).toContain(before);
    const changed = targets.map((source, slot) => slot === index ? source.replace(before, after) : source);
    expect(() => verify(changed[0], changed[1])).toThrow("Changed native PricePreference update callback behavior");
  });
  it("rejects extra whole-module behavior and missing native relocation anchors", () => {
    expect(() => verify(targets[0] + '\nthrow new Error("extra");', targets[1])).toThrow();
    expect(() => verify(targets[0], targets[1] + '\nthrow new Error("extra");')).toThrow();
    expect(() => verifyPricePreferenceUpdateCallbacks(originals[0].replace('from "../steps"', 'from "other"'), targets[0], originals[1], targets[1]))
      .toThrow("missing native adaptation anchor");
  });
  it.each(paths.flatMap(file => [
    { file, field: "classification", mutation: { classification: "authored", source: undefined } },
    { file, field: "source", mutation: { source: "third_party/medusa/upstream/packages/core/core-flows/src/pricing/steps/create-price-sets.ts" } },
  ]))("pins the exact $field for $file", ({ file, mutation }) => {
    const target = "packages/medusa-core-flows/src/" + file;
    expect(() => verifyCurrencyPromotion(root, { ...promotion, files: promotion.files.map(entry => entry.target === target ? { ...entry, ...mutation } : entry) }))
      .toThrow("PricePreference update outside its exact pinned source pair");
  });
});

describe("native PricePreference creation callback provenance", () => {
  const paths = ["pricing/workflows/create-price-preferences.ts", "pricing/steps/create-price-preferences.ts"];
  const originals = paths.map(file => readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/" + file, "utf8"));
  const targets = paths.map(file => readFileSync("packages/medusa-core-flows/src/" + file, "utf8"));
  const verify = (workflow = targets[0], step = targets[1]) => verifyPricePreferenceCreateCallbacks(originals[0], workflow, originals[1], step);
  it("admits original array inputs, full results and retained physical deletion with only portable seams", () => {
    expect(() => verify()).not.toThrow();
    expect(() => verify(targets[0], targets[1].replace("const pricePreferences =", "const pricePreferences: unknown ="))).not.toThrow();
  });
  /** @type {Array<[number,string,string,string]>} */
  const mutations = [
    [0, "workflow identity", '"create-price-preferences"', '"other-price-preferences"'],
    [0, "original child input", "createPricePreferencesStep(input)", "createPricePreferencesStep([])"],
    [0, "original full result", "new WorkflowResponse(createPricePreferencesStep(input))", "new WorkflowResponse([])"],
    [0, "original child import", 'from "../steps/create-price-preferences"', 'from "../steps"'],
    [0, "public workflow array contract", "PricingWorkflow.CreatePricePreferencesWorkflowInput[]", "PricingWorkflow.CreatePricePreferencesWorkflowInput"],
    [0, "public workflow type owner", 'import type { PricingWorkflow } from "@medusajs/types"', 'import type { PricingWorkflow } from "other-types"'],
    [1, "step identity", '"create-price-preferences"', '"other-price-preferences"'],
    [1, "covered settlement metadata", 'compensation: "transactionCovered"', 'compensation: "noCompensation"'],
    [1, "Pricing capability", "Modules.PRICING", "Modules.REGION"],
    [1, "original array argument", "pricingModule.createPricePreferences(data)", "pricingModule.createPricePreferences([])"],
    [1, "native creation method", "pricingModule.createPricePreferences(data)", "pricingModule.upsertPricePreferences(data)"],
    [1, "awaited original creation", "await pricingModule.createPricePreferences(data)", "pricingModule.createPricePreferences(data)"],
    [1, "raw order and duplicates", "pricingModule.createPricePreferences(data)", "pricingModule.createPricePreferences(data.slice().reverse())"],
    [1, "retained returned IDs", "pricePreference.id)", "pricePreference.value)"],
    [1, "returned full DTOs", "      pricePreferences,", "      pricePreferences.map((entry) => entry.id),"],
    [1, "empty input still calls Pricing", "    const pricePreferences = await", "    if (!data.length) return new StepResponse([], [])\n    const pricePreferences = await"],
    [1, "inverse empty guard", "if (!pricePreferences?.length)", "if (!pricePreferences)"],
    [1, "physical inverse", "pricingModule.deletePricePreferences(pricePreferences)", "pricingModule.softDeletePricePreferences(pricePreferences)"],
    [1, "exact retained inverse input", "pricingModule.deletePricePreferences(pricePreferences)", "pricingModule.deletePricePreferences([])"],
    [1, "awaited original inverse", "await pricingModule.deletePricePreferences(pricePreferences)", "pricingModule.deletePricePreferences(pricePreferences)"],
    [1, "original step array contract", "PricingWorkflow.CreatePricePreferencesWorkflowInput[]", "PricingWorkflow.CreatePricePreferencesWorkflowInput[] | null"],
    [1, "original type import owner", 'from "@medusajs/types"', 'from "other-types"'],
  ];
  it.each(mutations)("rejects changed member %i %s", (index, _name, before, after) => {
    expect(targets[index]).toContain(before);
    const changed = targets.map((text, slot) => slot === index ? text.replace(before, after) : text);
    expect(() => verify(changed[0], changed[1])).toThrow("Changed native PricePreference creation callback behavior");
  });
  it("rejects extra behavior in either whole module and altered native anchors", () => {
    for (let index = 0; index < targets.length; index++) {
      const changed = targets.map((text, slot) => slot === index ? text + '\nthrow new Error("extra");\n' : text);
      expect(() => verify(changed[0], changed[1])).toThrow();
    }
    expect(() => verifyPricePreferenceCreateCallbacks(originals[0].replace('from "../steps"', 'from "other-steps"'), targets[0], originals[1], targets[1]))
      .toThrow("missing native adaptation anchor");
  });
  it.each(paths.flatMap(file => [
    { file, field: "classification", mutation: { classification: "authored", source: undefined } },
    { file, field: "source", mutation: { source: "third_party/medusa/upstream/packages/core/core-flows/src/pricing/steps/create-price-sets.ts" } },
  ]))("pins the exact $field for $file", ({ file, mutation }) => {
    const target = "packages/medusa-core-flows/src/" + file;
    expect(() => verifyCurrencyPromotion(root, { ...promotion, files: promotion.files.map(entry => entry.target === target ? { ...entry, ...mutation } : entry) }))
      .toThrow("PricePreference creation outside its exact pinned source pair");
  });
});

describe("native SalesChannel Product membership callback provenance", () => {
  const paths = [
    "sales-channel/workflows/link-products-to-sales-channel.ts",
    "sales-channel/steps/associate-products-with-channels.ts",
    "sales-channel/steps/detach-products-from-sales-channels.ts",
  ];
  const originals = paths.map(file => readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/" + file, "utf8"));
  const targets = paths.map(file => readFileSync("packages/medusa-core-flows/src/" + file, "utf8"));
  const verify = (workflow = targets[0], association = targets[1], detachment = targets[2]) =>
    verifySalesChannelProductLinkCallbacks(originals[0], workflow, originals[1], association, originals[2], detachment);
  it("admits only finite input/void seams, native raw definitions and distinct empty inverses", () => {
    expect(() => verify()).not.toThrow();
    expect(() => verify(targets[0], targets[1].replace("const createdLinks =", "const createdLinks: unknown ="))).not.toThrow();
  });
  /** @type {Array<[number,string,string,string]>} */
  const mutations = [
    [0, "root identity", '"link-products-to-sales-channel"', '"other-membership"'],
    [0, "add channel", "sales_channel_id: data.input.id", 'sales_channel_id: "other"'],
    [0, "raw add duplicates", "data.input.add?.map", "data.input.add?.filter(Boolean).map"],
    [0, "raw remove delegation", "data.input.remove?.map", "data.input.add?.map"],
    [0, "add omission", "links: data.input.add?.map", "links: (data.input.add ?? []).map"],
    [0, "remove Product identity", "product_id: productId,", 'product_id: "other",'],
    [0, "native association invocation", "associateProductsWithSalesChannelsStep(toAdd)", "associateProductsWithSalesChannelsStep(toRemove)"],
    [0, "native step order", "associateProductsWithSalesChannelsStep(toAdd)\n    detachProductsFromSalesChannelsStep(toRemove)", "detachProductsFromSalesChannelsStep(toRemove)\n    associateProductsWithSalesChannelsStep(toAdd)"],
    [0, "void result", "new WorkflowResponse(void 0)", "new WorkflowResponse([])"],
    [0, "leaf import", 'from "../steps/detach-products-from-sales-channels"', 'from "../steps"'],
    [1, "association empty output", "new StepResponse([], [])", "new StepResponse([], undefined)"],
    [1, "association invocation guard", "if (!input.links?.length)", "if (!input.links)"],
    [1, "association required empty inverse", "if (!links)", "if (!links?.length)"],
    [1, "association Link capability", "ContainerRegistrationKeys.LINK", "ContainerRegistrationKeys.QUERY"],
    [1, "association raw Product", "product_id: link.product_id", 'product_id: "other"'],
    [1, "association create arguments", "remoteLink.create(links)", "remoteLink.create([])"],
    [1, "association awaited create", "await remoteLink.create(links)", "remoteLink.create(links)"],
    [1, "association raw retained definitions", "new StepResponse(createdLinks, links)", "new StepResponse(createdLinks, createdLinks)"],
    [1, "association inverse", "remoteLink.dismiss(links)", "remoteLink.create(links)"],
    [1, "association settlement metadata", 'compensation: "transactionCovered"', 'compensation: "noCompensation"'],
    [1, "association omitted links contract", "links?: {", "links: {"],
    [2, "detachment empty output", "new StepResponse(void 0, [])", "new StepResponse([], [])"],
    [2, "detachment invocation guard", "if (!input.links?.length)", "if (!input.links)"],
    [2, "detachment skipped empty inverse", "if (!links?.length)", "if (!links)"],
    [2, "detachment raw channel", "sales_channel_id: link.sales_channel_id", 'sales_channel_id: "other"'],
    [2, "detachment dismiss arguments", "remoteLink.dismiss(links)", "remoteLink.dismiss([])"],
    [2, "detachment awaited dismiss", "await remoteLink.dismiss(links)", "remoteLink.dismiss(links)"],
    [2, "detachment raw retained definitions", "new StepResponse(void 0, links)", "new StepResponse(void 0, [])"],
    [2, "detachment inverse", "remoteLink.create(links)", "remoteLink.dismiss(links)"],
    [2, "detachment settlement metadata", 'compensation: "transactionCovered"', 'compensation: "noCompensation"'],
    [2, "detachment omitted links contract", "links?: {", "links: {"],
    [2, "Product key contract", "product_id: string", "product_id: unknown"],
  ];
  it.each(mutations)("rejects changed member %i %s", (index, _name, before, after) => {
    expect(targets[index]).toContain(before);
    const changed = targets.map((text, slot) => slot === index ? text.replace(before, after) : text);
    expect(() => verify(changed[0], changed[1], changed[2])).toThrow("Changed native SalesChannel Product membership callback behavior");
  });
  it("rejects extra runtime in every module and missing original adaptation anchors", () => {
    for (let index = 0; index < targets.length; index++) {
      const changed = targets.map((text, slot) => slot === index ? text + '\nthrow new Error("extra");\n' : text);
      expect(() => verify(changed[0], changed[1], changed[2])).toThrow();
    }
    expect(() => verifySalesChannelProductLinkCallbacks(originals[0].replace("data.input.add?.map", "data.input.add.map"), targets[0], originals[1], targets[1], originals[2], targets[2]))
      .toThrow("missing native adaptation anchor");
  });
  it.each(paths.flatMap(file => [
    { file, field: "classification", mutation: { classification: "authored", source: undefined } },
    { file, field: "source", mutation: { source: "third_party/medusa/upstream/packages/core/core-flows/src/common/steps/create-remote-links.ts" } },
  ]))("pins the exact $field for $file", ({ file, mutation }) => {
    const target = "packages/medusa-core-flows/src/" + file;
    expect(() => verifyCurrencyPromotion(root, { ...promotion, files: promotion.files.map(entry => entry.target === target ? { ...entry, ...mutation } : entry) }))
      .toThrow("SalesChannel Product membership outside its exact pinned source pair");
  });
});

describe("native Link cascade return-map correction provenance", () => {
  const native = readFileSync("third_party/medusa/upstream/packages/core/modules-sdk/src/link.ts", "utf8");
  const adapted = readFileSync("packages/medusa-modules-sdk/src/link.ts", "utf8");
  it("admits the approved correction and refuses the uncorrected native map", () => {
    expect(() => verifyLinkCascadeReturnMapFork(native, adapted)).not.toThrow();
    expect(() => verifyLinkCascadeReturnMapFork(native, native)).toThrow("Changed native Link cascade return-map fork behavior");
  });
  it.each([
    ["declared key order", "returnFields.find((field)", "returnFields.reverse().find((field)"],
    ["owned key presence", "Object.prototype.hasOwnProperty.call(deletedEntities, field)", "deletedEntities[field]?.length"],
    ["missing key guard", "if (mainKey !== undefined)", "if (mainKey === undefined)"],
    ["accumulation", "...new Set(", "...Array.of("],
    ["returned IDs", "deletedEntities[mainKey]", "[]"],
    ["processed ID tracking", "processedIds[hash].add(id)", "processedIds[hash].delete(id)"],
    ["recursive continuation", "deleteKeys: deletedEntities as DeleteEntities", "deleteKeys: {} as DeleteEntities"],
    ["native lifecycle call", "service[method]", "service.restore"],
  ])("rejects changed %s", (_label, before, after) => {
    expect(adapted).toContain(before);
    expect(() => verifyLinkCascadeReturnMapFork(native, adapted.replace(before, after)))
      .toThrow("Changed native Link cascade return-map fork behavior");
  });
  it("refuses reclassifying the exact source pair as authored", () => {
    expect(() => verifyCurrencyPromotion(root, { ...promotion, files: promotion.files.map(file =>
      file.target === "packages/medusa-modules-sdk/src/link.ts" ? { ...file, classification: "authored", source: undefined } : file) }))
      .toThrow("Link cascade adaptation outside its exact pinned source pair");
  });
});

describe("native Inventory reservation line-item restore correction provenance", () => {
  const native = readFileSync("third_party/medusa/upstream/packages/modules/inventory/src/services/inventory-module.ts", "utf8");
  const adapted = readFileSync("packages/medusa-inventory/src/services/inventory-module.ts", "utf8");
  it("refuses a different native source for the sole Inventory service target", () => {
    expect(() => verifyCurrencyPromotion(root, { ...promotion, files: promotion.files.map(file =>
      file.target === "packages/medusa-inventory/src/services/inventory-module.ts"
        ? { ...file, source: "third_party/medusa/upstream/packages/modules/inventory/src/services/inventory-level.ts" } : file) }))
      .toThrow("Inventory service adaptation outside its approved source file");
  });
  const helper = readFileSync("packages/medusa-inventory/src/utils/inventory-level-quantity.ts", "utf8");
  /** @param {string} source @param {string} target */
  const verify = (source, target) => verifyInventoryReservationRestoreFork(source, target, helper);
  const correctedMethod = "  @InjectTransactionManager()\n  protected async restoreReservationItemsByLineItem_(\n    lineItemId: string | string[],\n    @MedusaContext() context: Context = {}\n  ): Promise<void> {\n    const reservations: InventoryTypes.ReservationItemDTO[] =\n      await this.reservationItemService_.list(\n        { line_item_id: lineItemId },\n        { withDeleted: true },\n        context\n      )\n\n    // Snapshot deleted preimages before restore can mutate managed entities.\n    const reservationsToRestore = reservations\n      .filter((reservation) => reservation.deleted_at !== null)\n      .map((reservation) => ({ ...reservation }))\n\n    await this.reservationItemService_.restore(\n      { line_item_id: lineItemId },\n      context\n    )\n\n    await this.adjustInventoryLevelsForReservationsRestore(\n      reservationsToRestore,\n      context\n    )\n  }\n";
  it("admits only the approved deleted-history preimage correction and erased types", () => {
    expect(() => verify(native, adapted)).not.toThrow();
    expect(() => verify(native, adapted.replace("const reservationsToRestore =", "const reservationsToRestore: InventoryTypes.ReservationItemDTO[] ="))).not.toThrow();
    expect(() => verify(native, native)).toThrow();
  });
  it.each([
  [
    "history visibility",
    "{ withDeleted: true }",
    "{}"
  ],
  [
    "false history flag",
    "{ withDeleted: true }",
    "{ withDeleted: false }"
  ],
  [
    "active preimage admission",
    "reservation.deleted_at !== null",
    "reservation.deleted_at === null"
  ],
  [
    "all history admission",
    ".filter((reservation) => reservation.deleted_at !== null)",
    ".filter(() => true)"
  ],
  [
    "snapshot copy",
    ".map((reservation) => ({ ...reservation }))",
    ".map((reservation) => reservation)"
  ],
  [
    "redundant explicit snapshot",
    ".map((reservation) => ({ ...reservation }))",
    ".map((reservation) => ({ ...reservation, quantity: reservation.quantity }))"
  ],
  [
    "selected preimage order",
    ".map((reservation) => ({ ...reservation }))",
    ".map((reservation) => ({ ...reservation })).reverse()"
  ],
  [
    "raw selectors",
    "{ line_item_id: lineItemId }",
    "{ line_item_id: [] }"
  ],
  [
    "quantity helper preimages",
    "      reservationsToRestore,",
    "      reservations,"
  ],
  [
    "raw restore selector",
    "await this.reservationItemService_.restore(\n      { line_item_id: lineItemId },",
    "await this.reservationItemService_.restore(\n      { line_item_id: [] },"
  ],
  [
    "empty invocation",
    "await this.reservationItemService_.restore(\n      { line_item_id: lineItemId },",
    "if (lineItemId.length) await this.reservationItemService_.restore(\n      { line_item_id: lineItemId },"
  ],
  [
    "transaction decorator",
    "@InjectTransactionManager()\n  protected async restoreReservationItemsByLineItem_",
    "protected async restoreReservationItemsByLineItem_"
  ],
  [
    "by-ID method",
    "protected async restoreReservationItems_(",
    "protected async changedRestoreReservationItems_("
  ],
  [
    "unrelated runtime",
    "export default class InventoryModuleService",
    "export const extraInventoryRuntime = true;\nexport default class InventoryModuleService"
  ]
])('rejects changed %s', (_name, before, after) => {
    const outsideMethod = _name === "by-ID method" || _name === "unrelated runtime";
    const selected = outsideMethod ? adapted : correctedMethod;
    const replacement = selected.replace(before, after); expect(replacement).not.toBe(selected);
    const changed = outsideMethod ? replacement : adapted.replace(correctedMethod, replacement);
    expect(changed).not.toBe(adapted);
    expect(() => verify(native, changed)).toThrow();
  });
  it("refuses snapshot capture after lifecycle restore", () => {
    const snapshot = "    // Snapshot deleted preimages before restore can mutate managed entities.\n    const reservationsToRestore = reservations\n      .filter((reservation) => reservation.deleted_at !== null)\n      .map((reservation) => ({ ...reservation }))\n\n";
    const changed = adapted.replace(snapshot, "").replace("    await this.adjustInventoryLevelsForReservationsRestore(\n      reservationsToRestore,", snapshot + "    await this.adjustInventoryLevelsForReservationsRestore(\n      reservationsToRestore,");
    expect(changed).not.toBe(adapted);
    expect(() => verify(native, changed)).toThrow();
  });
  it("refuses duplicate or missing corrected method", () => {
    const method = "  @InjectTransactionManager()\n  protected async restoreReservationItemsByLineItem_(\n    lineItemId: string | string[],\n    @MedusaContext() context: Context = {}\n  ): Promise<void> {\n    const reservations: InventoryTypes.ReservationItemDTO[] =\n      await this.reservationItemService_.list(\n        { line_item_id: lineItemId },\n        { withDeleted: true },\n        context\n      )\n\n    // Snapshot deleted preimages before restore can mutate managed entities.\n    const reservationsToRestore = reservations\n      .filter((reservation) => reservation.deleted_at !== null)\n      .map((reservation) => ({ ...reservation }))\n\n    await this.reservationItemService_.restore(\n      { line_item_id: lineItemId },\n      context\n    )\n\n    await this.adjustInventoryLevelsForReservationsRestore(\n      reservationsToRestore,\n      context\n    )\n  }\n";
    expect(adapted).toContain(method);
    expect(() => verify(native, adapted.replace(method, method + "\n" + method))).toThrow();
    expect(() => verify(native, adapted.replace(method, ""))).toThrow();
  });
});


describe("native Inventory Reservation arithmetic extraction provenance", () => {
  const native = readFileSync("third_party/medusa/upstream/packages/modules/inventory/src/services/inventory-module.ts", "utf8");
  const adapted = readFileSync("packages/medusa-inventory/src/services/inventory-module.ts", "utf8");
  const helper = readFileSync("packages/medusa-inventory/src/utils/inventory-level-quantity.ts", "utf8");
  it("retains the exact extracted native algorithm and its sole delegated call", () => {
    expect(() => verifyInventoryReservationRestoreFork(native, adapted, helper)).not.toThrow();
    expect(() => verifyInventoryReservationRestoreFork(native, adapted, helper.replace("const multiplier =", "const multiplier: number ="))).not.toThrow();
  });
  it.each([
    ["multiplier", "isDelete ? -1 : 1", "isDelete ? 1 : -1"],
    ["group owner", "acc.get(curr.inventory_item_id)", "acc.get(curr.location_id)"],
    ["group lookup", "inventoryLevelMap.has(curr.location_id)", "inventoryLevelMap.has(curr.inventory_item_id)"],
    ["previous adjustment", "inventoryLevelMap.get(curr.location_id)", "inventoryLevelMap.get(curr.inventory_item_id)"],
    ["group addition", "MathBN.add(", "MathBN.sub("],
    ["quantity multiplier", "MathBN.mult(curr.quantity, multiplier)", "MathBN.mult(curr.quantity, 1)"],
    ["quantity source", "MathBN.mult(curr.quantity, multiplier)", "MathBN.mult(0, multiplier)"],
    ["group location", "inventoryLevelMap.set(curr.location_id, adjustment)", "inventoryLevelMap.set(curr.inventory_item_id, adjustment)"],
    ["group insertion", "acc.set(curr.inventory_item_id, inventoryLevelMap)", "acc.set(curr.location_id, inventoryLevelMap)"],
    ["group iteration order", "reservations.reduce((acc, curr)", "[...reservations].reverse().reduce((acc, curr)"],
    ["Level iteration order", "return inventoryLevels.map((level)", "return [...inventoryLevels].reverse().map((level)"],
    ["Level lookup", ".get(level.inventory_item_id)", ".get(level.location_id)"],
    ["Level location", "?.get(level.location_id)", "?.get(level.inventory_item_id)"],
    ["zero/undefined selection", "if (!adjustment)", "if (adjustment === undefined)"],
    ["undefined entry preservation", "if (!adjustment) {\n      return", "if (!adjustment) {\n      return { id: level.id, reserved_quantity: 0 }"],
    ["update identity", "id: level.id,", "id: level.location_id,"],
    ["reserved source", "MathBN.add(level.reserved_quantity, adjustment)", "MathBN.add(0, adjustment)"],
    ["extra update field", "id: level.id,", "id: level.id, stocked_quantity: 0,"],
    ["available quantity owner", "MathBN.sub(stocked, reserved)", "MathBN.add(stocked, reserved)"],
    ["helper parameter order", "reservations: readonly", "reorderedReservations: readonly"],
  ])("rejects changed extracted %s", (_name, before, after) => {
    const changed = helper.replace(before, after); expect(changed).not.toBe(helper);
    expect(() => verifyInventoryReservationRestoreFork(native, adapted, changed)).toThrow();
  });
  it.each([
    ["helper import", 'import { inventoryLevelReservationAdjustments } from "../utils/inventory-level-quantity"', 'import { inventoryLevelReservationAdjustments } from "../utils/other"'],
    ["unused helper", "const levelAdjustmentUpdates = inventoryLevelReservationAdjustments(", "const levelAdjustmentUpdates = anotherHelper("],
    ["delegate source", "      reservations,\n      inventoryLevels,\n      isDelete", "      [],\n      inventoryLevels,\n      isDelete"],
    ["delegate Level source", "      reservations,\n      inventoryLevels,\n      isDelete", "      reservations,\n      [],\n      isDelete"],
    ["delegate multiplier", "      reservations,\n      inventoryLevels,\n      isDelete", "      reservations,\n      inventoryLevels,\n      !isDelete"],
    ["ensure inputs", "reservations.map((r) => ({", "[].map((r) => ({"],
    ["ensure call", "const inventoryLevels = await this.ensureInventoryLevels(", "const inventoryLevels = await this.anotherEnsure("],
    ["update arguments", "await this.inventoryLevelService_.update(levelAdjustmentUpdates, context)", "await this.inventoryLevelService_.update([], context)"],
    ["update context", "await this.inventoryLevelService_.update(levelAdjustmentUpdates, context)", "await this.inventoryLevelService_.update(levelAdjustmentUpdates, {})"],
  ])("rejects changed native arithmetic delegation %s", (_name, before, after) => {
    const start = _name === "helper import" ? 0 : adapted.indexOf("  private async adjustInventoryLevelsForReservations_(");
    expect(start).toBeGreaterThanOrEqual(0);
    const selected = adapted.slice(start), replacement = selected.replace(before, after); expect(replacement).not.toBe(selected);
    const changed = adapted.slice(0, start) + replacement;
    expect(() => verifyInventoryReservationRestoreFork(native, changed, helper)).toThrow();
  });
  it("refuses missing, duplicate or extra runtime helper exports", () => {
    expect(() => verifyInventoryReservationRestoreFork(native, adapted, helper.replace("export function inventoryLevelReservationAdjustments(", "function inventoryLevelReservationAdjustments("))).toThrow();
    expect(() => verifyInventoryReservationRestoreFork(native, adapted, helper + "\nexport const extra = true;\n")).toThrow();
    expect(() => verifyInventoryReservationRestoreFork(native, adapted, helper + "\nexport function inventoryLevelReservationAdjustments() {}\n")).toThrow();
  });
});

describe("named Pricing workflow admission selection", () => {
  const native = readFileSync("third_party/medusa/upstream/packages/core/types/src/pricing/service.ts", "utf8");
  const adapter = readFileSync("packages/medusa-adapter/src/modules/pricing/service.ts", "utf8");
  const repository = readFileSync("packages/medusa-adapter/src/modules/pricing/repository.ts", "utf8");
  it("retains Product profiles and isolates PricePreference creation, Store lookup and native updates from Shipping", () => {
    expect(() => verifyPricingWorkflowSelection(native, adapter, repository)).not.toThrow();
  });
  it.each([
    ["PriceList Price named profile", 'listPriceCreations ? "pricing-price-list-price-creations"', 'listPriceCreations ? "pricing-price-list-creations"'],
    ["PriceList Price command overgrant", 'listPriceCreations ? [listPriceRead, addListPrices, removeListPrices]', 'listPriceCreations ? [listPriceRead, addListPrices, removeListPrices, createList]'],
    ["PriceList Price inverse removal", 'listPriceCreations ? [listPriceRead, addListPrices, removeListPrices]', 'listPriceCreations ? [listPriceRead, addListPrices]'],
    ["PriceList Price repository overgrant", 'listPrices ? model === PriceList ? bound.listRepository : model === Price ? bound.priceRepository : listPriceUpdates && model === PriceRule ? bound.ruleRepository : bound.denied', 'listPrices ? bound.repository'],
    ["PriceList Price method read crosswire", 'listPriceLists: listPriceListsForPriceCreation', 'listPriceLists: listPriceListsForUpdate'],
    ["PriceList Price read grammar overgrant", 'Schema.Tuple([PriceListPriceReadInput.fields.filters, Schema.Struct({})])', 'Schema.Tuple([PriceListPriceReadInput.fields.filters, PriceListUpdateReadConfig])'],
    ["PriceList Price native add crosswire", 'addPriceListPrices: listPriceCreations ? native.addPriceListPrices.bind(native)', 'addPriceListPrices: listPriceCreations ? native.updatePriceLists.bind(native)'],
    ["PriceList Price native inverse overgrant", 'removePrices: listPriceCreations ? native.removePrices.bind(native) : binding.refuse', 'removePrices: native.removePrices.bind(native)'],
    ["PriceList Price receipt crosswire", 'listPriceCreations ? pricingListPriceCreationPolicy(listPriceContracts)', 'listPriceCreations ? pricingListCreationPolicy(listContracts)'],
    ["PriceList Price raw inverse IDs", 'service.removePrices([...ids], context)', 'service.removePrices([...new Set(ids)], context)'],
    ["PriceList update predicate", 'listUpdates = admission === "price-list-updates"', 'listUpdates = listCreations'],
    ["PriceList update named profile", 'listUpdates ? "pricing-price-list-updates"', 'listUpdates ? "pricing-price-list-creations"'],
    ["PriceList update create overgrant", 'listUpdates ? [listUpdateRead, listUpdate]', 'listUpdates ? [listUpdateRead, listUpdate, createList]'],
    ["PriceList update delete overgrant", 'listUpdates ? [listUpdateRead, listUpdate]', 'listUpdates ? [listUpdateRead, listUpdate, deleteList]'],
    ["PriceList update read crosswire", 'listUpdates ? [listUpdateRead, listUpdate]', 'listUpdates ? [list, listUpdate]'],
    ["PriceList update method overgrant", 'listUpdates ? { listPriceLists: listPriceListsForUpdate, updatePriceLists }', 'listUpdates ? { listPriceLists: listPriceListsForUpdate, updatePriceLists, createPriceLists }'],
    ["PriceList update read native crosswire", 'listPriceLists: listUpdates || listPriceCreations || listPriceUpdates ? native.listPriceLists.bind(native)', 'listPriceLists: listUpdates ? native.listPriceSets.bind(native)'],
    ["PriceList update write native crosswire", 'updatePriceLists: listUpdates ? native.updatePriceLists.bind(native)', 'updatePriceLists: listUpdates ? native.updatePriceSets.bind(native)'],
    ["PriceList update policy crosswire", 'listUpdates ? pricingListUpdatePolicy(listUpdateContracts)', 'listUpdates ? pricingListCreationPolicy(listContracts)'],
    ["PriceList update DML contracts", 'compilePriceListUpdateContracts(metadata.frame)', 'compilePriceListUpdateContracts(otherFrame)'],
    ["PriceList update read decoder", 'prepare(decodePriceListUpdateRead)', 'prepare(decodePriceListUpdate)'],
    ["PriceList update write decoder", 'prepare(decodePriceListUpdate)', 'prepare(decodePriceListCreate)'],
    ["PriceList update sparse output", 'output: listUpdateContracts.decodeUpdateOutput', 'output: listContracts.decodeOutput'],
    ["PriceList update read output", 'output: listUpdateContracts.decodeReadOutput', 'output: listContracts.decodeOutput'],
    ["PriceList update rules-created event", 'objectName: "price_list_rule", action: "created" }),\n        buildModuleResourceEventName({ prefix: Modules.PRICING, objectName: "price_list", action: "updated"', 'objectName: "price_list", action: "created" }),\n        buildModuleResourceEventName({ prefix: Modules.PRICING, objectName: "price_list", action: "updated"'],
    ["admission owner reference", 'PricingRepositoryAdmission = "create"', 'string = "create"'],
    ["old-profile mutability", 'admission === "variant-updates" || admission === "product-updates"', 'admission !== "create"'],
    ["Product lifecycle predicate", 'lifecycle = admission === "product-updates"', 'lifecycle = mutable'],
    ["preference predicate", 'preferences = admission === "price-preferences" || preferenceUpdates', 'preferences = mutable'],
    ["preference update predicate", 'preferenceUpdates = admission === "price-preference-updates"', 'preferenceUpdates = preferences'],
    ["preference DML contracts", 'yield* compilePricePreferenceContracts(metadata.frame)', 'yield* compilePricePreferenceContracts(otherFrame)'],
    ["preference policy construction", 'pricingPreferencePolicy(preferenceContracts)', 'pricingLogicalCreateEventPolicy(preferenceContracts)'],
    ["methods branch predicate", '...(preferences && !preferenceUpdates && !preferenceDeletions ?', '...(mutable ?'],
    ["Store method isolation from native updates", '...(preferences && !preferenceUpdates && !preferenceDeletions ?', '...(preferences ?'],
    ["extra PriceSet method in preference profile", '{ createPricePreferences, listPricePreferences, upsertPricePreferences, deletePricePreferences }', '{ createPricePreferences, listPricePreferences, upsertPricePreferences, deletePricePreferences, createPriceSets }'],
    ["missing required preference creation method", '{ createPricePreferences, listPricePreferences, upsertPricePreferences, deletePricePreferences }', '{ listPricePreferences, upsertPricePreferences, deletePricePreferences }'],
    ["missing required preference inverse", '{ createPricePreferences, listPricePreferences, upsertPricePreferences, deletePricePreferences }', '{ createPricePreferences, listPricePreferences, upsertPricePreferences }'],
    ["method spread override", '{ createPricePreferences, listPricePreferences, upsertPricePreferences, deletePricePreferences }', '{ createPricePreferences, listPricePreferences, upsertPricePreferences, deletePricePreferences, ...override }'],
    ["preference native create refusal", 'createPricePreferences: shipping || preferenceUpdates || preferenceDeletions || listCreations || listUpdates || listDeletions || listPrices ? binding.refuse : native.createPricePreferences.bind(native)', 'createPricePreferences: preferences || shipping ? binding.refuse : native.createPricePreferences.bind(native)'],
    ["Shipping preference native create overgrant", 'createPricePreferences: shipping || preferenceUpdates || preferenceDeletions || listCreations || listUpdates || listDeletions || listPrices ? binding.refuse : native.createPricePreferences.bind(native)', 'createPricePreferences: native.createPricePreferences.bind(native)'],
    ["preference update creation overgrant", 'createPricePreferences: shipping || preferenceUpdates || preferenceDeletions || listCreations || listUpdates || listDeletions || listPrices ? binding.refuse', 'createPricePreferences: shipping ? binding.refuse'],
    ["preference update deletion overgrant", 'deletePricePreferences: preferences && !preferenceUpdates && !preferenceDeletions ?', 'deletePricePreferences: preferences ?'],
    ["preference update native service isolation", 'updatePricePreferences: preferenceUpdates ?', 'updatePricePreferences: preferences ?'],
    ["preference update list method crosswire", 'listPricePreferences: listUpdatePricePreferences', 'listPricePreferences'],
    ["preference update inverse method crosswire", 'upsertPricePreferences: upsertUpdatePricePreferences', 'upsertPricePreferences'],
    ["preference update missing forward method", 'listPricePreferences: listUpdatePricePreferences, updatePricePreferences, upsertPricePreferences: upsertUpdatePricePreferences', 'listPricePreferences: listUpdatePricePreferences, upsertPricePreferences: upsertUpdatePricePreferences'],
    ["preference update method overgrant", 'upsertPricePreferences: upsertUpdatePricePreferences } : {})', 'upsertPricePreferences: upsertUpdatePricePreferences, createPricePreferences } : {})'],
    ["original creation method", '...(!shipping ? { createPriceLists, createPricePreferences } : {})', '...(!shipping ? { createPriceLists } : {})'],
    ["complementary branch predicate", '...(!preferences && !shippingUpdates && !listCreations && !listUpdates && !listDeletions && !listPrices ? { createPriceSets,', '...(preferences ? { createPriceSets,'],
    ["variant method admission", '...(mutable ? { upsertPriceSets, updatePriceSets, listPriceSets } : {})', '...(preferences ? { upsertPriceSets, updatePriceSets, listPriceSets } : {})'],
    ["preference command capability", 'preferences ? [createPreference, preferenceList, preferenceUpsert, preferenceDelete]', 'preferences ? [createPreference, preferenceList, preferenceUpsert, preferenceDelete, create]'],
    ["missing preference creation command", 'preferences ? [createPreference, preferenceList, preferenceUpsert, preferenceDelete]', 'preferences ? [preferenceList, preferenceUpsert, preferenceDelete]'],
    ["repository selection", 'preparePricingRepository(metadata.frame, admission)', 'preparePricingRepository(metadata.frame, "create")'],
    ["missing repository admission", 'preparePricingRepository(metadata.frame, admission)', 'preparePricingRepository(metadata.frame)'],
    ["repository owner import", 'type PricingRepositoryAdmission } from "./repository"', 'type PricingRepositoryAdmission } from "./other-repository"'],
    ["preference graph", 'preferences || listCreations || listUpdates || listDeletions || listPrices ? { aliases: [], reads: [] }', 'preferences ? { aliases: [{ name: "prices", model: "PriceSet" }], reads: [] }'],
    ["preference update graph overgrant", 'preferences || listCreations || listUpdates || listDeletions || listPrices ? { aliases: [], reads: [] }', 'preferences && !preferenceUpdates ? { aliases: [], reads: [] }'],
    ["preference update receipt crosswire", 'preferences ? preferencePolicy : lifecycle ?', 'preferences && !preferenceUpdates ? preferencePolicy : lifecycle ?'],
    ["preference update command overgrant", 'preferenceUpdates ? [preferenceUpdateList, preferenceUpdate, preferenceUpdateUpsert]', 'preferenceUpdates ? [preferenceUpdateList, preferenceUpdate, preferenceUpdateUpsert, preferenceDelete]'],
    ["preference update command crosswire", 'preferenceUpdates ? [preferenceUpdateList, preferenceUpdate, preferenceUpdateUpsert]', 'preferenceUpdates ? [preferenceList, preferenceUpdate, preferenceUpsert]'],
    ["preference update named profile", 'preferenceUpdates ? "pricing-price-preference-updates"', 'preferenceUpdates ? "pricing-price-preferences"'],
    ["preference deletion predicate", 'preferenceDeletions = admission === "price-preference-deletions"', 'preferenceDeletions = preferences'],
    ["preference deletion named profile", 'preferenceDeletions ? "pricing-price-preference-deletions"', 'preferenceDeletions ? "pricing-price-preference-updates"'],
    ["preference deletion command overgrant", 'preferenceDeletions ? [preferenceSoftDelete, preferenceRestore]', 'preferenceDeletions ? [preferenceSoftDelete, preferenceRestore, preferenceDelete]'],
    ["preference deletion missing inverse command", 'preferenceDeletions ? [preferenceSoftDelete, preferenceRestore]', 'preferenceDeletions ? [preferenceSoftDelete]'],
    ["preference deletion method overgrant", '...(preferenceDeletions ? { softDeletePricePreferences, restorePricePreferences } : {})', '...(preferenceDeletions ? { softDeletePricePreferences, restorePricePreferences, deletePricePreferences } : {})'],
    ["preference deletion inverse crosswire", 'restorePricePreferences: preferenceDeletions ? native.restorePricePreferences.bind(native)', 'restorePricePreferences: preferenceDeletions ? native.softDeletePricePreferences.bind(native)'],
    ["preference deletion forward overgrant", 'softDeletePricePreferences: preferenceDeletions ?', 'softDeletePricePreferences: preferences ?'],
    ["preference deletion list overgrant", 'listPricePreferences: preferences && !preferenceDeletions ?', 'listPricePreferences: preferences ?'],
    ["preference deletion upsert overgrant", 'upsertPricePreferences: preferences && !preferenceDeletions ?', 'upsertPricePreferences: preferences ?'],
    ["old create receipt", ': pricingLogicalCreateEventPolicy(preferencePolicy)', ': preferencePolicy'],
    ["named profile identity", 'preferences ? "pricing-price-preferences"', 'preferences ? "pricing-base-prices"'],
    ["Shipping profile capture", 'if (shipping && !shippingUpdates) shippingLifecycleServices.set', 'if (lifecycle || shipping) shippingLifecycleServices.set'],
    ["Shipping restore isolation", 'restorePriceSets: shipping ? native.restorePriceSets.bind(native) : binding.refuse', 'restorePriceSets: lifecycle || shipping ? native.restorePriceSets.bind(native) : binding.refuse'],
    ["Shipping physical delete isolation", 'deletePriceSets: shipping ? native.deletePriceSets.bind(native) : binding.refuse', 'deletePriceSets: mutable || shipping ? native.deletePriceSets.bind(native) : binding.refuse'],
    ["Shipping command selector", 'shipping ? [create, list, count, retrieve, softDeletePriceSetsCommand, restorePriceSetsCommand, deletePriceSetsCommand]', 'shipping ? [create, list, count, retrieve, calculate, softDeletePriceSetsCommand, restorePriceSetsCommand, deletePriceSetsCommand]'],
    ["Shipping method selector", '...(shipping ? { restorePriceSets, deletePriceSets } : {})', '...(shipping ? { restorePriceSets } : {})'],
    ["Shipping receipt policy", 'shipping ? pricingShippingOptionPolicy(preferencePolicy, shippingOutput, shippingUpdates ? shippingMutation : undefined, shippingUpdates ? prepared : undefined)', 'shipping ? preferencePolicy'],
    ["Shipping update predicate", 'shippingUpdates = admission === "shipping-option-updates"', 'shippingUpdates = true'],
    ["Shipping update profile identity", 'shippingUpdates ? "pricing-shipping-option-updates"', 'shippingUpdates ? "pricing-shipping-options"'],
    ["Shipping update creation exclusion", '...(!preferences && !shippingUpdates && !listCreations && !listUpdates && !listDeletions && !listPrices ?', '...(!preferences ?'],
    ["Shipping update lifecycle overgrant", 'createPriceRules: createShippingPriceRules } : {})', 'createPriceRules: createShippingPriceRules, restorePriceSets } : {})'],
    ["Shipping update create overgrant", 'createPriceRules: createShippingPriceRules } : {})', 'createPriceRules: createShippingPriceRules, createPriceSets } : {})'],
    ["Shipping update method override", 'updatePriceSets: updateShippingPriceSets', 'updatePriceSets'],
    ["Shipping update command overgrant", '[shippingUpdate, shippingListPrices, shippingListRules, shippingCreateRules, list, count, retrieve]', '[shippingUpdate, shippingListPrices, shippingListRules, shippingCreateRules, upsert, list, count, retrieve]'],
    ["Shipping update native service overgrant", 'listPriceRules: shippingUpdates ? native.listPriceRules.bind(native) : binding.refuse', 'listPriceRules: shipping ? native.listPriceRules.bind(native) : binding.refuse'],
    ["Shipping update mutation proof bypass", 'shippingUpdates ? shippingMutation : undefined, shippingUpdates ? prepared : undefined', 'undefined, shippingUpdates ? prepared : undefined'],
    ["Shipping update causal proof bypass", 'shippingUpdates ? shippingMutation : undefined, shippingUpdates ? prepared : undefined', 'shippingUpdates ? shippingMutation : undefined, undefined'],
    ["Shipping update lifecycle router exposure", 'if (shipping && !shippingUpdates) shippingLifecycleServices.set', 'if (shipping) shippingLifecycleServices.set'],
    ["PriceList predicate", 'listCreations = admission === "price-list-creations"', 'listCreations = !preferences'],
    ["PriceList named profile", 'listCreations ? "pricing-price-list-creations"', 'listCreations ? "pricing-base-prices"'],
    ["PriceList command read overgrant", 'listCreations ? [createList, deleteList]', 'listCreations ? [createList, deleteList, list]'],
    ["PriceList command create overgrant", 'listCreations ? [createList, deleteList]', 'listCreations ? [createList, deleteList, create]'],
    ["PriceList command inverse removal", 'listCreations ? [createList, deleteList]', 'listCreations ? [createList]'],
    ["PriceList method upsert overgrant", '...(listCreations ? { createPriceLists, deletePriceLists } : {})', '...(listCreations ? { createPriceLists, deletePriceLists, upsertPriceSets } : {})'],
    ["PriceList method read overgrant", '...(listCreations ? { createPriceLists, deletePriceLists } : {})', '...(listCreations ? { createPriceLists, deletePriceLists, listPriceSets } : {})'],
    ["PriceList repository overgrant", 'listCreations || listUpdates || listDeletions ? model === PriceList ? bound.listRepository : bound.denied', 'listCreations ? bound.repository'],
    ["PriceList physical inverse overgrant", 'deletePriceLists: listCreations ? native.deletePriceLists.bind(native) : binding.refuse', 'deletePriceLists: native.deletePriceLists.bind(native)'],
    ["PriceList graph overgrant", 'preferences || listCreations || listUpdates || listDeletions || listPrices ? { aliases: [], reads: [] }', 'preferences ? { aliases: [], reads: [] }'],
    ["PriceList DML contracts", 'compilePriceListCreationContracts(metadata.frame)', 'compilePriceListCreationContracts(otherFrame)'],
    ["PriceList complete output crosswire", 'output: listContracts.decodeOutput', 'output: preferenceContracts.decodeOutput'],
    ["PriceList complete receipt bypass", 'listCreations ? pricingListCreationPolicy(listContracts)', 'listCreations ? existingPolicy'],
    ["PriceList standalone policy crosswire", 'listCreations ? pricingListCreationPolicy(listContracts)', 'listCreations ? pricingListCreationPolicy(listContracts, existingPolicy)'],
    ["old Pricing policy and insertion authority", 'pricingListCreationPolicy(listContracts, existingPolicy)', 'pricingListCreationPolicy(listContracts)'],
    ["PriceList inverse command crosswire", 'commands.write("pricingDeleteList", prepare(decodePriceListDeletionIds)', 'commands.write("pricingDeleteList", prepare(decodePriceListCreate)'],
    ["PriceList inverse callback crosswire", 'await service.deletePriceLists([...ids], context)', 'await service.deletePriceSets([...ids], context)'],
  ])("rejects changed %s", (_name, before, after) => {
    const changed = adapter.replace(before, after); expect(changed).not.toBe(adapter);
    expect(() => verifyPricingWorkflowSelection(native, changed, repository)).toThrow("Unadmitted native Pricing workflow selection");
  });
  it("rejects a second workflow registration", () => {
    expect(() => verifyPricingWorkflowSelection(native, adapter + "\ndefineWorkflowModule({});", repository))
      .toThrow("Unadmitted native Pricing workflow selection");
  });
  it("rejects a missing native preference method", () => {
    const changed = native.replace("deletePricePreferences(ids:", "deleteOtherPreferences(ids:"); expect(changed).not.toBe(native);
    expect(() => verifyPricingWorkflowSelection(changed, adapter, repository)).toThrow("Missing native Pricing admitted methods");
  });
  it.each(["updatePriceSets", "listPrices", "listPriceRules", "createPriceRules", "updatePricePreferences", "softDeletePricePreferences", "restorePricePreferences", "deletePriceLists", "softDeletePriceLists", "restorePriceLists", "listPriceLists", "updatePriceLists", "addPriceListPrices", "removePrices"])("requires native %s for the selected update profiles", method => {
    const changed = native.replace(new RegExp("\\b" + method + "(?=\\s*[<(])", "g"), method + "Unadmitted");
    expect(changed).not.toBe(native);
    expect(() => verifyPricingWorkflowSelection(changed, adapter, repository)).toThrow("Missing native Pricing admitted methods");
  });
  it("rejects widening the original Product preference lookup beyond two pairs", () => {
    const before = "Schema.Array(Schema.Struct({ attribute: Schema.String, value: Schema.String })).check(Schema.isMaxLength(2))";
    const changed = repository.replace(before, before.replace("isMaxLength(2)", "isMaxLength(4)")); expect(changed).not.toBe(repository);
    expect(() => verifyPricingWorkflowSelection(native, adapter, changed)).toThrow("Changed existing Pricing preference lookup admission");
  });
  it.each([
    ["PriceList Price candidate read", 'readPriceListPriceCandidates(ctx, listPrice.contracts, captured)', 'readPriceListPriceCandidates(ctx, listPrice.contracts, [])'],
    ["PriceList Price List borrowed queue", 'listPrice !== undefined ? (input, shared) => bridge.executeInput(shared, input, (ctx, captured)', 'listPrice !== undefined ? (input, shared) => bridge.execute(shared, (ctx, captured)'],
    ["PriceList Price candidate borrowed queue", 'find: (input, shared) => bridge.executeInput(shared, input, (ctx, captured)', 'find: (input, shared) => bridge.execute(shared, (ctx, captured)'],
    ["PriceList Price List captured operand", 'readPriceListUpdateRows(ctx, listPrice.contracts.listReadContracts, captured)', 'readPriceListUpdateRows(ctx, listPrice.contracts.listReadContracts, input)'],
    ["PriceList Price candidate captured operand", 'readPriceListPriceCandidates(ctx, listPrice.contracts, captured)', 'readPriceListPriceCandidates(ctx, listPrice.contracts, input)'],
    ["PriceList Price replacement config", 'listPrice.replace(ctx, captured, config)', 'listPrice.replace(ctx, captured, {})'],
    ["PriceList Price physical inverse roots", 'deletePricingPriceRows(ctx, listPrice.root, listPrice.rule, selected, ctx.resources.queryRows, "storageInsertion")', 'deletePricingPriceRows(ctx, listPrice.root, listPrice.rule, [], ctx.resources.queryRows, "storageInsertion")'],
    ["PriceList Price scoped inverse ordering", 'deletePricingPriceRows(ctx, listPrice.root, listPrice.rule, selected, ctx.resources.queryRows, "storageInsertion")', 'deletePricingPriceRows(ctx, listPrice.root, listPrice.rule, selected, ctx.resources.queryRows)'],
    ["PriceList update predicate", 'const listUpdates = admission === "price-list-updates"', 'const listUpdates = true'],
    ["PriceList update contracts", 'compilePriceListUpdateContracts(metadata)', 'compilePriceListUpdateContracts(otherMetadata)'],
    ["PriceList update replacement", 'preparePriceListUpdateReplacement(contracts)', 'preparePriceListUpdateReplacement(otherContracts)'],
    ["PriceList update creation overgrant", 'create: listUpdates || listDeletions || listPriceCreations || listPriceUpdates || listPriceRemovals ? refuse :', 'create: false ? refuse :'],
    ["PriceList update read contract", 'readPriceListUpdateRows(ctx, listUpdate.contracts, input)', 'readPriceListUpdateRows(ctx, otherContracts, input)'],
    ["PriceList update replacement config", 'listUpdate.replace(ctx, input, config)', 'listUpdate.replace(ctx, input, {})'],
    ["shared admission union", '"price-list-creations" | "price-list-updates" | "price-list-deletions" | "price-list-price-creations" | "price-list-price-updates" | "price-list-price-removals" | "shipping-options"', '"price-list-creations" | "price-list-updates" | "price-list-deletions" | "price-list-price-creations" | "price-list-price-updates" | "unbounded" | "shipping-options"'],
    ["preference mode", 'preferenceDeletions ? "deletions" : preferenceUpdates ? "updates" : "store"', 'preferenceDeletions ? "updates" : preferenceUpdates ? "deletions" : "store"'],
    ["PriceList repository inverse overgrant", 'delete: listCreations ?', 'delete: !preferences ?'],
    ["PriceList repository inverse crosswire", 'deletePricingPriceLists(ctx, metadata, input)', 'softDeletePricingPriceSets(ctx, metadata, input)'],
  ])("rejects changed repository %s", (_name, before, after) => {
    const changed = repository.replace(before, after); expect(changed).not.toBe(repository);
    expect(() => verifyPricingWorkflowSelection(native, adapter, changed)).toThrow("Unadmitted native Pricing workflow selection");
  });
});

describe("native Store creation callback provenance", () => {
  const paths = ["store/workflows/create-stores.ts", "store/steps/create-stores.ts", "pricing/steps/update-price-preferences-as-array.ts"];
  const native = paths.map(file => readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/" + file, "utf8"));
  const promoted = paths.map(file => readFileSync("packages/medusa-core-flows/src/" + file, "utf8"));
  const verify = (workflow = promoted[0], store = promoted[1], preferences = promoted[2]) =>
    verifyStoreCreateCallbacks(native[0], workflow, native[1], store, native[2], preferences);
  it("admits only portable/direct imports, erased annotations and covered metadata", () => {
    expect(() => verify()).not.toThrow();
  });
  it.each([
    ["root ID", '"create-stores"', '"create-other-stores"'],
    ["Store input iteration order", "data.input.stores.map((store)", "[...data.input.stores].reverse().map((store)"],
    ["Store currency tax isolation", "currency_code: currency.currency_code,", "currency_code: currency.currency_code, is_tax_inclusive: currency.is_tax_inclusive,"],
    ["raw Map key", "toUpsert.set(currency.currency_code,", "toUpsert.set(currency.currency_code.toLowerCase(),"],
    ["Map last value", "toUpsert.set(currency.currency_code,", "if (!toUpsert.has(currency.currency_code)) toUpsert.set(currency.currency_code,"],
    ["first-key output order", "Array.from(toUpsert.values())", "Array.from(toUpsert.values()).reverse()"],
    ["original input preference traversal", "data.input.stores.forEach((store)", ";[...data.input.stores].reverse().forEach((store)"],
    ["raw Pricing value", "value: currency.currency_code,", "value: currency.currency_code.toLowerCase(),"],
    ["tax flag omission", "is_tax_inclusive: currency.is_tax_inclusive,", "is_tax_inclusive: currency.is_tax_inclusive ?? false,"],
    ["unconditional Pricing call", "updatePricePreferencesAsArrayStep(upsertPricePreferences)", "updatePricePreferencesAsArrayStep([])"],
    ["Store result", "new WorkflowResponse(stores)", "new WorkflowResponse(input.stores)"],
    ["selected import", 'from "../steps/create-stores"', 'from "../steps"'],
    ["extra query/event side effect", "return new WorkflowResponse(stores)", 'container.resolve("query"); return new WorkflowResponse(stores)'],
  ])("rejects changed native %s", (_name, before, after) => {
    const changed = promoted[0].replace(before, after); expect(changed).not.toBe(promoted[0]);
    expect(() => verify(changed)).toThrow("Changed native Store creation callback behavior");
  });
  it("rejects moving Store creation after Pricing mutation", () => {
    const changed = promoted[0].replace("    const stores = createStoresStep(normalizedInput)\n", "")
      .replace("    return new WorkflowResponse(stores)", "    const stores = createStoresStep(normalizedInput)\n    return new WorkflowResponse(stores)");
    expect(changed).not.toBe(promoted[0]);
    expect(() => verify(changed)).toThrow("Changed native Store creation callback behavior");
  });
  it.each([
    ["Store step ID", '"create-stores"', '"create-other-stores"'],
    ["Store inverse policy", 'compensation: "transactionCovered"', 'compensation: "none"'],
    ["Store empty forward invocation", "service.createStores(data)", "service.createStores(data.length ? data : [{}])"],
    ["returned ID order", "created.map((store) => store.id)", "created.map((store) => store.id).reverse()"],
    ["full Store result", "      created,", "      [],"],
    ["Store inverse empty guard", "if (!createdIds?.length)", "if (!createdIds)"],
    ["Store physical inverse", "deleteStores(createdIds)", "softDeleteStores(createdIds)"],
  ])("rejects changed native %s", (_name, before, after) => {
    const changed = promoted[1].replace(before, after); expect(changed).not.toBe(promoted[1]);
    expect(() => verify(promoted[0], changed)).toThrow("Changed native Store creation callback behavior");
  });
  it.each([
    ["Pricing step ID", '"update-price-preferences-as-array"', '"update-other-preferences"'],
    ["Pricing inverse policy", 'compensation: "transactionCovered"', 'compensation: "none"'],
    ["Pricing empty condition", "if (!input.length)", "if (!input)"],
    ["Pricing empty captured input", "new StepResponse([], { prevData: [], newDataIds: [] })", "new StepResponse([])"],
    ["Pricing lookup operator", "$or: input.map", "$and: input.map"],
    ["attribute/value refusal", "if (!entry.attribute || !entry.value)", "if (!entry.attribute && !entry.value)"],
    ["pair identity", "prevEntry.attribute === entry.attribute &&", "prevEntry.attribute === entry.attribute ||"],
    ["existing preference ID", "id: prevEntry?.id,", "id: undefined,"],
    ["false flag preservation", "entry.is_tax_inclusive ?? prevEntry?.is_tax_inclusive", "entry.is_tax_inclusive || prevEntry?.is_tax_inclusive"],
    ["native upsert method", "service.upsertPricePreferences(", "service.createPricePreferences("],
    ["new identity difference", "prevData.map((p) => p.id)", "[]"],
    ["full Pricing result", "new StepResponse(upsertedPricePreferences,", "new StepResponse(input,"],
    ["full Pricing preimages", "      prevData,", "      prevData: [],"],
    ["Pricing grouped-empty inverse", "if (!compensationData)", "if (!compensationData || !compensationData.prevData.length)"],
    ["Pricing restore preimages", "upsertPricePreferences(compensationData.prevData)", "upsertPricePreferences([])"],
    ["Pricing inverse delete IDs", "deletePricePreferences(compensationData.newDataIds)", "deletePricePreferences([])"],
    ["portable utility import", 'from "@medusajs/framework/utils/portable"', 'from "@medusajs/framework/utils"'],
  ])("rejects changed native %s", (_name, before, after) => {
    const changed = promoted[2].replace(before, after); expect(changed).not.toBe(promoted[2]);
    expect(() => verify(promoted[0], promoted[1], changed)).toThrow("Changed native Store creation callback behavior");
  });
  it("rejects moving Pricing resolution after its empty branch", () => {
    const line = "    const service = container.resolve<IPricingModuleService>(Modules.PRICING)";
    const changed = promoted[2].replace(line, "").replace("    const prevData =", line + "\n    const prevData =");
    expect(changed).not.toBe(promoted[2]);
    expect(() => verify(promoted[0], promoted[1], changed)).toThrow("Changed native Store creation callback behavior");
  });
  it("rejects deleting new Pricing rows before restoring prior rows", () => {
    const changed = promoted[2].replace("    await service.upsertPricePreferences(compensationData.prevData)", "")
      .replace("    await service.deletePricePreferences(compensationData.newDataIds)",
        "    await service.deletePricePreferences(compensationData.newDataIds)\n    await service.upsertPricePreferences(compensationData.prevData)");
    expect(changed).not.toBe(promoted[2]);
    expect(() => verify(promoted[0], promoted[1], changed)).toThrow("Changed native Store creation callback behavior");
  });
});

describe("selected native Store creation type provenance", () => {
  const paths = ["workflow/store/index.ts", "workflow/pricing/index.ts", "http/store/admin/payloads.ts"];
  const native = paths.map(file => readFileSync("third_party/medusa/upstream/packages/core/types/src/" + file, "utf8"));
  const promoted = paths.map(file => readFileSync("packages/medusa-types/src/" + file, "utf8"));
  const verify = (store = promoted[0], pricing = promoted[1], payload = promoted[2]) =>
    verifyStoreCreationTypes(native[0], store, native[1], pricing, native[2], payload);
  it("retains complete native types after only the direct type-only HTTP import seam", () => {
    expect(() => verify()).not.toThrow();
  });
  it.each([
    [0, "required currency array", "supported_currencies: {", "supported_currencies?: {"],
    [0, "workflow currency flag", "is_tax_inclusive?: boolean", "is_tax_inclusive?: string"],
    [0, "direct HTTP type closure", '../../http/store/admin/payloads', '../../http'],
    [1, "nullable preference attribute", "attribute?: string | null", "attribute?: string"],
    [2, "nullable default channel", "default_sales_channel_id?: string | null", "default_sales_channel_id?: string"],
  ])("rejects changed native %s %s", (index, _name, before, after) => {
    const changed = promoted[index].replace(before, after); expect(changed).not.toBe(promoted[index]);
    const values = [...promoted]; values[index] = changed;
    expect(() => verify(...values)).toThrow("Changed native Store creation type contract");
  });
});
describe("native Store creation erased boundary type provenance", () => {
  it.each([
    ["packages/medusa-types/src/store/mutations/store.ts", "packages/core/types/src/store/mutations/store.ts"],
    ["packages/medusa-types/src/pricing/common/price-preference.ts", "packages/core/types/src/pricing/common/price-preference.ts"],
    ["packages/medusa-types/src/workflow/pricing/index.ts", "packages/core/types/src/workflow/pricing/index.ts"],
  ])("retains exact emitted JavaScript and only the explicit undefined seam: %s", (target, source) => {
    const original = readFileSync("third_party/medusa/upstream/" + source, "utf8"), adapted = readFileSync(target, "utf8");
    expect(() => verifyModuleTypeFork(original, adapted)).not.toThrow();
    expect(() => verifyStoreCreationTypeFork(original, adapted, target)).not.toThrow();
    const changed = adapted.replace("| undefined", "| number"); expect(changed).not.toBe(adapted);
    expect(() => verifyStoreCreationTypeFork(original, changed, target)).toThrow("Changed native Store creation erased type seam");
    expect(() => verifyStoreCreationTypeFork(original, adapted + "\nexport const runtimeDrift = true;\n", target))
      .toThrow("Module type adaptation changes runtime behavior");
  });
  it("refuses type adaptation classification on another package file", () => {
    expect(() => verifyCurrencyPromotion(root, { ...promotion, files: promotion.files.map(file =>
      file.target === source ? { ...file, classification: "storeCreationTypeFork" } : file) }))
      .toThrow("Store creation type adaptation outside its approved source files");
  });
});

describe("native Store normalizer visibility provenance", () => {
  const native = readFileSync("third_party/medusa/upstream/packages/modules/store/src/services/store-module-service.ts", "utf8");
  const target = "packages/medusa-store/src/services/store-module-service.ts";
  const adapted = readFileSync(target, "utf8");
  it("permits only public visibility of the existing pure normalizer with identical emitted JavaScript", () => {
    expect(() => verifyModuleTypeFork(native, adapted)).not.toThrow();
    expect(() => verifyStoreTypeFork(native, adapted)).not.toThrow();
  });
  it("limits the new classification to the sole approved Store service source", () => {
    expect(() => verifyCurrencyPromotion(root, { ...promotion, files: promotion.files.map(file =>
      file.target === source ? { ...file, classification: "storeTypeFork" } : file) }))
      .toThrow("Store type adaptation outside its approved source file");
  });
  it.each([
    ["still-private normalizer", "  static normalizeInput<", "  private static normalizeInput<"],
    ["additional validation visibility", "private static validateCreateRequest(", "static validateCreateRequest("],
    ["additional repository visibility", "protected baseRepository_:", "public baseRepository_:"],
    ["normalizer return type", "  ): T[] {", "  ): readonly T[] {"],
    ["currency normalization body", "currency_code: c.currency_code.toLowerCase()", "currency_code: c.currency_code"],
    ["name normalization body", "name: store.name?.trim()", "name: store.name"],
    ["create validation body", "let seenDefault = false", "let seenDefault = true"],
    ["native normalizer call site", "StoreModuleService.normalizeInput(data)", "StoreModuleService.normalizeInput([])"],
    ["portable utility import", 'from "@medusajs/framework/utils/portable"', 'from "@medusajs/framework/utils"'],
  ])("rejects changed %s", (_name, before, after) => {
    const changed = adapted.replace(before, after); expect(changed).not.toBe(adapted);
    expect(() => verifyStoreTypeFork(native, changed)).toThrow();
  });
});
describe("native Store deletion callback provenance", () => {
  const nativeWorkflow = readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/store/workflows/delete-stores.ts", "utf8");
  const workflow = readFileSync("packages/medusa-core-flows/src/store/workflows/delete-stores.ts", "utf8");
  const nativeStep = readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/store/steps/delete-stores.ts", "utf8");
  const step = readFileSync("packages/medusa-core-flows/src/store/steps/delete-stores.ts", "utf8");
  const nativeLink = readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/common/steps/remove-remote-links.ts", "utf8");
  const link = readFileSync("packages/medusa-core-flows/src/common/steps/remove-remote-links.ts", "utf8");
  it("admits only portable imports, the exact response wrapper and covered metadata", () => {
    expect(() => verifyStoreDeleteCallbacks(nativeWorkflow, workflow, nativeStep, step, nativeLink, link)).not.toThrow();
  });
  it.each([
    ["root identity", '"delete-stores"', '"delete-other-stores"'],
    ["raw Store IDs", "deleteStoresStep(input.ids)", "deleteStoresStep([...new Set(input.ids)])"],
    ["raw Link IDs", "store_id: input.ids", "store_id: []"],
    ["Store endpoint", "[Modules.STORE]", "[Modules.PRODUCT]"],
    ["root result", "new WorkflowResponse(deletedStores)", "new WorkflowResponse(input.ids)"],
    ["exact return wrapper", "new WorkflowResponse(deletedStores)", "new WorkflowResponse(void 0)"],
    ["portable dependency", 'from "@medusajs/framework/utils/portable"', 'from "@medusajs/framework/utils"'],
    ["foreign extra side effect", "return new WorkflowResponse(deletedStores)", "console.log(input); return new WorkflowResponse(deletedStores)"],
    ["native callback order", "const deletedStores = deleteStoresStep(input.ids)", "const deletedStores = deleteStoresStep(input.ids); deleteStoresStep(input.ids)"],
  ])("rejects changed native %s", (_name, before, after) => {
    const changed = workflow.replace(before, after); expect(changed).not.toBe(workflow);
    expect(() => verifyStoreDeleteCallbacks(nativeWorkflow, changed, nativeStep, step, nativeLink, link))
      .toThrow("Changed native Store deletion callback behavior");
  });
  it("rejects moving Link removal before Store deletion", () => {
    const changed = workflow.replace("    const deletedStores = deleteStoresStep(input.ids)\n", "")
      .replace("    return new WorkflowResponse(deletedStores)", "    const deletedStores = deleteStoresStep(input.ids)\n    return new WorkflowResponse(deletedStores)");
    expect(changed).not.toBe(workflow);
    expect(() => verifyStoreDeleteCallbacks(nativeWorkflow, changed, nativeStep, step, nativeLink, link))
      .toThrow("Changed native Store deletion callback behavior");
  });
  it.each([
    ["step identity", '"delete-stores"', '"delete-other-stores"'],
    ["covered inverse policy", 'compensation: "transactionCovered"', 'compensation: "none"'],
    ["native empty call", "await storeModule.softDeleteStores(ids)", "if (ids.length) await storeModule.softDeleteStores(ids)"],
    ["raw duplicate identities", "softDeleteStores(ids)", "softDeleteStores([...new Set(ids)])"],
    ["native lifecycle method", "softDeleteStores(ids)", "deleteStores(ids)"],
    ["void output", "new StepResponse(void 0, ids)", "new StepResponse(ids, ids)"],
    ["inverse input", "new StepResponse(void 0, ids)", "new StepResponse(void 0, [])"],
    ["inverse empty guard", "if (!idsToRestore?.length)", "if (!idsToRestore)"],
    ["native inverse call", "restoreStores(idsToRestore)", "restoreStores([])"],
  ])("rejects changed native %s", (_name, before, after) => {
    const changed = step.replace(before, after); expect(changed).not.toBe(step);
    expect(() => verifyStoreDeleteCallbacks(nativeWorkflow, workflow, nativeStep, changed, nativeLink, link))
      .toThrow("Changed native Store deletion callback behavior");
  });
  it.each([
    ["Link identity", '"remove-remote-links"', '"remove-other-links"'],
    ["Link inverse policy", 'compensation: "transactionCovered"', 'compensation: "none"'],
    ["Link grouped empty call", "await link.delete(grouped)", "if (Object.keys(grouped).length) await link.delete(grouped)"],
    ["Link raw grouping order", "currentKeys.concat(incomingKeys)", "incomingKeys.concat(currentKeys)"],
    ["Link inverse payload", "new StepResponse(grouped, grouped)", "new StepResponse(grouped, {})"],
    ["Link grouped empty inverse", "if (!removedLinks)", "if (!removedLinks || !Object.keys(removedLinks).length)"],
    ["Link restore call", "await link.restore(removedLinks)", "await link.restore({})"],
  ])("rejects changed native %s", (_name, before, after) => {
    const changed = link.replace(before, after); expect(changed).not.toBe(link);
    expect(() => verifyStoreDeleteCallbacks(nativeWorkflow, workflow, nativeStep, step, nativeLink, changed))
      .toThrow("Changed native Store deletion callback behavior");
  });
});
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

describe("native Inventory Item creation callback provenance", () => {
  const names = ["inventory/workflows/create-inventory-items.ts", "inventory/steps/create-inventory-items.ts", "inventory/workflows/create-inventory-levels.ts", "inventory/steps/create-inventory-levels.ts", "inventory/steps/validate-inventory-locations.ts"];
  const originals = names.map(name => readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/" + name, "utf8"));
  const promoted = names.map(name => readFileSync("packages/medusa-core-flows/src/" + name, "utf8"));
  const verify = (selected = promoted) => verifyInventoryItemCreateCallbacks(originals[0], selected[0], originals[1], selected[1], originals[2], selected[2], originals[3], selected[3], originals[4], selected[4]);
  it("permits only erased types and the two exact existing portable seams", () => { expect(() => verify()).not.toThrow(); });
  it.each([
    [0, "missing items fallback", "data.items = data.items ?? []", "data.items = []"],
    [0, "ordinal mapping", "locationLevelMap[index] =", "locationLevelMap[0] ="],
    [0, "nested array order", "location_levels?.length ? location_levels : []", "location_levels?.length ? [...location_levels].reverse() : []"],
    [0, "Item association order", "data.items.forEach((item, index)", "data.items.reverse().forEach((item, index)"],
    [0, "foreign Item identity precedence", "inventory_item_id: item.id", "inventory_item_id: locationLevel.inventory_item_id"],
    [0, "empty Level child skip", "createInventoryLevelsWorkflow.runAsStep({ input: inventoryLevelsInput.input })", "if (items.length) createInventoryLevelsWorkflow.runAsStep({ input: inventoryLevelsInput.input })"],
    [0, "child seam input", "input: inventoryLevelsInput.input", "input: {}"],
    [0, "returned Item array", "new WorkflowResponse(items)", "new WorkflowResponse([])"],
    [0, "root binding identity", "  createInventoryItemsWorkflowId,", "  differentWorkflowId,"],
    [0, "root identity", '"create-inventory-items-workflow"', '"create-different-items-workflow"'],
    [1, "empty Item invocation", "await inventoryService.createInventoryItems(data)", "data.length ? await inventoryService.createInventoryItems(data) : []"],
    [1, "captured generated Item IDs", "createdItems.map((i) => i.id)", "[]"],
    [1, "Item inverse empty resolution", "if (!data?.length)", "if (!data)"],
    [1, "Item inverse physical method", "deleteInventoryItems(data)", "softDeleteInventoryItems(data)"],
    [1, "Item inverse identities", "deleteInventoryItems(data)", "deleteInventoryItems([])"],
    [1, "Item retained compensation", 'compensation: "transactionCovered"', 'compensation: undefined'],
    [2, "Level guard ordering", "validateInventoryLocationsStep(input.inventory_levels)", "validateInventoryLocationsStep([])"],
    [2, "Level native data", "createInventoryLevelsStep(input.inventory_levels)", "createInventoryLevelsStep([])"],
    [3, "empty Level invocation", "await service.createInventoryLevels(data)", "data.length ? await service.createInventoryLevels(data) : []"],
    [3, "Level inverse identities", "inventoryLevels.map((level) => level.id)", "[]"],
    [3, "Level inverse physical method", "deleteInventoryLevels(ids)", "softDeleteInventoryLevels(ids)"],
    [3, "Level inverse empty resolution", "if (!ids?.length)", "if (!ids)"],
    [4, "Stock query raw IDs", "id: data.map((d) => d.location_id)", "id: []"],
    [4, "Stock query projection", 'fields: ["id"]', 'fields: ["name"]'],
    [4, "complete Stock count", "metadata.count !== stockLocations.length", "metadata.count < stockLocations.length"],
    [4, "Stock offset", "metadata.skip !== 0", "metadata.skip < 0"],
    [4, "bounded Stock page", "take: query.maxPageSize", "take: 1"],
    [4, "missing Location ordering", 'diff.join(", ")', 'diff.reverse().join(", ")'],
    [4, "missing Location guard", "if (diff.length > 0)", "if (false)"],
  ])("rejects changed native %s / %s", (index, _name, before, after) => {
    const selected = [...promoted], changed = selected[index].replace(before, after); expect(changed).not.toBe(selected[index]); selected[index] = changed;
    expect(() => verify(selected)).toThrow("Changed native Inventory Item creation callback behavior");
  });
});

describe("exact Currency promotion", () => {
  it("authenticates source, transformed inputs, package exports, and available build outputs", () => {
    expect(promotion.packages).toHaveLength(25);
    expect(promotion.packages.some((pkg) => pkg.path === "packages/medusa-locking")).toBe(true);
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
    ["misclassified Inventory adaptation", { ...promotion, files: promotion.files.map((file) => file.target === source ? { ...file, classification: "inventoryServiceFork" } : file) }],
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

describe("native Reservation Line Item deletion callback provenance", () => {
  const paths = ["reservation/workflows/delete-reservations-by-line-items.ts", "reservation/steps/delete-reservations-by-line-items.ts"];
  const native = paths.map(file => readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/" + file, "utf8").replace(/\r\n/g, "\n"));
  const promoted = paths.map(file => readFileSync("packages/medusa-core-flows/src/" + file, "utf8").replace(/\r\n/g, "\n"));
  const verify = (workflow = promoted[0], step = promoted[1]) =>
    verifyReservationLineItemDeletionCallbacks(native[0], workflow, native[1], step);
  it("admits the exact complete native runtime with only recorded portable seams", () => {
    expect(() => verify()).not.toThrow();
    expect(() => verify(promoted[0].replace("input: WorkflowData<DeleteReservationByLineItemsWorkflowInput>", "input: WorkflowData<DeleteReservationByLineItemsWorkflowInput> /* erased */"))).not.toThrow();
  });
  it.each([
    ["root ID", '"delete-reservations-by-line-items"', '"delete-other-reservations"'],
    ["selected step import", 'from "../steps/delete-reservations-by-line-items"', 'from "../steps"'],
    ["raw ID order", "deleteReservationsByLineItemsStep(input.ids)", "deleteReservationsByLineItemsStep([...input.ids].reverse())"],
    ["duplicate raw IDs", "deleteReservationsByLineItemsStep(input.ids)", "deleteReservationsByLineItemsStep([...new Set(input.ids)])"],
    ["required empty forward call", "deleteReservationsByLineItemsStep(input.ids)", "input.ids.length ? deleteReservationsByLineItemsStep(input.ids) : undefined"],
    ["response wrapper", "return new WorkflowResponse(deleteReservationsByLineItemsStep(input.ids))", "return deleteReservationsByLineItemsStep(input.ids)"],
    ["extra root effect", "return new WorkflowResponse(", 'container.resolve("query"); return new WorkflowResponse('],
    ["extra module import", 'from "@medusajs/workflows-sdk"', 'from "@medusajs/workflows-sdk"; import "node:fs"'],
  ])("rejects changed native %s", (_name, before, after) => {
    const changed = promoted[0].replace(before, after); expect(changed).not.toBe(promoted[0]);
    expect(() => verify(changed)).toThrow("Changed native Reservation Line Item deletion callback behavior");
  });
  it.each([
    ["step ID", '"delete-reservations-by-line-items"', '"delete-other-reservations"'],
    ["covered metadata", 'compensation: "transactionCovered"', 'compensation: "none"'],
    ["Inventory resolution", "Modules.INVENTORY", "Modules.ORDER"],
    ["forward native method", "deleteReservationItemsByLineItem(ids)", "softDeleteReservationItems(ids)"],
    ["forward ordered raw selectors", "deleteReservationItemsByLineItem(ids)", "deleteReservationItemsByLineItem([...ids].sort())"],
    ["forward required empty invocation", "await service.deleteReservationItemsByLineItem(ids)", "if (ids.length) await service.deleteReservationItemsByLineItem(ids)"],
    ["void native result", "new StepResponse(void 0, ids)", "new StepResponse(null, ids)"],
    ["retained inverse selectors", "new StepResponse(void 0, ids)", "new StepResponse(void 0, [...new Set(ids)])"],
    ["empty inverse skip", "if (!prevIds?.length)", "if (!prevIds)"],
    ["inverse native method", "restoreReservationItemsByLineItem(prevIds)", "restoreReservationItems(prevIds)"],
    ["inverse raw selectors", "restoreReservationItemsByLineItem(prevIds)", "restoreReservationItemsByLineItem([...prevIds].reverse())"],
    ["portable utility import", 'from "@medusajs/framework/utils/portable"', 'from "@medusajs/framework/utils"'],
    ["extra unused-result statement", "    await service.deleteReservationItemsByLineItem(ids)", "    void service; await service.deleteReservationItemsByLineItem(ids)"],
  ])("rejects changed native %s", (_name, before, after) => {
    const changed = promoted[1].replace(before, after); expect(changed).not.toBe(promoted[1]);
    expect(() => verify(promoted[0], changed)).toThrow("Changed native Reservation Line Item deletion callback behavior");
  });
  it("rejects moving Inventory resolution before the empty inverse guard", () => {
    const before = '    if (!prevIds?.length) {\n      return\n    }\n\n    const service = container.resolve<IInventoryService>(Modules.INVENTORY)';
    const after = '    const service = container.resolve<IInventoryService>(Modules.INVENTORY)\n\n    if (!prevIds?.length) {\n      return\n    }';
    const changed = promoted[1].replace(before, after); expect(changed).not.toBe(promoted[1]);
    expect(() => verify(promoted[0], changed)).toThrow("Changed native Reservation Line Item deletion callback behavior");
  });
  it("rejects moving the forward response before deletion", () => {
    const before = "    await service.deleteReservationItemsByLineItem(ids)\n\n    return new StepResponse(void 0, ids)";
    const after = "    return new StepResponse(void 0, ids)\n    await service.deleteReservationItemsByLineItem(ids)";
    const changed = promoted[1].replace(before, after); expect(changed).not.toBe(promoted[1]);
    expect(() => verify(promoted[0], changed)).toThrow("Changed native Reservation Line Item deletion callback behavior");
  });
  it("rejects a syntactically invalid mutation", () => {
    const changed = promoted[1].replace("return new StepResponse(void 0, ids)", "return new StepResponse(");
    expect(changed).not.toBe(promoted[1]);
    expect(() => verify(promoted[0], changed)).toThrow("Invalid native Reservation Line Item callback syntax");
  });
});


describe("native Store update callback provenance", () => {
  const paths = ["store/workflows/update-stores.ts", "store/steps/update-stores.ts"];
  const native = paths.map(file => readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/" + file, "utf8").replace(/\r\n/g, "\n"));
  const promoted = paths.map(file => readFileSync("packages/medusa-core-flows/src/" + file, "utf8").replace(/\r\n/g, "\n"));
  const verify = (workflow = promoted[0], step = promoted[1]) => verifyStoreUpdateCallbacks(native[0], workflow, native[1], step);
  it("admits only the complete native runtime and erased annotations", () => {
    expect(() => verify()).not.toThrow();
    expect(() => verify(promoted[0].replace("input: WorkflowData<StoreWorkflow.UpdateStoreWorkflowInput>", "input: WorkflowData<StoreWorkflow.UpdateStoreWorkflowInput> /* erased */"))).not.toThrow();
  });
  it.each([
    ["root ID", '"update-stores"', '"update-other-stores"'],
    ["selected Store import", 'from "../steps/update-stores"', 'from "../steps"'],
    ["selected Pricing import", 'from "../../pricing/steps/update-price-preferences-as-array"', 'from "../../pricing"'],
    ["empty normalization branch", "if (!data.input.update.supported_currencies?.length)", "if (!data.input.update.supported_currencies)"],
    ["native Store selector", "selector: data.input.selector", "selector: {}"],
    ["raw currency case", "currency_code: currency.currency_code", "currency_code: currency.currency_code.toLowerCase()"],
    ["native default projection", "is_default: currency.is_default", "is_default: currency.is_default ?? false"],
    ["condition", "return !!data.input.update.supported_currencies?.length", "return true"],
    ["Pricing original input", "transform({ input }, (data) => {\n        return data.input.update", "transform({ normalizedInput }, (data) => {\n        return data.normalizedInput.update"],
    ["raw tax flag", "is_tax_inclusive: currency.is_tax_inclusive", "is_tax_inclusive: currency.is_tax_inclusive ?? false"],
    ["Store invocation", "updateStoresStep(normalizedInput)", "updateStoresStep(input)"],
    ["Pricing invocation", "updatePricePreferencesAsArrayStep(upsertPricePreferences)", "updatePricePreferencesAsArrayStep([])"],
    ["native output", "new WorkflowResponse(stores)", "new WorkflowResponse([])"],
    ["extra unused statement", "return new WorkflowResponse(stores)", "void stores; return new WorkflowResponse(stores)"],
    ["extra runtime import", 'from "@medusajs/workflows-sdk"', 'from "@medusajs/workflows-sdk"; import "node:fs"'],
  ])("rejects changed root %s", (_label, before, after) => {
    const changed = promoted[0].replace(before, after); expect(changed).not.toBe(promoted[0]);
    expect(() => verify(changed)).toThrow("Changed native Store update callback behavior");
  });
  it.each([
    ["step ID", '"update-stores"', '"update-other-stores"'],
    ["covered metadata", 'compensation: "transactionCovered"', 'compensation: "none"'],
    ["Store resolution", "Modules.STORE", "Modules.PRICING"],
    ["list selector", "listStores(data.selector,", "listStores({},"],
    ["list projection", "select: selects", "select: []"],
    ["list relations", "relations,", "relations: [],"],
    ["list await", "await service.listStores", "service.listStores"],
    ["update selector", "updateStores(data.selector, data.update)", "updateStores({}, data.update)"],
    ["update payload", "updateStores(data.selector, data.update)", "updateStores(data.selector, {})"],
    ["update await", "await service.updateStores", "service.updateStores"],
    ["retained preimage", "new StepResponse(stores, prevData)", "new StepResponse(stores, stores)"],
    ["empty inverse skip", "if (!prevData?.length)", "if (!prevData)"],
    ["native inverse", "service.upsertStores(", "service.updateStores("],
    ["null metadata semantics", "metadata: r.metadata || undefined", "metadata: r.metadata"],
    ["portable utils", 'from "@medusajs/framework/utils/portable"', 'from "@medusajs/framework/utils"'],
    ["extra inverse effect", "    await service.upsertStores(", '    container.resolve("query"); await service.upsertStores('],
  ])("rejects changed step %s", (_label, before, after) => {
    const changed = promoted[1].replace(before, after); expect(changed).not.toBe(promoted[1]);
    expect(() => verify(promoted[0], changed)).toThrow("Changed native Store update callback behavior");
  });
  it("rejects malformed native callback syntax", () => {
    expect(() => verify(promoted[0], promoted[1].replace("return new StepResponse(stores, prevData)", "return new StepResponse("))).toThrow("Invalid native Store update callback syntax");
  });
});

describe("native ShippingProfile update callback provenance", () => {
  const paths = ["fulfillment/workflows/update-shipping-profiles.ts", "fulfillment/steps/update-shipping-profiles.ts"];
  const native = paths.map(file => readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/" + file, "utf8").replace(/\r\n/g, "\n"));
  const promoted = paths.map(file => readFileSync("packages/medusa-core-flows/src/" + file, "utf8").replace(/\r\n/g, "\n"));
  const verify = (workflow = promoted[0], step = promoted[1]) => verifyShippingProfileUpdateCallbacks(native[0], workflow, native[1], step);
  it("admits the full native program and erased annotations", () => {
    expect(() => verify()).not.toThrow();
    expect(() => verify(promoted[0].replace("input: WorkflowData<FulfillmentWorkflow.UpdateShippingProfilesWorkflowInput>", "input: WorkflowData<FulfillmentWorkflow.UpdateShippingProfilesWorkflowInput> /* erased */"))).not.toThrow();
  });
  it.each([
    ["root ID", '"update-shipping-profiles-workflow"', '"update-other-shipping-profiles-workflow"'],
    ["selected step import", 'from "../steps/update-shipping-profiles"', 'from "../steps"'],
    ["native step input", "updateShippingProfilesStep(input)", "updateShippingProfilesStep({})"],
    ["output wrapping", "return new WorkflowResponse(updateShippingProfilesStep(input))", "return new WorkflowResponse([])"],
    ["extra unused statement", "return new WorkflowResponse", "void input; return new WorkflowResponse"],
    ["extra runtime import", 'from "@medusajs/workflows-sdk"', 'from "@medusajs/workflows-sdk"; import "node:fs"'],
  ])("rejects changed root %s", (_label, before, after) => {
    const changed = promoted[0].replace(before, after); expect(changed).not.toBe(promoted[0]);
    expect(() => verify(changed)).toThrow("Changed native ShippingProfile update callback behavior");
  });
  it.each([
    ["step ID", '"update-shipping-profiles"', '"update-other-shipping-profiles"'],
    ["covered metadata", 'compensation: "transactionCovered"', 'compensation: "none"'],
    ["Fulfillment resolution", "Modules.FULFILLMENT", "Modules.STORE"],
    ["projection source", "      input.update,", "      {},"],
    ["list selector", "listShippingProfiles(input.selector,", "listShippingProfiles({},"],
    ["list projection", "select: selects", "select: []"],
    ["list relations", "relations,", "relations: [],"],
    ["list await", "await service.listShippingProfiles", "service.listShippingProfiles"],
    ["update selector", "      input.selector,", "      {},"],
    ["update payload", "      input.update\n", "      {}\n"],
    ["update await", "await service.updateShippingProfiles", "service.updateShippingProfiles"],
    ["full array result", "new StepResponse(profiles, prevData)", "new StepResponse(profiles[0], prevData)"],
    ["retained preimages", "new StepResponse(profiles, prevData)", "new StepResponse(profiles, profiles)"],
    ["empty inverse skip", "if (!prevData?.length)", "if (!prevData)"],
    ["native inverse", "service.upsertShippingProfiles(prevData)", "service.updateShippingProfiles(prevData)"],
    ["metadata inverse rewrite", "service.upsertShippingProfiles(prevData)", "service.upsertShippingProfiles(prevData.map(r => ({ ...r, metadata: r.metadata || undefined })))"],
    ["portable utility import", 'from "@medusajs/framework/utils/portable"', 'from "@medusajs/framework/utils"'],
    ["extra inverse effect", "    await service.upsertShippingProfiles", '    container.resolve("query"); await service.upsertShippingProfiles'],
    ["missing inverse await", "await service.upsertShippingProfiles", "service.upsertShippingProfiles"],
  ])("rejects changed step %s", (_label, before, after) => {
    const changed = promoted[1].replace(before, after); expect(changed).not.toBe(promoted[1]);
    expect(() => verify(promoted[0], changed)).toThrow("Changed native ShippingProfile update callback behavior");
  });
  it("rejects malformed native callback syntax", () => {
    expect(() => verify(promoted[0], promoted[1].replace("return new StepResponse(profiles, prevData)", "return new StepResponse(")))
      .toThrow("Invalid native ShippingProfile update callback syntax");
  });
});

describe("native ShippingProfile workflow metadata type seam", () => {
  const source = readFileSync("third_party/medusa/upstream/packages/core/types/src/workflow/fulfillment/shipping-profiles.ts", "utf8");
  const target = readFileSync("packages/medusa-types/src/workflow/fulfillment/shipping-profiles.ts", "utf8");
  it("admits only the erased metadata field used by the native step and Admin route", () => {
    expect(() => verifyShippingProfileWorkflowTypeFork(source, target)).not.toThrow();
  });
  it.each([
    ["changed name contract", "  name?: string", "  name?: number"],
    ["changed metadata nullability", "Record<string, unknown> | null", "Record<string, unknown>"],
    ["extra input capability", "  name?: string", "  name?: string\n  shipping_options?: string[]"],
  ])("rejects %s", (_label, before, after) => {
    const changed = target.replace(before, after); expect(changed).not.toBe(target);
    expect(() => verifyShippingProfileWorkflowTypeFork(source, changed)).toThrow("Changed native ShippingProfile workflow erased type seam");
  });
  it("rejects added runtime behavior", () => {
    expect(() => verifyShippingProfileWorkflowTypeFork(source, target + "\nexport const runtimeDrift = true;\n"))
      .toThrow("Module type adaptation changes runtime behavior");
  });
  it.each(["target", "source"])("refuses a different %s for the narrow type seam", property => {
    expect(() => verifyCurrencyPromotion(root, { ...promotion, files: promotion.files.map(file =>
      file.classification === "shippingProfileWorkflowTypeFork" ? { ...file, [property]: property === "target"
        ? "packages/medusa-types/src/workflow/fulfillment/unadmitted-shipping-profiles.ts"
        : "third_party/medusa/upstream/packages/core/types/src/fulfillment/common/shipping-profile.ts" } : file) }))
      .toThrow("ShippingProfile workflow type adaptation outside its approved source file");
  });
});


describe("native ShippingProfile creation root, retained physical inverse and public contract provenance", () => {
  const paths = ["fulfillment/workflows/create-shipping-profiles.ts", "fulfillment/steps/create-shipping-profiles.ts"];
  const native = paths.map(file => readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/" + file, "utf8").replaceAll("\r\n", "\n"));
  const promoted = paths.map(file => readFileSync("packages/medusa-core-flows/src/" + file, "utf8").replaceAll("\r\n", "\n"));
  const nativeTypes = readFileSync("third_party/medusa/upstream/packages/core/types/src/workflow/fulfillment/shipping-profiles.ts", "utf8");
  const types = readFileSync("packages/medusa-types/src/workflow/fulfillment/shipping-profiles.ts", "utf8");
  const verify = (workflow = promoted[0], step = promoted[1], publicTypes = types) =>
    verifyShippingProfileCreateCallbacks(native[0], workflow, native[1], step, nativeTypes, publicTypes);
  it("admits the exact native root, unchanged existing step and approved shared type seam", () => expect(() => verify()).not.toThrow());
  it.each([
    ["root identity", '"create-shipping-profiles-workflow"', '"create-other-shipping-profiles-workflow"'],
    ["whole input", "createShippingProfilesStep(input.data)", "createShippingProfilesStep([])"],
    ["complete returned rows", "new WorkflowResponse(createShippingProfilesStep(input.data))", "new WorkflowResponse([])"],
    ["direct step import", 'from "../steps/create-shipping-profiles"', 'from "../steps"'],
    ["extra resource", 'from "../steps/create-shipping-profiles"', 'from "../steps/create-shipping-profiles"; import "node:fs"'],
    ["extra runtime effect", "    return new WorkflowResponse", "    console.log(input); return new WorkflowResponse"],
    ["empty creation elision", "createShippingProfilesStep(input.data)", "input.data.length ? createShippingProfilesStep(input.data) : []"],
    ["input mutation", "    return new WorkflowResponse", "    input.data.reverse(); return new WorkflowResponse"],
  ])("rejects changed root %s", (_label, before, after) => {
    const changed = promoted[0].replace(before, after); expect(changed).not.toBe(promoted[0]);
    expect(() => verify(changed)).toThrow("Changed native ShippingProfile creation callback behavior");
  });
  it.each([
    ["step identity", '"create-shipping-profiles"', '"create-other-shipping-profiles"'],
    ["covered metadata", 'compensation: "transactionCovered"', 'compensation: "none"'],
    ["Fulfillment resource", "Modules.FULFILLMENT", "Modules.PRODUCT"],
    ["complete create input", "service.createShippingProfiles(input)", "service.createShippingProfiles([])"],
    ["native create method", "service.createShippingProfiles(input)", "service.upsertShippingProfiles(input)"],
    ["create await", "await service.createShippingProfiles", "service.createShippingProfiles"],
    ["actual returned rows", "      createdShippingProfiles,", "      [],"],
    ["actual retained IDs", "createdShippingProfiles.map((created) => created.id)", "[]"],
    ["inverse empty guard", "if (!createdShippingProfiles?.length)", "if (!createdShippingProfiles)"],
    ["physical inverse", "service.deleteShippingProfiles(createdShippingProfiles)", "service.softDeleteShippingProfiles(createdShippingProfiles)"],
    ["raw retained inverse", "service.deleteShippingProfiles(createdShippingProfiles)", "service.deleteShippingProfiles([])"],
    ["inverse await", "await service.deleteShippingProfiles", "service.deleteShippingProfiles"],
    ["extra inverse resource", "    await service.deleteShippingProfiles", '    container.resolve("query"); await service.deleteShippingProfiles'],
  ])("rejects changed existing native step %s", (_label, before, after) => {
    const changed = promoted[1].replace(before, after); expect(changed).not.toBe(promoted[1]);
    expect(() => verify(promoted[0], changed)).toThrow("Changed native ShippingProfile creation callback behavior");
  });
  it.each([
    [0, "WorkflowData<FulfillmentWorkflow.CreateShippingProfilesWorkflowInput>", "WorkflowData<never>"],
    [0, "WorkflowResponse<FulfillmentWorkflow.CreateShippingProfilesWorkflowOutput>", "WorkflowResponse<never>"],
    [0, 'from "@medusajs/framework/types"', 'from "@medusajs/types"'],
    [1, "CreateShippingProfileDTO[]", "readonly CreateShippingProfileDTO[]"],
    [1, "input: CreateShippingProfilesStepInput", "input: never"],
    [1, 'from "@medusajs/types"', 'from "@medusajs/framework/types"'],
  ])("rejects changed erased public contract %s / %s", (index, before, after) => {
    const changed = promoted[index].replace(before, after); expect(changed).not.toBe(promoted[index]);
    expect(() => index === 0 ? verify(changed) : verify(promoted[0], changed)).toThrow("Changed native ShippingProfile creation public contract");
  });
  it.each([
    ["required name", "  name: string", "  name?: string"],
    ["required type", "  type: string", "  type: number"],
    ["complete data", "data: CreateShippingProfile[]", "data: readonly CreateShippingProfile[]"],
    ["DTO output", "= ShippingProfileDTO[]", "= readonly ShippingProfileDTO[]"],
    ["extra relation input", "  type: string", "  type: string\n  shipping_options?: unknown[]"],
  ])("rejects changed public creation types %s", (_label, before, after) => {
    const changed = types.replace(before, after); expect(changed).not.toBe(types);
    expect(() => verify(promoted[0], promoted[1], changed)).toThrow("Changed native ShippingProfile creation public contract");
  });
  it("rejects malformed callback syntax", () => {
    expect(() => verify(promoted[0], promoted[1].replace("return new StepResponse(", "return new StepResponse(,")))
      .toThrow("Invalid native ShippingProfile creation callback syntax");
  });
  it.each(paths.flatMap(file => [
    [file, "source", { source: "third_party/medusa/upstream/packages/core/core-flows/src/fulfillment/steps/create-service-zones.ts" }],
    [file, "classification", { classification: "selectedExportFacade" }],
  ]))("rejects displaced %s %s", (file, _label, mutation) => {
    expect(() => verifyCurrencyPromotion(root, { ...promotion, files: promotion.files.map(entry =>
      entry.target === "packages/medusa-core-flows/src/" + file ? { ...entry, ...mutation } : entry) }))
      .toThrow("ShippingProfile creation adaptation outside its exact pinned source pair");
  });
});

describe("native ShippingProfile deletion callback provenance", () => {
  const paths = ["shipping-profile/workflows/delete-shipping-profile.ts", "shipping-profile/steps/delete-shipping-profile.ts", "common/steps/remove-remote-links.ts"];
  const native = paths.map(file => readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/" + file, "utf8").replace(/\r\n/g, "\n"));
  const promoted = paths.map(file => readFileSync("packages/medusa-core-flows/src/" + file, "utf8").replace(/\r\n/g, "\n"));
  const verify = (workflow = promoted[0], step = promoted[1], link = promoted[2]) => verifyShippingProfileDeleteCallbacks(native[0], workflow, native[1], step, native[2], link);
  it("admits the complete emitted native program and erased private Query annotation", () => {
    expect(() => verify()).not.toThrow();
    expect(() => verify(promoted[0].replace("readonly Record<string, unknown>[]", "readonly Record<string, unknown>[] /* erased */"))).not.toThrow();
  });
  it.each([
    ["singular root identity", '"delete-shipping-profile-workflow"', '"delete-other-shipping-profile-workflow"'],
    ["step identity", '"validate-step-shipping-profile-delete"', '"validate-other-shipping-profile-delete"'],
    ["Query alias", 'entity: "product_shipping_profile"', 'entity: "product_shipping_profiles"'],
    ["Query fields", 'fields: ["product_id", "shipping_profile_id"]', 'fields: ["shipping_profile_id", "product_id"]'],
    ["Query selector", "filters: { shipping_profile_id: input.ids }", "filters: { product_id: input.ids }"],
    ["guard rows", "links: currentShippingProfileLinks.data", "links: []"],
    ["guard threshold", "if (links.length > 0)", "if (links.length > 1)"],
    ["error type", "MedusaError.Types.INVALID_DATA", "MedusaError.Types.NOT_FOUND"],
    ["native Product IDs in error", ".map((l) => l.product_id)", ".map((l) => l.shipping_profile_id)"],
    ["native error separator", '.join(", ")', '.join(";")'],
    ["native error wording", "because they are linked to products:", "because products exist:"],
    ["raw delete IDs", "deleteShippingProfilesStep(input.ids)", "deleteShippingProfilesStep([])"],
    ["grouped Link endpoint", "{ shipping_profile_id: input.ids }", "{ shipping_profile_id: [] }"],
    ["Fulfillment endpoint", "[Modules.FULFILLMENT]", "[Modules.PRODUCT]"],
    ["void response", "new WorkflowResponse(void 0)", "new WorkflowResponse(input.ids)"],
    ["extra root effect", "return new WorkflowResponse(void 0)", "console.log(input); return new WorkflowResponse(void 0)"],
    ["direct step import", 'from "../steps/delete-shipping-profile"', 'from "../steps"'],
    ["extra import", 'from "@medusajs/workflows-sdk"', 'from "@medusajs/workflows-sdk"; import "node:fs"'],
  ])("rejects changed root %s", (_label, before, after) => {
    const changed = promoted[0].replace(before, after); expect(changed).not.toBe(promoted[0]);
    expect(() => verify(changed)).toThrow("Changed native ShippingProfile deletion callback behavior");
  });
  it("rejects changed operation order", () => {
    const changed = promoted[0].replace("    deleteShippingProfilesStep(input.ids)\n", "")
      .replace("    validateStepShippingProfileDelete({", "    deleteShippingProfilesStep(input.ids)\n    validateStepShippingProfileDelete({");
    expect(() => verify(changed)).toThrow("Changed native ShippingProfile deletion callback behavior");
  });
  it.each([
    ["step ID", '"delete-shipping-profile"', '"delete-shipping-profiles"'],
    ["covered metadata", 'compensation: "transactionCovered"', 'compensation: "none"'],
    ["Fulfillment resolution", "Modules.FULFILLMENT", "Modules.PRODUCT"],
    ["softDelete", "service.softDeleteShippingProfiles(ids)", "service.deleteShippingProfiles(ids)"],
    ["await", "await service.softDeleteShippingProfiles", "service.softDeleteShippingProfiles"],
    ["retained raw IDs", "new StepResponse(void 0, ids)", "new StepResponse(void 0, [])"],
    ["empty inverse guard", "if (!prevIds?.length)", "if (!prevIds)"],
    ["inverse selector", "service.restoreShippingProfiles(prevIds)", "service.restoreShippingProfiles([])"],
    ["inverse await", "await service.restoreShippingProfiles", "service.restoreShippingProfiles"],
    ["extra inverse effect", "    await service.restoreShippingProfiles", '    container.resolve("query"); await service.restoreShippingProfiles'],
  ])("rejects changed step %s", (_label, before, after) => {
    const changed = promoted[1].replace(before, after); expect(changed).not.toBe(promoted[1]);
    expect(() => verify(promoted[0], changed)).toThrow("Changed native ShippingProfile deletion callback behavior");
  });
  it.each([
    ["empty entries guard", "if (!entries.length)", "if (!entries.length || entries.length === 1)"],
    ["raw endpoint concatenation", "currentKeys.concat(incomingKeys)", "[...new Set(currentKeys.concat(incomingKeys))]"],
    ["Link delete", "await link.delete(grouped)", "await link.delete({})"],
    ["retained endpoint", "new StepResponse(grouped, grouped)", "new StepResponse(grouped, {})"],
    ["Link restore", "await link.restore(removedLinks)", "await link.restore({})"],
    ["covered metadata", 'compensation: "transactionCovered"', 'compensation: "none"'],
  ])("rejects changed common Link callback %s", (_label, before, after) => {
    const changed = promoted[2].replace(before, after); expect(changed).not.toBe(promoted[2]);
    expect(() => verify(promoted[0], promoted[1], changed)).toThrow("Changed native ShippingProfile deletion callback behavior");
  });
  it("rejects a widened original public guard input type", () => {
    expect(() => verify(promoted[0].replace("    product_id: string", "    product_id?: string")))
      .toThrow("Changed native ShippingProfile deletion public input type");
  });
  it("rejects malformed callback syntax", () => {
    expect(() => verify(promoted[0], promoted[1].replace("return new StepResponse(void 0, ids)", "return new StepResponse(")))
      .toThrow("Invalid native ShippingProfile deletion callback syntax");
  });
});

describe("native ShippingOptionType creation callback provenance", () => {
  const paths = ["shipping-options/workflows/create-shipping-option-types.ts", "shipping-options/steps/create-shipping-option-types.ts"];
  const native = paths.map(file => readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/" + file, "utf8").replace(/\r\n/g, "\n"));
  const promoted = paths.map(file => readFileSync("packages/medusa-core-flows/src/" + file, "utf8").replace(/\r\n/g, "\n"));
  const verify = (workflow = promoted[0], step = promoted[1]) => verifyShippingOptionTypeCreateCallbacks(native[0], workflow, native[1], step);
  it("admits the complete native program and unchanged public input aliases", () => {
    expect(() => verify()).not.toThrow();
  });
  it.each([
    ["workflow identity", '"create-shipping-option-types"', '"create-other-shipping-option-types"'],
    ["root create input", "input.shipping_option_types", "[]"],
    ["hook identity", '"shippingOptionTypesCreated"', '"shippingOptionTypeCreated"'],
    ["hook rows", "shipping_option_types: shippingOptionTypes", "shipping_option_types: []"],
    ["additional data", "additional_data: input.additional_data", "additional_data: {}"],
    ["event family", "ShippingOptionTypeWorkflowEvents.CREATED", "ShippingOptionTypeWorkflowEvents.UPDATED"],
    ["event IDs", "id: v.id", "id: String(v.code)"],
    ["event payload", "data: typeIdEvents", "data: []"],
    ["root output", "new WorkflowResponse(shippingOptionTypes,", "new WorkflowResponse([],"],
    ["hook exposure", "hooks: [shippingOptionTypesCreated]", "hooks: []"],
    ["direct step import", 'from "../steps/create-shipping-option-types"', 'from "../steps"'],
    ["direct event import", 'from "../../common/steps/emit-event"', 'from "../../common"'],
    ["extra runtime effect", "return new WorkflowResponse(shippingOptionTypes,", "console.log(input); return new WorkflowResponse(shippingOptionTypes,"],
    ["extra runtime import", 'from "@medusajs/workflows-sdk"', 'from "@medusajs/workflows-sdk"; import "node:fs"'],
  ])("rejects changed root %s", (_label, before, after) => {
    const changed = promoted[0].replace(before, after); expect(changed).not.toBe(promoted[0]);
    expect(() => verify(changed)).toThrow("Changed native ShippingOptionType creation callback behavior");
  });
  it("rejects moving the hook after event emission", () => {
    const start = promoted[0].indexOf("    const shippingOptionTypesCreated = createHook(");
    const end = promoted[0].indexOf("\n    const typeIdEvents = transform(", start);
    expect(start).toBeGreaterThan(-1); expect(end).toBeGreaterThan(start);
    const hook = promoted[0].slice(start, end);
    const changed = promoted[0].slice(0, start) + promoted[0].slice(end);
    expect(() => verify(changed.replace("    return new WorkflowResponse(", hook + "\n    return new WorkflowResponse(")))
      .toThrow("Changed native ShippingOptionType creation callback behavior");
  });
  it.each([
    ["step identity", '"create-shipping-option-types"', '"create-other-shipping-option-types"'],
    ["covered compensation", 'compensation: "transactionCovered"', 'compensation: "none"'],
    ["Fulfillment resolution", "Modules.FULFILLMENT", "Modules.PRODUCT"],
    ["native create method", "service.createShippingOptionTypes(data)", "service.upsertShippingOptionTypes(data)"],
    ["create await", "await service.createShippingOptionTypes", "service.createShippingOptionTypes"],
    ["returned rows", "      created,", "      [],"],
    ["inverse IDs", "created.map((shippingOptionType) => shippingOptionType.id)", "[]"],
    ["empty inverse", "if (!createdIds?.length)", "if (!createdIds)"],
    ["physical inverse", "service.deleteShippingOptionTypes(createdIds)", "service.softDeleteShippingOptionTypes(createdIds)"],
    ["inverse raw selector", "service.deleteShippingOptionTypes(createdIds)", "service.deleteShippingOptionTypes([])"],
    ["inverse await", "await service.deleteShippingOptionTypes", "service.deleteShippingOptionTypes"],
    ["extra inverse effect", "    await service.deleteShippingOptionTypes", '    container.resolve("query"); await service.deleteShippingOptionTypes'],
  ])("rejects changed step %s", (_label, before, after) => {
    const changed = promoted[1].replace(before, after); expect(changed).not.toBe(promoted[1]);
    expect(() => verify(promoted[0], changed)).toThrow("Changed native ShippingOptionType creation callback behavior");
  });
  it.each([
    ["root", "FulfillmentTypes.CreateShippingOptionTypeDTO[]", "unknown[]"],
    ["step", "FulfillmentTypes.CreateShippingOptionTypeDTO[]", "unknown[]"],
  ])("rejects changed public %s input", (file, before, after) => {
    const target = file === "root" ? promoted[0] : promoted[1];
    const changed = target.replace(before, after); expect(changed).not.toBe(target);
    expect(() => file === "root" ? verify(changed) : verify(promoted[0], changed))
      .toThrow("Changed native ShippingOptionType creation public input type");
  });
  it("rejects malformed callback syntax", () => {
    expect(() => verify(promoted[0], promoted[1].replace("return new StepResponse(", "return new StepResponse(" + "{")))
      .toThrow("Invalid native ShippingOptionType creation callback syntax");
  });
});

describe("native generic zero-to-many initialization provenance", () => {
  const native = readFileSync("third_party/medusa/upstream/packages/database/drizzle/src/medusa.ts", "utf8");
  const owner = readFileSync("packages/medusa-drizzle/src/relation-query.ts", "utf8");
  it("admits only the native runtime helper with erased metadata-only types", () => {
    expect(() => verifyNativeToManyInitialization(native, owner)).not.toThrow();
  });
  it.each([
    ["preserve existing fields", "relationName in row", "Object.hasOwn(row, relationName)"],
    ["hasMany branch", 'descriptor.relationship.type !== "hasMany"', 'descriptor.relationship.type !== "belongsTo"'],
    ["manyToMany branch", 'descriptor.relationship.type !== "manyToMany"', 'descriptor.relationship.type !== "hasMany"'],
    ["branch conjunction", '!== "hasMany" &&', '!== "hasMany" ||'],
    ["native empty array", "row[relationName] = []", "row[relationName] = null"],
    ["extra side effect", "row[relationName] = []", "console.log(row); row[relationName] = []"],
  ])("rejects changed helper %s", (_label, before, after) => {
    const changed = owner.replace(before, after); expect(changed).not.toBe(owner);
    expect(() => verifyNativeToManyInitialization(native, changed)).toThrow("Changed native zero-to-many initialization extraction");
  });
  it("rejects duplicate helpers", () => {
    expect(() => verifyNativeToManyInitialization(native, owner + "\nfunction fillEmptyToManyRelations() {}\n"))
      .toThrow("Changed native zero-to-many initialization extraction");
  });
  it("rejects missing helpers", () => {
    expect(() => verifyNativeToManyInitialization(native, owner.replace("function fillEmptyToManyRelations", "function otherInitializer")))
      .toThrow("Changed native zero-to-many initialization extraction");
  });
});

describe("native ShippingOptionType update callback provenance", () => {
  const paths = ["shipping-options/workflows/update-shipping-option-types.ts", "shipping-options/steps/update-shipping-option-types.ts"];
  const native = paths.map(file => readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/" + file, "utf8").replace(/\r\n/g, "\n"));
  const promoted = paths.map(file => readFileSync("packages/medusa-core-flows/src/" + file, "utf8").replace(/\r\n/g, "\n"));
  const verify = (workflow = promoted[0], step = promoted[1]) => verifyShippingOptionTypeUpdateCallbacks(native[0], workflow, native[1], step);
  it("admits the complete native root, projected inverse and unchanged input aliases", () => expect(() => verify()).not.toThrow());
  it.each([
    ["root identity", '"update-shipping-option-types"', '"update-other-shipping-option-types"'],
    ["whole step input", "updateShippingOptionTypesStep(input)", "updateShippingOptionTypesStep({selector:input.selector,update:{}})"],
    ["hook identity", '"shippingOptionTypesUpdated"', '"shippingOptionTypeUpdated"'],
    ["hook rows", "shipping_option_types: updatedShippingOptionTypes", "shipping_option_types: []"],
    ["additional data", "additional_data: input.additional_data", "additional_data: {}"],
    ["array/scalar normalization", "Array.isArray(updatedShippingOptionTypes)", "true"],
    ["workflow event IDs", "id: v.id", "id: v.code"],
    ["workflow event family", "ShippingOptionTypeWorkflowEvents.UPDATED", "ShippingOptionTypeWorkflowEvents.CREATED"],
    ["workflow payload", "data: typeIdEvents", "data: []"],
    ["native output", "new WorkflowResponse(updatedShippingOptionTypes,", "new WorkflowResponse([],"],
    ["hook exposure", "hooks: [shippingOptionTypesUpdated]", "hooks: []"],
    ["direct step import", 'from "../steps/update-shipping-option-types"', 'from "../steps"'],
    ["extra import", 'from "@medusajs/workflows-sdk"', 'from "@medusajs/workflows-sdk"; import "node:fs"'],
    ["extra runtime effect", "return new WorkflowResponse(updatedShippingOptionTypes,", "console.log(input); return new WorkflowResponse(updatedShippingOptionTypes,"],
  ])("rejects changed root %s", (_label, before, after) => {
    const changed = promoted[0].replace(before, after); expect(changed).not.toBe(promoted[0]);
    expect(() => verify(changed)).toThrow("Changed native ShippingOptionType update callback behavior");
  });
  it.each([
    ["step identity", '"update-shipping-option-types"', '"update-other-shipping-option-types"'],
    ["covered metadata", 'compensation: "transactionCovered"', 'compensation: "none"'],
    ["Fulfillment resolution", "Modules.FULFILLMENT", "Modules.PRODUCT"],
    ["preimage derivation", "      data.update,", "      {},"],
    ["preimage selector", "service.listShippingOptionTypes(data.selector,", "service.listShippingOptionTypes({},"],
    ["preimage fields", "select: selects", 'select: ["id"]'],
    ["preimage relations", "      relations,", "      relations: [],"],
    ["list await", "await service.listShippingOptionTypes", "service.listShippingOptionTypes"],
    ["native update method", "await service.updateShippingOptionTypes(", "await service.upsertShippingOptionTypes("],
    ["update selector", "      data.selector,", "      {},"],
    ["update patch", "      data.update\n    )", "      {}\n    )"],
    ["update await", "await service.updateShippingOptionTypes", "service.updateShippingOptionTypes"],
    ["retained preimage", "new StepResponse(shippingOptionTypes, prevData)", "new StepResponse(shippingOptionTypes, [])"],
    ["forward result", "new StepResponse(shippingOptionTypes, prevData)", "new StepResponse(prevData, prevData)"],
    ["empty inverse", "if (!prevData?.length)", "if (!prevData)"],
    ["true upsert inverse", "service.upsertShippingOptionTypes(prevData)", "service.updateShippingOptionTypes(prevData)"],
    ["unmodified preimages", "service.upsertShippingOptionTypes(prevData)", "service.upsertShippingOptionTypes([])"],
    ["inverse await", "await service.upsertShippingOptionTypes", "service.upsertShippingOptionTypes"],
    ["extra inverse resource", "    await service.upsertShippingOptionTypes", '    container.resolve("query"); await service.upsertShippingOptionTypes'],
  ])("rejects changed step %s", (_label, before, after) => {
    const changed = promoted[1].replace(before, after); expect(changed).not.toBe(promoted[1]);
    expect(() => verify(promoted[0], changed)).toThrow("Changed native ShippingOptionType update callback behavior");
  });
  it.each(["root", "step"])("rejects narrowed original %s update input", file => {
    const index = file === "root" ? 0 : 1;
    const changed = promoted[index].replace("update: FulfillmentTypes.UpdateShippingOptionTypeDTO", "update: {label?: string}");
    expect(changed).not.toBe(promoted[index]);
    expect(() => index === 0 ? verify(changed) : verify(promoted[0], changed))
      .toThrow("Changed native ShippingOptionType update public input type");
  });
  it("rejects malformed callback syntax", () => {
    expect(() => verify(promoted[0], promoted[1].replace("return new StepResponse(shippingOptionTypes, prevData)", "return new StepResponse(")))
      .toThrow("Invalid native ShippingOptionType update callback syntax");
  });
});

describe("native ShippingOptionType deletion callback provenance", () => {
  const paths = ["shipping-options/workflows/delete-shipping-option-types.ts", "shipping-options/steps/delete-shipping-option-types.ts"];
  const native = paths.map(file => readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/" + file, "utf8").replace(/\r\n/g, "\n"));
  const promoted = paths.map(file => readFileSync("packages/medusa-core-flows/src/" + file, "utf8").replace(/\r\n/g, "\n"));
  const verify = (workflow = promoted[0], step = promoted[1]) => verifyShippingOptionTypeDeleteCallbacks(native[0], workflow, native[1], step);
  it("admits the full native guard, Link/event graph and raw-ID inverse", () => expect(() => verify()).not.toThrow());
  it.each([
    ["root identity", '"delete-shipping-option-types"', '"delete-other-shipping-option-types"'],
    ["validation step identity", '"validate-delete-shipping-option-types"', '"validate-other-shipping-option-types"'],
    ["guard entity", 'entity: "shipping_option"', 'entity: "shipping_option_type"'],
    ["guard filter", "filters: { shipping_option_type_id: input.ids }", "filters: { id: input.ids }"],
    ["guard pagination", "pagination: { take: 1 }", "pagination: { take: 4 }"],
    ["guard projection", 'fields: ["id"]', 'fields: ["id", "name"]'],
    ["query node identity", 'name: "get-shipping-options"', 'name: "get-shipping-option-types"'],
    ["query output", "shippingOptionsQuery.data as", "[] as"],
    ["guard condition", "shippingOptions.length > 0", "shippingOptions.length > 1"],
    ["guard error class", "MedusaError.Types.INVALID_DATA", "MedusaError.Types.NOT_FOUND"],
    ["guard error message", "some shipping options are using it.", "some shipping options exist."],
    ["guard invocation", "      shippingOptions,", "      shippingOptions: [],"],
    ["raw forward IDs", "deleteShippingOptionTypesStep(input.ids)", "deleteShippingOptionTypesStep([])"],
    ["hook identity", '"shippingOptionTypesDeleted"', '"shippingOptionTypeDeleted"'],
    ["hook IDs", "ids: input.ids,", "ids: [],"],
    ["raw event IDs", "return input.ids?.map", "return []?.map"],
    ["event row", "return { id }", "return { id: null }"],
    ["parallel siblings", "    parallelize(", "    transform("],
    ["Link endpoint", "[Modules.FULFILLMENT]: { shipping_option_type_id: input.ids }", "[Modules.FULFILLMENT]: { shipping_option_type_id: [] }"],
    ["workflow event family", "ShippingOptionTypeWorkflowEvents.DELETED", "ShippingOptionTypeWorkflowEvents.CREATED"],
    ["workflow event data", "data: typeIdEvents", "data: []"],
    ["native void output", "new WorkflowResponse(deletedShippingOptionTypes,", "new WorkflowResponse([],"],
    ["hook exposure", "hooks: [shippingOptionTypesDeleted]", "hooks: []"],
    ["direct step import", 'from "../steps/delete-shipping-option-types"', 'from "../steps"'],
    ["direct query import", 'from "../../common/steps/use-query-graph"', 'from "../../common"'],
    ["extra runtime effect", "return new WorkflowResponse(deletedShippingOptionTypes,", "console.log(input); return new WorkflowResponse(deletedShippingOptionTypes,"],
    ["extra import", 'from "@medusajs/utils/common/errors"', 'from "@medusajs/utils/common/errors"; import "node:fs"'],
  ])("rejects changed root %s", (_label, before, after) => {
    const changed = promoted[0].replace(before, after); expect(changed).not.toBe(promoted[0]);
    expect(() => verify(changed)).toThrow("Changed native ShippingOptionType deletion callback behavior");
  });
  it.each([
    ["step identity", '"delete-shipping-option-types"', '"delete-other-shipping-option-types"'],
    ["covered metadata", 'compensation: "transactionCovered"', 'compensation: "none"'],
    ["Fulfillment resolution", "Modules.FULFILLMENT", "Modules.PRODUCT"],
    ["native soft delete", "service.softDeleteShippingOptionTypes(ids)", "service.deleteShippingOptionTypes(ids)"],
    ["native await", "await service.softDeleteShippingOptionTypes", "service.softDeleteShippingOptionTypes"],
    ["void forward result", "new StepResponse(void 0, ids)", "new StepResponse(ids, ids)"],
    ["raw compensation IDs", "new StepResponse(void 0, ids)", "new StepResponse(void 0, [])"],
    ["empty inverse", "if (!prevIds?.length)", "if (!prevIds)"],
    ["native restore", "service.restoreShippingOptionTypes(prevIds)", "service.softDeleteShippingOptionTypes(prevIds)"],
    ["restore raw IDs", "service.restoreShippingOptionTypes(prevIds)", "service.restoreShippingOptionTypes([])"],
    ["restore await", "await service.restoreShippingOptionTypes", "service.restoreShippingOptionTypes"],
    ["extra inverse resource", "    await service.restoreShippingOptionTypes", '    container.resolve("query"); await service.restoreShippingOptionTypes'],
  ])("rejects changed step %s", (_label, before, after) => {
    const changed = promoted[1].replace(before, after); expect(changed).not.toBe(promoted[1]);
    expect(() => verify(promoted[0], changed)).toThrow("Changed native ShippingOptionType deletion callback behavior");
  });
  it.each(["root", "step"])("rejects narrowed original %s input", file => {
    const index = file === "root" ? 0 : 1;
    const changed = promoted[index].replace("string[]", "readonly string[]");
    expect(changed).not.toBe(promoted[index]);
    expect(() => index === 0 ? verify(changed) : verify(promoted[0], changed))
      .toThrow("Changed native ShippingOptionType deletion public input type");
  });
  it("rejects malformed callback syntax", () => {
    expect(() => verify(promoted[0], promoted[1].replace("return new StepResponse(void 0, ids)", "return new StepResponse(")))
      .toThrow("Invalid native ShippingOptionType deletion callback syntax");
  });
});

describe("native ServiceZone creation callback and public type provenance", () => {
  const paths = ["fulfillment/workflows/create-service-zones.ts", "fulfillment/steps/create-service-zones.ts"];
  const native = paths.map(file => readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/" + file, "utf8").replace(/\r\n/g, "\n"));
  const promoted = paths.map(file => readFileSync("packages/medusa-core-flows/src/" + file, "utf8").replace(/\r\n/g, "\n"));
  const nativeTypes = readFileSync("third_party/medusa/upstream/packages/core/types/src/workflow/fulfillment/service-zones.ts", "utf8");
  const types = readFileSync("packages/medusa-types/src/workflow/fulfillment/service-zones.ts", "utf8");
  const verify = (workflow = promoted[0], step = promoted[1], contract = types) => verifyServiceZoneCreateCallbacks(native[0], workflow, native[1], step, nativeTypes, contract);
  it("admits exact native root, full step/inverse and unchanged type source", () => expect(() => verify()).not.toThrow());
  it.each([
    ["identity", '"create-service-zones-workflow"', '"create-other-service-zones-workflow"'],
    ["whole input", "createServiceZonesStep(input.data)", "createServiceZonesStep([])"],
    ["response", "new WorkflowResponse(createServiceZonesStep(input.data))", "new WorkflowResponse([])"],
    ["direct step import", 'from "../steps/create-service-zones"', 'from "../steps"'],
    ["extra runtime effect", "return new WorkflowResponse", "console.log(input); return new WorkflowResponse"],
  ])("rejects changed root %s", (_label, before, after) => {
    const changed = promoted[0].replace(before, after); expect(changed).not.toBe(promoted[0]);
    expect(() => verify(changed)).toThrow("Changed native ServiceZone creation callback behavior");
  });
  it.each([
    ["identity", '"create-service-zones"', '"create-other-service-zones"'],
    ["covered inverse", 'compensation: "transactionCovered"', 'compensation: "none"'],
    ["resource", "Modules.FULFILLMENT", "Modules.PRODUCT"],
    ["native method", "service.createServiceZones(input)", "service.upsertServiceZones(input)"],
    ["whole data", "service.createServiceZones(input)", "service.createServiceZones([])"],
    ["await", "await service.createServiceZones", "service.createServiceZones"],
    ["output", "      createdServiceZones,", "      [],"],
    ["retained IDs", "createdServiceZones.map((createdZone) => createdZone.id)", "[]"],
    ["retained projection", "createdZone.id", "createdZone.name"],
    ["empty inverse", "if (!createdServiceZones?.length)", "if (!createdServiceZones)"],
    ["physical inverse", "service.deleteServiceZones(createdServiceZones)", "service.softDeleteServiceZones(createdServiceZones)"],
    ["inverse IDs", "service.deleteServiceZones(createdServiceZones)", "service.deleteServiceZones([])"],
    ["inverse await", "await service.deleteServiceZones", "service.deleteServiceZones"],
    ["extra resolution", "    await service.deleteServiceZones", '    container.resolve("query"); await service.deleteServiceZones'],
  ])("rejects changed step %s", (_label, before, after) => {
    const changed = promoted[1].replace(before, after); expect(changed).not.toBe(promoted[1]);
    expect(() => verify(promoted[0], changed)).toThrow("Changed native ServiceZone creation callback behavior");
  });
  it.each([
    [0, "ServiceZoneDTO[]", "unknown[]"],
    [0, "FulfillmentWorkflow.CreateServiceZonesWorkflowInput", "{data: []}"],
    [0, '"@medusajs/types/workflow/fulfillment/service-zones"', '"@medusajs/types"'],
    [1, "CreateServiceZoneDTO[]", "unknown[]"],
  ])("rejects changed erased public seam %s", (index, before, after) => {
    const changed = promoted[index].replace(before, after); expect(changed).not.toBe(promoted[index]);
    expect(() => index === 0 ? verify(changed) : verify(promoted[0], changed)).toThrow("Changed native ServiceZone creation public contract");
  });
  it.each([
    ["name: string", "name: string | null"],
    ["fulfillment_set_id: string", "fulfillment_set_id?: string"],
    ["geo_zones?: (", "geo_zones: ("],
    ['"service_zone_id"', '"id"'],
    ["data: CreateServiceZone[]", "data: unknown[]"],
    ['from "../../fulfillment"', 'from "../../http"'],
  ])("rejects altered original type source %s", (before, after) => {
    const changed = types.replace(before, after); expect(changed).not.toBe(types);
    expect(() => verify(promoted[0], promoted[1], changed)).toThrow("Changed native ServiceZone creation public contract");
  });
  it("rejects malformed native callback syntax", () => {
    expect(() => verify(promoted[0], promoted[1].replace("return new StepResponse(", "return new StepResponse(,")))
      .toThrow("Invalid native ServiceZone creation callback syntax");
  });
});

describe("native FulfillmentSet deletion callback and public input provenance", () => {
  const paths = ["fulfillment/workflows/delete-fulfillment-sets.ts", "fulfillment/steps/delete-fulfillment-sets.ts"];
  const native = paths.map(file => readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/" + file, "utf8").replace(/\r\n/g, "\n"));
  const promoted = paths.map(file => readFileSync("packages/medusa-core-flows/src/" + file, "utf8").replace(/\r\n/g, "\n"));
  const verify = (workflow = promoted[0], step = promoted[1]) => verifyFulfillmentSetDeleteCallbacks(native[0], workflow, native[1], step);
  it("admits genuine native root/step/raw inverse and the explicit void wrapper", () => expect(() => verify()).not.toThrow());
  it.each([
    ["required Link step", "    removeRemoteLinkStep({", "    deleteFulfillmentSetsStep({"],
    ["native module endpoint", "[Modules.FULFILLMENT]: { fulfillment_set_id: input.ids }", "[Modules.PRODUCT]: { fulfillment_set_id: input.ids }"],
    ["exact endpoint key", "fulfillment_set_id: input.ids", "service_zone_id: input.ids"],
    ["raw Link IDs", "fulfillment_set_id: input.ids", "fulfillment_set_id: []"],
    ["mandatory empty Link call", "    removeRemoteLinkStep({", "    if (input.ids.length) removeRemoteLinkStep({"],
    ["direct Link import", 'from "../../common/steps/remove-remote-links"', 'from "../../common"'],
    ["serial ordering", "    deleteFulfillmentSetsStep(input.ids)\n\n    removeRemoteLinkStep", "    removeRemoteLinkStep(input.ids)\n\n    deleteFulfillmentSetsStep"],
    ["duplicate resource", "    return new WorkflowResponse", "    removeRemoteLinkStep({}); return new WorkflowResponse"],
  ])("rejects changed native Link topology %s", (_label, before, after) => {
    const changed = promoted[0].replace(before, after); expect(changed).not.toBe(promoted[0]);
    expect(() => verify(changed)).toThrow("Changed native FulfillmentSet deletion callback behavior");
  });
  it.each([
    ["identity", '"delete-fulfillment-sets-workflow"', '"delete-other-fulfillment-sets-workflow"'],
    ["whole raw input", "deleteFulfillmentSetsStep(input.ids)", "deleteFulfillmentSetsStep([])"],
    ["void result", "new WorkflowResponse(void 0)", "new WorkflowResponse([])"],
    ["required wrapper", "return new WorkflowResponse(void 0)", "return undefined"],
    ["direct step import", 'from "../steps/delete-fulfillment-sets"', 'from "../steps"'],
    ["extra runtime effect", "    deleteFulfillmentSetsStep(input.ids)", "    console.log(input); deleteFulfillmentSetsStep(input.ids)"],
    ["extra resource import", 'from "../steps/delete-fulfillment-sets"', 'from "../steps/delete-fulfillment-sets"; import "node:fs"'],
  ])("rejects changed root %s", (_label, before, after) => {
    const changed = promoted[0].replace(before, after); expect(changed).not.toBe(promoted[0]);
    expect(() => verify(changed)).toThrow("Changed native FulfillmentSet deletion callback behavior");
  });
  it.each([
    ["identity", '"delete-fulfillment-sets"', '"delete-other-fulfillment-sets"'],
    ["covered metadata", 'compensation: "transactionCovered"', 'compensation: "none"'],
    ["Fulfillment resource", "Modules.FULFILLMENT", "Modules.PRODUCT"],
    ["soft delete", "service.softDeleteFulfillmentSets(ids)", "service.deleteFulfillmentSets(ids)"],
    ["raw forward IDs", "service.softDeleteFulfillmentSets(ids)", "service.softDeleteFulfillmentSets([])"],
    ["forward await", "await service.softDeleteFulfillmentSets", "service.softDeleteFulfillmentSets"],
    ["native void", "new StepResponse(void 0, ids)", "new StepResponse(ids, ids)"],
    ["raw retained IDs", "new StepResponse(void 0, ids)", "new StepResponse(void 0, [])"],
    ["empty inverse", "if (!prevIds?.length)", "if (!prevIds)"],
    ["native restore", "service.restoreFulfillmentSets(prevIds)", "service.softDeleteFulfillmentSets(prevIds)"],
    ["restore raw IDs", "service.restoreFulfillmentSets(prevIds)", "service.restoreFulfillmentSets([])"],
    ["inverse await", "await service.restoreFulfillmentSets", "service.restoreFulfillmentSets"],
    ["extra inverse resource", "    await service.restoreFulfillmentSets", '    container.resolve("query"); await service.restoreFulfillmentSets'],
  ])("rejects changed step %s", (_label, before, after) => {
    const changed = promoted[1].replace(before, after); expect(changed).not.toBe(promoted[1]);
    expect(() => verify(promoted[0], changed)).toThrow("Changed native FulfillmentSet deletion callback behavior");
  });
  it.each([0, 1])("rejects narrowed public input in file %s", index => {
    const changed = promoted[index].replace("string[]", "readonly string[]"); expect(changed).not.toBe(promoted[index]);
    expect(() => index === 0 ? verify(changed) : verify(promoted[0], changed)).toThrow("Changed native FulfillmentSet deletion public contract");
  });
  it("rejects changed erased native service type import", () => {
    expect(() => verify(promoted[0], promoted[1].replace('from "@medusajs/types/fulfillment/index"', 'from "@medusajs/types"')))
      .toThrow("Changed native FulfillmentSet deletion public contract");
  });
  it("rejects malformed native callback syntax", () => {
    expect(() => verify(promoted[0], promoted[1].replace("return new StepResponse(void 0, ids)", "return new StepResponse(")))
      .toThrow("Invalid native FulfillmentSet deletion callback syntax");
  });
  it.each(paths.flatMap(file => [
    [file, "source", { source: "third_party/medusa/upstream/packages/core/core-flows/src/fulfillment/steps/delete-service-zones.ts" }],
    [file, "classification", { classification: "selectedExportFacade" }],
  ]))("rejects displaced %s %s", (file, _label, mutation) => {
    expect(() => verifyCurrencyPromotion(root, { ...promotion, files: promotion.files.map(entry =>
      entry.target === "packages/medusa-core-flows/src/" + file ? { ...entry, ...mutation } : entry) }))
      .toThrow("FulfillmentSet deletion adaptation outside its exact pinned source pair");
  });
});

describe("native ServiceZone deletion callback and public input provenance", () => {
  const paths = ["fulfillment/workflows/delete-service-zones.ts", "fulfillment/steps/delete-service-zones.ts"];
  const native = paths.map(file => readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/" + file, "utf8").replace(/\r\n/g, "\n"));
  const promoted = paths.map(file => readFileSync("packages/medusa-core-flows/src/" + file, "utf8").replace(/\r\n/g, "\n"));
  const verify = (workflow = promoted[0], step = promoted[1]) => verifyServiceZoneDeleteCallbacks(native[0], workflow, native[1], step);
  it("admits genuine native root/step/raw inverse and the explicit void wrapper", () => expect(() => verify()).not.toThrow());
  it.each([
    ["identity", '"delete-service-zones-workflow"', '"delete-other-service-zones-workflow"'],
    ["whole raw input", "deleteServiceZonesStep(input.ids)", "deleteServiceZonesStep([])"],
    ["void result", "new WorkflowResponse(void 0)", "new WorkflowResponse([])"],
    ["required wrapper", "return new WorkflowResponse(void 0)", "return undefined"],
    ["direct step import", 'from "../steps/delete-service-zones"', 'from "../steps"'],
    ["extra runtime effect", "    deleteServiceZonesStep(input.ids)", "    console.log(input); deleteServiceZonesStep(input.ids)"],
    ["extra resource import", 'from "../steps/delete-service-zones"', 'from "../steps/delete-service-zones"; import "node:fs"'],
  ])("rejects changed root %s", (_label, before, after) => {
    const changed = promoted[0].replace(before, after); expect(changed).not.toBe(promoted[0]);
    expect(() => verify(changed)).toThrow("Changed native ServiceZone deletion callback behavior");
  });
  it.each([
    ["identity", '"delete-service-zones"', '"delete-other-service-zones"'],
    ["covered metadata", 'compensation: "transactionCovered"', 'compensation: "none"'],
    ["Fulfillment resource", "Modules.FULFILLMENT", "Modules.PRODUCT"],
    ["soft delete", "service.softDeleteServiceZones(ids)", "service.deleteServiceZones(ids)"],
    ["raw forward IDs", "service.softDeleteServiceZones(ids)", "service.softDeleteServiceZones([])"],
    ["forward await", "await service.softDeleteServiceZones", "service.softDeleteServiceZones"],
    ["native void", "new StepResponse(void 0, ids)", "new StepResponse(ids, ids)"],
    ["raw retained IDs", "new StepResponse(void 0, ids)", "new StepResponse(void 0, [])"],
    ["empty inverse", "if (!prevIds?.length)", "if (!prevIds)"],
    ["native restore", "service.restoreServiceZones(prevIds)", "service.softDeleteServiceZones(prevIds)"],
    ["restore raw IDs", "service.restoreServiceZones(prevIds)", "service.restoreServiceZones([])"],
    ["inverse await", "await service.restoreServiceZones", "service.restoreServiceZones"],
    ["extra inverse resource", "    await service.restoreServiceZones", '    container.resolve("query"); await service.restoreServiceZones'],
  ])("rejects changed step %s", (_label, before, after) => {
    const changed = promoted[1].replace(before, after); expect(changed).not.toBe(promoted[1]);
    expect(() => verify(promoted[0], changed)).toThrow("Changed native ServiceZone deletion callback behavior");
  });
  it.each([0, 1])("rejects narrowed public input in file %s", index => {
    const changed = promoted[index].replace("string[]", "readonly string[]"); expect(changed).not.toBe(promoted[index]);
    expect(() => index === 0 ? verify(changed) : verify(promoted[0], changed)).toThrow("Changed native ServiceZone deletion public contract");
  });
  it("rejects changed erased native service type import", () => {
    expect(() => verify(promoted[0], promoted[1].replace('from "@medusajs/types/fulfillment/index"', 'from "@medusajs/types"')))
      .toThrow("Changed native ServiceZone deletion public contract");
  });
  it("rejects malformed native callback syntax", () => {
    expect(() => verify(promoted[0], promoted[1].replace("return new StepResponse(void 0, ids)", "return new StepResponse(")))
      .toThrow("Invalid native ServiceZone deletion callback syntax");
  });
});

describe("native ServiceZone update callback and full public contract provenance", () => {
  const paths = ["fulfillment/workflows/update-service-zones.ts", "fulfillment/steps/update-service-zones.ts"];
  const native = paths.map(file => readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/" + file, "utf8").replace(/\r\n/g, "\n"));
  const promoted = paths.map(file => readFileSync("packages/medusa-core-flows/src/" + file, "utf8").replace(/\r\n/g, "\n"));
  const nativeTypes = readFileSync("third_party/medusa/upstream/packages/core/types/src/workflow/fulfillment/service-zones.ts", "utf8");
  const types = readFileSync("packages/medusa-types/src/workflow/fulfillment/service-zones.ts", "utf8");
  const verify = (workflow = promoted[0], step = promoted[1], publicTypes = types) =>
    verifyServiceZoneUpdateCallbacks(native[0], workflow, native[1], step, nativeTypes, publicTypes);
  it("admits the genuine root, projected originals, update and retained upsert", () => expect(() => verify()).not.toThrow());
  it.each([
    ["identity", '"update-service-zones-workflow"', '"update-other-service-zones-workflow"'],
    ["whole input", "updateServiceZonesStep(input)", "updateServiceZonesStep({})"],
    ["returned result", "new WorkflowResponse(updateServiceZonesStep(input))", "new WorkflowResponse([])"],
    ["direct step import", 'from "../steps/update-service-zones"', 'from "../steps"'],
    ["extra runtime effect", "    return new WorkflowResponse", "    console.log(input); return new WorkflowResponse"],
    ["extra dependency", 'from "../steps/update-service-zones"', 'from "../steps/update-service-zones"; import "node:fs"'],
  ])("rejects changed root %s", (_label, before, after) => {
    const changed = promoted[0].replace(before, after); expect(changed).not.toBe(promoted[0]);
    expect(() => verify(changed)).toThrow("Changed native ServiceZone update callback behavior");
  });
  it.each([
    ["identity", '"update-service-zones"', '"update-other-service-zones"'],
    ["covered metadata", 'compensation: "transactionCovered"', 'compensation: "none"'],
    ["Fulfillment resource", "Modules.FULFILLMENT", "Modules.PRODUCT"],
    ["projection source", "      input.update,", "      {},"],
    ["projection helper", "getSelectsAndRelationsFromObjectArray([", "Object.assign(["],
    ["original selector", "service.listServiceZones(input.selector,", "service.listServiceZones({},"],
    ["select projection", "select: selects", "select: []"],
    ["relation projection", "      relations,", "      relations: [],"],
    ["list await", "await service.listServiceZones", "service.listServiceZones"],
    ["selector update", "service.updateServiceZones(", "service.upsertServiceZones("],
    ["update selector", "      input.selector,", "      {},"],
    ["update patch", "      input.update\n", "      {}\n"],
    ["update await", "await service.updateServiceZones", "service.updateServiceZones"],
    ["returned rows", "new StepResponse(updatedServiceZones, prevData)", "new StepResponse([], prevData)"],
    ["projected retained originals", "new StepResponse(updatedServiceZones, prevData)", "new StepResponse(updatedServiceZones, [])"],
    ["empty inverse", "if (!prevData?.length)", "if (!prevData)"],
    ["genuine upsert inverse", "service.upsertServiceZones(prevData)", "service.createServiceZones(prevData)"],
    ["original inverse input", "service.upsertServiceZones(prevData)", "service.upsertServiceZones([])"],
    ["inverse await", "await service.upsertServiceZones", "service.upsertServiceZones"],
    ["extra inverse resource", "    await service.upsertServiceZones", '    container.resolve("query"); await service.upsertServiceZones'],
  ])("rejects changed step %s", (_label, before, after) => {
    const changed = promoted[1].replace(before, after); expect(changed).not.toBe(promoted[1]);
    expect(() => verify(promoted[0], changed)).toThrow("Changed native ServiceZone update callback behavior");
  });
  it.each([
    [0, "ServiceZoneDTO[]", "readonly ServiceZoneDTO[]"],
    [0, "WorkflowData<FulfillmentWorkflow.UpdateServiceZonesWorkflowInput>", "WorkflowData<never>"],
    [1, "input: FulfillmentWorkflow.UpdateServiceZonesWorkflowInput", "input: never"],
    [0, 'from "@medusajs/types/workflow/fulfillment/service-zones"', 'from "@medusajs/types/workflow/fulfillment/shipping-profiles"'],
    [1, 'from "@medusajs/types/fulfillment/index"', 'from "@medusajs/types"'],
  ])("rejects changed public contract %s", (index, before, after) => {
    const changed = promoted[index].replace(before, after); expect(changed).not.toBe(promoted[index]);
    expect(() => index === 0 ? verify(changed) : verify(promoted[0], changed)).toThrow("Changed native ServiceZone update public contract");
  });
  it.each([
    ["name?: string | null", "name?: string"],
    ["selector: FilterableServiceZoneProps", "selector: never"],
    ["update: UpdateServiceZone", "update: Partial<UpdateServiceZone>"],
    ["id: string", "id?: string"],
  ])("rejects shared public workflow type mutation %s", (before, after) => {
    const changed = types.replace(before, after); expect(changed).not.toBe(types);
    expect(() => verify(promoted[0], promoted[1], changed)).toThrow("Changed native ServiceZone update public contract");
  });
  it("rejects malformed native callback syntax", () => {
    expect(() => verify(promoted[0], promoted[1].replace("return new StepResponse(updatedServiceZones, prevData)", "return new StepResponse(")))
      .toThrow("Invalid native ServiceZone update callback syntax");
  });
  it.each(paths.flatMap(file => [
    [file, "source", { source: "third_party/medusa/upstream/packages/core/core-flows/src/fulfillment/steps/update-shipping-profiles.ts" }],
    [file, "classification", { classification: "selectedExportFacade" }],
  ]))("rejects displaced %s %s", (file, _label, mutation) => {
    expect(() => verifyCurrencyPromotion(root, { ...promotion, files: promotion.files.map(entry =>
      entry.target === "packages/medusa-core-flows/src/" + file ? { ...entry, ...mutation } : entry) }))
      .toThrow("ServiceZone update adaptation outside its exact pinned source pair");
  });
});

describe("native metadata-only relation scalar-field projection provenance", () => {
  const native = readFileSync("third_party/medusa/upstream/packages/database/drizzle/src/medusa.ts", "utf8");
  const owner = readFileSync("packages/medusa-drizzle/src/relation-query.ts", "utf8");
  const offset = owner.indexOf("export function relationScalarFieldPaths(");
  const prefix = owner.slice(0, offset), helper = owner.slice(offset);
  it("admits the exact native helper and metadata-only public seam", () => {
    expect(offset).toBeGreaterThan(0);
    expect(() => verifyNativeRelationScalarFields(native, owner)).not.toThrow();
  });
  it.each([
    ["falsey/true populate", "if (!Array.isArray(populate))", "if (!populate)"],
    ["path splitting", 'path.split(".").filter(Boolean)', 'path.split(".")'],
    ["descriptor lookup", "currentDescriptors.get(part)", "descriptors.get(part)"],
    ["relation ancestry", "if (relationParts.length)", "if (relationParts.length > 1)"],
    ["scalar terminal", '[...relationParts, part].join(".")', '[...relationParts].join(".")'],
    ["raw prefix", 'part.startsWith("raw_")', 'part.startsWith("raw")'],
    ["raw schema membership", "part.slice(4) in currentModel.parse().schema", "part in currentModel.parse().schema"],
    ["raw scalar alias", '[...relationParts, part.slice(4)].join(".")', '[...relationParts, part].join(".")'],
    ["virtual terminal", "parts[parts.length - 1]", "parts[index]"],
    ["virtual depth", "index < parts.length - 1", "index <= parts.length - 1"],
    ["virtual schema membership", "virtualField in currentModel.parse().schema", "part in currentModel.parse().schema"],
    ["virtual scalar alias", '[...relationParts, virtualField].join(".")', '[...relationParts, part].join(".")'],
    ["stop at scalar", "        break", "        continue"],
    ["descendant model", "currentModel = descriptor.targetModel", "currentModel = undefined"],
    ["descendant descriptors", "descriptorsByModel.get(descriptor.relationship.targetModel)", "descriptorsByModel.get(part)"],
    ["native duplicate preservation", "return fields", "return [...new Set(fields)]"],
    ["extra side effect", "return fields", "console.log(fields); return fields"],
  ])("rejects changed helper %s", (_label, before, after) => {
    const changed = helper.replace(before, after); expect(changed).not.toBe(helper);
    expect(() => verifyNativeRelationScalarFields(native, prefix + changed))
      .toThrow("Changed native relation scalar-field extraction");
  });
  it.each([
    ["populate: string[] | boolean | undefined", "populate: string[]"],
    ["descriptors: ReadonlyMap<string, ScalarFieldRelationDescriptor>", "descriptors: Map<string, ScalarFieldRelationDescriptor>"],
    ["schema: Readonly<Record<string, unknown>>", "schema: Readonly<Record<string, string>>"],
    ["readonly targetModel: string", "readonly targetModel: number"],
  ])("rejects public metadata seam mutation %s", (before, after) => {
    const changed = owner.replace(before, after); expect(changed).not.toBe(owner);
    expect(() => verifyNativeRelationScalarFields(native, changed))
      .toThrow("Changed native relation scalar-field public contract");
  });
  it.each([
    owner + "\nfunction relationScalarFieldPaths() {}\n",
    owner.replace("function relationScalarFieldPaths", "function otherProjection"),
  ])("rejects missing/duplicate extraction", changed => {
    expect(() => verifyNativeRelationScalarFields(native, changed))
      .toThrow("Changed native relation scalar-field extraction");
  });
  it.each([
    { source: "third_party/medusa/upstream/packages/database/drizzle/src/schema.ts" },
    { classification: "workflowFork" },
  ])("rejects displaced extraction provenance %j", mutation => {
    expect(() => verifyCurrencyPromotion(root, { ...promotion, files: promotion.files.map(file =>
      file.target === "packages/medusa-drizzle/src/relation-query.ts" ? { ...file, ...mutation } : file) }))
      .toThrow("Native relation projection extraction outside its exact pinned source pair");
  });
});


describe("native LocationFulfillmentSet callback provenance", () => {
  const paths = [
    ["packages/core/core-flows/src/stock-location/workflows/create-location-fulfillment-set.ts", "packages/medusa-core-flows/src/stock-location/workflows/create-location-fulfillment-set.ts"],
    ["packages/core/core-flows/src/fulfillment/steps/create-fulfillment-set.ts", "packages/medusa-core-flows/src/fulfillment/steps/create-fulfillment-set.ts"],
    ["packages/core/core-flows/src/stock-location/steps/associate-locations-with-fulfillment-sets.ts", "packages/medusa-core-flows/src/stock-location/steps/associate-locations-with-fulfillment-sets.ts"],
    ["packages/modules/link-modules/src/definitions/fulfillment-set-location.ts", "packages/medusa-link-modules/src/definitions/fulfillment-set-location.ts"],
    ["packages/core/types/src/workflows/stock-locations/mutations.ts", "packages/medusa-types/src/workflows/stock-locations/mutations.ts"],
  ];
  const native = paths.map(([file]) => readFileSync("third_party/medusa/upstream/" + file, "utf8").replaceAll("\r\n", "\n"));
  const promoted = paths.map(([, file]) => readFileSync(file, "utf8").replaceAll("\r\n", "\n"));
  const verify = (workflow = promoted[0], setStep = promoted[1], association = promoted[2], definition = promoted[3], types = promoted[4]) =>
    verifyLocationFulfillmentSetCallbacks(native[0], workflow, native[1], setStep, native[2], association, native[3], definition, native[4], types);
  it("admits native creation, empty association branches, raw retained endpoints and physical inverse", () => {
    expect(() => verify()).not.toThrow();
  });
  /** @type {Array<[number, string, string, string]>} */
  const runtimeMutations = [
    [0, "root identity", '"create-location-fulfillment-set"', '"other-location-fulfillment-set"'],
    [0, "name forwarding", "name: input.fulfillment_set_data.name", 'name: "other"'],
    [0, "type forwarding", "type: input.fulfillment_set_data.type", 'type: "other"'],
    [0, "ignored supplied fields", "name: input.fulfillment_set_data.name,", 'name: input.fulfillment_set_data.name, id: "invented",'],
    [0, "actual created ID", "[data.fulfillmentSet[0].id]", '["invented"]'],
    [0, "location forwarding", "location_id: data.input.location_id", 'location_id: "other"'],
    [0, "association invocation", "      input: data,", "      input: [],"],
    [0, "root void seam", "return new WorkflowResponse(void 0)", "return new WorkflowResponse(null)"],
    [0, "native step import", 'from "../../fulfillment/steps/create-fulfillment-set"', 'from "../../fulfillment"'],
    [0, "extra resolution", "    const fulfillmentSet =", '    container.resolve("query"); const fulfillmentSet ='],
    [1, "step identity", '"create-fulfillment-sets"', '"create-other-fulfillment-sets"'],
    [1, "mandatory empty creation", "    const service =", "    if (!data.length) return\n    const service ="],
    [1, "module capability", "Modules.FULFILLMENT", "Modules.STOCK_LOCATION"],
    [1, "create arguments", "service.createFulfillmentSets(data)", "service.createFulfillmentSets([])"],
    [1, "create await", "await service.createFulfillmentSets(data)", "service.createFulfillmentSets(data)"],
    [1, "actual output", "      createSets,", "      [],"],
    [1, "retained created IDs", "createSets.map((createdSet) => createdSet.id)", "[]"],
    [1, "inverse empty guard", "if (!createSetIds?.length)", "if (!createSetIds)"],
    [1, "physical inverse", "service.deleteFulfillmentSets(createSetIds)", "service.softDeleteFulfillmentSets(createSetIds)"],
    [1, "inverse await", "await service.deleteFulfillmentSets(createSetIds)", "service.deleteFulfillmentSets(createSetIds)"],
    [2, "association identity", '"associate-fulfillment-sets-with-location-step"', '"other-fulfillment-sets-with-location-step"'],
    [2, "empty outer guard", "if (!data.input.length)", "if (!data.input)"],
    [2, "empty outer response", "new StepResponse([], [])", "new StepResponse([], undefined)"],
    [2, "raw flatten order", "      .flat()", "      .flat().reverse()"],
    [2, "Location endpoint", "stock_location_id: link.location_id", 'stock_location_id: "other"'],
    [2, "Set endpoint", "fulfillment_set_id: id", 'fulfillment_set_id: "other"'],
    [2, "Link capability", "ContainerRegistrationKeys.LINK", "ContainerRegistrationKeys.QUERY"],
    [2, "mandatory empty inner call", "    const createdLinks =", "    if (!links.length) return new StepResponse([], [])\n    const createdLinks ="],
    [2, "create arguments", "remoteLink.create(links)", "remoteLink.create([])"],
    [2, "create await", "await remoteLink.create(links)", "remoteLink.create(links)"],
    [2, "retained raw definitions", "new StepResponse(createdLinks, links)", "new StepResponse(createdLinks, createdLinks)"],
    [2, "actual created output", "new StepResponse(createdLinks, links)", "new StepResponse(links, links)"],
    [2, "inverse empty guard", "if (!links?.length)", "if (!links)"],
    [2, "native dismiss inverse", "remoteLink.dismiss(links)", "remoteLink.delete(links)"],
    [2, "inverse await", "await remoteLink.dismiss(links)", "remoteLink.dismiss(links)"],
    [3, "native Link identity", 'idPrefix: "locfs"', 'idPrefix: "other"'],
    [3, "native Link registration", "isLink: true", "isLink: false"],
    [3, "native table identity", 'tableName: "location_fulfillment_set"', 'tableName: "other"'],
    [3, "endpoint primary keys", '["id", "stock_location_id", "fulfillment_set_id"]', '["id", "stock_location_id"]'],
    [3, "cascade authority", "deleteCascade: true", "deleteCascade: false"],
    [3, "native relationship cardinality", "hasMany: true", "hasMany: false"],
    [3, "native extension cardinality", "isList: true", "isList: false"],
    [3, "native Set endpoint", 'foreignKey: "fulfillment_set_id"', 'foreignKey: "stock_location_id"'],
    [3, "native Location endpoint", 'foreignKey: "stock_location_id"', 'foreignKey: "fulfillment_set_id"'],
    [3, "native alias", 'alias: "locations_link"', 'alias: "other_link"'],
    [3, "canonical link name", 'composeLinkName(Modules.STOCK_LOCATION, "stock_location_id", Modules.FULFILLMENT, "fulfillment_set_id")', 'composeLinkName(Modules.STOCK_LOCATION, "id", Modules.FULFILLMENT, "fulfillment_set_id")'],
    ...[1, 2].flatMap(index => {
      /** @type {Array<[number, string, string, string]>} */
      const mutations = [[index, "covered compensation metadata", 'compensation: "transactionCovered"', 'compensation: "none"']];
      return mutations;
    }),
    ...[0, 1, 2].flatMap(index => {
      /** @type {Array<[number, string, string, string]>} */
      const mutations = [[index, "runtime SDK import", 'from "@medusajs/workflows-sdk"', 'from "@medusajs/framework/workflows-sdk"']];
      return mutations;
    }),
    ...[0, 1, 2, 3].flatMap(index => {
      /** @type {Array<[number, string, string, string]>} */
      const mutations = [[index, "extra backend import", "import ", 'import "node:fs";\nimport ']];
      return mutations;
    }),
  ];
  it.each(runtimeMutations)("rejects changed runtime %s %s", (index, _label, before, after) => {
    const changed = promoted[index].replace(before, after); expect(changed).not.toBe(promoted[index]);
    const values = [...promoted]; values[index] = changed;
    expect(() => verify(values[0], values[1], values[2], values[3], values[4])).toThrow("Changed native LocationFulfillmentSet callback behavior");
  });
  it.each([
    [0, "WorkflowData<CreateLocationFulfillmentSetWorkflowInputDTO>", "WorkflowData<never>"],
    [0, 'from "@medusajs/types/workflows/stock-locations/mutations"', 'from "@medusajs/framework/types"'],
    [1, "CreateFulfillmentSetDTO[]", "ReadonlyArray<CreateFulfillmentSetDTO>"],
    [1, "data: CreateFulfillmentSetsStepInput", "data: never"],
    [1, "container.resolve<IFulfillmentModuleService>", "container.resolve<never>"],
    [2, "location_id: string", "location_id?: string"],
    [2, "fulfillment_set_ids: string[]", "fulfillment_set_ids: string"],
    [2, 'Pick<Link, "create" | "dismiss">', 'Pick<Link, "create">'],
    [3, "LocationFulfillmentSet: ModuleJoinerConfig", "LocationFulfillmentSet: never"],
    [4, "location_id: string", "location_id?: string"],
    [4, "fulfillment_set_data: {", "fulfillment_set_data?: {"],
    [4, "name: string", "name: string | null"],
    [4, "type: string", "type: number"],
  ])("rejects changed public contract %s %s", (index, before, after) => {
    const changed = promoted[index].replace(before, after); expect(changed).not.toBe(promoted[index]);
    const values = [...promoted]; values[index] = changed;
    expect(() => verify(values[0], values[1], values[2], values[3], values[4])).toThrow("Changed native LocationFulfillmentSet public contract");
  });
  it.each([0, 1, 2, 3, 4])("rejects malformed syntax in file %s", index => {
    const values = [...promoted]; values[index] += "\nconst invalid = (";
    expect(() => verify(values[0], values[1], values[2], values[3], values[4])).toThrow("Invalid native LocationFulfillmentSet callback syntax");
  });
  it.each(["removed", "widened", "relocated", "duplicated"])("rejects a %s first-result type seam", mutation => {
    const comment = "// @ts-expect-error Native creation assumes a first Set; preserve its missing-first property-read failure.";
    const changed = mutation === "removed" ? promoted[0].replace(comment, "") :
      mutation === "widened" ? promoted[0].replace("@ts-expect-error", "@ts-ignore") :
        mutation === "relocated" ? promoted[0].replace(comment, "") + "\n" + comment + "\n" :
          promoted[0] + "\n" + comment + "\n";
    expect(changed).not.toBe(promoted[0]);
    expect(() => verify(changed)).toThrow("Changed native LocationFulfillmentSet first-result type seam");
  });
  it.each(paths.flatMap(([, target], index) => [
    [target, index, "source", { source: "third_party/medusa/upstream/packages/core/core-flows/src/fulfillment/steps/create-shipping-profiles.ts" }],
    [target, index, "classification", { classification: "selectedExportFacade" }],
  ]))("rejects displaced %s %s %s", (target, index, _label, mutation) => {
    const failure = index === 4 ? "LocationFulfillmentSet workflow type outside its exact unchanged pinned source" :
      index === 3 ? "LocationFulfillmentSet definition adaptation outside its exact pinned source pair" :
        "LocationFulfillmentSet workflow adaptation outside its exact pinned source pair";
    expect(() => verifyCurrencyPromotion(root, { ...promotion, files: promotion.files.map(entry =>
      entry.target === target ? { ...entry, ...mutation } : entry) })).toThrow(failure);
  });
});

describe("native ShippingOptionRule batch callback provenance", () => {
  const paths = ["fulfillment/workflows/batch-shipping-option-rules.ts",
    ...["create", "update", "delete"].map(kind => "fulfillment/steps/" + kind + "-shipping-option-rules.ts")];
  const native = paths.map(file => readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/" + file, "utf8").replaceAll("\r\n", "\n"));
  const promoted = paths.map(file => readFileSync("packages/medusa-core-flows/src/" + file, "utf8").replaceAll("\r\n", "\n"));
  const verify = (workflow = promoted[0], create = promoted[1], update = promoted[2], deleted = promoted[3]) =>
    verifyShippingOptionRuleBatchCallbacks(native[0], workflow, native[1], create, native[2], update, native[3], deleted);
  it("admits unchanged parallel branches, empty absence and actual retained physical inverses", () => {
    expect(() => verify()).not.toThrow();
  });
  it.each([
    ["root identity", '"batch-shipping-option-rules"', '"batch-other-shipping-option-rules"'],
    ["create transform", "createInput: { data: create ?? [] }", "createInput: { data: [] }"],
    ["update transform", "updateInput: { data: update ?? [] }", "updateInput: { data: [] }"],
    ["delete transform", "deleteInput: { ids: del ?? [] }", "deleteInput: { ids: [] }"],
    ["nullish behavior", "create ?? []", "create || []"],
    ["branch identity", "const [created, updated, deleted]", "const [updated, created, deleted]"],
    ["create branch", "createShippingOptionRulesStep(actionInputs.createInput)", "createShippingOptionRulesStep(actionInputs.updateInput)"],
    ["update branch", "updateShippingOptionRulesStep(actionInputs.updateInput)", "updateShippingOptionRulesStep(actionInputs.createInput)"],
    ["delete branch", "deleteShippingOptionRulesStep(actionInputs.deleteInput)", "deleteShippingOptionRulesStep({ ids: [] })"],
    ["omitted branch", "      deleteShippingOptionRulesStep(actionInputs.deleteInput)\n", ""],
    ["result", "transform({ created, deleted, updated },", "transform({ created, deleted },"],
    ["direct step import", 'from "../steps/create-shipping-option-rules"', 'from "../steps"'],
    ["runtime SDK seam", 'from "@medusajs/workflows-sdk"', 'from "@medusajs/framework/workflows-sdk"'],
    ["extra dependency", 'from "../steps/delete-shipping-option-rules"', 'from "../steps/delete-shipping-option-rules"; import "node:fs"'],
  ])("rejects changed root %s", (_label, before, after) => {
    const changed = promoted[0].replace(before, after); expect(changed).not.toBe(promoted[0]);
    expect(() => verify(changed)).toThrow("Changed native ShippingOptionRule batch callback behavior");
  });
  /** @type {Array<[number, string, string, string]>} */
  const stepMutations = [
    [1, "step identity", '"create-shipping-option-rules"', '"create-other-shipping-option-rules"'],
    [1, "mandatory empty create", "    const { data } = input", "    if (!input.data?.length) return\n    const { data } = input"],
    [1, "create arguments", "fulfillmentModule.createShippingOptionRules(data)", "fulfillmentModule.createShippingOptionRules([])"],
    [1, "create await", "await fulfillmentModule.createShippingOptionRules", "fulfillmentModule.createShippingOptionRules"],
    [1, "actual output", "      createdShippingOptionRules,", "      [],"],
    [1, "retained IDs", "createdShippingOptionRules.map((pr) => pr.id)", "[]"],
    [1, "inverse empty guard", "if (!ruleIds?.length)", "if (!ruleIds)"],
    [1, "physical inverse", "fulfillmentModule.deleteShippingOptionRules(ruleIds)", "fulfillmentModule.softDeleteShippingOptionRules(ruleIds)"],
    [1, "inverse await", "await fulfillmentModule.deleteShippingOptionRules", "fulfillmentModule.deleteShippingOptionRules"],
    [2, "empty update absence", "if (!input.data?.length)", "if (!input.data)"],
    [2, "projected preimage", 'select: ["id", "attribute", "operator", "value", "shipping_option_id"]', 'select: ["id", "attribute", "operator"]'],
    [2, "preimage selector", "{ id: ids }", "{ id: [] }"],
    [2, "preimage await", "await fulfillmentModule.listShippingOptionRules", "fulfillmentModule.listShippingOptionRules"],
    [2, "update arguments", "fulfillmentModule.updateShippingOptionRules(data)", "fulfillmentModule.updateShippingOptionRules([])"],
    [2, "retained preimage", "shippingOptionRules as unknown as UpdateShippingOptionRuleDTO[]", "[] as unknown as UpdateShippingOptionRuleDTO[]"],
    [2, "actual output", "      updatedPromotionRules,", "      shippingOptionRules,"],
    [2, "inverse empty guard", "if (!previousRulesData?.length)", "if (!previousRulesData)"],
    [2, "inverse update", "fulfillmentModule.updateShippingOptionRules(previousRulesData)", "fulfillmentModule.upsertShippingOptionRules(previousRulesData)"],
    [2, "inverse await", "await fulfillmentModule.updateShippingOptionRules(previousRulesData)", "fulfillmentModule.updateShippingOptionRules(previousRulesData)"],
    [3, "empty delete absence", "if (!input.ids?.length)", "if (!input.ids)"],
    [3, "projected preimage", 'select: ["attribute", "operator", "value", "shipping_option_id"]', 'select: ["attribute", "operator", "value"]'],
    [3, "native implicit ID selection", 'select: ["attribute", "operator", "value", "shipping_option_id"]', 'select: ["id", "attribute", "operator", "value", "shipping_option_id"]'],
    [3, "physical deletion", "fulfillmentModule.deleteShippingOptionRules(ids)", "fulfillmentModule.softDeleteShippingOptionRules(ids)"],
    [3, "delete await", "await fulfillmentModule.deleteShippingOptionRules(ids)", "fulfillmentModule.deleteShippingOptionRules(ids)"],
    [3, "raw requested output", "new StepResponse(ids, shippingOptionRules)", "new StepResponse([], shippingOptionRules)"],
    [3, "actual retained rows", "new StepResponse(ids, shippingOptionRules)", "new StepResponse(ids, [])"],
    [3, "inverse empty guard", "if (!shippingOptionRules?.length)", "if (!shippingOptionRules)"],
    [3, "native recreation", "await fulfillmentModule.createShippingOptionRules(", "await fulfillmentModule.upsertShippingOptionRules("],
    [3, "recreation await", "await fulfillmentModule.createShippingOptionRules(", "fulfillmentModule.createShippingOptionRules("],
    [3, "original ID", "id: rule.id", 'id: "new-rule"'],
    [3, "original attribute", "attribute: rule.attribute", 'attribute: "other"'],
    [3, "original operator", "operator: rule.operator as RuleOperatorType", 'operator: "eq" as RuleOperatorType'],
    [3, "original value", "value: rule.value as unknown as string | string[]", 'value: "other" as unknown as string | string[]'],
    [3, "original owner", "shipping_option_id: rule.shipping_option_id", 'shipping_option_id: "other-option"'],
    [3, "invented timestamp restoration", "id: rule.id,", "id: rule.id, created_at: rule.created_at,"],
    ...[1, 2, 3].flatMap(index => {
      /** @type {Array<[number, string, string, string]>} */
      const sharedMutations = [
        [index, "covered metadata", 'compensation: "transactionCovered"', 'compensation: "none"'],
        [index, "Fulfillment capability", "Modules.FULFILLMENT", "Modules.PRODUCT"],
        [index, "extra inverse resolution", "    const fulfillmentModule = container.resolve", '    container.resolve("query"); const fulfillmentModule = container.resolve'],
      ];
      return sharedMutations;
    }),
  ];
  it.each(stepMutations)("rejects changed step %s %s", (index, _label, before, after) => {
    const changed = promoted[index].replace(before, after); expect(changed).not.toBe(promoted[index]);
    const values = [...promoted]; values[index] = changed;
    expect(() => verify(values[0], values[1], values[2], values[3])).toThrow("Changed native ShippingOptionRule batch callback behavior");
  });
  it.each([
    [0, "extends BatchWorkflowInput<", "extends Partial<"],
    [0, "extends BatchWorkflowOutput<ShippingOptionRuleDTO>", "extends BatchWorkflowOutput<never>"],
    [0, "WorkflowData<BatchShippingOptionRulesInput>", "WorkflowData<never>"],
    [0, "WorkflowResponse<BatchShippingOptionRulesComposerResult>", "WorkflowResponse<BatchShippingOptionRulesOutput>"],
    [0, "WorkflowResponse<BatchShippingOptionRulesComposerResult>", "WorkflowResponse<never>"],
    [0, "): WorkflowResponse<BatchShippingOptionRulesComposerResult> => {", ") => {"],
    [0, 'created: BatchShippingOptionRulesOutput["created"]', 'created: BatchShippingOptionRulesOutput["created"] | undefined'],
    [0, 'updated: BatchShippingOptionRulesOutput["updated"] | undefined', 'updated: BatchShippingOptionRulesOutput["updated"]'],
    [0, 'deleted: BatchShippingOptionRulesOutput["deleted"] | undefined', 'deleted: BatchShippingOptionRulesOutput["deleted"]'],
    [0, "extends BatchWorkflowOutput<ShippingOptionRuleDTO>", "extends Partial<BatchWorkflowOutput<ShippingOptionRuleDTO>>"],
    [0, 'from "@medusajs/types/fulfillment/index"', 'from "@medusajs/framework/types"'],
    [1, "input: AddFulfillmentShippingOptionRulesWorkflowDTO", "input: never"],
    [2, "input: UpdateFulfillmentShippingOptionRulesWorkflowDTO", "input: never"],
    [2, "as unknown as UpdateShippingOptionRuleDTO[]", "as unknown as never[]"],
    [3, "input: RemoveFulfillmentShippingOptionRulesWorkflowDTO", "input: never"],
    [3, 'from "@medusajs/types/common/rule"', 'from "@medusajs/framework/types"'],
    [3, "as RuleOperatorType", "as string"],
    [3, "as unknown as string | string[]", "as unknown as string"],
  ])("rejects changed erased public contract %s %s", (index, before, after) => {
    const changed = promoted[index].replace(before, after); expect(changed).not.toBe(promoted[index]);
    const values = [...promoted]; values[index] = changed;
    expect(() => verify(values[0], values[1], values[2], values[3])).toThrow("Changed native ShippingOptionRule batch public contract");
  });
  it.each([0, 1, 2, 3])("rejects malformed syntax in file %s", index => {
    const changed = promoted[index] + "\nconst invalid = (";
    const values = [...promoted]; values[index] = changed;
    expect(() => verify(values[0], values[1], values[2], values[3])).toThrow("Invalid native ShippingOptionRule batch callback syntax");
  });
  it.each(paths.flatMap(file => [
    [file, "source", { source: "third_party/medusa/upstream/packages/core/core-flows/src/fulfillment/steps/create-shipping-profiles.ts" }],
    [file, "classification", { classification: "selectedExportFacade" }],
  ]))("rejects displaced %s %s", (file, _label, mutation) => {
    expect(() => verifyCurrencyPromotion(root, { ...promotion, files: promotion.files.map(entry =>
      entry.target === "packages/medusa-core-flows/src/" + file ? { ...entry, ...mutation } : entry) }))
      .toThrow("ShippingOptionRule batch adaptation outside its exact pinned source pair");
  });
});
