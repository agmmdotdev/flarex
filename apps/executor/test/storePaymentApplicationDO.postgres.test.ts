import { readFile } from "node:fs/promises";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { createCorePostgresFixture } from "@flarex/persistence-postgres/internal/system-test/core-persistence-fixture";
import { prepareStoreCartRequestFixture, observeStoreCartRequestFixture } from "@flarex/medusa-adapter/internal/system-test/store-cart-request-fixture";
import { storeCartRequestTarget, storeCartToken, storeCartRevokedToken, storePaymentHttpProofSeedRows } from "@flarex/medusa-adapter/internal/system-test/store-cart-request-catalog";
import { executorApplicationProfileFixture } from "./support/executorApplicationConfiguration";
import { createMedusaDOTestSuite } from "./support/medusaDOTestRunner";

const endpointPath = process.env.FLAREX_CORE_POSTGRES_ENDPOINTS_FILE;
const endpoints = endpointPath === undefined ? undefined : Schema.decodeUnknownSync(Schema.Struct({ connectionString: Schema.NonEmptyString,
  provisioningConnectionString: Schema.NonEmptyString }))(JSON.parse(await readFile(endpointPath, "utf8")));
const suite = createMedusaDOTestSuite(new URL("./storeCartApplicationDO.workerd.worker.ts", import.meta.url));
const decodeCart = Schema.decodeUnknownSync(Schema.Struct({ cart: Schema.JsonObject }));
const decodeCollection = Schema.decodeUnknownSync(Schema.Struct({ payment_collection: Schema.JsonObject }));
const decodeRows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const decodeObject = Schema.decodeUnknownSync(Schema.JsonObject);
const decodeId = Schema.decodeUnknownSync(Schema.NonEmptyString);
const provider = "pp_system_default";
const collectionPath = "/store/payment-collections";
const sessionPath = (id: string) => `${collectionPath}/${id}/payment-sessions`;

