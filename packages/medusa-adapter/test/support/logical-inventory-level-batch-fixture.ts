import { Effect, Result, Schema } from "effect";
import { and, eq } from "drizzle-orm";
import { fxControlTables, fxAppRowCurrent } from "../../../persistence-postgres/src/database/schema";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { batchInventoryItemLevelsWorkflow } from "@medusajs/core-flows/inventory/batch-inventory-item-levels";
import { makeLocalInventoryCommands } from "../../src/modules/inventory/service";
import { InventoryLevelInput } from "../../src/modules/inventory/level-input";
import { InventoryLevelCreatedRows, InventoryLevelRows } from "../../src/modules/inventory/level-contracts";
import { InventoryLevelUpdates } from "../../src/modules/inventory/update-level-input";
import { InventoryLevelDeletionIds } from "../../src/modules/inventory/delete-level-input";
import { InventoryLevelBatchInput, prepareInventoryLevelBatchWorkflow } from "../../src/workflows/inventory/batch-levels";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { prepareLogicalInventoryLevelDeletion } from "./logical-inventory-level-delete-fixture";
import { prepareLogicalPricingHost } from "./logical-pricing-fixture";
import { pricingLogicalCreateEventPolicy } from "../../src/modules/pricing/events";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalInventoryMaintenanceShared } from "./logical-inventory-maintenance-fixture";

const prepared = Result.getOrThrow(batchInventoryItemLevelsWorkflow.prepare());
function callback(name: string) {
  const node = prepared.nodes.find(node => node.kind === "step" && node.name === name);
  if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
    throw new Error("Missing genuine Level batch callback " + name); return node;
}
const creation = callback("create-inventory-levels"), update = callback("update-inventory-levels-step");
const child = prepared.nodes.find(node => node.kind === "workflow");
if (child?.kind !== "workflow") throw new Error("Missing genuine Level deletion child");
const deletion = child.workflow.nodes.find(node => node.kind === "step" && node.name === "delete-entities-step");
if (deletion?.kind !== "step" || deletion.compensate === undefined) throw new Error("Missing genuine generic inverse");
const restoreLevels = deletion.compensate;
// Retained native callback input needs mutable arrays; conversion must precede
// checks because the installed Schema.mutable rebuilds the array schema.
const Creates = Schema.Array(InventoryLevelInput).pipe(Schema.mutable).check(Schema.isMaxLength(8));
const Preimages = Schema.Struct({ dataBeforeUpdate: InventoryLevelRows, selects: Schema.Array(Schema.String), relations: Schema.Array(Schema.String) });
const Created = Schema.Struct({ output: InventoryLevelCreatedRows, compensation: Schema.Array(Schema.String).pipe(Schema.mutable).check(Schema.isMaxLength(8)) });
const Updated = Schema.Struct({ output: InventoryLevelRows, compensation: Preimages });

/** Existing creation/update/deletion seeds and probes remain native. The test
 * root binds one Level batch profile and no Stock Location provider. Separate
 * probes invoke retained genuine callbacks; they do not replace batch execution. */
