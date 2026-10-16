import { Effect, Result, Schema } from "effect";
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
import { commerceDecoder } from "../../value/decoder";
import { captureInventoryMetadata } from "./schema";
import { prepareInventoryItemUpdateRepository } from "./update-repository";
import { compileInventoryItemUpdateContracts, InventoryItemUpdates, InventoryItemUpdateReadInput,
  decodeInventoryItemUpdateCommandInput, decodeInventoryItemUpdateReadInput } from "./update-input";
import { inventoryItemUpdateEventPolicy } from "./update-events";

const decodeListArguments = commerceDecoder(Schema.Tuple([InventoryItemUpdateReadInput.fields.filters, InventoryItemUpdateReadInput.fields.config]), "invalidInput");
const decodeUpdateArguments = commerceDecoder(Schema.Tuple([InventoryItemUpdates]), "invalidInput");

/** One named attribute-update profile. The full native model set is configured,
 * while every quantity, lifecycle and sibling data method remains refused. */
export const makeInventoryItemUpdateCommands = Effect.fn("InventoryAdapter.itemUpdateCommands")(function* () {
  const metadata = yield* captureInventoryMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const table = metadata.frame.tables.find(table => table.name === "inventory_item");
    if (table === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const contracts = yield* compileInventoryItemUpdateContracts(table), prepared = yield* prepareInventoryItemUpdateRepository(table);
    const bind = (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => {
        const bound = prepared.bind(ctx, owner);
        const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository, repository: (model: typeof InventoryItem | typeof InventoryLevel | typeof ReservationItem) =>
          model === InventoryItem ? bound.repository : bound.denied, events: bound.mutationEvents, eventBus,
          levelRepository: { ...bound.denied, getStockedQuantity: bound.refuse, getReservedQuantity: bound.refuse, getAvailableQuantity: bound.refuse } };
    };
    const module = yield* defineCommerceModule({ name: "flarex-inventory-local", models: [InventoryItem, InventoryLevel, ReservationItem],
      profile: { name: "inventory-item-updates", capabilities: [], bind },
      extensions: { inventoryLevelService: { mode: "replace", create: ({ binding, persistence }) => {
        const container = { inventoryLevelRepository: binding.levelRepository, modulePersistenceAdapter: persistence };
        return new InventoryLevelService(container);
      } } },
      service: ({ binding, dependencies, context }) => {
        const container = { ...dependencies, [Modules.EVENT_BUS]: binding.eventBus };
        const native = new InventoryModuleService(container, { scope: "internal" });
        return { service: { listInventoryItems: native.listInventoryItems.bind(native), updateInventoryItems: native.updateInventoryItems.bind(native) }, context };
      },
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("InventoryItemUpdate.prepare");
    const list = commands.read("inventoryItemListForUpdate", prepare(decodeInventoryItemUpdateReadInput), ({ service, context }, args) =>
      service.listInventoryItems({ id: [...args.filters.id] }, args.config, context));
    const update = commands.write("inventoryItemUpdateForWorkflow", prepare(decodeInventoryItemUpdateCommandInput), ({ service, context }, input) =>
      Array.isArray(input) ? service.updateInventoryItems(input, context) : service.updateInventoryItems(input, context));
    const listInventoryItems = yield* defineWorkflowMethod({ command: list,
      arguments: decodeListArguments,
      encode: ([filters, config]) => ({ filters, config }), output: contracts.decodeRows });
    const updateInventoryItems = yield* defineWorkflowMethod({ command: update,
      arguments: decodeUpdateArguments, encode: ([updates]) => updates, output: contracts.decodeRows,
      moduleEvents: [buildModuleResourceEventName({ prefix: Modules.INVENTORY, objectName: "inventory_item", action: "updated" })] });
    const admitted = [list, update];
    const workflow = yield* defineWorkflowModule({ name: Modules.INVENTORY, source: module.description,
      methods: { listInventoryItems, updateInventoryItems }, graph: { aliases: [], reads: [] },
      logical: { ...inventoryItemUpdateEventPolicy(contracts), commands: admitted } });
    return { list, update, commands: admitted, workflow, withService: module.use,
      logicalEventPolicy: () => inventoryItemUpdateEventPolicy(contracts) };
  }));
});
