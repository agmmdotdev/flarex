import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Result, Schema } from "effect";
import { createWorkflow, transform, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createVariantPricingLinkStep } from "@medusajs/core-flows/product/create-variant-pricing-link-step";
import { useQueryGraphStep } from "@medusajs/core-flows/common/use-query-graph";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { prepareAtomicWorkflowHost } from "../src/workflow/host";
import { internalModuleWorkflowEvents } from "../src/workflow/events";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/atomicCommerce/host";
import { makeCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commitEvents/schema";
import { fxAppRowCurrent } from "../../persistence-postgres/src/schema";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalVariantPricingLinkHost } from "./support/logical-variant-pricing-link-fixture";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Link test driver");
const cleanup: Array<() => Promise<void>> = [];
let fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
let link: Awaited<ReturnType<typeof prepareLogicalVariantPricingLinkHost>>;
const Input = Schema.Struct({ links: Schema.Array(Schema.Struct({ variant_id: Schema.String, price_set_id: Schema.String }))
  .check(Schema.isLengthBetween(1, 4)) });
const Output = Schema.Array(Schema.Struct({ id: Schema.String, variant_id: Schema.String, price_set_id: Schema.String }));
async function prepareAttachHost(selected: Awaited<ReturnType<typeof prepareLogicalVariantPricingLinkHost>>) {
  const resources = Result.getOrThrow(prepareWorkflowResources({ link: {
    module: selected.runtime.workflow, methods: ["create"], graph: true,
  } }, true));
  const flow = createWorkflow("attach-logical-variant-prices", (input: WorkflowData<typeof Input.Type>) => {
    createVariantPricingLinkStep(transform(input, value => ({ links: value.links.map(item => ({ ...item })) })));
    const ids = transform(input, value => value.links.map(item => item.variant_id));
    const pending = useQueryGraphStep({ entity: "product_variant_price_sets",
      fields: ["id", "variant_id", "price_set_id"], filters: { variant_id: ids }, pagination: { take: 4 } });
    return new WorkflowResponse(pending.data);
  });
  return Effect.runPromise(prepareAtomicWorkflowHost({
    execution: { identityAndAccessPolicy: selected.hostInput.identityAndAccessPolicy,
      prepare: composition => makeAtomicCommerceHost({ ...selected.hostInput, ...composition }) },
    modules: { link: { module: selected.runtime.workflow, logicalStorage: selected.hostInput.logicalStorage,
      moduleEvents: selected.runtime.logicalEventPolicy() } },
    revision: "c".repeat(64), subscribers: [{ id: "logical-variant-pricing-link", revision: "d".repeat(64) }],
    workflow: { name: "logicalVariantPricingLinkAttach", resources, prepared: Result.getOrThrow(flow.prepare()),
      input: Input, output: Output, events: internalModuleWorkflowEvents },
  }));
}

