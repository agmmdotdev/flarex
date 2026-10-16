import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createInventoryItemsWorkflow } from "@medusajs/core-flows/inventory/create-inventory-items";
import type { StockLocationModuleService } from "@medusajs/stock-location/services";
import { defineCommerceCommand } from "../../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { makeCommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeLocalInventoryCommands } from "../../src/modules/inventory/service";
import { makeStockLocationCommands } from "../../src/modules/stock-location/service";
import { StockLocationDeletionIds } from "../../src/modules/stock-location/delete-input";
import { InventoryItemInput } from "../../src/modules/inventory/item-input";
import { InventoryItemRows } from "../../src/modules/inventory/item-contracts";
import { projectNativeRow } from "../../src/repository/result";
import { InventoryId } from "../../src/modules/inventory/item-input";
import { InventoryItemCreationInput, prepareInventoryItemCreationWorkflow } from "../../src/workflows/inventory/create-items";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { prepareLogicalInventoryLevelBatch } from "./logical-inventory-level-batch-fixture";
import type { LogicalInventoryMaintenanceShared } from "./logical-inventory-maintenance-fixture";

const prepared = Result.getOrThrow(createInventoryItemsWorkflow.prepare());
const itemCreation = prepared.nodes.find(node => node.kind === "step" && node.name === "create-inventory-items");
const child = prepared.nodes.find(node => node.kind === "workflow");
if (itemCreation?.kind !== "step" || child?.kind !== "workflow") throw new Error("Missing native Item creation root");
const levelCreation = child.workflow.nodes.find(node => node.kind === "step" && node.name === "create-inventory-levels");
if (levelCreation?.kind !== "step" || itemCreation.compensate === undefined || levelCreation.compensate === undefined)
  throw new Error("Missing genuine retained creation inverses");
