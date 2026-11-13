import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { asValue, createContainer } from "@medusajs/deps/awilix-portable";
import { createStoreCartHttpHandler } from "@flarex/medusa-http/store-cart";
import { ManualFulfillmentService } from "@medusajs/fulfillment-manual/services";
import { SystemPaymentProvider } from "@medusajs/payment/providers/system";
import SystemTaxService from "@medusajs/tax/providers/system";
import { CartModuleService } from "@medusajs/cart/services";
import { PricingModuleService } from "@medusajs/pricing/services";
import { flattenObjectToKeyValuePairs } from "@medusajs/utils/common/flatten-object-to-key-value-pairs";
import { makeStoreCartRequestScopeFactory } from "../src/http/store-cart-request";
import { prepareCartShippingWorkflows } from "../src/workflows/cart/shipping";
import { cartCreationModuleNames } from "../src/workflows/cart/creation-graph";
import { captureInstalledWorkflowModules } from "../src/workflow/host";
import { cartShippingPricingContext } from "../src/modules/pricing/cart-shipping-context";
import { prepareStoreCartRequestFixture } from "./support/store-cart-request-fixture";
import { storeCartLogger, storeCartToken, storeCartRevokedToken, storeCartShippingSeedRows } from "./support/store-cart-request-catalog";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cartBody = Schema.decodeUnknownSync(Schema.Struct({ cart: Schema.JsonObject }));
const optionBody = Schema.decodeUnknownSync(Schema.Struct({ shipping_options: Schema.Array(Schema.JsonObject) }));
const rows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const id = Schema.decodeUnknownSync(Schema.NonEmptyString);
const hasCartId = Schema.is(Schema.Struct({ data: Schema.Struct({ id: Schema.String }) }));
const standard = "so-http-shipping-standard", express = "so-http-shipping-express";
let tested: Awaited<ReturnType<typeof prepareStoreCartRequestFixture>>;
beforeAll(async () => { tested = await prepareStoreCartRequestFixture(driver, { additionalRows: storeCartShippingSeedRows }); }, 600_000);
afterAll(async () => { await tested?.fixture.close(); }, 60_000);
const requestDiagnostics = new WeakMap<object, string>();
const explain = (response: { readonly status: number; readonly value: unknown }) => JSON.stringify(response) + (requestDiagnostics.get(response) ?? "");

async function request(path: string, options: Readonly<{ value?: unknown; key?: string; method?: "GET" | "POST" }> = {}) {
  return tested.use(runtime => Effect.gen(function* () {
    const container = createContainer().register({ logger: asValue(storeCartLogger), configModule: asValue({ projectConfig: { http: {} } }) });
    const failures: string[] = [];
    const observe = <A, E, R>(work: Effect.Effect<A, E, R>) => work.pipe(Effect.tapCause(cause => Effect.sync(() => {
      failures.push(Cause.pretty(cause) + "\nCaptured failure: " + JSON.stringify(cause, (key, value) => key === "stack" ? undefined : value));
    })));
    const witnessed: typeof runtime = { ...runtime, runWorkflow: (name, value) => observe(runtime.runWorkflow(name, value)),
      remoteQuery: value => observe(runtime.remoteQuery(value)), query: { graph: (value, options) => observe(runtime.query.graph(value, options)) } };
    const scopes = yield* makeStoreCartRequestScopeFactory({ runtime: witnessed, container });
    const http = createStoreCartHttpHandler({ storeCors: "https://store.test", ...scopes,
      admitCartRefetchFields: runtime.admitCartRefetchFields, admitShippingOptionFields: runtime.admitShippingOptionFields });
    const response = yield* Effect.promise(() => http.handle(new Request(`https://store.test${path}`, {
      method: options.method ?? (options.value === undefined ? "GET" : "POST"),
      headers: { "content-type": "application/json", "x-publishable-api-key": options.key ?? storeCartToken },
      ...(options.value === undefined ? {} : { body: JSON.stringify(options.value) }),
    })));
    const result = { status: response.status, value: yield* Effect.promise(() => response.json()) };
    if (failures.length) requestDiagnostics.set(result, `\nRequest: ${JSON.stringify({ path, value: options.value })}\n${failures.join("\n")}`);
    return result;
  }));
}
const shippingPath = (cart: string) => `/store/carts/${cart}/shipping-methods`;
const publicEvents = (snapshot: Awaited<ReturnType<typeof tested.fixture.snapshot>>) => snapshot.events.filter(event => !event.envelope.internal);
const updated = (snapshot: Awaited<ReturnType<typeof tested.fixture.snapshot>>, cart: string) => snapshot.events.filter(event =>
  event.envelope.contract === "cart.updated" && hasCartId(event.envelope.message) && event.envelope.message.data.id === cart);
