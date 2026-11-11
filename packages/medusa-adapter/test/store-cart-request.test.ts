import { afterAll, beforeAll, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { asValue, createContainer } from "@medusajs/deps/awilix-portable";
import { createStoreCartHttpHandler } from "@flarex/medusa-http/store-cart";
import { makeStoreCartRequestScopeFactory } from "../src/http/store-cart-request";
import type { CartCreationHooks } from "../src/workflows/cart/create-cart";
import { prepareStoreCartRequestFixture } from "./support/store-cart-request-fixture";
import { storeCartLogger, storeCartToken, storeCartMultiToken, storeCartRevokedToken } from "./support/store-cart-request-catalog";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const body = Schema.decodeUnknownSync(Schema.Struct({ cart: Schema.JsonObject }));
let tested: Awaited<ReturnType<typeof prepareStoreCartRequestFixture>>;
beforeAll(async () => { tested = await prepareStoreCartRequestFixture(driver); }, 600_000);
afterAll(async () => { await tested?.fixture.close(); }, 60_000);

async function request(path: string, options: Readonly<{ value?: unknown; key?: string; customer?: boolean; hooks?: CartCreationHooks }> = {}) {
  return tested.use(runtime => Effect.gen(function* () {
    const container = createContainer().register({ logger: asValue(storeCartLogger), configModule: asValue({ projectConfig: { http: {} } }) });
    const scopes = yield* makeStoreCartRequestScopeFactory({ runtime, container });
    const http = createStoreCartHttpHandler({ storeCors: "https://store.test", ...scopes, admitCartRefetchFields: runtime.admitCartRefetchFields,
      resolveCustomerPrincipal: () => options.customer === true ? { actor_id: "cus-create-root", actor_type: "customer",
        auth_identity_id: "auth-cart-http", app_metadata: {}, user_metadata: {} } : undefined });
    const response = yield* Effect.promise(() => http.handle(new Request(`https://store.test${path}`, {
      method: options.value === undefined ? "GET" : "POST", headers: { "content-type": "application/json", "x-publishable-api-key": options.key ?? storeCartToken },
      ...(options.value === undefined ? {} : { body: JSON.stringify(options.value) }),
    })));
    return { status: response.status, value: yield* Effect.promise(() => response.json()) };
  }), options.hooks === undefined ? {} : { hooks: options.hooks });
}

it("creates and refetches the complete native default Cart and reads it after generation reconstruction", async () => {
  const created = await request("/store/carts", { value: {} });
  expect(created.status).toBe(200);
  const cart = body(created.value).cart;
  expect(cart).toMatchObject({ currency_code: "usd", region_id: "reg-create-root", sales_channel_id: "sc-create-root", total: 0,
    subtotal: 0, tax_total: 0, discount_total: 0, items: [], shipping_methods: [], promotions: [], credit_lines: [],
    region: { id: "reg-create-root", countries: [expect.objectContaining({ iso_2: "us" })] } });
  const before = await tested.fixture.snapshot();
  expect(await request(`/store/carts/${cart.id}`)).toEqual(created);
  expect(await request(`/store/carts/${cart.id}?fields=id,currency_code,total`)).toEqual({ status: 200,
    value: { cart: { id: cart.id, currency_code: "usd", total: 0, raw_total: { value: "0", precision: 20 } } } });
  expect(await tested.fixture.snapshot()).toEqual(before);
});

it("preserves real variant, customer-group, tax and Promotion results in the native HTTP Cart graph", async () => {
  const created = await request("/store/carts", { customer: true, value: { items: [{ variant_id: "variant-create-root", quantity: 1 }], promo_codes: ["NATIVE-CART"] } });
  expect(created.status).toBe(200);
  const cart = body(created.value).cart;
  expect(cart).toMatchObject({ customer: { id: "cus-create-root", groups: [{ id: "cusgroup-create-root" }] },
    region: { id: "reg-create-root" }, items: [expect.objectContaining({ variant_id: "variant-create-root", quantity: 1, unit_price: 12.5,
      product: expect.objectContaining({ id: "prod-create-root" }), tax_lines: [expect.objectContaining({ rate: 10 })],
      adjustments: [expect.objectContaining({ promotion_id: "promo-create-root" })] })],
    promotions: [expect.objectContaining({ id: "promo-create-root", code: "NATIVE-CART" })] });
  expect(await request(`/store/carts/${cart.id}`)).toEqual(created);
});

it("refuses key/channel, unsupported response/input and native inventory failures without Cart writes", async () => {
  const before = await tested.fixture.snapshot();
  expect((await request("/store/carts", { value: {}, key: storeCartRevokedToken })).status).toBe(400);
  expect((await request("/store/carts", { value: {}, key: storeCartMultiToken })).status).toBe(400);
  expect((await request("/store/carts", { value: { sales_channel_id: "sc-other" } })).status).toBe(400);
  expect((await request("/store/carts?fields=id,unknown_field", { value: {} })).status).toBe(400);
  expect((await request("/store/carts", { value: { metadata: null } })).status).toBe(400);
  expect((await request("/store/carts", { value: { items: [{ variant_id: "variant-create-root", quantity: 4 }] } })).status).toBe(400);
  expect(await tested.fixture.snapshot()).toEqual(before);
  expect(await request("/store/carts/cart-missing")).toEqual({ status: 404, value: expect.objectContaining({ message: "Cart with id 'cart-missing' not found" }) });
  expect(await tested.fixture.snapshot()).toEqual(before);
});

it("rolls back the complete native graph when the real cartCreated callback fails after writes", async () => {
  const before = await tested.fixture.snapshot();
  let callbacks = 0;
  const failed = await request("/store/carts", { value: { items: [{ variant_id: "variant-create-root", quantity: 1 }] },
    hooks: { cartCreated: () => { callbacks++; throw new Error("late-cart-http-hook-failure"); } } });
  expect(callbacks).toBe(1);
  expect(failed.status).toBe(500);
  expect(await tested.fixture.snapshot()).toEqual(before);
});
