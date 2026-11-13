import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Cause, Effect, Schema } from "effect";
import { asValue, createContainer } from "@medusajs/deps/awilix-portable";
import { createStoreCartHttpHandler } from "@flarex/medusa-http/store-cart";
import * as nativeHosts from "@flarex/persistence-postgres/internal/commerce-native";
import { makeStoreCartRequestScopeFactory, storeCartRequestHostLimits } from "../src/http/store-cart-request";
import { prepareStoreCartRequestFixture } from "./support/store-cart-request-fixture";
import { storeCartLogger, storeCartToken, storeCartRevokedToken, storeCartCompletionSeedRows,
  installStoreCartCompletionFailure } from "./support/store-cart-request-catalog";
import { completionFailureDiagnostic, installCompletionCaptureDiagnostics } from "./support/store-cart-completion-capture-diagnostic";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cartBody = Schema.decodeUnknownSync(Schema.Struct({ cart: Schema.JsonObject }));
const orderBody = Schema.decodeUnknownSync(Schema.Struct({ type: Schema.Literal("order"), order: Schema.JsonObject }));
const collectionBody = Schema.decodeUnknownSync(Schema.Struct({ payment_collection: Schema.JsonObject }));
const object = Schema.decodeUnknownSync(Schema.JsonObject);
const rows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const id = Schema.decodeUnknownSync(Schema.NonEmptyString);
const credential = "store-completion-verified-customer";
type RequestOptions = Readonly<{ value?: unknown; method?: "GET" | "POST"; customer?: boolean; key?: string }>;
type ResponseProof = Readonly<{ status: number; value: unknown; cause?: string }>;
type RequestProof = (path: string, options?: RequestOptions) => Promise<ResponseProof>;
let tested: Awaited<ReturnType<typeof prepareStoreCartRequestFixture>>;
let fault: ReturnType<typeof installStoreCartCompletionFailure>;
let captureDiagnostic: ReturnType<typeof installCompletionCaptureDiagnostics> | undefined;
beforeAll(async () => {
  fault = installStoreCartCompletionFailure();
  if (process.env.FLAREX_COMPLETION_CAPTURE_DIAGNOSTICS === "1") captureDiagnostic = installCompletionCaptureDiagnostics();
  tested = await prepareStoreCartRequestFixture(driver, { additionalRows: storeCartCompletionSeedRows });
}, 600_000);
afterAll(async () => { try { await tested?.fixture.close(); } finally { fault?.restore(); captureDiagnostic?.mockRestore(); } }, 120_000);

