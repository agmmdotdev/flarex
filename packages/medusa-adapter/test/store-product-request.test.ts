import { Cause, Effect, Schema } from "effect";
import { asValue, createContainer } from "@medusajs/deps/awilix-portable";
import { createStoreProductHttpHandler, type StoreProductHttpOptions } from "@flarex/medusa-http/store-product";
import { describe, expect, it, vi } from "vitest";
import { PricingModuleService } from "@medusajs/pricing/services";
import { VariantItemPricingCalculationOutput } from "../src/modules/pricing/calculation";
import { ExactNumericRaw } from "../src/value/exact-numeric";
import { shareCoreNativeWorkflowPhysical } from "./support/core-native-workflow-fixture";
import { makeStoreProductRequestScopeFactory, type StoreProductRequestReads } from "../src/http/store-product-request";
import { prepareStoreProductRequestFixture, seedStoreProductRequestFixture } from "./support/store-product-request-fixture";
import { storeProductToken, storeProductMultiToken, storeProductEmptyToken, storeProductLogger } from "./support/store-product-request-catalog";
import { storeRequestReadRevokedToken, storeRequestReadSecretToken } from "./support/store-request-read-catalog";

const driver = process.env.FLAREX_TEST_DRIVER === "postgres" ? "postgres" : "pglite";
const object = Schema.decodeUnknownSync(Schema.JsonObject);
const list = Schema.decodeUnknownSync(Schema.Struct({ products: Schema.Array(Schema.JsonObject), count: Schema.Number, offset: Schema.Number, limit: Schema.Number }));
const detail = Schema.decodeUnknownSync(Schema.Struct({ product: Schema.JsonObject }));
const variants = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const makeHttp = Effect.fn("StoreProductProof.makeHttp")(function* (reads: StoreProductRequestReads,
  principal?: StoreProductHttpOptions["resolveCustomerPrincipal"]) {
  const container = createContainer().register({ logger: asValue(storeProductLogger), configModule: asValue({ projectConfig: { http: {} } }) });
  const diagnosticReads = { ...reads, query: { ...reads.query,
    graph: (...args: Parameters<typeof reads.query.graph>) => reads.query.graph(...args).pipe(Effect.tapCause(cause => Effect.sync(() => {
      // Private failure evidence only; do not log native inputs or credentials.
      console.error("Store Product graph failure", Cause.pretty(cause).replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/giu, "[redacted-postgres]"));
    }))),
  }, tax: { getTaxLines: (...args: Parameters<typeof reads.tax.getTaxLines>) => reads.tax.getTaxLines(...args).pipe(
    Effect.tapCause(cause => Effect.sync(() => console.error("Store Product Tax failure",
      Cause.pretty(cause).replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/giu, "[redacted-postgres]")))),
  ) } };
  const scopes = yield* makeStoreProductRequestScopeFactory({ reads: diagnosticReads, container });
  return createStoreProductHttpHandler({ storeCors: "https://store.test", ...scopes,
    ...(principal === undefined ? {} : { resolveCustomerPrincipal: principal }) });
});
const firstVariant = (product: Schema.Schema.Type<typeof Schema.JsonObject>) => {
  const first = variants(product.variants)[0];
  if (first === undefined) throw new Error("Native Store response omitted Variant");
  return first;
};
const calculated = (product: Schema.Schema.Type<typeof Schema.JsonObject>) => object(firstVariant(product).calculated_price);
const pricingFields = "id,title,variants.id,variants.manage_inventory,variants.calculated_price,variants.price_set.id,variants.prices.id,variants.prices.amount";

