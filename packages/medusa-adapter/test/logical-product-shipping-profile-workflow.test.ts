import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { Cause, Deferred, Effect, Fiber, Option, Result, Schema } from "effect";
import { createStep, createWorkflow, WorkflowResponse, type StepExecutionContext, type WorkflowData } from "@medusajs/workflows-sdk";
import { Link } from "@medusajs/modules-sdk/link";
import { createRemoteLinkStep } from "@medusajs/core-flows/common/create-remote-links-step";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/atomicCommerce/host";
import { makeCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../persistence-postgres/src/atomicCommerce/events";
import { fxAppRowCurrent } from "../../persistence-postgres/src/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commitEvents/schema";
import { fxSystemCommitEventDeliveries } from "../../persistence-postgres/src/commitEvents/schema";
import { makeCommitEventPump } from "../../persistence-postgres/src/commitEvents/pump";
import { CommitEventSubscriberFailure } from "../../persistence-postgres/src/commitEvents/model";
import { issueRelationalSession, runRelationalSession } from "../../persistence-postgres/src/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/relationalTransaction/model";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { CommerceTransactionError, commerceError, isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";
import { productLogicalCreateEventPolicy } from "../src/product-local-events";
import { productShippingProfileResources } from "../src/product-shipping-profile-contract";
import { prepareProductShippingProfileWorkflow, productShippingProfileWorkflow,
  ProductShippingProfileInput, ProductShippingProfileOutput } from "../src/product-shipping-profile-workflow";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type AtomicWorkflowHostComposition } from "../src/workflow/host";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../src/workflow/events";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalProductHost } from "./support/logical-product-fixture";
import { prepareLogicalSalesChannelHost } from "./support/logical-sales-channel-fixture";
import { prepareLogicalShippingProfileHost } from "./support/logical-shipping-profile-fixture";
import { prepareLogicalProductLinksHost } from "./support/logical-product-links-fixture";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Product ShippingProfile workflow driver");
const cleanup: Array<() => Promise<void>> = [];
let selected: {
  fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
  product: Awaited<ReturnType<typeof prepareLogicalProductHost>>;
  sales: Awaited<ReturnType<typeof prepareLogicalSalesChannelHost>>;
  shipping: Awaited<ReturnType<typeof prepareLogicalShippingProfileHost>>;
  links: Awaited<ReturnType<typeof prepareLogicalProductLinksHost>>;
  catalog: Effect.Success<ReturnType<typeof productRuntimeMetadata>>;
};
const revision = (value: string) => createHash("sha256").update(value).digest("hex");
const input = (prefix: string, count = 1) => ({ shippingProfile: { id: prefix + "-profile", name: prefix, type: "default" },
  salesChannel: { id: prefix + "-channel", name: prefix },
  products: Array.from({ length: count }, (_, index) => ({ id: prefix + "-" + index, title: prefix + "-" + index })) });
const modules = (instance = selected) => ({
  product: { module: instance.product.runtime.workflow, logicalStorage: instance.product.hostInput.logicalStorage,
    moduleEvents: productLogicalCreateEventPolicy(instance.catalog) },
  sales_channel: { module: instance.sales.runtime.workflow, logicalStorage: instance.sales.hostInput.logicalStorage,
    moduleEvents: instance.sales.runtime.logicalEventPolicy() },
  fulfillment: { module: instance.shipping.runtime.workflow, logicalStorage: instance.shipping.hostInput.logicalStorage,
    moduleEvents: instance.shipping.runtime.logicalEventPolicy() },
  link: { module: instance.links.runtime.workflow, logicalStorage: instance.links.hostInput.logicalStorage,
    moduleEvents: instance.links.runtime.logicalEventPolicy() },
});
const execution = (instance = selected, session = instance.fixture.session) => ({ identityAndAccessPolicy: instance.fixture.hostInput.identityAndAccessPolicy,
  prepare: (composition: AtomicWorkflowHostComposition) => makeAtomicCommerceHost({ ...instance.fixture.hostInput, session, ...composition }) });
const options = (instance = selected) => ({ execution: execution(instance), modules: modules(instance), revision: revision("logical-product-shipping-profile"),
  subscribers: [{ id: "logical-product-shipping-profile", revision: "a".repeat(64) }] });
const prepare = (instance = selected) => Effect.runPromise(prepareProductShippingProfileWorkflow(options(instance)));
async function observe(after: (value: unknown, context: StepExecutionContext) => unknown | Promise<unknown>,
  selectedModules = modules(), selectedExecution: AtomicWorkflowExecution = execution(),
  output: Schema.ConstraintDecoder<Schema.Json> = ProductShippingProfileOutput) {
  const resources = Result.getOrThrow(prepareWorkflowResources({
    product: { module: selectedModules.product.module, methods: ["createProducts"], graph: true },
    sales_channel: { module: selectedModules.sales_channel.module, methods: ["createSalesChannels"], graph: true },
    fulfillment: { module: selectedModules.fulfillment.module, methods: ["createShippingProfiles"], graph: true },
    link: { module: selectedModules.link.module, methods: ["create"], graph: true },
  }, true));
  const flow = createWorkflow("observe-logical-product-shipping-profile", (value: WorkflowData<typeof ProductShippingProfileInput.Type>) => {
    const result = productShippingProfileWorkflow.runAsStep({ input: value });
    const callback = createStep("after-logical-product-shipping-profile", resources.callback(after));
    return new WorkflowResponse(callback(result));
  });
  return Effect.runPromise(prepareAtomicWorkflowHost({ ...options(), modules: selectedModules, execution: selectedExecution,
    requestCallLimit: productShippingProfileResources.calls,
    workflow: { name: "observeLogicalProductShippingProfile", resources, prepared: Result.getOrThrow(flow.prepare()),
      input: ProductShippingProfileInput, output, events: internalModuleWorkflowEvents },
  }));
}
const ShippingPairs = Schema.Struct({ links: Schema.Array(Schema.Struct({
  product: Schema.Struct({ product_id: Schema.String }), fulfillment: Schema.Struct({ shipping_profile_id: Schema.String }),
})).pipe(Schema.mutable) });
async function associateShipping(after: () => void | Promise<void> = () => undefined) {
  const selectedModules = { link: modules().link };
  const resources = Result.getOrThrow(prepareWorkflowResources({
    link: { module: selectedModules.link.module, methods: ["create"], graph: true },
  }, true));
  const flow = createWorkflow("associate-logical-shipping-profiles", (value: WorkflowData<typeof ShippingPairs.Type>) => {
    const result = createRemoteLinkStep(value.links);
    const callback = createStep("after-logical-shipping-association", resources.callback(async (output: unknown) => {
      await after(); return output;
    }));
    return new WorkflowResponse(callback(result));
  });
  return Effect.runPromise(prepareAtomicWorkflowHost({ ...options(), modules: selectedModules,
    workflow: { name: "associateLogicalShippingProfiles", resources, prepared: Result.getOrThrow(flow.prepare()),
      input: ShippingPairs, output: Schema.Array(Schema.JsonObject), events: internalModuleWorkflowEvents },
  }));
}
const rows = () => selected.fixture.persistence.drizzle.select().from(fxAppRowCurrent);
const events = () => selected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents)
  .orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);
