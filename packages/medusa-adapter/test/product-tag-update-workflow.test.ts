import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from "vitest";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Deferred, Effect, Exit, Fiber, Result } from "effect";
import { prepareProductTagUpdateWorkflow, type ProductTagUpdateWorkflowHooks, type ProductTagUpdateResources } from "../src/product-tag-update-workflow";
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
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/atomicCommerce/commands";
import { captureBindingValue, isDataBindingSetFrame } from "../../persistence-postgres/src/frameworkSchema/binding/canonical";
import { commerceBindings } from "../../persistence-postgres/src/frameworkSchema/binding/model";
import { dataBindingActivationRequest } from "../../persistence-postgres/src/frameworkSchema/binding/host";
import { readAdmittedDataBinding } from "../../persistence-postgres/src/frameworkSchema/binding/selection";
import type { AtomicWorkflowHostComposition } from "../src/workflow/host";

const cleanup: Array<() => Promise<void>> = [];
const driver = process.env.MEDUSA_COMPARISON_DRIVER ?? "pglite";
let product: CommerceHostTestFixture;
let control: CommerceHostTestFixture["persistence"];
let commands: Effect.Success<ReturnType<typeof makeLocalProductCommands>>;
let policy: ReturnType<typeof productModuleEventPolicy>;
let revision: string;
const subscribers = [{ id: "tag-updates", revision: "a".repeat(64) }];
const args = (id: string, value = id + "-updated") => ({ selector: { id }, update: { value }, additional_data: { witness: id } });
const execution = (session = product.session) => ({ identityAndAccessPolicy: product.hostInput.identityAndAccessPolicy,
  prepare: (composition: AtomicWorkflowHostComposition) => makeAtomicCommerceHost({ ...product.hostInput, session, ...composition }),
});
const options = (hooks?: ProductTagUpdateWorkflowHooks) => ({ execution: execution(), revision, subscribers,
  modules: { product: { module: commands.workflow, profile: product.prepared.profile, installation: product.installation, moduleEvents: policy } },
  ...(hooks === undefined ? {} : { hooks }),
});
const assemble = (hooks?: ProductTagUpdateWorkflowHooks) => runEffect(prepareProductTagUpdateWorkflow(options(hooks)));
const seed = (id: string) => runEffect(product.host.run(product.host.newRequestKey(), commands.commands.createTags, [{ id, value: id }]));
const inventory = async () => ({ data: await commerceInventory(product),
  events: await product.persistence.drizzle.select().from(fxSystemCommitEvents).orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal),
  deliveries: await product.persistence.drizzle.select().from(fxSystemCommitEventDeliveries).orderBy(fxSystemCommitEventDeliveries.commitSeq, fxSystemCommitEventDeliveries.eventOrdinal),
});