function withHttp(work: (request: RequestProof) => Promise<void>) {
  return tested.use(runtime => Effect.gen(function* () {
    const container = createContainer().register({ logger: asValue(storeCartLogger), configModule: asValue({ projectConfig: { http: {} } }) });
    const failures: string[] = [];
    const observe = <A, E, R>(work: Effect.Effect<A, E, R>) => work.pipe(Effect.tapCause(cause =>
      Effect.sync(() => { failures.push(Cause.pretty(cause) + "\nCaptured failure: " + completionFailureDiagnostic(cause)); })));
    const witnessed: typeof runtime = { ...runtime, runWorkflow: (name, value) => observe(runtime.runWorkflow(name, value)),
      remoteQuery: value => observe(runtime.remoteQuery(value)), query: { graph: (value, options) => observe(runtime.query.graph(value, options)) } };
    const scopes = yield* makeStoreCartRequestScopeFactory({ runtime: witnessed, container });
    const http = createStoreCartHttpHandler({ storeCors: "https://store.test", ...scopes,
      admitCartRefetchFields: runtime.admitCartRefetchFields, admitShippingOptionFields: runtime.admitShippingOptionFields,
      admitPaymentCollectionFields: runtime.admitPaymentCollectionFields, admitOrderRefetchFields: runtime.admitOrderRefetchFields,
      resolveCustomerPrincipal: request => request.headers.get("x-proof-completion-customer") === credential
        ? { actor_id: "cus-create-root", actor_type: "customer", auth_identity_id: "auth-completion-http", app_metadata: {}, user_metadata: {} } : undefined });
    const request: RequestProof = async (path, options = {}) => {
      failures.length = 0;
      const response = await http.handle(new Request(`https://store.test${path}`, {
        method: options.method ?? (options.value === undefined ? "GET" : "POST"),
        headers: { "content-type": "application/json", "x-publishable-api-key": options.key ?? storeCartToken,
          ...(options.customer ? { "x-proof-completion-customer": credential } : { "x-customer-id": "cus-create-root" }) },
        ...(options.value === undefined ? {} : { body: JSON.stringify(options.value) }),
      }));
      return { status: response.status, value: await response.json(), ...(failures.length ? { cause: failures.join("\n") } : {}) };
    };
    return yield* Effect.promise(() => work(request));
  }));
}
function ok(response: ResponseProof) {
  expect(response.status, JSON.stringify(response)).toBe(200);
  return response.value;
}
async function payable(request: RequestProof, options: Readonly<{ customer?: boolean; sessionData?: Record<string, unknown> }> = {}) {
  const customer = options.customer === true;
  const cart = cartBody(ok(await request("/store/carts", { customer, value: {
    email: "completion-guest@example.com", items: [{ variant_id: "variant-http-shipping", quantity: 1 }],
    shipping_address: { first_name: "Native", last_name: "Checkout", address_1: "10 Checkout Road", city: "Native destination", country_code: "us" },
    billing_address: { first_name: "Native", last_name: "Billing", address_1: "11 Billing Road", city: "Native billing", country_code: "us" },
  } }))).cart;
  if (customer) expect(cart.customer_id).toBe("cus-create-root");
  else {
    expect(id(cart.customer_id)).not.toBe("cus-create-root");
    expect((await tested.fixture.readRows("customer")).find(row => row.id === cart.customer_id)).toMatchObject({ has_account: false });
  }
  const cartId = id(cart.id);
  const shipped = cartBody(ok(await request(`/store/carts/${cartId}/shipping-methods`, { customer,
    value: { option_id: "so-http-shipping-standard", data: { delivery: "completion" } } }))).cart;
  expect(shipped).toMatchObject({ total: 14.85, subtotal: 17.5, tax_total: 1.35, discount_total: 4.4,
    items: [{ tax_lines: [{ code: "NATIVE-US", rate: 10 }], adjustments: [{ code: "NATIVE-CART", amount: 1 }] }],
    shipping_methods: [{ amount: 5, tax_lines: [{ rate: 10 }], adjustments: [{ code: "HTTP-COMPLETION-SHIPPING", amount: 3 }] }] });
  const collection = collectionBody(ok(await request("/store/payment-collections", { customer, value: { cart_id: cartId } }))).payment_collection;
  const collectionId = id(collection.id);
  const initialized = collectionBody(ok(await request(`/store/payment-collections/${collectionId}/payment-sessions`, { customer,
    value: { provider_id: "pp_system_default", data: options.sessionData ?? {} } }))).payment_collection;
  const sessions = rows(initialized.payment_sessions);
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toMatchObject({ status: "pending", amount: 14.85 });
  if (!customer) expect(object(sessions[0]?.context)).not.toHaveProperty("customer");
  return { cartId, collectionId, sessionId: id(sessions[0]?.id) };
}
const completePath = (cartId: string) => `/store/carts/${cartId}/complete`;
function expectFailedRoot(before: Awaited<ReturnType<typeof tested.fixture.inventory>>, after: typeof before) {
  const keys = new Set(before.outcomes.map(outcome => outcome.value.key));
  const failures = after.outcomes.filter(outcome => !keys.has(outcome.value.key));
  expect(failures).toEqual([expect.objectContaining({ value: expect.objectContaining({ kind: "nativeRoot", state: "failed" }) })]);
  expect(after).toEqual({ ...before, outcomes: [...before.outcomes, ...failures] });
}

