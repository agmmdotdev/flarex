import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { Deferred, Effect, Fiber, Result, Schema } from "effect";
import { createStep, createWorkflow, WorkflowResponse, type WorkflowData, type StepExecutionContext } from "@medusajs/workflows-sdk";
import type { IPricingModuleService } from "@medusajs/framework/types";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/atomicCommerce/host";
import { issueRelationalSession, runRelationalSession } from "../../persistence-postgres/src/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/relationalTransaction/model";
import { fxSystemCommitEvents, fxSystemCommitEventDeliveries } from "../../persistence-postgres/src/commitEvents/schema";
import { makeCommitEventPump } from "../../persistence-postgres/src/commitEvents/pump";
import { CommitEventSubscriberFailure } from "../../persistence-postgres/src/commitEvents/model";
import { fxAppRowCurrent } from "../../persistence-postgres/src/schema";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";
import { productLogicalCreateEventPolicy, productLogicalVariantCreateEventPolicy } from "../src/product-local-events";
import { pricingLogicalCreateEventPolicy } from "../src/pricing-events";
import { prepareProductCreateWorkflow } from "../src/product-create-workflow";
import { prepareProductVariantPricingWorkflow, productVariantPricingWorkflow,
  ProductVariantPricingInput, ProductVariantPricingOutput } from "../src/product-variant-pricing-workflow";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type AtomicWorkflowHostComposition } from "../src/workflow/host";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../src/workflow/events";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalProductHost } from "./support/logical-product-fixture";
import { prepareLogicalPricingHost } from "./support/logical-pricing-fixture";
import { prepareLogicalVariantPricingLinkHost } from "./support/logical-variant-pricing-link-fixture";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid connected Pricing driver");
const cleanup: Array<() => Promise<void>> = [];
type Connected = { fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
  product: Awaited<ReturnType<typeof prepareLogicalProductHost>>;
  pricing: Awaited<ReturnType<typeof prepareLogicalPricingHost>>;
  link: Awaited<ReturnType<typeof prepareLogicalVariantPricingLinkHost>>;
  catalog: Effect.Success<ReturnType<typeof productRuntimeMetadata>> };
let selected: Connected;
const commitEvents = () => selected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents)
  .orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);
const execution = (connected: Connected, session = connected.fixture.session) => ({ identityAndAccessPolicy: connected.fixture.hostInput.identityAndAccessPolicy,
  prepare: (composition: AtomicWorkflowHostComposition) =>
    makeAtomicCommerceHost({ ...connected.fixture.hostInput, session, ...composition }) });
const revision = (name: string) => createHash("sha256").update(name).digest("hex");

async function seedProduct(connected: Connected, id: string) {
  const host = await Effect.runPromise(prepareProductCreateWorkflow({
    execution: execution(connected), modules: { product: { module: connected.product.runtime.workflow,
      logicalStorage: connected.product.hostInput.logicalStorage, moduleEvents: productLogicalCreateEventPolicy(connected.catalog) } },
    revision: revision("logical-priced-variant-product-create"),
    subscribers: [{ id: "logical-priced-variant-seed", revision: "a".repeat(64) }],
  }));
  try {
    return await Effect.runPromise(host.run(host.newRequestKey(), { products: [{ id, title: id,
      options: [{ title: "Size", values: ["0", "1", "2", "3"] }] }] }));
  } finally { await Effect.runPromise(host.close); }
}

const modules = (connected: Connected) => ({
  product: { module: connected.product.runtime.workflow, logicalStorage: connected.product.hostInput.logicalStorage,
    moduleEvents: productLogicalVariantCreateEventPolicy(connected.catalog) },
  pricing: { module: connected.pricing.runtime.workflow, logicalStorage: connected.pricing.hostInput.logicalStorage,
    moduleEvents: pricingLogicalCreateEventPolicy() },
  link: { module: connected.link.runtime.workflow, logicalStorage: connected.link.hostInput.logicalStorage,
    moduleEvents: connected.link.runtime.logicalEventPolicy() },
});

async function prepareConnectedHost(connected: Connected, selectedExecution: AtomicWorkflowExecution = execution(connected),
  selectedRevision = revision("logical-product-variant-pricing-workflow")) {
  return Effect.runPromise(prepareProductVariantPricingWorkflow({
    execution: selectedExecution, modules: modules(connected), revision: selectedRevision,
    subscribers: [{ id: "logical-product-variant-pricing", revision: "b".repeat(64) }],
  }));
}

