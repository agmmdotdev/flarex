import { Effect, Result } from "effect";
import { InventoryItem, InventoryLevel, ReservationItem } from "@medusajs/inventory/models";
import { InventoryModuleService, InventoryLevelService } from "@medusajs/inventory/services";
import { Modules } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defineCommerceModule } from "../../module/definition";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { commerceCommandPreparation, commerceServiceCommands } from "../../module/commands";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { captureInventoryMetadata } from "./schema";
import { compileInventoryConfirmationContracts, decodeInventoryConfirmation, decodeInventoryConfirmationArguments,
  decodeInventoryConfirmationOutput } from "./confirmation-input";
import { prepareInventoryConfirmationRepository } from "./confirmation-repository";
import { inventoryConfirmationPolicy } from "./confirmation-receipt";
import { makeInventoryConfirmationResource } from "./confirmation-resource";

/** A confirmation-only native module borrows the existing command lifetime.
 * Only Item reads and native Level availability are installed; every data
 * mutation, reservation operation and module event remains denied. */
export const makeInventoryConfirmationCommands = Effect.fn("InventoryAdapter.confirmationCommands")(function* () {
  const metadata = yield* captureInventoryMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const contracts = yield* compileInventoryConfirmationContracts(metadata.frame.tables);
    const prepared = yield* prepareInventoryConfirmationRepository(contracts);
    const bind = (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = prepared.bind(ctx, owner);
      return { ...bound, baseRepository: bound.itemRepository,
        repository: (model: typeof InventoryItem | typeof InventoryLevel | typeof ReservationItem) =>
          model === InventoryItem ? bound.itemRepository : model === InventoryLevel ? bound.levelRepository : bound.denied,
        events: bound.mutationEvents,
        eventBus: { emit: bound.refuse, subscribe: () => owner.reject(commerceError("unadmittedEvent")),
          unsubscribe: () => owner.reject(commerceError("unadmittedEvent")), releaseGroupedEvents: bound.refuse, clearGroupedEvents: bound.refuse } };
    };
    const module = yield* defineCommerceModule({ name: "flarex-inventory-local", models: [InventoryItem, InventoryLevel, ReservationItem],
      profile: { name: "inventory-confirmation", capabilities: [], bind },
      extensions: { inventoryLevelService: { mode: "replace", create: ({ binding, persistence }) => {
        const container = { inventoryLevelRepository: binding.levelRepository, modulePersistenceAdapter: persistence };
        return new InventoryLevelService(container);
      } } },
      service: ({ binding, dependencies, context }) => {
        // Native MedusaService receives the full container even though this
        // module's declared local dependencies omit its inherited event bus.
        const container = { ...dependencies, [Modules.EVENT_BUS]: binding.eventBus };
        const native = new InventoryModuleService(container, { scope: "internal" });
        return { service: { confirmInventory: native.confirmInventory.bind(native) }, context };
      },
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const confirm = commerceServiceCommands(module.use).read("inventoryConfirmForWorkflow",
      commerceCommandPreparation("Inventory.prepareConfirmation")(decodeInventoryConfirmation),
      ({ service, context }, input) => service.confirmInventory(input.inventory_item_id, [...input.location_ids], input.quantity, context));
    const confirmInventory = yield* defineWorkflowMethod({ command: confirm, arguments: decodeInventoryConfirmationArguments,
      encode: ([inventory_item_id, location_ids, quantity]) => ({ inventory_item_id, location_ids: [...location_ids], quantity }),
      output: decodeInventoryConfirmationOutput });
    const policy = inventoryConfirmationPolicy(contracts, prepared.query);
    const workflow = yield* defineWorkflowModule({ name: Modules.INVENTORY, source: module.description,
      methods: { confirmInventory }, graph: { aliases: [], reads: [] }, logical: { ...policy, commands: [confirm] } });
    const resource = yield* makeInventoryConfirmationResource(confirmInventory);
    return { confirm, workflow, resource, contracts, logicalEventPolicy: () => policy, withService: module.use };
  }));
});
