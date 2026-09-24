import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Effect, Result } from "effect";
import { createHash } from "node:crypto";
import { createStep, createWorkflow, WorkflowResponse, type WorkflowData, type StepExecutionContext } from "@medusajs/workflows-sdk";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/atomicCommerce/host";
import { fxAppRowCurrent } from "../../persistence-postgres/src/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commitEvents/schema";
import { fxSystemCommitEventDeliveries } from "../../persistence-postgres/src/commitEvents/schema";
import { makeCommitEventPump } from "../../persistence-postgres/src/commitEvents/pump";
import { CommitEventSubscriberFailure } from "../../persistence-postgres/src/commitEvents/model";
import { issueRelationalSession, runRelationalSession } from "../../persistence-postgres/src/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/relationalTransaction/model";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";
import { productLogicalCreateEventPolicy } from "../src/product-local-events";
import { prepareProductSalesChannelWorkflow, productSalesChannelWorkflow, ProductSalesChannelInput,
  ProductSalesChannelOutput } from "../src/product-sales-channel-workflow";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type AtomicWorkflowHostComposition } from "../src/workflow/host";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../src/workflow/events";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalProductHost } from "./support/logical-product-fixture";
import { prepareLogicalSalesChannelHost } from "./support/logical-sales-channel-fixture";
import { prepareLogicalProductSalesChannelLinkHost } from "./support/logical-product-sales-channel-link-fixture";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Link workflow driver");
const cleanup: Array<() => Promise<void>> = [];
let selected: {
  fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
  product: Awaited<ReturnType<typeof prepareLogicalProductHost>>;
  sales: Awaited<ReturnType<typeof prepareLogicalSalesChannelHost>>;
  link: Awaited<ReturnType<typeof prepareLogicalProductSalesChannelLinkHost>>;
  catalog: Effect.Success<ReturnType<typeof productRuntimeMetadata>>;
};
const revision = (value: string) => createHash("sha256").update(value).digest("hex");
const input = (prefix: string, count = 1) => ({ salesChannel: { id: prefix + "-channel", name: prefix },
  products: Array.from({ length: count }, (_, index) => ({ id: prefix + "-" + index, title: prefix + "-" + index })) });
const modules = () => {
  const { product, sales, link, catalog } = selected;
  return {
      product: { module: product.runtime.workflow, logicalStorage: product.hostInput.logicalStorage,
        moduleEvents: productLogicalCreateEventPolicy(catalog) },
      sales_channel: { module: sales.runtime.workflow, logicalStorage: sales.hostInput.logicalStorage,
        moduleEvents: sales.runtime.logicalEventPolicy() },
      link: { module: link.runtime.workflow, logicalStorage: link.hostInput.logicalStorage,
        moduleEvents: link.runtime.logicalEventPolicy() },
    };
};
const execution = (session = selected.fixture.session) => ({ identityAndAccessPolicy: selected.fixture.hostInput.identityAndAccessPolicy,
  prepare: (composition: AtomicWorkflowHostComposition) => makeAtomicCommerceHost({ ...selected.fixture.hostInput, session, ...composition }) });
