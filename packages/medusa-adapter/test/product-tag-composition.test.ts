import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, when, WorkflowResponse, type PreparedWorkflow, type WorkflowData } from "@medusajs/workflows-sdk";
import { createProductTagsWorkflow } from "@medusajs/core-flows/product/create-product-tags";
import { deleteProductTagsWorkflow } from "@medusajs/core-flows/product/delete-product-tags";
import { prepareProductTagComposition, type ProductTagCompositionHooks } from "../src/product-tag-composition";
import { composedProductTagEvents } from "../src/product-tag-workflow-events";
import { prepareCurrencyProfile } from "../src/currency-contract";
import { currencyCommands, currencyWorkflowModule } from "../src/currency-service";
import { makeLocalProductCommands } from "../src/product-service";
import { prepareLocalProductProfile } from "../src/product-profile";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";
import { productLocalEventPolicy, productModuleEventPolicy } from "../src/product-local-events";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { prepareAtomicWorkflowHost, type AtomicWorkflowHostComposition } from "../src/workflow/host";
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
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/atomicCommerce/commands";
import { defineCommerceCommand } from "../../persistence-postgres/src/commerceTransaction/commands";
import { defineCommerceEventContract, type ParticipantEventSelection, type CommerceEventContract } from "../../persistence-postgres/src/atomicCommerce/events";
import { commerceError, type CommerceTransactionError } from "../../persistence-postgres/src/commerceTransaction/model";

const cleanup: Array<() => Promise<void>> = [];
const driver = process.env.MEDUSA_COMPARISON_DRIVER ?? "pglite";
let product: CommerceHostTestFixture, currency: CommerceHostTestFixture;
let commands: Effect.Success<ReturnType<typeof makeLocalProductCommands>>;
let policy: ReturnType<typeof productModuleEventPolicy>;
let revision: string;
const subscribers = [{ id: "composition", revision: "a".repeat(64) }];
const inventory = async () => ({ product: await commerceInventory(product), currency: await commerceInventory(currency),
  events: await product.persistence.drizzle.select().from(fxSystemCommitEvents).orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal),
  deliveries: await product.persistence.drizzle.select().from(fxSystemCommitEventDeliveries).orderBy(fxSystemCommitEventDeliveries.commitSeq, fxSystemCommitEventDeliveries.eventOrdinal),
});
const execution = (session = currency.session) => ({ identityAndAccessPolicy: currency.hostInput.identityAndAccessPolicy,
  prepare: (composition: AtomicWorkflowHostComposition) => makeAtomicCommerceHost({ ...currency.hostInput, session, ...composition }),
});
const modules = () => ({ product: { module: commands.workflow, profile: product.prepared.profile, installation: product.installation, moduleEvents: policy },
  currency: { module: Result.getOrThrow(currencyWorkflowModule), profile: currency.prepared.profile, installation: currency.installation } });
const options = (hooks?: ProductTagCompositionHooks) => ({ execution: execution(), modules: modules(), revision, subscribers, ...(hooks === undefined ? {} : { hooks }) });
const args = (value: string) => ({ value, updated_value: `${value}-updated` });
const resources = () => Result.getOrThrow(prepareWorkflowResources({
  product: { module: commands.workflow, methods: ["createProductTags", "listProductTags", "updateProductTags", "softDeleteProductTags"], graph: true },
  currency: { module: Result.getOrThrow(currencyWorkflowModule), methods: [], graph: true },
}, true));
const Input = Schema.Struct({ value: Schema.String, enabled: Schema.Boolean });
const raw = async (build: (selection: ReturnType<typeof resources>) => PreparedWorkflow,
  output: Schema.ConstraintDecoder<Schema.Json> = Schema.Json) => {
  const selection = resources();
  return runEffect(prepareAtomicWorkflowHost({ ...options(), workflow: {
    name: "composeTagScenario", resources: selection, prepared: build(selection), input: Input, output,
    events: composedProductTagEvents({ create: commands.workflow.methods.createProductTags, update: commands.workflow.methods.updateProductTags, delete: commands.workflow.methods.softDeleteProductTags }),
  } }));
};

