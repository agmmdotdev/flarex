import { Effect, Result, Schema } from "effect";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { DAL } from "@medusajs/framework/types";
import { InventoryItem, InventoryLevel, ReservationItem } from "@medusajs/inventory/models";
import { InventoryModuleService, InventoryLevelService } from "@medusajs/inventory/services";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { defineCommerceModule } from "../../module/definition";
import { commerceModuleEventBus } from "../../module/events";
import { deniedCommerceRepository } from "../../repository/denied";
import { commerceDecoder } from "../../value/decoder";
import { defineWorkflowModule, defineWorkflowMethod } from "../../workflow/module";
import { captureInventoryMetadata } from "./schema";
import { ReservationLineItemIds, decodeReservationLineItemIds } from "./reservation-line-item-input";
import { prepareReservationLineItemRepository } from "./reservation-line-item-repository";
import { inventoryReservationLineItemEventPolicy } from "./reservation-line-item-events";

/** The native Line Item selectors expose no Order or Cart capability. Only
 * Reservation lifecycle and the native reserved-quantity Level update are bound. */
export const makeInventoryReservationLineItemCommands = Effect.fn("InventoryAdapter.reservationLineItemCommands")(function* () {
  const metadata = yield* captureInventoryMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareReservationLineItemRepository(metadata.frame);
    const bind = (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = prepared.bind(ctx, owner);
      const denied = deniedCommerceRepository(bound.baseRepository, bound.refuse);
      const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
        capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
      return { ...bound, events: bound.mutationEvents, eventBus,
        repository: (model: typeof InventoryItem | typeof InventoryLevel | typeof ReservationItem): DAL.RepositoryService =>
          model === ReservationItem ? bound.reservationRepository : model === InventoryLevel ? bound.levelRepository : denied };
    };
    const module = yield* defineCommerceModule({ name: "flarex-inventory-local", models: [InventoryItem, InventoryLevel, ReservationItem],
      profile: { name: "inventory-reservation-line-items", capabilities: [], bind },
      extensions: { inventoryLevelService: { mode: "replace", create: ({ binding, persistence }) => {
        const container = { inventoryLevelRepository: binding.levelRepository, modulePersistenceAdapter: persistence };
        return new InventoryLevelService(container);
      } } },
      service: ({ binding, dependencies, context }) => {
        const container = { ...dependencies, [Modules.EVENT_BUS]: binding.eventBus };
        const native = new InventoryModuleService(container, { scope: "internal" });
        return { service: { deleteReservationItemsByLineItem: native.deleteReservationItemsByLineItem.bind(native),
          restoreReservationItemsByLineItem: native.restoreReservationItemsByLineItem.bind(native) }, context };
      },
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("InventoryReservationLineItem.prepare");
    const deleteForWorkflow = commands.write("inventoryDeleteReservationsByLineItem", prepare(decodeReservationLineItemIds),
      async ({ service, context }, ids) => {
        const output = await service.deleteReservationItemsByLineItem([...ids], context);
        if (output !== undefined) throw commerceError("storedCorruption");
        return null;
      });
    const restoreForWorkflow = commands.write("inventoryRestoreReservationsByLineItem", prepare(decodeReservationLineItemIds),
      async ({ service, context }, ids) => {
        const output = await service.restoreReservationItemsByLineItem([...ids], context);
        if (output !== undefined) throw commerceError("storedCorruption");
        return null;
      });
    const args = commerceDecoder(Schema.Tuple([ReservationLineItemIds]), "unsupportedProfile");
    const output = commerceDecoder(Schema.Null, "storedCorruption");
    const levelEvent = buildModuleResourceEventName({ prefix: Modules.INVENTORY, objectName: "inventory_level", action: "updated" });
    const deleteReservationItemsByLineItem = yield* defineWorkflowMethod({ command: deleteForWorkflow, arguments: args,
      encode: ([ids]) => ids, output, moduleEvents: [
        buildModuleResourceEventName({ prefix: Modules.INVENTORY, objectName: "reservation_item", action: "deleted" }), levelEvent,
      ] });
    const restoreReservationItemsByLineItem = yield* defineWorkflowMethod({ command: restoreForWorkflow, arguments: args,
      encode: ([ids]) => ids, output, moduleEvents: [
        buildModuleResourceEventName({ prefix: Modules.INVENTORY, objectName: "reservation_item", action: "restored" }), levelEvent,
      ] });
    const admitted = [deleteForWorkflow, restoreForWorkflow];
    const workflow = yield* defineWorkflowModule({ name: Modules.INVENTORY, source: module.description,
      methods: { deleteReservationItemsByLineItem, restoreReservationItemsByLineItem }, graph: { aliases: [], reads: [] },
      logical: { ...inventoryReservationLineItemEventPolicy(prepared.contracts), commands: admitted } });
    return { deleteForWorkflow, restoreForWorkflow, commands: admitted, workflow, withService: module.use,
      logicalEventPolicy: () => inventoryReservationLineItemEventPolicy(prepared.contracts) };
  }));
});
