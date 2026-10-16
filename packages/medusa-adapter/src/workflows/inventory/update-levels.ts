import { Effect } from "effect";
import { updateInventoryLevelsWorkflow } from "@medusajs/core-flows/inventory/update-inventory-levels";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { InventoryLevelUpdateInput, InventoryLevelUpdateOutput } from "../../modules/inventory/update-level-input";
import type { makeInventoryLevelUpdateCommands } from "../../modules/inventory/update-level-service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

export { InventoryLevelUpdateInput, InventoryLevelUpdateOutput };
type Inventory = Effect.Success<ReturnType<typeof makeInventoryLevelUpdateCommands>>["workflow"];

/** Native absolute Level updates retain pair lookup and caller ID precedence
 * through one confined module and the existing atomic settlement owner. */
export const prepareInventoryLevelUpdateWorkflow = Effect.fn("Inventory.prepareLevelUpdate")(function* (input: {
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
  if (source?.name !== "flarex-inventory-local" || source.profile !== "inventory-level-updates")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    inventory: { module: modules.inventory.module, methods: ["listInventoryLevels", "updateInventoryLevels"], graph: false },
  }, true));
  const prepared = yield* Effect.fromResult(updateInventoryLevelsWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules,
    workflow: { name: "updateInventoryLevelsWorkflow", resources, prepared,
      input: InventoryLevelUpdateInput, output: InventoryLevelUpdateOutput, events: internalModuleWorkflowEvents } });
});
