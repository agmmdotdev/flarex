import { beforeAll, describe, expect, it, vi } from "vitest";
import { Effect, Result } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import { LocationFulfillmentProvider, ShippingOptionPriceSet } from "@medusajs/link-modules";
import { captureLocationFulfillmentProviderLinkMetadata, compileLocationFulfillmentProviderLinkDefinition } from "../src/links/location-fulfillment-provider-schema";
import { captureShippingOptionPriceSetLinkMetadata, compileShippingOptionPriceSetLinkDefinition } from "../src/links/shipping-option-price-set-schema";
import { prepareLocationFulfillmentProviderLink } from "../src/links/location-fulfillment-provider-service";
import { prepareShippingOptionPriceSetLink, prepareShippingOptionCreationLinkResource, captureShippingOptionPriceSetLinkService } from "../src/links/shipping-option-price-set-service";
import { prepareLocationFulfillmentSetLinkRead, prepareLocationFulfillmentSetLink } from "../src/links/location-fulfillment-set-service";
import { workflowMethodDefinition, workflowModuleDefinition } from "../src/workflow/module";
import { linkWorkflowServiceDefinition } from "../src/links/workflow-service";
import { composedWorkflowResourceDefinition } from "../src/workflow/composed-resource";

let provider: Effect.Success<ReturnType<typeof prepareLocationFulfillmentProviderLink>>;
let pricing: Effect.Success<ReturnType<typeof prepareShippingOptionPriceSetLink>>;
let location: Effect.Success<ReturnType<typeof prepareLocationFulfillmentSetLinkRead>>;
beforeAll(async () => {
  location = await Effect.runPromise(prepareLocationFulfillmentSetLinkRead());
  provider = await Effect.runPromise(prepareLocationFulfillmentProviderLink());
  pricing = await Effect.runPromise(prepareShippingOptionPriceSetLink());
});