describe.runIf(endpoints !== undefined)("native Store Payment HTTP in the actual application DO", () => {
  it("creates and reuses Cart collections, replaces guest and Customer Sessions, rolls back late failure and survives recreation", async () => {
    if (endpoints === undefined) throw new Error("Store Payment DO requires ordinary PostgreSQL");
    const physical = await createCorePostgresFixture(endpoints);
    let prepared: Awaited<ReturnType<typeof prepareStoreCartRequestFixture>> | undefined;
    let scenario: Awaited<ReturnType<typeof suite.createScenario>> | undefined;
    let phase = "bootstrap";
    const primary: unknown[] = [];
    try {
      prepared = await prepareStoreCartRequestFixture("postgres", { physical: { ...physical, close: async () => {} }, additionalRows: storePaymentHttpProofSeedRows });
      await prepared.fixture.close();
      const baseline = await observeStoreCartRequestFixture({ physical, catalog: prepared.catalog });
      const profile = { ...executorApplicationProfileFixture(), ...storeCartRequestTarget,
        persistenceNamespace: physical.namespace, instanceName: physical.instanceName };
      scenario = await suite.createScenario({ profile, connectionString: endpoints.connectionString,
        privateToken: "private-store-payment-do-proof", className: "NativeStoreCartApplicationFixture", hostname: "native-store-payment.test",
        headers: { "x-publishable-api-key": storeCartToken, origin: "https://store.test" } });
      const host = scenario;
      const request = async (path: string, options: Parameters<typeof host.request>[1] = {}, status = 200) => {
        const response = await host.request(path, options);
        expect(response.status, await response.clone().text()).toBe(status);
        return response;
      };
      const post = (body: unknown) => ({ method: "POST" as const, body });
      const customerHeaders = { "x-proof-customer-credential": "store-cart-verified-secret" };

      phase = "HTTP admission and existing collection"; host.start(); await host.ready();
      await request(collectionPath, { ...post({ cart_id: "cart-http-payment" }), private: false }, 401);
      await request(collectionPath, post({}), 400);
      await request(collectionPath, post({ cart_id: "cart-http-payment", metadata: {} }), 400);
      await request(`${collectionPath}?fields=id,unsupported`, post({ cart_id: "cart-http-payment" }), 400);
      await request(collectionPath, { ...post({ cart_id: "cart-http-payment" }), headers: { "x-publishable-api-key": storeCartRevokedToken } }, 400);
      await request(sessionPath("paycol-http-payment-customer"), post({ provider_id: provider, customer_id: "cus-create-root" }), 400);
      await request(sessionPath("paycol-http-payment-customer"), post({ provider_id: "pp_remote_unsupported" }), 400);
      await request(`${sessionPath("paycol-http-payment-customer")}?fields=unsupported`, post({ provider_id: provider }), 400);
      expect(decodeCollection(await (await request(collectionPath, post({ cart_id: "cart-http-payment-existing-completed" }))).json()).payment_collection)
        .toMatchObject({ id: "paycol-http-payment-existing", amount: 31.25, payment_sessions: [] });
      expect(decodeCollection(await (await request(`${collectionPath}?fields=id`, post({ cart_id: "cart-http-payment-existing-completed" }))).json()).payment_collection)
        .toEqual({ id: "paycol-http-payment-existing" });
      await host.stop();
      expect(await observeStoreCartRequestFixture({ physical, catalog: prepared.catalog })).toEqual(baseline);

      phase = "native Cart to guest Payment"; host.start(); await host.ready();
      const created = decodeCart(await (await request("/store/carts", post({ items: [{ variant_id: "variant-create-root", quantity: 1 }],
        shipping_address: { country_code: "us" } }))).json()).cart;
      expect(created).toMatchObject({ total: 12.65, tax_total: 1.15, discount_total: 1.1 });
      const cartId = decodeId(created.id), lineId = decodeId(decodeRows(created.items)[0]?.id);
      const collection = decodeCollection(await (await request(collectionPath, post({ cart_id: cartId }))).json()).payment_collection;
      const collectionId = decodeId(collection.id);
      expect(collection).toMatchObject({ currency_code: "usd", amount: 12.65, payment_sessions: [] });
      expect(decodeCollection(await (await request(collectionPath, post({ cart_id: cartId }))).json()).payment_collection).toEqual(collection);
      const first = decodeCollection(await (await request(sessionPath(collectionId), { ...post({ provider_id: provider, data: { marker: "Worker guest" } }),
        headers: { "x-customer-id": "cus-create-root", "x-proof-customer-credential": "unverified" } })).json()).payment_collection;
      const firstSession = decodeRows(first.payment_sessions)[0];
      expect(firstSession).toMatchObject({ provider_id: provider, amount: 12.65, status: "pending", data: { marker: "Worker guest" } });
      expect(decodeObject(firstSession?.context)).not.toHaveProperty("customer");
      const firstId = decodeId(firstSession?.id);
      const replacement = decodeCollection(await (await request(sessionPath(collectionId), post({ provider_id: provider, data: { marker: "Worker replacement" } }))).json()).payment_collection;
      const replacementSessions = decodeRows(replacement.payment_sessions);
      expect(replacementSessions).toHaveLength(1);
      expect(replacementSessions[0]).toMatchObject({ data: { marker: "Worker replacement" }, amount: 12.65 });
      expect(replacementSessions[0]?.id).not.toBe(firstId);
      const updated = decodeCart(await (await request(`/store/carts/${cartId}/line-items/${lineId}`, post({ quantity: 2 }))).json()).cart;
      expect(updated).toMatchObject({ total: 26.4, payment_collection: { id: collectionId, amount: 26.4, payment_sessions: [] } });
      await host.stop();
      const committed = await observeStoreCartRequestFixture({ physical, catalog: prepared.catalog });
      expect(committed.rows.some(row => row.value.id === firstId)).toBe(false);
      expect(committed.rows.find(row => row.value.id === collectionId)?.value).toMatchObject({ amount: "26.400000000000000000", raw_amount: { value: "26.400000000000000000", precision: 20 } });

      phase = "late native provider failure"; host.start(); await host.ready();
      await request(sessionPath("paycol-http-payment-failure"), { ...post({ provider_id: provider, data: { fail_workerd_payment: true } }), headers: customerHeaders }, 500);
      await host.stop();
      const rejected = await observeStoreCartRequestFixture({ physical, catalog: prepared.catalog });
      const priorKeys = new Set(committed.outcomes.map(outcome => outcome.value.key));
      const failures = rejected.outcomes.filter(outcome => !priorKeys.has(outcome.value.key));
      expect(failures).toEqual([expect.objectContaining({ value: expect.objectContaining({ kind: "nativeRoot", state: "failed" }) })]);
      expect(rejected).toEqual({ ...committed, outcomes: [...committed.outcomes, ...failures] });

      phase = "verified Customer account and replacement"; host.start(); await host.ready();
      const customer = decodeCollection(await (await request(sessionPath("paycol-http-payment-customer"), {
        ...post({ provider_id: provider, data: { marker: "Verified Customer" } }), headers: customerHeaders })).json()).payment_collection;
      const customerSession = decodeRows(customer.payment_sessions)[0], context = decodeObject(customerSession?.context);
      const holderId = decodeId(decodeObject(context.account_holder).id);
      expect(context).toMatchObject({ customer: { id: "cus-create-root", billing_address: { id: "cuaddr-http-payment-billing" } }, account_holder: { id: holderId } });
      const customerReplacement = decodeCollection(await (await request(sessionPath("paycol-http-payment-customer"), {
        ...post({ provider_id: provider, data: { marker: "Same account" } }), headers: customerHeaders })).json()).payment_collection;
      const latestSessions = decodeRows(customerReplacement.payment_sessions);
      expect(latestSessions).toHaveLength(1);
      expect(latestSessions[0]?.id).not.toBe(customerSession?.id);
      expect(decodeObject(latestSessions[0]?.context)).toMatchObject({ account_holder: { id: holderId } });
      await host.stop();
      const customerCommitted = await observeStoreCartRequestFixture({ physical, catalog: prepared.catalog });
      expect(customerCommitted.rows.filter(row => row.value.customer_id === "cus-create-root" && row.value.account_holder_id === holderId)).toHaveLength(1);
      expect(customerCommitted.rows.find(row => row.value.id === holderId)?.value).toMatchObject({ provider_id: provider });
      expect(customerCommitted.rows.find(row => row.value.id === latestSessions[0]?.id)?.value).toMatchObject({ amount: "13.750000000000000000",
        raw_amount: { value: "13.750000000000000000", precision: 20 }, data: { marker: "Same account" } });

      phase = "recreation"; host.start(); await host.ready();
      expect(decodeCart(await (await request(`/store/carts/${cartId}`)).json()).cart).toEqual(updated);
      expect(decodeCollection(await (await request(collectionPath, post({ cart_id: cartId }))).json()).payment_collection)
        .toMatchObject({ id: collectionId, amount: 26.4, payment_sessions: [] });
      await host.stop();
      expect(await observeStoreCartRequestFixture({ physical, catalog: prepared.catalog })).toEqual(customerCommitted);
    } catch (cause) { console.error("Store Payment DO proof failed", { phase }); primary.push(cause); throw cause; }
    finally {
      const failures: unknown[] = [];
      try { await scenario?.stop(); } catch (cause) { failures.push(cause); }
      try { await prepared?.fixture.close(); } catch (cause) { failures.push(cause); }
      try { await physical.close(); } catch (cause) { failures.push(cause); }
      if (failures.length > 0) throw new AggregateError([...primary, ...failures], "Store Payment DO proof cleanup failed");
    }
  }, 600_000);
});
