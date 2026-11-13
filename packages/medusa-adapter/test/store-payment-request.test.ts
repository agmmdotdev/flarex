import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { asValue, createContainer } from "@medusajs/deps/awilix-portable";
import { createStoreCartHttpHandler } from "@flarex/medusa-http/store-cart";
import { PaymentModuleService } from "@medusajs/payment/services";
import { SystemPaymentProvider } from "@medusajs/payment/providers/system";
import { makeStoreCartRequestScopeFactory } from "../src/http/store-cart-request";
import { prepareStorePaymentWorkflows } from "../src/workflows/payment/store";
import { prepareStoreCartRequestFixture } from "./support/store-cart-request-fixture";
import { storeCartLogger, storeCartToken, storeCartRevokedToken, storePaymentHttpSeedRows } from "./support/store-cart-request-catalog";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const decodeCollection = Schema.decodeUnknownSync(Schema.Struct({ payment_collection: Schema.JsonObject }));
const decodeCart = Schema.decodeUnknownSync(Schema.Struct({ cart: Schema.JsonObject }));
const decodeSingleSession = Schema.decodeUnknownSync(Schema.Struct({ payment_sessions: Schema.Tuple([Schema.JsonObject]) }));
const decodeId = Schema.decodeUnknownSync(Schema.NonEmptyString);
const decodeObject = Schema.decodeUnknownSync(Schema.JsonObject);
const provider = "pp_system_default";
const collectionPath = "/store/payment-collections";
const sessionPath = (id: string) => `${collectionPath}/${id}/payment-sessions`;
const customerCredential = "verified-payment-customer";
let tested: Awaited<ReturnType<typeof prepareStoreCartRequestFixture>>;
beforeAll(async () => { tested = await prepareStoreCartRequestFixture(driver, { additionalRows: storePaymentHttpSeedRows }); }, 600_000);
afterAll(async () => { await tested?.fixture.close(); }, 60_000);

type RequestOptions = Readonly<{ value?: unknown; method?: "GET" | "POST"; key?: string; credential?: string; headers?: Readonly<Record<string, string>> }>;
type ResponseValue = Readonly<{ status: number; value: unknown; cause?: string }>;
type RequestProof = (path: string, options?: RequestOptions) => Promise<ResponseValue>;

/** A single scoped native runtime serves each connected request sequence. The
 * Promise callback is the Vitest/Fetch boundary, not a second workflow owner. */
function withHttp(work: (request: RequestProof) => Promise<void>) {
  return tested.use(runtime => Effect.gen(function* () {
    const container = createContainer().register({ logger: asValue(storeCartLogger), configModule: asValue({ projectConfig: { http: {} } }) });
    const failures: string[] = [];
    const observe = <A, E, R>(work: Effect.Effect<A, E, R>) => work.pipe(Effect.tapCause(cause =>
      Effect.sync(() => { failures.push(Cause.pretty(cause) + "\nCaptured failure: " + JSON.stringify(cause, (key, value) => key === "stack" ? undefined : value)); })));
    const witnessed: typeof runtime = { ...runtime, runWorkflow: (name, value) => observe(runtime.runWorkflow(name, value)),
      remoteQuery: value => observe(runtime.remoteQuery(value)), query: { graph: (value, options) => observe(runtime.query.graph(value, options)) } };
    const scopes = yield* makeStoreCartRequestScopeFactory({ runtime: witnessed, container });
    const http = createStoreCartHttpHandler({ storeCors: "https://store.test", ...scopes,
      admitCartRefetchFields: runtime.admitCartRefetchFields, admitPaymentCollectionFields: runtime.admitPaymentCollectionFields,
      resolveCustomerPrincipal: request => request.headers.get("x-proof-payment-customer") === customerCredential
        ? { actor_id: "cus-create-root", actor_type: "customer", auth_identity_id: "auth-payment-http", app_metadata: {}, user_metadata: {} } : undefined });
    const request: RequestProof = async (path, options = {}) => {
      failures.length = 0;
      const response = await http.handle(new Request(`https://store.test${path}`, {
        method: options.method ?? (options.value === undefined ? "GET" : "POST"),
        headers: { "content-type": "application/json", "x-publishable-api-key": options.key ?? storeCartToken,
          ...(options.credential === undefined ? {} : { "x-proof-payment-customer": options.credential }), ...options.headers },
        ...(options.value === undefined ? {} : { body: JSON.stringify(options.value) }),
      }));
      const value: unknown = await response.json();
      return { status: response.status, value, ...(failures.length === 0 ? {} : { cause: failures.join("\n") }) };
    };
    return yield* Effect.promise(() => work(request));
  }));
}

