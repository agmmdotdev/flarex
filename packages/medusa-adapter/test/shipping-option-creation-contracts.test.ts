import { describe, expect, it, vi } from "vitest";
import { Effect, Result } from "effect";
import { commerceDecoder } from "../src/value/decoder";
import { ShippingOptionCreationInput, prepareShippingOptionCreationWorkflow, prepareShippingOptionCreationResources,
  shippingOptionCreationEvents } from "../src/workflows/fulfillment/create-shipping-options";
import { defineWorkflowModule } from "../src/workflow/module";
import { makeLocalShippingOptionCreationCommands } from "../src/modules/fulfillment/shipping-option-create-service";
import { makeLocalPricingCommands } from "../src/modules/pricing/service";
import { makeLocalRegionReadCommands } from "../src/modules/region/service";
import { makeStockLocationCommands } from "../src/modules/stock-location/service";
import { prepareLocationFulfillmentSetLinkRead } from "../src/links/location-fulfillment-set-service";
import { prepareLocationFulfillmentProviderLink } from "../src/links/location-fulfillment-provider-service";
import { prepareShippingOptionPriceSetLink, prepareShippingOptionCreationLinkResource } from "../src/links/shipping-option-price-set-service";
import { shippingOptionCreationResources } from "../src/workflow/policy";
import type { AtomicWorkflowHostComposition, InstalledWorkflowModule } from "../src/workflow/host";
import { captureAtomicCommerceEvents } from "../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { workflowResourceSelections } from "../src/workflow/resources";

const decode = commerceDecoder(ShippingOptionCreationInput, "invalidInput");
const flat = { name: " Raw Name ", price_type: "flat", service_zone_id: "zone", shipping_profile_id: "profile", provider_id: "manual_manual",
  type: { label: " Native Label ", code: " Raw CODE ", description: null },
  prices: [{ currency_code: "USD", amount: 100 }] };

