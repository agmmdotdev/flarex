import { createHash, randomUUID } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { deleteFulfillmentSetsWorkflow } from "@medusajs/core-flows/fulfillment/delete-fulfillment-sets";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { fulfillmentSetDeletionResources, fulfillmentSetDeletionCommandMs } from "../../src/workflow/policy";
import { makeFulfillmentSetDeletionCommands } from "../../src/modules/fulfillment/fulfillment-set-delete-service";
import { FulfillmentSetDeletionIds } from "../../src/modules/fulfillment/fulfillment-set-delete-input";
import { prepareFulfillmentSetDeletionLinkResource } from "../../src/links/fulfillment-set-deletion";
import { prepareLocationFulfillmentSetDeletionLinks } from "../../src/links/location-fulfillment-set-deletion";
import { makeStockLocationCommands } from "../../src/modules/stock-location/service";
import { compileStockLocationCoreDefinition } from "../../src/modules/stock-location/schema";
import { makeLocalSalesChannelCommands } from "../../src/modules/sales-channel/service";
import { compileSalesChannelCoreDefinition } from "../../src/modules/sales-channel/schema";
import { compileSalesChannelLocationLinkCoreDefinition } from "../../src/links/sales-channel-location-schema";
import { prepareSalesChannelLocationLink } from "../../src/links/sales-channel-location-service";
import { compileServiceZoneCreationCoreDefinition } from "../../src/modules/fulfillment/shipping-profile-schema";
import { compileLocationFulfillmentSetLinkCoreDefinition } from "../../src/links/location-fulfillment-set-schema";
import { compileLocationFulfillmentProviderLinkCoreDefinition } from "../../src/links/location-fulfillment-provider-schema";
import { compileShippingOptionPriceSetLinkCoreDefinition } from "../../src/links/shipping-option-price-set-schema";
import { compilePricingCoreDefinition } from "../../src/modules/pricing/schema";
import { prepareFulfillmentSetDeletionWorkflow, FulfillmentSetDeletionInput } from "../../src/workflows/fulfillment/delete-fulfillment-sets";
import { makeLocalPricingCommands } from "../../src/modules/pricing/service";
import { prepareLocationFulfillmentProviderLink } from "../../src/links/location-fulfillment-provider-service";
import { prepareShippingOptionPriceSetLink } from "../../src/links/shipping-option-price-set-service";
import { makeServiceZoneCreationCommands } from "../../src/modules/fulfillment/service-zone-create-service";
import { prepareServiceZoneCreationWorkflow } from "../../src/workflows/fulfillment/create-service-zones";
import { fulfillmentForestRows, fulfillmentSetDeletionGraph, serviceZoneSeedTime } from "./native-fulfillment-graph-fixture";
import { createCoreNativeWorkflowFixture, shareCoreNativeWorkflowPhysical } from "./core-native-workflow-fixture";

type Seed = Readonly<{ table: string; row: JsonObject }>;
type RetainedInputs = Readonly<{ set: unknown; link: unknown }>;
const native = Result.getOrThrow(deleteFulfillmentSetsWorkflow.prepare());
function retained(name: string) {
  const node = native.nodes.find(node => node.name === name);
  if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
    throw new Error("Missing genuine retained FulfillmentSet callback " + name);
  return node.compensate;
}
const restoreSet = retained("delete-fulfillment-sets"), restoreLinks = retained("remove-remote-links");

/** Complete eight-source forest and native inverses share the translated owner.
 * Installed Stock/Sales neighbors are observed without granting their APIs. */
