import { Effect, Result, Schema } from "effect";
import { InventoryItem, InventoryLevel, ReservationItem } from "@medusajs/inventory/models";
import { InventoryModuleService, InventoryLevelService } from "@medusajs/inventory/services";
import { inventoryStaticResources } from "@medusajs/inventory/static-manifest";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import type { Context, DAL, FindConfig, InventoryTypes, IEventBusModuleService } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureInventoryMetadata } from "./inventory-schema";
import { prepareScalarRepository } from "./scalar-repository";
import { defineCommerceModule } from "./module-definition";
import type { CommercePromiseOwner } from "./commerce-promise-owner";
import { commerceServiceCommands } from "./service-commands";
import { commerceDecoder } from "./commerce-decoder";
import { captureCommerceInput } from "./commerce-input";
import { decodeLocalEventBatch, decodeLocalEventOptions } from "./module-event-input";
import { defineWorkflowModule, defineWorkflowMethod } from "./workflow/module";
import { moduleAliases } from "./local-graph/module";
import { decodeGraphCount } from "./local-graph/query";
import type { GraphModuleDefinition } from "./local-graph/model";
import { inventoryCreateEventPolicy } from "./inventory-events";
import { ScalarId, ScalarIdRead, scalarIdWhere } from "./scalar-id-read";

