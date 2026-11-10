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
const decodeDeletedVariant = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String, object: Schema.Literal("variant"),
  deleted: Schema.Literal(true), parent: Schema.Unknown }));
const decodeNativeVariants = Schema.decodeUnknownSync(Schema.Struct({ variants: Schema.Array(nativeVariant),
  count: Schema.Number, offset: Schema.Number, limit: Schema.Number }));
const decodeVariantInventory = Schema.decodeUnknownSync(Schema.Struct({ variants: Schema.Array(Schema.Struct({
  id: Schema.NonEmptyString, inventory_items: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString,
    variant_id: Schema.NonEmptyString, inventory_item_id: Schema.NonEmptyString, required_quantity: Schema.Number,
    inventory: Schema.Struct({ id: Schema.NonEmptyString, sku: Schema.String }) })) })) }));
const decodeVariantQuantities = Schema.decodeUnknownSync(Schema.Struct({ variants: Schema.Array(Schema.Struct({
  id: Schema.NonEmptyString, manage_inventory: Schema.Boolean, inventory_quantity: Schema.optionalKey(Schema.Number) })) }));
const nativeOption = Schema.Struct({ id: Schema.NonEmptyString, product_id: Schema.NonEmptyString, title: Schema.String,
  values: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString, option_id: Schema.NonEmptyString, value: Schema.String })) });
const decodeNativeOption = Schema.decodeUnknownSync(Schema.Struct({ product_option: nativeOption }));
const decodeNativeOptions = Schema.decodeUnknownSync(Schema.Struct({ product_options: Schema.Array(nativeOption),
  count: Schema.Number, offset: Schema.Number, limit: Schema.Number }));
const optionFields = "id,product_id,title,values.id,values.value,values.option_id";
const decodeDeletedOption = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String, object: Schema.Literal("product_option"),
  deleted: Schema.Literal(true), parent: Schema.Unknown }));
const decodeRawOptionParent = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.NonEmptyString,
  options: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString, title: Schema.String,
    values: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString, value: Schema.String })) })),
  variants: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString, sku: Schema.String, manage_inventory: Schema.Boolean,
    price_set: Schema.Struct({ prices: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString, amount: Schema.Number,
      currency_code: Schema.String, raw_amount: Schema.Struct({ value: Schema.String, precision: Schema.Number }) })) }),
    inventory_items: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString, variant_id: Schema.NonEmptyString,
      inventory_item_id: Schema.NonEmptyString, required_quantity: Schema.Number,
      inventory: Schema.Struct({ id: Schema.NonEmptyString, sku: Schema.String }) })) })) }));
const decodeNativeEnvelope = Schema.decodeUnknownSync(Schema.JsonObject);
const decodeNativeId = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.NonEmptyString }));
const decodeCatalogEntity = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.NonEmptyString, value: Schema.String,
  metadata: Schema.NullOr(Schema.JsonObject) }));
const decodeImageProduct = Schema.decodeUnknownSync(Schema.Struct({ product: Schema.Struct({ id: Schema.NonEmptyString,
  images: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString, url: Schema.String })),
  variants: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString, thumbnail: Schema.NullOr(Schema.String) })) }) }));
const decodeImageAssignment = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.NonEmptyString,
  variant_id: Schema.NonEmptyString, image_id: Schema.NonEmptyString }));

async function nativeJson(pending: ReturnType<Miniflare["dispatchFetch"]>, status = 200) {
  const response = await pending;
  const body = decodeNativeEnvelope(await response.json());
  expect(response.status, JSON.stringify(body)).toBe(status);
  return body;
}

/** A fresh native-ready tenant per test. The benchmark keeps its one runtime
 * open throughout warmup and measurement; independent observation requires close. */
