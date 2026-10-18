import { createHash } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import type { Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { deleteStockLocationsWorkflow } from "@medusajs/core-flows/stock-location/delete-stock-locations";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { makeStockLocationCommands } from "../../src/modules/stock-location/service";
import { makeLocalInventoryCommands } from "../../src/modules/inventory/service";
import { compileInventoryDefinition } from "../../src/modules/inventory/schema";
import { prepareStockLocationDeletionLinks } from "../../src/links/stock-location-deletion";
import { prepareStockLocationDeletionWorkflow, StockLocationDeletionInput } from "../../src/workflows/stock-location/delete";
import { prepareCreateReservationWorkflow } from "../../src/workflows/inventory/adjust-and-reserve";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./logical-currency-fixture";
import { prepareLogicalSalesChannelLocation } from "./logical-sales-channel-location-fixture";

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

/** Genuine endpoint/Link seed owners are reused. Inventory is an installed
 * source without unrelated Product or Variant participants; Store has only
 * canonical initial data because this workflow deliberately grants no Store API. */
export async function prepareLogicalStockLocationDeletion(
  driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  shared?: Readonly<{ resource: LogicalCurrencyFixture["resource"];
    fixtureIdentity: Readonly<{ deploymentId: string; projectId: string; uuidOffset: number }> }>,
) {
  const inventoryDefinition = await Effect.runPromise(compileInventoryDefinition());
  const inventorySource = await Effect.runPromise(captureLogicalSchemaSource({ key: "medusa.inventory", owner: "medusa",
    writeProfile: "medusa.inventory", evidence: inventoryDefinition.provenance,
    definition: { kind: "relational", schema: inventoryDefinition.schema },
    bindings: inventoryDefinition.schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
      table: { namespace: "medusa", logicalName: `${inventoryDefinition.schema.coordinate.lineageId}/${table.identity.tableId}` } })),
  }));
  const configuration = { includeSalesChannel: true, includeStockLocation: true,
    includeSalesChannelLocationLink: true, includeStore: true, additionalSources: [inventorySource] };
  const fixture = await logicalCurrencyFixture(driver, close, shared === undefined ? configuration : { ...configuration, ...shared });
  const endpoints = await prepareLogicalSalesChannelLocation(fixture, close);
  const stock = await Effect.runPromise(makeStockLocationCommands("delete"));
  const reader = await Effect.runPromise(makeStockLocationCommands("update"));
  const links = await Effect.runPromise(prepareStockLocationDeletionLinks());
  const inventory = await Effect.runPromise(makeLocalInventoryCommands("stock"));
  const stockDefinition = fixture.stockLocationDefinition, storeDefinition = fixture.storeDefinition;
  if (stockDefinition === undefined || storeDefinition === undefined) throw new Error("Missing Stock Location/Store sources");
  const dataset = (rows: Json) => Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows }, 1_048_576,
    { invalidInput: () => new Error("Invalid Stock Location deletion initialization"),
      hashFailure: cause => new Error("Stock Location deletion initialization hash", { cause }) }));
  const empty = await dataset([]);
  const inputFor = (key: string, definition: typeof stockDefinition, commands: LogicalCommerceHostInput<unknown>["commands"]) => ({
    ...fixture.hostInput, identityAndAccessPolicy: { profile: key + ".stock-location-delete-test" }, commands,
    logicalStorage: { ...fixture.hostInput.logicalStorage,
      source: { sourceKey: key, writeProfile: key, schema: definition.schema, evidence: definition.provenance },
      initialization: { stepId: key.toLowerCase() + ".empty", datasetSha256: empty.sha256Hex, expectedRowCount: 0 } },
  } satisfies LogicalCommerceHostInput<unknown>);
  const stockInput = inputFor("medusa.stockLocation", stockDefinition, reader.commands);
  const stockReader = await Effect.runPromise(makeCommerceHost(stockInput));
  close(() => Effect.runPromise(stockReader.close));
  const inventoryInput = inputFor("medusa.inventory", inventoryDefinition, inventory.commands);
  const initializer = await Effect.runPromise(makeCommerceHost(inventoryInput));
  try { await Effect.runPromise(initializer.initialize([])); } finally { await Effect.runPromise(initializer.close); }
  const storeRows = [{ table: "store", row: { id: "stock-delete-store", name: "Store with default Location",
    default_location_id: "stock-delete-maximum-location-0", default_sales_channel_id: null, default_region_id: null,
    metadata: { retained: true }, created_at: "2026-10-16T00:00:00.000Z", updated_at: "2026-10-16T00:00:00.000Z", deleted_at: null } }];
  const storeData = await dataset(storeRows), storeInput = inputFor("medusa.store", storeDefinition, []);
  const storeInitializer = await Effect.runPromise(makeCommerceHost({ ...storeInput, logicalStorage: { ...storeInput.logicalStorage,
    initialization: { stepId: "stock-delete-store-initial", datasetSha256: storeData.sha256Hex, expectedRowCount: 1 } } }));
  try { await Effect.runPromise(storeInitializer.initialize(storeRows)); } finally { await Effect.runPromise(storeInitializer.close); }
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const modules: Parameters<typeof prepareStockLocationDeletionWorkflow>[0]["modules"] = {
    stock_location: { module: stock.workflow, logicalStorage: stockInput.logicalStorage },
    sales_channel_location_links: { module: links.location.workflow, logicalStorage: endpoints.linkInput.logicalStorage },
  };
  const options = { execution, modules, link: links.resource, revision: revision("native-stock-location-delete-114"),
    subscribers: [{ id: "native-stock-location-deletion", revision: "a".repeat(64) }] };
  const prepare = async (selectedRevision = options.revision, linkRows?: 8) => {
    const host = await Effect.runPromise(prepareStockLocationDeletionWorkflow({ ...options, revision: selectedRevision,
      modules: { ...modules, sales_channel_location_links: { ...modules.sales_channel_location_links,
        ...(linkRows === undefined ? {} : { logicalResources: { ...defaultCommerceResources, catalogRows: linkRows, queryRows: linkRows, writeBatchRows: linkRows } }) } },
    }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareRestore = async () => {
    const resources = Result.getOrThrow(prepareWorkflowResources({
      stock_location: { module: stock.workflow, methods: ["softDeleteStockLocations", "restoreStockLocations"], graph: false },
      sales_channel_location_links: { module: links.location.workflow, methods: ["softDelete", "restore"], graph: false, expose: false },
    }, true, { link: links.resource }));
    const restore = createStep("invoke-retained-stock-location-compensators", resources.callback(async (input: typeof StockLocationDeletionInput.Type, context) => {
      await restoreLocations([...input.ids], context);
      await restoreLinks({ stock_location: input.ids.length === 0 ? {} : { stock_location_id: [...input.ids], location_id: [...input.ids] } }, context);
      return new StepResponse(null);
    }));
    const workflow = createWorkflow("probe-retained-stock-location-compensation", (input: WorkflowData<typeof StockLocationDeletionInput.Type>) => new WorkflowResponse(restore(input)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules, operationScheduling: "queued",
      revision: revision("retained-stock-location-compensation-probe"), subscribers: options.subscribers,
      workflow: { name: "probeRetainedStockLocationCompensation", resources, prepared: Result.getOrThrow(workflow.prepare()),
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
    const module = { module: inventory.workflow, logicalStorage: inventoryInput.logicalStorage };
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
  return { fixture, stock, links, options, execution, prepare, prepareRestore, seed, attach, detach, seedProtectedInventory,
    readLocations, readAddresses, readLinks, readChannels };
}
