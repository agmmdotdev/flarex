import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import { InventoryItem, InventoryLevel, ReservationItem } from "@medusajs/inventory/models";
import { InventoryModuleService, InventoryLevelService } from "@medusajs/inventory/services";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { defineCommerceModule } from "../../module/definition";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowModule, defineWorkflowMethod } from "../../workflow/module";
import { deniedCommerceRepository } from "../../repository/denied";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere } from "../../repository/scalar-id-read";
import { commerceDecoder } from "../../value/decoder";
import { captureInventoryMetadata } from "./schema";
import { compileInventoryItemContracts } from "./item-contracts";
import { compileInventoryLevelContracts } from "./level-contracts";
import { compileInventoryDeletionContracts } from "./deletion-contracts";
import { prepareInventoryQuantityRepository, inventoryQuantityProjection } from "./quantity-repository";
import { inventoryLevelLifecycleRepository } from "./level-lifecycle";
import { prepareInventoryLevelCreationMethods } from "./level-creation";
import { deleteInventoryItemCreation } from "./physical-item-lifecycle";
import { InventoryItemCreates, InventoryItemPhysicalDeletionIds, decodeInventoryItemCreates, decodeInventoryItemPhysicalDeletionIds } from "./create-item-input";
import { inventoryItemCreationEventPolicy } from "./create-item-events";

const decodeCreateArguments = commerceDecoder(Schema.Tuple([InventoryItemCreates]), "invalidInput");
const decodePhysicalArguments = commerceDecoder(Schema.Tuple([InventoryItemPhysicalDeletionIds]), "invalidInput");

/** Genuine standalone creation and its retained inverse borrow one Inventory
 * owner. Forward Level creation retains its real Location validation child. */
export const makeInventoryItemCreationCommands = Effect.fn("InventoryAdapter.itemCreationCommands")(function* () {
  const metadata = yield* captureInventoryMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const item = metadata.frame.tables.find(table => table.name === "inventory_item"), level = metadata.frame.tables.find(table => table.name === "inventory_level");
    if (item === undefined || level === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const items = yield* compileInventoryItemContracts(item), levels = yield* compileInventoryLevelContracts(level),
      lifecycle = yield* compileInventoryDeletionContracts(metadata.frame.tables);
    const prepared = yield* prepareScalarRepository(item, "InventoryItem", scalarIdWhere, inventoryQuantityProjection(level.columns));
    const preparedLevels = yield* prepareInventoryQuantityRepository(level, "InventoryLevel", "read-only");
    const bind = (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = prepared.bind(ctx, owner), levelBound = preparedLevels.bind(ctx, owner, bound.events);
      const denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const itemRepository: DAL.RepositoryService = { ...denied, create: bound.repository.create, serialize: bound.repository.serialize,
        delete: (input, shared) =>
          bound.bridge.executeInput(shared, input, (current, captured) => bound.bridge.checked(current,
            deleteInventoryItemCreation(current, metadata.frame, lifecycle, captured))) };
      const physicalLevels = inventoryLevelLifecycleRepository(levelBound, metadata.frame, level, levels, "batch");
      const levelRepository = { ...denied, create: levelBound.repository.create, serialize: levelBound.repository.serialize,
        delete: physicalLevels.delete, getStockedQuantity: bound.refuse, getReservedQuantity: bound.refuse, getAvailableQuantity: bound.refuse };
      const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
        capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
      return { baseRepository: itemRepository, repository: (model: typeof InventoryItem | typeof InventoryLevel | typeof ReservationItem) =>
        model === InventoryItem ? itemRepository : model === InventoryLevel ? levelRepository : denied,
        events: bound.mutationEvents, eventBus, levelRepository };
    };
    const module = yield* defineCommerceModule({ name: "flarex-inventory-local", models: [InventoryItem, InventoryLevel, ReservationItem],
      profile: { name: "inventory-item-creations", capabilities: [], bind },
      extensions: { inventoryLevelService: { mode: "replace", create: ({ binding, persistence }) => {
        const container = { inventoryLevelRepository: binding.levelRepository, modulePersistenceAdapter: persistence };
        return new InventoryLevelService(container);
      } } },
      service: ({ binding, dependencies, context }) => {
        const container = { ...dependencies, [Modules.EVENT_BUS]: binding.eventBus };
        const native = new InventoryModuleService(container, { scope: "internal" });
        return { service: { createInventoryItems: native.createInventoryItems.bind(native), createInventoryLevels: native.createInventoryLevels.bind(native),
          deleteInventoryItems: native.deleteInventoryItems.bind(native), deleteInventoryLevels: native.deleteInventoryLevels.bind(native) }, context };
      },
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("InventoryItemCreation.prepare");
    const createItems = commands.write("inventoryCreate", prepare(decodeInventoryItemCreates), ({ service, context }, input) => service.createInventoryItems([...input], context));
    const deleteItemsForWorkflow = commands.write("inventoryItemPhysicalDeleteForWorkflow", prepare(decodeInventoryItemPhysicalDeletionIds), async ({ service, context }, ids) => {
      const result = await service.deleteInventoryItems([...ids], context);
      if (result !== undefined) throw commerceError("storedCorruption");
      return null;
    });
    const createInventoryItems = yield* defineWorkflowMethod({ command: createItems, arguments: decodeCreateArguments, encode: ([input]) => input,
      output: items.decodeRows, moduleEvents: [buildModuleResourceEventName({ prefix: Modules.INVENTORY, objectName: "inventory_item", action: "created" })] });
    const deleteInventoryItems = yield* defineWorkflowMethod({ command: deleteItemsForWorkflow, arguments: decodePhysicalArguments, encode: ([ids]) => ids,
      output: commerceDecoder(Schema.Null, "storedCorruption"), moduleEvents: [buildModuleResourceEventName({ prefix: Modules.INVENTORY, objectName: "inventory_item", action: "deleted" })] });
    const levelMethods = yield* prepareInventoryLevelCreationMethods(module.use, levels);
    const { createLevels, createInventoryLevels, deleteInventoryLevels, deleteForWorkflow: deleteLevelsForWorkflow } = levelMethods;
    const admitted = [createItems, createLevels, deleteItemsForWorkflow, deleteLevelsForWorkflow];
    const workflow = yield* defineWorkflowModule({ name: Modules.INVENTORY, source: module.description,
      methods: { createInventoryItems, createInventoryLevels, deleteInventoryItems, deleteInventoryLevels }, graph: { aliases: [], reads: [] },
      logical: { ...inventoryItemCreationEventPolicy(items, levels, lifecycle), commands: admitted } });
    return { createItems, createLevels, deleteItemsForWorkflow, deleteLevelsForWorkflow, commands: admitted, workflow,
      withService: module.use, logicalEventPolicy: () => inventoryItemCreationEventPolicy(items, levels, lifecycle) };
  }));
});
