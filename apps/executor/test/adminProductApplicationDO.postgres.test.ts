import { createCorePostgresFixture } from "@flarex/persistence-postgres/internal/system-test/core-persistence-fixture";
import { prepareProductRequestFixture, observeProductRequestFixture, seedProductRequestInventory } from "@flarex/medusa-adapter/internal/system-test/product-request-fixture";
import { Schema } from "effect";
import { Miniflare } from "miniflare";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { bundleApplicationWorker } from "./support/bundleApplicationWorker";
import { createExecutorApplicationSecretFixture, executorApplicationProfileFixture } from "./support/executorApplicationConfiguration";
import { adminProductDOFixtureTarget } from "./support/adminProductDOFixtureIdentity";
import { isSuccessfulProductReceipt, makeProductBenchmarkClient, productBenchmarkInput, runProductBenchmarkCohort,
  summarizeProductBenchmarkCohorts, type ProductBenchmarkCohort } from "./support/productDoBenchmark";
import { verifyConcurrentProductGraphs, type ProductSubmissionReceipt } from "./support/verifyConcurrentProductGraphs";

const endpointPath = process.env.FLAREX_CORE_POSTGRES_ENDPOINTS_FILE;
const endpoints = endpointPath === undefined ? undefined : Schema.decodeUnknownSync(Schema.Struct({
  connectionString: Schema.NonEmptyString, provisioningConnectionString: Schema.NonEmptyString,
}))(JSON.parse(await readFile(endpointPath, "utf8")));
const privateToken = "private-native-admin-product-app-fixture";
const adminCredential = "native-admin-product-identity-fixture";
const path = "/admin/products?fields=id,title,handle,status,options.id,options.title,options.values.id,options.values.value";
const managedPath = `${path},variants.id,variants.title,variants.sku,variants.manage_inventory,variants.options.id,variants.options.value,variants.options.option_id`;
const productInput = { title: "Real DO Product", handle: "real-do-product", options: [{ title: "Size", values: ["One"] }] };
const decodeProduct = Schema.decodeUnknownSync(Schema.Struct({ product: Schema.Struct({
  id: Schema.NonEmptyString, title: Schema.String, handle: Schema.String, status: Schema.String,
  options: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String,
    values: Schema.Array(Schema.Struct({ id: Schema.String, value: Schema.String })) })),
}) }));
const decodeVariants = Schema.decodeUnknownSync(Schema.Struct({ product: Schema.Struct({ variants: Schema.Array(Schema.Struct({
  id: Schema.NonEmptyString, title: Schema.String, sku: Schema.String, manage_inventory: Schema.Boolean,
  options: Schema.Array(Schema.Struct({ id: Schema.String, value: Schema.String, option_id: Schema.String })),
})) }) }));
const decodePriceLink = Schema.decodeUnknownSync(Schema.Struct({ variant_id: Schema.String, price_set_id: Schema.String }));
const decodeInventoryLink = Schema.decodeUnknownSync(Schema.Struct({ variant_id: Schema.String, inventory_item_id: Schema.String,
  required_quantity: Schema.Number }));
const decodeDurableGraphSummary = Schema.decodeUnknownSync(Schema.Struct({ product_id: Schema.String, variant_id: Schema.String,
  price_set_id: Schema.String, price_id: Schema.String, inventory_item_id: Schema.String, amount: Schema.String,
  currency: Schema.String, sku: Schema.String, required_quantity: Schema.Number, publication_timestamp: Schema.String }));
const readPrice = Schema.Struct({ id: Schema.NonEmptyString, amount: Schema.Number, currency_code: Schema.String,
  price_set_id: Schema.NonEmptyString, variant_id: Schema.NonEmptyString });
const readProduct = Schema.Struct({ id: Schema.NonEmptyString, title: Schema.String, handle: Schema.String, status: Schema.String,
  variants: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString, sku: Schema.String, manage_inventory: Schema.Boolean,
    prices: Schema.Array(readPrice), inventory_items: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString,
      variant_id: Schema.NonEmptyString, inventory_item_id: Schema.NonEmptyString, required_quantity: Schema.Number,
      inventory: Schema.Struct({ id: Schema.NonEmptyString, sku: Schema.String }) })) })) });
const decodeReadProduct = Schema.decodeUnknownSync(Schema.Struct({ product: readProduct }));
const decodeDefaultPrices = Schema.decodeUnknownSync(Schema.Struct({ product: Schema.Struct({ variants: Schema.Array(
  Schema.Struct({ id: Schema.NonEmptyString, prices: Schema.Array(readPrice) })) }) }));
const decodeReadProducts = Schema.decodeUnknownSync(Schema.Struct({ products: Schema.Array(readProduct),
  count: Schema.Number, offset: Schema.Number, limit: Schema.Number }));
const readFields = "id,title,handle,status,variants.id,variants.sku,variants.manage_inventory,*variants.prices,*variants.inventory_items,*variants.inventory_items.inventory";
const nativeVariant = Schema.Struct({ id: Schema.NonEmptyString, product_id: Schema.NonEmptyString, title: Schema.String,
  sku: Schema.String, manage_inventory: Schema.Boolean, prices: Schema.Array(readPrice),
  options: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString, value: Schema.String, option_id: Schema.NonEmptyString })) });
const decodeNativeVariant = Schema.decodeUnknownSync(Schema.Struct({ variant: nativeVariant }));
const decodeNativeVariants = Schema.decodeUnknownSync(Schema.Struct({ variants: Schema.Array(nativeVariant),
  count: Schema.Number, offset: Schema.Number, limit: Schema.Number }));
const decodeVariantInventory = Schema.decodeUnknownSync(Schema.Struct({ variants: Schema.Array(Schema.Struct({
  id: Schema.NonEmptyString, inventory_items: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString,
    variant_id: Schema.NonEmptyString, inventory_item_id: Schema.NonEmptyString, required_quantity: Schema.Number,
    inventory: Schema.Struct({ id: Schema.NonEmptyString, sku: Schema.String }) })) })) }));
const decodeVariantQuantities = Schema.decodeUnknownSync(Schema.Struct({ variants: Schema.Array(Schema.Struct({
  id: Schema.NonEmptyString, manage_inventory: Schema.Boolean, inventory_quantity: Schema.optionalKey(Schema.Number) })) }));

/** A fresh native-ready tenant per test. The benchmark keeps its one runtime
 * open throughout warmup and measurement; independent observation requires close. */
