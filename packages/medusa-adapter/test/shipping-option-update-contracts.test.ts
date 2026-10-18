import { beforeAll, describe, expect, it, vi } from "vitest";
import { Effect, Result } from "effect";
import { commerceDecoder } from "../src/value/decoder";
import { ShippingOptionUpdateInput, prepareShippingOptionUpdateResources, prepareShippingOptionUpdateWorkflow } from "../src/workflows/fulfillment/update-shipping-options";
import { makeLocalShippingOptionUpdateCommands } from "../src/modules/fulfillment/shipping-option-update-service";
import { makeLocalShippingOptionCreationCommands } from "../src/modules/fulfillment/shipping-option-create-service";
import { makeLocalPricingCommands } from "../src/modules/pricing/service";
import { makeLocalRegionReadCommands } from "../src/modules/region/service";
import { makeStockLocationCommands } from "../src/modules/stock-location/service";
import { prepareLocationFulfillmentSetLinkRead } from "../src/links/location-fulfillment-set-service";
import { prepareLocationFulfillmentProviderLink } from "../src/links/location-fulfillment-provider-service";
import { prepareShippingOptionPriceSetLink } from "../src/links/shipping-option-price-set-service";
import { defineWorkflowModule } from "../src/workflow/module";
import { workflowResourceSelections } from "../src/workflow/resources";
import { shippingOptionUpdateResources, shippingOptionUpdateCommandMs } from "../src/workflow/policy";
import type { AtomicWorkflowHostComposition, InstalledWorkflowModule } from "../src/workflow/host";
import { captureAtomicCommerceEvents } from "../../persistence-postgres/src/frameworks/atomicCommerce/events";

const decode = commerceDecoder(ShippingOptionUpdateInput, "invalidInput");
const selectedModules = Effect.gen(function* () {
  const fulfillment = yield* makeLocalShippingOptionUpdateCommands(), pricing = yield* makeLocalPricingCommands("shipping-option-updates"),
    region = yield* makeLocalRegionReadCommands(), stockLocation = yield* makeStockLocationCommands("read"),
    locationLinks = yield* prepareLocationFulfillmentSetLinkRead(), providerLinks = yield* prepareLocationFulfillmentProviderLink(),
    priceSetLinks = yield* prepareShippingOptionPriceSetLink();
  return { fulfillment: fulfillment.workflow, pricing: pricing.workflow, region: region.workflow, stockLocation: stockLocation.workflow,
    locationLinks: locationLinks.workflow, providerLinks: providerLinks.workflow, priceSetLinks: priceSetLinks.workflow };
});
let modules: Effect.Success<typeof selectedModules>;
beforeAll(async () => { modules = await Effect.runPromise(selectedModules); });

