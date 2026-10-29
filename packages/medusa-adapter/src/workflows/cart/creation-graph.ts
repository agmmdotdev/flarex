import { Effect, Result } from "effect";
import { CartCustomer, CartRegion, CartProduct, CartShippingOption } from "@medusajs/link-modules";
import { joinerConfig as productJoiner } from "@medusajs/product/joiner-config";
import { customerStaticResources } from "@medusajs/customer/static-manifest";
import { regionStaticResources } from "@medusajs/region/static-manifest";
import { fulfillmentStaticResources } from "@medusajs/fulfillment/static-manifest";
import { describeToManyRelation } from "@medusajs/drizzle/relation-query";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCommerceCallValidation } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { nativeLinkGraphDirectPaths, localGraphDirectPath } from "../../local-graph/direct-paths";
import type { GraphModuleDefinition } from "../../local-graph/model";
import { makeReadCatalog } from "../../query/catalog";
import { capturePaymentMetadata } from "../../modules/payment/schema";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { captureInstalledWorkflowModules, type InstalledWorkflowModule } from "../../workflow/host";
import { defineWorkflowModule, workflowModuleDefinition, workflowMethodDefinition, type WorkflowModule, type WorkflowMethod } from "../../workflow/module";
import { prepareVariantItemPricingModules } from "./variant-item-pricing-graph";
import { prepareVariantInventoryConfirmationModule } from "./variant-inventory-confirmation";

export const cartCreationModuleNames = ["product", "pricing", "inventory", "stock_location", "sales_channel", "fulfillment",
  "product_links", "variant_links", "sales_channel_locations", "cart", "customer", "region", "store", "promotion", "tax", "payment",
  "cart_promotion_links", "cart_payment_collection_links"] as const;
export type CartCreationModules = Readonly<Record<typeof cartCreationModuleNames[number], InstalledWorkflowModule>>;

/** The same native Sales Channel source supplies two existing narrow owners:
 * graph reads and the exact Cart retrieve ABI. Their original receipts remain
 * responsible for each command; preparation introduces no service or lifetime. */
function prepareSalesChannelCreationModule(graph: InstalledWorkflowModule, retrieval: WorkflowModule) {
  return Result.gen(function* () {
    const base = workflowModuleDefinition(graph.module), read = workflowModuleDefinition(retrieval), method = retrieval.methods.retrieveSalesChannel,
      command = method === undefined ? undefined : workflowMethodDefinition(method)?.command;
    if (base?.logical === undefined || read?.logical === undefined || method === undefined || command === undefined ||
      base.source.name !== read.source.name || base.source.profile !== read.source.profile || retrieval.name !== graph.module.name ||
      base.source.name !== "flarex-sales-channel-local" || base.source.profile !== "sales-channel")
      return yield* Result.fail(commerceError("invalidAuthority"));
    const basePolicy = base.logical, readPolicy = read.logical;
    const validateLogicalCall: LogicalCommerceCallValidation = Effect.fn("CartCreation.validateSalesChannelCall")(function* (call, activity, selected) {
      return yield* (selected === command ? readPolicy : basePolicy).validateLogicalCall(call, activity, selected);
    });
    const module = yield* defineWorkflowModule({ name: graph.module.name, source: base.source,
      methods: { retrieveSalesChannel: method }, graph: base.graph, logical: { ...base.logical,
        commands: [...new Set([...base.logical.commands, ...read.logical.commands])], validateLogicalCall } });
    return { ...graph, module };
  });
}

/** Authenticate all eighteen genuine source graphs. Existing pricing and
 * Inventory confirmation owners are reused; Cart local rows and native Links
 * supply each cross-module endpoint, including genuinely empty branches. */