export async function prepareLogicalInventoryLevelBatch(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  shared?: LogicalInventoryMaintenanceShared) {
  const common = await prepareLogicalInventoryLevelDeletion(driver, close, shared);
  const batch = await Effect.runPromise(makeLocalInventoryCommands("level-batches"));
  const modules = { inventory: { module: batch.workflow, logicalStorage: common.members.inventory.hostInput.logicalStorage } };
  const subscribers = [{ id: "native-inventory-level-batch", revision: "2".repeat(64) }];
  const options: Parameters<typeof prepareInventoryLevelBatchWorkflow>[0] = { execution: common.execution, modules, revision: "3".repeat(64), subscribers };
  const prepare = async (revision = options.revision) => {
    const host = await Effect.runPromise(prepareInventoryLevelBatchWorkflow({ ...options, revision })); close(() => Effect.runPromise(host.close)); return host;
  };
  const resources = Result.getOrThrow(prepareWorkflowResources({ inventory: { module: batch.workflow,
    methods: ["createInventoryLevels", "deleteInventoryLevels", "listInventoryLevels", "updateInventoryLevels", "softDeleteInventoryLevels", "restoreInventoryLevels"], graph: false } }, true));
  const createForward = createStep("probe-retained-level-batch-create", resources.callback(async (input: typeof Creates.Type, context) => {
    const result = await creation.invoke(input, context); if (!(result instanceof StepResponse)) throw new Error("Missing genuine create response");
    return { output: result.output, compensation: result.compensateInput };
  }));
  const createInverse = createStep("probe-retained-level-batch-create-inverse", resources.callback(async (ids: typeof Created.fields.compensation.Type, context) => {
    if (creation.compensate === undefined) throw new Error("Missing genuine physical inverse"); await creation.compensate(ids, context); return new StepResponse(null);
  }));
  const updateForward = createStep("probe-retained-level-batch-update", resources.callback(async (input: typeof InventoryLevelUpdates.Type, context) => {
    const result = await update.invoke(input, context); if (!(result instanceof StepResponse)) throw new Error("Missing genuine update response");
    return { output: result.output, compensation: result.compensateInput };
  }));
  const updateInverse = createStep("probe-retained-level-batch-update-inverse", resources.callback(async (input: typeof Preimages.Type, context) => {
    if (update.compensate === undefined) throw new Error("Missing genuine update inverse"); await update.compensate(input, context); return new StepResponse(null);
  }));
  const deletionInverse = createStep("probe-retained-level-batch-delete-inverse", resources.callback(async (ids: typeof InventoryLevelDeletionIds.Type, context) => {
    await restoreLevels({ entityIdentifiers: [...ids], moduleRegistrationName: "inventory", compensateMethod: "restoreInventoryLevels" }, context); return new StepResponse(null);
  }));
  const createProbe = createWorkflow("probe-level-batch-create", (input: WorkflowData<typeof Creates.Type>) => new WorkflowResponse(createForward(input)));
  const createRestoreProbe = createWorkflow("probe-level-batch-create-inverse", (input: WorkflowData<typeof Created.fields.compensation.Type>) => new WorkflowResponse(createInverse(input)));
  const updateProbe = createWorkflow("probe-level-batch-update", (input: WorkflowData<typeof InventoryLevelUpdates.Type>) => new WorkflowResponse(updateForward(input)));
  const updateRestoreProbe = createWorkflow("probe-level-batch-update-inverse", (input: WorkflowData<typeof Preimages.Type>) => new WorkflowResponse(updateInverse(input)));
  const deleteRestoreProbe = createWorkflow("probe-level-batch-delete-inverse", (input: WorkflowData<typeof InventoryLevelDeletionIds.Type>) => new WorkflowResponse(deletionInverse(input)));
  const prepareProbes = async () => {
    const create = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", workflow: {
      name: "probeLevelBatchCreate", resources, prepared: Result.getOrThrow(createProbe.prepare()), input: Creates, output: Created, events: internalModuleWorkflowEvents } }));
    const undoCreate = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", workflow: {
      name: "probeLevelBatchCreateInverse", resources, prepared: Result.getOrThrow(createRestoreProbe.prepare()), input: Created.fields.compensation, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    const update = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", workflow: {
      name: "probeLevelBatchUpdate", resources, prepared: Result.getOrThrow(updateProbe.prepare()), input: InventoryLevelUpdates, output: Updated, events: internalModuleWorkflowEvents } }));
    const undoUpdate = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", workflow: {
      name: "probeLevelBatchUpdateInverse", resources, prepared: Result.getOrThrow(updateRestoreProbe.prepare()), input: Preimages, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    const undoDelete = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", workflow: {
      name: "probeLevelBatchDeleteInverse", resources, prepared: Result.getOrThrow(deleteRestoreProbe.prepare()), input: InventoryLevelDeletionIds, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    for (const host of [create, undoCreate, update, undoUpdate, undoDelete]) close(() => Effect.runPromise(host.close));
    return { create, undoCreate, update, undoUpdate, undoDelete };
  };
  const maximum = async (prefix: string) => {
    const graph = await common.seedCohort(prefix), input: typeof InventoryLevelBatchInput.Type = {
      create: graph.items.slice(0, 8).map((inventory_item_id, index) => ({ inventory_item_id, location_id: prefix + "-unresolved-location-" + index,
        stocked_quantity: index + 0.125, incoming_quantity: index + 0.25 })),
      update: graph.pairs.slice(0, 4).map((pair, index) => ({ ...pair, stocked_quantity: 20 + index + 0.5, incoming_quantity: index + 0.75 })),
      delete: graph.levels.slice(4, 8).map(level => level.id), force: true,
    };
    return { ...graph, input };
  };
  let pricingSeeded = false;
  const seedProtected = async (prefix: string) => {
    const protectedGraph = await common.seedProtected(prefix);
    if (!pricingSeeded) {
      const pricing = await prepareLogicalPricingHost(common.fixture); await Effect.runPromise(pricing.host.initialize([]));
      close(() => Effect.runPromise(pricing.host.close));
      const participant = defineAtomicCommerceParticipant("pricing"), policy = pricingLogicalCreateEventPolicy();
      const names = ["pricing.price-set.created", "pricing.price.created", "pricing.price-rule.created"];
      const contracts = names.map(name => ({ name, contract: defineCommerceEventContract({ name, revision: "4".repeat(64), internal: true, decode: policy.capture }) }));
      const create = defineAtomicCommerceCommand("levelBatchProtectedPricingSeed", (ctx, input) => ctx.call(participant, pricing.runtime.create, input));
      const host = await Effect.runPromise(common.execution.prepare({ identityAndAccessPolicy: { seed: "level-batch-pricing" },
        participants: [{ participant, logicalStorage: pricing.hostInput.logicalStorage, commands: [pricing.runtime.create], validateLogicalCall: policy.validateLogicalCall,
          events: { contracts: contracts.map(entry => entry.contract), select: message => {
            const found = isJsonObject(message) ? contracts.find(entry => entry.name === message.name) : undefined;
            return found === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(found.contract);
          } } }], commands: [create], events: { producerRevision: "4".repeat(64), contracts: contracts.map(entry => entry.contract), subscribers,
          validate: events => events.every(event => event.internal) ? Effect.void : Effect.fail(commerceError("unadmittedEvent")) } }));
      try { await Effect.runPromise(host.run(host.newRequestKey(), create, [{ id: prefix + "-protected-price-set", prices: [{ currency_code: "USD", amount: "123.4567890123456789", rules: { region_id: "retained" } }] }])); }
      finally { await Effect.runPromise(host.close); }
      pricingSeeded = true;
    }
    return protectedGraph;
  };
  const preserved = async () => {
    const tables = await common.fixture.control.drizzle.select().from(fxControlTables).where(and(eq(fxControlTables.deploymentId, common.fixture.deploymentId),
      eq(fxControlTables.namespace, "medusa")));
    const selected = new Set(tables.filter(table => ["price_set", "price", "price_rule"].some(name => table.logicalName.endsWith("/" + name))).map(table => table.tableId));
    const pricing = (await common.fixture.persistence.drizzle.select().from(fxAppRowCurrent).orderBy(fxAppRowCurrent.tableId, fxAppRowCurrent.rowId)).filter(row => selected.has(row.tableId));
    return { ...await common.preserved(), pricing };
  };
  return { ...common, batch, options, prepare, prepareProbes, maximum, seedProtected, preserved, prepareUpdate: common.prepareUpdate };
}
