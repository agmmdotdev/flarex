import { Effect, Result } from "effect";
import { InventoryItem, InventoryLevel, ReservationItem } from "@medusajs/inventory/models";
import { InventoryModuleService, InventoryLevelService } from "@medusajs/inventory/services";
import { Modules } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { defineCommerceModule } from "../../module/definition";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowModule } from "../../workflow/module";
import { deniedCommerceRepository } from "../../repository/denied";
import { captureInventoryMetadata } from "./schema";
import { compileInventoryLevelContracts } from "./level-contracts";
import { prepareInventoryQuantityRepository } from "./quantity-repository";
import { inventoryLevelLifecycleRepository } from "./level-lifecycle";
import { prepareInventoryLevelCreationMethods } from "./level-creation";
import { prepareInventoryLevelUpdateMethods } from "./update-level-service";
import { prepareInventoryLevelDeletionMethods } from "./delete-level-service";
import { inventoryLevelBatchEventPolicy } from "./batch-level-events";

/** One genuine Inventory service and one Level working set cover all three
 * native branches and retained inverses. Item/Reservation DALs stay denied. */
export const makeInventoryLevelBatchCommands = Effect.fn("InventoryAdapter.levelBatchCommands")(function* () {
  const metadata = yield* captureInventoryMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const table = metadata.frame.tables.find(table => table.name === "inventory_level");
    if (table === undefined || table.relationships.some(relation => relation.cascadeDelete))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const contracts = yield* compileInventoryLevelContracts(table);
    const prepared = yield* prepareInventoryQuantityRepository(table, "InventoryLevel", "level-batches");
    const bind = (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = prepared.bind(ctx, owner), denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const repository = { ...bound.repository, ...inventoryLevelLifecycleRepository(bound, metadata.frame, table, contracts, "batch") };
      const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
        capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
      return { baseRepository: repository, repository: (model: typeof InventoryItem | typeof InventoryLevel | typeof ReservationItem) =>
        model === InventoryLevel ? repository : denied, events: bound.mutationEvents, eventBus,
        levelRepository: { ...repository, getStockedQuantity: bound.refuse, getReservedQuantity: bound.refuse, getAvailableQuantity: bound.refuse } };
    };
    const module = yield* defineCommerceModule({ name: "flarex-inventory-local", models: [InventoryItem, InventoryLevel, ReservationItem],
      profile: { name: "inventory-level-batches", capabilities: [], bind },
      extensions: { inventoryLevelService: { mode: "replace", create: ({ binding, persistence }) => {
        const container = { inventoryLevelRepository: binding.levelRepository, modulePersistenceAdapter: persistence };
        return new InventoryLevelService(container);
      } } },
      service: ({ binding, dependencies, context }) => {
        const container = { ...dependencies, [Modules.EVENT_BUS]: binding.eventBus };
        const native = new InventoryModuleService(container, { scope: "internal" });
        return { service: { createInventoryLevels: native.createInventoryLevels.bind(native),
          listInventoryLevels: native.listInventoryLevels.bind(native), updateInventoryLevels: native.updateInventoryLevels.bind(native),
          listAndCountInventoryLevels: native.listAndCountInventoryLevels.bind(native),
          softDeleteInventoryLevels: native.softDeleteInventoryLevels.bind(native), restoreInventoryLevels: native.restoreInventoryLevels.bind(native),
          deleteInventoryLevels: native.deleteInventoryLevels.bind(native) }, context };
      },
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const { createLevels, deleteForWorkflow, createInventoryLevels, deleteInventoryLevels } =
      yield* prepareInventoryLevelCreationMethods(module.use, contracts);
    const updates = yield* prepareInventoryLevelUpdateMethods(module.use, contracts);
    const deletions = yield* prepareInventoryLevelDeletionMethods(module.use, prepared.table);
    const { list, update, listInventoryLevels, updateInventoryLevels } = updates;
    const { count, softDeleteForWorkflow, restoreForWorkflow, softDeleteInventoryLevels, restoreInventoryLevels, graph } = deletions;
    const admitted = [createLevels, list, update, count, softDeleteForWorkflow, restoreForWorkflow, deleteForWorkflow];
    const workflow = yield* defineWorkflowModule({ name: Modules.INVENTORY, source: module.description,
      methods: { createInventoryLevels, listInventoryLevels, updateInventoryLevels,
        softDeleteInventoryLevels, restoreInventoryLevels, deleteInventoryLevels }, graph,
      logical: { ...inventoryLevelBatchEventPolicy(contracts), commands: admitted } });
    return { createLevels, list, update, count, softDeleteForWorkflow, restoreForWorkflow, deleteForWorkflow,
      commands: admitted, workflow, graph, withService: module.use, logicalEventPolicy: () => inventoryLevelBatchEventPolicy(contracts) };
  }));
});