const methods = (cart: typeof Schema.JsonObject.Type) => rows(cart.shipping_methods);
const businessRows = (snapshot: Awaited<ReturnType<typeof tested.fixture.snapshot>>) => {
  const tables = new Set(tested.catalog.sources.flatMap(source => source.definition.tables.map(table => table.name)));
  return snapshot.rows.filter(row => tables.has(row.table));
};
function installedModules() {
  return Result.getOrThrow(captureInstalledWorkflowModules(Object.fromEntries(cartCreationModuleNames.map(name =>
    [name, { module: tested.catalog.runtimes.workflows[name], nativeStorage: tested.fixture.source(name) }])), cartCreationModuleNames));
}
const prepare = () => Effect.runPromise(prepareCartShippingWorkflows({ execution: tested.fixture.execution, modules: installedModules(),
  salesChannelRead: tested.catalog.runtimes.salesChannelRead,
  shippingLinks: {
    location_fulfillment_set_links: { ...tested.catalog.shippingLinks.location_fulfillment_set_links,
      nativeStorage: tested.fixture.source("location_fulfillment_set_links") },
    shipping_option_price_set_links: { ...tested.catalog.shippingLinks.shipping_option_price_set_links,
      nativeStorage: tested.fixture.source("shipping_option_price_set_links") },
  }, link: tested.catalog.runtimes.link, logger: tested.catalog.runtimes.logger,
  revision: "9".repeat(64), subscribers: [{ id: "native-cart-shipping-replay", revision: "a".repeat(64) }] }));

it("lists native eligible flat options, keeps mandatory fields and observes return, context, GeoZone, channel and real Inventory", async () => {
  const roots = await prepare();
  const quote = vi.spyOn(ManualFulfillmentService.prototype, "calculatePrice"), validate = vi.spyOn(ManualFulfillmentService.prototype, "validateFulfillmentData");
  try {
    const before = await tested.fixture.snapshot();
    const nativeInput = Result.getOrThrow(roots.listShippingOptions.decodeInput({ cart_id: "cart-http-shipping" }));
    const nativeOptions = rows(await Effect.runPromise(roots.listShippingOptions.run(roots.listShippingOptions.newRequestKey(), nativeInput)));
    expect(nativeOptions.map(option => option.id).sort()).toEqual([express, standard]);
    const listed = await request("/store/shipping-options?cart_id=cart-http-shipping&fields=id&limit=1&offset=9");
    expect(listed.status, explain(listed)).toBe(200);
    const options = optionBody(listed.value).shipping_options;
    expect(options.map(option => option.id).sort()).toEqual([express, standard]);
    expect(options).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: standard, name: "HTTP Shipping standard", amount: 5, is_tax_inclusive: false, insufficient_inventory: false,
        calculated_price: expect.objectContaining({ calculated_amount: 5 }), provider: expect.objectContaining({ id: "manual_manual" }) }),
      expect.objectContaining({ id: express, amount: 8, insufficient_inventory: false }),
    ]));
    const returned = await request("/store/shipping-options?cart_id=cart-http-shipping&is_return=true");
    expect(returned.status, explain(returned)).toBe(200);
    expect(optionBody(returned.value).shipping_options.map(option => option.id)).toEqual(["so-http-shipping-return"]);
    const scarce = await request("/store/shipping-options?cart_id=cart-http-shipping-inventory");
    expect(scarce.status, explain(scarce)).toBe(200);
    expect(optionBody(scarce.value).shipping_options).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: standard, insufficient_inventory: true }), expect.objectContaining({ id: express, insufficient_inventory: true }),
    ]));
    const completed = await request("/store/shipping-options?cart_id=cart-http-shipping-completed");
    expect(completed.status, explain(completed)).toBe(200);
    const input = Result.getOrThrow(roots.listShippingOptions.decodeInput({ cart_id: "cart-http-shipping", enabled_in_store: false }));
    const disabled = rows(await Effect.runPromise(roots.listShippingOptions.run(roots.listShippingOptions.newRequestKey(), input)));
    expect(disabled.map(option => option.id)).toEqual(["so-http-shipping-rule-mismatch"]);
    const after = await tested.fixture.snapshot();
    expect(businessRows(after)).toEqual(businessRows(before)); expect(publicEvents(after)).toEqual(publicEvents(before));
    expect(quote).not.toHaveBeenCalled(); expect(validate).not.toHaveBeenCalled();
  } finally {
    quote.mockRestore(); validate.mockRestore();
    await Effect.runPromise(roots.listShippingOptions.close); await Effect.runPromise(roots.addShippingMethod.close);
  }
});

