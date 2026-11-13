import { Cause, Effect, Exit, Result, Schema } from "effect";
import { beforeAll, expect, it } from "vitest";
import { commerceCommandIdentity, defineAtomicCommerceParticipant, runCommerceCommand,
  type CommerceCommand, type CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, commerceLimits, defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeBoundedRequestLifetime } from "../../persistence-postgres/src/execution/preparation/boundedRequestLifetime";
import { makeCommerceCommandContext } from "../../persistence-postgres/src/frameworks/commerceTransaction/context";
import { prepareCartCreationModules } from "../src/workflows/cart/creation-graph";
import { prepareCartShippingModules } from "../src/workflows/cart/shipping-graph";
import { prepareLocalGraph } from "../src/local-graph/query";
import type { GraphParticipant, GraphReadContext } from "../src/local-graph/model";
import { workflowModuleDefinition } from "../src/workflow/module";
import { compileCompleteRow, compileRowProjection } from "../src/value/complete-row";
import { captureCommerceInput } from "../src/value/input";
import { compileProductDefinition } from "../src/modules/product/definition";
import { captureVariantInventoryLinkMetadata } from "../src/composition/product-variant-inventory-schema";
import { captureServiceZoneCreationMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { captureStockLocationMetadata } from "../src/modules/stock-location/schema";
import { captureLocationFulfillmentSetLinkMetadata } from "../src/links/location-fulfillment-set-schema";
import { decodeNativeShippingOptions, decodeNativePricedShippingOptions } from "@medusajs/core-flows/common/cart-mutation-shipping-query-views";
import { CartMutationRefreshView, NativeCartMutationRefreshView } from "@medusajs/core-flows/common/cart-mutation-query-views";
import { capturePaymentMetadata } from "../src/modules/payment/schema";
import { captureCartCreationMetadata } from "../src/modules/cart/creation-schema";
import { compileStoreCartRequestFixtureCatalog } from "./support/store-cart-request-catalog";
import { promiseFailureObserver } from "./support/promise-failure-observer";
import { paymentCollectionSeed } from "./support/payment-fixture-data";
import { mockRelationalRead } from "./mock-relational-read";
import { createRawPropertiesFromBigNumber, decorateCartTotals } from "@medusajs/framework/utils/portable";
import { captureNativeNumericDto } from "../src/value/native-numeric";
import { decodeCartCollectionCreateView } from "@medusajs/core-flows/common/payment-collection-query-views";
import { cartFieldsForPricingContext, cartFieldsForRefreshSteps } from "@medusajs/core-flows/cart/variant-pricing-fields";

let catalog: Effect.Success<ReturnType<typeof compileStoreCartRequestFixtureCatalog>>["catalog"];
let graph: Result.Result.Success<ReturnType<typeof prepareLocalGraph>>;
let paymentRow: JsonObject;
let cartRow: JsonObject;
let variantRow: JsonObject;
let inventoryLinkRow: JsonObject;
let variantCommand: CommerceCommand;
const readTables = new Map<CommerceCommand, string>();
type Call = { command: CommerceCommand; args: Json };
const fields = ["payment_collection.id", "payment_collection.currency_code", "payment_collection.amount", "payment_collection.payment_sessions.*"];
const stamp = "2026-01-01T00:00:00.000Z";

beforeAll(async () => {
  ({ catalog } = await Effect.runPromise(compileStoreCartRequestFixtureCatalog()));
  const selected = await Effect.runPromise(prepareCartCreationModules(catalog.modules, catalog.runtimes.salesChannelRead));
  const modules = Result.getOrThrow(prepareCartShippingModules(selected.modules, catalog.shippingLinks));
  const participants: GraphParticipant[] = catalog.nativeSources.map(source => {
    const module = workflowModuleDefinition(modules[source.name].module);
    if (module === undefined) throw new Error("Missing native Store payment graph owner");
    for (const read of module.graph.reads) readTables.set(read.command, read.table.name);
    return { participant: defineAtomicCommerceParticipant(`paymentQuery_${source.name}`), module: module.graph };
  });
  graph = Result.getOrThrow(prepareLocalGraph(participants));
  const metadata = await Effect.runPromise(capturePaymentMetadata());
  const table = metadata.frame.tables.find(table => table.name === "payment_collection");
  if (table === undefined) throw new Error("Missing genuine PaymentCollection DML");
  paymentRow = Result.getOrThrow(Result.getOrThrow(compileCompleteRow(table))({ ...paymentCollectionSeed().row,
    id: "paycol-http-payment-existing", amount: 31.25, raw_amount: { value: "31.25", precision: 20 } }));
  const cartMetadata = await Effect.runPromise(captureCartCreationMetadata());
  const cartTable = cartMetadata.frame.tables.find(table => table.name === "cart");
  if (cartTable === undefined) throw new Error("Missing genuine Cart DML");
  cartRow = Result.getOrThrow(Result.getOrThrow(compileCompleteRow(cartTable))({ id: "cart-http-payment-existing-completed", currency_code: "usd",
    region_id: null, customer_id: null, sales_channel_id: null, email: null, locale: null, metadata: null, completed_at: stamp,
    shipping_address_id: null, billing_address_id: null, created_at: stamp, updated_at: stamp, deleted_at: null }));
  const productMetadata = await Effect.runPromise(compileProductDefinition());
  const variantTable = productMetadata.metadata.tables.find(table => table.name === "product_variant");
  const variantRead = workflowModuleDefinition(catalog.runtimes.workflows.product)?.graph.reads.find(read => read.model === "ProductVariant");
  if (variantTable === undefined || variantRead === undefined) throw new Error("Missing native Variant source");
  variantRow = Schema.decodeUnknownSync(Schema.JsonObject)(Result.getOrThrow(Result.getOrThrow(compileRowProjection(variantTable))({ id: "native-shipping-probe" })));
  variantCommand = variantRead.command;
  const inventoryLink = await Effect.runPromise(captureVariantInventoryLinkMetadata());
  inventoryLinkRow = Result.getOrThrow(Result.getOrThrow(compileCompleteRow(inventoryLink.frame))({ id: "native-inventory-link",
    variant_id: "native-shipping-probe", inventory_item_id: "native-inventory-probe", required_quantity: 1,
    created_at: stamp, updated_at: stamp, deleted_at: null }));
}, 60_000);

function graphContext(calls: Call[]): GraphReadContext {
  const linkTable = catalog.paymentRuntimes.cartPaymentCollection.metadata.frame;
  const link = Result.getOrThrow(Result.getOrThrow(compileCompleteRow(linkTable))({ id: "link-http-payment-existing",
    cart_id: "cart-http-payment-existing-completed", payment_collection_id: "paycol-http-payment-existing",
    created_at: stamp, updated_at: stamp, deleted_at: null }));
  const payment = catalog.runtimes.workflows.payment;
  const paymentRead = workflowModuleDefinition(payment)?.graph.reads.find(read => read.model === "PaymentCollection");
  const cartRead = workflowModuleDefinition(catalog.runtimes.workflows.cart)?.graph.reads.find(read => read.model === "Cart");
  if (paymentRead === undefined) throw new Error("Missing native PaymentCollection graph read");
  return { refuse: Effect.fail, recordFailure: promiseFailureObserver(), call: Effect.fn("PaymentQuery.scriptedRead")(function* (_participant, command, args) {
    calls.push({ command, args });
    const linkRead = workflowModuleDefinition(catalog.modules.cart_payment_collection_links.module)?.graph.reads[0];
    if (command === linkRead?.command) return [[link], 1];
    if (command === paymentRead.command) return [[{ ...paymentRow, payment_sessions: [] }], 1];
    if (command === cartRead?.command) return [[cartRow], 1];
    return yield* commerceError("invalidAuthority");
  }) };
}

it("admits actual native Shipping local population selectors through their owning commands before storage", async () => {
  const profiles = [
    { entryPoint: "cart", fields: [...cartFieldsForPricingContext, "items.*", "items.variant.manage_inventory",
      "items.variant.inventory_items.inventory_item_id", "items.variant.inventory_items.inventory.requires_shipping",
      "items.variant.inventory_items.inventory.location_levels.*"] },
    { entryPoint: "cart", fields: cartFieldsForRefreshSteps },
    { entryPoint: "product_variant", fields: ["id", "inventory_items.inventory.requires_shipping", "inventory_items.inventory.location_levels.*"] },
    { entryPoint: "stock_location", fields: ["id", "name", "address.*"] },
    { entryPoint: "region", fields: ["id", "name", "currency_code", "countries.*"] },
    { entryPoint: "shipping_option", fields: ["id", "name", "type.*", "rules.*", "provider.*", "service_zone.geo_zones.*", "service_zone.fulfillment_set.*"] },
  ];
  for (const profile of profiles) {
    const calls: Call[] = [], reached = new Error(`Selected ${profile.entryPoint} Shipping storage`);
    const exit = await Effect.runPromiseExit(Effect.scoped(Effect.gen(function* () {
      const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(commerceError, commerceLimits,
        {}, {}, "native-shipping-selector-contract", "read"), owner => owner.close);
      const unavailable = () => Effect.fail(commerceError("resourceFailure", reached));
      const store: CommerceCommandContext["store"] = { prepareRead(query) { return mockRelationalRead(this, query); },
        findPage: unavailable, aggregate: unavailable, find: unavailable, count: unavailable, write: unavailable,
        delete: unavailable, lifecycle: unavailable };
      const context = makeCommerceCommandContext(lifetime, { store, resources: defaultCommerceResources,
        table: () => Effect.succeed(store) }, "native-shipping-selector-contract", lifetime.context, unavailable, unavailable);
      const read: GraphReadContext = { refuse: Effect.fail, recordFailure: promiseFailureObserver(), call: (_participant, command, args) => {
        calls.push({ command, args });
        if (profile.entryPoint === "product_variant" && command === variantCommand) return Effect.succeed([[variantRow], 1]);
        if (profile.entryPoint === "product_variant" && commerceCommandIdentity(command)?.name === "variantInventoryLinkCount")
          return Effect.succeed([[inventoryLinkRow], 1]);
        return runCommerceCommand(command, context, args);
      } };
      return yield* graph.bind(read).remoteQuery({ ...profile, variables: { id: "native-shipping-probe" } }, { throwIfKeyNotFound: false });
    })));
    expect.soft(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect.soft(Cause.pretty(exit.cause), JSON.stringify({ profile,
      calls: calls.map(call => ({ command: commerceCommandIdentity(call.command)?.name, args: call.args })) })).toContain(reached.message);
  }
});

it("decodes the actual native calculated Shipping option's own undefined price without admitting unrelated undefined fields", async () => {
  const fulfillment = await Effect.runPromise(captureServiceZoneCreationMetadata());
  const stock = await Effect.runPromise(captureStockLocationMetadata());
  const link = await Effect.runPromise(captureLocationFulfillmentSetLinkMetadata());
  const selected = (name: string, value: unknown) => {
    const table = [...fulfillment.frame.tables, ...stock.frame.tables].find(table => table.name === name);
    if (table === undefined) throw new Error("Missing actual Shipping DML " + name);
    return Schema.decodeUnknownSync(Schema.JsonObject)(Result.getOrThrow(Result.getOrThrow(compileRowProjection(table))(value)));
  };
  const set = selected("fulfillment_set", { id: "fset-http-shipping", type: "shipping" });
  const zone = selected("service_zone", { id: "sz-http-shipping-gb", fulfillment_set_id: set.id });
  const option = selected("shipping_option", { id: "so-http-shipping-calculated", name: "HTTP Shipping calculated", price_type: "calculated",
    service_zone_id: zone.id, shipping_profile_id: "sp-create-root", provider_id: "manual_manual", data: { id: "manual-fulfillment" } });
  const type = selected("shipping_option_type", { id: "sot-http-shipping", label: "Manual delivery", description: null, code: "manual-http" });
  const provider = selected("fulfillment_provider", { id: "manual_manual", is_enabled: true });
  const location = selected("stock_location", { id: "sloc-http-shipping", name: "HTTP Shipping location", address_id: null });
  const relation = Result.getOrThrow(Result.getOrThrow(compileCompleteRow(link.frame))({ id: "locfs-http-shipping",
    stock_location_id: location.id, fulfillment_set_id: set.id, created_at: stamp, updated_at: stamp, deleted_at: null }));
  const calls: string[] = [];
  const query = graph.bind({ refuse: Effect.fail, recordFailure: promiseFailureObserver(), call: (_participant, command) => {
    const table = readTables.get(command); calls.push(table ?? "unissued");
    if (table === "shipping_option") return Effect.succeed([[{ ...option, type, provider, rules: [],
      service_zone: { ...zone, fulfillment_set: set } }], 1]);
    if (table === "location_fulfillment_set") return Effect.succeed([[relation], 1]);
    if (table === "stock_location") return Effect.succeed([[{ ...location, address: null }], 1]);
    if (table === "shipping_option_price_set") return Effect.succeed([[], 0]);
    return Effect.fail(commerceError("invalidAuthority"));
  } });
  const actual = await Effect.runPromise(query.remoteQuery({ entryPoint: "shipping_options", variables: { id: option.id }, fields: [
    "id", "name", "price_type", "service_zone_id", "shipping_profile_id", "provider_id", "data",
    "service_zone.fulfillment_set_id", "service_zone.fulfillment_set.type", "service_zone.fulfillment_set.location.id",
    "service_zone.fulfillment_set.location.address.*", "type.id", "type.label", "type.description", "type.code",
    "provider.id", "provider.is_enabled", "rules.attribute", "rules.value", "rules.operator",
    "calculated_price.*", "prices.*", "prices.price_rules.*",
  ] }, { throwIfKeyNotFound: false }));
  if (!Array.isArray(actual) || actual.length !== 1 || actual[0] === null || typeof actual[0] !== "object")
    throw new Error("Missing genuine native Shipping query row");
  expect(calls).toContain("shipping_option_price_set");
  expect(Object.hasOwn(actual[0], "calculated_price")).toBe(true);
  expect(Reflect.get(actual[0], "calculated_price")).toBeUndefined();
  expect(() => decodeNativeShippingOptions(actual)).not.toThrow();
  expect(() => decodeNativePricedShippingOptions([{ ...actual[0], amount: undefined }])).not.toThrow();
  for (const row of [{ ...actual[0], unrelated: undefined }, { ...actual[0], calculated_price: 123 },
    { ...actual[0], calculated_price: { calculated_amount: "wrong", is_calculated_price_tax_inclusive: false } }])
    expect(() => decodeNativeShippingOptions([row])).toThrow();
});

it("decodes an actual native Cart refresh DTO produced by the native Cart service over complete checked empty storage", async () => {
  const actual = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(commerceError, commerceLimits,
      {}, {}, "native-cart-refresh-dto", "read"), owner => owner.close);
    const unavailable = () => Effect.fail(commerceError("invalidAuthority"));
    const store: CommerceCommandContext["store"] = { prepareRead(query) { return mockRelationalRead(this, query); },
      findPage: unavailable, aggregate: unavailable, find: () => Effect.succeed([]), count: () => Effect.succeed(0), write: unavailable,
      delete: unavailable, lifecycle: unavailable };
    const stored = { ...cartRow, id: "cart-native-refresh", sales_channel_id: "sc-create-root", completed_at: null };
    const context = makeCommerceCommandContext(lifetime, { store, resources: defaultCommerceResources,
      table: (_manager, table) => Effect.succeed({ ...store, find: () => Effect.succeed(table === "cart" ? [stored] : []),
        count: () => Effect.succeed(table === "cart" ? 1 : 0) }) },
    "native-cart-refresh-dto", lifetime.context, unavailable, unavailable);
    return yield* graph.bind({ refuse: Effect.fail, recordFailure: promiseFailureObserver(),
      call: (_participant, command, args) => runCommerceCommand(command, context, args) }).remoteQuery({ entryPoint: "cart",
      fields: cartFieldsForRefreshSteps, variables: { id: stored.id } }, { throwIfKeyNotFound: true });
  })));
  if (!Array.isArray(actual) || actual.length !== 1) throw new Error("Missing genuine native Cart refresh");
  const row = actual[0];
  if (row === null || typeof row !== "object" || Array.isArray(row)) throw new Error("Missing genuine native Cart row");
  for (const name of ["customer", "region", "payment_collection"]) {
    expect(Object.hasOwn(row, name)).toBe(true);
    expect(Reflect.get(row, name)).toBeUndefined();
  }
  expect(Object.hasOwn(row, "raw_total")).toBe(false);
  const decoded = Schema.decodeUnknownResult(NativeCartMutationRefreshView)(actual[0]);
  expect(Result.isSuccess(decoded), (Result.isFailure(decoded) ? String(decoded.failure) : "") + "\n" +
    JSON.stringify(actual[0], (_key, value) => value === undefined ? "<native undefined>" : value)).toBe(true);
  for (const malformed of [{ ...row, unrelated: undefined }, { ...row, total: undefined }, { ...row, items: undefined },
    { ...row, payment_collection: { id: 123 } }, { ...row, region: { id: 123 } }, { ...row, customer: { id: 123 } },
    { ...row, raw_total: undefined }, { ...row, raw_total: { value: 0, precision: 20 } }])
    expect(Result.isFailure(Schema.decodeUnknownResult(NativeCartMutationRefreshView)(malformed))).toBe(true);
  expect(Result.isFailure(Schema.decodeUnknownResult(CartMutationRefreshView)(row))).toBe(true);
  expect(Result.isSuccess(Schema.decodeUnknownResult(CartMutationRefreshView)(Result.getOrThrow(captureCommerceInput(row))))).toBe(true);
});