const invokeItemCreation = itemCreation.invoke, undoItems = itemCreation.compensate, undoLevels = levelCreation.compensate;
const Ids = Schema.Array(InventoryId).pipe(Schema.mutable).check(Schema.isMaxLength(4));
const LevelIds = Schema.Array(InventoryId).pipe(Schema.mutable).check(Schema.isMaxLength(8));
const Items = Schema.Array(InventoryItemInput).pipe(Schema.mutable).check(Schema.isMaxLength(4));
const Created = Schema.Struct({ output: InventoryItemRows, compensation: Ids });
const decodeIds = Schema.decodeUnknownEffect(Ids), decodeItems = Schema.decodeUnknownEffect(InventoryItemRows);
const probeCommand = defineCommerceCommand("standaloneInventoryItemCreationProbe", "read", Effect.fn(function* (ctx, input) {
  const ids = yield* decodeIds(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
  return (yield* (yield* ctx.table("inventory_item")).find(ctx.manager, { order: { column: "id", direction: "asc" }, take: 4,
    predicate: { kind: "in", column: "id", values: ids } })).map(projectNativeRow);
}));

/** Existing native seeds preserve nonempty neighboring graphs. The standalone
 * root binds only the dedicated creation owner and a Location ID-read owner. */
export async function prepareLogicalInventoryItemCreation(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  shared?: LogicalInventoryMaintenanceShared) {
  const common = await prepareLogicalInventoryLevelBatch(driver, close, shared);
  const creation = await Effect.runPromise(makeLocalInventoryCommands("item-creations"));
  const locations = await Effect.runPromise(makeStockLocationCommands("read"));
  const modules = { inventory: { module: creation.workflow, logicalStorage: common.members.inventory.hostInput.logicalStorage },
    stock_location: { module: locations.workflow, logicalStorage: common.members.stockLocation.hostInput.logicalStorage } };
  const subscribers = [{ id: "native-inventory-item-creation", revision: "6".repeat(64) }];
  const options: Parameters<typeof prepareInventoryItemCreationWorkflow>[0] = { execution: common.execution, modules, revision: "7".repeat(64), subscribers };
  const prepare = async (revision = options.revision) => {
    const host = await Effect.runPromise(prepareInventoryItemCreationWorkflow({ ...options, revision })); close(() => Effect.runPromise(host.close)); return host;
  };
  const rawReader = await Effect.runPromise(makeCommerceHost({ ...common.members.inventory.hostInput, commands: [probeCommand] }));
  close(() => Effect.runPromise(rawReader.close));
  const probeItems = (ids: readonly string[]) => rawReader.read(probeCommand, [...ids]).pipe(Effect.flatMap(decodeItems));
  const resources = Result.getOrThrow(prepareWorkflowResources({ inventory: { module: creation.workflow,
    methods: ["createInventoryItems", "createInventoryLevels", "deleteInventoryItems", "deleteInventoryLevels"], graph: false } }, true));
  const forward = createStep("probe-retained-item-create", resources.callback(async (input: typeof Items.Type, context) => {
    const result = await invokeItemCreation(input, context); if (!(result instanceof StepResponse)) throw new Error("Missing genuine Item create response");
    return { output: result.output, compensation: result.compensateInput };
  }));
  const inverse = createStep("probe-retained-item-create-inverse", resources.callback(async (ids: typeof Ids.Type, context) => { await undoItems(ids, context); return null; }));
  const levelInverse = createStep("probe-retained-child-level-create-inverse", resources.callback(async (ids: typeof LevelIds.Type, context) => { await undoLevels(ids, context); return null; }));
  const forwardProbe = createWorkflow("probe-item-create", (input: WorkflowData<typeof Items.Type>) => new WorkflowResponse(forward(input)));
  const inverseProbe = createWorkflow("probe-item-create-inverse", (input: WorkflowData<typeof Ids.Type>) => new WorkflowResponse(inverse(input)));
  const levelInverseProbe = createWorkflow("probe-item-child-level-create-inverse", (input: WorkflowData<typeof LevelIds.Type>) => new WorkflowResponse(levelInverse(input)));
  const prepareProbes = async () => {
    const probeOptions = { execution: common.execution, modules: { inventory: modules.inventory }, revision: options.revision, subscribers };
    const create = await Effect.runPromise(prepareAtomicWorkflowHost({ ...probeOptions, workflow: { name: "probeInventoryItemCreate", resources,
      prepared: Result.getOrThrow(forwardProbe.prepare()), input: Items, output: Created, events: internalModuleWorkflowEvents } }));
    const undo = await Effect.runPromise(prepareAtomicWorkflowHost({ ...probeOptions, workflow: { name: "probeInventoryItemCreateInverse", resources,
      prepared: Result.getOrThrow(inverseProbe.prepare()), input: Ids, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    const undoChild = await Effect.runPromise(prepareAtomicWorkflowHost({ ...probeOptions, workflow: { name: "probeInventoryItemChildLevelCreateInverse", resources,
      prepared: Result.getOrThrow(levelInverseProbe.prepare()), input: LevelIds, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    for (const host of [create, undo, undoChild]) close(() => Effect.runPromise(host.close)); return { create, undo, undoChild };
  };
  const seedLocations = async (prefix: string, count = 8) => {
    const ids = Array.from({ length: count }, (_, index) => prefix + "-location-" + index);
    for (let offset = 0; offset < ids.length; offset += 4) await Effect.runPromise(common.stocking.run(common.stocking.newRequestKey(), {
      locations: ids.slice(offset, offset + 4).map(id => ({ id, name: id })), inventory_levels: [] }));
    return ids;
  };
  const prepareLocationDeletion = async () => {
    const deletion = await Effect.runPromise(makeStockLocationCommands("delete"));
    const resources = Result.getOrThrow(prepareWorkflowResources({ stock_location: { module: deletion.workflow,
      methods: ["softDeleteStockLocations", "restoreStockLocations"], graph: false } }, true));
    const invoke = createStep("competing-native-location-soft-delete", resources.callback(async (ids: typeof StockLocationDeletionIds.Type, context) => {
      const service = context.container.resolve<Pick<StockLocationModuleService, "softDeleteStockLocations">>("stock_location");
      await service.softDeleteStockLocations([...ids]); return null;
    }));
    const workflow = createWorkflow("competing-native-location-soft-delete", (input: WorkflowData<typeof StockLocationDeletionIds.Type>) => new WorkflowResponse(invoke(input)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution: common.execution,
      modules: { stock_location: { module: deletion.workflow, logicalStorage: modules.stock_location.logicalStorage } }, revision: options.revision, subscribers,
      workflow: { name: "competingNativeLocationSoftDelete", resources, prepared: Result.getOrThrow(workflow.prepare()),
        input: StockLocationDeletionIds, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const maximum = async (prefix: string) => {
    const locations = await seedLocations(prefix), input: typeof InventoryItemCreationInput.Type = { items: Array.from({ length: 4 }, (_, index) => ({
      id: prefix + "-item-" + index, sku: prefix + "-sku-" + index, title: "Item " + index, description: "Native " + index,
      origin_country: "US", hs_code: "HS" + index, mid_code: "MID" + index, material: "Cotton", thumbnail: "image-" + index,
      weight: index - 0.125, length: index + 1.5, height: 2.75, width: -3.25, requires_shipping: index % 2 === 0,
      metadata: { ordinal: index, nested: { retained: true } },
      location_levels: locations.slice(index * 2, index * 2 + 2).map((location_id, ordinal) => ({ location_id,
        stocked_quantity: index * 10 + ordinal + 0.125, incoming_quantity: ordinal - 0.5 })),
    })) };
    return { input, locations, ids: input.items!.map(item => item.id!) };
  };
  const preserved = async () => {
    const { items: _items, ...families } = await common.preserved(); return families;
  };
  return { ...common, creation, locations, options, prepare, prepareProbes, probeItems, seedLocations, prepareLocationDeletion, maximum, preserved };
}
