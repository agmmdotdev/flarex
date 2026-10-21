import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Effect, Result, Schema } from "effect";
import { PricingModuleService } from "@medusajs/pricing/services";
import { ProductModuleService } from "@medusajs/product/services";
import { InventoryModuleService } from "@medusajs/inventory/services";
import { StockLocationModuleService } from "@medusajs/stock-location/services";
import { SalesChannelModuleService } from "@medusajs/sales-channel/services";
import { FulfillmentModuleService } from "@medusajs/fulfillment/services";
import { MedusaError } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { defineAtomicCommerceCommand, getAtomicCommerceCommand, getAtomicCommerceParticipant, type AtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import type { AtomicWorkflowExecution, AtomicWorkflowHostComposition } from "../src/workflow/host";
import { variantItemPricingResources } from "../src/workflow/policy";
import { prepareVariantItemPricingWorkflow } from "../src/workflows/cart/variant-item-pricing";
import { ExactNumericRaw } from "../src/value/exact-numeric";
import { VariantItemPricingCalculationOutput } from "../src/modules/pricing/calculation";
import { prepareLogicalVariantItemPricing } from "./support/logical-variant-item-pricing-fixture";
import { creationRevision } from "./support/logical-product-creation-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
const caseCleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalVariantItemPricing>>;
type Seed = Awaited<ReturnType<Awaited<ReturnType<typeof prepareLogicalVariantItemPricing>>["seed"]>>;
type Host = Effect.Success<ReturnType<typeof prepareVariantItemPricingWorkflow>>;
type Input = Parameters<Host["run"]>[1];
type Item = NonNullable<Input["items"]>[number];
let baseline: Seed;
const text = Schema.decodeUnknownSync(Schema.String), numeric = Schema.decodeUnknownSync(Schema.Number);
const object = Schema.decodeUnknownSync(Schema.JsonObject), objects = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const raw = Schema.decodeUnknownSync(ExactNumericRaw);
const first = <Value>(values: readonly Value[]): Value => {
  const value = values[0]; if (value === undefined) throw new Error("Missing genuine native159 fixture output"); return value;
};
const input = (seed: Seed, items?: Input["items"]): Input => ({
  cart: { id: "cart159-input", currency_code: "usd", region_id: "reg159-input", customer_id: "cus159-input" },
  items: items ?? seed.variants.map((variant, index) => ({ id: "item159-" + index, variant_id: variant.id, quantity: 1 })),
  setPricingContextResult: {},
});
const prepare = async (execution = connected.execution) => {
  const host = await Effect.runPromise(prepareVariantItemPricingWorkflow({ execution,
    modules: { ...connected.creationModules,
      pricing: { module: connected.pricingRead.workflow, logicalStorage: connected.creationModules.pricing.logicalStorage },
      inventory: { module: connected.inventoryRead.workflow, logicalStorage: connected.creationModules.inventory.logicalStorage },
      sales_channel_locations: { module: connected.channelLocations.link.workflow,
        logicalStorage: connected.channelLocations.linkInput.logicalStorage } },
    revision: creationRevision("native-variant-item-pricing159"),
    subscribers: [{ id: "native-variant-item-pricing159", revision: creationRevision("native-variant-item-pricing159-subscriber") }],
  }));
  caseCleanup.push(() => Effect.runPromise(host.close));
  return host;
};
const snapshot = () => logicalCurrencyInventory(connected.fixture);
const noMutation = (before: Awaited<ReturnType<typeof snapshot>>, after: Awaited<ReturnType<typeof snapshot>>) => {
  for (const key of ["rows", "revisions", "indexEntries", "indexRevisions", "uniqueKeys", "searchEntries", "searchBuilds",
    "indexBuilds", "uniqueBuilds", "rowChanges", "events", "physicalFacts", "initialization"] as const)
    expect(after[key], key).toEqual(before[key]);
};
function failureMessages(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? failureMessages(reason.error)
    : reason._tag === "Die" ? failureMessages(reason.defect) : ["Interrupt"]);
  if (!(value instanceof Error)) return [];
  return [value.name, value.message, ...("reason" in value && typeof value.reason === "string" ? [value.reason] : []),
    ...failureMessages(value.cause)];
}
async function refused(work: Effect.Effect<unknown, unknown>, message: string) {
  const before = await snapshot(), outcome = await Effect.runPromise(Effect.result(work));
  if (Result.isSuccess(outcome)) throw new Error("Native159 failure unexpectedly succeeded");
  expect(failureMessages(outcome.failure).some(value => value.includes(message))).toBe(true);
  expect(await snapshot()).toEqual(before);
  return outcome.failure;
}
async function run(host: Host, value: Input, selectedLimit: number = variantItemPricingResources.calls) {
  let calls = 0;
  const before = await snapshot();
  let outcome: "Success" | "Failure" = "Failure";
  try {
    const result = await Effect.runPromise(host.run(host.newRequestKey(), value).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, observed) => { if (name === "BoundedRequest.enter") calls++; return observed; },
    })));
    outcome = "Success";
    expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(selectedLimit);
    noMutation(before, await snapshot());
    return result;
  } finally {
    console.info("Variant/item pricing bounded native root", { driver, items: value.items?.length ?? 0, calls, limit: selectedLimit, outcome });
  }
}

/** Explicit native default DTO expectations use returned business IDs/raw
 * quantities. They intentionally include implicit join keys and omit fields
 * absent from the original native Query result. */
