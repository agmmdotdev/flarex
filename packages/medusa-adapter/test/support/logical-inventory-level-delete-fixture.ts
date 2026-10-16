import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { deleteInventoryLevelsWorkflow } from "@medusajs/core-flows/inventory/delete-inventory-levels";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeLocalInventoryCommands } from "../../src/modules/inventory/service";
import { InventoryLevelDeletionIds } from "../../src/modules/inventory/delete-level-input";
import { prepareInventoryLevelDeletionWorkflow } from "../../src/workflows/inventory/delete-levels";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { prepareLogicalInventoryLevelUpdate } from "./logical-inventory-level-update-fixture";
import type { LogicalInventoryMaintenanceShared } from "./logical-inventory-maintenance-fixture";

const prepared = Result.getOrThrow(deleteInventoryLevelsWorkflow.prepare());
const deletion = prepared.nodes.find(node => node.name === "delete-entities-step");
if (deletion?.kind !== "step" || deletion.compensation !== "transactionCovered" || deletion.compensate === undefined)
  throw new Error("Missing retained generic Level deletion compensator");
const compensate = deletion.compensate;

/** Native creation, quantities and connected endpoint seeds retain their
 * existing owners. This fixture only composes the dedicated deletion profile. */
export async function prepareLogicalInventoryLevelDeletion(driver: "pglite" | "postgres", registerCleanup: (close: () => Promise<void>) => void,
  shared?: LogicalInventoryMaintenanceShared) {
  const common = await prepareLogicalInventoryLevelUpdate(driver, registerCleanup, shared);
  const { fixture, members, execution } = common;
  const deletion = await Effect.runPromise(makeLocalInventoryCommands("level-deletions"));
  const subscribers = [{ id: "inventory-level-deletion-test", revision: "d".repeat(64) }];
  const options: Parameters<typeof prepareInventoryLevelDeletionWorkflow>[0] = { execution,
    modules: { inventory: { module: deletion.workflow, logicalStorage: members.inventory.hostInput.logicalStorage } },
    revision: "e".repeat(64), subscribers };
  const prepare = async (revision = options.revision) => {
    const host = await Effect.runPromise(prepareInventoryLevelDeletionWorkflow({ ...options, revision }));
    registerCleanup(() => Effect.runPromise(host.close)); return host;
  };
  const policy = deletion.logicalEventPolicy(), participant = defineAtomicCommerceParticipant("inventory");
  const names = ["inventory.inventory-level.deleted", "inventory.inventory-level.restored"];
  const namedContracts = names.map(name => ({ name, contract: defineCommerceEventContract({ name, revision: "f".repeat(64), internal: true, decode: policy.capture }) }));
  const contracts = namedContracts.map(entry => entry.contract);
  const softDelete = defineAtomicCommerceCommand("nativeInventoryLevelSoftDeleteAssertion", (ctx, input) => ctx.call(participant, deletion.softDeleteForWorkflow, input));
  const restore = defineAtomicCommerceCommand("nativeInventoryLevelRestoreAssertion", (ctx, input) => ctx.call(participant, deletion.restoreForWorkflow, input));
  const native = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput,
    participants: [{ participant, logicalStorage: members.inventory.hostInput.logicalStorage, commands: deletion.commands,
      validateLogicalCall: policy.validateLogicalCall, events: { contracts, select: message => {
        const selected = isJsonObject(message) ? namedContracts.find(entry => entry.name === message.name)?.contract : undefined;
        return selected === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(selected);
      } } }], commands: [softDelete, restore],
    events: { producerRevision: "f".repeat(64), contracts, subscribers,
      validate: emitted => emitted.some(event => !event.internal) ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void } }));
  registerCleanup(() => Effect.runPromise(native.close));
  const prepareRestore = async () => {
    const resources = Result.getOrThrow(prepareWorkflowResources({ inventory: { module: deletion.workflow,
      methods: ["restoreInventoryLevels"], graph: false } }, true));
    const invoke = createStep("invoke-retained-level-delete-compensation", resources.callback(async (ids: typeof InventoryLevelDeletionIds.Type, context) => {
      await compensate({ entityIdentifiers: [...ids], moduleRegistrationName: "inventory", compensateMethod: "restoreInventoryLevels" }, context);
      return null;
    }));
    const workflow = createWorkflow("probe-retained-level-delete-compensation", (input: WorkflowData<typeof InventoryLevelDeletionIds.Type>) => new WorkflowResponse(invoke(input)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules: options.modules,
      revision: "0".repeat(64), subscribers, workflow: { name: "probeRetainedLevelDeleteCompensation", resources,
        prepared: Result.getOrThrow(workflow.prepare()), input: InventoryLevelDeletionIds, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    registerCleanup(() => Effect.runPromise(host.close)); return host;
  };
  const seedMany = async (prefix: string, count = 5) => {
    const items = Array.from({ length: count }, (_, index) => prefix + "-item-" + index), location = prefix + "-location";
    for (const id of items) await common.nativeCreate({ id, sku: id + "-sku" });
    for (let offset = 0; offset < items.length; offset += 4) {
      const inventory_levels = items.slice(offset, offset + 4).map(inventory_item_id => ({ inventory_item_id, stocked_quantity: 0, location_id: location }));
      await Effect.runPromise(common.stocking.run(common.stocking.newRequestKey(), { locations: offset === 0 ? [{ id: location, name: location }] : [], inventory_levels }));
    }
    return { items, location, pairs: items.map(inventory_item_id => ({ inventory_item_id, location_id: location })), levels: await common.probeCohort(items) };
  };
  const setQuantities = (pairs: readonly Readonly<{ inventory_item_id: string; location_id: string }>[], stocked = 0, incoming = 0) =>
    common.nativeUpdate(pairs.map(pair => ({ ...pair, stocked_quantity: stocked, incoming_quantity: incoming })));
  const seedProtected = async (prefix: string) => {
    const graph = await common.seed(prefix, 1, true), addressId = prefix + "-retained-address", locationId = prefix + "-address-location";
    const result = await Effect.runPromise(common.stocking.run(common.stocking.newRequestKey(), { locations: [{ id: locationId, name: locationId,
      address: { id: addressId, address_1: "Retained street", country_code: "US", city: "Retained" } }], inventory_levels: [] }));
    if (result.locations[0]?.address_id !== addressId) throw new Error("Missing genuine retained Stock Location address");
    return graph;
  };
  return { ...common, deletion, options, prepare, prepareRestore, seedMany, setQuantities, seedProtected,
    nativeDelete: (ids: readonly string[]) => native.run(native.newRequestKey(), softDelete, [...ids]),
    nativeRestore: (ids: readonly string[]) => native.run(native.newRequestKey(), restore, [...ids]),
    prepareUpdate: common.prepare };
}
