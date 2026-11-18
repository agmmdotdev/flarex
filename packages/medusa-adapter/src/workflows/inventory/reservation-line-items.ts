import { Effect, Schema } from "effect";
import { deleteReservationsByLineItemsWorkflow } from "@medusajs/core-flows/reservation/delete-reservations-by-line-items";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { makeInventoryReservationLineItemCommands } from "../../modules/inventory/reservation-line-item-service";
import { ReservationLineItemIds } from "../../modules/inventory/reservation-line-item-input";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { captureInstalledWorkflowModules, prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";
import { internalModuleWorkflowEvents } from "../../workflow/events";

type Inventory = Effect.Success<ReturnType<typeof makeInventoryReservationLineItemCommands>>["workflow"];
export const ReservationLineItemDeletionInput = Schema.Struct({ ids: ReservationLineItemIds });

/** Native Line Item selectors borrow the existing exclusive stock lifetime.
 * The root has no Locking provider, external side effect or settlement power. */
export const prepareDeleteReservationsByLineItemsWorkflow = Effect.fn("Inventory.prepareReservationLineItemDeletion")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly inventory: InstalledWorkflowModule<Inventory>;
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(name => !["execution", "inventory", "revision", "subscribers"].includes(name)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules({ inventory: options.inventory }, ["inventory"]));
  const definition = workflowModuleDefinition(modules.inventory.module);
  if (definition?.source.name !== "flarex-inventory-local" || definition.source.profile !== "inventory-reservation-line-items")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ inventory: {
    module: modules.inventory.module, methods: ["deleteReservationItemsByLineItem", "restoreReservationItemsByLineItem"], graph: false,
  } }, true));
  const prepared = yield* Effect.fromResult(deleteReservationsByLineItemsWorkflow.prepare());
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, modules, revision: options.revision,
    subscribers: options.subscribers, executionIsolation: "scopeExclusive",
    workflow: { name: "deleteReservationsByLineItemsWorkflow", resources, prepared,
      input: ReservationLineItemDeletionInput, output: Schema.Null, events: internalModuleWorkflowEvents } });
});
