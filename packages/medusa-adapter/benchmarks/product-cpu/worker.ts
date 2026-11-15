import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { Effect, Schema } from "effect";
import { FlarexClient } from "../../../flarex/src/client";
import { makeFunctionReference } from "../../../flarex/src/api";
import { decodePublicInvokeRequestBodyEffect } from "flarex-protocol/invoke";
import { makeMemoryPhysical } from "./memory-persistence";
import { makeCoreProductCreationFixture, productCreationOptions, seedCreationEndpoints, seedCreationReferences } from "../../test/support/core-product-creation-fixture";
import { productCreationInput } from "../../test/support/core-product-creation-input";
import { prepareProductCreationWorkflow, ProductCreationOutput } from "../../src/workflows/product/creation";

const configuration = Schema.decodeUnknownSync(Schema.Struct({
  scenario: Schema.Literals(["minimal", "rich"]), transport: Schema.Literals(["direct", "client"]),
  samples: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 })),
  warmups: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10 })),
  diagnostic: Schema.Boolean, profilePath: Schema.optionalKey(Schema.String),
}))({ scenario: process.env.PRODUCT_CPU_SCENARIO ?? "rich", transport: process.env.PRODUCT_CPU_TRANSPORT ?? "direct",
  samples: Number(process.env.PRODUCT_CPU_SAMPLES ?? "16"), warmups: Number(process.env.PRODUCT_CPU_WARMUPS ?? "8"),
  diagnostic: process.env.PRODUCT_CPU_DIAGNOSTIC === "1",
  ...(process.env.PRODUCT_CPU_PROFILE === undefined ? {} : { profilePath: process.env.PRODUCT_CPU_PROFILE }) });
