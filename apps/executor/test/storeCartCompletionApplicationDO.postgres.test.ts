import { readFile } from "node:fs/promises";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { createCorePostgresFixture } from "@flarex/persistence-postgres/internal/system-test/core-persistence-fixture";
import { prepareStoreCartRequestFixture, observeStoreCartRequestFixture } from "@flarex/medusa-adapter/internal/system-test/store-cart-request-fixture";
import { storeCartRequestTarget, storeCartToken, storeCartRevokedToken, storeCartCompletionSeedRows } from "@flarex/medusa-adapter/internal/system-test/store-cart-request-catalog";
import { executorApplicationProfileFixture } from "./support/executorApplicationConfiguration";
import { createMedusaDOTestSuite } from "./support/medusaDOTestRunner";

const endpointPath = process.env.FLAREX_CORE_POSTGRES_ENDPOINTS_FILE;
const endpoints = endpointPath === undefined ? undefined : Schema.decodeUnknownSync(Schema.Struct({ connectionString: Schema.NonEmptyString,
  provisioningConnectionString: Schema.NonEmptyString }))(JSON.parse(await readFile(endpointPath, "utf8")));
const suite = createMedusaDOTestSuite(new URL("./storeCartCompletionApplicationDO.workerd.worker.ts", import.meta.url));
const cartBody = Schema.decodeUnknownSync(Schema.Struct({ cart: Schema.JsonObject }));
const orderBody = Schema.decodeUnknownSync(Schema.Struct({ type: Schema.Literal("order"), order: Schema.JsonObject }));
const collectionBody = Schema.decodeUnknownSync(Schema.Struct({ payment_collection: Schema.JsonObject }));
const rows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const object = Schema.decodeUnknownSync(Schema.JsonObject);
const id = Schema.decodeUnknownSync(Schema.NonEmptyString);
const isPlaced = Schema.is(Schema.Struct({ contract: Schema.Literal("order.placed") }));
const completePath = (cartId: string) => `/store/carts/${cartId}/complete`;