it("adds, repeats and replaces actual Manual methods while atomically refreshing Tax, both Promotion targets, Payment and one Cart event", async () => {
  const validate = vi.spyOn(ManualFulfillmentService.prototype, "validateFulfillmentData"), quote = vi.spyOn(ManualFulfillmentService.prototype, "calculatePrice");
  const deleted = vi.spyOn(SystemPaymentProvider.prototype, "deletePayment");
  const pricing = vi.spyOn(PricingModuleService.prototype, "calculatePrices");
  try {
    let previousMethod: string | undefined;
    for (const [option, amount, total] of [[standard, 5, 14.85], [standard, 5, 14.85], [express, 8, 18.15]] as const) {
      const before = await tested.fixture.snapshot();
      const oldChildren = previousMethod === undefined ? [] : before.rows.filter(row => row.value.shipping_method_id === previousMethod);
      const data = { delivery: option === express ? "express-door" : "standard-door" };
      const response = await request(shippingPath("cart-http-shipping"), { value: { option_id: option, data } });
      expect(response.status, explain(response)).toBe(200);
      const cart = cartBody(response.value).cart, current = methods(cart)[0];
      if (current === undefined) throw new Error("Native Shipping root omitted its new method");
      expect(cart).toMatchObject({ id: "cart-http-shipping", subtotal: 12.5 + amount, item_subtotal: 12.5, total,
        shipping_subtotal: amount, shipping_total: amount === 5 ? 2.2 : 5.5,
        payment_collection: { id: "paycol-http-shipping", amount: total, payment_sessions: [] } });
      expect(methods(cart)).toHaveLength(1);
      expect(current).toMatchObject({ shipping_option_id: option, amount,
        tax_lines: [expect.objectContaining({ rate: 10, code: "NATIVE-US" })],
        adjustments: [expect.objectContaining({ amount: 3 })] });
      expect(rows(cart.items)[0]).toMatchObject({ adjustments: [expect.objectContaining({ promotion_id: "promo-create-root", amount: 1 })] });
      const stored = (await tested.fixture.readRows("cart")).find(row => row.id === current.id);
      expect(stored).toMatchObject({ data });
      const after = await tested.fixture.snapshot();
      expect(updated(after, "cart-http-shipping")).toHaveLength(updated(before, "cart-http-shipping").length + 1);
      expect(after.outcomes).toHaveLength(before.outcomes.length + 1);
      if (previousMethod !== undefined) {
        expect(after.rows.find(row => row.value.id === previousMethod)?.value.deleted_at).toEqual(expect.any(String));
        expect(oldChildren.length).toBeGreaterThan(0);
        for (const child of oldChildren) expect(after.rows.find(row => row.table === child.table && row.value.id === child.value.id)).toEqual(child);
      }
      previousMethod = id(current.id);
    }
    expect(validate).toHaveBeenCalled(); expect(quote).not.toHaveBeenCalled(); expect(deleted).toHaveBeenCalledTimes(1);
    expect(validate.mock.calls).toEqual(expect.arrayContaining([[expect.objectContaining({ id: "manual-fulfillment" }),
      { delivery: "express-door" }, expect.objectContaining({ id: "cart-http-shipping", from_location: expect.objectContaining({ id: "sloc-http-shipping" }) })]]));
    const quantity = await request("/store/carts/cart-http-shipping/line-items/line-cart-http-shipping", { value: { quantity: 2 } });
    expect(quantity.status, JSON.stringify(quantity.value)).toBe(200);
    const expanded = cartBody(quantity.value).cart;
    expect(expanded).toMatchObject({ subtotal: 33, item_subtotal: 25, total: 31.9, items: [{ quantity: 2 }],
      shipping_methods: [{ id: previousMethod, shipping_option_id: express, amount: 8 }],
      payment_collection: { amount: 31.9 } });
    expect(rows(expanded.items)[0]).toMatchObject({ adjustments: [expect.objectContaining({ promotion_id: "promo-create-root", amount: 1 })] });
    expect(Schema.decodeUnknownSync(Schema.JsonObject)(expanded.payment_collection).amount).toBe(expanded.total);
    const patched = await request("/store/carts/cart-http-shipping", { value: { metadata: { after_shipping: true }, sales_channel_id: null } });
    const policy = Result.getOrThrow(cartShippingPricingContext);
    const contexts = pricing.mock.calls.map(([, call]) => Object.keys(flattenObjectToKeyValuePairs(call?.context ?? {}))
      .filter(key => key !== "currency_code" && key !== "quantity"));
    expect(contexts.some(keys => keys.length > 64)).toBe(true);
    const measurements = contexts.map(keys => ({ attributes: keys.length, opaque: keys.filter(key => !policy.fields.includes(key)).length }));
    for (const context of measurements) {
      expect(context.attributes).toBeLessThanOrEqual(policy.maximum);
      expect(context.opaque).toBeLessThanOrEqual(policy.opaqueMaximum);
    }
    console.info("Native Cart Shipping Pricing context counts", { measurements, maximum: policy.maximum, opaqueMaximum: policy.opaqueMaximum });
    if (patched.status !== 200) await tested.use(runtime => runtime.runWorkflow("update-cart", {
      id: "cart-http-shipping", metadata: { after_shipping: true }, sales_channel_id: null,
    }));
    expect(patched.status, JSON.stringify(patched.value)).toBe(200);
    expect(cartBody(patched.value).cart).toMatchObject({ metadata: { after_shipping: true }, sales_channel_id: "sc-create-root", total: 31.9,
      shipping_methods: [{ id: previousMethod, shipping_option_id: express, amount: 8 }], payment_collection: { amount: 31.9 } });
    expect((await tested.fixture.readRows("cart")).find(row => row.id === "cart-http-shipping")).toMatchObject({ sales_channel_id: "sc-create-root" });
    expect(quote).not.toHaveBeenCalled();
  } finally { validate.mockRestore(); quote.mockRestore(); deleted.mockRestore(); pricing.mockRestore(); }
});

