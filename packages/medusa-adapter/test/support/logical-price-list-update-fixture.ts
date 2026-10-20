import { Effect, Result, Schema } from "effect";
import { and, eq } from "drizzle-orm";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { updatePriceListsWorkflow, type UpdatePriceListsWorkflowInput } from "@medusajs/core-flows/price-list/update-price-lists";
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
import { PriceListUpdateWorkflowInput, PriceListUpdatesInput } from "../../src/modules/pricing/list-update-input";
import { prepareUpdatePriceListsWorkflow } from "../../src/workflows/pricing/update-price-lists";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { projectNativeRow } from "../../src/repository/result";
import { logicalCurrencyFixture } from "./logical-currency-fixture";
import { logicalCurrencyInventory } from "./logical-currency-inventory";

const revision = "d".repeat(64), stamp = "2026-01-01T00:00:00.000Z";
const original = Result.getOrThrow(updatePriceListsWorkflow.prepare());
const validation = original.nodes.find(node => node.name === "validate-price-lists");
const updating = original.nodes.find(node => node.name === "update-price-lists");
const creation = Result.getOrThrow(createPriceListsWorkflow.prepare()).nodes.find(node => node.name === "create-price-lists");
if (validation?.kind !== "step" || updating?.kind !== "step" || updating.compensation !== "transactionCovered" || !updating.compensate ||
  creation?.kind !== "step" || creation.compensation !== "transactionCovered" || !creation.compensate)
  throw new Error("Missing genuine Price List update/creation callbacks");
const retained = { validate: validation.invoke, invoke: updating.invoke, compensate: updating.compensate, remove: creation.compensate };
export const PriceListUpdateCompensation = Schema.NullOr(Schema.Struct({
  dataBeforeUpdate: Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)),
  selects: Schema.Array(Schema.String), relations: Schema.Array(Schema.String),
}));
export const PriceListUpdateProbeOutput = Schema.Struct({
  output: Schema.NullOr(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4))), compensation: PriceListUpdateCompensation,
});
type Options = Parameters<typeof prepareUpdatePriceListsWorkflow>[0];
type Input = typeof PriceListUpdateWorkflowInput.Type;
interface ParentOptions {
  readonly lateFailure?: boolean; readonly caughtRefusal?: boolean;
  readonly inspect?: (resources: unknown) => void;
  readonly escape?: (work: () => Promise<unknown>) => void;
  readonly afterNative?: () => Promise<void>;
}

/** Canonical comparison rows are setup data, not a native administrative API.
 * All workflow mutations below execute genuine installed Pricing methods. */
