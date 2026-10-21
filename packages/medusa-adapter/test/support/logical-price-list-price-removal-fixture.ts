import { Effect, Result, Schema } from "effect";
import { and, eq } from "drizzle-orm";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { removePriceListPricesWorkflow } from "@medusajs/core-flows/price-list/remove-price-list-prices";
import { createPriceListPricesWorkflow } from "@medusajs/core-flows/price-list/create-price-list-prices";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { fxControlTables } from "../../../persistence-postgres/src/database/schema";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { captureVariantPricingLinkMetadata } from "../../src/composition/product-variant-pricing-schema";
import { prepareVariantPricingLink } from "../../src/links/variant-pricing-service";
import { makeLocalPricingCommands } from "../../src/modules/pricing/service";
import { PriceListWorkflowInput } from "../../src/modules/pricing/list-input";
import { PriceListPriceRemovalIds } from "../../src/modules/pricing/price-list-price-input";
import { PriceListPriceRemovalWorkflowInput } from "../../src/modules/pricing/price-list-price-removal-input";
import { PriceListPriceUpdateWorkflowInput } from "../../src/modules/pricing/price-list-price-update-input";
import { prepareCreatePriceListsWorkflow } from "../../src/workflows/pricing/create-price-lists";
import { prepareUpdatePriceListPricesWorkflow } from "../../src/workflows/pricing/update-price-list-prices";
import { prepareRemovePriceListPricesWorkflow } from "../../src/workflows/pricing/remove-price-list-prices";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { projectNativeRow } from "../../src/repository/result";
import { priceListCreationComparisonRows } from "./logical-price-list-create-fixture";
import { logicalCurrencyFixture } from "./logical-currency-fixture";
import { logicalCurrencyInventory } from "./logical-currency-inventory";

const revision = "7".repeat(64), stamp = "2026-01-01T00:00:00.000Z";
const native = Result.getOrThrow(removePriceListPricesWorkflow.prepare());
const removal = native.nodes.find(node => node.name === "remove-price-list-prices");
if (removal?.kind !== "step" || removal.compensation !== "transactionCovered" || !removal.compensate)
  throw new Error("Missing original retained Price removal callback");
const callbacks = { forward: removal.invoke, inverse: removal.compensate };
const creation = Result.getOrThrow(createPriceListPricesWorkflow.prepare()).nodes.find(node => node.name === "create-price-list-prices");
if (creation?.kind !== "step" || !creation.compensate) throw new Error("Missing original physical Price removal callback");
const physicalInverse = creation.compensate;
const Retained = Schema.Struct({ output: PriceListPriceRemovalIds, compensation: PriceListPriceRemovalIds });
type Options = Parameters<typeof prepareRemovePriceListPricesWorkflow>[0];
type Input = typeof PriceListPriceRemovalWorkflowInput.Type;

/** Local comparison rows reuse 152's catalog and stored Link fixtures. Only this
 * fixture activates its fourth Set; 152's historical-Set witness is unchanged. */
