import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from "vitest";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema } from "effect";
import { createStep, createWorkflow, WorkflowResponse } from "@medusajs/workflows-sdk";
import { useQueryGraphStep } from "@medusajs/core-flows/common/use-query-graph";
import { batchVariantImagesWorkflow } from "@medusajs/core-flows/product/batch-variant-images";
import { ProductImage } from "@medusajs/product/models";
import { prepareVariantImagesWorkflow, variantImagesWorkflowEvents } from "../src/product-variant-images-workflow";
import { VariantImagesWorkflowInput } from "../src/product-variant-workflow-input";
import { makeLocalProductCommands } from "../src/product-service";
import { prepareLocalProductProfile } from "../src/product-profile";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";
import { productLocalEventPolicy, productModuleEventPolicy } from "../src/product-local-events";
import { prepareCurrencyProfile } from "../src/currency-contract";
import { currencyCommands, currencyWorkflowModule } from "../src/currency-service";
import { prepareAtomicWorkflowHost, type AtomicWorkflowHostComposition } from "../src/workflow/host";
import { prepareWorkflowResources } from "../src/workflow/resources";
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
import { fxSystemScopeClocks } from "../../persistence-postgres/src/schema";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";

const cleanup: Array<() => Promise<void>> = [];
const driver = process.env.MEDUSA_COMPARISON_DRIVER ?? "pglite";
let product: CommerceHostTestFixture;
let control: CommerceHostTestFixture["persistence"];
let commands: Effect.Success<ReturnType<typeof makeLocalProductCommands>>;
let policy: ReturnType<typeof productModuleEventPolicy>;
let revision: string;
const subscribers = [{ id: "variant-images", revision: "a".repeat(64) }];
const execution = (session = product.session) => ({ identityAndAccessPolicy: product.hostInput.identityAndAccessPolicy,
  prepare: (composition: AtomicWorkflowHostComposition) => makeAtomicCommerceHost({ ...product.hostInput, session, ...composition }),
});
const options = (moduleEvents = policy) => ({ execution: execution(), revision, subscribers,
  modules: { product: { module: commands.workflow, profile: product.prepared.profile, installation: product.installation, moduleEvents } },
});
const assemble = (moduleEvents = policy) => runEffect(prepareVariantImagesWorkflow(options(moduleEvents)));
const inventory = async () => ({ data: await commerceInventory(product),
  events: await product.persistence.drizzle.select().from(fxSystemCommitEvents).orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal),
  deliveries: await product.persistence.drizzle.select().from(fxSystemCommitEventDeliveries).orderBy(fxSystemCommitEventDeliveries.commitSeq, fxSystemCommitEventDeliveries.eventOrdinal),
});
async function seed(prefix: string, thumbnail: string | null = `${prefix}-old-url`) {
  await runEffect(product.host.run(product.host.newRequestKey(), commands.commands.create, {
    id: `${prefix}-product`, title: prefix, handle: prefix,
    images: [{ id: `${prefix}-old`, url: `${prefix}-old-url` }, { id: `${prefix}-new`, url: `${prefix}-new-url` }, { id: `${prefix}-general`, url: `${prefix}-general-url` }],
    variants: [{ id: `${prefix}-variant`, title: prefix, thumbnail }, { id: `${prefix}-other`, title: "other" }],
  }));
  await runEffect(product.host.run(product.host.newRequestKey(), commands.commands.addImageToVariant, [
    { variant_id: `${prefix}-variant`, image_id: `${prefix}-old` }, { variant_id: `${prefix}-other`, image_id: `${prefix}-new` },
  ]));
}
const args = (prefix: string) => ({ variant_id: `${prefix}-variant`, add: [`${prefix}-new`], remove: [`${prefix}-old`] });