async function prepare() {
  return Effect.runPromise(prepareProductSalesChannelWorkflow({
    execution: execution(), modules: modules(), revision: revision("logical-product-sales-channel-workflow"),
    subscribers: [{ id: "logical-product-sales-channel", revision: "a".repeat(64) }],
  }));
}
async function observe(after: (value: unknown, context: StepExecutionContext) => unknown | Promise<unknown>,
  selectedModules = modules(), selectedExecution: AtomicWorkflowExecution = execution()) {
  const resources = Result.getOrThrow(prepareWorkflowResources({
    product: { module: selectedModules.product.module, methods: ["createProducts"], graph: true },
    sales_channel: { module: selectedModules.sales_channel.module, methods: ["createSalesChannels"], graph: true },
    link: { module: selectedModules.link.module, methods: ["create"], graph: true },
  }, true));
  const flow = createWorkflow("observe-logical-product-sales-channel", (value: WorkflowData<typeof ProductSalesChannelInput.Type>) => {
    const result = productSalesChannelWorkflow.runAsStep({ input: value });
    const callback = createStep("after-logical-product-sales-channel", resources.callback(after));
    return new WorkflowResponse(callback(result));
  });
  return Effect.runPromise(prepareAtomicWorkflowHost({ execution: selectedExecution, modules: selectedModules,
    revision: revision("observe-logical-product-sales-channel"),
    subscribers: [{ id: "observe-logical-product-sales-channel", revision: "b".repeat(64) }],
    workflow: { name: "observeLogicalProductSalesChannel", resources, prepared: Result.getOrThrow(flow.prepare()),
      input: ProductSalesChannelInput, output: ProductSalesChannelOutput, events: internalModuleWorkflowEvents },
  }));
}

