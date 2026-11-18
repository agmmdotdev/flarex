import { createHash, randomUUID } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { deleteStockLocationsWorkflow } from "@medusajs/core-flows/stock-location/delete-stock-locations";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import { stockLocationDeletionResources, stockLocationDeletionCommandMs } from "../../src/workflow/policy";
import { makeFulfillmentSetDeletionCommands } from "../../src/modules/fulfillment/fulfillment-set-delete-service";
import { makeLocalPricingCommands } from "../../src/modules/pricing/service";
import { compilePricingCoreDefinition } from "../../src/modules/pricing/schema";
import { makeStockLocationCommands } from "../../src/modules/stock-location/service";
import { compileStockLocationCoreDefinition } from "../../src/modules/stock-location/schema";
import { makeLocalSalesChannelCommands } from "../../src/modules/sales-channel/service";
import { compileSalesChannelCoreDefinition } from "../../src/modules/sales-channel/schema";
import { compileSalesChannelLocationLinkCoreDefinition } from "../../src/links/sales-channel-location-schema";
import { makeLocalInventoryCommands } from "../../src/modules/inventory/service";
import { compileInventoryCoreDefinition } from "../../src/modules/inventory/schema";
import { compileStoreCoreDefinition } from "../../src/modules/store/schema";
import { makeStoreGuardCommands } from "../../src/modules/store/service";
import { compileServiceZoneCreationCoreDefinition } from "../../src/modules/fulfillment/shipping-profile-schema";
import { compileLocationFulfillmentSetLinkCoreDefinition } from "../../src/links/location-fulfillment-set-schema";
import { compileLocationFulfillmentProviderLinkCoreDefinition } from "../../src/links/location-fulfillment-provider-schema";
import { compileShippingOptionPriceSetLinkCoreDefinition } from "../../src/links/shipping-option-price-set-schema";
import { prepareStockLocationDeletionLinks } from "../../src/links/stock-location-deletion";
import { prepareStockLocationDeletionWorkflow, StockLocationDeletionInput } from "../../src/workflows/stock-location/delete";
import { prepareCreateReservationWorkflow } from "../../src/workflows/inventory/adjust-and-reserve";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { fulfillmentForestRows, fulfillmentSetDeletionGraph } from "./native-fulfillment-graph-fixture";
import { createCoreNativeWorkflowFixture, shareCoreNativeWorkflowPhysical } from "./core-native-workflow-fixture";
import { prepareCoreSalesChannelLocationHosts } from "./core-sales-channel-location-fixture";

const revision = (name: string) => createHash("sha256").update(name).digest("hex");
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(Schema.JsonObject));
const deletion = Result.getOrThrow(deleteStockLocationsWorkflow.prepare());
function nativeCompensator(name: string) {
  const node = deletion.nodes.find(node => node.name === name);
  if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
    throw new Error("Missing retained native Stock Location compensator " + name);
  return node.compensate;
}
const restoreLocations = nativeCompensator("delete-stock-locations-step"), restoreLinks = nativeCompensator("remove-remote-links");

/** Ten genuine native sources share Core's one installation, app owner and
 * finalizer. The deletion root grants exactly seven modules; Store/Inventory
 * remain initial data unless a separate trusted seed workflow selects them. */
