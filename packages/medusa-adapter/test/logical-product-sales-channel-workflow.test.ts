import { withWorkflowPolicy } from "./support/workflow-policy-fixture";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Effect, Result } from "effect";
import { createHash } from "node:crypto";
import { createStep, createWorkflow, WorkflowResponse, type WorkflowData, type StepExecutionContext } from "@medusajs/workflows-sdk";
import { makeCoreCommitEventPump } from "../../persistence-postgres/src/commit/events/coreStore";
import { CommitEventSubscriberFailure } from "../../persistence-postgres/src/commit/events/model";
import { prepareProductSalesChannelWorkflow, productSalesChannelWorkflow, ProductSalesChannelInput,
  ProductSalesChannelOutput } from "../src/workflows/product/sales-channel";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../src/workflow/host";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../src/workflow/events";
import { createCoreProductSalesChannelLinkFixture, type CoreProductSalesChannelLinkFixture } from "./support/core-product-sales-channel-link-fixture";
import { expectWorkflowDefect, expectWorkflowTypedFailures } from "./support/workflow-failure-assertions";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Link workflow driver");
const cleanup: Array<() => Promise<void>> = [];
let selected: CoreProductSalesChannelLinkFixture;
const snapshot = () => selected.fixture.snapshot();
const revision = (value: string) => createHash("sha256").update(value).digest("hex");
const input = (prefix: string, count = 1) => ({ salesChannel: { id: prefix + "-channel", name: prefix },
  products: Array.from({ length: count }, (_, index) => ({ id: prefix + "-" + index, title: prefix + "-" + index })) });
