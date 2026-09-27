import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Result, Schema } from "effect";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { pricingModuleModels } from "@medusajs/pricing/static-manifest";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { compileLogicalSourceSearches } from "flarex-protocol/internal/logical-storage-requirements";
import { AppCreationTimeV1Schema, canonicalizeAppDocumentV1 } from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { createStep, createWorkflow, StepResponse, transform, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { Modules } from "@medusajs/framework/utils/portable";
import type { IPricingModuleService } from "@medusajs/framework/types";
import { createPriceSetsStep } from "@medusajs/core-flows/pricing/create-price-sets-step";
import { useQueryGraphStep } from "@medusajs/core-flows/common/use-query-graph";
import { PriceSetsInput, PriceListsInput, PricePreferencesInput } from "../src/pricing-input";
import { decodeCompiledDml } from "../src/schema/compiled";
import { lowerDmlSchema } from "../src/schema/lower";

import { prepareAtomicWorkflowHost } from "../src/workflow/host";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../src/workflow/events";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/atomicCommerce/host";
import { makeCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import { defaultCommerceResources } from "../../persistence-postgres/src/commerceTransaction/resources";
import { isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commitEvents/schema";
import { fxControlTables } from "../../persistence-postgres/src/schema";
import { locateAppDeveloperIndexDefinitionsForSchemaEffect } from "../../persistence-postgres/src/appIndexDefinitions";
import { lowerAppDeveloperIndexKeyV1 } from "../../persistence-postgres/src/appDeveloperIndexCommitV1";
import { selectLogicalIndex } from "../../persistence-postgres/src/logicalDocuments/query";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalPricingHost } from "./support/logical-pricing-fixture";
import { pricingLogicalCreateEventPolicy } from "../src/pricing-events";

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

  it("rejects a PricePreference result mismatch or an extra inserted row and event", async () => {
    const policy = pricingLogicalCreateEventPolicy();
    const call = { commandName: "pricingCreatePreference", mode: "write" as const,
      input: [{ attribute: "currency_code", value: "USD" }],
      result: [{ id: "prpref_test", attribute: "currency_code", value: "USD", is_tax_inclusive: false }],
      events: [{ name: "pricing.price-preference.created",
        metadata: { source: "pricing", object: "price_preference", action: "created" },
        data: { id: "prpref_test" } }], fromAttempt: 0, toAttempt: 1, fromLifecycle: 0, toLifecycle: 0 };
    const activity = { mutations: [{ ordinal: 0, table: "price_preference", operation: "insert" as const,
      before: null, after: { id: "prpref_test", attribute: "currency_code", value: "USD",
        is_tax_inclusive: false, deleted_at: null } }], lifecycle: [], observedRows: [],
      setNull: [], referenceReplacements: [] };
    await Effect.runPromise(policy.validateLogicalCall(call, activity));
    expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall({ ...call,
      result: [{ ...call.result[0], is_tax_inclusive: true }] }, activity))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
    expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall({ ...call,
      events: [...call.events, { ...call.events[0], data: { id: "prpref_extra" } }],
    }, { ...activity, mutations: [...activity.mutations, {
      ordinal: 1, table: "price_preference", operation: "insert" as const, before: null,
      after: { id: "prpref_extra", attribute: "currency_code", value: "EUR",
        is_tax_inclusive: false, deleted_at: null },
    }] })))).toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  });

  it("preserves PriceListRule's native GIN method as a logical JSON containment index", async () => {
    const compiled = await Effect.runPromise(decodeCompiledDml(JSON.parse(JSON.stringify(compileDmlSchema(pricingModuleModels)))));
    const rule = compiled.tables.find(table => table.name === "price_list_rule");
    expect(rule?.indexes.find(index => index.columns.length === 1 && index.columns[0] === "value"))
      .toMatchObject({ type: "gin", where: "deleted_at IS NULL" });
    const schema = Result.getOrThrow(normalizeRelationalSchema(lowerDmlSchema(compiled.tables, "commerce.pricing")));
    expect(schema.tables.find(table => table.identity.tableId === "price_list_rule")?.indexes
      .find(index => index.columns[0]?.columnId === "value"))
      .toMatchObject({ kind: "jsonContainment", predicate: { kind: "isNull",
        column: { columnId: "deleted_at" } } });
    expect(Result.getOrThrow(compileLogicalSourceSearches({
      key: "medusa.pricing", owner: "medusa", evidence: null,
      sourceSha256: "0".repeat(64), writeProfile: "medusa.pricing",
      definition: { kind: "relational", schema }, bindings: [],
    })).find(requirement => requirement.localName === "price_list_rule"))
      .toMatchObject({ kind: "jsonContainment", columns: ["value"],
        nullPredicateField: "deleted_at" });
  });

  it("admits the full pinned Pricing definition without module table DDL", async () => {
    expect(fixture.pricing.definition.schema.tables.map(table => table.identity.tableId).sort())
      .toEqual(["price", "price_list", "price_list_rule", "price_preference", "price_rule", "price_set"]);
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

  it("keeps compound preference points on their admitted partial index with a broader competitor", async () => {
    const table = (await fixture.currency.control.drizzle.select().from(fxControlTables))
      .find(value => value.logicalName === "commerce.pricing/price_preference");
    if (table === undefined) throw new Error("Missing logical PricePreference table");
    const definitions = await Effect.runPromise(locateAppDeveloperIndexDefinitionsForSchemaEffect(
      fixture.currency.control.drizzle, fixture.currency.deploymentId,
      fixture.currency.application.authority.scopeId, fixture.currency.schemaVersionId, [table.tableId], 20));
    if (definitions === null) throw new Error("Missing logical PricePreference indexes");
    const exact = definitions.find(definition => definition.physicalSpec.predicate?.kind === "fieldIsNull" &&
      definition.physicalSpec.orderedFields[0]?.kind === "documentPath" &&
      definition.physicalSpec.orderedFields[0].path === "attribute" &&
      definition.physicalSpec.orderedFields[1]?.kind === "documentPath" &&
      definition.physicalSpec.orderedFields[1].path === "value");
    if (exact === undefined) throw new Error("Missing active preference pair index");
    const { predicate: _predicate, ...broadSpec } = exact.physicalSpec;
    const broad = { ...exact, physicalSpec: broadSpec };
    const where = { attribute: "currency_code", value: "USD", deleted_at: null };
    const choose = (point?: Readonly<{ columns: readonly string[]; nullColumn?: string }>) =>
      Result.getOrThrow(selectLogicalIndex([broad, ...definitions], table.tableId, where,
        () => new Error("PricePreference index selection failed"), point));
    expect(choose().pipe(value => value._tag === "Some" ? value.value.definition.physicalSpec.predicate : null)).toBeUndefined();
    expect(choose({ columns: ["attribute", "value"], nullColumn: "deleted_at" })
      .pipe(value => value._tag === "Some" ? value.value.definition.physicalSpec.predicate : null))
      .toEqual({ kind: "fieldIsNull", field: "deleted_at" });
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
      const second = createPriceSetsStep(transform(created, sets => sets.map(set => ({ id: set.id + "-second", prices: [] })))).config({ name: "second-price-set-call" });
      const ids = transform({ created, second }, sets => [...sets.created, ...sets.second].map(set => set.id));
      const pending = useQueryGraphStep({ entity: "price_set", fields: ["id", "prices.id", "prices.amount", "prices.raw_amount", "prices.price_rules.id"],
        filters: { id: ids }, pagination: { take: 4 } });
      return new WorkflowResponse({ created, second, pending: pending.data });
    });
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({
      execution: { identityAndAccessPolicy: fixture.pricing.hostInput.identityAndAccessPolicy,
        prepare: composition => makeAtomicCommerceHost({ ...fixture.pricing.hostInput, ...composition }) },
      modules: { pricing: { module: fixture.pricing.runtime.workflow,
        logicalStorage: fixture.pricing.hostInput.logicalStorage } },
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
        second: [{ id: "exact-second" }],
        pending: [{ id: "exact", prices: [{ id: "exact-price",
          raw_amount: { value: "123.45678901234567890", precision: 20 } }] }, { id: "exact-second", prices: [] }] });
      const events = (await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEvents)).slice(before.length);
      expect(events.map(event => event.envelope.contract).sort()).toEqual([
        "pricing.price-set.created", "pricing.price.created", "pricing.price-rule.created", "pricing.price-set.created",
      ].sort());
      expect(await Effect.runPromise(host.run(key, [{ id: "exact", prices: [{ id: "exact-price",
        currency_code: "USD", amount: "123.4567890123456789", rules: { region_id: "region" } }] }]))).toEqual(value);
      const reader = await Effect.runPromise(makeCommerceHost(fixture.pricing.hostInput));
      try {
        expect(await Effect.runPromise(reader.read(fixture.pricing.runtime.list, { filters: { id: "exact" },
          config: { select: ["id", "prices.amount", "prices.raw_amount"], relations: ["prices"], take: 1 } })))
          .toMatchObject([{ id: "exact", prices: [{ raw_amount: { value: "123.45678901234567890" } }] }]);
        expect(await Effect.runPromise(reader.read(fixture.pricing.runtime.calculate, {
          filters: { id: ["exact"] }, pricingContext: { context: { currency_code: "USD", region_id: "region" } },
        }))).toMatchObject([{ id: "exact", calculated_amount: 123.45678901234568,
          raw_calculated_amount: { value: "123.45678901234567890" },
          is_calculated_price_tax_inclusive: false, calculated_price: { id: "exact-price" } }]);
      } finally { await Effect.runPromise(reader.close); }
      await Effect.runPromise(host.run(host.newRequestKey(), [{ id: "other", prices: [{ id: "other-price",
        currency_code: "USD", amount: "1" }] }]));
      const bounded = await Effect.runPromise(makeCommerceHost({ ...fixture.pricing.hostInput,
        logicalResources: { ...defaultCommerceResources, catalogRows: 2, queryRows: 2, writeBatchRows: 2 } }));
      try {
        const calculate = (ids: string[]) => bounded.read(fixture.pricing.runtime.calculate, {
          filters: { id: ids }, pricingContext: { context: { currency_code: "USD", region_id: "region" } },
        });
        expect(await Effect.runPromise(calculate(["exact"]))).toMatchObject([
          { id: "exact", calculated_price: { id: "exact-price" } },
        ]);
        const overflow = await Effect.runPromise(Effect.flip(calculate(["exact", "other"])));
        expect(JSON.parse(JSON.stringify(overflow)))
          .toMatchObject({ reason: "rollbackOnly", cause: { failures: [
            { error: { reason: "limitExceeded" } },
          ] } });
      } finally { await Effect.runPromise(bounded.close); }
      const preferenceResources = Result.getOrThrow(prepareWorkflowResources({ pricing: {
        module: fixture.pricing.runtime.workflow, methods: ["createPricePreferences"], graph: true,
      } }, true));
      const preferenceStep = createStep("create-native-price-preferences", async (
        data: typeof PricePreferencesInput.Type, { container },
      ) => {
        const service = container.resolve<IPricingModuleService>(Modules.PRICING);
        return new StepResponse(await service.createPricePreferences(data.map(preference => ({ ...preference }))));
      });
      const preferenceFlow = createWorkflow("create-logical-price-preferences", (
        input: WorkflowData<typeof PricePreferencesInput.Type>,
      ) => new WorkflowResponse(preferenceStep(input)));
      const preferenceHost = await Effect.runPromise(prepareAtomicWorkflowHost({
        execution: { identityAndAccessPolicy: fixture.pricing.hostInput.identityAndAccessPolicy,
          prepare: composition => makeAtomicCommerceHost({ ...fixture.pricing.hostInput, ...composition }) },
        modules: { pricing: { module: fixture.pricing.runtime.workflow,
          logicalStorage: fixture.pricing.hostInput.logicalStorage } },
        revision: "e".repeat(64), subscribers: [{ id: "pricing-preferences-logical", revision: "f".repeat(64) }],
        workflow: { name: "logicalPricePreferences", resources: preferenceResources,
          prepared: Result.getOrThrow(preferenceFlow.prepare()), input: PricePreferencesInput,
          output: Schema.Json, events: internalModuleWorkflowEvents },
      }));
      try {
        const input = [
          { attribute: "currency_code", value: "USD", is_tax_inclusive: true },
          { attribute: "currency_code", value: "EUR" },
          { attribute: "currency_code", value: "GBP", is_tax_inclusive: false },
        ];
        const beforePreferenceEvents = (await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEvents)).length;
        const preferenceKey = preferenceHost.newRequestKey();
        const created = await Effect.runPromise(preferenceHost.run(preferenceKey, input));
        expect(created).toMatchObject([{ attribute: "currency_code", value: "USD", is_tax_inclusive: true },
          { attribute: "currency_code", value: "EUR", is_tax_inclusive: false },
          { attribute: "currency_code", value: "GBP", is_tax_inclusive: false }]);
        expect(await Effect.runPromise(preferenceHost.run(preferenceKey, input))).toEqual(created);
        expect((await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEvents))
          .slice(beforePreferenceEvents).map(event => event.envelope.contract))
          .toEqual(Array(3).fill("pricing.price-preference.created"));
      } finally { await Effect.runPromise(preferenceHost.close); }
      const selective = await Effect.runPromise(makeCommerceHost({ ...fixture.pricing.hostInput,
        logicalResources: { ...defaultCommerceResources, catalogRows: 3, queryRows: 3, writeBatchRows: 3 } }));
      try {
        expect(await Effect.runPromise(selective.read(fixture.pricing.runtime.calculate, {
          filters: { id: ["exact"] }, pricingContext: { context: { currency_code: "USD", region_id: "region" } },
        }))).toMatchObject([{ id: "exact", is_calculated_price_tax_inclusive: true,
          calculated_price: { id: "exact-price" } }]);
      } finally { await Effect.runPromise(selective.close); }
      const otherCurrency = await logicalCurrencyFixture(driver, close => cleanup.push(close), {
        resource: fixture.currency.resource, includePricing: true,
        fixtureIdentity: { deploymentId: "deployment_pricing_calculation_shop_b",
          projectId: "project_pricing_calculation_shop_b", uuidOffset: 20_000 },
      });
      const otherPricing = await prepareLogicalPricingHost(otherCurrency);
      await Effect.runPromise(otherPricing.host.initialize([]));
      await Effect.runPromise(otherPricing.host.close);
      const otherResources = Result.getOrThrow(prepareWorkflowResources({ pricing: {
        module: otherPricing.runtime.workflow, methods: ["createPriceSets"], graph: true,
      } }, true));
      const otherHost = await Effect.runPromise(prepareAtomicWorkflowHost({
        execution: { identityAndAccessPolicy: otherPricing.hostInput.identityAndAccessPolicy,
          prepare: composition => makeAtomicCommerceHost({ ...otherPricing.hostInput, ...composition }) },
        modules: { pricing: { module: otherPricing.runtime.workflow,
          logicalStorage: otherPricing.hostInput.logicalStorage } },
        revision: "c".repeat(64), subscribers: [{ id: "pricing-logical-shop-b", revision: "d".repeat(64) }],
        workflow: { name: "logicalBasePrices", resources: otherResources, prepared: Result.getOrThrow(flow.prepare()),
          input: PriceSetsInput, output: Schema.Json, events: internalModuleWorkflowEvents },
      }));
      try {
        await Effect.runPromise(otherHost.run(otherHost.newRequestKey(), [{ id: "exact", prices: [{
          id: "exact-price", currency_code: "USD", amount: "5" }] }]));
        const otherReader = await Effect.runPromise(makeCommerceHost(otherPricing.hostInput));
        try {
          expect(await Effect.runPromise(otherReader.read(otherPricing.runtime.calculate, {
            filters: { id: ["exact"] }, pricingContext: { context: { currency_code: "USD" } },
          }))).toMatchObject([{ id: "exact", calculated_amount: 5,
            is_calculated_price_tax_inclusive: false,
            calculated_price: { id: "exact-price" } }]);
        } finally { await Effect.runPromise(otherReader.close); }
        const firstReader = await Effect.runPromise(makeCommerceHost(fixture.pricing.hostInput));
        try {
          expect(await Effect.runPromise(firstReader.read(fixture.pricing.runtime.calculate, {
            filters: { id: ["exact"] }, pricingContext: { context: { currency_code: "USD", region_id: "region" } },
          }))).toMatchObject([{ id: "exact", calculated_amount: 123.45678901234568,
            is_calculated_price_tax_inclusive: true }]);
        } finally { await Effect.runPromise(firstReader.close); }
      } finally { await Effect.runPromise(otherHost.close); }
    } finally { await Effect.runPromise(host.close); }
  }, 60_000);

  it("creates a native active PriceList graph and calculates its override from logical rows", async () => {
    const createListsStep = createStep({ name: "create-price-lists", compensation: "transactionCovered" },
      async (data: typeof PriceListsInput.Type, { container }) => {
        const service = container.resolve<IPricingModuleService>(Modules.PRICING);
        const normalized = data.map(list => {
          const { prices, rules, ...rest } = list;
          return { ...rest, prices: prices.map(price => ({ ...price })),
            ...(rules === undefined ? {} : { rules: Object.fromEntries(Object.entries(rules)
              .map(([key, values]) => [key, [...values]])) }) };
        });
        return new StepResponse(await service.createPriceLists(normalized));
      });
    const Input = Schema.Struct({ sets: PriceSetsInput, lists: PriceListsInput });
    const flow = createWorkflow("create-logical-price-list", (input: WorkflowData<typeof Input.Type>) => {
      const sets = createPriceSetsStep(transform(input.sets, data => data.map(set => {
        const { prices, ...rest } = set;
        return { ...rest, ...(prices === undefined ? {} : { prices: prices.map(price => ({ ...price,
          ...(price.rules === undefined ? {} : { rules: { ...price.rules } }),
        })) }) };
      })));
      const lists = createListsStep(transform({ sets, data: input.lists }, ({ data }) => data));
      return new WorkflowResponse({ sets, lists });
    });
    const resources = Result.getOrThrow(prepareWorkflowResources({ pricing: {
      module: fixture.pricing.runtime.workflow, methods: ["createPriceSets", "createPriceLists"], graph: true,
    } }, true));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({
      execution: { identityAndAccessPolicy: fixture.pricing.hostInput.identityAndAccessPolicy,
        prepare: composition => makeAtomicCommerceHost({ ...fixture.pricing.hostInput, ...composition }) },
      modules: { pricing: { module: fixture.pricing.runtime.workflow,
        logicalStorage: fixture.pricing.hostInput.logicalStorage } },
      revision: "e".repeat(64), subscribers: [{ id: "pricing-logical-list", revision: "f".repeat(64) }],
      workflow: { name: "logicalPriceList", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: Input, output: Schema.Json, events: internalModuleWorkflowEvents },
    }));
    try {
      const before = await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      const input: typeof Input.Type = { sets: [{ id: "list-set", prices: [{ id: "list-base", currency_code: "USD", amount: "100" }] }],
        lists: [{ id: "active-list", title: "Regional override", description: "Selected logical list",
          status: "active", type: "override", rules: { region_id: ["region"] },
          prices: [{ id: "list-price", price_set_id: "list-set", currency_code: "USD", amount: "10" }] }] };
      const key = host.newRequestKey();
      const result = await Effect.runPromise(host.run(key, input));
      expect(result).toMatchObject({ lists: [{ id: "active-list", status: "active", type: "override" }] });
      expect(await Effect.runPromise(host.run(key, input))).toEqual(result);
      const events = (await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEvents)).slice(before.length);
      expect(events.map(event => event.envelope.contract).sort()).toEqual([
        "pricing.price-set.created", "pricing.price.created", "pricing.price-list.created",
        "pricing.price.created", "pricing.price-list-rule.created",
      ].sort());
      await expect(Effect.runPromise(host.run(host.newRequestKey(), { ...input,
        sets: [{ id: "failed-list-set", prices: [{ id: "failed-list-base", currency_code: "USD", amount: "50" }] }],
      }))).rejects.toMatchObject({ _tag: "CommerceTransactionError" });
      expect(await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEvents))
        .toHaveLength(before.length + events.length);
      const matrix: typeof Input.Type = { sets: ["sale", "override", "future", "expired"].map(name => ({
        id: `${name}-set`, prices: [{ id: `${name}-base`, currency_code: "USD", amount: "100" }],
      })), lists: [
        { id: "sale-list", title: "Sale", description: "Below base", status: "active", type: "sale",
          prices: [{ id: "sale-price", price_set_id: "sale-set", currency_code: "USD", amount: "90" }] },
        { id: "override-list", title: "Override", description: "Above base", status: "active", type: "override",
          starts_at: "2020-01-01T00:00:00.000Z", ends_at: "2999-01-01T00:00:00.000Z",
          prices: [{ id: "override-price", price_set_id: "override-set", currency_code: "USD", amount: "120" }] },
        { id: "future-list", title: "Future", description: "Not yet active", status: "active", type: "sale",
          starts_at: "2999-01-01T00:00:00.000Z",
          prices: [{ id: "future-price", price_set_id: "future-set", currency_code: "USD", amount: "10" }] },
        { id: "expired-list", title: "Expired", description: "No longer active", status: "active", type: "sale",
          ends_at: "2020-01-01T00:00:00.000Z",
          prices: [{ id: "expired-price", price_set_id: "expired-set", currency_code: "USD", amount: "10" }] },
      ] };
      const matrixKey = host.newRequestKey();
      const matrixResult = await Effect.runPromise(host.run(matrixKey, matrix));
      expect(matrixResult).toMatchObject({ lists: matrix.lists.map(list => ({ id: list.id })) });
      expect(await Effect.runPromise(host.run(matrixKey, matrix))).toEqual(matrixResult);
      const draft: typeof Input.Type = { sets: [{ id: "draft-set", prices: [
        { id: "draft-base", currency_code: "USD", amount: "100" }] }],
        lists: [{ id: "draft-list", title: "Draft", description: "Not active", status: "draft", type: "sale",
          prices: [{ id: "draft-price", price_set_id: "draft-set", currency_code: "USD", amount: "10" }] }] };
      await Effect.runPromise(host.run(host.newRequestKey(), draft));
      const invalid: typeof Input.Type = { sets: [{ id: "invalid-date-set", prices: [
        { id: "invalid-date-base", currency_code: "USD", amount: "100" }] }],
        lists: [{ id: "invalid-date-list", title: "Invalid", description: "Bad interval", status: "active", type: "sale",
          starts_at: "not-a-date", prices: [{ id: "invalid-date-price", price_set_id: "invalid-date-set",
            currency_code: "USD", amount: "10" }] }] };
      await expect(Effect.runPromise(host.run(host.newRequestKey(), invalid)))
        .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
      const reader = await Effect.runPromise(makeCommerceHost(fixture.pricing.hostInput));
      try {
        const calculated = await Effect.runPromise(reader.read(fixture.pricing.runtime.calculate, {
          filters: { id: ["list-set"] }, pricingContext: { context: { currency_code: "USD", region_id: "region" } },
        }));
        expect(calculated).toMatchObject([{ id: "list-set", calculated_amount: 10,
          original_amount: 10, calculated_price: { id: "list-price" },
          is_calculated_price_price_list: true }]);
        expect(await Effect.runPromise(reader.read(fixture.pricing.runtime.calculate, {
          filters: { id: ["list-set"] }, pricingContext: { context: { currency_code: "USD", region_id: "elsewhere" } },
        }))).toMatchObject([{ id: "list-set", calculated_amount: 100,
          original_amount: 100, calculated_price: { id: "list-base" } }]);
        expect(await Effect.runPromise(reader.read(fixture.pricing.runtime.calculate, {
          filters: { id: ["list-set"] }, pricingContext: { context: { currency_code: "USD" } },
        }))).toMatchObject([{ id: "list-set", calculated_amount: 100,
          original_amount: 100, calculated_price: { id: "list-base" } }]);
        expect(await Effect.runPromise(reader.read(fixture.pricing.runtime.list, {
          filters: { id: ["failed-list-set"] },
        }))).toEqual([]);
        expect(await Effect.runPromise(reader.read(fixture.pricing.runtime.list, {
          filters: { id: ["invalid-date-set"] },
        }))).toEqual([]);
        const selected = await Effect.runPromise(reader.read(fixture.pricing.runtime.calculate, {
          filters: { id: ["sale-set", "override-set", "future-set", "expired-set", "draft-set"] },
          pricingContext: { context: { currency_code: "USD" } },
        }));
        if (!Array.isArray(selected)) throw new Error("Expected calculated PriceSets");
        const rows = selected.filter(isJsonObject);
        expect(rows).toHaveLength(5);
        const byId = Object.fromEntries(rows.map(row => [row.id, row]));
        expect(byId["sale-set"]).toMatchObject({ calculated_amount: 90, original_amount: 100,
          calculated_price: { id: "sale-price" }, original_price: { id: "sale-base" } });
        expect(byId["override-set"]).toMatchObject({ calculated_amount: 120, original_amount: 120,
          calculated_price: { id: "override-price" } });
        for (const name of ["future", "expired", "draft"]) expect(byId[`${name}-set`])
          .toMatchObject({ calculated_amount: 100, original_amount: 100,
            calculated_price: { id: `${name}-base` } });
        expect(await Effect.runPromise(reader.read(fixture.pricing.runtime.calculate, {
          filters: { id: ["override-set"] }, pricingContext: { context: { currency_code: "USD", region_id: "elsewhere" } },
        }))).toMatchObject([{ calculated_amount: 120, calculated_price: { id: "override-price" } }]);
      } finally { await Effect.runPromise(reader.close); }
    } finally { await Effect.runPromise(host.close); }
  }, 60_000);
});
