import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { commerceCommandIdentity } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareLocalProductLinks } from "../src/links/product-service";
import { prepareLocalVariantLinks } from "../src/links/variant-service";
import { prepareProductBatchLinkResource } from "../src/links/product-batch-resource";
import { prepareProductNativeLinkResource } from "../src/links/product-resource";
import { makeLocalPricingCommands } from "../src/modules/pricing/service";
import { composedWorkflowResourceDefinition, type ComposedWorkflowServices, type InvokeWorkflowMethod } from "../src/workflow/composed-resource";
import { workflowMethodDefinition, type WorkflowMethod } from "../src/workflow/module";

let product: Effect.Success<ReturnType<typeof prepareLocalProductLinks>>;
let variant: Effect.Success<ReturnType<typeof prepareLocalVariantLinks>>;
let pricing: Effect.Success<ReturnType<typeof makeLocalPricingCommands>>;
let resource: Result.Result.Success<ReturnType<typeof prepareProductBatchLinkResource>>;
type Service = ComposedWorkflowServices<{ readonly link: typeof resource }>["link"];
const services = () => ({ ...product.nativeServices, ...variant.nativeServices });

function bind(respond: (name: string, args: readonly unknown[]) => Json | Promise<Json>) {
  const calls: Array<{ name: string; args: readonly unknown[] }> = [];
  const definition = composedWorkflowResourceDefinition(resource);
  if (definition === undefined) throw new Error("Missing authentic batch Link resource");
  const invoke: InvokeWorkflowMethod = async <Output>(method: WorkflowMethod<readonly unknown[], Output>, ...args: readonly unknown[]) => {
    const selected = workflowMethodDefinition(method);
    const identity = selected === undefined ? undefined : commerceCommandIdentity(selected.command);
    if (selected === undefined || identity === undefined) throw new Error("Missing authentic Link callback");
    Result.getOrThrow(selected.input(args));
    calls.push({ name: identity.name, args: structuredClone(args) });
    const value = Result.getOrThrow(selected.output(await respond(identity.name, args)));
    // SAFETY: this ABI observation port validates the authentic method's own
    // argument/output contracts. Native Link owns routing; no DAL is simulated.
    return value as Output;
  };
  // SAFETY: the authentic factory retains the decoder-associated service type,
  // matching the production composed-resource binder.
  return { service: definition.bind(invoke) as Service, calls, definition };
}

