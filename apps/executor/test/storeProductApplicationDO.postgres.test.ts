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
const adminSuite = createMedusaDOTestSuite(new URL("./adminProductApplicationDO.workerd.worker.ts", import.meta.url));
const object = Schema.decodeUnknownSync(Schema.JsonObject);
const products = Schema.decodeUnknownSync(Schema.Struct({ products: Schema.Array(Schema.JsonObject), count: Schema.Number, offset: Schema.Number, limit: Schema.Number }));
const product = Schema.decodeUnknownSync(Schema.Struct({ product: Schema.JsonObject }));
const variants = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const variant = (value: typeof Schema.JsonObject.Type) => {
  const row = variants(value.variants)[0]; if (row === undefined) throw new Error("Native Store DO omitted Variant"); return row;
};

describe.runIf(endpoints !== undefined)("native Store Product reads in the actual application DO", () => {
  it("reads actual Admin-created Collections, Tags, Types and Categories from the same Core tenant across the Admin-to-Store handoff and Store recreation", async () => {
    if (endpoints === undefined) throw new Error("Store Collection DO requires ordinary PostgreSQL");
    const physical = await createCorePostgresFixture(endpoints);
    let prepared: Awaited<ReturnType<typeof prepareStoreProductRequestFixture>> | undefined;
    let admin: Awaited<ReturnType<typeof adminSuite.createScenario>> | undefined;
    let store: Awaited<ReturnType<typeof suite.createScenario>> | undefined;
    const primary: unknown[] = [];
    let phase = "initialization";
    try {
      // Reuse the existing Store superset bootstrap. Taxonomy business rows
      // start empty and are created exclusively by the promoted Admin route.
      prepared = await prepareStoreProductRequestFixture("postgres", { physical: { ...physical, close: async () => {} } });
      await prepared.fixture.close();
      const profile = { ...executorApplicationProfileFixture(), ...storeProductRequestTarget,
        persistenceNamespace: physical.namespace, instanceName: physical.instanceName };
      const adminCredential = "native-store-collection-admin-identity";
      admin = await adminSuite.createScenario({ profile, connectionString: endpoints.connectionString, privateToken,
        className: "NativeAdminProductApplicationFixture", hostname: "native-collection-admin.test",
        bindings: { ADMIN_PRODUCT_CREDENTIAL: adminCredential, ADMIN_PRODUCT_STORE_CATALOG: "true" },
        headers: { "x-admin-fixture-token": adminCredential, origin: "https://admin.test" } });
      const administrator = admin;
      phase = "Admin startup"; administrator.start(); await administrator.ready();
      const post = async (path: string, input: unknown) => {
        phase = `Admin POST ${path}`;
        const response = await administrator.request(path, { method: "POST", body: input });
        const body = object(await response.json()); expect(response.status, JSON.stringify(body)).toBe(200); return body;
      };
      const create = async (title: string, handle: string) => {
        const body = await post("/admin/collections", { title, handle, metadata: { private: "admin-only-default" } });
        return Schema.decodeUnknownSync(Schema.Struct({ id: Schema.NonEmptyString, title: Schema.String, handle: Schema.String,
          created_at: Schema.String, updated_at: Schema.String }))(body.collection);
      };
      const alpha = await create("Alpha Collection", "store-collection-alpha");
      const beta = await create("Beta Collection", "store-collection-beta");
      expect(alpha.id).not.toBe(beta.id);
      const nativeId = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.NonEmptyString }));
      const tag = nativeId((await post("/admin/product-tags", { value: "Store DO Tag" })).product_tag);
      const type = nativeId((await post("/admin/product-types", { value: "Store DO Type" })).product_type);
      const root = nativeId((await post("/admin/product-categories", { name: "Public Root", handle: "store-do-root", is_active: true })).product_category);
      const child = nativeId((await post("/admin/product-categories", { name: "Public Child", handle: "store-do-child", is_active: true,
        parent_category_id: root.id })).product_category);
      const internal = nativeId((await post("/admin/product-categories", { name: "Internal Category", handle: "store-do-internal",
        is_active: true, is_internal: true, parent_category_id: root.id })).product_category);
      const inactive = nativeId((await post("/admin/product-categories", { name: "Inactive Category", handle: "store-do-inactive",
        is_active: false, parent_category_id: root.id })).product_category);
      const linkedProducts = [];
      for (const status of ["published", "draft"] as const) {
        const created = nativeId((await post("/admin/products?fields=id", { title: `Taxonomy ${status}`, handle: `store-do-taxonomy-${status}`,
          status, type_id: type.id, tags: [{ id: tag.id }], options: [{ title: "Size", values: ["One"] }],
          variants: [{ title: "One", manage_inventory: false, options: { Size: "One" }, prices: [] }] })).product);
        linkedProducts.push({ id: created.id, status });
      }
      phase = "Admin shutdown"; await administrator.stop();
      const committed = await observeStoreProductRequestFixture({ physical, catalog: prepared.catalog });
      store = await suite.createScenario({ profile, connectionString: endpoints.connectionString, privateToken,
        className: "NativeStoreProductApplicationFixture", hostname: "native-collection-store.test",
        headers: { "x-publishable-api-key": storeProductToken, origin: "https://store.test" } });
      const host = store;
      const request = async (path: string, options: Readonly<{ status?: number; key?: string | undefined }> = {}) => {
        phase = path;
        const response = await host.request(path, { headers: Object.hasOwn(options, "key") ? { "x-publishable-api-key": options.key } : {} });
        const body = object(await response.json()); expect(response.status, JSON.stringify(body)).toBe(options.status ?? 200);
        expect(response.headers.get("access-control-allow-origin")).toBe("https://store.test"); return body;
      };
      const collections = Schema.decodeUnknownSync(Schema.Struct({ collections: Schema.Array(Schema.JsonObject),
        count: Schema.Number, offset: Schema.Number, limit: Schema.Number }));
      phase = "Store startup"; host.start(); await host.ready();
      const defaults = collections(await request("/store/collections"));
      expect(defaults).toMatchObject({ count: 2, offset: 0, limit: 10 });
      expect(defaults.collections).toEqual([beta, alpha]);
      for (const row of defaults.collections) expect(Object.keys(row).toSorted()).toEqual(["id", "title", "handle", "created_at", "updated_at"].toSorted());
      expect(collections(await request(`/store/collections?handle=${alpha.handle}&fields=id,title`)))
        .toEqual({ collections: [{ id: alpha.id, title: alpha.title }], count: 1, offset: 0, limit: 10 });
      expect(collections(await request(`/store/collections?id=${beta.id}&fields=id`)))
        .toEqual({ collections: [{ id: beta.id }], count: 1, offset: 0, limit: 10 });
      expect(collections(await request("/store/collections?title=Beta%20Collection&fields=id")))
        .toEqual({ collections: [{ id: beta.id }], count: 1, offset: 0, limit: 10 });
      expect(collections(await request("/store/collections?fields=id&order=title&offset=1&limit=1")))
        .toEqual({ collections: [{ id: beta.id }], count: 2, offset: 1, limit: 1 });
      const detail = await request(`/store/collections/${alpha.id}`);
      expect(detail).toEqual({ collection: alpha });
      expect(await request(`/store/collections/${beta.id}?fields=id,title`)).toEqual({ collection: { id: beta.id, title: beta.title } });
      expect(await request("/store/collections/missing", { status: 404 })).toMatchObject({ type: "not_found", message: "Collection with id: missing was not found" });
      for (const path of ["/store/collections", `/store/collections/${alpha.id}`]) {
        await request(path, { key: undefined, status: 400 });
        await request(path, { key: "pk_missing", status: 400 });
      }
      const taxonomySnapshots: Array<readonly [string, typeof Schema.JsonObject.Type]> = [];
      const remember = async (path: string) => {
        const body = await request(path); taxonomySnapshots.push([path, body]); return body;
      };
      const linkedIds = linkedProducts.map(row => row.id).toSorted();
      for (const [family, entity, row, value] of [["product-tags", "product_tag", tag, "Store DO Tag"],
        ["product-types", "product_type", type, "Store DO Type"]] as const) {
        const path = `/store/${family}`;
        const listed = await remember(path);
        expect(listed).toMatchObject({ count: 1, offset: 0, limit: 50 });
        const [listedRow] = variants(listed[`${entity}s`]);
        expect(listedRow).toMatchObject({ id: row.id, value, metadata: null });
        expect(variants(listedRow?.products).map(product => product.id).toSorted()).toEqual(linkedIds);
        const detail = await remember(`${path}/${row.id}`);
        expect(detail[entity]).toEqual(listedRow);
        // These native taxonomy routes do not apply Store Product publication
        // or sales-channel selection to their linked scalar Product rows.
        expect(variants(object(detail[entity]).products)).toEqual(expect.arrayContaining(linkedProducts.map(product => expect.objectContaining(product))));
        const selected = await request(`${path}/${row.id}?fields=id,value,products.id,products.status`);
        expect(object(selected[entity])).toEqual({ id: row.id, value,
          products: expect.arrayContaining(linkedProducts) });
        expect(await request(`${path}?value=${encodeURIComponent(value)}&fields=id`))
          .toEqual({ [`${entity}s`]: [{ id: row.id }], count: 1, offset: 0, limit: 50 });
        await request(`${path}/missing`, { status: 404 });
        for (const route of [path, `${path}/${row.id}`]) await request(route, { key: "pk_missing", status: 400 });
      }
      const categoryPath = "/store/product-categories";
      const categoryList = await remember(categoryPath);
      expect(categoryList).toMatchObject({ count: 2, offset: 0, limit: 50 });
      expect(variants(categoryList.product_categories).map(row => row.id).toSorted()).toEqual([root.id, child.id].toSorted());
      const rootDetail = await remember(`${categoryPath}/${root.id}`);
      expect(rootDetail).toMatchObject({ product_category: { id: root.id, name: "Public Root", parent_category: null,
        category_children: [{ id: child.id, name: "Public Child", parent_category_id: root.id }] } });
      const childDetail = await remember(`${categoryPath}/${child.id}`);
      expect(childDetail).toMatchObject({ product_category: { id: child.id, parent_category_id: root.id,
        parent_category: { id: root.id, name: "Public Root" }, category_children: [] } });
      expect(await request(`${categoryPath}?parent_category_id=${root.id}&fields=id,parent_category_id`))
        .toEqual({ product_categories: [{ id: child.id, parent_category_id: root.id }], count: 1, offset: 0, limit: 50 });
      expect(await request(`${categoryPath}/${child.id}?fields=id,name,parent_category.name`))
        .toEqual({ product_category: { id: child.id, name: "Public Child", parent_category: { name: "Public Root" } } });
      for (const hidden of [internal, inactive]) {
        expect(await request(`${categoryPath}?id=${hidden.id}&fields=id`)).toEqual({ product_categories: [], count: 0, offset: 0, limit: 50 });
        expect(await request(`${categoryPath}/${hidden.id}`)).toEqual({});
      }
      for (const route of [categoryPath, `${categoryPath}/${root.id}`]) await request(route, { key: "pk_missing", status: 400 });
      phase = "Store shutdown"; await host.stop();
      expect(await observeStoreProductRequestFixture({ physical, catalog: prepared.catalog })).toEqual(committed);
      phase = "Store recreation"; host.start(); await host.ready();
      expect(collections(await request("/store/collections"))).toEqual(defaults);
      expect(await request(`/store/collections/${alpha.id}`)).toEqual(detail);
      for (const [path, expected] of taxonomySnapshots) expect(await request(path)).toEqual(expected);
      phase = "final Store shutdown"; await host.stop();
      expect(await observeStoreProductRequestFixture({ physical, catalog: prepared.catalog })).toEqual(committed);
    } catch (cause) { console.error("Store Collection DO proof failed", { phase }); primary.push(cause); throw cause; }
    finally {
      const failures: unknown[] = [];
      for (const scenario of [admin, store]) try { await scenario?.stop(); } catch (cause) { failures.push(cause); }
      try { await prepared?.fixture.close(); } catch (cause) { failures.push(cause); }
      try { await physical.close(); } catch (cause) { failures.push(cause); }
      if (failures.length > 0) throw new AggregateError([...primary, ...failures], "Store Collection DO proof cleanup failed");
    }
  }, 300_000);

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