function collection(response: ResponseValue) {
  expect(response.status, JSON.stringify(response)).toBe(200);
  return decodeCollection(response.value).payment_collection;
}
const singleSession = (value: typeof Schema.JsonObject.Type) => decodeSingleSession(value).payment_sessions[0];
const prepareRoots = () => {
  const { catalog, fixture } = tested, payment = catalog.paymentRuntimes;
  return Effect.runPromise(prepareStorePaymentWorkflows({ execution: fixture.execution, modules: {
    cart: { module: payment.cart.workflow, nativeStorage: fixture.source("cart") },
    payment: { module: catalog.runtimes.workflows.payment, nativeStorage: fixture.source("payment") },
    cart_payment_collection_links: { module: payment.cartPaymentCollection.workflow, nativeStorage: fixture.source("cart_payment_collection_links") },
    customer: { module: payment.customer.workflow, nativeStorage: fixture.source("customer") },
    customer_account_holder_links: { module: payment.customerAccountHolder.workflow, nativeStorage: fixture.source("customer_account_holder_links") },
  }, customerAccountLink: payment.customerAccountLink, logger: catalog.runtimes.logger, revision: "9".repeat(64),
  subscribers: [{ id: "native-store-payment-replay", revision: "a".repeat(64) }] }));
};

it("admits native strict bodies and response fields before writes, and reuses a completed Cart collection through a read-only branch", async () => {
  const before = await tested.fixture.snapshot();
  await withHttp(async request => {
    for (const [path, options] of [
      [collectionPath, { value: {} }],
      [collectionPath, { value: { cart_id: "cart-http-payment", metadata: {} } }],
      [collectionPath, { value: { cart_id: "cart-http-payment" }, key: storeCartRevokedToken }],
      [`${collectionPath}?fields=id,unsupported`, { value: { cart_id: "cart-http-payment" } }],
      [sessionPath("paycol-http-payment-customer"), { value: {} }],
      [sessionPath("paycol-http-payment-customer"), { value: { provider_id: provider, customer_id: "cus-create-root" } }],
      [sessionPath("paycol-http-payment-customer"), { value: { provider_id: provider, data: null } }],
      [sessionPath("paycol-http-payment-customer"), { value: { provider_id: "pp_remote_unsupported" } }],
      [`${sessionPath("paycol-http-payment-customer")}?fields=id,unsupported`, { value: { provider_id: provider } }],
    ] as const) {
      const refused = await request(path, options);
      expect(refused.status, JSON.stringify(refused.value)).toBe(400);
    }
    expect(collection(await request(collectionPath, { value: { cart_id: "cart-http-payment-existing-completed" } })))
      .toMatchObject({ id: "paycol-http-payment-existing", amount: 31.25, currency_code: "usd", payment_sessions: [] });
    expect(collection(await request(`${collectionPath}?fields=id`, { value: { cart_id: "cart-http-payment-existing-completed" } })))
      .toEqual({ id: "paycol-http-payment-existing" });
    expect((await request(collectionPath, { value: { cart_id: "cart-http-payment-completed" } })).status).toBe(400);
    const missing = await request(collectionPath, { value: { cart_id: "cart-http-payment-missing" } });
    expect(missing.status, JSON.stringify(missing.value)).toBe(404);
  });
  expect(await tested.fixture.snapshot()).toEqual(before);
});

it("rolls back the pending native Session and newly created account/Link after a local provider failure", async () => {
  const before = await tested.fixture.snapshot();
  let pendingCreated = false, providerReached = false;
  const nativeCreate = PaymentModuleService.prototype.createPaymentSession_;
  const create = vi.spyOn(PaymentModuleService.prototype, "createPaymentSession_").mockImplementation(async function (this: PaymentModuleService, ...args) {
    const value = await Reflect.apply(nativeCreate, this, args); pendingCreated = true; return value;
  });
  const initiate = vi.spyOn(SystemPaymentProvider.prototype, "initiatePayment").mockImplementation(async () => {
    if (!pendingCreated) throw new Error("Provider invocation preceded genuine Session insertion");
    providerReached = true; throw new Error("late-native-http-payment-provider");
  });
  const log = vi.spyOn(storeCartLogger, "error").mockImplementation(() => undefined);
  try {
    await withHttp(async request => {
      const refused = await request(sessionPath("paycol-http-payment-failure"), { value: { provider_id: provider, data: { attempt: "rollback" } },
        credential: customerCredential });
      expect(refused.status, JSON.stringify(refused.value)).toBe(500);
    });
    expect(pendingCreated).toBe(true); expect(providerReached).toBe(true); expect(create).toHaveBeenCalledTimes(1);
    expect(initiate).toHaveBeenCalledTimes(1); expect(await tested.fixture.snapshot()).toEqual(before);
  } finally { create.mockRestore(); initiate.mockRestore(); log.mockRestore(); }
});

