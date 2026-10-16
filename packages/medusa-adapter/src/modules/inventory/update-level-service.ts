import { compileInventoryLevelContracts } from "./level-contracts";
import { Effect, Result, Schema } from "effect";
import type { Context } from "@medusajs/framework/types";
import type { PreparedCommerceModule } from "../../module/definition";
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
import { commerceDecoder } from "../../value/decoder";
import { captureInventoryMetadata } from "./schema";
import { prepareInventoryQuantityRepository } from "./quantity-repository";
import { InventoryLevelUpdates, InventoryLevelUpdateReadInput,
  decodeInventoryLevelUpdateCommandInput, decodeInventoryLevelUpdateReadInput } from "./update-level-input";
import { inventoryLevelUpdateEventPolicy } from "./update-level-events";

const decodeListArguments = commerceDecoder(Schema.Tuple([InventoryLevelUpdateReadInput.fields.filters, InventoryLevelUpdateReadInput.fields.config]), "invalidInput");
const decodeUpdateArguments = commerceDecoder(Schema.Tuple([InventoryLevelUpdates]), "invalidInput");

/** Native absolute-level updates keep pair lookup, caller ID precedence,
 * duplicate selection and compensation. Other Inventory mutations are denied. */
export const makeInventoryLevelUpdateCommands = Effect.fn("InventoryAdapter.levelUpdateCommands")(function* () {
  const metadata = yield* captureInventoryMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const table = metadata.frame.tables.find(table => table.name === "inventory_level");
    if (table === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const contracts = yield* compileInventoryLevelContracts(table);
    const prepared = yield* prepareInventoryQuantityRepository(table, "InventoryLevel", "level-updates");
    const bind = (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = prepared.bind(ctx, owner), denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
        capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
      return { baseRepository: bound.repository, repository: (model: typeof InventoryItem | typeof InventoryLevel | typeof ReservationItem) =>
        model === InventoryLevel ? bound.repository : denied, events: bound.mutationEvents, eventBus,
        levelRepository: { ...bound.repository, getStockedQuantity: bound.refuse, getReservedQuantity: bound.refuse, getAvailableQuantity: bound.refuse } };
    };
    const module = yield* defineCommerceModule({ name: "flarex-inventory-local", models: [InventoryItem, InventoryLevel, ReservationItem],
      profile: { name: "inventory-level-updates", capabilities: [], bind },
      extensions: { inventoryLevelService: { mode: "replace", create: ({ binding, persistence }) => {
        const container = { inventoryLevelRepository: binding.levelRepository, modulePersistenceAdapter: persistence };
        return new InventoryLevelService(container);
      } } },
      service: ({ binding, dependencies, context }) => {
        const container = { ...dependencies, [Modules.EVENT_BUS]: binding.eventBus };
        const native = new InventoryModuleService(container, { scope: "internal" });
        return { service: { listInventoryLevels: native.listInventoryLevels.bind(native), updateInventoryLevels: native.updateInventoryLevels.bind(native) }, context };
      },
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const { list, update, listInventoryLevels, updateInventoryLevels } = yield* prepareInventoryLevelUpdateMethods(module.use, contracts);
    const admitted = [list, update];
    const workflow = yield* defineWorkflowModule({ name: Modules.INVENTORY, source: module.description,
      methods: { listInventoryLevels, updateInventoryLevels }, graph: { aliases: [], reads: [] },
      logical: { ...inventoryLevelUpdateEventPolicy(contracts), commands: admitted } });
    return { list, update, commands: admitted, workflow, withService: module.use,
      logicalEventPolicy: () => inventoryLevelUpdateEventPolicy(contracts) };
  }));
});

/** Reuse the exact native absolute-update ABI in the standalone and batch roots. */
export function prepareInventoryLevelUpdateMethods<Service extends { readonly service: Pick<InventoryModuleService, "listInventoryLevels" | "updateInventoryLevels">; readonly context: Context }>(
  use: PreparedCommerceModule<Service>["use"], contracts: Result.Result.Success<ReturnType<typeof compileInventoryLevelContracts>>,
) {
  return Result.gen(function* () {
    const commands = commerceServiceCommands(use), prepare = commerceCommandPreparation("InventoryLevelUpdate.prepare");
    const list = commands.read("inventoryLevelListForUpdate", prepare(decodeInventoryLevelUpdateReadInput), ({ service, context }, args) =>
      service.listInventoryLevels({ $or: args.filters.$or.map(pair => ({ ...pair })) }, args.config, context));
    const update = commands.write("inventoryLevelUpdateForWorkflow", prepare(decodeInventoryLevelUpdateCommandInput), ({ service, context }, input) =>
      Array.isArray(input) ? service.updateInventoryLevels(input, context) : service.updateInventoryLevels(input, context));
    const listInventoryLevels = yield* defineWorkflowMethod({ command: list,
      arguments: decodeListArguments, encode: ([filters, config]) => ({ filters, config }), output: contracts.decodeRows });
    const updateInventoryLevels = yield* defineWorkflowMethod({ command: update, arguments: decodeUpdateArguments, encode: ([updates]) => updates,
      output: contracts.decodeRows, moduleEvents: [buildModuleResourceEventName({ prefix: Modules.INVENTORY, objectName: "inventory_level", action: "updated" })] });
    return { list, update, listInventoryLevels, updateInventoryLevels };
  });
}
