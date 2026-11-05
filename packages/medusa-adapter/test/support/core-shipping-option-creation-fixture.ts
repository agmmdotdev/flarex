import { createHash, randomUUID } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createShippingOptionsWorkflow } from "@medusajs/core-flows/fulfillment/create-shipping-options";
import { defineCommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { makeStockLocationCommands } from "../../src/modules/stock-location/service";
import { compileStockLocationCoreDefinition } from "../../src/modules/stock-location/schema";
import { makeLocalShippingOptionCreationCommands } from "../../src/modules/fulfillment/shipping-option-create-service";
import { compileServiceZoneCreationCoreDefinition } from "../../src/modules/fulfillment/shipping-profile-schema";
import { makeLocalPricingCommands } from "../../src/modules/pricing/service";
import { compilePricingCoreDefinition } from "../../src/modules/pricing/schema";
import { makeLocalRegionReadCommands } from "../../src/modules/region/service";
import { compileRegionCoreDefinition } from "../../src/modules/region/schema";
import { prepareLocationFulfillmentSetLinkRead } from "../../src/links/location-fulfillment-set-service";
import { compileLocationFulfillmentSetLinkCoreDefinition } from "../../src/links/location-fulfillment-set-schema";
import { prepareLocationFulfillmentProviderLink } from "../../src/links/location-fulfillment-provider-service";
import { compileLocationFulfillmentProviderLinkCoreDefinition } from "../../src/links/location-fulfillment-provider-schema";
import { prepareShippingOptionPriceSetLink, prepareShippingOptionCreationLinkResource } from "../../src/links/shipping-option-price-set-service";
import { compileShippingOptionPriceSetLinkCoreDefinition } from "../../src/links/shipping-option-price-set-schema";
import { prepareShippingOptionCreationWorkflow, ShippingOptionCreationInput, prepareShippingOptionCreationResources,
  shippingOptionCreationEvents } from "../../src/workflows/fulfillment/create-shipping-options";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { shippingOptionCreationResources } from "../../src/workflow/policy";
import { createCoreNativeWorkflowFixture, shareCoreNativeWorkflowPhysical } from "./core-native-workflow-fixture";
import { orderFixtureHosts } from "./core-order-fixture";
import { shippingOptionCreationRows, shippingOptionParents, type ShippingOptionRetained } from "./shipping-option-creation-fixture-data";

const revision = createHash("sha256").update("native-shipping-option-creation-138").digest("hex");
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

/** The complete ordinary native root borrows seven sources from one Core owner. */
export async function prepareCoreShippingOptionCreation(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  settings: Readonly<{ physical?: CorePersistenceFixture; historicalParents?: boolean }> = {}) {
  const target = { scopeUuid: randomUUID(), epochUuid: randomUUID() };
  const [fulfillment, pricing, region, stockLocation, locationLinks, providerLinks, priceSetLinks] = await Effect.runPromise(Effect.all([
    makeLocalShippingOptionCreationCommands(), makeLocalPricingCommands("shipping-options"), makeLocalRegionReadCommands(),
    makeStockLocationCommands("read"), prepareLocationFulfillmentSetLinkRead(), prepareLocationFulfillmentProviderLink(), prepareShippingOptionPriceSetLink(),
  ]));
  const definitions = await Effect.runPromise(Effect.all({
    fulfillment: compileServiceZoneCreationCoreDefinition(target), pricing: compilePricingCoreDefinition(target), region: compileRegionCoreDefinition(target),
    stock_location: compileStockLocationCoreDefinition(target), locationLinks: compileLocationFulfillmentSetLinkCoreDefinition(target),
    providerLinks: compileLocationFulfillmentProviderLinkCoreDefinition(target), priceSetLinks: compileShippingOptionPriceSetLinkCoreDefinition(target),
  }));
  const seed = shippingOptionCreationRows(settings.historicalParents);
  const eventDefinition = await Effect.runPromise(compileCoreNativeEventStorageDefinition(target));
  const fixture = await createCoreNativeWorkflowFixture(driver, { eventDefinition,
    ...(settings.physical === undefined ? {} : { physical: await shareCoreNativeWorkflowPhysical(settings.physical) }), sources: [
      { name: "fulfillment", definition: definitions.fulfillment, initialCommands: fulfillment.commands, rows: seed.fulfillment },
      { name: "pricing", definition: definitions.pricing, initialCommands: pricing.commands, rows: seed.pricing },
      { name: "region", definition: definitions.region, initialCommands: region.commands, rows: seed.region },
      { name: "stock_location", definition: definitions.stock_location, initialCommands: stockLocation.commands, rows: seed.stock_location },
      { name: "locationLinks", initializationStepId: "location-links-initial", definition: definitions.locationLinks, initialCommands: locationLinks.commands, rows: seed.locationLinks },
      { name: "providerLinks", initializationStepId: "provider-links-initial", definition: definitions.providerLinks, initialCommands: providerLinks.commands, rows: seed.providerLinks },
      { name: "priceSetLinks", initializationStepId: "price-set-links-initial", definition: definitions.priceSetLinks, initialCommands: priceSetLinks.commands, rows: seed.priceSetLinks },
    ] });
  close(fixture.close);
  const { own, closeCaseHosts } = orderFixtureHosts(close);
  const modules = {
    fulfillment: { module: fulfillment.workflow, nativeStorage: fixture.source("fulfillment") },
    pricing: { module: pricing.workflow, nativeStorage: fixture.source("pricing") },
    region: { module: region.workflow, nativeStorage: fixture.source("region") },
    stockLocation: { module: stockLocation.workflow, nativeStorage: fixture.source("stock_location") },
    locationLinks: { module: locationLinks.workflow, nativeStorage: fixture.source("locationLinks") },
    providerLinks: { module: providerLinks.workflow, nativeStorage: fixture.source("providerLinks") },
    priceSetLinks: { module: priceSetLinks.workflow, nativeStorage: fixture.source("priceSetLinks") },
  };
  const link = Result.getOrThrow(prepareShippingOptionCreationLinkResource({ location: locationLinks.nativeService,
    provider: providerLinks.nativeService, pricing: priceSetLinks.nativeService }));
  const options = { execution: fixture.execution, modules, link, revision,
    subscribers: [{ id: "native-shipping-option-create", revision: "8".repeat(64) }] };
  const prepare = async () => own(await Effect.runPromise(prepareShippingOptionCreationWorkflow(options)));
  const resources = Result.getOrThrow(prepareShippingOptionCreationResources({ fulfillment: fulfillment.workflow, pricing: pricing.workflow,
    region: region.workflow, stockLocation: stockLocation.workflow, locationLinks: locationLinks.workflow,
    providerLinks: providerLinks.workflow, priceSetLinks: priceSetLinks.workflow }, link));
  const prepareRoundtrip = async (actualRetained: () => ShippingOptionRetained, lateFailure = false) => {
    const inverse = createStep("probe-native-shipping-option-inverses", resources.callback(async (_input: null, context) => {
      const actual = actualRetained();
      await undo.event(actual.event, context); await undo.links(actual.links, context);
      await undo.pricing(actual.pricing, context); await undo.creation(actual.creation, context);
      if (lateFailure) throw new Error("Late native Shipping Option inverse failure");
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-native-shipping-option-roundtrip", (value: WorkflowData<typeof ShippingOptionCreationInput.Type>) => {
      // SAFETY: the admitted runtime grammar preserves the native composer's
      // missing-prices branch and readonly inputs beyond the public DTO.
      const root = createShippingOptionsWorkflow.runAsStep({ input: value as NativeCreationInput });
      return new WorkflowResponse(inverse(transform(root, () => null)));
    });
    const installed = Object.fromEntries(Object.entries(modules).map(([key, value]) => [key, { ...value, logicalResources: shippingOptionCreationResources }]));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: installed, operationScheduling: "queued",
      requestCallLimit: shippingOptionCreationResources.calls, requestEventLimit: shippingOptionCreationResources.eventMessages,
      requestByteLimit: shippingOptionCreationResources.commandBytes,
      workflow: { name: "probeNativeShippingOptionInverses", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: ShippingOptionCreationInput, output: Schema.Null, events: shippingOptionCreationEvents(fulfillment.workflow, fulfillment.contracts) } })));
  };
  const prepareParentRemoval = async (kind: "profile" | "type") => {
    const table = kind === "profile" ? "shipping_profile" : "shipping_option_type", id = kind === "profile" ? shippingOptionParents.profile : shippingOptionParents.type;
    const command = defineCommerceCommand("shippingOptionCreationRemoveParent" + kind, "write", Effect.fn(function* (ctx, input) {
      const selected = yield* Schema.decodeUnknownEffect(Schema.Literal(id))(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
      return [...yield* (yield* ctx.table(table)).delete(ctx.manager, [{ id: selected }])];
    }));
    const host = own(await fixture.run(fixture.openWriteHost("fulfillment", [command])));
    return { newRequestKey: host.newRequestKey, run: (key: string) => host.run(key, command, id) };
  };
  return { fixture, fulfillment, pricing, region, stockLocation, locationLinks, providerLinks, priceSetLinks,
    options, modules, installed: modules, execution: fixture.execution, link, resources, definitions,
    prepare, prepareRoundtrip, prepareParentRemoval, closeCaseHosts, read: () => fixture.readRows(), snapshot: fixture.snapshot };
}