describe("native Product batch Link resource ABI", () => {
  beforeAll(async () => {
    product = await Effect.runPromise(prepareLocalProductLinks("product-deletions"));
    variant = await Effect.runPromise(prepareLocalVariantLinks("product-deletions"));
    pricing = await Effect.runPromise(makeLocalPricingCommands("product-updates"));
    resource = Result.getOrThrow(prepareProductBatchLinkResource(services(), pricing.workflow));
  });

  it("uses one router for native creation in all four original families and exact Pricing list", async () => {
    const row = { variant_id: "v", price_set_id: "ps" };
    const { service, calls, definition } = bind((name, args) => name === "pricingLinkNativeList" &&
      JSON.stringify(args) === JSON.stringify([{ variant_id: ["v"] }, { select: ["variant_id", "price_set_id"] }]) ? [row] : []);
    expect(await service.create([{ product: { product_id: "p" }, sales_channel: { sales_channel_id: "sc" } }])).toEqual([]);
    expect(await service.create([{ product: { product_id: "p" }, fulfillment: { shipping_profile_id: "sp" } }])).toEqual([]);
    expect(await service.create([{ product: { variant_id: "v" }, inventory: { inventory_item_id: "i" }, data: { required_quantity: 2 } }])).toEqual([]);
    expect(await service.create([{ product: { variant_id: "v" }, pricing: { price_set_id: "ps" } }])).toEqual([]);
    expect(await service.listVariantPricing({ variant_id: ["v"] }, { select: ["variant_id", "price_set_id"] })).toEqual([row]);
    for (const prefix of ["salesLink", "shippingLink", "inventoryLink", "pricingLink"])
      expect(calls.some(call => call.name === prefix + "NativeCreate")).toBe(true);
    expect(calls).toContainEqual({ name: "inventoryLinkNativeCreate", args: [[["v", "i", { required_quantity: 2 }]]] });
    expect(calls.at(-1)).toEqual({ name: "pricingLinkNativeList", args: [{ variant_id: ["v"] }, { select: ["variant_id", "price_set_id"] }] });
    expect(Object.keys(definition.methods)).toEqual(["create", "list", "dismiss", "delete", "listVariantPricing"]);
    const expected = [product.nativeServices.sales, product.nativeServices.shipping, variant.nativeServices.inventory, variant.nativeServices.pricing];
    expect(definition.dependencies).toHaveLength(16);
    for (const source of expected) for (const method of [source.createMethod, source.listMethod, source.softDeleteMethod])
      expect(definition.dependencies).toContain(method);
    expect(definition.dependencies).not.toContain(variant.nativeServices.pricing.dismissMethod);
  });

  it("retains Product replacement preimages and Product/Inventory dismissal", async () => {
    const pair = { product: { product_id: "p" }, fulfillment: { shipping_profile_id: "sp" } };
    const { service, calls } = bind(name => name === "shippingLinkNativeList" ? [{ id: "link", product_id: "p", shipping_profile_id: "sp" }] : []);
    expect(await service.list([pair], { asLinkDefinition: true })).toEqual([pair]);
    expect(await service.dismiss([pair])).toEqual([]);
    expect(await service.dismiss([{ product: { variant_id: "v" }, inventory: { inventory_item_id: "i" } }])).toEqual([]);
    expect(calls).toEqual([
      { name: "shippingLinkNativeList", args: [{ $or: [{ product_id: "p", shipping_profile_id: "sp" }] }, {}] },
      { name: "shippingLinkNativeDismiss", args: [[["p", "sp"]]] },
      { name: "inventoryLinkNativeDismiss", args: [[["v", "i"]]] },
    ]);
  });

  it("preserves the complete native deletion tuple and reverse Inventory endpoint routing", async () => {
    const { service, calls, definition } = bind(name => {
      if (name === "salesLinkNativeSoftDelete") return { product_id: ["p"], sales_channel_id: ["sc"] };
      if (name === "shippingLinkNativeSoftDelete") return { product_id: ["p"], shipping_profile_id: ["sp"] };
      if (name === "inventoryLinkNativeSoftDelete") return { variant_id: ["v"], inventory_item_id: ["i"] };
      if (name === "pricingLinkNativeSoftDelete") return { variant_id: ["v"], price_set_id: ["ps"] };
      if (name === "pricingSoftDeletePriceSets") return { price_set_id: ["ps"] };
      return {};
    });
    const result = await service.delete({ product: { product_id: ["p"], variant_id: ["v"] } });
    expect(result).toEqual([null, {
      [product.nativeServices.sales.routing.__joinerConfig.serviceName!]: { product_id: ["p"], sales_channel_id: ["sc"] },
      [product.nativeServices.shipping.routing.__joinerConfig.serviceName!]: { product_id: ["p"], shipping_profile_id: ["sp"] },
      [variant.nativeServices.inventory.routing.__joinerConfig.serviceName!]: { variant_id: ["v"], inventory_item_id: ["i"] },
      [variant.nativeServices.pricing.routing.__joinerConfig.serviceName!]: { variant_id: ["v"], price_set_id: ["ps"] },
      pricing: { price_set_id: ["ps"] },
    }]);
    expect(calls).toHaveLength(5);
    expect(Result.isSuccess(definition.methods.delete!.output(result))).toBe(true);
    calls.length = 0;
    expect(await service.delete({ inventory: { inventory_item_id: ["i"] } })).toEqual([null, {
      [variant.nativeServices.inventory.routing.__joinerConfig.serviceName!]: { variant_id: ["v"], inventory_item_id: ["i"] },
    }]);
    expect(calls.map(call => call.name)).toEqual(["inventoryLinkNativeSoftDelete"]);
  });

  it("reuses the authentic creation decoder and preserves empty calls", async () => {
    const { service, calls, definition } = bind(() => []);
    const creation = Result.getOrThrow(prepareProductNativeLinkResource(Object.values(services())));
    expect(definition.methods.create!.arguments).toBe(composedWorkflowResourceDefinition(creation)?.methods.create?.arguments);
    expect(await service.create([])).toEqual([]);
    expect(await service.list([], { asLinkDefinition: true })).toEqual([]);
    expect(await service.dismiss([])).toEqual([]);
    expect(await service.delete({ product: { product_id: [], variant_id: [] } })).toEqual([null, {}]);
    expect(await service.delete({ inventory: { inventory_item_id: [] } })).toEqual([null, {}]);
    expect(calls).toEqual([]);
  });

  it("refuses forged sources, wrong profiles, heterogeneous and one-over calls", async () => {
    expect(Result.isFailure(prepareProductBatchLinkResource({ ...services(), sales: { ...services().sales } }, pricing.workflow))).toBe(true);
    expect(Result.isFailure(prepareProductBatchLinkResource({ ...services(), inventory: services().pricing }, pricing.workflow))).toBe(true);
    const previous = await Effect.runPromise(prepareLocalProductLinks("product-updates"));
    expect(Result.isFailure(prepareProductBatchLinkResource({ ...services(), sales: previous.nativeServices.sales }, pricing.workflow))).toBe(true);
    const { definition } = bind(() => []);
    const sales = { product: { product_id: "p" }, sales_channel: { sales_channel_id: "sc" } };
    const inventory = { product: { variant_id: "v" }, inventory: { inventory_item_id: "i" } };
    const pricingPair = { product: { variant_id: "v" }, pricing: { price_set_id: "ps" } };
    expect(Result.isFailure(definition.methods.create!.arguments([[sales, inventory]]))).toBe(true);
    for (const pair of [sales, inventory, pricingPair]) {
      expect(Result.isSuccess(definition.methods.create!.arguments([Array.from({ length: 8 }, () => pair)]))).toBe(true);
      expect(Result.isFailure(definition.methods.create!.arguments([Array.from({ length: 9 }, () => pair)]))).toBe(true);
    }
    expect(Result.isFailure(definition.methods.dismiss!.arguments([[pricingPair]]))).toBe(true);
    expect(Result.isFailure(definition.methods.delete!.arguments([{ product: { variant_id: ["1", "2", "3", "4", "5"] } }]))).toBe(true);
    expect(Result.isFailure(definition.methods.delete!.arguments([{ inventory: { inventory_item_id: Array.from({ length: 9 }, (_, index) => "i" + index) } }]))).toBe(true);
    expect(Result.isFailure(definition.methods.listVariantPricing!.arguments([{ variant_id: ["1", "2", "3", "4", "5"] }, { select: ["variant_id", "price_set_id"] }]))).toBe(true);
    expect(Result.isFailure(definition.methods.delete!.output([null, {}, "discarded"]))).toBe(true);
  });
});