export const InventoryId = ScalarId;
const Text = Schema.optionalKey(Schema.NullOr(Schema.String));
const Dimension = Schema.optionalKey(Schema.NullOr(Schema.Number.check(Schema.isFinite())));
export const InventoryItemInput = Schema.Struct({ id: Schema.optionalKey(InventoryId), sku: Text, origin_country: Text,
  hs_code: Text, mid_code: Text, material: Text, weight: Dimension, length: Dimension, height: Dimension, width: Dimension,
  requires_shipping: Schema.optionalKey(Schema.Boolean), description: Text, title: Text, thumbnail: Text,
  metadata: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)),
});
const Items = Schema.Array(InventoryItemInput).check(Schema.isMaxLength(4));
const EmptyLevels = Schema.Array(Schema.Never).pipe(Schema.mutable);
const decodeCreate = commerceDecoder(Schema.Union([InventoryItemInput, Items]), "invalidInput");
const decodeLevels = commerceDecoder(EmptyLevels, "unsupportedProfile");
const decodeRead = commerceDecoder(ScalarIdRead, "invalidInput");
export const InventoryItemsOutput = Schema.Array(Schema.StructWithRest(Schema.Struct({ id: InventoryId }), [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(4));

export const makeLocalInventoryCommands = Effect.fn("InventoryAdapter.commands")(function* () {
  const metadata = yield* captureInventoryMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const item = metadata.frame.tables.find(table => table.name === "inventory_item");
    const level = metadata.frame.tables.find(table => table.name === "inventory_level");
    if (!item || !level) return yield* Result.fail(commerceError("unsupportedProfile"));
    const prepared = yield* prepareScalarRepository(item, "InventoryItem", scalarIdWhere);
    const levels = yield* prepareScalarRepository(level, "InventoryLevel", scalarIdWhere);
    const bind = (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = prepared.bind(ctx, owner);
      const levelBound = levels.bind(ctx, owner, bound.events);
      const denied: DAL.RepositoryService = { getFreshManager: bound.repository.getFreshManager, getActiveManager: bound.repository.getActiveManager,
        transaction: bound.repository.transaction, serialize: bound.refuse, find: bound.refuse, findAndCount: bound.refuse, create: bound.refuse,
        update: bound.refuse, delete: bound.refuse, softDelete: bound.refuse, restore: bound.refuse, upsert: bound.refuse, upsertWithReplace: bound.refuse };
      const levelRepository = { ...denied, create: (input: unknown, shared?: Context) =>
        captureCommerceInput(input, ctx.resources).pipe(Result.flatMap(decodeLevels), Result.match({
          onFailure: error => owner.run(ctx.refuse(error)),
          onSuccess: rows => levelBound.repository.create([...rows], shared),
        })), getStockedQuantity: bound.refuse, getReservedQuantity: bound.refuse, getAvailableQuantity: bound.refuse };
      const eventBus: IEventBusModuleService = { emit: (input, options) => owner.run(bound.bridge.checked(ctx, Effect.gen(function* () {
        yield* Effect.fromResult(decodeLocalEventOptions(yield* Effect.fromResult(captureCommerceInput(options))));
        for (const message of yield* Effect.fromResult(decodeLocalEventBatch(yield* Effect.fromResult(captureCommerceInput(input, ctx.resources))))) yield* bound.bridge.current().captureLocalEvent(message);
      }))), subscribe: () => owner.reject(commerceError("unsupportedProfile")), unsubscribe: () => owner.reject(commerceError("unsupportedProfile")), releaseGroupedEvents: bound.refuse, clearGroupedEvents: bound.refuse };
      return { baseRepository: bound.repository, repository: (model: typeof InventoryItem | typeof InventoryLevel | typeof ReservationItem) => model === InventoryItem ? bound.repository : model === InventoryLevel ? levelRepository : denied,
        events: bound.mutationEvents, eventBus, levelRepository };
    };
    const module = yield* defineCommerceModule({ name: "flarex-inventory-local", models: [InventoryItem, InventoryLevel, ReservationItem],
      profile: { name: "inventory-variant-items", capabilities: [], bind },
      extensions: { inventoryLevelService: { mode: "replace", create: ({ binding, persistence }) => {
        const container = { inventoryLevelRepository: binding.levelRepository, modulePersistenceAdapter: persistence };
        return new InventoryLevelService(container);
      } } },
      service: ({ binding, dependencies, context }) => {
        const container = { ...dependencies, [Modules.EVENT_BUS]: binding.eventBus };
        const native = new InventoryModuleService(container, { scope: "internal" });
        return { service: { createInventoryItems: native.createInventoryItems.bind(native), createInventoryLevels: native.createInventoryLevels.bind(native),
          listAndCountInventoryItems: native.listAndCountInventoryItems.bind(native) }, context };
      },
    }).pipe(Result.mapError(error => commerceError("unsupportedProfile", error)));
    const commands = commerceServiceCommands(module.use);
    const prepare = <Value>(decode: (input: unknown) => Result.Result<Value, ReturnType<typeof commerceError>>) => Effect.fn("Inventory.prepare")(
      (ctx: CommerceCommandContext, input: Json) => Effect.fromResult(decode(input)).pipe(Effect.map(value => structuredClone(value)), Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error))));
    const create = commands.write("inventoryCreate", prepare(decodeCreate), ({ service, context }, items) =>
      Array.isArray(items) ? service.createInventoryItems(items, context) : service.createInventoryItems(items, context));
    const createLevels = commands.write("inventoryCreateLevels", prepare(decodeLevels), ({ service, context }, levels) => service.createInventoryLevels([...levels], context));
    const count = commands.read("inventoryCount", prepare(decodeRead), ({ service, context }, args) => service.listAndCountInventoryItems(args.filters,
      args.config as FindConfig<InventoryTypes.InventoryItemDTO> | undefined, context));
    const joiner = inventoryStaticResources.joinerConfig;
    if (!joiner) return yield* Result.fail(commerceError("unsupportedProfile"));
    const graph: GraphModuleDefinition = { aliases: yield* moduleAliases({ ...joiner, alias: (Array.isArray(joiner.alias) ? joiner.alias : []).filter(alias => alias.entity === "InventoryItem") }),
      reads: [{ model: "InventoryItem", command: count, table: prepared.table, paths: [], orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount }] };
    const decodeItemArguments = commerceDecoder(Schema.Tuple([Items]), "invalidInput");
    const decodeLevelArguments = commerceDecoder(Schema.Tuple([EmptyLevels]), "unsupportedProfile");
    const createInventoryItems = yield* defineWorkflowMethod({ command: create, arguments: decodeItemArguments, encode: ([items]) => [...items],
      output: commerceDecoder(InventoryItemsOutput, "storedCorruption"), moduleEvents: [buildModuleResourceEventName({ prefix: Modules.INVENTORY, objectName: "inventory_item", action: "created" })] });
    const createInventoryLevels = yield* defineWorkflowMethod({ command: createLevels, arguments: decodeLevelArguments, encode: ([levels]) => [...levels],
      output: commerceDecoder(EmptyLevels, "storedCorruption") });
    const workflow = yield* defineWorkflowModule({ name: Modules.INVENTORY, source: module.description, methods: { createInventoryItems, createInventoryLevels }, graph,
      logical: { ...inventoryCreateEventPolicy(), commands: [create, createLevels, count] } });
    return { create, createLevels, count, commands: [create, createLevels, count], workflow, graph, withService: module.use,
      logicalEventPolicy: inventoryCreateEventPolicy };
  }));
});
