import { randomUUID } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createRemoteLinkStep } from "@medusajs/core-flows/common/create-remote-links-step";
import type { InventoryModuleService } from "@medusajs/inventory/services";
import { coreNativeRelationalRow } from "../../../persistence-postgres/src/core/nativeRelationalQuery";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import { compileInventoryCoreDefinition } from "../../src/modules/inventory/schema";
import { compileStockLocationCoreDefinition } from "../../src/modules/stock-location/schema";
import { compileProductCoreDefinition } from "../../src/modules/product/schema";
import { compilePricingCoreDefinition } from "../../src/modules/pricing/schema";
import { compileVariantLinksCoreDefinition } from "../../src/links/variant-definition";
import { makeLocalInventoryCommands } from "../../src/modules/inventory/service";
import { makeStockLocationCommands } from "../../src/modules/stock-location/service";
import { makeLocalProductCommands } from "../../src/modules/product/service";
import { makeLocalPricingCommands } from "../../src/modules/pricing/service";
import { prepareLocalVariantLinks, VariantInventoryLinkBatch } from "../../src/links/variant-service";
import { InventoryItemInput } from "../../src/modules/inventory/item-input";
import { prepareInventoryStockingWorkflow } from "../../src/workflows/inventory/stock";
import { prepareCreateReservationWorkflow } from "../../src/workflows/inventory/adjust-and-reserve";
import { prepareAtomicWorkflowHost, type InstalledWorkflowModule } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { createCoreNativeWorkflowFixture, shareCoreNativeWorkflowPhysical,
  type CoreNativeWorkflowFixtureOptions, type CoreNativeWorkflowSource } from "./core-native-workflow-fixture";
import { openCoreProductReadHost, prepareCoreInventoryCreateHost } from "./core-product-creation-fixture";

export interface CoreInventoryMaintenanceShared extends Pick<CoreNativeWorkflowFixtureOptions,
  "physical" | "wrapPersistence" | "maximumRequests"> {
  readonly target?: Readonly<{ scopeUuid: string; epochUuid: string }>;
  readonly includeGraph?: boolean;
}
const linkSeed = createWorkflow("seed-item-update-links", (input: WorkflowData<typeof VariantInventoryLinkBatch.Type>) =>
  new WorkflowResponse(createRemoteLinkStep(input)));
const DeletionIds = Schema.Array(Schema.String).pipe(Schema.mutable);
const seedDeletionStep = createStep({ name: "seed-item-update-deletion", compensation: "transactionCovered" }, async (ids: string[], { container }) => {
  const inventory = container.resolve<Pick<InventoryModuleService, "softDeleteInventoryItems">>("inventory");
  await inventory.softDeleteInventoryItems(ids); return new StepResponse(null);
});
const deletionSeed = createWorkflow("seed-item-update-deleted-target", (input: WorkflowData<typeof DeletionIds.Type>) => new WorkflowResponse(seedDeletionStep(input)));

/** Genuine native producers and commands share one Core bundle and app owner.
 * Neighboring Product/Pricing/Link sources are selected only by graph consumers. */