export function priceListUpdateComparisonRows() {
  const managed = { created_at: stamp, updated_at: stamp, deleted_at: null };
  const targetIds = ["plist153-a", "plist153-b", "plist153-c", "plist153-d"];
  const protectedRootId = "plist153-protected", deletionRootId = "plist153-delete", historicalRootId = "plist153-history", historyOwnerId = "plist153-active-history";
  const activeIds = [...targetIds, protectedRootId, deletionRootId, historyOwnerId];
  const seedRows: Array<{ table: string; row: JsonObject }> = [];
  const protectedIds: string[] = [protectedRootId, "prpref153-protected"];
  const selectedPricingIds: string[] = [];
  for (const [index, id] of activeIds.entries()) {
    const setId = "pset153-" + index, baseId = "price153-base-" + index;
    seedRows.push({ table: "price_list", row: { id, title: "Original title153-" + index, description: "Original description153-" + index,
        status: index % 2 ? "draft" : "active", type: "sale", starts_at: "2025-01-01T00:00:00.000Z",
        ends_at: "2030-01-01T00:00:00.000Z", rules_count: 2, ...managed } });
    const price = (priceId: string, listId: string | null, amount: string, rules: number): JsonObject => ({
      id: priceId, title: null, currency_code: "USD", amount, raw_amount: { value: amount, precision: 20 },
      min_quantity: null, raw_min_quantity: null, max_quantity: null, raw_max_quantity: null,
      rules_count: rules, price_set_id: setId, price_list_id: listId, ...managed,
    });
    // The protected graph covers all six tables; one updated root also has
    // attached Prices/Rules, proving native List updates preserve that graph.
    if (id === protectedRootId || id === targetIds[0]) {
      (id === protectedRootId ? protectedIds : selectedPricingIds).push(setId, baseId);
      seedRows.push({ table: "price_set", row: { id: setId, ...managed } },
        { table: "price", row: price(baseId, null, "100.00000000000000000", 0) });
    }
    for (const number of [0, 1]) {
      const listRuleId = "plrule153-" + index + "-" + number, priceId = "price153-" + index + "-" + number;
      seedRows.push({ table: "price_list_rule", row: { id: listRuleId, price_list_id: id,
        attribute: number ? "sales_channel_id" : "region_id", value: number ? ["web153", "app153"] : ["reg153-" + index], ...managed } });
      if (id === protectedRootId || id === targetIds[0] && number === 0) {
        seedRows.push({ table: "price", row: price(priceId, id, "40.000000000000000000", 2) });
        if (id === protectedRootId) protectedIds.push(listRuleId, priceId);
        else selectedPricingIds.push(priceId);
        for (const priority of [0, 1]) {
          const ruleId = "prule153-" + index + "-" + number + "-" + priority;
          seedRows.push({ table: "price_rule", row: { id: ruleId, price_id: priceId, attribute: priority ? "customer_group_id" : "region_id",
            value: "value153", operator: "eq", priority, ...managed } });
          (id === protectedRootId ? protectedIds : selectedPricingIds).push(ruleId);
        }
      }
    }
  }
  seedRows.push({ table: "price_preference", row: { id: "prpref153-protected", attribute: "protected153", value: "never-touch", is_tax_inclusive: true, ...managed } },
    { table: "price_list", row: { id: historicalRootId, title: "Historical153", description: "Canonical history", status: "draft", type: "sale",
      starts_at: null, ends_at: null, rules_count: 3, ...managed, deleted_at: stamp } });
  for (const index of [0, 1, 2]) seedRows.push({ table: "price_list_rule", row: { id: "plrule153-history-" + index,
    price_list_id: historicalRootId, attribute: "history153-" + index, value: ["history153"], ...managed, deleted_at: index === 1 ? null : stamp } });
  seedRows.push({ table: "price_list_rule", row: { id: "plrule153-active-root-history", price_list_id: historyOwnerId,
    attribute: "historical153", value: ["keep-history153"], ...managed, deleted_at: stamp } });
  return { targetIds, protectedIds, selectedPricingIds, protectedRootId, deletionRootId, historicalRootId, historyOwnerId, seedRows, stamp };
}

