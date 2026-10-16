import { Effect, Result, Schema } from "effect";
import type { DAL, FindConfig, InventoryTypes } from "@medusajs/framework/types";
import { InventoryItem, InventoryLevel, ReservationItem } from "@medusajs/inventory/models";
import { InventoryModuleService, InventoryLevelService } from "@medusajs/inventory/services";
import { inventoryStaticResources } from "@medusajs/inventory/static-manifest";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineCommerceModule } from "../../module/definition";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { defineWorkflowModule, defineWorkflowMethod } from "../../workflow/module";
import { deniedCommerceRepository } from "../../repository/denied";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere } from "../../repository/scalar-id-read";
import { orderNativeIdRows } from "../../repository/result";
import { moduleAliases, scalarGraphDefinition } from "../../local-graph/module";
import { captureInventoryMetadata } from "./schema";
import { inventoryItemLifecycle } from "./deletion-lifecycle";
import { compileInventoryDeletionContracts } from "./deletion-contracts";
import { inventoryDeletionEventPolicy } from "./deletion-events";
import { inventoryDeletionFind, inventoryDeletionReadTable } from "./deletion-read";
import { decodeInventoryItemDeletionCommandInput, decodeInventoryItemDeletionArguments,
  decodeInventoryItemDeletionReadInput, decodeInventoryItemDeletionResult } from "./delete-item-input";

/** Only the native computed Item guard and generated cascade lifecycle methods
 * are bound. Child quantity and reservation services remain unavailable. */
