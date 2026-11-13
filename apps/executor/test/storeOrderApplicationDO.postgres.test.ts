import { readFile } from "node:fs/promises";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { createCorePostgresFixture } from "@flarex/persistence-postgres/internal/system-test/core-persistence-fixture";
import { prepareStoreCartRequestFixture, observeStoreCartRequestFixture } from "@flarex/medusa-adapter/internal/system-test/store-cart-request-fixture";
import { storeCartRequestTarget, storeCartToken, storeCartRevokedToken, storeOrderHttpSeedRows, storeOrderIds,
  storeOrderSpecialId, storeOrderOtherId, storeOrderDraftId, storeOrderDeletedId, storeOrderEmptyId } from "@flarex/medusa-adapter/internal/system-test/store-cart-request-catalog";
import { executorApplicationProfileFixture } from "./support/executorApplicationConfiguration";
import { createMedusaDOTestSuite } from "./support/medusaDOTestRunner";

const endpointPath = process.env.FLAREX_CORE_POSTGRES_ENDPOINTS_FILE;
const endpoints = endpointPath === undefined ? undefined : Schema.decodeUnknownSync(Schema.Struct({ connectionString: Schema.NonEmptyString,
  provisioningConnectionString: Schema.NonEmptyString }))(JSON.parse(await readFile(endpointPath, "utf8")));
const suite = createMedusaDOTestSuite(new URL("./storeOrderApplicationDO.workerd.worker.ts", import.meta.url));
const orderBody = Schema.decodeUnknownSync(Schema.Struct({ order: Schema.JsonObject }));
const cartBody = Schema.decodeUnknownSync(Schema.Struct({ cart: Schema.JsonObject }));
const pageBody = Schema.decodeUnknownSync(Schema.Struct({ orders: Schema.Array(Schema.JsonObject), count: Schema.Int, offset: Schema.Int, limit: Schema.Int }));
const rows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));

