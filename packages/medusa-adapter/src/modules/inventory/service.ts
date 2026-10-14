import { deniedCommerceRepository } from "../../repository/denied";
import { Effect, Result, Schema } from "effect";
import { InventoryItem, InventoryLevel, ReservationItem } from "@medusajs/inventory/models";
import { InventoryModuleService, InventoryLevelService } from "@medusajs/inventory/services";
import { inventoryStaticResources } from "@medusajs/inventory/static-manifest";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import type { Context, FindConfig, InventoryTypes } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureInventoryMetadata } from "./schema";
import { prepareScalarRepository } from "../../repository/scalar";
import { defineCommerceModule } from "../../module/definition";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowModule, defineWorkflowMethod } from "../../workflow/module";
import { moduleAliases, scalarGraphDefinition } from "../../local-graph/module";

import { inventoryCreateEventPolicy } from "./events";
import { ScalarId, ScalarIdRead, scalarIdWhere } from "../../repository/scalar-id-read";
import { InventoryLevelsInput, InventoryLevelsOutput } from "./level-input";
import { prepareInventoryQuantityRepository, inventoryQuantityProjection } from "./quantity-repository";
import { Adjustments, ReservationCreates, ReservationUpdates, ReservationIds, ReservationRead, ReservationOutput } from "./reservation-input";
import { inventoryStockEventPolicy } from "./stock-events";

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
const decodeRead = commerceDecoder(ScalarIdRead, "invalidInput");
export const InventoryItemsOutput = Schema.Array(Schema.StructWithRest(Schema.Struct({ id: InventoryId }), [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(4));

export const makeLocalInventoryCommands = Effect.fn("InventoryAdapter.commands")(function* (admission: "items" | "levels" | "stock" = "items") {
  const metadata = yield* captureInventoryMetadata();
  const stock = admission === "stock";
  const levelInput = admission !== "items" ? InventoryLevelsInput : EmptyLevels;
  const decodeLevels = commerceDecoder(levelInput, "unsupportedProfile");
  const policy = () => stock ? inventoryStockEventPolicy() : inventoryCreateEventPolicy(admission === "levels");
  const decodeAdjust = commerceDecoder(stock ? Adjustments : Schema.Never, "unsupportedProfile");
  const decodeReserve = commerceDecoder(stock ? ReservationCreates : Schema.Never, "unsupportedProfile");
  const decodeUpdateReservation = commerceDecoder(stock ? ReservationUpdates : Schema.Never, "unsupportedProfile");
  const decodeRelease = commerceDecoder(stock ? ReservationIds : Schema.Never, "unsupportedProfile");
  const decodeReservationsRead = commerceDecoder(stock ? ReservationRead : Schema.Never, "unsupportedProfile");
  return yield* Effect.fromResult(Result.gen(function* () {
    const item = metadata.frame.tables.find(table => table.name === "inventory_item");
    const level = metadata.frame.tables.find(table => table.name === "inventory_level");
    const reservation = metadata.frame.tables.find(table => table.name === "reservation_item");
    if (!item || !level || !reservation) return yield* Result.fail(commerceError("unsupportedProfile"));
    const prepared = yield* prepareScalarRepository(item, "InventoryItem", scalarIdWhere,
      inventoryQuantityProjection([...level.columns, ...reservation.columns]));
    const levels = yield* prepareInventoryQuantityRepository(level, "InventoryLevel", stock);
    const reservations = yield* prepareInventoryQuantityRepository(reservation, "ReservationItem", stock);
    const bind = (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = prepared.bind(ctx, owner);
      const levelBound = levels.bind(ctx, owner, bound.events);
      const reservationBound = reservations.bind(ctx, owner, bound.events);
      const denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const levelRepository = { ...(stock ? levelBound.repository : denied), create: (input: unknown, shared?: Context) =>
        captureCommerceInput(input, ctx.resources).pipe(Result.flatMap(decodeLevels), Result.match({
          onFailure: error => owner.run(ctx.refuse(error)),
          onSuccess: rows => levelBound.repository.create([...rows], shared),
        })), getStockedQuantity: bound.refuse, getReservedQuantity: bound.refuse, getAvailableQuantity: bound.refuse };
      const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message),
          check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse,
        });
      return { baseRepository: bound.repository, repository: (model: typeof InventoryItem | typeof InventoryLevel | typeof ReservationItem) => model === InventoryItem ? bound.repository : model === InventoryLevel ? levelRepository : stock ? reservationBound.repository : denied,
        events: bound.mutationEvents, eventBus, levelRepository, refuse: bound.refuse };
    };
    const module = yield* defineCommerceModule({ name: "flarex-inventory-local", models: [InventoryItem, InventoryLevel, ReservationItem],
      profile: { name: stock ? "inventory-stock-mutations" : admission === "levels" ? "inventory-stock-levels" : "inventory-variant-items", capabilities: [], bind },
      extensions: { inventoryLevelService: { mode: "replace", create: ({ binding, persistence }) => {
        const container = { inventoryLevelRepository: binding.levelRepository, modulePersistenceAdapter: persistence };
        return new InventoryLevelService(container);
      } } },
      service: ({ binding, dependencies, context }) => {
        const container = { ...dependencies, [Modules.EVENT_BUS]: binding.eventBus };
        const native = new InventoryModuleService(container, { scope: "internal" });
        return { service: { createInventoryItems: native.createInventoryItems.bind(native), createInventoryLevels: native.createInventoryLevels.bind(native),
          // The native implementation's MedusaContext decorator is at slot 3,
          // even for the two-argument array overload. Preserve that actual ABI.
          adjustInventory: stock ? (input: typeof Adjustments.Type, shared: Context) =>
            Reflect.apply(native.adjustInventory, native, [[...input], undefined, undefined, shared]) : binding.refuse,
          createReservationItems: stock ? native.createReservationItems.bind(native) : binding.refuse,
          updateReservationItems: stock ? native.updateReservationItems.bind(native) : binding.refuse,
          softDeleteReservationItems: stock ? native.softDeleteReservationItems.bind(native) : binding.refuse,
          listReservationItems: stock ? native.listReservationItems.bind(native) : binding.refuse,
          listAndCountInventoryItems: native.listAndCountInventoryItems.bind(native) }, context };
      },
    }).pipe(Result.mapError(error => commerceError("unsupportedProfile", error)));
    const commands = commerceServiceCommands(module.use);
    const prepare = commerceCommandPreparation("Inventory.prepare");
    const create = commands.write("inventoryCreate", prepare(decodeCreate), ({ service, context }, items) =>
      Array.isArray(items) ? service.createInventoryItems(items, context) : service.createInventoryItems(items, context));
    const createLevels = commands.write("inventoryCreateLevels", prepare(decodeLevels), ({ service, context }, levels) => service.createInventoryLevels([...levels], context));
    const count = commands.read("inventoryCount", prepare(decodeRead), ({ service, context }, args) => service.listAndCountInventoryItems(args.filters,
      args.config as FindConfig<InventoryTypes.InventoryItemDTO> | undefined, context));
    const adjust = commands.write("inventoryAdjust", prepare(decodeAdjust), ({ service, context }, input) => service.adjustInventory(input, context));
    const reserve = commands.write("inventoryReserve", prepare(decodeReserve), ({ service, context }, input) => service.createReservationItems([...input], context));
    const updateReservation = commands.write("inventoryUpdateReservation", prepare(decodeUpdateReservation), ({ service, context }, input) => service.updateReservationItems([...input], context));
    const release = commands.write("inventoryRelease", prepare(decodeRelease), async ({ service, context }, input) => {
      const result = await service.softDeleteReservationItems([...input], undefined, context);
      if (result !== undefined) throw commerceError("storedCorruption");
      return null;
    });
    const listReservations = commands.read("inventoryListReservations", prepare(decodeReservationsRead), ({ service, context }, input) => service.listReservationItems(input.filters,
      input.config as FindConfig<InventoryTypes.ReservationItemDTO> | undefined, context));
    const joiner = inventoryStaticResources.joinerConfig;
    if (!joiner) return yield* Result.fail(commerceError("unsupportedProfile"));
    const graph = yield* scalarGraphDefinition(yield* moduleAliases({ ...joiner, alias: (Array.isArray(joiner.alias) ? joiner.alias : []).filter(alias => alias.entity === "InventoryItem") }), "InventoryItem", count, prepared.table);
    const decodeItemArguments = commerceDecoder(Schema.Tuple([Items]), "invalidInput");
    const decodeLevelArguments = commerceDecoder(Schema.Tuple([levelInput]), "unsupportedProfile");
    const createInventoryItems = yield* defineWorkflowMethod({ command: create, arguments: decodeItemArguments, encode: ([items]) => [...items],
      output: commerceDecoder(InventoryItemsOutput, "storedCorruption"), moduleEvents: [buildModuleResourceEventName({ prefix: Modules.INVENTORY, objectName: "inventory_item", action: "created" })] });
    const createInventoryLevels = yield* defineWorkflowMethod({ command: createLevels, arguments: decodeLevelArguments, encode: ([levels]) => [...levels],
      output: commerceDecoder(admission !== "items" ? InventoryLevelsOutput : EmptyLevels, "storedCorruption"),
      moduleEvents: admission !== "items" ? [buildModuleResourceEventName({ prefix: Modules.INVENTORY, objectName: "inventory_level", action: "created" })] : [] });
    const levelUpdated = "inventory.inventory-level.updated";
    const reservationCreated = "inventory.reservation-item.created";
    const reservationUpdated = "inventory.reservation-item.updated";
    const reservationDeleted = "inventory.reservation-item.deleted";
    const adjustArgs = commerceDecoder(Schema.Tuple([Adjustments]), "unsupportedProfile");
    const reserveArgs = commerceDecoder(Schema.Tuple([ReservationCreates]), "unsupportedProfile");
    const updateArgs = commerceDecoder(Schema.Tuple([ReservationUpdates]), "unsupportedProfile");
    const releaseArgs = commerceDecoder(Schema.Tuple([ReservationIds]), "unsupportedProfile");
    const listArgs = commerceDecoder(Schema.Tuple([Schema.Struct({ id: Schema.Array(ScalarId) }), Schema.Struct({ select: Schema.Array(Schema.String), relations: Schema.Array(Schema.String).check(Schema.isMaxLength(0)) })]), "unsupportedProfile");
    const adjustInventory = yield* defineWorkflowMethod({ command: adjust, arguments: adjustArgs, encode: ([input]) => [...input],
      output: commerceDecoder(InventoryLevelsOutput, "storedCorruption"), moduleEvents: [levelUpdated] });
    const createReservationItems = yield* defineWorkflowMethod({ command: reserve, arguments: reserveArgs, encode: ([input]) => [...input],
      output: commerceDecoder(ReservationOutput, "storedCorruption"), moduleEvents: [reservationCreated, levelUpdated] });
    const updateReservationItems = yield* defineWorkflowMethod({ command: updateReservation, arguments: updateArgs, encode: ([input]) => [...input],
      output: commerceDecoder(ReservationOutput, "storedCorruption"), moduleEvents: [reservationUpdated, levelUpdated] });
    const softDeleteReservationItems = yield* defineWorkflowMethod({ command: release, arguments: releaseArgs, encode: ([input]) => [...input],
      output: commerceDecoder(Schema.Null, "storedCorruption"), moduleEvents: [reservationDeleted, levelUpdated] });
    const listReservationItems = yield* defineWorkflowMethod({ command: listReservations,
      arguments: listArgs,
      encode: ([filters, config]) => ({ filters: { id: [...filters.id] }, config: { select: [...config.select], relations: [...config.relations] } }),
      output: commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(1)), "storedCorruption") });
    const allCommands = [create, createLevels, count, adjust, reserve, updateReservation, release, listReservations];
    const workflow = yield* defineWorkflowModule({ name: Modules.INVENTORY, source: module.description, methods: { createInventoryItems, createInventoryLevels,
      adjustInventory, createReservationItems, updateReservationItems, softDeleteReservationItems, listReservationItems }, graph,
      logical: { ...policy(), commands: allCommands } });
    return { create, createLevels, count, adjust, reserve, updateReservation, release, listReservations, commands: allCommands, workflow, graph, withService: module.use,
      logicalEventPolicy: policy };
  }));
});
