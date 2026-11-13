import { afterAll, beforeAll, expect, it } from "vitest";
import { Cause, Effect, Schema } from "effect";
import { asValue, createContainer } from "@medusajs/deps/awilix-portable";
import { createStoreCartHttpHandler } from "@flarex/medusa-http/store-cart";
import { makeStoreCartRequestScopeFactory } from "../src/http/store-cart-request";
import { prepareStoreCartRequestFixture } from "./support/store-cart-request-fixture";
import { storeCartLogger, storeCartToken, storeCartRevokedToken, storeOrderHttpSeedRows, storeOrderIds,
  storeOrderSpecialId, storeOrderEmptyId, storeOrderOtherId, storeOrderDraftId, storeOrderDeletedId } from "./support/store-cart-request-catalog";
import { completionFailureDiagnostic } from "./support/store-cart-completion-capture-diagnostic";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const orderBody = Schema.decodeUnknownSync(Schema.Struct({ order: Schema.JsonObject }));
const cartBody = Schema.decodeUnknownSync(Schema.Struct({ cart: Schema.JsonObject }));
const pageBody = Schema.decodeUnknownSync(Schema.Struct({ orders: Schema.Array(Schema.JsonObject), count: Schema.Int, offset: Schema.Int, limit: Schema.Int }));
const rows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
type Options = Readonly<{ customer?: "owner" | "other"; key?: string }>;
type Response = Readonly<{ status: number; value: unknown; cause?: string }>;
let tested: Awaited<ReturnType<typeof prepareStoreCartRequestFixture>>;
beforeAll(async () => {
  try { tested = await prepareStoreCartRequestFixture(driver, { additionalRows: storeOrderHttpSeedRows }); }
  catch (cause) { console.error("Store Order fixture proof", completionFailureDiagnostic(cause)); throw cause; }
}, 600_000);
afterAll(async () => { await tested?.fixture.close(); }, 120_000);

function withHttp(work: (request: (path: string, options?: Options) => Promise<Response>) => Promise<void>) {
  return tested.use(runtime => Effect.gen(function* () {
    const failures: string[] = [];
    const witnessed: typeof runtime = { ...runtime, runWorkflow: (name, value) => runtime.runWorkflow(name, value).pipe(Effect.tapCause(cause =>
      Effect.sync(() => { failures.push(Cause.pretty(cause) + "\n" + completionFailureDiagnostic(cause)); }))) };
    const scopes = yield* makeStoreCartRequestScopeFactory({ runtime: witnessed,
      container: createContainer().register({ logger: asValue(storeCartLogger), configModule: asValue({ projectConfig: { http: {} } }) }) });
    const http = createStoreCartHttpHandler({ storeCors: "https://store.test", ...scopes,
      admitCartRefetchFields: runtime.admitCartRefetchFields, admitOrderRefetchFields: runtime.admitOrderRefetchFields,
      admitOrderReadFields: runtime.admitOrderReadFields,
      resolveCustomerPrincipal: request => {
        const credential = request.headers.get("x-proof-store-order-customer");
        return credential === "verified-owner" || credential === "verified-other" ? {
          actor_id: credential === "verified-owner" ? "cus-create-root" : "cus-store-other", actor_type: "customer",
          auth_identity_id: "auth-store-order", app_metadata: {}, user_metadata: {},
        } : undefined;
      } });
    return yield* Effect.promise(() => work(async (path, options = {}) => {
      failures.length = 0;
      const response = await http.handle(new Request("https://store.test" + path, { headers: {
        "x-publishable-api-key": options.key ?? storeCartToken,
        ...(options.customer === undefined ? { "x-customer-id": "cus-create-root" } : { "x-proof-store-order-customer": "verified-" + options.customer }),
      } }));
      return { status: response.status, value: await response.json(), ...(failures.length ? { cause: failures.join("\n") } : {}) };
    }));
  }));
}
const ok = (response: Response) => { expect(response.status, JSON.stringify(response)).toBe(200); return response.value; };

