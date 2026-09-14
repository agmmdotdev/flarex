import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Deferred, Effect, Exit, Fiber, Option, Result, Schema } from "effect";
import { createStep, createWorkflow, WorkflowResponse, type WorkflowData, type StepExecutionContext } from "@medusajs/workflows-sdk";
import { Link } from "@medusajs/modules-sdk/link";
import type { IPricingModuleService } from "@medusajs/framework/types";
import { defineCommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { makeLocalCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import { prepareLinkService } from "../src/link-service";
import { makeLocalProductCommands } from "../src/product-service";
import { makeLocalPricingCommands } from "../src/pricing-service";
import { prepareVariantPricingLink } from "../src/variant-pricing-link-service";
import { prepareProductVariantPricing, productVariantPricingResources, captureVariantPricingLinkMetadata } from "../src/product-variant-pricing-schema";
import { prepareProductVariantPricingWorkflow, productVariantPricingWorkflow, ProductVariantPricingInput, ProductVariantPricingOutput } from "../src/product-variant-pricing-workflow";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";
import { productModuleEventPolicy, productLocalEventPolicy } from "../src/product-local-events";
import { prepareAtomicWorkflowHost, type AtomicWorkflowHostComposition } from "../src/workflow/host";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../src/workflow/events";
import { commerceHostFixture, type CommerceHostTestFixture } from "../../persistence-postgres/test/commerceHostFixture";
import { commerceInventory } from "../../persistence-postgres/test/commerceInventory";
import { createRelationalPGliteFixture } from "../../persistence-postgres/test/relationalPGliteWorkerTestSupport";
import { createMigratedPGlitePersistence } from "../../persistence-postgres/test/pgliteTestFixture";
import { createFileScopedPostgresFixture } from "../../persistence-postgres/test/postgresHelpers";
import { makePostgresRelationalSession, issueRelationalSession, runRelationalSession } from "../../persistence-postgres/src/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/relationalTransaction/model";
import { makeCommitEventPump } from "../../persistence-postgres/src/commitEvents/pump";
import { CommitEventSubscriberFailure } from "../../persistence-postgres/src/commitEvents/model";
import { runEffect, runEffectFailure } from "../../persistence-postgres/test/effectTestRuntime";
import { requireCommerceProfile, registerLocalCommerceProfile } from "@flarex/persistence-postgres/internal/commerce-profile";
import { makeDataBindingHost, dataBindingActivationRequest } from "../../persistence-postgres/src/frameworkSchema/binding/host";
import { makeCommerceBinding } from "@flarex/persistence-postgres/internal/commerce";
import { readAdmittedDataBinding } from "../../persistence-postgres/src/frameworkSchema/binding/selection";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/atomicCommerce/host";
import { fxSystemCommitEvents, fxSystemCommitEventDeliveries } from "../../persistence-postgres/src/commitEvents/schema";

const cleanup: Array<() => Promise<void>> = [];
let fixture: CommerceHostTestFixture;
let product: Effect.Success<ReturnType<typeof makeLocalProductCommands>>;
let pricing: Effect.Success<ReturnType<typeof makeLocalPricingCommands>>;
let link: Effect.Success<ReturnType<typeof prepareVariantPricingLink>>;
let installed: Parameters<typeof prepareProductVariantPricingWorkflow>[0]["modules"];
let defaultInstalled: typeof installed;
let bindings: Effect.Success<ReturnType<typeof makeDataBindingHost>>;
let revision: string;
let linkHost: Effect.Success<ReturnType<typeof makeLocalCommerceHost>>["host"];
let dismissLink: ReturnType<typeof defineCommerceCommand>, restoreLink: ReturnType<typeof defineCommerceCommand>;
const execution = (session = fixture.session) => ({ identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
  prepare: (composition: AtomicWorkflowHostComposition) => makeAtomicCommerceHost({ ...fixture.hostInput, session, ...composition }),
});
const options = () => ({ execution: execution(), modules: installed, revision, subscribers: [{ id: "variant-pricing", revision: "b".repeat(64) }] });
const inventory = async () => ({ data: await commerceInventory(fixture), events: await fixture.persistence.drizzle.select().from(fxSystemCommitEvents).orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal),
  deliveries: await fixture.persistence.drizzle.select().from(fxSystemCommitEventDeliveries).orderBy(fxSystemCommitEventDeliveries.commitSeq, fxSystemCommitEventDeliveries.eventOrdinal) });
const input = (prefix: string, count = 4) => ({ product_id: prefix + "-product", variants: Array.from({ length: count }, (_, index) => ({
  id: prefix + "-variant-" + index, title: prefix + " " + index, options: { Size: String(index) }, priceSet: { id: prefix + "-set-" + index, prices: [
    { id: prefix + "-base-" + index, currency_code: "USD", amount: "123.4567890123456789", rules: { region_id: "r1" } },
    { id: prefix + "-other-" + index, currency_code: "EUR", amount: 200, rules: { region_id: "r2" } },
  ] },
})) });
async function seed(prefix: string) {
  await runEffect(fixture.host.run(fixture.host.newRequestKey(), product.commands.create, {
    id: prefix + "-product", title: prefix, options: [{ title: "Size", values: ["0", "1", "2", "3"] }],
  }));
}
const observe = async (after: (value: unknown, context: StepExecutionContext) => unknown | Promise<unknown>,
  output: Schema.ConstraintDecoder<Schema.Json> = ProductVariantPricingOutput, configuration = options()) => {
  const resources = Result.getOrThrow(prepareWorkflowResources({ product: { module: product.workflow, methods: ["createProductVariants"], graph: true },
    pricing: { module: pricing.workflow, methods: ["createPriceSets"], graph: true }, link: { module: link.workflow, methods: ["create"], graph: true },
  }, true));
  const flow = createWorkflow("observe-variant-pricing", (input: WorkflowData<typeof ProductVariantPricingInput.Type>) => {
    const result = productVariantPricingWorkflow.runAsStep({ input });
    const callback = createStep("after-native-pricing", resources.callback(async (value: unknown, context) => { await after(value, context); return value; }));
    return new WorkflowResponse(callback(result));
  });
  return runEffect(prepareAtomicWorkflowHost({ ...configuration, requestCallLimit: productVariantPricingResources.calls, workflow: { name: "observeVariantPricing", resources,
    prepared: Result.getOrThrow(flow.prepare()), input: ProductVariantPricingInput, output, events: internalModuleWorkflowEvents,
  } }));
};
beforeAll(async () => {
  const hash = createHash("sha256");
  for (const root of ["../src/", "../../medusa-workflows-sdk/src/", "../../medusa-core-flows/src/", "../../medusa-pricing/src/"]) {
    const directory = new URL(root, import.meta.url);
    for (const path of (await readdir(directory, { recursive: true })).filter(path => path.endsWith(".ts")).sort()) {
      hash.update(path); hash.update(await readFile(new URL(path.replaceAll("\\", "/"), directory)));
    }
  }
  hash.update(await readFile(new URL(import.meta.url))); revision = hash.digest("hex");
  const registerCleanup = (close: () => Promise<void>) => { cleanup.push(close); };
  const postgres = process.env.FLAREX_TEST_DRIVER === "postgres";
  const resource = postgres ? await (async () => { const database = await createFileScopedPostgresFixture(); registerCleanup(database.dispose);
    return { persistence: database.persistence, session: makePostgresRelationalSession(database.persistence) }; })() : await createRelationalPGliteFixture({ registerCleanup });
  const control = postgres ? resource.persistence : await createMigratedPGlitePersistence(registerCleanup);
  product = await runEffect(makeLocalProductCommands()); pricing = await runEffect(makeLocalPricingCommands()); link = await runEffect(prepareVariantPricingLink());
  const metadata = await runEffect(captureProductSchema("workflow-link-foundation").pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
  let selection: Effect.Success<ReturnType<typeof prepareProductVariantPricing>>["profiles"] | undefined;
  const prepare = (...args: Parameters<typeof prepareProductVariantPricing>) => prepareProductVariantPricing(...args).pipe(Effect.map(value => { selection = value.profiles; return { ...value, profile: value.profiles.product }; }));
  fixture = await commerceHostFixture(resource.persistence, resource.session, prepare, [product.commands.create], control, descriptor => productLocalEventPolicy(descriptor, metadata, () => Effect.void));
  if (!selection) throw new Error("Missing Pricing profiles");
  const profiles = Object.values(selection);
  const defaults = await Promise.all(profiles.map(async profile => {
    const descriptor = await runEffect(requireCommerceProfile(profile));
    return runEffect(registerLocalCommerceProfile(descriptor.artifact, descriptor.layout, descriptor.profileId + ".default",
      descriptor.tables.map(({ mode, ...table }) => ({ ...table, ...(mode === "readInsertUpdate" ? { update: "existingPrimaryKey" as const } : {}) })), undefined, descriptor.structuralTables));
  }));
  bindings = await runEffect(makeDataBindingHost({ ...fixture.bindingsInput, commerceProfiles: [...profiles, ...defaults] }));
  const binding = await runEffect(makeCommerceBinding(fixture.availability, profiles));
  const candidate = await runEffect(bindings.prepare({ ...fixture.candidate.frame, commerce: [binding] }));
  const current = await runEffect(fixture.bindings.withCurrent(readAdmittedDataBinding));
  await runEffect(bindings.activate(dataBindingActivationRequest(fixture.candidate.frame.application.scopeId, fixture.candidate.frame.application.storageGeneration, "workflow-link-foundation", candidate.sha256, current.head)));
  installed = {
    product: { module: product.workflow, profile: selection.product, installation: fixture.installation, moduleEvents: productModuleEventPolicy(fixture.descriptor, metadata) },
    pricing: { module: pricing.workflow, profile: selection.pricing, installation: fixture.installation, moduleEvents: pricing.eventPolicy(await runEffect(requireCommerceProfile(selection.pricing)), () => Effect.void) },
    link: { module: link.workflow, profile: selection.link, installation: fixture.installation, moduleEvents: link.eventPolicy(await runEffect(requireCommerceProfile(selection.link)), () => Effect.void) },
  };
  const [defaultProduct, defaultPricing, defaultLink] = defaults;
  if (!defaultProduct || !defaultPricing || !defaultLink) throw new Error("Missing default Pricing profiles");
  defaultInstalled = { product: { ...installed.product, profile: defaultProduct }, pricing: { ...installed.pricing, profile: defaultPricing }, link: { ...installed.link, profile: defaultLink } };
  const native = await runEffect(prepareLinkService(await runEffect(captureVariantPricingLinkMetadata())));
  const decodePair = Schema.decodeUnknownSync(Schema.Struct({ product: Schema.Struct({ variant_id: Schema.String }), pricing: Schema.Struct({ price_set_id: Schema.String }) }));
  dismissLink = defineCommerceCommand("linkDismiss", "write", (ctx, args) => native.use(ctx, scope => scope.link.dismiss(decodePair(args), scope.context)));
  // Constraint characterization selects native Link-module restoration only;
  // cross-module cascade traversal remains outside the workflow capability.
  restoreLink = defineCommerceCommand("linkRestore", "write", (ctx, args) => native.use(ctx, async scope => {
    await scope.service.restore({ price_set_id: Schema.decodeUnknownSync(Schema.String)(args) }, {}, scope.context);
    return null;
  }));
  linkHost = (await runEffect(makeLocalCommerceHost({ ...fixture.hostInput, profile: installed.link.profile, commands: [...link.commands, dismissLink, restoreLink] }, link.eventPolicy(await runEffect(requireCommerceProfile(installed.link.profile)), () => Effect.void)))).host;
});
afterAll(async () => { for (const close of cleanup.reverse()) await close(); });
describe("connected native Product Variant Pricing", () => {
  it("creates the maximum graph, links actual identities, reads pending rows and settles once", async () => {
    await seed("maximum");
    const host = await runEffect(prepareProductVariantPricingWorkflow(options()));
    const before = await inventory(), key = host.newRequestKey();
    const result = await runEffect(host.run(key, input("maximum")));
    expect(result.variants).toHaveLength(4); expect(result.priceSets).toHaveLength(4); expect(result.links).toHaveLength(4);
    for (const variant of result.variants) {
      const association = result.links.find(link => link.variant_id === variant.id);
      expect(result.priceSets.find(set => set.id === association?.price_set_id)?.prices).toHaveLength(2);
    }
    const after = await inventory();
    expect(after.data.commits).toHaveLength(before.data.commits.length + 1);
    expect(after.data.outcomes).toHaveLength(before.data.outcomes.length + 1);
    expect(after.data.facts.slice(before.data.facts.length)).toHaveLength(32);
    expect(after.events.slice(before.events.length).map(event => event.envelope.contract).sort()).toEqual([
      "LinkProductVariantPriceSet.attached", ...Array.from({ length: 4 }, () => "product.product-variant.created"),
      ...Array.from({ length: 4 }, () => "pricing.price-set.created"), ...Array.from({ length: 8 }, () => "pricing.price.created"),
      ...Array.from({ length: 8 }, () => "pricing.price-rule.created"),
    ].sort());
    expect(after.deliveries).toHaveLength(before.deliveries.length + 25);
    expect(await runEffect(host.run(key, input("maximum")))).toEqual(result);
    expect(await inventory()).toEqual(after);
  });
  it("rejects invalid options and oversized inputs without committing any child work", async () => {
    await seed("invalid");
    const host = await runEffect(prepareProductVariantPricingWorkflow(options()));
    const before = await inventory();
    const invalid = input("invalid", 1);
    const variant = invalid.variants[0];
    if (variant === undefined) throw new Error("Missing invalid variant fixture");
    variant.options.Size = "missing";
    expect(await runEffectFailure(host.run(host.newRequestKey(), invalid))).toMatchObject({ _tag: "CommerceTransactionError" });
    expect(await inventory()).toEqual(before);
    expect(await runEffectFailure(host.run(host.newRequestKey(), input("invalid", 5)))).toMatchObject({ _tag: "CommerceTransactionError" });
    expect(await inventory()).toEqual(before);
  });
  it("associates generated native identities and retains structural PriceList without rows", async () => {
    await seed("generated");
    const host = await runEffect(prepareProductVariantPricingWorkflow(options()));
    const result = await runEffect(host.run(host.newRequestKey(), { product_id: "generated-product", variants: [
      { title: "Generated", options: { Size: "0" }, priceSet: { prices: [{ currency_code: "USD", amount: 50 }] } },
      { title: "Empty", options: { Size: "1" } },
    ] }));
    expect(result.variants.every(variant => variant.id.startsWith("variant_"))).toBe(true);
    expect(result.priceSets.every(set => set.id.startsWith("pset_"))).toBe(true);
    expect(result.links.map(link => link.variant_id).sort()).toEqual(result.variants.map(variant => variant.id).sort());
    expect(result.links.map(link => link.price_set_id).sort()).toEqual(result.priceSets.map(set => set.id).sort());
    expect(result.priceSets.map(set => set.prices.length).sort()).toEqual([0, 1]);
    expect((await inventory()).data.tables.price_list).toEqual([]);
    const descriptor = await runEffect(requireCommerceProfile(installed.pricing.profile));
    expect(descriptor.structuralTables).toEqual(["price_list"]);
    expect(descriptor.tables.map(table => table.tableId).sort()).toEqual(["price", "price_rule", "price_set"]);
  });
  it("rolls back late and output failures across the maximum graph without native compensation", async () => {
    await seed("late"); await seed("output");
    const before = await inventory();
    const compensate = vi.spyOn(Link.prototype, "dismiss");
    const reached = vi.fn(() => { throw new Error("Late Pricing parent failure"); });
    try {
      const host = await observe(reached);
      expect(Exit.isFailure(await runEffect(Effect.exit(host.run(host.newRequestKey(), input("late")))))).toBe(true);
      expect(reached).toHaveBeenCalledTimes(1); expect(await inventory()).toEqual(before);
      const output = await observe(() => undefined, Schema.Null);
      expect(await runEffectFailure(output.run(output.newRequestKey(), input("output")))).toMatchObject({ reason: "storedCorruption" });
      expect(await inventory()).toEqual(before); expect(compensate).not.toHaveBeenCalled();
    } finally { compensate.mockRestore(); }
  });
  it("keeps caught unselected methods and hydration fatal after maximum pending creation", async () => {
    const callbacks = [
      async (_value: unknown, { container }: StepExecutionContext) => {
        const service = container.resolve<Pick<IPricingModuleService, "calculatePrices">>("pricing");
        try { await service.calculatePrices({ id: [] }); } catch { /* The borrowed refusal remains fatal. */ }
      },
      async (_value: unknown, { container }: StepExecutionContext) => {
        const service = container.resolve<Pick<IPricingModuleService, "createPriceLists">>("pricing");
        try { await service.createPriceLists([]); } catch { /* Even an empty unselected write is refused. */ }
      },
      async (_value: unknown, { container }: StepExecutionContext) => {
        const query = container.resolve<{ graph(input: Schema.Json): Promise<unknown> }>("query");
        try { await query.graph({ entity: "price_set", fields: ["variant.id"], pagination: { take: 1 } }); } catch { /* Cross-module hydration is unadmitted. */ }
      },
      async (_value: unknown, { container }: StepExecutionContext) => {
        const native = container.resolve<{ restore(input: Schema.Json): Promise<unknown> }>("link");
        try { await native.restore({ pricing: { price_set_id: [] } }); } catch { /* Cascade restoration is not a workflow capability. */ }
      },
    ];
    for (const [index, callback] of callbacks.entries()) {
      const prefix = "caught-" + index; await seed(prefix);
      const before = await inventory(), reached = vi.fn(callback), host = await observe(reached);
      expect(Exit.isFailure(await runEffect(Effect.exit(host.run(host.newRequestKey(), input(prefix)))))).toBe(true);
      expect(reached).toHaveBeenCalledTimes(1); expect(await inventory()).toEqual(before);
    }
  });
  it("binds revisions and each participant profile to retained outcomes", async () => {
    await seed("identity");
    const host = await runEffect(prepareProductVariantPricingWorkflow(options()));
    const key = host.newRequestKey(); await runEffect(host.run(key, input("identity")));
    const before = await inventory();
    const changed = await runEffect(prepareProductVariantPricingWorkflow({ ...options(), revision: "f".repeat(64) }));
    expect(await runEffectFailure(changed.run(key, input("identity")))).toMatchObject({ reason: "requestConflict" });
    let attempt = 0;
    const activate = async (modules: typeof installed) => {
      const binding = await runEffect(makeCommerceBinding(fixture.availability, Object.values(modules).map(module => module.profile)));
      const candidate = await runEffect(bindings.prepare({ ...fixture.candidate.frame, commerce: [binding] }));
      const current = await runEffect(bindings.withCurrent(readAdmittedDataBinding));
      await runEffect(bindings.activate(dataBindingActivationRequest(fixture.candidate.frame.application.scopeId, fixture.candidate.frame.application.storageGeneration,
        "pricing-profile-" + ++attempt, candidate.sha256, current.head)));
    };
    for (const name of ["product", "pricing", "link"] as const) {
      const selected = await runEffect(requireCommerceProfile(installed[name].profile)), defaults = await runEffect(requireCommerceProfile(defaultInstalled[name].profile));
      expect(selected.resources).toEqual({ ...defaults.resources, calls: 128 }); expect(defaults.resources.calls).toBe(64);
      expect(selected.contractSha256).not.toBe(defaults.contractSha256);
      const modules = { ...installed, [name]: defaultInstalled[name] }; await activate(modules);
      try {
        const replaced = await runEffect(prepareProductVariantPricingWorkflow({ ...options(), modules }));
        expect(await runEffectFailure(replaced.run(key, input("identity")))).toMatchObject({ reason: "requestConflict" });
      } finally { await activate(installed); }
    }
    expect(await inventory()).toEqual(before);
  });
  it("preserves both singular Link endpoints and conflicting restore", async () => {
    const pair = (variant: string, set: string) => ({ product: { variant_id: variant }, pricing: { price_set_id: set } });
    const create = (value: Schema.Json) => runEffect(linkHost.run(linkHost.newRequestKey(), link.create, value));
    await create(pair("unique-a", "set-a"));
    const before = await inventory();
    for (const value of [pair("unique-a", "set-b"), pair("unique-b", "set-a")]) {
      expect(Exit.isFailure(await runEffect(Effect.exit(linkHost.run(linkHost.newRequestKey(), link.create, value))))).toBe(true);
      expect(await inventory()).toEqual(before);
    }
    await runEffect(linkHost.run(linkHost.newRequestKey(), dismissLink, pair("unique-a", "set-a")));
    await create(pair("unique-a", "set-b"));
    const conflict = await inventory();
    expect(Exit.isFailure(await runEffect(Effect.exit(linkHost.run(linkHost.newRequestKey(), restoreLink, "set-a"))))).toBe(true);
    expect(await inventory()).toEqual(conflict);
    await runEffect(linkHost.run(linkHost.newRequestKey(), dismissLink, pair("unique-a", "set-b")));
    await runEffect(linkHost.run(linkHost.newRequestKey(), restoreLink, "set-a"));
    expect(await runEffect(linkHost.read(link.count, { filters: { variant_id: "unique-a" } }))).toEqual([[expect.objectContaining({ price_set_id: "set-a", deleted_at: null })], 1]);
  });
  it("cancels maximum pending work and revokes escaped native methods", async () => {
    await seed("cancelled");
    const reached = await runEffect(Deferred.make<void>());
    let release: (() => void) | undefined;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    let escaped = Option.none<Pick<IPricingModuleService, "createPriceSets">>();
    const host = await observe(async (_value, { container }) => {
      escaped = Option.some(container.resolve("pricing"));
      await runEffect(Deferred.succeed(reached, undefined)); await waiting;
    });
    const before = await inventory();
    try {
      await runEffect(Effect.scoped(Effect.gen(function* () {
        const fiber = yield* Effect.forkScoped(host.run(host.newRequestKey(), input("cancelled")));
        yield* Deferred.await(reached).pipe(Effect.timeout(10000)); yield* Fiber.interrupt(fiber);
      })));
    } finally { release?.(); }
    expect(await inventory()).toEqual(before);
    await expect(Option.getOrThrow(escaped).createPriceSets([])).rejects.toMatchObject({ reason: "closed" });
  });
  it("recovers uncertain maximum settlement without repeating native callbacks", async () => {
    await seed("uncertain");
    let lose = true;
    const session = issueRelationalSession(fixture.persistence.drizzle, work => runRelationalSession(fixture.session, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => {
        if (!lose) return Effect.succeed(value);
        lose = false;
        return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost Pricing COMMIT acknowledgement") }));
      }),
    ));
    const reached = vi.fn(), host = await observe(reached, ProductVariantPricingOutput, { ...options(), execution: execution(session) });
    const before = await inventory(), key = host.newRequestKey(), result = await runEffect(host.run(key, input("uncertain")));
    const after = await inventory();
    expect(after.data.commits).toHaveLength(before.data.commits.length + 1); expect(after.data.facts).toHaveLength(before.data.facts.length + 32);
    expect(after.events).toHaveLength(before.events.length + 25);
    expect(await runEffect(host.run(key, input("uncertain")))).toEqual(result);
    expect(reached).toHaveBeenCalledTimes(1); expect(await inventory()).toEqual(after);
  });
  it("retains committed maximum work after subscriber failure", async () => {
    await seed("subscriber");
    const host = await runEffect(prepareProductVariantPricingWorkflow(options()));
    const key = host.newRequestKey(), result = await runEffect(host.run(key, input("subscriber")));
    const before = await inventory(), commit = before.data.commits.at(-1);
    if (!commit) throw new Error("Missing Pricing commit");
    const handle = vi.fn(() => Effect.fail(new CommitEventSubscriberFailure({ retryable: true, code: "offline" })));
    const pump = await runEffect(makeCommitEventPump(fixture.hostInput, options().subscribers.map(subscriber => ({ ...subscriber, handle }))));
    await runEffect(pump.runNext(commit.commitSeq - 1n));
    expect(handle).toHaveBeenCalledTimes(25);
    const after = await inventory();
    expect(after.data).toEqual(before.data); expect(after.events).toEqual(before.events);
    expect(after.deliveries.filter(row => row.commitSeq === commit.commitSeq).every(row => row.attempts === 1 && row.state !== "delivered")).toBe(true);
    expect(await runEffect(host.run(key, input("subscriber")))).toEqual(result);
  });
});
