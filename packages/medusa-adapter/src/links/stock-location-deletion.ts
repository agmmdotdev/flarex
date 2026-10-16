import { Effect, Result, Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import { SalesChannelLocation } from "@medusajs/link-modules";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../value/decoder";
import { defineComposedWorkflowResource } from "../workflow/composed-resource";
import { defineWorkflowModule } from "../workflow/module";
import { captureSalesChannelLocationLinkMetadata } from "./sales-channel-location-schema";
import { prepareLinkService } from "./service";
import { prepareLinkWorkflowService, linkWorkflowServiceDefinition } from "./workflow-service";
import { linkLogicalEventPolicy } from "./events";
import { decodeLinkCascade } from "./cascade-result";

const Ids = Schema.Array(Schema.String.check(Schema.isLengthBetween(1, 256))).pipe(Schema.mutable).check(Schema.isMaxLength(4));
const Endpoint = Schema.Struct({ stock_location: Schema.Struct({
  stock_location_id: Schema.optionalKey(Ids), location_id: Schema.optionalKey(Ids),
}).check(Schema.makeFilter(aliases => {
  const { stock_location_id: native, location_id: authored } = aliases;
  return native === undefined ? authored === undefined : authored !== undefined && native.length === authored.length
    && native.every((id, index) => id === authored[index]);
})) });
const decodeEndpoint = commerceDecoder(Schema.Tuple([Endpoint]), "invalidInput");

/** The actual generated Location identity map reaches the genuine router.
 * Its stock_location_id relationship selects this sole loaded Link family;
 * the authenticated location_id alias supplies no additional deletion. */
export function prepareStockLocationDeletionLinkResource(services: { readonly location: unknown }) {
  return Result.gen(function* () {
    const location = linkWorkflowServiceDefinition(services.location);
    if (location === undefined) return yield* Result.fail(commerceError("invalidAuthority"));
    if (location.admission !== "stock-location-deletions" ||
      location.routing.__joinerConfig.serviceName !== SalesChannelLocation.serviceName)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const softDelete = location.softDeleteMethod, restore = location.restoreMethod;
    if (softDelete === undefined || restore === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    return yield* defineComposedWorkflowResource({ identity: { format: "medusa.stock-location.deletion-links",
      services: [location.routing] }, dependencies: [softDelete, restore],
      methods: { delete: { arguments: decodeEndpoint, output: decodeLinkCascade },
        restore: { arguments: decodeEndpoint, output: decodeLinkCascade } },
      bind: invoke => {
        const loaded = { ...structuredClone(location.routing),
          softDelete: (selector: unknown, config: unknown) => invoke(softDelete, selector, config),
          restore: (selector: unknown, config: unknown) => invoke(restore, selector, config) };
        const native = new Link([loaded]);
        return { delete: input => native.delete(structuredClone(input)), restore: input => native.restore(structuredClone(input)) };
      },
    });
  });
}

/** Exactly the installed noncascading Sales Channel-Location family; endpoint
 * services and unadmitted Fulfillment cascade families are not impersonated. */
export const prepareStockLocationDeletionLinks = Effect.fn("StockLocationDeletionLinks.prepare")(function* () {
  const location = yield* prepareLinkService(yield* captureSalesChannelLocationLinkMetadata(), 8);
  const native = yield* Effect.fromResult(prepareLinkWorkflowService(location, "stockLocationSalesChannelLink", "stock-location-deletions"));
  const softDelete = native.softDeleteMethod, restore = native.restoreMethod;
  const softDeleteCommand = native.softDelete, restoreCommand = native.restore;
  const softDeleteName = native.softDeleteName, restoreName = native.restoreName;
  if (softDelete === undefined || restore === undefined || softDeleteCommand === undefined || restoreCommand === undefined ||
    softDeleteName === undefined || restoreName === undefined)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const nativeServices = { location: native };
  const resource = yield* Effect.fromResult(prepareStockLocationDeletionLinkResource(nativeServices));
  const commands = [native.create, native.list, softDeleteCommand, restoreCommand];
  const logicalEventPolicy = () => linkLogicalEventPolicy(location.prepared.table.name, location.serviceName, location.entityName,
    ["sales_channel_id", "stock_location_id"], [native.createName], [], [softDeleteName], [restoreName]);
  const workflow = yield* Effect.fromResult(defineWorkflowModule({ name: "sales_channel_location_stock_location_deletion_links",
    source: { name: location.serviceName, profile: "stock-location-deletions" }, graph: { aliases: [], reads: [] },
    methods: { create: native.createMethod, list: native.listMethod, softDelete, restore },
    logical: { ...logicalEventPolicy(), commands } }));
  return { location: { workflow, commands, logicalEventPolicy }, nativeServices, resource };
});