export async function prepareLogicalPriceListUpdate(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void) {
  const fixture = await logicalCurrencyFixture(driver, close, { includePricing: true });
  const pricing = await Effect.runPromise(makeLocalPricingCommands("price-list-updates"));
  const definition = fixture.pricingDefinition;
  if (!definition) throw new Error("Missing installed Pricing source");
  const comparison = priceListUpdateComparisonRows(), { seedRows, targetIds } = comparison;
  const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: seedRows },
    1_048_576, { invalidInput: () => new Error("Invalid Price List update comparison seed"), hashFailure: cause => new Error("Price List update seed hash", { cause }) }));
  const hostInput = { ...fixture.hostInput, commands: pricing.commands, logicalStorage: { ...fixture.hostInput.logicalStorage,
    source: { sourceKey: "medusa.pricing", writeProfile: "medusa.pricing", schema: definition.schema, evidence: definition.provenance },
    initialization: { stepId: "price-list153-comparison", datasetSha256: dataset.sha256Hex, expectedRowCount: seedRows.length } },
  } satisfies LogicalCommerceHostInput<unknown>;
  const initializer = await Effect.runPromise(makeCommerceHost(hostInput));
  try { await Effect.runPromise(initializer.initialize(seedRows)); } finally { await Effect.runPromise(initializer.close); }
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const options: Options = { execution, pricing: { module: pricing.workflow, logicalStorage: hostInput.logicalStorage, logicalPublication: "mixed" }, revision,
    subscribers: [{ id: "native-price-list-update", revision }] };
  const modules = { pricing: options.pricing };
  const resources = Result.getOrThrow(prepareWorkflowResources({ pricing: { module: pricing.workflow, methods: ["listPriceLists", "updatePriceLists"], graph: false } }, true));
  const caseHosts: Array<() => Promise<void>> = [];
  const own = <H extends { readonly close: Effect.Effect<void> }>(host: H) => { caseHosts.push(() => Effect.runPromise(host.close)); return host; };
  const closeCaseHosts = async () => { for (const dispose of caseHosts.splice(0).reverse()) await dispose(); };
  close(closeCaseHosts);
  const prepareForward = async () => {
    const step = createStep("probe153-original-forward", resources.callback(async (input: Input, context) => {
      await retained.validate(input.price_lists_data, context);
      const result = await retained.invoke(input.price_lists_data, context);
      if (!(result instanceof StepResponse)) throw new Error("Missing genuine native update StepResponse");
      return { output: result.output ?? null, compensation: result.compensateInput ?? null };
    }));
    const flow = createWorkflow("probe153-original-forward-root", (input: WorkflowData<Input>) => new WorkflowResponse(step(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules, workflow: { name: "probePriceListUpdateForward", resources,
      prepared: Result.getOrThrow(flow.prepare()), input: PriceListUpdateWorkflowInput, output: PriceListUpdateProbeOutput, events: internalModuleWorkflowEvents } })));
  };
  const prepareInverse = async (repeat = false) => {
    const step = createStep("probe153-original-inverse", resources.callback(async (input: typeof PriceListUpdateCompensation.Type, context) => {
      await retained.compensate(input, context); if (repeat) await retained.compensate(input, context); return new StepResponse(null);
    }));
    const flow = createWorkflow("probe153-original-inverse-root", (input: WorkflowData<typeof PriceListUpdateCompensation.Type>) => new WorkflowResponse(step(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules, workflow: { name: "probePriceListUpdateInverse", resources,
      prepared: Result.getOrThrow(flow.prepare()), input: PriceListUpdateCompensation, output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const prepareModuleUpdate = async () => {
    const step = createStep("probe153-native-outside-update", resources.callback(async (input: typeof PriceListUpdatesInput.Type, context) =>
      context.resources.pricing.updatePriceLists(structuredClone(input))));
    const flow = createWorkflow("probe153-native-outside-update-root", (input: WorkflowData<typeof PriceListUpdatesInput.Type>) => new WorkflowResponse(step(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules, workflow: { name: "probePriceListNativeOutsideUpdate", resources,
      prepared: Result.getOrThrow(flow.prepare()), input: PriceListUpdatesInput, output: Schema.Array(Schema.JsonObject), events: internalModuleWorkflowEvents } })));
  };
  const preparePhysicalDeletion = async () => {
    const creation = await Effect.runPromise(makeLocalPricingCommands("price-list-creations"));
    const installed = { pricing: { module: creation.workflow, logicalStorage: hostInput.logicalStorage } };
    const selected = Result.getOrThrow(prepareWorkflowResources({ pricing: { module: creation.workflow, methods: ["deletePriceLists"], graph: false } }, true));
    const step = createStep("probe153-existing-physical-inverse", selected.callback(async (ids: typeof PriceListDeletionIds.Type, context) => {
      await retained.remove(ids, context); return new StepResponse(null);
    }));
    const flow = createWorkflow("probe153-existing-physical-inverse-root", (ids: WorkflowData<typeof PriceListDeletionIds.Type>) => new WorkflowResponse(step(ids)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: installed, workflow: { name: "probePriceListExistingPhysicalInverse", resources: selected,
      prepared: Result.getOrThrow(flow.prepare()), input: PriceListDeletionIds, output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const prepareWrapped = async (configuration: ParentOptions = {}) => {
    const step = createStep("probe153-parent", resources.callback(async (_: unknown, context) => {
      await configuration.afterNative?.(); configuration.inspect?.(context.resources);
      configuration.escape?.(() => context.resources.pricing.listPriceLists({ id: [targetIds[0]!] }));
      if (configuration.caughtRefusal) { try { context.container.resolve("region"); } catch { /* The native caller catches an authentic refusal. */ } }
      if (configuration.lateFailure) throw new Error("Late parent failure after genuine Price List update");
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe153-parent-root", (input: WorkflowData<UpdatePriceListsWorkflowInput>) => {
      const updated = updatePriceListsWorkflow.runAsStep({ input });
      return new WorkflowResponse(step(updated));
    });
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules, workflow: { name: "probePriceListUpdateParent", resources,
      prepared: Result.getOrThrow(flow.prepare()), input: PriceListUpdateWorkflowInput, output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const readRows = async (ids?: readonly string[]) => {
    const inventory = await logicalCurrencyInventory(fixture), rows: Array<{ table: string; row: JsonObject }> = [];
    const tables = await fixture.control.drizzle.select().from(fxControlTables).where(and(eq(fxControlTables.deploymentId, fixture.deploymentId),
      eq(fxControlTables.namespace, "medusa")));
    const selected = ids === undefined ? undefined : new Set(ids);
    for (const current of inventory.rows) {
      if (current.scopeUuid !== projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid) continue;
      const version = inventory.revisions.find(row => row.scopeUuid === current.scopeUuid && row.tableId === current.tableId && row.commitSeq === current.commitSeq && Buffer.from(row.rowId).equals(Buffer.from(current.rowId)));
      if (!version || version.isTombstone) continue;
      const decoded = await decodeCanonicalFlarexValueEvidenceV1({ canonicalBytes: version.valueBytes, sha256: version.valueSha256, profile: "appDocument" });
      const row = projectNativeRow(Schema.decodeUnknownSync(Schema.JsonObject)(decoded.valueJson));
      if (typeof row.id !== "string" || selected && !selected.has(row.id)) continue;
      const table = tables.find(table => table.tableId === current.tableId);
      if (!table) throw new Error("Missing actual installed comparison table identity");
      rows.push({ table: table.logicalName.slice(table.logicalName.lastIndexOf("/") + 1), row });
    }
    return rows.sort((left, right) => String(left.row.id).localeCompare(String(right.row.id)));
  };
  const read = async (ids?: readonly string[]) => (await readRows(ids)).map(item => item.row);
  const readStorageOrder = async (ids: readonly string[]) => {
    const inventory = await logicalCurrencyInventory(fixture), selected = new Set(ids), order: Array<{ id: string; commit: bigint; ordinal: number }> = [];
    for (const current of inventory.rows) {
      if (current.scopeUuid !== projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid) continue;
      const version = inventory.revisions.find(row => row.scopeUuid === current.scopeUuid && row.tableId === current.tableId && row.commitSeq === current.commitSeq && Buffer.from(row.rowId).equals(Buffer.from(current.rowId)));
      if (!version || version.isTombstone) continue;
      const decoded = await decodeCanonicalFlarexValueEvidenceV1({ canonicalBytes: version.valueBytes, sha256: version.valueSha256, profile: "appDocument" });
      const row = Schema.decodeUnknownSync(Schema.JsonObject)(decoded.valueJson);
      if (typeof row.id !== "string" || !selected.has(row.id)) continue;
      if (version.insertionCommitSeq === null || version.insertionAttemptOrdinal === null) throw new Error("Missing actual storage insertion evidence");
      order.push({ id: row.id, commit: version.insertionCommitSeq, ordinal: version.insertionAttemptOrdinal });
    }
    return order.sort((a, b) => a.commit < b.commit ? -1 : a.commit > b.commit ? 1 : a.ordinal - b.ordinal).map(item => item.id);
  };
  return { fixture, options, pricing, ...comparison, prepareForward, prepareInverse, prepareModuleUpdate, preparePhysicalDeletion, prepareWrapped, read, readRows,
    readStorageOrder, prepare: async () => own(await Effect.runPromise(prepareUpdatePriceListsWorkflow(options))), snapshot: () => logicalCurrencyInventory(fixture), closeCaseHosts };
}