export const prepareCartCreationModules = Effect.fn("CartCreation.prepareModules")(function* (
  input: Readonly<Record<string, InstalledWorkflowModule>>, salesChannelRead: WorkflowModule,
) {
  const record = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(record).length !== cartCreationModuleNames.length) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const installed = yield* Effect.fromResult(captureInstalledWorkflowModules(record, cartCreationModuleNames));
  for (const name of cartCreationModuleNames) if (installed[name].logicalResources !== undefined || installed[name].logicalPublication !== undefined)
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const expected = [["cart", "flarex-cart-creation-workflow", "cart.creation-workflow"],
    ["customer", "flarex-customer-cart-creation", "customer.cart-creation"], ["region", "flarex-region-cart-read", "region-cart-context-read"],
    ["store", "flarex-store-cart-context-read", "store.cart-context-read"], ["promotion", "flarex-promotion-compute", "promotion.compute-actions"],
    ["tax", "flarex-tax-item-lines", "tax.itemTaxLines"]] as const;
  for (const [name, owner, profile] of expected) {
    const source = workflowModuleDefinition(installed[name].module)?.source;
    if (source?.name !== owner || source.profile !== profile) return yield* Effect.fail(commerceError("invalidAuthority"));
  }
  const pricing = yield* prepareVariantItemPricingModules({ product: installed.product, pricing: installed.pricing, inventory: installed.inventory,
    stock_location: installed.stock_location, sales_channel: installed.sales_channel, fulfillment: installed.fulfillment,
    product_links: installed.product_links, variant_links: installed.variant_links, sales_channel_locations: installed.sales_channel_locations }, "cart-creation");
  const confirmation = yield* prepareVariantInventoryConfirmationModule(pricing.inventory);
  const sales = yield* Effect.fromResult(prepareSalesChannelCreationModule(pricing.sales_channel, salesChannelRead));
  const definitions = new Map(cartCreationModuleNames.map(name => [name, workflowModuleDefinition(installed[name].module)]));
  const cart = definitions.get("cart"), payment = definitions.get("payment");
  const customerJoiner = customerStaticResources.joinerConfig, regionJoiner = regionStaticResources.joinerConfig,
    fulfillmentJoiner = fulfillmentStaticResources.joinerConfig;
  if (cart === undefined || payment === undefined || customerJoiner === undefined || regionJoiner === undefined || fulfillmentJoiner === undefined ||
    payment.source.profile !== "payment.system-lifecycle" || definitions.get("cart_promotion_links")?.source.profile !== "cart-promotion.exact-preimages" ||
    definitions.get("cart_payment_collection_links")?.source.profile !== "cart-payment-collection-read")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const root = "Cart", selection = { root, maximumSources: 4, maximumTargets: 4, maximumPerSource: 1 };
  const directPaths = [
    ...yield* Effect.fromResult(nativeLinkGraphDirectPaths(CartProduct, [{ ...selection, path: "items.variant" }, { ...selection, path: "items.product" }], "LineItem", productJoiner)),
    ...yield* Effect.fromResult(nativeLinkGraphDirectPaths(CartCustomer, [{ ...selection, path: "customer" }], root, customerJoiner)),
    ...yield* Effect.fromResult(nativeLinkGraphDirectPaths(CartRegion, [{ ...selection, path: "region" }], root, regionJoiner)),
    ...yield* Effect.fromResult(nativeLinkGraphDirectPaths(CartShippingOption, [{ ...selection, path: "shipping_methods.shipping_option" }], "ShippingMethod", fulfillmentJoiner)),
  ];
  const metadata = yield* capturePaymentMetadata(), collection = metadata.frame.tables.find(table => table.name === "payment_collection");
  const sessions = collection === undefined ? undefined : describeToManyRelation(collection, "payment_sessions", metadata.frame.tables);
  if (collection === undefined || sessions === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const paymentCatalog = yield* Effect.fromResult(makeReadCatalog(payment.graph.reads.map(read => read.table),
    new Map([[collection.name, new Map([[sessions.name, sessions]])]])));
  const paymentSessions = yield* Effect.fromResult(localGraphDirectPath(paymentCatalog, collection.name, "PaymentCollection", "PaymentSession", sessions.name,
    { root, path: "payment_collection.payment_sessions", maximumSources: 4, maximumTargets: 4, maximumPerSource: 4 }));
  const clone = <const Methods extends Readonly<Record<string, WorkflowMethod>>>(name: typeof cartCreationModuleNames[number],
    graph: GraphModuleDefinition, methods: Methods) => Result.gen(function* () {
    const original = definitions.get(name);
    if (original === undefined) return yield* Result.fail(commerceError("invalidAuthority"));
    const module = yield* defineWorkflowModule({ name: installed[name].module.name, source: original.source, methods, graph,
      ...(original.logical === undefined ? {} : { logical: original.logical }) });
    return { ...installed[name], module };
  });
  const modules = { ...installed, ...pricing, sales_channel: sales, inventory: confirmation.binding,
    cart: yield* Effect.fromResult(clone("cart", { ...cart.graph, directPaths: [...cart.graph.directPaths ?? [], ...directPaths] }, installed.cart.module.methods)),
    payment: yield* Effect.fromResult(clone("payment", { ...payment.graph, directPaths: [...payment.graph.directPaths ?? [], paymentSessions] }, installed.payment.module.methods)) };
  return { modules, inventory: confirmation.resource };
});
