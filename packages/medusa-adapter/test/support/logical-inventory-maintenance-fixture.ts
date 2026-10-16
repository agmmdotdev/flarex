import { Effect, Schema } from "effect";
import { and, eq } from "drizzle-orm";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createRemoteLinkStep } from "@medusajs/core-flows/common/create-remote-links-step";
import type { InventoryModuleService } from "@medusajs/inventory/services";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { fxControlTables, fxAppRowCurrent } from "../../../persistence-postgres/src/database/schema";
import { makeLocalInventoryCommands } from "../../src/modules/inventory/service";
import { InventoryItemInput } from "../../src/modules/inventory/item-input";
import { VariantInventoryLinkBatch } from "../../src/links/variant-service";
import { prepareInventoryStockingWorkflow } from "../../src/workflows/inventory/stock";
import { prepareCreateReservationWorkflow } from "../../src/workflows/inventory/adjust-and-reserve";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./logical-currency-fixture";
import { prepareLogicalInventoryHosts, prepareInventoryCreateHost } from "./logical-inventory-fixture";

export type LogicalInventoryMaintenanceShared = Readonly<{ resource: LogicalCurrencyFixture["resource"];
  fixtureIdentity: Readonly<{ deploymentId: string; projectId: string; uuidOffset: number }> }>;
const linkSeed = createWorkflow("seed-item-update-links", (input: WorkflowData<typeof VariantInventoryLinkBatch.Type>) =>
  new WorkflowResponse(createRemoteLinkStep(input)));
const DeletionIds = Schema.Array(Schema.String).pipe(Schema.mutable);
const seedDeletionStep = createStep({ name: "seed-item-update-deletion", compensation: "transactionCovered" }, async (ids: string[], { container }) => {
  const inventory = container.resolve<Pick<InventoryModuleService, "softDeleteInventoryItems">>("inventory");
  await inventory.softDeleteInventoryItems(ids); return new StepResponse(null);
});
const deletionSeed = createWorkflow("seed-item-update-deleted-target", (input: WorkflowData<typeof DeletionIds.Type>) => new WorkflowResponse(seedDeletionStep(input)));

/** Shared seed/read topology for Item and Level maintenance. All writes invoke
 * the existing native module/workflow owners; no storage or business algorithm
 * is reproduced. Product/Pricing definitions satisfy the installed Link graph. */