describe("Product-tag updates with selected atomic participants", () => {
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
    const catalog = await runEffect(captureProductSchema("tag-update-workflow").pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    product = await commerceHostFixture(resource.persistence, resource.session, prepareLocalProductProfile,
      [commands.commands.createTags, commands.commands.updateTags, commands.commands.listTags], control,
      descriptor => productLocalEventPolicy(descriptor, catalog, () => Effect.void));
    policy = productModuleEventPolicy(product.descriptor, catalog);
  }, 150_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

  it("uses an empty selector for zero or one matching tag without changing the service result", async () => {
    const host = await assemble();
    expect(await runEffect(host.run(host.newRequestKey(), { selector: {}, update: { value: "empty-selection" } }))).toEqual([]);
    await seed("all-matching-tag");
    expect(await runEffect(host.run(host.newRequestKey(), { selector: {}, update: { value: "all-matching-updated" } })))
      .toMatchObject([{ id: "all-matching-tag", value: "all-matching-updated" }]);
  });

  it("updates the sole installed module, exposes pending graph/projections and publishes both event families once", async () => {
    expect(commerceBindings(product.candidate.frame)).toHaveLength(1);
    expect(await runEffect(captureBindingValue(product.candidate.frame, isDataBindingSetFrame))).toHaveProperty("sha256Hex");
    await seed("single-tag"); await seed("unaffected-tag");
    let hooks = 0;
    let escaped: ProductTagUpdateResources["product"]["updateProductTags"] | undefined;
    const host = await assemble({ productTagsUpdated: async (input, { resources }) => {
      hooks++; escaped = resources.product.updateProductTags;
      expect(input.additional_data).toEqual({ witness: "single-tag" });
      expect(input.product_tags).toMatchObject([{ id: "single-tag", value: "single-tag-updated" }]);
      const selected = await resources.product.listProductTags({ id: "single-tag" }, { select: ["id"], relations: [] });
      expectTypeOf(selected).toEqualTypeOf<readonly import("flarex-protocol/json").JsonObject[]>();
      expect(selected).toEqual([{ id: "single-tag" }]);
      const graph = await resources.query.graph({ entity: "product_tag", fields: ["id", "value"], filters: { id: ["single-tag", "unaffected-tag"] }, pagination: { take: 2 } });
      expect(graph.data).toEqual(expect.arrayContaining([{ id: "single-tag", value: "single-tag-updated" }, { id: "unaffected-tag", value: "unaffected-tag" }]));
    } });
    const before = await inventory(); const key = host.newRequestKey();
    const result = await runEffect(host.run(key, args("single-tag")));
    const after = await inventory();
    expect(after.data.commits).toHaveLength(before.data.commits.length + 1);
    expect(after.data.outcomes).toHaveLength(before.data.outcomes.length + 1);
    expect(after.data.wakes).toHaveLength(before.data.wakes.length + 1);
    expect(after.data.facts.slice(before.data.facts.length).map(row => row.installationSha256)).toEqual([product.installation.installation.installationSha256]);
    expect(after.events.slice(before.events.length).map(row => row.envelope.contract)).toEqual(["product.product-tag.updated", "product-tag.updated"]);
    expect(after.events.slice(before.events.length).map(row => row.eventOrdinal)).toEqual([0, 1]);
    expect(after.events.at(-1)?.envelope).toMatchObject({ group: key, message: { name: "product-tag.updated", data: { id: "single-tag" }, metadata: { eventGroupId: key } } });
    expect(after.deliveries).toHaveLength(before.deliveries.length + 2);
    expect(await runEffect(host.run(key, args("single-tag")))).toEqual(result);
    expect(hooks).toBe(1); expect(await inventory()).toEqual(after);
    await expect(escaped?.({ id: "single-tag" }, { value: "escaped" })).rejects.toMatchObject({ reason: "closed" });
  });

  it("preserves selector, empty-result, unchanged-value and existing ID-command behavior", async () => {
    await seed("selector-tag");
    const host = await assemble();
    expect(await runEffect(host.run(host.newRequestKey(), { selector: { value: "selector-tag" }, update: { value: "selected-by-value" } }))).toMatchObject([{ id: "selector-tag", value: "selected-by-value" }]);
    expect(await runEffect(host.run(host.newRequestKey(), { selector: { id: ["selector-tag", "missing-tag"], value: "selected-by-value" }, update: { value: "selected-by-value" } }))).toMatchObject([{ id: "selector-tag", value: "selected-by-value" }]);
    for (const selector of [{ id: [] }, { id: "missing-tag" }, { id: "selector-tag", value: "different" }]) {
      const before = await inventory();
      expect(await runEffect(host.run(host.newRequestKey(), { selector, update: { value: "no-matches" } }))).toEqual([]);
      const after = await inventory(); expect(after.events).toEqual(before.events); expect(after.data.facts).toEqual(before.data.facts);
    }
    expect(await runEffect(product.host.run(product.host.newRequestKey(), commands.commands.updateTags,
      { id: "selector-tag", data: { value: "existing-id-command" } }))).toMatchObject({ id: "selector-tag", value: "existing-id-command" });
  });

  it("rolls back duplicate-value selector updates and refuses unsupported input", async () => {
    await seed("duplicate-a"); await seed("duplicate-b");
    const host = await assemble();
    const before = await inventory();
    for (const selector of [{ id: ["duplicate-a", "duplicate-b"] }, {}]) {
      expect(Exit.isFailure(await runEffect(Effect.exit(host.run(host.newRequestKey(), { selector, update: { value: "collision" } }))))).toBe(true);
      expect(await inventory()).toEqual(before);
    }
    // Deliberate malformed-boundary fixtures retain a valid TS call surface.
    for (const [field, value] of [["selector", { q: "search" }], ["selector", { value: ["duplicate-a"] }], ["selector", { id: Array.from({ length: 257 }, () => "a") }],
      ["update", {}], ["update", { value: "value", metadata: {} }], ["update", { value: "value", id: "changed" }], ["additional_data", null]] as const) {
      const input = Object.defineProperty(args("duplicate-a"), field, { value });
      expect(await runEffectFailure(host.run(host.newRequestKey(), input))).toMatchObject({ reason: "invalidInput" });
      expect(await inventory()).toEqual(before);
    }
  });

  it("keeps caught graph/method/foreign-resource refusals and hook failures fatal", async () => {
    await seed("failed-hook");
    const before = await inventory();
    const hooks: ProductTagUpdateWorkflowHooks[] = [
      { productTagsUpdated: () => { throw new Error("hook failed"); } },
      { productTagsUpdated: async (_input, { resources }) => { await resources.product.listProductTags({}, { select: ["not_a_field"], relations: [] }).catch(() => undefined); } },
      { productTagsUpdated: async (_input, { resources }) => { await resources.query.graph({ entity: "currency", fields: ["code"] }).catch(() => undefined); } },
      { productTagsUpdated: (_input, { container }) => { try { container.resolve("currency"); } catch { /* refusal remains owned by the root */ } } },
      { productTagsUpdated: async (_input, { resources }) => { for (let call = 0; call < 65; call++) await resources.product.listProductTags({}, { select: ["id"], relations: [] }); } },
    ];
    for (const hook of hooks) {
      const host = await assemble(hook);
      expect(Exit.isFailure(await runEffect(Effect.exit(host.run(host.newRequestKey(), args("failed-hook")))))).toBe(true);
      expect(await inventory()).toEqual(before);
    }
  }, 40_000);

  it("rolls back cancelled work and reconciles lost acknowledgement without repeating the hook", async () => {
    await seed("cancel-update");
    const reached = await runEffect(Deferred.make<void>());
    let release: (() => void) | undefined;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const cancelled = await assemble({ productTagsUpdated: async () => { await runEffect(Deferred.succeed(reached, undefined)); await wait; } });
    const before = await inventory();
    try {
      await runEffect(Effect.scoped(Effect.gen(function* () {
        const fiber = yield* Effect.forkScoped(cancelled.run(cancelled.newRequestKey(), args("cancel-update")));
        yield* Deferred.await(reached).pipe(Effect.timeout(5000));
        yield* Fiber.interrupt(fiber);
      })));
    } finally { release?.(); }
    expect(await inventory()).toEqual(before);
    let lose = true; let calls = 0;
    const session = issueRelationalSession(product.persistence.drizzle, work => runRelationalSession(product.session, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => { if (!lose) return Effect.succeed(value); lose = false;
        return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: "lost update acknowledgement" })); }),
    ));
    const host = await runEffect(prepareProductTagUpdateWorkflow({ ...options({ productTagsUpdated: () => { calls++; } }), execution: execution(session) }));
    const key = host.newRequestKey(); const result = await runEffect(host.run(key, args("cancel-update")));
    expect(await runEffect(host.run(key, args("cancel-update")))).toEqual(result); expect(calls).toBe(1);
    expect((await inventory()).events).toHaveLength(before.events.length + 2);
  });

  it.skipIf(driver !== "postgres")("hides pending writes from another connection and executes a duplicate request only once", async () => {
    await seed("isolated-update");
    let calls = 0;
    const host = await assemble({ productTagsUpdated: async () => {
      calls++;
      const current = await commerceInventory(product);
      expect(current.tables.product_tag?.find(row => row.id === "isolated-update")?.value).toBe("isolated-update");
    } });
    const before = await inventory(); const key = host.newRequestKey();
    const values = await Promise.all([runEffect(host.run(key, args("isolated-update"))), runEffect(host.run(key, args("isolated-update")))]);
    expect(values[0]).toEqual(values[1]); expect(calls).toBe(1);
    expect((await inventory()).data.commits).toHaveLength(before.data.commits.length + 1);
  });

  it("runs a Product-only selection beside Currency while preserving whole-binding replay and missing-member refusal", async () => {
    await seed("coexisting-update");
    const host = await assemble(); const key = host.newRequestKey();
    await runEffect(host.run(key, args("coexisting-update", "before-currency")));
    const currency = await commerceHostFixture(product.persistence, product.session, prepareCurrencyProfile,
      [currencyCommands.retrieve], control, undefined, {}, product);
    const before = await inventory();
    expect(await runEffectFailure(host.run(key, args("coexisting-update", "before-currency")))).toMatchObject({ reason: "requestConflict" });
    expect(await inventory()).toEqual(before);
    expect(await runEffect(host.run(host.newRequestKey(), args("coexisting-update", "alongside-currency")))).toMatchObject([{ value: "alongside-currency" }]);
    const current = await runEffect(currency.bindings.withCurrent(readAdmittedDataBinding));
    const candidate = await runEffect(currency.bindings.prepare({ ...currency.candidate.frame,
      commerce: commerceBindings(currency.candidate.frame).filter(binding => binding.installation.installationSha256 === currency.installation.installation.installationSha256),
    }));
    await runEffect(currency.bindings.activate(dataBindingActivationRequest(candidate.frame.application.scopeId, candidate.frame.application.storageGeneration,
      "update-remove-product", candidate.sha256, current.head)));
    expect(await runEffectFailure(host.run(host.newRequestKey(), args("coexisting-update")))).toMatchObject({ reason: "bindingChanged" });
  }, 100_000);

  it("rejects empty, excessive, duplicate and forged participant configurations", async () => {
    const participant = defineAtomicCommerceParticipant("product");
    const command = defineAtomicCommerceCommand("admissionOnly", () => Effect.succeed(null));
    const member = { participant, profile: product.prepared.profile, installation: product.installation,
      commands: [commands.commands.listTags], validate: policy.validate };
    for (const members of [[], Array.from({ length: 9 }, () => member)]) {
      expect(await runEffectFailure(makeAtomicCommerceHost({ ...product.hostInput, commands: [command], participants: members }))).toMatchObject({ reason: "unsupportedProfile" });
    }
    for (const members of [[member, member], [{ ...member, participant: { ...participant } }]]) {
      expect(await runEffectFailure(makeAtomicCommerceHost({ ...product.hostInput, commands: [command], participants: members }))).toMatchObject({ reason: "invalidAuthority" });
    }
  });
});
