import { Effect, Result } from "effect";
import { CartCustomer, CartRegion, CartProduct, InventoryLevelStockLocation, ProductShippingProfile,
  ProductVariantInventoryItem, SalesChannelLocation } from "@medusajs/link-modules";
import { describeToManyRelation } from "@medusajs/drizzle/relation-query";
import { matchesAtomicCommerceNativeSource } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { nativeLinkGraphDirectPaths, localGraphDirectPath } from "../../local-graph/direct-paths";
import { nativeLinkGraphPaths } from "../../local-graph/links";
import { relationPaths } from "../../local-graph/module";
import type { GraphModuleDefinition, GraphReadDefinition } from "../../local-graph/model";
import { captureInventoryMetadata } from "../../modules/inventory/schema";
import { capturePaymentMetadata } from "../../modules/payment/schema";
import { captureProductSchema } from "../../modules/product/schema";
import { productRuntimeMetadata } from "../../modules/product/runtime-metadata";
import { makeReadCatalog } from "../../query/catalog";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { captureInstalledWorkflowModules, type InstalledWorkflowModule } from "../../workflow/host";
import { defineWorkflowModule, workflowModuleDefinition, type WorkflowModule } from "../../workflow/module";

export const checkoutModuleNames = ["cart", "order", "payment", "cart_payment_collection_links", "order_payment_collection_links",
  "order_cart_links", "customer", "region", "promotion", "cart_promotion_links", "product", "product_links", "variant_links",
  "inventory", "stock_location", "sales_channel", "sales_channel_locations", "fulfillment"] as const;
export type InstalledCheckoutModule = Extract<InstalledWorkflowModule, { readonly nativeStorage: unknown }> & {
  readonly logicalResources?: never;
  readonly logicalPublication?: never;
};
export type CheckoutModules = Readonly<Record<typeof checkoutModuleNames[number], InstalledCheckoutModule>>;
export const customerCheckoutModuleNames = [...checkoutModuleNames, "customer_account_holder_links"] as const;
export type CustomerCheckoutModules = Readonly<Record<typeof customerCheckoutModuleNames[number], InstalledCheckoutModule>>;

const checkoutSourceKeys = {
  cart: "medusa.cart",
  order: "medusa.order",
  payment: "medusa.payment",
  cart_payment_collection_links: "medusa.link.cartPaymentCollection",
  order_payment_collection_links: "medusa.link.orderPaymentCollection",
  order_cart_links: "medusa.link.orderCart",
  customer: "medusa.customer",
  region: "medusa.region",
  promotion: "medusa.promotion",
  cart_promotion_links: "medusa.link.cartPromotion",
  product: "medusa.product",
  product_links: "medusa.product-links",
  variant_links: "medusa.variantLinks",
  inventory: "medusa.inventory",
  stock_location: "medusa.stockLocation",
  sales_channel: "medusa.salesChannel",
  sales_channel_locations: "medusa.salesChannelLocationLink",
  fulfillment: "medusa.shippingProfile",
  customer_account_holder_links: "medusa.link.customerAccountHolder",
} as const satisfies Readonly<Record<typeof customerCheckoutModuleNames[number], string>>;

/** The exact native Cart selector uses existing source identities and read
 * commands. Empty branches do not replace real target model registrations. */