it("creates a real HTTP Cart collection, initializes a guest Session, and refreshes totals with native Session invalidation", async () => {
  let cartId = "", collectionId = "";
  await withHttp(async request => {
    expect(collection(await request(collectionPath, { value: { cart_id: "cart-http-payment-no-channel" } })))
      .toMatchObject({ amount: 0, currency_code: "usd", payment_sessions: [] });
    const created = await request("/store/carts", { value: { items: [{ variant_id: "variant-create-root", quantity: 1 }],
      shipping_address: { country_code: "us" } } });
    expect(created.status, JSON.stringify(created)).toBe(200);
    const cart = decodeCart(created.value).cart; cartId = decodeId(cart.id);
    expect(cart).toMatchObject({ total: 12.65, subtotal: 12.5, discount_total: 1.1, tax_total: 1.15 });
    const payment = collection(await request(collectionPath, { value: { cart_id: cartId } }));
    collectionId = decodeId(payment.id);
    expect(payment).toMatchObject({ amount: 12.65, currency_code: "usd", payment_sessions: [] });
    const initialized = collection(await request(sessionPath(collectionId), { value: { provider_id: provider, data: { checkout_note: "guest" } },
      headers: { "x-customer-id": "cus-create-root", "x-actor-id": "cus-create-root" } }));
    const session = singleSession(initialized);
    expect(session).toMatchObject({ payment_collection_id: collectionId, provider_id: provider, amount: 12.65, currency_code: "usd",
      status: "pending", data: { checkout_note: "guest" }, context: {} });
    expect(decodeObject(session.context)).not.toHaveProperty("customer");
    const beforeReuse = await tested.fixture.snapshot();
    expect(collection(await request(collectionPath, { value: { cart_id: cartId } }))).toEqual(initialized);
    expect(await tested.fixture.snapshot()).toEqual(beforeReuse);
    const line = Schema.decodeUnknownSync(Schema.Struct({ items: Schema.Tuple([Schema.JsonObject]) }))(cart).items[0];
    const updated = await request(`/store/carts/${cartId}/line-items/${decodeId(line.id)}`, { value: { quantity: 2 } });
    expect(updated.status, JSON.stringify(updated)).toBe(200);
    expect(decodeCart(updated.value).cart).toMatchObject({ total: 26.4, payment_collection: { id: collectionId, amount: 26.4, payment_sessions: [] } });
  });
  const settled = await tested.fixture.snapshot();
  await tested.fixture.run(tested.fixture.recover);
  await withHttp(async request => {
    const afterRecreation = collection(await request(collectionPath, { value: { cart_id: cartId } }));
    expect(afterRecreation).toMatchObject({ id: collectionId, amount: 26.4, payment_sessions: [] });
  });
  expect(await tested.fixture.snapshot()).toEqual(settled);
});

it("uses only verified Customer identity, native billing Address selection and one stored account across Session replacement", async () => {
  const account = vi.spyOn(SystemPaymentProvider.prototype, "createAccountHolder");
  try {
    await withHttp(async request => {
      const first = collection(await request(sessionPath("paycol-http-payment-customer"), { value: { provider_id: provider, data: { attempt: 1 } },
        credential: customerCredential }));
      const firstSession = singleSession(first), context = decodeObject(firstSession.context), holder = decodeObject(context.account_holder);
      expect(firstSession).toMatchObject({ payment_collection_id: "paycol-http-payment-customer", amount: 13.75, data: { attempt: 1 }, context: {
        customer: { id: "cus-create-root", email: "native-cart@example.com", billing_address: { id: "cuaddr-http-payment-billing", city: "Native billing address" } },
        account_holder: { id: expect.stringMatching(/^acchld_/), external_id: "cus-create-root", provider_id: provider },
      } });
      expect(account).toHaveBeenCalledTimes(1);
      const replaced = collection(await request(sessionPath("paycol-http-payment-customer"), { value: { provider_id: provider, data: { attempt: 2 } },
        credential: customerCredential }));
      const secondSession = singleSession(replaced);
      expect(secondSession.id).not.toBe(firstSession.id);
      expect(secondSession).toMatchObject({ data: { attempt: 2 }, context: { account_holder: holder } });
      expect(account).toHaveBeenCalledTimes(1);
      const persisted = await tested.fixture.readRows();
      expect(persisted.filter(row => row.external_id === "cus-create-root")).toEqual([expect.objectContaining({ id: holder.id })]);
      expect(persisted.filter(row => row.account_holder_id === holder.id)).toEqual([expect.objectContaining({ customer_id: "cus-create-root" })]);
      expect(persisted.filter(row => row.id === firstSession.id)).toEqual([]);
    });
  } finally { account.mockRestore(); }
});