async function prepareLateHost(connected: Connected,
  after: (value: unknown, context: StepExecutionContext) => unknown | Promise<unknown>,
  output: Schema.ConstraintDecoder<Schema.Json> = ProductVariantPricingOutput) {
  const registered = modules(connected);
  const resources = Result.getOrThrow(prepareWorkflowResources({
    product: { module: registered.product.module, methods: ["createProductVariants"], graph: true },
    pricing: { module: registered.pricing.module, methods: ["createPriceSets"], graph: true },
    link: { module: registered.link.module, methods: ["create"], graph: true },
  }, true));
  const flow = createWorkflow("observe-logical-priced-variants", (value: WorkflowData<typeof ProductVariantPricingInput.Type>) => {
    const created = productVariantPricingWorkflow.runAsStep({ input: value });
    const reached = createStep("after-logical-priced-variants", resources.callback(after));
    return new WorkflowResponse(reached(created));
  });
  return Effect.runPromise(prepareAtomicWorkflowHost({ execution: execution(connected), modules: registered,
    requestCallLimit: 128, revision: revision("observe-logical-product-variant-pricing"),
    subscribers: [{ id: "observe-logical-product-variant-pricing", revision: "c".repeat(64) }],
    workflow: { name: "observeLogicalProductVariantPricing", resources, prepared: Result.getOrThrow(flow.prepare()),
      input: ProductVariantPricingInput, output, events: internalModuleWorkflowEvents },
  }));
}

const input = (prefix: string, count = 4) => ({ product_id: prefix + "-product",
  variants: Array.from({ length: count }, (_, index) => ({ id: prefix + "-variant-" + index,
    title: prefix + " " + index, options: { Size: String(index) },
    priceSet: { id: prefix + "-set-" + index, prices: [
      { id: prefix + "-base-" + index, currency_code: "USD", amount: "123.4567890123456789", rules: { region_id: "r1" } },
      { id: prefix + "-other-" + index, currency_code: "EUR", amount: 200, rules: { region_id: "r2" } },
    ] },
  })) });