export async function prepareCoreFulfillmentSetDeletion(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  graphs: readonly ReturnType<typeof fulfillmentSetDeletionGraph>[], shared?: Readonly<{ physical: CorePersistenceFixture }>) {
  const target = Object.freeze({ scopeUuid: randomUUID(), epochUuid: randomUUID() });
  const definitions = {
    fulfillment: await Effect.runPromise(compileServiceZoneCreationCoreDefinition(target)),
    stock: await Effect.runPromise(compileStockLocationCoreDefinition(target)),
    sales: await Effect.runPromise(compileSalesChannelCoreDefinition(target)),
    salesLinks: await Effect.runPromise(compileSalesChannelLocationLinkCoreDefinition(target)),
    locationLinks: await Effect.runPromise(compileLocationFulfillmentSetLinkCoreDefinition(target)),
    providerLinks: await Effect.runPromise(compileLocationFulfillmentProviderLinkCoreDefinition(target)),
    priceSetLinks: await Effect.runPromise(compileShippingOptionPriceSetLinkCoreDefinition(target)),
    pricing: await Effect.runPromise(compilePricingCoreDefinition(target)),
  };
  const fulfillment = await Effect.runPromise(makeFulfillmentSetDeletionCommands());
  const locationLinks = await Effect.runPromise(prepareLocationFulfillmentSetDeletionLinks("fulfillment-set-deletions", "fulfillmentSetLocationLink"));
  const providerLinks = await Effect.runPromise(prepareLocationFulfillmentProviderLink());
  const priceSetLinks = await Effect.runPromise(prepareShippingOptionPriceSetLink());
  const pricing = await Effect.runPromise(makeLocalPricingCommands("shipping-options"));
  const stock = await Effect.runPromise(makeStockLocationCommands());
  const channels = await Effect.runPromise(makeLocalSalesChannelCommands());
  const sales = await Effect.runPromise(prepareSalesChannelLocationLink());
  const linkRows = graphs.flatMap(graph => graph.links), locationIds = [...new Set(linkRows.map(entry => entry.row.stock_location_id))];
  const protectedRows: Seed[] = [
    ...locationIds.slice(0, 4).map((id, index) => ({ table: "stock_location_address", row: { id: `${id}-address`, address_1: `Address ${index}`,
      address_2: null, company: null, city: null, country_code: "MM", phone: null, province: null, postal_code: null, metadata: null,
      created_at: serviceZoneSeedTime, updated_at: serviceZoneSeedTime, deleted_at: null } })),
    ...locationIds.map((id, index) => ({ table: "stock_location", row: { id, name: id, metadata: null,
      address_id: index < 4 ? `${id}-address` : null, created_at: serviceZoneSeedTime, updated_at: serviceZoneSeedTime, deleted_at: null } })),
  ];
  const channelRows: Seed[] = linkRows.length === 0 ? [] : [0, 1].map(index => ({ table: "sales_channel", row: {
    id: `set-delete-protected-channel-${index}`, name: `Protected channel ${index}`, description: null, is_disabled: false, metadata: null,
    created_at: serviceZoneSeedTime, updated_at: serviceZoneSeedTime, deleted_at: null,
  } }));
  const salesRows: Seed[] = locationIds.slice(0, 4).flatMap(id => [0, 1].map(index => ({ table: "sales_channel_stock_location", row: {
    id: `${id}-scloc-${index}`, stock_location_id: id, sales_channel_id: `set-delete-protected-channel-${index}`,
    created_at: serviceZoneSeedTime, updated_at: serviceZoneSeedTime, deleted_at: null,
  } })));
  const eventDefinition = await Effect.runPromise(compileCoreNativeEventStorageDefinition(target));
  const fixture = await createCoreNativeWorkflowFixture(driver, { eventDefinition,
    ...(shared === undefined ? {} : { physical: await shareCoreNativeWorkflowPhysical(shared.physical) }), sources: [
      { name: "fulfillment", definition: definitions.fulfillment, initialCommands: fulfillment.commands, rows: fulfillmentForestRows(graphs, true) },
      { name: "stock_location", definition: definitions.stock, initialCommands: stock.commands, rows: protectedRows },
      { name: "sales_channel", definition: definitions.sales, initialCommands: channels.commands, rows: channelRows },
      { name: "sales_channel_location_links", definition: definitions.salesLinks, initialCommands: sales.commands, rows: salesRows },
      { name: "locationLinks", initializationStepId: "location-links-initial", definition: definitions.locationLinks, initialCommands: locationLinks.commands, rows: linkRows },
      { name: "providerLinks", initializationStepId: "provider-links-initial", definition: definitions.providerLinks, initialCommands: providerLinks.commands, rows: graphs.flatMap(graph => graph.shipping?.providerLinks ?? []) },
      { name: "priceSetLinks", initializationStepId: "price-set-links-initial", definition: definitions.priceSetLinks, initialCommands: priceSetLinks.commands, rows: graphs.flatMap(graph => graph.shipping?.priceSetLinks ?? []) },
      { name: "pricing", definition: definitions.pricing, initialCommands: pricing.commands, rows: graphs.flatMap(graph => graph.shipping?.pricingRows ?? []) },
    ] });
  close(fixture.close);
  const execution = fixture.execution;
  const link = Result.getOrThrow(prepareFulfillmentSetDeletionLinkResource({ location: locationLinks.nativeService, fulfillment: fulfillment.workflow,
    provider: providerLinks.nativeService, priceSet: priceSetLinks.nativeService, pricing: pricing.workflow }));
  const installed = { module: fulfillment.workflow, nativeStorage: fixture.source("fulfillment"), logicalResources: fulfillmentSetDeletionResources };
  const installedLinks = { module: locationLinks.workflow, nativeStorage: fixture.source("locationLinks"), logicalResources: fulfillmentSetDeletionResources };
  const modules = { fulfillment: installed, locationLinks: installedLinks,
    providerLinks: { module: providerLinks.workflow, nativeStorage: fixture.source("providerLinks"), logicalResources: fulfillmentSetDeletionResources },
    priceSetLinks: { module: priceSetLinks.workflow, nativeStorage: fixture.source("priceSetLinks"), logicalResources: fulfillmentSetDeletionResources },
    pricing: { module: pricing.workflow, nativeStorage: fixture.source("pricing"), logicalResources: fulfillmentSetDeletionResources, logicalPublication: "mixed" as const },
  };
  const options: Parameters<typeof prepareFulfillmentSetDeletionWorkflow>[0] = { execution, modules, link,
    revision: createHash("sha256").update("native-fulfillment-set-delete-134").digest("hex"),
    subscribers: [{ id: "native-fulfillment-set-delete", revision: "d".repeat(64) }] };
  const resources = Result.getOrThrow(prepareWorkflowResources({ fulfillment: { module: fulfillment.workflow,
    methods: ["softDeleteFulfillmentSets", "restoreFulfillmentSets"], graph: false },
    locationLinks: { module: locationLinks.workflow, methods: ["create", "list", "softDelete", "restore"], graph: false, expose: false },
    providerLinks: { module: providerLinks.workflow, methods: ["softDelete", "restore"], graph: false, expose: false },
    priceSetLinks: { module: priceSetLinks.workflow, methods: ["softDelete", "restore"], graph: false, expose: false },
    pricing: { module: pricing.workflow, methods: ["softDeletePriceSets", "restorePriceSets"], graph: false, expose: false },
  }, true, { link }));
  const prepare = async (revision = options.revision) => {
    const host = await Effect.runPromise(prepareFulfillmentSetDeletionWorkflow({ ...options, revision }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const hostOptions = { execution, modules, revision: options.revision, subscribers: options.subscribers,
    requestCallLimit: fulfillmentSetDeletionResources.calls, requestEventLimit: fulfillmentSetDeletionResources.eventMessages,
    requestByteLimit: fulfillmentSetDeletionResources.commandBytes, requestCommandMs: fulfillmentSetDeletionCommandMs };
  const prepareLifecycle = async () => {
    const Input = Schema.Struct({ ids: FulfillmentSetDeletionIds, restore: Schema.Boolean });
    const invoke = createStep("probe-native-fulfillment-set-lifecycle", resources.callback(async (value: typeof Input.Type, context) =>
      value.restore ? context.resources.fulfillment.restoreFulfillmentSets([...value.ids]) : context.resources.fulfillment.softDeleteFulfillmentSets([...value.ids])));
    const flow = createWorkflow("probe-native-fulfillment-set-lifecycle", (value: WorkflowData<typeof Input.Type>) => new WorkflowResponse(invoke(value)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...hostOptions, workflow: { name: "probeNativeFulfillmentSetLifecycle", resources,
      prepared: Result.getOrThrow(flow.prepare()), input: Input, output: Schema.JsonObject, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareRoundtrip = async (actualRetained: () => RetainedInputs,
    limits: Readonly<{ calls: number; eventMessages: number; commandBytes?: number }> = fulfillmentSetDeletionResources, lateFailure = false, revision = options.revision) => {
    const inverse = createStep("probe-native-fulfillment-set-retained-inverses", resources.callback(async (_value: null, context) => {
      const actual = actualRetained(); await restoreLinks(actual.link, context); await restoreSet(actual.set, context);
      if (lateFailure) throw new Error("Late genuine FulfillmentSet retained inverse failure"); return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-native-fulfillment-set-root-roundtrip", (value: WorkflowData<typeof FulfillmentSetDeletionInput.Type>) => {
      const deleted = deleteFulfillmentSetsWorkflow.runAsStep({ input: { ids: value.ids } });
      return new WorkflowResponse(inverse(transform(deleted, () => null)));
    });
    const selectedResources = { ...fulfillmentSetDeletionResources, ...limits };
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...hostOptions, revision,
      modules: Object.fromEntries(Object.entries(modules).map(([name, module]) => [name, { ...module, logicalResources: selectedResources }])),
      requestCallLimit: selectedResources.calls, requestEventLimit: selectedResources.eventMessages,
      requestByteLimit: selectedResources.commandBytes, workflow: {
        name: "probeNativeFulfillmentSetRootRoundtrip", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: FulfillmentSetDeletionInput, output: Schema.Null, events: internalModuleWorkflowEvents,
      } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareAbsentInverse = async () => {
    const inverse = createStep("probe-native-fulfillment-set-absent-inverses", resources.callback(async (_value: null, context) => {
      await restoreSet(undefined, context); await restoreSet([], context); await restoreLinks(undefined, context); return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-native-fulfillment-set-absent-inverses", (value: WorkflowData<null>) => new WorkflowResponse(inverse(value)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...hostOptions, workflow: { name: "probeNativeFulfillmentSetAbsentInverses", resources,
      prepared: Result.getOrThrow(flow.prepare()), input: Schema.Null, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareZoneCreation = async () => {
    const zone = await Effect.runPromise(makeServiceZoneCreationCommands());
    const host = await Effect.runPromise(prepareServiceZoneCreationWorkflow({ execution,
      modules: { fulfillment: { module: zone.workflow, nativeStorage: fixture.source("fulfillment") } },
      revision: createHash("sha256").update("native-service-zone-create-131").digest("hex"),
      subscribers: [{ id: "native-service-zone-create", revision: "a".repeat(64) }] }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const read = async (ids: readonly string[]) => {
    const selected = new Set(ids);
    return (await fixture.readRows()).filter(row => typeof row.id === "string" && selected.has(row.id))
      .toSorted((left, right) => String(left.id).localeCompare(String(right.id)));
  };
  return { fixture, definitions, execution, fulfillment, installed, installedLinks, locationLinks, providerLinks, priceSetLinks, pricing,
    link, linkRows, protectedRows: [...protectedRows, ...channelRows, ...salesRows], options, resources, hostOptions, prepare,
    prepareLifecycle, prepareRoundtrip, prepareAbsentInverse, prepareZoneCreation, input: FulfillmentSetDeletionInput,
    read, snapshot: () => fixture.snapshot() };
}