it("keeps the committed native Session when its independent HTTP refetch exceeds the bounded read cohort", async () => {
  const before = await tested.fixture.snapshot();
  const original = (await tested.fixture.readRows("payment")).filter(row => row.payment_collection_id === "paycol-http-payment-full");
  expect(original).toHaveLength(4);
  // The native Session handler's refetchEntity call reaches this exact graph
  // ABI. Establish the successful four-row boundary before creating the fifth.
  const visible = await tested.use(runtime => runtime.query.graph({ entity: "payment_collection", fields: ["id", "currency_code", "amount", "payment_sessions.*"],
    filters: { id: "paycol-http-payment-full" }, pagination: undefined, withDeleted: undefined, context: undefined }));
  const existing = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Tuple([Schema.Struct({ payment_sessions: Schema.Array(Schema.JsonObject) })]) }))(visible);
  expect(existing.data[0].payment_sessions).toHaveLength(4);
  expect(await tested.fixture.snapshot()).toEqual(before);
  await withHttp(async request => {
    const response = await request(sessionPath("paycol-http-payment-full"), { value: { provider_id: provider, data: { beyond_refetch_cohort: true } } });
    expect(response.status, JSON.stringify(response.value)).toBe(400);
  });
  const retained = (await tested.fixture.readRows("payment")).filter(row => row.payment_collection_id === "paycol-http-payment-full");
  expect(retained).toHaveLength(5);
  expect(retained).toEqual(expect.arrayContaining(original));
  expect(retained).toContainEqual(expect.objectContaining({ data: { beyond_refetch_cohort: true }, authorized_at: null }));
  const committed = await tested.fixture.snapshot();
  expect(committed.outcomes).toHaveLength(before.outcomes.length + 1);
  expect(committed.events.length).toBeGreaterThan(before.events.length);
});

it("replays collection and Session outcomes across owner recreation without invoking the native provider again", async () => {
  const roots = await prepareRoots(), create = vi.spyOn(PaymentModuleService.prototype, "createPaymentCollections"),
    initiate = vi.spyOn(SystemPaymentProvider.prototype, "initiatePayment");
  try {
    const collectionKey = roots.createCollection.newRequestKey();
    const collectionInput = Result.getOrThrow(roots.createCollection.decodeInput({ cart_id: "cart-http-payment" }));
    const created = await Effect.runPromise(roots.createCollection.run(collectionKey, collectionInput));
    expect(created).toMatchObject({ amount: 13.75, currency_code: "usd" });
    expect(create).toHaveBeenCalledTimes(1);
    const sessionKey = roots.createSessions.newRequestKey(), fault = tested.fixture.loseNextNativeRootAcknowledgement();
    const sessionInput = Result.getOrThrow(roots.createSessions.decodeInput({ payment_collection_id: "paycol-http-payment-replay", provider_id: provider,
      data: { replay: "native" } }));
    const initialized = await Effect.runPromise(roots.createSessions.run(sessionKey, sessionInput));
    expect(initialized).toMatchObject({ payment_collection_id: "paycol-http-payment-replay", amount: 13.75, data: { replay: "native" } });
    expect(fault).toMatchObject({ armed: false, failures: 1 });
    expect(initiate).toHaveBeenCalledTimes(1);
    const committed = await tested.fixture.snapshot();
    expect(committed.outcomes).toContainEqual(expect.objectContaining({ timestamp: fault.evidence?.timestamp,
      value: expect.objectContaining({ key: sessionKey, kind: "nativeRoot", state: "committed" }) }));
    await tested.fixture.run(tested.fixture.recover);
    const recreated = await prepareRoots();
    try {
      expect(await Effect.runPromise(recreated.createCollection.run(collectionKey, collectionInput))).toEqual(created);
      expect(await Effect.runPromise(recreated.createSessions.run(sessionKey, sessionInput))).toEqual(initialized);
      expect(create).toHaveBeenCalledTimes(1); expect(initiate).toHaveBeenCalledTimes(1);
      expect(await tested.fixture.snapshot()).toEqual(committed);
      expect(Exit.isFailure(await Effect.runPromiseExit(recreated.createSessions.run(sessionKey, { ...sessionInput, data: { replay: "changed" } })))).toBe(true);
      expect(await tested.fixture.snapshot()).toEqual(committed);
    } finally { await Effect.runPromise(recreated.createCollection.close); await Effect.runPromise(recreated.createSessions.close); }
  } finally {
    create.mockRestore(); initiate.mockRestore(); await Effect.runPromise(roots.createCollection.close); await Effect.runPromise(roots.createSessions.close);
  }
});
