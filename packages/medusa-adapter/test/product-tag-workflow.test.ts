import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { expireEventClaims, makeEventRetriesDue, corruptEventCount, replaceEventEnvelope, explainSparseEventDirectory } from "../../persistence-postgres/test/commitEventTestSupport";
import { Deferred, Effect, Exit, Fiber, Option, Result, Schema } from "effect";
import { createStep, createWorkflow, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import type { Json } from "flarex-protocol/json";
import { prepareProductTagWorkflow, type ProductTagWorkflowHooks } from "../src/product-tag-workflow";
import { prepareCurrencyProfile } from "../src/currency-contract";
import { currencyCommands, currencyWorkflowModule } from "../src/currency-service";
import { makeLocalProductCommands } from "../src/product-service";
import { prepareLocalProductProfile } from "../src/product-profile";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";
import { productLocalEventPolicy, productModuleEventPolicy } from "../src/product-local-events";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/atomicCommerce/host";
import { commerceHostFixture, type CommerceHostTestFixture } from "../../persistence-postgres/test/commerceHostFixture";
import { commerceInventory, expireCommerceResult, compactCommerceHistory } from "../../persistence-postgres/test/commerceInventory";
import { createRelationalPGliteFixture } from "../../persistence-postgres/test/relationalPGliteWorkerTestSupport";
import { createMigratedPGlitePersistence } from "../../persistence-postgres/test/pgliteTestFixture";
import { createFileScopedPostgresFixture } from "../../persistence-postgres/test/postgresHelpers";
import { issueRelationalSession, makePostgresRelationalSession, runRelationalSession } from "../../persistence-postgres/src/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/relationalTransaction/model";
import { runEffect, runEffectFailure } from "../../persistence-postgres/test/effectTestRuntime";
import { makeCommitEventPump, type CommitEventHandler } from "../../persistence-postgres/src/commitEvents/pump";
import { makeCommitEventStore, type CommitEventQuery } from "../../persistence-postgres/src/commitEvents/store";
import { CommitEventSubscriberFailure, type CommitEventMessage } from "../../persistence-postgres/src/commitEvents/model";
import { fxSystemCommitEvents, fxSystemCommitEventDeliveries } from "../../persistence-postgres/src/commitEvents/schema";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { prepareAtomicWorkflowHost } from "../src/workflow/host";
import { commerceDecoder } from "../src/commerce-decoder";
import { defineWorkflowMethod, defineWorkflowModule, workflowModuleDefinition } from "../src/workflow/module";

const cleanup: Array<() => Promise<void>> = [];
const driver = process.env.MEDUSA_COMPARISON_DRIVER ?? "pglite";
let currency: CommerceHostTestFixture;
let product: CommerceHostTestFixture;
let policy: ReturnType<typeof productModuleEventPolicy>;
let productCommands: Effect.Success<ReturnType<typeof makeLocalProductCommands>>;
let revision: string;
const subscribers = [{ id: "tags-index", revision: "a".repeat(64) }, { id: "tags-audit", revision: "b".repeat(64) }];
const args = (value: string) => ({ product_tags: [{ value }], additional_data: { witness: value } });
const inventory = async () => ({ product: await commerceInventory(product),
  events: await product.persistence.drizzle.select().from(fxSystemCommitEvents).orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal),
  deliveries: await product.persistence.drizzle.select().from(fxSystemCommitEventDeliveries).orderBy(fxSystemCommitEventDeliveries.commitSeq, fxSystemCommitEventDeliveries.eventOrdinal, fxSystemCommitEventDeliveries.subscriberId),
});
const execution = (session = currency.session) => ({
  identityAndAccessPolicy: currency.hostInput.identityAndAccessPolicy,
  prepare: (composition: import("../src/workflow/host").AtomicWorkflowHostComposition) => makeAtomicCommerceHost({ ...currency.hostInput, session, ...composition }),
});
const installedModules = () => ({
  product: { module: productCommands.workflow, profile: product.prepared.profile, installation: product.installation, moduleEvents: policy },
  currency: { module: Result.getOrThrow(currencyWorkflowModule), profile: currency.prepared.profile, installation: currency.installation },
});
const assemble = async (hooks?: ProductTagWorkflowHooks, suffix = "standard") => {
  const input = { execution: execution(), modules: installedModules(), revision: createHash("sha256").update(revision).update(suffix).digest("hex"),
    subscribers, ...(hooks === undefined ? {} : { hooks }) };
  return { input, host: await runEffect(prepareProductTagWorkflow(input)) };
};
const handlers = (messages: CommitEventMessage[]): CommitEventHandler[] => subscribers.map(subscriber => ({ ...subscriber,
  handle: message => Effect.sync(() => { messages.push(message); }),
}));