describe.runIf(endpoints !== undefined)("native Store Cart completion in the actual application DO", () => {
  it("settles populated guest and Customer checkouts, preserves default Order graph, rolls back Session failures and survives recreation", async () => {
    if (endpoints === undefined) throw new Error("Store Cart completion DO requires ordinary PostgreSQL");
    const physical = await createCorePostgresFixture(endpoints);
    let prepared: Awaited<ReturnType<typeof prepareStoreCartRequestFixture>> | undefined;
    let scenario: Awaited<ReturnType<typeof suite.createScenario>> | undefined;
    let phase = "bootstrap";
    const primary: unknown[] = [];
    try {
      prepared = await prepareStoreCartRequestFixture("postgres", { physical: { ...physical, close: async () => {} }, additionalRows: storeCartCompletionSeedRows });
      await prepared.fixture.close();
      const catalog = prepared.catalog;
      const observe = () => observeStoreCartRequestFixture({ physical, catalog });
      const baseline = await observe();
      const profile = { ...executorApplicationProfileFixture(), ...storeCartRequestTarget,
        persistenceNamespace: physical.namespace, instanceName: physical.instanceName };
      scenario = await suite.createScenario({ profile, connectionString: endpoints.connectionString,
        privateToken: "private-store-cart-completion-proof", className: "NativeStoreCartCompletionApplicationFixture", hostname: "native-store-cart-completion.test",
        headers: { "x-publishable-api-key": storeCartToken, origin: "https://store.test" } });
      const host = scenario;
      const request = async (path: string, options: Parameters<typeof host.request>[1] = {}, status = 200) => {
        const response = await host.request(path, options);
        expect(response.status, await response.clone().text()).toBe(status);
        return response;
      };
      const post = (body: unknown) => ({ method: "POST" as const, body });
      const customerHeaders = { "x-proof-customer-credential": "store-cart-verified-secret" };
      const payable = async (customer: boolean, data: Record<string, unknown> = {}) => {
        const headers = customer ? customerHeaders : { "x-customer-id": "cus-create-root" };
        const cart = cartBody(await (await request("/store/carts", { ...post({ email: "workerd-checkout@example.com",
          items: [{ variant_id: "variant-http-shipping", quantity: 1 }],
          shipping_address: { address_1: "10 Workerd checkout road", city: "Workerd destination", country_code: "us" },
          billing_address: { address_1: "11 Workerd billing road", city: "Workerd billing", country_code: "us" },
        }), headers })).json()).cart;
        if (customer) expect(cart.customer_id).toBe("cus-create-root");
        else expect(id(cart.customer_id)).not.toBe("cus-create-root");
        const cartId = id(cart.id);
        const shipped = cartBody(await (await request(`/store/carts/${cartId}/shipping-methods`, {
          ...post({ option_id: "so-http-shipping-standard", data: { delivery: "actual Workerd" } }), headers })).json()).cart;
        expect(shipped).toMatchObject({ total: 14.85, subtotal: 17.5, tax_total: 1.35, discount_total: 4.4,
          items: [{ tax_lines: [{ rate: 10 }], adjustments: [{ code: "NATIVE-CART", amount: 1 }] }],
          shipping_methods: [{ amount: 5, tax_lines: [{ rate: 10 }], adjustments: [{ code: "HTTP-COMPLETION-SHIPPING", amount: 3 }] }] });
        const collection = collectionBody(await (await request("/store/payment-collections", { ...post({ cart_id: cartId }), headers })).json()).payment_collection;
        const collectionId = id(collection.id);
        const initialized = collectionBody(await (await request(`/store/payment-collections/${collectionId}/payment-sessions`, {
          ...post({ provider_id: "pp_system_default", data }), headers })).json()).payment_collection;
        const session = rows(initialized.payment_sessions)[0];
        expect(session).toMatchObject({ status: "pending", amount: 14.85 });
        if (!customer) expect(object(session?.context)).not.toHaveProperty("customer");
        return { cartId, collectionId, sessionId: id(session?.id) };
      };
      const failedRoot = (before: Awaited<ReturnType<typeof observe>>, after: typeof before) => {
        const keys = new Set(before.outcomes.map(outcome => outcome.value.key));
        const failed = after.outcomes.filter(outcome => !keys.has(outcome.value.key));
        expect(failed).toEqual([expect.objectContaining({ value: expect.objectContaining({ kind: "nativeRoot", state: "failed" }) })]);
        expect(after).toEqual({ ...before, outcomes: [...before.outcomes, ...failed] });
      };

      phase = "admission"; host.start(); await host.ready();
      await request(completePath("missing"), { ...post({}), private: false }, 401);
      await request(completePath("missing"), { ...post({}), headers: { "x-publishable-api-key": storeCartRevokedToken } }, 400);
      await request(completePath("missing") + "?fields=id,unsupported", post({}), 400);
      await host.stop(); expect(await observe()).toEqual(baseline);

      phase = "populated guest checkout"; host.start(); await host.ready();
      const guest = await payable(false);
      const order = orderBody(await (await request(completePath(guest.cartId), post({}))).json()).order;
      const orderId = id(order.id);
      expect(order).toMatchObject({ total: 14.85, subtotal: 17.5, tax_total: 1.35, discount_total: 4.4, currency_code: "usd",
        items: [{ quantity: 1, unit_price: 12.5, detail: { quantity: 1 }, variant: { id: "variant-http-shipping", product: { id: "prod-create-root" } },
          tax_lines: [{ rate: 10 }], adjustments: [{ code: "NATIVE-CART", amount: 1 }] }],
        shipping_methods: [{ shipping_option_id: "so-http-shipping-standard", tax_lines: [{ rate: 10 }],
          adjustments: [{ code: "HTTP-COMPLETION-SHIPPING", amount: 3 }] }],
        shipping_address: { city: "Workerd destination" }, billing_address: { city: "Workerd billing" },
        payment_collections: [{ id: guest.collectionId, amount: 14.85, status: "authorized" }], credit_lines: [] });
      for (const field of ["summary", "display_id", "original_total", "shipping_tax_total", "credit_line_total"])
        expect(order).toHaveProperty(field);
      await host.stop(); const settled = await observe();
      const cartTable = catalog.sources.find(source => source.name === "cart")?.definition.tables
        .find(table => (table.localName ?? table.name) === "cart")?.name;
      const sessionTable = catalog.sources.find(source => source.name === "payment")?.definition.tables
        .find(table => (table.localName ?? table.name) === "payment_session")?.name;
      expect(settled.rows.filter(row => row.table === cartTable && row.value.id === guest.cartId))
        .toEqual([expect.objectContaining({ value: expect.objectContaining({ completed_at: expect.any(String) }) })]);
      expect(settled.rows.filter(row => row.table === sessionTable && row.value.id === guest.sessionId))
        .toEqual([expect.objectContaining({ value: expect.objectContaining({ status: "authorized", authorized_at: expect.any(String) }) })]);
      const orderRow = settled.rows.find(row => row.value.id === orderId);
      expect(orderRow).toBeDefined();
      for (const sourceName of ["cart", "order", "payment", "inventory", "promotion", "order_cart_links", "order_payment_collection_links", "order_promotion_links"]) {
        const tables = new Set(catalog.sources.find(source => source.name === sourceName)?.definition.tables.map(table => table.name));
        expect(settled.revisions.some(row => tables.has(row.table) && row.timestamp === orderRow?.timestamp), sourceName).toBe(true);
      }
      expect(settled.rows.filter(row => row.value.order_id === orderId && row.value.cart_id === guest.cartId)).toHaveLength(1);
      expect(settled.rows.filter(row => row.value.order_id === orderId && row.value.payment_collection_id === guest.collectionId)).toHaveLength(1);
      expect(settled.rows.filter(row => row.value.order_id === orderId && typeof row.value.promotion_id === "string")).toHaveLength(2);
      expect(settled.rows.find(row => row.value.id === "promo-http-completion-shipping")?.value).toMatchObject({ used: 1 });
      expect(settled.rows.filter(row => row.value.inventory_item_id === "iitem-http-shipping" && typeof row.value.line_item_id === "string")).toHaveLength(1);
      expect(settled.rows.filter(row => isPlaced(row.value.envelope))).toEqual([expect.objectContaining({ timestamp: orderRow?.timestamp,
        value: expect.objectContaining({ envelope: expect.objectContaining({ message: expect.objectContaining({ data: { id: orderId }, options: { priority: 10 } }) }) }) })]);
      phase = "guest completion after cold recreation"; host.start(); await host.ready();
      expect(orderBody(await (await request(completePath(guest.cartId), post({}))).json()).order).toEqual(order);
      await host.stop(); const recreated = await observe();
      expect({ ...recreated, outcomes: [] }).toEqual({ ...settled, outcomes: [] });

      phase = "unprocessable Session setup"; host.start(); await host.ready();
      const refused = await payable(false, { refuse_completion_authorization: true });
      await host.stop(); const beforeRefusal = await observe();
      phase = "unprocessable Session rollback"; host.start(); await host.ready();
      const refusal = await request(completePath(refused.cartId), post({}), 400);
      expect(await refusal.json()).toMatchObject({ type: "not_allowed", message: `Session: ${refused.sessionId} was not authorized with the provider.` });
      expect(await (await request("/__proof/completion-fault")).json()).toEqual({ completedAuthorizations: 0, refusedAuthorizations: 1 });
      await host.stop(); failedRoot(beforeRefusal, await observe());

      phase = "verified Customer setup"; host.start(); await host.ready();
      const customer = await payable(true, { fail_completion_after_authorization: true });
      await host.stop(); const beforeLate = await observe();
      phase = "late native authorization rollback"; host.start(); await host.ready();
      await request(completePath(customer.cartId), { ...post({}), headers: customerHeaders }, 500);
      expect(await (await request("/__proof/completion-fault")).json()).toEqual({ completedAuthorizations: 1, refusedAuthorizations: 0 });
      await host.stop(); failedRoot(beforeLate, await observe());
      phase = "Customer completion after proven rollback"; host.start(); await host.ready();
      await request(`/store/payment-collections/${customer.collectionId}/payment-sessions`, {
        ...post({ provider_id: "pp_system_default", data: { retry_after_failure: true } }), headers: customerHeaders });
      const customerOrder = orderBody(await (await request(completePath(customer.cartId), { ...post({}), headers: customerHeaders })).json()).order;
      expect(customerOrder).toMatchObject({ total: 14.85, shipping_address: { city: "Workerd destination" } });
      await host.stop(); const completed = await observe();
      expect(completed.rows.find(row => row.value.id === customerOrder.id)?.value).toMatchObject({ customer_id: "cus-create-root" });
      expect(completed.rows.find(row => row.value.id === "promo-http-completion-shipping")?.value).toMatchObject({ used: 2 });
      expect(completed.rows.filter(row => isPlaced(row.value.envelope))).toHaveLength(2);
      phase = "Customer projection and cold recreation"; host.start(); await host.ready();
      expect(orderBody(await (await request(completePath(customer.cartId) + "?fields=id,total", { ...post({}), headers: customerHeaders })).json()).order)
        .toEqual({ id: customerOrder.id, total: 14.85 });
      await host.stop(); expect({ ...await observe(), outcomes: [] }).toEqual({ ...completed, outcomes: [] });
    } catch (cause) { console.error("Store completion DO proof failed", { phase }); primary.push(cause); throw cause; }
    finally {
      const failures: unknown[] = [];
      try { await scenario?.stop(); } catch (cause) { failures.push(cause); }
      try { await prepared?.fixture.close(); } catch (cause) { failures.push(cause); }
      try { await physical.close(); } catch (cause) { failures.push(cause); }
      if (failures.length > 0) throw new AggregateError([...primary, ...failures], "Store completion DO proof cleanup failed");
    }
  }, 600_000);
});