describe(`native Store Product HTTP (${driver})`, () => {
  it("serves complete native defaults, published channel scope, categories, pagination and key refusals without durable writes", async () => {
    const tested = await prepareStoreProductRequestFixture(driver);
    try {
      await seedStoreProductRequestFixture(tested);
      const before = await tested.fixture.inventory();
      await tested.use(reads => Effect.gen(function* () {
        const http = yield* makeHttp(reads);
        yield* Effect.promise(async () => {
          const request = async (path: string, key: string | undefined = storeProductToken, status = 200) => {
            const response = await http.handle(new Request(`https://native-store.test${path}`, { headers: key === undefined ? {} : { "x-publishable-api-key": key } }));
            const body = object(await response.json());
            expect(response.status, `${path}: ${JSON.stringify(body)}`).toBe(status); return body;
          };
          const defaults = list(await request("/store/products"));
          expect(defaults).toMatchObject({ count: 4, offset: 0, limit: 50 });
          expect(defaults.products.map(row => row.id).toSorted()).toEqual(["prod_store_base", "prod_store_null", "prod_store_override", "prod_store_sale"]);
          const base = defaults.products.find(row => row.id === "prod_store_base");
          if (base === undefined) throw new Error("Missing native Store base Product");
          expect(base).toMatchObject({ title: "Store base", handle: "store-base", subtitle: null, description: null, is_giftcard: false,
            discountable: true, collection_id: null, type_id: null, type: null, collection: null, tags: [], images: [], options: [{ title: "Size", values: [{ value: "One" }] }] });
          expect(firstVariant(base)).toMatchObject({ id: "variant_store_base", title: "One", sku: "store-base", manage_inventory: true, options: [{ value: "One" }] });
          expect(firstVariant(base)).not.toHaveProperty("calculated_price");
          const page = list(await request("/store/products?fields=id&limit=1&offset=1&order=id"));
          expect(page).toEqual({ products: [{ id: "prod_store_null" }], count: 4, offset: 1, limit: 1 });
          expect(list(await request("/store/products?fields=id&limit=0"))).toEqual({ products: [], count: 4, offset: 0, limit: 0 });
          const retrieved = detail(await request("/store/products/prod_store_base"));
          expect(retrieved.product).toMatchObject({ id: "prod_store_base", title: "Store base" });
          expect(variants(retrieved.product.categories)).toHaveLength(2);
          expect(variants(retrieved.product.categories)).toEqual(expect.arrayContaining([{ is_internal: false }, { is_internal: true }]));
          expect(detail(await request("/store/products/prod_store_base?fields=id,categories.id,categories.is_internal")).product)
            .toEqual({ id: "prod_store_base", categories: [{ id: "pcat_store_public", is_internal: false }] });
          expect(list(await request("/store/products?fields=id&category_id=pcat_store_public")).products).toEqual([{ id: "prod_store_base" }]);
          // Pinned transformProductParams moves category_id to categories.id
          // before the native defaults callback looks for the removed key.
          expect(list(await request("/store/products?fields=id&category_id=pcat_store_internal")).products).toEqual([{ id: "prod_store_base" }]);
          await request("/store/products/prod_store_draft", storeProductToken, 404);
          await request("/store/products/prod_store_foreign", storeProductToken, 404);
          await request("/store/products?sales_channel_id=sc_other", storeProductToken, 400);
          await request("/store/products?sales_channel_id=sc_removed", storeProductToken, 400);
          expect(detail(await request("/store/products/prod_store_foreign?fields=id", storeProductMultiToken)).product.id).toBe("prod_store_foreign");
          for (const key of ["missing", storeRequestReadRevokedToken, storeRequestReadSecretToken]) await request("/store/products", key, 400);
          const absentKey = await http.handle(new Request("https://native-store.test/store/products")); expect(absentKey.status).toBe(400);
          await request("/store/products?fields=id", storeProductEmptyToken, 400);
          for (const path of ["/store/products?limit=invalid", "/store/products?limit=257", "/store/products?fields=__proto__.polluted", "/store/products?fields=variants.calculated_price.secret"])
            await request(path, storeProductToken, 400);
        });
      }));
      expect(await tested.fixture.inventory()).toEqual(before);
    } finally { await tested.fixture.close(); }
  });

  it("calculates native base, sale, override, null, customer, tax and channel inventory contexts with complete read-only evidence", async () => {
    const tested = await prepareStoreProductRequestFixture(driver);
    let restoreCalculation: (() => void) | undefined;
    try {
      const seeded = await seedStoreProductRequestFixture(tested);
      const storedPrices = await tested.fixture.readRows("pricing");
      const sourcePrice = (priceSet: string, listId: string | null = null) => Schema.decodeUnknownSync(Schema.Struct({ id: Schema.NonEmptyString,
        raw_amount: ExactNumericRaw }))(storedPrices.find(row => row.price_set_id === priceSet && row.price_list_id === listId && row.rules_count === 0));
      const regionalPrice = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.NonEmptyString, raw_amount: ExactNumericRaw }))(
        storedPrices.find(row => row.price_set_id === seeded.priceSets.base && row.price_list_id === null && row.rules_count === 1));
      const basePrice = sourcePrice(seeded.priceSets.base), saleBase = sourcePrice(seeded.priceSets.sale), saleList = seeded.lists[0], vipList = seeded.lists[1];
      if (saleList === undefined || vipList === undefined) throw new Error("Native Store seed omitted PriceLists");
      const salePrice = sourcePrice(seeded.priceSets.sale, saleList.id), vipPrice = sourcePrice(seeded.priceSets.sale, vipList.id),
        overridePrice = sourcePrice(seeded.priceSets.override, "plist_store_override");
      const originalPriceSets = PricingModuleService.prototype.listAndCountPriceSets;
      const priceSetSelections: Array<Parameters<typeof originalPriceSets>[1]> = [];
      const calculation = vi.spyOn(PricingModuleService.prototype, "calculatePrices");
      const priceSets = vi.spyOn(PricingModuleService.prototype, "listAndCountPriceSets").mockImplementation(function (this: PricingModuleService, ...args) {
        // Native setupCalculatedPriceConfig_ splices the relation array. Observe
        // its incoming selection before forwarding the same call exactly once.
        priceSetSelections.push(structuredClone(args[1]));
        return originalPriceSets.apply(this, args);
      });
      restoreCalculation = () => { calculation.mockRestore(); priceSets.mockRestore(); };
      const before = await tested.fixture.inventory();
      await tested.use(reads => Effect.gen(function* () {
        const guest = yield* makeHttp(reads), verified = yield* makeHttp(reads, () => ({ actor_id: "cus_store_verified", actor_type: "customer", auth_identity_id: "auth_store_verified", app_metadata: {}, user_metadata: {} }));
        const deletedCustomer = yield* makeHttp(reads, () => ({ actor_id: "cus_store_deleted", actor_type: "customer", auth_identity_id: "auth_store_deleted", app_metadata: {}, user_metadata: {} }));
        const overboundCustomer = yield* makeHttp(reads, () => ({ actor_id: "cus_store_overbound", actor_type: "customer", auth_identity_id: "auth_store_overbound", app_metadata: {}, user_metadata: {} }));
        yield* Effect.promise(async () => {
          const request = async (name: string, query = "", http = guest, key = storeProductToken, status = 200) => {
            const response = await http.handle(new Request(`https://native-store.test/store/products/prod_store_${name}?fields=${pricingFields}${query}`, { headers: { "x-publishable-api-key": key } }));
            const body = object(await response.json()); expect(response.status, `${name}${query}: ${JSON.stringify(body)}`).toBe(status);
            return status === 200 ? detail(body).product : body;
          };
          const base = await request("base");
          expect(priceSets).toHaveBeenCalledTimes(1);
          expect(calculation).toHaveBeenCalledTimes(1);
          expect(calculation.mock.calls[0]?.slice(0, 2)).toEqual([{ id: [seeded.priceSets.base] }, { context: { region_id: "reg_store_us", currency_code: "usd" } }]);
          expect(priceSetSelections[0]?.relations).toEqual(expect.arrayContaining(["prices", "calculated_price"]));
          const completedCalculation = calculation.mock.results[0];
          if (completedCalculation?.type !== "return") throw new Error("Native Pricing calculation did not return");
          expect(Schema.decodeUnknownSync(VariantItemPricingCalculationOutput)(await completedCalculation.value)).toMatchObject([
            { id: seeded.priceSets.base, calculated_amount: 100, original_amount: 100, calculated_price: { id: expect.any(String) }, original_price: { id: expect.any(String) } },
          ]);
          expect(calculated(base)).toMatchObject({ calculated_amount: 100, original_amount: 100, currency_code: "usd", is_calculated_price_price_list: false,
            is_calculated_price_tax_inclusive: false, raw_calculated_amount: basePrice.raw_amount, raw_original_amount: basePrice.raw_amount,
            calculated_price: { id: basePrice.id }, original_price: { id: basePrice.id } });
          expect(basePrice.raw_amount.precision).toBe(20);
          expect(calculated(base)).not.toHaveProperty("calculated_amount_with_tax");
          expect(firstVariant(base)).toHaveProperty("price_set.id");
          expect(variants(firstVariant(base).prices)).toEqual(expect.arrayContaining([expect.objectContaining({ amount: 100 })]));
          const sale = calculated(await request("sale")); expect(sale).toMatchObject({ calculated_amount: 70, original_amount: 100, is_calculated_price_price_list: true,
            raw_calculated_amount: salePrice.raw_amount, raw_original_amount: saleBase.raw_amount, calculated_price: { id: salePrice.id, price_list_type: "sale" }, original_price: { id: saleBase.id } });
          expect(calculated(await request("sale", "", verified))).toMatchObject({ calculated_amount: 60, original_amount: 100,
            raw_calculated_amount: vipPrice.raw_amount, raw_original_amount: saleBase.raw_amount, calculated_price: { id: vipPrice.id, price_list_type: "sale" }, original_price: { id: saleBase.id } });
          expect(calculated(await request("sale", "", deletedCustomer))).toMatchObject({ calculated_amount: 70 });
          await request("sale", "", overboundCustomer, storeProductToken, 400);
          expect(calculated(await request("override"))).toMatchObject({ calculated_amount: 120, original_amount: 120,
            is_original_price_price_list: true, raw_calculated_amount: overridePrice.raw_amount, raw_original_amount: overridePrice.raw_amount,
            calculated_price: { id: overridePrice.id, price_list_type: "override" }, original_price: { id: overridePrice.id } });
          expect(firstVariant(await request("null")).calculated_price).toBeNull();
          expect(calculated(await request("null", "&region_id=reg_store_eur"))).toMatchObject({ calculated_amount: 15, currency_code: "eur" });
          expect(calculated(await request("base", "&country_code=us"))).toMatchObject({ calculated_amount_with_tax: 110, calculated_amount_without_tax: 100,
            original_amount_with_tax: 110, original_amount_without_tax: 100 });
          const inclusive = calculated(await request("base", "&region_id=reg_store_inclusive&country_code=us"));
          expect(inclusive).toMatchObject({ calculated_amount: 100, is_calculated_price_tax_inclusive: true, calculated_amount_with_tax: 100,
            calculated_price: { id: regionalPrice.id }, original_price: { id: regionalPrice.id }, raw_calculated_amount: regionalPrice.raw_amount, raw_original_amount: regionalPrice.raw_amount });
          expect(inclusive.calculated_amount_without_tax).toBeCloseTo(100 / 1.1, 10);
          expect(calculated(await request("sale", "&region_id=reg_store_inclusive&country_code=us"))).toMatchObject({ calculated_amount: 100,
            is_calculated_price_tax_inclusive: false, calculated_amount_with_tax: 110, calculated_amount_without_tax: 100,
            calculated_price: { id: saleBase.id }, raw_calculated_amount: saleBase.raw_amount });
          expect(calculated(await request("base", "&region_id=reg_store_manual&country_code=us"))).not.toHaveProperty("calculated_amount_with_tax");
          expect(calculated(await request("base", "&cart_id=cart_store_us&region_id=reg_store_eur&country_code=gb")))
            .toMatchObject({ currency_code: "usd", calculated_amount_with_tax: 110, calculated_amount_without_tax: 100 });
          await request("base", "&region_id=missing", guest, storeProductToken, 400);
          const readsBeforeList = priceSets.mock.calls.length, calculationsBeforeList = calculation.mock.calls.length;
          const pricedListResponse = await guest.handle(new Request(`https://native-store.test/store/products?fields=${pricingFields}&country_code=us`, {
            headers: { "x-publishable-api-key": storeProductToken } }));
          expect(pricedListResponse.status, await pricedListResponse.clone().text()).toBe(200);
          const pricedList = list(await pricedListResponse.json());
          expect(pricedList).toMatchObject({ count: 4, offset: 0, limit: 50 });
          expect(priceSets).toHaveBeenCalledTimes(readsBeforeList + 1);
          expect(calculation).toHaveBeenCalledTimes(calculationsBeforeList + 1);
          const nativeListCalculation = calculation.mock.results[calculationsBeforeList];
          if (nativeListCalculation?.type !== "return") throw new Error("Native Store list calculation did not return");
          expect(Schema.decodeUnknownSync(VariantItemPricingCalculationOutput)(await nativeListCalculation.value).map(row => row.id).toSorted())
            .toEqual([seeded.priceSets.base, seeded.priceSets.sale, seeded.priceSets.override].toSorted());
          for (const expected of [
            { name: "base", priceSet: seeded.priceSets.base, amount: 100, withTax: 110, original: 100, calculated: basePrice, originalPrice: basePrice },
            { name: "sale", priceSet: seeded.priceSets.sale, amount: 70, withTax: 77, original: 100, calculated: salePrice, originalPrice: saleBase },
            { name: "override", priceSet: seeded.priceSets.override, amount: 120, withTax: 132, original: 120, calculated: overridePrice, originalPrice: overridePrice },
          ]) {
            const own = pricedList.products.find(row => row.id === `prod_store_${expected.name}`);
            if (own === undefined) throw new Error("Native Store priced list omitted Product");
            const price = calculated(own);
            expect(price).toMatchObject({ id: expected.priceSet, calculated_amount: expected.amount,
              original_amount: expected.original, calculated_amount_with_tax: expected.withTax,
              calculated_price: { id: expected.calculated.id }, original_price: { id: expected.originalPrice.id } });
            expect(price.raw_calculated_amount).toEqual(expected.calculated.raw_amount);
            expect(price.raw_original_amount).toEqual(expected.originalPrice.raw_amount);
          }
          expect(firstVariant(pricedList.products.find(row => row.id === seeded.nullId) ?? {}).calculated_price).toBeNull();
          // Pinned RemoteJoiner appends the Variant primary key for its PriceSet
          // relationship and does not re-mask it before the native tax helper.
          const implicitKeyResponse = await guest.handle(new Request("https://native-store.test/store/products/prod_store_base?fields=id,variants.calculated_price&region_id=reg_store_us&country_code=us", {
            headers: { "x-publishable-api-key": storeProductToken } }));
          const implicitKeyBody = object(await implicitKeyResponse.json());
          expect(implicitKeyResponse.status, JSON.stringify(implicitKeyBody)).toBe(200);
          expect(firstVariant(detail(implicitKeyBody).product)).toMatchObject({ id: "variant_store_base",
            calculated_price: { calculated_amount: 100, calculated_amount_with_tax: 110 } });
          const quantityResponse = await guest.handle(new Request("https://native-store.test/store/products?fields=id,variants.id,variants.manage_inventory,variants.inventory_quantity", { headers: { "x-publishable-api-key": storeProductToken } }));
          expect(quantityResponse.status, await quantityResponse.clone().text()).toBe(200);
          const quantities = list(await quantityResponse.json());
          expect(firstVariant(quantities.products.find(product => product.id === "prod_store_base") ?? {})).toMatchObject({ inventory_quantity: 8 });
          expect(firstVariant(quantities.products.find(product => product.id === "prod_store_null") ?? {})).not.toHaveProperty("inventory_quantity");
          const ambiguous = await guest.handle(new Request("https://native-store.test/store/products?fields=id,variants.id,variants.manage_inventory,variants.inventory_quantity", { headers: { "x-publishable-api-key": storeProductMultiToken } }));
          expect(ambiguous.status, await ambiguous.clone().text()).toBe(400);
          const selected = await guest.handle(new Request("https://native-store.test/store/products?fields=id,variants.id,variants.manage_inventory,variants.inventory_quantity&sales_channel_id=sc_active", { headers: { "x-publishable-api-key": storeProductMultiToken } }));
          expect(selected.status, await selected.clone().text()).toBe(200);
        });
      }));
      expect(await tested.fixture.inventory()).toEqual(before);
    } finally { restoreCalculation?.(); await tested.fixture.close(); }
  });

  it("preserves the pinned single-channel list quirk while detail always applies membership", async () => {
    const tested = await prepareStoreProductRequestFixture(driver);
    try {
      await seedStoreProductRequestFixture(tested, { singleChannel: true });
      const before = await tested.fixture.inventory();
      await tested.use(reads => Effect.gen(function* () {
        const http = yield* makeHttp(reads);
        yield* Effect.promise(async () => {
          const request = (path: string) => http.handle(new Request(`https://native-store.test${path}`, { headers: { "x-publishable-api-key": storeProductToken } }));
          const response = await request("/store/products?fields=id"); expect(response.status).toBe(200);
          expect(list(await response.json()).products).toContainEqual({ id: "prod_store_foreign" });
          expect((await request("/store/products/prod_store_foreign?fields=id")).status).toBe(404);
          expect((await request("/store/products/prod_store_draft?fields=id")).status).toBe(404);
        });
      }));
      expect(await tested.fixture.inventory()).toEqual(before);
    } finally { await tested.fixture.close(); }
  });

  it("keeps two native scopes and epochs isolated on the same physical persistence through separate Core instances", async () => {
    const first = await prepareStoreProductRequestFixture(driver);
    let second: Awaited<ReturnType<typeof prepareStoreProductRequestFixture>> | undefined;
    try {
      const firstSeed = await seedStoreProductRequestFixture(first, { label: "TenantA" });
      const physical = await shareCoreNativeWorkflowPhysical(first.fixture.physical);
      second = await prepareStoreProductRequestFixture(driver, { physical,
        target: { scopeUuid: "d1000000-0000-4000-8000-000000000001", epochUuid: "d1000000-0000-4000-8000-000000000002" } });
      expect(second.fixture.physical.namespace).toBe(first.fixture.physical.namespace);
      expect(second.fixture.physical.instanceName).not.toBe(first.fixture.physical.instanceName);
      const fetchBase = (tested: typeof first, expectedStatus = 200) => tested.use(reads => Effect.gen(function* () {
        const http = yield* makeHttp(reads);
        return yield* Effect.promise(async () => {
          const response = await http.handle(new Request("https://native-store.test/store/products/prod_store_base?fields=id,title,variants.id,variants.calculated_price", {
            headers: { "x-publishable-api-key": storeProductToken } }));
          const body = object(await response.json()); expect(response.status, JSON.stringify(body)).toBe(expectedStatus); return body;
        });
      }));
      await fetchBase(second, 404);
      const secondSeed = await seedStoreProductRequestFixture(second, { label: "TenantB" });
      const beforeA = await first.fixture.inventory(), beforeB = await second.fixture.inventory();
      const firstProduct = detail(await fetchBase(first)).product, secondProduct = detail(await fetchBase(second)).product;
      expect(firstProduct.title).toBe("TenantA base");
      expect(secondProduct.title).toBe("TenantB base");
      expect(calculated(firstProduct).id).toBe(firstSeed.priceSets.base);
      expect(calculated(secondProduct).id).toBe(secondSeed.priceSets.base);
      expect(firstSeed.priceSets.base).not.toBe(secondSeed.priceSets.base);
      expect(await first.fixture.inventory()).toEqual(beforeA);
      expect(await second.fixture.inventory()).toEqual(beforeB);
    } finally {
      const failures: unknown[] = [];
      for (const fixture of [second?.fixture, first.fixture]) try { await fixture?.close(); } catch (cause) { failures.push(cause); }
      if (failures.length > 0) throw new AggregateError(failures, "Store Product tenant proof cleanup failed");
    }
  }, 300_000);
});
