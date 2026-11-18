import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { pricingStaticResources } from "@medusajs/pricing/static-manifest";
import { commerceCommandIdentity } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareLocalProductLinks } from "../src/links/product-service";
import { prepareLocalVariantLinks } from "../src/links/variant-service";
import { prepareProductUpdateLinkResource } from "../src/links/product-update-resource";
import { makeLocalPricingCommands } from "../src/modules/pricing/service";
import { composedWorkflowResourceDefinition, type ComposedWorkflowServices, type InvokeWorkflowMethod } from "../src/workflow/composed-resource";
import { workflowMethodDefinition, type WorkflowMethod } from "../src/workflow/module";

let product: Effect.Success<ReturnType<typeof prepareLocalProductLinks>>;
let variant: Effect.Success<ReturnType<typeof prepareLocalVariantLinks>>;
let pricing: Effect.Success<ReturnType<typeof makeLocalPricingCommands>>;
let resource: Result.Result.Success<ReturnType<typeof prepareProductUpdateLinkResource>>;
type Service = ComposedWorkflowServices<{ readonly link: typeof resource }>["link"];
const services = () => ({ ...product.nativeServices, ...variant.nativeServices });

function bind(respond: (name: string, args: readonly unknown[]) => Json | Promise<Json>) {
  const calls: Array<{ name: string; args: readonly unknown[] }> = [];
  const definition = composedWorkflowResourceDefinition(resource);
  if (definition === undefined) throw new Error("Missing authentic Link resource");
  const invoke: InvokeWorkflowMethod = async <Output>(method: WorkflowMethod<readonly unknown[], Output>, ...args: readonly unknown[]) => {
    const selected = workflowMethodDefinition(method);
    const identity = selected === undefined ? undefined : commerceCommandIdentity(selected.command);
    if (selected === undefined || identity === undefined) throw new Error("Missing authentic Link method");
    Result.getOrThrow(selected.input(args));
    calls.push({ name: identity.name, args: structuredClone(args) });
    const value = Result.getOrThrow(selected.output(await respond(identity.name, args)));
    // SAFETY: this observation port checks the authentic method's input/output
    // decoders before returning its associated output type. It models no DAL or
    // settlement behavior; the real native Link algorithm owns every callback.
    return value as Output;
  };
  // SAFETY: the authentic resource factory and its registered method contracts
  // retain the inferred service type, as in the production resource binder.
  const service = definition.bind(invoke) as Service;
  return { service, calls, definition };
}

