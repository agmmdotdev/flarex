import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { prepareScalarRepository } from "../../repository/scalar";
import { deniedCommerceRepository } from "../../repository/denied";
import { medusaLifecycle } from "../../repository/lifecycle";
import { projectNativeRow } from "../../repository/result";
import { ScalarId } from "../../repository/scalar-id-read";
import type { WherePolicy } from "../../query/predicate";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import type { captureInventoryMetadata } from "./schema";
import { compileReservationLineItemContracts, ReservationLineItemIds } from "./reservation-line-item-input";
import { prepareInventoryQuantityRepository, inventoryQuantityProjection } from "./quantity-repository";

type Frame = Effect.Success<ReturnType<typeof captureInventoryMetadata>>["frame"];
const LineItemSelector = Schema.Struct({ line_item_id: Schema.Union([ScalarId, ReservationLineItemIds]) });
const decodeSelector = commerceDecoder(LineItemSelector, "unsupportedProfile");
const decodeFilter = commerceDecoder(Schema.Union([ScalarId, ReservationLineItemIds]), "unsupportedProfile");
const decodeQuery = commerceDecoder(Schema.Struct({ where: LineItemSelector, options: Schema.optionalKey(Schema.Struct({
  orderBy: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.Literal("ASC")) })),
  populate: Schema.optionalKey(Schema.Array(Schema.Never)),
  filters: Schema.optionalKey(Schema.Struct({ softDeletable: Schema.Struct({ withDeleted: Schema.Boolean }) })),
})) }), "unsupportedProfile");
const decodeObjects = commerceDecoder(Schema.Array(Schema.JsonObject), "storedCorruption");
const where: WherePolicy = { decode: decodeSelector,
  fields: new Map([["line_item_id", { column: "line_item_id", decode: decodeFilter }]]) };

/** The profile sees complete indexed Line Item history before native visibility
 * projection. No page or active-only index can hide a bound overflow. */
export function prepareReservationLineItemRepository(frame: Frame) {
  return Result.gen(function* () {
    const table = frame.tables.find(table => table.name === "reservation_item"), level = frame.tables.find(table => table.name === "inventory_level");
    if (table === undefined || level === undefined || table.relationships.some(relation => relation.cascadeDelete))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const contracts = yield* compileReservationLineItemContracts(frame.tables);
    const scalar = yield* prepareScalarRepository(table, "ReservationItem", where, inventoryQuantityProjection(table.columns));
    const levels = yield* prepareInventoryQuantityRepository(level, "InventoryLevel", "reservation-line-items");
    const exactProjection = inventoryQuantityProjection(table.columns, true);
    const bind = (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = scalar.bind(ctx, owner), levelBound = levels.bind(ctx, owner, bound.events);
      const history = Effect.fn("ReservationLineItem.history")(function* (current: CommerceCommandContext, selector: typeof LineItemSelector.Type) {
        const selected = yield* bound.find(current, { where: selector, options: { orderBy: { id: "ASC" },
          filters: { softDeletable: { withDeleted: true } } } }, true);
        if (selected.count === undefined || selected.count !== selected.rows.length || selected.count > 4)
          return yield* current.refuse(commerceError("unsupportedProfile"));
        const ids = typeof selector.line_item_id === "string" ? [selector.line_item_id] : selector.line_item_id;
        const rows: JsonObject[] = [];
        for (const value of selected.rows) {
          const row = yield* contracts.decodeStoredRow(value);
          if (row.line_item_id === null || !ids.includes(row.line_item_id)) return yield* current.refuse(commerceError("storedCorruption"));
          rows.push(row);
        }
        return rows;
      });
      const lifecycle = (operation: "softDelete" | "restore"): DAL.RepositoryService["softDelete"] => (input, shared) =>
        bound.bridge.executeInput(shared, input, (current, captured) => bound.bridge.checked(current, Effect.gen(function* () {
          const selector = yield* Effect.fromResult(captureCommerceInput(captured, current.resources).pipe(Result.flatMap(decodeSelector)));
          const roots = (yield* history(current, selector)).filter(row => operation !== "softDelete" || row.deleted_at === null);
          const owner = medusaLifecycle(current, { tables: frame.tables, entities: [{ table, model: "ReservationItem" }] }, operation);
          const plan = yield* owner.plan(table, roots);
          if (frame.tables.some(candidate => candidate !== table && plan.rows(candidate).length !== 0))
            return yield* current.refuse(commerceError("unsupportedProfile"));
          const result = yield* plan.apply();
          for (const row of result.roots) yield* contracts.decodeStoredRow(projectNativeRow(row));
          // Native restore has no subscriber registration; the genuine dispatch
          // owner then uses its conventional aggregator branch.
          if (shared === undefined || operation === "softDelete" && !bound.events.isSubscribed(shared))
            return yield* current.refuse(commerceError("unadmittedEvent"));
          yield* bound.events.cascades(result.cascades, shared, row => ({ entity: row,
            originalEntity: { deleted_at: operation === "softDelete" ? null : row.updated_at } }));
          return [result.roots, result.cascades] satisfies [object[], Record<string, unknown[]>];
        })));
      const denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const reservationRepository: DAL.RepositoryService = { ...denied, serialize: bound.repository.serialize,
        find: (input, shared) => bound.bridge.executeInput(shared, input, (current, captured) => bound.bridge.checked(current, Effect.gen(function* () {
          const query = yield* Effect.fromResult(captureCommerceInput(captured, current.resources).pipe(Result.flatMap(decodeQuery)));
          const rows = yield* history(current, query.where);
          const visible = query.options?.filters?.softDeletable.withDeleted === true ? rows : rows.filter(row => row.deleted_at === null);
          const output = yield* exactProjection(visible);
          if (!Array.isArray(output)) return yield* current.refuse(commerceError("storedCorruption"));
          return structuredClone([...yield* Effect.fromResult(decodeObjects(output))]);
        }))), softDelete: lifecycle("softDelete"), restore: lifecycle("restore") };
      const levelRepository: DAL.RepositoryService & { getStockedQuantity: typeof bound.refuse;
        getReservedQuantity: typeof bound.refuse; getAvailableQuantity: typeof bound.refuse } = {
        ...levelBound.repository, getStockedQuantity: bound.refuse, getReservedQuantity: bound.refuse, getAvailableQuantity: bound.refuse };
      return { baseRepository: reservationRepository, reservationRepository, levelRepository,
        mutationEvents: bound.mutationEvents, events: bound.events, bridge: bound.bridge, refuse: bound.refuse };
    };
    return { bind, contracts };
  });
}
