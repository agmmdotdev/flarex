import { createHash } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { deleteFulfillmentSetsWorkflow } from "@medusajs/core-flows/fulfillment/delete-fulfillment-sets";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { fulfillmentSetDeletionResources, fulfillmentSetDeletionCommandMs } from "../../src/workflow/policy";
import { makeFulfillmentSetDeletionCommands } from "../../src/modules/fulfillment/fulfillment-set-delete-service";
import { FulfillmentSetDeletionIds } from "../../src/modules/fulfillment/fulfillment-set-delete-input";
import { prepareFulfillmentSetDeletionLinkResource } from "../../src/links/fulfillment-set-deletion";
import { prepareLocationFulfillmentSetDeletionLinks } from "../../src/links/location-fulfillment-set-deletion";
import { makeStockLocationCommands } from "../../src/modules/stock-location/service";
import { makeLocalSalesChannelCommands } from "../../src/modules/sales-channel/service";
import { prepareLinkService } from "../../src/links/service";
import { captureSalesChannelLocationLinkMetadata } from "../../src/links/sales-channel-location-schema";
import { prepareLinkWorkflowService } from "../../src/links/workflow-service";
import { prepareFulfillmentSetDeletionWorkflow, FulfillmentSetDeletionInput } from "../../src/workflows/fulfillment/delete-fulfillment-sets";
import { prepareLogicalServiceZoneCreation, serviceZoneDeletionGraph, serviceZoneSeedTime } from "./logical-service-zone-creation-fixture";
import type { LogicalCurrencyFixture } from "./logical-currency-fixture";
import { shippingDeletionClosure } from "./shipping-deletion-closure";
import { makeLocalPricingCommands } from "../../src/modules/pricing/service";
import { prepareLocationFulfillmentProviderLink } from "../../src/links/location-fulfillment-provider-service";
import { prepareShippingOptionPriceSetLink } from "../../src/links/shipping-option-price-set-service";

type Seed = Readonly<{ table: string; row: JsonObject }>;
type RetainedInputs = Readonly<{ set: unknown; link: unknown }>;

/** Canonical eight-table forest plus optional installed locfs history. Counts
 * are aggregate so 4/4/16/8/16 is exactly 48 selected lifecycle rows. */
