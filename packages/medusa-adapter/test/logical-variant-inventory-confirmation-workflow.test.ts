import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Effect, Result, Schema } from "effect";
import { InventoryModuleService, InventoryLevelService } from "@medusajs/inventory/services";
import { PricingModuleService } from "@medusajs/pricing/services";
import { defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { variantInventoryConfirmationResources } from "../src/workflow/policy";
import { VariantItemPricingCalculationOutput } from "../src/modules/pricing/calculation";
import { ExactNumericRaw } from "../src/value/exact-numeric";
import { MathBN } from "@medusajs/framework/utils/portable";
import { getVariantsAndItemsWithPrices } from "@medusajs/core-flows/cart/get-variants-and-items-with-prices";
import { confirmVariantInventoryWorkflow } from "@medusajs/core-flows/cart/confirm-variant-inventory";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { getAtomicCommerceParticipant } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import type { AtomicWorkflowHostComposition } from "../src/workflow/host";
import { prepareLogicalVariantInventoryConfirmation } from "./support/logical-variant-inventory-confirmation-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [], caseCleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalVariantInventoryConfirmation>>;
type Seed = Awaited<ReturnType<Awaited<ReturnType<typeof prepareLogicalVariantInventoryConfirmation>>["seed"]>>;
type Host = Awaited<ReturnType<Awaited<ReturnType<typeof prepareLogicalVariantInventoryConfirmation>>["prepare"]>>;
type Input = Parameters<Host["run"]>[1];
let baseline: Seed;
const first = <Value>(values: readonly Value[]) => {
  const value = values[0]; if (value === undefined) throw new Error("Missing genuine native confirmation fixture output"); return value;
};
const input = (seed: Seed, items?: Input["items"]): Input => ({ cart: { id: "confirmation-cart", currency_code: "usd" },
  sales_channel_id: "root-channel-0", setPricingContextResult: {},
  items: items ?? seed.variants.map((variant, index) => ({ id: "confirmation-line-" + index, variant_id: variant.id, quantity: 1 })) });
const snapshot = () => logicalCurrencyInventory(connected.fixture);
const unchangedData = (before: Awaited<ReturnType<typeof snapshot>>, after: Awaited<ReturnType<typeof snapshot>>) => {
  for (const key of ["rows", "revisions", "indexEntries", "indexRevisions", "uniqueKeys", "searchEntries", "searchBuilds",
    "indexBuilds", "uniqueBuilds", "rowChanges", "events", "physicalFacts", "initialization"] as const)
    expect(after[key], key).toEqual(before[key]);
};
function failureMessages(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? failureMessages(reason.error)
    : reason._tag === "Die" ? failureMessages(reason.defect) : ["Interrupt"]);
  if (!(value instanceof Error)) return [];
  return [value.name, value.message, ...("reason" in value && typeof value.reason === "string" ? [value.reason] : []),
    ...("type" in value && typeof value.type === "string" ? [value.type] : []), ...failureMessages(value.cause)];
}
async function refused(work: Effect.Effect<unknown, unknown>, message: string) {
  const before = await snapshot(), outcome = await Effect.runPromise(Effect.result(work));
  if (Result.isSuccess(outcome)) throw new Error("Native confirmation unexpectedly succeeded");
  const messages = failureMessages(outcome.failure);
  expect(messages.some(value => value.includes(message)), messages.join("\n")).toBe(true);
  expect(await snapshot()).toEqual(before);
  return outcome.failure;
}
const prepare = async (candidateCallLimit?: number) => {
  const host = await connected.prepare(candidateCallLimit);
  caseCleanup.push(() => Effect.runPromise(host.close));
  return host;
};
async function run(host: Host, value: Input, limit: number) {
  const before = await snapshot(); let calls = 0, outcome: "Success" | "Failure" = "Failure";
  try {
    const result = await Effect.runPromise(host.run(host.newRequestKey(), value).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, observed) => { if (name === "BoundedRequest.enter") calls++; return observed; },
    })));
    outcome = "Success";
    expect(calls).toBeLessThanOrEqual(limit);
    unchangedData(before, await snapshot());
    return result;
  } finally {
    // Keep the actual measured failure at the unchanged candidate limit.
    console.info("Candidate native graph and inventory confirmation", { driver, items: value.items?.length ?? 0, calls, limit, outcome });
  }
}