describe("conditional Variant Image workflow on the native transaction", () => {
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
    const catalog = await runEffect(captureProductSchema("variant-image-workflow").pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    product = await commerceHostFixture(resource.persistence, resource.session, prepareLocalProductProfile,
      [commands.commands.create, commands.commands.addImageToVariant, commands.commands.removeImageFromVariant, commands.commands.listVariants], control,
      descriptor => productLocalEventPolicy(descriptor, catalog, () => Effect.void));
    policy = productModuleEventPolicy(product.descriptor, catalog);
  }, 150_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

  it("adds then removes assignments, clears the matching thumbnail and publishes exactly once", async () => {
    await seed("mixed"); const host = await assemble(); const key = host.newRequestKey(); const before = await inventory();
    const result = await runEffect(host.run(key, args("mixed")));
    expectTypeOf(result).toEqualTypeOf<{ readonly added: readonly string[]; readonly removed: readonly string[] }>();
    expect(result).toEqual({ added: ["mixed-new"], removed: ["mixed-old"] });
    const after = await inventory();
    expect(after.data.tables.product_variant_product_image?.filter(row => row.variant_id === "mixed-variant")).toMatchObject([{ image_id: "mixed-new" }]);
    expect(after.data.tables.product_variant?.find(row => row.id === "mixed-variant")).toMatchObject({ thumbnail: null });
    for (const [table, rows] of Object.entries(before.data.tables)) if (!["product_variant", "product_variant_product_image"].includes(table)) expect(after.data.tables[table]).toEqual(rows);
    expect(after.data.tables.product_variant?.filter(row => row.id !== "mixed-variant")).toEqual(before.data.tables.product_variant?.filter(row => row.id !== "mixed-variant"));
    expect(after.data.tables.product_variant_product_image?.filter(row => row.variant_id !== "mixed-variant")).toEqual(before.data.tables.product_variant_product_image?.filter(row => row.variant_id !== "mixed-variant"));
    expect(after.data.facts.slice(before.data.facts.length).map(row => [row.tableId, row.operation])).toEqual([
      ["product_variant_product_image", "insert"], ["product_variant_product_image", "delete"], ["product_variant", "update"],
    ]);
    expect(after.data.commits).toHaveLength(before.data.commits.length + 1);
    expect(after.data.outcomes).toHaveLength(before.data.outcomes.length + 1);
    expect(after.data.wakes).toHaveLength(before.data.wakes.length + 1);
    expect(after.events.slice(before.events.length).map(row => row.envelope)).toMatchObject([
      { contract: "product.product-variant.updated", internal: true, group: key, message: { data: { id: "mixed-variant" } } },
    ]);
    expect(after.deliveries).toHaveLength(before.deliveries.length + 1);
    const hydrated = await runEffect(product.host.read(commands.commands.listVariants, { filters: { id: "mixed-variant" }, config: { relations: ["images"] } }));
    // Removed assignments become general Product images in the pinned hydration.
    expect(hydrated).toMatchObject([{ id: "mixed-variant", images: expect.arrayContaining([
      expect.objectContaining({ id: "mixed-old" }), expect.objectContaining({ id: "mixed-new" }), expect.objectContaining({ id: "mixed-general" }),
    ]) }]);
    expect(await runEffect(host.run(key, args("mixed")))).toEqual(result); expect(await inventory()).toEqual(after);
  });

  it.each([null, "unrelated-url"])("retains a nonmatching thumbnail (%s) without inventing events", async thumbnail => {
    const prefix = thumbnail === null ? "null-thumb" : "different-thumb";
    await seed(prefix, thumbnail); const host = await assemble(); const before = await inventory();
    expect(await runEffect(host.run(host.newRequestKey(), { variant_id: `${prefix}-variant`, remove: [`${prefix}-old`] }))).toEqual({ added: [], removed: [`${prefix}-old`] });
    const after = await inventory();
    expect(after.data.tables.product_variant).toEqual(before.data.tables.product_variant);
    expect(after.data.facts.slice(before.data.facts.length).map(row => row.operation)).toEqual(["delete"]);
    expect(after.events).toEqual(before.events); expect(after.deliveries).toEqual(before.deliveries);
  });

  it("keeps add-only and existing-association service behavior and returns requested IDs", async () => {
    await seed("add"); const host = await assemble(); const before = await inventory();
    for (let repeat = 0; repeat < 2; repeat++) {
      expect(await runEffect(host.run(host.newRequestKey(), { variant_id: "add-variant", add: ["add-new"] }))).toEqual({ added: ["add-new"], removed: [] });
    }
    const after = await inventory();
    // The pinned assignment service creates rows; it is not an upsert by pair.
    expect(after.data.tables.product_variant_product_image?.filter(row => row.variant_id === "add-variant" && row.image_id === "add-new")).toHaveLength(2);
    expect(after.data.tables.product_variant).toEqual(before.data.tables.product_variant);
    expect(after.events).toEqual(before.events);
  });

  it("checks requested image URLs even when removal changes no association", async () => {
    await seed("noop", "noop-general-url"); const host = await assemble(); const before = await inventory();
    expect(await runEffect(host.run(host.newRequestKey(), { variant_id: "noop-variant", remove: ["noop-general", "missing-image"] })))
      .toEqual({ added: [], removed: ["noop-general", "missing-image"] });
    const after = await inventory();
    expect(after.data.tables.product_variant_product_image).toEqual(before.data.tables.product_variant_product_image);
    expect(after.data.tables.product_variant?.find(row => row.id === "noop-variant")).toMatchObject({ thumbnail: null });
    expect(after.data.facts.slice(before.data.facts.length).map(row => row.operation)).toEqual(["update"]);
    const beforeRepeat = await inventory();
    expect(await runEffect(host.run(host.newRequestKey(), { variant_id: "noop-variant", remove: ["missing-image"] }))).toEqual({ added: [], removed: ["missing-image"] });
    const repeated = await inventory(); expect(repeated.data.tables).toEqual(beforeRepeat.data.tables); expect(repeated.events).toEqual(beforeRepeat.events);
  });

  it("preserves the empty no-op and refuses invalid or missing mutation targets without publication", async () => {
    const host = await assemble(); const beforeEmpty = await inventory();
    expect(await runEffect(host.run(host.newRequestKey(), { variant_id: "missing-variant" }))).toEqual({ added: [], removed: [] });
    const afterEmpty = await inventory(); expect(afterEmpty.data.tables).toEqual(beforeEmpty.data.tables); expect(afterEmpty.events).toEqual(beforeEmpty.events);
    await seed("invalid"); const before = await inventory();
    for (const input of [
      { variant_id: "invalid-variant", add: ["invalid-new", "invalid-new"] },
      { variant_id: "invalid-variant", remove: ["invalid-old", "invalid-old"] },
      { variant_id: "invalid-variant", add: ["invalid-old"], remove: ["invalid-old"] },
      { variant_id: "", add: [] }, { variant_id: "x".repeat(257) }, { variant_id: "invalid-variant", add: [""] },
      { variant_id: "invalid-variant", remove: Array.from({ length: 257 }, (_, index) => `image-${index}`) },
      { variant_id: "invalid-variant", add: ["invalid-new"], extra: true },
      { variant_id: "missing-variant", remove: ["invalid-old"] },
      { variant_id: "missing-variant", add: ["invalid-new"] },
      { variant_id: "invalid-variant", add: ["invalid-new", "missing-image"], remove: ["invalid-old"] },
    ]) {
      expect(Exit.isFailure(await runEffect(Effect.exit(host.run(host.newRequestKey(), input)))), JSON.stringify(input)).toBe(true);
      expect(await inventory()).toEqual(before);
    }
  });

  it("rolls back the complete real workflow when final output validation fails", async () => {
    await seed("rollback"); const before = await inventory();
    const resources = Result.getOrThrow(prepareWorkflowResources({ product: { module: commands.workflow,
      methods: ["addImageToVariant", "removeImageFromVariant", "listProductVariants", "updateProductVariants"], graph: true,
    } }, true));
    const host = await runEffect(prepareAtomicWorkflowHost({ ...options(), workflow: { name: "invalidVariantImagesOutput", resources,
      prepared: Result.getOrThrow(batchVariantImagesWorkflow.prepare()), input: VariantImagesWorkflowInput, output: Schema.Null, events: variantImagesWorkflowEvents,
    } }));
    expect(await runEffectFailure(host.run(host.newRequestKey(), args("rollback")))).toMatchObject({ reason: "storedCorruption" });
    expect(await inventory()).toEqual(before);
  });

  it("keeps colliding foreign-scope images and variants out of graph reads and mutations", async () => {
    await seed("scoped");
    const clock = (await product.persistence.drizzle.select().from(fxSystemScopeClocks))[0];
    if (clock === undefined) throw new Error("Missing fixture clock");
    const uuid = "1d687ee5-82a0-45c9-b0dc-998353412742";
    await product.persistence.drizzle.insert(fxSystemScopeClocks).values({ scopeId: ScopeIdSchema.make("scope_" + uuid), storageGeneration: clock.storageGeneration, epoch: clock.epoch });
    const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
    // Intentional foreign-scope fixtures use only compiler-owned identifiers.
    const insert = async (tableId: string, row: Record<string, string>) => {
      const layout = product.descriptor.layout.frame;
      const table = layout.tables.find(table => table.identity.tableId === tableId);
      if (table === undefined) throw new Error("Missing fixture table");
      const columns = Object.keys(row).map(key => {
        const column = table.columns.find(column => column.identity.columnId === key);
        if (column === undefined) throw new Error("Missing fixture column");
        return quote(column.name);
      });
      await product.persistence.query(`insert into ${quote(layout.targetNamespace.schemaName)}.${quote(table.name)} (scope_uuid, ${columns.join(", ")})
        values ($1::uuid, ${columns.map((_, index) => "$" + (index + 2)).join(", ")})`, [uuid, ...Object.values(row)]);
    };
    await insert("product", { id: "scoped-product", title: "foreign", handle: "foreign" });
    await insert("product_variant", { id: "foreign-variant", title: "foreign", product_id: "scoped-product" });
    await insert(ProductImage.parse().tableName, { id: "foreign-image", url: "scoped-old-url", product_id: "scoped-product" });
    await insert(ProductImage.parse().tableName, { id: "scoped-old", url: "foreign-url", product_id: "scoped-product" });
    const host = await assemble(); const before = await inventory();
    for (const input of [{ variant_id: "scoped-variant", add: ["foreign-image"] }, { variant_id: "foreign-variant", remove: ["scoped-old"] }]) {
      expect(Exit.isFailure(await runEffect(Effect.exit(host.run(host.newRequestKey(), input))))).toBe(true);
      expect(await inventory()).toEqual(before);
    }
    await runEffect(host.run(host.newRequestKey(), { variant_id: "scoped-variant", remove: ["foreign-image"] }));
    const after = await inventory();
    expect(after.data.tables).toEqual(before.data.tables); expect(after.data.facts).toEqual(before.data.facts); expect(after.events).toEqual(before.events);
  });

  it("keeps extra graph arguments a sticky refusal even when the workflow catches it", async () => {
    await seed("extra-args"); const before = await inventory();
    const resources = Result.getOrThrow(prepareWorkflowResources({ product: { module: commands.workflow,
      methods: ["addImageToVariant"], graph: true,
    } }, false));
    const call = createStep("extra-args", resources.callback(async (_input: unknown, { resources }) => {
      await resources.product.addImageToVariant([{ variant_id: "extra-args-variant", image_id: "extra-args-new" }]);
      await Reflect.apply(resources.query.graph, undefined, [{ entity: "variant", fields: ["id"], pagination: { take: 1 } }, {}]).catch(() => undefined);
      return null;
    }));
    const flow = createWorkflow("caught-graph-options", () => new WorkflowResponse(call(undefined)));
    const { subscribers: _subscribers, ...base } = options();
    const host = await runEffect(prepareAtomicWorkflowHost({ ...base, workflow: { name: "caughtGraphOptions", resources,
      prepared: Result.getOrThrow(flow.prepare()), input: Schema.Null, output: Schema.Null,
    } }));
    const exit = await runEffect(Effect.exit(host.run(host.newRequestKey(), null)));
    if (Exit.isSuccess(exit)) throw new Error("Expected the caught graph refusal to fail the transaction");
    expect(exit.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error.reason === "unsupportedProfile")).toBe(true);
    expect(await inventory()).toEqual(before);
  });

  it("drains cancellation after mutation and recovers an uncertain commit without repeating the flow", async () => {
    await seed("cancel"); const before = await inventory();
    const reached = await runEffect(Deferred.make<void>());
    const cancelled = await assemble({ ...policy, validate: (...args) => policy.validate(...args).pipe(
      Effect.andThen(args[2] === "productUpdateVariantsBySelector"
        ? Deferred.succeed(reached, undefined).pipe(Effect.andThen(Effect.never)) : Effect.void),
    ) });
    await runEffect(Effect.scoped(Effect.gen(function* () {
      const fiber = yield* Effect.forkScoped(cancelled.run(cancelled.newRequestKey(), args("cancel")));
      yield* Deferred.await(reached).pipe(Effect.timeout(5000));
      yield* Fiber.interrupt(fiber);
    })));
    expect(await inventory()).toEqual(before);
    let lose = true, validations = 0;
    const session = issueRelationalSession(product.persistence.drizzle, work => runRelationalSession(product.session, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => { if (!lose) return Effect.succeed(value); lose = false;
        return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: "lost variant-image acknowledgement" })); }),
    ));
    const host = await runEffect(prepareVariantImagesWorkflow({ ...options({ ...policy,
      validate: (...args) => policy.validate(...args).pipe(Effect.tap(() => Effect.sync(() => { if (args[2] === "productUpdateVariantsBySelector") validations++; }))),
    }), execution: execution(session) }));
    const key = host.newRequestKey();
    expect(await runEffect(host.run(key, args("cancel")))).toEqual({ added: ["cancel-new"], removed: ["cancel-old"] });
    const after = await inventory(); expect(validations).toBe(1);
    await runEffect(host.run(key, args("cancel")));
    expect(validations).toBe(1); expect(await inventory()).toEqual(after);
    expect(after.data.commits).toHaveLength(before.data.commits.length + 1); expect(after.events).toHaveLength(before.events.length + 1);
  });

  it.skipIf(driver !== "postgres")("hides pending mutations from other connections and settles duplicate calls once", async () => {
    await seed("isolated"); const before = await inventory(); let observed = false;
    const host = await assemble({ ...policy, validate: (...args) => policy.validate(...args).pipe(Effect.andThen(args[2] === "productUpdateVariantsBySelector"
      ? Effect.promise(async () => { observed = true; expect(await inventory()).toEqual(before); }) : Effect.void)) });
    const key = host.newRequestKey();
    expect(await Promise.all([runEffect(host.run(key, args("isolated"))), runEffect(host.run(key, args("isolated")))]))
      .toEqual([{ added: ["isolated-new"], removed: ["isolated-old"] }, { added: ["isolated-new"], removed: ["isolated-old"] }]);
    expect(observed).toBe(true); const after = await inventory();
    expect(after.data.commits).toHaveLength(before.data.commits.length + 1); expect(after.events).toHaveLength(before.events.length + 1);
  });

  it("uses the same graph step for Currency and runs Product beside its installation", async () => {
    const currency = await commerceHostFixture(product.persistence, product.session, prepareCurrencyProfile, [currencyCommands.retrieve], control, undefined, {}, product);
    const module = Result.getOrThrow(currencyWorkflowModule);
    const resources = Result.getOrThrow(prepareWorkflowResources({ currency: { module, methods: [], graph: true } }, false));
    const flow = createWorkflow("currency-common-graph", () => new WorkflowResponse(useQueryGraphStep({ entity: "currency", fields: ["code", "name"], filters: { code: "usd" }, options: { isList: false } })));
    const host = await runEffect(prepareAtomicWorkflowHost({ execution: execution(), revision,
      modules: { currency: { module, profile: currency.prepared.profile, installation: currency.installation } },
      workflow: { name: "currencyCommonGraph", resources, prepared: Result.getOrThrow(flow.prepare()), input: Schema.Null, output: Schema.JsonObject },
    }));
    expect(await runEffect(host.run(host.newRequestKey(), null))).toMatchObject({ data: { code: "usd", name: "US Dollar" }, metadata: { count: 1, skip: 0, take: 256 } });
    await seed("coexisting"); const native = await assemble();
    expect(await runEffect(native.run(native.newRequestKey(), args("coexisting")))).toEqual({ added: ["coexisting-new"], removed: ["coexisting-old"] });
  }, 100_000);
});