it("reads the existing Collection Link's default projection without selecting its completed null-channel Cart", async () => {
  const calls: Call[] = [];
  expect(Result.isSuccess(graph.admitProjection("cart_payment_collection", fields))).toBe(true);
  const result = await Effect.runPromiseExit(graph.bind(graphContext(calls)).graph({ entity: "cart_payment_collection", fields,
    filters: { cart_id: "cart-http-payment-existing-completed" }, pagination: { take: 4, skip: 0 } }));
  expect(Exit.isSuccess(result), Exit.isFailure(result) ? Cause.pretty(result.cause) + JSON.stringify(calls) : undefined).toBe(true);
  if (Exit.isSuccess(result)) expect(result.value.data).toMatchObject([{ payment_collection: { id: "paycol-http-payment-existing", amount: 31.25,
    currency_code: "usd", payment_sessions: [] } }]);
  expect(calls.map(call => commerceCommandIdentity(call.command)?.name)).toEqual(["cartPaymentCollectionCount", "paymentCollectionCountForLifecycle"]);
});

it("passes the Link root's genuine graph arguments through its authoritative command decoder before storage", async () => {
  const calls: Call[] = [];
  await Effect.runPromise(graph.bind(graphContext(calls)).graph({ entity: "cart_payment_collection", fields: ["id", "cart_id", "payment_collection_id"],
    filters: { cart_id: "cart-http-payment-existing-completed" }, pagination: { take: 4, skip: 0 } }));
  const first = calls[0];
  if (first === undefined) throw new Error("Native Link root made no read");
  const reached = new Error("reached authentic Cart Payment Link storage boundary");
  const exit = await Effect.runPromiseExit(Effect.scoped(Effect.gen(function* () {
    const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(commerceError, commerceLimits,
      {}, {}, "store-payment-query-contract", "read"), owner => owner.close);
    const unavailable = () => Effect.fail(commerceError("resourceFailure", reached));
    const store: CommerceCommandContext["store"] = { prepareRead(query) { return mockRelationalRead(this, query); },
      findPage: unavailable, aggregate: unavailable, find: unavailable, count: unavailable, write: unavailable,
      delete: unavailable, lifecycle: unavailable };
    const context = makeCommerceCommandContext(lifetime, { store, resources: defaultCommerceResources,
      table: () => Effect.succeed(store) }, "store-payment-query-contract", lifetime.context, unavailable, unavailable);
    return yield* runCommerceCommand(first.command, context, first.args);
  })));
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    expect(Cause.pretty(exit.cause), JSON.stringify(first.args)).toContain(reached.message);
    expect(exit.cause.reasons.flatMap(reason => Cause.isFailReason(reason) ? [reason.error.cause] : [])).toContain(reached);
  }
});