async function createAdminProductDOFixture(options: Readonly<{ leaseTracePhase?: () => string }> = {}) {
  if (endpoints === undefined) throw new Error("Admin Product app DO requires ordinary PostgreSQL");
  const physical = await createCorePostgresFixture(endpoints);
  let seed: Awaited<ReturnType<typeof prepareProductRequestFixture>> | undefined;
  let runtime: Miniflare | undefined;
  let closed = false;
  let runtimeEpoch = 0;
  let ready: Promise<void> | undefined;
  let incarnation: string | undefined;
  const decodeLeaseMetadata = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ generation: Schema.NullOr(Schema.String),
    read_only: Schema.Boolean })));
  const leaseMetadata = async (boundary: string) => {
    if (options.leaseTracePhase === undefined) return undefined;
    // Trusted physical metadata observation only: opening a Core observer here
    // would itself acquire a writer and invalidate the handoff evidence.
    const [metadata] = decodeLeaseMetadata(await physical.query(`SELECT
      (SELECT ts::text FROM "${physical.namespace}".leases WHERE instance_name = $1) AS generation,
      EXISTS (SELECT 1 FROM "${physical.namespace}".read_only WHERE instance_name = $1) AS read_only`, [physical.instanceName]));
    if (metadata === undefined) throw new Error("Lease metadata query omitted its row");
    console.info("Core lease handoff", JSON.stringify({ phase: options.leaseTracePhase(), boundary,
      namespace: physical.namespace, instance: physical.instanceName, runtimeEpoch, incarnation: incarnation ?? null, ...metadata }));
    expect(metadata.read_only).toBe(false);
    return metadata.generation === null ? 0n : BigInt(metadata.generation);
  };
  const acquired = async <A>(boundary: string, work: () => Promise<A>, acquisitions = 1n) => {
    const predecessor = await leaseMetadata(`${boundary}: pending acquisition`);
    let result: A;
    try { result = await work(); }
    catch (cause) {
      // This is explicitly a later observation, not the failed SQL's snapshot.
      try { await leaseMetadata(`${boundary}: failed, later observation`); }
      catch (diagnostic) { throw new AggregateError([cause, diagnostic], "Lease acquisition and diagnostic failed"); }
      throw cause;
    }
    const generation = await leaseMetadata(`${boundary}: owner ready or scoped owner closed`);
    if (predecessor !== undefined) {
      console.info("Core lease handoff result", JSON.stringify({ phase: options.leaseTracePhase?.(), boundary,
        namespace: physical.namespace, instance: physical.instanceName, runtimeEpoch, incarnation: incarnation ?? null,
        predecessor: predecessor.toString(), generation: generation?.toString(), acquisitions: acquisitions.toString() }));
      expect(generation, `${boundary} must advance once per genuine owner open`).toBe(predecessor + acquisitions);
    }
    return result;
  };
  const stop = async () => {
    const current = runtime;
    runtime = undefined;
    if (current === undefined) return;
    const failures: unknown[] = [];
    let predecessor: bigint | undefined;
    try { predecessor = await leaseMetadata("DO close: pending request/bootstrap/resource drain"); }
    catch (cause) { failures.push(cause); }
    try {
      const response = await current.dispatchFetch("https://native-admin.test/__proof/close", {
        headers: { authorization: `Bearer ${privateToken}` },
      });
      if (!response.ok) throw new Error(await response.text());
      const generation = await leaseMetadata("DO close: authenticated owner close completed");
      if (predecessor !== undefined) expect(generation).toBe(predecessor);
    } catch (cause) { failures.push(cause); }
    try { await current.dispose(); } catch (cause) { failures.push(cause); }
    try {
      const generation = await leaseMetadata("DO close: Miniflare disposed");
      if (predecessor !== undefined) expect(generation).toBe(predecessor);
    } catch (cause) { failures.push(cause); }
    ready = undefined;
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
    seed = await acquired("Node prepare", async () => {
      const prepared = await prepareProductRequestFixture("postgres", { target: adminProductDOFixtureTarget,
        physical: { ...physical, close: async () => {} } });
      seed = prepared;
      await prepared.fixture.close();
      return prepared;
    }, 2n); // The genuine fixture opens its initializer, then its application owner.
    const catalog = seed.catalog;
    const observe = () => {
      if (runtime !== undefined) throw new Error("The Product DO must drain before independent observation");
      return acquired("Node observe", () => observeProductRequestFixture({ physical, catalog }));
    };
    const seedInventory = (input: Pick<Parameters<typeof seedProductRequestInventory>[0], "stocking" | "reservationBatches">) => {
      if (runtime !== undefined) throw new Error("The Product DO must drain before native Inventory fixture seeding");
      return acquired("Node Inventory seed", () => seedProductRequestInventory({ physical, catalog, ...input }));
    };
    const initial = await observe();
    const worker = await bundleApplicationWorker(new URL("./adminProductApplicationDO.workerd.worker.ts", import.meta.url));
    const base = executorApplicationProfileFixture();
    const profile = { ...base, ...adminProductDOFixtureTarget, persistenceNamespace: physical.namespace, instanceName: physical.instanceName };
    const keys = await createExecutorApplicationSecretFixture(profile.keyId);
    const start = () => {
      if (runtime !== undefined) throw new Error("Previous Product DO owner has not drained");
      if (closed) throw new Error("Product fixture is closed");
      runtimeEpoch += 1;
      incarnation = undefined;
      runtime = new Miniflare({ modules: [{ type: "ESModule", path: "worker.js", contents: worker }],
        compatibilityDate: "2026-06-14", compatibilityFlags: ["nodejs_compat"],
        bindings: { FLAREX_EXECUTOR_TOKEN: privateToken, ADMIN_PRODUCT_CREDENTIAL: adminCredential,
          FLAREX_APPLICATION_PROFILES: JSON.stringify({ version: 1, profiles: [profile] }), FLAREX_APPLICATION_KEYS: keys },
        hyperdrives: { HYPERDRIVE_CACHE_DISABLED: endpoints.connectionString }, workerLoaders: { LOADER: {} }, r2Buckets: ["ARTIFACTS"],
        durableObjects: { APPLICATIONS: { className: "NativeAdminProductApplicationFixture", useSQLite: true } },
      });
    };
    const request = async (input: unknown, requestOptions: Readonly<{ private?: boolean; admin?: string; path?: string; signal?: AbortSignal; method?: "POST" | "GET" | "DELETE" }>
      = { private: true, admin: adminCredential }) => {
      const current = runtime;
      if (current === undefined) throw new Error("Native Product DO is closed");
      if (options.leaseTracePhase !== undefined) {
        ready ??= acquired("Workerd DO boot", async () => {
          incarnation = await probeIncarnation();
          const response = await current.dispatchFetch("https://native-admin.test/__proof/ready", {
            headers: { authorization: `Bearer ${privateToken}` }, signal: AbortSignal.timeout(60_000),
          });
          expect(response.status, await response.clone().text()).toBe(200);
          expect(await response.json()).toEqual({ ready: true });
        });
        await ready;
      }
      return current.dispatchFetch(`https://native-admin.test${requestOptions.path ?? path}`, { method: requestOptions.method ?? "POST",
        headers: { "content-type": "application/json", origin: "https://admin.test",
          ...(requestOptions.private === true ? { authorization: `Bearer ${privateToken}` } : {}),
          ...(requestOptions.admin === undefined ? {} : { "x-admin-fixture-token": requestOptions.admin }) },
        ...(requestOptions.method === "GET" || (requestOptions.method === "DELETE" && input === undefined) ? {} : { body: JSON.stringify(input) }),
        ...(requestOptions.signal === undefined ? {} : { signal: requestOptions.signal }) });
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
    const fixture = await createAdminProductDOFixture({ leaseTracePhase: () => "native Variant graph and Inventory handoff" });
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

  it("deletes only the parent-selected native variant graph atomically and preserves survivors across DO recreation", async () => {
    const fixture = await createAdminProductDOFixture();
    const primary: unknown[] = [];
    try {
      fixture.start();
      const created = [];
      for (const [name, amounts] of [["First", [1234, 4321]], ["Other", [8765]]] as const) {
        const response = await fixture.request({ title: `${name} Variant Delete Parent`, handle: `${name.toLowerCase()}-variant-delete-parent`,
          options: [{ title: "Size", values: ["One", "Two"] }], variants: amounts.map((amount, index) => ({
            title: `${name} Variant ${index}`, sku: `VARIANT-DELETE-${name.toUpperCase()}-${index}`, manage_inventory: true,
            options: { Size: index === 0 ? "One" : "Two" }, prices: [{ currency_code: "usd", amount }],
          })) }, { private: true, admin: adminCredential, path: "/admin/products" });
        expect(response.status, await response.clone().text()).toBe(200);
        const body: unknown = await response.json();
        created.push({ product: decodeProduct(body).product, variants: decodeVariants(body).product.variants,
          priced: decodeDefaultPrices(body).product.variants });
      }
      const first = created[0], other = created[1];
      if (first === undefined || other === undefined) throw new Error("Expected two native Variant deletion parents");
      const selected = first.variants.find(variant => variant.sku === "VARIANT-DELETE-FIRST-0");
      const sibling = first.variants.find(variant => variant.sku === "VARIANT-DELETE-FIRST-1");
      const foreign = other.variants[0];
      if (selected === undefined || sibling === undefined || foreign === undefined) throw new Error("Native seed omitted a Variant");
      const price = first.priced.find(variant => variant.id === selected.id)?.prices[0];
      if (price === undefined) throw new Error("Native seed omitted the selected Variant price");
      const collection = `/admin/products/${first.product.id}/variants`;
      const detail = `${collection}/${selected.id}`;
      await fixture.stop();
      const before = await fixture.observe();
      const selectedInventory = decodeInventoryLink(before.variantInventoryItems.find(row => row.variant_id === selected.id));
      expect(before.variants).toHaveLength(3);
      expect(new Set(before.variantInventoryItems.map(row => row.inventory_item_id)).size).toBe(3);
      expect(new Set(before.variantPriceSets.map(row => row.price_set_id)).size).toBe(3);

      fixture.start();
      expect((await fixture.remove(detail, { admin: adminCredential })).status).toBe(401);
      expect((await fixture.remove(detail, { private: true })).status).toBe(401);
      expect((await fixture.remove(detail, { private: true, admin: "invalid-admin" })).status).toBe(401);
      for (const suffix of ["without-policy", "read-only", "variant-reader"]) {
        expect((await fixture.remove(detail, { private: true, admin: `${adminCredential}-${suffix}` })).status).toBe(403);
      }
      for (const fields of ["unsupported_field", "variants.unsupported_field", "__proto__.x"]) {
        const unsupported = await fixture.remove(`${detail}?fields=${fields}`);
        expect(unsupported.status, await unsupported.clone().text()).toBe(400);
        expect(await unsupported.json()).toMatchObject({ type: "invalid_data" });
      }
      await fixture.stop();
      expect(await fixture.observe()).toEqual(before);

      fixture.start();
      for (const id of [foreign.id, "variant_missing_native_parent_delete"]) {
        const response = await fixture.remove(`${collection}/${id}`);
        expect(response.status, await response.clone().text()).toBe(200);
        const body = decodeDeletedVariant(await response.json());
        expect(body).toMatchObject({ id, object: "variant", deleted: true });
        expect(decodeProduct({ product: body.parent }).product).toEqual(first.product);
        expect(decodeVariants({ product: body.parent }).product.variants).toEqual(expect.arrayContaining([...first.variants]));
      }
      await fixture.stop();
      const absent = await fixture.observe();
      // An empty root may settle. Business rows, events, revisions and indexes
      // must remain identical for a child outside the URL parent or absent ID.
      const { outcomes: _beforeOutcomes, publishedTimestamp: _beforeTimestamp, ...beforeData } = before;
      const { outcomes: _absentOutcomes, publishedTimestamp: _absentTimestamp, ...absentData } = absent;
      expect(absentData).toEqual(beforeData);

      fixture.start();
      const response = await fixture.remove(detail);
      expect(response.status, await response.clone().text()).toBe(200);
      const deleted = decodeDeletedVariant(await response.json());
      expect(deleted).toMatchObject({ id: selected.id, object: "variant", deleted: true });
      expect(decodeProduct({ product: deleted.parent }).product).toEqual(first.product);
      expect(decodeVariants({ product: deleted.parent }).product.variants).toEqual([sibling]);
      const incarnation = await fixture.probeIncarnation();
      await fixture.stop();
      const persisted = await fixture.observe();
      for (const key of ["products", "options", "optionValues", "variantOptions", "inventoryLevels", "reservations"] as const) {
        expect(persisted[key], `Variant DELETE changed retained ${key}`).toEqual(before[key]);
      }
      const ownedRows = {
        variants: (row: Record<string, unknown>) => row.id === selected.id,
        priceSets: (row: Record<string, unknown>) => row.id === price.price_set_id,
        prices: (row: Record<string, unknown>) => row.id === price.id,
        inventoryItems: (row: Record<string, unknown>) => row.id === selectedInventory.inventory_item_id,
        variantPriceSets: (row: Record<string, unknown>) => row.variant_id === selected.id,
        variantInventoryItems: (row: Record<string, unknown>) => row.variant_id === selected.id,
      };
      for (const key of ["variants", "priceSets", "prices", "inventoryItems", "variantPriceSets", "variantInventoryItems"] as const) {
        expect(persisted[key]).toHaveLength(3);
        expect(persisted[key].filter(ownedRows[key]), `Variant DELETE omitted owned ${key}`)
          .toEqual([expect.objectContaining({ deleted_at: expect.any(String) })]);
        expect(persisted[key].filter(row => !ownedRows[key](row)), `Variant DELETE changed a surviving ${key}`)
          .toEqual(before[key].filter(row => !ownedRows[key](row)));
      }
      const publications = persisted.outcomes.filter(outcome => outcome.timestamp > absent.publishedTimestamp
        && outcome.value.kind === "nativeRoot" && outcome.value.state === "committed");
      expect(publications).toHaveLength(1);
      const publication = publications[0];
      if (publication === undefined) throw new Error("Native Variant deletion omitted its committed root outcome");
      const changedRows = persisted.businessRows.filter(row => row.timestamp > absent.publishedTimestamp);
      expect(changedRows).toHaveLength(6);
      expect(changedRows.every(row => row.timestamp === publication.timestamp)).toBe(true);
      const revisions = persisted.revisions.filter(revision => revision.timestamp > absent.publishedTimestamp);
      expect(revisions.length).toBeGreaterThanOrEqual(6);
      expect(revisions.every(revision => revision.timestamp === publication.timestamp)).toBe(true);
      for (const id of [selected.id, price.id, price.price_set_id, selectedInventory.inventory_item_id]) {
        expect(revisions).toContainEqual(expect.objectContaining({ previous: expect.any(BigInt), deleted: false,
          value: expect.objectContaining({ id, deleted_at: expect.any(String) }) }));
      }
      const familyTable = fixture.catalog.eventDefinition.tables.find(table => table.privateEvent?.role === "family")?.name;
      const envelopeTable = fixture.catalog.eventDefinition.tables.find(table => table.privateEvent?.role === "envelope")?.name;
      if (familyTable === undefined || envelopeTable === undefined) throw new Error("Native Variant fixture omitted event storage");
      expect(persisted.rows.filter(row => row.table === familyTable && row.timestamp === publication.timestamp)).toHaveLength(1);
      expect(persisted.rows.filter(row => row.table === envelopeTable && row.timestamp === publication.timestamp).map(row => row.value))
        .toEqual(expect.arrayContaining([expect.objectContaining({ envelope: expect.objectContaining({ contract: "product-variant.deleted",
          message: expect.objectContaining({ data: { id: selected.id } }) }) })]));

      fixture.start();
      const missing = await fixture.get(detail);
      expect(missing.status, await missing.clone().text()).toBe(200);
      expect(await missing.json()).toEqual({});
      expect(await fixture.probeIncarnation()).not.toBe(incarnation);
      for (const [parent, variant] of [[first.product, sibling], [other.product, foreign]] as const) {
        const rich = await fixture.get(`/admin/products/${parent.id}?fields=${readFields}`);
        expect(rich.status, await rich.clone().text()).toBe(200);
        const product = decodeReadProduct(await rich.json()).product;
        expect(product).toMatchObject({ id: parent.id, title: parent.title });
        const linkedPrice = decodePriceLink(before.variantPriceSets.find(row => row.variant_id === variant.id));
        const inventory = decodeInventoryLink(before.variantInventoryItems.find(row => row.variant_id === variant.id));
        expect(product.variants).toEqual([expect.objectContaining({ id: variant.id, sku: variant.sku, manage_inventory: true,
          prices: [expect.objectContaining({ price_set_id: linkedPrice.price_set_id, variant_id: variant.id })],
          inventory_items: [expect.objectContaining({ ...inventory, inventory: { id: inventory.inventory_item_id, sku: variant.sku } })] })]);
        const detailResponse = await fixture.get(`/admin/products/${parent.id}/variants/${variant.id}`);
        expect(detailResponse.status, await detailResponse.clone().text()).toBe(200);
        expect(decodeNativeVariant(await detailResponse.json()).variant).toMatchObject({ ...variant, product_id: parent.id });
      }
      await fixture.stop();
      const afterReads = await fixture.observe();
      expect(afterReads).toEqual(persisted);

      fixture.start();
      for (const id of [selected.id, "variant_missing_native_parent_delete"]) {
        const repeated = await fixture.remove(`${collection}/${id}`);
        expect(repeated.status, await repeated.clone().text()).toBe(200);
        const body = decodeDeletedVariant(await repeated.json());
        expect(body).toMatchObject({ id, object: "variant", deleted: true });
        expect(decodeProduct({ product: body.parent }).product).toEqual(first.product);
        expect(decodeVariants({ product: body.parent }).product.variants).toEqual([sibling]);
      }
      await fixture.stop();
      const afterRepeated = await fixture.observe();
      const { outcomes: _persistedOutcomes, publishedTimestamp: _persistedTimestamp, ...persistedData } = persisted;
      const { outcomes: _repeatedOutcomes, publishedTimestamp: _repeatedTimestamp, ...repeatedData } = afterRepeated;
      expect(repeatedData).toEqual(persistedData);
    } catch (cause) { primary.push(cause); throw cause; }
    finally {
      try { await fixture.close(); }
      catch (cause) { throw new AggregateError([...primary, cause], "Admin Product Variant DELETE proof cleanup failed"); }
    }
  }, 360_000);

  it("creates, reads and updates native Product options and Value identities through the DO across recreation", async () => {
    const fixture = await createAdminProductDOFixture();
    const primary: unknown[] = [];
    try {
      fixture.start();
      const created = [];
      for (const [name, amount] of [["First", 1122], ["Other", 7788]] as const) {
        const response = await fixture.request({ title: `${name} Option Parent`, handle: `${name.toLowerCase()}-option-parent`,
          options: [{ title: "Size", values: ["Small", "Large"] }], variants: [{ title: `${name} Small`,
            sku: `OPTION-${name.toUpperCase()}`, options: { Size: "Small" }, prices: [{ currency_code: "usd", amount }] }] },
        { private: true, admin: adminCredential, path: "/admin/products" });
        expect(response.status, await response.clone().text()).toBe(200);
        const body: unknown = await response.json();
        const product = decodeProduct(body).product, variant = decodeVariants(body).product.variants[0], option = product.options[0];
        if (variant === undefined || option === undefined) throw new Error("Native option seed omitted its Variant or Option");
        created.push({ product, variant, option });
      }
      const first = created[0], other = created[1];
      if (first === undefined || other === undefined) throw new Error("Expected two native Option parents");
      const collection = `/admin/products/${first.product.id}/options`;
      const detail = `${collection}/${first.option.id}`;
      const post = (target: string, body: unknown, admin = adminCredential) =>
        fixture.request(body, { private: true, admin, path: target });
      await fixture.stop();
      const before = await fixture.observe();

      fixture.start();
      const defaults = await fixture.get(collection, { private: true, admin: `${adminCredential}-read-only` });
      expect(defaults.status, await defaults.clone().text()).toBe(200);
      expect(await defaults.json()).toEqual({ product_options: [{ id: first.option.id, title: "Size" }], count: 1, offset: 0, limit: 50 });
      const rich = await fixture.get(`${detail}?fields=${optionFields}`);
      expect(rich.status, await rich.clone().text()).toBe(200);
      expect(decodeNativeOption(await rich.json()).product_option).toEqual({ ...first.option, product_id: first.product.id,
        values: expect.arrayContaining(first.option.values.map(value => ({ ...value, option_id: first.option.id }))) });
      const wrongGet = await fixture.get(`${collection}/${other.option.id}`);
      expect(wrongGet.status, await wrongGet.clone().text()).toBe(200);
      expect(await wrongGet.json()).toEqual({});
      for (const target of [collection, detail]) {
        expect((await fixture.get(target, { admin: adminCredential })).status).toBe(401);
        expect((await fixture.get(target, { private: true })).status).toBe(401);
        expect((await fixture.get(target, { private: true, admin: "invalid-admin" })).status).toBe(401);
        expect((await fixture.get(target, { private: true, admin: `${adminCredential}-without-policy` })).status).toBe(403);
        expect((await fixture.get(`${target}?fields=unsupported_field`)).status).toBe(400);
        expect((await post(target, { title: 42 })).status).toBe(400);
        expect((await post(target, { title: "Refused", values: [], metadata: { outside: "native-http-schema" } })).status).toBe(400);
        expect((await post(target, { title: "Refused", values: ["1", "2", "3", "4", "5"] })).status).toBe(400);
        expect((await post(`${target}?fields=unsupported_field`, { title: "Refused", values: [] })).status).toBe(400);
      }
      expect((await fixture.get(detail, { private: true, admin: `${adminCredential}-read-only` })).status).toBe(403);
      expect((await post(detail, { title: "Refused" }, `${adminCredential}-read-only`)).status).toBe(403);
      for (const id of [first.option.id, other.option.id])
        expect((await post(detail, { id, title: "Cannot override the selector" })).status).toBe(400);
      expect((await fixture.get(`${collection}?limit=invalid`)).status).toBe(400);
      await fixture.stop();
      expect(await fixture.observe()).toEqual(before);

      fixture.start();
      const wrongUpdate = await post(`${collection}/${other.option.id}`, { title: "Must not replace other Values", values: [] });
      expect(wrongUpdate.status, await wrongUpdate.clone().text()).toBe(200);
      expect(decodeProduct(await wrongUpdate.json()).product.options).toEqual(first.product.options);
      await fixture.stop();
      const wrongSelected = await fixture.observe();
      const { outcomes: _beforeOutcomes, publishedTimestamp: _beforeTimestamp, ...beforeData } = before;
      const { outcomes: _wrongOutcomes, publishedTimestamp: _wrongTimestamp, ...wrongData } = wrongSelected;
      expect(wrongData).toEqual(beforeData);

      fixture.start();
      const incarnation = await fixture.probeIncarnation();
      const create = await post(collection, { title: "Material", values: ["Cotton", "Wool"],
        additional_data: { origin: "native-do-options" } });
      expect(create.status, await create.clone().text()).toBe(200);
      const parent = decodeProduct(await create.json()).product;
      const material = parent.options.find(option => option.title === "Material");
      if (material === undefined) throw new Error("Native Option creation omitted its Option");
      expect(parent).toMatchObject({ id: first.product.id, title: first.product.title });
      expect(material.values.map(value => value.value).sort()).toEqual(["Cotton", "Wool"]);
      const materialPath = `${collection}/${material.id}`;
      const rename = await post(materialPath, { title: "Fabric" });
      expect(rename.status, await rename.clone().text()).toBe(200);
      expect(decodeProduct(await rename.json()).product.options.find(option => option.id === material.id))
        .toEqual({ ...material, title: "Fabric" });
      const replace = await post(materialPath, { values: ["Cotton", "Linen"] });
      expect(replace.status, await replace.clone().text()).toBe(200);
      const replaced = decodeProduct(await replace.json()).product.options.find(option => option.id === material.id);
      if (replaced === undefined) throw new Error("Native Option replacement omitted its Option");
      expect(replaced.values.map(value => value.value).sort()).toEqual(["Cotton", "Linen"]);
      expect(replaced.values.find(value => value.value === "Cotton")).toEqual(material.values.find(value => value.value === "Cotton"));
      const clear = await post(detail, { values: [] });
      expect(clear.status, await clear.clone().text()).toBe(200);
      expect(decodeProduct(await clear.json()).product.options.find(option => option.id === first.option.id))
        .toEqual({ ...first.option, values: [] });
      await fixture.stop();
      const persisted = await fixture.observe();
      for (const key of ["products", "variants", "priceSets", "prices", "inventoryItems", "inventoryLevels", "reservations",
        "variantPriceSets", "variantInventoryItems"] as const) expect(persisted[key], `Option mutation changed ${key}`).toEqual(before[key]);
      expect(persisted.variantOptions.filter(row => row.variant_id === first.variant.id)).toEqual([]);
      expect(persisted.variantOptions.filter(row => row.variant_id === other.variant.id))
        .toEqual(before.variantOptions.filter(row => row.variant_id === other.variant.id));
      expect(persisted.options.find(row => row.id === other.option.id)).toEqual(before.options.find(row => row.id === other.option.id));
      expect(persisted.optionValues.filter(row => row.option_id === other.option.id)).toEqual(before.optionValues.filter(row => row.option_id === other.option.id));
      expect(persisted.optionValues.filter(row => row.option_id === first.option.id)).toEqual([]);
      expect(persisted.optionValues.filter(row => row.option_id === material.id).map(row => row.value).sort()).toEqual(["Cotton", "Linen"]);
      const publications = persisted.outcomes.filter(outcome => outcome.timestamp > wrongSelected.publishedTimestamp
        && outcome.value.kind === "nativeRoot" && outcome.value.state === "committed");
      expect(publications).toHaveLength(4);
      const publicationTimes = new Set(publications.map(outcome => outcome.timestamp));
      expect(persisted.businessRows.filter(row => row.timestamp > wrongSelected.publishedTimestamp)
        .every(row => publicationTimes.has(row.timestamp))).toBe(true);
      const clearedValues = before.revisions.filter(row => first.option.values.some(value => row.value?.id === value.id));
      expect(clearedValues).toHaveLength(first.option.values.length);
      expect(persisted.revisions.filter(row => row.timestamp > wrongSelected.publishedTimestamp && row.deleted))
        .toEqual(expect.arrayContaining(clearedValues.map(row => expect.objectContaining({ table: row.table, id: row.id,
          previous: row.timestamp, value: null }))));

      fixture.start();
      expect(await fixture.probeIncarnation()).not.toBe(incarnation);
      const page = await fixture.get(`${collection}?fields=${optionFields}&order=id&offset=1&limit=1`);
      expect(page.status, await page.clone().text()).toBe(200);
      const paged = decodeNativeOptions(await page.json());
      expect(paged).toMatchObject({ count: 2, offset: 1, limit: 1, product_options: [{
        id: [first.option.id, material.id].sort()[1], product_id: first.product.id,
      }] });
      const updatedDetail = await fixture.get(`${materialPath}?fields=${optionFields}`);
      expect(updatedDetail.status, await updatedDetail.clone().text()).toBe(200);
      expect(decodeNativeOption(await updatedDetail.json()).product_option).toEqual({ ...replaced, product_id: first.product.id,
        values: expect.arrayContaining(replaced.values.map(value => ({ ...value, option_id: material.id }))) });
      const retained = await fixture.get(`/admin/products/${other.product.id}?fields=${readFields}`);
      expect(retained.status, await retained.clone().text()).toBe(200);
      expect(decodeReadProduct(await retained.json()).product.variants[0]).toMatchObject({ id: other.variant.id,
        inventory_items: [expect.objectContaining({ variant_id: other.variant.id })], prices: [expect.objectContaining({ amount: 7788 })] });
      await fixture.stop();
      const afterReads = await fixture.observe();
      for (const key of ["rows", "revisions", "indexes", "businessRows", "products", "options", "optionValues", "variants", "variantOptions",
        "priceSets", "prices", "inventoryItems", "variantPriceSets", "variantInventoryItems"] as const)
        expect(afterReads[key], `Option reads changed durable ${key}`).toEqual(persisted[key]);
    } catch (cause) { primary.push(cause); throw cause; }
    finally {
      try { await fixture.close(); }
      catch (cause) { throw new AggregateError([...primary, cause], "Admin Product Option proof cleanup failed"); }
    }
  }, 360_000);

  it("deletes only the parent-selected native Option and Values with a raw parent envelope across DO recreation", async () => {
    let phase = "prepare fixture";
    const fixture = await createAdminProductDOFixture({ leaseTracePhase: () => phase }).catch(cause => {
      console.error("Option DELETE proof failed during", phase, cause);
      throw cause;
    });
    const primary: unknown[] = [];
    const fields = `${readFields},options.id,options.title,options.values.id,options.values.value`;
    const observeAt = (stage: string) => { phase = stage; return fixture.observe(); };
    try {
      fixture.start();
      const created = [];
      for (const [name, amount] of [["First", 1234], ["Other", 8765]] as const) {
        phase = `seed ${name} Product`;
        const response = await fixture.request({ title: `${name} Option Delete Parent`, handle: `${name.toLowerCase()}-option-delete-parent`,
          options: [{ title: "Size", values: ["Small", "Large"] }], variants: [{ title: `${name} Small`,
            sku: `OPTION-DELETE-${name.toUpperCase()}`, manage_inventory: true, options: { Size: "Small" },
            prices: [{ currency_code: "usd", amount }] }] }, { private: true, admin: adminCredential, path: "/admin/products" });
        expect(response.status, await response.clone().text()).toBe(200);
        const body: unknown = await response.json();
        const product = decodeProduct(body).product, variant = decodeVariants(body).product.variants[0];
        if (variant === undefined) throw new Error("Native Option deletion seed omitted its Variant");
        phase = `seed ${name} Material Option`;
        const addMaterial = await fixture.request({ title: "Material", values: ["Cotton", "Wool"] },
          { private: true, admin: adminCredential, path: `/admin/products/${product.id}/options` });
        expect(addMaterial.status, await addMaterial.clone().text()).toBe(200);
        const parent = decodeProduct(await addMaterial.json()).product;
        const selected = parent.options.find(option => option.title === "Size");
        const retained = parent.options.find(option => option.title === "Material");
        if (selected === undefined || retained === undefined) throw new Error("Native Option seed omitted an Option");
        created.push({ product: parent, variant, selected, retained, amount });
      }
      const first = created[0], other = created[1];
      if (first === undefined || other === undefined) throw new Error("Expected two native Option deletion parents");
      const collection = `/admin/products/${first.product.id}/options`;
      const detail = `${collection}/${first.selected.id}`;
      phase = "drain seeded owner";
      await fixture.stop();
      const before = await observeAt("observe seeded graph");
      expect(before.variantOptions).toHaveLength(2);
      expect(first.selected.values).toHaveLength(2);

      fixture.start();
      phase = "authorization and projection refusals";
      expect((await fixture.remove(detail, { admin: adminCredential })).status).toBe(401);
      expect((await fixture.remove(detail, { private: true })).status).toBe(401);
      expect((await fixture.remove(detail, { private: true, admin: "invalid-admin" })).status).toBe(401);
      for (const suffix of ["without-policy", "read-only", "option-reader"]) {
        expect((await fixture.remove(detail, { private: true, admin: `${adminCredential}-${suffix}` })).status).toBe(403);
      }
      for (const query of ["fields=unsupported_field", "fields=variants.unsupported_field", "fields=__proto__.x", "limit=invalid"]) {
        const unsupported = await fixture.remove(`${detail}?${query}`);
        expect(unsupported.status, await unsupported.clone().text()).toBe(400);
        expect(await unsupported.json()).toMatchObject({ type: "invalid_data" });
      }
      phase = "drain refused owner";
      await fixture.stop();
      expect(await observeAt("observe unchanged refused graph")).toEqual(before);

      fixture.start();
      phase = "wrong parent and missing Option no-op";
      for (const id of [other.selected.id, "opt_missing_native_parent_delete"]) {
        const response = await fixture.remove(`${collection}/${id}?fields=${fields}`);
        expect(response.status, await response.clone().text()).toBe(200);
        const body = decodeDeletedOption(await response.json());
        expect(body).toMatchObject({ id, object: "product_option", deleted: true });
        expect(decodeRawOptionParent(body.parent)).toMatchObject({ id: first.product.id,
          options: expect.arrayContaining([...first.product.options]) });
      }
      phase = "drain no-op owner";
      await fixture.stop();
      const absent = await observeAt("observe unchanged no-op graph");
      const { outcomes: _beforeOutcomes, publishedTimestamp: _beforeTimestamp, ...beforeData } = before;
      const { outcomes: _absentOutcomes, publishedTimestamp: _absentTimestamp, ...absentData } = absent;
      expect(absentData).toEqual(beforeData);

      fixture.start();
      phase = "delete selected Option";
      // Native DELETE ignores body selectors; the URL remains authoritative.
      const response = await fixture.request({ ids: [other.selected.id], product_id: other.product.id },
        { private: true, admin: adminCredential, method: "DELETE", path: `${detail}?fields=${fields}` });
      expect(response.status, await response.clone().text()).toBe(200);
      const deleted = decodeDeletedOption(await response.json());
      expect(deleted).toMatchObject({ id: first.selected.id, object: "product_option", deleted: true });
      const parent = decodeRawOptionParent(deleted.parent);
      expect(parent.options).toEqual([first.retained]);
      const inventory = decodeInventoryLink(before.variantInventoryItems.find(row => row.variant_id === first.variant.id));
      const priceLink = decodePriceLink(before.variantPriceSets.find(row => row.variant_id === first.variant.id));
      const price = before.prices.find(row => row.price_set_id === priceLink.price_set_id);
      if (price === undefined) throw new Error("Native Option fixture omitted its persisted price");
      expect(parent).toMatchObject({ id: first.product.id, variants: [{ id: first.variant.id, sku: first.variant.sku,
        manage_inventory: true, price_set: { prices: [{ id: price.id, amount: first.amount, currency_code: "usd", raw_amount: price.raw_amount }] },
        inventory_items: [expect.objectContaining({ ...inventory, inventory: { id: inventory.inventory_item_id, sku: first.variant.sku } })] }] });
      // This route intentionally returns the raw native graph. A Product
      // remapper would flatten price_set.prices and replace its raw companion.
      expect(deleted.parent).not.toHaveProperty("variants.0.prices");
      phase = "probe deleting incarnation";
      const incarnation = await fixture.probeIncarnation();
      phase = "drain deleting owner";
      await fixture.stop();
      const persisted = await observeAt("observe committed Option deletion");
      for (const key of ["products", "variants", "variantOptions", "priceSets", "prices", "inventoryItems", "inventoryLevels",
        "reservations", "variantPriceSets", "variantInventoryItems"] as const) {
        expect(persisted[key], `Option DELETE changed retained ${key}`).toEqual(before[key]);
      }
      expect(persisted.options.find(row => row.id === first.selected.id)).toMatchObject({ deleted_at: expect.any(String) });
      expect(persisted.options.filter(row => row.id !== first.selected.id)).toEqual(before.options.filter(row => row.id !== first.selected.id));
      const selectedValues = persisted.optionValues.filter(row => row.option_id === first.selected.id);
      expect(selectedValues).toHaveLength(2);
      for (const value of selectedValues) {
        expect(value).toMatchObject({ deleted_at: expect.any(String), updated_at: expect.any(String) });
        expect(value.updated_at).not.toBe(before.optionValues.find(row => row.id === value.id)?.updated_at);
      }
      expect(persisted.optionValues.filter(row => row.option_id !== first.selected.id))
        .toEqual(before.optionValues.filter(row => row.option_id !== first.selected.id));
      const publications = persisted.outcomes.filter(outcome => outcome.timestamp > absent.publishedTimestamp
        && outcome.value.kind === "nativeRoot" && outcome.value.state === "committed");
      expect(publications).toHaveLength(1);
      const publication = publications[0];
      if (publication === undefined) throw new Error("Native Option deletion omitted its committed root outcome");
      const changedRows = persisted.businessRows.filter(row => row.timestamp > absent.publishedTimestamp);
      expect(changedRows).toHaveLength(3);
      expect(changedRows.every(row => row.timestamp === publication.timestamp)).toBe(true);
      const revisions = persisted.revisions.filter(revision => revision.timestamp > absent.publishedTimestamp);
      expect(revisions.every(revision => revision.timestamp === publication.timestamp)).toBe(true);
      for (const id of [first.selected.id, ...first.selected.values.map(value => value.id)]) {
        expect(revisions).toContainEqual(expect.objectContaining({ previous: expect.any(BigInt), deleted: false,
          value: expect.objectContaining({ id, deleted_at: expect.any(String) }) }));
      }
      const envelopeTable = fixture.catalog.eventDefinition.tables.find(table => table.privateEvent?.role === "envelope")?.name;
      const familyTable = fixture.catalog.eventDefinition.tables.find(table => table.privateEvent?.role === "family")?.name;
      if (familyTable === undefined || envelopeTable === undefined) throw new Error("Native Option fixture omitted event storage");
      expect(persisted.rows.filter(row => row.table === familyTable && row.timestamp === publication.timestamp)).toHaveLength(1);
      expect(persisted.rows.filter(row => row.table === envelopeTable && row.timestamp === publication.timestamp).map(row => row.value))
        .toEqual(expect.arrayContaining([expect.objectContaining({ envelope: expect.objectContaining({ contract: "product-option.deleted",
          message: expect.objectContaining({ data: { id: first.selected.id } }) }) })]));

      fixture.start();
      phase = "read surviving graphs after recreation";
      const missing = await fixture.get(detail);
      expect(missing.status, await missing.clone().text()).toBe(200);
      expect(await missing.json()).toEqual({});
      expect(await fixture.probeIncarnation()).not.toBe(incarnation);
      for (const expected of created) {
        const rich = await fixture.get(`/admin/products/${expected.product.id}?fields=${fields}`);
        expect(rich.status, await rich.clone().text()).toBe(200);
        const body: unknown = await rich.json();
        const product = decodeProduct(body).product;
        expect(product.options).toEqual(expected === first ? [first.retained] : expected.product.options);
        expect(decodeReadProduct(body).product.variants).toEqual([expect.objectContaining({ id: expected.variant.id,
          sku: expected.variant.sku, prices: [expect.objectContaining({ amount: expected.amount })],
          inventory_items: [expect.objectContaining({ variant_id: expected.variant.id })] })]);
      }
      phase = "drain recreated read owner";
      await fixture.stop();
      const afterReads = await observeAt("observe unchanged recreated read graph");
      expect(afterReads).toEqual(persisted);

      fixture.start();
      phase = "repeat deleted and missing Option no-op";
      for (const id of [first.selected.id, "opt_missing_native_parent_delete"]) {
        const repeated = await fixture.remove(`${collection}/${id}?fields=${fields}`);
        expect(repeated.status, await repeated.clone().text()).toBe(200);
        const body = decodeDeletedOption(await repeated.json());
        expect(body).toMatchObject({ id, object: "product_option", deleted: true });
        expect(decodeRawOptionParent(body.parent)).toMatchObject({ id: first.product.id, options: [first.retained] });
      }
      phase = "drain repeated no-op owner";
      await fixture.stop();
      const afterRepeated = await observeAt("observe unchanged repeated no-op graph");
      const { outcomes: _persistedOutcomes, publishedTimestamp: _persistedTimestamp, ...persistedData } = persisted;
      const { outcomes: _repeatedOutcomes, publishedTimestamp: _repeatedTimestamp, ...repeatedData } = afterRepeated;
      expect(repeatedData).toEqual(persistedData);
    } catch (cause) {
      console.error("Option DELETE proof failed during", phase, cause);
      primary.push(cause); throw cause;
    }
    finally {
      try { await fixture.close(); }
      catch (cause) { throw new AggregateError([...primary, cause], "Admin Product Option DELETE proof cleanup failed"); }
    }
  }, 360_000);

  it("persists both native Image and Variant batch endpoints across DO recreation without crossing Product commerce graphs", async () => {
    const fixture = await createAdminProductDOFixture();
    const primary: unknown[] = [];
    const fields = `${readFields},images.id,images.url,variants.thumbnail`;
    const post = (path: string, input: unknown, status = 200) => nativeJson(fixture.request(input,
      { private: true, admin: adminCredential, path }), status);
    const rich = (id: string) => nativeJson(fixture.get(`/admin/products/${id}?fields=${fields}`));
    try {
      fixture.start();
      const created = [];
      for (const [name, amount] of [["First", 1234], ["Other", 8765]] as const) {
        const body = await post(`/admin/products?fields=${fields}`, { title: `${name} Image Parent`, handle: `do-images-${name.toLowerCase()}`,
          images: [{ url: `https://images.test/${name}-one.png` }, { url: `https://images.test/${name}-two.png` }],
          options: [{ title: "Size", values: ["One"] }], variants: [{ title: `${name} managed`, sku: `DO-IMAGES-${name}`,
            manage_inventory: true, options: { Size: "One" }, prices: [{ amount, currency_code: "usd" }] }] });
        const product = decodeImageProduct(body).product, variant = product.variants[0], image = product.images[0], nextImage = product.images[1];
        if (variant === undefined || image === undefined || nextImage === undefined) throw new Error("Image HTTP seed omitted its managed Variant or Images");
        await post(`/admin/products/${product.id}/variants/${variant.id}`, { thumbnail: image.url });
        created.push({ product, variant, image, nextImage, amount });
      }
      const first = created[0], other = created[1];
      if (first === undefined || other === undefined) throw new Error("Expected two independent Image HTTP parents");
      const forward = `/admin/products/${first.product.id}/variants/${first.variant.id}/images/batch`;
      const inverse = `/admin/products/${first.product.id}/images/${first.image.id}/variants/batch`;
      expect(await post(forward, { add: [first.image.id] })).toEqual({ added: [first.image.id], removed: [] });
      expect(await post(`/admin/products/${other.product.id}/images/${other.image.id}/variants/batch`, { add: [other.variant.id] }))
        .toEqual({ added: [other.variant.id], removed: [] });
      const beforeGraphs = await Promise.all(created.map(({ product }) => rich(product.id)));
      const incarnation = await fixture.probeIncarnation();
      await fixture.stop();
      const before = await fixture.observe();
      const assignmentTable = fixture.catalog.productSource.definition.tables.find(table => table.localName === "product_variant_product_image");
      if (assignmentTable === undefined) throw new Error("Actual Product catalog omitted Image assignment storage");
      const assignments = (snapshot: typeof before) => snapshot.rows.filter(row => row.table === assignmentTable.name)
        .map(row => decodeImageAssignment(row.value));
      expect(assignments(before)).toHaveLength(2);
      fixture.start();
      for (const [path, body] of [
        [forward, { add: [other.image.id] }], [forward, { remove: [first.image.id, other.image.id] }],
        [`/admin/products/${first.product.id}/variants/${other.variant.id}/images/batch`, { add: [first.image.id] }],
        [inverse, { add: [other.variant.id] }], [inverse, { remove: [first.variant.id, other.variant.id] }],
        [`/admin/products/${first.product.id}/images/${other.image.id}/variants/batch`, { add: [first.variant.id] }],
      ] as const) expect(await post(path, body, 400)).toMatchObject({ type: "invalid_data",
        message: "Product Image and Variant must belong to the specified Product" });
      await fixture.stop();
      const refused = await fixture.observe();
      // Parent ownership is a native business refusal after claim. Its failed
      // root audit is durable; no business, event or history write may escape.
      const failed = refused.outcomes.filter(outcome => outcome.timestamp > before.publishedTimestamp);
      expect(failed).toHaveLength(6);
      expect(failed.every(outcome => outcome.value.kind === "nativeRoot" && outcome.value.state === "failed")).toBe(true);
      expect(new Set(failed.map(outcome => outcome.value.key)).size).toBe(6);
      expect(refused.outcomes.filter(outcome => outcome.timestamp <= before.publishedTimestamp)).toEqual(before.outcomes);
      expect(refused.publishedTimestamp).toBe(failed.reduce((latest, outcome) => outcome.timestamp > latest ? outcome.timestamp : latest, 0n));
      const { outcomes: _beforeOutcomes, publishedTimestamp: _beforeTimestamp, ...beforeBusiness } = before;
      const { outcomes: _refusedOutcomes, publishedTimestamp: _refusedTimestamp, ...refusedBusiness } = refused;
      expect(refusedBusiness).toEqual(beforeBusiness);
      fixture.start();
      expect(await post(forward, { product_id: other.product.id, add: [] }, 400)).toMatchObject({ type: "invalid_data" });
      expect((await fixture.request({ add: [] }, { private: true, admin: `${adminCredential}-without-policy`, path: forward })).status).toBe(403);
      await fixture.stop();
      expect(await fixture.observe()).toEqual(refused);
      fixture.start();
      expect(await post(forward, { remove: [first.image.id] })).toEqual({ added: [], removed: [first.image.id] });
      expect(decodeImageProduct(await rich(first.product.id)).product.variants).toEqual([{ id: first.variant.id, thumbnail: null }]);
      expect(await post(inverse, { add: [first.variant.id] })).toEqual({ added: [first.variant.id], removed: [] });
      expect(await post(inverse, { remove: [first.variant.id] })).toEqual({ added: [], removed: [first.variant.id] });
      expect(await post(forward, { add: [first.nextImage.id] })).toEqual({ added: [first.nextImage.id], removed: [] });
      await fixture.stop();
      const persisted = await fixture.observe();
      expect(assignments(persisted)).toEqual(expect.arrayContaining([
        { id: expect.any(String), variant_id: first.variant.id, image_id: first.nextImage.id },
        { id: expect.any(String), variant_id: other.variant.id, image_id: other.image.id },
      ]));
      expect(assignments(persisted)).toHaveLength(2);
      expect(assignments(persisted).find(row => row.variant_id === other.variant.id))
        .toEqual(assignments(before).find(row => row.variant_id === other.variant.id));
      expect(persisted.variants.filter(row => row.id !== first.variant.id)).toEqual(before.variants.filter(row => row.id !== first.variant.id));
      for (const key of ["products", "options", "optionValues", "variantOptions", "priceSets", "prices", "inventoryItems", "inventoryLevels",
        "reservations", "variantPriceSets", "variantInventoryItems"] as const) expect(persisted[key], `Image association changed ${key}`).toEqual(before[key]);
      fixture.start();
      expect(await fixture.probeIncarnation()).not.toBe(incarnation);
      for (const [index, expected] of created.entries()) {
        const body = await rich(expected.product.id), graph = decodeReadProduct(body).product;
        expect(graph).toEqual(decodeReadProduct(beforeGraphs[index]).product);
        expect(graph.variants).toEqual([expect.objectContaining({ id: expected.variant.id,
          prices: [expect.objectContaining({ amount: expected.amount })],
          inventory_items: [expect.objectContaining({ variant_id: expected.variant.id, inventory: expect.objectContaining({ sku: `DO-IMAGES-${index === 0 ? "First" : "Other"}` }) })] })]);
        expect(decodeImageProduct(body).product.variants).toEqual([{ id: expected.variant.id, thumbnail: index === 0 ? null : expected.image.url }]);
      }
      await fixture.stop();
      expect(await fixture.observe()).toEqual(persisted);
    } catch (cause) { primary.push(cause); throw cause; }
    finally {
      try { await fixture.close(); }
      catch (cause) { throw new AggregateError([...primary, cause], "Image batch DO proof cleanup failed"); }
    }
  }, 360_000);

  it("runs all ten native Type and Tag HTTP methods and retains Product references and commerce graphs across DO recreation", async () => {
    const fixture = await createAdminProductDOFixture();
    const primary: unknown[] = [];
    const post = (path: string, input: unknown, status = 200) => nativeJson(fixture.request(input,
      { private: true, admin: adminCredential, path }), status);
    const fields = `${readFields},type_id,type.id,tags.id`;
    try {
      fixture.start();
      const type = decodeCatalogEntity((await post("/admin/product-types", { value: "DO Type", metadata: { keep: "yes", drop: "old" } })).product_type);
      const tag = decodeCatalogEntity((await post("/admin/product-tags", { value: "DO Tag", metadata: { keep: "yes", drop: "old" } })).product_tag);
      const body = await post(`/admin/products?fields=${fields}`, { title: "Catalog linked Product", handle: "do-catalog-product",
        type_id: type.id, tags: [{ id: tag.id }], options: [{ title: "Size", values: ["One"] }],
        variants: [{ title: "Catalog managed", sku: "DO-CATALOG-MANAGED", manage_inventory: true, options: { Size: "One" },
          prices: [{ amount: 2300, currency_code: "usd" }] }] });
      const product = decodeNativeId(body.product);
      expect(body.product).toMatchObject({ type_id: type.id, type: { id: type.id }, tags: [{ id: tag.id }] });
      const graph = decodeReadProduct(body).product;
      const incarnation = await fixture.probeIncarnation();
      for (const [family, entity, row] of [["product-types", "product_type", type], ["product-tags", "product_tag", tag]] as const) {
        const path = `/admin/${family}`;
        expect(await nativeJson(fixture.get(`${path}?fields=id,value,metadata&limit=2&order=id`)))
          .toEqual({ [`${entity}s`]: [row], count: 1, offset: 0, limit: 2 });
        expect(await nativeJson(fixture.get(`${path}/${row.id}?fields=id,value,metadata`))).toEqual({ [entity]: row });
        const changed = { id: row.id, value: `${row.value} renamed`, metadata: { keep: "yes", nested: { fresh: true } } };
        expect(decodeCatalogEntity((await post(`${path}/${row.id}`, { value: changed.value, metadata: { drop: "", nested: { fresh: true } } }))[entity])).toEqual(changed);
        expect(decodeCatalogEntity((await post(`${path}/${row.id}`, {}))[entity])).toEqual(changed);
        expect(decodeCatalogEntity((await post(`${path}/${row.id}`, { metadata: {} }))[entity]).metadata).toEqual({});
        expect(decodeCatalogEntity((await post(`${path}/${row.id}?fields=id,value,metadata`, { metadata: null }))[entity]).metadata).toBeNull();
        expect(await nativeJson(fixture.get(`${path}?fields=id&limit=1&offset=1&order=id`)))
          .toEqual({ [`${entity}s`]: [], count: 1, offset: 1, limit: 1 });
        expect(await nativeJson(fixture.get(`${path}/missing`))).toEqual({});
        expect(await post(`${path}/missing`, { metadata: {} }, 404)).toMatchObject({ type: "not_found" });
      }
      await fixture.stop();
      const before = await fixture.observe();
      fixture.start();
      for (const family of ["product-types", "product-tags"]) {
        expect((await fixture.request({ value: "No authority" }, { private: true, admin: `${adminCredential}-without-policy`, path: `/admin/${family}` })).status).toBe(403);
        for (const [suffix, input] of [["?fields=id,unadmitted", { value: "Must not create" }],
          ["/missing?fields=id,unadmitted", { value: "Must not update" }], ["", { value: "Strict body", unknown: true }],
          ["", { value: "Invalid metadata", metadata: [] }]] as const) expect(await post(`/admin/${family}${suffix}`, input, 400)).toMatchObject({ type: "invalid_data" });
      }
      await fixture.stop();
      expect(await fixture.observe()).toEqual(before);
      fixture.start();
      expect(await fixture.probeIncarnation()).not.toBe(incarnation);
      for (const [family, entity, row] of [["product-types", "product_type", type], ["product-tags", "product_tag", tag]] as const) {
        expect(await nativeJson(fixture.get(`/admin/${family}/${row.id}?fields=id,value,metadata`)))
          .toEqual({ [entity]: { id: row.id, value: `${row.value} renamed`, metadata: null } });
        for (const id of [row.id, row.id, "missing"]) expect(await nativeJson(fixture.remove(`/admin/${family}/${id}`)))
          .toEqual({ id, object: entity, deleted: true });
        expect(await nativeJson(fixture.get(`/admin/${family}?fields=id&limit=2`)))
          .toEqual({ [`${entity}s`]: [], count: 0, offset: 0, limit: 2 });
      }
      await fixture.stop();
      const persisted = await fixture.observe();
      for (const key of ["products", "options", "optionValues", "variants", "variantOptions", "priceSets", "prices", "inventoryItems",
        "variantPriceSets", "variantInventoryItems"] as const) expect(persisted[key], `Catalog deletion changed ${key}`).toEqual(before[key]);
      const tagRelation = fixture.catalog.productRuntime.metadata.queryRelations.get(fixture.catalog.productRuntime.metadata.product.table.name)?.get("tags");
      if (tagRelation?.join.type !== "manyToMany") throw new Error("Missing actual Tag pivot metadata");
      const pivotTable = tagRelation.join.pivotTable;
      const pivot = fixture.catalog.productSource.definition.tables.find(table => table.localName === pivotTable);
      if (pivot === undefined) throw new Error("Missing actual Tag pivot storage");
      expect(before.rows.filter(row => row.table === pivot.name)).toHaveLength(1);
      expect(persisted.rows.filter(row => row.table === pivot.name)).toEqual(before.rows.filter(row => row.table === pivot.name));
      fixture.start();
      const after = await nativeJson(fixture.get(`/admin/products/${product.id}?fields=${fields}`));
      expect(after.product).toMatchObject({ id: product.id, type_id: type.id, type: null, tags: [] });
      expect(decodeReadProduct(after).product).toEqual(graph);
      await fixture.stop();
      expect(await fixture.observe()).toEqual(persisted);
    } catch (cause) { primary.push(cause); throw cause; }
    finally {
      try { await fixture.close(); }
      catch (cause) { throw new AggregateError([...primary, cause], "Type and Tag DO proof cleanup failed"); }
    }
  }, 360_000);

  it("runs all twelve native Category and Collection HTTP methods with trees and memberships across DO recreation", async () => {
    const fixture = await createAdminProductDOFixture();
    const primary: unknown[] = [];
    const post = (path: string, input: unknown, status = 200) => nativeJson(fixture.request(input,
      { private: true, admin: adminCredential, path }), status);
    const categories = "/admin/product-categories", collections = "/admin/collections";
    const fields = `${readFields},collection_id,collection.id,categories.id`;
    try {
      fixture.start();
      const root = decodeNativeId((await post(categories, { name: "Root", handle: "do-root", is_active: true, metadata: { old: true } })).product_category);
      const child = decodeNativeId((await post(categories, { name: "Child", handle: "do-child", parent_category_id: root.id, rank: 0 })).product_category);
      const leaf = decodeNativeId((await post(categories, { name: "Leaf", handle: "do-leaf", parent_category_id: child.id })).product_category);
      expect(await nativeJson(fixture.get(`${categories}/${root.id}`))).toMatchObject({ product_category: { id: root.id, parent_category: null,
        category_children: [{ id: child.id, category_children: [{ id: leaf.id, category_children: [] }] }] } });
      expect(await nativeJson(fixture.get(`${categories}/${leaf.id}`))).toMatchObject({ product_category: { id: leaf.id,
        parent_category: { id: child.id, parent_category: { id: root.id, parent_category: null } }, category_children: [] } });
      expect(await nativeJson(fixture.get(`${categories}/${child.id}?fields=parent_category_id`)))
        .toEqual({ product_category: { id: child.id, parent_category_id: root.id } });
      expect(await nativeJson(fixture.get(`${categories}/${child.id}?fields=id&include_ancestors_tree=true&include_descendants_tree=true`)))
        .toEqual({ product_category: { id: child.id } });
      expect(await nativeJson(fixture.get(`${categories}/${child.id}?fields=id,name,parent_category.name,category_children.name`)))
        .toEqual({ product_category: { id: child.id, name: "Child", parent_category: { name: "Root" }, category_children: [{ name: "Leaf" }] } });
      expect(await nativeJson(fixture.get(`${categories}?fields=id&order=id&limit=1&offset=1`)))
        .toEqual({ product_categories: [{ id: [root.id, child.id, leaf.id].sort()[1] }], count: 3, offset: 1, limit: 1 });
      expect(await nativeJson(fixture.get(`${categories}?fields=id,parent_category_id&parent_category_id[]=${root.id}`)))
        .toEqual({ product_categories: [{ id: child.id, parent_category_id: root.id }], count: 1, offset: 0, limit: 50 });
      expect(await post(`${categories}/${root.id}?fields=id,name,metadata`, { name: "Renamed Root", metadata: { fresh: true } }))
        .toEqual({ product_category: { id: root.id, name: "Renamed Root", metadata: { fresh: true } } });
      const collection = decodeNativeId((await post(collections, { title: "Selected", handle: "do-selected", metadata: { keep: "yes", drop: "old" },
        additional_data: { source: "native-do" } })).collection);
      const otherCollection = decodeNativeId((await post(collections, { title: "Other", handle: "do-other" })).collection);
      expect(await nativeJson(fixture.get(`${collections}?fields=id&order=id&limit=1&offset=1`)))
        .toEqual({ collections: [{ id: [collection.id, otherCollection.id].sort()[1] }], count: 2, offset: 1, limit: 1 });
      expect(await post(`${collections}/${collection.id}?fields=id,title,metadata`, { title: "Changed", metadata: { drop: "", fresh: true }, additional_data: { updated: true } }))
        .toEqual({ collection: { id: collection.id, title: "Changed", metadata: { keep: "yes", fresh: true } } });
      const created = [];
      for (const [name, amount] of [["Selected", 2300], ["Unrelated", 8700]] as const) {
        const body = await post(`/admin/products?fields=${fields}`, { title: name, handle: `do-taxonomy-${name.toLowerCase()}`,
          options: [{ title: "Size", values: ["One"] }], variants: [{ title: `${name} managed`, sku: `DO-TAXONOMY-${name}`,
            manage_inventory: true, options: { Size: "One" }, prices: [{ amount, currency_code: "usd" }] }] });
        created.push({ id: decodeNativeId(body.product).id, graph: decodeReadProduct(body).product });
      }
      const selected = created[0], unrelated = created[1];
      if (selected === undefined || unrelated === undefined) throw new Error("Taxonomy HTTP seed omitted its Products");
      for (const category of [root, child]) expect(await post(`${categories}/${category.id}/products?fields=id,name,products.id,products.title`, { add: [selected.id] }))
        .toEqual({ product_category: { id: category.id, name: category === root ? "Renamed Root" : "Child", products: [{ id: selected.id, title: "Selected" }] } });
      await post(`${categories}/${root.id}/products?fields=id`, { add: [selected.id], remove: [selected.id] });
      expect((await nativeJson(fixture.get(`/admin/products/${selected.id}?fields=${fields}`))).product)
        .toMatchObject({ categories: [{ id: child.id }] });
      await post(`${categories}/${root.id}/products?fields=id`, { add: [selected.id] });
      await post(`${collections}/${otherCollection.id}/products?fields=id,products.id`, { add: [selected.id] });
      await post(`${collections}/${collection.id}/products?fields=id,products.id`, { remove: [selected.id] });
      expect((await nativeJson(fixture.get(`/admin/products/${selected.id}?fields=${fields}`))).product)
        .toMatchObject({ collection_id: otherCollection.id });
      expect(await post(`${collections}/${collection.id}/products?fields=id,products.id,products.title`, { add: [selected.id] }))
        .toEqual({ collection: { id: collection.id, products: [{ id: selected.id, title: "Selected" }] } });
      expect(await nativeJson(fixture.get(`${collections}/${otherCollection.id}?fields=id,products.id`)))
        .toEqual({ collection: { id: otherCollection.id, products: [] } });
      const incarnation = await fixture.probeIncarnation();
      await fixture.stop();
      const before = await fixture.observe();
      fixture.start();
      for (const [path, id, input] of [[categories, root.id, { name: "Rejected" }], [collections, collection.id, { title: "Rejected" }]] as const) {
        for (const [suffix, body] of [["", input], [`/${id}`, input], [`/${id}/products`, { add: [selected.id] }]] as const)
          expect(await post(`${path}${suffix}?fields=id,unadmitted`, body, 400)).toMatchObject({ type: "invalid_data" });
        expect((await fixture.request(input, { private: true, admin: `${adminCredential}-without-policy`, path })).status).toBe(403);
      }
      expect(await post(categories, { name: "Fractional", rank: 0.5 }, 400)).toMatchObject({ type: "invalid_data" });
      expect(await post(categories, { name: "Unsupported data", additional_data: { custom: true } }, 400)).toMatchObject({ type: "invalid_data" });
      expect(await post(collections, { title: "Malformed data", additional_data: [] }, 400)).toMatchObject({ type: "invalid_data" });
      await fixture.stop();
      expect(await fixture.observe()).toEqual(before);
      fixture.start();
      expect(await fixture.probeIncarnation()).not.toBe(incarnation);
      expect(await nativeJson(fixture.get(`${categories}/${root.id}`))).toMatchObject({ product_category: { id: root.id, name: "Renamed Root",
        category_children: [{ id: child.id, category_children: [{ id: leaf.id }] }] } });
      expect(await nativeJson(fixture.get(`${categories}/${child.id}?fields=id,name,parent_category.name,category_children.name`)))
        .toEqual({ product_category: { id: child.id, name: "Child", parent_category: { name: "Renamed Root" }, category_children: [{ name: "Leaf" }] } });
      expect(await nativeJson(fixture.get(`${categories}/${root.id}?fields=id,name,products.id,products.title`)))
        .toEqual({ product_category: { id: root.id, name: "Renamed Root", products: [{ id: selected.id, title: "Selected" }] } });
      expect(await nativeJson(fixture.get(`${collections}/${collection.id}?fields=id,title,metadata,products.id`)))
        .toEqual({ collection: { id: collection.id, title: "Changed", metadata: { keep: "yes", fresh: true }, products: [{ id: selected.id }] } });
      expect((await nativeJson(fixture.get(`/admin/products/${selected.id}?fields=${fields}`))).product)
        .toMatchObject({ collection_id: collection.id, collection: { id: collection.id }, categories: expect.arrayContaining([{ id: root.id }, { id: child.id }]) });
      expect(await nativeJson(fixture.get(`${categories}/missing`), 404)).toMatchObject({ type: "not_found" });
      expect(await post(`${categories}/missing`, { name: "No existence pre-read" })).toEqual({});
      expect(await nativeJson(fixture.get(`${collections}/missing`))).toEqual({});
      expect(await post(`${collections}/missing`, { title: "Missing" }, 404)).toMatchObject({ type: "not_found" });
      for (const id of [leaf.id, child.id]) expect(await nativeJson(fixture.remove(`${categories}/${id}`)))
        .toEqual({ id, object: "product_category", deleted: true });
      expect(await nativeJson(fixture.remove(`${categories}/missing`), 404)).toMatchObject({ type: "not_found" });
      expect(await nativeJson(fixture.remove(`${collections}/${collection.id}`)))
        .toEqual({ id: collection.id, object: "collection", deleted: true });
      expect(await nativeJson(fixture.remove(`${collections}/missing`))).toEqual({ id: "missing", object: "collection", deleted: true });
      await fixture.stop();
      const persisted = await fixture.observe();
      for (const key of ["options", "optionValues", "variants", "variantOptions", "priceSets", "prices", "inventoryItems", "variantPriceSets", "variantInventoryItems"] as const)
        expect(persisted[key], `Taxonomy deletion changed ${key}`).toEqual(before[key]);
      expect(persisted.products).toEqual(before.products);
      const relation = fixture.catalog.productRuntime.metadata.queryRelations.get(fixture.catalog.productRuntime.metadata.product.table.name)?.get("categories");
      if (relation?.join.type !== "manyToMany") throw new Error("Missing actual Category membership metadata");
      const pivotTable = relation.join.pivotTable;
      const pivot = fixture.catalog.productSource.definition.tables.find(table => table.localName === pivotTable);
      if (pivot === undefined) throw new Error("Missing actual Category membership storage");
      expect(before.rows.filter(row => row.table === pivot.name)).toHaveLength(2);
      expect(persisted.rows.filter(row => row.table === pivot.name)).toEqual(before.rows.filter(row => row.table === pivot.name));
      fixture.start();
      for (const expected of created) {
        const body = await nativeJson(fixture.get(`/admin/products/${expected.id}?fields=${fields}`));
        expect(decodeReadProduct(body).product).toEqual(expected.graph);
        if (expected === selected) expect(body.product).toMatchObject({ collection_id: collection.id, collection: null, categories: [{ id: root.id }] });
        else expect(body.product).toMatchObject({ collection_id: null, collection: null, categories: [] });
      }
      await fixture.stop();
      expect(await fixture.observe()).toEqual(persisted);
    } catch (cause) { primary.push(cause); throw cause; }
    finally {
      try { await fixture.close(); }
      catch (cause) { throw new AggregateError([...primary, cause], "Category and Collection DO proof cleanup failed"); }
    }
  }, 360_000);

  it("runs global Variant reads and native Inventory Link mutations with scoped atomic refusal and durable identity across DO recreation", async () => {
    const fixture = await createAdminProductDOFixture();
    const primary: unknown[] = [];
    try {
      fixture.start();
      const created = [];
      for (const [name, amount] of [["Selected", 651], ["Unrelated", 982]] as const) {
        const body = await nativeJson(fixture.request({ title: `${name} Link Parent`, handle: `do-inventory-link-${name.toLowerCase()}`,
          options: [{ title: "Size", values: ["One"] }], variants: [{ title: `${name} One`, sku: `DO-INVENTORY-LINK-${name}`,
            options: { Size: "One" }, prices: [{ amount, currency_code: "usd" }] }] }, { private: true, admin: adminCredential, path: `${managedPath},variants.prices.*` }));
        const product = decodeProduct(body).product, variant = decodeVariants(body).product.variants[0];
        if (variant === undefined) throw new Error("Native Link proof seed omitted Variant");
        created.push({ product, variant, amount });
      }
      const selected = created[0], other = created[1];
      if (selected === undefined || other === undefined) throw new Error("Native Link proof omitted two Products");
      await fixture.stop();
      const before = await fixture.observe();
      const own = decodeInventoryLink(before.variantInventoryItems.find(row => row.variant_id === selected.variant.id));
      const inventory = decodeInventoryLink(before.variantInventoryItems.find(row => row.variant_id === other.variant.id));
      const otherPrice = decodePriceLink(before.variantPriceSets.find(row => row.variant_id === other.variant.id));
      await fixture.seedInventory({ stocking: { locations: [{ name: "Global Variant Link Warehouse" }], inventory_levels: [
        { inventory_item_id: own.inventory_item_id, location_index: 0, stocked_quantity: 20 },
      ] } });
      const stocked = await fixture.observe();
      fixture.start();
      const root = `/admin/products/${selected.product.id}/variants`;
      const collection = `${root}/${selected.variant.id}/inventory-items`;
      const batchPath = `${root}/inventory-items/batch`;
      const query = "?fields=id,product_id,inventory_items.id,inventory_items.variant_id,inventory_items.inventory_item_id,inventory_items.required_quantity";
      const post = (path: string, input: unknown, status = 200, admin = adminCredential) => nativeJson(fixture.request(input,
        { private: true, admin, path }), status);
      const wire = (variant_id: string, inventory_item_id: string, required_quantity?: number) => ({ product: { variant_id }, inventory: { inventory_item_id },
        ...(required_quantity === undefined ? {} : { data: { required_quantity } }) });
      const variantLink = Schema.Struct({ id: Schema.NonEmptyString, variant_id: Schema.NonEmptyString,
        inventory_item_id: Schema.NonEmptyString, required_quantity: Schema.Number });
      const decodeLinkIdentity = Schema.decodeUnknownSync(variantLink);
      const ownIdentity = decodeLinkIdentity(before.variantInventoryItems.find(row => row.variant_id === selected.variant.id));
      const readLinks = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.NonEmptyString, product_id: Schema.NonEmptyString,
        inventory_items: Schema.Array(variantLink) }));
      for (const credential of [`${adminCredential}-without-policy`, `${adminCredential}-read-only`]) {
        expect(await nativeJson(fixture.get("/admin/product-variants", { private: true, admin: credential }), 403)).toMatchObject({ type: "forbidden" });
      }
      const global = await nativeJson(fixture.get("/admin/product-variants?limit=1&offset=1&order=id", {
        private: true, admin: `${adminCredential}-variant-reader`,
      }));
      expect(global).toMatchObject({ count: 2, offset: 1, limit: 1, variants: [expect.objectContaining({ product: expect.objectContaining({ id: expect.any(String) }),
        prices: [expect.objectContaining({ amount: expect.any(Number), price_set_id: expect.any(String), variant_id: expect.any(String) })] })] });
      expect(global).not.toHaveProperty("variants.0.inventory_quantity");
      expect(await nativeJson(fixture.get(`/admin/product-variants?id=${selected.variant.id}&fields=id,product.id,prices.amount`)))
        .toEqual({ variants: [{ id: selected.variant.id, product: { id: selected.product.id }, prices: [{ amount: selected.amount, title: "",
          raw_amount: { value: selected.amount }, currency_code: "", min_quantity: null, max_quantity: null, price_set_id: "",
          variant_id: selected.variant.id, deleted_at: null, rules: {} }] }], count: 1, offset: 0, limit: 50 });
      expect(await nativeJson(fixture.get(`/admin/product-variants?id=${selected.variant.id}&fields=id,manage_inventory,inventory_quantity`)))
        .toEqual({ variants: [{ id: selected.variant.id, manage_inventory: true, inventory_quantity: 20 }], count: 1, offset: 0, limit: 50 });
      for (const credential of [`${adminCredential}-without-policy`, `${adminCredential}-read-only`, `${adminCredential}-variant-reader`]) {
        await post(collection + query, { inventory_item_id: inventory.inventory_item_id, required_quantity: 2 }, 403, credential);
        await post(`${collection}/${own.inventory_item_id}${query}`, { required_quantity: 2 }, 403, credential);
        await nativeJson(fixture.remove(`${collection}/${own.inventory_item_id}${query}`, { private: true, admin: credential }), 403);
        await post(batchPath, { update: [{ variant_id: selected.variant.id, inventory_item_id: own.inventory_item_id, required_quantity: 2 }] }, 403, credential);
      }
      for (const suffix of ["?fields=unsupported_field", "?fields=inventory_items.unsupported_field", "?fields=__proto__.x"]) {
        await post(collection + suffix, { inventory_item_id: inventory.inventory_item_id, required_quantity: 2 }, 400);
        await post(`${collection}/${own.inventory_item_id}${suffix}`, { required_quantity: 2 }, 400);
        await nativeJson(fixture.remove(`${collection}/${own.inventory_item_id}${suffix}`), 400);
      }
      await post(collection + query, { inventory_item_id: inventory.inventory_item_id, required_quantity: 0.5 }, 400);
      await post(batchPath, { create: Array.from({ length: 9 }, () => ({ variant_id: selected.variant.id,
        inventory_item_id: inventory.inventory_item_id, required_quantity: 1 })) }, 400);
      await fixture.stop();
      expect(await fixture.observe()).toEqual(stocked);
      fixture.start();
      // Every method must reject a foreign Variant; a native failed-root audit is allowed, business history is not.
      const foreignCollection = `${root}/${other.variant.id}/inventory-items`;
      await post(foreignCollection + query, { inventory_item_id: own.inventory_item_id, required_quantity: 2 }, 404);
      await post(`${foreignCollection}/${inventory.inventory_item_id}${query}`, { required_quantity: 2 }, 404);
      await nativeJson(fixture.remove(`${foreignCollection}/${inventory.inventory_item_id}${query}`), 404);
      for (const arm of ["create", "update", "delete"] as const) {
        const quantity = arm === "delete" ? {} : { required_quantity: 2 };
        await post(batchPath, { [arm]: [
          { variant_id: selected.variant.id, inventory_item_id: arm === "create" ? inventory.inventory_item_id : own.inventory_item_id, ...quantity },
          { variant_id: other.variant.id, inventory_item_id: own.inventory_item_id, ...quantity },
        ] }, 404);
      }
      await fixture.stop();
      const refused = await fixture.observe();
      expect(refused.outcomes.slice(0, stocked.outcomes.length)).toEqual(stocked.outcomes);
      const failedRoots = refused.outcomes.slice(stocked.outcomes.length);
      expect(failedRoots).toHaveLength(6);
      expect(new Set(failedRoots.map(outcome => outcome.value.key)).size).toBe(6);
      for (const outcome of failedRoots) expect(outcome.value).toMatchObject({ kind: "nativeRoot", state: "failed" });
      for (const key of ["rows", "revisions", "indexes", "businessRows", "products", "options", "optionValues", "variants", "variantOptions",
        "priceSets", "prices", "inventoryItems", "inventoryLevels", "reservations", "variantPriceSets", "variantInventoryItems"] as const) expect(refused[key]).toEqual(stocked[key]);
      fixture.start();
      const added = readLinks((await post(collection + query, { inventory_item_id: inventory.inventory_item_id, required_quantity: 3 })).variant);
      const newLink = added.inventory_items.find(row => row.inventory_item_id === inventory.inventory_item_id);
      expect(newLink).toMatchObject({ variant_id: selected.variant.id, required_quantity: 3 });
      const updated = readLinks((await post(`${collection}/${inventory.inventory_item_id}${query}`, { required_quantity: 7 })).variant);
      const updatedLinks = updated.inventory_items.filter(row => row.inventory_item_id === inventory.inventory_item_id);
      expect(updatedLinks).toEqual([{ id: expect.any(String), variant_id: selected.variant.id, inventory_item_id: inventory.inventory_item_id, required_quantity: 7 }]);
      expect(updatedLinks[0]?.id).not.toBe(newLink?.id);
      const deleted = await nativeJson(fixture.remove(`${collection}/${inventory.inventory_item_id}${query}`));
      expect(deleted).toEqual({ id: wire(selected.variant.id, inventory.inventory_item_id), object: "variant-inventory-item-link", deleted: true,
        parent: { id: selected.variant.id, product_id: selected.product.id, inventory_items: [expect.objectContaining(own)] } });
      await post(`${collection}/${inventory.inventory_item_id}${query}`, { required_quantity: 2 }, 404);
      const selectedPriceLink = decodePriceLink(before.variantPriceSets.find(row => row.variant_id === selected.variant.id));
      const priceId = decodeNativeId(before.prices.find(row => row.price_set_id === selectedPriceLink.price_set_id)).id;
      const aliasQuery = "?fields=id,prices.id,price_set.prices.id";
      const aliasVariant = { id: selected.variant.id, prices: [{ id: priceId, amount: 0, title: "", raw_amount: { value: 0 }, currency_code: "",
        min_quantity: null, max_quantity: null, price_set_id: "", variant_id: selected.variant.id, deleted_at: null, rules: {} }] };
      const currentLinks = async () => readLinks((await nativeJson(fixture.get(`${root}/${selected.variant.id}${query}`))).variant).inventory_items;
      expect(await post(collection + aliasQuery, { inventory_item_id: inventory.inventory_item_id, required_quantity: 11 })).toEqual({ variant: aliasVariant });
      expect((await currentLinks()).filter(row => row.inventory_item_id === inventory.inventory_item_id)).toEqual([expect.objectContaining({ required_quantity: 11 })]);
      expect(await post(`${collection}/${inventory.inventory_item_id}${aliasQuery}`, { required_quantity: 12 })).toEqual({ variant: aliasVariant });
      expect((await currentLinks()).filter(row => row.inventory_item_id === inventory.inventory_item_id)).toEqual([expect.objectContaining({ required_quantity: 12 })]);
      expect(await nativeJson(fixture.remove(`${collection}/${inventory.inventory_item_id}${aliasQuery}`))).toEqual({
        id: wire(selected.variant.id, inventory.inventory_item_id), object: "variant-inventory-item-link", deleted: true, parent: aliasVariant,
      });
      expect((await currentLinks()).filter(row => row.inventory_item_id === inventory.inventory_item_id)).toEqual([]);
      for (const input of [{}, { create: [], update: [], delete: [] }]) expect(await post(batchPath, input)).toEqual({ created: [], updated: [], deleted: [] });
      const create = { variant_id: selected.variant.id, inventory_item_id: inventory.inventory_item_id, required_quantity: 5 };
      const update = { variant_id: selected.variant.id, inventory_item_id: own.inventory_item_id, required_quantity: 4 };
      expect(await post(batchPath, { create: [create], update: [update] })).toEqual({ created: [wire(create.variant_id, create.inventory_item_id, 5)],
        updated: [wire(update.variant_id, update.inventory_item_id, 4)], deleted: [] });
      expect(await post(batchPath, { delete: [{ variant_id: selected.variant.id, inventory_item_id: inventory.inventory_item_id }] }))
        .toEqual({ created: [], updated: [], deleted: [wire(selected.variant.id, inventory.inventory_item_id)] });
      await fixture.stop();
      const persisted = await fixture.observe();
      const activeSelectedLinks = persisted.variantInventoryItems.filter(row => row.variant_id === selected.variant.id && row.deleted_at === null);
      expect(activeSelectedLinks).toHaveLength(1);
      const persistedOwn = decodeLinkIdentity(activeSelectedLinks[0]);
      expect(persistedOwn).toEqual({ id: expect.any(String), variant_id: selected.variant.id, inventory_item_id: own.inventory_item_id, required_quantity: 4 });
      expect(persistedOwn.id).not.toBe(ownIdentity.id);
      const dismissedLink = persisted.variantInventoryItems.find(row => row.variant_id === selected.variant.id && row.inventory_item_id === inventory.inventory_item_id);
      expect(dismissedLink).toMatchObject({ variant_id: selected.variant.id, inventory_item_id: inventory.inventory_item_id, required_quantity: 5,
        deleted_at: expect.any(String) });
      expect(persisted.variantInventoryItems.filter(row => row.variant_id === other.variant.id)).toEqual(before.variantInventoryItems.filter(row => row.variant_id === other.variant.id));
      for (const key of ["products", "options", "optionValues", "variants", "variantOptions", "priceSets", "prices", "inventoryItems", "inventoryLevels", "reservations", "variantPriceSets"] as const)
        expect(persisted[key], `Inventory Link mutation changed ${key}`).toEqual(stocked[key]);
      fixture.start();
      const recreated = await nativeJson(fixture.get(`/admin/product-variants?id=${other.variant.id}`));
      expect(recreated).toMatchObject({ variants: [expect.objectContaining({ id: other.variant.id, product: expect.objectContaining({ id: other.product.id }),
        prices: [expect.objectContaining({ amount: other.amount, price_set_id: otherPrice.price_set_id, variant_id: other.variant.id })] })] });
      const reread = await nativeJson(fixture.get(`${root}/${selected.variant.id}?fields=id,product_id,*inventory_items`));
      expect(readLinks(reread.variant).inventory_items).toEqual([persistedOwn]);
      expect(await nativeJson(fixture.get(`/admin/product-variants?id=${selected.variant.id}&fields=id,manage_inventory,inventory_quantity`)))
        .toEqual({ variants: [{ id: selected.variant.id, manage_inventory: true, inventory_quantity: 5 }], count: 1, offset: 0, limit: 50 });
      await fixture.stop();
      expect(await fixture.observe()).toEqual(persisted);
    } catch (cause) { primary.push(cause); throw cause; }
    finally {
      try { await fixture.close(); }
      catch (cause) { throw new AggregateError([...primary, cause], "Variant Inventory Link DO proof cleanup failed"); }
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
