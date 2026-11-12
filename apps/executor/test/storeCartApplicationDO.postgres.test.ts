import { readFile } from "node:fs/promises";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { createCorePostgresFixture } from "@flarex/persistence-postgres/internal/system-test/core-persistence-fixture";
import { prepareStoreCartRequestFixture, observeStoreCartRequestFixture } from "@flarex/medusa-adapter/internal/system-test/store-cart-request-fixture";
import { storeCartRequestTarget, storeCartToken, storeCartMultiToken, storeCartRevokedToken, storeCartPromotionSeedRows } from "@flarex/medusa-adapter/internal/system-test/store-cart-request-catalog";
import { executorApplicationProfileFixture } from "./support/executorApplicationConfiguration";
import { createMedusaDOTestSuite } from "./support/medusaDOTestRunner";

const endpointPath = process.env.FLAREX_CORE_POSTGRES_ENDPOINTS_FILE;
const endpoints = endpointPath === undefined ? undefined : Schema.decodeUnknownSync(Schema.Struct({ connectionString: Schema.NonEmptyString,
  provisioningConnectionString: Schema.NonEmptyString }))(JSON.parse(await readFile(endpointPath, "utf8")));
const suite = createMedusaDOTestSuite(new URL("./storeCartApplicationDO.workerd.worker.ts", import.meta.url));
const decodeCart = Schema.decodeUnknownSync(Schema.Struct({ cart: Schema.JsonObject }));
const decodeId = Schema.decodeUnknownSync(Schema.NonEmptyString);
const isCreatedEnvelope = Schema.is(Schema.Struct({ contract: Schema.Literal("cart.created") }));
const isUpdatedEnvelope = Schema.is(Schema.Struct({ contract: Schema.Literal("cart.updated") }));
const isCartModuleEnvelope = Schema.is(Schema.Struct({ message: Schema.Struct({
  metadata: Schema.Struct({ source: Schema.Literal("cart"), object: Schema.String, action: Schema.String }),
  data: Schema.Struct({ id: Schema.Union([Schema.String, Schema.Array(Schema.String)]) }) }) }));