describe("native Product–SalesChannel workflow on shared logical storage", () => {
  beforeAll(async () => {
    const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), {
      includeProduct: true, includeSalesChannel: true, includeProductSalesChannelLink: true,
    });
    const product = await prepareLogicalProductHost(fixture);
    const sales = await prepareLogicalSalesChannelHost(fixture);
    const link = await prepareLogicalProductSalesChannelLinkHost(fixture);
    for (const member of [product, sales, link]) {
      await Effect.runPromise(member.host.initialize([]));
      await Effect.runPromise(member.host.close);
    }
    const catalog = await Effect.runPromise(captureProductSchema("logical-product-sales-channel")
      .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    selected = { fixture, product, sales, link, catalog };
  }, 150_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

  it("admits the native Link with a scoped pair key and no generated module table", async () => {
    const { fixture, link } = selected;
    expect(link.definition.schema.tables.map(table => table.identity.tableId)).toEqual(["product_sales_channel"]);
    const table = link.definition.schema.tables[0];
    expect(table?.keys.find(key => key.kind === "primary")?.columns.map(column => column.columnId))
      .toEqual(["product_id", "sales_channel_id"]);
    expect(table?.constraints.filter(item => item.kind === "foreignKey")).toEqual([]);
    expect((await fixture.persistence.query<{ name: string }>(
      "select tablename as name from pg_tables where schemaname = current_schema() order by tablename")).rows)
      .toEqual(fixture.physicalTablesBeforeCandidate);
  });

  it("creates all three native participants atomically with pending Link reads and replay", async () => {
    const host = await prepare();
    try {
      const beforeRows = await selected.fixture.persistence.drizzle.select().from(fxAppRowCurrent);
      const beforeEvents = await selected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents);
      const key = host.newRequestKey();
      const result = await Effect.runPromise(host.run(key, input("connected", 4)));
      expect(result.products).toHaveLength(4);
      expect(result.salesChannels).toHaveLength(1);
      expect(result.links).toHaveLength(4);
      expect(result.links.map(link => link.product_id).sort()).toEqual(result.products.map(product => product.id).sort());
      const rows = await selected.fixture.persistence.drizzle.select().from(fxAppRowCurrent);
      const events = await selected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents);
      expect(rows.length).toBeGreaterThan(beforeRows.length);
      expect(events.length - beforeEvents.length).toBe(6);
      expect(await Effect.runPromise(host.run(key, input("connected", 4)))).toEqual(result);
      expect(await selected.fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(rows);
      expect(await selected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(events);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("uses native generated IDs and enforces the four-Product request envelope", async () => {
    const host = await prepare();
    try {
      const result = await Effect.runPromise(host.run(host.newRequestKey(), {
        salesChannel: { name: "generated-channel" }, products: [{ title: "generated-product" }],
      }));
      expect(result.links).toMatchObject([{ product_id: result.products[0]?.id,
        sales_channel_id: result.salesChannels[0]?.id }]);
      const before = await selected.fixture.persistence.drizzle.select().from(fxAppRowCurrent);
      await expect(Effect.runPromise(host.run(host.newRequestKey(), input("oversized", 5)))).rejects.toBeDefined();
      expect(await selected.fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(before);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("rolls back every participant on a late native callback failure", async () => {
    const host = await observe(() => { throw new Error("late workflow failure"); });
    try {
      const beforeRows = await selected.fixture.persistence.drizzle.select().from(fxAppRowCurrent);
      const beforeEvents = await selected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents);
      await expect(Effect.runPromise(host.run(host.newRequestKey(), input("late-failure")))).rejects.toBeDefined();
      expect(await selected.fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRows);
      expect(await selected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(beforeEvents);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("rejects a forged Link event and retains no endpoint writes", async () => {
    const selectedModules = modules();
    const policy = selectedModules.link.moduleEvents;
    if (policy === undefined) throw new Error("Missing Link event policy");
    const capture = vi.fn((value: unknown) => policy.capture(value).pipe(Effect.map(message => {
      if (typeof message !== "object" || message === null || Array.isArray(message)) throw new Error("Missing Link event");
      return { ...message, data: { id: "prodsc_forged" } };
    })));
    const host = await observe(value => value, { ...selectedModules,
      link: { ...selectedModules.link, moduleEvents: { ...policy, capture } },
    });
    try {
      const beforeRows = await selected.fixture.persistence.drizzle.select().from(fxAppRowCurrent);
      const beforeEvents = await selected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents);
      await expect(Effect.runPromise(host.run(host.newRequestKey(), input("forged-event"))))
        .rejects.toMatchObject({ reason: "receiptMismatch" });
      expect(capture).toHaveBeenCalled();
      expect(await selected.fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRows);
      expect(await selected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(beforeEvents);
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
            cause: new Error("Lost logical workflow COMMIT acknowledgement") }));
        })));
    const reached = vi.fn((value: unknown) => value);
    const host = await observe(reached, modules(), execution(session));
    try {
      const key = host.newRequestKey();
      const before = await fixture.persistence.drizzle.select().from(fxSystemCommitEvents);
      const result = await Effect.runPromise(host.run(key, input("uncertain")));
      const committed = await fixture.persistence.drizzle.select().from(fxSystemCommitEvents);
      expect(committed.length - before.length).toBe(3);
      expect(await Effect.runPromise(host.run(key, input("uncertain")))).toEqual(result);
      expect(await fixture.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(committed);
      expect(reached).toHaveBeenCalledTimes(1);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("keeps committed participants intact when event delivery fails", async () => {
    const host = await prepare();
    try {
      const key = host.newRequestKey();
      const result = await Effect.runPromise(host.run(key, input("subscriber")));
      const beforeRows = await selected.fixture.persistence.drizzle.select().from(fxAppRowCurrent);
      const beforeEvents = await selected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents);
      const last = beforeEvents.at(-1);
      if (last === undefined) throw new Error("Missing workflow commit");
      const handle = vi.fn(() => Effect.fail(new CommitEventSubscriberFailure({ retryable: true, code: "offline" })));
      const subscribers = [{ id: "logical-product-sales-channel", revision: "a".repeat(64), handle }];
      const pump = await Effect.runPromise(makeCommitEventPump(selected.fixture.hostInput, subscribers));
      await Effect.runPromise(pump.runNext(last.commitSeq - 1n));
      expect(handle).toHaveBeenCalledTimes(3);
      expect(await selected.fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRows);
      expect(await selected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(beforeEvents);
      expect((await selected.fixture.persistence.drizzle.select().from(fxSystemCommitEventDeliveries))
        .filter(row => row.commitSeq === last.commitSeq).every(row => row.attempts === 1 && row.state !== "delivered")).toBe(true);
      expect(await Effect.runPromise(host.run(key, input("subscriber")))).toEqual(result);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);
});
