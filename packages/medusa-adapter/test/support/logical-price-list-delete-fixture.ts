import { Effect, Result, Schema } from "effect";
import { and, eq } from "drizzle-orm";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { deletePriceListsWorkflow } from "@medusajs/core-flows/price-list/delete-price-lists";
import { createPriceListsWorkflow } from "@medusajs/core-flows/price-list/create-price-lists";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { fxControlTables } from "../../../persistence-postgres/src/database/schema";
import { makeLocalPricingCommands } from "../../src/modules/pricing/service";
import { PriceListDeletionIds } from "../../src/modules/pricing/list-input";
import { PriceListDeletionWorkflowInput } from "../../src/modules/pricing/list-deletion-input";
import { PriceListUpdatesInput } from "../../src/modules/pricing/list-update-input";
import { preparePriceListDeletionLinkResource } from "../../src/links/price-list-deletion";
import { prepareDeletePriceListsWorkflow } from "../../src/workflows/pricing/delete-price-lists";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { priceListDeletionResources } from "../../src/workflow/policy";
import { projectNativeRow } from "../../src/repository/result";
import { logicalCurrencyFixture } from "./logical-currency-fixture";
import { logicalCurrencyInventory } from "./logical-currency-inventory";

const revision = "4".repeat(64), stamp = "2026-01-01T00:00:00.000Z";
const native = Result.getOrThrow(deletePriceListsWorkflow.prepare());
function callbacks(name: string) {
  const node = native.nodes.find(candidate => candidate.name === name);
  if (node?.kind !== "step" || node.compensation !== "transactionCovered" || !node.compensate)
    throw new Error("Missing original retained deletion callback: " + name);
  return { invoke: node.invoke, compensate: node.compensate };
}
const pricingCallbacks = callbacks("delete-price-lists"), linkCallbacks = callbacks("remove-remote-links");
const creation = Result.getOrThrow(createPriceListsWorkflow.prepare()).nodes.find(node => node.name === "create-price-lists");
if (creation?.kind !== "step" || !creation.compensate) throw new Error("Missing original physical inverse");
const physicalInverse = creation.compensate;
export const PriceListDeletionRetained = Schema.Struct({ pricing: PriceListDeletionIds,
  link: Schema.Struct({ pricing: Schema.Struct({ price_list_id: PriceListDeletionIds }) }) });
type Retained = typeof PriceListDeletionRetained.Type;
type Options = Parameters<typeof prepareDeletePriceListsWorkflow>[0];
export type DeletionScenario = "maximum" | "history" | "mixed-history" | "collision" | "same-model-id";
interface ParentOptions { readonly lateFailure?: boolean; readonly caughtRefusal?: boolean;
  readonly inspect?: (value: unknown) => void; readonly escape?: (work: () => Promise<unknown>) => void; }

/** Canonical comparison history is setup data, never a native administrative
 * API. Every forward, inverse and outside edit below uses existing native owners. */