export async function prepareCoreInventoryMaintenance(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  options: CoreInventoryMaintenanceShared = {}) {
  const target = Object.freeze({ scopeUuid: options.target?.scopeUuid ?? randomUUID(), epochUuid: options.target?.epochUuid ?? randomUUID() });
  const inventoryRuntime = await Effect.runPromise(makeLocalInventoryCommands("stock"));
  const stockRuntime = await Effect.runPromise(makeStockLocationCommands("create"));
  const inventoryDefinition = await Effect.runPromise(compileInventoryCoreDefinition(target));
  const stockDefinition = await Effect.runPromise(compileStockLocationCoreDefinition(target));
  const neighboring = options.includeGraph === true ? {
    productRuntime: await Effect.runPromise(makeLocalProductCommands()),
    pricingRuntime: await Effect.runPromise(makeLocalPricingCommands()),
    linkRuntime: await Effect.runPromise(prepareLocalVariantLinks()),
    productDefinition: await Effect.runPromise(compileProductCoreDefinition(target)),
    pricingDefinition: await Effect.runPromise(compilePricingCoreDefinition(target)),
    linkDefinition: await Effect.runPromise(compileVariantLinksCoreDefinition(target)),
  } : undefined;
  const sources: readonly CoreNativeWorkflowSource[] = [
    { name: "inventory", definition: inventoryDefinition, initialCommands: inventoryRuntime.commands, rows: [] },
    { name: "stock_location", definition: stockDefinition, initialCommands: stockRuntime.commands, rows: [] },
    ...(neighboring === undefined ? [] : [
      { name: "product", definition: neighboring.productDefinition, initialCommands: Object.values(neighboring.productRuntime.commands), rows: [] },
      { name: "pricing", definition: neighboring.pricingDefinition, initialCommands: neighboring.pricingRuntime.commands, rows: [] },
      { name: "variant_links", definition: neighboring.linkDefinition, initialCommands: neighboring.linkRuntime.commands, rows: [] },
    ]),
  ];
  const eventDefinition = await Effect.runPromise(compileCoreNativeEventStorageDefinition(target));
  const physical = options.physical === undefined ? undefined : await shareCoreNativeWorkflowPhysical(options.physical);
  const fixture = await createCoreNativeWorkflowFixture(driver, { sources, eventDefinition,
    ...(physical === undefined ? {} : { physical }),
    ...(options.wrapPersistence === undefined ? {} : { wrapPersistence: options.wrapPersistence }),
    ...(options.maximumRequests === undefined ? {} : { maximumRequests: options.maximumRequests }) });
  close(fixture.close);
  const inventoryReads = await openCoreProductReadHost(fixture, "inventory", inventoryRuntime.commands);
  const stockReads = await openCoreProductReadHost(fixture, "stock_location", stockRuntime.commands);
  for (const host of [inventoryReads, stockReads]) close(() => Effect.runPromise(host.close));
  const members = {
    inventory: { definition: inventoryDefinition, runtime: inventoryRuntime, source: fixture.source("inventory"), reads: inventoryReads, host: inventoryReads },
    stockLocation: { definition: stockDefinition, runtime: stockRuntime, source: fixture.source("stock_location"), reads: stockReads, host: stockReads },
  };
  const graphMembers = neighboring === undefined ? undefined : {
    product: { definition: neighboring.productDefinition, runtime: neighboring.productRuntime, source: fixture.source("product"),
      reads: await openCoreProductReadHost(fixture, "product", Object.values(neighboring.productRuntime.commands)) },
    pricing: { definition: neighboring.pricingDefinition, runtime: neighboring.pricingRuntime, source: fixture.source("pricing"),
      reads: await openCoreProductReadHost(fixture, "pricing", neighboring.pricingRuntime.commands) },
    link: { definition: neighboring.linkDefinition, runtime: neighboring.linkRuntime, source: fixture.source("variant_links"),
      reads: await openCoreProductReadHost(fixture, "variant_links", neighboring.linkRuntime.commands) },
  };
  if (graphMembers !== undefined) for (const member of Object.values(graphMembers)) close(() => Effect.runPromise(member.reads.close));
  const graph = () => {
    if (graphMembers === undefined) throw new Error("Inventory neighboring graph was not selected");
    return graphMembers;
  };
  const execution = fixture.execution;
  const inventory: InstalledWorkflowModule<typeof inventoryRuntime.workflow> = {
    module: inventoryRuntime.workflow, nativeStorage: members.inventory.source };
  const subscribers = [{ id: "inventory-item-update-test", revision: "5".repeat(64) }];
  const stocking = await Effect.runPromise(prepareInventoryStockingWorkflow({ execution, revision: "1".repeat(64), subscribers, modules: {
    inventory, stock_location: { module: stockRuntime.workflow, nativeStorage: members.stockLocation.source } } }));
  const reservations = await Effect.runPromise(prepareCreateReservationWorkflow({ execution, inventory, revision: "2".repeat(64), subscribers }));
  for (const host of [stocking, reservations]) close(() => Effect.runPromise(host.close));
  const links = graphMembers === undefined ? undefined : await Effect.runPromise(prepareAtomicWorkflowHost({ execution,
    revision: "3".repeat(64), subscribers, modules: { link: { module: graphMembers.link.runtime.workflow, nativeStorage: graphMembers.link.source } },
    workflow: { name: "seedInventoryItemUpdateLinks", resources: Result.getOrThrow(prepareWorkflowResources({
      link: { module: graphMembers.link.runtime.workflow, methods: ["create"], graph: false } }, true)),
    prepared: Result.getOrThrow(linkSeed.prepare()), input: VariantInventoryLinkBatch,
    output: VariantInventoryLinkBatch, events: internalModuleWorkflowEvents } }));
  if (links !== undefined) close(() => Effect.runPromise(links.close));
  const deletion = await Effect.runPromise(makeLocalInventoryCommands("product-deletions"));
  const deleter = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, revision: "4".repeat(64), subscribers,
    modules: { inventory: { module: deletion.workflow, nativeStorage: members.inventory.source } },
    workflow: { name: "seedInventoryItemUpdateDeletion", resources: Result.getOrThrow(prepareWorkflowResources({
      inventory: { module: deletion.workflow, methods: ["softDeleteInventoryItems"], graph: false } }, true)),
    prepared: Result.getOrThrow(deletionSeed.prepare()), input: DeletionIds,
    output: Schema.Null, events: internalModuleWorkflowEvents } }));
  close(() => Effect.runPromise(deleter.close));
  const nativeCreate = async (input: typeof InventoryItemInput.Type) => {
    const creator = await prepareCoreInventoryCreateHost(fixture, members.inventory);
    try { return await Effect.runPromise(creator.host.run(creator.host.newRequestKey(), creator.create, input)); }
    finally { await Effect.runPromise(creator.host.close); }
  };
  const seed = async (prefix: string, count = 1, connected = false) => {
    const ids = Array.from({ length: count }, (_, index) => prefix + "-" + index);
    const creator = await prepareCoreInventoryCreateHost(fixture, members.inventory);
    try { await Effect.runPromise(creator.host.run(creator.host.newRequestKey(), creator.create, ids.map((id, index) => ({ id,
      sku: id + "-sku", title: "Before " + index, description: "Original", weight: 1, length: 2, height: 3, width: 4,
      metadata: { keep: id, drop: "old", nested: { before: index } } })))); }
    finally { await Effect.runPromise(creator.host.close); }
    if (connected) {
      if (links === undefined) throw new Error("Connected Inventory seeding requires its actual neighboring graph");
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
  const preserveTables = async (names: readonly string[]) => {
    const selected = new Set(sources.flatMap(source => source.definition.tables.filter(table => names.includes(table.localName ?? table.name)).map(table => table.name)));
    return (await fixture.snapshot()).rows.filter(row => selected.has(row.table));
  };
  const readTable = async (sourceName: string, tableName: string) => {
    const source = sources.find(source => source.name === sourceName);
    const table = source?.definition.tables.find(table => (table.localName ?? table.name) === tableName);
    if (table === undefined) throw new Error("Unknown Inventory fixture table: " + sourceName + "/" + tableName);
    return (await fixture.inventory()).rows.filter(row => row.table === table.name)
      .map(row => structuredClone(Result.getOrThrow(coreNativeRelationalRow(row.value))));
  };
  return { fixture, target, members, graph, execution, inventory, stocking, reservations, links, seed, nativeCreate,
    preserveTables, readTable, snapshot: fixture.snapshot,
    remove: (ids: string[]) => deleter.run(deleter.newRequestKey(), ids) };
}