async function createAdminProductDOFixture() {
  if (endpoints === undefined) throw new Error("Admin Product app DO requires ordinary PostgreSQL");
  const physical = await createCorePostgresFixture(endpoints);
  let seed: Awaited<ReturnType<typeof prepareProductRequestFixture>> | undefined;
  let runtime: Miniflare | undefined;
  let closed = false;
  const stop = async () => {
    const current = runtime;
    runtime = undefined;
    if (current === undefined) return;
    const failures: unknown[] = [];
    try {
      const response = await current.dispatchFetch("https://native-admin.test/__proof/close", {
        headers: { authorization: `Bearer ${privateToken}` },
      });
      if (!response.ok) throw new Error(await response.text());
    } catch (cause) { failures.push(cause); }
    try { await current.dispose(); } catch (cause) { failures.push(cause); }
    if (failures.length > 0) throw new AggregateError(failures, "Admin Product DO cleanup failed");
  };
  const close = async () => {
    if (closed) return;
    closed = true;
    const failures: unknown[] = [];
    try { await stop(); } catch (cause) { failures.push(cause); }
    try { await seed?.fixture.close(); } catch (cause) { failures.push(cause); }
    try { await physical.close(); } catch (cause) { failures.push(cause); }
    if (failures.length > 0) throw new AggregateError(failures, "Admin Product fixture cleanup failed");
  };
  try {
    seed = await prepareProductRequestFixture("postgres", { target: adminProductDOFixtureTarget,
      physical: { ...physical, close: async () => {} } });
    await seed.fixture.close();
    const catalog = seed.catalog;
    const observe = () => {
      if (runtime !== undefined) throw new Error("The Product DO must drain before independent observation");
      return observeProductRequestFixture({ physical, catalog });
    };
    const seedInventory = (input: Pick<Parameters<typeof seedProductRequestInventory>[0], "stocking" | "reservationBatches">) => {
      if (runtime !== undefined) throw new Error("The Product DO must drain before native Inventory fixture seeding");
      return seedProductRequestInventory({ physical, catalog, ...input });
    };
    const initial = await observe();
    const worker = await bundleApplicationWorker(new URL("./adminProductApplicationDO.workerd.worker.ts", import.meta.url));
    const base = executorApplicationProfileFixture();
    const profile = { ...base, ...adminProductDOFixtureTarget, persistenceNamespace: physical.namespace, instanceName: physical.instanceName };
    const keys = await createExecutorApplicationSecretFixture(profile.keyId);
    const start = () => {
      if (runtime !== undefined) throw new Error("Previous Product DO owner has not drained");
      if (closed) throw new Error("Product fixture is closed");
      runtime = new Miniflare({ modules: [{ type: "ESModule", path: "worker.js", contents: worker }],
        compatibilityDate: "2026-06-14", compatibilityFlags: ["nodejs_compat"],
        bindings: { FLAREX_EXECUTOR_TOKEN: privateToken, ADMIN_PRODUCT_CREDENTIAL: adminCredential,
          FLAREX_APPLICATION_PROFILES: JSON.stringify({ version: 1, profiles: [profile] }), FLAREX_APPLICATION_KEYS: keys },
        hyperdrives: { HYPERDRIVE_CACHE_DISABLED: endpoints.connectionString }, workerLoaders: { LOADER: {} }, r2Buckets: ["ARTIFACTS"],
        durableObjects: { APPLICATIONS: { className: "NativeAdminProductApplicationFixture", useSQLite: true } },
      });
    };
    const request = (input: unknown, options: Readonly<{ private?: boolean; admin?: string; path?: string; signal?: AbortSignal; method?: "POST" | "GET" | "DELETE" }>
      = { private: true, admin: adminCredential }) => {
      if (runtime === undefined) throw new Error("Native Product DO is closed");
      return runtime.dispatchFetch(`https://native-admin.test${options.path ?? path}`, { method: options.method ?? "POST",
        headers: { "content-type": "application/json", origin: "https://admin.test",
          ...(options.private === true ? { authorization: `Bearer ${privateToken}` } : {}),
          ...(options.admin === undefined ? {} : { "x-admin-fixture-token": options.admin }) },
        ...(options.method === "GET" || options.method === "DELETE" ? {} : { body: JSON.stringify(input) }),
        ...(options.signal === undefined ? {} : { signal: options.signal }) });
    };
    const get = (path: string, options: Readonly<{ private?: boolean; admin?: string }> = { private: true, admin: adminCredential }) =>
      request(undefined, { ...options, path, method: "GET" });
    const remove = (path: string, options: Readonly<{ private?: boolean; admin?: string }> = { private: true, admin: adminCredential }) =>
      request(undefined, { ...options, path, method: "DELETE" });
    const probeIncarnation = async () => {
      if (runtime === undefined) throw new Error("Native Product DO is closed");
      const response = await runtime.dispatchFetch("https://native-admin.test/__proof/incarnation", {
        headers: { authorization: `Bearer ${privateToken}` }, signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Incarnation probe returned HTTP ${response.status}`);
      return Schema.decodeUnknownSync(Schema.Struct({ incarnation: Schema.NonEmptyString }))(await response.json()).incarnation;
    };
    return { initial, catalog, start, stop, close, request, get, remove, observe, seedInventory, probeIncarnation };
  } catch (cause) {
    try { await close(); } catch (cleanup) { throw new AggregateError([cause, cleanup], "Product fixture setup and cleanup failed"); }
    throw cause;
  }
}

const benchmarkEnabled = process.env.FLAREX_PRODUCT_DO_BENCH === "1";
const benchmarkInteger = (minimum: number, maximum: number) => Schema.FiniteFromString.check(Schema.makeFilter(value =>
  Number.isSafeInteger(value) && value >= minimum && value <= maximum ? undefined : `Expected an integer from ${minimum} to ${maximum}`));
const benchmarkControl = benchmarkEnabled ? Schema.decodeUnknownSync(Schema.Struct({
  requestsPerCohort: benchmarkInteger(1, 128), requestTimeoutMs: benchmarkInteger(100, 60_000),
}))({ requestsPerCohort: process.env.FLAREX_PRODUCT_DO_BENCH_REQUESTS ?? "20",
  requestTimeoutMs: process.env.FLAREX_PRODUCT_DO_BENCH_TIMEOUT_MS ?? "30000" })
  : { requestsPerCohort: 20, requestTimeoutMs: 30_000 };
const benchmarkTimeoutMs = 300_000 + (6 + 2 * [1, 2, 4, 8].reduce((sum, concurrency) =>
  sum + Math.ceil(benchmarkControl.requestsPerCohort / concurrency), 0)) * benchmarkControl.requestTimeoutMs;

describe.runIf(endpoints !== undefined)("native-ready private Admin Product in the real application DO", () => {
  it("rejects invalid requests and persists products, a managed variant, its price, inventory item and links after DO shutdown", async () => {
    const fixture = await createAdminProductDOFixture();
    const { initial, catalog, start, stop, request, observe } = fixture;
    const primary: unknown[] = [];
    try {
      expect(initial.products).toEqual([]);
      start();
      expect((await request(productInput, { admin: adminCredential })).status).toBe(401);
      expect((await request(productInput, { private: true })).status).toBe(401);
      expect((await request(productInput, { private: true, admin: "invalid-admin" })).status).toBe(401);
      expect((await request(productInput, { private: true, admin: `${adminCredential}-without-policy` })).status).toBe(403);
      expect((await request({ title: 42 })).status).toBe(400);
      expect((await request(productInput, { private: true, admin: adminCredential, path: "/admin/products?fields=unsupported_field" })).status).toBe(400);
      const unsupported = await request({ ...productInput, variants: Array.from({ length: 5 }, (_, index) => ({
        title: `Variant ${index}`, options: { Size: "One" }, prices: [],
      })) });
      expect(unsupported.status, await unsupported.clone().text()).toBe(400);
      expect(await unsupported.json()).toMatchObject({ type: "invalid_data", message: expect.stringContaining("private supported profile") });
      await stop();
      const refused = await observe();
      expect(refused).toEqual(initial);

      start();
      const workflowFailure = await request({ title: "Invalid workflow Product", handle: "no-product-options" });
      expect(workflowFailure.status, await workflowFailure.clone().text()).toBe(400);
      expect(await workflowFailure.json()).toMatchObject({ type: "invalid_data",
        message: "Product options are not provided for: [Invalid workflow Product]." });
      await stop();
      const failed = await observe();
      expect(failed.products).toEqual(initial.products);
      expect(failed.options).toEqual(initial.options);
      expect(failed.optionValues).toEqual(initial.optionValues);

      start();
      const created = await request(productInput);
      expect(created.status, await created.clone().text()).toBe(200);
      expect(created.headers.get("access-control-allow-origin")).toBe("https://admin.test");
      const product = decodeProduct(await created.json()).product;
      expect(product).toMatchObject({ title: productInput.title, handle: productInput.handle,
        options: [{ title: "Size", values: [{ value: "One" }] }] });
      expect(product.id).toMatch(/^prod_/);
      await stop();
      // The HTTP owner is completely closed before an independent Core observer
      // opens the persisted database. This cannot read a workflow/HTTP cache.
      const persisted = await observe();
      expect(persisted.products).toHaveLength(1);
      expect(persisted.products[0]).toMatchObject({ id: product.id, title: productInput.title, handle: productInput.handle });
      expect(persisted.options).toHaveLength(1);
      expect(persisted.options[0]).toMatchObject({ id: product.options[0]?.id, product_id: product.id, title: "Size" });
      expect(persisted.optionValues).toHaveLength(1);
      expect(persisted.optionValues[0]).toMatchObject({ id: product.options[0]?.values[0]?.id, value: "One", option_id: persisted.options[0]?.id });

      start();
      const managedInput = { title: "Real DO Managed Product", handle: "real-do-managed-product",
        options: [{ title: "Size", values: ["One"] }], variants: [{ title: "Managed One", sku: "NATIVE-DO-MANAGED-ONE",
          manage_inventory: true, options: { Size: "One" }, prices: [{ currency_code: "usd", amount: 2500 }] }] };
      const managedResponse = await request(managedInput, { private: true, admin: adminCredential,
        path: managedPath });
      expect(managedResponse.status, await managedResponse.clone().text()).toBe(200);
      const managedBody: unknown = await managedResponse.json();
      const managedProduct = decodeProduct(managedBody).product;
      const variants = decodeVariants(managedBody).product.variants;
      expect(managedProduct).toMatchObject({ title: managedInput.title, handle: managedInput.handle });
      expect(managedProduct.id).toMatch(/^prod_/);
      expect(managedProduct.options).toHaveLength(1);
      const managedOption = managedProduct.options[0];
      if (managedOption === undefined) throw new Error("Native HTTP response omitted its managed Product option");
      expect(managedOption.values).toHaveLength(1);
      const managedOptionValue = managedOption.values[0];
      if (managedOptionValue === undefined) throw new Error("Native HTTP response omitted its managed Product option value");
      expect(variants).toHaveLength(1);
      const variant = variants[0];
      if (variant === undefined) throw new Error("Native HTTP response omitted its created variant");
      expect(variant).toMatchObject({ title: "Managed One", sku: "NATIVE-DO-MANAGED-ONE", manage_inventory: true,
        options: [{ id: managedOptionValue.id, value: "One", option_id: managedOption.id }] });
      await stop();

      const managed = await observe();
      expect(managed.products).toHaveLength(2);
      expect(managed.products.find(row => row.id === managedProduct.id)).toMatchObject({ title: managedInput.title, handle: managedInput.handle });
      expect(managed.options).toHaveLength(2);
      expect(managed.options.find(row => row.id === managedOption.id)).toMatchObject({ product_id: managedProduct.id, title: "Size" });
      expect(managed.optionValues).toHaveLength(2);
      expect(managed.optionValues.find(row => row.id === managedOptionValue.id)).toMatchObject({ option_id: managedOption.id, value: "One" });
      expect(managed.variants).toHaveLength(1);
      expect(managed.variants[0]).toMatchObject({ id: variant.id, product_id: managedProduct.id,
        sku: "NATIVE-DO-MANAGED-ONE", manage_inventory: true });
      expect(managed.variantOptions).toEqual([expect.objectContaining({ variant_id: variant.id,
        option_value_id: managedOptionValue.id })]);

      expect(managed.variantPriceSets).toHaveLength(1);
      const priceLink = decodePriceLink(managed.variantPriceSets[0]);
      expect(priceLink.variant_id).toBe(variant.id);
      expect(managed.priceSets).toEqual([expect.objectContaining({ id: priceLink.price_set_id })]);
      // Native BigNumber uses twenty significant digits for the persisted
      // decimal and its authenticated raw companion; do not coerce to Number.
      expect(managed.prices).toEqual([expect.objectContaining({ price_set_id: priceLink.price_set_id,
        currency_code: "usd", amount: "2500.0000000000000000",
        raw_amount: { value: "2500.0000000000000000", precision: 20 } })]);

      expect(managed.variantInventoryItems).toHaveLength(1);
      const inventoryLink = decodeInventoryLink(managed.variantInventoryItems[0]);
      expect(inventoryLink).toMatchObject({ variant_id: variant.id, required_quantity: 1 });
      expect(managed.inventoryItems).toEqual([expect.objectContaining({ id: inventoryLink.inventory_item_id, sku: "NATIVE-DO-MANAGED-ONE" })]);
      const publications = managed.outcomes.filter(outcome => outcome.timestamp > persisted.publishedTimestamp
        && outcome.value.kind === "nativeRoot" && outcome.value.state === "committed");
      expect(publications).toHaveLength(1);
      const publication = publications[0];
      if (publication === undefined) throw new Error("Created variant has no durable native root outcome");
      const changedRows = managed.businessRows.filter(row => row.timestamp > persisted.publishedTimestamp);
      const tables = catalog.productRuntime.metadata;
      expect(changedRows.map(row => row.table).sort()).toEqual([tables.product.table.name, tables.option.table.name,
        tables.value.table.name, tables.variant.table.name, tables.pivot.table.name, "price_set", "price", "inventory_item",
        "product_variant_price_set", "product_variant_inventory_item"].sort());
      expect(changedRows.every(row => row.timestamp === publication.timestamp)).toBe(true);
      const summary = decodeDurableGraphSummary({ product_id: managed.products.find(row => row.id === managedProduct.id)?.id,
        variant_id: managed.variants[0]?.id, price_set_id: priceLink.price_set_id, price_id: managed.prices[0]?.id,
        inventory_item_id: inventoryLink.inventory_item_id, amount: managed.prices[0]?.amount, currency: managed.prices[0]?.currency_code,
        sku: managed.inventoryItems[0]?.sku, required_quantity: inventoryLink.required_quantity,
        publication_timestamp: publication.timestamp.toString() });
      console.info("Native Product durable graph", JSON.stringify(summary));
    } catch (cause) { primary.push(cause); throw cause; }
    finally {
      try { await fixture.close(); }
      catch (cause) { throw new AggregateError([...primary, cause], "Admin Product proof cleanup failed"); }
    }
  }, 240_000);

  it("reads native Product detail and lists with their own price and inventory links after DO recreation without business writes", async () => {
    const fixture = await createAdminProductDOFixture();
    const primary: unknown[] = [];
    try {
      fixture.start();
      const incarnation = await fixture.probeIncarnation();
      const cases = [
        { title: "Alpha Native Read Product", handle: "alpha-native-read-product", sku: "NATIVE-READ-ALPHA", amount: 1357 },
        { title: "Beta Native Read Product", handle: "beta-native-read-product", sku: "NATIVE-READ-BETA", amount: 8642 },
      ];
      const created: Array<{ id: string; variantId: string; title: string; handle: string; sku: string; amount: number }> = [];
      for (const input of cases) {
        const response = await fixture.request({ title: input.title, handle: input.handle,
          options: [{ title: "Size", values: ["One"] }], variants: [{ title: `${input.title} One`, sku: input.sku,
            manage_inventory: true, options: { Size: "One" }, prices: [{ currency_code: "usd", amount: input.amount }] }] },
        { private: true, admin: adminCredential, path: managedPath });
        expect(response.status, await response.clone().text()).toBe(200);
        const body: unknown = await response.json();
        const product = decodeProduct(body).product;
        const variants = decodeVariants(body).product.variants;
        expect(variants).toHaveLength(1);
        const variant = variants[0];
        if (variant === undefined) throw new Error("Created read fixture omitted its variant");
        created.push({ ...input, id: product.id, variantId: variant.id });
      }
      await fixture.stop();
      // Reopen Core independently before any read, so every later link assertion
      // compares HTTP results with committed storage rather than creation output.
      const persisted = await fixture.observe();
      expect(persisted.products).toHaveLength(2);
      expect(persisted.variants).toHaveLength(2);
      expect(persisted.prices).toHaveLength(2);
      expect(persisted.variantPriceSets).toHaveLength(2);
      expect(persisted.inventoryItems).toHaveLength(2);
      expect(persisted.variantInventoryItems).toHaveLength(2);

      fixture.start();
      expect(await fixture.probeIncarnation()).not.toBe(incarnation);
      const first = created[0], second = created[1];
      if (first === undefined || second === undefined) throw new Error("Expected two committed Product read fixtures");
      const detailPath = `/admin/products/${first.id}?fields=${readFields}`;
      for (const target of ["/admin/products", detailPath]) {
        expect((await fixture.get(target, { admin: adminCredential })).status).toBe(401);
        expect((await fixture.get(target, { private: true })).status).toBe(401);
        expect((await fixture.get(target, { private: true, admin: "invalid-admin" })).status).toBe(401);
        expect((await fixture.get(target, { private: true, admin: `${adminCredential}-without-policy` })).status).toBe(403);
      }
      expect((await fixture.get("/admin/products?limit=invalid")).status).toBe(400);
      expect((await fixture.get(`/admin/products/${first.id}?fields=unsupported_field`)).status).toBe(400);
      const missing = await fixture.get("/admin/products/prod_missing_native_read?fields=id,title");
      expect(missing.status, await missing.clone().text()).toBe(404);
      expect(await missing.json()).toMatchObject({ type: "not_found" });

      const defaultDetail = await fixture.get(`/admin/products/${first.id}`);
      expect(defaultDetail.status, await defaultDetail.clone().text()).toBe(200);
      const defaultBody: unknown = await defaultDetail.json();
      expect(decodeProduct(defaultBody).product).toMatchObject({ id: first.id, title: first.title, handle: first.handle });
      const defaultPrices = decodeDefaultPrices(defaultBody);
      expect(defaultPrices.product.variants).toEqual([expect.objectContaining({ id: first.variantId,
        prices: [expect.objectContaining({ amount: first.amount, currency_code: "usd", variant_id: first.variantId })] })]);
      const defaultList = await fixture.get("/admin/products");
      expect(defaultList.status, await defaultList.clone().text()).toBe(200);
      expect(await defaultList.json()).toMatchObject({ products: expect.arrayContaining([
        expect.objectContaining({ id: first.id }), expect.objectContaining({ id: second.id })]), count: 2, offset: 0, limit: 50 });

      const assertDurableGraph = (product: typeof readProduct.Type) => {
        const expected = created.find(row => row.id === product.id);
        if (expected === undefined) throw new Error("Native GET returned a foreign Product");
        expect(product).toMatchObject({ title: expected.title, handle: expected.handle, status: "draft" });
        expect(persisted.products.find(row => row.id === product.id)).toMatchObject({ title: product.title, handle: product.handle });
        expect(product.variants).toHaveLength(1);
        const variant = product.variants[0];
        if (variant === undefined) throw new Error("Native GET omitted its linked variant");
        expect(variant).toMatchObject({ id: expected.variantId, sku: expected.sku, manage_inventory: true });
        expect(persisted.variants.find(row => row.id === variant.id)).toMatchObject({ product_id: product.id, sku: expected.sku });
        expect(variant.prices).toHaveLength(1);
        const price = variant.prices[0];
        if (price === undefined) throw new Error("Native GET omitted its linked price");
        expect(price).toMatchObject({ amount: expected.amount, currency_code: "usd", variant_id: variant.id });
        expect(persisted.variantPriceSets.find(row => row.variant_id === variant.id)).toMatchObject({ price_set_id: price.price_set_id });
        expect(persisted.priceSets.find(row => row.id === price.price_set_id)).toBeDefined();
        expect(persisted.prices.find(row => row.id === price.id)).toMatchObject({ price_set_id: price.price_set_id,
          currency_code: "usd", amount: `${expected.amount}.0000000000000000` });
        expect(variant.inventory_items).toHaveLength(1);
        const inventoryLink = variant.inventory_items[0];
        if (inventoryLink === undefined) throw new Error("Native GET omitted its linked inventory item");
        expect(inventoryLink).toMatchObject({ variant_id: variant.id, required_quantity: 1,
          inventory: { id: inventoryLink.inventory_item_id, sku: expected.sku } });
        expect(persisted.variantInventoryItems.find(row => row.id === inventoryLink.id)).toMatchObject({
          variant_id: variant.id, inventory_item_id: inventoryLink.inventory_item_id, required_quantity: 1 });
        expect(persisted.inventoryItems.find(row => row.id === inventoryLink.inventory_item_id)).toMatchObject({ sku: expected.sku });
      };
      for (const expected of created) {
        const response = await fixture.get(`/admin/products/${expected.id}?fields=${readFields}`);
        expect(response.status, await response.clone().text()).toBe(200);
        assertDurableGraph(decodeReadProduct(await response.json()).product);
      }
      const ordered = await fixture.get(`/admin/products?fields=${readFields}&order=-handle&offset=1&limit=1`);
      expect(ordered.status, await ordered.clone().text()).toBe(200);
      const page = decodeReadProducts(await ordered.json());
      expect(page).toMatchObject({ count: 2, offset: 1, limit: 1 });
      expect(page.products.map(product => product.id)).toEqual([first.id]);
      page.products.forEach(assertDurableGraph);
      const filtered = await fixture.get(`/admin/products?fields=${readFields}&handle=${second.handle}&order=handle&limit=1`);
      expect(filtered.status, await filtered.clone().text()).toBe(200);
      const filteredPage = decodeReadProducts(await filtered.json());
      expect(filteredPage).toMatchObject({ count: 1, offset: 0, limit: 1 });
      expect(filteredPage.products.map(product => product.id)).toEqual([second.id]);
      filteredPage.products.forEach(assertDurableGraph);
      await fixture.stop();
      const afterReads = await fixture.observe();
      for (const key of ["rows", "revisions", "indexes", "businessRows", "products", "options", "optionValues", "variants", "variantOptions",
        "priceSets", "prices", "inventoryItems", "variantPriceSets", "variantInventoryItems"] as const) {
        expect(afterReads[key], `GET requests changed durable ${key}`).toEqual(persisted[key]);
      }
    } catch (cause) { primary.push(cause); throw cause; }
    finally {
      try { await fixture.close(); }
      catch (cause) { throw new AggregateError([...primary, cause], "Admin Product read proof cleanup failed"); }
    }
  }, 240_000);

  it("updates a native Product and its existing variant price with default responses, preserving both durable graphs after DO recreation", async () => {
    const fixture = await createAdminProductDOFixture();
    const primary: unknown[] = [];
    try {
      fixture.start();
      const firstIncarnation = await fixture.probeIncarnation();
      const inputs = [
        { title: "Alpha Native Update Product", handle: "alpha-native-update-product", sku: "NATIVE-UPDATE-ALPHA", amount: 1357 },
        { title: "Beta Native Update Product", handle: "beta-native-update-product", sku: "NATIVE-UPDATE-BETA", amount: 8642 },
      ];
      const created = [];
      for (const input of inputs) {
        const response = await fixture.request({ title: input.title, handle: input.handle,
          options: [{ title: "Size", values: ["One"] }], variants: [{ title: `${input.title} One`, sku: input.sku,
            manage_inventory: true, options: { Size: "One" }, prices: [{ currency_code: "usd", amount: input.amount }] }] },
        { private: true, admin: adminCredential, path: "/admin/products" });
        expect(response.status, await response.clone().text()).toBe(200);
        const body: unknown = await response.json();
        const product = decodeProduct(body).product;
        const variants = decodeVariants(body).product.variants;
        const pricedVariants = decodeDefaultPrices(body).product.variants;
        expect(product).toMatchObject({ title: input.title, handle: input.handle, status: "draft" });
        expect(variants).toHaveLength(1);
        expect(pricedVariants).toHaveLength(1);
        const variant = variants[0], pricedVariant = pricedVariants[0];
        if (variant === undefined || pricedVariant === undefined) throw new Error("Default create response omitted its native variant");
        expect(pricedVariant.prices).toHaveLength(1);
        const price = pricedVariant.prices[0];
        if (price === undefined) throw new Error("Default create response omitted its native price");
        expect(price).toMatchObject({ amount: input.amount, currency_code: "usd", variant_id: variant.id });
        expect(variant).toMatchObject({ sku: input.sku, manage_inventory: true });
        created.push({ ...input, id: product.id, variantId: variant.id, priceId: price.id, priceSetId: price.price_set_id });
      }
      const first = created[0], second = created[1];
      if (first === undefined || second === undefined) throw new Error("Expected two native Product update fixtures");
      await fixture.stop();
      const before = await fixture.observe();
      for (const key of ["products", "options", "optionValues", "variants", "variantOptions", "priceSets", "prices",
        "inventoryItems", "variantPriceSets", "variantInventoryItems"] as const) expect(before[key]).toHaveLength(2);
      for (const expected of created) {
        expect(before.products.find(row => row.id === expected.id)).toMatchObject({ title: expected.title, status: "draft" });
        expect(before.variantPriceSets.find(row => row.variant_id === expected.variantId)).toMatchObject({ price_set_id: expected.priceSetId });
        expect(before.prices.find(row => row.id === expected.priceId)).toMatchObject({ price_set_id: expected.priceSetId,
          amount: `${expected.amount}.0000000000000000`, currency_code: "usd" });
        const inventoryLink = decodeInventoryLink(before.variantInventoryItems.find(row => row.variant_id === expected.variantId));
        expect(before.inventoryItems.find(row => row.id === inventoryLink.inventory_item_id)).toMatchObject({ sku: expected.sku });
      }

      fixture.start();
      const updatePath = `/admin/products/${first.id}`;
      const refusedUpdate = { title: "Must not be persisted", status: "published" };
      expect((await fixture.request(refusedUpdate, { admin: adminCredential, path: updatePath })).status).toBe(401);
      expect((await fixture.request(refusedUpdate, { private: true, path: updatePath })).status).toBe(401);
      expect((await fixture.request(refusedUpdate, { private: true, admin: "invalid-admin", path: updatePath })).status).toBe(401);
      expect((await fixture.request(refusedUpdate, { private: true, admin: `${adminCredential}-without-policy`, path: updatePath })).status).toBe(403);
      const invalid = await fixture.request({ title: 42 }, { private: true, admin: adminCredential, path: updatePath });
      expect(invalid.status, await invalid.clone().text()).toBe(400);
      expect(await invalid.json()).toMatchObject({ type: "invalid_data" });
      const unsupported = await fixture.request(refusedUpdate, { private: true, admin: adminCredential,
        path: `${updatePath}?fields=unsupported_field` });
      expect(unsupported.status, await unsupported.clone().text()).toBe(400);
      expect(await unsupported.json()).toMatchObject({ type: "invalid_data" });
      const missingId = "prod_missing_native_update";
      const missing = await fixture.request(refusedUpdate, { private: true, admin: adminCredential, path: `/admin/products/${missingId}` });
      expect(missing.status, await missing.clone().text()).toBe(404);
      expect(await missing.json()).toMatchObject({ type: "not_found", message: `Product with id "${missingId}" not found` });
      await fixture.stop();
      const refused = await fixture.observe();
      for (const key of ["rows", "revisions", "indexes", "outcomes", "businessRows", "products", "options", "optionValues", "variants",
        "variantOptions", "priceSets", "prices", "inventoryItems", "variantPriceSets", "variantInventoryItems"] as const) {
        expect(refused[key], `Refused native updates changed durable ${key}`).toEqual(before[key]);
      }

      fixture.start();
      const updateIncarnation = await fixture.probeIncarnation();
      expect(updateIncarnation).not.toBe(firstIncarnation);
      const title = "Alpha Native Updated Product", amount = 4242;
      const updated = await fixture.request({ title, status: "published", variants: [{ id: first.variantId,
        prices: [{ id: first.priceId, currency_code: "usd", amount }] }] },
      { private: true, admin: adminCredential, path: updatePath });
      expect(updated.status, await updated.clone().text()).toBe(200);
      const updatedBody: unknown = await updated.json();
      expect(decodeProduct(updatedBody).product).toMatchObject({ id: first.id, title, handle: first.handle, status: "published" });
      expect(decodeVariants(updatedBody).product.variants).toEqual([expect.objectContaining({ id: first.variantId,
        sku: first.sku, manage_inventory: true })]);
      expect(decodeDefaultPrices(updatedBody).product.variants).toEqual([expect.objectContaining({ id: first.variantId,
        prices: [expect.objectContaining({ id: first.priceId, price_set_id: first.priceSetId, variant_id: first.variantId,
          amount, currency_code: "usd" })] })]);
      await fixture.stop();
      const persisted = await fixture.observe();
      expect(persisted.products).toHaveLength(2);
      expect(persisted.variants).toHaveLength(2);
      expect(persisted.priceSets).toHaveLength(2);
      expect(persisted.prices).toHaveLength(2);
      expect(persisted.products.find(row => row.id === first.id)).toMatchObject({ title, status: "published", handle: first.handle });
      expect(persisted.prices.find(row => row.id === first.priceId)).toMatchObject({ price_set_id: first.priceSetId,
        currency_code: "usd", amount: `${amount}.0000000000000000`, raw_amount: { value: `${amount}.0000000000000000`, precision: 20 } });
      for (const key of ["options", "optionValues", "variantOptions", "inventoryItems", "variantPriceSets", "variantInventoryItems"] as const) {
        expect(persisted[key], `Native update changed unrelated ${key}`).toEqual(before[key]);
      }
      for (const [key, id] of [["products", second.id], ["variants", second.variantId], ["prices", second.priceId],
        ["priceSets", second.priceSetId]] as const) {
        expect(persisted[key].find(row => row.id === id), `Native update changed the second Product's ${key}`)
          .toEqual(before[key].find(row => row.id === id));
      }
      const publications = persisted.outcomes.filter(outcome => outcome.timestamp > refused.publishedTimestamp
        && outcome.value.kind === "nativeRoot" && outcome.value.state === "committed");
      expect(publications).toHaveLength(1);
      const publication = publications[0];
      if (publication === undefined) throw new Error("Updated Product has no durable native root outcome");
      const revisions = persisted.revisions.filter(revision => revision.timestamp > refused.publishedTimestamp);
      expect(revisions.length).toBeGreaterThanOrEqual(2);
      expect(revisions.every(revision => revision.timestamp === publication.timestamp)).toBe(true);
      expect(revisions).toEqual(expect.arrayContaining([
        expect.objectContaining({ previous: expect.any(BigInt), deleted: false, value: expect.objectContaining({ id: first.id, title, status: "published" }) }),
        expect.objectContaining({ previous: expect.any(BigInt), deleted: false,
          value: expect.objectContaining({ id: first.priceId, amount: `${amount}.0000000000000000` }) }),
      ]));

      fixture.start();
      expect(await fixture.probeIncarnation()).not.toBe(updateIncarnation);
      const defaultRead = await fixture.get(updatePath);
      expect(defaultRead.status, await defaultRead.clone().text()).toBe(200);
      const defaultBody: unknown = await defaultRead.json();
      expect(decodeProduct(defaultBody).product).toMatchObject({ id: first.id, title, status: "published" });
      expect(decodeDefaultPrices(defaultBody).product.variants).toEqual([expect.objectContaining({ id: first.variantId,
        prices: [expect.objectContaining({ id: first.priceId, price_set_id: first.priceSetId, amount })] })]);
      for (const expected of created) {
        const response = await fixture.get(`/admin/products/${expected.id}?fields=${readFields}`);
        expect(response.status, await response.clone().text()).toBe(200);
        const product = decodeReadProduct(await response.json()).product;
        expect(product).toMatchObject({ id: expected.id, title: expected.id === first.id ? title : expected.title,
          handle: expected.handle, status: expected.id === first.id ? "published" : "draft" });
        const inventoryLink = decodeInventoryLink(persisted.variantInventoryItems.find(row => row.variant_id === expected.variantId));
        expect(product.variants).toEqual([expect.objectContaining({ id: expected.variantId, sku: expected.sku, manage_inventory: true,
          prices: [expect.objectContaining({ id: expected.priceId, price_set_id: expected.priceSetId, variant_id: expected.variantId,
            amount: expected.id === first.id ? amount : expected.amount, currency_code: "usd" })],
          inventory_items: [expect.objectContaining({ variant_id: expected.variantId, inventory_item_id: inventoryLink.inventory_item_id,
            required_quantity: 1, inventory: { id: inventoryLink.inventory_item_id, sku: expected.sku } })] })]);
      }
      await fixture.stop();
      const afterReads = await fixture.observe();
      for (const key of ["rows", "revisions", "indexes", "businessRows", "products", "options", "optionValues", "variants", "variantOptions",
        "priceSets", "prices", "inventoryItems", "variantPriceSets", "variantInventoryItems"] as const) {
        expect(afterReads[key], `Restarted native reads changed durable ${key}`).toEqual(persisted[key]);
      }
    } catch (cause) { primary.push(cause); throw cause; }
    finally {
      try { await fixture.close(); }
      catch (cause) { throw new AggregateError([...primary, cause], "Admin Product update proof cleanup failed"); }
    }
  }, 240_000);

  it("deletes only the native Product's owned graph atomically and reads the surviving graph after DO recreation", async () => {
    const fixture = await createAdminProductDOFixture();
    const primary: unknown[] = [];
    try {
      fixture.start();
      const created = [];
      for (const input of [
        { title: "Alpha Native Delete Product", handle: "alpha-native-delete-product", sku: "NATIVE-DELETE-ALPHA", amount: 1357 },
        { title: "Beta Native Delete Product", handle: "beta-native-delete-product", sku: "NATIVE-DELETE-BETA", amount: 8642 },
      ]) {
        const response = await fixture.request({ title: input.title, handle: input.handle,
          options: [{ title: "Size", values: ["One"] }], variants: [{ title: `${input.title} One`, sku: input.sku,
            manage_inventory: true, options: { Size: "One" }, prices: [{ currency_code: "usd", amount: input.amount }] }] },
        { private: true, admin: adminCredential, path: "/admin/products" });
        expect(response.status, await response.clone().text()).toBe(200);
        const body: unknown = await response.json();
        const product = decodeProduct(body).product;
        const variants = decodeVariants(body).product.variants;
        const pricedVariants = decodeDefaultPrices(body).product.variants;
        expect(variants).toHaveLength(1);
        expect(pricedVariants).toHaveLength(1);
        const variant = variants[0], pricedVariant = pricedVariants[0];
        if (variant === undefined || pricedVariant === undefined) throw new Error("Native create omitted its deletion fixture variant");
        expect(pricedVariant.prices).toHaveLength(1);
        const price = pricedVariant.prices[0];
        if (price === undefined) throw new Error("Native create omitted its deletion fixture price");
        expect(price).toMatchObject({ amount: input.amount, currency_code: "usd", variant_id: variant.id });
        created.push({ ...input, id: product.id, variantId: variant.id, priceId: price.id, priceSetId: price.price_set_id });
      }
      const first = created[0], second = created[1];
      if (first === undefined || second === undefined) throw new Error("Expected two native Product deletion fixtures");
      await fixture.stop();
      const before = await fixture.observe();
      for (const key of ["products", "options", "optionValues", "variants", "variantOptions", "priceSets", "prices",
        "inventoryItems", "variantPriceSets", "variantInventoryItems"] as const) expect(before[key]).toHaveLength(2);
      const firstInventory = decodeInventoryLink(before.variantInventoryItems.find(row => row.variant_id === first.variantId));
      const secondInventory = decodeInventoryLink(before.variantInventoryItems.find(row => row.variant_id === second.variantId));
      expect(firstInventory.inventory_item_id).not.toBe(secondInventory.inventory_item_id);
      expect(first.priceSetId).not.toBe(second.priceSetId);
      for (const expected of created) {
        expect(before.products.find(row => row.id === expected.id)).toMatchObject({ title: expected.title, deleted_at: null });
        expect(before.variants.find(row => row.id === expected.variantId)).toMatchObject({ product_id: expected.id, sku: expected.sku, manage_inventory: true });
        expect(before.variantPriceSets.find(row => row.variant_id === expected.variantId)).toMatchObject({ price_set_id: expected.priceSetId });
        expect(before.prices.find(row => row.id === expected.priceId)).toMatchObject({ price_set_id: expected.priceSetId,
          amount: `${expected.amount}.0000000000000000`, currency_code: "usd" });
        const inventory = decodeInventoryLink(before.variantInventoryItems.find(row => row.variant_id === expected.variantId));
        expect(before.inventoryItems.find(row => row.id === inventory.inventory_item_id)).toMatchObject({ sku: expected.sku, deleted_at: null });
      }

      fixture.start();
      const deletePath = `/admin/products/${first.id}`;
      expect((await fixture.remove(deletePath, { admin: adminCredential })).status).toBe(401);
      expect((await fixture.remove(deletePath, { private: true })).status).toBe(401);
      expect((await fixture.remove(deletePath, { private: true, admin: "invalid-admin" })).status).toBe(401);
      expect((await fixture.remove(deletePath, { private: true, admin: `${adminCredential}-without-policy` })).status).toBe(403);
      expect((await fixture.remove(deletePath, { private: true, admin: `${adminCredential}-read-only` })).status).toBe(403);
      const invalid = await fixture.remove(`${deletePath}?fields=__proto__.x`);
      expect(invalid.status, await invalid.clone().text()).toBe(400);
      expect(await invalid.json()).toMatchObject({ type: "invalid_data" });
      await fixture.stop();
      const refused = await fixture.observe();
      expect(refused).toEqual(before);

      fixture.start();
      const deleteIncarnation = await fixture.probeIncarnation();
      const deleted = await fixture.remove(deletePath);
      expect(deleted.status, await deleted.clone().text()).toBe(200);
      expect(await deleted.json()).toEqual({ id: first.id, object: "product", deleted: true });
      await fixture.stop();
      const persisted = await fixture.observe();
      const ownedRows = {
        products: (row: Record<string, unknown>) => row.id === first.id,
        options: (row: Record<string, unknown>) => row.product_id === first.id,
        optionValues: (row: Record<string, unknown>) => before.options.some(option => option.product_id === first.id && option.id === row.option_id),
        variants: (row: Record<string, unknown>) => row.id === first.variantId,
        priceSets: (row: Record<string, unknown>) => row.id === first.priceSetId,
        prices: (row: Record<string, unknown>) => row.id === first.priceId,
        inventoryItems: (row: Record<string, unknown>) => row.id === firstInventory.inventory_item_id,
        variantPriceSets: (row: Record<string, unknown>) => row.variant_id === first.variantId,
        variantInventoryItems: (row: Record<string, unknown>) => row.variant_id === first.variantId,
      };
      for (const key of ["products", "options", "optionValues", "variants", "priceSets", "prices", "inventoryItems",
        "variantPriceSets", "variantInventoryItems"] as const) {
        // Native deletion soft-deletes the exclusive managed Inventory Item and
        // owned Pricing records through Link; all durable rows remain present.
        expect(persisted[key]).toHaveLength(2);
        const owned = persisted[key].filter(ownedRows[key]);
        expect(owned, `Native deletion omitted its owned ${key}`).toHaveLength(1);
        expect(owned).toEqual([expect.objectContaining({ deleted_at: expect.any(String) })]);
        expect(persisted[key].filter(row => !ownedRows[key](row)), `Native deletion changed the other Product's ${key}`)
          .toEqual(before[key].filter(row => !ownedRows[key](row)));
      }
      // Native soft-delete retains module-local option pivots, including those
      // whose endpoints are deleted. They are not remote Link lifecycle rows.
      expect(persisted.variantOptions).toEqual(before.variantOptions);
      const publications = persisted.outcomes.filter(outcome => outcome.timestamp > refused.publishedTimestamp
        && outcome.value.kind === "nativeRoot" && outcome.value.state === "committed");
      expect(publications).toHaveLength(1);
      const publication = publications[0];
      if (publication === undefined) throw new Error("Deleted Product has no durable native root outcome");
      const familyTable = fixture.catalog.eventDefinition.tables.find(table => table.privateEvent?.role === "family")?.name;
      const envelopeTable = fixture.catalog.eventDefinition.tables.find(table => table.privateEvent?.role === "envelope")?.name;
      if (familyTable === undefined || envelopeTable === undefined) throw new Error("Native Product fixture omitted event storage");
      expect(persisted.rows.filter(row => row.table === familyTable && row.timestamp === publication.timestamp)).toHaveLength(1);
      expect(persisted.rows.filter(row => row.table === envelopeTable && row.timestamp === publication.timestamp).map(row => row.value))
        .toEqual(expect.arrayContaining([expect.objectContaining({ envelope: expect.objectContaining({ contract: "product.deleted",
          message: expect.objectContaining({ data: { id: first.id } }) }) })]));
      const changedRows = persisted.businessRows.filter(row => row.timestamp > refused.publishedTimestamp);
      expect(changedRows).toHaveLength(9);
      expect(changedRows.every(row => row.timestamp === publication.timestamp)).toBe(true);
      const revisions = persisted.revisions.filter(revision => revision.timestamp > refused.publishedTimestamp);
      expect(revisions.length).toBeGreaterThanOrEqual(9);
      expect(revisions.every(revision => revision.timestamp === publication.timestamp)).toBe(true);
      for (const id of [first.id, first.variantId, first.priceSetId, first.priceId, firstInventory.inventory_item_id]) {
        expect(revisions).toContainEqual(expect.objectContaining({ previous: expect.any(BigInt), deleted: false,
          value: expect.objectContaining({ id, deleted_at: expect.any(String) }) }));
      }

      fixture.start();
      expect(await fixture.probeIncarnation()).not.toBe(deleteIncarnation);
      const missingDetail = await fixture.get(deletePath);
      expect(missingDetail.status, await missingDetail.clone().text()).toBe(404);
      expect(await missingDetail.json()).toMatchObject({ type: "not_found", message: "Product not found" });
      const list = await fixture.get(`/admin/products?fields=${readFields}&order=handle`);
      expect(list.status, await list.clone().text()).toBe(200);
      const listed = decodeReadProducts(await list.json());
      expect(listed.count).toBe(1);
      expect(listed.products.map(product => product.id)).toEqual([second.id]);
      const detail = await fixture.get(`/admin/products/${second.id}?fields=${readFields}`);
      expect(detail.status, await detail.clone().text()).toBe(200);
      const survivor = decodeReadProduct(await detail.json()).product;
      expect(listed.products).toEqual([survivor]);
      expect(survivor).toMatchObject({ id: second.id, title: second.title, handle: second.handle });
      expect(survivor.variants).toEqual([expect.objectContaining({ id: second.variantId, sku: second.sku, manage_inventory: true,
        prices: [expect.objectContaining({ id: second.priceId, price_set_id: second.priceSetId, variant_id: second.variantId,
          amount: second.amount, currency_code: "usd" })],
        inventory_items: [expect.objectContaining({ variant_id: second.variantId, inventory_item_id: secondInventory.inventory_item_id,
          required_quantity: 1, inventory: { id: secondInventory.inventory_item_id, sku: second.sku } })] })]);
      await fixture.stop();
      const afterReads = await fixture.observe();
      for (const key of ["rows", "revisions", "indexes", "businessRows", "products", "options", "optionValues", "variants", "variantOptions",
        "priceSets", "prices", "inventoryItems", "variantPriceSets", "variantInventoryItems"] as const) {
        expect(afterReads[key], `Restarted native reads changed durable ${key}`).toEqual(persisted[key]);
      }

      // The pinned DELETE route has no existence check. A fresh workflow request
      // for either a deleted or absent ID still succeeds; GET owns its 404.
      fixture.start();
      for (const id of [first.id, "prod_missing_native_delete"]) {
        const response = await fixture.remove(`/admin/products/${id}`);
        expect(response.status, await response.clone().text()).toBe(200);
        expect(await response.json()).toEqual({ id, object: "product", deleted: true });
      }
      await fixture.stop();
      const afterRepeated = await fixture.observe();
      for (const key of ["businessRows", "products", "options", "optionValues", "variants", "variantOptions",
        "priceSets", "prices", "inventoryItems", "variantPriceSets", "variantInventoryItems"] as const) {
        expect(afterRepeated[key], `Repeated or missing DELETE changed business ${key}`).toEqual(afterReads[key]);
      }
      expect(afterRepeated.outcomes.filter(outcome => outcome.timestamp > afterReads.publishedTimestamp
        && outcome.value.kind === "nativeRoot" && outcome.value.state === "committed")).toHaveLength(2);
    } catch (cause) { primary.push(cause); throw cause; }
    finally {
      try { await fixture.close(); }
      catch (cause) { throw new AggregateError([...primary, cause], "Admin Product delete proof cleanup failed"); }
    }
  }, 240_000);

  it("creates native variants and reads their own prices, options, inventory and parent scope across DO recreation", async () => {
    const fixture = await createAdminProductDOFixture();
    const primary: unknown[] = [];
    try {
      fixture.start();
      const parentResponse = await fixture.request({ title: "Native Variant Parent", handle: "native-variant-parent",
        options: [{ title: "Size", values: ["Small", "Large"] }] }, { private: true, admin: adminCredential, path: "/admin/products" });
      expect(parentResponse.status, await parentResponse.clone().text()).toBe(200);
      const parentBody: unknown = await parentResponse.json();
      const parent = decodeProduct(parentBody).product;
      expect(decodeVariants(parentBody).product.variants).toEqual([]);
      const otherResponse = await fixture.request({ title: "Other Variant Parent", handle: "other-variant-parent",
        options: [{ title: "Size", values: ["One"] }], variants: [{ title: "Other Unmanaged", sku: "NATIVE-VARIANT-OTHER",
          manage_inventory: false, options: { Size: "One" }, prices: [{ currency_code: "usd", amount: 9999 }] }] },
      { private: true, admin: adminCredential, path: "/admin/products" });
      expect(otherResponse.status, await otherResponse.clone().text()).toBe(200);
      const otherBody: unknown = await otherResponse.json();
      const other = decodeProduct(otherBody).product;
      const otherVariant = decodeVariants(otherBody).product.variants[0];
      if (otherVariant === undefined) throw new Error("Other Product omitted its native variant");
      await fixture.stop();
      const before = await fixture.observe();
      const collection = `/admin/products/${parent.id}/variants`;
      const validInput = { title: "Managed Small", sku: "NATIVE-VARIANT-SMALL", manage_inventory: true,
        options: { Size: "Small" }, prices: [{ currency_code: "usd", amount: 1234 }] };

      fixture.start();
      for (const target of [collection, `${collection}/${otherVariant.id}`]) {
        expect((await fixture.get(target, { admin: adminCredential })).status).toBe(401);
        expect((await fixture.get(target, { private: true })).status).toBe(401);
        expect((await fixture.get(target, { private: true, admin: "invalid-admin" })).status).toBe(401);
        expect((await fixture.get(target, { private: true, admin: `${adminCredential}-without-policy` })).status).toBe(403);
        expect((await fixture.get(`${target}?fields=unsupported_field`)).status).toBe(400);
      }
      const create = (body: unknown, admin = adminCredential, target = collection) =>
        fixture.request(body, { private: true, admin, path: target });
      expect((await fixture.request(validInput, { admin: adminCredential, path: collection })).status).toBe(401);
      expect((await fixture.request(validInput, { private: true, path: collection })).status).toBe(401);
      expect((await create(validInput, "invalid-admin")).status).toBe(401);
      expect((await create(validInput, `${adminCredential}-without-policy`)).status).toBe(403);
      // The reader passes the inherited Product read check but lacks the native
      // Product Variant create policy on the collection route.
      expect((await create(validInput, `${adminCredential}-read-only`)).status).toBe(403);
      expect((await create({ ...validInput, title: 42 })).status).toBe(400);
      expect((await create(validInput, adminCredential, `${collection}?fields=unsupported_field`)).status).toBe(400);
      expect((await fixture.get(`${collection}?limit=invalid`)).status).toBe(400);
      await fixture.stop();
      expect(await fixture.observe()).toEqual(before);

      fixture.start();
      for (const target of [collection, "/admin/products/prod_missing_native_variant/variants"]) {
        const invalid = await create({ ...validInput, options: { Unknown: "Small" } }, adminCredential, target);
        expect(invalid.status, await invalid.clone().text()).toBe(400);
        expect(await invalid.json()).toMatchObject({ type: "invalid_data" });
      }
      await fixture.stop();
      const failed = await fixture.observe();
      for (const key of ["businessRows", "products", "options", "optionValues", "variants", "variantOptions", "priceSets", "prices",
        "inventoryItems", "variantPriceSets", "variantInventoryItems"] as const) expect(failed[key]).toEqual(before[key]);

      const created: Array<{ id: string; title: string; sku: string; size: string; amount: number }> = [];
      let previous = failed;
      for (const input of [{ ...validInput, size: "Small", amount: 1234 },
        { title: "Managed Large", sku: "NATIVE-VARIANT-LARGE", manage_inventory: true,
          options: { Size: "Large" }, prices: [{ currency_code: "usd", amount: 5678 }], size: "Large", amount: 5678 }]) {
        fixture.start();
        const { size, amount, ...body } = input;
        const response = await create(body);
        expect(response.status, await response.clone().text()).toBe(200);
        const result: unknown = await response.json();
        // Native collection POST returns the default parent Product response.
        expect(decodeProduct(result).product).toMatchObject({ id: parent.id, title: parent.title });
        const variants = decodeVariants(result).product.variants;
        const variant = variants.find(value => value.sku === input.sku);
        if (variant === undefined) throw new Error("Native Variant POST omitted its created variant from the parent");
        expect(variants).toHaveLength(created.length + 1);
        expect(variant).toMatchObject({ title: input.title, manage_inventory: true });
        const option = parent.options.find(value => value.title === "Size");
        const optionValue = option?.values.find(value => value.value === size);
        if (option === undefined || optionValue === undefined) throw new Error("Parent omitted its native Size option");
        expect(variant.options).toEqual([{ id: optionValue.id, option_id: option.id, value: size }]);
        expect(decodeDefaultPrices(result).product.variants.find(value => value.id === variant.id)?.prices)
          .toEqual([expect.objectContaining({ variant_id: variant.id, amount, currency_code: "usd" })]);
        created.push({ id: variant.id, title: input.title, sku: input.sku, size, amount });
        await fixture.stop();
        const current = await fixture.observe();
        const publications = current.outcomes.filter(outcome => outcome.timestamp > previous.publishedTimestamp
          && outcome.value.kind === "nativeRoot" && outcome.value.state === "committed");
        expect(publications).toHaveLength(1);
        const publication = publications[0];
        if (publication === undefined) throw new Error("Variant creation omitted its committed native root outcome");
        const changed = current.businessRows.filter(row => row.timestamp > previous.publishedTimestamp);
        const tables = fixture.catalog.productRuntime.metadata;
        expect(changed.map(row => row.table).sort()).toEqual([tables.variant.table.name, tables.pivot.table.name,
          "price_set", "price", "inventory_item", "product_variant_price_set", "product_variant_inventory_item"].sort());
        expect(changed.every(row => row.timestamp === publication.timestamp)).toBe(true);
        expect(current.products).toEqual(before.products);
        expect(current.options).toEqual(before.options);
        expect(current.optionValues).toEqual(before.optionValues);
        expect(current.variants.find(row => row.id === variant.id)).toMatchObject({ product_id: parent.id, sku: input.sku });
        expect(current.variantOptions).toContainEqual(expect.objectContaining({ variant_id: variant.id, option_value_id: optionValue.id }));
        const priceLink = decodePriceLink(current.variantPriceSets.find(row => row.variant_id === variant.id));
        expect(current.priceSets).toContainEqual(expect.objectContaining({ id: priceLink.price_set_id }));
        expect(current.prices).toContainEqual(expect.objectContaining({ price_set_id: priceLink.price_set_id, currency_code: "usd",
          amount: `${amount}.0000000000000000`, raw_amount: { value: `${amount}.0000000000000000`, precision: 20 } }));
        const inventoryLink = decodeInventoryLink(current.variantInventoryItems.find(row => row.variant_id === variant.id));
        expect(inventoryLink.required_quantity).toBe(1);
        expect(current.inventoryItems).toContainEqual(expect.objectContaining({ id: inventoryLink.inventory_item_id, sku: input.sku }));
        previous = current;
      }
      const persisted = previous;
      fixture.start();
      const incarnation = await fixture.probeIncarnation();
      const listResponse = await fixture.get(collection, { private: true, admin: `${adminCredential}-read-only` });
      expect(listResponse.status, await listResponse.clone().text()).toBe(200);
      const list = decodeNativeVariants(await listResponse.json());
      expect(list).toMatchObject({ count: 2, offset: 0, limit: 50 });
      expect(list.variants.map(variant => variant.id).sort()).toEqual(created.map(variant => variant.id).sort());
      const assertVariant = (variant: typeof nativeVariant.Type) => {
        const expected = created.find(row => row.id === variant.id);
        if (expected === undefined) throw new Error("Variant read crossed its Product boundary");
        expect(variant).toMatchObject({ product_id: parent.id, title: expected.title, sku: expected.sku, manage_inventory: true });
        expect(variant.options).toEqual([expect.objectContaining({ value: expected.size })]);
        const priceLink = decodePriceLink(persisted.variantPriceSets.find(row => row.variant_id === variant.id));
        const price = persisted.prices.find(row => row.price_set_id === priceLink.price_set_id);
        if (typeof price?.id !== "string") throw new Error("Persisted Variant price omitted its ID");
        expect(variant.prices).toEqual([expect.objectContaining({ id: price.id, price_set_id: priceLink.price_set_id,
          variant_id: variant.id, amount: expected.amount, currency_code: "usd" })]);
      };
      list.variants.forEach(assertVariant);
      for (const expected of created) {
        const detail = await fixture.get(`${collection}/${expected.id}`);
        expect(detail.status, await detail.clone().text()).toBe(200);
        assertVariant(decodeNativeVariant(await detail.json()).variant);
      }
      const rich = await fixture.get(`${collection}?fields=id,*inventory_items,*inventory_items.inventory`);
      expect(rich.status, await rich.clone().text()).toBe(200);
      const richVariants = decodeVariantInventory(await rich.json()).variants;
      expect(richVariants).toHaveLength(2);
      for (const variant of richVariants) {
        const expected = created.find(row => row.id === variant.id);
        if (expected === undefined) throw new Error("Rich Variant read crossed its Product boundary");
        const link = persisted.variantInventoryItems.find(row => row.variant_id === variant.id);
        if (typeof link?.id !== "string") throw new Error("Persisted Variant inventory link omitted its ID");
        const inventory = decodeInventoryLink(link);
        expect(variant.inventory_items).toEqual([expect.objectContaining({ id: link.id, ...inventory,
          inventory: { id: inventory.inventory_item_id, sku: expected.sku } })]);
      }
      const quantities = await fixture.get(`${collection}?fields=id,manage_inventory,inventory_quantity`);
      expect(quantities.status, await quantities.clone().text()).toBe(200);
      expect(decodeVariantQuantities(await quantities.json()).variants).toEqual(expect.arrayContaining(created.map(variant => ({
        id: variant.id, manage_inventory: true, inventory_quantity: 0 }))));
      const otherList = await fixture.get(`/admin/products/${other.id}/variants?fields=id,manage_inventory,inventory_quantity`);
      expect(otherList.status, await otherList.clone().text()).toBe(200);
      expect(decodeVariantQuantities(await otherList.json()).variants).toEqual([{ id: otherVariant.id, manage_inventory: false }]);
      const wrongParent = await fixture.get(`${collection}/${otherVariant.id}`);
      expect(wrongParent.status, await wrongParent.clone().text()).toBe(200);
      // Pinned remapVariantResponse(undefined) is omitted by JSON serialization.
      expect(await wrongParent.json()).toEqual({});
      const absent = await fixture.get("/admin/products/prod_missing_native_variant/variants");
      expect(absent.status, await absent.clone().text()).toBe(200);
      expect(await absent.json()).toEqual({ variants: [], count: 0, offset: 0, limit: 50 });
      expect((await fixture.get(`${collection}?order=sku`)).status).toBe(400);
      const page = await fixture.get(`${collection}?order=id&offset=1&limit=1`);
      expect(page.status, await page.clone().text()).toBe(200);
      expect(decodeNativeVariants(await page.json())).toMatchObject({ count: 2, offset: 1, limit: 1,
        variants: [expect.objectContaining({ id: created.map(variant => variant.id).sort()[1] })] });
      await fixture.stop();
      fixture.start();
      expect(await fixture.probeIncarnation()).not.toBe(incarnation);
      for (const expected of created) {
        const detail = await fixture.get(`${collection}/${expected.id}`);
        expect(detail.status, await detail.clone().text()).toBe(200);
        assertVariant(decodeNativeVariant(await detail.json()).variant);
      }
      const retained = await fixture.get(`${collection}?fields=id,*inventory_items,*inventory_items.inventory`);
      expect(retained.status, await retained.clone().text()).toBe(200);
      expect(decodeVariantInventory(await retained.json()).variants).toEqual(richVariants);
      await fixture.stop();
      const afterReads = await fixture.observe();
      for (const key of ["rows", "revisions", "indexes", "businessRows", "products", "options", "optionValues", "variants", "variantOptions",
        "priceSets", "prices", "inventoryItems", "variantPriceSets", "variantInventoryItems"] as const) {
        expect(afterReads[key], `Variant reads changed durable ${key}`).toEqual(persisted[key]);
      }
      const stocked = created.map((variant, index) => ({ ...variant,
        inventory: decodeInventoryLink(persisted.variantInventoryItems.find(row => row.variant_id === variant.id)),
        stockedQuantity: index === 0 ? 20 : 9, reservedQuantity: index === 0 ? 3 : 1, availableQuantity: index === 0 ? 17 : 8 }));
      await fixture.seedInventory({ stocking: { locations: [{ id: "variant-quantity-location", name: "Variant quantity" }],
        inventory_levels: stocked.map(variant => ({ inventory_item_id: variant.inventory.inventory_item_id,
          location_index: 0, stocked_quantity: variant.stockedQuantity })) },
      reservationBatches: stocked.map(variant => [{ inventory_item_id: variant.inventory.inventory_item_id,
        location_id: "variant-quantity-location", quantity: variant.reservedQuantity }]) });
      const seeded = await fixture.observe();
      expect(seeded.inventoryLevels).toHaveLength(2);
      expect(seeded.reservations).toHaveLength(2);
      const decodeLevelQuantities = Schema.decodeUnknownSync(Schema.Struct({ stocked_quantity: Schema.FiniteFromString,
        reserved_quantity: Schema.FiniteFromString }));
      for (const variant of stocked) {
        const level = seeded.inventoryLevels.find(row => row.inventory_item_id === variant.inventory.inventory_item_id);
        expect(level).toMatchObject({ location_id: "variant-quantity-location" });
        expect(decodeLevelQuantities(level)).toEqual({ stocked_quantity: variant.stockedQuantity, reserved_quantity: variant.reservedQuantity });
        expect(seeded.reservations).toContainEqual(expect.objectContaining({ inventory_item_id: variant.inventory.inventory_item_id,
          location_id: "variant-quantity-location" }));
      }
      fixture.start();
      expect(await fixture.probeIncarnation()).not.toBe(incarnation);
      const available = await fixture.get(`${collection}?fields=id,manage_inventory,inventory_quantity`);
      expect(available.status, await available.clone().text()).toBe(200);
      expect(decodeVariantQuantities(await available.json()).variants).toEqual(expect.arrayContaining(stocked.map(variant => ({
        id: variant.id, manage_inventory: true, inventory_quantity: variant.availableQuantity }))));
      await fixture.stop();
      const afterAvailability = await fixture.observe();
      for (const key of ["rows", "revisions", "indexes", "businessRows", "products", "options", "optionValues", "variants", "variantOptions",
        "priceSets", "prices", "inventoryItems", "inventoryLevels", "reservations", "variantPriceSets", "variantInventoryItems"] as const) {
        expect(afterAvailability[key], `Native availability read changed durable ${key}`).toEqual(seeded[key]);
      }
    } catch (cause) { primary.push(cause); throw cause; }
    finally {
      try { await fixture.close(); }
      catch (cause) { throw new AggregateError([...primary, cause], "Admin Product variant proof cleanup failed"); }
    }
  }, 360_000);

  it("updates only the parent-selected native variant and persists its price and Inventory dismissal across DO recreation", async () => {
    const fixture = await createAdminProductDOFixture();
    const primary: unknown[] = [];
    try {
      fixture.start();
      const created = [];
      for (const [name, amount] of [["Alpha", 1234], ["Beta", 8765]] as const) {
        const input = { title: `${name} Variant Update Parent`, handle: `${name.toLowerCase()}-variant-update-parent`,
          sku: `NATIVE-VARIANT-UPDATE-${name.toUpperCase()}`, amount };
        const response = await fixture.request({ title: input.title, handle: input.handle,
          options: [{ title: "Size", values: ["One"] }], variants: [{ title: `${name} Original Variant`, sku: input.sku,
            manage_inventory: true, options: { Size: "One" }, prices: [{ currency_code: "usd", amount }] }] },
        { private: true, admin: adminCredential, path: "/admin/products" });
        expect(response.status, await response.clone().text()).toBe(200);
        const body: unknown = await response.json();
        const product = decodeProduct(body).product, variant = decodeVariants(body).product.variants[0];
        const price = decodeDefaultPrices(body).product.variants[0]?.prices[0];
        if (variant === undefined || price === undefined) throw new Error("Native variant update seed omitted its variant or price");
        created.push({ ...input, id: product.id, variantId: variant.id, variantTitle: variant.title,
          priceId: price.id, priceSetId: price.price_set_id });
      }
      const first = created[0], second = created[1];
      if (first === undefined || second === undefined) throw new Error("Expected two native variant update parents");
      await fixture.stop();
      const before = await fixture.observe();
      const firstInventory = decodeInventoryLink(before.variantInventoryItems.find(row => row.variant_id === first.variantId));
      const secondInventory = decodeInventoryLink(before.variantInventoryItems.find(row => row.variant_id === second.variantId));
      expect(firstInventory.inventory_item_id).not.toBe(secondInventory.inventory_item_id);
      expect(first.priceSetId).not.toBe(second.priceSetId);
      const updatePath = `/admin/products/${first.id}/variants/${first.variantId}`;

      fixture.start();
      const update = { title: "Selected Variant Updated", prices: [{ id: first.priceId, amount: 4321 }] };
      expect((await fixture.request(update, { admin: adminCredential, path: updatePath })).status).toBe(401);
      expect((await fixture.request(update, { private: true, path: updatePath })).status).toBe(401);
      expect((await fixture.request(update, { private: true, admin: "invalid-admin", path: updatePath })).status).toBe(401);
      expect((await fixture.request(update, { private: true, admin: `${adminCredential}-without-policy`, path: updatePath })).status).toBe(403);
      // This principal passes inherited product:read, then fails the native
      // product_variant:read check. The route has no invented update policy.
      expect((await fixture.request(update, { private: true, admin: `${adminCredential}-read-only`, path: updatePath })).status).toBe(403);
      for (const body of [{ title: 42 }, { product_id: second.id }, { inventory_items: [] },
        { id: first.variantId, title: "Body ID is outside this profile" }, { id: second.variantId, title: "Cannot redirect selection" }]) {
        const response = await fixture.request(body, { private: true, admin: adminCredential, path: updatePath });
        expect(response.status, await response.clone().text()).toBe(400);
      }
      const unsupported = await fixture.request(update, { private: true, admin: adminCredential,
        path: `${updatePath}?fields=unsupported_field` });
      expect(unsupported.status, await unsupported.clone().text()).toBe(400);
      await fixture.stop();
      expect(await fixture.observe()).toEqual(before);

      fixture.start();
      const wrongParent = await fixture.request({ title: "Must not change the other parent", manage_inventory: false, prices: [] },
        { private: true, admin: adminCredential, path: `/admin/products/${first.id}/variants/${second.variantId}` });
      expect(wrongParent.status, await wrongParent.clone().text()).toBe(200);
      const wrongBody: unknown = await wrongParent.json();
      expect(decodeProduct(wrongBody).product).toMatchObject({ id: first.id, title: first.title });
      expect(decodeVariants(wrongBody).product.variants).toEqual([expect.objectContaining({ id: first.variantId,
        title: first.variantTitle, manage_inventory: true })]);
      await fixture.stop();
      const wrongSelected = await fixture.observe();
      // Native selector absence may settle an empty root outcome. All actual
      // business rows, revision/index history and event documents stay intact.
      const { outcomes: _beforeOutcomes, publishedTimestamp: _beforeTimestamp, ...beforeData } = before;
      const { outcomes: _wrongOutcomes, publishedTimestamp: _wrongTimestamp, ...wrongData } = wrongSelected;
      expect(wrongData).toEqual(beforeData);

      fixture.start();
      const updateIncarnation = await fixture.probeIncarnation();
      const response = await fixture.request(update, { private: true, admin: adminCredential, path: updatePath });
      expect(response.status, await response.clone().text()).toBe(200);
      const body: unknown = await response.json();
      expect(decodeProduct(body).product).toMatchObject({ id: first.id, title: first.title, handle: first.handle });
      expect(decodeVariants(body).product.variants).toEqual([expect.objectContaining({ id: first.variantId,
        title: update.title, sku: first.sku, manage_inventory: true })]);
      expect(decodeDefaultPrices(body).product.variants).toEqual([expect.objectContaining({ id: first.variantId,
        prices: [expect.objectContaining({ id: first.priceId, price_set_id: first.priceSetId, amount: 4321 })] })]);
      await fixture.stop();
      const updated = await fixture.observe();
      expect(updated.variants.find(row => row.id === first.variantId)).toMatchObject({ product_id: first.id, title: update.title,
        sku: first.sku, manage_inventory: true });
      expect(updated.prices.find(row => row.id === first.priceId)).toMatchObject({ price_set_id: first.priceSetId,
        currency_code: "usd", amount: "4321.0000000000000000", raw_amount: { value: "4321.0000000000000000", precision: 20 } });
      for (const key of ["products", "options", "optionValues", "variantOptions", "inventoryItems", "inventoryLevels", "reservations",
        "variantPriceSets", "variantInventoryItems"] as const) expect(updated[key], `Variant update changed unrelated ${key}`).toEqual(before[key]);
      for (const [key, id] of [["variants", second.variantId], ["prices", second.priceId], ["priceSets", second.priceSetId]] as const) {
        expect(updated[key].find(row => row.id === id)).toEqual(before[key].find(row => row.id === id));
      }
      const publications = updated.outcomes.filter(outcome => outcome.timestamp > wrongSelected.publishedTimestamp
        && outcome.value.kind === "nativeRoot" && outcome.value.state === "committed");
      expect(publications).toHaveLength(1);
      const publication = publications[0];
      if (publication === undefined) throw new Error("Native variant update omitted its committed root outcome");
      const revisions = updated.revisions.filter(revision => revision.timestamp > wrongSelected.publishedTimestamp);
      expect(revisions).toEqual(expect.arrayContaining([
        expect.objectContaining({ previous: expect.any(BigInt), deleted: false, value: expect.objectContaining({ id: first.variantId, title: update.title }) }),
        expect.objectContaining({ previous: expect.any(BigInt), deleted: false, value: expect.objectContaining({ id: first.priceId, amount: "4321.0000000000000000" }) }),
      ]));
      expect(revisions.every(revision => revision.timestamp === publication.timestamp)).toBe(true);

      fixture.start();
      const dismiss = await fixture.request({ manage_inventory: false }, { private: true, admin: adminCredential, path: updatePath });
      expect(dismiss.status, await dismiss.clone().text()).toBe(200);
      expect(decodeVariants(await dismiss.json()).product.variants).toEqual([expect.objectContaining({ id: first.variantId,
        title: update.title, manage_inventory: false })]);
      await fixture.stop();
      const persisted = await fixture.observe();
      expect(persisted.variantInventoryItems.find(row => row.variant_id === first.variantId)).toMatchObject({
        ...firstInventory, deleted_at: expect.any(String) });
      expect(persisted.variantInventoryItems.find(row => row.variant_id === second.variantId))
        .toEqual(updated.variantInventoryItems.find(row => row.variant_id === second.variantId));
      for (const key of ["products", "options", "optionValues", "variantOptions", "priceSets", "prices", "inventoryItems",
        "inventoryLevels", "reservations", "variantPriceSets"] as const) expect(persisted[key]).toEqual(updated[key]);
      expect(persisted.variants.find(row => row.id === second.variantId)).toEqual(updated.variants.find(row => row.id === second.variantId));

      fixture.start();
      expect(await fixture.probeIncarnation()).not.toBe(updateIncarnation);
      for (const expected of created) {
        const detail = await fixture.get(`/admin/products/${expected.id}/variants/${expected.variantId}`);
        expect(detail.status, await detail.clone().text()).toBe(200);
        const variant = decodeNativeVariant(await detail.json()).variant;
        expect(variant).toMatchObject({ id: expected.variantId, product_id: expected.id, sku: expected.sku,
          title: expected.id === first.id ? update.title : expected.variantTitle, manage_inventory: expected.id !== first.id,
          prices: [expect.objectContaining({ id: expected.priceId, price_set_id: expected.priceSetId, variant_id: expected.variantId,
            currency_code: "usd", amount: expected.id === first.id ? 4321 : expected.amount })] });
        const rich = await fixture.get(`/admin/products/${expected.id}?fields=${readFields}`);
        expect(rich.status, await rich.clone().text()).toBe(200);
        const product = decodeReadProduct(await rich.json()).product;
        expect(product).toMatchObject({ id: expected.id, title: expected.title, handle: expected.handle });
        expect(product.variants[0]?.inventory_items).toEqual(expected.id === first.id ? [] : [expect.objectContaining({
          ...secondInventory, inventory: { id: secondInventory.inventory_item_id, sku: second.sku } })]);
      }
      await fixture.stop();
      const afterReads = await fixture.observe();
      for (const key of ["rows", "revisions", "indexes", "businessRows", "products", "options", "optionValues", "variants", "variantOptions",
        "priceSets", "prices", "inventoryItems", "inventoryLevels", "reservations", "variantPriceSets", "variantInventoryItems"] as const) {
        expect(afterReads[key], `Recreated DO variant reads changed durable ${key}`).toEqual(persisted[key]);
      }
    } catch (cause) { primary.push(cause); throw cause; }
    finally {
      try { await fixture.close(); }
      catch (cause) { throw new AggregateError([...primary, cause], "Admin Product variant update proof cleanup failed"); }
    }
  }, 360_000);

  it.runIf(benchmarkEnabled)("warm DO closed-loop Product benchmark", async () => {
    const fixture = await createAdminProductDOFixture();
    const runId = crypto.randomUUID().replaceAll("-", "");
    const redact = (value: string) => [privateToken, adminCredential, endpoints?.connectionString, endpoints?.provisioningConnectionString]
      .reduce<string>((text, secret) => secret === undefined ? text : text.replaceAll(secret, "[redacted]"), value);
    const client = makeProductBenchmarkClient({ timeoutMs: benchmarkControl.requestTimeoutMs, redact,
      send: (sample, signal) => fixture.request(productBenchmarkInput(sample), {
        private: true, admin: adminCredential, path: managedPath, signal,
      }) });
    const receipts: ProductSubmissionReceipt[] = [];
    const cohorts: ProductBenchmarkCohort[] = [];
    const probes: Array<{ label: string; incarnation?: string; error?: string }> = [];
    let sequence = 0;
    let phase = "created";
    let harnessError: string | undefined;
    let reconciliation: ReturnType<typeof verifyConcurrentProductGraphs> | undefined;
    const warmups = () => receipts.filter(receipt => receipt.phase === "warmup");
    const warmupEligible = () => warmups().length === 5 && warmups().every(isSuccessfulProductReceipt);
    const incarnationStable = () => probes.length === 3 && probes.every(probe => probe.error === undefined)
      && new Set(probes.map(probe => probe.incarnation)).size === 1;
    const ineligibilityReasons = () => [
      ...(client.isInterrupted() ? ["request-timeout"] : []),
      ...(warmupEligible() ? [] : ["five-successful-warmups-required"]),
      ...(incarnationStable() ? [] : ["live-incarnation-not-established"]),
      ...(cohorts.filter(cohort => cohort.phase === "load").length === 8
        && cohorts.every(cohort => cohort.receipts.length === cohort.requested) ? [] : ["incomplete-cohorts"]),
      ...(reconciliation === undefined ? ["durable-reconciliation-pending"]
        : reconciliation.integrityErrors.length === 0 ? [] : ["durable-integrity-errors"]),
      ...(harnessError === undefined ? [] : ["harness-error"]),
    ];
    const publish = async () => {
      const reasons = ineligibilityReasons();
      const report = { format: "flarex.native-product-do-benchmark", version: 1, runId, phase, control: benchmarkControl,
        topology: { tenantCount: 1, runtime: "local Workerd", privateNativeReady: true },
        timing: "performance.now from HTTP dispatch through complete response.text; receipt decoding excluded",
        order: [[1, 2, 4, 8], [8, 4, 2, 1]], warmupEligible: warmupEligible(), incarnationStable: incarnationStable(), probes,
        warmups: warmups(), preflight: receipts.filter(receipt => receipt.phase === "preflight"),
        interruptedByTimeout: client.isInterrupted(), primaryRatesEligible: reasons.length === 0, ineligibilityReasons: reasons,
        receipts: [...receipts].sort((left, right) => left.seq - right.seq),
        summary: summarizeProductBenchmarkCohorts(cohorts, reasons.length === 0), reconciliation, harnessError };
      const json = JSON.stringify(report, (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value, 2);
      const reportPath = process.env.FLAREX_PRODUCT_DO_REPORT;
      if (reportPath === undefined) console.info("Native Product DO benchmark report", json);
      else {
        const target = resolve(reportPath);
        try {
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, json, "utf8");
        } catch (error) {
          console.info("Product DO report write failed; retained raw report", json);
          throw error;
        }
        console.info("Native Product DO benchmark report", JSON.stringify({ phase, path: target, submitted: receipts.length,
          successfulResponses: receipts.filter(isSuccessfulProductReceipt).length, warmupEligible: warmupEligible(),
          incarnationStable: incarnationStable(), reconciliation: reconciliation?.counts, integrityErrors: reconciliation?.integrityErrors.length,
          interruptedByTimeout: client.isInterrupted(), primaryRatesEligible: reasons.length === 0, ineligibilityReasons: reasons,
          harnessError }));
      }
    };
    const probe = async (label: string) => {
      try { probes.push({ label, incarnation: await fixture.probeIncarnation() }); }
      catch (error) { probes.push({ label, error: redact(error instanceof Error ? error.message : String(error)) }); }
    };
    const run = async (samplePhase: ProductSubmissionReceipt["phase"], concurrency: number, round: number, count: number) => {
      const cohort = await runProductBenchmarkCohort({ phase: samplePhase, concurrency, round, count,
        next: () => {
          const seq = ++sequence;
          return { phase: samplePhase, seq, concurrency, round, handle: `warm-do-${runId}-${seq}`,
            sku: `WARM-DO-${runId}-${seq}`, amount: 1000 + seq };
        }, submit: client.submit, isInterrupted: client.isInterrupted, onReceipt: receipt => { receipts.push(receipt); } });
      cohorts.push(cohort);
      // This progress output is deliberately outside the cohort's wall interval.
      console.info("Product DO benchmark cohort", JSON.stringify({ phase: samplePhase, round, concurrency,
        requests: cohort.receipts.length, successes: cohort.receipts.filter(isSuccessfulProductReceipt).length,
        interruptedByTimeout: cohort.interruptedByTimeout, wallMs: cohort.wallMs }));
    };
    const primary: unknown[] = [];
    try {
      fixture.start();
      phase = "warming";
      await run("warmup", 1, 0, 5);
      if (!client.isInterrupted()) {
        await probe("after-warmups");
        phase = "preflight";
        await run("preflight", 2, 0, 2);
      }
      if (!client.isInterrupted()) {
        await probe("after-preflight");
        phase = "load";
        load: for (const [round, order] of [[1, 2, 4, 8], [8, 4, 2, 1]].entries()) {
          for (const concurrency of order) {
            await run("load", concurrency, round + 1, benchmarkControl.requestsPerCohort);
            if (client.isInterrupted()) break load;
          }
        }
      }
      if (!client.isInterrupted()) await probe("after-load");
      phase = client.isInterrupted() ? "load-interrupted-timeout" : "load-complete";
      // Retain every failure receipt even if shutdown or independent observation fails.
      await publish();
      await fixture.stop();
      await client.drain();
      const after = await fixture.observe();
      reconciliation = verifyConcurrentProductGraphs({ receipts, before: fixture.initial, after });
      phase = client.isInterrupted() ? "reconciled-timeout" : "reconciled";
      await publish();
      expect(reconciliation.integrityErrors).toEqual([]);
      expect(client.isInterrupted(), "Timeout-interrupted runs retain partial data but are ineligible for benchmark rates").toBe(false);
      expect(warmupEligible(), "Five genuine successful warmups are required for a warm benchmark").toBe(true);
      expect(incarnationStable(), "The same live DO incarnation must serve the complete warm run").toBe(true);
    } catch (cause) {
      primary.push(cause);
      phase = "failed";
      harnessError = redact(cause instanceof Error ? cause.message : String(cause));
      try { await publish(); } catch (reportError) { primary.push(reportError); }
      throw primary.length === 1 ? cause : new AggregateError(primary, "Product benchmark/report failed");
    } finally {
      const failures: unknown[] = [];
      try { await fixture.stop(); } catch (cause) { failures.push(cause); }
      try { await client.drain(); } catch (cause) { failures.push(cause); }
      try { await fixture.close(); } catch (cause) { failures.push(cause); }
      if (failures.length > 0) throw new AggregateError([...primary, ...failures], "Product benchmark cleanup failed");
    }
  }, benchmarkTimeoutMs);
});
