import { createCorePostgresFixture } from "@flarex/persistence-postgres/internal/system-test/core-persistence-fixture";
import { prepareStoreProductRequestFixture, seedStoreProductRequestFixture, observeStoreProductRequestFixture } from "@flarex/medusa-adapter/internal/system-test/store-product-request-fixture";
import { storeProductRequestTarget, storeProductToken, storeProductMultiToken } from "@flarex/medusa-adapter/internal/system-test/store-product-request-catalog";
import { Schema } from "effect";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { executorApplicationProfileFixture } from "./support/executorApplicationConfiguration";
import { createMedusaDOTestSuite } from "./support/medusaDOTestRunner";

const endpointPath = process.env.FLAREX_CORE_POSTGRES_ENDPOINTS_FILE;
const endpoints = endpointPath === undefined ? undefined : Schema.decodeUnknownSync(Schema.Struct({ connectionString: Schema.NonEmptyString,
  provisioningConnectionString: Schema.NonEmptyString }))(JSON.parse(await readFile(endpointPath, "utf8")));
const privateToken = "private-native-store-product-do-proof";
const suite = createMedusaDOTestSuite(new URL("./storeProductApplicationDO.workerd.worker.ts", import.meta.url));
const object = Schema.decodeUnknownSync(Schema.JsonObject);
const products = Schema.decodeUnknownSync(Schema.Struct({ products: Schema.Array(Schema.JsonObject), count: Schema.Number, offset: Schema.Number, limit: Schema.Number }));
const product = Schema.decodeUnknownSync(Schema.Struct({ product: Schema.JsonObject }));
const variants = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const variant = (value: typeof Schema.JsonObject.Type) => {
  const row = variants(value.variants)[0]; if (row === undefined) throw new Error("Native Store DO omitted Variant"); return row;
};

