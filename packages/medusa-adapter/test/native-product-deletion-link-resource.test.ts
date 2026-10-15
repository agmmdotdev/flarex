import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { pricingStaticResources } from "@medusajs/pricing/static-manifest";
import { commerceCommandIdentity } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareLocalProductLinks } from "../src/links/product-service";
import { prepareLocalVariantLinks } from "../src/links/variant-service";
import { prepareProductDeletionLinkResource } from "../src/links/product-deletion-resource";
import { prepareProductUpdateLinkResource } from "../src/links/product-update-resource";
import { prepareVariantPricingLink } from "../src/links/variant-pricing-service";
import { makeLocalPricingCommands } from "../src/modules/pricing/service";
import { composedWorkflowResourceDefinition, type ComposedWorkflowServices, type InvokeWorkflowMethod } from "../src/workflow/composed-resource";
import { workflowMethodDefinition, type WorkflowMethod } from "../src/workflow/module";

let product: Effect.Success<ReturnType<typeof prepareLocalProductLinks>>;
let variant: Effect.Success<ReturnType<typeof prepareLocalVariantLinks>>;
let pricing: Effect.Success<ReturnType<typeof makeLocalPricingCommands>>;
let resource: Result.Result.Success<ReturnType<typeof prepareProductDeletionLinkResource>>;
type Service = ComposedWorkflowServices<{ readonly link: typeof resource }>["link"];
const services = () => ({ ...product.nativeServices, ...variant.nativeServices });

function bind(respond: (name: string, args: readonly unknown[]) => Json | Promise<Json>) {
  const calls: Array<{ name: string; args: readonly unknown[] }> = [];
  const definition = composedWorkflowResourceDefinition(resource);
  if (definition === undefined) throw new Error("Missing authentic deletion Link resource");
  const invoke: InvokeWorkflowMethod = async <Output>(method: WorkflowMethod<readonly unknown[], Output>, ...args: readonly unknown[]) => {
    const selected = workflowMethodDefinition(method);
    const identity = selected === undefined ? undefined : commerceCommandIdentity(selected.command);
    if (selected === undefined || identity === undefined) throw new Error("Missing authentic deletion Link method");
    Result.getOrThrow(selected.input(args));
    calls.push({ name: identity.name, args: structuredClone(args) });
    const value = Result.getOrThrow(selected.output(await respond(identity.name, args)));
    // SAFETY: this ABI observation port validates the authentic method's actual
    // input/output contracts; it models neither persistence nor settlement.
    return value as Output;
  };
  // SAFETY: the authentic factory retains the service associated with its
  // registered argument/output decoders, as the production binder does.
  return { service: definition.bind(invoke) as Service, calls, definition };
}