const modules = () => {
  const { product, sales, link } = selected;
  return {
      product: { module: product.runtime.workflow, nativeStorage: product.source },
      sales_channel: { module: sales.runtime.workflow, nativeStorage: sales.source },
      link: { module: link.runtime.workflow, nativeStorage: link.source },
    };
};
const execution = () => selected.execution;
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
    selected = await createCoreProductSalesChannelLinkFixture(driver, close => cleanup.push(close));
  }, 150_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

  it("admits the native Link with a scoped pair key and no generated module table", async () => {
    const { link } = selected;
    expect(selected.product.definition.tables).toHaveLength(13);
    expect(selected.sales.definition.tables).toHaveLength(1);
    expect(link.schema.tables.map(table => table.identity.tableId)).toEqual(["product_sales_channel"]);
    const table = link.schema.tables[0];
    expect(table?.keys.find(key => key.kind === "primary")?.columns.map(column => column.columnId))
      .toEqual(["product_id", "sales_channel_id"]);
    expect(table?.constraints.filter(item => item.kind === "foreignKey")).toEqual([]);
    expect(await selected.readPhysicalTables()).toEqual(selected.physicalTablesBeforeCandidate);
  });

  it("creates all three native participants atomically with pending Link reads and replay", async () => {
    const host = await prepare();
    try {
      const before = await snapshot();
      const key = host.newRequestKey();
      const result = await Effect.runPromise(host.run(key, input("connected", 4)));
      expect(result.products).toHaveLength(4);
      expect(result.salesChannels).toHaveLength(1);
      expect(result.links).toHaveLength(4);
      expect(result.links.map(link => link.product_id).sort()).toEqual(result.products.map(product => product.id).sort());
      const committed = await snapshot();
      expect(committed.rows.length).toBeGreaterThan(before.rows.length);
      expect(committed.events.length - before.events.length).toBe(6);
      expect(committed.outcomes.length - before.outcomes.length).toBe(1);
      expect(await Effect.runPromise(host.run(key, input("connected", 4)))).toEqual(result);
      expect(await snapshot()).toEqual(committed);
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
      const before = await snapshot();
      await expect(Effect.runPromise(host.run(host.newRequestKey(), input("oversized", 5)))).rejects.toBeDefined();
      expect(await snapshot()).toEqual(before);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("rolls back every participant on a late native callback failure", async () => {
    const original = new Error("late workflow failure");
    const host = await observe(() => { throw original; });
    try {
      const before = await snapshot();
      expectWorkflowDefect(await Effect.runPromiseExit(host.run(host.newRequestKey(), input("late-failure"))), original);
      expect(await snapshot()).toEqual(before);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("rejects a forged Link event and retains no endpoint writes", async () => {
    const selectedModules = modules();
    const policy = selected.link.runtime.logicalEventPolicy();
    if (policy === undefined) throw new Error("Missing Link event policy");
    const capture = vi.fn((value: unknown) => policy.capture(value).pipe(Effect.map(message => {
      if (typeof message !== "object" || message === null || Array.isArray(message)) throw new Error("Missing Link event");
      return { ...message, data: { id: "prodsc_forged" } };
    })));
    const host = await observe(value => value, { ...selectedModules,
      link: { ...selectedModules.link, module: withWorkflowPolicy(selectedModules.link.module, policy => ({ ...policy, capture })) },
    });
    try {
      const before = await snapshot();
      expectWorkflowTypedFailures(await Effect.runPromiseExit(host.run(host.newRequestKey(), input("forged-event"))), "receiptMismatch");
      expect(capture).toHaveBeenCalled();
      expect(await snapshot()).toEqual(before);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("recovers an uncertain commit without replaying native callbacks", async () => {
    const { fixture } = selected;
    const reached = vi.fn((value: unknown) => value);
    const host = await observe(reached);
    try {
      const fault = fixture.loseNextNativeRootAcknowledgement();
      const key = host.newRequestKey();
      const before = await snapshot();
      const result = await Effect.runPromise(host.run(key, input("uncertain")));
      const committed = await snapshot();
      expect(fault.armed).toBe(false); expect(fault.failures).toBe(1);
      expect(fault.evidence?.inventory).toEqual(await fixture.inventory());
      expect(committed.events.length - before.events.length).toBe(3);
      expect(committed.outcomes.length - before.outcomes.length).toBe(1);
      expect(await Effect.runPromise(host.run(key, input("uncertain")))).toEqual(result);
      expect(await snapshot()).toEqual(committed);
      expect(reached).toHaveBeenCalledTimes(1);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("keeps committed participants intact when event delivery fails", async () => {
    const host = await prepare();
    try {
      const key = host.newRequestKey();
      const result = await Effect.runPromise(host.run(key, input("subscriber")));
      const before = await snapshot();
      const last = before.events.at(-1);
      if (last === undefined) throw new Error("Missing workflow commit");
      const handle = vi.fn(() => Effect.fail(new CommitEventSubscriberFailure({ retryable: true, code: "offline" })));
      const subscribers = [{ id: "logical-product-sales-channel", revision: "a".repeat(64), handle }];
      const previous = before.families.map(family => family.value.id).filter((id): id is string => typeof id === "string")
        .toSorted().filter(id => id < last.familyId).at(-1);
      await selected.fixture.run(selected.fixture.useGeneration(generation => Effect.gen(function* () {
        const definition = selected.fixture.eventDefinition;
        if (definition === undefined) return yield* Effect.die(new Error("Missing Core native event source"));
        const binding = yield* generation.database.bindNative({ definition });
        const pump = yield* makeCoreCommitEventPump({ database: generation.database, binding }, subscribers);
        yield* pump.runNext(previous);
      })));
      expect(handle).toHaveBeenCalledTimes(3);
      const after = await snapshot();
      for (const key of ["rows", "revisions", "indexes", "events", "families", "outcomes"] as const)
        expect(after[key], key).toEqual(before[key]);
      const deliveries = after.deliveries.filter(row => row.value.family_id === last.familyId);
      expect(deliveries).toHaveLength(3);
      expect(deliveries.every(row => row.value.attempts === 1 && row.value.state !== "delivered")).toBe(true);
      expect(await Effect.runPromise(host.run(key, input("subscriber")))).toEqual(result);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);
});
