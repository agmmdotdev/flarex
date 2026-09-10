import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from "vitest";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema } from "effect";
import { deleteProductTagsWorkflow } from "@medusajs/core-flows/product/delete-product-tags";
import { prepareProductTagDeleteWorkflow, type ProductTagDeleteWorkflowHooks, type ProductTagDeleteResources } from "../src/product-tag-delete-workflow";
import { makeLocalProductCommands } from "../src/product-service";
import { prepareLocalProductProfile } from "../src/product-profile";
import { prepareCurrencyProfile } from "../src/currency-contract";
import { currencyCommands } from "../src/currency-service";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";
import { productLocalEventPolicy, productModuleEventPolicy } from "../src/product-local-events";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/atomicCommerce/host";
import { commerceHostFixture, type CommerceHostTestFixture } from "../../persistence-postgres/test/commerceHostFixture";
import { commerceInventory } from "../../persistence-postgres/test/commerceInventory";
import { createRelationalPGliteFixture } from "../../persistence-postgres/test/relationalPGliteWorkerTestSupport";
import { createMigratedPGlitePersistence } from "../../persistence-postgres/test/pgliteTestFixture";
import { createFileScopedPostgresFixture } from "../../persistence-postgres/test/postgresHelpers";
import { issueRelationalSession, makePostgresRelationalSession, runRelationalSession } from "../../persistence-postgres/src/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/relationalTransaction/model";
import { runEffect, runEffectFailure } from "../../persistence-postgres/test/effectTestRuntime";
import { fxSystemCommitEvents, fxSystemCommitEventDeliveries } from "../../persistence-postgres/src/commitEvents/schema";
import { commerceBindings } from "../../persistence-postgres/src/frameworkSchema/binding/model";
import { dataBindingActivationRequest } from "../../persistence-postgres/src/frameworkSchema/binding/host";
import { readAdmittedDataBinding } from "../../persistence-postgres/src/frameworkSchema/binding/selection";
import { prepareAtomicWorkflowHost, type AtomicWorkflowHostComposition } from "../src/workflow/host";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { ProductLifecycleIds } from "../src/product-lifecycle";
import { productTagDeletionEvents } from "../src/product-tag-workflow-events";

const cleanup: Array<() => Promise<void>> = [];
const driver = process.env.MEDUSA_COMPARISON_DRIVER ?? "pglite";
let product: CommerceHostTestFixture;
let control: CommerceHostTestFixture["persistence"];
let commands: Effect.Success<ReturnType<typeof makeLocalProductCommands>>;
let policy: ReturnType<typeof productModuleEventPolicy>;
let revision: string;
const subscribers = [{ id: "tag-deletions", revision: "a".repeat(64) }];
const args = (id: string) => ({ ids: [id] });
const execution = (session = product.session) => ({ identityAndAccessPolicy: product.hostInput.identityAndAccessPolicy,
  prepare: (composition: AtomicWorkflowHostComposition) => makeAtomicCommerceHost({ ...product.hostInput, session, ...composition }),
});
const options = (hooks?: ProductTagDeleteWorkflowHooks) => ({ execution: execution(), revision, subscribers,
  modules: { product: { module: commands.workflow, profile: product.prepared.profile, installation: product.installation, moduleEvents: policy } },
  ...(hooks === undefined ? {} : { hooks }),
});
const assemble = (hooks?: ProductTagDeleteWorkflowHooks) => runEffect(prepareProductTagDeleteWorkflow(options(hooks)));
const seed = (id: string) => runEffect(product.host.run(product.host.newRequestKey(), commands.commands.createTags, [{ id, value: id }]));
const inventory = async () => ({ data: await commerceInventory(product),
  events: await product.persistence.drizzle.select().from(fxSystemCommitEvents).orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal),
  deliveries: await product.persistence.drizzle.select().from(fxSystemCommitEventDeliveries).orderBy(fxSystemCommitEventDeliveries.commitSeq, fxSystemCommitEventDeliveries.eventOrdinal),
});