export function priceListDeletionComparisonRows(scenario: DeletionScenario = "maximum") {
  const managed = { created_at: stamp, updated_at: stamp, deleted_at: null };
  const targetIds = (scenario === "maximum" ? ["plist154-a", "plist154-b", "plist154-c", "plist154-d"] : ["plist154-a"]);
  const protectedRootId = "plist154-protected", setId = "pset154-shared";
  const seedRows: Array<{ table: string; row: JsonObject }> = [];
  const root = (id: string): JsonObject => ({ id, title: "Original154 " + id, description: "Original154", status: "draft", type: "sale",
    starts_at: null, ends_at: null, rules_count: id === protectedRootId ? 1 : (scenario === "history" || scenario === "mixed-history") ? 3 : 2, ...managed });
  const price = (id: string, listId: string | null, rules = 2): JsonObject => ({ id, title: null, currency_code: "USD", amount: "25.000000000000000000",
    raw_amount: { value: "25.000000000000000000", precision: 20 }, min_quantity: null, raw_min_quantity: null,
    max_quantity: null, raw_max_quantity: null, rules_count: rules, price_set_id: setId, price_list_id: listId, ...managed });
  seedRows.push({ table: "price_set", row: { id: setId, ...managed } }, { table: "price", row: price("price154-base", null, 0) });
  for (const id of [...targetIds, protectedRootId]) {
    const extra = (scenario === "history" || scenario === "mixed-history") && id === targetIds[0];
    const historicalRoot = scenario === "history" && id === targetIds[0];
    seedRows.push({ table: "price_list", row: { ...root(id), ...(historicalRoot ? { deleted_at: stamp } : {}) } });
    for (let index = 0; index < (id === protectedRootId ? 1 : extra ? 3 : 2); index++) {
      const listRuleId = scenario === "same-model-id" && id === targetIds[0] && index === 0 ? "same-id154" : "plrule154-" + id + "-" + index;
      const priceId = "price154-" + id + "-" + index;
      seedRows.push({ table: "price_list_rule", row: { id: listRuleId, price_list_id: id, attribute: "list154-" + index, value: ["value154"], ...managed,
        ...((extra && index !== 1 || scenario === "same-model-id" && id === targetIds[0] && index === 0) ? { deleted_at: stamp } : {}) } },
      { table: "price", row: { ...price(priceId, id, extra && index === 0 ? 3 : id === protectedRootId ? 1 : 2), ...(extra && index === 0 ? { deleted_at: stamp } : {}) } });
      for (let priority = 0; priority < (extra && index === 0 ? 3 : id === protectedRootId ? 1 : 2); priority++) {
        const ruleId = scenario === "same-model-id" && id === targetIds[0] && index === 0 && priority === 0 ? "same-id154" : "prule154-" + id + "-" + index + "-" + priority;
        seedRows.push({ table: "price_rule", row: { id: ruleId, price_id: priceId, attribute: "rule154-" + priority, value: "value154", operator: "eq", priority,
          ...managed, ...((extra && priority !== 1 || scenario === "collision" && id === targetIds[0] && index === 0 && priority === 0) ? { deleted_at: stamp } : {}) } });
      }
    }
  }
  if (scenario === "collision") seedRows.push({ table: "price_rule", row: { id: "prule154-active-twin", price_id: "price154-plist154-a-0",
    attribute: "rule154-0", value: "value154", operator: "eq", priority: 0, ...managed } });
  seedRows.push({ table: "price_preference", row: { id: "prpref154-protected", attribute: "protected154", value: "never-touch", is_tax_inclusive: true, ...managed } });
  const protectedIds = seedRows.filter(entry => entry.table === "price_set" || entry.table === "price_preference" || entry.row.id === "price154-base" ||
    entry.row.id === protectedRootId || entry.row.price_list_id === protectedRootId || String(entry.row.price_id).includes(protectedRootId)).map(entry => String(entry.row.id));
  // Reuse the initializer's adjacent-table batch owner. Stable grouping keeps
  // every canonical row and each family's source order while respecting FKs.
  const initializationTableOrder = ["price_set", "price_list", "price_list_rule", "price", "price_rule", "price_preference"];
  const groupedRows = initializationTableOrder.flatMap(table => seedRows.filter(entry => entry.table === table));
  if (groupedRows.length !== seedRows.length) throw new Error("Unknown canonical initialization table");
  return { targetIds, protectedIds, protectedRootId, seedRows: groupedRows, sourceRows: seedRows, initializationTableOrder, stamp, scenario };
}