it("rejects malformed, unsupported, missing and completed mutations without durable changes", async () => {
  const before = await tested.fixture.snapshot();
  for (const [path, value, key] of [
    [shippingPath("cart-http-shipping-failure"), {}, storeCartToken],
    [shippingPath("cart-http-shipping-failure"), { option_id: standard, data: null }, storeCartToken],
    [shippingPath("cart-http-shipping-failure"), { option_id: standard, additional_data: {} }, storeCartToken],
    [shippingPath("cart-http-shipping-failure"), { option_id: standard }, storeCartRevokedToken],
    [shippingPath("cart-http-shipping-failure") + "?fields=id,unsupported", { option_id: standard }, storeCartToken],
    [shippingPath("cart-http-shipping-failure"), { option_id: "so-http-shipping-other-channel" }, storeCartToken],
    [shippingPath("cart-http-shipping-completed"), { option_id: standard }, storeCartToken],
  ] as const) {
    const response = await request(path, { value, key });
    expect(response.status, explain(response)).toBe(400);
    expect(await tested.fixture.snapshot()).toEqual(before);
  }
  for (const path of ["/store/shipping-options?cart_id=cart-http-shipping&fields=unsupported", "/store/shipping-options?cart_id=cart-http-shipping&is_return=invalid"]) {
    expect((await request(path)).status).toBe(400); expect(await tested.fixture.snapshot()).toEqual(before);
  }
  expect((await request("/store/shipping-options?cart_id=cart-http-shipping-missing")).status).toBe(404);
  expect(await tested.fixture.snapshot()).toEqual(before);
  const missing = await request(shippingPath("cart-http-shipping-missing"), { value: { option_id: standard } });
  expect(missing).toEqual({ status: 404, value: expect.objectContaining({ message: "Cart id not found: cart-http-shipping-missing" }) });
  expect(await tested.fixture.snapshot()).toEqual(before);
  const provider = vi.spyOn(ManualFulfillmentService.prototype, "validateFulfillmentData");
  try {
    for (const cart of ["cart-http-shipping-no-channel", "cart-http-shipping-omitted-channel"]) {
      for (const [path, value] of [[`/store/shipping-options?cart_id=${cart}`, undefined],
        [`/store/carts/${cart}`, undefined], [shippingPath(cart), { option_id: standard }],
        [`/store/carts/${cart}`, { metadata: { requires_store_fallback: true } }]] as const) {
        const refused = await request(path, value === undefined ? {} : { value });
        expect(refused.status, explain(refused)).toBe(400);
        expect(await tested.fixture.snapshot()).toEqual(before);
      }
    }
    expect(provider).not.toHaveBeenCalled();
  } finally { provider.mockRestore(); }
});