it("accounts every prepared read and workflow host in the one named Store budget", async () => {
  const reads = vi.spyOn(nativeHosts, "makeCommerceNativeReadHost"), roots = vi.spyOn(nativeHosts, "makeAtomicCommerceNativeHost");
  try {
    await tested.use(() => Effect.void);
    expect(roots).toHaveBeenCalledTimes(12);
    expect(reads.mock.calls.length + roots.mock.calls.length).toBe(storeCartRequestHostLimits.maximumHosts);
    expect(storeCartRequestHostLimits.maximumPreparedBytes).toBe(8 * 1024 * 1024);
  } finally { reads.mockRestore(); roots.mockRestore(); }
});

it("admits the complete Order projection and publishable key before starting checkout", async () => {
  const before = await tested.fixture.snapshot();
  await withHttp(async request => {
    for (const [path, options] of [
      [completePath("missing") + "?fields=id,unsupported", { value: {} }],
      [completePath("missing"), { value: {}, key: storeCartRevokedToken }],
    ] as const) expect((await request(path, options)).status).toBe(400);
  });
  expect(await tested.fixture.snapshot()).toEqual(before);
});

it("completes a populated guest Cart and returns the native default Order graph with one atomic durable publication", async () => {
  await withHttp(async request => {
    const input = await payable(request), before = await tested.fixture.snapshot();
    const order = orderBody(ok(await request(completePath(input.cartId), { value: {} }))).order;
    const orderId = id(order.id);
    expect(order).toMatchObject({ status: "pending", currency_code: "usd", email: "completion-guest@example.com", region_id: "reg-create-root",
      total: 14.85, subtotal: 17.5, tax_total: 1.35, discount_total: 4.4, shipping_subtotal: 5, shipping_total: 2.2,
      items: [{ variant_id: "variant-http-shipping", product_id: "prod-create-root", quantity: 1, unit_price: 12.5,
        variant: { id: "variant-http-shipping", product: { id: "prod-create-root" } },
        tax_lines: [{ code: "NATIVE-US", rate: 10 }], adjustments: [{ code: "NATIVE-CART", amount: 1 }], detail: { quantity: 1 } }],
      shipping_methods: [{ shipping_option_id: "so-http-shipping-standard", amount: 5,
        tax_lines: [{ rate: 10 }], adjustments: [{ code: "HTTP-COMPLETION-SHIPPING", amount: 3 }] }],
      shipping_address: { city: "Native destination" }, billing_address: { city: "Native billing" },
      payment_collections: [{ id: input.collectionId, amount: 14.85, status: "authorized" }], credit_lines: [] });
    for (const field of ["display_id", "summary", "created_at", "updated_at", "original_total", "item_total", "shipping_tax_total", "credit_line_total"])
      expect(order).toHaveProperty(field);
    const settled = await tested.fixture.snapshot(), keys = new Set(before.outcomes.map(outcome => outcome.value.key));
    const outcomes = settled.outcomes.filter(outcome => !keys.has(outcome.value.key));
    expect(outcomes).toEqual([expect.objectContaining({ value: expect.objectContaining({ kind: "nativeRoot", state: "committed" }) })]);
    const timestamp = outcomes[0]?.timestamp;
    for (const sourceName of ["cart", "order", "payment", "inventory", "promotion", "order_cart_links", "order_payment_collection_links", "order_promotion_links"]) {
      const tables = new Set(tested.catalog.sources.find(source => source.name === sourceName)?.definition.tables.map(table => table.name));
      expect(settled.revisions.some(row => tables.has(row.table) && row.timestamp === timestamp), sourceName).toBe(true);
    }
    const durable = await tested.fixture.readRows();
    const cartTable = tested.catalog.sources.find(source => source.name === "cart")?.definition.tables
      .find(table => (table.localName ?? table.name) === "cart")?.name;
    const sessionTable = tested.catalog.sources.find(source => source.name === "payment")?.definition.tables
      .find(table => (table.localName ?? table.name) === "payment_session")?.name;
    // Cart Promotion preimages intentionally reuse the Cart primary key. Keep
    // the declared table identity when observing committed business records.
    const carts = settled.rows.filter(row => row.table === cartTable && row.value.id === input.cartId);
    const sessions = settled.rows.filter(row => row.table === sessionTable && row.value.id === input.sessionId);
    expect(carts).toEqual([expect.objectContaining({ value: expect.objectContaining({ completed_at: expect.any(String) }) })]);
    expect(sessions).toEqual([expect.objectContaining({ value: expect.objectContaining({ status: "authorized", authorized_at: expect.any(String) }) })]);
    expect(durable.filter(row => row.payment_session_id === input.sessionId)).toHaveLength(1);
    expect(durable.filter(row => row.order_id === orderId && row.cart_id === input.cartId)).toHaveLength(1);
    expect(durable.filter(row => row.order_id === orderId && row.payment_collection_id === input.collectionId)).toHaveLength(1);
    expect(durable.filter(row => row.order_id === orderId && typeof row.promotion_id === "string")).toHaveLength(2);
    expect(durable.find(row => row.id === "promo-http-completion-shipping")).toMatchObject({ used: 1 });
    expect(durable.filter(row => row.inventory_item_id === "iitem-http-shipping" && typeof row.line_item_id === "string")).toHaveLength(1);
    expect(settled.events.filter(event => event.envelope.contract === "order.placed")).toHaveLength(1);
    expect(orderBody(ok(await request(completePath(input.cartId), { value: {} }))).order).toEqual(order);
    const repeated = await tested.fixture.snapshot();
    expect({ ...repeated, outcomes: [] }).toEqual({ ...settled, outcomes: [] });
  });
});

