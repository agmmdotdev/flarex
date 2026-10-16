import { Effect, Result, Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import { ProductSalesChannel, SalesChannelLocation } from "@medusajs/link-modules";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../value/decoder";
import { defineComposedWorkflowResource } from "../workflow/composed-resource";
import { defineWorkflowModule } from "../workflow/module";
import { captureProductSalesChannelLinkMetadata } from "./product-sales-channel-schema";
import { captureSalesChannelLocationLinkMetadata } from "./sales-channel-location-schema";
import { prepareLinkService } from "./service";
import { prepareLinkWorkflowService, linkWorkflowServiceDefinition } from "./workflow-service";
import { linkLogicalEventPolicy } from "./events";
import { decodeLinkCascade } from "./cascade-result";

const Ids = Schema.Array(Schema.String.check(Schema.isLengthBetween(1, 256))).pipe(Schema.mutable).check(Schema.isMaxLength(4));
const decodeEndpoint = commerceDecoder(Schema.Tuple([Schema.Struct({
  sales_channel: Schema.Struct({ sales_channel_id: Ids }),
})]), "invalidInput");

/** The original native router owns both non-cascading Link families. Each
 * callback invokes an issuer-authenticated borrowed method, with no DAL or
 * settlement authority exposed by this resource. */
export function prepareSalesChannelDeletionLinkResource(services: { readonly sales: unknown; readonly location: unknown }) {
  return Result.gen(function* () {
    const sales = linkWorkflowServiceDefinition(services.sales), location = linkWorkflowServiceDefinition(services.location);
    if (sales === undefined || location === undefined) return yield* Result.fail(commerceError("invalidAuthority"));
    if (sales.admission !== "sales-channel-deletions" || location.admission !== "sales-channel-deletions" ||
      sales.routing.__joinerConfig.serviceName !== ProductSalesChannel.serviceName ||
      location.routing.__joinerConfig.serviceName !== SalesChannelLocation.serviceName)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const salesDelete = sales.softDeleteMethod, salesRestore = sales.restoreMethod;
    const locationDelete = location.softDeleteMethod, locationRestore = location.restoreMethod;
    if (salesDelete === undefined || salesRestore === undefined || locationDelete === undefined || locationRestore === undefined)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    return yield* defineComposedWorkflowResource({ identity: { format: "medusa.sales-channel.deletion-links",
      services: [sales.routing, location.routing] },
      dependencies: [salesDelete, salesRestore, locationDelete, locationRestore],
      methods: { delete: { arguments: decodeEndpoint, output: decodeLinkCascade },
        restore: { arguments: decodeEndpoint, output: decodeLinkCascade } },
      bind: invoke => {
        const loaded = [
          { ...structuredClone(sales.routing),
            softDelete: (selector: unknown, config: unknown) => invoke(salesDelete, selector, config),
            restore: (selector: unknown, config: unknown) => invoke(salesRestore, selector, config) },
          { ...structuredClone(location.routing),
            softDelete: (selector: unknown, config: unknown) => invoke(locationDelete, selector, config),
            restore: (selector: unknown, config: unknown) => invoke(locationRestore, selector, config) },
        ];
        const native = new Link(loaded);
        return { delete: input => native.delete(structuredClone(input)), restore: input => native.restore(structuredClone(input)) };
      },
    });
  });
}

/** Named lifecycle admission constructs exactly Product-Sales Channel and
 * Sales Channel-Stock Location; unrelated Product cascade modules never load. */
export const prepareSalesChannelDeletionLinks = Effect.fn("SalesChannelDeletionLinks.prepare")(function* () {
  const sales = yield* prepareLinkService(yield* captureProductSalesChannelLinkMetadata(), 8);
  const location = yield* prepareLinkService(yield* captureSalesChannelLocationLinkMetadata(), 8);
  const salesNative = yield* Effect.fromResult(prepareLinkWorkflowService(sales, "salesChannelProductLink", "sales-channel-deletions"));
  const locationNative = yield* Effect.fromResult(prepareLinkWorkflowService(location, "salesChannelLocationLink", "sales-channel-deletions"));
  const salesDelete = salesNative.softDeleteMethod, salesRestore = salesNative.restoreMethod;
  const locationDelete = locationNative.softDeleteMethod, locationRestore = locationNative.restoreMethod;
  const salesDeleteCommand = salesNative.softDelete, salesRestoreCommand = salesNative.restore;
  const locationDeleteCommand = locationNative.softDelete, locationRestoreCommand = locationNative.restore;
  if (salesDelete === undefined || salesRestore === undefined || locationDelete === undefined || locationRestore === undefined ||
    salesDeleteCommand === undefined || salesRestoreCommand === undefined || locationDeleteCommand === undefined || locationRestoreCommand === undefined)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const nativeServices = { sales: salesNative, location: locationNative };
  const resource = yield* Effect.fromResult(prepareSalesChannelDeletionLinkResource(nativeServices));
  const salesDeleteName = salesNative.softDeleteName, salesRestoreName = salesNative.restoreName;
  const locationDeleteName = locationNative.softDeleteName, locationRestoreName = locationNative.restoreName;
  if (salesDeleteName === undefined || salesRestoreName === undefined || locationDeleteName === undefined || locationRestoreName === undefined)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const salesCommands = [salesNative.create, salesNative.list, salesDeleteCommand, salesRestoreCommand];
  const locationCommands = [locationNative.create, locationNative.list, locationDeleteCommand, locationRestoreCommand];
  const salesPolicy = () => linkLogicalEventPolicy(sales.prepared.table.name, sales.serviceName, sales.entityName,
    ["product_id", "sales_channel_id"], [salesNative.createName], [], [salesDeleteName], [salesRestoreName]);
  const locationPolicy = () => linkLogicalEventPolicy(location.prepared.table.name, location.serviceName, location.entityName,
    ["sales_channel_id", "stock_location_id"], [locationNative.createName], [], [locationDeleteName], [locationRestoreName]);
  const graph = { aliases: [], reads: [] };
  const salesWorkflow = yield* Effect.fromResult(defineWorkflowModule({ name: "product_sales_channel_deletion_links",
    source: { name: "flarex-product-links", profile: "sales-channel-deletions" }, graph,
    methods: { create: salesNative.createMethod, list: salesNative.listMethod,
      softDelete: salesDelete, restore: salesRestore }, logical: { ...salesPolicy(), commands: salesCommands } }));
  const locationWorkflow = yield* Effect.fromResult(defineWorkflowModule({ name: "sales_channel_location_deletion_links",
    source: { name: location.serviceName, profile: "sales-channel-deletions" }, graph,
    methods: { create: locationNative.createMethod, list: locationNative.listMethod,
      softDelete: locationDelete, restore: locationRestore }, logical: { ...locationPolicy(), commands: locationCommands } }));
  return { sales: { workflow: salesWorkflow, commands: salesCommands, logicalEventPolicy: salesPolicy },
    location: { workflow: locationWorkflow, commands: locationCommands, logicalEventPolicy: locationPolicy },
    nativeServices, resource };
});