describe("native Product deletion Link resource ABI", () => {
  beforeAll(async () => {
    product = await Effect.runPromise(prepareLocalProductLinks("product-deletions"));
    variant = await Effect.runPromise(prepareLocalVariantLinks("product-deletions"));
    pricing = await Effect.runPromise(makeLocalPricingCommands("product-updates"));
    resource = Result.getOrThrow(prepareProductDeletionLinkResource(services(), pricing.workflow));
  });

  it("deletes all four native Link families and cascades only their Pricing endpoint", async () => {
    const { service, calls, definition } = bind(name => {
      if (name === "salesLinkNativeSoftDelete") return { product_id: ["p"], sales_channel_id: ["sc"] };
      if (name === "shippingLinkNativeSoftDelete") return { product_id: ["p"], shipping_profile_id: ["sp"] };
      if (name === "inventoryLinkNativeSoftDelete") return { variant_id: ["v", "v"], inventory_item_id: ["i1", "i2"] };
      if (name === "pricingLinkNativeSoftDelete") return { variant_id: ["v"], price_set_id: ["ps"] };
      if (name === "pricingSoftDeletePriceSets") return { price_set_id: ["ps"], price_id: ["base", "list"], price_rule_id: ["rb", "rl"] };
      throw new Error("Unexpected endpoint callback " + name);
    });
    const result = await service.delete({ product: { product_id: ["p"], variant_id: ["v"] } });
    expect(result).toEqual([null, {
      [product.nativeServices.sales.routing.__joinerConfig.serviceName!]: { product_id: ["p"], sales_channel_id: ["sc"] },
      [product.nativeServices.shipping.routing.__joinerConfig.serviceName!]: { product_id: ["p"], shipping_profile_id: ["sp"] },
      [variant.nativeServices.inventory.routing.__joinerConfig.serviceName!]: { variant_id: ["v", "v"], inventory_item_id: ["i1", "i2"] },
      [variant.nativeServices.pricing.routing.__joinerConfig.serviceName!]: { variant_id: ["v"], price_set_id: ["ps"] },
      pricing: { price_set_id: ["ps"] },
    }]);
    expect(calls).toHaveLength(5);
    for (const family of [product.nativeServices.sales, product.nativeServices.shipping]) {
      expect(calls).toContainEqual({ name: family.softDeleteName, args: [{ product_id: ["p"] },
        { returnLinkableKeys: family.routing.__joinerConfig.primaryKeys }] });
    }
    for (const family of [variant.nativeServices.inventory, variant.nativeServices.pricing]) {
      expect(calls).toContainEqual({ name: family.softDeleteName, args: [{ variant_id: ["v"] },
        { returnLinkableKeys: family.routing.__joinerConfig.primaryKeys }] });
    }
    expect(calls).toContainEqual({ name: "pricingSoftDeletePriceSets", args: [{ id: ["ps"] }, {
      returnLinkableKeys: Object.keys(pricingStaticResources.joinerConfig?.linkableKeys ?? {}),
    }] });
    expect(Result.isSuccess(definition.methods.delete!.output(result))).toBe(true);
    expect(Object.keys(definition.methods)).toEqual(["delete"]);
    expect(definition.dependencies).toHaveLength(5);
  });

  it("routes eight reverse Inventory endpoints without cascading to Product or Pricing", async () => {
    const ids = Array.from({ length: 8 }, (_, index) => "i" + index);
    const variants = ids.map((_, index) => "v" + index);
    const { service, calls, definition } = bind(name => {
      if (name !== "inventoryLinkNativeSoftDelete") throw new Error("Unexpected independent endpoint deletion " + name);
      return { variant_id: variants, inventory_item_id: ids };
    });
    const result = await service.delete({ inventory: { inventory_item_id: ids } });
    expect(result).toEqual([null, { [variant.nativeServices.inventory.routing.__joinerConfig.serviceName!]: {
      variant_id: variants, inventory_item_id: ids,
    } }]);
    expect(calls).toEqual([{ name: "inventoryLinkNativeSoftDelete", args: [{ inventory_item_id: ids }, {
      returnLinkableKeys: variant.nativeServices.inventory.routing.__joinerConfig.primaryKeys,
    }] }]);
    expect(Result.isSuccess(definition.methods.delete!.output(result))).toBe(true);
  });

  it("preserves simultaneous native family dispatch and errors as tuple data", async () => {
    let releaseSales!: () => void;
    const salesPending = new Promise<void>(resolve => { releaseSales = resolve; });
    let shippingStarted!: () => void;
    const shippingEntered = new Promise<void>(resolve => { shippingStarted = resolve; });
    const { service, calls, definition } = bind(async name => {
      if (name === "salesLinkNativeSoftDelete") { await salesPending; throw new Error("Sales Link lifecycle failed"); }
      if (name === "shippingLinkNativeSoftDelete") shippingStarted();
      return {};
    });
    const pending = service.delete({ product: { product_id: ["p"], variant_id: ["v"] } });
    await shippingEntered;
    expect(calls.map(call => call.name)).toContain("salesLinkNativeSoftDelete");
    releaseSales();
    const result = await pending;
    expect(calls).toHaveLength(4);
    expect(result[0]).toMatchObject([{ serviceName: product.nativeServices.sales.routing.__joinerConfig.serviceName,
      method: "softDelete", args: { product_id: ["p"] }, error: { message: "Sales Link lifecycle failed" } }]);
    expect(Result.isSuccess(definition.methods.delete!.output(result))).toBe(true);
  });

  it("retains native empty deletion behavior", async () => {
    const { service, calls } = bind(() => { throw new Error("Unexpected empty-selector callback"); });
    expect(await service.delete({ product: { product_id: [], variant_id: [] } })).toEqual([null, {}]);
    expect(await service.delete({ inventory: { inventory_item_id: [] } })).toEqual([null, {}]);
    expect(calls).toEqual([]);
  });

  it("admits reverse Inventory eight only in the new named profile", async () => {
    const reverse = { inventory_item_id: Array.from({ length: 8 }, (_, index) => "i" + index) };
    const config = { returnLinkableKeys: variant.nativeServices.inventory.routing.__joinerConfig.primaryKeys };
    const deletion = workflowMethodDefinition(variant.nativeServices.inventory.softDeleteMethod!);
    expect(Result.isSuccess(deletion!.input([reverse, config]))).toBe(true);
    expect(Result.isFailure(deletion!.input([{ inventory_item_id: [...reverse.inventory_item_id, "overflow"] }, config]))).toBe(true);
    expect(Result.isFailure(deletion!.input([{ variant_id: ["1", "2", "3", "4", "5"] }, config]))).toBe(true);
    const previous = await Effect.runPromise(prepareLocalVariantLinks("product-updates"));
    const previousMethod = workflowMethodDefinition(previous.nativeServices.inventory.softDeleteMethod!);
    expect(Result.isFailure(previousMethod!.input([reverse, config]))).toBe(true);
    expect(previous.graph.remotePaths).toBeUndefined();
    expect(variant.graph.remotePaths?.map(path => ({ root: path.root, path: path.path, maximumSources: path.maximumSources,
      maximumLinks: path.maximumLinks, maximumTargets: path.maximumTargets, maximumPerSource: path.maximumPerSource }))).toEqual([
      { root: "ProductVariant", path: "inventory", maximumSources: 4, maximumLinks: 8, maximumTargets: 8, maximumPerSource: 2 },
      { root: "ProductVariant", path: "inventory.variants", maximumSources: 8, maximumLinks: 32, maximumTargets: 32, maximumPerSource: 4 },
    ]);
  });

  it("refuses forged preparations, old profiles and cross-profile resource construction", async () => {
    expect(Result.isFailure(prepareProductDeletionLinkResource({ ...services(), sales: { ...services().sales } }, pricing.workflow))).toBe(true);
    expect(Result.isFailure(prepareProductDeletionLinkResource({ ...services(), inventory: services().pricing }, pricing.workflow))).toBe(true);
    const previous = await Effect.runPromise(prepareLocalProductLinks("product-updates"));
    expect(Result.isFailure(prepareProductDeletionLinkResource({ ...services(), sales: previous.nativeServices.sales }, pricing.workflow))).toBe(true);
    const ordinaryPricing = await Effect.runPromise(makeLocalPricingCommands());
    expect(Result.isFailure(prepareProductDeletionLinkResource(services(), ordinaryPricing.workflow))).toBe(true);
    expect(Result.isFailure(prepareProductUpdateLinkResource(services(), pricing.workflow))).toBe(true);
  });

  it("retains pre-existing finite batch checks after creating mutable native arrays", async () => {
    const variantInput = workflowMethodDefinition(variant.workflow.methods.create!)!.input;
    const inventoryPair = { product: { variant_id: "v" }, inventory: { inventory_item_id: "i" } };
    const pricingPair = { product: { variant_id: "v" }, pricing: { price_set_id: "ps" } };
    for (const pair of [inventoryPair, pricingPair]) {
      expect(Result.isSuccess(variantInput([Array.from({ length: 8 }, () => pair)]))).toBe(true);
      expect(Result.isFailure(variantInput([Array.from({ length: 9 }, () => pair)]))).toBe(true);
    }
    const productInput = workflowMethodDefinition(product.workflow.methods.create!)!.input;
    for (const pair of [{ product: { product_id: "p" }, sales_channel: { sales_channel_id: "sc" } },
      { product: { product_id: "p" }, fulfillment: { shipping_profile_id: "sp" } }]) {
      expect(Result.isSuccess(productInput([Array.from({ length: 256 }, () => pair)]))).toBe(true);
      expect(Result.isFailure(productInput([Array.from({ length: 257 }, () => pair)]))).toBe(true);
    }
    const standalone = await Effect.runPromise(prepareVariantPricingLink());
    const standaloneInput = workflowMethodDefinition(standalone.workflow.methods.create!)!.input;
    expect(Result.isSuccess(standaloneInput([Array.from({ length: 4 }, () => pricingPair)]))).toBe(true);
    expect(Result.isFailure(standaloneInput([Array.from({ length: 5 }, () => pricingPair)]))).toBe(true);
  });

  it("refuses unsupported endpoints, mixed selectors, oversized input and malformed native tuples", () => {
    const { definition } = bind(() => ({}));
    const argumentsDecoder = definition.methods.delete!.arguments;
    expect(Result.isFailure(argumentsDecoder([{ product: { product_id: ["1", "2", "3", "4", "5"] } }]))).toBe(true);
    expect(Result.isFailure(argumentsDecoder([{ inventory: { inventory_item_id: Array.from({ length: 9 }, (_, index) => "i" + index) } }]))).toBe(true);
    expect(Result.isFailure(argumentsDecoder([{ product: { variant_id: ["v"] }, inventory: { inventory_item_id: ["i"] } }]))).toBe(true);
    expect(Result.isFailure(argumentsDecoder([{ pricing: { price_set_id: ["ps"] } }]))).toBe(true);
    expect(Result.isFailure(argumentsDecoder([{ product: { id: ["p"] } }]))).toBe(true);
    expect(Result.isFailure(definition.methods.delete!.output([null, {}, "discarded"]))).toBe(true);
  });
});
