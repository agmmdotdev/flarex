import { afterAll, beforeAll, describe, expect, expectTypeOf, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { createStep, createWorkflow, WorkflowResponse, type WorkflowData, type PreparedWorkflow } from "@medusajs/workflows-sdk";
import { batchLinkProductsToCollectionWorkflow } from "@medusajs/core-flows/product/batch-link-products-collection";
import { batchLinkProductsToCategoryWorkflow } from "@medusajs/core-flows/product/batch-products-in-category";
import { prepareProductRelationshipsWorkflow, productRelationshipsWorkflow } from "../src/product-relationships-workflow";
import { ProductMembershipChange, ProductRelationshipsInput, ProductRelationshipsOutput } from "../src/product-relationship-workflow-input";
import { makeLocalProductCommands } from "../src/product-service";
import { prepareLocalProductWorkflowProfile, productWorkflowResources } from "../src/product-profile";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";
import { productLocalEventPolicy, productModuleEventPolicy } from "../src/product-local-events";
import { prepareWorkflowResources, type PreparedWorkflowResources } from "../src/workflow/resources";
import { prepareAtomicWorkflowHost, type AtomicWorkflowHostComposition } from "../src/workflow/host";
import { internalModuleWorkflowEvents } from "../src/workflow/events";
import { defineWorkflowMethod, defineWorkflowModule, workflowMethodDefinition, workflowModuleDefinition } from "../src/workflow/module";
import { commerceDecoder } from "../src/commerce-decoder";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/atomicCommerce/host";
import { commerceHostFixture, type CommerceHostTestFixture } from "../../persistence-postgres/test/commerceHostFixture";
import { commerceInventory } from "../../persistence-postgres/test/commerceInventory";
import { createRelationalPGliteFixture } from "../../persistence-postgres/test/relationalPGliteWorkerTestSupport";
import { createMigratedPGlitePersistence } from "../../persistence-postgres/test/pgliteTestFixture";
import { createFileScopedPostgresFixture } from "../../persistence-postgres/test/postgresHelpers";
import { makePostgresRelationalSession } from "../../persistence-postgres/src/relationalTransaction/session";
import { runEffect, runEffectFailure } from "../../persistence-postgres/test/effectTestRuntime";
import { fxSystemCommitEvents, fxSystemCommitEventDeliveries } from "../../persistence-postgres/src/commitEvents/schema";

const cleanup: Array<() => Promise<void>> = [];
const driver = process.env.MEDUSA_COMPARISON_DRIVER ?? "pglite";
let product: CommerceHostTestFixture;
let commands: Effect.Success<ReturnType<typeof makeLocalProductCommands>>;
let policy: ReturnType<typeof productModuleEventPolicy>;
let revision: string;
const subscribers = [{ id: "relationships", revision: "a".repeat(64) }];
const execution = (requestCallLimit: number | undefined) => ({ identityAndAccessPolicy: product.hostInput.identityAndAccessPolicy,
  prepare: (composition: AtomicWorkflowHostComposition) => makeAtomicCommerceHost({ ...product.hostInput, ...composition,
    ...(requestCallLimit === undefined ? {} : { requestCallLimit }) }),
});
const options = (module = commands.workflow) => ({ execution: execution(productWorkflowResources.calls), revision, subscribers,
  modules: { product: { module, profile: product.prepared.profile, installation: product.installation, moduleEvents: policy } },
});
const inventory = async () => ({ data: await commerceInventory(product),
  events: await product.persistence.drizzle.select().from(fxSystemCommitEvents).orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal),
  deliveries: await product.persistence.drizzle.select().from(fxSystemCommitEventDeliveries).orderBy(fxSystemCommitEventDeliveries.commitSeq, fxSystemCommitEventDeliveries.eventOrdinal),
});
const run = (command: typeof commands.commands.create, input: Schema.Json) => runEffect(product.host.run(product.host.newRequestKey(), command, input));
async function seed(prefix: string) {
  await run(commands.commands.createCategories, ["category", "keep", "other-category"].map(name => ({ id: `${prefix}-${name}`, name: `${prefix}-${name}` })));
  await run(commands.commands.createCollections, ["collection", "other-collection"].map(name => ({ id: `${prefix}-${name}`, title: `${prefix}-${name}` })));
  await run(commands.commands.create, ["one", "two", "three"].map((name, index) => ({
    id: `${prefix}-${name}`, title: `${prefix}-${name}`, handle: `${prefix}-${name}`,
    collection_id: `${prefix}-${index === 0 ? "other-collection" : "collection"}`,
    category_ids: [`${prefix}-keep`, ...(index === 1 ? [`${prefix}-category`] : [])],
  })));
}
const args = (prefix: string) => ({ collection: { id: `${prefix}-collection`, add: [`${prefix}-one`], remove: [`${prefix}-two`] },
  category: { id: `${prefix}-category`, add: [`${prefix}-one`], remove: [`${prefix}-two`] },
});
const selection = () => Result.getOrThrow(prepareWorkflowResources({ product: { module: commands.workflow,
  methods: ["listProducts", "retrieveProductCollection", "upsertProducts", "updateProductCollections"], graph: true,
} }, true));
const raw = async (after: (value: unknown) => unknown | Promise<unknown>, output: Schema.ConstraintDecoder<Schema.Json> = ProductRelationshipsOutput) => {
  const resources = selection();
  const definition = createWorkflow("relationship-observer", (input: WorkflowData<typeof ProductRelationshipsInput.Type>) => {
    const result = productRelationshipsWorkflow.runAsStep({ input });
    const observe = createStep("after-relationships", resources.callback(async (value: unknown) => { await after(value); return value; }));
    return new WorkflowResponse(observe(result));
  });
  return runEffect(prepareAtomicWorkflowHost({ ...options(), workflow: { name: "relationshipObserver", resources,
    prepared: Result.getOrThrow(definition.prepare()), input: ProductRelationshipsInput, output, events: internalModuleWorkflowEvents,
  } }));
};
const categoryIds = (value: typeof ProductRelationshipsOutput.Type, id: string) => value.products.find(row => row.id === id)?.categories.map(row => row.id).sort();
const standalone = <Resources>(name: string, resources: PreparedWorkflowResources<Resources>, prepared: PreparedWorkflow) =>
  runEffect(prepareAtomicWorkflowHost({ ...options(), execution: execution(undefined), workflow: { name, resources, prepared,
    input: ProductMembershipChange, output: Schema.Null, events: internalModuleWorkflowEvents,
  } }));

