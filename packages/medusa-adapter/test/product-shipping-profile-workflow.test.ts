import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Cause, Deferred, Effect, Exit, Fiber, Option, Result, Schema } from "effect";
import { createStep, createWorkflow, WorkflowResponse, type WorkflowData, type StepExecutionContext } from "@medusajs/workflows-sdk";
import { associateProductsWithSalesChannelsStep } from "@medusajs/core-flows/sales-channel/associate-products-with-channels-step";
import { createRemoteLinkStep } from "@medusajs/core-flows/common/create-remote-links-step";
import { Link } from "@medusajs/modules-sdk/link";
import type { IFulfillmentModuleService } from "@medusajs/types";
import { defineCommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { prepareLinkService } from "../src/link-service";
import { captureProductShippingProfileLinkMetadata } from "../src/product-shipping-profile-link-schema";
import { makeLocalProductCommands } from "../src/product-service";
import { makeLocalSalesChannelCommands } from "../src/sales-channel-service";
import { prepareLocalProductLinks } from "../src/product-link-service";
import { makeLocalShippingProfileCommands } from "../src/shipping-profile-service";
import { prepareProductShippingProfileWorkflow, productShippingProfileWorkflow, ProductShippingProfileInput, ProductShippingProfileOutput } from "../src/product-shipping-profile-workflow";
import { prepareProductShippingProfile } from "../src/product-shipping-profile-schema";
import { productShippingProfileResources } from "../src/product-shipping-profile-contract";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";
import { productModuleEventPolicy } from "../src/product-local-events";
import { prepareAtomicWorkflowHost, type AtomicWorkflowHostComposition } from "../src/workflow/host";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../src/workflow/events";
import { CommerceTransactionError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceHostFixture, type CommerceHostTestFixture } from "../../persistence-postgres/test/commerceHostFixture";
import { commerceInventory } from "../../persistence-postgres/test/commerceInventory";
import { createRelationalPGliteFixture } from "../../persistence-postgres/test/relationalPGliteWorkerTestSupport";
import { createMigratedPGlitePersistence } from "../../persistence-postgres/test/pgliteTestFixture";
import { createFileScopedPostgresFixture } from "../../persistence-postgres/test/postgresHelpers";
import { makePostgresRelationalSession } from "../../persistence-postgres/src/relationalTransaction/session";
import { issueRelationalSession, runRelationalSession } from "../../persistence-postgres/src/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/relationalTransaction/model";
import { makeCommitEventPump } from "../../persistence-postgres/src/commitEvents/pump";
import { CommitEventSubscriberFailure } from "../../persistence-postgres/src/commitEvents/model";
import { runEffect, runEffectFailure } from "../../persistence-postgres/test/effectTestRuntime";
import { registerLocalCommerceProfile, requireCommerceProfile } from "@flarex/persistence-postgres/internal/commerce-profile";
import { makeDataBindingHost, dataBindingActivationRequest } from "../../persistence-postgres/src/frameworkSchema/binding/host";
import { makeCommerceBinding } from "@flarex/persistence-postgres/internal/commerce";
import { readAdmittedDataBinding } from "../../persistence-postgres/src/frameworkSchema/binding/selection";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/atomicCommerce/host";
import { fxSystemCommitEvents, fxSystemCommitEventDeliveries } from "../../persistence-postgres/src/commitEvents/schema";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid workflow test driver");
const cleanup: Array<() => Promise<void>> = [];
let fixture: CommerceHostTestFixture;
let product: Effect.Success<ReturnType<typeof makeLocalProductCommands>>;
let sales: Effect.Success<ReturnType<typeof makeLocalSalesChannelCommands>>;
let link: Effect.Success<ReturnType<typeof prepareLocalProductLinks>>;
let shipping: Effect.Success<ReturnType<typeof makeLocalShippingProfileCommands>>;
let installed: Parameters<typeof prepareProductShippingProfileWorkflow>[0]["modules"];
let defaultInstalled: typeof installed;
let restoreShipping: ReturnType<typeof defineCommerceCommand>;
let resourceBindings: Effect.Success<ReturnType<typeof makeDataBindingHost>>;
let revision: string;
const execution = (session = fixture.session) => ({ identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
  prepare: (composition: AtomicWorkflowHostComposition) => makeAtomicCommerceHost({ ...fixture.hostInput, session, ...composition }),
});
const options = () => ({ execution: execution(),
  modules: installed, revision, subscribers: [{ id: "product-shipping-profile", revision: "a".repeat(64) }] });
const inventory = async () => ({ data: await commerceInventory(fixture),
  events: await fixture.persistence.drizzle.select().from(fxSystemCommitEvents).orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal),
  deliveries: await fixture.persistence.drizzle.select().from(fxSystemCommitEventDeliveries).orderBy(fxSystemCommitEventDeliveries.commitSeq, fxSystemCommitEventDeliveries.eventOrdinal),
});
const input = (prefix: string, count = 1) => ({ shippingProfile: { id: prefix + "-profile", name: prefix, type: "default" }, salesChannel: { id: prefix + "-channel", name: prefix },
  products: Array.from({ length: count }, (_, index) => ({ id: prefix + "-" + index, title: prefix + "-" + index })),
});

