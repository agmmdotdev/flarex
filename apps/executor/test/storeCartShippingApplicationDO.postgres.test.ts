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
const decodeOptions = Schema.decodeUnknownSync(Schema.Struct({ shipping_options: Schema.Array(Schema.JsonObject) }));
const decodeRows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const decodeId = Schema.decodeUnknownSync(Schema.NonEmptyString);
const isUpdatedEnvelope = Schema.is(Schema.Struct({ contract: Schema.Literal("cart.updated") }));

describe.runIf(endpoints !== undefined)("native Store Cart Shipping HTTP in the actual application DO", () => {
  it("discovers eligible options, replaces native methods with Tax, promotions and Payment, rolls back failure and survives recreation", async () => {
    if (endpoints === undefined) throw new Error("Store Cart Shipping DO requires ordinary PostgreSQL");
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
        privateToken: "private-store-cart-shipping-do-proof", className: "NativeStoreCartApplicationFixture", hostname: "native-store-cart-shipping.test",
        headers: { "x-publishable-api-key": storeCartToken, origin: "https://store.test" } });
      const host = scenario;
      const request = async (path: string, options: Parameters<typeof host.request>[1] = {}, status = 200) => {
        const response = await host.request(path, options);
        expect(response.status, await response.clone().text()).toBe(status);
        return response;
      };
      const cartPath = "/store/carts/cart-http-shipping";
      phase = "HTTP validation"; host.start(); await host.ready();
      await request("/store/shipping-options", {}, 400);
      await request("/store/shipping-options?cart_id=cart-http-shipping", { private: false }, 401);
      await request("/store/shipping-options?cart_id=cart-http-shipping&fields=unsupported", {}, 400);
      await request("/store/shipping-options?cart_id=cart-http-shipping", { headers: { "x-publishable-api-key": storeCartRevokedToken } }, 400);
      await request(`${cartPath}/shipping-methods`, { method: "POST", body: {} }, 400);
      await request(`${cartPath}/shipping-methods`, { method: "POST", body: { option_id: "so-http-shipping-standard", amount: 0 } }, 400);
      await request(`${cartPath}/shipping-methods`, { method: "POST", body: { option_id: "so-http-shipping-standard", additional_data: {} } }, 400);
      await request(`${cartPath}/shipping-methods?fields=id,unsupported`, { method: "POST", body: { option_id: "so-http-shipping-standard" } }, 400);
      await request(`${cartPath}/shipping-methods`, { method: "POST", body: { option_id: "so-http-shipping-standard" },
        headers: { "x-publishable-api-key": storeCartRevokedToken } }, 400);
      await host.stop();
      expect(await observeStoreCartRequestFixture({ physical, catalog: prepared.catalog })).toEqual(baseline);

      phase = "native option discovery"; host.start(); await host.ready();
      const options = decodeOptions(await (await request("/store/shipping-options?cart_id=cart-http-shipping&fields=id&limit=1")).json()).shipping_options;
      expect(options.map(option => option.id).sort()).toEqual(["so-http-shipping-express", "so-http-shipping-standard"]);
      expect(options).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "so-http-shipping-standard", amount: 5, price_type: "flat", insufficient_inventory: false }),
        expect.objectContaining({ id: "so-http-shipping-express", amount: 8, price_type: "flat", insufficient_inventory: false }),
      ]));
      const returned = decodeOptions(await (await request("/store/shipping-options?cart_id=cart-http-shipping&is_return=true")).json()).shipping_options;
      expect(returned.map(option => option.id)).toEqual(["so-http-shipping-return"]);
      const unavailable = decodeOptions(await (await request("/store/shipping-options?cart_id=cart-http-shipping-inventory")).json()).shipping_options;
      expect(unavailable).toHaveLength(2);
      expect(unavailable.every(option => option.insufficient_inventory === true)).toBe(true);
      const calculated = decodeOptions(await (await request("/store/shipping-options?cart_id=cart-http-shipping-calculated")).json()).shipping_options;
      expect(calculated).toEqual([expect.objectContaining({ id: "so-http-shipping-calculated", price_type: "calculated", is_tax_inclusive: false })]);
      expect(calculated[0]).not.toHaveProperty("amount");
      await host.stop();
      const discovered = await observeStoreCartRequestFixture({ physical, catalog: prepared.catalog });
      expect(discovered.rows).toEqual(baseline.rows);
      expect(discovered.revisions).toEqual(baseline.revisions);
      expect(discovered.indexes).toEqual(baseline.indexes);

      phase = "unsupported native Manual quote"; host.start(); await host.ready();
      await request("/store/carts/cart-http-shipping-calculated/shipping-methods", { method: "POST", body: { option_id: "so-http-shipping-calculated" } }, 500);
      await host.stop();
      const quoteRefused = await observeStoreCartRequestFixture({ physical, catalog: prepared.catalog });
      expect(quoteRefused).toEqual({ ...discovered, outcomes: [...discovered.outcomes,
        expect.objectContaining({ value: expect.objectContaining({ kind: "nativeRoot", state: "failed" }) })] });

      phase = "native selection"; host.start(); await host.ready();
      const first = decodeCart(await (await request(`${cartPath}/shipping-methods`, { method: "POST", body: {
        option_id: "so-http-shipping-standard", data: { delivery_note: "Worker Manual provider" },
      } })).json()).cart;
      expect(first).toMatchObject({ total: 14.85, shipping_subtotal: 5,
        shipping_methods: [{ shipping_option_id: "so-http-shipping-standard", amount: 5,
          tax_lines: [{ code: "NATIVE-US", rate: 10 }], adjustments: [{ amount: 3 }] }],
        payment_collection: { id: "paycol-http-shipping", amount: 14.85, payment_sessions: [] } });
      const firstMethod = decodeId(decodeRows(first.shipping_methods)[0]?.id);
      expect(decodeRows(first.shipping_methods)[0]).not.toHaveProperty("data");
      const explicitData = decodeCart(await (await request(`${cartPath}?fields=%2Bshipping_methods.data`)).json()).cart;
      expect(decodeRows(explicitData.shipping_methods)[0]).toMatchObject({ id: firstMethod, data: { delivery_note: "Worker Manual provider" } });
      await host.stop();
      const selected = await observeStoreCartRequestFixture({ physical, catalog: prepared.catalog });
      expect(selected.rows.find(row => row.value.id === firstMethod)?.value.data).toEqual({ delivery_note: "Worker Manual provider" });
      const retainedChildren = selected.rows.filter(row => row.value.shipping_method_id === firstMethod);
      expect(retainedChildren.length).toBeGreaterThanOrEqual(2);

      phase = "native replacement"; host.start(); await host.ready();
      const replaced = decodeCart(await (await request(`${cartPath}/shipping-methods`, { method: "POST", body: {
        option_id: "so-http-shipping-express", data: { delivery_note: "Express replacement" },
      } })).json()).cart;
      expect(replaced).toMatchObject({ total: 18.15, shipping_subtotal: 8,
        shipping_methods: [{ shipping_option_id: "so-http-shipping-express", amount: 8,
          tax_lines: [{ code: "NATIVE-US", rate: 10 }], adjustments: [{ amount: 3 }] }],
        payment_collection: { id: "paycol-http-shipping", amount: 18.15, payment_sessions: [] } });
      expect(decodeRows(replaced.shipping_methods)).toHaveLength(1);
      const currentMethod = decodeId(decodeRows(replaced.shipping_methods)[0]?.id);
      expect(decodeRows(replaced.shipping_methods)[0]).not.toHaveProperty("data");
      expect(currentMethod).not.toBe(firstMethod);
      await host.stop();
      const committed = await observeStoreCartRequestFixture({ physical, catalog: prepared.catalog });
      expect(committed.rows.find(row => row.value.id === currentMethod)?.value.data).toEqual({ delivery_note: "Express replacement" });
      const methods = committed.rows.filter(row => row.value.cart_id === "cart-http-shipping" &&
        [firstMethod, currentMethod].includes(decodeId(row.value.id)));
      expect(methods).toEqual(expect.arrayContaining([
        expect.objectContaining({ value: expect.objectContaining({ id: firstMethod, deleted_at: expect.any(String) }) }),
        expect.objectContaining({ value: expect.objectContaining({ id: currentMethod, deleted_at: null }) }),
      ]));
      expect(committed.rows.filter(row => row.value.shipping_method_id === firstMethod)).toEqual(retainedChildren);
      const updated = committed.rows.filter(row => isUpdatedEnvelope(row.value.envelope));
      expect(updated).toHaveLength(2);
      for (const event of updated) expect(committed.outcomes).toContainEqual(expect.objectContaining({ timestamp: event.timestamp,
        value: expect.objectContaining({ kind: "nativeRoot", state: "committed" }) }));

      phase = "late native failure"; host.start(); await host.ready();
      const failed = await request("/store/carts/cart-http-shipping-failure/shipping-methods", { method: "POST", body: {
        option_id: "so-http-shipping-standard",
      } }, 500);
      expect(await failed.json()).toMatchObject({ message: expect.any(String) });
      await host.stop();
      const rejected = await observeStoreCartRequestFixture({ physical, catalog: prepared.catalog });
      const priorKeys = new Set(committed.outcomes.map(outcome => outcome.value.key));
      const failures = rejected.outcomes.filter(outcome => !priorKeys.has(outcome.value.key));
      expect(failures).toEqual([expect.objectContaining({ value: expect.objectContaining({ kind: "nativeRoot", state: "failed" }) })]);
      expect(rejected).toEqual({ ...committed, outcomes: [...committed.outcomes, ...failures] });

      phase = "recreation"; host.start(); await host.ready();
      expect(decodeCart(await (await request(cartPath)).json()).cart).toEqual(replaced);
      expect(decodeOptions(await (await request("/store/shipping-options?cart_id=cart-http-shipping&fields=id&limit=1")).json()).shipping_options).toEqual(options);
      await host.stop();
      const recreated = await observeStoreCartRequestFixture({ physical, catalog: prepared.catalog });
      // List is a genuine native workflow root with a durable result outcome.
      expect(recreated.rows).toEqual(rejected.rows);
      expect(recreated.revisions).toEqual(rejected.revisions);
      expect(recreated.indexes).toEqual(rejected.indexes);
      expect(recreated.outcomes).toEqual(expect.arrayContaining([...rejected.outcomes]));
      expect(recreated.outcomes).toHaveLength(rejected.outcomes.length + 1);
    } catch (cause) { console.error("Store Cart Shipping DO proof failed", { phase }); primary.push(cause); throw cause; }
    finally {
      const failures: unknown[] = [];
      try { await scenario?.stop(); } catch (cause) { failures.push(cause); }
      try { await prepared?.fixture.close(); } catch (cause) { failures.push(cause); }
      try { await physical.close(); } catch (cause) { failures.push(cause); }
      if (failures.length > 0) throw new AggregateError([...primary, ...failures], "Store Cart Shipping DO proof cleanup failed");
    }
  }, 600_000);
});