const jsonObject = Schema.decodeUnknownSync(Schema.JsonObject), jsonObjects = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const exactRaw = Schema.decodeUnknownSync(ExactNumericRaw), text = Schema.decodeUnknownSync(Schema.String);
function expectedCombinedSale(setId: string, sale: { readonly list: JsonObject; readonly price: JsonObject }, original: JsonObject,
  originalAmount: number, saleMinimum: number | null, saleMaximum: number | null, originalMinimum: number | null, originalMaximum: number | null) {
  return { id: setId, is_calculated_price_price_list: true, is_calculated_price_tax_inclusive: true,
    calculated_amount: 7, raw_calculated_amount: exactRaw(sale.price.raw_amount),
    is_original_price_price_list: false, is_original_price_tax_inclusive: false,
    original_amount: originalAmount, raw_original_amount: exactRaw(original.raw_amount), currency_code: "usd",
    calculated_price: { id: text(sale.price.id), price_list_id: text(sale.list.id), price_list_type: "sale",
      min_quantity: saleMinimum, max_quantity: saleMaximum },
    original_price: { id: text(original.id), price_list_id: null, price_list_type: null,
      min_quantity: originalMinimum, max_quantity: originalMaximum } };
}

describe("connected native Variant graph and Inventory confirmation", () => {
  beforeAll(async () => {
    connected = await prepareLogicalVariantInventoryConfirmation(driver, close => cleanup.push(close));
    baseline = await connected.seed("confirmation-default");
  }, 180_000);
  afterEach(async () => {
    const failures: unknown[] = [];
    try {
      for (const close of caseCleanup.splice(0).reverse()) {
        try { await close(); } catch (error) { failures.push(error); }
      }
    } finally { vi.restoreAllMocks(); }
    if (failures.length) throw new AggregateError(failures, "Unable to close confirmation case hosts");
  }, 120_000);
  afterAll(async () => {
    const failures: unknown[] = [];
    for (const close of cleanup.splice(0).reverse()) {
      try { await close(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, "Unable to close confirmation fixtures");
  }, 120_000);

  it("preserves the original 64-call refusal without publishing a partial graph", async () => {
    const host = await prepare(64);
    await refused(host.run(host.newRequestKey(), input(baseline)), "limitExceeded");
  }, 180_000);

  it("uses one Inventory participant for genuine graph reads and native confirmation", async () => {
    const captures: AtomicWorkflowHostComposition[] = [];
    const host = await connected.prepare(undefined, { ...connected.execution, prepare: composition => {
      captures.push(composition); return connected.execution.prepare(composition);
    } });
    caseCleanup.push(() => Effect.runPromise(host.close));
    const composition = first(captures);
    expect(composition.participants).toHaveLength(9);
    expect(composition.participants.map(member => getAtomicCommerceParticipant(member.participant)).filter(name => name?.includes("inventory")))
      .toEqual(["inventory_graph"]);
    expect(composition.requestParticipantLimit).toBe(9);
    expect(composition.requestCallLimit).toBe(256);
    expect(variantInventoryConfirmationResources).toEqual({ ...defaultCommerceResources, calls: 256 });
    expect(composition).not.toHaveProperty("requestEventLimit");
    expect(composition).not.toHaveProperty("events");
    const confirm = vi.spyOn(InventoryModuleService.prototype, "confirmInventory"), available = vi.spyOn(InventoryLevelService.prototype, "getAvailableQuantity");
    const value = input(baseline), original = structuredClone(value), result = await run(host, value, 256);
    expect(value).toEqual(original);
    expect(result.variants.map(variant => variant.id)).toEqual(baseline.variants.map(variant => variant.id));
    expect(result.lineItems).toHaveLength(1);
    expect(result.inventory.items).toEqual(baseline.inventoryLinks.map(link => ({ id: "confirmation-line-0", inventory_item_id: link.inventory_item_id,
      required_quantity: link.required_quantity, allow_backorder: false, quantity: 1, location_ids: baseline.locations.map(location => location.id) })));
    expect(confirm).toHaveBeenCalledTimes(2); expect(available).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls.map(call => call[0])).toEqual(baseline.inventoryLinks.map(link => link.inventory_item_id));
  }, 180_000);

  it("passes duplicate original Items separately and retains their exact quantities", async () => {
    const host = await prepare(256), variant = first(baseline.variants);
    const confirm = vi.spyOn(InventoryModuleService.prototype, "confirmInventory");
    const quantities = ["0.50000000000000000000001", "0.5"];
    const result = await run(host, input(baseline, quantities.map((quantity, index) => ({
      id: "duplicate-" + index, variant_id: variant.id, quantity }))), 256);
    expect(result.inventory.items.map(item => item.id)).toEqual(["duplicate-0", "duplicate-0", "duplicate-1", "duplicate-1"]);
    expect(result.inventory.items.map(item => item.quantity)).toEqual([quantities[0], quantities[0], quantities[1], quantities[1]]);
    expect(confirm).toHaveBeenCalledTimes(4);
    for (const [index, call] of confirm.mock.calls.entries()) {
      const quantity = quantities[Math.floor(index / 2)], link = baseline.inventoryLinks[index % 2];
      if (quantity === undefined || link === undefined) throw new Error("Missing original duplicate Item/Link pair");
      expect(MathBN.eq(call[2], MathBN.mult(quantity, link.required_quantity))).toBe(true);
    }
  }, 180_000);

  it("prefers sufficient individual Locations and falls back to the native aggregate", async () => {
    const host = await prepare(256), variant = first(baseline.variants);
    const selected = baseline.inventoryLinks.find(link => link.required_quantity === 3);
    const preferred = baseline.locations[1];
    if (selected === undefined || preferred === undefined) throw new Error("Missing genuine preferred-Location fixture endpoints");
    const available = vi.spyOn(InventoryLevelService.prototype, "getAvailableQuantity");
    const enoughAtOne = await run(host, input(baseline, [{ variant_id: variant.id, quantity: 7 }]), 256);
    expect(enoughAtOne.inventory.items.find(item => item.inventory_item_id === selected.inventory_item_id)?.location_ids).toEqual([preferred.id]);
    expect(available.mock.calls.find(call => call[0] === selected.inventory_item_id)?.[1]).toEqual([preferred.id]);
    available.mockClear();
    // Neither Location alone has the 30 required units, while their complete
    // active aggregate does. The original native helper selects both Locations.
    const aggregate = await run(host, input(baseline, [{ variant_id: variant.id, quantity: 10 }]), 256);
    expect(aggregate.inventory.items.find(item => item.inventory_item_id === selected.inventory_item_id)?.location_ids)
      .toEqual(baseline.locations.map(location => location.id));
    expect(available.mock.calls.find(call => call[0] === selected.inventory_item_id)?.[1]).toEqual(baseline.locations.map(location => location.id));
    // Incoming stock exists in this genuine fixture but never covers demand.
    await refused(host.run(host.newRequestKey(), input(baseline, [{ variant_id: variant.id, quantity: 14.2 }])),
      "Some variant does not have the required inventory");
  }, 180_000);

  it("preserves the exact over-20-digit insufficiency after real native stock adjustments", async () => {
    const seed = await connected.seed("confirmation-precision"), selectedItem = first(seed.items);
    const levels = seed.levels.filter(level => level.inventory_item_id === selectedItem.id);
    const firstLevel = first(levels), secondLevel = levels[1];
    if (secondLevel === undefined) throw new Error("Missing genuine second Location Level");
    // The genuine reservation is 0.125 at the first Location. Leave exactly 2
    // available units there and zero at the second, using admitted native writes.
    await connected.adjust([{ inventory_item_id: selectedItem.id, location_id: firstLevel.location_id, adjustment: 2.125 - firstLevel.stocked_quantity },
      { inventory_item_id: selectedItem.id, location_id: secondLevel.location_id, adjustment: -secondLevel.stocked_quantity }]);
    const host = await prepare(256), variant = first(seed.variants);
    await refused(host.run(host.newRequestKey(), input(seed, [{ id: "exact-shortage", variant_id: variant.id, quantity: "1.000000000000000000001" }])),
      "Some variant does not have the required inventory");
    const result = await run(host, input(seed, [{ id: "exact-fit", variant_id: variant.id, quantity: "1" }]), 256);
    expect(result.inventory.items).toHaveLength(2);
  }, 180_000);

  it("retains the native Sales Channel, missing Variant and unpublished Product errors", async () => {
    const host = await prepare(256);
    await refused(host.run(host.newRequestKey(), { ...input(baseline), sales_channel_id: "unlinked-channel" }), "is not associated with any stock location");
    await refused(host.run(host.newRequestKey(), input(baseline, [{ variant_id: "missing-variant", quantity: 1 }])), "do not exist or belong to a product");
    const draft = await connected.seed("confirmation-draft", { status: "draft" });
    await refused(host.run(host.newRequestKey(), input(draft)), "do not exist or belong to a product");
    await refused(host.run(host.newRequestKey(), input(baseline, [{ variant_id: first(baseline.variants).id, quantity: 1_000 }])),
      "Some variant does not have the required inventory");
  }, 180_000);

  it("runs the native empty-create branch with omitted original Items", async () => {
    const host = await prepare(256), confirm = vi.spyOn(InventoryModuleService.prototype, "confirmInventory");
    const result = await run(host, { cart: { currency_code: "usd" }, setPricingContextResult: {}, sales_channel_id: "root-channel-0" }, 256);
    expect(result).toEqual({ variants: [], lineItems: [], inventory: { items: [] } });
    expect(confirm).not.toHaveBeenCalled();
  }, 180_000);

  it("probes the complete Pricing cohort with four Variants and eight confirmations", async () => {
    const complete = await connected.seedCompletePricing("confirmation-full-pricing", "split-sets"), seed = complete.seed;
    expect(seed.variants).toHaveLength(4); expect(seed.inventoryLinks).toHaveLength(8);
    expect(seed.items).toHaveLength(4); expect(seed.levels).toHaveLength(16); expect(complete.lists).toHaveLength(4);
    expect(complete.listPrices).toHaveLength(8); expect(complete.preferences).toHaveLength(2);
    expect(complete.lists.flatMap(list => jsonObjects(list.price_list_rules))).toHaveLength(8);
    expect(complete.listPrices.flatMap(entry => jsonObjects(entry.price.price_rules))).toHaveLength(16);
    const host = await prepare(256), pricing = vi.spyOn(PricingModuleService.prototype, "calculatePrices");
    const confirm = vi.spyOn(InventoryModuleService.prototype, "confirmInventory");
    const value: Input = { ...input(seed, seed.variants.map((variant, index) => ({
      id: "full-pricing-line-" + index, variant_id: variant.id, quantity: index + 1,
    }))), cart: complete.cart, setPricingContextResult: complete.setPricingContextResult };
    const result = await run(host, value, 256);
    expect(pricing).toHaveBeenCalledTimes(4); expect(confirm).toHaveBeenCalledTimes(8);
    for (const [index, variant] of seed.variants.entries()) {
      const priceSet = seed.priceSetLinks.find(link => link.variant_id === variant.id);
      if (priceSet === undefined) throw new Error("Missing combined native Variant Price Set");
      const sale = complete.listPrices.find(entry => entry.list.type === "sale" && entry.price.price_set_id === priceSet.price_set_id);
      const originalAmount = index === 0 ? 10 : 8, original = variant.prices.find(price => price.amount === originalAmount);
      if (sale === undefined || original === undefined) throw new Error("Missing complete native Pricing preimage");
      const expected = expectedCombinedSale(priceSet.price_set_id, sale, original, originalAmount, null, null, index === 0 ? null : 2, index === 0 ? null : 10);
      const returnedVariant = result.variants.find(row => row.id === variant.id), returnedLine = result.lineItems[index], nativeCall = pricing.mock.results[index];
      if (returnedVariant === undefined || returnedLine === undefined || nativeCall?.type !== "return") throw new Error("Missing actual native Pricing context result");
      expect(returnedVariant.calculated_price).toEqual(expected);
      expect(Schema.decodeUnknownSync(VariantItemPricingCalculationOutput)(await nativeCall.value)).toEqual([expected]);
      expect(returnedLine.data).toMatchObject({ quantity: index + 1, unit_price: 7, compare_at_unit_price: originalAmount, is_tax_inclusive: true });
    }
    expect(pricing.mock.calls.map(call => call[1]?.context?.quantity)).toEqual([1, 2, 3, 4]);
    expect(pricing.mock.calls.map(call => call[0].id)).toEqual(seed.priceSetLinks.map(link => [link.price_set_id]));
    for (const call of pricing.mock.calls) expect(call[1]).toMatchObject({ context: {
      customer: complete.cart.customer, region: complete.cart.region, custom_segment159: "vip159", is_custom_price: false,
    } });
    expect(result.inventory.items).toHaveLength(8);
  }, 180_000);

  it("probes sixteen confirmations and four distinct contexts over all four relevant native Price Lists", async () => {
    const complete = await connected.seedCompletePricing("confirmation-repeated-pricing", "one-set-bands"), seed = complete.seed, variant = first(seed.variants);
    const existing = seed.inventoryLinks.filter(link => link.variant_id === variant.id);
    const additional = seed.items.filter(item => !existing.some(link => link.inventory_item_id === item.id));
    expect(existing).toHaveLength(2); expect(additional).toHaveLength(2);
    await connected.attachInventory(additional.map((item): Parameters<typeof connected.attachInventory>[0][number] =>
      [variant.id, item.id, { required_quantity: 1 }]));
    expect(complete.lists).toHaveLength(4); expect(complete.listPrices).toHaveLength(8);
    expect(complete.lists.flatMap(list => jsonObjects(list.price_list_rules))).toHaveLength(8);
    expect(complete.listPrices.flatMap(entry => jsonObjects(entry.price.price_rules))).toHaveLength(16);
    expect(seed.items).toHaveLength(4); expect(seed.levels).toHaveLength(16);
    const priceSet = seed.priceSetLinks.find(link => link.variant_id === variant.id);
    const lowestSale = complete.lists.find(list => list.id === "confirmation-repeated-pricing-list-0");
    if (priceSet === undefined || lowestSale === undefined) throw new Error("Missing complete repeated-context Pricing preimages");
    expect(new Set(complete.listPrices.map(entry => entry.price.price_set_id))).toEqual(new Set([priceSet.price_set_id]));
    const host = await prepare(256), pricing = vi.spyOn(PricingModuleService.prototype, "calculatePrices");
    const confirm = vi.spyOn(InventoryModuleService.prototype, "confirmInventory");
    const value: Input = { ...input(seed, [1, 2, 3, 4].map((quantity, index) => ({
      id: "repeated-pricing-line-" + index, variant_id: variant.id, quantity,
    }))), cart: complete.cart, setPricingContextResult: complete.setPricingContextResult };
    const result = await run(host, value, 256);
    expect(pricing).toHaveBeenCalledTimes(4); expect(confirm).toHaveBeenCalledTimes(16);
    const expectedPrices: ReturnType<typeof expectedCombinedSale>[] = [];
    for (const [index, quantity] of [1, 2, 3, 4].entries()) {
      const minimum = quantity === 1 ? 1 : 2, maximum = quantity === 1 ? 1 : 4;
      const sale = complete.listPrices.find(entry => entry.list.id === lowestSale.id && MathBN.eq(
        Schema.decodeUnknownSync(Schema.Union([Schema.String, Schema.Number]))(entry.price.min_quantity), minimum));
      const originalAmount = quantity === 1 ? 10 : 8, original = variant.prices.find(price => price.amount === originalAmount);
      if (sale === undefined || original === undefined) throw new Error("Missing native quantity-band Pricing preimage");
      const expected = expectedCombinedSale(priceSet.price_set_id, sale, original, originalAmount, minimum, maximum, quantity === 1 ? null : 2, quantity === 1 ? null : 10);
      expectedPrices.push(expected);
      const nativeCall = pricing.mock.results[index], line = result.lineItems[index];
      if (nativeCall?.type !== "return" || line === undefined) throw new Error("Missing native repeated Pricing context result");
      expect(Schema.decodeUnknownSync(VariantItemPricingCalculationOutput)(await nativeCall.value)).toEqual([expected]);
      expect(line.data).toMatchObject({ quantity, unit_price: 7, compare_at_unit_price: originalAmount, is_tax_inclusive: true });
    }
    const finalPrice = expectedPrices[3];
    if (finalPrice === undefined) throw new Error("Missing fourth native Pricing expectation");
    expect(jsonObject(first(result.variants).calculated_price)).toEqual(finalPrice);
    expect(pricing.mock.calls.map(call => call[1]?.context?.quantity)).toEqual([1, 2, 3, 4]);
    expect(pricing.mock.calls.map(call => call[0].id)).toEqual([1, 2, 3, 4].map(() => [priceSet.price_set_id]));
    for (const call of pricing.mock.calls) expect(call[1]).toMatchObject({ context: {
      customer: complete.cart.customer, region: complete.cart.region, custom_segment159: "vip159", is_custom_price: false,
    } });
    expect(result.inventory.items).toHaveLength(16);
    for (const quantity of [1, 2, 3, 4]) expect(result.inventory.items.filter(item => item.quantity === quantity)).toHaveLength(4);
  }, 180_000);

  it("probes eight selected rich Links and sixteen confirmations with all four native Price Lists relevant to two Sets", async () => {
    const prefix = "confirmation-mixed-pricing", complete = await connected.seedCompletePricing(prefix, "two-sets"), seed = complete.seed;
    const selectedVariants = seed.variants.slice(0, 2);
    expect(selectedVariants).toHaveLength(2); expect(seed.items).toHaveLength(4); expect(seed.levels).toHaveLength(16);
    const existing = seed.inventoryLinks.filter(link => selectedVariants.some(variant => variant.id === link.variant_id));
    expect(existing).toHaveLength(4);
    const attached = await connected.attachInventory(selectedVariants.flatMap(variant => seed.items
      .filter(item => !existing.some(link => link.variant_id === variant.id && link.inventory_item_id === item.id))
      .map((item): Parameters<typeof connected.attachInventory>[0][number] => [variant.id, item.id, { required_quantity: 1 }])));
    expect(attached).toHaveLength(4);
    const selectedLinks = [...existing, ...attached];
    expect(selectedLinks).toHaveLength(8);
    for (const variant of selectedVariants) expect(selectedLinks.filter(link => link.variant_id === variant.id)
      .map(link => link.inventory_item_id).sort()).toEqual(seed.items.map(item => item.id).sort());
    expect(complete.lists).toHaveLength(4); expect(complete.listPrices).toHaveLength(8);
    expect(complete.lists.flatMap(list => jsonObjects(list.price_list_rules))).toHaveLength(8);
    expect(complete.listPrices.flatMap(entry => jsonObjects(entry.price.price_rules))).toHaveLength(16);
    const priceSets = seed.priceSetLinks.filter(link => selectedVariants.some(variant => variant.id === link.variant_id));
    expect(priceSets).toHaveLength(2);
    for (const list of complete.lists) expect(complete.listPrices.filter(entry => entry.list.id === list.id)
      .map(entry => entry.price.price_set_id).sort()).toEqual(priceSets.map(link => link.price_set_id).sort());
    const originalItems = [1, 2, 3, 4].map((quantity, index) => {
      const variant = selectedVariants[index % 2];
      if (variant === undefined) throw new Error("Missing genuine mixed maximum Variant");
      return { id: "mixed-pricing-line-" + index, variant_id: variant.id, quantity };
    });
    const host = await prepare(256), pricing = vi.spyOn(PricingModuleService.prototype, "calculatePrices");
    const confirm = vi.spyOn(InventoryModuleService.prototype, "confirmInventory");
    const value: Input = { ...input(seed, originalItems), cart: complete.cart, setPricingContextResult: complete.setPricingContextResult };
    const result = await run(host, value, 256);
    expect(result.variants).toHaveLength(2); expect(result.lineItems).toHaveLength(4);
    expect(pricing).toHaveBeenCalledTimes(4); expect(confirm).toHaveBeenCalledTimes(16);
    const finalPrices = new Map<string, ReturnType<typeof expectedCombinedSale>>();
    const requestedSets: string[][] = [];
    for (const [index, item] of originalItems.entries()) {
      const variant = selectedVariants.find(row => row.id === item.variant_id);
      const priceSet = priceSets.find(link => link.variant_id === item.variant_id);
      if (variant === undefined || priceSet === undefined) throw new Error("Missing mixed maximum native Pricing endpoints");
      const sale = complete.listPrices.find(entry => entry.list.id === prefix + "-list-0" && entry.price.price_set_id === priceSet.price_set_id);
      const originalAmount = item.quantity === 1 ? 10 : 8, original = variant.prices.find(price => price.amount === originalAmount);
      if (sale === undefined || original === undefined) throw new Error("Missing mixed maximum native Pricing preimages");
      const expected = expectedCombinedSale(priceSet.price_set_id, sale, original, originalAmount, null, null,
        item.quantity === 1 ? null : 2, item.quantity === 1 ? null : 10);
      finalPrices.set(variant.id, expected); requestedSets.push([priceSet.price_set_id]);
      const nativeCall = pricing.mock.results[index], line = result.lineItems[index];
      if (nativeCall?.type !== "return" || line === undefined) throw new Error("Missing actual mixed native Pricing result");
      expect(Schema.decodeUnknownSync(VariantItemPricingCalculationOutput)(await nativeCall.value)).toEqual([expected]);
      expect(line.data).toMatchObject({ quantity: item.quantity, unit_price: 7, compare_at_unit_price: originalAmount, is_tax_inclusive: true });
      const confirmations = result.inventory.items.filter(row => row.id === item.id);
      expect(confirmations).toHaveLength(4);
      expect(confirmations.map(row => row.inventory_item_id).sort()).toEqual(seed.items.map(item => item.id).sort());
      for (const confirmation of confirmations) expect(confirmation.location_ids).toHaveLength(4);
    }
    for (const variant of result.variants) expect(variant.calculated_price).toEqual(finalPrices.get(variant.id));
    expect(pricing.mock.calls.map(call => call[1]?.context?.quantity)).toEqual([1, 2, 3, 4]);
    expect(pricing.mock.calls.map(call => call[0].id)).toEqual(requestedSets);
    for (const call of pricing.mock.calls) expect(call[1]).toMatchObject({ context: {
      customer: complete.cart.customer, region: complete.cart.region, custom_segment159: "vip159", is_custom_price: false,
    } });
    expect(result.inventory.items).toHaveLength(16);
    for (const item of seed.items) expect(confirm.mock.calls.filter(call => call[0] === item.id)).toHaveLength(4);
  }, 180_000);

  it("probes four genuine Variants, eight rich Links, four Items and sixteen Levels", async () => {
    const seed = await connected.seed("confirmation-maximum", { variantCount: 4 });
    expect(seed.variants).toHaveLength(4); expect(seed.inventoryLinks).toHaveLength(8);
    expect(seed.items).toHaveLength(4); expect(seed.levels).toHaveLength(16);
    const host = await prepare(256), confirm = vi.spyOn(InventoryModuleService.prototype, "confirmInventory");
    const result = await run(host, input(seed), 256);
    expect(result.variants).toHaveLength(4); expect(result.inventory.items).toHaveLength(8);
    expect(confirm).toHaveBeenCalledTimes(8);
  }, 180_000);

  it("executes sixteen confirmations for four original lines and four genuine linked Items", async () => {
    const seed = await connected.seed("confirmation-sixteen", { variantCount: 4 }), variant = first(seed.variants);
    const existing = seed.inventoryLinks.filter(link => link.variant_id === variant.id);
    const additional = seed.items.filter(item => !existing.some(link => link.inventory_item_id === item.id));
    expect(existing).toHaveLength(2); expect(additional).toHaveLength(2);
    const attached = await connected.attachInventory(additional.map((item): Parameters<typeof connected.attachInventory>[0][number] =>
      [variant.id, item.id, { required_quantity: 1 }]));
    expect(attached.map(link => link.inventory_item_id).sort()).toEqual(additional.map(item => item.id).sort());
    const host = await prepare(256), confirm = vi.spyOn(InventoryModuleService.prototype, "confirmInventory");
    const originalItems = Array.from({ length: 4 }, (_, index) => ({ id: "sixteen-line-" + index, variant_id: variant.id, quantity: 1 }));
    const result = await run(host, input(seed, originalItems), 256);
    expect(result.variants).toHaveLength(1); expect(result.lineItems).toHaveLength(4);
    expect(result.inventory.items).toHaveLength(16); expect(confirm).toHaveBeenCalledTimes(16);
    for (const item of originalItems) {
      const rows = result.inventory.items.filter(row => row.id === item.id);
      expect(rows).toHaveLength(4);
      expect(rows.map(row => row.inventory_item_id).sort()).toEqual(seed.items.map(item => item.id).sort());
      for (const row of rows) expect(row.location_ids).toHaveLength(4);
    }
    for (const item of seed.items) expect(confirm.mock.calls.filter(call => call[0] === item.id)).toHaveLength(4);
  }, 180_000);

  it("retains native backorder and unmanaged branches on actual linked Variants", async () => {
    const backorder = await connected.seed("confirmation-backorder"), backorderVariant = first(backorder.variants);
    await connected.updateVariant({ id: backorderVariant.id, allow_backorder: true });
    const host = await prepare(256), confirm = vi.spyOn(InventoryModuleService.prototype, "confirmInventory");
    const permitted = await run(host, { ...input(backorder, [{ variant_id: backorderVariant.id, quantity: 10_000 }]), sales_channel_id: "unlinked-channel" }, 256);
    expect(permitted.variants[0]).toMatchObject({ allow_backorder: true });
    expect(permitted.inventory.items).toHaveLength(2);
    for (const item of permitted.inventory.items) expect(item).toMatchObject({ allow_backorder: true, location_ids: [] });
    expect(confirm).not.toHaveBeenCalled();
    const unmanaged = await connected.seed("confirmation-unmanaged"), unmanagedVariant = first(unmanaged.variants);
    await connected.updateVariant({ id: unmanagedVariant.id, manage_inventory: false });
    const ignored = await run(host, input(unmanaged, [{ variant_id: unmanagedVariant.id, quantity: 10_000 }]), 256);
    expect(ignored.variants[0]).toMatchObject({ manage_inventory: false });
    expect(ignored.inventory.items).toEqual([]); expect(confirm).not.toHaveBeenCalled();
  }, 180_000);

  it("fails genuine confirmation for an existing linked Item with no Levels", async () => {
    const seed = await connected.seed("confirmation-missing-levels"), variant = first(seed.variants), itemId = "confirmation-unstocked-item";
    await connected.createItem(itemId);
    await connected.attachInventory([[variant.id, itemId, { required_quantity: 1 }]]);
    const host = await prepare(256), confirm = vi.spyOn(InventoryModuleService.prototype, "confirmInventory");
    await refused(host.run(host.newRequestKey(), input(seed)), "Some variant does not have the required inventory");
    expect(confirm.mock.calls.some(call => call[0] === itemId)).toBe(true);
  }, 180_000);

  it("uses the genuine module's zero-Location and missing-Item behavior, including reserved and incoming stock", async () => {
    const direct = await connected.prepareDirect();
    caseCleanup.push(() => Effect.runPromise(direct.close));
    const before = await snapshot(), locations = baseline.locations.map(location => location.id), item = first(baseline.items);
    expect(await Effect.runPromise(direct.run(direct.newRequestKey(), { inventory_item_id: "missing-item", location_ids: [], quantity: "0" }))).toBe(true);
    expect(await Effect.runPromise(direct.run(direct.newRequestKey(), { inventory_item_id: "missing-item", location_ids: [], quantity: "0.1" }))).toBe(false);
    expect(await Effect.runPromise(direct.run(direct.newRequestKey(), { inventory_item_id: item.id, location_ids: locations, quantity: "41.875" }))).toBe(true);
    expect(await Effect.runPromise(direct.run(direct.newRequestKey(), { inventory_item_id: item.id, location_ids: locations, quantity: "41.875000000000000000001" }))).toBe(false);
    expect(await Effect.runPromise(direct.run(direct.newRequestKey(), { inventory_item_id: item.id, location_ids: locations, quantity: "42" }))).toBe(false);
    unchangedData(before, await snapshot());
    await refused(direct.run(direct.newRequestKey(), { inventory_item_id: "missing-item", location_ids: locations, quantity: "0" }), "was not found");
  }, 180_000);

  it("retains the earlier native pricing TypeError and direct Item NOT_FOUND for a deleted linked Item", async () => {
    const seed = await connected.seed("confirmation-deleted-item"), variant = first(seed.variants), item = first(seed.items);
    const [linksBefore, beforeCount] = await connected.readInventoryLinks(variant.id);
    expect(beforeCount).toBe(2);
    const selectedLink = linksBefore.find(link => link.inventory_item_id === item.id);
    if (selectedLink === undefined) throw new Error("Missing genuine active Link to selected Item");
    expect(selectedLink.deleted_at).toBeNull();
    await connected.softDeleteItemPreservingLinks(item.id);
    const [linksAfter, afterCount] = await connected.readInventoryLinks(variant.id);
    expect(afterCount).toBe(beforeCount); expect(linksAfter).toEqual(linksBefore);
    const host = await prepare(256), confirm = vi.spyOn(InventoryModuleService.prototype, "confirmInventory");
    const failure = await refused(host.run(host.newRequestKey(), input(seed)), "Cannot read properties of undefined (reading 'requires_shipping')");
    expect(failureMessages(failure)).toContain("TypeError");
    expect(confirm).not.toHaveBeenCalled();
    const direct = await connected.prepareDirect();
    caseCleanup.push(() => Effect.runPromise(direct.close));
    const directFailure = await refused(direct.run(direct.newRequestKey(), { inventory_item_id: item.id,
      location_ids: seed.locations.map(location => location.id), quantity: "1" }), "was not found");
    expect(failureMessages(directFailure)).toContain("not_found");
    expect(confirm).toHaveBeenCalledTimes(1); expect(confirm.mock.calls[0]?.[0]).toBe(item.id);
  }, 180_000);

  it("retains no invented inverse for either read-only native child and replays without another confirmation", async () => {
    const children = [Result.getOrThrow(getVariantsAndItemsWithPrices.prepare()),
      Result.getOrThrow(confirmVariantInventoryWorkflow.prepare())];
    for (const child of children) for (const node of child.nodes)
      if (node.kind !== "workflow") expect(node.compensate).toBeUndefined();
    const host = await prepare(256), confirm = vi.spyOn(InventoryModuleService.prototype, "confirmInventory");
    const key = host.newRequestKey(), value = input(baseline), before = await snapshot();
    const firstResult = await Effect.runPromise(host.run(key, value)), replay = await Effect.runPromise(host.run(key, value));
    expect(replay).toEqual(firstResult); expect(confirm).toHaveBeenCalledTimes(2);
    unchangedData(before, await snapshot());
  }, 180_000);
});
