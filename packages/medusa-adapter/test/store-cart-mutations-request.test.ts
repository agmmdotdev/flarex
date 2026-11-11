import { afterAll, beforeAll, expect, it } from "vitest";
import { Effect, Result, Schema } from "effect";
import { asValue, createContainer } from "@medusajs/deps/awilix-portable";
import { createStoreCartHttpHandler } from "@flarex/medusa-http/store-cart";
import { makeStoreCartRequestScopeFactory } from "../src/http/store-cart-request";
import { prepareCartMutationWorkflows, type CartMutationHooks } from "../src/workflows/cart/mutations";
import { captureInstalledWorkflowModules } from "../src/workflow/host";
import { cartCreationModuleNames } from "../src/workflows/cart/creation-graph";
import { prepareStoreCartRequestFixture } from "./support/store-cart-request-fixture";
import { storeCartLogger, storeCartToken, storeCartRevokedToken, storeCartMutationSeedRows } from "./support/store-cart-request-catalog";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const decodeCart = Schema.decodeUnknownSync(Schema.Struct({ cart: Schema.JsonObject }));
const decodeId = Schema.decodeUnknownSync(Schema.NonEmptyString);
const decodeItems = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
let tested: Awaited<ReturnType<typeof prepareStoreCartRequestFixture>>;
beforeAll(async () => { tested = await prepareStoreCartRequestFixture(driver, { additionalRows: storeCartMutationSeedRows }); }, 600_000);
afterAll(async () => { await tested?.fixture.close(); }, 60_000);

async function request(path: string, options: Readonly<{ method?: "GET" | "POST" | "DELETE"; value?: unknown; key?: string; hooks?: CartMutationHooks }> = {}) {
  return tested.use(runtime => Effect.gen(function* () {
    const container = createContainer().register({ logger: asValue(storeCartLogger), configModule: asValue({ projectConfig: { http: {} } }) });
    const scopes = yield* makeStoreCartRequestScopeFactory({ runtime, container });
    const http = createStoreCartHttpHandler({ storeCors: "https://store.test", ...scopes, admitCartRefetchFields: runtime.admitCartRefetchFields });
    const response = yield* Effect.promise(() => http.handle(new Request(`https://store.test${path}`, {
      method: options.method ?? (options.value === undefined ? "GET" : "POST"),
      headers: { "content-type": "application/json", "x-publishable-api-key": options.key ?? storeCartToken },
      ...(options.value === undefined ? {} : { body: JSON.stringify(options.value) }),
    })));
    return { status: response.status, value: yield* Effect.promise(() => response.json()) };
  }), options.hooks === undefined ? {} : { mutationHooks: options.hooks });
}
async function create(items: readonly unknown[] = []) {
  const response = await request("/store/carts", { value: { items } });
  expect(response.status, JSON.stringify(response.value)).toBe(200);
  return decodeCart(response.value).cart;
}
const cartId = (cart: typeof Schema.JsonObject.Type) => decodeId(cart.id);

it("updates native Cart/Customer/Addresses and forces genuine Region, pricing and Tax refresh", async () => {
  const cart = await create([{ variant_id: "variant-create-root", quantity: 1 }]), id = cartId(cart);
  const updated = await request(`/store/carts/${id}`, { value: { email: "native-cart@example.com", metadata: { edited: true },
    shipping_address: { address_1: "Native address", city: "Yangon", country_code: "us" }, billing_address: { country_code: "us", city: "Mandalay" } } });
  expect(updated.status, JSON.stringify(updated.value)).toBe(200);
  expect(decodeCart(updated.value).cart).toMatchObject({ id, email: "native-cart@example.com", metadata: { edited: true },
    customer: { id: "cus-create-root" }, shipping_address: { address_1: "Native address", city: "Yangon", country_code: "us" },
    billing_address: { city: "Mandalay", country_code: "us" } });
  const billing = Schema.decodeUnknownSync(Schema.JsonObject)(decodeCart(updated.value).cart.billing_address);
  const cleared = await request(`/store/carts/${id}`, { value: { billing_address: { id: decodeId(billing.id), city: null } } });
  expect(cleared.status, JSON.stringify(cleared.value)).toBe(200);
  expect(decodeCart(cleared.value).cart.billing_address).toMatchObject({ id: billing.id, city: null, country_code: "us" });
  const changedRegion = await request(`/store/carts/${id}`, { value: { region_id: "reg-cart-update" } });
  expect(changedRegion.status, JSON.stringify(changedRegion.value)).toBe(200);
  expect(decodeCart(changedRegion.value).cart).toMatchObject({ region_id: "reg-cart-update", currency_code: "usd",
    region: { id: "reg-cart-update" }, shipping_address: { country_code: "gb" },
    items: [{ unit_price: 12.5, tax_lines: [{ code: "NATIVE-GB", rate: 5 }] }] });
  const events = (await tested.fixture.snapshot()).events.filter(event => !event.envelope.internal && event.envelope.contract === "cart.region_updated");
  expect(events).toContainEqual(expect.objectContaining({ envelope: expect.objectContaining({ message: expect.objectContaining({ data: { id } }) }) }));
  const nullable = await request(`/store/carts/${id}`, { value: { metadata: null } });
  expect(nullable.status, JSON.stringify(nullable.value)).toBe(200);
  expect(decodeCart(nullable.value).cart.metadata).toBeNull();
});