it("rolls back all source revisions and pending events when native authorization refuses the Session", async () => {
  await withHttp(async request => {
    const input = await payable(request, { sessionData: { refuse_completion_authorization: true } });
    const before = await tested.fixture.inventory(), refusals = fault.refusals();
    const response = await request(completePath(input.cartId), { value: {} });
    expect(response.status, JSON.stringify(response)).toBe(400);
    expect(fault.refusals()).toBe(refusals + 1);
    expect(response.value).toMatchObject({ type: "not_allowed", message: `Session: ${input.sessionId} was not authorized with the provider.` });
    expectFailedRoot(before, await tested.fixture.inventory());
  });
});

it("rolls back late native authorization after all other checkout writes, then completes the same verified Customer Cart", async () => {
  const log = vi.spyOn(storeCartLogger, "error").mockImplementation(() => undefined);
  let completedCartId = "", completedOrderId = "";
  try {
    await withHttp(async request => {
      const input = await payable(request, { customer: true, sessionData: { fail_completion_after_authorization: true } });
      const before = await tested.fixture.inventory(), authorizations = fault.authorizations();
      const response = await request(completePath(input.cartId), { value: {}, customer: true });
      expect(response.status, JSON.stringify(response)).toBe(500);
      expect(fault.authorizations()).toBe(authorizations + 1);
      expectFailedRoot(before, await tested.fixture.inventory());
      ok(await request(`/store/payment-collections/${input.collectionId}/payment-sessions`, { customer: true,
        value: { provider_id: "pp_system_default", data: { retry_after_proven_failure: true } } }));
      const order = orderBody(ok(await request(completePath(input.cartId), { value: {}, customer: true }))).order;
      expect(order).toMatchObject({ total: 14.85,
        shipping_address: { city: "Native destination" }, billing_address: { city: "Native billing" } });
      expect((await tested.fixture.readRows("order")).find(row => row.id === order.id)).toMatchObject({ customer_id: "cus-create-root" });
      completedCartId = input.cartId; completedOrderId = id(order.id);
    });
    const committed = await tested.fixture.snapshot();
    await tested.fixture.run(tested.fixture.recover);
    await withHttp(async request => {
      expect(orderBody(ok(await request(completePath(completedCartId) + "?fields=id,total", { value: {}, customer: true }))).order)
        .toEqual({ id: completedOrderId, total: 14.85 });
    });
    expect({ ...await tested.fixture.snapshot(), outcomes: [] }).toEqual({ ...committed, outcomes: [] });
  } finally { log.mockRestore(); }
});