function productForVariant(seed: Seed, variant: Seed["variants"][number]) {
  const product = seed.products.find(product => product.id === variant.product_id);
  if (product === undefined) throw new Error("Missing native parent Product preimage for the selected Variant");
  return product;
}
function expectedVariant(seed: Seed, variant: Seed["variants"][number], optionalRelations = true) {
  const product = productForVariant(seed, variant), priceSet = seed.priceSetLinks.find(link => link.variant_id === variant.id);
  if (priceSet === undefined) throw new Error("Missing native PriceSet Link preimage");
  const price = first(variant.prices), priceId = text(price.id), amount = numeric(price.amount);
  const priceData = { id: priceId, price_list_id: null, price_list_type: null, min_quantity: null, max_quantity: null };
  return { id: variant.id, title: variant.title, sku: variant.sku, manage_inventory: variant.manage_inventory,
    allow_backorder: variant.allow_backorder, barcode: variant.barcode, thumbnail: variant.thumbnail, product_id: product.id,
    product: { id: product.id, title: product.title, description: product.description, status: product.status, subtitle: product.subtitle,
      thumbnail: product.thumbnail, handle: product.handle, discountable: product.discountable, is_giftcard: product.is_giftcard,
      type: optionalRelations ? { value: "Root type", id: "root-type" } : null,
      collection: optionalRelations ? { title: "Root collection" } : null, shipping_profile: { id: "root-profile-0" } },
    inventory_items: seed.inventoryLinks.filter(link => link.variant_id === variant.id).map(link => {
      const item = seed.items.find(item => item.id === link.inventory_item_id);
      if (item === undefined) throw new Error("Missing native Item preimage");
      return { inventory_item_id: item.id, required_quantity: link.required_quantity, variant_id: variant.id,
        inventory: { requires_shipping: item.requires_shipping, id: item.id,
          location_levels: seed.levels.filter(level => level.inventory_item_id === item.id).sort((a, b) => a.id.localeCompare(b.id)).map(level => {
            const reservation = seed.reservations.find(row => row.inventory_item_id === item.id && row.location_id === level.location_id);
            const location = seed.locations.find(location => location.id === level.location_id);
            if (location === undefined) throw new Error("Missing native Stock Location preimage");
            return { stocked_quantity: level.stocked_quantity, reserved_quantity: reservation?.quantity ?? level.reserved_quantity,
              location_id: location.id, raw_stocked_quantity: raw(level.raw_stocked_quantity),
              raw_reserved_quantity: raw(reservation?.raw_quantity ?? level.raw_reserved_quantity),
              stock_locations: [{ id: location.id, name: location.name,
                sales_channels: [{ id: "root-channel-0", name: "Root channel 0" }, { id: "root-channel-1", name: "Root channel 1" }] }] };
          }) } };
    }),
    calculated_price: { id: priceSet.price_set_id, is_calculated_price_price_list: false, is_calculated_price_tax_inclusive: false,
      calculated_amount: amount, raw_calculated_amount: raw(price.raw_amount), is_original_price_price_list: false,
      is_original_price_tax_inclusive: false, original_amount: amount, raw_original_amount: raw(price.raw_amount),
      currency_code: "usd", calculated_price: priceData, original_price: priceData } };
}
function expectedLine(seed: Seed, variant: Seed["variants"][number], index: number, optionalRelations = true) {
  const product = productForVariant(seed, variant);
  return { selector: { id: "item159-" + index }, data: { quantity: 1, title: product.title, subtitle: variant.title,
    thumbnail: product.thumbnail, product_id: product.id, product_title: product.title, product_description: product.description,
    product_subtitle: product.subtitle, product_type: optionalRelations ? "Root type" : null,
    product_type_id: optionalRelations ? "root-type" : null, product_collection: optionalRelations ? "Root collection" : null,
    product_handle: product.handle, variant_id: variant.id, variant_sku: variant.sku, variant_barcode: variant.barcode,
    variant_title: variant.title, is_discountable: false, is_giftcard: false, requires_shipping: true,
    unit_price: 10, is_tax_inclusive: false, metadata: {}, cart_id: "cart159-input" } };
}
const expectDefault = (actual: unknown, seed: Seed, optionalRelations = true) => expect(actual).toEqual({
  variants: seed.variants.map(variant => expectedVariant(seed, variant, optionalRelations)).sort((a, b) => a.id.localeCompare(b.id)),
  lineItems: seed.variants.map((variant, index) => expectedLine(seed, variant, index, optionalRelations)),
});