describe("native composed Product workflows", () => {
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
    const catalog = await runEffect(captureProductSchema("tag-composition").pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    currency = await commerceHostFixture(resource.persistence, resource.session, prepareCurrencyProfile, [currencyCommands.retrieve], control);
    product = await commerceHostFixture(resource.persistence, resource.session, prepareLocalProductProfile, [commands.commands.createTags, commands.commands.listTags], control,
      descriptor => productLocalEventPolicy(descriptor, catalog, () => Effect.void), {}, currency);
    policy = productModuleEventPolicy(product.descriptor, catalog);
  }, 150_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

  it("runs real create/update children, reads pending graphs and publishes one ordered root", async () => {
    const hooks: string[] = [];
    const before = await inventory();
    const host = await runEffect(prepareProductTagComposition(options({
      created: async (input, { resources }) => {
        hooks.push("created");
        expect(await resources.query.graph({ entity: "product_tag", fields: ["id", "value"], filters: { id: input.product_tags.map(tag => tag.id) }, pagination: { take: 1 } }))
          .toMatchObject({ data: [{ value: "composed" }] });
        expect(await resources.query.graph({ entity: "currency", fields: ["code"], filters: { code: "usd" }, pagination: { take: 1 } })).toMatchObject({ data: [{ code: "usd" }] });
        if (driver === "postgres") expect(await inventory()).toEqual(before);
      },
      updated: async (input, { resources }) => {
        hooks.push("updated");
        expect(await resources.query.graph({ entity: "product_tag", fields: ["value"], filters: { id: input.product_tags.map(tag => tag.id) }, pagination: { take: 1 } }))
          .toMatchObject({ data: [{ value: "composed-updated" }] });
        if (driver === "postgres") expect(await inventory()).toEqual(before);
      },
    })));
    const key = host.newRequestKey(); const result = await runEffect(host.run(key, args("composed")));
    expect(result).toMatchObject([{ value: "composed-updated" }]); expect(hooks).toEqual(["created", "updated"]);
    const after = await inventory();
    expect(after.product.commits).toHaveLength(before.product.commits.length + 1);
    expect(after.product.outcomes).toHaveLength(before.product.outcomes.length + 1);
    expect(after.product.wakes).toHaveLength(before.product.wakes.length + 1);
    const events = after.events.slice(before.events.length);
    expect(events.map(row => row.envelope.contract)).toEqual(["product.product-tag.created", "product-tag.created", "product.product-tag.updated", "product-tag.updated"]);
    expect(events.map(row => row.eventOrdinal)).toEqual([0, 1, 2, 3]);
    expect(events.map(row => row.envelope.internal)).toEqual([true, false, true, false]);
    expect(events.every(row => row.envelope.group === key)).toBe(true);
    expect(new Set(events.map(row => row.commitSeq)).size).toBe(1);
    expect(after.product.commits.at(-1)?.eventCount).toBe(4);
    expect(after.deliveries).toHaveLength(before.deliveries.length + 4);
    const facts = after.product.facts.slice(before.product.facts.length);
    expect(facts.map(fact => fact.changeOrdinal)).toEqual(facts.map((_, index) => index));
    expect(await runEffect(host.run(key, args("composed")))).toEqual(result);
    expect(hooks).toEqual(["created", "updated"]); expect(await inventory()).toEqual(after);
    const changed = await runEffect(prepareProductTagComposition(options()));
    expect(await runEffectFailure(changed.run(key, args("composed")))).toMatchObject({ reason: "requestConflict" });
  }, 30_000);

  it("isolates renamed repeated children and completely skips conditional children", async () => {
    const calls: string[] = [];
    const host = await raw(selection => Result.getOrThrow(createWorkflow("repeated-tags", (input: WorkflowData<typeof Input.Type>) => {
      const first = createProductTagsWorkflow.runAsStep({ input: { product_tags: [{ value: input.value }] },
        hooks: { productTagsCreated: selection.callback(() => { calls.push("first"); }) } }).config({ name: "first" });
      const second = when("enabled", input.enabled, value => value).then(() => createProductTagsWorkflow.runAsStep({
        input: { product_tags: [{ value: transform(input.value, value => `${value}-second`) }] },
        hooks: { productTagsCreated: selection.callback(() => { calls.push("second"); }) },
      }).config({ name: "second" }));
      return new WorkflowResponse(transform({ first, second }, value => ({ first: value.first, second: value.second ?? null })));
    }).prepare()));
    const before = await inventory();
    expect(await runEffect(host.run(host.newRequestKey(), { value: "repeated", enabled: true }))).toMatchObject({ first: [{ value: "repeated" }], second: [{ value: "repeated-second" }] });
    expect(calls).toEqual(["first", "second"]);
    expect(await runEffect(host.run(host.newRequestKey(), { value: "skipped", enabled: false }))).toMatchObject({ first: [{ value: "skipped" }], second: null });
    expect(calls).toEqual(["first", "second", "first"]);
    expect((await inventory()).events).toHaveLength(before.events.length + 6);
  }, 30_000);

  it("keeps delete-child void as intermediate absence and commits creation plus deletion", async () => {
    const host = await raw(() => Result.getOrThrow(createWorkflow("create-delete-tag", (input: WorkflowData<typeof Input.Type>) => {
      const created = createProductTagsWorkflow.runAsStep({ input: { product_tags: [{ value: input.value }] } });
      const deleted = deleteProductTagsWorkflow.runAsStep({ input: { ids: transform(created, tags => tags.map(tag => tag.id)) } });
      return new WorkflowResponse(transform({ created, deleted }, value => {
        expect(value.deleted).toBeUndefined(); return value.created.map(tag => tag.id);
      }));
    }).prepare()));
    const before = await inventory();
    const ids = await runEffect(host.run(host.newRequestKey(), { value: "created-deleted", enabled: true }));
    expect(ids).toEqual([expect.any(String)]);
    expect(await runEffect(product.host.read(commands.commands.listTags, { filters: { value: "created-deleted" }, config: {} }))).toEqual([]);
    expect((await inventory()).events.slice(before.events.length).map(row => row.envelope.contract))
      .toEqual(["product.product-tag.created", "product-tag.created", "product.product-tag.deleted", "product-tag.deleted"]);
  }, 30_000);

  it("rolls back late child, hook, graph and event refusals even when caught", async () => {
    const cases: NonNullable<ProductTagCompositionHooks["updated"]>[] = [
      () => { throw new Error("late child hook failure"); },
      async (_input, { resources }) => { try { await resources.query.graph({ entity: "external", fields: ["id"] }); } catch { /* refusal remains sticky */ } },
      async (_input, { resources }) => { try { await resources.event_bus.emit([{ name: "unselected", data: {} }]); } catch { /* refusal remains sticky */ } },
      () => Symbol("invalid hook output"),
    ];
    const before = await inventory();
    for (const updated of cases) {
      const host = await runEffect(prepareProductTagComposition(options({ updated })));
      expect(Exit.isFailure(await runEffect(Effect.exit(host.run(host.newRequestKey(), args("refused-child")))))).toBe(true);
      expect(await inventory()).toEqual(before);
    }
  }, 30_000);

  it("rolls back late parent and root output failure and wrong selection", async () => {
    const before = await inventory();
    for (const mode of ["parent", "output", "selection"] as const) {
      const foreign = resources();
      const host = await raw(selection => Result.getOrThrow(createWorkflow("refused-parent", (input: WorkflowData<typeof Input.Type>) => {
        const created = createProductTagsWorkflow.runAsStep({ input: { product_tags: [{ value: input.value }] },
          hooks: mode === "selection" ? { productTagsCreated: foreign.callback(() => null) } : {},
        });
        const after = createStep("after-child", selection.callback(() => {
          if (mode === "parent") throw new Error("parent failed after child completed");
          return null;
        }));
        after(undefined); return new WorkflowResponse(created);
      }).prepare()), mode === "output" ? Schema.Null : Schema.Json);
      expect(Exit.isFailure(await runEffect(Effect.exit(host.run(host.newRequestKey(), { value: `refused-${mode}`, enabled: true }))))).toBe(true);
      expect(await inventory()).toEqual(before);
    }
  }, 30_000);

  it("charges individually bounded child outputs against the shared root byte budget", async () => {
    // A few individually valid values exhaust bytes well before the 64-call
    // ceiling, so a generic limit failure cannot accidentally prove call limits.
    const evaluate = vi.fn(() => "x".repeat(192_000));
    const payload = createStep("payload", evaluate);
    const child = createWorkflow("bounded-payload", () => new WorkflowResponse(payload(undefined)));
    const host = await raw(() => Result.getOrThrow(createWorkflow("shared-byte-budget", (input: WorkflowData<typeof Input.Type>) => {
      createProductTagsWorkflow.runAsStep({ input: { product_tags: [{ value: input.value }] } });
      for (let index = 0; index < 12; index++) child.runAsStep({ input: undefined }).config({ name: `payload-${index}` });
      return new WorkflowResponse(null);
    }).prepare()));
    const before = await inventory();
    const exit = await runEffect(Effect.exit(host.run(host.newRequestKey(), { value: "bounded-children", enabled: true })));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(exit.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error.reason)).toContain("limitExceeded");
    expect(evaluate.mock.calls.length).toBeGreaterThan(1); expect(evaluate.mock.calls.length).toBeLessThan(5);
    expect(await inventory()).toEqual(before);
  }, 30_000);

  it("binds literal child configuration into replay without changing the bundle revision", async () => {
    const make = (value: string) => raw(() => Result.getOrThrow(createWorkflow("configured-parent", () => new WorkflowResponse(
      createProductTagsWorkflow.runAsStep({ input: { product_tags: [{ value }] } }),
    )).prepare()));
    const first = await make("captured-first"), changed = await make("captured-second");
    const key = first.newRequestKey(), input = { value: "same-root-input", enabled: true };
    expect(await runEffect(first.run(key, input))).toMatchObject([{ value: "captured-first" }]);
    const after = await inventory();
    expect(await runEffectFailure(changed.run(key, input))).toMatchObject({ reason: "requestConflict" });
    expect(await inventory()).toEqual(after);
  }, 30_000);

  it("cancels a child hook and revokes its borrowed resources", async () => {
    const reached = await runEffect(Deferred.make<void>());
    let release: (() => void) | undefined;
    const wait = new Promise<void>(resolve => { release = resolve; });
    let escaped: Parameters<NonNullable<ProductTagCompositionHooks["updated"]>>[1]["resources"] | undefined;
    const host = await runEffect(prepareProductTagComposition(options({ updated: async (_input, { resources }) => {
      escaped = resources; await runEffect(Deferred.succeed(reached, undefined)); await wait;
    } })));
    const before = await inventory();
    await runEffect(Effect.scoped(Effect.gen(function* () {
      const fiber = yield* Effect.forkScoped(host.run(host.newRequestKey(), args("cancel-child")));
      yield* Deferred.await(reached).pipe(Effect.timeout(5000)); yield* Fiber.interrupt(fiber);
    })));
    release?.();
    await expect(escaped?.query.graph({ entity: "currency", fields: ["code"], pagination: { take: 1 } })).rejects.toMatchObject({ reason: "closed" });
    expect(await inventory()).toEqual(before);
  }, 30_000);

  it("recovers a lost root acknowledgement without repeating either child", async () => {
    const called = vi.fn(); let lose = true;
    const session = issueRelationalSession(currency.persistence.drizzle, work => runRelationalSession(currency.session, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => { if (!lose) return Effect.succeed(value); lose = false;
        return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: "lost composition acknowledgement" })); }),
    ));
    const host = await runEffect(prepareProductTagComposition({ ...options({ created: called, updated: called }), execution: execution(session) }));
    const before = await inventory(); const key = host.newRequestKey();
    const result = await runEffect(host.run(key, args("recovered-composition")));
    expect(result).toMatchObject([{ value: "recovered-composition-updated" }]); expect(called).toHaveBeenCalledTimes(2);
    expect((await inventory()).events).toHaveLength(before.events.length + 4);
    expect(await runEffect(host.run(key, args("recovered-composition")))).toEqual(result); expect(called).toHaveBeenCalledTimes(2);
  }, 30_000);

  it.skipIf(driver !== "postgres")("settles concurrent duplicate roots once", async () => {
    const called = vi.fn(); const host = await runEffect(prepareProductTagComposition(options({ created: called, updated: called })));
    const before = await inventory(); const key = host.newRequestKey();
    const [first, second] = await Promise.all([runEffect(host.run(key, args("concurrent-composition"))), runEffect(host.run(key, args("concurrent-composition")))]);
    expect(first).toEqual(second); expect(called).toHaveBeenCalledTimes(2);
    expect((await inventory()).product.commits).toHaveLength(before.product.commits.length + 1);
  }, 30_000);

  it("checks event selection in core independently of the adapter", async () => {
    const participant = defineAtomicCommerceParticipant("eventProducer");
    const first = defineCommerceEventContract({ name: "first.internal", revision, internal: true, decode: value => Effect.succeed(value === null ? null : "first") });
    const second = defineCommerceEventContract({ name: "second.internal", revision, internal: true, decode: () => Effect.succeed("second") });
    const external = defineCommerceEventContract({ name: "external.only", revision, internal: false, decode: () => Effect.succeed(null) });
    const unlisted = defineCommerceEventContract({ name: "unlisted.internal", revision, internal: true, decode: () => Effect.succeed(null) });
    // SAFETY: deliberately forged token exercises runtime authentication.
    const forged = Object.freeze({}) as CommerceEventContract;
    let message: unknown = { payload: "owned" };
    const failures: CommerceTransactionError[] = [];
    const emitted = defineCommerceCommand("emitSelected", "write", ctx => ctx.captureLocalEvent(message).pipe(Effect.as(null)));
    const command = defineAtomicCommerceCommand("selectParticipantEvent", ctx => ctx.call(participant, emitted, null).pipe(
      Effect.catch(error => Effect.sync(() => { failures.push(error); return null; })),
    ));
    const base = { ...currency.hostInput, commands: [command], events: { producerRevision: revision, contracts: [first, second, external], subscribers, validate: () => Effect.void } };
    const member = { participant, installation: product.installation, profile: product.prepared.profile, commands: [emitted], validate: () => Effect.void };
    const make = (events?: ParticipantEventSelection) => makeAtomicCommerceHost({ ...base, participants: [{ ...member, ...(events === undefined ? {} : { events }) }] });
    for (const contracts of [[forged], [unlisted], [external], [first, first], Array.from({ length: 65 }, () => first)]) {
      expect(await runEffectFailure(make({ contracts, select: () => Effect.succeed(first) }))).toMatchObject({ reason: "invalidAuthority" });
    }
    const before = await inventory();
    for (const selected of [forged, second, external, unlisted]) {
      const host = await runEffect(make({ contracts: [first], select: () => Effect.succeed(selected) }));
      expect(await runEffectFailure(host.run(host.newRequestKey(), command, null))).toMatchObject({ reason: "rollbackOnly" });
      expect(failures.at(-1)).toMatchObject({ reason: "unadmittedEvent" });
      expect(await inventory()).toEqual(before);
    }
    for (const events of [undefined, { contracts: [], select: () => Effect.succeed(first) }]) {
      const host = await runEffect(make(events));
      expect(await runEffectFailure(host.run(host.newRequestKey(), command, null))).toMatchObject({ reason: "rollbackOnly" });
      expect(failures.at(-1)).toMatchObject({ reason: "unadmittedEvent" });
    }
    const failure = commerceError("receiptMismatch"), defect = new Error("selector defect");
    for (const scenario of [{ select: () => Effect.fail(failure), defect: false }, { select: () => Effect.die(defect), defect: true }]) {
      const host = await runEffect(make({ contracts: [first], select: scenario.select }));
      const exit = await runEffect(Effect.exit(host.run(host.newRequestKey(), command, null)));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(Cause.hasDies(exit.cause)).toBe(scenario.defect);
      if (!scenario.defect) expect(failures.at(-1)).toBe(failure);
      expect(await inventory()).toEqual(before);
    }
    const getter = vi.fn(() => "unsafe"), select = vi.fn(() => Effect.succeed(first));
    message = Object.defineProperty({}, "payload", { get: getter, enumerable: true });
    const invalid = await runEffect(make({ contracts: [first], select }));
    expect(await runEffectFailure(invalid.run(invalid.newRequestKey(), command, null))).toMatchObject({ reason: "rollbackOnly" });
    expect(failures.at(-1)).toMatchObject({ reason: "invalidInput" });
    expect(getter).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled(); expect(await inventory()).toEqual(before);
    message = { payload: "owned" };
    const tokens = [first, second];
    const selection = { contracts: tokens, select: (message: Schema.Json) => Effect.sync(() => { expect(message).toEqual({ payload: "owned" }); expect(Object.isFrozen(message)).toBe(true); return first; }) };
    const host = await runEffect(make(selection)); tokens.length = 0; selection.select = () => Effect.succeed(second);
    const key = host.newRequestKey(); expect(await runEffect(host.run(key, command, null))).toBeNull();
    expect((await inventory()).events.at(-1)?.envelope).toMatchObject({ contract: "first.internal", internal: true, message: "first" });
    const changed = await runEffect(make({ contracts: [first], select: () => Effect.succeed(first) }));
    expect(await runEffectFailure(changed.run(key, command, null))).toMatchObject({ reason: "requestConflict" });
    const quiet = defineAtomicCommerceCommand("quietParticipant", () => Effect.succeed(null));
    for (const events of [undefined, { contracts: [], select: () => Effect.succeed(first) }]) {
      const host = await runEffect(makeAtomicCommerceHost({ ...base, commands: [quiet], participants: [{ ...member, ...(events === undefined ? {} : { events }) }] }));
      expect(await runEffect(host.run(host.newRequestKey(), quiet, null))).toBeNull();
    }
  }, 30_000);
});