export function fulfillmentSetDeletionGraph(prefix: string, options: Readonly<{
  sets?: number; zones?: number; geos?: number; options?: number; rules?: number;
  links?: number; historicalLinks?: number;
  history?: Readonly<{ sets?: number; zones?: number; geos?: number; options?: number; rules?: number }>;
  shipping?: Readonly<{ historical?: boolean }>;
}> = {}) {
  const count = options.sets ?? 1, zoneCount = options.zones ?? count;
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(zoneCount) || zoneCount < 0 ||
    zoneCount === 0 && ((options.geos ?? 0) !== 0 || (options.options ?? 0) !== 0 || (options.rules ?? 0) !== 0))
    throw new Error("Invalid FulfillmentSet comparison graph");
  const ids = Array.from({ length: count }, (_, index) => `${prefix}-set-${index}`);
  const descendants = zoneCount === 0 ? { ids: [], geoIds: [], optionIds: [], ruleIds: [], allIds: [], rows: [] }
    : serviceZoneDeletionGraph(prefix, { roots: zoneCount, geos: options.geos ?? 0, options: options.options ?? 0, rules: options.rules ?? 0 });
  const parents = new Map(descendants.ids.map((id, index) => {
    const parent = ids[index % ids.length];
    if (parent === undefined) throw new Error("Missing comparison Set parent");
    return [id, parent];
  }));
  const supplied: Seed[] = [
    ...ids.map(id => ({ table: "fulfillment_set", row: { id, name: id, type: "shipping", metadata: { fixture: prefix },
      created_at: serviceZoneSeedTime, updated_at: serviceZoneSeedTime, deleted_at: null } })),
    ...descendants.rows.map(entry => {
      if (entry.table !== "service_zone") return entry;
      const id = entry.row.id, parent = typeof id === "string" ? parents.get(id) : undefined;
      if (parent === undefined) throw new Error("Missing comparison Zone parent");
      return { ...entry, row: { ...entry.row, fulfillment_set_id: parent } };
    }),
  ];
  const history = new Map([["fulfillment_set", options.history?.sets ?? 0], ["service_zone", options.history?.zones ?? 0],
    ["geo_zone", options.history?.geos ?? 0], ["shipping_option", options.history?.options ?? 0], ["shipping_option_rule", options.history?.rules ?? 0]]);
  const positions = new Map<string, number>();
  const rows: Seed[] = supplied.map(entry => {
    const ordinal = positions.get(entry.table) ?? 0; positions.set(entry.table, ordinal + 1);
    return { ...entry, row: { ...entry.row, deleted_at: ordinal < (history.get(entry.table) ?? 0) ? serviceZoneSeedTime : null } };
  });
  const links = Array.from({ length: options.links ?? 0 }, (_, index) => ({ table: "location_fulfillment_set", row: {
    id: `${prefix}-locfs-${index}`, stock_location_id: `${prefix}-location-${index}`, fulfillment_set_id: ids[index % ids.length]!,
    created_at: serviceZoneSeedTime, updated_at: serviceZoneSeedTime, deleted_at: index < (options.historicalLinks ?? 0) ? serviceZoneSeedTime : null,
  } }));
  const shipping = options.shipping === undefined ? undefined : shippingDeletionClosure(prefix, descendants.optionIds,
    [...new Set(links.flatMap(entry => typeof entry.row.stock_location_id === "string" ? [entry.row.stock_location_id] : []))], options.shipping.historical);
  return { ids, zoneIds: descendants.ids, geoIds: descendants.geoIds, optionIds: descendants.optionIds, ruleIds: descendants.ruleIds,
    allIds: [...ids, ...descendants.allIds], rows: [...rows, ...shipping?.providerRows ?? []], links, shipping };
}

const native = Result.getOrThrow(deleteFulfillmentSetsWorkflow.prepare());
function retained(name: string) {
  const node = native.nodes.find(node => node.name === name);
  if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
    throw new Error("Missing genuine retained FulfillmentSet callback " + name);
  return node.compensate;
}
const restoreSet = retained("delete-fulfillment-sets"), restoreLinks = retained("remove-remote-links");

/** Reuse the original source installation, protected FK targets, initialized
 * canonical rows and complete scope inventory. Callers split independent seed
 * cohorts into fresh scopes over shared.resource before initializer limits. */
