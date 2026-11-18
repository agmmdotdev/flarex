import { Effect, Schema } from "effect";
import { deleteInventoryLevelsWorkflow } from "@medusajs/core-flows/inventory/delete-inventory-levels";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { InventoryLevelDeletionInput } from "../../modules/inventory/delete-level-input";
import type { makeInventoryLevelDeletionCommands } from "../../modules/inventory/delete-level-service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

export { InventoryLevelDeletionInput };
type Inventory = Effect.Success<ReturnType<typeof makeInventoryLevelDeletionCommands>>["workflow"];

/** The genuine graph query and quantity guard select Level identities before
 * native soft deletion under the existing outer atomic settlement. */
export const prepareInventoryLevelDeletionWorkflow = Effect.fn("Inventory.prepareLevelDeletion")(function* (input: {
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
  if (source?.name !== "flarex-inventory-local" || source.profile !== "inventory-level-deletions")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    inventory: { module: modules.inventory.module, methods: ["softDeleteInventoryLevels", "restoreInventoryLevels"], graph: true },
  }, true));
  const prepared = yield* Effect.fromResult(deleteInventoryLevelsWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules,
    workflow: { name: "deleteInventoryLevelsWorkflow", resources, prepared,
      input: InventoryLevelDeletionInput, output: Schema.Null, events: internalModuleWorkflowEvents } });
});