const prepareGraphs = Effect.fn("Checkout.prepareGraphs")(function* (input: Readonly<Record<string, WorkflowModule>>, profile: "checkout" | "customer") {
  const names = profile === "customer" ? customerCheckoutModuleNames : checkoutModuleNames;
  const record = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(record).length !== names.length) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const installed = record;
  const definitions = new Map<typeof customerCheckoutModuleNames[number], NonNullable<ReturnType<typeof workflowModuleDefinition>>>();
  for (const key of names) {
    const module = installed[key], definition = module === undefined ? undefined : workflowModuleDefinition(module);
    if (definition === undefined)
      return yield* Effect.fail(commerceError("invalidAuthority"));
    definitions.set(key, definition);
  }
  const definition = (key: typeof customerCheckoutModuleNames[number]) => {
    const value = definitions.get(key);
    return value === undefined ? Result.fail(commerceError("invalidAuthority")) : Result.succeed(value);
  };
  const expected = [["cart", "cart.checkout"], ["order", "order.checkout"], ["payment", "payment.system-lifecycle"],
    ["customer", profile === "customer" ? "customer.address-management" : "customer.checkout-read"], ["promotion", "promotion.checkout-read"], ["fulfillment", "fulfillment.checkout-read"],
    ["inventory", "inventory-checkout"],
    ["order_cart_links", "order-cart.checkout-native-links"], ["order_payment_collection_links", "order-payment.checkout-native-links"]] as const;
  for (const [key, profile] of expected) {
    const selected = definitions.get(key);
    if (selected?.source.profile !== profile) return yield* Effect.fail(commerceError("invalidAuthority"));
  }
  if (profile === "customer" && definitions.get("customer_account_holder_links")?.source.profile !== "customer-account.checkout-native-links")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const root = "Cart", prefix = "items.variant", product = yield* Effect.fromResult(definition("product"));
  const capturedProduct = yield* captureProductSchema("product-runtime-contract").pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const productMetadata = yield* productRuntimeMetadata(capturedProduct.metadata.frame);
  const productReads: GraphReadDefinition[] = [];
  for (const read of product.graph.reads) if (read.model === productMetadata.variant.model || read.model === productMetadata.product.model) {
    productReads.push({ ...read, nativeFields: true as const,
      paths: yield* Effect.fromResult(relationPaths(productMetadata.readCatalog, read.table.name, read.paths.map(path => path.path), { nativeFields: true })) });
  }
  const capturedInventory = yield* captureInventoryMetadata(), inventory = yield* Effect.fromResult(definition("inventory"));
  const item = capturedInventory.frame.tables.find(table => table.name === "inventory_item"), level = capturedInventory.frame.tables.find(table => table.name === "inventory_level");
  const itemRead = inventory.graph.reads.find(read => read.table.name === item?.name), levelRead = inventory.graph.reads.find(read => read.table.name === level?.name);
  if (item === undefined || level === undefined || itemRead === undefined || levelRead === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const levels = describeToManyRelation(item, "location_levels", capturedInventory.frame.tables);
  if (levels === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const inventoryCatalog = yield* Effect.fromResult(makeReadCatalog(capturedInventory.frame.tables.map(table => ({ name: table.name,
    columns: table.columns.map(column => column.name), primaryKeys: table.columns.filter(column => column.primaryKey).map(column => column.name),
    foreignKeys: table.foreignKeys.flatMap(key => key.columns), companions: {},
  })), new Map([[item.name, new Map([[levels.name, levels]])]])));
  const paymentMetadata = yield* capturePaymentMetadata(), payment = yield* Effect.fromResult(definition("payment"));
  const collection = paymentMetadata.frame.tables.find(table => table.name === "payment_collection");
  const sessions = collection === undefined ? undefined : describeToManyRelation(collection, "payment_sessions", paymentMetadata.frame.tables);
  if (collection === undefined || sessions === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const paymentCatalog = yield* Effect.fromResult(makeReadCatalog(payment.graph.reads.map(read => read.table),
    new Map([[collection.name, new Map([[sessions.name, sessions]])]])));
  const paymentSessions = yield* Effect.fromResult(localGraphDirectPath(paymentCatalog, collection.name, "PaymentCollection", "PaymentSession", sessions.name,
    { root, path: "payment_collection.payment_sessions", maximumSources: 4, maximumTargets: 4, maximumPerSource: 4 }));
  const variant = yield* Effect.fromResult(nativeLinkGraphDirectPaths(CartProduct, [{ root, path: prefix,
    maximumSources: 4, maximumTargets: 4, maximumPerSource: 1 }], "LineItem"));
  const customer = yield* Effect.fromResult(nativeLinkGraphDirectPaths(CartCustomer, [{ root, path: "customer",
    maximumSources: 4, maximumTargets: 4, maximumPerSource: 1 }], root));
  const region = yield* Effect.fromResult(nativeLinkGraphDirectPaths(CartRegion, [{ root, path: "region",
    maximumSources: 4, maximumTargets: 4, maximumPerSource: 1 }], root));
  const rich = yield* Effect.fromResult(nativeLinkGraphDirectPaths(ProductVariantInventoryItem, [{ root, path: prefix + ".inventory_items",
    maximumSources: 4, maximumTargets: 8, maximumPerSource: 8 }], productMetadata.variant.model));
  const richModel = rich[0]?.targetModel;
  if (richModel === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const richInventory = yield* Effect.fromResult(nativeLinkGraphDirectPaths(ProductVariantInventoryItem, [{ root, path: prefix + ".inventory_items.inventory",
    maximumSources: 8, maximumTargets: 4, maximumPerSource: 1 }], richModel));
  const inventoryLevels = yield* Effect.fromResult(localGraphDirectPath(inventoryCatalog, item.name, itemRead.model, levelRead.model, levels.name,
    { root, path: prefix + ".inventory_items.inventory.location_levels", maximumSources: 4, maximumTargets: 16, maximumPerSource: 16 }));
  const stock = yield* Effect.fromResult(nativeLinkGraphDirectPaths(InventoryLevelStockLocation, [{ root,
    path: prefix + ".inventory_items.inventory.location_levels.stock_locations", maximumSources: 16, maximumTargets: 4, maximumPerSource: 1 }], levelRead.model));
  const stockModel = stock[0]?.targetModel;
  if (stockModel === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const channels = yield* Effect.fromResult(nativeLinkGraphPaths(SalesChannelLocation, [{ root,
    path: prefix + ".inventory_items.inventory.location_levels.stock_locations.sales_channels",
    maximumSources: 4, maximumLinks: 8, maximumTargets: 4, maximumPerSource: 4 }], stockModel));
  const shipping = yield* Effect.fromResult(nativeLinkGraphPaths(ProductShippingProfile, [{ root, path: prefix + ".product.shipping_profile",
    maximumSources: 4, maximumLinks: 4, maximumTargets: 4, maximumPerSource: 1 }], productMetadata.product.model));
  const clone = (key: typeof customerCheckoutModuleNames[number], graph: GraphModuleDefinition) => Result.gen(function* () {
    const original = yield* definition(key);
    const module = installed[key];
    if (module === undefined) return yield* Result.fail(commerceError("invalidAuthority"));
    return yield* defineWorkflowModule({ name: module.name, source: original.source,
      methods: module.methods, graph, ...(original.logical === undefined ? {} : { logical: original.logical }) });
  });
  const cart = yield* Effect.fromResult(definition("cart")), variantLinks = yield* Effect.fromResult(definition("variant_links")),
    productLinks = yield* Effect.fromResult(definition("product_links")), channelLinks = yield* Effect.fromResult(definition("sales_channel_locations"));
  return { ...installed,
    cart: yield* Effect.fromResult(clone("cart", { ...cart.graph, directPaths: [...cart.graph.directPaths ?? [], ...variant, ...customer, ...region] })),
    payment: yield* Effect.fromResult(clone("payment", { ...payment.graph, directPaths: [...payment.graph.directPaths ?? [], paymentSessions] })),
    product: yield* Effect.fromResult(clone("product", { ...product.graph, reads: productReads,
      aliases: product.graph.aliases.filter(alias => productReads.some(read => read.model === alias.model)) })),
    inventory: yield* Effect.fromResult(clone("inventory", { ...inventory.graph, directPaths: [...inventory.graph.directPaths ?? [], inventoryLevels, ...stock] })),
    variant_links: yield* Effect.fromResult(clone("variant_links", { ...variantLinks.graph,
      remotePaths: [], directPaths: [...rich, ...richInventory],
      reads: variantLinks.graph.reads.filter(read => read.model === richModel), aliases: variantLinks.graph.aliases.filter(alias => alias.model === richModel) })),
    product_links: yield* Effect.fromResult(clone("product_links", { ...productLinks.graph, remotePaths: [...shipping] })),
    sales_channel_locations: yield* Effect.fromResult(clone("sales_channel_locations", { ...channelLinks.graph, remotePaths: [...channels] })),
  };
});

export const prepareCheckoutGraphs = (input: Readonly<Record<string, WorkflowModule>>) => prepareGraphs(input, "checkout");
export const prepareCustomerCheckoutGraphs = (input: Readonly<Record<string, WorkflowModule>>) => prepareGraphs(input, "customer");

const prepareModules = Effect.fn("Checkout.prepareModules")(function* (input: Readonly<Record<string, InstalledCheckoutModule>>, profile: "checkout" | "customer") {
  const names = profile === "customer" ? customerCheckoutModuleNames : checkoutModuleNames;
  const record = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(record).length !== names.length) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const installed = yield* Effect.fromResult(captureInstalledWorkflowModules(record, names));
  for (const key of names) {
    const member = installed[key];
    if (member.logicalResources !== undefined || member.logicalPublication !== undefined || member.logicalStorage !== undefined ||
      member.nativeStorage === undefined || !matchesAtomicCommerceNativeSource(member.nativeStorage, key, checkoutSourceKeys[key]))
      return yield* Effect.fail(commerceError("invalidAuthority"));
  }
  const graphs: Readonly<Record<string, WorkflowModule>> = yield* prepareGraphs(Object.fromEntries(names.map(name => [name, installed[name].module])), profile);
  const entries: Array<[string, InstalledCheckoutModule]> = [];
  for (const key of names) {
    const module = graphs[key];
    if (module === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
    entries.push([key, { ...installed[key], module }]);
  }
  return yield* Effect.fromResult(captureInstalledWorkflowModules(Object.fromEntries(entries), names));
});

export const prepareCheckoutModules = (input: CheckoutModules): Effect.Effect<CheckoutModules, ReturnType<typeof commerceError>> => prepareModules(input, "checkout");
export const prepareCustomerCheckoutModules = (input: CustomerCheckoutModules): Effect.Effect<CustomerCheckoutModules, ReturnType<typeof commerceError>> => prepareModules(input, "customer");