describe("native Variant–PriceSet Link on shared logical storage", () => {
  beforeAll(async () => {
    fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), {
      includeProduct: true, includePricing: true, includeVariantPricingLink: true,
    });
    link = await prepareLogicalVariantPricingLinkHost(fixture);
    await Effect.runPromise(link.host.initialize([]));
    await Effect.runPromise(link.host.close);
  }, 150_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

  it("admits the native rich Link with no generated module table", async () => {
    expect(link.definition.schema.tables.map(table => table.identity.tableId)).toEqual(["product_variant_price_set"]);
    const table = link.definition.schema.tables[0];
    expect(table?.constraints.filter(item => item.kind === "foreignKey")).toEqual([]);
    expect(table?.keys.find(key => key.kind === "primary")?.columns.map(column => column.columnId))
      .toEqual(["variant_id", "price_set_id"]);
    expect(table?.indexes.filter(index => index.kind === "uniqueBtree").map(index => ({
      columns: index.columns.map(column => column.columnId), predicate: index.predicate?.kind,
    })).sort((a, b) => a.columns[0]!.localeCompare(b.columns[0]!))).toEqual([
      { columns: ["price_set_id"], predicate: "isNull" },
      { columns: ["variant_id"], predicate: "isNull" },
    ]);
    expect((await fixture.persistence.query<{ name: string }>(
      "select tablename as name from pg_tables where schemaname = current_schema() order by tablename")).rows)
      .toEqual(fixture.physicalTablesBeforeCandidate);
  });

  it("refuses a Link row whose native attached message is missing", async () => {
    const policy = link.runtime.logicalEventPolicy();
    expect(await Effect.runPromise(Effect.result(policy.validateLogical([
      { commandName: "linkCreate", mode: "write", input: [], result: [], events: [], fromAttempt: 0, toAttempt: 1,
        fromLifecycle: 0, toLifecycle: 0 },
    ], [{ ordinal: 0, table: "product_variant_price_set", operation: "insert", before: null,
      after: { id: "pvps_orphan", variant_id: "variant", price_set_id: "pset", deleted_at: null } }], [], []))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  });

  it("attaches native Link rows without endpoint FKs and reads them pending before one publication", async () => {
    const host = await prepareAttachHost(link);
    try {
      const before = await fixture.persistence.drizzle.select().from(fxSystemCommitEvents);
      const beforeRows = await fixture.persistence.drizzle.select().from(fxAppRowCurrent);
      await expect(Effect.runPromise(host.run(host.newRequestKey(), { links: [
        { variant_id: "bulk_conflict", price_set_id: "pset_one" },
        { variant_id: "bulk_conflict", price_set_id: "pset_two" },
      ] }))).rejects.toBeDefined();
      expect(await fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRows);
      expect(await fixture.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(before);
      const key = host.newRequestKey();
      const value = await Effect.runPromise(host.run(key, { links: [
        { variant_id: "variant_without_target", price_set_id: "pset_without_target" },
      ] }));
      expect(value).toMatchObject([{ variant_id: "variant_without_target", price_set_id: "pset_without_target" }]);
      expect(value[0]?.id).toMatch(/^pvps_/);
      expect((await fixture.persistence.drizzle.select().from(fxSystemCommitEvents)).slice(before.length)
        .map(event => event.envelope.contract)).toEqual(["LinkProductVariantPriceSet.attached"]);
      expect(await Effect.runPromise(host.run(key, { links: [
        { variant_id: "variant_without_target", price_set_id: "pset_without_target" },
      ] }))).toEqual(value);
      const reader = await Effect.runPromise(makeCommerceHost(link.hostInput));
      try {
        const observedSql: string[] = [];
        fixture.observeSql?.(sql => { observedSql.push(sql); });
        expect(await Effect.runPromise(reader.read(link.runtime.count, { filters: { variant_id: "variant_without_target" },
          config: { select: ["id", "variant_id", "price_set_id"], take: 1 } })))
          .toMatchObject([[{ id: value[0]?.id, variant_id: "variant_without_target",
            price_set_id: "pset_without_target" }], 1]);
        if (fixture.observeSql !== undefined) expect(observedSql.some(sql => sql.includes("fx_app_index_entry_current"))).toBe(true);
      } finally { fixture.observeSql?.(undefined); await Effect.runPromise(reader.close); }
      const rows = await fixture.persistence.drizzle.select().from(fxAppRowCurrent);
      const events = await fixture.persistence.drizzle.select().from(fxSystemCommitEvents);
      await expect(Effect.runPromise(host.run(host.newRequestKey(), { links: [
        { variant_id: "variant_without_target", price_set_id: "another_price_set" },
      ] }))).rejects.toBeDefined();
      expect(await fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(rows);
      expect(await fixture.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(events);
    } finally { await Effect.runPromise(host.close); }
  }, 60_000);

  it("confines colliding native endpoint pairs to two shops on shared physical tables", async () => {
    const other = await logicalCurrencyFixture(driver, close => cleanup.push(close), {
      resource: fixture.resource, fixtureIdentity: { deploymentId: "deployment_variant_pricing_link_shop_b",
        projectId: "project_variant_pricing_link_shop_b", uuidOffset: 2_000 },
      includeProduct: true, includePricing: true, includeVariantPricingLink: true,
    });
    const otherLink = await prepareLogicalVariantPricingLinkHost(other);
    await Effect.runPromise(otherLink.host.initialize([]));
    await Effect.runPromise(otherLink.host.close);
    const first = await prepareAttachHost(link);
    const second = await prepareAttachHost(otherLink);
    try {
      const firstScope = projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid;
      const secondScope = projectScopeIdUuidV1(other.application.authority.scopeId).scopeUuid;
      expect(firstScope).not.toBe(secondScope);
      const same = { links: [{ variant_id: "shared_variant", price_set_id: "shared_price_set" }] };
      const firstResult = await Effect.runPromise(first.run(first.newRequestKey(), same));
      const firstRows = (await fixture.persistence.drizzle.select().from(fxAppRowCurrent))
        .filter(row => row.scopeUuid === firstScope);
      const secondRowsBefore = (await fixture.persistence.drizzle.select().from(fxAppRowCurrent))
        .filter(row => row.scopeUuid === secondScope);
      const secondResult = await Effect.runPromise(second.run(second.newRequestKey(), same));
      expect(secondResult).toMatchObject([{ variant_id: "shared_variant", price_set_id: "shared_price_set" }]);
      expect(firstResult).toMatchObject([{ variant_id: "shared_variant", price_set_id: "shared_price_set" }]);
      expect((await fixture.persistence.drizzle.select().from(fxAppRowCurrent))
        .filter(row => row.scopeUuid === firstScope)).toEqual(firstRows);
      expect((await fixture.persistence.drizzle.select().from(fxAppRowCurrent))
        .filter(row => row.scopeUuid === secondScope)).toHaveLength(secondRowsBefore.length + 1);
    } finally { await Effect.runPromise(first.close); await Effect.runPromise(second.close); }
  }, 120_000);

  it.skipIf(driver !== "postgres")("settles competing endpoint attaches with one winner and one row", async () => {
    const first = await prepareAttachHost(link);
    const second = await prepareAttachHost(link);
    try {
      const results = await Promise.allSettled([
        Effect.runPromise(first.run(first.newRequestKey(), { links: [
          { variant_id: "variant_competing_claim", price_set_id: "price_set_first" },
        ] })),
        Effect.runPromise(second.run(second.newRequestKey(), { links: [
          { variant_id: "variant_competing_claim", price_set_id: "price_set_second" },
        ] })),
      ]);
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
      const reader = await Effect.runPromise(makeCommerceHost(link.hostInput));
      try {
        const [rows, count] = Schema.decodeUnknownSync(Schema.Tuple([Output, Schema.Number]))(
          await Effect.runPromise(reader.read(link.runtime.count,
            { filters: { variant_id: "variant_competing_claim" },
              config: { select: ["id", "variant_id", "price_set_id"], take: 2 } })));
        expect(count).toBe(1);
        expect(rows).toHaveLength(1);
      } finally { await Effect.runPromise(reader.close); }
    } finally { await Effect.runPromise(first.close); await Effect.runPromise(second.close); }
  }, 120_000);
});
