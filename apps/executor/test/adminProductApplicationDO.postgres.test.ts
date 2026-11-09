import { createCorePostgresFixture } from "@flarex/persistence-postgres/internal/system-test/core-persistence-fixture";
import { prepareProductRequestFixture, observeProductRequestFixture } from "@flarex/medusa-adapter/internal/system-test/product-request-fixture";
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
    const request = (input: unknown, options: Readonly<{ private?: boolean; admin?: string; path?: string; signal?: AbortSignal }>
      = { private: true, admin: adminCredential }) => {
      if (runtime === undefined) throw new Error("Native Product DO is closed");
      return runtime.dispatchFetch(`https://native-admin.test${options.path ?? path}`, { method: "POST",
        headers: { "content-type": "application/json", origin: "https://admin.test",
          ...(options.private === true ? { authorization: `Bearer ${privateToken}` } : {}),
          ...(options.admin === undefined ? {} : { "x-admin-fixture-token": options.admin }) }, body: JSON.stringify(input),
        ...(options.signal === undefined ? {} : { signal: options.signal }) });
    };
    const probeIncarnation = async () => {
      if (runtime === undefined) throw new Error("Native Product DO is closed");
      const response = await runtime.dispatchFetch("https://native-admin.test/__proof/incarnation", {
        headers: { authorization: `Bearer ${privateToken}` }, signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Incarnation probe returned HTTP ${response.status}`);
      return Schema.decodeUnknownSync(Schema.Struct({ incarnation: Schema.NonEmptyString }))(await response.json()).incarnation;
    };
    return { initial, catalog, start, stop, close, request, observe, probeIncarnation };
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
      expect((await request(productInput, { private: true, admin: adminCredential, path: "/admin/products" })).status).toBe(400);
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
