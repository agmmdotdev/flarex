import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createShippingOptionsWorkflow } from "@medusajs/core-flows/fulfillment/create-shipping-options";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { makeStockLocationCommands } from "../../src/modules/stock-location/service";
import { makeLocalShippingOptionCreationCommands, makeLocalShippingOptionCreationWithReferenceDetachmentCommands } from "../../src/modules/fulfillment/shipping-option-create-service";
import { compileFulfillmentCreationDefinition } from "../../src/modules/fulfillment/shipping-profile-schema";
import { makeLocalPricingCommands } from "../../src/modules/pricing/service";
import { makeLocalRegionReadCommands } from "../../src/modules/region/service";
import { prepareLocationFulfillmentSetLinkRead } from "../../src/links/location-fulfillment-set-service";
import { prepareLocationFulfillmentProviderLink } from "../../src/links/location-fulfillment-provider-service";
import { prepareShippingOptionPriceSetLink, prepareShippingOptionCreationLinkResource } from "../../src/links/shipping-option-price-set-service";
import { prepareShippingOptionCreationWorkflow, ShippingOptionCreationInput, prepareShippingOptionCreationResources,
  shippingOptionCreationEvents } from "../../src/workflows/fulfillment/create-shipping-options";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../../src/workflow/host";
import { shippingOptionCreationResources } from "../../src/workflow/policy";
import { projectNativeRow } from "../../src/repository/result";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./logical-currency-fixture";
import { logicalCurrencyInventory } from "./logical-currency-inventory";

const stamp = "2026-10-18T00:00:00.000Z";
const managed = { created_at: stamp, updated_at: stamp, deleted_at: null };
export const shippingOptionParents = { zone: "sz138", unavailableZone: "sz138-unavailable", set: "set138", location: "loc138",
  profile: "sp138", type: "sot138", provider: "manual_manual", region: "reg138" } as const;
export const shippingOptionRegionIds = [shippingOptionParents.region, ...Array.from({ length: 7 }, (_, index) => "reg138-" + (index + 1))];
type Seed = { readonly table: string; readonly row: JsonObject };
type NativeCreationInput = Parameters<typeof createShippingOptionsWorkflow.runAsStep>[0]["input"];
const native = Result.getOrThrow(createShippingOptionsWorkflow.prepare());
function retained(name: string) {
  const node = native.nodes.find(node => node.name === name);
  if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
    throw new Error("Missing genuine Shipping Option retained inverse: " + name);
  return node.compensate;
}
const undo = { creation: retained("create-shipping-options-step"), pricing: retained("add-shipping-options-prices-step"),
  links: retained("set-shipping-options-price-sets-step"), event: retained("emit-event-step") };
export type ShippingOptionRetained = { readonly creation: unknown; readonly pricing: unknown; readonly links: unknown; readonly event: unknown };

export function shippingOptionCreationInput(prefix: string, count = 1): typeof ShippingOptionCreationInput.Type {
  return Array.from({ length: count }, (_, index) => ({ name: `${prefix}-${index}`, price_type: "flat", service_zone_id: shippingOptionParents.zone,
    shipping_profile_id: shippingOptionParents.profile, provider_id: shippingOptionParents.provider,
    type: { label: `${prefix}-type-${index}`, code: `${prefix}-type-${index}` },
    prices: [{ currency_code: "usd", amount: 100 + index }], rules: [{ attribute: "enabled", operator: "eq", value: true }] }));
}

/** Every source is installed by the ordinary composition/admission path. Seeds
 * provide existing endpoints; no fake provider or synthetic Query service runs. */