describe("native Shipping Option update facade contract", () => {
  it("retains the raw native array, empty roots, partial prices, Types and Rules", () => {
    expect(Result.getOrThrow(decode([]))).toEqual([]);
    const input = [
      { id: "option-a", name: " Raw Name ", type: { id: "type" }, rules: [{ id: "rule", value: false }] },
      { id: "option-b", prices: [{ id: "price" }, { id: "another-price", amount: 125 }] },
      { id: "option-c", type: "type", type_id: "alias", rules: [], prices: [] },
      { id: "option-d", metadata: { nested: [null, { raw: true }] }, data: null, prices: [
        { region_id: "region", amount: 150, rules: [{ attribute: "cart_total", operator: "gte", value: 100 }] },
        { currency_code: "USD", amount: 200 },
      ] },
    ];
    expect(Result.getOrThrow(decode(input))).toEqual(input);
    expect(Result.isFailure(decode({ options: input }))).toBe(true);
  });

  it("leaves native calculated-price and numeric-operator decisions to their owners", () => {
    const input = [{ id: "option-a", price_type: "calculated", provider_id: "manual_manual" },
      { id: "option-b", prices: [{ currency_code: "usd", amount: 1,
        rules: [{ attribute: "cart_total", operator: "native-invalid-operator", value: 1 }] }] }];
    expect(Result.getOrThrow(decode(input))).toEqual(input);
  });

  it("excludes managed retained DTOs from public input and enforces the four-root envelope", () => {
    for (const field of ["created_at", "updated_at", "deleted_at", "shipping_option_type_id", "price_set_id", "foreign"])
      expect(Result.isFailure(decode([{ id: "option", [field]: "forbidden" }]))).toBe(true);
    for (const patch of [
      { type: { id: "type", created_at: "retained" } },
      { rules: [{ id: "rule", value: "x", created_at: "retained" }] },
      { prices: [{ id: "price", price_set_id: "set" }] },
      { prices: [{ id: "price", amount: "10" }] },
      { prices: [{ id: "price", amount: 10, raw_amount: { value: "10", precision: 20 } }] },
      { prices: [{ currency_code: "usd", amount: 10, rules: [{ attribute: "x", operator: "gte", value: "10" }] }] },
    ]) expect(Result.isFailure(decode([{ id: "option", ...patch }]))).toBe(true);
    expect(Result.isFailure(decode(Array.from({ length: 5 }, (_, index) => ({ id: "option-" + index }))))).toBe(true);
    expect(Result.isFailure(decode([{ id: "option", prices: [{ id: "a" }, { id: "b" }, { id: "c" }] }]))).toBe(true);
    expect(Result.isFailure(decode([{ id: "option", rules: Array.from({ length: 5 }, () => ({ value: "x" })) }]))).toBe(true);
  });

  it("prepares the genuine seven-module closure with read-only Links and exactly four Pricing methods", () => {
    const resources = Result.getOrThrow(prepareShippingOptionUpdateResources(modules));
    expect(workflowResourceSelections(resources)?.map(selection => [selection.name, selection.methods])).toEqual([
      ["fulfillment", ["upsertShippingOptions", "validateShippingOptionsForPriceCalculation", "listShippingOptions", "listFulfillmentProviders",
        "listShippingOptionRules", "createShippingOptionRules", "deleteShippingOptionRules"]],
      ["pricing", ["updatePriceSets", "listPrices", "listPriceRules", "createPriceRules"]],
      ["region", ["listRegions"]], ["stockLocation", []], ["locationLinks", ["list"]], ["providerLinks", ["list"]], ["priceSetLinks", ["list"]],
    ]);
    const definitions = workflowResourceSelections(resources);
    expect(definitions?.filter(selection => ["stockLocation", "locationLinks", "providerLinks", "priceSetLinks"].includes(selection.name))
      .every(selection => selection.expose === false && selection.graph)).toBe(true);
  });

  it("rejects creation profiles, missing modules and forged identities before execution preparation", async () => {
    const creation = await Effect.runPromise(makeLocalShippingOptionCreationCommands()), pricingCreation = await Effect.runPromise(makeLocalPricingCommands("shipping-options"));
    const wrong = Result.getOrThrow(defineWorkflowModule({ name: "fulfillment", source: { name: "flarex-shipping-option-update", profile: "wrong" },
      methods: {}, graph: { aliases: [], reads: [] } }));
    for (const input of [{ ...modules, fulfillment: creation.workflow }, { ...modules, pricing: pricingCreation.workflow },
      { ...modules, fulfillment: { ...modules.fulfillment } }, { ...modules, pricing: {} }, { ...modules, region: undefined },
      { ...modules, fulfillment: wrong }])
      expect(Reflect.apply(prepareShippingOptionUpdateResources, undefined, [input])).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    const { priceSetLinks: _missing, ...missing } = modules;
    expect(Reflect.apply(prepareShippingOptionUpdateResources, undefined, [missing]))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    const getter = vi.fn(() => modules.fulfillment), accessor = { ...modules };
    Object.defineProperty(accessor, "fulfillment", { enumerable: true, get: getter });
    expect(Reflect.apply(prepareShippingOptionUpdateResources, undefined, [accessor]))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(getter).not.toHaveBeenCalled();
  });

  it("pins the selected allowance and grants pending cancellation only to the native workflow event", async () => {
    const installed: Record<string, InstalledWorkflowModule> = {};
    // This preparation-only port observes genuine module capabilities and owns
    // no database or simulated persistence implementation.
    for (const [name, module] of Object.entries(modules)) Object.defineProperty(installed, name, {
      enumerable: true, value: { module, logicalStorage: {}, logicalPublication: "mixed" },
    });
    const captured: AtomicWorkflowHostComposition[] = [];
    const prepare = vi.fn((composition: AtomicWorkflowHostComposition) => {
      captured.push(composition);
      return Effect.succeed({ close: Effect.void, newRequestKey: () => "unit-key", run: () => Effect.succeed([]) });
    });
    const input = { execution: { identityAndAccessPolicy: { fixture: "preparation-only" }, prepare }, modules: installed,
      revision: "a".repeat(64), subscribers: [{ id: "shipping", revision: "b".repeat(64) }] };
    await Effect.runPromise(Reflect.apply(prepareShippingOptionUpdateWorkflow, undefined, [input]));
    expect(prepare).toHaveBeenCalledTimes(1);
    const composition = captured[0]; if (!composition?.events) throw new Error("Missing prepared Shipping update composition");
    expect(composition.participants).toHaveLength(7);
    expect(composition).toMatchObject({ operationScheduling: "queued", requestCommandMs: shippingOptionUpdateCommandMs,
      requestCallLimit: shippingOptionUpdateResources.calls, requestEventLimit: shippingOptionUpdateResources.eventMessages,
      requestByteLimit: shippingOptionUpdateResources.commandBytes });
    for (const [index, member] of composition.participants.entries()) {
      if (!("logicalResources" in member)) throw new Error("Missing selected logical allowance");
      expect(member.logicalResources).toEqual(shippingOptionUpdateResources);
      expect("logicalPublication" in member ? member.logicalPublication : undefined).toBe(index === 1 ? "mixed" : undefined);
    }
    const definitions = Result.getOrThrow(captureAtomicCommerceEvents(composition.events)).definitions;
    expect(definitions.filter(item => item.definition?.pendingCancellation).map(item => item.definition?.name)).toEqual(["shipping-option.updated"]);
    expect(definitions.filter(item => item.definition?.internal).every(item => item.definition?.pendingCancellation === undefined)).toBe(true);
    for (const extra of [{ link: {} }, { hooks: {} }, { provider: {} }])
      expect(await Effect.runPromise(Effect.result(Reflect.apply(prepareShippingOptionUpdateWorkflow, undefined, [{ ...input, ...extra }]))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    const altered = { ...installed, pricing: { module: modules.pricing, logicalStorage: {},
      logicalResources: { ...shippingOptionUpdateResources, calls: shippingOptionUpdateResources.calls - 1 } } };
    expect(await Effect.runPromise(Effect.result(Reflect.apply(prepareShippingOptionUpdateWorkflow, undefined, [{ ...input, modules: altered }]))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(prepare).toHaveBeenCalledTimes(1);
  });
});