describe("native Shipping Option stored Link capabilities", () => {
  it("retains the genuine availability many-to-many and Pricing one-to-one metadata, active indexes and cascade", async () => {
    const availability = await Effect.runPromise(captureLocationFulfillmentProviderLinkMetadata());
    const prices = await Effect.runPromise(captureShippingOptionPriceSetLinkMetadata());
    expect(availability.joiner).toEqual(LocationFulfillmentProvider);
    expect(prices.joiner).toEqual(ShippingOptionPriceSet);
    expect(availability.frame.foreignKeys).toEqual([]);
    expect(prices.frame.foreignKeys).toEqual([]);
    expect(availability.frame.indexes.filter(index => index.unique)).toEqual([]);
    expect(prices.frame.indexes.filter(index => index.unique).map(index => ({ columns: index.columns, where: index.where })))
      .toEqual([{ columns: ["shipping_option_id"], where: "deleted_at IS NULL" }, { columns: ["price_set_id"], where: "deleted_at IS NULL" }]);
    expect(availability.joiner.relationships?.map(value => value.deleteCascade)).toEqual([undefined, undefined]);
    expect(prices.joiner.relationships?.map(value => value.deleteCascade)).toEqual([undefined, true]);
    const definitions = [await Effect.runPromise(compileLocationFulfillmentProviderLinkDefinition()), await Effect.runPromise(compileShippingOptionPriceSetLinkDefinition())];
    expect(definitions.map(value => value.schema.coordinate.lineageId))
      .toEqual(["commerce.link.location-fulfillment-provider", "commerce.link.shipping-option-price-set"]);
    expect(definitions.map(value => value.schema.tables.length)).toEqual([1, 1]);
  });

  it("derives both availability edges from the complete native alias set and exposes the actual service identities", () => {
    expect(location.graph.remotePaths).toEqual(provider.locationFulfillmentSetRemotePaths);
    expect(provider.locationFulfillmentSetRemotePaths).toMatchObject([{ root: "ServiceZone", path: "fulfillment_set.locations",
      sourceModel: "FulfillmentSet", targetModel: "StockLocation", maximumSources: 4, maximumLinks: 8, maximumTargets: 8, maximumPerSource: 8 }]);
    expect(provider.graph.remotePaths).toMatchObject([{ root: "ServiceZone", path: "fulfillment_set.locations.fulfillment_providers",
      sourceModel: "StockLocation", targetModel: "FulfillmentProvider", maximumSources: 8, maximumLinks: 8, maximumTargets: 8, maximumPerSource: 8 }]);
    expect(provider.graph.services).toEqual([{ name: LocationFulfillmentProvider.serviceName, model: "LinkLocationFulfillmentProvider" }]);
    expect(pricing.graph.services).toEqual([{ name: ShippingOptionPriceSet.serviceName, model: "LinkShippingOptionPriceSet" }]);
    expect(workflowModuleDefinition(pricing.workflow)?.logical?.commands).toContain(pricing.count);
  });

  it("authenticates all installed routing metadata while granting only the selected Pricing Link commands", async () => {
    const input = { location: location.nativeService, provider: provider.nativeService, pricing: pricing.nativeService };
    const resource = Result.getOrThrow(prepareShippingOptionCreationLinkResource(input));
    const definition = composedWorkflowResourceDefinition(resource);
    if (definition === undefined) throw new Error("Missing issued native Link resource");
    expect(definition.identity).toMatchObject({ format: "medusa.shipping-option.creation-links", services: expect.any(Array) });
    expect(definition.dependencies).toEqual([pricing.nativeService.createMethod, pricing.nativeService.listMethod, pricing.nativeService.dismissMethod]);
    expect(Object.keys(definition.methods)).toEqual(["create", "dismiss"]);
    const pairs = Array.from({ length: 4 }, (_, index) => ({ fulfillment: { shipping_option_id: "option" + index }, pricing: { price_set_id: "price" + index } }));
    for (const method of Object.values(definition.methods)) {
      expect(Result.isSuccess(method.arguments([pairs]))).toBe(true);
      expect(Result.isFailure(method.arguments([[...pairs, pairs[0]]]))).toBe(true);
      expect(Result.isFailure(method.arguments([[{ stock_location: { stock_location_id: "l" }, fulfillment: { fulfillment_provider_id: "p" } }]]))).toBe(true);
    }
    expect(Result.isFailure(prepareShippingOptionCreationLinkResource({ ...input, pricing: provider.nativeService }))).toBe(true);
    expect(Result.isFailure(captureShippingOptionPriceSetLinkService({ ...pricing.nativeService }))).toBe(true);
    const previous = await Effect.runPromise(prepareLocationFulfillmentSetLink());
    expect(workflowModuleDefinition(previous.workflow)?.graph).toEqual({ aliases: [], reads: [] });
    expect(workflowModuleDefinition(previous.workflow)?.source.profile).toBe("location-fulfillment-set-creation");
    expect(Result.isFailure(prepareShippingOptionCreationLinkResource({ ...input, location: previous.nativeService }))).toBe(true);
  });

  it("requires complete history and admits all eight endpoint identities for genuine delete and restore callbacks", () => {
    const ids = Array.from({ length: 8 }, (_, index) => "endpoint" + index);
    for (const selected of [provider, pricing]) {
      const definition = linkWorkflowServiceDefinition(selected.nativeService);
      const [primary, foreign] = selected.prepared.joiner.relationships ?? [];
      if (definition === undefined || primary === undefined || foreign === undefined) throw new Error("Missing native Link service");
      expect(definition).toMatchObject({ admission: "shipping-option-links", lifecycle: { maximumRows: 8, completeHistory: true } });
      const config = { returnLinkableKeys: selected.prepared.routing.__joinerConfig.primaryKeys };
      for (const name of ["softDelete", "restore"] as const) {
        const token = selected.workflow.methods[name], method = workflowMethodDefinition(token);
        if (method === undefined) throw new Error("Missing genuine Link lifecycle method");
        for (const endpoint of [primary.foreignKey, foreign.foreignKey]) {
          expect(Result.getOrThrow(method.input([{ [endpoint]: ids }, config])))
            .toEqual({ selector: { [endpoint]: ids }, config });
          expect(Result.isFailure(method.input([{ [endpoint]: [...ids, "outside"] }, config]))).toBe(true);
        }
        expect(Result.isFailure(method.input([{ unknown_id: ids }, config]))).toBe(true);
        expect(Result.isFailure(method.input([{ [primary.foreignKey]: ids }, { ...config, unknown: true }]))).toBe(true);
      }
    }
  });

  it("keeps native one-to-one conflict checks and provider many-to-many routing before service delegation", async () => {
    // Actual native routing is observed against empty selected storage. These
    // stubs establish tuple/cardinality behavior, not persistence conformance.
    const create = vi.fn().mockResolvedValue([]), list = vi.fn().mockResolvedValue([]);
    const loaded = (selected: typeof provider | typeof pricing) => ({ ...structuredClone(selected.prepared.routing), create, list });
    const prices = new Link([loaded(pricing)]);
    await expect(prices.create([{ fulfillment: { shipping_option_id: "option" }, pricing: { price_set_id: "a" } },
      { fulfillment: { shipping_option_id: "option" }, pricing: { price_set_id: "b" } }])).rejects.toThrow();
    expect(create).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled();
    const availability = new Link([loaded(provider)]);
    await availability.create([{ stock_location: { stock_location_id: "location" }, fulfillment: { fulfillment_provider_id: "a" } },
      { stock_location: { stock_location_id: "location" }, fulfillment: { fulfillment_provider_id: "b" } }]);
    expect(create).toHaveBeenCalledExactlyOnceWith([["location", "a"], ["location", "b"]], undefined, undefined, {});
    expect(list).not.toHaveBeenCalled();
  });
});
