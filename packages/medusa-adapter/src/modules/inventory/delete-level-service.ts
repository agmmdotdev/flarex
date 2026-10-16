import { Effect, Result } from "effect";
import type { Context, DAL, FindConfig, InventoryTypes } from "@medusajs/framework/types";
import { InventoryItem, InventoryLevel, ReservationItem } from "@medusajs/inventory/models";
import { InventoryModuleService, InventoryLevelService } from "@medusajs/inventory/services";
import { inventoryStaticResources } from "@medusajs/inventory/static-manifest";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { PreparedCommerceModule } from "../../module/definition";
import { defineCommerceModule } from "../../module/definition";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowModule, defineWorkflowMethod } from "../../workflow/module";
import { deniedCommerceRepository } from "../../repository/denied";
import { prepareScalarRepository } from "../../repository/scalar";
import { inventoryLevelLifecycleRepository } from "./level-lifecycle";
import { moduleAliases, scalarGraphDefinition } from "../../local-graph/module";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import type { GraphModuleDefinition } from "../../local-graph/model";

import { captureInventoryMetadata } from "./schema";
import { compileInventoryLevelContracts } from "./level-contracts";
import { inventoryQuantityProjection } from "./quantity-repository";
import { inventoryLevelDeletionWhere, decodeInventoryLevelDeletionIds, decodeInventoryLevelDeletionArguments,
  decodeInventoryLevelDeletionReadInput, decodeInventoryLevelDeletionResult } from "./delete-level-input";
import { inventoryLevelDeletionEventPolicy } from "./delete-level-events";

/** Level-only native query and lifecycle methods. Item and Reservation service
 * repositories remain denied even though their checked DML defines the module. */
export const makeInventoryLevelDeletionCommands = Effect.fn("InventoryAdapter.levelDeletionCommands")(function* () {
  const metadata = yield* captureInventoryMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const table = metadata.frame.tables.find(table => table.name === "inventory_level");
    if (table === undefined || table.relationships.some(relation => relation.cascadeDelete))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const contracts = yield* compileInventoryLevelContracts(table);
    const prepared = yield* prepareScalarRepository(table, "InventoryLevel", inventoryLevelDeletionWhere, inventoryQuantityProjection(table.columns));
    const bind = (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = prepared.bind(ctx, owner), { bridge } = bound;
      const denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const repository: DAL.RepositoryService = { ...denied, serialize: bound.repository.serialize,
        ...inventoryLevelLifecycleRepository(bound, metadata.frame, table, contracts) };
      const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
        capture: message => bridge.current().captureLocalEvent(message), check: work => bridge.checked(ctx, work), refuse: bound.refuse });
      return { baseRepository: repository, repository: (model: typeof InventoryItem | typeof InventoryLevel | typeof ReservationItem) =>
        model === InventoryLevel ? repository : denied, events: bound.mutationEvents, eventBus,
        levelRepository: { ...repository, getStockedQuantity: bound.refuse, getReservedQuantity: bound.refuse, getAvailableQuantity: bound.refuse } };
    };
    const module = yield* defineCommerceModule({ name: "flarex-inventory-local", models: [InventoryItem, InventoryLevel, ReservationItem],
      profile: { name: "inventory-level-deletions", capabilities: [], bind },
      extensions: { inventoryLevelService: { mode: "replace", create: ({ binding, persistence }) => {
        const container = { inventoryLevelRepository: binding.levelRepository, modulePersistenceAdapter: persistence };
        return new InventoryLevelService(container);
      } } },
      service: ({ binding, dependencies, context }) => {
        const container = { ...dependencies, [Modules.EVENT_BUS]: binding.eventBus };
        const native = new InventoryModuleService(container, { scope: "internal" });
        return { service: { listAndCountInventoryLevels: native.listAndCountInventoryLevels.bind(native),
          softDeleteInventoryLevels: native.softDeleteInventoryLevels.bind(native), restoreInventoryLevels: native.restoreInventoryLevels.bind(native) }, context };
      },
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const { count, softDeleteForWorkflow, restoreForWorkflow, softDeleteInventoryLevels, restoreInventoryLevels, graph } =
      yield* prepareInventoryLevelDeletionMethods(module.use, prepared.table);
    const admitted = [count, softDeleteForWorkflow, restoreForWorkflow];
    const workflow = yield* defineWorkflowModule({ name: Modules.INVENTORY, source: module.description,
      methods: { softDeleteInventoryLevels, restoreInventoryLevels }, graph,
      logical: { ...inventoryLevelDeletionEventPolicy(contracts), commands: admitted } });
    return { count, softDeleteForWorkflow, restoreForWorkflow, commands: admitted, workflow, graph, withService: module.use,
      logicalEventPolicy: () => inventoryLevelDeletionEventPolicy(contracts) };
  }));
});

/** Both supported roots share the genuine selected query and lifecycle ABI. */
export function prepareInventoryLevelDeletionMethods<Service extends { readonly service: Pick<InventoryModuleService, "listAndCountInventoryLevels" | "softDeleteInventoryLevels" | "restoreInventoryLevels">; readonly context: Context }>(
  use: PreparedCommerceModule<Service>["use"], readTable: Parameters<typeof scalarGraphDefinition>[3],
) {
  return Result.gen(function* () {
    const commands = commerceServiceCommands(use), prepare = commerceCommandPreparation("InventoryLevelDeletion.prepare");
    const count = commands.read("inventoryLevelCountForDeletion", prepare(decodeInventoryLevelDeletionReadInput), ({ service, context }, args) =>
      service.listAndCountInventoryLevels(args.filters, args.config as FindConfig<InventoryTypes.InventoryLevelDTO> | undefined, context));
    const softDeleteForWorkflow = commands.write("inventoryLevelSoftDeleteForWorkflow", prepare(decodeInventoryLevelDeletionIds),
      ({ service, context }, ids) => service.softDeleteInventoryLevels([...ids], {}, context));
    const restoreForWorkflow = commands.write("inventoryLevelRestoreForWorkflow", prepare(decodeInventoryLevelDeletionIds),
      ({ service, context }, ids) => service.restoreInventoryLevels([...ids], {}, context));
    const softDeleteInventoryLevels = yield* defineWorkflowMethod({ command: softDeleteForWorkflow, arguments: decodeInventoryLevelDeletionArguments,
      encode: ([ids]) => ids, output: decodeInventoryLevelDeletionResult,
      moduleEvents: [buildModuleResourceEventName({ prefix: Modules.INVENTORY, objectName: "inventory_level", action: "deleted" })] });
    const restoreInventoryLevels = yield* defineWorkflowMethod({ command: restoreForWorkflow, arguments: decodeInventoryLevelDeletionArguments,
      encode: ([ids]) => ids, output: decodeInventoryLevelDeletionResult,
      moduleEvents: [buildModuleResourceEventName({ prefix: Modules.INVENTORY, objectName: "inventory_level", action: "restored" })] });
    const joiner = inventoryStaticResources.joinerConfig;
    if (joiner === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const nativeGraph = yield* scalarGraphDefinition(yield* moduleAliases({ ...joiner,
      alias: (Array.isArray(joiner.alias) ? joiner.alias : []).filter(alias => alias.entity === "InventoryLevel") }), "InventoryLevel", count, readTable);
    const graph: GraphModuleDefinition = { ...nativeGraph, reads: nativeGraph.reads.map(read => ({ ...read, allowOrFilters: true, selectedFieldsOnly: true })) };
    return { count, softDeleteForWorkflow, restoreForWorkflow, softDeleteInventoryLevels, restoreInventoryLevels, graph };
  });
}