export async function prepareLogicalPriceListDeletion(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  scenario: DeletionScenario = "maximum") {
  const fixture = await logicalCurrencyFixture(driver, close, { includePricing: true });
  const pricing = await Effect.runPromise(makeLocalPricingCommands("price-list-deletions"));
  const definition = fixture.pricingDefinition;
  if (!definition) throw new Error("Missing installed Pricing source");
  const comparison = priceListDeletionComparisonRows(scenario), { seedRows, targetIds } = comparison;
  const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: seedRows },
    1_048_576, { invalidInput: () => new Error("Invalid Price List deletion comparison seed"), hashFailure: cause => new Error("Price List deletion seed hash", { cause }) }));
  const hostInput = { ...fixture.hostInput, commands: pricing.commands, logicalStorage: { ...fixture.hostInput.logicalStorage,
    source: { sourceKey: "medusa.pricing", writeProfile: "medusa.pricing", schema: definition.schema, evidence: definition.provenance },
    initialization: { stepId: "price-list154-comparison", datasetSha256: dataset.sha256Hex, expectedRowCount: seedRows.length } },
  } satisfies LogicalCommerceHostInput<unknown>;
  const initializer = await Effect.runPromise(makeCommerceHost(hostInput));
  try { await Effect.runPromise(initializer.initialize(seedRows)); } finally { await Effect.runPromise(initializer.close); }
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const link = Result.getOrThrow(preparePriceListDeletionLinkResource());
  const options: Options = { execution, pricing: { module: pricing.workflow, logicalStorage: hostInput.logicalStorage }, link, revision,
    subscribers: [{ id: "native-price-list-delete", revision }] };
  const resources = Result.getOrThrow(prepareWorkflowResources({ pricing: { module: pricing.workflow,
    methods: ["softDeletePriceLists", "restorePriceLists"], graph: false } }, true, { link }));
  const caseHosts: Array<() => Promise<void>> = [];
  const own = <H extends { readonly close: Effect.Effect<void> }>(host: H) => { caseHosts.push(() => Effect.runPromise(host.close)); return host; };
  const closeCaseHosts = async () => { for (const dispose of caseHosts.splice(0).reverse()) await dispose(); };
  close(closeCaseHosts);
  const prepareForward = async () => {
    const step = createStep("probe154-original-forward", resources.callback(async (ids: typeof PriceListDeletionIds.Type, context) => {
      const deleted = await pricingCallbacks.invoke(ids, context);
      if (!(deleted instanceof StepResponse)) throw new Error("Missing genuine native deletion StepResponse");
      const removed = await linkCallbacks.invoke({ pricing: { price_list_id: ids } }, context);
      if (!(removed instanceof StepResponse)) throw new Error("Missing genuine native Link StepResponse");
      return { pricing: deleted.compensateInput, link: removed.compensateInput };
    }));
    const flow = createWorkflow("probe154-original-forward-root", (ids: WorkflowData<typeof PriceListDeletionIds.Type>) => new WorkflowResponse(step(ids)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: { pricing: { ...options.pricing, logicalResources: priceListDeletionResources } }, operationScheduling: "queued",
      requestCallLimit: priceListDeletionResources.calls,
      workflow: { name: "probePriceListDeleteForward", resources, prepared: Result.getOrThrow(flow.prepare()), input: PriceListDeletionIds,
        output: PriceListDeletionRetained, events: internalModuleWorkflowEvents } })));
  };
  const prepareInverse = async (repeat = false) => {
    const step = createStep("probe154-original-inverse", resources.callback(async (input: Retained, context) => {
      await linkCallbacks.compensate(input.link, context); await pricingCallbacks.compensate(input.pricing, context);
      if (repeat) { await linkCallbacks.compensate(input.link, context); await pricingCallbacks.compensate(input.pricing, context); }
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe154-original-inverse-root", (input: WorkflowData<Retained>) => new WorkflowResponse(step(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: { pricing: { ...options.pricing, logicalResources: priceListDeletionResources } }, operationScheduling: "queued",
      requestCallLimit: priceListDeletionResources.calls,
      workflow: { name: "probePriceListDeleteInverse", resources, prepared: Result.getOrThrow(flow.prepare()), input: PriceListDeletionRetained,
        output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const prepareWrapped = async (configuration: ParentOptions = {}) => {
    const step = createStep("probe154-parent", resources.callback(async (_: unknown, context) => {
      configuration.inspect?.(context.resources); configuration.escape?.(() => context.resources.pricing.softDeletePriceLists([]));
      if (configuration.caughtRefusal) { try { context.container.resolve("region"); } catch { /* Authentic caller catches refused authority. */ } }
      if (configuration.lateFailure) throw new Error("Late parent failure after genuine Price List deletion");
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe154-parent-root", (input: WorkflowData<typeof PriceListDeletionWorkflowInput.Type>) => {
      const deleted = deletePriceListsWorkflow.runAsStep({ input }); return new WorkflowResponse(step(deleted));
    });
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: { pricing: { ...options.pricing, logicalResources: priceListDeletionResources } }, operationScheduling: "queued",
      requestCallLimit: priceListDeletionResources.calls,
      workflow: { name: "probePriceListDeleteParent", resources, prepared: Result.getOrThrow(flow.prepare()), input: PriceListDeletionWorkflowInput,
        output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const prepareRestore = async () => {
    const step = createStep("fixture154-restore", resources.callback(async (ids: typeof PriceListDeletionIds.Type, context) =>
      context.resources.pricing.restorePriceLists([...ids])));
    const flow = createWorkflow("fixture154-restore-root", (ids: WorkflowData<typeof PriceListDeletionIds.Type>) => new WorkflowResponse(step(ids)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: { pricing: { ...options.pricing, logicalResources: priceListDeletionResources } }, operationScheduling: "queued",
      requestCallLimit: priceListDeletionResources.calls,
      workflow: { name: "fixturePriceListRestore", resources, prepared: Result.getOrThrow(flow.prepare()), input: PriceListDeletionIds,
        output: Schema.JsonObject, events: internalModuleWorkflowEvents } })));
  };
  // Refusal/replay control: the identical original root and command identity
  // intentionally omit both named allowance selections. No caller chooses it.
  const prepareDefault64 = async () => own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options,
    modules: { pricing: options.pricing }, operationScheduling: "queued", workflow: { name: "deletePriceListsWorkflow", resources,
      prepared: native, input: PriceListDeletionWorkflowInput, output: Schema.Null, events: internalModuleWorkflowEvents } })));
  const prepareOutsideUpdate = async () => {
    const update = await Effect.runPromise(makeLocalPricingCommands("price-list-updates"));
    const selected = Result.getOrThrow(prepareWorkflowResources({ pricing: { module: update.workflow, methods: ["updatePriceLists"], graph: false } }, true));
    const step = createStep("fixture154-outside-update", selected.callback(async (data: typeof PriceListUpdatesInput.Type, context) =>
      context.resources.pricing.updatePriceLists(structuredClone(data))));
    const flow = createWorkflow("fixture154-outside-update-root", (data: WorkflowData<typeof PriceListUpdatesInput.Type>) => new WorkflowResponse(step(data)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: { pricing: { ...options.pricing, module: update.workflow, logicalPublication: "mixed" } },
      workflow: { name: "fixturePriceListOutsideUpdate", resources: selected, prepared: Result.getOrThrow(flow.prepare()), input: PriceListUpdatesInput,
        output: Schema.Array(Schema.JsonObject), events: internalModuleWorkflowEvents } })));
  };
  const preparePhysicalDeletion = async () => {
    const create = await Effect.runPromise(makeLocalPricingCommands("price-list-creations"));
    const selected = Result.getOrThrow(prepareWorkflowResources({ pricing: { module: create.workflow, methods: ["deletePriceLists"], graph: false } }, true));
    const step = createStep("fixture154-physical-inverse", selected.callback(async (ids: typeof PriceListDeletionIds.Type, context) => {
      await physicalInverse(ids, context); return new StepResponse(null);
    }));
    const flow = createWorkflow("fixture154-physical-inverse-root", (ids: WorkflowData<typeof PriceListDeletionIds.Type>) => new WorkflowResponse(step(ids)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: { pricing: { ...options.pricing, module: create.workflow } },
      workflow: { name: "fixturePriceListPhysicalInverse", resources: selected, prepared: Result.getOrThrow(flow.prepare()), input: PriceListDeletionIds,
        output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
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
      if (!table) throw new Error("Missing installed Pricing table");
      rows.push({ table: table.logicalName.slice(table.logicalName.lastIndexOf("/") + 1), row });
    }
    return rows.sort((left, right) => (left.table + "/" + left.row.id).localeCompare(right.table + "/" + right.row.id));
  };
  return { fixture, pricing, options, native, ...comparison, prepareForward, prepareInverse, prepareWrapped, prepareRestore, prepareDefault64,
    prepareOutsideUpdate, preparePhysicalDeletion, readRows, read: async (ids?: readonly string[]) => (await readRows(ids)).map(item => item.row),
    prepare: async () => own(await Effect.runPromise(prepareDeletePriceListsWorkflow(options))), snapshot: () => logicalCurrencyInventory(fixture), closeCaseHosts };
}