describe.runIf(endpoints !== undefined)("native Store Cart HTTP in the actual application DO", () => {
  it("creates and refetches native guest and customer Carts, refuses invalid requests without writes and preserves the graph across recreation", async () => {
    if (endpoints === undefined) throw new Error("Store Cart DO requires ordinary PostgreSQL");
    const physical = await createCorePostgresFixture(endpoints);
    let prepared: Awaited<ReturnType<typeof prepareStoreCartRequestFixture>> | undefined;
    let scenario: Awaited<ReturnType<typeof suite.createScenario>> | undefined;
    let phase = "bootstrap";
    const primary: unknown[] = [];
    try {
      prepared = await prepareStoreCartRequestFixture("postgres", { physical: { ...physical, close: async () => {} }, additionalRows: storeCartPromotionSeedRows });
      await prepared.fixture.close();
      const baseline = await observeStoreCartRequestFixture({ physical, catalog: prepared.catalog });
      const profile = { ...executorApplicationProfileFixture(), ...storeCartRequestTarget,
        persistenceNamespace: physical.namespace, instanceName: physical.instanceName };
      scenario = await suite.createScenario({ profile, connectionString: endpoints.connectionString,
        privateToken: "private-store-cart-do-proof", className: "NativeStoreCartApplicationFixture", hostname: "native-store-cart.test",
        headers: { "x-publishable-api-key": storeCartToken, origin: "https://store.test" } });
      const host = scenario;
      const request = async (path: string, options: Parameters<typeof host.request>[1] = {}, status = 200) => {
        const response = await host.request(path, options);
        expect(response.status, await response.clone().text()).toBe(status);
        return response;
      };
      phase = "invalid requests"; host.start(); await host.ready();
      await request("/store/carts", { method: "POST", body: {}, private: false }, 401);
      for (const token of ["pk_missing", storeCartRevokedToken])
        await request("/store/carts", { method: "POST", body: {}, headers: { "x-publishable-api-key": token } }, 400);
      await request("/store/carts", { method: "POST", body: {}, headers: { "x-publishable-api-key": storeCartMultiToken } }, 400);
      const mismatch = await request("/store/carts", { method: "POST", body: { sales_channel_id: "sc-unrelated" } }, 400);
      expect(await mismatch.json()).toMatchObject({ errors: [expect.stringContaining("not associated")],
        message: "Provided request body contains errors. Please check the data and retry the request" });
      await request("/store/carts?fields=id,unsupported_field", { method: "POST", body: {} }, 400);
      await request("/store/carts", { method: "POST", body: { email: null } }, 400);
      await request("/store/carts/missing", {}, 404);
      await request("/store/carts/missing/complete", { method: "POST", body: {} }, 404);
      await host.stop();
      expect(await observeStoreCartRequestFixture({ physical, catalog: prepared.catalog })).toEqual(baseline);

      phase = "native business refusal"; host.start(); await host.ready();
      await request("/store/carts", { method: "POST", body: { items: [{ variant_id: "variant-create-root", quantity: 4 }] } }, 400);
      await host.stop();
      // The native outer owner records an acquired request's terminal failure.
      // Every business row, index and revision remains exactly unchanged.
      const rejected = await observeStoreCartRequestFixture({ physical, catalog: prepared.catalog });
      expect(rejected).toEqual({ ...baseline, outcomes: [...baseline.outcomes,
        expect.objectContaining({ value: expect.objectContaining({ kind: "nativeRoot", state: "failed" }) })] });

      phase = "creation"; host.start(); await host.ready();
      const guestResponse = await request("/store/carts", { method: "POST", body: {}, headers: { "x-customer-id": "cus-create-root" } });
      expect(guestResponse.headers.get("access-control-allow-origin")).toBe("https://store.test");
      let guest = decodeCart(await guestResponse.json()).cart;
      const guestId = decodeId(guest.id);
      expect(guest).toMatchObject({ currency_code: "usd", region_id: "reg-create-root", sales_channel_id: "sc-create-root",
        items: [], total: 0, subtotal: 0, tax_total: 0 });
      // Native RemoteJoiner assigns an absent cross-module target as undefined;
      // JSON omits it while retaining the Cart's nullable source identity.
      expect(guest).toMatchObject({ customer_id: null });
      expect(guest).not.toHaveProperty("customer");
      expect(decodeCart(await (await request(`/store/carts/${guestId}`)).json()).cart).toEqual(guest);
      expect(await (await request(`/store/carts/${guestId}?fields=id,currency_code,region.id`)).json())
        .toEqual({ cart: { id: guestId, currency_code: "usd", region_id: "reg-create-root", region: { id: "reg-create-root" } } });
      const customerResponse = await request("/store/carts", { method: "POST", body: { items: [{ variant_id: "variant-create-root", quantity: 1 }] },
        headers: { "x-proof-customer-credential": "store-cart-verified-secret" } });
      let customer = decodeCart(await customerResponse.json()).cart;
      const customerId = decodeId(customer.id);
      expect(customer).toMatchObject({ customer: { id: "cus-create-root", email: "native-cart@example.com", groups: [{ id: "cusgroup-create-root" }] },
        subtotal: 12.5, items: [{ variant_id: "variant-create-root", product_id: "prod-create-root", quantity: 1, unit_price: 12.5,
          tax_lines: [{ rate: 10, code: "NATIVE-US" }], adjustments: [{ code: "NATIVE-CART", amount: 1 }] }],
        promotions: [{ code: "NATIVE-CART" }] });
      const items = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(customer.items);
      expect(items[0]).not.toHaveProperty("variant");
      expect(Schema.decodeUnknownSync(Schema.JsonObject)(customer.shipping_address)).not.toHaveProperty("region_code");
      expect(await (await request(`/store/carts/${customerId}?fields=id,items.variant.id`)).json())
        .toMatchObject({ cart: { id: customerId, items: [{ variant: { id: "variant-create-root" } }] } });
      await host.stop();
      let committed = await observeStoreCartRequestFixture({ physical, catalog: prepared.catalog });
      const cartTable = prepared.catalog.sources.find(source => source.name === "cart")?.definition.tables.find(table => table.localName === "cart")?.name;
      if (cartTable === undefined) throw new Error("Missing native Cart table identity");
      const initialCartCount = baseline.rows.filter(row => row.table === cartTable).length;
      expect(committed.rows.filter(row => row.table === cartTable)).toHaveLength(initialCartCount + 2);
      expect(committed.outcomes.filter(row => row.value.kind === "nativeRoot" && row.value.state === "committed")).toHaveLength(2);
      expect(committed.outcomes.filter(row => row.value.kind === "nativeRoot" && row.value.state === "failed"))
        .toEqual(rejected.outcomes.filter(row => row.value.kind === "nativeRoot" && row.value.state === "failed"));
      const createdEvents = committed.rows.filter(row => isCreatedEnvelope(row.value.envelope));
      expect(createdEvents).toHaveLength(2);
      for (const id of [guestId, customerId]) {
        const cartRow = committed.rows.find(row => row.table === cartTable && row.value.id === id);
        expect(createdEvents).toContainEqual(expect.objectContaining({ timestamp: cartRow?.timestamp }));
        expect(committed.outcomes).toContainEqual(expect.objectContaining({ timestamp: cartRow?.timestamp }));
      }

      phase = "native promotion codes and Payment refresh"; host.start(); await host.ready();
      const historyId = "cart-http-promotion-equal";
      let historyCart = decodeCart(await (await request(`/store/carts/${historyId}`)).json()).cart;
      for (let attempt = 0; attempt < 2; attempt++) {
        historyCart = decodeCart(await (await request(`/store/carts/${historyId}/promotions`, { method: "POST", body: { promo_codes: ["HTTP-CART"] } })).json()).cart;
        expect(historyCart).toMatchObject({ id: historyId, discount_total: 3.3, total: 10.45,
          promotions: expect.arrayContaining([expect.objectContaining({ id: "promo-create-root", code: "NATIVE-CART", is_automatic: true }),
          expect.objectContaining({ code: "HTTP-CART", is_automatic: false })]) });
        expect(Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(historyCart.promotions)).toHaveLength(2);
      }
      historyCart = decodeCart(await (await request(`/store/carts/${historyId}/promotions`, { method: "DELETE", body: { promo_codes: ["HTTP-CART"] } })).json()).cart;
      expect(historyCart).toMatchObject({ discount_total: 1.1, total: 12.65, promotions: [{ code: "NATIVE-CART" }] });
      historyCart = decodeCart(await (await request(`/store/carts/${historyId}/promotions`, { method: "POST", body: { promo_codes: ["HTTP-CART"] } })).json()).cart;
      expect(historyCart).toMatchObject({ discount_total: 3.3, total: 10.45 });
      historyCart = decodeCart(await (await request(`/store/carts/${historyId}/promotions`, { method: "POST", body: { promo_codes: [] } })).json()).cart;
      expect(historyCart).toMatchObject({ discount_total: 1.1, total: 12.65, promotions: [{ code: "NATIVE-CART" }] });
      const paymentCart = decodeCart(await (await request("/store/carts/cart-http-promotion-payment/promotions", {
        method: "POST", body: { promo_codes: ["HTTP-CART"] } })).json()).cart;
      expect(paymentCart).toMatchObject({ id: "cart-http-promotion-payment", discount_total: 3.3, total: 10.45,
        payment_collection: { id: "paycol-http-promotions", amount: 10.45, payment_sessions: [] } });
      await host.stop();
      const promoted = await observeStoreCartRequestFixture({ physical, catalog: prepared.catalog });
      expect(promoted.outcomes.filter(row => row.value.kind === "nativeRoot" && row.value.state === "committed")).toHaveLength(8);
      expect(promoted.rows.filter(row => isCreatedEnvelope(row.value.envelope))).toEqual(createdEvents);
      expect(promoted.rows.filter(row => isUpdatedEnvelope(row.value.envelope))).toEqual([]);
      const paymentCollectionTable = prepared.catalog.sources.find(source => source.name === "payment")?.definition.tables.find(table => table.localName === "payment_collection")?.name;
      const paymentRow = promoted.rows.find(row => row.table === paymentCollectionTable && row.value.id === "paycol-http-promotions");
      expect(paymentRow).toBeDefined();
      expect(promoted.outcomes).toContainEqual(expect.objectContaining({ timestamp: paymentRow?.timestamp,
        value: expect.objectContaining({ kind: "nativeRoot", state: "committed" }) }));
      const paymentEvents = promoted.rows.filter(row => row.timestamp === paymentRow?.timestamp && row.value.envelope !== undefined);
      expect(paymentEvents).toEqual(expect.arrayContaining([
        expect.objectContaining({ value: expect.objectContaining({ envelope: expect.objectContaining({ contract: "payment.payment-collection.updated" }) }) }),
        expect.objectContaining({ value: expect.objectContaining({ envelope: expect.objectContaining({ contract: "payment.payment-session.deleted" }) }) }),
      ]));
      phase = "line item update after promotion history"; host.start(); await host.ready();
      historyCart = decodeCart(await (await request(`/store/carts/${historyId}/line-items`, { method: "POST", body: {
        variant_id: "variant-create-root", quantity: 1 } })).json()).cart;
      expect(historyCart).toMatchObject({ subtotal: 25, items: [{ quantity: 2 }] });
      await host.stop();
      const afterHistory = await observeStoreCartRequestFixture({ physical, catalog: prepared.catalog });
      expect(afterHistory.outcomes.filter(row => row.value.kind === "nativeRoot" && row.value.state === "committed")).toHaveLength(9);
      expect(afterHistory.rows.filter(row => isUpdatedEnvelope(row.value.envelope))).toHaveLength(1);

      phase = "complete lifecycle history deletion"; host.start(); await host.ready();
      const historyItems = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(historyCart.items);
      const historyLineId = decodeId(historyItems[0]?.id);
      const historyDeleted = await (await request(`/store/carts/${historyId}/line-items/${historyLineId}`, { method: "DELETE" })).json();
      expect(historyDeleted).toMatchObject({ id: historyLineId, object: "line-item", deleted: true, parent: { id: historyId, items: [], total: 0 } });
      historyCart = Schema.decodeUnknownSync(Schema.Struct({ parent: Schema.JsonObject }))(historyDeleted).parent;
      expect(decodeCart(await (await request(`/store/carts/${historyId}`)).json()).cart).toEqual(historyCart);
      await host.stop();
      committed = await observeStoreCartRequestFixture({ physical, catalog: prepared.catalog });
      const historyKeys = new Set(afterHistory.outcomes.map(outcome => outcome.value.key));
      const historyOutcomes = committed.outcomes.filter(outcome => !historyKeys.has(outcome.value.key));
      expect(historyOutcomes).toEqual([expect.objectContaining({ value: expect.objectContaining({ kind: "nativeRoot", state: "committed" }) })]);
      const historyLine = committed.rows.find(row => row.value.id === historyLineId);
      expect(historyLine?.value.deleted_at).toEqual(expect.any(String));
      expect(historyOutcomes[0]?.timestamp).toEqual(historyLine?.timestamp);
      const historyMessages = committed.rows.filter(row => row.timestamp === historyLine?.timestamp).map(row => row.value.envelope)
        .filter(isCartModuleEnvelope).map(envelope => envelope.message);
      for (const object of ["line_item_tax_line", "line_item_adjustment"]) {
        const table = prepared.catalog.sources.find(source => source.name === "cart")?.definition.tables.find(table => table.localName === `cart_${object}`)?.name;
        if (table === undefined) throw new Error("Missing native Cart descendant table");
        const children = afterHistory.rows.filter(row => row.table === table && row.value.item_id === historyLineId);
        expect(children.length).toBeGreaterThan(object === "line_item_adjustment" ? 8 : 0);
        for (const child of children) {
          const { deleted_at: _deleted, updated_at: _updated, ...retained } = child.value;
          const changed = committed.rows.find(row => row.table === table && row.value.id === child.value.id);
          expect(changed).toMatchObject({ timestamp: historyLine?.timestamp,
            value: { ...retained, deleted_at: expect.any(String), updated_at: expect.any(String) } });
        }
        for (const action of ["deleted", "updated"]) {
          const actual = historyMessages.filter(message => message.metadata.object === object && message.metadata.action === action)
            .flatMap(message => typeof message.data.id === "string" ? [message.data.id] : message.data.id).sort();
          const expected = children.filter(child => action === "deleted" ? child.value.deleted_at === null : child.value.deleted_at !== null)
            .map(child => child.value.id).sort();
          expect(actual).toEqual(expected);
        }
      }
      expect(committed.rows.filter(row => isUpdatedEnvelope(row.value.envelope))).toHaveLength(2);
      phase = "mutation projection refusal"; host.start(); await host.ready();
      await request(`/store/carts/${guestId}?fields=id,unsupported_field`, { method: "POST", body: { metadata: { refused: true } } }, 400);
      const firstLineId = decodeId(items[0]?.id);
      await request(`/store/carts/${customerId}/line-items/${firstLineId}?fields=id,unsupported_field`, { method: "DELETE" }, 400);
      for (const method of ["POST", "DELETE"] as const) {
        await request(`/store/carts/${customerId}/promotions?fields=id,unsupported_field`, { method, body: { promo_codes: ["HTTP-CART"] } }, 400);
        await request(`/store/carts/${customerId}/promotions`, { method, body: { promo_codes: "HTTP-CART" } }, 400);
        await request(`/store/carts/${customerId}/promotions`, { method, body: { promo_codes: ["HTTP-CART"] },
          headers: { "x-publishable-api-key": storeCartRevokedToken } }, 400);
      }
      await host.stop();
      expect(await observeStoreCartRequestFixture({ physical, catalog: prepared.catalog })).toEqual(committed);

      phase = "native mutation rollback"; host.start(); await host.ready();
      await request(`/store/carts/${guestId}`, { method: "POST", body: { metadata: { rejected_hook: true },
        additional_data: { fail_cart_hook: true } } }, 500);
      await host.stop();
      const lateRejected = await observeStoreCartRequestFixture({ physical, catalog: prepared.catalog });
      const priorKeys = new Set(committed.outcomes.map(outcome => outcome.value.key));
      const lateOutcomes = lateRejected.outcomes.filter(outcome => !priorKeys.has(outcome.value.key));
      expect(lateOutcomes).toEqual([expect.objectContaining({ value: expect.objectContaining({ kind: "nativeRoot", state: "failed" }) })]);
      expect(lateRejected.outcomes).toHaveLength(committed.outcomes.length + 1);
      expect(lateRejected).toEqual({ ...committed, outcomes: expect.arrayContaining([...committed.outcomes, ...lateOutcomes]) });

      phase = "Cart and Line Item mutations"; host.start(); await host.ready();
      guest = decodeCart(await (await request(`/store/carts/${guestId}`, { method: "POST", body: { metadata: { cart_updated: true },
        billing_address: { country_code: "us", city: "Workerd address" } } })).json()).cart;
      expect(guest).toMatchObject({ id: guestId, metadata: { cart_updated: true }, billing_address: { city: "Workerd address" } });
      customer = decodeCart(await (await request(`/store/carts/${customerId}/line-items`, { method: "POST", body: {
        variant_id: "variant-create-root", quantity: 1 } })).json()).cart;
      expect(customer).toMatchObject({ subtotal: 25, items: [{ id: firstLineId, quantity: 2 }] });
      customer = decodeCart(await (await request(`/store/carts/${customerId}/line-items/${firstLineId}`, { method: "POST", body: {
        quantity: 1, metadata: { edited: true } } })).json()).cart;
      expect(customer).toMatchObject({ subtotal: 12.5, items: [{ id: firstLineId, quantity: 1, metadata: { edited: true } }] });
      const deleted = await (await request(`/store/carts/${customerId}/line-items/${firstLineId}`, { method: "DELETE" })).json();
      expect(deleted).toMatchObject({ id: firstLineId, object: "line-item", deleted: true, parent: { id: customerId, items: [] } });
      const again = decodeCart(await (await request(`/store/carts/${customerId}/line-items`, { method: "POST", body: {
        variant_id: "variant-create-root", quantity: 1 } })).json()).cart;
      const againItems = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(again.items);
      customer = decodeCart(await (await request(`/store/carts/${customerId}/line-items/${decodeId(againItems[0]?.id)}`, {
        method: "POST", body: { quantity: 0 } })).json()).cart;
      expect(customer.items).toEqual([]);
      await host.stop();
      const mutated = await observeStoreCartRequestFixture({ physical, catalog: prepared.catalog });
      expect(mutated.rows.filter(row => row.table === cartTable)).toHaveLength(initialCartCount + 2);
      expect(mutated.outcomes.filter(row => row.value.kind === "nativeRoot" && row.value.state === "committed")).toHaveLength(16);
      expect(mutated.outcomes.filter(row => row.value.kind === "nativeRoot" && row.value.state === "failed"))
        .toEqual(lateRejected.outcomes.filter(row => row.value.kind === "nativeRoot" && row.value.state === "failed"));
      const updatedEvents = mutated.rows.filter(row => isUpdatedEnvelope(row.value.envelope));
      expect(updatedEvents).toHaveLength(9);
      for (const event of updatedEvents) expect(mutated.outcomes).toContainEqual(expect.objectContaining({ timestamp: event.timestamp,
        value: expect.objectContaining({ state: "committed" }) }));
      expect(mutated.rows.filter(row => isCreatedEnvelope(row.value.envelope))).toEqual(createdEvents);

      phase = "recreation"; host.start(); await host.ready();
      expect(decodeCart(await (await request(`/store/carts/${guestId}`)).json()).cart).toEqual(guest);
      // GET retains the native publishable-key contract; no customer ownership
      // policy is invented by the adapter during public Cart retrieval.
      expect(decodeCart(await (await request(`/store/carts/${customerId}`)).json()).cart).toEqual(customer);
      expect(decodeCart(await (await request("/store/carts/cart-http-promotion-payment")).json()).cart).toEqual(paymentCart);
      expect(decodeCart(await (await request(`/store/carts/${historyId}`)).json()).cart).toEqual(historyCart);
      await request(`/store/carts/${customerId}`, { headers: { "x-publishable-api-key": storeCartRevokedToken } }, 400);
      await host.stop();
      expect(await observeStoreCartRequestFixture({ physical, catalog: prepared.catalog })).toEqual(mutated);
    } catch (cause) { console.error("Store Cart DO proof failed", { phase }); primary.push(cause); throw cause; }
    finally {
      const failures: unknown[] = [];
      try { await scenario?.stop(); } catch (cause) { failures.push(cause); }
      try { await prepared?.fixture.close(); } catch (cause) { failures.push(cause); }
      try { await physical.close(); } catch (cause) { failures.push(cause); }
      if (failures.length > 0) throw new AggregateError([...primary, ...failures], "Store Cart DO proof cleanup failed");
    }
  }, 600_000);
});