describe("native Medusa Product-tag workflow and committed events", () => {
  beforeAll(async () => {
    // A trusted test bundle hashes its actual authoring and execution sources,
    // including this file's hook bodies; names and Function.toString are not revisions.
    const paths = ["product-tag-workflow.ts", "product-tag-workflow-events.ts", "workflow-runtime.ts", "workflow-value.ts", "product-workflow-module.ts", "product-service.ts", "currency-service.ts", "product-local-events.ts", "commerce-checked-value.ts", "local-graph/query.ts"];
    for (const name of (await readdir(new URL("../src/workflow/", import.meta.url))).sort()) if (name.endsWith(".ts")) paths.push("workflow/" + name);
    const sources = await Promise.all(paths.map(path => readFile(new URL(`../src/${path}`, import.meta.url))));
    for (const path of ["definition", "references", "responses", "model", "runtime", "orchestrator-builder"]) sources.push(await readFile(new URL(`../../medusa-workflows-sdk/src/${path}.ts`, import.meta.url)));
    for (const path of ["product/workflows/create-product-tags", "product/steps/create-product-tags", "common/steps/emit-event", "events"]) sources.push(await readFile(new URL(`../../medusa-core-flows/src/${path}.ts`, import.meta.url)));
    sources.push(await readFile(new URL(import.meta.url)));
    const hash = createHash("sha256"); for (const source of sources) hash.update(source);
    revision = hash.digest("hex");
    const register = (close: () => Promise<void>) => { cleanup.push(close); };
    const resource = driver === "pglite" ? await createRelationalPGliteFixture({ registerCleanup: register }) : await (async () => {
      const fixture = await createFileScopedPostgresFixture(); register(fixture.dispose);
      return { persistence: fixture.persistence, session: makePostgresRelationalSession(fixture.persistence) };
    })();
    const control = driver === "pglite" ? await createMigratedPGlitePersistence(register) : resource.persistence;
    productCommands = await runEffect(makeLocalProductCommands());
    const catalog = await runEffect(captureProductSchema("workflow-events").pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    currency = await commerceHostFixture(resource.persistence, resource.session, prepareCurrencyProfile, [currencyCommands.retrieve], control);
    product = await commerceHostFixture(resource.persistence, resource.session, prepareLocalProductProfile, [productCommands.commands.createTags], control,
      descriptor => productLocalEventPolicy(descriptor, catalog, () => Effect.void), {}, currency);
    policy = productModuleEventPolicy(product.descriptor, catalog);
  }, 150_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

  it("executes the original business sequence with pending graph reads, both event families and one root commit", async () => {
    let hookCalls = 0;
    const workflow = await assemble({ productTagsCreated: async (input, { resources }) => {
      hookCalls++;
      expect(input.additional_data).toEqual({ witness: "workflow-created" });
      const query = resources.query;
      const tags = await query.graph({ entity: "product_tag", fields: ["id", "value"], filters: { id: input.product_tags.map(tag => tag.id) }, pagination: { take: 1 } });
      expect(tags).toMatchObject({ data: [{ value: "workflow-created" }] });
      const currencies = await query.graph({ entity: "currency", fields: ["code"], filters: { code: "usd" }, pagination: { take: 1 } });
      expect(currencies).toMatchObject({ data: [{ code: "usd" }] });
      // Ordinary PostgreSQL uses another connection here. Pending rows visible
      // through the hook's graph must remain invisible to a future subscriber.
      if (driver === "postgres") expect(await inventory()).toEqual(before);
    } }, "graph-hook");
    const before = await inventory();
    const key = workflow.host.newRequestKey();
    const result = await runEffect(workflow.host.run(key, args("workflow-created")));
    expect(result).toMatchObject([{ value: "workflow-created" }]);
    const after = await inventory();
    expect(after.product.commits).toHaveLength(before.product.commits.length + 1);
    expect(after.events.slice(before.events.length).map(row => row.envelope.contract)).toEqual(["product.product-tag.created", "product-tag.created"]);
    expect(after.events.slice(before.events.length).map(row => row.eventOrdinal)).toEqual([0, 1]);
    expect(after.events.slice(before.events.length).map(row => row.envelope.internal)).toEqual([true, false]);
    expect(after.events.at(-1)?.envelope).toMatchObject({ group: key, message: { name: "product-tag.created", metadata: { eventGroupId: key } }, subscribers });
    expect(after.product.commits.at(-1)?.eventCount).toBe(2);
    expect(new Set(after.events.slice(before.events.length).map(row => row.commitSeq)).size).toBe(1);
    expect(after.deliveries.slice(before.deliveries.length)).toHaveLength(4);
    expect(after.deliveries.every(row => row.state === "pending")).toBe(true);
    expect(await runEffect(workflow.host.run(key, args("workflow-created")))).toEqual(result);
    expect(hookCalls).toBe(1);
    expect(await inventory()).toEqual(after);
    const changed = await assemble(undefined, "changed-bundle");
    expect(await runEffectFailure(changed.host.run(key, args("workflow-created")))).toMatchObject({ reason: "requestConflict" });
  }, 30_000);

  it("rolls back module rows and both event families when the hook fails", async () => {
    const workflow = await assemble({ productTagsCreated: async (input, { container }) => {
      const query = container.resolve<{ graph: (input: Json) => Promise<Json> }>("query");
      expect(await query.graph({ entity: "product_tag", fields: ["value"], pagination: { take: 256 } })).toMatchObject({ data: expect.arrayContaining([{ value: input.product_tags[0]?.value }]) });
      throw new Error("Hook failed after pending reads");
    } }, "failure-hook");
    const before = await inventory();
    expect(Exit.isFailure(await runEffect(Effect.exit(workflow.host.run(workflow.host.newRequestKey(), args("workflow-failed")))))).toBe(true);
    expect(await inventory()).toEqual(before);
  }, 30_000);

  it("keeps a caught unsupported-resource refusal fatal and revokes escaped services", async () => {
    let escaped: { graph: (value: Json) => Promise<Json> } | undefined;
    const workflow = await assemble({ productTagsCreated: async (_input, { container }) => {
      escaped = container.resolve("query");
      try { container.resolve("transactionManager"); } catch { /* user callback swallows a refusal */ }
    } }, "caught-hook");
    const before = await inventory();
    expect(Exit.isFailure(await runEffect(Effect.exit(workflow.host.run(workflow.host.newRequestKey(), args("caught-hook")))))).toBe(true);
    await expect(escaped?.graph({ entity: "currency", fields: ["code"], pagination: { take: 1 } })).rejects.toMatchObject({ reason: "closed" });
    expect(await inventory()).toEqual(before);
  }, 30_000);

  it("cancels a pending hook without committing and releases its scoped runners", async () => {
    const reached = await runEffect(Deferred.make<void>());
    let release: (() => void) | undefined;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const workflow = await assemble({ productTagsCreated: async () => { await runEffect(Deferred.succeed(reached, undefined)); await waiting; } }, "cancel-hook");
    const before = await inventory();
    await runEffect(Effect.scoped(Effect.gen(function* () {
      const fiber = yield* Effect.forkScoped(workflow.host.run(workflow.host.newRequestKey(), args("cancel-hook")));
      yield* Deferred.await(reached).pipe(Effect.timeout(5000));
      yield* Fiber.interrupt(fiber);
    })));
    release?.();
    expect(await inventory()).toEqual(before);
  }, 30_000);

  it("recovers a lost commit acknowledgement and emits nothing for empty input", async () => {
    let hookCalls = 0;
    const workflow = await assemble({ productTagsCreated: async () => { hookCalls++; } }, "recovery-hook");
    let lose = true;
    const session = issueRelationalSession(currency.persistence.drizzle, work => runRelationalSession(currency.session, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => { if (!lose) return Effect.succeed(value); lose = false;
        return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: "test lost acknowledgement" })); }),
    ));
    const host = await runEffect(prepareProductTagWorkflow({ ...workflow.input, execution: execution(session) }));
    const before = await inventory();
    const key = host.newRequestKey();
    const result = await runEffect(host.run(key, args("recover-workflow")));
    expect(result).toMatchObject([{ value: "recover-workflow" }]);
    expect(hookCalls).toBe(1);
    expect((await inventory()).events).toHaveLength(before.events.length + 2);
    expect(await runEffect(host.run(key, args("recover-workflow")))).toEqual(result);
    expect(hookCalls).toBe(1);
    const empty = await assemble();
    const count = (await inventory()).events.length;
    expect(await runEffect(empty.host.run(empty.host.newRequestKey(), { product_tags: [] }))).toEqual([]);
    expect((await inventory()).events).toHaveLength(count);
  }, 30_000);

  it("rolls back failures at event, delivery, result, wake and clock publication", async () => {
    const workflow = await assemble();
    const before = await inventory();
    for (const table of ["fx_system_commit_event", "fx_system_commit_event_delivery", "fx_system_idempotency", "fx_system_outbox", "fx_system_scope_clock"]) {
      await product.persistence.exec("create function fx_test_workflow_failure() returns trigger language plpgsql as $$ begin raise exception 'workflow publication failure'; end $$");
      try {
        await product.persistence.exec(`create trigger fx_test_workflow_failure before ${table === "fx_system_scope_clock" ? "update" : "insert"} on "${table}" for each row execute function fx_test_workflow_failure()`);
        expect(Exit.isFailure(await runEffect(Effect.exit(workflow.host.run(workflow.host.newRequestKey(), args("publication-failed")))))).toBe(true);
        expect(await inventory()).toEqual(before);
      } finally {
        await product.persistence.exec(`drop trigger if exists fx_test_workflow_failure on "${table}"`);
        await product.persistence.exec("drop function fx_test_workflow_failure()");
      }
    }
  }, 60_000);

  it("repairs delivery from committed storage after host restart and result expiry", async () => {
    const workflow = await assemble();
    const key = workflow.host.newRequestKey();
    const value = await runEffect(workflow.host.run(key, args("restart-delivery")));
    await expireCommerceResult(product, key);
    const messages: CommitEventMessage[] = [];
    const pump = await runEffect(makeCommitEventPump(currency.hostInput, handlers(messages)));
    let cursor = 0n;
    for (let page = 0; page < 20; page++) {
      const result = await runEffect(pump.runNext(cursor)); cursor = result.cursor;
      if (result.done) break;
      if (page === 19) throw new Error("Event scan failed to terminate");
    }
    expect(messages.some(message => message.envelope.group === key)).toBe(true);
    expect(messages.filter(message => message.envelope.group === key)).toHaveLength(4);
    expect(new Set(messages.map(message => message.deliveryId)).size).toBe(messages.length);
    expect((await inventory()).deliveries.every(row => row.state === "delivered")).toBe(true);
    expect(await runEffectFailure(workflow.host.run(key, args("restart-delivery")))).toMatchObject({ reason: "resultUnavailable" });
    expect(value).toMatchObject([{ value: "restart-delivery" }]);
  }, 60_000);

  it("recovers a lost delivery acknowledgement with stable identity and fenced settlement", async () => {
    const workflow = await assemble();
    await runEffect(workflow.host.run(workflow.host.newRequestKey(), args("claim-fence")));
    const commit = (await inventory()).product.commits.at(-1);
    if (commit === undefined) throw new Error("Missing event commit");
    const store = await runEffect(makeCommitEventStore(currency.hostInput));
    const first = await runEffect(store.claim(commit.commitSeq, subscribers));
    if (Option.isNone(first)) throw new Error("Missing claim");
    // Handler succeeded but acknowledgement was lost. Only the lease changes;
    // the immutable event family and pinned handler identities remain intact.
    await expireEventClaims(product.persistence.drizzle, commit.commitSeq);
    const restarted = await runEffect(makeCommitEventStore(currency.hostInput));
    const second = await runEffect(restarted.claim(commit.commitSeq, subscribers));
    if (Option.isNone(second)) throw new Error("Missing recovered claim");
    expect(second.value.message.deliveryId).toBe(first.value.message.deliveryId);
    expect(await runEffectFailure(store.settle(first.value))).toMatchObject({ reason: "staleClaim" });
    await runEffect(restarted.settle(second.value));
    const rows = (await inventory()).deliveries.filter(row => row.commitSeq === commit.commitSeq && row.state === "delivered");
    expect(rows).toHaveLength(1); expect(rows[0]?.attempts).toBe(2);
  }, 30_000);

  it("keeps acknowledged subscribers independent and persists bounded failures without compensating writes", async () => {
    const workflow = await assemble();
    const key = workflow.host.newRequestKey();
    const value = await runEffect(workflow.host.run(key, args("subscriber-failure")));
    const commit = (await inventory()).product.commits.at(-1);
    if (commit === undefined) throw new Error("Missing event commit");
    const counts = { audit: 0, index: 0 };
    const pump = await runEffect(makeCommitEventPump(currency.hostInput, subscribers.map(subscriber => ({ ...subscriber,
      handle: () => subscriber.id === "tags-audit" ? Effect.sync(() => { counts.audit++; }) : Effect.sync(() => { counts.index++; }).pipe(Effect.andThen(Effect.fail(new CommitEventSubscriberFailure({ retryable: true, code: "index-unavailable" })))),
    }))));
    await runEffect(pump.runNext(commit.commitSeq - 1n));
    expect(counts).toEqual({ audit: 2, index: 2 });
    for (let attempt = 1; attempt < 5; attempt++) {
      await makeEventRetriesDue(product.persistence.drizzle, commit.commitSeq);
      await runEffect(pump.runNext(commit.commitSeq - 1n));
    }
    expect(counts).toEqual({ audit: 2, index: 10 });
    const deliveries = (await inventory()).deliveries.filter(row => row.commitSeq === commit.commitSeq);
    expect(deliveries.filter(row => row.state === "failed")).toHaveLength(2);
    expect(await runEffect(workflow.host.run(key, args("subscriber-failure")))).toEqual(value);
  }, 60_000);

  it("refuses incomplete event families and leaves missing handler revisions pending", async () => {
    const workflow = await assemble();
    await runEffect(workflow.host.run(workflow.host.newRequestKey(), args("integrity")));
    const before = await inventory();
    const commit = before.product.commits.at(-1);
    if (commit === undefined) throw new Error("Missing event commit");
    const store = await runEffect(makeCommitEventStore(currency.hostInput));
    expect(Option.isNone(await runEffect(store.claim(commit.commitSeq, subscribers.map(subscriber => ({ ...subscriber, revision: "f".repeat(64) })))))).toBe(true);
    expect(await inventory()).toEqual(before);
    await corruptEventCount(product.persistence.drizzle, commit.commitSeq, 3);
    expect(await runEffectFailure(store.claim(commit.commitSeq, subscribers))).toMatchObject({ reason: "storedCorruption" });
    await corruptEventCount(product.persistence.drizzle, commit.commitSeq, 2);
    expect(await inventory()).toEqual(before);
    const event = before.events.find(row => row.commitSeq === commit.commitSeq);
    if (event === undefined) throw new Error("Missing event envelope");
    for (const envelope of [{ ...event.envelope, message: { name: "changed", data: { id: "different" } } }, { ...event.envelope, producerRevision: "f".repeat(64) }, { ...event.envelope, internal: false }]) {
      await replaceEventEnvelope(product.persistence.drizzle, { ...event, envelope });
      expect(await runEffectFailure(store.claim(commit.commitSeq, subscribers))).toMatchObject({ reason: "storedCorruption" });
      await replaceEventEnvelope(product.persistence.drizzle, event);
    }
    expect(await inventory()).toEqual(before);
  }, 30_000);

  it.runIf(driver === "postgres")("serializes competing claims without claiming the same delivery twice", async () => {
    const workflow = await assemble();
    await runEffect(workflow.host.run(workflow.host.newRequestKey(), args("concurrent-delivery")));
    const commit = (await inventory()).product.commits.at(-1);
    if (commit === undefined) throw new Error("Missing event commit");
    const stores = await Promise.all([runEffect(makeCommitEventStore(currency.hostInput)), runEffect(makeCommitEventStore(currency.hostInput))]);
    const claims = await Promise.all(stores.map(store => runEffect(store.claim(commit.commitSeq, subscribers))));
    expect(claims.every(Option.isSome)).toBe(true);
    expect(new Set(claims.flatMap(claim => Option.isSome(claim) ? [claim.value.message.deliveryId] : [])).size).toBe(2);
    for (const [index, claim] of claims.entries()) {
      const store = stores[index];
      if (store === undefined || Option.isNone(claim)) throw new Error("Missing concurrent claim");
      expect(Object.isFrozen(claim.value.message.envelope.message)).toBe(true);
      await runEffect(store.settle(claim.value));
    }
  }, 30_000);

  it("keeps foreign event and shared byte/call budget failures fatal after pending writes", async () => {
    const hooks: ProductTagWorkflowHooks[] = [
      { productTagsCreated: async (_input, { container }) => {
        const events = container.resolve<{ emit: (message: unknown) => Promise<void> }>("event_bus");
        await expect(events.emit([{ name: "unadmitted.created", data: { id: "foreign" }, metadata: { eventGroupId: "other-root" } }])).rejects.toMatchObject({ reason: "unadmittedEvent" });
      } },
      { productTagsCreated: async (_input, { container }) => {
        const service = container.resolve<{ createProductTags: (input: unknown) => Promise<unknown> }>("product");
        await expect(service.createProductTags([{ value: Symbol("invalid-before-call") }])).rejects.toMatchObject({ reason: "invalidInput" });
      } },
      { productTagsCreated: async () => "x".repeat(1_048_577) },
      { productTagsCreated: async (_input, { container }) => {
        const query = container.resolve<{ graph: (input: Json) => Promise<Json> }>("query");
        for (let call = 0; call < 100; call++) {
          try { await query.graph({ entity: "currency", fields: ["code"], filters: { code: "usd" }, pagination: { take: 1 } }); }
          catch { break; }
        }
      } },
    ];
    const before = await inventory();
    for (const [index, hook] of hooks.entries()) {
      const workflow = await assemble(hook, "bounded-hook-" + index);
      expect(Exit.isFailure(await runEffect(Effect.exit(workflow.host.run(workflow.host.newRequestKey(), args("bounded-hook"))))), "bounded hook " + index).toBe(true);
      expect(await inventory()).toEqual(before);
    }
  }, 60_000);

  it("retains the committed event family independently of ordinary history compaction", async () => {
    const before = await inventory();
    expect(before.product.commits.filter(row => row.eventCount > 0).length).toBeGreaterThan(1);
    await compactCommerceHistory(product);
    const after = await inventory();
    expect(after.events).toEqual(before.events);
    expect(after.deliveries).toEqual(before.deliveries);
    expect(after.product.commits.filter(row => row.eventCount > 0)).toEqual(before.product.commits.filter(row => row.eventCount > 0));
    expect(after.product.commits.length).toBeLessThan(before.product.commits.length);
  }, 60_000);

  it("uses the same host for native Product/Currency reads with no event resource", async () => {
    const modules = installedModules();
    const resources = Result.getOrThrow(prepareWorkflowResources({
      product: { module: modules.product.module, methods: [], graph: true },
      currency: { module: modules.currency.module, methods: ["retrieveCurrency"], graph: false },
    }, false));
    let escaped: ((code: string) => Promise<unknown>) | undefined;
    const retrieve = createStep("retrieve-native-currency", resources.callback(async (input: { code: string }, { resources }) => {
      escaped = resources.currency.retrieveCurrency;
      return await resources.currency.retrieveCurrency(input.code);
    }));
    const query = createStep("read-native-products", resources.callback(async (_input: undefined, { resources }) =>
      (await resources.query.graph({ entity: "product_tag", fields: ["id", "value"], pagination: { take: 256 } })).data));
    const flow = createWorkflow("native-catalog-read", (input: WorkflowData<{ code: string }>) => new WorkflowResponse({ currency: retrieve(input), tags: query(undefined) }));
    const definition = { name: "nativeCatalogRead", resources, prepared: Result.getOrThrow(flow.prepare()),
      input: Schema.Struct({ code: Schema.String }),
      output: Schema.Struct({ currency: Schema.JsonObject, tags: Schema.Array(Schema.JsonObject) }),
    };
    const host = await runEffect(prepareAtomicWorkflowHost({ execution: execution(), modules, workflow: definition, revision }));
    const before = await inventory();
    const key = host.newRequestKey();
    const result = await runEffect(host.run(key, { code: "usd" }));
    expect(result.currency).toMatchObject({ code: "usd", name: "US Dollar" });
    expect(result.tags.length).toBeGreaterThan(0);
    const after = await inventory();
    expect(after.events).toEqual(before.events); expect(after.deliveries).toEqual(before.deliveries);
    expect(after.product.facts).toEqual(before.product.facts);
    expect(after.product.commits).toHaveLength(before.product.commits.length + 1);
    expect(after.product.commits.at(-1)?.eventCount).toBe(0);
    expect(await runEffect(host.run(key, { code: "usd" }))).toEqual(result);
    expect(await inventory()).toEqual(after);
    await expect(escaped?.("usd")).rejects.toMatchObject({ reason: "closed" });
    const changed = await runEffect(prepareAtomicWorkflowHost({ execution: execution(), modules, workflow: definition, revision: "e".repeat(64) }));
    expect(await runEffectFailure(changed.run(key, { code: "usd" }))).toMatchObject({ reason: "requestConflict" });

    const unavailable = createStep("refuse-unselected-events", resources.callback((_input: undefined, { container }) => {
      try { container.resolve("event_bus"); } catch { /* the root must remain failed */ }
      return null;
    }));
    const invalid = createWorkflow("unselected-event-resource", () => new WorkflowResponse(unavailable(undefined)));
    const refused = await runEffect(prepareAtomicWorkflowHost({ execution: execution(), modules, revision,
      workflow: { ...definition, name: "unselectedEventResource", prepared: Result.getOrThrow(invalid.prepare()) },
    }));
    const unchanged = await inventory();
    const refusal = await runEffect(Effect.exit(refused.run(refused.newRequestKey(), { code: "usd" })));
    expect(Exit.isFailure(refusal)).toBe(true);
    expect(await inventory()).toEqual(unchanged);
  }, 60_000);

  it("keeps prepared native hook resources isolated and swallowed native validation fatal", async () => {
    const seen: string[] = [];
    const makeHook = (expected: string): ProductTagWorkflowHooks => ({ productTagsCreated: async (input, { resources }) => {
      const result = await resources.query.graph({ entity: "product_tag", fields: ["id", "value"], filters: { id: input.product_tags.map(tag => tag.id) }, pagination: { take: 1 } });
      expect(result.data).toMatchObject([{ value: expected }]); seen.push(expected);
    } });
    const first = await assemble(makeHook("isolated-a"), "isolated-a");
    const second = await assemble(makeHook("isolated-b"), "isolated-b");
    const a = () => runEffect(first.host.run(first.host.newRequestKey(), args("isolated-a")));
    const b = () => runEffect(second.host.run(second.host.newRequestKey(), args("isolated-b")));
    if (driver === "postgres") await Promise.all([a(), b()]); else { await a(); await b(); }
    expect(seen.toSorted()).toEqual(["isolated-a", "isolated-b"]);
    const invalid = await assemble({ productTagsCreated: async (_input, { resources }) => {
      await expect(Reflect.apply(resources.product.createProductTags, undefined, [[{ value: Symbol("invalid-native-input") }]]))
        .rejects.toMatchObject({ reason: "invalidInput" });
    } }, "invalid-native-input");
    const before = await inventory();
    expect(Exit.isFailure(await runEffect(Effect.exit(invalid.host.run(invalid.host.newRequestKey(), args("invalid-native-input")))))).toBe(true);
    expect(await inventory()).toEqual(before);
  }, 60_000);

  it("decodes encoded inputs once and validates transformed stored results on replay", async () => {
    const modules = installedModules();
    const resources = Result.getOrThrow(prepareWorkflowResources({
      product: { module: modules.product.module, methods: [], graph: true },
      currency: { module: modules.currency.module, methods: ["retrieveCurrency"], graph: false },
    }, false));
    let calls = 0;
    const stringify = createStep("format-decoded-input", (input: number) => { calls++; return String(input + 1); });
    const flow = createWorkflow("transforming-contracts", (input: WorkflowData<number>) => new WorkflowResponse(stringify(input)));
    const host = await runEffect(prepareAtomicWorkflowHost({ execution: execution(), modules, revision,
      workflow: { name: "transformingContracts", resources, prepared: Result.getOrThrow(flow.prepare()), input: Schema.NumberFromString, output: Schema.NumberFromString },
    }));
    const before = await inventory();
    const key = host.newRequestKey();
    expect(await runEffect(host.run(key, "41"))).toBe(42);
    const after = await inventory();
    expect(after.product.commits).toHaveLength(before.product.commits.length + 1);
    expect(await runEffect(host.run(key, "41"))).toBe(42);
    expect(calls).toBe(1); expect(await inventory()).toEqual(after);
    const invalid = await runEffect(Effect.exit(host.run(host.newRequestKey(), "invalid")));
    expect(Exit.isFailure(invalid)).toBe(true);
    expect(await inventory()).toEqual(after);
    const inputType = () => {
      // @ts-expect-error run accepts the encoded schema input, not its decoded number
      host.run("unused", 41);
    };
    expect(inputType).toBeTypeOf("function");
  }, 60_000);

  it("includes method-to-command associations in replay identity", async () => {
    const installed = installedModules();
    const description = workflowModuleDefinition(installed.currency.module);
    if (description === undefined) throw new Error("Missing Currency registration");
    const decode = commerceDecoder(Schema.Json, "invalidInput");
    const adapters = { arguments: commerceDecoder(Schema.Tuple([]), "invalidInput"), encode: () => ({}), output: decode };
    const retrieve = Result.getOrThrow(defineWorkflowMethod({ ...adapters, command: currencyCommands.retrieve }));
    const count = Result.getOrThrow(defineWorkflowMethod({ ...adapters, command: currencyCommands.count }));
    const assemble = async (swapped: boolean) => {
      const module = Result.getOrThrow(defineWorkflowModule({ name: "currency", source: { ...description.source, models: [], extensions: [], capabilities: [] },
        methods: { first: swapped ? count : retrieve, second: swapped ? retrieve : count }, graph: description.graph }));
      const modules = { ...installed, currency: { ...installed.currency, module } };
      const resources = Result.getOrThrow(prepareWorkflowResources({ product: { module: modules.product.module, methods: [], graph: true },
        currency: { module, methods: ["first", "second"], graph: false } }, false));
      const flow = createWorkflow("association-policy", () => new WorkflowResponse(null));
      return await runEffect(prepareAtomicWorkflowHost({ execution: execution(), modules, revision,
        workflow: { name: "associationPolicy", resources, prepared: Result.getOrThrow(flow.prepare()), input: Schema.Null, output: Schema.Null } }));
    };
    const first = await assemble(false), second = await assemble(true);
    const key = first.newRequestKey();
    expect(await runEffect(first.run(key, null))).toBeNull();
    const before = await inventory();
    expect(await runEffectFailure(second.run(key, null))).toMatchObject({ reason: "requestConflict" });
    expect(await inventory()).toEqual(before);
  }, 60_000);

  it("rolls back pending writes when a hook catches a graph decoder defect", async () => {
    const modules = installedModules();
    const description = workflowModuleDefinition(modules.product.module);
    if (description === undefined) throw new Error("Missing Product registration");
    const defect = new Error("graph decoder defect");
    const module = Result.getOrThrow(defineWorkflowModule({ name: "product", source: { ...description.source, models: [], extensions: [], capabilities: [] },
      methods: modules.product.module.methods, refusedMethods: description.refusedMethods,
      graph: { ...description.graph, reads: description.graph.reads.map(read => ({ ...read, decode: () => { throw defect; } })) },
    }));
    const host = await runEffect(prepareProductTagWorkflow({ execution: execution(), modules: { ...modules, product: { ...modules.product, module } }, revision, subscribers,
      hooks: { productTagsCreated: async (_input, { resources }) => {
        await expect(resources.query.graph({ entity: "product_tag", fields: ["id"], pagination: { take: 256 } })).rejects.toBeDefined();
      } },
    }));
    const before = await inventory();
    const pending = host.run(host.newRequestKey(), args("caught-graph-defect"));
    const failed = await runEffect(Effect.exit(pending));
    expect(Exit.isFailure(failed)).toBe(true);
    expect(await inventory()).toEqual(before);
  }, 60_000);

  it("captures nested Product bindings without invoking registration accessors", async () => {
    let reads = 0;
    const installed = installedModules();
    const modules = Object.defineProperty({ ...installed }, "product", { enumerable: true, get: () => { reads++; return installed.product; } });
    expect(Exit.isFailure(await runEffect(Effect.exit(prepareProductTagWorkflow({ execution: execution(), modules, revision, subscribers }))))).toBe(true);
    const binding = Object.defineProperty({ ...installed.product }, "module", { enumerable: true, get: () => { reads++; return installed.product.module; } });
    expect(Exit.isFailure(await runEffect(Effect.exit(prepareProductTagWorkflow({ execution: execution(), modules: { ...installed, product: binding }, revision, subscribers }))))).toBe(true);
    expect(reads).toBe(0);
  });

  it.runIf(driver === "postgres")("discovers sparse event history through the partial commit directory", async () => {
    if (!("pool" in product.persistence)) throw new Error("PostgreSQL proof requires a real pool");
    const before = await inventory();
    const latest = before.product.commits.at(-1);
    if (latest === undefined) throw new Error("Missing latest commit");
    let observed: CommitEventQuery | undefined;
    const store = await runEffect(makeCommitEventStore({ ...currency.hostInput, observeQuery: query => { observed = query; } }));
    expect(Option.isNone(await runEffect(store.nextCommit(latest.commitSeq)))).toBe(true);
    if (observed === undefined) throw new Error("Missing event directory query");
    expect(await explainSparseEventDirectory(product.persistence, observed, latest)).toContain("fx_commit_event_directory_idx");
    expect(await inventory()).toEqual(before);
  }, 30_000);
});
