import { Effect } from "effect";
import { deleteInventoryItemWorkflow } from "@medusajs/core-flows/inventory/delete-inventory-items";
import { ProductVariantInventoryItem } from "@medusajs/link-modules";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { InventoryItemDeletionInput } from "../../modules/inventory/delete-item-input";
import type { makeInventoryItemDeletionCommands } from "../../modules/inventory/delete-item-service";
import type { prepareInventoryItemDeletionLinks } from "../../links/inventory-item-deletion";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

export { InventoryItemDeletionInput };
type Inventory = Effect.Success<ReturnType<typeof makeInventoryItemDeletionCommands>>["workflow"];
type Links = Effect.Success<ReturnType<typeof prepareInventoryItemDeletionLinks>>;

/** The genuine root guards computed active-Level reservations, cascades native
 * Inventory lifecycle and removes matching rich Links. It returns raw IDs. */
export const prepareInventoryItemDeletionWorkflow = Effect.fn("Inventory.prepareItemDeletion")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: {
    readonly inventory: InstalledWorkflowModule<Inventory>;
    readonly inventory_item_links: InstalledWorkflowModule<Links["inventory"]["workflow"]>;
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
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["inventory", "inventory_item_links"]));
  for (const [module, name] of [
    [modules.inventory.module, "flarex-inventory-local"],
    [modules.inventory_item_links.module, ProductVariantInventoryItem.serviceName],
  ] as const) {
    const definition = workflowModuleDefinition(module);
    if (definition === undefined || definition.source.name !== name || definition.source.profile !== "inventory-item-deletions")
      return yield* Effect.fail(commerceError("invalidAuthority"));
  }
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    inventory: { module: modules.inventory.module, methods: ["softDeleteInventoryItems", "restoreInventoryItems"], graph: true },
    inventory_item_links: { module: modules.inventory_item_links.module, methods: ["softDelete", "restore"], graph: false, expose: false },
  }, true, { link: options.link }));
  const prepared = yield* Effect.fromResult(deleteInventoryItemWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, operationScheduling: "queued",
    workflow: { name: "deleteInventoryItemWorkflow", resources, prepared,
      input: InventoryItemDeletionInput, output: InventoryItemDeletionInput, events: internalModuleWorkflowEvents } });
});
