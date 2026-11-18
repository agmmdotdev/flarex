import { Effect } from "effect";
import { updateStockLocationsWorkflow } from "@medusajs/core-flows/stock-location/update-stock-locations";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { StockLocationUpdateInput, StockLocationUpdateWorkflowOutput } from "../../modules/stock-location/update-input";
import type { makeStockLocationUpdateCommands } from "../../modules/stock-location/update-service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

export { StockLocationUpdateInput, StockLocationUpdateWorkflowOutput };
type StockLocation = Effect.Success<ReturnType<typeof makeStockLocationUpdateCommands>>["workflow"];

/** Genuine Address upsert and selector update share one outer settlement. The
 * native undefined result on no matches crosses the existing public null seam. */
export const prepareStockLocationUpdateWorkflow = Effect.fn("StockLocation.prepareUpdate")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly stock_location: InstalledWorkflowModule<StockLocation> };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== 1) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(options.modules, ["stock_location"]));
  const source = workflowModuleDefinition(modules.stock_location.module)?.source;
  if (source?.name !== "flarex-stock-location-update" || source.profile !== "stock-location-update")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    stock_location: { module: modules.stock_location.module,
      methods: ["listStockLocations", "listStockLocationAddresses", "upsertStockLocationAddresses", "updateStockLocations"], graph: true },
  }, true));
  const prepared = yield* Effect.fromResult(updateStockLocationsWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, operationScheduling: "queued", borrowedOperationScheduling: "queued",
    workflow: { name: "updateStockLocationsWorkflow", resources, prepared,
      input: StockLocationUpdateInput, output: StockLocationUpdateWorkflowOutput, events: internalModuleWorkflowEvents } });
});