describe("Product relationship workflows on the native transaction", () => {
  beforeAll(async () => {
    const hash = createHash("sha256");
    for (const root of ["../src/", "../../medusa-workflows-sdk/src/", "../../medusa-core-flows/src/"]) {
      const directory = new URL(root, import.meta.url);
      for (const path of (await readdir(directory, { recursive: true })).filter(path => path.endsWith(".ts")).sort()) {
        hash.update(path); hash.update(await readFile(new URL(path.replaceAll("\\", "/"), directory)));
      }
    }
    hash.update(await readFile(new URL(import.meta.url))); revision = hash.digest("hex");
    const register = (close: () => Promise<void>) => { cleanup.push(close); };
    const resource = driver === "pglite" ? await createRelationalPGliteFixture({ registerCleanup: register }) : await (async () => {
      const fixture = await createFileScopedPostgresFixture(); register(fixture.dispose);
      return { persistence: fixture.persistence, session: makePostgresRelationalSession(fixture.persistence) };
    })();
    const control = driver === "pglite" ? await createMigratedPGlitePersistence(register) : resource.persistence;
    commands = await runEffect(makeLocalProductCommands());
    const catalog = await runEffect(captureProductSchema("relationship-workflows").pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    product = await commerceHostFixture(resource.persistence, resource.session, prepareLocalProductWorkflowProfile, Object.values(commands.commands), control,
      descriptor => productLocalEventPolicy(descriptor, catalog, () => Effect.void));
    policy = productModuleEventPolicy(product.descriptor, catalog);
  }, 150_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

  it("composes real children, reads pending memberships and commits both event families once", async () => {
    await seed("mixed"); const before = await inventory();
    const observed = vi.fn(async (value: unknown) => {
      expect(value).toMatchObject({ products: expect.arrayContaining([{ id: "mixed-one", collection_id: "mixed-collection", categories: expect.any(Array) }]) });
      if (driver === "postgres") expect(await inventory()).toEqual(before);
    });
    const host = await raw(observed); const key = host.newRequestKey(); const input = args("mixed"); const snapshot = structuredClone(input);
    const result = Result.getOrThrow(commerceDecoder(ProductRelationshipsOutput, "storedCorruption")(await runEffect(host.run(key, input))));
    expect(input).toEqual(snapshot);
    expect(categoryIds(result, "mixed-one")).toEqual(["mixed-category", "mixed-keep"]);
    expect(categoryIds(result, "mixed-two")).toEqual(["mixed-keep"]);
    expect(result.products.find(row => row.id === "mixed-two")?.collection_id).toBeNull();
    expect(result.collections[0]?.products.map(row => row.id).sort()).toEqual(["mixed-one", "mixed-three"]);
    const after = await inventory();
    expect(after.data.tables.product).toHaveLength(before.data.tables.product?.length ?? 0);
    expect(after.data.commits).toHaveLength(before.data.commits.length + 1);
    expect(after.data.outcomes).toHaveLength(before.data.outcomes.length + 1);
    expect(after.data.wakes).toHaveLength(before.data.wakes.length + 1);
    const events = after.events.slice(before.events.length);
    expect(events.every(row => row.envelope.internal && row.envelope.group === key)).toBe(true);
    expect(events.filter(row => row.envelope.contract === "product.product-collection.updated")).toHaveLength(1);
    expect(events.filter(row => row.envelope.contract === "product.product.updated")).toHaveLength(5);
    expect(events).toHaveLength(6);
    expect(after.deliveries).toHaveLength(before.deliveries.length + events.length);
    expect(new Set(events.map(row => row.commitSeq)).size).toBe(1);
    expect(after.data.facts.slice(before.data.facts.length).some(row => row.tableId === "product" && row.operation === "delete")).toBe(false);
    expect(await runEffect(host.run(key, input))).toEqual(result);
    expect(observed).toHaveBeenCalledTimes(1); expect(await inventory()).toEqual(after);
  }, 30_000);

  it("preserves the different overlap rules and clears memberships without deleting Products", async () => {
    await seed("overlap"); const host = await runEffect(prepareProductRelationshipsWorkflow(options()));
    const input = { collection: { id: "overlap-collection", add: ["overlap-two"], remove: ["overlap-two"] },
      category: { id: "overlap-category", add: ["overlap-two"], remove: ["overlap-two"] } };
    const result = await runEffect(host.run(host.newRequestKey(), input));
    expectTypeOf(result).toEqualTypeOf<typeof ProductRelationshipsOutput.Type>();
    expect(result.products[0]?.collection_id).toBe("overlap-collection");
    expect(categoryIds(result, "overlap-two")).toEqual(["overlap-keep"]);
    const cleared = await runEffect(host.run(host.newRequestKey(), { collection: { id: "overlap-collection", remove: ["overlap-two", "overlap-three"] }, category: { id: "overlap-category" } }));
    expect(cleared.collections[0]?.products).toEqual([]);
    expect(cleared.products).toHaveLength(2); expect(cleared.products.every(row => row.collection_id === null)).toBe(true);
  }, 30_000);

  it("keeps the default root budget and rolls back an exhausted composition without publishing", async () => {
    await seed("budget"); const before = await inventory();
    for (const requestCallLimit of [undefined, 64]) {
      const host = await runEffect(prepareProductRelationshipsWorkflow({ ...options(), execution: execution(requestCallLimit) }));
      const exit = await runEffect(Effect.exit(host.run(host.newRequestKey(), args("budget"))));
      expect(Exit.isFailure(exit)).toBe(true);
      if (!Exit.isFailure(exit)) throw new Error("Expected bounded root refusal");
      expect(exit.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error.reason === "limitExceeded")).toBe(true);
      expect(await inventory()).toEqual(before);
    }
    const host = await runEffect(prepareProductRelationshipsWorkflow(options())); const key = host.newRequestKey();
    await runEffect(host.run(key, args("budget"))); const committed = await inventory();
    const changed = await runEffect(prepareProductRelationshipsWorkflow({ ...options(), execution: execution(255) }));
    expect(await runEffectFailure(changed.run(key, args("budget")))).toMatchObject({ reason: "requestConflict" });
    expect(await inventory()).toEqual(committed);
  }, 30_000);

  it("preserves omitted/empty-list no-ops and the original missing-Product selector behavior", async () => {
    const host = await runEffect(prepareProductRelationshipsWorkflow(options())); const before = await inventory();
    expect(await runEffect(host.run(host.newRequestKey(), { collection: { id: "missing" }, category: { id: "missing", add: [], remove: [] } })))
      .toEqual({ products: [], collections: [] });
    const after = await inventory(); expect(after.data.tables).toEqual(before.data.tables); expect(after.events).toEqual(before.events);
    await seed("missing");
    const result = await runEffect(host.run(host.newRequestKey(), { collection: { id: "missing-collection", add: ["nonexistent"] }, category: { id: "missing-category", add: ["nonexistent"] } }));
    expect(result.products).toEqual([]); expect(result.collections[0]?.products.map(row => row.id).sort()).toEqual(["missing-three", "missing-two"]);
  }, 30_000);

  it("runs Collection alone with its full event set and Category alone with native null completion", async () => {
    await seed("alone");
    const collectionResources = Result.getOrThrow(prepareWorkflowResources({ product: { module: commands.workflow,
      methods: ["retrieveProductCollection", "updateProductCollections"], graph: false } }, true));
    const categoryResources = Result.getOrThrow(prepareWorkflowResources({ product: { module: commands.workflow,
      methods: ["listProducts", "upsertProducts"], graph: false } }, true));
    for (const [host, input] of [
      [await standalone("collectionOnly", collectionResources, Result.getOrThrow(batchLinkProductsToCollectionWorkflow.prepare())), args("alone").collection],
      [await standalone("categoryOnly", categoryResources, Result.getOrThrow(batchLinkProductsToCategoryWorkflow.prepare())), args("alone").category],
    ] as const) {
      expect(await runEffect(host.run(host.newRequestKey(), input))).toBeNull();
    }
  }, 30_000);

  it("reads every selected Product beyond the default page before a bounded membership update", async () => {
    const ids = Array.from({ length: 16 }, (_, index) => `page-product-${index.toString().padStart(2, "0")}`);
    await run(commands.commands.createCategories, { id: "page-category", name: "page-category" });
    await run(commands.commands.create, ids.map(id => ({ id, title: id, handle: id })));
    const host = await runEffect(prepareProductRelationshipsWorkflow(options()));
    const result = await runEffect(host.run(host.newRequestKey(), { collection: { id: "absent-page-collection" }, category: { id: "page-category", add: ids } }));
    expect(result.products.map(row => row.id).sort()).toEqual(ids);
    expect(result.products.every(row => row.categories.length === 1 && row.categories[0]?.id === "page-category")).toBe(true);
  }, 30_000);

  it("rolls back both children on a late failure, output refusal or missing category", async () => {
    await seed("failure"); const before = await inventory();
    const failAfterChildren = vi.fn(() => { throw new Error("late parent failure"); });
    const late = await raw(failAfterChildren);
    expect(Exit.isFailure(await runEffect(Effect.exit(late.run(late.newRequestKey(), args("failure")))))).toBe(true);
    expect(failAfterChildren).toHaveBeenCalledTimes(1);
    expect(await inventory()).toEqual(before);
    const reachOutput = vi.fn(); const badOutput = await raw(reachOutput, Schema.Null);
    expect(await runEffectFailure(badOutput.run(badOutput.newRequestKey(), args("failure")))).toMatchObject({ reason: "storedCorruption" });
    expect(reachOutput).toHaveBeenCalledTimes(1); expect(await inventory()).toEqual(before);
    const host = await runEffect(prepareProductRelationshipsWorkflow(options()));
    expect(Exit.isFailure(await runEffect(Effect.exit(host.run(host.newRequestKey(), { ...args("failure"), category: { id: "absent-failure-category", add: ["failure-one"] } }))))).toBe(true);
    expect(await inventory()).toEqual(before);
    expect(Exit.isFailure(await runEffect(Effect.exit(host.run(host.newRequestKey(), { ...args("failure"), collection: { id: "absent-failure-collection", add: ["failure-one"] } }))))).toBe(true);
    expect(await inventory()).toEqual(before);
  }, 30_000);

  it("rejects malformed input and relation-only method widening without publication", async () => {
    await seed("invalid"); const host = await runEffect(prepareProductRelationshipsWorkflow(options())); const before = await inventory();
    for (const value of [null, { ...args("invalid"), scopeId: "foreign" }, { ...args("invalid"), collection: { id: "invalid-collection", add: [12] } },
      { ...args("invalid"), category: { id: "invalid-category", add: Array.from({ length: 257 }, () => "invalid-one") } }]) {
      // @ts-expect-error deliberately malformed external request exercises runtime validation
      expect(Exit.isFailure(await runEffect(Effect.exit(host.run(host.newRequestKey(), value))))).toBe(true);
    }
    const method = workflowMethodDefinition(commands.workflow.methods.upsertProducts);
    if (method === undefined) throw new Error("Missing method registration");
    for (const value of [[[ { title: "not-authorized" } ]], [[{ id: "invalid-one", title: "not-authorized" }]]]) {
      expect(Result.isFailure(method.input(value))).toBe(true);
    }
    expect(await inventory()).toEqual(before);
  });

  it("binds each method event association into replay and refuses an incomplete Collection set", async () => {
    await seed("identity"); const host = await runEffect(prepareProductRelationshipsWorkflow(options())); const key = host.newRequestKey();
    await runEffect(host.run(key, args("identity"))); const before = await inventory();
    const original = workflowMethodDefinition(commands.workflow.methods.updateProductCollections);
    const source = workflowModuleDefinition(commands.workflow);
    if (original === undefined || source === undefined) throw new Error("Missing authentic method metadata");
    const narrowed = Result.getOrThrow(defineWorkflowMethod({ command: original.command, arguments: commerceDecoder(Schema.Array(Schema.Json), "invalidInput"),
      encode: value => Result.getOrThrow(original.input(value)), output: original.output, moduleEvents: ["product.product-collection.updated"],
    }));
    // Preserve the inferred method contract through its exact existing decoder.
    const replacement = Result.getOrThrow(defineWorkflowModule({ name: "product", source: source.source,
      methods: { ...commands.workflow.methods, updateProductCollections: narrowed }, graph: source.graph }));
    const allResources = Result.getOrThrow(prepareWorkflowResources({ product: { module: replacement,
      methods: ["listProducts", "retrieveProductCollection", "upsertProducts", "updateProductCollections"], graph: true } }, true));
    const changed = await runEffect(prepareAtomicWorkflowHost({ ...options(), modules: { product: { ...options().modules.product, module: replacement } }, workflow: {
      name: "productRelationships", resources: allResources, prepared: Result.getOrThrow(productRelationshipsWorkflow.prepare()),
      input: ProductRelationshipsInput, output: ProductRelationshipsOutput, events: internalModuleWorkflowEvents,
    } }));
    expect(await runEffectFailure(changed.run(key, args("identity")))).toMatchObject({ reason: "requestConflict" });
    const resources = Result.getOrThrow(prepareWorkflowResources({ product: { module: replacement, methods: ["retrieveProductCollection", "updateProductCollections"], graph: false } }, true));
    const standalone = await runEffect(prepareAtomicWorkflowHost({ ...options(), modules: { product: { ...options().modules.product, module: replacement } },
      workflow: { name: "incompleteCollection", resources, prepared: Result.getOrThrow(batchLinkProductsToCollectionWorkflow.prepare()), input: ProductMembershipChange, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    expect(Exit.isFailure(await runEffect(Effect.exit(standalone.run(standalone.newRequestKey(), { id: "identity-collection", remove: ["identity-one"] }))))).toBe(true);
    expect(await inventory()).toEqual(before);
  }, 30_000);

  it.skipIf(driver !== "postgres")("serializes competing membership updates and preserves both committed additions", async () => {
    await seed("competing");
    let release: () => void = () => undefined, reached: () => void = () => undefined;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { reached = resolve; });
    const first = await raw(async () => { reached(); await waiting; });
    const second = await runEffect(prepareProductRelationshipsWorkflow(options()));
    const firstRun = runEffect(first.run(first.newRequestKey(), { collection: { id: "competing-collection", add: ["competing-one"] }, category: { id: "competing-category", add: ["competing-one"] } }));
    let secondRun: Promise<unknown> | undefined;
    try {
      await Promise.race([entered, firstRun]);
      secondRun = runEffect(second.run(second.newRequestKey(), { collection: { id: "competing-collection", add: ["competing-two"] }, category: { id: "competing-other-category", add: ["competing-one"] } }));
      await expect.poll(async () => {
        const result = await product.persistence.query<{ blocked: number }>("select count(*)::int as blocked from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query ilike '%fx_system_scope_clock%' and cardinality(pg_blocking_pids(pid)) > 0");
        return result.rows[0]?.blocked;
      }, { interval: 5, timeout: 400 }).toBeGreaterThan(0);
    } finally { release(); await Promise.allSettled([firstRun, ...(secondRun === undefined ? [] : [secondRun])]); }
    await firstRun; await secondRun;
    const result = await runEffect(second.run(second.newRequestKey(), { collection: { id: "competing-collection" }, category: { id: "competing-category", remove: ["not-present"] } }));
    expect(result.collections[0]?.products.map(row => row.id).sort()).toEqual(["competing-one", "competing-three", "competing-two"]);
    const read = await runEffect(product.host.read(commands.commands.retrieve, { id: "competing-one", config: { select: ["id", "categories.id"], relations: ["categories"] } }));
    expect(read).toMatchObject({ categories: expect.arrayContaining([{ id: "competing-category" }, { id: "competing-other-category" }, { id: "competing-keep" }]) });
  }, 30_000);
});