describe("native Product Variant Pricing workflow on shared logical storage", () => {
  beforeAll(async () => {
    const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), {
      includeProduct: true, includePricing: true, includeVariantPricingLink: true,
    });
    const product = await prepareLogicalProductHost(fixture);
    const pricing = await prepareLogicalPricingHost(fixture);
    const link = await prepareLogicalVariantPricingLinkHost(fixture);
    for (const member of [product, pricing, link]) {
      await Effect.runPromise(member.host.initialize([]));
      await Effect.runPromise(member.host.close);
    }
    const catalog = await Effect.runPromise(captureProductSchema("logical-priced-variant")
      .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    selected = { fixture, product, pricing, link, catalog };
  }, 150_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

  it("refuses a Variant pivot whose observed option belongs to another Product", async () => {
    const policy = productLogicalVariantCreateEventPolicy(selected.catalog);
    const result = await Effect.runPromise(Effect.result(policy.validateLogical([{
      commandName: "productCreatevariant", mode: "write", input: [], result: [], fromAttempt: 0, toAttempt: 2,
      fromLifecycle: 0, toLifecycle: 0,
      events: [{ name: selected.catalog.variant.createdEvent,
        metadata: { source: "product", object: selected.catalog.variant.eventObject, action: "created" },
        data: { id: "variant_wrong_owner" } }],
    }], [
      { ordinal: 0, table: selected.catalog.variant.table.name, operation: "insert", before: null,
        after: { id: "variant_wrong_owner", product_id: "product_a", deleted_at: null } },
      { ordinal: 1, table: selected.catalog.pivot.table.name, operation: "insert", before: null,
        after: { [selected.catalog.pivot.variantColumn]: "variant_wrong_owner",
          [selected.catalog.pivot.valueColumn]: "value_b" } },
    ], [], [
      { table: selected.catalog.option.table.name, row: { id: "option_b", product_id: "product_b", deleted_at: null } },
      { table: selected.catalog.value.table.name, row: { id: "value_b", option_id: "option_b", deleted_at: null } },
    ])));
    expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  });

  it("creates the maximum native graph through three logical participants and one publication", async () => {
    await seedProduct(selected, "maximum-product");
    const host = await prepareConnectedHost(selected);
    try {
      const beforeRows = await selected.fixture.persistence.drizzle.select().from(fxAppRowCurrent);
      const beforeEvents = await commitEvents();
      const key = host.newRequestKey();
      const result = await Effect.runPromise(host.run(key, input("maximum")));
      expect(result.variants).toHaveLength(4);
      expect(result.priceSets).toHaveLength(4);
      expect(result.links).toHaveLength(4);
      for (const variant of result.variants) {
        const association = result.links.find(item => item.variant_id === variant.id);
        expect(result.priceSets.find(set => set.id === association?.price_set_id)?.prices).toHaveLength(2);
      }
      expect(result.priceSets[0]?.prices[0]?.raw_amount.value).toBe("123.45678901234567890");
      const afterRows = await selected.fixture.persistence.drizzle.select().from(fxAppRowCurrent);
      const afterEvents = await commitEvents();
      expect(afterRows.length).toBe(beforeRows.length + 32);
      expect((await selected.fixture.persistence.query<{ name: string }>(
        "select tablename as name from pg_tables where schemaname = current_schema() order by tablename")).rows)
        .toEqual(selected.fixture.physicalTablesBeforeCandidate);
      const emitted = afterEvents.slice(beforeEvents.length);
      expect(new Set(emitted.map(event => event.commitSeq)).size).toBe(1);
      expect(emitted.map(event => event.envelope.contract).sort()).toEqual([
        "LinkProductVariantPriceSet.attached", ...Array.from({ length: 4 }, () => "product.product-variant.created"),
        ...Array.from({ length: 4 }, () => "pricing.price-set.created"),
        ...Array.from({ length: 8 }, () => "pricing.price.created"),
        ...Array.from({ length: 8 }, () => "pricing.price-rule.created"),
      ].sort());
      expect(await Effect.runPromise(host.run(key, input("maximum")))).toEqual(result);
      expect(await selected.fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterRows);
      expect(await commitEvents()).toEqual(afterEvents);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("keeps generated native identities and an empty PriceSet in the connected result", async () => {
    await seedProduct(selected, "generated-product");
    const host = await prepareConnectedHost(selected);
    try {
      const result = await Effect.runPromise(host.run(host.newRequestKey(), { product_id: "generated-product",
        variants: [
          { title: "Generated", options: { Size: "0" },
            priceSet: { prices: [{ currency_code: "USD", amount: 50 }] } },
          { title: "Empty", options: { Size: "1" } },
        ] }));
      expect(result.variants.every(variant => variant.id.startsWith("variant_"))).toBe(true);
      expect(result.priceSets.every(set => set.id.startsWith("pset_"))).toBe(true);
      expect(result.links.map(item => item.variant_id).sort()).toEqual(result.variants.map(variant => variant.id).sort());
      expect(result.links.map(item => item.price_set_id).sort()).toEqual(result.priceSets.map(set => set.id).sort());
      expect(result.priceSets.map(set => set.prices.length).sort()).toEqual([0, 1]);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("refuses invalid option ancestry and rolls back a late failure after all three native steps", async () => {
    await seedProduct(selected, "invalid-product");
    await seedProduct(selected, "late-product");
    await seedProduct(selected, "bad-output-product");
    const host = await prepareConnectedHost(selected);
    const beforeRows = await selected.fixture.persistence.drizzle.select().from(fxAppRowCurrent);
    const beforeEvents = await commitEvents();
    try {
      const bad = input("invalid", 1);
      const variant = bad.variants[0];
      if (variant === undefined) throw new Error("Missing invalid Variant input");
      variant.options.Size = "missing";
      await expect(Effect.runPromise(host.run(host.newRequestKey(), bad)))
        .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
      await expect(Effect.runPromise(host.run(host.newRequestKey(), input("missing", 1))))
        .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
      await expect(Effect.runPromise(host.run(host.newRequestKey(), input("invalid", 5))))
        .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
      expect(await selected.fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRows);
      expect(await commitEvents()).toEqual(beforeEvents);
    } finally { await Effect.runPromise(host.close); }
    const reached = vi.fn(() => { throw new Error("Late logical Pricing failure"); });
    const late = await prepareLateHost(selected, reached);
    try {
      await expect(Effect.runPromise(late.run(late.newRequestKey(), input("late")))).rejects.toBeDefined();
      expect(reached).toHaveBeenCalledTimes(1);
      expect(await selected.fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRows);
      expect(await commitEvents()).toEqual(beforeEvents);
    } finally { await Effect.runPromise(late.close); }
    const output = await prepareLateHost(selected, result => result, Schema.Null);
    try {
      await expect(Effect.runPromise(output.run(output.newRequestKey(), input("bad-output"))))
        .rejects.toMatchObject({ reason: "storedCorruption" });
      expect(await selected.fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRows);
      expect(await commitEvents()).toEqual(beforeEvents);
    } finally { await Effect.runPromise(output.close); }
  }, 120_000);

  it("keeps caught unselected module methods and cross-module hydration fatal", async () => {
    const callbacks: Array<(value: unknown, context: StepExecutionContext) => Promise<unknown>> = [
      async (value, { container }) => {
        const service = container.resolve<Pick<IPricingModuleService, "calculatePrices">>("pricing");
        try { await service.calculatePrices({ id: [] }); } catch { /* A caught borrowed refusal remains fatal. */ }
        return value;
      },
      async (value, { container }) => {
        const service = container.resolve<Pick<IPricingModuleService, "createPriceLists">>("pricing");
        try { await service.createPriceLists([]); } catch { /* Even empty unselected writes are fatal. */ }
        return value;
      },
      async (value, { container }) => {
        const query = container.resolve<{ graph(input: Schema.Json): Promise<unknown> }>("query");
        try { await query.graph({ entity: "price_set", fields: ["variant.id"], pagination: { take: 1 } }); }
        catch { /* Cross-module hydration is unadmitted. */ }
        return value;
      },
      async (value, { container }) => {
        const service = container.resolve<{ restore(input: Schema.Json): Promise<unknown> }>("link");
        try { await service.restore({ pricing: { price_set_id: [] } }); }
        catch { /* Link restore is outside this selected workflow. */ }
        return value;
      },
    ];
    for (const [index, callback] of callbacks.entries()) {
      const prefix = "unselected-" + index;
      await seedProduct(selected, prefix + "-product");
      const beforeRows = await selected.fixture.persistence.drizzle.select().from(fxAppRowCurrent);
      const beforeEvents = await commitEvents();
      const reached = vi.fn(callback);
      const host = await prepareLateHost(selected, reached);
      try {
        await expect(Effect.runPromise(host.run(host.newRequestKey(), input(prefix))))
          .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
        expect(reached).toHaveBeenCalledTimes(1);
        expect(await selected.fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRows);
        expect(await commitEvents()).toEqual(beforeEvents);
      } finally { await Effect.runPromise(host.close); }
    }
  }, 150_000);

  it("binds the workflow revision to its retained request outcome", async () => {
    await seedProduct(selected, "revision-product");
    const host = await prepareConnectedHost(selected);
    try {
      const key = host.newRequestKey();
      await Effect.runPromise(host.run(key, input("revision", 1)));
      const rows = await selected.fixture.persistence.drizzle.select().from(fxAppRowCurrent);
      const events = await commitEvents();
      const changed = await prepareConnectedHost(selected, execution(selected), "f".repeat(64));
      try {
        await expect(Effect.runPromise(changed.run(key, input("revision", 1))))
          .rejects.toMatchObject({ reason: "requestConflict" });
        expect(await selected.fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(rows);
        expect(await commitEvents()).toEqual(events);
      } finally { await Effect.runPromise(changed.close); }
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("cancels pending native work and revokes an escaped Pricing service", async () => {
    await seedProduct(selected, "cancel-product");
    const reached = await Effect.runPromise(Deferred.make<void>());
    let release: (() => void) | undefined;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    let escaped: Pick<IPricingModuleService, "createPriceSets"> | undefined;
    const host = await prepareLateHost(selected, async (value, { container }) => {
      escaped = container.resolve("pricing");
      await Effect.runPromise(Deferred.succeed(reached, undefined));
      await waiting;
      return value;
    });
    const beforeRows = await selected.fixture.persistence.drizzle.select().from(fxAppRowCurrent);
    const beforeEvents = await commitEvents();
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const fiber = yield* Effect.forkScoped(host.run(host.newRequestKey(), input("cancel", 1)));
        yield* Deferred.await(reached).pipe(Effect.timeout(20_000));
        yield* Fiber.interrupt(fiber);
      })));
      expect(await selected.fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRows);
      expect(await commitEvents()).toEqual(beforeEvents);
      if (escaped === undefined) throw new Error("Missing escaped Pricing method");
      await expect(escaped.createPriceSets([])).rejects.toMatchObject({ reason: "closed" });
    } finally { release?.(); await Effect.runPromise(host.close); }
  }, 120_000);

  it("isolates matching native identities for two shops on the same generic tables", async () => {
    const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), {
      resource: selected.fixture.resource,
      fixtureIdentity: { deploymentId: "deployment_priced_variant_shop_b", projectId: "project_priced_variant_shop_b",
        uuidOffset: 3_000 },
      includeProduct: true, includePricing: true, includeVariantPricingLink: true,
    });
    const product = await prepareLogicalProductHost(fixture);
    const pricing = await prepareLogicalPricingHost(fixture);
    const link = await prepareLogicalVariantPricingLinkHost(fixture);
    for (const member of [product, pricing, link]) {
      await Effect.runPromise(member.host.initialize([]));
      await Effect.runPromise(member.host.close);
    }
    const other = { fixture, product, pricing, link, catalog: selected.catalog } satisfies Connected;
    await seedProduct(selected, "shared-product");
    await seedProduct(other, "shared-product");
    const first = await prepareConnectedHost(selected);
    const second = await prepareConnectedHost(other);
    try {
      const firstScope = projectScopeIdUuidV1(selected.fixture.application.authority.scopeId).scopeUuid;
      const secondScope = projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid;
      expect(firstScope).not.toBe(secondScope);
      const same = input("shared", 1);
      const firstResult = await Effect.runPromise(first.run(first.newRequestKey(), same));
      const firstRows = (await selected.fixture.persistence.drizzle.select().from(fxAppRowCurrent))
        .filter(row => row.scopeUuid === firstScope);
      const secondResult = await Effect.runPromise(second.run(second.newRequestKey(), same));
      expect(secondResult.variants).toEqual(firstResult.variants);
      expect(secondResult.priceSets).toMatchObject([{ id: "shared-set-0", prices: [
        { id: "shared-base-0", raw_amount: { value: "123.45678901234567890" } },
        { id: "shared-other-0" },
      ] }]);
      expect(secondResult.links).toMatchObject([{ variant_id: "shared-variant-0", price_set_id: "shared-set-0" }]);
      expect((await selected.fixture.persistence.drizzle.select().from(fxAppRowCurrent))
        .filter(row => row.scopeUuid === firstScope)).toEqual(firstRows);
      expect((await selected.fixture.persistence.drizzle.select().from(fxAppRowCurrent))
        .filter(row => row.scopeUuid === secondScope).length).toBeGreaterThan(1);
    } finally { await Effect.runPromise(first.close); await Effect.runPromise(second.close); }
  }, 150_000);

  it("recovers an uncertain committed root without rerunning native steps", async () => {
    await seedProduct(selected, "uncertain-product");
    let lose = true;
    const session = issueRelationalSession(selected.fixture.persistence.drizzle,
      (profile, work) => runRelationalSession(selected.fixture.session, profile, work).pipe(
        Effect.catchTag("RelationalTransactionError", cause =>
          Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
        Effect.flatMap(value => {
          if (!lose) return Effect.succeed(value);
          lose = false;
          return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain",
            cause: new Error("Lost logical Pricing COMMIT acknowledgement") }));
        }),
      ));
    const host = await prepareConnectedHost(selected, execution(selected, session));
    try {
      const before = await commitEvents();
      const key = host.newRequestKey();
      const result = await Effect.runPromise(host.run(key, input("uncertain", 1)));
      const after = await commitEvents();
      expect(lose).toBe(false);
      expect(after.length).toBe(before.length + 7);
      expect(await Effect.runPromise(host.run(key, input("uncertain", 1)))).toEqual(result);
      expect(await commitEvents()).toEqual(after);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("retains the committed graph when a subscriber cannot deliver", async () => {
    await seedProduct(selected, "subscriber-product");
    const host = await prepareConnectedHost(selected);
    try {
      const key = host.newRequestKey();
      const result = await Effect.runPromise(host.run(key, input("subscriber", 1)));
      const rows = await selected.fixture.persistence.drizzle.select().from(fxAppRowCurrent);
      const events = await commitEvents();
      const commit = events.at(-1);
      if (commit === undefined) throw new Error("Missing connected Pricing commit");
      const handle = vi.fn(() => Effect.fail(new CommitEventSubscriberFailure({ retryable: true, code: "offline" })));
      const pump = await Effect.runPromise(makeCommitEventPump(selected.fixture.hostInput,
        [{ id: "logical-product-variant-pricing", revision: "b".repeat(64), handle }]));
      await Effect.runPromise(pump.runNext(commit.commitSeq - 1n));
      expect(handle).toHaveBeenCalledTimes(7);
      const deliveries = (await selected.fixture.persistence.drizzle.select().from(fxSystemCommitEventDeliveries))
        .filter(row => row.commitSeq === commit.commitSeq);
      expect(deliveries).toHaveLength(7);
      expect(deliveries.every(row => row.attempts === 1 && row.state !== "delivered")).toBe(true);
      expect(await selected.fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(rows);
      expect(await commitEvents()).toEqual(events);
      expect(await Effect.runPromise(host.run(key, input("subscriber", 1)))).toEqual(result);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);
});