export async function prepareLogicalFulfillmentSetDeletion(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  graphs: readonly ReturnType<typeof fulfillmentSetDeletionGraph>[], shared?: Readonly<{ resource: LogicalCurrencyFixture["resource"];
    fixtureIdentity: Readonly<{ deploymentId: string; projectId: string; uuidOffset: number }> }>) {
  const base = await prepareLogicalServiceZoneCreation(driver, close, graphs, shared,
    { includeStockLocation: true, includeLocationFulfillmentSetLink: true, includeSalesChannel: true, includeSalesChannelLocationLink: true,
      includePricing: true, includeLocationFulfillmentProviderLink: true, includeShippingOptionPriceSetLink: true });
  const fulfillment = await Effect.runPromise(makeFulfillmentSetDeletionCommands());
  const locationLinks = await Effect.runPromise(prepareLocationFulfillmentSetDeletionLinks("fulfillment-set-deletions", "fulfillmentSetLocationLink"));
  const providerLinks = await Effect.runPromise(prepareLocationFulfillmentProviderLink()), priceSetLinks = await Effect.runPromise(prepareShippingOptionPriceSetLink());
  const pricing = await Effect.runPromise(makeLocalPricingCommands("shipping-options"));
  const link = Result.getOrThrow(prepareFulfillmentSetDeletionLinkResource({ location: locationLinks.nativeService, fulfillment: fulfillment.workflow,
    provider: providerLinks.nativeService, priceSet: priceSetLinks.nativeService, pricing: pricing.workflow }));
  const initialize = async (key: string, definition: { readonly schema: NonNullable<typeof base.fixture.locationFulfillmentSetLinkDefinition>["schema"]; readonly provenance: unknown },
    commands: LogicalCommerceHostInput<unknown>["commands"], rows: readonly Seed[]) => {
    // Single-table initialization accepts native row bodies; the existing
    // multi-table initialization contract accepts named table/row batches.
    const inputRows = definition.schema.tables.length === 1 ? rows.map(entry => entry.row) : rows;
    const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: inputRows }, 1_048_576,
      { invalidInput: () => new Error("Invalid Set deletion Link seed"), hashFailure: cause => new Error("Set deletion Link seed hash", { cause }) }));
    const input = { ...base.fixture.hostInput, commands, identityAndAccessPolicy: { profile: key + ".set-delete-test" },
      logicalStorage: { ...base.fixture.hostInput.logicalStorage,
        source: { sourceKey: key, writeProfile: key, schema: definition.schema, evidence: definition.provenance },
        initialization: { stepId: key.toLowerCase() + ".set-delete-initial", datasetSha256: dataset.sha256Hex, expectedRowCount: rows.length } },
    } satisfies LogicalCommerceHostInput<unknown>;
    const host = await Effect.runPromise(makeCommerceHost(input));
    try {
      await Effect.runPromise(host.initialize(inputRows).pipe(Effect.mapError(cause => new Error("Failed canonical Set deletion initialization: " + key, { cause }))));
    } finally { await Effect.runPromise(host.close); }
    return input.logicalStorage;
  };
  const definition = base.fixture.locationFulfillmentSetLinkDefinition;
  if (definition === undefined) throw new Error("Missing installed Location Fulfillment Set source");
  const linkRows = graphs.flatMap(graph => graph.links);
  const locationStorage = await initialize("medusa.link.locationFulfillmentSet", definition, locationLinks.commands, linkRows);
  const providerDefinition = base.fixture.locationFulfillmentProviderLinkDefinition, priceSetDefinition = base.fixture.shippingOptionPriceSetLinkDefinition,
    pricingDefinition = base.fixture.pricingDefinition;
  if (providerDefinition === undefined || priceSetDefinition === undefined || pricingDefinition === undefined) throw new Error("Missing installed Shipping sources");
  const providerStorage = await initialize("medusa.link.locationFulfillmentProvider", providerDefinition, providerLinks.commands, graphs.flatMap(graph => graph.shipping?.providerLinks ?? []));
  const priceSetStorage = await initialize("medusa.link.shippingOptionPriceSet", priceSetDefinition, priceSetLinks.commands, graphs.flatMap(graph => graph.shipping?.priceSetLinks ?? []));
  const pricingStorage = await initialize("medusa.pricing", pricingDefinition, pricing.commands, graphs.flatMap(graph => graph.shipping?.pricingRows ?? []));
  const stock = await Effect.runPromise(makeStockLocationCommands()), stockDefinition = base.fixture.stockLocationDefinition,
    salesDefinition = base.fixture.salesChannelLocationLinkDefinition, channelDefinition = base.fixture.salesChannelDefinition;
  if (stockDefinition === undefined || salesDefinition === undefined || channelDefinition === undefined) throw new Error("Missing untouched Stock/Sales Channel Link sources");
  const locationIds = [...new Set(linkRows.map(entry => entry.row.stock_location_id))];
  const protectedRows: Seed[] = [
    ...locationIds.slice(0, 4).map((id, index) => ({ table: "stock_location_address", row: { id: `${id}-address`, address_1: `Address ${index}`,
      address_2: null, company: null, city: null, country_code: "MM", phone: null, province: null, postal_code: null, metadata: null,
      created_at: serviceZoneSeedTime, updated_at: serviceZoneSeedTime, deleted_at: null } })),
    ...locationIds.map((id, index) => ({ table: "stock_location", row: { id, name: id, metadata: null,
      address_id: index < 4 ? `${id}-address` : null, created_at: serviceZoneSeedTime, updated_at: serviceZoneSeedTime, deleted_at: null } })),
  ];
  await initialize("medusa.stockLocation", stockDefinition, stock.commands, protectedRows);
  const channels = await Effect.runPromise(makeLocalSalesChannelCommands());
  const channelRows: Seed[] = linkRows.length === 0 ? [] : [0, 1].map(index => ({ table: "sales_channel", row: {
    id: `set-delete-protected-channel-${index}`, name: `Protected channel ${index}`, description: null, is_disabled: false, metadata: null,
    created_at: serviceZoneSeedTime, updated_at: serviceZoneSeedTime, deleted_at: null,
  } }));
  await initialize("medusa.salesChannel", channelDefinition, channels.commands, channelRows);
  const sales = Result.getOrThrow(prepareLinkWorkflowService(await Effect.runPromise(prepareLinkService(
    await Effect.runPromise(captureSalesChannelLocationLinkMetadata()), 8)), "setUntouchedSalesLink"));
  const salesRows: Seed[] = locationIds.slice(0, 4).flatMap(id => [0, 1].map(index => ({ table: "sales_channel_stock_location", row: {
    id: `${id}-scloc-${index}`, stock_location_id: id, sales_channel_id: `set-delete-protected-channel-${index}`,
    created_at: serviceZoneSeedTime, updated_at: serviceZoneSeedTime, deleted_at: null,
  } })));
  await initialize("medusa.link.salesChannelLocation", salesDefinition, [sales.create, sales.list], salesRows);
  const installed = { module: fulfillment.workflow, logicalStorage: base.installed.logicalStorage, logicalResources: fulfillmentSetDeletionResources };
  const installedLinks = { module: locationLinks.workflow, logicalStorage: locationStorage, logicalResources: fulfillmentSetDeletionResources };
  const installedProvider = { module: providerLinks.workflow, logicalStorage: providerStorage, logicalResources: fulfillmentSetDeletionResources };
  const installedPriceSet = { module: priceSetLinks.workflow, logicalStorage: priceSetStorage, logicalResources: fulfillmentSetDeletionResources };
  const installedPricing = { module: pricing.workflow, logicalStorage: pricingStorage, logicalResources: fulfillmentSetDeletionResources, logicalPublication: "mixed" as const };
  const modules = { fulfillment: installed, locationLinks: installedLinks, providerLinks: installedProvider, priceSetLinks: installedPriceSet, pricing: installedPricing };
  const options: Parameters<typeof prepareFulfillmentSetDeletionWorkflow>[0] = { execution: base.execution, modules, link,
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
  const hostOptions = { execution: options.execution, modules: options.modules, revision: options.revision, subscribers: options.subscribers,
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
  /** The test supplies actual retained StepResponse inputs captured while the
   * literal root executes. Native compensation reverses its serial Set→Link
   * graph. Atomic failure itself still rolls back through the outer owner. */
  const prepareRoundtrip = async (actualRetained: () => RetainedInputs,
    limits: Readonly<{ calls: number; eventMessages: number; commandBytes?: number }> = fulfillmentSetDeletionResources, lateFailure = false, revision = options.revision) => {
    const inverse = createStep("probe-native-fulfillment-set-retained-inverses", resources.callback(async (_value: null, context) => {
      const actual = actualRetained();
      await restoreLinks(actual.link, context); await restoreSet(actual.set, context);
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
  return { ...base, fulfillment, installed, installedLinks, locationLinks, providerLinks, priceSetLinks, pricing, link, linkRows, protectedRows: [...protectedRows, ...channelRows, ...salesRows], options, resources, hostOptions, prepare, prepareLifecycle, prepareRoundtrip, prepareAbsentInverse,
    prepareZoneCreation: base.prepare, input: FulfillmentSetDeletionInput };
}
