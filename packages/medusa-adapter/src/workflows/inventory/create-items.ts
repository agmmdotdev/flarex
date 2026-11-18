import { Effect, Schema } from "effect";
import { createInventoryItemsWorkflow } from "@medusajs/core-flows/inventory/create-inventory-items";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { InventoryItemInput } from "../../modules/inventory/item-input";
import { InventoryLevelInput } from "../../modules/inventory/level-input";
import { InventoryItemRows } from "../../modules/inventory/item-contracts";
import type { makeInventoryItemCreationCommands } from "../../modules/inventory/create-item-service";
import type { makeStockLocationCommands } from "../../modules/stock-location/service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

const { inventory_item_id: _itemId, ...locationFields } = InventoryLevelInput.fields;
const Locations = Schema.Array(Schema.Struct(locationFields)).pipe(Schema.mutable).check(Schema.isMaxLength(2));
export const InventoryItemCreationItems = Schema.Array(Schema.Struct({ ...InventoryItemInput.fields,
  location_levels: Schema.optionalKey(Locations),
})).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const InventoryItemCreationInput = Schema.Struct({ items: Schema.optionalKey(InventoryItemCreationItems) });
export const InventoryItemCreationOutput = InventoryItemRows;
type Inventory = Effect.Success<ReturnType<typeof makeInventoryItemCreationCommands>>["workflow"];
type StockLocation = Effect.Success<ReturnType<typeof makeStockLocationCommands>>["workflow"];

/** The native ordered Item root always invokes its Level child, including its
 * empty Stock Location query. Only Inventory writes and Location ID reads bind. */
export const prepareInventoryItemCreationWorkflow = Effect.fn("Inventory.prepareItemCreation")(function* (input: {
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
  if (inventory?.name !== "flarex-inventory-local" || inventory.profile !== "inventory-item-creations" ||
    location?.name !== "flarex-stock-location-read" || location.profile !== "stock-location-id-read")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    inventory: { module: modules.inventory.module,
      methods: ["createInventoryItems", "createInventoryLevels", "deleteInventoryItems", "deleteInventoryLevels"], graph: false },
    stock_location: { module: modules.stock_location.module, methods: [], graph: true },
  }, true));
  const prepared = yield* Effect.fromResult(createInventoryItemsWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules,
    workflow: { name: "createInventoryItemsWorkflow", resources, prepared,
      input: InventoryItemCreationInput, output: InventoryItemCreationOutput, events: internalModuleWorkflowEvents } });
});