function comparisonRows(linkTable: string) {
  const base = priceListCreationComparisonRows(linkTable);
  const seedRows = base.seedRows.map(entry => entry.table === "price_set" ? { ...entry, row: { ...entry.row, deleted_at: null } } : entry);
  const sample = seedRows.find(entry => entry.row.id === "price152-comparison-0");
  if (!sample) throw new Error("Missing complete comparison Price source");
  const managed = { created_at: stamp, updated_at: stamp, deleted_at: null };
  const collisionId = "price157-collision", hiddenSetId = "pset157-history", hiddenPriceId = "price157-hidden-set", basePriceId = "price157-base";
  const mixedHistoryPriceId = "price157-mixed-history";
  const roots = [{ table: "price_set", row: { id: hiddenSetId, ...managed, deleted_at: stamp } }];
  const prices = [
    { table: "price", row: { ...sample.row, id: collisionId, price_list_id: null, rules_count: 2, ...managed } },
    { table: "price", row: { ...sample.row, id: hiddenPriceId, price_set_id: hiddenSetId, price_list_id: null, rules_count: 0, ...managed } },
    { table: "price", row: { ...sample.row, id: basePriceId, price_list_id: null, rules_count: 0, ...managed } },
    { table: "price", row: { ...sample.row, id: mixedHistoryPriceId, price_list_id: null, rules_count: 2, ...managed, deleted_at: stamp } },
    ...["price157-order-a", "price157-order-z"].map(id => ({ table: "price", row: { ...sample.row, id, price_list_id: null, rules_count: 2, ...managed } })),
  ];
  const rules = [false, true].map(historical => ({ table: "price_rule", row: {
    id: "prule157-collision-" + (historical ? "history" : "active"), price_id: collisionId,
    attribute: "collision157", value: historical ? "old" : "current", operator: "eq", priority: historical ? 1 : 0,
    ...managed, deleted_at: historical ? stamp : null,
  } }));
  // Child lexical order deliberately disagrees with parent traversal. One
  // child also shares a Price ID with a different historical state, requiring
  // table-qualified preimage correlation before native event dispatch.
  const orderRules = [
    { id: "prule157-order-y", price_id: "price157-order-a", historical: false },
    { id: "prule157-order-z", price_id: "price157-order-a", historical: false },
    { id: "price157-order-a", price_id: "price157-order-z", historical: true },
    { id: "prule157-order-b", price_id: "price157-order-z", historical: false },
  ].map((entry, index) => ({ table: "price_rule", row: { id: entry.id, price_id: entry.price_id,
    attribute: "order157-" + index, value: "value", operator: "eq", priority: index,
    ...managed, deleted_at: entry.historical ? stamp : null } }));
  // Valid imported initial history, independent of any post-forward creation:
  // a historical Price can already own active and historical Rule rows.
  const mixedHistoryRules = [false, true].map(historical => ({ table: "price_rule", row: {
    id: "prule157-mixed-history-" + (historical ? "historical" : "active"), price_id: mixedHistoryPriceId,
    attribute: historical ? "historical157" : "active157", value: historical ? "retained-history" : "retained-active",
    operator: "eq", priority: historical ? 1 : 0, ...managed, deleted_at: historical ? stamp : null,
  } }));
  const initializationTableOrder = ["price_set", "price_preference", "price_list", "price_list_rule", "price", "price_rule"];
  const rows = [...seedRows, ...roots, ...prices, ...rules, ...orderRules, ...mixedHistoryRules];
  const grouped = initializationTableOrder.flatMap(table => rows.filter(entry => entry.table === table));
  if (grouped.length !== rows.length) throw new Error("Unknown comparison initialization table");
  const protectedIds = [...base.protectedIds, ...base.linkRows.map(entry => Schema.decodeUnknownSync(Schema.String)(entry.row.id)),
    ...seedRows.filter(entry => entry.table === "price_list" || entry.table === "price_list_rule").map(entry => Schema.decodeUnknownSync(Schema.String)(entry.row.id)),
    hiddenSetId, hiddenPriceId];
  return { ...base, protectedIds, seedRows: grouped, collisionId, hiddenSetId, hiddenPriceId, basePriceId, mixedHistoryPriceId };
}

/** Canonical initialization owns comparison history; genuine native 152/155/156
 * callbacks own every subsequent setup mutation. The 157 root borrows Pricing
 * alone. Installed stored Links are protected data, never its authority. */