export async function prepareCoreStockLocationDeletion(
  driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  shared?: Readonly<{ physical: CorePersistenceFixture }>,
  graphs: readonly ReturnType<typeof fulfillmentSetDeletionGraph>[] = [],
) {
  const target = Object.freeze({ scopeUuid: randomUUID(), epochUuid: randomUUID() });
  const definitions = {
    stock: await Effect.runPromise(compileStockLocationCoreDefinition(target)),
    sales: await Effect.runPromise(compileSalesChannelCoreDefinition(target)),
    salesLinks: await Effect.runPromise(compileSalesChannelLocationLinkCoreDefinition(target)),
    store: await Effect.runPromise(compileStoreCoreDefinition(target)),
    fulfillment: await Effect.runPromise(compileServiceZoneCreationCoreDefinition(target)),
    fulfillmentLinks: await Effect.runPromise(compileLocationFulfillmentSetLinkCoreDefinition(target)),
    providerLinks: await Effect.runPromise(compileLocationFulfillmentProviderLinkCoreDefinition(target)),
    priceSetLinks: await Effect.runPromise(compileShippingOptionPriceSetLinkCoreDefinition(target)),
    pricing: await Effect.runPromise(compilePricingCoreDefinition(target)),
    inventory: await Effect.runPromise(compileInventoryCoreDefinition(target)),
  };
  const stock = await Effect.runPromise(makeStockLocationCommands("delete"));
  const reader = await Effect.runPromise(makeStockLocationCommands("update"));
  const fulfillment = await Effect.runPromise(makeFulfillmentSetDeletionCommands());
  const pricing = await Effect.runPromise(makeLocalPricingCommands("shipping-options"));
  const links = await Effect.runPromise(prepareStockLocationDeletionLinks(fulfillment.workflow, pricing.workflow));
  const inventory = await Effect.runPromise(makeLocalInventoryCommands("stock"));
  const sales = await Effect.runPromise(makeLocalSalesChannelCommands());
  const storeInitialization = await Effect.runPromise(makeStoreGuardCommands());
  const storeRows = [{ table: "store", row: { id: "stock-delete-store", name: "Store with default Location",
    default_location_id: "stock-delete-maximum-location-0", default_sales_channel_id: null, default_region_id: null,
    metadata: { retained: true }, created_at: "2026-10-16T00:00:00.000Z", updated_at: "2026-10-16T00:00:00.000Z", deleted_at: null } }];
  const eventDefinition = await Effect.runPromise(compileCoreNativeEventStorageDefinition(target));
  const fixture = await createCoreNativeWorkflowFixture(driver, { eventDefinition,
    ...(shared === undefined ? {} : { physical: await shareCoreNativeWorkflowPhysical(shared.physical) }), sources: [
      { name: "stock_location", definition: definitions.stock, initialCommands: reader.commands, rows: [] },
      { name: "sales_channel", definition: definitions.sales, initialCommands: sales.commands, rows: [] },
      { name: "sales_channel_location_links", definition: definitions.salesLinks, initialCommands: links.location.commands, rows: [] },
      { name: "store", definition: definitions.store, initialCommands: storeInitialization.commands, rows: storeRows },
      { name: "fulfillment", definition: definitions.fulfillment, initialCommands: fulfillment.commands, rows: fulfillmentForestRows(graphs, false) },
      { name: "location_fulfillment_set_links", definition: definitions.fulfillmentLinks, initialCommands: links.fulfillmentSet.commands, rows: graphs.flatMap(graph => graph.links) },
      { name: "providerLinks", initializationStepId: "provider-links-initial", definition: definitions.providerLinks, initialCommands: links.provider.commands, rows: graphs.flatMap(graph => graph.shipping?.providerLinks ?? []) },
      { name: "priceSetLinks", initializationStepId: "price-set-links-initial", definition: definitions.priceSetLinks, initialCommands: links.priceSet.commands, rows: graphs.flatMap(graph => graph.shipping?.priceSetLinks ?? []) },
      { name: "pricing", definition: definitions.pricing, initialCommands: pricing.commands, rows: graphs.flatMap(graph => graph.shipping?.pricingRows ?? []) },
      { name: "inventory", definition: definitions.inventory, initialCommands: inventory.commands, rows: [] },
    ] });
  close(fixture.close);
  const endpoints = await prepareCoreSalesChannelLocationHosts(fixture, close);
  const stockReader = await fixture.run(fixture.openReadHost("stock_location", [reader.list, reader.listAddresses]));
  const locfs = await fixture.run(fixture.openReadHost("location_fulfillment_set_links", [links.fulfillmentSet.nativeService.list]));
  const provider = await fixture.run(fixture.openReadHost("providerLinks", [links.provider.nativeService.list]));
  const priceSet = await fixture.run(fixture.openReadHost("priceSetLinks", [links.priceSet.nativeService.list]));
  for (const host of [stockReader, locfs, provider, priceSet]) close(() => Effect.runPromise(host.close));
  const execution = fixture.execution;
  const modules = {
    stock_location: { module: stock.workflow, nativeStorage: fixture.source("stock_location") },
    sales_channel_location_links: { module: links.location.workflow, nativeStorage: fixture.source("sales_channel_location_links") },
    location_fulfillment_set_links: { module: links.fulfillmentSet.workflow, nativeStorage: fixture.source("location_fulfillment_set_links") },
    fulfillment: { module: fulfillment.workflow, nativeStorage: fixture.source("fulfillment") },
    providerLinks: { module: links.provider.workflow, nativeStorage: fixture.source("providerLinks") },
    priceSetLinks: { module: links.priceSet.workflow, nativeStorage: fixture.source("priceSetLinks") },
    pricing: { module: pricing.workflow, nativeStorage: fixture.source("pricing"), logicalPublication: "mixed" as const },
  } satisfies Parameters<typeof prepareStockLocationDeletionWorkflow>[0]["modules"];
  const options = { execution, modules, link: links.resource, revision: revision("native-stock-location-delete-114"),
    subscribers: [{ id: "native-stock-location-deletion", revision: "a".repeat(64) }] };
  const prepare = async (selectedRevision = options.revision, linkRows?: 8) => {
    const host = await Effect.runPromise(prepareStockLocationDeletionWorkflow({ ...options, revision: selectedRevision,
      modules: { ...modules, sales_channel_location_links: { ...modules.sales_channel_location_links,
        ...(linkRows === undefined ? {} : { logicalResources: stockLocationDeletionResources }) } },
    }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const resources = Result.getOrThrow(prepareWorkflowResources({
    stock_location: { module: stock.workflow, methods: ["softDeleteStockLocations", "restoreStockLocations"], graph: false },
    sales_channel_location_links: { module: links.location.workflow, methods: ["softDelete", "restore"], graph: false, expose: false },
    location_fulfillment_set_links: { module: links.fulfillmentSet.workflow, methods: ["softDelete", "restore"], graph: false, expose: false },
    fulfillment: { module: fulfillment.workflow, methods: ["softDeleteFulfillmentSets", "restoreFulfillmentSets"], graph: false, expose: false },
    providerLinks: { module: links.provider.workflow, methods: ["softDelete", "restore"], graph: false, expose: false },
    priceSetLinks: { module: links.priceSet.workflow, methods: ["softDelete", "restore"], graph: false, expose: false },
    pricing: { module: pricing.workflow, methods: ["softDeletePriceSets", "restorePriceSets"], graph: false, expose: false },
  }, true, { link: links.resource }));
  const prepareRestore = async () => {
    const restore = createStep("invoke-retained-stock-location-compensators", resources.callback(async (input: typeof StockLocationDeletionInput.Type, context) => {
      await restoreLocations([...input.ids], context);
      await restoreLinks({ stock_location: input.ids.length === 0 ? {} : { stock_location_id: [...input.ids], location_id: [...input.ids] } }, context);
      return new StepResponse(null);
    }));
    const workflow = createWorkflow("probe-retained-stock-location-compensation", (input: WorkflowData<typeof StockLocationDeletionInput.Type>) => new WorkflowResponse(restore(input)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution,
      modules: Object.fromEntries(Object.entries(modules).map(([name, value]) => [name, { ...value, logicalResources: stockLocationDeletionResources }])),
      operationScheduling: "queued", requestCallLimit: stockLocationDeletionResources.calls, requestEventLimit: stockLocationDeletionResources.eventMessages,
      requestByteLimit: stockLocationDeletionResources.commandBytes, requestCommandMs: stockLocationDeletionCommandMs,
      revision: revision("retained-stock-location-compensation-probe"), subscribers: options.subscribers,
      workflow: { name: "probeRetainedStockLocationCompensation", resources, prepared: Result.getOrThrow(workflow.prepare()),
        input: StockLocationDeletionInput, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareRoundtrip = async (retained: () => { readonly stock: unknown; readonly link: unknown }, lateFailure?: Error,
    limits: Readonly<{ calls: number; eventMessages: number; commandBytes?: number }> = stockLocationDeletionResources) => {
    const inverse = createStep("invoke-actual-stock-location-retained-inverses", resources.callback(async (_value: null, context) => {
      const actual = retained(); await restoreLinks(actual.link, context); await restoreLocations(actual.stock, context);
      if (lateFailure !== undefined) throw lateFailure;
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-installed-stock-location-root-roundtrip", (value: WorkflowData<typeof StockLocationDeletionInput.Type>) => {
      const result = deleteStockLocationsWorkflow.runAsStep({ input: transform(value, current => ({ ids: [...current.ids] })) });
      return new WorkflowResponse(inverse(transform(result, () => null)));
    });
    const selected = { ...stockLocationDeletionResources, ...limits };
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution,
      modules: Object.fromEntries(Object.entries(modules).map(([name, value]) => [name, { ...value, logicalResources: selected }])),
      operationScheduling: "queued", requestCallLimit: selected.calls, requestEventLimit: selected.eventMessages,
      requestByteLimit: selected.commandBytes, requestCommandMs: stockLocationDeletionCommandMs,
      revision: revision("installed-stock-location-retained-roundtrip"), subscribers: options.subscribers,
      workflow: { name: "probeInstalledStockLocationRootRoundtrip", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: StockLocationDeletionInput, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const seed = async (prefix: string, count = 1, channelsPerLocation = 1) => {
    const locations = Array.from({ length: count }, (_, index) => prefix + "-location-" + index);
    const channels = Array.from({ length: channelsPerLocation }, (_, index) => prefix + "-channel-" + index);
    for (let offset = 0; offset < Math.max(locations.length, channels.length); offset += 4)
      await Effect.runPromise(endpoints.seed.run(endpoints.seed.newRequestKey(), {
        channels: channels.slice(offset, offset + 4).map(id => ({ id, name: id })),
        locations: locations.slice(offset, offset + 4).map((id, index) => ({ id, name: id,
          address: { id: id + "-address", address_1: "Street " + index, country_code: "US", city: "Retained" }, metadata: { retained: true } })),
      }));
    for (const id of locations) for (let offset = 0; offset < channels.length; offset += 4)
      await Effect.runPromise(endpoints.workflow.run(endpoints.workflow.newRequestKey(), { id, add: channels.slice(offset, offset + 4) }));
    return { locations, channels };
  };
  const attach = async (id: string, channels: readonly string[]) => {
    for (let offset = 0; offset < channels.length; offset += 4)
      await Effect.runPromise(endpoints.workflow.run(endpoints.workflow.newRequestKey(), { id, add: channels.slice(offset, offset + 4) }));
  };
  const detach = async (id: string, channels: readonly string[]) => {
    for (let offset = 0; offset < channels.length; offset += 4)
      await Effect.runPromise(endpoints.workflow.run(endpoints.workflow.newRequestKey(), { id, remove: channels.slice(offset, offset + 4) }));
  };
  const seedProtectedInventory = async (locationId: string) => {
    const resources = Result.getOrThrow(prepareWorkflowResources({ inventory: { module: inventory.workflow,
      methods: ["createInventoryItems", "createInventoryLevels"], graph: false } }, true));
    const step = createStep("seed-retained-inventory", resources.callback(async (id: string, { resources }) => {
      await resources.inventory.createInventoryItems([{ id: id + "-item", sku: id + "-sku" }]);
      await resources.inventory.createInventoryLevels([{ inventory_item_id: id + "-item", location_id: id, stocked_quantity: 10 }]);
      return new StepResponse(null);
    }));
    const workflow = createWorkflow("seed-stock-location-deletion-inventory", (input: WorkflowData<string>) => new WorkflowResponse(step(input)));
    const module = { module: inventory.workflow, nativeStorage: fixture.source("inventory") };
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules: { inventory: module },
      revision: revision("stock-delete-inventory-seed"), subscribers: options.subscribers,
      workflow: { name: "seedStockLocationDeletionInventory", resources, prepared: Result.getOrThrow(workflow.prepare()),
        input: Schema.String, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    try { await Effect.runPromise(host.run(host.newRequestKey(), locationId)); } finally { await Effect.runPromise(host.close); }
    const reserve = await Effect.runPromise(prepareCreateReservationWorkflow({ execution, inventory: module,
      revision: revision("stock-delete-inventory-reservation"), subscribers: options.subscribers }));
    try { return await Effect.runPromise(reserve.run(reserve.newRequestKey(), {
      reservations: [{ inventory_item_id: locationId + "-item", location_id: locationId, quantity: 2 }],
    })); } finally { await Effect.runPromise(reserve.close); }
  };
  const readLocations = (ids: readonly string[], withDeleted = false) => Effect.runPromise(stockReader.read(reader.list,
    { filters: { id: [...ids] }, config: { withDeleted, order: { id: "ASC" } } }).pipe(Effect.flatMap(decodeRows)));
  const readAddresses = (ids: readonly string[]) => Effect.runPromise(stockReader.read(reader.listAddresses,
    { filters: { id: [...ids] }, config: { order: { id: "ASC" } } }).pipe(Effect.flatMap(decodeRows)));
  const readLinks = (ids: readonly string[], withDeleted = false) => Effect.runPromise(endpoints.reader.read(endpoints.link.list,
    { filters: { stock_location_id: [...ids] }, config: { withDeleted, take: 256 } }).pipe(Effect.flatMap(decodeRows)));
  const readChannels = (ids: readonly string[]) => Effect.runPromise(endpoints.sales.host.read(endpoints.sales.runtime.list,
    { filters: { id: [...ids] }, config: { withDeleted: true, take: 256, order: { id: "ASC" } } }).pipe(Effect.flatMap(decodeRows)));
  const readSetLinks = (ids: readonly string[], withDeleted = false) => Effect.runPromise(locfs.read(links.fulfillmentSet.nativeService.list,
    { filters: { stock_location_id: [...ids] }, config: { withDeleted, take: 256 } }).pipe(Effect.flatMap(decodeRows)));
  const readProviderLinks = (ids: readonly string[], withDeleted = false) => Effect.runPromise(provider.read(links.provider.nativeService.list,
    { filters: { stock_location_id: [...ids] }, config: { withDeleted, take: 256 } }).pipe(Effect.flatMap(decodeRows)));
  const readPriceSetLinks = (ids: readonly string[], withDeleted = false) => Effect.runPromise(priceSet.read(links.priceSet.nativeService.list,
    { filters: { shipping_option_id: [...ids] }, config: { withDeleted, take: 256 } }).pipe(Effect.flatMap(decodeRows)));
  const readFulfillment = async (ids: readonly string[]) => {
    const selected = new Set(ids);
    return (await fixture.readRows()).filter(row => typeof row.id === "string" && selected.has(row.id));
  };
  return { fixture, definitions, resources, prepareRoundtrip, readSetLinks, readFulfillment,
    readProviderLinks, readPriceSetLinks, stock, fulfillment, pricing, links, options, execution, prepare, prepareRestore, seed, attach, detach, seedProtectedInventory,
    readLocations, readAddresses, readLinks, readChannels, snapshot: () => fixture.snapshot() };
}
