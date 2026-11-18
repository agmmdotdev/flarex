import { Effect, Result, Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import { SalesChannelLocation, getModuleService } from "@medusajs/link-modules";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../value/decoder";
import { fulfillmentSetDeletionServiceDefinition, type makeFulfillmentSetDeletionCommands } from "../modules/fulfillment/fulfillment-set-delete-service";
import { prepareLocationFulfillmentSetDeletionLinks, captureLocationFulfillmentSetDeletionService } from "./location-fulfillment-set-deletion";
import { captureCommerceInput } from "../value/input";
import { defineComposedWorkflowResource } from "../workflow/composed-resource";
import { defineWorkflowModule } from "../workflow/module";
import { captureSalesChannelLocationLinkMetadata } from "./sales-channel-location-schema";
import { prepareLinkService } from "./service";
import { prepareLinkWorkflowService, linkWorkflowServiceDefinition } from "./workflow-service";
import { linkLogicalEventPolicy } from "./events";
import { decodeLinkCascade } from "./cascade-result";
import { prepareLocationFulfillmentProviderLink } from "./location-fulfillment-provider-service";
import { prepareShippingOptionPriceSetLink } from "./shipping-option-price-set-service";
import { captureShippingDeletionServices } from "./shipping-deletion-services";

const Ids = Schema.Array(Schema.String.check(Schema.isLengthBetween(1, 256))).pipe(Schema.mutable).check(Schema.isMaxLength(4));
const Endpoint = Schema.Struct({ stock_location: Schema.Struct({
  stock_location_id: Schema.optionalKey(Ids), location_id: Schema.optionalKey(Ids),
}).check(Schema.makeFilter(aliases => {
  const { stock_location_id: native, location_id: authored } = aliases;
  return native === undefined ? authored === undefined : authored !== undefined && native.length === authored.length
    && native.every((id, index) => id === authored[index]);
})) });
const decodeEndpoint = commerceDecoder(Schema.Tuple([Endpoint]), "invalidInput");
const nativeLocationJoiner = getModuleService(SalesChannelLocation).prototype.__joinerConfig();

/** The actual generated Location identity map reaches the genuine router.
 * Its stock_location_id relationship selects both installed Link families;
 * the authenticated location_id alias supplies no additional deletion. */
export function prepareStockLocationDeletionLinkResource(services: { readonly location: unknown; readonly fulfillmentSet: unknown;
  readonly provider: unknown; readonly priceSet: unknown; readonly pricing: unknown }, fulfillment: Effect.Success<ReturnType<typeof makeFulfillmentSetDeletionCommands>>["workflow"]) {
  return Result.gen(function* () {
    const location = linkWorkflowServiceDefinition(services.location);
    const set = yield* captureLocationFulfillmentSetDeletionService(services.fulfillmentSet, "stock-location-deletions");
    const endpoint = fulfillmentSetDeletionServiceDefinition(fulfillment);
    const shipping = yield* captureShippingDeletionServices(services);
    if (location === undefined || endpoint === undefined) return yield* Result.fail(commerceError("invalidAuthority"));
    if (location.admission !== "stock-location-deletions" ||
      location.routing.__joinerConfig.serviceName !== SalesChannelLocation.serviceName)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const actual = yield* captureCommerceInput(location.routing.__joinerConfig), expected = yield* captureCommerceInput(nativeLocationJoiner);
    if (!jsonEqual(actual, expected)) return yield* Result.fail(commerceError("unsupportedProfile"));
    const softDelete = location.softDeleteMethod, restore = location.restoreMethod;
    const setSoftDelete = set.softDeleteMethod, setRestore = set.restoreMethod;
    if (softDelete === undefined || restore === undefined || setSoftDelete === undefined || setRestore === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    return yield* defineComposedWorkflowResource({ identity: { format: "medusa.stock-location.deletion-links",
      services: [location.routing, set.routing, endpoint.routing, ...shipping.routing], lifecycle: set.lifecycle },
      dependencies: [softDelete, restore, setSoftDelete, setRestore, endpoint.softDelete, endpoint.restore, ...shipping.dependencies],
      methods: { delete: { arguments: decodeEndpoint, output: decodeLinkCascade },
        restore: { arguments: decodeEndpoint, output: decodeLinkCascade } },
      bind: invoke => {
        const loaded = { ...structuredClone(location.routing),
          softDelete: (selector: unknown, config: unknown) => invoke(softDelete, selector, config),
          restore: (selector: unknown, config: unknown) => invoke(restore, selector, config) };
        const loadedSet = { ...structuredClone(set.routing),
          softDelete: (selector: unknown, config: unknown) => invoke(setSoftDelete, selector, config),
          restore: (selector: unknown, config: unknown) => invoke(setRestore, selector, config) };
        const loadedEndpoint = { ...structuredClone(endpoint.routing),
          softDeleteFulfillmentSets: (selector: unknown, config: unknown) => invoke(endpoint.softDelete, selector, config),
          restoreFulfillmentSets: (selector: unknown, config: unknown) => invoke(endpoint.restore, selector, config) };
        const native = new Link([loaded, loadedSet, loadedEndpoint, ...shipping.bind(invoke)]);
        return { delete: input => native.delete(structuredClone(input)), restore: input => native.restore(structuredClone(input)) };
      },
    });
  });
}

/** Both installed native Link families and their genuine Fulfillment endpoint
 * lifecycle share this scoped Stock Location composition. */
export const prepareStockLocationDeletionLinks = Effect.fn("StockLocationDeletionLinks.prepare")(function* (fulfillment: Effect.Success<ReturnType<typeof makeFulfillmentSetDeletionCommands>>["workflow"], pricing: unknown) {
  const location = yield* prepareLinkService(yield* captureSalesChannelLocationLinkMetadata(), 8);
  const native = yield* Effect.fromResult(prepareLinkWorkflowService(location, "stockLocationSalesChannelLink", "stock-location-deletions"));
  const softDelete = native.softDeleteMethod, restore = native.restoreMethod;
  const softDeleteCommand = native.softDelete, restoreCommand = native.restore;
  const softDeleteName = native.softDeleteName, restoreName = native.restoreName;
  if (softDelete === undefined || restore === undefined || softDeleteCommand === undefined || restoreCommand === undefined ||
    softDeleteName === undefined || restoreName === undefined)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const fulfillmentSet = yield* prepareLocationFulfillmentSetDeletionLinks("stock-location-deletions", "stockLocationFulfillmentSetLink");
  const provider = yield* prepareLocationFulfillmentProviderLink(), priceSet = yield* prepareShippingOptionPriceSetLink();
  const nativeServices = { location: native, fulfillmentSet: fulfillmentSet.nativeService, provider: provider.nativeService, priceSet: priceSet.nativeService, pricing };
  const resource = yield* Effect.fromResult(prepareStockLocationDeletionLinkResource(nativeServices, fulfillment));
  const commands = [native.create, native.list, softDeleteCommand, restoreCommand];
  const logicalEventPolicy = () => linkLogicalEventPolicy(location.prepared.table.name, location.serviceName, location.entityName,
    ["sales_channel_id", "stock_location_id"], [native.createName], [], [softDeleteName], [restoreName]);
  const workflow = yield* Effect.fromResult(defineWorkflowModule({ name: "sales_channel_location_stock_location_deletion_links",
    source: { name: location.serviceName, profile: "stock-location-deletions" }, graph: { aliases: [], reads: [] },
    methods: { create: native.createMethod, list: native.listMethod, softDelete, restore },
    logical: { ...logicalEventPolicy(), commands } }));
  return { location: { workflow, commands, logicalEventPolicy }, fulfillmentSet, provider, priceSet, nativeServices, resource };
});