const observe = async (after: (value: unknown, context: StepExecutionContext) => unknown | Promise<unknown>,
  output: Schema.ConstraintDecoder<Schema.Json> = ProductShippingProfileOutput, configuration = options()) => {
  const resources = Result.getOrThrow(prepareWorkflowResources({
    product: { module: product.workflow, methods: ["createProducts"], graph: true },
    sales_channel: { module: sales.workflow, methods: ["createSalesChannels"], graph: true },
    fulfillment: { module: shipping.workflow, methods: ["createShippingProfiles"], graph: true },
    link: { module: link.workflow, methods: ["create"], graph: true },
  }, true));
  const flow = createWorkflow("observe-product-shipping-profile", (input: WorkflowData<typeof ProductShippingProfileInput.Type>) => {
    const result = productShippingProfileWorkflow.runAsStep({ input });
    const callback = createStep("after-native-creation", resources.callback(async (value: unknown, context) => { await after(value, context); return value; }));
    return new WorkflowResponse(callback(result));
  });
  return runEffect(prepareAtomicWorkflowHost({ ...configuration, requestCallLimit: productShippingProfileResources.calls, workflow: { name: "observeProductShippingProfile", resources,
    prepared: Result.getOrThrow(flow.prepare()), input: ProductShippingProfileInput, output, events: internalModuleWorkflowEvents,
  } }));
};
const Pairs = Schema.Struct({ links: Schema.Array(Schema.Struct({ product_id: Schema.String, sales_channel_id: Schema.String })).check(Schema.isMaxLength(256)).pipe(Schema.mutable) });
const associate = async (after: (context: StepExecutionContext) => void | Promise<void> = () => undefined) => {
  const resources = Result.getOrThrow(prepareWorkflowResources({ link: { module: link.workflow, methods: ["create"], graph: true } }, true));
  const flow = createWorkflow("associate-existing-products", (input: WorkflowData<typeof Pairs.Type>) => {
    const result = associateProductsWithSalesChannelsStep({ links: input.links });
    const callback = createStep("after-native-association", resources.callback(async (value: unknown, context) => { await after(context); return value; }));
    return new WorkflowResponse(callback(result));
  });
  return runEffect(prepareAtomicWorkflowHost({ ...options(), modules: { link: installed.link }, workflow: { name: "associateExistingProducts", resources,
    prepared: Result.getOrThrow(flow.prepare()), input: Pairs, output: Schema.Array(Schema.JsonObject), events: internalModuleWorkflowEvents,
  } }));
};
const ShippingPairs = Schema.Struct({ links: Schema.Array(Schema.Struct({
  product: Schema.Struct({ product_id: Schema.String }), fulfillment: Schema.Struct({ shipping_profile_id: Schema.String }),
})).pipe(Schema.mutable) });
const associateShipping = async (after: () => void | Promise<void> = () => undefined) => {
  const resources = Result.getOrThrow(prepareWorkflowResources({ link: { module: link.workflow, methods: ["create"], graph: true } }, true));
  const flow = createWorkflow("associate-existing-shipping-profiles", (input: WorkflowData<typeof ShippingPairs.Type>) => {
    const result = createRemoteLinkStep(input.links);
    const callback = createStep("after-shipping-association", resources.callback(async (value: unknown) => { await after(); return value; }));
    return new WorkflowResponse(callback(result));
  });
  return runEffect(prepareAtomicWorkflowHost({ ...options(), modules: { link: installed.link }, workflow: { name: "associateShippingProfiles", resources,
    prepared: Result.getOrThrow(flow.prepare()), input: ShippingPairs, output: Schema.Array(Schema.JsonObject), events: internalModuleWorkflowEvents,
  } }));
};