export const makeInventoryItemDeletionCommands = Effect.fn("InventoryAdapter.itemDeletionCommands")(function* () {
  const metadata = yield* captureInventoryMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const table = metadata.frame.tables.find(table => table.name === "inventory_item");
    if (table === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const contracts = yield* compileInventoryDeletionContracts(metadata.frame.tables);
    const prepared = yield* prepareScalarRepository(table, "InventoryItem", scalarIdWhere);
    const bind = (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = prepared.bind(ctx, owner), { bridge, events } = bound;
      const denied = deniedCommerceRepository(bound.repository, bound.refuse), find = inventoryDeletionFind(bound);
      const lifecycle = (operation: "softDelete" | "restore"): DAL.RepositoryService["softDelete"] => (input, shared) =>
        bridge.executeInput(shared, input, (current, captured) => bridge.checked(current, Effect.gen(function* () {
          const result = yield* inventoryItemLifecycle(current, metadata.frame, captured, operation, 4);
          if (shared === undefined || operation === "softDelete" && !events.isSubscribed(shared))
            return yield* current.refuse(commerceError("unadmittedEvent"));
          yield* events.cascades(result.cascades, shared, row => ({ entity: row,
            originalEntity: { deleted_at: operation === "softDelete" ? null : row.updated_at } }));
          return [result.roots, result.cascades] satisfies [object[], Record<string, unknown[]>];
        })));
      const repository: DAL.RepositoryService = { ...denied, serialize: bound.repository.serialize,
        findAndCount: (input, shared) => bridge.executeInput(shared, input, (current, captured) => bridge.checked(current, Effect.gen(function* () {
          const result = yield* find(current, captured, true);
          if (result.count === undefined || result.count > 4 || result.rows.length !== result.count ||
            !Schema.is(Schema.JsonObject)(captured)) return yield* current.refuse(commerceError("unsupportedProfile"));
          const rows = [];
          for (const row of result.rows) {
            if (typeof row.id !== "string") return yield* current.refuse(commerceError("storedCorruption"));
            rows.push({ ...row, id: row.id });
          }
          return [structuredClone(orderNativeIdRows(rows, captured.where)), result.count] satisfies [object[], number];
        }))), softDelete: lifecycle("softDelete"), restore: lifecycle("restore") };
      const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
        capture: message => bridge.current().captureLocalEvent(message), check: work => bridge.checked(ctx, work), refuse: bound.refuse });
      return { baseRepository: repository, repository: (model: typeof InventoryItem | typeof InventoryLevel | typeof ReservationItem) =>
        model === InventoryItem ? repository : denied, events: bound.mutationEvents, eventBus,
        levelRepository: { ...denied, getStockedQuantity: bound.refuse, getReservedQuantity: bound.refuse, getAvailableQuantity: bound.refuse } };
    };
    const module = yield* defineCommerceModule({ name: "flarex-inventory-local", models: [InventoryItem, InventoryLevel, ReservationItem],
      profile: { name: "inventory-item-deletions", capabilities: [], bind },
      extensions: { inventoryLevelService: { mode: "replace", create: ({ binding, persistence }) => {
        const container = { inventoryLevelRepository: binding.levelRepository, modulePersistenceAdapter: persistence };
        return new InventoryLevelService(container);
      } } },
      service: ({ binding, dependencies, context }) => {
        const container = { ...dependencies, [Modules.EVENT_BUS]: binding.eventBus };
        const native = new InventoryModuleService(container, { scope: "internal" });
        return { service: { listAndCountInventoryItems: native.listAndCountInventoryItems.bind(native),
          softDeleteInventoryItems: native.softDeleteInventoryItems.bind(native), restoreInventoryItems: native.restoreInventoryItems.bind(native) }, context };
      },
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("InventoryItemDeletion.prepare");
    const count = commands.read("inventoryItemCountForDeletion", prepare(decodeInventoryItemDeletionReadInput), ({ service, context }, args) => {
      const { select, relations, ...options } = args.config;
      const config: FindConfig<InventoryTypes.InventoryItemDTO> = { ...options, select: [...select],
        ...(relations === undefined ? {} : { relations: [...relations] }) };
      return service.listAndCountInventoryItems(args.filters, config, context);
    });
    const softDeleteForWorkflow = commands.write("inventoryItemSoftDeleteForWorkflow", prepare(decodeInventoryItemDeletionCommandInput),
      ({ service, context }, input) => service.softDeleteInventoryItems([...input.selector], input.config.returnLinkableKeys === undefined ? {} :
        { returnLinkableKeys: [...input.config.returnLinkableKeys] }, context));
    const restoreForWorkflow = commands.write("inventoryItemRestoreForWorkflow", prepare(decodeInventoryItemDeletionCommandInput),
      ({ service, context }, input) => service.restoreInventoryItems([...input.selector], input.config.returnLinkableKeys === undefined ? {} :
        { returnLinkableKeys: [...input.config.returnLinkableKeys] }, context));
    const softDeleteInventoryItems = yield* defineWorkflowMethod({ command: softDeleteForWorkflow, arguments: decodeInventoryItemDeletionArguments,
      encode: args => ({ selector: args[0], config: args[1] ?? {} }), output: decodeInventoryItemDeletionResult,
      moduleEvents: ["inventory_item", "inventory_level", "reservation_item"].map(objectName =>
        buildModuleResourceEventName({ prefix: Modules.INVENTORY, objectName, action: "deleted" })) });
    const restoreInventoryItems = yield* defineWorkflowMethod({ command: restoreForWorkflow, arguments: decodeInventoryItemDeletionArguments,
      encode: args => ({ selector: args[0], config: args[1] ?? {} }), output: decodeInventoryItemDeletionResult,
      moduleEvents: ["inventory_item", "inventory_level", "reservation_item"].map(objectName =>
        buildModuleResourceEventName({ prefix: Modules.INVENTORY, objectName, action: "restored" })) });
    const joiner = inventoryStaticResources.joinerConfig;
    if (joiner === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const graph = yield* scalarGraphDefinition(yield* moduleAliases({ ...joiner,
      alias: (Array.isArray(joiner.alias) ? joiner.alias : []).filter(alias => alias.entity === "InventoryItem") }),
      "InventoryItem", count, inventoryDeletionReadTable(prepared.table));
    const admitted = [count, softDeleteForWorkflow, restoreForWorkflow];
    const workflow = yield* defineWorkflowModule({ name: Modules.INVENTORY, source: module.description,
      methods: { softDeleteInventoryItems, restoreInventoryItems }, graph,
      logical: { ...inventoryDeletionEventPolicy(contracts, "item-deletions"), commands: admitted } });
    return { count, softDeleteForWorkflow, restoreForWorkflow, commands: admitted, workflow, graph, withService: module.use,
      logicalEventPolicy: () => inventoryDeletionEventPolicy(contracts, "item-deletions") };
  }));
});
