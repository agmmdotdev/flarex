import { Effect, Result, Schema } from "effect";
import { createWorkflow, transform, createHook, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createStockLocationsWorkflow } from "@medusajs/core-flows/stock-location/create-stock-locations";
import { createInventoryLevelsWorkflow } from "@medusajs/core-flows/inventory/create-inventory-levels";
import { StockLocationsInput, StockLocationsOutput } from "../../modules/stock-location/input";
import { InventoryLevelInput, InventoryLevelsOutput } from "../../modules/inventory/level-input";
import type { makeStockLocationCommands } from "../../modules/stock-location/service";
import type { makeLocalInventoryCommands } from "../../modules/inventory/service";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { prepareWorkflowResources, type NativeWorkflowContext, type NativeWorkflowResources } from "../../workflow/resources";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { inventoryStockingResources } from "../../workflow/policy";

const { location_id: _location, ...levelFields } = InventoryLevelInput.fields;
const NewLocationLevel = Schema.Struct({ ...levelFields,
  location_index: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 3 })),
});
export const InventoryStockingInput = Schema.Struct({ locations: StockLocationsInput,
  inventory_levels: Schema.Array(Schema.Union([InventoryLevelInput, NewLocationLevel])).check(Schema.isMaxLength(8)),
}).check(Schema.makeFilter(input => input.inventory_levels.every(level =>
  !("location_index" in level) || level.location_index < input.locations.length)));
export const InventoryStockingOutput = Schema.Struct({ locations: StockLocationsOutput, inventory_levels: InventoryLevelsOutput });
type Inventory = Effect.Success<ReturnType<typeof makeLocalInventoryCommands>>["workflow"];
type StockLocation = Effect.Success<ReturnType<typeof makeStockLocationCommands>>["workflow"];
type Selections = {
  readonly inventory: { readonly module: Inventory; readonly methods: readonly ["createInventoryLevels"]; readonly graph: false };
  readonly stock_location: { readonly module: StockLocation; readonly methods: readonly ["createStockLocations"]; readonly graph: true };
};
type Resources = NativeWorkflowResources<Selections, true>;
export interface InventoryStockingHooks {
  readonly stockLocationsCreated?: (value: { readonly stockLocations: typeof StockLocationsOutput.Type }, context: NativeWorkflowContext<Resources>) => unknown | Promise<unknown>;
  readonly inventoryStocked?: (value: typeof InventoryStockingOutput.Type, context: NativeWorkflowContext<Resources>) => unknown | Promise<unknown>;
}
const decodeLocationHook = commerceDecoder(Schema.Struct({ stockLocations: StockLocationsOutput }), "invalidInput");
const decodeStockHook = commerceDecoder(InventoryStockingOutput, "invalidInput");

/** Two real native workflows borrow one owner. Indexed location references are
 * resolved only from authentic returned identities, never invented business IDs. */
export const prepareInventoryStockingWorkflow = Effect.fn("MedusaWorkflow.prepareInventoryStocking")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly inventory: InstalledWorkflowModule<Inventory>; readonly stock_location: InstalledWorkflowModule<StockLocation> };
  readonly revision: string; readonly subscribers: AtomicCommerceEvents["subscribers"];
  readonly hooks?: InventoryStockingHooks;
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(options.modules, ["inventory", "stock_location"]));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    inventory: { module: modules.inventory.module, methods: ["createInventoryLevels"], graph: false },
    stock_location: { module: modules.stock_location.module, methods: ["createStockLocations"], graph: true },
  }, true));
  const hooks = yield* Effect.fromResult(captureWorkflowRecord(options.hooks ?? {}));
  if (Object.keys(hooks).some(name => !["stockLocationsCreated", "inventoryStocked"].includes(name)) ||
    Object.values(hooks).some(handler => handler !== undefined && typeof handler !== "function"))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const locationHandler = hooks.stockLocationsCreated;
  const stockHandler = hooks.inventoryStocked;
  const locationHooks = locationHandler === undefined ? {} : { stockLocationsCreated: resources.callback((value: unknown, context) =>
    captureCommerceInput(value).pipe(Result.flatMap(decodeLocationHook), Result.match({
      onFailure: error => Promise.reject(error), onSuccess: checked => locationHandler(checked, context),
    }))) };
  const workflow = createWorkflow("stock-inventory", (input: WorkflowData<typeof InventoryStockingInput.Type>) => {
    const locations = createStockLocationsWorkflow.runAsStep({ input: { locations: transform(input.locations, rows => [...rows]) }, hooks: locationHooks });
    const nativeLevels = transform({ locations, levels: input.inventory_levels }, ({ locations, levels }) => levels.map(level => {
      if (!("location_index" in level)) return level;
      const { location_index, ...fields } = level;
      const location = locations[location_index];
      if (location === undefined) throw new Error("Validated location ordinal is missing");
      return { ...fields, location_id: location.id };
    }));
    const inventory_levels = createInventoryLevelsWorkflow.runAsStep({ input: { inventory_levels: nativeLevels } });
    const stocked = createHook("inventoryStocked", { locations, inventory_levels });
    return new WorkflowResponse({ locations, inventory_levels }, { hooks: [stocked] });
  });
  const handlers = stockHandler === undefined ? {} : { inventoryStocked: resources.callback((value: unknown, context) =>
    captureCommerceInput(value).pipe(Result.flatMap(decodeStockHook), Result.match({
      onFailure: error => Promise.reject(error), onSuccess: checked => stockHandler(checked, context),
    }))) };
  const prepared = yield* Effect.fromResult(workflow.prepare(handlers)).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, requestCallLimit: inventoryStockingResources.calls,
    workflow: { name: "stock-inventory", resources, prepared, input: InventoryStockingInput, output: InventoryStockingOutput,
      events: internalModuleWorkflowEvents } });
});
