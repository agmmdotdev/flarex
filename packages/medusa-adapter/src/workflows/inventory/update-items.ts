import { Effect } from "effect";
import { updateInventoryItemsWorkflow } from "@medusajs/core-flows/inventory/update-inventory-items";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { InventoryItemUpdateInput, InventoryItemUpdateOutput } from "../../modules/inventory/update-input";
import type { makeInventoryItemUpdateCommands } from "../../modules/inventory/update-service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

export { InventoryItemUpdateInput, InventoryItemUpdateOutput };
type Inventory = Effect.Success<ReturnType<typeof makeInventoryItemUpdateCommands>>["workflow"];

/** Native keyed Item updates borrow one confined module under the existing
 * atomic owner. Quantity, reservation and Link mutation APIs are not granted. */
export const prepareInventoryItemUpdateWorkflow = Effect.fn("Inventory.prepareItemUpdate")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly inventory: InstalledWorkflowModule<Inventory> };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== 1) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["inventory"]));
  const source = workflowModuleDefinition(modules.inventory.module)?.source;
  if (source?.name !== "flarex-inventory-local" || source.profile !== "inventory-item-updates")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    inventory: { module: modules.inventory.module, methods: ["listInventoryItems", "updateInventoryItems"], graph: false },
  }, true));
  const prepared = yield* Effect.fromResult(updateInventoryItemsWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules,
    workflow: { name: "updateInventoryItemsWorkflow", resources, prepared,
      input: InventoryItemUpdateInput, output: InventoryItemUpdateOutput, events: internalModuleWorkflowEvents } });
});
