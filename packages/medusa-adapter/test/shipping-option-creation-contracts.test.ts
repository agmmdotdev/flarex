import { beforeAll, describe, expect, it, vi } from "vitest";
import { Effect, Result } from "effect";
import { commerceDecoder } from "../src/value/decoder";
import { ShippingOptionCreationInput, prepareShippingOptionCreationWorkflow, prepareShippingOptionCreationResources,
  prepareLegacyShippingOptionCreationWorkflow, shippingOptionCreationEvents } from "../src/workflows/fulfillment/create-shipping-options";
import { defineWorkflowModule } from "../src/workflow/module";
import { makeLocalShippingOptionCreationCommands, makeLegacyShippingOptionCreationCommands } from "../src/modules/fulfillment/shipping-option-create-service";
import { compileServiceZoneCreationCoreDefinition, compileShippingProfileCoreDefinition, compileFulfillmentCreationCoreDefinition } from "../src/modules/fulfillment/shipping-profile-schema";
import { makeLocalPricingCommands } from "../src/modules/pricing/service";
import { compilePricingCoreDefinition } from "../src/modules/pricing/schema";
import { makeLocalRegionReadCommands } from "../src/modules/region/service";
import { compileRegionCoreDefinition } from "../src/modules/region/schema";
import { makeStockLocationCommands } from "../src/modules/stock-location/service";
import { compileStockLocationCoreDefinition } from "../src/modules/stock-location/schema";
import { prepareLocationFulfillmentSetLinkRead } from "../src/links/location-fulfillment-set-service";
import { prepareLocationFulfillmentProviderLink } from "../src/links/location-fulfillment-provider-service";
import { prepareShippingOptionPriceSetLink, prepareShippingOptionCreationLinkResource } from "../src/links/shipping-option-price-set-service";
import { compileLocationFulfillmentSetLinkCoreDefinition } from "../src/links/location-fulfillment-set-schema";
import { compileLocationFulfillmentProviderLinkCoreDefinition } from "../src/links/location-fulfillment-provider-schema";
import { compileShippingOptionPriceSetLinkCoreDefinition } from "../src/links/shipping-option-price-set-schema";
import { shippingOptionCreationResources } from "../src/workflow/policy";
import type { AtomicWorkflowHostComposition } from "../src/workflow/host";
import { captureAtomicCommerceEvents } from "../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { defineAtomicCommerceNativeSource } from "../../persistence-postgres/src/frameworks/atomicCommerce/nativeSelection";
import { workflowResourceSelections } from "../src/workflow/resources";

const decode = commerceDecoder(ShippingOptionCreationInput, "invalidInput");
const flat = { name: " Raw Name ", price_type: "flat", service_zone_id: "zone", shipping_profile_id: "profile", provider_id: "manual_manual",
  type: { label: " Native Label ", code: " Raw CODE ", description: null },
  prices: [{ currency_code: "USD", amount: 100 }] };
