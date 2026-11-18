import { Effect, Schema } from "effect";
import { createInventoryLevelsWorkflow } from "@medusajs/core-flows/inventory/create-inventory-levels";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { InventoryLevelInput } from "../../modules/inventory/level-input";
import { InventoryLevelCreatedRows } from "../../modules/inventory/level-contracts";
import type { makeInventoryLevelCreationCommands } from "../../modules/inventory/create-level-service";
import type { makeStockLocationCommands } from "../../modules/stock-location/service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

const Levels = Schema.Array(InventoryLevelInput).pipe(Schema.mutable).check(Schema.isMaxLength(8));
export const InventoryLevelCreationInput = Schema.Struct({ inventory_levels: Levels });
export const InventoryLevelCreationOutput = InventoryLevelCreatedRows;
type Inventory = Effect.Success<ReturnType<typeof makeInventoryLevelCreationCommands>>["workflow"];
type StockLocation = Effect.Success<ReturnType<typeof makeStockLocationCommands>>["workflow"];

/** Existing Items and Locations use the genuine validated Level root. Empty
 * requests retain their Location query and native Inventory creation call. */
export const prepareInventoryLevelCreationWorkflow = Effect.fn("Inventory.prepareLevelCreation")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly inventory: InstalledWorkflowModule<Inventory>; readonly stock_location: InstalledWorkflowModule<StockLocation> };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== 2) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["inventory", "stock_location"]));
  const inventory = workflowModuleDefinition(modules.inventory.module)?.source;
  const location = workflowModuleDefinition(modules.stock_location.module)?.source;
  if (inventory?.name !== "flarex-inventory-local" || inventory.profile !== "inventory-level-creations" ||
    location?.name !== "flarex-stock-location-read" || location.profile !== "stock-location-id-read")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    inventory: { module: modules.inventory.module, methods: ["createInventoryLevels", "deleteInventoryLevels"], graph: false },
    stock_location: { module: modules.stock_location.module, methods: [], graph: true },
  }, true));
  const prepared = yield* Effect.fromResult(createInventoryLevelsWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules,
    workflow: { name: "createInventoryLevelsWorkflow", resources, prepared,
      input: InventoryLevelCreationInput, output: InventoryLevelCreationOutput, events: internalModuleWorkflowEvents } });
});
