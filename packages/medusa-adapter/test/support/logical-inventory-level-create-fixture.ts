import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createInventoryLevelsWorkflow } from "@medusajs/core-flows/inventory/create-inventory-levels";
import { makeLocalInventoryCommands } from "../../src/modules/inventory/service";
import { InventoryId } from "../../src/modules/inventory/item-input";
import { InventoryItemRows } from "../../src/modules/inventory/item-contracts";
import { InventoryLevelCreationInput, prepareInventoryLevelCreationWorkflow } from "../../src/workflows/inventory/create-levels";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { prepareLogicalInventoryItemCreation } from "./logical-inventory-item-create-fixture";
import type { LogicalInventoryMaintenanceShared } from "./logical-inventory-maintenance-fixture";

const prepared = Result.getOrThrow(createInventoryLevelsWorkflow.prepare());
const creation = prepared.nodes.find(node => node.kind === "step" && node.name === "create-inventory-levels");
if (creation?.kind !== "step" || creation.compensation !== "transactionCovered" || creation.compensate === undefined)
  throw new Error("Missing genuine retained native Level creation inverse");
const compensate = creation.compensate;
const Ids = Schema.Array(InventoryId).pipe(Schema.mutable).check(Schema.isMaxLength(8));

/** Existing native Item/Location seeds and raw Level probes remain with 119/120.
 * This fixture assembles the dedicated existing-endpoint creation profile. */
export async function prepareLogicalInventoryLevelCreation(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  shared?: LogicalInventoryMaintenanceShared) {
  const common = await prepareLogicalInventoryItemCreation(driver, close, shared);
  const creation = await Effect.runPromise(makeLocalInventoryCommands("level-creations"));
  const modules = { inventory: { module: creation.workflow, logicalStorage: common.members.inventory.hostInput.logicalStorage },
    stock_location: { module: common.locations.workflow, logicalStorage: common.members.stockLocation.hostInput.logicalStorage } };
  const subscribers = [{ id: "native-inventory-level-creation", revision: "b".repeat(64) }];
  const options: Parameters<typeof prepareInventoryLevelCreationWorkflow>[0] = { execution: common.execution, modules,
    revision: "a".repeat(64), subscribers };
  const prepare = async (revision = options.revision) => {
    const host = await Effect.runPromise(prepareInventoryLevelCreationWorkflow({ ...options, revision }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareInverse = async () => {
    const resources = Result.getOrThrow(prepareWorkflowResources({ inventory: { module: creation.workflow,
      methods: ["deleteInventoryLevels"], graph: false } }, true));
    const inverse = createStep("probe-standalone-level-creation-inverse", resources.callback(async (ids: typeof Ids.Type, context) => {
      await compensate(ids, context); return null;
    }));
    const workflow = createWorkflow("probe-standalone-level-creation-inverse", (input: WorkflowData<typeof Ids.Type>) => new WorkflowResponse(inverse(input)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution: common.execution,
      modules: { inventory: modules.inventory }, revision: options.revision, subscribers,
      workflow: { name: "probeStandaloneLevelCreationInverse", resources, prepared: Result.getOrThrow(workflow.prepare()),
        input: Ids, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const ownedItems = new Set<string>();
  const probeItems = async (ids: readonly string[]) => {
    const rows: Array<(typeof InventoryItemRows.Type)[number]> = [];
    for (let offset = 0; offset < ids.length; offset += 4)
      rows.push(...await Effect.runPromise(common.probeItems(ids.slice(offset, offset + 4))));
    return rows;
  };
  const endpoints = async (prefix: string, count = 1, repeated = false) => {
    const items = Array.from({ length: repeated ? Math.min(2, count) : count }, (_, index) => prefix + "-item-" + index);
    for (const id of items) { await common.nativeCreate({ id, sku: id + "-sku", title: id }); ownedItems.add(id); }
    const locations = await common.seedLocations(prefix, count);
    const input: typeof InventoryLevelCreationInput.Type = { inventory_levels: locations.map((location_id, index) => ({
      inventory_item_id: items[index % items.length]!, location_id,
    })) };
    return { items, locations, input };
  };
  const maximum = async (prefix: string, repeated = false) => {
    const graph = await endpoints(prefix, 8, repeated);
    const input: typeof InventoryLevelCreationInput.Type = { inventory_levels: graph.input.inventory_levels.map((row, index) => ({
      ...row, ...(index === 0 ? {} : { stocked_quantity: index === 7 ? 1e30 : index % 2 === 0 ? -index - 0.125 : index + 0.25,
        incoming_quantity: index === 6 ? -1e25 : index - 0.75 }),
    })) };
    return { ...graph, input };
  };
  const seedProtected = async (prefix: string) => {
    const graph = await common.seedProtected(prefix); for (const id of graph.items) ownedItems.add(id); return graph;
  };
  const preserved = async () => ({ ...await common.preserved(), items: await probeItems([...ownedItems]) });
  return { ...common, common, creation, options, prepare, prepareInverse, endpoints, maximum, seedProtected, preserved, probeItems };
}
