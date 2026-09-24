import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Result, Schema } from "effect";
import { AppCreationTimeV1Schema, canonicalizeAppDocumentV1 } from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { createWorkflow, transform, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createPriceSetsStep } from "@medusajs/core-flows/pricing/create-price-sets-step";
import { useQueryGraphStep } from "@medusajs/core-flows/common/use-query-graph";
import { PriceSetsInput } from "../src/pricing-input";
import { pricingLogicalCreateEventPolicy } from "../src/pricing-events";
import { prepareAtomicWorkflowHost } from "../src/workflow/host";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../src/workflow/events";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/atomicCommerce/host";
import { makeCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commitEvents/schema";
import { fxControlTables } from "../../persistence-postgres/src/schema";
import { locateAppDeveloperIndexDefinitionsForSchemaEffect } from "../../persistence-postgres/src/appIndexDefinitions";
import { lowerAppDeveloperIndexKeyV1 } from "../../persistence-postgres/src/appDeveloperIndexCommitV1";
import { selectLogicalIndex } from "../../persistence-postgres/src/logicalDocuments/query";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalPricingHost } from "./support/logical-pricing-fixture";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Pricing test driver");
const cleanup: Array<() => Promise<void>> = [];
let fixture: { currency: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
  pricing: Awaited<ReturnType<typeof prepareLogicalPricingHost>> };