it("decodes the genuine native Cart payment singleton after an absent Collection relation", async () => {
  const calls: Call[] = [];
  const cart = { ...cartRow, completed_at: null, currency_code: "usd", items: [], shipping_methods: [], credit_lines: [] };
  createRawPropertiesFromBigNumber(decorateCartTotals(cart));
  const native = Result.getOrThrow(captureNativeNumericDto(cart));
  const cartRead = workflowModuleDefinition(catalog.runtimes.workflows.cart)?.graph.reads.find(read => read.model === "Cart");
  const linkRead = workflowModuleDefinition(catalog.modules.cart_payment_collection_links.module)?.graph.reads[0];
  if (cartRead === undefined || linkRead === undefined) throw new Error("Missing authentic native Cart/Link read owners");
  const context: GraphReadContext = { refuse: Effect.fail, recordFailure: promiseFailureObserver(), call: (_participant, command, args) => {
    calls.push({ command, args });
    return command === cartRead.command ? Effect.succeed([[native], 1]) : command === linkRead.command ? Effect.succeed([[], 0])
      : Effect.fail(commerceError("invalidAuthority"));
  } };
  const result = await Effect.runPromise(graph.bind(context).remoteQuery({ entryPoint: "cart", variables: { id: cartRow.id },
    fields: ["id", "completed_at", "currency_code", "total", "raw_total", "payment_collection.id"] }, { throwIfKeyNotFound: true }));
  const values = Schema.decodeUnknownSync(Schema.Array(Schema.Unknown))(result);
  const decoded = decodeCartCollectionCreateView(values[0]);
  expect(Result.getOrThrow(decoded)).toEqual(values[0]);
  expect(Object.hasOwn(Result.getOrThrow(decoded), "payment_collection")).toBe(true);
  expect(Result.getOrThrow(decoded).payment_collection).toBeUndefined();
  for (const changed of [{ ...Result.getOrThrow(decoded), id: false }, { ...Result.getOrThrow(decoded), extra: true },
    { ...Result.getOrThrow(decoded), payment_collection: { id: 1 } }])
    expect(Result.isFailure(decodeCartCollectionCreateView(changed))).toBe(true);
});
