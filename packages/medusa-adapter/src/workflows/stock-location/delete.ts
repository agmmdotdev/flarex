import { Effect, Schema } from "effect";
import { deleteStockLocationsWorkflow } from "@medusajs/core-flows/stock-location/delete-stock-locations";
import { SalesChannelLocation } from "@medusajs/link-modules";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { StockLocationDeletionIds } from "../../modules/stock-location/delete-input";
import type { makeStockLocationDeletionCommands } from "../../modules/stock-location/delete-service";
import type { prepareStockLocationDeletionLinks } from "../../links/stock-location-deletion";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

type StockLocation = Effect.Success<ReturnType<typeof makeStockLocationDeletionCommands>>["workflow"];
type Links = Effect.Success<ReturnType<typeof prepareStockLocationDeletionLinks>>;
export const StockLocationDeletionInput = Schema.Struct({ ids: StockLocationDeletionIds });

/** The genuine module's returned map selects the one installed native Link
 * family. Addresses and other endpoints receive no mutation capability. */
export const prepareStockLocationDeletionWorkflow = Effect.fn("StockLocation.prepareDeletion")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: {
    readonly stock_location: InstalledWorkflowModule<StockLocation>;
    readonly sales_channel_location_links: InstalledWorkflowModule<Links["location"]["workflow"]>;
  };
  readonly link: Links["resource"];
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "link", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== 2) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["stock_location", "sales_channel_location_links"]));
  for (const [module, name, profile] of [
    [modules.stock_location.module, "flarex-stock-location-delete", "stock-location-delete"],
    [modules.sales_channel_location_links.module, SalesChannelLocation.serviceName, "stock-location-deletions"],
  ] as const) {
    const definition = workflowModuleDefinition(module);
    if (definition === undefined || definition.source.name !== name || definition.source.profile !== profile)
      return yield* Effect.fail(commerceError("invalidAuthority"));
  }
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    stock_location: { module: modules.stock_location.module, methods: ["softDeleteStockLocations", "restoreStockLocations"], graph: false },
    sales_channel_location_links: { module: modules.sales_channel_location_links.module,
      methods: ["softDelete", "restore"], graph: false, expose: false },
  }, true, { link: options.link }));
  const prepared = yield* Effect.fromResult(deleteStockLocationsWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, operationScheduling: "queued",
    workflow: { name: "deleteStockLocationsWorkflow", resources, prepared,
      input: StockLocationDeletionInput, output: Schema.Null, events: internalModuleWorkflowEvents } });
});