describe("native Pricing on shared logical storage", () => {
  beforeAll(async () => {
    const currency = await logicalCurrencyFixture(driver, close => cleanup.push(close), { includePricing: true });
    const pricing = await prepareLogicalPricingHost(currency);
    await Effect.runPromise(pricing.host.initialize([]));
    await Effect.runPromise(pricing.host.close);
    fixture = { currency, pricing };
  }, 150_000);
  afterAll(async () => {
    for (const close of cleanup.reverse()) await close();
  });

  it("admits the base-price dependency set without module table DDL", async () => {
    expect(fixture.pricing.definition.schema.tables.map(table => table.identity.tableId).sort())
      .toEqual(["price", "price_list", "price_rule", "price_set"]);
    expect((await fixture.currency.persistence.query<{ name: string }>(
      "select tablename as name from pg_tables where schemaname = current_schema() order by tablename")).rows)
      .toEqual(fixture.currency.physicalTablesBeforeCandidate);
  });

  it("keeps PriceList's native active predicate in indexed membership and query selection", async () => {
    const table = (await fixture.currency.control.drizzle.select().from(fxControlTables))
      .find(value => value.logicalName === "commerce.pricing/price_list");
    if (table === undefined) throw new Error("Missing logical PriceList table");
    const definitions = await Effect.runPromise(locateAppDeveloperIndexDefinitionsForSchemaEffect(
      fixture.currency.control.drizzle, fixture.currency.deploymentId,
      fixture.currency.application.authority.scopeId, fixture.currency.schemaVersionId, [table.tableId], 20));
    if (definitions === null) throw new Error("Missing logical PriceList definitions");
    const active = definitions.find(definition => definition.physicalSpec.predicate?.kind === "fieldIsNullAndTextEquals");
    if (active === undefined) throw new Error("Missing native active PriceList index");
    expect(active.physicalSpec.predicate).toEqual({ kind: "fieldIsNullAndTextEquals",
      nullField: "deleted_at", textField: "status", value: "active" });
    const creationTime = AppCreationTimeV1Schema.make(1);
    const rowId = decodeAppRowIdHexV1("11".repeat(16));
    const key = async (status: string, deletedAt: string | null) => {
      const document = await canonicalizeAppDocumentV1({ tableId: table.tableId, rowId, creationTime,
        fields: { id: "plist_test", status, deleted_at: deletedAt, starts_at: null, ends_at: null } });
      return Result.getOrThrow(lowerAppDeveloperIndexKeyV1(active, document, creationTime));
    };
    expect(await key("active", null)).not.toBeNull();
    expect(await key("draft", null)).toBeNull();
    expect(await key("active", "2026-09-24T00:00:00.000Z")).toBeNull();
    const choose = (status: string) => Result.getOrThrow(selectLogicalIndex(definitions, table.tableId,
      { id: "plist_test", deleted_at: null, status }, () => new Error("PriceList index selection failed")));
    expect(choose("active").pipe(value => value._tag === "Some" ? value.value.definition.indexDefinitionId : null))
      .toBe(active.indexDefinitionId);
    expect(choose("draft").pipe(value => value._tag === "Some" ? value.value.definition.indexDefinitionId : null))
      .not.toBe(active.indexDefinitionId);
  });

  it("runs native base-price creation with exact nested values, pending reads and one publication", async () => {
    const resources = Result.getOrThrow(prepareWorkflowResources({ pricing: {
      module: fixture.pricing.runtime.workflow, methods: ["createPriceSets"], graph: true,
    } }, true));
    const flow = createWorkflow("create-logical-base-prices", (input: WorkflowData<typeof PriceSetsInput.Type>) => {
      const created = createPriceSetsStep(transform(input, sets => sets.map(set => ({
        ...(set.id === undefined ? {} : { id: set.id }),
        ...(set.prices === undefined ? {} : { prices: set.prices.map(price => ({
          ...price,
          ...(price.rules === undefined ? {} : { rules: { ...price.rules } }),
        })) }),
      }))));
      const ids = transform(created, sets => sets.map(set => set.id));
      const pending = useQueryGraphStep({ entity: "price_set", fields: ["id", "prices.id", "prices.amount", "prices.raw_amount", "prices.price_rules.id"],
        filters: { id: ids }, pagination: { take: 4 } });
      return new WorkflowResponse({ created, pending: pending.data });
    });
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({
      execution: { identityAndAccessPolicy: fixture.pricing.hostInput.identityAndAccessPolicy,
        prepare: composition => makeAtomicCommerceHost({ ...fixture.pricing.hostInput, ...composition }) },
      modules: { pricing: { module: fixture.pricing.runtime.workflow,
        logicalStorage: fixture.pricing.hostInput.logicalStorage, moduleEvents: pricingLogicalCreateEventPolicy() } },
      revision: "a".repeat(64), subscribers: [{ id: "pricing-logical", revision: "b".repeat(64) }],
      workflow: { name: "logicalBasePrices", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: PriceSetsInput, output: Schema.Json, events: internalModuleWorkflowEvents },
    }));
    try {
      const before = await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      const key = host.newRequestKey();
      const value = await Effect.runPromise(host.run(key, [{ id: "exact", prices: [{ id: "exact-price",
        currency_code: "USD", amount: "123.4567890123456789", rules: { region_id: "region" } }] }]));
      expect(value).toMatchObject({ created: [{ id: "exact", prices: [{ id: "exact-price",
        raw_amount: { value: "123.45678901234567890", precision: 20 } }] }],
        pending: [{ id: "exact", prices: [{ id: "exact-price",
          raw_amount: { value: "123.45678901234567890", precision: 20 } }] }] });
      const events = (await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEvents)).slice(before.length);
      expect(events.map(event => event.envelope.contract).sort()).toEqual([
        "pricing.price-set.created", "pricing.price.created", "pricing.price-rule.created",
      ].sort());
      expect(await Effect.runPromise(host.run(key, [{ id: "exact", prices: [{ id: "exact-price",
        currency_code: "USD", amount: "123.4567890123456789", rules: { region_id: "region" } }] }]))).toEqual(value);
      const reader = await Effect.runPromise(makeCommerceHost(fixture.pricing.hostInput));
      try {
        expect(await Effect.runPromise(reader.read(fixture.pricing.runtime.list, { filters: { id: "exact" },
          config: { select: ["id", "prices.amount", "prices.raw_amount"], relations: ["prices"], take: 1 } })))
          .toMatchObject([{ id: "exact", prices: [{ raw_amount: { value: "123.45678901234567890" } }] }]);
      } finally { await Effect.runPromise(reader.close); }
    } finally { await Effect.runPromise(host.close); }
  }, 60_000);
});