it("adds and merges native items by Variant and metadata, and refuses insufficient Inventory atomically", async () => {
  const id = cartId(await create());
  const path = `/store/carts/${id}/line-items`;
  const first = await request(path, { value: { variant_id: "variant-create-root", quantity: 1, metadata: { group: "same" } } });
  expect(first.status, JSON.stringify(first.value)).toBe(200);
  const line = decodeItems(decodeCart(first.value).cart.items)[0];
  if (line === undefined) throw new Error("Missing native added Line Item");
  const merged = await request(path, { value: { variant_id: "variant-create-root", quantity: 1, metadata: { group: "same" } } });
  expect(merged.status, JSON.stringify(merged.value)).toBe(200);
  expect(decodeCart(merged.value).cart).toMatchObject({ subtotal: 25, items: [{ id: line.id, quantity: 2, unit_price: 12.5,
    tax_lines: [{ rate: 10 }], adjustments: [{ code: "NATIVE-CART" }] }] });
  const distinct = await request(path, { value: { variant_id: "variant-create-root", quantity: 1, metadata: { group: "different" } } });
  expect(distinct.status, JSON.stringify(distinct.value)).toBe(200);
  expect(decodeItems(decodeCart(distinct.value).cart.items)).toHaveLength(2);
  const before = await tested.fixture.snapshot();
  const refused = await request(path, { value: { variant_id: "variant-create-root", quantity: 4 } });
  expect(refused.status).toBe(400);
  expect(await tested.fixture.snapshot()).toEqual(before);
});

it("updates native quantity and metadata, then removes quantity zero with both native events", async () => {
  const cart = await create([{ variant_id: "variant-create-root", quantity: 1 }]), id = cartId(cart);
  const line = decodeItems(cart.items)[0];
  if (line === undefined) throw new Error("Missing native Cart Line Item");
  const path = `/store/carts/${id}/line-items/${decodeId(line.id)}`;
  const updated = await request(path, { value: { quantity: 2, metadata: { quantity_updated: true } } });
  expect(updated.status, JSON.stringify(updated.value)).toBe(200);
  expect(decodeCart(updated.value).cart).toMatchObject({ subtotal: 25, items: [{ id: line.id, quantity: 2, metadata: { quantity_updated: true }, unit_price: 12.5 }] });
  const before = await tested.fixture.snapshot();
  const removed = await request(path, { value: { quantity: 0 } });
  expect(removed.status, JSON.stringify(removed.value)).toBe(200);
  expect(decodeCart(removed.value).cart.items).toEqual([]);
  const after = await tested.fixture.snapshot();
  expect(after.events.filter(event => !event.envelope.internal && event.envelope.contract === "cart.updated")).toHaveLength(
    before.events.filter(event => !event.envelope.internal && event.envelope.contract === "cart.updated").length + 2);
  expect((await tested.fixture.readRows("cart", [decodeId(line.id)]))[0]).toMatchObject({ id: line.id, deleted_at: expect.any(String) });
});

it("preserves native POST membership refusal and ID-only DELETE across Cart identities", async () => {
  const parent = await create(), foreign = await create([{ variant_id: "variant-create-root", quantity: 1 }]);
  const line = decodeItems(foreign.items)[0];
  if (line === undefined) throw new Error("Missing foreign native Line Item");
  const path = `/store/carts/${cartId(parent)}/line-items/${decodeId(line.id)}`;
  const before = await tested.fixture.snapshot();
  expect((await request(path, { value: { quantity: 2 } })).status).toBe(404);
  expect(await tested.fixture.snapshot()).toEqual(before);
  const removed = await request(path, { method: "DELETE" });
  expect(removed.status, JSON.stringify(removed.value)).toBe(200);
  expect(removed.value).toMatchObject({ id: line.id, object: "line-item", deleted: true, parent: { id: parent.id, items: [] } });
  expect(decodeCart((await request(`/store/carts/${cartId(foreign)}`)).value).cart.items).toEqual([]);
});