it("preserves native public detail, full default Order presentation and genuine forced status relations", async () => {
  const before = await tested.fixture.inventory();
  await withHttp(async request => {
    const order = orderBody(ok(await request(`/store/orders/${storeOrderSpecialId}`))).order;
    expect(order).toMatchObject({ id: storeOrderSpecialId, total: 10, currency_code: "usd", payment_status: "captured", fulfillment_status: "delivered",
      items: [{ quantity: 1, unit_price: 10, detail: { fulfilled_quantity: 1 }, variant: { id: "variant-create-root", product: { id: "prod-create-root" } } }] });
    for (const field of ["summary", "display_id", "created_at", "updated_at", "original_total", "tax_total", "shipping_methods", "credit_lines"]) expect(order).toHaveProperty(field);
    expect(rows(order.payment_collections)).toHaveLength(2);
    expect(rows(order.fulfillments)).toHaveLength(2);
    const rich = orderBody(ok(await request(`/store/orders/${storeOrderSpecialId}?fields=id,*fulfillments,*fulfillments.items,*fulfillments.labels,*fulfillments.delivery_address`))).order;
    expect(rows(rich.fulfillments).find(row => row.id === `ful-${storeOrderSpecialId}`)).toMatchObject({
      items: [{ quantity: 1, sku: "store-order-sku" }], labels: [{ tracking_number: "STORE-NATIVE-1" }], delivery_address: { city: "Native delivery" } });
    expect(orderBody(ok(await request(`/store/orders/${storeOrderSpecialId}?fields=id`))).order)
      .toMatchObject({ id: storeOrderSpecialId, payment_status: "captured", fulfillment_status: "delivered" });
    expect(orderBody(ok(await request(`/store/orders/${storeOrderSpecialId}?fields=id,payment_status,fulfillment_status`))).order)
      .toMatchObject({ id: storeOrderSpecialId, payment_status: "captured", fulfillment_status: "delivered" });
    expect(orderBody(ok(await request(`/store/orders/${storeOrderOtherId}?fields=id`))).order.id).toBe(storeOrderOtherId);
    expect(orderBody(ok(await request(`/store/orders/${storeOrderEmptyId}?fields=id`))).order)
      .toMatchObject({ id: storeOrderEmptyId, payment_status: "not_paid", fulfillment_status: "not_fulfilled" });
  });
  expect(await tested.fixture.inventory()).toEqual(before);
});

it("returns the native fifty-order default page and genuine offset/count without read-side durable effects", async () => {
  const before = await tested.fixture.inventory();
  await withHttp(async request => {
    const first = pageBody(ok(await request("/store/orders", { customer: "owner" })));
    expect(first).toMatchObject({ count: 53, offset: 0, limit: 50 });
    expect(first.orders.map(row => row.id)).toEqual(storeOrderIds.slice(0, 50));
    expect(first.orders[0]).toMatchObject({ payment_status: "captured", fulfillment_status: "delivered" });
    expect(first.orders[1]).toMatchObject({ payment_status: "authorized", fulfillment_status: "shipped" });
    expect(first.orders.every(row => row.payment_collections === undefined && row.fulfillments === undefined)).toBe(true);
    const explicit = pageBody(ok(await request("/store/orders?fields=id,payment_status,fulfillment_status&limit=1", { customer: "owner" })));
    expect(explicit).toMatchObject({ count: 53, offset: 0, limit: 1, orders: [{ id: storeOrderSpecialId, status: "pending", version: 1,
      payment_status: "captured", fulfillment_status: "delivered", items: [{ id: `item-${storeOrderSpecialId}`, quantity: 1, detail: { fulfilled_quantity: 1 } }] }] });
    expect(explicit.orders).toHaveLength(1);
    expect(explicit.orders[0]).not.toHaveProperty("payment_collections");
    expect(explicit.orders[0]).not.toHaveProperty("fulfillments");
    const last = pageBody(ok(await request("/store/orders?offset=50&fields=id", { customer: "owner" })));
    expect(last).toMatchObject({ count: 53, offset: 50, limit: 50 });
    expect(last.orders.map(row => row.id)).toEqual(storeOrderIds.slice(50));
    expect(last.orders[0]).toMatchObject({ payment_status: "authorized", fulfillment_status: "shipped" });
    expect(last.orders[2]).toMatchObject({ payment_status: "not_paid", fulfillment_status: "not_fulfilled" });
    const reverse = pageBody(ok(await request("/store/orders?limit=2&offset=1&order=-id&fields=id", { customer: "owner" })));
    expect(reverse).toMatchObject({ count: 53, offset: 1, limit: 2 });
    expect(reverse.orders.map(row => row.id)).toEqual([storeOrderIds[51], storeOrderIds[50]]);
    const other = pageBody(ok(await request("/store/orders?fields=id", { customer: "other" })));
    expect(other).toMatchObject({ count: 1, orders: [{ id: storeOrderOtherId }] });
  });
  expect(await tested.fixture.inventory()).toEqual(before);
});