export async function prepareLogicalInventoryMaintenance(driver: "pglite" | "postgres", registerCleanup: (close: () => Promise<void>) => void,
  shared?: LogicalInventoryMaintenanceShared) {
  const fixture = shared === undefined
    ? await logicalCurrencyFixture(driver, registerCleanup, { includeProduct: true, includePricing: true, includeVariantInventory: true })
    : await logicalCurrencyFixture(driver, registerCleanup, { includeProduct: true, includePricing: true, includeVariantInventory: true, ...shared });
  const members = await prepareLogicalInventoryHosts(fixture, { stock: true, stockLocations: true });
  const deletion = await Effect.runPromise(makeLocalInventoryCommands("product-deletions"));
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const inventory: InstalledWorkflowModule<typeof members.inventory.runtime.workflow> = {
    module: members.inventory.runtime.workflow, logicalStorage: members.inventory.hostInput.logicalStorage };
  const subscribers = [{ id: "inventory-item-update-test", revision: "5".repeat(64) }];
  const stocking = await Effect.runPromise(prepareInventoryStockingWorkflow({ execution, revision: "1".repeat(64), subscribers, modules: {
    inventory, stock_location: { module: members.stockLocation.runtime.workflow, logicalStorage: members.stockLocation.hostInput.logicalStorage } } }));
  const reservations = await Effect.runPromise(prepareCreateReservationWorkflow({ execution, inventory, revision: "2".repeat(64), subscribers }));
  for (const host of [stocking, reservations]) registerCleanup(() => Effect.runPromise(host.close));
  const links = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, revision: "3".repeat(64), subscribers,
    modules: { link: { module: members.link.runtime.workflow, logicalStorage: members.link.hostInput.logicalStorage } },
    workflow: { name: "seedInventoryItemUpdateLinks", resources: await Effect.runPromise(Effect.fromResult(prepareWorkflowResources({
      link: { module: members.link.runtime.workflow, methods: ["create"], graph: false } }, true))),
    prepared: await Effect.runPromise(Effect.fromResult(linkSeed.prepare())), input: VariantInventoryLinkBatch,
    output: VariantInventoryLinkBatch, events: internalModuleWorkflowEvents } }));
  const deleter = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, revision: "4".repeat(64), subscribers,
    modules: { inventory: { module: deletion.workflow, logicalStorage: members.inventory.hostInput.logicalStorage } },
    workflow: { name: "seedInventoryItemUpdateDeletion", resources: await Effect.runPromise(Effect.fromResult(prepareWorkflowResources({
      inventory: { module: deletion.workflow, methods: ["softDeleteInventoryItems"], graph: false } }, true))),
    prepared: await Effect.runPromise(Effect.fromResult(deletionSeed.prepare())), input: DeletionIds,
    output: Schema.Null, events: internalModuleWorkflowEvents } }));
  for (const host of [links, deleter]) registerCleanup(() => Effect.runPromise(host.close));
  const nativeCreate = async (input: typeof InventoryItemInput.Type) => {
    const creator = await prepareInventoryCreateHost(fixture, members.inventory);
    try { return await Effect.runPromise(creator.host.run(creator.host.newRequestKey(), creator.create, input)); }
    finally { await Effect.runPromise(creator.host.close); }
  };
  const seed = async (prefix: string, count = 1, connected = false) => {
    const ids = Array.from({ length: count }, (_, index) => prefix + "-" + index);
    const creator = await prepareInventoryCreateHost(fixture, members.inventory);
    try { await Effect.runPromise(creator.host.run(creator.host.newRequestKey(), creator.create, ids.map((id, index) => ({ id,
      sku: id + "-sku", title: "Before " + index, description: "Original", weight: 1, length: 2, height: 3, width: 4,
      metadata: { keep: id, drop: "old", nested: { before: index } } })))); }
    finally { await Effect.runPromise(creator.host.close); }
    if (connected) {
      const location = prefix + "-location";
      await Effect.runPromise(stocking.run(stocking.newRequestKey(), { locations: [{ id: location, name: location }],
        inventory_levels: ids.map(inventory_item_id => ({ inventory_item_id, location_index: 0, stocked_quantity: 10 })) }));
      const first = ids[0]; if (first === undefined) throw new Error("Connected Inventory seed needs an item");
      await Effect.runPromise(reservations.run(reservations.newRequestKey(), { reservations: [{ inventory_item_id: first,
        location_id: location, quantity: 2, metadata: { retained: "reservation" } }] }));
      await Effect.runPromise(links.run(links.newRequestKey(), ids.map((inventory_item_id, index) => ({
        product: { variant_id: prefix + "-unresolved-native-variant-" + index }, inventory: { inventory_item_id },
        data: { id: prefix + "-rich-link-" + index, required_quantity: index + 2 } }))));
    }
    return ids;
  };
  const preserved = async (names: readonly string[]) => {
    const tables = await fixture.control.drizzle.select().from(fxControlTables).where(and(eq(fxControlTables.deploymentId, fixture.deploymentId),
      eq(fxControlTables.namespace, "medusa")));
    const selected = new Set(tables.filter(table => names.some(name => table.logicalName.endsWith("/" + name))).map(table => table.tableId));
    return (await fixture.persistence.drizzle.select().from(fxAppRowCurrent).orderBy(fxAppRowCurrent.tableId, fxAppRowCurrent.rowId)).filter(row => selected.has(row.tableId));
  };
  return { fixture, members, execution, inventory, stocking, reservations, links, seed, nativeCreate, preserved,
    remove: (ids: string[]) => deleter.run(deleter.newRequestKey(), ids) };
}