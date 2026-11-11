import { readFile } from "node:fs/promises";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { createCorePostgresFixture } from "@flarex/persistence-postgres/internal/system-test/core-persistence-fixture";
import { prepareStoreCartRequestFixture, observeStoreCartRequestFixture } from "@flarex/medusa-adapter/internal/system-test/store-cart-request-fixture";
import { storeCartRequestTarget, storeCartToken, storeCartMultiToken, storeCartRevokedToken } from "@flarex/medusa-adapter/internal/system-test/store-cart-request-catalog";
import { executorApplicationProfileFixture } from "./support/executorApplicationConfiguration";
import { createMedusaDOTestSuite } from "./support/medusaDOTestRunner";

const endpointPath = process.env.FLAREX_CORE_POSTGRES_ENDPOINTS_FILE;
const endpoints = endpointPath === undefined ? undefined : Schema.decodeUnknownSync(Schema.Struct({ connectionString: Schema.NonEmptyString,
  provisioningConnectionString: Schema.NonEmptyString }))(JSON.parse(await readFile(endpointPath, "utf8")));
const suite = createMedusaDOTestSuite(new URL("./storeCartApplicationDO.workerd.worker.ts", import.meta.url));
const decodeCart = Schema.decodeUnknownSync(Schema.Struct({ cart: Schema.JsonObject }));
const decodeId = Schema.decodeUnknownSync(Schema.NonEmptyString);
const isCreatedEnvelope = Schema.is(Schema.Struct({ contract: Schema.Literal("cart.created") }));

describe.runIf(endpoints !== undefined)("native Store Cart HTTP in the actual application DO", () => {
  it("creates and refetches native guest and customer Carts, refuses invalid requests without writes and preserves the graph across recreation", async () => {
    if (endpoints === undefined) throw new Error("Store Cart DO requires ordinary PostgreSQL");
    const physical = await createCorePostgresFixture(endpoints);
    let prepared: Awaited<ReturnType<typeof prepareStoreCartRequestFixture>> | undefined;
    let scenario: Awaited<ReturnType<typeof suite.createScenario>> | undefined;
    let phase = "bootstrap";
    const primary: unknown[] = [];
    try {
      prepared = await prepareStoreCartRequestFixture("postgres", { physical: { ...physical, close: async () => {} } });
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
      await request("/store/carts/missing", { method: "POST", body: {} }, 404);
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
      const guest = decodeCart(await guestResponse.json()).cart, guestId = decodeId(guest.id);
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
      const customer = decodeCart(await customerResponse.json()).cart, customerId = decodeId(customer.id);
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
      const committed = await observeStoreCartRequestFixture({ physical, catalog: prepared.catalog });
      const cartTable = prepared.catalog.sources.find(source => source.name === "cart")?.definition.tables.find(table => table.localName === "cart")?.name;
      if (cartTable === undefined) throw new Error("Missing native Cart table identity");
      expect(committed.rows.filter(row => row.table === cartTable)).toHaveLength(2);
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
      phase = "recreation"; host.start(); await host.ready();
      expect(decodeCart(await (await request(`/store/carts/${guestId}`)).json()).cart).toEqual(guest);
      // GET retains the native publishable-key contract; no customer ownership
      // policy is invented by the adapter during public Cart retrieval.
      expect(decodeCart(await (await request(`/store/carts/${customerId}`)).json()).cart).toEqual(customer);
      await request(`/store/carts/${customerId}`, { headers: { "x-publishable-api-key": storeCartRevokedToken } }, 400);
      await host.stop();
      expect(await observeStoreCartRequestFixture({ physical, catalog: prepared.catalog })).toEqual(committed);
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