describe.runIf(endpoints !== undefined)("native Store Order reads in the actual application DO", () => {
  it("serves native public details and fifty-row Customer pages without writes, preserves statuses and survives recreation", async () => {
    if (endpoints === undefined) throw new Error("Store Order DO requires ordinary PostgreSQL");
    const physical = await createCorePostgresFixture(endpoints);
    let prepared: Awaited<ReturnType<typeof prepareStoreCartRequestFixture>> | undefined;
    let scenario: Awaited<ReturnType<typeof suite.createScenario>> | undefined;
    let phase = "bootstrap";
    const primary: unknown[] = [];
    try {
      prepared = await prepareStoreCartRequestFixture("postgres", { physical: { ...physical, close: async () => {} }, additionalRows: storeOrderHttpSeedRows });
      await prepared.fixture.close();
      const catalog = prepared.catalog, observe = () => observeStoreCartRequestFixture({ physical, catalog });
      const baseline = await observe();
      const profile = { ...executorApplicationProfileFixture(), ...storeCartRequestTarget,
        persistenceNamespace: physical.namespace, instanceName: physical.instanceName };
      scenario = await suite.createScenario({ profile, connectionString: endpoints.connectionString,
        privateToken: "private-store-order-proof", className: "NativeStoreOrderApplicationFixture", hostname: "native-store-order.test",
        headers: { "x-publishable-api-key": storeCartToken, origin: "https://store.test" } });
      const host = scenario;
      const owner = { "x-proof-store-order-customer": "verified-owner" }, other = { "x-proof-store-order-customer": "verified-other" };
      const request = async (path: string, options: Parameters<typeof host.request>[1] = {}, status = 200) => {
        const response = await host.request(path, options);
        expect(response.status, await response.clone().text()).toBe(status);
        return response;
      };
      phase = "admission"; host.start(); await host.ready();
      expect(await (await request(`/store/orders/${storeOrderSpecialId}`, { private: false }, 401)).json()).toEqual({
        error: "unauthorized", message: "Unauthorized Flarex executor request.",
      });
      await request("/store/orders", { headers: { "x-customer-id": "cus-create-root" } }, 401);
      await request(`/store/orders/${storeOrderSpecialId}`, { headers: { "x-publishable-api-key": storeCartRevokedToken } }, 400);
      for (const id of ["missing", storeOrderDraftId, storeOrderDeletedId]) await request(`/store/orders/${id}`, {}, 404);
      await request(`/store/orders/${storeOrderSpecialId}?fields=id,unsupported`, {}, 400);
      for (const path of ["/store/orders?fields=id,unsupported", "/store/orders?limit=51", "/store/orders?customer_id=cus-store-other"])
        await request(path, { headers: owner }, 400);
      await host.stop(); expect(await observe()).toEqual(baseline);

      phase = "native public Order detail"; host.start(); await host.ready();
      const detail = orderBody(await (await request(`/store/orders/${storeOrderSpecialId}`)).json()).order;
      expect(detail).toMatchObject({ id: storeOrderSpecialId, total: 10, currency_code: "usd", payment_status: "captured", fulfillment_status: "delivered",
        items: [{ quantity: 1, unit_price: 10, detail: { fulfilled_quantity: 1 }, variant: { id: "variant-create-root", product: { id: "prod-create-root" } } }] });
      for (const field of ["summary", "display_id", "created_at", "updated_at", "original_total", "tax_total", "shipping_methods", "credit_lines"]) expect(detail).toHaveProperty(field);
      expect(rows(detail.payment_collections)).toHaveLength(2); expect(rows(detail.fulfillments)).toHaveLength(2);
      const rich = orderBody(await (await request(`/store/orders/${storeOrderSpecialId}?fields=id,*fulfillments,*fulfillments.items,*fulfillments.labels,*fulfillments.delivery_address`)).json()).order;
      expect(rows(rich.fulfillments).find(row => row.id === `ful-${storeOrderSpecialId}`)).toMatchObject({ items: [{ quantity: 1, sku: "store-order-sku" }],
        labels: [{ tracking_number: "STORE-NATIVE-1" }], delivery_address: { city: "Native delivery" } });
      expect(orderBody(await (await request(`/store/orders/${storeOrderSpecialId}?fields=id`)).json()).order)
        .toMatchObject({ id: storeOrderSpecialId, payment_status: "captured", fulfillment_status: "delivered" });
      expect(orderBody(await (await request(`/store/orders/${storeOrderEmptyId}?fields=id`)).json()).order)
        .toMatchObject({ id: storeOrderEmptyId, payment_status: "not_paid", fulfillment_status: "not_fulfilled" });
      expect(orderBody(await (await request(`/store/orders/${storeOrderOtherId}?fields=id`)).json()).order.id).toBe(storeOrderOtherId);
      await host.stop(); expect(await observe()).toEqual(baseline);

      phase = "native Customer order pages"; host.start(); await host.ready();
      const first = pageBody(await (await request("/store/orders", { headers: owner })).json());
      expect(first).toMatchObject({ count: 53, offset: 0, limit: 50 }); expect(first.orders.map(row => row.id)).toEqual(storeOrderIds.slice(0, 50));
      expect(first.orders[0]).toMatchObject({ payment_status: "captured", fulfillment_status: "delivered" });
      expect(first.orders[1]).toMatchObject({ payment_status: "authorized", fulfillment_status: "shipped" });
      expect(first.orders.every(row => row.payment_collections === undefined && row.fulfillments === undefined)).toBe(true);
      const last = pageBody(await (await request("/store/orders?fields=id&offset=50", { headers: owner })).json());
      expect(last).toMatchObject({ count: 53, offset: 50, limit: 50 }); expect(last.orders.map(row => row.id)).toEqual(storeOrderIds.slice(50));
      expect(last.orders[0]).toMatchObject({ payment_status: "authorized", fulfillment_status: "shipped" });
      expect(last.orders[2]).toMatchObject({ payment_status: "not_paid", fulfillment_status: "not_fulfilled" });
      const reverse = pageBody(await (await request("/store/orders?fields=id&limit=2&offset=1&order=-id", { headers: owner })).json());
      expect(reverse).toMatchObject({ count: 53, offset: 1, limit: 2 }); expect(reverse.orders.map(row => row.id)).toEqual([storeOrderIds[51], storeOrderIds[50]]);
      expect(pageBody(await (await request("/store/orders?fields=id", { headers: other })).json())).toMatchObject({ count: 1, orders: [{ id: storeOrderOtherId }] });
      const filters = new URLSearchParams({ fields: "id" }); filters.set("$or[0][id]", storeOrderOtherId); filters.set("$or[1][id]", storeOrderDraftId);
      filters.set("$or[2][id]", storeOrderSpecialId); filters.set("$and[0][status]", "pending");
      expect(pageBody(await (await request("/store/orders?" + filters, { headers: owner })).json())).toMatchObject({ count: 1, orders: [{ id: storeOrderSpecialId }] });
      expect(pageBody(await (await request("/store/orders?id=missing&fields=id", { headers: owner })).json())).toMatchObject({ count: 0, orders: [] });
      await host.stop(); expect(await observe()).toEqual(baseline);

      phase = "cold recreation"; host.start(); await host.ready();
      expect(orderBody(await (await request(`/store/orders/${storeOrderSpecialId}?fields=id,payment_status,fulfillment_status`)).json()).order)
        .toMatchObject({ id: storeOrderSpecialId, payment_status: "captured", fulfillment_status: "delivered" });
      expect(pageBody(await (await request("/store/orders?fields=id,payment_status,fulfillment_status&limit=1", { headers: owner })).json()))
        .toMatchObject({ count: 53, limit: 1, orders: [{ id: storeOrderSpecialId, status: "pending", version: 1, payment_status: "captured", fulfillment_status: "delivered",
          items: [{ id: `item-${storeOrderSpecialId}`, quantity: 1, detail: { fulfilled_quantity: 1 } }] }] });
      expect(cartBody(await (await request("/store/carts/cart-store-order-compat")).json()).cart).toMatchObject({
        id: "cart-store-order-compat", total: 12.5, customer: { id: "cus-create-root", groups: [{ id: "cusgroup-create-root" }] },
        items: [{ variant_id: "variant-create-root", quantity: 1, unit_price: 12.5, product: { id: "prod-create-root" } }],
      });
      await host.stop(); expect(await observe()).toEqual(baseline);
    } catch (cause) { console.error("Store Order DO proof failed", { phase }); primary.push(cause); throw cause; }
    finally {
      const failures: unknown[] = [];
      try { await scenario?.stop(); } catch (cause) { failures.push(cause); }
      try { await prepared?.fixture.close(); } catch (cause) { failures.push(cause); }
      try { await physical.close(); } catch (cause) { failures.push(cause); }
      if (failures.length > 0) throw new AggregateError([...primary, ...failures], "Store Order DO proof cleanup failed");
    }
  }, 600_000);
});