describe("native Variant and item pricing on the complete default graph", () => {
  beforeAll(async () => {
    connected = await prepareLogicalVariantItemPricing(driver, close => cleanup.push(close));
    baseline = await connected.seed("pricing159-default");
  }, 180_000);
  afterEach(async () => {
    const failures: unknown[] = [];
    try {
      for (const close of caseCleanup.splice(0).reverse()) {
        try { await close(); }
        catch (failure) { failures.push(failure); }
      }
    } finally { vi.restoreAllMocks(); }
    if (failures.length !== 0) throw new AggregateError(failures, "Unable to close native159 per-case hosts");
  }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("executes both native Variant aliases and all six module owners with the exact full default DTO", async () => {
    const host = await prepare();
    const product = vi.spyOn(ProductModuleService.prototype, "listAndCountProductVariants");
    const pricing = vi.spyOn(PricingModuleService.prototype, "calculatePrices");
    const inventory = vi.spyOn(InventoryModuleService.prototype, "listAndCountInventoryItems");
    const levels = vi.spyOn(InventoryModuleService.prototype, "listAndCountInventoryLevels");
    const locations = vi.spyOn(StockLocationModuleService.prototype, "listAndCountStockLocations");
    const channels = vi.spyOn(SalesChannelModuleService.prototype, "listAndCountSalesChannels");
    const fulfillment = vi.spyOn(FulfillmentModuleService.prototype, "listAndCountShippingProfiles");
    const value = input(baseline), before = structuredClone(value);
    expectDefault(await run(host, value), baseline);
    expect(value).toEqual(before); expect(product).toHaveBeenCalledTimes(2); expect(pricing).toHaveBeenCalledTimes(1);
    for (const owner of [inventory, levels, locations, channels, fulfillment]) expect(owner).toHaveBeenCalled();
    expect(pricing.mock.calls[0]?.slice(0, 2)).toEqual([{ id: [first(baseline.priceSetLinks).price_set_id] },
      { context: { id: "cart159-input", currency_code: "usd", region_id: "reg159-input", customer_id: "cus159-input",
        quantity: 1, is_custom_price: false } }]);
  }, 180_000);

  it("preserves the original 64-call refusal without publishing partial default-graph results", async () => {
    const execution: AtomicWorkflowExecution = { ...connected.execution, prepare: composition => {
      const { requestCallLimit: _selectedAllowance, ...retained } = composition;
      return connected.execution.prepare({ ...retained, requestCallLimit: 64 });
    } };
    const host = await prepare(execution), before = await snapshot();
    await run(host, input(baseline), 64).then(
      () => { throw new Error("The original 64-call native root unexpectedly succeeded"); },
      failure => { expect(failureMessages(failure)).toContain("limitExceeded"); },
    );
    expect(await snapshot()).toEqual(before);
  }, 180_000);

  it("reads four Variants, four shared Items and sixteen Levels under the named call allowance", async () => {
    const seed = await connected.seed("pricing159-maximum", { variantCount: 4 });
    const pricing = vi.spyOn(PricingModuleService.prototype, "calculatePrices"), host = await prepare();
    expectDefault(await run(host, input(seed)), seed);
    expect(pricing).toHaveBeenCalledTimes(1);
    expect(pricing.mock.calls[0]?.[0]).toEqual({ id: seed.priceSetLinks.map(link => link.price_set_id) });
    pricing.mockClear();
    const result = await run(host, input(seed, seed.variants.map((variant, index) => ({
      id: "item159-" + index, variant_id: variant.id, quantity: index + 1,
    }))));
    expect(result).toEqual({ variants: seed.variants.map(variant => expectedVariant(seed, variant)).sort((a, b) => a.id.localeCompare(b.id)),
      lineItems: seed.variants.map((variant, index) => {
        const line = expectedLine(seed, variant, index); return { ...line, data: { ...line.data, quantity: index + 1 } };
      }) });
    expect(pricing).toHaveBeenCalledTimes(4);
    expect(pricing.mock.calls.map(call => call[1]?.context?.quantity)).toEqual([1, 2, 3, 4]);
  }, 180_000);

  it("binds omitted, explicit eight and explicit nine participant allowances to distinct genuine request identities", async () => {
    const captures: AtomicWorkflowHostComposition[] = [];
    await prepare({ ...connected.execution, prepare: composition => {
      captures.push(composition); return connected.execution.prepare(composition);
    } });
    expect(captures).toHaveLength(1);
    const captured = first(captures);
    const pricing = captured.participants.find(member => getAtomicCommerceParticipant(member.participant) === "pricing");
    if (pricing === undefined || !("logicalStorage" in pricing)) throw new Error("Missing original logical Pricing participant");
    const probe = defineAtomicCommerceCommand("variantItemPricingParticipantIdentity159", ctx => ctx.call(pricing.participant,
      connected.pricingRead.count, { filters: { id: [] }, config: { select: ["id"], relations: [], order: { id: "ASC" }, skip: 0, take: 4 } }));
    const { requestParticipantLimit: _namedAllowance, ...composition } = captured;
    const hosts: AtomicCommerceHost[] = [];
    for (const requestParticipantLimit of [undefined, 8, 9]) {
      const host = await Effect.runPromise(connected.execution.prepare({ ...composition, participants: [pricing], commands: [probe],
        ...(requestParticipantLimit === undefined ? {} : { requestParticipantLimit }) }));
      caseCleanup.push(() => Effect.runPromise(host.close)); hosts.push(host);
    }
    const omitted = hosts[0], eight = hosts[1], nine = hosts[2];
    if (omitted === undefined || eight === undefined || nine === undefined) throw new Error("Missing actual participant identity probe host");
    const count = vi.spyOn(PricingModuleService.prototype, "listAndCountPriceSets"), before = await snapshot();
    const omittedKey = omitted.newRequestKey();
    expect(await Effect.runPromise(omitted.run(omittedKey, probe, {}))).toEqual([[], 0]);
    expect(await Effect.runPromise(omitted.run(omittedKey, probe, {}))).toEqual([[], 0]);
    expect(count).toHaveBeenCalledTimes(1);
    await refused(eight.run(omittedKey, probe, {}), "requestConflict");
    await refused(nine.run(omittedKey, probe, {}), "requestConflict");
    const eightKey = eight.newRequestKey();
    expect(await Effect.runPromise(eight.run(eightKey, probe, {}))).toEqual([[], 0]);
    await refused(nine.run(eightKey, probe, {}), "requestConflict");
    expect(await Effect.runPromise(nine.run(nine.newRequestKey(), probe, {}))).toEqual([[], 0]);
    expect(count).toHaveBeenCalledTimes(3);
    noMutation(before, await snapshot());
  }, 180_000);

  it.each([
    { name: "implicit zero", unit_price: 0, expected: 0, custom: true, contextCustom: false },
    { name: "explicit false zero", unit_price: 0, is_custom_price: false, expected: 10, custom: false, contextCustom: false },
    { name: "explicit true zero", unit_price: 0, is_custom_price: true, expected: 0, custom: true, contextCustom: false },
    { name: "explicit false positive", unit_price: 77, is_custom_price: false, expected: 10, custom: false, contextCustom: true },
  ])("preserves native custom-price handling for $name", async mode => {
    const variant = first(baseline.variants), host = await prepare(), pricing = vi.spyOn(PricingModuleService.prototype, "calculatePrices");
    const item: Item = { id: "custom159", variant_id: variant.id, quantity: 1, unit_price: mode.unit_price,
      ...("is_custom_price" in mode && mode.is_custom_price !== undefined ? { is_custom_price: mode.is_custom_price } : {}) };
    const result = object(await run(host, input(baseline, [item]))), line = object(first(objects(result.lineItems)).data);
    expect(line.unit_price).toBe(mode.expected);
    if (mode.custom) expect(line.is_custom_price).toBe(true); else expect(line).not.toHaveProperty("is_custom_price");
    expect(pricing.mock.calls[0]?.[1]).toMatchObject({ context: { is_custom_price: mode.contextCustom } });
    expect(object(first(objects(result.variants)).calculated_price).calculated_amount).toBe(10);
  }, 180_000);

  it("matches a genuine nested customer List Rule and preserves sale/original amounts and mismatch", async () => {
    const seed = await connected.seed("pricing159-nested-sale"), variant = first(seed.variants);
    const list = first(objects(await connected.seedPriceLists([{ id: "pricing159-nested-list", title: "Nested159 sale", description: "Nested159",
      status: "active", type: "sale", rules: { "customer.groups.id": ["cg159"] },
      prices: [{ price_set_id: first(seed.priceSetLinks).price_set_id, currency_code: "usd", amount: 7 }],
    }])));
    const sale = first(objects(list.prices)), base = first(variant.prices), host = await prepare();
    const pricing = vi.spyOn(PricingModuleService.prototype, "calculatePrices");
    const request = (group: string): Input => ({ ...input(seed), cart: { ...input(seed).cart,
      customer: { id: "cus159-input", groups: [{ id: group }, { id: "cg159-other" }] },
      region: { id: "reg159-input", currency_code: "usd", name: "Input region159" } },
      setPricingContextResult: { custom159: { nested: "value159" } } });
    const matched = object(await run(host, request("cg159"))), calculated = object(first(objects(matched.variants)).calculated_price);
    expect(Schema.decodeUnknownSync(VariantItemPricingCalculationOutput)([calculated])).toEqual([{
      id: first(seed.priceSetLinks).price_set_id, is_calculated_price_price_list: true, is_calculated_price_tax_inclusive: false,
      calculated_amount: 7, raw_calculated_amount: raw(sale.raw_amount), is_original_price_price_list: false,
      is_original_price_tax_inclusive: false, original_amount: 10, raw_original_amount: raw(base.raw_amount), currency_code: "usd",
      calculated_price: { id: text(sale.id), price_list_id: text(list.id), price_list_type: "sale", min_quantity: null, max_quantity: null },
      original_price: { id: text(base.id), price_list_id: null, price_list_type: null, min_quantity: null, max_quantity: null },
    }]);
    expect(object(first(objects(matched.lineItems)).data)).toMatchObject({ unit_price: 7, compare_at_unit_price: 10 });
    expect(pricing.mock.calls[0]?.[1]).toEqual({ context: { id: "cart159-input", currency_code: "usd", region_id: "reg159-input",
      customer_id: "cus159-input", customer: { id: "cus159-input", groups: [{ id: "cg159" }, { id: "cg159-other" }] },
      region: { id: "reg159-input", currency_code: "usd", name: "Input region159" }, custom159: { nested: "value159" },
      quantity: 1, is_custom_price: false } });
    const unmatched = object(await run(host, request("cg159-no-match")));
    expect(object(first(objects(unmatched.variants)).calculated_price).calculated_amount).toBe(10);
    expect(object(first(objects(unmatched.lineItems)).data)).not.toHaveProperty("compare_at_unit_price");
  }, 180_000);

  it("retains genuine override selection and region-specific tax preferences", async () => {
    const seed = await connected.seed("pricing159-override-tax");
    const list = first(objects(await connected.seedPriceLists([{ id: "pricing159-override-list", title: "Override159", description: "Override159",
      status: "active", type: "override", prices: [{ price_set_id: first(seed.priceSetLinks).price_set_id,
        currency_code: "usd", amount: 15, rules: { region_id: "reg159-tax" } }],
    }])));
    await connected.seedPricePreferences([{ attribute: "region_id", value: "reg159-tax", is_tax_inclusive: true },
      { attribute: "currency_code", value: "usd", is_tax_inclusive: false }]);
    const price = first(objects(list.prices)), host = await prepare();
    const result = object(await run(host, { ...input(seed), cart: { ...input(seed).cart, region_id: "reg159-tax" } }));
    const metadata = { id: text(price.id), price_list_id: text(list.id), price_list_type: "override", min_quantity: null, max_quantity: null };
    expect(Schema.decodeUnknownSync(VariantItemPricingCalculationOutput)([first(objects(result.variants)).calculated_price])).toEqual([{
      id: first(seed.priceSetLinks).price_set_id, is_calculated_price_price_list: true, is_calculated_price_tax_inclusive: true,
      calculated_amount: 15, raw_calculated_amount: raw(price.raw_amount), is_original_price_price_list: true,
      is_original_price_tax_inclusive: true, original_amount: 15, raw_original_amount: raw(price.raw_amount), currency_code: "usd",
      calculated_price: metadata, original_price: metadata,
    }]);
    expect(object(first(objects(result.lineItems)).data)).toMatchObject({ unit_price: 15, is_tax_inclusive: true });
    expect(object(first(objects(result.lineItems)).data)).not.toHaveProperty("compare_at_unit_price");
  }, 180_000);

  it("groups identical contexts and preserves distinct native quantity selections for repeated Variant rows", async () => {
    const seed = await connected.seed("pricing159-quantities", { prices: [
      { currency_code: "usd", amount: 10, min_quantity: 1, max_quantity: 2 },
      { currency_code: "usd", amount: 7, min_quantity: 3 },
    ] });
    const variant = first(seed.variants), host = await prepare(), pricing = vi.spyOn(PricingModuleService.prototype, "calculatePrices");
    const result = object(await run(host, input(seed, [1, 1, 2, 3].map((quantity, index) => ({ id: "quantity159-" + index,
      variant_id: variant.id, quantity })))));
    expect(objects(result.lineItems).map(line => object(line.data).unit_price)).toEqual([10, 10, 10, 7]);
    expect(pricing).toHaveBeenCalledTimes(3);
    expect(pricing.mock.calls.map(call => call[1]?.context?.quantity)).toEqual([1, 2, 3]);
    expect(pricing.mock.calls.map(call => call[0].id)).toEqual([
      [first(seed.priceSetLinks).price_set_id, first(seed.priceSetLinks).price_set_id],
      [first(seed.priceSetLinks).price_set_id], [first(seed.priceSetLinks).price_set_id],
    ]);
    expect(object(first(objects(result.variants)).calculated_price).calculated_amount).toBe(7);
  }, 180_000);

  it.each([
    { name: "boolean-false", attribute: "is_custom_price", value: "false", calculated: 6, custom: false, line: 6 },
    { name: "boolean-true", attribute: "is_custom_price", value: "true", calculated: 5, custom: true, line: 7 },
    { name: "array-context", attribute: "custom_segment159", value: "vip159", calculated: 4, custom: false, line: 4 },
  ])("passes the actual $name context through native matching and the complete Pricing DTO", async mode => {
    const seed = await connected.seed("pricing159-" + mode.name, { prices: [
      { currency_code: "usd", amount: 10 },
      { currency_code: "usd", amount: mode.calculated, rules: { [mode.attribute]: mode.value } },
    ] });
    const variant = first(seed.variants), host = await prepare(), pricing = vi.spyOn(PricingModuleService.prototype, "calculatePrices");
    const value = { ...input(seed, [{ id: "rule159", variant_id: variant.id, quantity: 1,
      ...(mode.custom ? { unit_price: 7 } : {}) }]),
      setPricingContextResult: mode.name === "array-context" ? { custom_segment159: ["vip159", "other159"] } : {} };
    const result = object(await run(host, value)), calculated = object(first(objects(result.variants)).calculated_price);
    const selected = variant.prices.find(price => price.amount === mode.calculated);
    if (selected === undefined) throw new Error("Native Product root omitted the seeded Rule Price");
    const metadata = { id: text(selected.id), price_list_id: null, price_list_type: null, min_quantity: null, max_quantity: null };
    const complete = { id: first(seed.priceSetLinks).price_set_id, is_calculated_price_price_list: false,
      is_calculated_price_tax_inclusive: false, calculated_amount: mode.calculated, raw_calculated_amount: raw(selected.raw_amount),
      is_original_price_price_list: false, is_original_price_tax_inclusive: false, original_amount: mode.calculated,
      raw_original_amount: raw(selected.raw_amount), currency_code: "usd", calculated_price: metadata, original_price: metadata };
    expect(Schema.decodeUnknownSync(VariantItemPricingCalculationOutput)([calculated])).toEqual([complete]);
    expect(object(first(objects(result.lineItems)).data).unit_price).toBe(mode.line);
    expect(pricing.mock.calls[0]?.[1]).toMatchObject({ context: { is_custom_price: mode.custom,
      ...(mode.name === "array-context" ? { custom_segment159: ["vip159", "other159"] } : {}) } });
  }, 180_000);

  it("preserves native null Type/Collection results and line-item fallbacks", async () => {
    const seed = await connected.seed("pricing159-optional", { optionalRelations: false }), host = await prepare();
    expectDefault(await run(host, input(seed)), seed, false);
  }, 180_000);

  it("retains item shipping, tax and metadata overrides", async () => {
    const variant = first(baseline.variants), host = await prepare();
    const result = object(await run(host, input(baseline, [{ id: "overrides159", variant_id: variant.id, quantity: 1,
      unit_price: 12, is_custom_price: true, is_tax_inclusive: true, requires_shipping: false,
      is_discountable: true, title: "Requested title", metadata: { preserve159: true }, variant_option_values: { Size: "Requested" } }])));
    expect(object(first(objects(result.lineItems)).data)).toMatchObject({ title: "Requested title", unit_price: 12,
      requires_shipping: false, is_tax_inclusive: true, is_discountable: true, is_custom_price: true,
      metadata: { preserve159: true }, variant_option_values: { Size: "Requested" } });
  }, 180_000);

  it("preserves native cart-item and explicit Variant-ID precedence", async () => {
    const variant = first(baseline.variants), host = await prepare();
    const manual = object(await run(host, { ...input(baseline, [{ id: "manual159", quantity: 1, title: "Manual159", unit_price: 7 }]),
      cart: { ...input(baseline).cart, items: [{ id: "cart-selected159", variant_id: variant.id, quantity: 1 }] } }));
    expect(objects(manual.variants).map(row => row.id)).toEqual([variant.id]);
    expect(first(objects(manual.variants))).not.toHaveProperty("calculated_price");
    expect(object(first(objects(manual.lineItems)).data)).toMatchObject({ title: "Manual159", unit_price: 7, is_custom_price: true });
    await refused(host.run(host.newRequestKey(), { ...input(baseline), variants: { id: [] } }),
      "do not exist or belong to a product that is not published");
  }, 180_000);

  it("uses the native region currency fallback without a Region service", async () => {
    const host = await prepare(), pricing = vi.spyOn(PricingModuleService.prototype, "calculatePrices");
    const result = object(await run(host, { ...input(baseline), cart: { id: "cart159-input",
      region: { id: "reg159-input", currency_code: "usd" } } }));
    expect(object(first(objects(result.lineItems)).data).unit_price).toBe(10);
    expect(pricing.mock.calls[0]?.[1]).toEqual({ context: { id: "cart159-input", currency_code: "usd",
      region: { id: "reg159-input", currency_code: "usd" }, quantity: 1, is_custom_price: false } });
  }, 180_000);

  it("preserves the native missing-currency error while empty and manual items remain valid", async () => {
    const host = await prepare(), pricing = vi.spyOn(PricingModuleService.prototype, "calculatePrices");
    const failure = await refused(host.run(host.newRequestKey(), { ...input(baseline), cart: { id: "cart159-input" } }),
      "Method calculatePrices requires currency_code in the pricing context");
    const nativeError = (cause: unknown): MedusaError | undefined => {
      if (cause instanceof MedusaError) return cause;
      if (Cause.isCause(cause)) {
        for (const reason of cause.reasons) {
          const found = reason._tag === "Fail" ? nativeError(reason.error) : reason._tag === "Die" ? nativeError(reason.defect) : undefined;
          if (found !== undefined) return found;
        }
      }
      return cause instanceof Error ? nativeError(cause.cause) : undefined;
    };
    expect(nativeError(failure)).toMatchObject({ type: MedusaError.Types.INVALID_DATA,
      message: "Method calculatePrices requires currency_code in the pricing context" });
    expect(pricing).toHaveBeenCalledTimes(1); pricing.mockClear();
    expect(await run(host, { cart: {}, items: [], setPricingContextResult: {} })).toEqual({ variants: [], lineItems: [] });
    const manual = object(await run(host, { cart: { id: "cart159-input" },
      items: [{ id: "no-currency-manual159", title: "Manual159", quantity: 1, unit_price: 7 }], setPricingContextResult: {} }));
    expect(manual.variants).toEqual([]);
    expect(object(first(objects(manual.lineItems)).data)).toMatchObject({ title: "Manual159", unit_price: 7, is_custom_price: true });
    expect(pricing).not.toHaveBeenCalled();
  }, 180_000);

  it("retains the native missing-Variant and unpublished-Product failures", async () => {
    const host = await prepare(), missing = "pricing159-unknown-variant";
    await refused(host.run(host.newRequestKey(), input(baseline, [{ id: "unknown159", variant_id: missing, quantity: 1 }])),
      "do not exist or belong to a product that is not published");
    const draft = await connected.seed("pricing159-draft", { status: "draft" });
    await refused(host.run(host.newRequestKey(), input(draft)), "do not exist or belong to a product that is not published");
  }, 180_000);

  it("fails missing PriceSet Links in the native step before calculation", async () => {
    const created = await connected.seedUnpricedVariant(first(baseline.products).id, "pricing159-unpriced-variant");
    const variantId = text(first(created).id), host = await prepare(), pricing = vi.spyOn(PricingModuleService.prototype, "calculatePrices");
    await refused(host.run(host.newRequestKey(), input(baseline, [{ id: "unpriced159", variant_id: variantId, quantity: 1 }])),
      "Variants with IDs " + variantId + " do not have a price");
    expect(pricing).not.toHaveBeenCalled();
  }, 180_000);

  it("preserves native empty-PriceSet and unmatched-currency dereference failures", async () => {
    const empty = await connected.seed("pricing159-empty-set", { prices: [] }), host = await prepare();
    for (const value of [input(empty), { ...input(baseline), cart: { ...input(baseline).cart, currency_code: "eur" } }]) {
      const failure = await refused(host.run(host.newRequestKey(), value), "reading 'calculated_amount'");
      expect(failureMessages(failure)).toContain("TypeError");
    }
  }, 180_000);

  it("retains the native nonpositive-quantity validation and real empty reads", async () => {
    const host = await prepare(), variant = first(baseline.variants);
    await refused(host.run(host.newRequestKey(), input(baseline, [{ id: "zero159", variant_id: variant.id, quantity: 0 }])),
      "Item quantity must be greater than 0");
    const pricing = vi.spyOn(PricingModuleService.prototype, "calculatePrices");
    expect(await run(host, { ...input(baseline, []), variants: { id: [] } })).toEqual({ variants: [], lineItems: [] });
    expect(pricing).not.toHaveBeenCalled();
  }, 180_000);

  it("revokes genuine native Pricing callbacks after successful settlement", async () => {
    const original = PricingModuleService.prototype.calculatePrices;
    let escaped: (() => Promise<unknown>) | undefined;
    vi.spyOn(PricingModuleService.prototype, "calculatePrices").mockImplementation(async function (this: PricingModuleService, ...args) {
      const result = await Reflect.apply(original, this, args);
      escaped = () => Reflect.apply(original, this, args);
      return result;
    });
    const host = await prepare(); expectDefault(await run(host, input(baseline)), baseline);
    if (escaped === undefined) throw new Error("Missing genuine borrowed Pricing callback");
    const before = await snapshot(); await expect(escaped()).rejects.toMatchObject({ reason: "closed" });
    expect(await snapshot()).toEqual(before);
  }, 180_000);

  it("keeps a caught read-profile write refusal sticky and revokes its borrowed callback", async () => {
    const original = PricingModuleService.prototype.calculatePrices;
    let caught = false, escaped: (() => Promise<unknown>) | undefined;
    vi.spyOn(PricingModuleService.prototype, "calculatePrices").mockImplementation(async function (this: PricingModuleService, ...args) {
      const result = await Reflect.apply(original, this, args);
      escaped = () => Reflect.apply(original, this, args);
      try { await this.createPriceSets([{ prices: [{ currency_code: "usd", amount: 999 }] }], args[2]); }
      catch { caught = true; }
      return result;
    });
    const host = await prepare();
    await refused(host.run(host.newRequestKey(), input(baseline)), "rollbackOnly");
    expect(caught).toBe(true);
    if (escaped === undefined) throw new Error("Missing genuine borrowed Pricing callback after refusal");
    const before = await snapshot(); await expect(escaped()).rejects.toMatchObject({ reason: "closed" });
    expect(await snapshot()).toEqual(before);
  }, 180_000);

  it("keeps a caught malformed native event sticky without publishing any read events", async () => {
    const original = PricingModuleService.prototype.calculatePrices;
    let caught = false;
    vi.spyOn(PricingModuleService.prototype, "calculatePrices").mockImplementation(async function (this: PricingModuleService, ...args) {
      const result = await Reflect.apply(original, this, args), bus: unknown = Reflect.get(this, "eventBusModuleService_");
      if (bus === null || typeof bus !== "object") throw new Error("Missing native Pricing event bus");
      const emit: unknown = Reflect.get(bus, "emit");
      if (typeof emit !== "function") throw new Error("Missing native Pricing event emitter");
      try { await Reflect.apply(emit, bus, [[{ name: "pricing.price.created", data: { id: 42 },
        metadata: { source: "pricing", object: "price", action: "created" } }], { internal: true }]); }
      catch { caught = true; }
      return result;
    });
    const host = await prepare(); await refused(host.run(host.newRequestKey(), input(baseline)), "rollbackOnly");
    expect(caught).toBe(true);
  }, 180_000);

  it("discards a late parent failure after the complete genuine native root", async () => {
    let completed = false;
    const execution: AtomicWorkflowExecution = { ...connected.execution, prepare: composition => Effect.gen(function* () {
      const original = composition.commands[0], definition = original === undefined ? undefined : getAtomicCommerceCommand(original);
      if (original === undefined || definition === undefined || composition.commands.length !== 1)
        return yield* Effect.fail(commerceError("invalidAuthority"));
      const forwarded = defineAtomicCommerceCommand("variantItemPricingLateParent159", (context, value) => definition.run(context, value).pipe(
        Effect.tap(() => Effect.sync(() => { completed = true; })),
        Effect.andThen(Effect.fail(commerceError("adapterFailure", new Error("Late parent failure after complete native159 root")))),
      ));
      const host = yield* connected.execution.prepare({ ...composition, commands: [forwarded] });
      return { ...host, run: (key, command, value) => host.run(key, command === original ? forwarded : command, value) } satisfies AtomicCommerceHost;
    }) };
    const host = await prepare(execution);
    await refused(host.run(host.newRequestKey(), input(baseline)), "Late parent failure after complete native159 root");
    expect(completed).toBe(true);
  }, 180_000);

  it("refuses caller-selected fields and raw item overflow before native Pricing dispatch", async () => {
    const host = await prepare(), pricing = vi.spyOn(PricingModuleService.prototype, "calculatePrices"), variant = first(baseline.variants);
    const extraFields = { fields: ["id"] };
    await refused(host.run(host.newRequestKey(), { ...input(baseline), variants: { id: [variant.id], ...extraFields } }), "invalidInput");
    await refused(host.run(host.newRequestKey(), input(baseline, Array.from({ length: 5 }, (_, index) => ({
      id: "overflow159-" + index, variant_id: variant.id, quantity: 1,
    })))), "invalidInput");
    expect(pricing).not.toHaveBeenCalled();
  }, 180_000);

  it("reads the combined maximum graph and complete native sale/override/Rule cohorts across four contexts", async () => {
    const prefix = "pricing159-combined", regionId = "reg159-combined";
    const seed = await connected.seed(prefix, { variantCount: 4, prices: [
      { currency_code: "usd", amount: 10 },
      { currency_code: "usd", amount: 8, min_quantity: 2, max_quantity: 10, rules: { is_custom_price: "false" } },
    ] });
    const listInput = [0, 1, 2, 3].map((index): Parameters<typeof connected.seedPriceLists>[0][number] => ({
      id: prefix + "-list-" + index, title: "Combined159 List " + index, description: "Combined159 native cohort",
      status: "active", type: index < 2 ? "sale" : "override",
      rules: { "customer.groups.id": ["cg159-combined"], custom_segment159: ["vip159"] },
      prices: seed.priceSetLinks.slice((index % 2) * 2, (index % 2) * 2 + 2).map(link => ({
        price_set_id: link.price_set_id, currency_code: "usd", amount: index < 2 ? 7 : 15,
        rules: { region_id: regionId, is_custom_price: "false" },
      })),
    }));
    const lists = objects(await connected.seedPriceLists(listInput));
    expect(lists).toHaveLength(4);
    const listPrices = lists.flatMap(list => {
      expect(objects(list.price_list_rules)).toHaveLength(2);
      const prices = objects(list.prices); expect(prices).toHaveLength(2);
      return prices.map(price => {
        expect(objects(price.price_rules)).toHaveLength(2); return { list, price };
      });
    });
    expect(listPrices).toHaveLength(8);
    expect(await connected.seedContextPreferences([{ attribute: "region_id", value: regionId, is_tax_inclusive: true },
      { attribute: "currency_code", value: "usd", is_tax_inclusive: false }])).toHaveLength(2);
    const value: Input = { ...input(seed, seed.variants.map((variant, index) => ({
      id: "item159-" + index, variant_id: variant.id, quantity: index + 1,
    }))), cart: { ...input(seed).cart, region_id: regionId, customer_id: "cus159-combined",
      customer: { id: "cus159-combined", groups: [{ id: "cg159-combined" }] },
      region: { id: regionId, currency_code: "usd", name: "Combined159 region" } },
      setPricingContextResult: { custom_segment159: "vip159" } };
    const host = await prepare(), pricing = vi.spyOn(PricingModuleService.prototype, "calculatePrices");
    const result = await run(host, value);
    const expected = seed.variants.map((variant, index) => {
      const priceSet = seed.priceSetLinks.find(link => link.variant_id === variant.id);
      if (priceSet === undefined) throw new Error("Missing combined native Variant–PriceSet Link");
      const sale = listPrices.find(entry => entry.list.type === "sale" && entry.price.price_set_id === priceSet.price_set_id);
      const originalAmount = index === 0 ? 10 : 8;
      const original = variant.prices.find(price => price.amount === originalAmount);
      if (sale === undefined || original === undefined) throw new Error("Missing combined native Price preimages");
      // Pinned repository order selects the lowest equal-specificity List
      // Price; the native SALE branch retains its first non-List original.
      const calculated = { id: priceSet.price_set_id, is_calculated_price_price_list: true,
        is_calculated_price_tax_inclusive: true, calculated_amount: 7, raw_calculated_amount: raw(sale.price.raw_amount),
        is_original_price_price_list: false, is_original_price_tax_inclusive: false,
        original_amount: originalAmount, raw_original_amount: raw(original.raw_amount), currency_code: "usd",
        calculated_price: { id: text(sale.price.id), price_list_id: text(sale.list.id), price_list_type: "sale",
          min_quantity: null, max_quantity: null },
        original_price: { id: text(original.id), price_list_id: null, price_list_type: null,
          min_quantity: index === 0 ? null : 2, max_quantity: index === 0 ? null : 10 } };
      const line = expectedLine(seed, variant, index);
      return { variant: { ...expectedVariant(seed, variant), calculated_price: calculated },
        line: { ...line, data: { ...line.data, quantity: index + 1, unit_price: 7,
          compare_at_unit_price: originalAmount, is_tax_inclusive: true } } };
    });
    expect(result).toEqual({ variants: expected.map(row => row.variant).sort((a, b) => a.id.localeCompare(b.id)),
      lineItems: expected.map(row => row.line) });
    expect(pricing).toHaveBeenCalledTimes(4);
    expect(pricing.mock.calls.map(call => call[1]?.context?.quantity)).toEqual([1, 2, 3, 4]);
    expect(pricing.mock.calls.map(call => call[0].id)).toEqual(seed.priceSetLinks.map(link => [link.price_set_id]));
    for (const call of pricing.mock.calls) expect(call[1]).toMatchObject({ context: {
      customer: { id: "cus159-combined", groups: [{ id: "cg159-combined" }] },
      region: { id: regionId, currency_code: "usd", name: "Combined159 region" },
      custom_segment159: "vip159", is_custom_price: false,
    } });
  }, 180_000);
});