describe("Product-tag deletion with native completion results", () => {
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
    control = driver === "pglite" ? await createMigratedPGlitePersistence(register) : resource.persistence;
    commands = await runEffect(makeLocalProductCommands());
    const catalog = await runEffect(captureProductSchema("tag-delete-workflow").pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    product = await commerceHostFixture(resource.persistence, resource.session, prepareLocalProductProfile,
      [commands.commands.createTags, commands.commands.create, commands.commands.listTags, commands.commands.softDeleteTags], control,
      descriptor => productLocalEventPolicy(descriptor, catalog, () => Effect.void));
    policy = productModuleEventPolicy(product.descriptor, catalog);
  }, 150_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

  it("soft deletes tags without deleting Products or pivots and publishes one null outcome", async () => {
    expect(commerceBindings(product.candidate.frame)).toHaveLength(1);
    await seed("delete-live"); await seed("delete-keep");
    await runEffect(product.host.run(product.host.newRequestKey(), commands.commands.create,
      { id: "delete-product", title: "Linked product", handle: "delete-product", tags: [{ id: "delete-live" }, { id: "delete-keep" }] }));
    let hooks = 0;
    let escaped: ProductTagDeleteResources["product"]["softDeleteProductTags"] | undefined;
    const host = await assemble({ productTagsDeleted: async (input, { resources }) => {
      hooks++; escaped = resources.product.softDeleteProductTags;
      expect(input.ids).toEqual(["delete-live"]);
      const tags = await resources.query.graph({ entity: "product_tag", fields: ["id", "value"], filters: { id: ["delete-live", "delete-keep"] }, pagination: { take: 2 } });
      expect(tags.data).toEqual([{ id: "delete-keep", value: "delete-keep" }]);
      const graph = await resources.query.graph({ entity: "product", fields: ["id", "tags.id"], filters: { id: "delete-product" }, pagination: { take: 1 } });
      expect(graph.data).toEqual([{ id: "delete-product", tags: [{ id: "delete-keep" }] }]);
    } });
    const before = await inventory(); const key = host.newRequestKey();
    expect(before.data.tables.product_tag?.find(row => row.id === "delete-live")).toMatchObject({ deleted_at: null });
    const result = await runEffect(host.run(key, args("delete-live")));
    expectTypeOf(result).toEqualTypeOf<null>(); expect(result).toBeNull();
    const after = await inventory();
    const deletedTag = after.data.tables.product_tag?.find(row => row.id === "delete-live");
    // The physical inventory exposes each driver's raw timestamp representation.
    expect(deletedTag).toMatchObject({ value: "delete-live", deleted_at: driver === "pglite" ? expect.any(String) : expect.any(Date) });
    const deletedAt = deletedTag?.deleted_at;
    expect(Number.isFinite(typeof deletedAt === "string" ? Date.parse(deletedAt) : deletedAt instanceof Date ? deletedAt.getTime() : NaN)).toBe(true);
    for (const [table, rows] of Object.entries(before.data.tables)) if (table !== "product_tag") expect(after.data.tables[table]).toEqual(rows);
    expect(after.data.commits).toHaveLength(before.data.commits.length + 1);
    expect(after.data.outcomes).toHaveLength(before.data.outcomes.length + 1);
    expect(after.data.wakes).toHaveLength(before.data.wakes.length + 1);
    expect(after.data.facts.slice(before.data.facts.length).map(row => row.operation)).toEqual(["update"]);
    expect(after.events.slice(before.events.length).map(row => row.envelope.contract)).toEqual(["product.product-tag.deleted", "product-tag.deleted"]);
    expect(after.events.slice(before.events.length).map(row => row.eventOrdinal)).toEqual([0, 1]);
    expect(after.events.at(-1)?.envelope).toMatchObject({ group: key, message: { name: "product-tag.deleted", data: { id: "delete-live" }, metadata: { eventGroupId: key } } });
    expect(after.deliveries).toHaveLength(before.deliveries.length + 2);
    expect(await runEffect(host.run(key, args("delete-live")))).toBeNull();
    expect(hooks).toBe(1); expect(await inventory()).toEqual(after);
    await expect(escaped?.(["delete-keep"])).rejects.toMatchObject({ reason: "closed" });
    await runEffect(product.host.run(product.host.newRequestKey(), commands.commands.createTags, [{ id: "delete-reused", value: "delete-live" }]));
    expect((await inventory()).data.tables.product_tag?.filter(row => row.value === "delete-live")).toHaveLength(2);
  });

  it("preserves missing, already-deleted and empty requests without inventing row changes", async () => {
    const host = await assemble();
    for (const ids of [["delete-missing", "delete-live"], []]) {
      const before = await inventory(); const key = host.newRequestKey();
      expect(await runEffect(host.run(key, { ids }))).toBeNull();
      const after = await inventory();
      expect(after.data.tables).toEqual(before.data.tables); expect(after.data.facts).toEqual(before.data.facts);
      expect(after.events.slice(before.events.length).map(row => row.envelope.message)).toEqual(ids.map(id => ({ name: "product-tag.deleted", data: { id }, metadata: { eventGroupId: key } })));
      expect(await runEffect(host.run(key, { ids }))).toBeNull(); expect(await inventory()).toEqual(after);
    }
  });

  it("retains the real service result and rejects malformed or duplicate IDs atomically", async () => {
    await seed("delete-service");
    expect(await runEffect(product.host.run(product.host.newRequestKey(), commands.commands.softDeleteTags, ["delete-service"])))
      .toEqual({ product_tag_id: ["delete-service"] });
    expect(await runEffect(product.host.run(product.host.newRequestKey(), commands.commands.softDeleteTags, ["delete-service"]))).toEqual({});
    await seed("delete-invalid"); const host = await assemble(); const before = await inventory();
    for (const invalid of [["delete-invalid", "delete-invalid"], [""], ["x".repeat(257)], Array.from({ length: 257 }, (_, index) => "tag-" + index), "delete-invalid", null]) {
      const input = Object.defineProperty(args("delete-invalid"), "ids", { value: invalid });
      const exit = await runEffect(Effect.exit(host.run(host.newRequestKey(), input)));
      if (Exit.isSuccess(exit)) throw new Error("Expected invalid deletion input to fail");
      // The root retains both rollback-only state and the original typed cause.
      expect(exit.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error.reason === "invalidInput"), JSON.stringify(invalid)).toBe(true);
      expect(await inventory()).toEqual(before);
    }
    const extra = { ...args("delete-invalid"), additional_data: {} };
    expect(await runEffectFailure(host.run(host.newRequestKey(), extra))).toMatchObject({ reason: "invalidInput" });
    expect(await inventory()).toEqual(before);
  });

  it("refuses a void result against a non-null output schema and rolls back pending deletion", async () => {
    await seed("delete-output"); const before = await inventory();
    const resources = Result.getOrThrow(prepareWorkflowResources({ product: { module: commands.workflow, methods: ["softDeleteProductTags"], graph: true } }, true));
    const host = await runEffect(prepareAtomicWorkflowHost({ ...options(), workflow: {
      name: "wrongDeletionOutput", resources, prepared: Result.getOrThrow(deleteProductTagsWorkflow.prepare()),
      input: Schema.Struct({ ids: ProductLifecycleIds }), output: Schema.Array(Schema.Json),
      events: productTagDeletionEvents(commands.workflow.methods.softDeleteProductTags),
    } }));
    expect(await runEffectFailure(host.run(host.newRequestKey(), args("delete-output")))).toMatchObject({ reason: "storedCorruption" });
    expect(await inventory()).toEqual(before);
  });

  it("keeps hook failures, caught resource refusals and unaccounted calls fatal", async () => {
    await seed("delete-failure"); await seed("delete-extra"); const before = await inventory();
    const hooks: ProductTagDeleteWorkflowHooks[] = [
      { productTagsDeleted: () => { throw new Error("late deletion failure"); } },
      { productTagsDeleted: async (_input, { resources }) => { await resources.query.graph({ entity: "currency", fields: ["code"] }).catch(() => undefined); } },
      { productTagsDeleted: async (_input, { resources }) => { await resources.product.softDeleteProductTags([""]).catch(() => undefined); } },
      { productTagsDeleted: async (_input, { resources }) => { await resources.product.softDeleteProductTags(["delete-extra"]); } },
      { productTagsDeleted: async (_input, { container }) => { await container.resolve<{ restoreProductTags(ids: string[]): Promise<void> }>("product").restoreProductTags(["delete-failure"]).catch(() => undefined); } },
      { productTagsDeleted: async (_input, { container }) => { await container.resolve<{ deleteProductTags(ids: string[]): Promise<void> }>("product").deleteProductTags(["delete-failure"]).catch(() => undefined); } },
      { productTagsDeleted: async (_input, { resources }) => { for (let call = 0; call < 65; call++) await resources.query.graph({ entity: "product_tag", fields: ["id"], pagination: { take: 1 } }); } },
    ];
    for (const hook of hooks) {
      const host = await assemble(hook);
      expect(Exit.isFailure(await runEffect(Effect.exit(host.run(host.newRequestKey(), args("delete-failure")))))).toBe(true);
      expect(await inventory()).toEqual(before);
    }
  }, 40_000);

  it("refuses forged, extra, duplicate and wrong-group deletion events", async () => {
    await seed("delete-forged"); const before = await inventory();
    for (const kind of ["extra", "duplicate", "group", "name"] as const) {
      const host = await assemble({ productTagsDeleted: async (_input, { resources, eventGroupId }) => {
        await resources.event_bus.emit([{ name: kind === "name" ? "product-tag.restored" : "product-tag.deleted",
          data: { id: kind === "extra" ? "not-requested" : "delete-forged" }, metadata: { eventGroupId: kind === "group" ? "wrong" : eventGroupId } }]);
      } });
      expect(Exit.isFailure(await runEffect(Effect.exit(host.run(host.newRequestKey(), args("delete-forged")))))).toBe(true);
      expect(await inventory()).toEqual(before);
    }
  });

  it("drains cancellation and recovers lost acknowledgement without invoking compensation or the hook twice", async () => {
    await seed("delete-cancel");
    const reached = await runEffect(Deferred.make<void>());
    let release: (() => void) | undefined;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const cancelled = await assemble({ productTagsDeleted: async () => { await runEffect(Deferred.succeed(reached, undefined)); await wait; } });
    const before = await inventory();
    try {
      await runEffect(Effect.scoped(Effect.gen(function* () {
        const fiber = yield* Effect.forkScoped(cancelled.run(cancelled.newRequestKey(), args("delete-cancel")));
        yield* Deferred.await(reached).pipe(Effect.timeout(5000));
        yield* Fiber.interrupt(fiber);
      })));
    } finally { release?.(); }
    expect(await inventory()).toEqual(before);
    let lose = true; let calls = 0;
    const session = issueRelationalSession(product.persistence.drizzle, work => runRelationalSession(product.session, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => { if (!lose) return Effect.succeed(value); lose = false;
        return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: "lost deletion acknowledgement" })); }),
    ));
    const host = await runEffect(prepareProductTagDeleteWorkflow({ ...options({ productTagsDeleted: () => { calls++; } }), execution: execution(session) }));
    const key = host.newRequestKey(); expect(await runEffect(host.run(key, args("delete-cancel")))).toBeNull();
    expect(await runEffect(host.run(key, args("delete-cancel")))).toBeNull(); expect(calls).toBe(1);
    expect((await inventory()).events).toHaveLength(before.events.length + 2);
  });

  it.skipIf(driver !== "postgres")("keeps pending deletion invisible to another connection and settles duplicate requests once", async () => {
    await seed("delete-isolated"); let hooks = 0;
    const host = await assemble({ productTagsDeleted: async (_input, { resources }) => {
      hooks++;
      expect((await commerceInventory(product)).tables.product_tag?.find(row => row.id === "delete-isolated")?.deleted_at).toBeNull();
      expect((await resources.query.graph({ entity: "product_tag", fields: ["id"], filters: { id: "delete-isolated" }, pagination: { take: 1 } })).data).toEqual([]);
    } });
    const before = await inventory(); const key = host.newRequestKey();
    expect(await Promise.all([runEffect(host.run(key, args("delete-isolated"))), runEffect(host.run(key, args("delete-isolated")))])).toEqual([null, null]);
    expect(hooks).toBe(1); expect((await inventory()).data.commits).toHaveLength(before.data.commits.length + 1);
  });

  it("supports Product-only deletion beside Currency and preserves whole-binding replay authority", async () => {
    await seed("delete-coexisting"); const host = await assemble(); const key = host.newRequestKey();
    await runEffect(host.run(key, args("delete-coexisting")));
    const currency = await commerceHostFixture(product.persistence, product.session, prepareCurrencyProfile,
      [currencyCommands.retrieve], control, undefined, {}, product);
    const before = await inventory();
    expect(await runEffectFailure(host.run(key, args("delete-coexisting")))).toMatchObject({ reason: "requestConflict" });
    expect(await inventory()).toEqual(before);
    expect(await runEffect(host.run(host.newRequestKey(), args("delete-coexisting")))).toBeNull();
    const current = await runEffect(currency.bindings.withCurrent(readAdmittedDataBinding));
    const candidate = await runEffect(currency.bindings.prepare({ ...currency.candidate.frame,
      commerce: commerceBindings(currency.candidate.frame).filter(binding => binding.installation.installationSha256 === currency.installation.installation.installationSha256),
    }));
    await runEffect(currency.bindings.activate(dataBindingActivationRequest(candidate.frame.application.scopeId, candidate.frame.application.storageGeneration,
      "delete-remove-product", candidate.sha256, current.head)));
    expect(await runEffectFailure(host.run(host.newRequestKey(), args("delete-coexisting")))).toMatchObject({ reason: "bindingChanged" });
  }, 100_000);
});