it("refuses response/key/body profiles before writes and aborts completed-Cart deletion after native pending work", async () => {
  const cart = await create(), id = cartId(cart), before = await tested.fixture.snapshot();
  expect((await request(`/store/carts/${id}?fields=id,unsupported`, { value: { metadata: { bad: true } } })).status).toBe(400);
  expect((await request(`/store/carts/${id}/line-items?fields=id,unsupported`, { value: { variant_id: "variant-create-root", quantity: 1 } })).status).toBe(400);
  expect((await request(`/store/carts/cart-http-completed/line-items/line-http-completed?fields=id,unsupported`, { method: "DELETE" })).status).toBe(400);
  expect((await request(`/store/carts/${id}`, { key: storeCartRevokedToken, value: {} })).status).toBe(400);
  expect((await request(`/store/carts/${id}`, { value: { customer_id: "forged" } })).status).toBe(400);
  expect((await request("/store/carts/cart-missing", { value: {} })).status).toBe(404);
  // The pinned HTTP schema admits a string, but its native update step uses
  // the `in` operator on truthy address entries and fails before module update.
  const address = Schema.decodeUnknownSync(Schema.JsonObject)(cart.shipping_address);
  expect((await request(`/store/carts/${id}`, { value: { shipping_address: decodeId(address.id) } })).status).toBe(500);
  expect((await request(`/store/carts/cart-http-completed/line-items/line-http-completed`, { method: "DELETE" })).status).toBe(400);
  expect(await tested.fixture.snapshot()).toEqual(before);
  const missing = await request("/store/carts/cart-missing/line-items/line-missing", { method: "DELETE" });
  expect(missing.status).toBe(500);
  expect(await tested.fixture.snapshot()).toEqual(before);
});

it("rolls back new Customer, Address and Cart changes after the genuine late cartUpdated hook", async () => {
  const id = cartId(await create()), before = await tested.fixture.snapshot(); let callbacks = 0;
  const failed = await request(`/store/carts/${id}`, { value: { email: "late-cart-update@example.com", metadata: { late: true },
    billing_address: { country_code: "us", city: "Late write" } }, hooks: { cartUpdated: () => { callbacks++; throw new Error("late-native-cart-update"); } } });
  expect(callbacks).toBe(1); expect(failed.status).toBe(500);
  expect(await tested.fixture.snapshot()).toEqual(before);
});

it("recovers the original mutation after lost acknowledgement and replays with no second callback or event", async () => {
  const id = cartId(await create()); let callbacks = 0;
  const modules = Result.getOrThrow(captureInstalledWorkflowModules(Object.fromEntries(cartCreationModuleNames.map(name =>
    [name, { module: tested.catalog.runtimes.workflows[name], nativeStorage: tested.fixture.source(name) }])), cartCreationModuleNames));
  const configuration = { execution: tested.fixture.execution, modules, salesChannelRead: tested.catalog.runtimes.salesChannelRead,
    link: tested.catalog.runtimes.link, logger: tested.catalog.runtimes.logger, revision: "3".repeat(64),
    subscribers: [{ id: "native-cart-mutation-replay", revision: "4".repeat(64) }], hooks: { cartUpdated: () => { callbacks++; } } };
  const roots = await Effect.runPromise(prepareCartMutationWorkflows(configuration));
  try {
    const key = roots.updateCart.newRequestKey(), fault = tested.fixture.loseNextNativeRootAcknowledgement();
    expect(await Effect.runPromise(roots.updateCart.run(key, { id, metadata: { replay: true } }))).toBeNull();
    expect(fault).toMatchObject({ armed: false, failures: 1 }); expect(callbacks).toBe(1);
    const before = await tested.fixture.snapshot();
    expect(await Effect.runPromise(roots.updateCart.run(key, { id, metadata: { replay: true } }))).toBeNull();
    expect(callbacks).toBe(1); expect(await tested.fixture.snapshot()).toEqual(before);
  } finally { for (const root of Object.values(roots)) await Effect.runPromise(root.close); }
});