describe.runIf(endpoints !== undefined)("native Store Product reads in the actual application DO", () => {
  it("serves native defaults, customer pricing, tax and channel inventory and preserves every durable row across DO recreation", async () => {
    if (endpoints === undefined) throw new Error("Store Product DO requires ordinary PostgreSQL");
    const physical = await createCorePostgresFixture(endpoints);
    let seed: Awaited<ReturnType<typeof prepareStoreProductRequestFixture>> | undefined;
    let scenario: Awaited<ReturnType<typeof suite.createScenario>> | undefined;
    const primary: unknown[] = [];
    let phase = "initialization";
    try {
      seed = await prepareStoreProductRequestFixture("postgres", { physical: { ...physical, close: async () => {} } });
      const seeded = await seedStoreProductRequestFixture(seed);
      const before = await seed.fixture.inventory();
      const beforePricing = await seed.fixture.readRows("pricing"), beforeLinks = await seed.fixture.readRows("variant_links"), beforeInventory = await seed.fixture.readRows("inventory");
      const saleList = seeded.lists[0];
      if (saleList === undefined) throw new Error("Native Store seed omitted sale PriceList");
      const salePrice = beforePricing.find(row => row.price_set_id === seeded.priceSets.sale && row.price_list_id === saleList.id);
      const saleBase = beforePricing.find(row => row.price_set_id === seeded.priceSets.sale && row.price_list_id === null);
      const basePrice = beforePricing.find(row => row.price_set_id === seeded.priceSets.base && row.price_list_id === null && row.rules_count === 0);
      const overridePrice = beforePricing.find(row => row.price_set_id === seeded.priceSets.override && row.price_list_id === "plist_store_override");
      if (salePrice === undefined || saleBase === undefined || basePrice === undefined || overridePrice === undefined)
        throw new Error("Native Store seed omitted source Price");
      for (const [name, priceSet] of Object.entries(seeded.priceSets)) {
        expect(beforeLinks.filter(row => row.variant_id === `variant_store_${name}` && row.price_set_id === priceSet)).toHaveLength(1);
        expect(beforePricing.filter(row => row.price_set_id === priceSet && row.price_list_id === null)).toHaveLength(name === "base" ? 2 : 1);
        const ownPrice = beforePricing.find(row => row.price_set_id === priceSet && row.price_list_id === null && row.rules_count === 0);
        if (ownPrice === undefined) throw new Error("Native Store seed omitted Variant's base Price");
        expect(Number(ownPrice.amount)).toBe(name === "null" ? 15 : 100);
      }
      expect(new Set(Object.values(seeded.priceSets)).size).toBe(4);
      expect(new Set(Object.values(seeded.inventoryItems)).size).toBe(3);
      expect(beforeInventory).toEqual(expect.arrayContaining(Object.values(seeded.inventoryItems).map(id => expect.objectContaining({ id }))));
      for (const [name, id] of Object.entries(seeded.inventoryItems)) expect(beforeInventory.find(row => row.id === id))
        .toMatchObject({ id, sku: `store-${name}` });
      await seed.fixture.close();
      phase = "bundle";
      const base = executorApplicationProfileFixture();
      const profile = { ...base, ...storeProductRequestTarget, persistenceNamespace: physical.namespace, instanceName: physical.instanceName };
      const host = await suite.createScenario({ profile, connectionString: endpoints.connectionString, privateToken,
        className: "NativeStoreProductApplicationFixture", hostname: "native-store.test",
        headers: { "x-publishable-api-key": storeProductToken, origin: "https://store.test" } });
      scenario = host;
      const request = async (path: string, options: Readonly<{ status?: number; key?: string; customer?: string }> = {}) => {
        phase = path;
        const response = await host.request(path, { headers: {
          ...(options.key === undefined ? {} : { "x-publishable-api-key": options.key }),
          "x-proof-customer-credential": options.customer } });
        const body = object(await response.json()); expect(response.status, JSON.stringify(body)).toBe(options.status ?? 200);
        expect(response.headers.get("access-control-allow-origin")).toBe("https://store.test"); return body;
      };
      phase = "first Worker startup"; host.start(); await host.ready();
      expect((await host.request("/store/products", { private: false,
        headers: { origin: undefined, "x-publishable-api-key": undefined } })).status).toBe(401);
      const defaults = products(await request("/store/products"));
      expect(defaults).toMatchObject({ count: 4, offset: 0, limit: 50 });
      expect(defaults.products.map(row => row.id).toSorted()).toEqual([seeded.baseId, seeded.nullId, seeded.overrideId, seeded.saleId].toSorted());
      expect(variant(defaults.products.find(row => row.id === seeded.baseId) ?? {})).toMatchObject({ id: "variant_store_base", sku: "store-base", manage_inventory: true });
      expect(variant(defaults.products.find(row => row.id === seeded.baseId) ?? {})).not.toHaveProperty("calculated_price");
      expect(products(await request("/store/products?fields=id&order=id&limit=1&offset=1"))).toEqual({ products: [{ id: seeded.nullId }], count: 4, offset: 1, limit: 1 });
      await request(`/store/products/${seeded.draftId}`, { status: 404 });
      await request(`/store/products/${seeded.foreignId}`, { status: 404 });
      expect(product(await request(`/store/products/${seeded.foreignId}?fields=id`, { key: storeProductMultiToken })).product.id).toBe(seeded.foreignId);
      const unselectedCategories = product(await request(`/store/products/${seeded.baseId}?fields=id`)).product;
      expect(variants(unselectedCategories.categories)).toEqual(expect.arrayContaining([{ is_internal: true }, { is_internal: false }]));
      expect(product(await request(`/store/products/${seeded.baseId}?fields=id,categories.id,categories.is_internal`)).product)
        .toEqual({ id: seeded.baseId, categories: [{ id: "pcat_store_public", is_internal: false }] });
      const fields = "id,variants.id,variants.manage_inventory,variants.calculated_price,variants.price_set.id,variants.prices.id,variants.prices.amount";
      const priced = async (name: string, suffix = "", customer?: string) => product(await request(`/store/products/prod_store_${name}?fields=${fields}${suffix}`,
        customer === undefined ? {} : { customer })).product;
      const sale = await priced("sale"), vip = await priced("sale", "", "store-proof-verified-customer-secret");
      const calculatedOnly = product(await request(`/store/products/${seeded.baseId}?fields=id,variants.id,variants.calculated_price`)).product;
      expect(object(variant(calculatedOnly).calculated_price)).toMatchObject({ id: seeded.priceSets.base, calculated_amount: 100, original_amount: 100 });
      const implicitVariantKey = product(await request(`/store/products/${seeded.baseId}?fields=id,variants.calculated_price&region_id=reg_store_us&country_code=us`)).product;
      expect(variant(implicitVariantKey)).toMatchObject({ id: "variant_store_base", calculated_price: { calculated_amount: 100, calculated_amount_with_tax: 110 } });
      expect(object(variant(sale).calculated_price)).toMatchObject({ calculated_amount: 70, original_amount: 100,
        raw_calculated_amount: salePrice.raw_amount, raw_original_amount: saleBase.raw_amount,
        calculated_price: { id: salePrice.id }, original_price: { id: saleBase.id } });
      expect(object(variant(vip).calculated_price)).toMatchObject({ calculated_amount: 60, original_amount: 100 });
      expect(object(variant(await priced("sale", "", "cus_store_verified")).calculated_price)).toMatchObject({ calculated_amount: 70 });
      expect(object(variant(await priced("override")).calculated_price)).toMatchObject({ calculated_amount: 120, is_calculated_price_price_list: true });
      expect(variant(await priced("null")).calculated_price).toBeNull();
      const taxed = await priced("base", "&country_code=us");
      expect(object(variant(taxed).calculated_price)).toMatchObject({ calculated_amount: 100, calculated_amount_with_tax: 110, calculated_amount_without_tax: 100 });
      const inclusive = object(variant(await priced("base", "&region_id=reg_store_inclusive&country_code=us")).calculated_price);
      expect(inclusive).toMatchObject({ is_calculated_price_tax_inclusive: true, calculated_amount_with_tax: 100 });
      expect(inclusive.calculated_amount_without_tax).toBeCloseTo(100 / 1.1, 10);
      expect(object(variant(await priced("sale", "&region_id=reg_store_inclusive&country_code=us")).calculated_price))
        .toMatchObject({ calculated_amount: 100, is_calculated_price_tax_inclusive: false, calculated_amount_with_tax: 110,
          calculated_price: { id: saleBase.id }, raw_calculated_amount: saleBase.raw_amount });
      expect(object(variant(await priced("base", "&region_id=reg_store_manual&country_code=us")).calculated_price)).not.toHaveProperty("calculated_amount_with_tax");
      expect(object(variant(await priced("base", "&cart_id=cart_store_us&region_id=reg_store_eur&country_code=gb")).calculated_price))
        .toMatchObject({ currency_code: "usd", calculated_amount_with_tax: 110 });
      const pricedCohort = products(await request(`/store/products?fields=${fields}&country_code=us`));
      expect(pricedCohort).toMatchObject({ count: 4, offset: 0, limit: 50 });
      for (const expected of [
        { id: seeded.baseId, priceSet: seeded.priceSets.base, amount: 100, original: 100, withTax: 110, selected: basePrice, originalPrice: basePrice },
        { id: seeded.saleId, priceSet: seeded.priceSets.sale, amount: 70, original: 100, withTax: 77, selected: salePrice, originalPrice: saleBase },
        { id: seeded.overrideId, priceSet: seeded.priceSets.override, amount: 120, original: 120, withTax: 132, selected: overridePrice, originalPrice: overridePrice },
      ]) {
        const own = pricedCohort.products.find(row => row.id === expected.id);
        if (own === undefined) throw new Error("Native Store DO priced list omitted Product");
        const price = object(variant(own).calculated_price);
        expect(price).toMatchObject({ id: expected.priceSet, calculated_amount: expected.amount, original_amount: expected.original,
          calculated_amount_with_tax: expected.withTax, calculated_price: { id: expected.selected.id }, original_price: { id: expected.originalPrice.id } });
        expect(price.raw_calculated_amount).toEqual(expected.selected.raw_amount);
        expect(price.raw_original_amount).toEqual(expected.originalPrice.raw_amount);
      }
      expect(variant(pricedCohort.products.find(row => row.id === seeded.nullId) ?? {}).calculated_price).toBeNull();
      const quantities = products(await request("/store/products?fields=id,variants.id,variants.manage_inventory,variants.inventory_quantity"));
      expect(variant(quantities.products.find(row => row.id === seeded.baseId) ?? {})).toMatchObject({ inventory_quantity: 8 });
      expect(variant(quantities.products.find(row => row.id === seeded.nullId) ?? {})).not.toHaveProperty("inventory_quantity");
      await request("/store/products?fields=id,variants.id,variants.manage_inventory,variants.inventory_quantity", { key: storeProductMultiToken, status: 400 });
      for (const path of ["/store/products?limit=invalid", "/store/products?fields=__proto__.polluted", "/store/products?fields=variants.calculated_price.secret"])
        await request(path, { status: 400 });
      await request("/store/products", { key: "pk_missing", status: 400 });
      phase = "first shutdown"; await host.stop();
      expect(await observeStoreProductRequestFixture({ physical, catalog: seed.catalog })).toEqual(before);
      phase = "recreation"; host.start(); await host.ready();
      expect(products(await request("/store/products"))).toEqual(defaults);
      expect(await priced("sale")).toEqual(sale);
      expect(await priced("base", "&country_code=us")).toEqual(taxed);
      expect(products(await request(`/store/products?fields=${fields}&country_code=us`))).toEqual(pricedCohort);
      phase = "final shutdown"; await host.stop();
      expect(await observeStoreProductRequestFixture({ physical, catalog: seed.catalog })).toEqual(before);
    } catch (cause) { console.error("Store Product DO proof failed", { phase }); primary.push(cause); throw cause; }
    finally {
      const failures: unknown[] = [];
      try { await scenario?.stop(); } catch (cause) { failures.push(cause); }
      try { await seed?.fixture.close(); } catch (cause) { failures.push(cause); }
      try { await physical.close(); } catch (cause) { failures.push(cause); }
      if (failures.length > 0) throw new AggregateError([...primary, ...failures], "Store Product DO proof cleanup failed");
    }
  }, 300_000);
});