const shippingPair = (product: string, profile: string) => ({ product: { product_id: product },
  fulfillment: { shipping_profile_id: profile } });
async function prepareLinkHost() {
  const participant = defineAtomicCommerceParticipant("link");
  const runtime = selected.links.runtime;
  const create = defineAtomicCommerceCommand("nativeProductLinksCreate", (ctx, input) => ctx.call(participant, runtime.create, input));
  const dismiss = defineAtomicCommerceCommand("nativeProductLinksDismiss", (ctx, input) => ctx.call(participant, runtime.dismiss, input));
  const restore = defineAtomicCommerceCommand("nativeProductLinksRestore", (ctx, input) => ctx.call(participant, runtime.restoreShipping, input));
  const policy = runtime.logicalEventPolicy();
  const revision = "b".repeat(64);
  const names = ["LinkProductSalesChannel.attached", "LinkProductSalesChannel.detached",
    "LinkProductShippingProfile.attached", "LinkProductShippingProfile.detached"];
  const contracts = names.map(name => defineCommerceEventContract({ name, revision, internal: true, decode: policy.capture }));
  const byName = new Map(names.map((name, index) => [name, contracts[index]]));
  const host = await Effect.runPromise(makeAtomicCommerceHost({ ...selected.fixture.hostInput,
    identityAndAccessPolicy: { profile: "logical-product-links-lifecycle" },
    participants: [{ participant, logicalStorage: selected.links.hostInput.logicalStorage,
      commands: runtime.commands, validateLogical: policy.validateLogical,
      events: { contracts, select: (message: Json) => {
        const contract = isJsonObject(message) && typeof message.name === "string"
          ? byName.get(message.name) : undefined;
        return contract === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(contract);
      } } }],
    commands: [create, dismiss, restore],
    events: { producerRevision: revision, contracts,
      subscribers: [{ id: "logical-product-links-lifecycle", revision: "c".repeat(64) }],
      validate: emitted => emitted.some(event => !event.internal)
        ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
  }));
  return { host, create, dismiss, restore };
}

describe("native Product–ShippingProfile workflow on shared logical storage", () => {
  beforeAll(async () => {
    const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), {
      includeProduct: true, includeSalesChannel: true, includeShippingProfile: true,
      includeProductSalesChannelLink: true, includeProductShippingProfileLink: true,
    });
    const product = await prepareLogicalProductHost(fixture);
    const sales = await prepareLogicalSalesChannelHost(fixture);
    const shipping = await prepareLogicalShippingProfileHost(fixture);
    const links = await prepareLogicalProductLinksHost(fixture);
    for (const member of [product, sales, shipping, links]) {
      await Effect.runPromise(member.host.initialize([]));
      await Effect.runPromise(member.host.close);
    }
    const catalog = await Effect.runPromise(captureProductSchema("logical-product-shipping-profile")
      .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    selected = { fixture, product, sales, shipping, links, catalog };
  }, 150_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

  it("admits both native stored Link tables without generating commerce tables", async () => {
    expect(selected.links.definition.schema.tables.map(table => table.identity.tableId))
      .toEqual(["product_sales_channel", "product_shipping_profile"]);
    const shipping = selected.links.definition.schema.tables.find(table => table.identity.tableId === "product_shipping_profile");
    expect(shipping?.keys.find(key => key.kind === "primary")?.columns.map(column => column.columnId))
      .toEqual(["product_id", "shipping_profile_id"]);
    expect(shipping?.constraints.filter(item => item.kind === "foreignKey")).toEqual([]);
    expect((await selected.fixture.persistence.query<{ name: string }>(
      "select tablename as name from pg_tables where schemaname = current_schema() order by tablename")).rows)
      .toEqual(selected.fixture.physicalTablesBeforeCandidate);
  });

  it("creates all four native participants with pending graph reads and one replayable publication", async () => {
    const host = await prepare();
    try {
      const beforeRows = await rows(), beforeEvents = await events();
      const key = host.newRequestKey();
      const result = await Effect.runPromise(host.run(key, input("connected", 4)));
      expect(result.products).toHaveLength(4); expect(result.shippingProfiles).toHaveLength(1);
      expect(result.salesChannels).toHaveLength(1); expect(result.links).toHaveLength(4);
      expect(result.shippingLinks).toHaveLength(4);
      expect(result.shippingLinks.map(link => link.product_id).sort())
        .toEqual(result.products.map(product => product.id).sort());
      expect(result.shippingLinks.every(link => link.shipping_profile_id === result.shippingProfiles[0]?.id)).toBe(true);
      const committedRows = await rows(), committedEvents = await events();
      expect(committedRows.length).toBeGreaterThan(beforeRows.length);
      expect(committedEvents.slice(beforeEvents.length).map(event => event.envelope.contract).sort()).toEqual([
        "LinkProductSalesChannel.attached", "LinkProductShippingProfile.attached", "fulfillment.shipping-profile.created",
        ...Array.from({ length: 4 }, () => "product.product.created"), "sales_channel.sales-channel.created",
      ]);
      expect(await Effect.runPromise(host.run(key, input("connected", 4)))).toEqual(result);
      expect(await rows()).toEqual(committedRows); expect(await events()).toEqual(committedEvents);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("rejects a mixed-family native Link batch before dispatch and rolls back every pending endpoint", async () => {
    const dispatch = vi.spyOn(Link.prototype, "create");
    const dispatchCounts: number[] = [];
    const callback = vi.fn(async (_value: unknown, { container }: StepExecutionContext) => {
      const native = container.resolve<{ create(value: Schema.Json): Promise<unknown> }>("link");
      const calls = dispatch.mock.calls.length;
      try { await native.create([{ product: { product_id: "mixed" }, sales_channel: { sales_channel_id: "sc" } },
        { product: { product_id: "mixed" }, fulfillment: { shipping_profile_id: "sp" } }]); } catch { /* Sticky refusal. */ }
      dispatchCounts.push(calls, dispatch.mock.calls.length);
    });
    const host = await observe(callback);
    try {
      const beforeRows = await rows(), beforeEvents = await events();
      await expect(Effect.runPromise(host.run(host.newRequestKey(), input("mixed"))))
        .rejects.toMatchObject({ reason: "rollbackOnly" });
      expect(callback).toHaveBeenCalledTimes(1);
      expect(dispatchCounts).toHaveLength(2);
      expect(dispatchCounts[1]).toBe(dispatchCounts[0]);
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
    } finally { dispatch.mockRestore(); await Effect.runPromise(host.close); }
  }, 120_000);

  it("rolls back a late callback failure after both Links and endpoints were written", async () => {
    const callback = vi.fn(() => { throw new Error("late logical workflow failure"); });
    const host = await observe(callback);
    try {
      const beforeRows = await rows(), beforeEvents = await events();
      await expect(Effect.runPromise(host.run(host.newRequestKey(), input("late-failure", 4)))).rejects.toBeDefined();
      expect(callback).toHaveBeenCalledTimes(1);
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("rejects malformed native Link input after pending endpoint writes", async () => {
    const callback = vi.fn(async (_value: unknown, { container }: StepExecutionContext) => {
      const native = container.resolve<{ create(value: Schema.Json): Promise<unknown> }>("link");
      await native.create([{ product: { product_id: 123 }, sales_channel: { sales_channel_id: "wrong" } }]);
    });
    const host = await observe(callback);
    try {
      const beforeRows = await rows(), beforeEvents = await events();
      await expect(Effect.runPromise(host.run(host.newRequestKey(), input("malformed")))).rejects.toBeDefined();
      expect(callback).toHaveBeenCalledTimes(1);
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("rejects malformed workflow output and rolls back pending writes", async () => {
    const callback = vi.fn((value: unknown) => value);
    const host = await observe(callback, modules(), execution(), Schema.Null);
    try {
      const beforeRows = await rows(), beforeEvents = await events();
      await expect(Effect.runPromise(host.run(host.newRequestKey(), input("bad-output", 4))))
        .rejects.toMatchObject({ reason: "storedCorruption" });
      expect(callback).toHaveBeenCalledTimes(1);
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("keeps the 128-call request contract and rejects an oversized Product envelope", async () => {
    const host = await prepare();
    try {
      const beforeRows = await rows(), beforeEvents = await events();
      await expect(Effect.runPromise(host.run(host.newRequestKey(), input("oversized", 5))))
        .rejects.toMatchObject({ reason: "invalidInput" });
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("preserves singular ShippingProfile assignment, profile reuse and conflicting restore", async () => {
    const { host, create, dismiss, restore } = await prepareLinkHost();
    try {
      expect(await Effect.runPromise(host.run(host.newRequestKey(), create,
        [shippingPair("shared-a", "profile-a"), shippingPair("shared-b", "profile-a")]))).toHaveLength(2);
      const beforeRows = await rows(), beforeEvents = await events();
      await expect(Effect.runPromise(host.run(host.newRequestKey(), create, shippingPair("shared-a", "profile-b"))))
        .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
      await Effect.runPromise(host.run(host.newRequestKey(), dismiss, shippingPair("shared-a", "profile-a")));
      await Effect.runPromise(host.run(host.newRequestKey(), create, shippingPair("shared-a", "profile-b")));
      const conflictRows = await rows(), conflictEvents = await events();
      await expect(Effect.runPromise(host.run(host.newRequestKey(), restore,
        { fulfillment: { shipping_profile_id: "profile-a" } }))).rejects.toMatchObject({ _tag: "CommerceTransactionError" });
      expect(await rows()).toEqual(conflictRows); expect(await events()).toEqual(conflictEvents);
      await Effect.runPromise(host.run(host.newRequestKey(), dismiss, shippingPair("shared-a", "profile-b")));
      await Effect.runPromise(host.run(host.newRequestKey(), restore, { fulfillment: { shipping_profile_id: "profile-a" } }));
      const reader = await Effect.runPromise(makeCommerceHost(selected.links.hostInput));
      try {
        expect(await Effect.runPromise(reader.read(selected.links.runtime.countShipping,
          { filters: { shipping_profile_id: "profile-a" }, config: { take: 2 } })))
          .toMatchObject([[{ deleted_at: null }, { deleted_at: null }], 2]);
      } finally { await Effect.runPromise(reader.close); }
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("rejects a Link event with a forged ID and rolls back all participants", async () => {
    const selectedModules = modules();
    const policy = selectedModules.link.moduleEvents;
    const host = await observe(value => value, { ...selectedModules,
      link: { ...selectedModules.link, moduleEvents: { ...policy,
        capture: (value: unknown) => policy.capture(value).pipe(Effect.map(message => {
          if (!isJsonObject(message)) throw new Error("Expected Link event");
          return { ...message, data: { id: "not-the-created-link" } };
        })) } },
    });
    try {
      const beforeRows = await rows(), beforeEvents = await events();
      const failure = await Effect.runPromise(Effect.flip(host.run(host.newRequestKey(), input("forged"))));
      expect(failure.reason).toBe("receiptMismatch");
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("associates generated native endpoint IDs and preserves the request call limit", async () => {
    const host = await prepare();
    try {
      const result = await Effect.runPromise(host.run(host.newRequestKey(), {
        shippingProfile: { name: "Generated logical profile", type: "default" },
        salesChannel: { name: "Generated logical channel" },
        products: Array.from({ length: 4 }, (_, index) => ({ title: "Generated logical " + index })),
      }));
      expect(result.shippingProfiles[0]?.id).toMatch(/^sp_/);
      expect(result.salesChannels[0]?.id).toMatch(/^sc_/);
      expect(result.products.every(product => product.id.startsWith("prod_"))).toBe(true);
      expect(result.links.map(link => link.product_id).sort()).toEqual(result.products.map(product => product.id).sort());
      expect(result.shippingLinks.map(link => link.product_id).sort()).toEqual(result.products.map(product => product.id).sort());
      const beforeRows = await rows(), beforeEvents = await events();
      const capped = await Effect.runPromise(prepareProductShippingProfileWorkflow({ ...options(), execution: {
        ...execution(), prepare: composition => execution().prepare({ ...composition, requestCallLimit: 64 }),
      } }));
      try {
        const failure = await Effect.runPromise(Effect.flip(capped.run(capped.newRequestKey(), input("budget-boundary"))));
        expect(failure.reason).toBe("rollbackOnly");
        if (!Cause.isCause(failure.cause)) throw new Error("Missing call-limit cause");
        expect(failure.cause.reasons.some(reason => Cause.isFailReason(reason)
          && reason.error instanceof CommerceTransactionError && reason.error.reason === "limitExceeded")).toBe(true);
        expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
      } finally { await Effect.runPromise(capped.close); }
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("keeps caught resource refusal fatal and revokes escaped native Link methods", async () => {
    let escaped = Option.none<{ create: (links: Schema.Json) => Promise<unknown> }>();
    const callback = vi.fn((_value: unknown, { container }: StepExecutionContext) => {
      escaped = Option.some(container.resolve("link"));
      try { container.resolve("transactionManager"); } catch { /* Sticky refusal. */ }
    });
    const host = await observe(callback);
    try {
      const beforeRows = await rows(), beforeEvents = await events();
      await expect(Effect.runPromise(host.run(host.newRequestKey(), input("caught"))))
        .rejects.toMatchObject({ reason: "rollbackOnly" });
      expect(callback).toHaveBeenCalledTimes(1);
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
      await expect(Option.getOrThrow(escaped).create([])).rejects.toMatchObject({ reason: "closed" });
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("cancels a pending callback and leaves no committed rows or events", async () => {
    const reached = await Effect.runPromise(Deferred.make<void>());
    let release: (() => void) | undefined;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    let escaped = Option.none<{ create: (links: Schema.Json) => Promise<unknown> }>();
    const host = await observe(async (_value, { container }) => {
      escaped = Option.some(container.resolve("link"));
      await Effect.runPromise(Deferred.succeed(reached, undefined)); await waiting;
    });
    try {
      const beforeRows = await rows(), beforeEvents = await events();
      try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const fiber = yield* Effect.forkScoped(host.run(host.newRequestKey(), input("cancelled", 4)));
          yield* Deferred.await(reached).pipe(Effect.timeout(10000));
          yield* Fiber.interrupt(fiber);
        })));
      } finally { release?.(); }
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
      await expect(Option.getOrThrow(escaped).create([])).rejects.toMatchObject({ reason: "closed" });
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("recovers an uncertain commit without replaying native callbacks", async () => {
    let lose = true;
    const { fixture } = selected;
    const session = issueRelationalSession(fixture.persistence.drizzle, (profile, work) =>
      runRelationalSession(fixture.session, profile, work).pipe(
        Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
        Effect.flatMap(value => {
          if (!lose) return Effect.succeed(value);
          lose = false;
          return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain",
            cause: new Error("Lost Product ShippingProfile COMMIT acknowledgement") }));
        })));
    const reached = vi.fn((value: unknown) => value);
    const host = await observe(reached, modules(), execution(selected, session));
    try {
      const key = host.newRequestKey(), beforeEvents = await events();
      const result = await Effect.runPromise(host.run(key, input("uncertain", 4)));
      const committedEvents = await events();
      expect(committedEvents.length - beforeEvents.length).toBe(8);
      expect(await Effect.runPromise(host.run(key, input("uncertain", 4)))).toEqual(result);
      expect(await events()).toEqual(committedEvents); expect(reached).toHaveBeenCalledTimes(1);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("does not undo a committed workflow when subscriber delivery fails", async () => {
    const host = await prepare();
    try {
      const key = host.newRequestKey();
      const result = await Effect.runPromise(host.run(key, input("subscriber", 4)));
      const beforeRows = await rows(), beforeEvents = await events();
      const last = beforeEvents.at(-1);
      if (last === undefined) throw new Error("Missing workflow event");
      const handle = vi.fn(() => Effect.fail(new CommitEventSubscriberFailure({ retryable: true, code: "offline" })));
      const pump = await Effect.runPromise(makeCommitEventPump(selected.fixture.hostInput,
        options().subscribers.map(subscriber => ({ ...subscriber, handle }))));
      await Effect.runPromise(pump.runNext(last.commitSeq - 1n));
      expect(handle).toHaveBeenCalledTimes(8);
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
      expect((await selected.fixture.persistence.drizzle.select().from(fxSystemCommitEventDeliveries))
        .filter(row => row.commitSeq === last.commitSeq).every(row => row.attempts === 1 && row.state !== "delivered")).toBe(true);
      expect(await Effect.runPromise(host.run(key, input("subscriber", 4)))).toEqual(result);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("keeps identical Product, channel, profile and Link IDs isolated between shops", async () => {
    const otherFixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), {
      resource: selected.fixture.resource, fixtureIdentity: { deploymentId: "deployment_product_shipping_shop_b",
        projectId: "project_product_shipping_shop_b", uuidOffset: 8_000 },
      includeProduct: true, includeSalesChannel: true, includeShippingProfile: true,
      includeProductSalesChannelLink: true, includeProductShippingProfileLink: true,
    });
    const otherProduct = await prepareLogicalProductHost(otherFixture);
    const otherSales = await prepareLogicalSalesChannelHost(otherFixture);
    const otherShipping = await prepareLogicalShippingProfileHost(otherFixture);
    const otherLinks = await prepareLogicalProductLinksHost(otherFixture);
    for (const member of [otherProduct, otherSales, otherShipping, otherLinks]) {
      await Effect.runPromise(member.host.initialize([])); await Effect.runPromise(member.host.close);
    }
    const other = { fixture: otherFixture, product: otherProduct, sales: otherSales,
      shipping: otherShipping, links: otherLinks, catalog: selected.catalog };
    const first = await prepare(), second = await prepare(other);
    try {
      const firstScope = projectScopeIdUuidV1(selected.fixture.application.authority.scopeId).scopeUuid;
      const secondScope = projectScopeIdUuidV1(other.fixture.application.authority.scopeId).scopeUuid;
      expect(firstScope).not.toBe(secondScope);
      const same = input("shared-identities");
      const firstResult = await Effect.runPromise(first.run(first.newRequestKey(), same));
      const firstRows = (await rows()).filter(row => row.scopeUuid === firstScope);
      const secondBefore = (await rows()).filter(row => row.scopeUuid === secondScope);
      const secondResult = await Effect.runPromise(second.run(second.newRequestKey(), same));
      expect(secondResult).toMatchObject({ products: firstResult.products, shippingProfiles: firstResult.shippingProfiles,
        salesChannels: firstResult.salesChannels });
      expect((await rows()).filter(row => row.scopeUuid === firstScope)).toEqual(firstRows);
      expect((await rows()).filter(row => row.scopeUuid === secondScope).length).toBeGreaterThan(secondBefore.length);
      expect((await selected.fixture.persistence.query<{ name: string }>(
        "select tablename as name from pg_tables where schemaname = current_schema() order by tablename")).rows)
        .toEqual(selected.fixture.physicalTablesBeforeCandidate);
    } finally { await Effect.runPromise(first.close); await Effect.runPromise(second.close); }
  }, 150_000);

  it("restores exact active and deleted ShippingProfile Link rows after a late native failure", async () => {
    const { host: linkHost, create, dismiss } = await prepareLinkHost();
    try {
      for (const deleted of [false, true]) {
        const product = deleted ? "previous-deleted" : "previous-active";
        const pair = shippingPair(product, "previous-profile");
        await Effect.runPromise(linkHost.run(linkHost.newRequestKey(), create, pair));
        if (deleted) await Effect.runPromise(linkHost.run(linkHost.newRequestKey(), dismiss, pair));
        const beforeRows = await rows(), beforeEvents = await events();
        const reached = vi.fn(() => { throw new Error("fail after native shipping reattach"); });
        const host = await associateShipping(reached);
        try {
          await expect(Effect.runPromise(host.run(host.newRequestKey(), { links: [pair] }))).rejects.toBeDefined();
          expect(reached).toHaveBeenCalledTimes(1);
          expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
        } finally { await Effect.runPromise(host.close); }
      }
    } finally { await Effect.runPromise(linkHost.close); }
  }, 120_000);

  it("rejects duplicate shipping pairs and distinguishes fresh attachment from retained replay", async () => {
    const host = await associateShipping();
    try {
      const pair = shippingPair("repeated-product", "repeated-profile");
      const beforeRows = await rows(), beforeEvents = await events();
      await expect(Effect.runPromise(host.run(host.newRequestKey(), { links: [pair, pair] })))
        .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
      const key = host.newRequestKey();
      const first = await Effect.runPromise(host.run(key, { links: [pair] }));
      const committedRows = await rows(), committedEvents = await events();
      expect(await Effect.runPromise(host.run(key, { links: [pair] }))).toEqual(first);
      expect(await rows()).toEqual(committedRows); expect(await events()).toEqual(committedEvents);
      await Effect.runPromise(host.run(host.newRequestKey(), { links: [pair] }));
      const nextEvents = await events();
      expect(nextEvents).toHaveLength(committedEvents.length + 1);
      expect(nextEvents.at(-1)?.envelope.contract).toBe("LinkProductShippingProfile.attached");
      expect(nextEvents.at(-1)?.envelope.message).not.toEqual(committedEvents.at(-1)?.envelope.message);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("refuses unselected Fulfillment methods, providers and cross-module hydration after pending writes", async () => {
    const beforeRows = await rows(), beforeEvents = await events();
    const callbacks: Array<(value: unknown, context: StepExecutionContext) => Promise<void>> = [
      async (_value, { container }) => {
        const native = container.resolve<{ deleteShippingProfiles(value: Schema.Json): Promise<unknown> }>("fulfillment");
        try { await native.deleteShippingProfiles([]); } catch { /* Sticky refusal. */ }
      },
      async (_value, { container }) => {
        const native = container.resolve<{ retrieveFulfillmentOptions(value: string): Promise<unknown> }>("fulfillment");
        try { await native.retrieveFulfillmentOptions("unregistered"); } catch { /* Sticky refusal. */ }
      },
      async (_value, { container }) => {
        const query = container.resolve<{ graph(value: Schema.Json): Promise<unknown> }>("query");
        try { await query.graph({ entity: "shipping_profile", fields: ["shipping_options.id"], pagination: { take: 1 } }); }
        catch { /* Unselected relation stays fatal. */ }
      },
    ];
    for (const [index, callback] of callbacks.entries()) {
      const reached = vi.fn(callback), host = await observe(reached);
      try {
        await expect(Effect.runPromise(host.run(host.newRequestKey(), input("unadmitted-" + index))))
          .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
        expect(reached).toHaveBeenCalledTimes(1);
        expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
      } finally { await Effect.runPromise(host.close); }
    }
  }, 120_000);

  it("binds replay to the selected workflow revision", async () => {
    const original = await prepare();
    const changed = await Effect.runPromise(prepareProductShippingProfileWorkflow({ ...options(), revision: "b".repeat(64) }));
    try {
      const key = original.newRequestKey();
      await Effect.runPromise(original.run(key, input("revision")));
      const beforeRows = await rows(), beforeEvents = await events();
      await expect(Effect.runPromise(changed.run(key, input("revision"))))
        .rejects.toMatchObject({ reason: "requestConflict" });
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
    } finally { await Effect.runPromise(original.close); await Effect.runPromise(changed.close); }
  }, 120_000);

  it.skipIf(driver !== "postgres")("reports a same-scope write conflict, then retries to one active Link", async () => {
    const entered = await Effect.runPromise(Deferred.make<void>()), secondEntered = await Effect.runPromise(Deferred.make<void>());
    const release = await Effect.runPromise(Deferred.make<void>());
    const firstHost = await associateShipping(async () => {
      await Effect.runPromise(Deferred.succeed(entered, undefined));
      await Effect.runPromise(Deferred.await(release));
    });
    const secondHost = await associateShipping(async () => {
      await Effect.runPromise(Deferred.succeed(secondEntered, undefined));
    });
    const args = { links: [shippingPair("contended-product", "contended-profile")] };
    const beforeEvents = await events();
    const first = Effect.runPromise(firstHost.run(firstHost.newRequestKey(), args));
    const firstObserved = first.then(value => ({ value }), error => ({ error }));
    await Effect.runPromise(Deferred.await(entered).pipe(Effect.timeout(10000)));
    const second = Effect.runPromise(secondHost.run(secondHost.newRequestKey(), args));
    const secondObserved = second.then(value => ({ value }), error => ({ error }));
    try {
      await Effect.runPromise(Deferred.await(secondEntered).pipe(Effect.timeout(10000)));
      await Effect.runPromise(Deferred.succeed(release, undefined));
      const outcomes = await Promise.all([firstObserved, secondObserved]);
      expect(outcomes.filter(outcome => "value" in outcome)).toHaveLength(1);
      expect(outcomes.filter(outcome => "error" in outcome)).toHaveLength(1);
      for (const outcome of outcomes) {
        if ("value" in outcome) expect(outcome.value).toEqual(args.links);
        else expect(outcome.error).toMatchObject({ reason: "writeConflict" });
      }
      expect((await events()).length).toBe(beforeEvents.length + 1);
      const retryHost = "error" in outcomes[0] ? firstHost : secondHost;
      expect(await Effect.runPromise(retryHost.run(retryHost.newRequestKey(), args))).toEqual(args.links);
      expect((await events()).length).toBe(beforeEvents.length + 2);
      const reader = await Effect.runPromise(makeCommerceHost(selected.links.hostInput));
      try {
        expect(await Effect.runPromise(reader.read(selected.links.runtime.countShipping,
          { filters: { product_id: "contended-product" }, config: { take: 1 } })))
          .toMatchObject([[{ product_id: "contended-product", shipping_profile_id: "contended-profile", deleted_at: null }], 1]);
      } finally { await Effect.runPromise(reader.close); }
    } finally {
      await Effect.runPromise(Deferred.succeed(release, undefined));
      await Promise.all([firstObserved, secondObserved]);
      await Effect.runPromise(firstHost.close); await Effect.runPromise(secondHost.close);
    }
  }, 120_000);
});