const decodeOutput = Schema.decodeUnknownSync(ProductCreationOutput);
// Observation projection of the native Product read, which does not embed
// cross-module Pricing fields present in the creation-workflow result.
const decodeCommitted = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({
  id: Schema.String, title: Schema.String, handle: Schema.String, status: Schema.String,
  images: Schema.Array(Schema.Struct({ url: Schema.String })),
  variants: Schema.Array(Schema.Struct({ id: Schema.String, sku: Schema.String, manage_inventory: Schema.Boolean })),
})));
const storage = makeMemoryPhysical();
const cleanup: Array<() => Promise<void>> = [];
const setupStart = performance.now();
let report;
try {
  const fixture = await makeCoreProductCreationFixture("pglite", close => cleanup.push(close), { physical: storage.physical });
  await seedCreationEndpoints(fixture);
  await seedCreationReferences(fixture);
  const host = await Effect.runPromise(prepareProductCreationWorkflow(productCreationOptions(fixture)));
  cleanup.push(() => Effect.runPromise(host.close));
  const before = await fixture.snapshot();
  const setupMs = performance.now() - setupStart;
  const reference = makeFunctionReference<"mutation">("benchmark:create-product");
  const invoke = (input: Parameters<typeof host.run>[1]) => Effect.runPromise(host.run(host.newRequestKey(), input));
  // Real client and protocol decoder over a benchmark-owned fetch bridge.
  // Backend authentication, function dispatch and network I/O are excluded.
  const client = new FlarexClient("https://cpu-benchmark.invalid", { fetch: async (url, init) => {
    const request = new Request(url, init);
    assert.equal(request.method, "POST"); assert.equal(new URL(request.url).pathname, "/invoke");
    const body = await Effect.runPromise(decodePublicInvokeRequestBodyEffect(await request.json()));
    assert.equal(body.path, "benchmark:create-product");
    assert.equal(body.partitionKey, "cpu-product-tenant");
    // Test-only adaptation of the typed API: run captures unknown input and
    // performs its authoritative workflow decode before any business call.
    // Do not predecode here: that would add a second workflow-input traversal.
    return Response.json({ value: await Effect.runPromise(host.run(host.newRequestKey(),
      body.args as Parameters<typeof host.run>[1])) });
  } });
  cleanup.push(async () => client.close());
  const run = configuration.transport === "client"
    ? (input: { products: readonly unknown[] }) => client.mutation(reference, input, { transport: "http", partitionKey: "cpu-product-tenant" })
    : invoke;
  const measurements = [];
  const expectedRows = configuration.scenario === "rich" ? 29 : 3;
  let profile: import("node:inspector/promises").Session | undefined;
  if (configuration.profilePath !== undefined) {
    const { Session } = await import("node:inspector/promises");
    profile = new Session(); profile.connect();
    await profile.post("Profiler.enable");
    await profile.post("Profiler.setSamplingInterval", { interval: 100 });
    cleanup.push(async () => profile?.disconnect());
  }
  for (let index = 0; index < configuration.samples + configuration.warmups; index++) {
    const prefix = `cpu-product-${index}`;
    const input = configuration.scenario === "rich" ? productCreationInput(prefix, 1)
      : { products: [{ id: prefix, title: "Small CPU Product " + index, handle: prefix,
        options: [{ title: "Default", values: ["Default"] }] }] };
    const measured = index >= configuration.warmups;
    for (const value of storage.instances.values()) value.measureBodies(configuration.diagnostic && measured);
    if (profile !== undefined && measured) await profile.post("Profiler.start");
    const cpu = process.cpuUsage(), thread = typeof process.threadCpuUsage === "function" ? process.threadCpuUsage() : undefined;
    const started = performance.now();
    const returned = await run(input);
    const wallMs = performance.now() - started;
    const threadElapsed = thread === undefined ? undefined : process.threadCpuUsage(thread);
    const elapsed = process.cpuUsage(cpu);
    const storageBodyCpuMs = [...storage.instances.values()].reduce((sum, value) => sum + value.bodyCpuUs, 0) / 1000;
    for (const value of storage.instances.values()) value.measureBodies(false);
    if (profile !== undefined && measured) {
      const capture = await profile.post("Profiler.stop");
      await writeFile(configuration.profilePath + `-${index - configuration.warmups}.cpuprofile`, JSON.stringify(capture.profile));
    }
    measurements.push({ phase: measured ? "measured" : "warmup", wallMs, cpuMs: (elapsed.user + elapsed.system) / 1000,
      threadCpuMs: threadElapsed === undefined ? null : (threadElapsed.user + threadElapsed.system) / 1000,
      ...(configuration.diagnostic && measured ? { storageBodyCpuMs } : {}) });
    const result = decodeOutput(returned), expected = input.products[0]; assert(expected !== undefined);
    assert.equal(result.length, 1); assert.equal(result[0]?.id, expected.id); assert.equal(result[0]?.title, expected.title);
    const committed = decodeCommitted(await Effect.runPromise(fixture.product.reads.read(fixture.product.runtime.commands.list,
      { filters: { id: [expected.id] }, config: { take: 1, relations: ["images", "variants"] } })));
    assert.equal(committed.length, 1); assert.equal(committed[0]?.id, expected.id); assert.equal(committed[0]?.title, expected.title);
    if (configuration.scenario === "rich") {
      assert.equal(committed[0]?.variants.length, 1); assert.equal(result[0]?.variants[0]?.id, prefix + "-variant-0");
      assert.equal(committed[0]?.status, "published");
      assert.deepEqual(committed[0]?.images.map(row => row.url).sort(), ["https://example.test/first.png", "https://example.test/second.png"]);
      assert.equal(committed[0]?.variants[0]?.sku, prefix + "-sku-0");
      assert.equal(committed[0]?.variants[0]?.manage_inventory, true);
    } else assert.equal(committed[0]?.variants.length, 0);
  }
  const after = await fixture.snapshot(), requests = measurements.length;
  assert.equal(after.rows.length - before.rows.length, expectedRows * requests);
  assert.equal(after.outcomes.length - before.outcomes.length, requests);
  assert.equal(after.families.length - before.families.length, requests);
  const events = after.events.slice(before.events.length), timestamps = new Set(events.map(event => event.timestamp));
  assert.equal(timestamps.size, requests);
  for (const timestamp of timestamps) {
    assert.equal(after.revisions.filter(row => row.timestamp === timestamp).length, expectedRows);
    assert.equal(after.outcomes.filter(row => row.timestamp === timestamp).length, 1);
    assert.equal(after.families.filter(row => row.timestamp === timestamp).length, 1);
    const messages = events.filter(event => event.timestamp === timestamp);
    assert.deepEqual(messages.filter(event => ["product-variant.created", "product.created"].includes(event.envelope.contract))
      .map(event => event.envelope.contract), configuration.scenario === "rich" ? ["product-variant.created", "product.created"] : ["product.created"]);
    if (configuration.scenario === "rich") for (const contract of ["LinkProductSalesChannel.attached", "LinkProductShippingProfile.attached",
      "LinkProductVariantInventoryItem.attached", "LinkProductVariantPriceSet.attached"])
      assert(messages.some(event => event.envelope.contract === contract));
  }
  report = { scenario: configuration.scenario, flow: "createProductsWorkflow", transport: configuration.transport,
    databaseEngines: false, runtime: process.versions, samples: configuration.samples, warmups: configuration.warmups,
    diagnostic: configuration.diagnostic, setupMs, measuredVerified: true, publicationVerified: true,
    businessRowsPerRequest: expectedRows, measurements,
    storage: [...storage.instances].map(([name, value]) => ({ name, calls: value.calls })) };
} finally {
  const failures: unknown[] = [];
  for (const close of cleanup.reverse()) try { await close(); } catch (cause) { failures.push(cause); }
  if (failures.length > 0) throw new AggregateError(failures, "CPU benchmark cleanup failed");
}
console.log(JSON.stringify({ ...report, disposed: true }));