describe("native Shipping Option creation facade contract", () => {
  it("captures the native raw-array shape, empty roots and the four-root currency/Region envelope", () => {
    expect(Result.getOrThrow(decode([]))).toEqual([]);
    const input = [flat, { ...flat, type_id: "existing-type", prices: [] },
      { ...flat, prices: [{ region_id: "region", amount: 150, rules: [{ attribute: "cart_total", operator: "gte", value: 100 },
        { attribute: "cart_total", operator: "lt", value: 500 }] }, { currency_code: "eur", amount: 200 }] },
      { ...flat, metadata: { nested: [null, { native: true }] }, rules: [{ attribute: "customer_group", operator: "in", value: ["group-a", "group-b"] }] }];
    expect(Result.getOrThrow(decode(input))).toEqual(input);
    expect(Result.isFailure(decode({ options: input }))).toBe(true);
  });

  it("leaves calculated-price and invalid numeric-operator decisions to the executing native owners", () => {
    const calculated = { name: "Calculated", price_type: "calculated", service_zone_id: "zone", shipping_profile_id: "profile", provider_id: "manual_manual" };
    const invalid = { ...flat, prices: [{ currency_code: "usd", amount: 10,
      rules: [{ attribute: "cart_total", operator: "native-invalid-operator", value: 10 }] }] };
    expect(Result.getOrThrow(decode([calculated, invalid]))).toEqual([calculated, invalid]);
  });

  it("refuses managed identities, malformed prices and expanded inputs beyond the selected envelope", () => {
    for (const field of ["id", "created_at", "updated_at", "deleted_at", "price_set_id", "shipping_option_type_id", "foreign"])
      expect(Result.isFailure(decode([{ ...flat, [field]: "forbidden" }]))).toBe(true);
    for (const price of [{ currency_code: "usd", amount: "10" }, { currency_code: "usd", amount: 10, raw_amount: { value: "10", precision: 20 } },
      { region_id: "region", currency_code: "usd", amount: 10 }, { currency_code: "usd", amount: 10, rules: [{ attribute: "cart_total", operator: "gte", value: "10" }] }])
      expect(Result.isFailure(decode([{ ...flat, prices: [price] }]))).toBe(true);
    expect(Result.isFailure(decode(Array.from({ length: 5 }, () => flat)))).toBe(true);
    expect(Result.isFailure(decode([{ ...flat, prices: Array.from({ length: 3 }, () => flat.prices[0]) }]))).toBe(true);
    expect(Result.isFailure(decode([{ ...flat, prices: [{ currency_code: "usd", amount: 10,
      rules: Array.from({ length: 3 }, () => ({ attribute: "cart_total", operator: "gte", value: 10 })) }] }]))).toBe(true);
  });

  it("refuses extra facade capabilities and malformed module cohorts before preparing execution", async () => {
    const prepare = vi.fn(() => Effect.die(new Error("Execution preparation must not run")));
    const base = { execution: { identityAndAccessPolicy: {}, prepare }, modules: {}, link: {}, revision: "a".repeat(64),
      subscribers: [{ id: "shipping", revision: "b".repeat(64) }] };
    for (const input of [{ ...base, hooks: {} }, { ...base, provider: {} }, base, { ...base, modules: { fulfillment: {} } }]) {
      const result = await Effect.runPromise(Effect.result(Reflect.apply(prepareShippingOptionCreationWorkflow, undefined, [input])));
      expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    }
    expect(prepare).not.toHaveBeenCalled();
  });

  it("requires the selected source profile and refuses module accessors without evaluating them", async () => {
    const prepare = vi.fn(() => Effect.die(new Error("Execution preparation must not run"))), getter = vi.fn(() => ({}));
    const wrong = Result.getOrThrow(defineWorkflowModule({ name: "fulfillment", source: { name: "flarex-shipping-option-create", profile: "wrong-profile" },
      methods: {}, graph: { aliases: [], reads: [] } }));
    const names = ["fulfillment", "pricing", "region", "stockLocation", "locationLinks", "providerLinks", "priceSetLinks"];
    const modules = Object.fromEntries(names.map(name => [name, { module: wrong, logicalStorage: {} }]));
    const input = { execution: { identityAndAccessPolicy: {}, prepare }, modules, link: {}, revision: "a".repeat(64),
      subscribers: [{ id: "shipping", revision: "b".repeat(64) }] };
    expect(await Effect.runPromise(Effect.result(Reflect.apply(prepareShippingOptionCreationWorkflow, undefined, [input]))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    const accessor = { ...modules };
    Object.defineProperty(accessor, "fulfillment", { enumerable: true, get: getter });
    expect(await Effect.runPromise(Effect.result(Reflect.apply(prepareShippingOptionCreationWorkflow, undefined, [{ ...input, modules: accessor }]))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(prepare).not.toHaveBeenCalled(); expect(getter).not.toHaveBeenCalled();
  });

  it("prepares authentic native resources, pins its allowance and grants cancellation only to the workflow event", async () => {
    const selected = await Effect.runPromise(Effect.gen(function* () {
      const fulfillment = yield* makeLocalShippingOptionCreationCommands(), pricing = yield* makeLocalPricingCommands("shipping-options"),
        region = yield* makeLocalRegionReadCommands(), stockLocation = yield* makeStockLocationCommands("read"),
        locationLinks = yield* prepareLocationFulfillmentSetLinkRead(), providerLinks = yield* prepareLocationFulfillmentProviderLink(),
        priceSetLinks = yield* prepareShippingOptionPriceSetLink();
      const link = yield* Effect.fromResult(prepareShippingOptionCreationLinkResource({ location: locationLinks.nativeService,
        provider: providerLinks.nativeService, pricing: priceSetLinks.nativeService }));
      const resources = yield* Effect.fromResult(prepareShippingOptionCreationResources({ fulfillment: fulfillment.workflow, pricing: pricing.workflow,
        region: region.workflow, stockLocation: stockLocation.workflow, locationLinks: locationLinks.workflow,
        providerLinks: providerLinks.workflow, priceSetLinks: priceSetLinks.workflow }, link));
      return { modules: { fulfillment, pricing, region, stockLocation, locationLinks, providerLinks, priceSetLinks }, link, resources };
    }));
    const selection = workflowResourceSelections(selected.resources);
    expect(selection?.map(member => [member.name, member.methods])).toEqual([
      ["fulfillment", ["upsertShippingOptions", "deleteShippingOptions", "validateShippingOptionsForPriceCalculation", "listShippingOptions", "listFulfillmentProviders"]],
      ["pricing", ["createPriceSets", "deletePriceSets"]], ["region", ["listRegions"]], ["stockLocation", []],
      ["locationLinks", ["list"]], ["providerLinks", ["list"]], ["priceSetLinks", ["create", "list", "dismiss"]],
    ]);
    await Effect.runPromise(shippingOptionCreationEvents(selected.modules.fulfillment.workflow, selected.modules.fulfillment.contracts)
      .validate([], { calls: () => [], results: () => [] }));
    const modules: Record<string, InstalledWorkflowModule> = {};
    // This preparation port owns no database or persistence simulation. Native
    // tokens/graphs/router are real; execution admission is observed below.
    for (const [name, service] of Object.entries(selected.modules)) Object.defineProperty(modules, name, {
      enumerable: true, value: { module: service.workflow, logicalStorage: {}, logicalPublication: "mixed" },
    });
    const compositions: AtomicWorkflowHostComposition[] = [];
    const prepare = vi.fn((composition: AtomicWorkflowHostComposition) => {
      compositions.push(composition);
      return Effect.succeed({ close: Effect.void, newRequestKey: () => "unit-key", run: () => Effect.succeed([]) });
    });
    const input = { execution: { identityAndAccessPolicy: { fixture: "preparation-only" }, prepare }, modules, link: selected.link,
      revision: "a".repeat(64), subscribers: [{ id: "shipping", revision: "b".repeat(64) }] };
    await Effect.runPromise(Reflect.apply(prepareShippingOptionCreationWorkflow, undefined, [input]));
    expect(prepare).toHaveBeenCalledTimes(1);
    const composition = compositions[0]; if (!composition?.events) throw new Error("Missing prepared native Shipping composition");
    expect(composition.participants).toHaveLength(7);
    for (const member of composition.participants) {
      if (!("logicalResources" in member)) throw new Error("Missing selected logical allowance");
      expect(member.logicalResources).toEqual(shippingOptionCreationResources);
      expect("logicalPublication" in member ? member.logicalPublication : undefined).toBeUndefined();
    }
    expect(composition).toMatchObject({ operationScheduling: "queued", requestCallLimit: shippingOptionCreationResources.calls,
      requestEventLimit: shippingOptionCreationResources.eventMessages, requestByteLimit: shippingOptionCreationResources.commandBytes });
    const definitions = Result.getOrThrow(captureAtomicCommerceEvents(composition.events)).definitions;
    expect(definitions.filter(item => item.definition?.pendingCancellation).map(item => item.definition?.name)).toEqual(["shipping-option.created"]);
    expect(definitions.filter(item => item.definition?.internal).every(item => item.definition?.pendingCancellation === undefined)).toBe(true);
    const altered = { ...modules };
    Object.defineProperty(altered, "pricing", { enumerable: true, value: { module: selected.modules.pricing.workflow,
      logicalStorage: {}, logicalResources: { ...shippingOptionCreationResources, calls: shippingOptionCreationResources.calls - 1 } } });
    expect(await Effect.runPromise(Effect.result(Reflect.apply(prepareShippingOptionCreationWorkflow, undefined, [{ ...input, modules: altered }]))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(await Effect.runPromise(Effect.result(Reflect.apply(prepareShippingOptionCreationWorkflow, undefined, [{ ...input, link: { ...selected.link } }]))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    expect(prepare).toHaveBeenCalledTimes(1);
  });
});