export async function prepareLogicalPriceListPriceRemoval(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void) {
  const fixture = await logicalCurrencyFixture(driver, close, { includeProduct: true, includePricing: true, includeVariantPricingLink: true });
  const pricing = await Effect.runPromise(makeLocalPricingCommands("price-list-price-removals"));
  const create = await Effect.runPromise(makeLocalPricingCommands("price-list-creations"));
  const link = await Effect.runPromise(prepareVariantPricingLink());
  const pricingDefinition = fixture.pricingDefinition, linkDefinition = fixture.variantPricingLinkDefinition;
  if (!pricingDefinition || !linkDefinition) throw new Error("Missing installed Pricing/Link source");
  const comparison = comparisonRows((await Effect.runPromise(captureVariantPricingLinkMetadata())).frame.name);
  const initialize = async (sourceKey: string, definition: typeof pricingDefinition | typeof linkDefinition,
    commands: LogicalCommerceHostInput<unknown>["commands"], rows: readonly { table: string; row: JsonObject }[]) => {
    const inputRows = definition.schema.tables.length === 1 ? rows.map(entry => entry.row) : rows;
    const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: inputRows }, 1_048_576,
      { invalidInput: () => new Error("Invalid Price removal comparison seed"), hashFailure: cause => new Error("Price removal comparison hash", { cause }) }));
    const input = { ...fixture.hostInput, commands, logicalStorage: { ...fixture.hostInput.logicalStorage,
      source: { sourceKey, writeProfile: sourceKey, schema: definition.schema, evidence: definition.provenance },
      initialization: { stepId: sourceKey.toLowerCase() + ".157-comparison", datasetSha256: dataset.sha256Hex, expectedRowCount: rows.length },
    } } satisfies LogicalCommerceHostInput<unknown>;
    const host = await Effect.runPromise(makeCommerceHost(input));
    try { await Effect.runPromise(host.initialize(inputRows)); } finally { await Effect.runPromise(host.close); }
    return input.logicalStorage;
  };
  const logicalStorage = await initialize("medusa.pricing", pricingDefinition, pricing.commands, comparison.seedRows);
  const linkStorage = await initialize("medusa.link.productVariantPriceSet", linkDefinition, link.commands, comparison.linkRows);
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const options: Options = { execution, pricing: { module: pricing.workflow, logicalStorage, logicalPublication: "mixed" }, revision,
    subscribers: [{ id: "native-price-removal", revision }] };
  const resources = Result.getOrThrow(prepareWorkflowResources({ pricing: {
    module: pricing.workflow, methods: ["listPrices", "softDeletePrices", "restorePrices"], graph: false,
  } }, true));
  const hosts: Array<() => Promise<void>> = [];
  const own = <H extends { readonly close: Effect.Effect<void> }>(host: H) => { hosts.push(() => Effect.runPromise(host.close)); return host; };
  const closeCaseHosts = async () => { for (const dispose of hosts.splice(0).reverse()) await dispose(); };
  close(closeCaseHosts);
  const prepareForward = async () => {
    const step = createStep("probe157-original-forward", resources.callback(async (input: Input, context) => {
      const response = await callbacks.forward(input.ids, context);
      if (!(response instanceof StepResponse) || response.compensateInput === undefined) throw new Error("Missing genuine Price removal retention");
      return { output: response.output, compensation: response.compensateInput };
    }));
    const flow = createWorkflow("probe157-original-forward-root", (input: WorkflowData<Input>) => new WorkflowResponse(step(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: { pricing: options.pricing }, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probePriceRemovalForward", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: PriceListPriceRemovalWorkflowInput, output: Retained, events: internalModuleWorkflowEvents } })));
  };
  const prepareInverse = async (repeat = false) => {
    const step = createStep("probe157-original-inverse", resources.callback(async (ids: typeof PriceListPriceRemovalIds.Type, context) => {
      await callbacks.inverse(ids, context); if (repeat) await callbacks.inverse(ids, context); return new StepResponse(null);
    }));
    const flow = createWorkflow("probe157-original-inverse-root", (ids: WorkflowData<typeof PriceListPriceRemovalIds.Type>) => new WorkflowResponse(step(ids)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: { pricing: options.pricing }, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probePriceRemovalInverse" + (repeat ? "Repeated" : ""), resources, prepared: Result.getOrThrow(flow.prepare()),
        input: PriceListPriceRemovalIds, output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const prepareWrapped = async (configuration: { readonly lateFailure?: boolean; readonly caughtRefusal?: boolean;
    readonly inspect?: (value: unknown) => void; readonly escape?: (work: () => Promise<unknown>) => void } = {}) => {
    const step = createStep("probe157-parent", resources.callback(async (output: unknown, context) => {
      configuration.inspect?.(context.resources); configuration.escape?.(() => context.resources.pricing.restorePrices([]));
      if (configuration.caughtRefusal) { try { context.container.resolve("region"); } catch { /* Refusal remains sticky at the outer owner. */ } }
      if (configuration.lateFailure) throw new Error("Late parent failure after genuine Price removal");
      return output;
    }));
    const flow = createWorkflow("probe157-parent-root", (input: WorkflowData<Input>) => new WorkflowResponse(step(removePriceListPricesWorkflow.runAsStep({ input }))));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: { pricing: options.pricing }, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probePriceRemovalParent", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: PriceListPriceRemovalWorkflowInput, output: PriceListPriceRemovalIds, events: internalModuleWorkflowEvents } })));
  };
  const seedLists = async (input: typeof PriceListWorkflowInput.Type) => {
    const host = own(await Effect.runPromise(prepareCreatePriceListsWorkflow({ execution, revision, subscribers: options.subscribers,
      modules: { pricing: { module: create.workflow, logicalStorage }, link: { module: link.workflow, logicalStorage: linkStorage } } })));
    return Effect.runPromise(host.run(host.newRequestKey(), input));
  };
  const outsideUpdate = async (input: typeof PriceListPriceUpdateWorkflowInput.Type) => {
    const update = await Effect.runPromise(makeLocalPricingCommands("price-list-price-updates"));
    const host = own(await Effect.runPromise(prepareUpdatePriceListPricesWorkflow({ execution, revision, subscribers: options.subscribers,
      modules: { pricing: { module: update.workflow, logicalStorage, logicalPublication: "mixed" }, link: { module: link.workflow, logicalStorage: linkStorage } } })));
    return Effect.runPromise(host.run(host.newRequestKey(), input));
  };
  const preparePhysicalDeletion = async () => {
    const module = await Effect.runPromise(makeLocalPricingCommands("price-list-price-creations"));
    const selected = Result.getOrThrow(prepareWorkflowResources({ pricing: { module: module.workflow, methods: ["removePrices"], graph: false } }, true));
    const step = createStep("fixture157-original-physical-inverse", selected.callback(async (ids: typeof PriceListPriceRemovalIds.Type, context) => {
      await physicalInverse(ids, context); return new StepResponse(null);
    }));
    const flow = createWorkflow("fixture157-original-physical-root", (ids: WorkflowData<typeof PriceListPriceRemovalIds.Type>) => new WorkflowResponse(step(ids)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: { pricing: { module: module.workflow, logicalStorage } }, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "fixturePriceRemovalPhysicalInverse", resources: selected, prepared: Result.getOrThrow(flow.prepare()),
        input: PriceListPriceRemovalIds, output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const direct = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, logicalStorage, commands: pricing.commands }));
  close(() => Effect.runPromise(direct.close));
  const readRows = async (ids?: readonly string[]) => {
    const inventory = await logicalCurrencyInventory(fixture), rows: Array<{ table: string; row: JsonObject }> = [];
    const tables = await fixture.control.drizzle.select().from(fxControlTables).where(and(eq(fxControlTables.deploymentId, fixture.deploymentId), eq(fxControlTables.namespace, "medusa")));
    const selected = ids === undefined ? undefined : new Set(ids);
    for (const current of inventory.rows) {
      if (current.scopeUuid !== projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid) continue;
      const version = inventory.revisions.find(row => row.scopeUuid === current.scopeUuid && row.tableId === current.tableId && row.commitSeq === current.commitSeq && Buffer.from(row.rowId).equals(Buffer.from(current.rowId)));
      if (!version || version.isTombstone) continue;
      const decoded = await decodeCanonicalFlarexValueEvidenceV1({ canonicalBytes: version.valueBytes, sha256: version.valueSha256, profile: "appDocument" });
      const row = projectNativeRow(Schema.decodeUnknownSync(Schema.JsonObject)(decoded.valueJson));
      if (typeof row.id !== "string" || selected && !selected.has(row.id)) continue;
      const table = tables.find(table => table.tableId === current.tableId);
      if (!table) throw new Error("Missing installed comparison table");
      rows.push({ table: table.logicalName.slice(table.logicalName.lastIndexOf("/") + 1), row });
    }
    return rows.sort((left, right) => (left.table + "/" + left.row.id).localeCompare(right.table + "/" + right.row.id));
  };
  return { fixture, pricing, options, native, ...comparison, seedLists, outsideUpdate, prepareForward, prepareInverse, prepareWrapped, preparePhysicalDeletion,
    closeCaseHosts, readRows, read: async (ids?: readonly string[]) => (await readRows(ids)).map(entry => entry.row),
    prepare: async () => own(await Effect.runPromise(prepareRemovePriceListPricesWorkflow(options))),
    listPrices: (ids: readonly string[]) => Effect.runPromise(direct.read(pricing.priceRemovalRead, { filters: { id: [...ids] }, config: { relations: ["price_list"] } })),
    softDeletePrices: async (ids: readonly string[]) => {
      const host = own(await Effect.runPromise(prepareRemovePriceListPricesWorkflow(options)));
      return Effect.runPromise(host.run(host.newRequestKey(), { ids: [...ids] }));
    },
    restorePrices: (ids: readonly string[]) => Effect.runPromise(direct.run(direct.newRequestKey(), pricing.priceRemovalRestore, [...ids])),
    snapshot: () => logicalCurrencyInventory(fixture) };
}