beforeAll(async () => {
  const hash = createHash("sha256");
  for (const root of ["../src/", "../../medusa-workflows-sdk/src/", "../../medusa-core-flows/src/"]) {
    const directory = new URL(root, import.meta.url);
    for (const path of (await readdir(directory, { recursive: true })).filter(path => path.endsWith(".ts")).sort()) {
      hash.update(path); hash.update(await readFile(new URL(path.replaceAll("\\", "/"), directory)));
    }
  }
  hash.update(await readFile(new URL(import.meta.url))); revision = hash.digest("hex");
  const registerCleanup = (close: () => Promise<void>) => { cleanup.push(close); };
  const resource = driver === "pglite" ? await createRelationalPGliteFixture({ registerCleanup }) : await (async () => {
    const database = await createFileScopedPostgresFixture(); registerCleanup(database.dispose);
    return { persistence: database.persistence, session: makePostgresRelationalSession(database.persistence) };
  })();
  const control = driver === "pglite" ? await createMigratedPGlitePersistence(registerCleanup) : resource.persistence;
  product = await runEffect(makeLocalProductCommands());
  sales = await runEffect(makeLocalSalesChannelCommands());
  shipping = await runEffect(makeLocalShippingProfileCommands());
  link = await runEffect(prepareLocalProductLinks());
  const shippingLink = await runEffect(captureProductShippingProfileLinkMetadata().pipe(Effect.flatMap(prepareLinkService)));
  restoreShipping = defineCommerceCommand("linkRestore", "write", (ctx, args) => shippingLink.use(ctx, async native =>
    native.cascade(await native.link.restore({ fulfillment: { shipping_profile_id: Schema.decodeUnknownSync(Schema.String)(args) } }, native.context))));
  let selection: Effect.Success<ReturnType<typeof prepareProductShippingProfile>>["profiles"] | undefined;
  const prepare = (...args: Parameters<typeof prepareProductShippingProfile>) => prepareProductShippingProfile(...args).pipe(
    Effect.tap(value => Effect.sync(() => { selection = value.profiles; })),
  );
  fixture = await commerceHostFixture(resource.persistence, resource.session, prepare,
    [...link.commands, restoreShipping], control, descriptor => link.eventPolicy(descriptor, () => Effect.void));
  const descriptor = fixture.descriptor;
  if (selection === undefined) throw new Error("Missing prepared workflow profiles");
  const { product: productProfile, sales_channel: salesProfile, fulfillment: shippingProfile } = selection;
  const defaultProfile = async (profile: typeof productProfile) => {
    const state = await runEffect(requireCommerceProfile(profile));
    return runEffect(registerLocalCommerceProfile(state.artifact, state.layout, state.profileId + ".default", state.tables.map(({ mode, ...table }) => ({
      ...table, ...(mode === "readInsertUpdate" ? { update: "existingPrimaryKey" as const } : {}),
    }))));
  };
  const defaults = { product: await defaultProfile(selection.product), sales_channel: await defaultProfile(selection.sales_channel),
    fulfillment: await defaultProfile(selection.fulfillment), link: await defaultProfile(selection.link) };
  const profiles = Object.values(selection);
  const bindings = await runEffect(makeDataBindingHost({ ...fixture.bindingsInput, commerceProfiles: [...profiles, ...Object.values(defaults)] }));
  resourceBindings = bindings;
  const binding = await runEffect(makeCommerceBinding(fixture.availability, profiles));
  const candidate = await runEffect(bindings.prepare({ ...fixture.candidate.frame, commerce: [binding] }));
  const current = await runEffect(fixture.bindings.withCurrent(readAdmittedDataBinding));
  await runEffect(bindings.activate(dataBindingActivationRequest(fixture.candidate.frame.application.scopeId,
    fixture.candidate.frame.application.storageGeneration, "workflow-link-foundation", candidate.sha256, current.head)));
  const metadata = await runEffect(captureProductSchema("workflow-link-foundation").pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
  installed = {
    product: { module: product.workflow, profile: productProfile, installation: fixture.installation,
      moduleEvents: productModuleEventPolicy(await runEffect(requireCommerceProfile(productProfile)), metadata) },
    sales_channel: { module: sales.workflow, profile: salesProfile, installation: fixture.installation,
      moduleEvents: sales.eventPolicy(await runEffect(requireCommerceProfile(salesProfile)), () => Effect.void) },
    fulfillment: { module: shipping.workflow, profile: shippingProfile, installation: fixture.installation,
      moduleEvents: shipping.eventPolicy(await runEffect(requireCommerceProfile(shippingProfile)), () => Effect.void) },
    link: { module: link.workflow, profile: fixture.prepared.profile, installation: fixture.installation,
      moduleEvents: link.eventPolicy(descriptor, () => Effect.void) },
  };
  defaultInstalled = { product: { ...installed.product, profile: defaults.product },
    sales_channel: { ...installed.sales_channel, profile: defaults.sales_channel },
    fulfillment: { ...installed.fulfillment, profile: defaults.fulfillment }, link: { ...installed.link, profile: defaults.link } };
});
afterAll(async () => {
  const failures: unknown[] = [];
  for (const close of cleanup.reverse()) await close().catch(cause => { failures.push(cause); });
  if (failures.length) throw new AggregateError(failures, "Workflow fixture cleanup failed");
});

describe("native Product ShippingProfile workflow", () => {
  it("retains every participant's cap and binds the private profile identity to replay", async () => {
    let activation = 0;
    const activate = async (modules: typeof installed) => {
      const profiles = Object.values(modules).map(module => module.profile);
      const binding = await runEffect(makeCommerceBinding(fixture.availability, profiles));
      const candidate = await runEffect(resourceBindings.prepare({ ...fixture.candidate.frame, commerce: [binding] }));
      const current = await runEffect(resourceBindings.withCurrent(readAdmittedDataBinding));
      await runEffect(resourceBindings.activate(dataBindingActivationRequest(fixture.candidate.frame.application.scopeId,
        fixture.candidate.frame.application.storageGeneration, "workflow-resource-cap-" + ++activation, candidate.sha256, current.head)));
    };
    const host = await runEffect(prepareProductShippingProfileWorkflow(options()));
    const key = host.newRequestKey();
    await runEffect(host.run(key, input("profile-identity")));
    const before = await inventory();
    for (const name of ["product", "sales_channel", "fulfillment", "link"] as const) {
      const selected = await runEffect(requireCommerceProfile(installed[name].profile));
      const previous = await runEffect(requireCommerceProfile(defaultInstalled[name].profile));
      expect(selected.resources).toEqual({ ...previous.resources, calls: 128 });
      expect(previous.resources.calls).toBe(64);
      expect(selected.contractSha256).not.toBe(previous.contractSha256);
      const modules = { ...installed, [name]: defaultInstalled[name] };
      await activate(modules);
      try {
        const capped = await runEffect(prepareProductShippingProfileWorkflow({ ...options(), modules }));
        expect(await runEffectFailure(capped.run(key, input("profile-identity")))).toMatchObject({ reason: "requestConflict" });
        const failure = await runEffectFailure(capped.run(capped.newRequestKey(), input("cap-" + name)));
        expect(failure.reason).toBe("rollbackOnly");
        if (!Cause.isCause(failure.cause)) throw new Error("Missing participant-cap cause");
        expect(failure.cause.reasons.some(reason => Cause.isFailReason(reason)
          && reason.error instanceof CommerceTransactionError && reason.error.reason === "limitExceeded")).toBe(true);
        expect(await inventory()).toEqual(before);
      } finally { await activate(installed); }
    }
  });
  it("preserves singular ShippingProfile assignment, profile reuse and conflicting restore", async () => {
    const pair = (product: string, profile: string) => ({ product: { product_id: product }, fulfillment: { shipping_profile_id: profile } });
    const create = (value: Schema.Json) => runEffect(fixture.host.run(fixture.host.newRequestKey(), link.create, value));
    const dismiss = (value: Schema.Json) => runEffect(fixture.host.run(fixture.host.newRequestKey(), link.dismiss, value));
    expect(await create([pair("shared-a", "profile-a"), pair("shared-b", "profile-a")])).toHaveLength(2);
    const before = await inventory();
    expect(Exit.isFailure(await runEffect(Effect.exit(fixture.host.run(fixture.host.newRequestKey(), link.create, pair("shared-a", "profile-b")))))).toBe(true);
    expect(await inventory()).toEqual(before);
    await dismiss(pair("shared-a", "profile-a"));
    await create(pair("shared-a", "profile-b"));
    const conflict = await inventory();
    expect(Exit.isFailure(await runEffect(Effect.exit(fixture.host.run(fixture.host.newRequestKey(), restoreShipping, "profile-a"))))).toBe(true);
    expect(await inventory()).toEqual(conflict);
    await dismiss(pair("shared-a", "profile-b"));
    await runEffect(fixture.host.run(fixture.host.newRequestKey(), restoreShipping, "profile-a"));
    expect(await runEffect(fixture.host.read(link.countShipping, { filters: { shipping_profile_id: "profile-a" } })))
      .toEqual([[expect.objectContaining({ product_id: "shared-a", deleted_at: null }), expect.objectContaining({ product_id: "shared-b", deleted_at: null })], 2]);
  });
  it("refuses a caught mixed-family call before native dispatch and rolls back pending endpoints", async () => {
    const dispatch = vi.spyOn(Link.prototype, "create");
    const before = await inventory();
    let reached = false;
    const host = await observe(async (_value, { container }) => {
      reached = true;
      const native = container.resolve<{ create(value: Schema.Json): Promise<unknown> }>("link");
      const calls = dispatch.mock.calls.length;
      try { await native.create([{ product: { product_id: "mixed" }, sales_channel: { sales_channel_id: "sc" } },
        { product: { product_id: "mixed" }, fulfillment: { shipping_profile_id: "sp" } }]); } catch { /* Refusal remains latched. */ }
      expect(dispatch).toHaveBeenCalledTimes(calls);
    });
    try {
      expect(Exit.isFailure(await runEffect(Effect.exit(host.run(host.newRequestKey(), input("mixed")))))).toBe(true);
      expect(reached).toBe(true); expect(await inventory()).toEqual(before);
    } finally { dispatch.mockRestore(); }
  });
  it("preserves the current call-budget refusal and atomically rolls back the complete minimum envelope", async () => {
    // The default root budget remains distinct from the admitted private profile.
    const host = await runEffect(prepareProductShippingProfileWorkflow({ ...options(), execution: {
      ...execution(), prepare: composition => execution().prepare({ ...composition, requestCallLimit: 64 }),
    } }));
    const before = await inventory();
    const failure = await runEffectFailure(host.run(host.newRequestKey(), input("budget-boundary")));
    expect(failure.reason).toBe("rollbackOnly");
    if (!Cause.isCause(failure.cause)) throw new Error("Missing call-budget refusal cause");
    expect(failure.cause.reasons.some(reason => Cause.isFailReason(reason)
      && reason.error instanceof CommerceTransactionError && reason.error.reason === "limitExceeded")).toBe(true);
    expect(await inventory()).toEqual(before);
  });
  it("fits the complete four-Product envelope within the admitted 128-call contract", async () => {
    const host = await runEffect(prepareProductShippingProfileWorkflow(options()));
    const result = await runEffect(host.run(host.newRequestKey(), input("maximum", 4)));
    expect(result.products).toHaveLength(4); expect(result.links).toHaveLength(4);
    expect(result.shippingProfiles).toHaveLength(1); expect(result.shippingLinks).toHaveLength(4);
    const before = await inventory();
    // @ts-expect-error test the external runtime contract, not just its static type
    expect(await runEffectFailure(host.run(host.newRequestKey(), { ...input("wide"), products: [{ title: "unsupported", options: [] }] }))).toMatchObject({ reason: "invalidInput" });
    expect(await runEffectFailure(host.run(host.newRequestKey(), input("oversized", 5)))).toMatchObject({ reason: "invalidInput" });
    expect(await inventory()).toEqual(before);
  });
  it("creates endpoints and links in one root, reads pending state, and replays", async () => {
    const host = await runEffect(prepareProductShippingProfileWorkflow(options()));
    const before = await inventory();
    const key = host.newRequestKey();
    const result = await runEffect(host.run(key, input("connected")));
    expect(result.products).toEqual([{ id: "connected-0", title: "connected-0" }]);
    expect(result.salesChannels).toEqual([{ id: "connected-channel", name: "connected" }]);
    expect(result.links).toEqual([{ id: expect.stringMatching(/^prodsc_/), product_id: "connected-0", sales_channel_id: "connected-channel" }]);
    const after = await inventory();
    expect(after.data.commits).toHaveLength(before.data.commits.length + 1);
    expect(after.data.facts.slice(before.data.facts.length).map(fact => fact.tableId).sort()).toEqual(["product", "product_sales_channel", "product_shipping_profile", "sales_channel", "shipping_profile"]);
    expect(after.events.slice(before.events.length).map(event => event.envelope.contract).sort()).toEqual([
      "LinkProductSalesChannel.attached", "LinkProductShippingProfile.attached", "fulfillment.shipping-profile.created",
      "product.product.created", "sales_channel.sales-channel.created",
    ]);
    expect(after.deliveries).toHaveLength(before.deliveries.length + 5);
    expect(await runEffect(host.run(key, input("connected")))).toEqual(result);
    expect(await inventory()).toEqual(after);
  });

  it("associates IDs returned by native creation when callers provide no IDs", async () => {
    const host = await runEffect(prepareProductShippingProfileWorkflow(options()));
    const result = await runEffect(host.run(host.newRequestKey(), {
      shippingProfile: { name: "Generated profile", type: "default" },
      salesChannel: { name: "Generated channel" }, products: Array.from({ length: 4 }, (_, index) => ({ title: "Generated " + index })),
    }));
    expect(result.products).toHaveLength(4);
    expect(result.shippingProfiles[0]?.id).toMatch(/^sp_/);
    expect(result.shippingLinks.every(link => link.shipping_profile_id === result.shippingProfiles[0]?.id)).toBe(true);
    expect(result.shippingLinks.map(link => link.product_id).sort()).toEqual(result.products.map(product => product.id).sort());
    expect(result.salesChannels[0]?.id).toMatch(/^sc_/);
    expect(result.products.every(product => product.id.startsWith("prod_"))).toBe(true);
    expect(result.links.map(link => link.product_id).sort()).toEqual(result.products.map(product => product.id).sort());
    expect(result.links.every(link => link.sales_channel_id === result.salesChannels[0]?.id)).toBe(true);
  });

  it("runs the observer once on replay, checks revision identity and rolls back late failures", async () => {
    const callback = vi.fn();
    const host = await observe(callback);
    const key = host.newRequestKey();
    const result = await runEffect(host.run(key, input("observer")));
    const committed = await inventory();
    expect(await runEffect(host.run(key, input("observer")))).toEqual(result);
    expect(callback).toHaveBeenCalledTimes(1); expect(await inventory()).toEqual(committed);
    const changed = await runEffect(prepareProductShippingProfileWorkflow({ ...options(), revision: "b".repeat(64) }));
    const ordinary = await runEffect(prepareProductShippingProfileWorkflow(options()));
    const retained = ordinary.newRequestKey();
    await runEffect(ordinary.run(retained, input("revision")));
    const before = await inventory();
    expect(await runEffectFailure(changed.run(retained, input("revision")))).toMatchObject({ reason: "requestConflict" });
    const reached = vi.fn(() => { throw new Error("late parent failure"); });
    const failed = await observe(reached);
    expect(Exit.isFailure(await runEffect(Effect.exit(failed.run(failed.newRequestKey(), input("failed", 4)))))).toBe(true);
    expect(reached).toHaveBeenCalledTimes(1); expect(await inventory()).toEqual(before);
    const output = await observe(() => undefined, Schema.Null);
    expect(await runEffectFailure(output.run(output.newRequestKey(), input("bad-output", 4)))).toMatchObject({ reason: "storedCorruption" });
    expect(await inventory()).toEqual(before);
  });

  it("restores exact active and deleted Link rows on late failure, without executing dismiss compensation", async () => {
    for (const deleted of [false, true]) {
      const productId = deleted ? "previous-deleted" : "previous-active";
      const pair = { product: { product_id: productId }, sales_channel: { sales_channel_id: "previous-channel" }, data: { id: productId + "-link" } };
      await runEffect(fixture.host.run(fixture.host.newRequestKey(), link.create, pair));
      if (deleted) await runEffect(fixture.host.run(fixture.host.newRequestKey(), link.dismiss, pair));
      const before = await inventory();
      const reached = vi.fn(() => { throw new Error("fail after native reattach"); });
      const host = await associate(reached);
      expect(Exit.isFailure(await runEffect(Effect.exit(host.run(host.newRequestKey(), {
        links: [{ product_id: productId, sales_channel_id: "previous-channel" }],
      }))))).toBe(true);
      expect(reached).toHaveBeenCalledTimes(1);
      expect(await inventory()).toEqual(before);
    }
  });

  it("preserves native duplicate refusal and distinguishes fresh attach from retained replay", async () => {
    const host = await associate();
    const pair = { product_id: "repeated-pair", sales_channel_id: "repeated-channel" };
    const before = await inventory();
    expect(Exit.isFailure(await runEffect(Effect.exit(host.run(host.newRequestKey(), { links: [pair, pair] }))))).toBe(true);
    expect(await inventory()).toEqual(before);
    const key = host.newRequestKey();
    const first = await runEffect(host.run(key, { links: [pair] }));
    const committed = await inventory();
    expect(await runEffect(host.run(key, { links: [pair] }))).toEqual(first);
    expect(await inventory()).toEqual(committed);
    const second = await runEffect(host.run(host.newRequestKey(), { links: [pair] }));
    expect(second[0]?.id).not.toEqual(first[0]?.id);
    const after = await inventory();
    expect(after.data.facts.slice(committed.data.facts.length).map(fact => fact.operation)).toEqual(["update"]);
  });

  it("keeps caught resource refusal fatal and revokes escaped native Link methods", async () => {
    let escaped = Option.none<{ create: (links: Schema.Json) => Promise<unknown> }>();
    const callback = vi.fn((_value: unknown, { container }: StepExecutionContext) => {
      escaped = Option.some(container.resolve("link"));
      try { container.resolve("transactionManager"); } catch { /* A user callback cannot clear rollback-only. */ }
    });
    const host = await observe(callback), before = await inventory();
    expect(Exit.isFailure(await runEffect(Effect.exit(host.run(host.newRequestKey(), input("caught")))))).toBe(true);
    expect(callback).toHaveBeenCalledTimes(1); expect(await inventory()).toEqual(before);
    await expect(Option.getOrThrow(escaped).create([])).rejects.toMatchObject({ reason: "closed" });
    const malformed = await observe(async (_value, { container }) => {
      const native = container.resolve<{ create: (links: Schema.Json) => Promise<unknown> }>("link");
      await native.create([{ product: { product_id: 123 }, sales_channel: { sales_channel_id: "wrong" } }]);
    });
    expect(Exit.isFailure(await runEffect(Effect.exit(malformed.run(malformed.newRequestKey(), input("malformed")))))).toBe(true);
    expect(await inventory()).toEqual(before);
  });

  it("refuses wrong native resources, unselected methods and cross-module hydration after pending writes", async () => {
    const before = await inventory();
    const callbacks = [
      async (_value: unknown, { container }: StepExecutionContext) => {
        const native = container.resolve<{ deleteShippingProfiles(value: Schema.Json): Promise<unknown> }>("fulfillment");
        try { await native.deleteShippingProfiles([]); } catch { /* Unselected deletion stays fatal. */ }
      },
      async (_value: unknown, { container }: StepExecutionContext) => {
        const native = container.resolve<Pick<IFulfillmentModuleService, "retrieveFulfillmentOptions">>("fulfillment");
        try { await native.retrieveFulfillmentOptions("unregistered"); } catch { /* No provider capability is admitted. */ }
      },
      async (_value: unknown, { container }: StepExecutionContext) => {
        const native = container.resolve<Pick<IFulfillmentModuleService, "validateFulfillmentOption">>("fulfillment");
        try { await native.validateFulfillmentOption("unregistered", {}); } catch { /* Provider validation is also refused. */ }
      },
      async (_value: unknown, { container }: StepExecutionContext) => {
        const native = container.resolve<Pick<IFulfillmentModuleService, "upsertShippingOptions">>("fulfillment");
        try { await native.upsertShippingOptions([]); } catch { /* Unselected writes cannot escape through an empty batch. */ }
      },
      async (_value: unknown, { container }: StepExecutionContext) => { container.resolve("remoteLink"); },
      async (_value: unknown, { container }: StepExecutionContext) => {
        const native = container.resolve<{ createProductTags: (value: Schema.Json) => Promise<unknown> }>("product");
        try { await native.createProductTags([]); } catch { /* The refusal stays fatal. */ }
      },
      async (_value: unknown, { container }: StepExecutionContext) => {
        const query = container.resolve<{ graph: (value: Schema.Json) => Promise<unknown> }>("query");
        try { await query.graph({ entity: "product", fields: ["sales_channels.id"], pagination: { take: 1 } }); } catch { /* The refusal stays fatal. */ }
      },
    ];
    for (const [index, callback] of callbacks.entries()) {
      const reached = vi.fn(callback), host = await observe(reached);
      expect(Exit.isFailure(await runEffect(Effect.exit(host.run(host.newRequestKey(), input("unadmitted-" + index)))))).toBe(true);
      expect(reached).toHaveBeenCalledTimes(1); expect(await inventory()).toEqual(before);
    }
  });

  it("rejects a Link event naming a different identity and rolls back all participants", async () => {
    const policy = installed.link.moduleEvents;
    if (policy === undefined) throw new Error("Missing Link event policy");
    const host = await runEffect(prepareProductShippingProfileWorkflow({ ...options(), modules: { ...installed,
      link: { ...installed.link, moduleEvents: { ...policy, capture: input => policy.capture(input).pipe(Effect.map(value => {
        if (!isJsonObject(value)) throw new Error("Expected native event");
        return { ...value, data: { id: "not-the-created-link" } };
      })) } },
    } }));
    const before = await inventory();
    const error = await runEffectFailure(host.run(host.newRequestKey(), input("wrong-event")));
    // The participant latches receiptMismatch; the native Promise boundary
    // re-enters refusal and returns rollbackOnly with that original full Cause.
    expect(error.reason).toBe("rollbackOnly");
    if (!Cause.isCause(error.cause)) throw new Error("Missing retained event-validation cause");
    expect(error.cause.reasons.some(reason => Cause.isFailReason(reason)
      && reason.error instanceof CommerceTransactionError && reason.error.reason === "receiptMismatch")).toBe(true);
    expect(await inventory()).toEqual(before);
  });

  it("cancels a pending callback without publishing and revokes the borrowed resources", async () => {
    const reached = await runEffect(Deferred.make<void>());
    let release: (() => void) | undefined;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    let escaped = Option.none<{ create: (links: Schema.Json) => Promise<unknown> }>();
    const host = await observe(async (_value, { container }) => {
      escaped = Option.some(container.resolve("link"));
      await runEffect(Deferred.succeed(reached, undefined)); await waiting;
    });
    const before = await inventory();
    try {
      await runEffect(Effect.scoped(Effect.gen(function* () {
        const fiber = yield* Effect.forkScoped(host.run(host.newRequestKey(), input("cancelled", 4)));
        yield* Deferred.await(reached).pipe(Effect.timeout(10000));
        yield* Fiber.interrupt(fiber);
      })));
    } finally { release?.(); }
    expect(await inventory()).toEqual(before);
    await expect(Option.getOrThrow(escaped).create([])).rejects.toMatchObject({ reason: "closed" });
  });

  it("recovers uncertain root settlement without repeating native callbacks", async () => {
    let lose = true;
    const session = issueRelationalSession(fixture.persistence.drizzle, work => runRelationalSession(fixture.session, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => {
        if (!lose) return Effect.succeed(value);
        lose = false;
        return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost workflow COMMIT acknowledgement") }));
      }),
    ));
    const reached = vi.fn();
    const host = await observe(reached, ProductShippingProfileOutput, { ...options(), execution: execution(session) });
    const before = await inventory(), key = host.newRequestKey();
    const result = await runEffect(host.run(key, input("uncertain", 4)));
    const after = await inventory();
    expect(after.data.commits).toHaveLength(before.data.commits.length + 1);
    expect(after.events.slice(before.events.length).map(event => event.envelope.contract).sort()).toEqual([
      "LinkProductSalesChannel.attached", "LinkProductShippingProfile.attached", "fulfillment.shipping-profile.created",
      ...Array.from({ length: 4 }, () => "product.product.created"), "sales_channel.sales-channel.created",
    ]);
    expect(await runEffect(host.run(key, input("uncertain", 4)))).toEqual(result);
    expect(reached).toHaveBeenCalledTimes(1); expect(await inventory()).toEqual(after);
  });

  it("does not undo committed Products, channels or links when a subscriber fails", async () => {
    const host = await runEffect(prepareProductShippingProfileWorkflow(options()));
    const key = host.newRequestKey(), result = await runEffect(host.run(key, input("subscriber", 4)));
    const before = await inventory(), commit = before.data.commits.at(-1);
    if (commit === undefined) throw new Error("Missing workflow commit");
    const handle = vi.fn(() => Effect.fail(new CommitEventSubscriberFailure({ retryable: true, code: "offline" })));
    const pump = await runEffect(makeCommitEventPump(fixture.hostInput, options().subscribers.map(subscriber => ({ ...subscriber, handle }))));
    await runEffect(pump.runNext(commit.commitSeq - 1n));
    // Product emits one creation event per row; the other four families emit once.
    expect(handle).toHaveBeenCalledTimes(8);
    const after = await inventory();
    expect(after.data).toEqual(before.data); expect(after.events).toEqual(before.events);
    expect(after.deliveries.filter(row => row.commitSeq === commit.commitSeq).every(row => row.attempts === 1 && row.state !== "delivered")).toBe(true);
    expect(await runEffect(host.run(key, input("subscriber", 4)))).toEqual(result);
  });

  it.skipIf(driver !== "postgres")("observes a same-scope PostgreSQL lock wait between competing native association roots", async () => {
    const entered = await runEffect(Deferred.make<void>()), release = await runEffect(Deferred.make<void>());
    const firstHost = await associateShipping(async () => {
      await runEffect(Deferred.succeed(entered, undefined));
      await runEffect(Deferred.await(release));
    });
    const secondHost = await associateShipping();
    const args = { links: [{ product: { product_id: "contended-product" }, fulfillment: { shipping_profile_id: "contended-profile" } }] };
    const before = await inventory();
    const first = runEffect(firstHost.run(firstHost.newRequestKey(), args));
    const firstObserved = first.then(value => ({ value }), error => ({ error }));
    await runEffect(Deferred.await(entered).pipe(Effect.timeout(10000)));
    const second = runEffect(secondHost.run(secondHost.newRequestKey(), args));
    const secondObserved = second.then(value => ({ value }), error => ({ error }));
    try {
      let waiting = false;
      for (let poll = 0; poll < 25; poll++) {
        const observed = await fixture.persistence.query<{ waiting: boolean }>(
          "select exists(select 1 from pg_stat_activity where usename=current_user and pid<>pg_backend_pid() and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0) as waiting");
        if (observed.rows[0]?.waiting) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
    } finally {
      await runEffect(Deferred.succeed(release, undefined));
      await Promise.all([firstObserved, secondObserved]);
    }
    const a = await first, b = await second;
    expect(a).toEqual(args.links); expect(b).toEqual(args.links);
    const after = await inventory();
    expect(after.data.commits).toHaveLength(before.data.commits.length + 2);
    expect(after.data.facts.slice(before.data.facts.length).map(fact => fact.operation)).toEqual(["insert", "update"]);
  });
});