const target = { scopeUuid: "91000000-0000-4000-8000-000000000043", epochUuid: "92000000-0000-4000-8000-000000000043" };
const selectNative = () => Effect.gen(function* () {
  const fulfillment = yield* makeLocalShippingOptionCreationCommands(), pricing = yield* makeLocalPricingCommands("shipping-options"),
    region = yield* makeLocalRegionReadCommands(), stockLocation = yield* makeStockLocationCommands("read"),
    locationLinks = yield* prepareLocationFulfillmentSetLinkRead(), providerLinks = yield* prepareLocationFulfillmentProviderLink(),
    priceSetLinks = yield* prepareShippingOptionPriceSetLink();
  const definitions = yield* Effect.all({ fulfillment: compileServiceZoneCreationCoreDefinition(target), pricing: compilePricingCoreDefinition(target),
    region: compileRegionCoreDefinition(target), stockLocation: compileStockLocationCoreDefinition(target),
    locationLinks: compileLocationFulfillmentSetLinkCoreDefinition(target), providerLinks: compileLocationFulfillmentProviderLinkCoreDefinition(target),
    priceSetLinks: compileShippingOptionPriceSetLinkCoreDefinition(target) });
  const sources = {
    fulfillment: yield* Effect.fromResult(defineAtomicCommerceNativeSource("fulfillment", definitions.fulfillment)),
    pricing: yield* Effect.fromResult(defineAtomicCommerceNativeSource("pricing", definitions.pricing)),
    region: yield* Effect.fromResult(defineAtomicCommerceNativeSource("region", definitions.region)),
    stockLocation: yield* Effect.fromResult(defineAtomicCommerceNativeSource("stock_location", definitions.stockLocation)),
    locationLinks: yield* Effect.fromResult(defineAtomicCommerceNativeSource("locationLinks", definitions.locationLinks)),
    providerLinks: yield* Effect.fromResult(defineAtomicCommerceNativeSource("providerLinks", definitions.providerLinks)),
    priceSetLinks: yield* Effect.fromResult(defineAtomicCommerceNativeSource("priceSetLinks", definitions.priceSetLinks)),
  };
  const modules = { fulfillment: { module: fulfillment.workflow, nativeStorage: sources.fulfillment }, pricing: { module: pricing.workflow, nativeStorage: sources.pricing },
    region: { module: region.workflow, nativeStorage: sources.region }, stockLocation: { module: stockLocation.workflow, nativeStorage: sources.stockLocation },
    locationLinks: { module: locationLinks.workflow, nativeStorage: sources.locationLinks }, providerLinks: { module: providerLinks.workflow, nativeStorage: sources.providerLinks },
    priceSetLinks: { module: priceSetLinks.workflow, nativeStorage: sources.priceSetLinks } };
  const link = yield* Effect.fromResult(prepareShippingOptionCreationLinkResource({ location: locationLinks.nativeService,
    provider: providerLinks.nativeService, pricing: priceSetLinks.nativeService }));
  const resources = yield* Effect.fromResult(prepareShippingOptionCreationResources({ fulfillment: fulfillment.workflow, pricing: pricing.workflow,
    region: region.workflow, stockLocation: stockLocation.workflow, locationLinks: locationLinks.workflow,
    providerLinks: providerLinks.workflow, priceSetLinks: priceSetLinks.workflow }, link));
  return { services: { fulfillment, pricing, region, stockLocation, locationLinks, providerLinks, priceSetLinks }, sources, modules, link, resources };
});
let selected: Effect.Success<ReturnType<typeof selectNative>>;
beforeAll(async () => { selected = await Effect.runPromise(selectNative()); });

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
    for (const input of [{ ...base, hooks: {} }, { ...base, provider: {} }, { ...base, allowTaskControl: true }, { ...base, taskBinding: {} },
      base, { ...base, modules: { fulfillment: {} } }]) {
      const result = await Effect.runPromise(Effect.result(Reflect.apply(prepareShippingOptionCreationWorkflow, undefined, [input])));
      expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    }
    expect(prepare).not.toHaveBeenCalled();
  });

  it("requires the selected source profile and refuses module accessors without evaluating them", async () => {
    const prepare = vi.fn(() => Effect.die(new Error("Execution preparation must not run"))), getter = vi.fn(() => ({}));
    const wrong = Result.getOrThrow(defineWorkflowModule({ name: "fulfillment", source: { name: "flarex-shipping-option-create", profile: "wrong-profile" },
      methods: {}, graph: { aliases: [], reads: [] } }));
    const modules = { ...selected.modules, fulfillment: { ...selected.modules.fulfillment, module: wrong } };
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
    const selection = workflowResourceSelections(selected.resources);
    expect(selection?.map(member => [member.name, member.methods])).toEqual([
      ["fulfillment", ["upsertShippingOptions", "deleteShippingOptions", "validateShippingOptionsForPriceCalculation", "listShippingOptions", "listFulfillmentProviders"]],
      ["pricing", ["createPriceSets", "deletePriceSets"]], ["region", ["listRegions"]], ["stockLocation", []],
      ["locationLinks", ["list"]], ["providerLinks", ["list"]], ["priceSetLinks", ["create", "list", "dismiss"]],
    ]);
    await Effect.runPromise(shippingOptionCreationEvents(selected.services.fulfillment.workflow, selected.services.fulfillment.contracts)
      .validate([], { calls: () => [], results: () => [] }));
    // This preparation port owns no database or persistence simulation. Native
    // tokens/graphs/router are real; execution admission is observed below.
    const modules = selected.modules;
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
      expect(member.nativeStorage).toBeDefined();
      expect(member.statementReferenceChecks).toBe(member.nativeStorage === selected.sources.fulfillment ? true : undefined);
    }
    const fulfillment = composition.participants.find(member => member.nativeStorage === selected.sources.fulfillment);
    if (fulfillment?.validateLogicalCall === undefined) throw new Error("Missing genuine per-call creation receipt");
    const emptyCall = { commandName: "shippingOptionCreateForWorkflow", mode: "write" as const, input: [], result: [], events: [],
      fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0 };
    const emptyActivity = { observedRows: [], relationalReads: [], mutations: [], lifecycle: [], setNull: [], referenceReplacements: [] };
    await Effect.runPromise(fulfillment.validateLogicalCall(emptyCall, emptyActivity, selected.services.fulfillment.upsert));
    expect(await Effect.runPromise(Effect.result(fulfillment.validateLogicalCall(emptyCall, {
      ...emptyActivity, observedRows: [{ table: "foreign", row: { id: "foreign" } }],
    }, selected.services.fulfillment.upsert)))).toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
    expect(composition).toMatchObject({ operationScheduling: "queued", requestCallLimit: shippingOptionCreationResources.calls,
      requestEventLimit: shippingOptionCreationResources.eventMessages, requestByteLimit: shippingOptionCreationResources.commandBytes });
    const definitions = Result.getOrThrow(captureAtomicCommerceEvents(composition.events)).definitions;
    expect(definitions.filter(item => item.definition?.pendingCancellation).map(item => item.definition?.name)).toEqual(["shipping-option.created"]);
    expect(definitions.filter(item => item.definition?.internal).every(item => item.definition?.pendingCancellation === undefined)).toBe(true);
    for (const override of [{ logicalResources: shippingOptionCreationResources },
      { logicalResources: { ...shippingOptionCreationResources, calls: shippingOptionCreationResources.calls - 1 } }, { logicalPublication: "mixed" }, { taskBinding: {} }])
      expect(await Effect.runPromise(Effect.result(Reflect.apply(prepareShippingOptionCreationWorkflow, undefined, [{ ...input,
        modules: { ...modules, pricing: { ...modules.pricing, ...override } } }]))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    for (const extra of [{ allowTaskControl: true }, { taskBinding: {} }, { hooks: {} }, { provider: {} }])
      expect(await Effect.runPromise(Effect.result(Reflect.apply(prepareShippingOptionCreationWorkflow, undefined, [{ ...input, ...extra }]))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(await Effect.runPromise(Effect.result(Reflect.apply(prepareShippingOptionCreationWorkflow, undefined, [{ ...input, link: { ...selected.link } }]))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it("refuses copied, swapped, narrower and wider issued native sources before execution preparation", async () => {
    const prepare = vi.fn(() => Effect.die(new Error("Execution preparation must not run")));
    const input = { execution: { identityAndAccessPolicy: {}, prepare }, modules: selected.modules, link: selected.link,
      revision: "a".repeat(64), subscribers: [{ id: "shipping", revision: "b".repeat(64) }] };
    const definitions = await Effect.runPromise(Effect.all([compileShippingProfileCoreDefinition(target), compileFulfillmentCreationCoreDefinition(target)]));
    const sources = definitions.map(definition => Result.getOrThrow(defineAtomicCommerceNativeSource("fulfillment", definition)));
    for (const modules of [
      { ...selected.modules, fulfillment: { ...selected.modules.fulfillment, nativeStorage: { ...selected.sources.fulfillment } } },
      { ...selected.modules, fulfillment: { ...selected.modules.fulfillment, module: { ...selected.services.fulfillment.workflow } } },
      { ...selected.modules, fulfillment: { ...selected.modules.fulfillment, nativeStorage: selected.sources.pricing } },
      { ...selected.modules, region: { ...selected.modules.region, nativeStorage: selected.sources.stockLocation } },
      ...sources.map(nativeStorage => ({ ...selected.modules, fulfillment: { ...selected.modules.fulfillment, nativeStorage } })),
    ]) expect(await Effect.runPromise(Effect.result(Reflect.apply(prepareShippingOptionCreationWorkflow, undefined, [{ ...input, modules }]))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("keeps Legacy construction outside the native facade and native selection outside the Legacy facade", async () => {
    const legacy = await Effect.runPromise(makeLegacyShippingOptionCreationCommands());
    expect(legacy.logicalEventPolicy().statementReferenceChecks).toBeUndefined();
    const prepare = vi.fn(() => Effect.die(new Error("Execution preparation must not run")));
    const input = { execution: { identityAndAccessPolicy: {}, prepare }, modules: selected.modules, link: selected.link,
      revision: "a".repeat(64), subscribers: [{ id: "shipping", revision: "b".repeat(64) }] };
    for (const modules of [
      { ...selected.modules, fulfillment: { ...selected.modules.fulfillment, module: legacy.workflow } },
      { ...selected.modules, fulfillment: { module: legacy.workflow, logicalStorage: {} } },
    ]) expect(await Effect.runPromise(Effect.result(Reflect.apply(prepareShippingOptionCreationWorkflow, undefined, [{ ...input, modules }]))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    expect(await Effect.runPromise(Effect.result(Reflect.apply(prepareLegacyShippingOptionCreationWorkflow, undefined, [input]))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(prepare).not.toHaveBeenCalled();
  });
});