it("keeps fixed Customer and draft filters conjunctive across native recursive filters", async () => {
  const before = await tested.fixture.inventory();
  await withHttp(async request => {
    const filtered = pageBody(ok(await request("/store/orders?status=pending&fields=id", { customer: "owner" })));
    expect(filtered.count).toBe(27);
    const query = new URLSearchParams({ fields: "id" });
    query.set("$or[0][id]", storeOrderOtherId); query.set("$or[1][id]", storeOrderDraftId); query.set("$or[2][id]", storeOrderSpecialId);
    query.set("$and[0][status]", "pending");
    const result = pageBody(ok(await request("/store/orders?" + query, { customer: "owner" })));
    expect(result).toMatchObject({ count: 1, orders: [{ id: storeOrderSpecialId }] });
    const empty = pageBody(ok(await request("/store/orders?id=missing&fields=id", { customer: "owner" })));
    expect(empty).toMatchObject({ count: 0, orders: [] });
  });
  expect(await tested.fixture.inventory()).toEqual(before);
});

it("preserves native authentication, missing/draft refusal and projection admission with no durable changes", async () => {
  const before = await tested.fixture.inventory();
  await withHttp(async request => {
    expect((await request("/store/orders")).status).toBe(401);
    expect((await request(`/store/orders/${storeOrderSpecialId}`, { key: storeCartRevokedToken })).status).toBe(400);
    for (const id of ["missing", storeOrderDraftId, storeOrderDeletedId]) expect((await request(`/store/orders/${id}`)).status).toBe(404);
    for (const path of [`/store/orders/${storeOrderSpecialId}?fields=id,unsupported`, "/store/orders?fields=id,unsupported", "/store/orders?limit=51", "/store/orders?customer_id=cus-store-other"])
      expect((await request(path, { customer: "owner" })).status).toBe(400);
  });
  expect(await tested.fixture.inventory()).toEqual(before);
});

it("retains Order reads after host recovery and the existing Cart retrieval graph", async () => {
  const before = await tested.fixture.inventory();
  await tested.fixture.run(tested.fixture.recover);
  await withHttp(async request => {
    expect(orderBody(ok(await request(`/store/orders/${storeOrderSpecialId}?fields=id`))).order)
      .toMatchObject({ id: storeOrderSpecialId, payment_status: "captured", fulfillment_status: "delivered" });
    expect((await request("/store/carts/missing")).status).toBe(404);
    expect(cartBody(ok(await request("/store/carts/cart-store-order-compat"))).cart).toMatchObject({
      id: "cart-store-order-compat", total: 12.5, customer: { id: "cus-create-root", groups: [{ id: "cusgroup-create-root" }] },
      items: [{ variant_id: "variant-create-root", quantity: 1, unit_price: 12.5, product: { id: "prod-create-root" } }],
    });
  });
  expect(await tested.fixture.inventory()).toEqual(before);
});