it("rolls back provider rejection and a late failure after the genuine native method and Tax work", async () => {
  const before = await tested.fixture.snapshot();
  const log = vi.spyOn(storeCartLogger, "error").mockImplementation(() => undefined);
  const provider = vi.spyOn(ManualFulfillmentService.prototype, "validateFulfillmentData").mockRejectedValueOnce(new Error("native-manual-shipping-rejection"));
  try {
    const response = await request(shippingPath("cart-http-shipping-failure"), { value: { option_id: standard } });
    expect(response.status, explain(response)).toBe(500);
    expect(provider, explain(response)).toHaveBeenCalled(); expect(await tested.fixture.snapshot()).toEqual(before);
  } finally { provider.mockRestore(); log.mockRestore(); }
  let added = false, late = false;
  const nativeAdd = CartModuleService.prototype.addShippingMethods;
  const add = vi.spyOn(CartModuleService.prototype, "addShippingMethods").mockImplementation(async function (this: CartModuleService, ...args) {
    const result = await Reflect.apply(nativeAdd, this, args); added = true; return result;
  });
  const nativeTax = SystemTaxService.prototype.getTaxLines;
  const tax = vi.spyOn(SystemTaxService.prototype, "getTaxLines").mockImplementation(async function (this: SystemTaxService, ...args) {
    const result = await Reflect.apply(nativeTax, this, args);
    if (args[1].length > 0) {
      if (!added) throw new Error("Shipping Tax callback preceded native method creation");
      late = true; throw new Error("late-native-shipping-tax-failure");
    }
    return result;
  });
  try {
    expect((await request(shippingPath("cart-http-shipping-failure"), { value: { option_id: standard } })).status).toBe(500);
    expect(added).toBe(true); expect(late).toBe(true); expect(add).toHaveBeenCalledTimes(1);
    expect(await tested.fixture.snapshot()).toEqual(before);
  } finally { add.mockRestore(); tax.mockRestore(); }
});