export async function prepareLogicalShippingOptionCreation(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  shared?: Readonly<{ resource: LogicalCurrencyFixture["resource"];
    fixtureIdentity: Readonly<{ deploymentId: string; projectId: string; uuidOffset: number }> }>, profile: "standalone" | "reference-detachment" = "standalone") {
  const configuration = { includeShippingProfile: true, includeServiceZoneCreation: true, includeFulfillmentCreation: true,
    includeStockLocation: true, includeLocationFulfillmentSetLink: true, includeLocationFulfillmentProviderLink: true,
    includeShippingOptionPriceSetLink: true, includePricing: true, includeRegion: true };
  const fixture = await logicalCurrencyFixture(driver, close, shared === undefined ? configuration : { ...configuration, ...shared });
  const fulfillment = await Effect.runPromise(profile === "reference-detachment" ? makeLocalShippingOptionCreationWithReferenceDetachmentCommands() : makeLocalShippingOptionCreationCommands()), pricing = await Effect.runPromise(makeLocalPricingCommands("shipping-options")),
    region = await Effect.runPromise(makeLocalRegionReadCommands()), stockLocation = await Effect.runPromise(makeStockLocationCommands("read")),
    locationLinks = await Effect.runPromise(prepareLocationFulfillmentSetLinkRead()), providerLinks = await Effect.runPromise(prepareLocationFulfillmentProviderLink()),
    priceSetLinks = await Effect.runPromise(prepareShippingOptionPriceSetLink());
  const definitions = { fulfillment: await Effect.runPromise(compileFulfillmentCreationDefinition()), pricing: fixture.pricingDefinition, region: fixture.regionDefinition,
    stockLocation: fixture.stockLocationDefinition, locationLinks: fixture.locationFulfillmentSetLinkDefinition,
    providerLinks: fixture.locationFulfillmentProviderLinkDefinition, priceSetLinks: fixture.shippingOptionPriceSetLinkDefinition };
  const initialize = async (key: string, definition: NonNullable<typeof definitions.fulfillment> | undefined,
    commands: LogicalCommerceHostInput<unknown>["commands"], rows: readonly Seed[]) => {
    if (definition === undefined) throw new Error("Missing Shipping Option source " + key);
    const inputRows = definition.schema.tables.length === 1 ? rows.map(entry => entry.row) : rows;
    const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: inputRows }, 1_048_576,
      { invalidInput: () => new Error("Invalid Shipping Option seed"), hashFailure: cause => new Error("Shipping seed hash", { cause }) }));
    const input = { ...fixture.hostInput, commands, identityAndAccessPolicy: { profile: key + ".shipping-create-test" },
      logicalResources: shippingOptionCreationResources, logicalStorage: { ...fixture.hostInput.logicalStorage,
        source: { sourceKey: key, writeProfile: key, schema: definition.schema, evidence: definition.provenance },
        initialization: { stepId: key.toLowerCase() + ".shipping-initial", datasetSha256: dataset.sha256Hex, expectedRowCount: rows.length } },
    } satisfies LogicalCommerceHostInput<unknown>;
    const host = await Effect.runPromise(makeCommerceHost(input));
    try { await Effect.runPromise(host.initialize(inputRows).pipe(Effect.mapError(cause => new Error("Shipping seed source " + key, { cause })))); }
    finally { await Effect.runPromise(host.close); }
    return input.logicalStorage;
  };
  const fulfillmentStorage = await initialize("medusa.shippingProfile", definitions.fulfillment, fulfillment.commands, [
    { table: "fulfillment_set", row: { id: shippingOptionParents.set, name: "Shipping138", type: "shipping", metadata: null, ...managed } },
    { table: "fulfillment_set", row: { id: "set138-unavailable", name: "Unavailable138", type: "shipping", metadata: null, ...managed } },
    { table: "shipping_profile", row: { id: shippingOptionParents.profile, name: "Shipping138", type: "default", metadata: null, ...managed } },
    { table: "shipping_option_type", row: { id: shippingOptionParents.type, label: "Existing138", code: "existing138", description: null, ...managed } },
    { table: "fulfillment_provider", row: { id: shippingOptionParents.provider, is_enabled: true, ...managed } },
    ...[shippingOptionParents.zone, shippingOptionParents.unavailableZone].map(id => ({ table: "service_zone", row: { id, name: id,
      fulfillment_set_id: id === shippingOptionParents.zone ? shippingOptionParents.set : "set138-unavailable", metadata: null, ...managed } })),
  ]);
  const stockStorage = await initialize("medusa.stockLocation", definitions.stockLocation, stockLocation.commands, [
    { table: "stock_location", row: { id: shippingOptionParents.location, name: "Shipping138", address_id: null, metadata: null, ...managed } },
  ]);
  const locationStorage = await initialize("medusa.link.locationFulfillmentSet", definitions.locationLinks, locationLinks.commands, [
    { table: "location_fulfillment_set", row: { id: "locfs138", stock_location_id: shippingOptionParents.location,
      fulfillment_set_id: shippingOptionParents.set, ...managed } },
  ]);
  const providerStorage = await initialize("medusa.link.locationFulfillmentProvider", definitions.providerLinks, providerLinks.commands, [
    { table: "location_fulfillment_provider", row: { id: "locfp138", stock_location_id: shippingOptionParents.location,
      fulfillment_provider_id: shippingOptionParents.provider, ...managed } },
  ]);
  const pricingStorage = await initialize("medusa.pricing", definitions.pricing, pricing.commands, []);
  const priceSetStorage = await initialize("medusa.link.shippingOptionPriceSet", definitions.priceSetLinks, priceSetLinks.commands, []);
  const regionStorage = await initialize("medusa.region", definitions.region, region.commands, shippingOptionRegionIds.map(id => (
    { table: "region", row: { id, name: "Region138-" + id, currency_code: "eur", automatic_taxes: true, metadata: null, ...managed } }
  )));
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const registration = <Module>(module: Module, logicalStorage: typeof fulfillmentStorage) => ({ module, logicalStorage, logicalResources: shippingOptionCreationResources });
  const modules = { fulfillment: registration(fulfillment.workflow, fulfillmentStorage), pricing: registration(pricing.workflow, pricingStorage),
    region: registration(region.workflow, regionStorage), stockLocation: registration(stockLocation.workflow, stockStorage),
    locationLinks: registration(locationLinks.workflow, locationStorage), providerLinks: registration(providerLinks.workflow, providerStorage),
    priceSetLinks: registration(priceSetLinks.workflow, priceSetStorage) };
  const link = Result.getOrThrow(prepareShippingOptionCreationLinkResource({ location: locationLinks.nativeService,
    provider: providerLinks.nativeService, pricing: priceSetLinks.nativeService }));
  const options = { execution, modules, link, revision: "8".repeat(64), subscribers: [{ id: "native-shipping-create", revision: "8".repeat(64) }] };
  const prepare = async () => {
    const host = await Effect.runPromise(prepareShippingOptionCreationWorkflow(options));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const resources = Result.getOrThrow(prepareShippingOptionCreationResources({ fulfillment: fulfillment.workflow, pricing: pricing.workflow,
    region: region.workflow, stockLocation: stockLocation.workflow, locationLinks: locationLinks.workflow,
    providerLinks: providerLinks.workflow, priceSetLinks: priceSetLinks.workflow }, link));
  const prepareRoundtrip = async (actualRetained: () => ShippingOptionRetained, lateFailure = false) => {
    const inverse = createStep("probe-shipping-option-native-inverses", resources.callback(async (_input: null, context) => {
      const actual = actualRetained();
      await undo.event(actual.event, context); await undo.links(actual.links, context);
      await undo.pricing(actual.pricing, context); await undo.creation(actual.creation, context);
      if (lateFailure) throw new Error("Late native Shipping Option inverse failure");
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-shipping-option-retained-inverses", (value: WorkflowData<typeof ShippingOptionCreationInput.Type>) => {
      // SAFETY: the checked runtime grammar also admits the native composer's
      // missing-prices branch. Its DTO requires prices and mutable arrays;
      // this definition-only annotation changes neither runtime capture nor data.
      const root = createShippingOptionsWorkflow.runAsStep({ input: value as NativeCreationInput });
      return new WorkflowResponse(inverse(transform(root, () => null)));
    });
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued",
      requestCallLimit: shippingOptionCreationResources.calls, requestEventLimit: shippingOptionCreationResources.eventMessages,
      requestByteLimit: shippingOptionCreationResources.commandBytes,
      workflow: { name: "probeShippingOptionRetainedInverses", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: ShippingOptionCreationInput, output: Schema.Null, events: shippingOptionCreationEvents(fulfillment.workflow, fulfillment.contracts) } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const read = async () => {
    const inventory = await logicalCurrencyInventory(fixture), scope = projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid;
    const result: JsonObject[] = [];
    for (const current of inventory.rows) {
      if (current.scopeUuid !== scope) continue;
      const revision = inventory.revisions.find(row => row.scopeUuid === scope && row.tableId === current.tableId && row.commitSeq === current.commitSeq
        && Buffer.from(row.rowId).equals(Buffer.from(current.rowId)));
      if (revision === undefined || revision.isTombstone) continue;
      const decoded = await decodeCanonicalFlarexValueEvidenceV1({ canonicalBytes: revision.valueBytes, sha256: revision.valueSha256, profile: "appDocument" });
      result.push(projectNativeRow(Schema.decodeUnknownSync(Schema.JsonObject)(decoded.valueJson)));
    }
    return result;
  };
  return { fixture, fulfillment, pricing, region, stockLocation, locationLinks, providerLinks, priceSetLinks,
    options, modules, execution, link, resources, prepare, prepareRoundtrip, read, snapshot: () => logicalCurrencyInventory(fixture) };
}