describe("native whole-Product Link resource ABI", () => {
  beforeAll(async () => {
    product = await Effect.runPromise(prepareLocalProductLinks("product-updates"));
    variant = await Effect.runPromise(prepareLocalVariantLinks("product-updates"));
    pricing = await Effect.runPromise(makeLocalPricingCommands("product-updates"));
    resource = Result.getOrThrow(prepareProductUpdateLinkResource(services(), pricing.workflow));
  });

  it("uses the native cascade and exact joiner keys while leaving Inventory independent", async () => {
    const { service, calls, definition } = bind(name => {
      if (name === "inventoryLinkNativeSoftDelete") return { variant_id: ["v", "v"], inventory_item_id: ["i1", "i2"] };
      if (name === "pricingLinkNativeSoftDelete") return { variant_id: ["v"], price_set_id: ["ps"] };
      if (name === "pricingSoftDeletePriceSets") return { price_set_id: ["ps"], price_id: ["p"], price_rule_id: ["r"] };
      throw new Error("Unexpected native callback " + name);
    });
    const result = await service.delete({ product: { variant_id: ["v"] } });
    expect(result).toEqual([null, {
      [variant.nativeServices.inventory.routing.__joinerConfig.serviceName!]: { variant_id: ["v", "v"], inventory_item_id: ["i1", "i2"] },
      [variant.nativeServices.pricing.routing.__joinerConfig.serviceName!]: { variant_id: ["v"], price_set_id: ["ps"] },
      pricing: { price_set_id: ["ps"] },
    }]);
    expect(calls).toHaveLength(3);
    for (const family of [variant.nativeServices.inventory, variant.nativeServices.pricing]) {
      expect(calls).toContainEqual({ name: family.softDeleteName, args: [{ variant_id: ["v"] },
        { returnLinkableKeys: family.routing.__joinerConfig.primaryKeys }] });
    }
    expect(calls.at(-1)).toEqual({ name: "pricingSoftDeletePriceSets", args: [{ id: ["ps"] }, {
      returnLinkableKeys: Object.keys(pricingStaticResources.joinerConfig?.linkableKeys ?? {}),
    }] });
    expect(Result.isSuccess(definition.methods.delete!.output(result))).toBe(true);
  });

  it("preserves the native error tuple and refuses partial success at the atomic boundary", async () => {
    const { service, definition } = bind(name => {
      if (name === "inventoryLinkNativeSoftDelete") return {};
      if (name === "pricingLinkNativeSoftDelete") return { variant_id: ["v"], price_set_id: ["ps"] };
      throw new Error("Pricing lifecycle observation failed");
    });
    const result = await service.delete({ product: { variant_id: ["v"] } });
    expect(result[0]).toMatchObject([{ serviceName: "pricing", method: "softDeletePriceSets", args: { id: ["ps"] },
      error: { message: "Pricing lifecycle observation failed" } }]);
    expect(result[1]).toHaveProperty(variant.nativeServices.pricing.routing.__joinerConfig.serviceName!);
    expect(definition.methods.delete!.output(result)).toMatchObject({ _tag: "Failure", failure: { reason: "adapterFailure", cause: result } });
  });

  it("routes native replacement preimages, dismissal and creation without endpoint reads", async () => {
    const pairs = [{ product: { product_id: "p" }, fulfillment: { shipping_profile_id: "old" } }];
    const row = { id: "link", product_id: "p", shipping_profile_id: "old" };
    let reads = 0;
    const { service, calls } = bind(name => name === "shippingLinkNativeList" && reads++ === 0 ? [row] : []);
    expect(await service.list(pairs, { asLinkDefinition: true })).toEqual(pairs);
    expect(await service.dismiss(pairs)).toEqual([]);
    expect(await service.create([{ product: { product_id: "p" }, fulfillment: { shipping_profile_id: "next" } }])).toEqual([]);
    expect(calls).toEqual([
      { name: "shippingLinkNativeList", args: [{ $or: [{ product_id: "p", shipping_profile_id: "old" }] }, {}] },
      { name: "shippingLinkNativeDismiss", args: [[["p", "old"]]] },
      { name: "shippingLinkNativeList", args: [{ $or: [{ shipping_profile_id: { $ne: "next" }, product_id: "p" }] }, { take: 1 }] },
      { name: "shippingLinkNativeCreate", args: [[["p", "next"]]] },
    ]);
  });

  it("retains native empty endpoint and batch behavior", async () => {
    const { service, calls } = bind(() => { throw new Error("Unexpected callback for an empty input"); });
    expect(await service.delete({ product: { variant_id: [] } })).toEqual([null, {}]);
    expect(await service.create([])).toEqual([]);
    expect(await service.dismiss([])).toEqual([]);
    expect(await service.list([], { asLinkDefinition: true })).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("refuses forged services, wrong families and default profiles", async () => {
    expect(Result.isFailure(prepareProductUpdateLinkResource({ ...services(), inventory: structuredClone(services().inventory) }, pricing.workflow))).toBe(true);
    expect(Result.isFailure(prepareProductUpdateLinkResource({ ...services(), sales: services().shipping }, pricing.workflow))).toBe(true);
    const ordinary = await Effect.runPromise(prepareLocalVariantLinks());
    expect(Result.isFailure(prepareProductUpdateLinkResource({ ...services(), inventory: ordinary.nativeServices.inventory }, pricing.workflow))).toBe(true);
    const ordinaryPricing = await Effect.runPromise(makeLocalPricingCommands());
    expect(Result.isFailure(prepareProductUpdateLinkResource(services(), ordinaryPricing.workflow))).toBe(true);
  });

  it("keeps finite homogeneous inputs and denies Inventory creation or foreign endpoint deletion", () => {
    const { definition } = bind(() => []);
    const inventoryPair = { product: { variant_id: "v" }, inventory: { inventory_item_id: "i" } };
    const pricingPair = { product: { variant_id: "v" }, pricing: { price_set_id: "ps" } };
    const salesPair = { product: { product_id: "p" }, sales_channel: { sales_channel_id: "sc" } };
    expect(Result.isFailure(definition.methods.create!.arguments([[inventoryPair]]))).toBe(true);
    expect(Result.isFailure(definition.methods.create!.arguments([[salesPair, pricingPair]]))).toBe(true);
    expect(Result.isFailure(definition.methods.dismiss!.arguments([[pricingPair]]))).toBe(true);
    expect(Result.isFailure(definition.methods.create!.arguments([Array.from({ length: 9 }, () => salesPair)]))).toBe(true);
    expect(Result.isFailure(definition.methods.delete!.arguments([{ product: { variant_id: ["1", "2", "3", "4", "5"] } }]))).toBe(true);
    expect(Result.isFailure(definition.methods.delete!.arguments([{ pricing: { price_set_id: ["ps"] } }]))).toBe(true);
    expect(Result.isFailure(definition.methods.delete!.output([null, {}, "discarded"]))).toBe(true);
  });
});