it("preserves native calculated-option refusal by invoking the genuine Manual quote without durable changes", async () => {
  const roots = await prepare();
  const before = await tested.fixture.snapshot(), quote = vi.spyOn(ManualFulfillmentService.prototype, "calculatePrice");
  const log = vi.spyOn(storeCartLogger, "error").mockImplementation(() => undefined);
  try {
    const input = Result.getOrThrow(roots.listShippingOptions.decodeInput({ cart_id: "cart-http-shipping-calculated" }));
    const nativeOptions = rows(await Effect.runPromise(roots.listShippingOptions.run(roots.listShippingOptions.newRequestKey(), input)));
    expect(nativeOptions).toEqual(expect.arrayContaining([expect.objectContaining({ id: "so-http-shipping-calculated", price_type: "calculated" })]));
    const listed = await request("/store/shipping-options?cart_id=cart-http-shipping-calculated");
    expect(listed.status, explain(listed)).toBe(200);
    expect(optionBody(listed.value).shipping_options).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "so-http-shipping-calculated", price_type: "calculated" }),
    ]));
    expect(quote).not.toHaveBeenCalled();
    const selected = await tested.fixture.snapshot();
    expect(businessRows(selected)).toEqual(businessRows(before));
    const refused = await request(shippingPath("cart-http-shipping-calculated"), { value: { option_id: "so-http-shipping-calculated" } });
    expect(refused.status, explain(refused)).toBe(500);
    expect(quote).toHaveBeenCalledTimes(1);
    expect(await tested.fixture.snapshot()).toEqual(selected);
  } finally {
    quote.mockRestore(); log.mockRestore();
    await Effect.runPromise(roots.listShippingOptions.close); await Effect.runPromise(roots.addShippingMethod.close);
  }
});

it("recovers a lost Shipping acknowledgement and replays the same key across prepared-root recreation without native callback replay", async () => {
  const roots = await prepare(), validate = vi.spyOn(ManualFulfillmentService.prototype, "validateFulfillmentData");
  try {
    const key = roots.addShippingMethod.newRequestKey(), fault = tested.fixture.loseNextNativeRootAcknowledgement();
    const args = Result.getOrThrow(roots.addShippingMethod.decodeInput({ cart_id: "cart-http-shipping-replay", options: [{ id: standard, data: { replay: "native" } }] }));
    expect(await Effect.runPromise(roots.addShippingMethod.run(key, args))).toBeNull();
    expect(fault).toMatchObject({ armed: false, failures: 1 }); expect(validate).toHaveBeenCalled();
    const calls = validate.mock.calls.length, committed = await tested.fixture.snapshot();
    expect(updated(committed, "cart-http-shipping-replay")).toHaveLength(1);
    expect(committed.outcomes).toContainEqual(expect.objectContaining({ timestamp: fault.evidence?.timestamp,
      value: expect.objectContaining({ key, kind: "nativeRoot", state: "committed" }) }));
    expect(await Effect.runPromise(roots.addShippingMethod.run(key, args))).toBeNull();
    expect(validate).toHaveBeenCalledTimes(calls); expect(await tested.fixture.snapshot()).toEqual(committed);
    await tested.fixture.run(tested.fixture.recover);
    const recreated = await prepare();
    try {
      expect(await Effect.runPromise(recreated.addShippingMethod.run(key, args))).toBeNull();
      expect(validate).toHaveBeenCalledTimes(calls); expect(await tested.fixture.snapshot()).toEqual(committed);
      expect(Exit.isFailure(await Effect.runPromiseExit(recreated.addShippingMethod.run(key, { ...args, options: [{ id: express }] })))).toBe(true);
      expect(await tested.fixture.snapshot()).toEqual(committed);
      expect(Result.isFailure(recreated.addShippingMethod.decodeInput({ cart_id: "cart-http-shipping-replay", options: Array.from({ length: 5 }, () => ({ id: standard })) }))).toBe(true);
      expect(Result.isFailure(recreated.listShippingOptions.decodeInput({ cart_id: "cart-http-shipping-replay", option_ids: Array.from({ length: 5 }, () => standard) }))).toBe(true);
      expect(Result.isFailure(recreated.listShippingOptions.decodeInput({ cart_id: "cart-http-shipping-replay", fields: Array.from({ length: 257 }, () => "id") }))).toBe(true);
    } finally { await Effect.runPromise(recreated.listShippingOptions.close); await Effect.runPromise(recreated.addShippingMethod.close); }
  } finally { validate.mockRestore(); await Effect.runPromise(roots.listShippingOptions.close); await Effect.runPromise(roots.addShippingMethod.close); }
});
