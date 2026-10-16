import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import { orderNativeIdRows } from "../../repository/result";
import { QueryEnvelope } from "../../query/decoder";
import { inventoryLevelAvailableQuantity } from "@medusajs/inventory/inventory-level-quantity";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere, ScalarId } from "../../repository/scalar-id-read";
import { compileKeyedUpdates } from "../../write/keyed";
import { commerceDecoder, commerceRowDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { captureExactNumericRow, captureExactNumericUpdatePair, projectExactNumericColumns, ExactNumericRaw } from "../../value/exact-numeric";
import type { SchemaTable } from "../../schema/model";
import type { WherePolicy } from "../../query/predicate";
import { commerceError, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";

const raw = commerceDecoder(ExactNumericRaw, "storedCorruption");
const envelope = commerceDecoder(QueryEnvelope, "unsupportedProfile");
const where = commerceDecoder(Schema.JsonObject, "unsupportedProfile");
const tuple = commerceDecoder(Schema.Struct({ inventory_item_id: ScalarId, location_id: ScalarId }), "unsupportedProfile");
const decodePairs = commerceDecoder(Schema.Array(Schema.Struct({ entity: Schema.JsonObject, update: Schema.JsonObject })).check(Schema.isMaxLength(8)), "unsupportedProfile");
const decodeId = commerceDecoder(ScalarId, "storedCorruption");
const decodeObjects = commerceDecoder(Schema.Array(Schema.JsonObject), "storedCorruption");
const ids = commerceDecoder(Schema.Array(ScalarId).check(Schema.isMaxLength(1)), "unsupportedProfile");
const strings = commerceDecoder(Schema.Union([ScalarId, Schema.Array(ScalarId).check(Schema.isMaxLength(8))]), "unsupportedProfile");
export const inventoryLevelWhere: WherePolicy = { ...scalarIdWhere,
  fields: new Map(["id", "inventory_item_id", "location_id"].map(column => [column, { column, decode: strings }])),
  selectors: { mode: "tuples", key: "id", decode: commerceDecoder(Schema.Array(Schema.Union([
    Schema.Struct({ id: Schema.Union([ScalarId, Schema.Array(ScalarId)]) }),
    Schema.Struct({ inventory_item_id: ScalarId, location_id: ScalarId }),
  ])).check(Schema.isMaxLength(8)), "unsupportedProfile") },
};

/** Native arithmetic reads retain exact decimal strings. Only the public DAL
 * serialization boundary converts complete, checked pairs to numeric DTOs. */
export function inventoryQuantityProjection(columns: readonly SchemaTable["columns"][number][], exact = false) {
  const numeric = columns.filter(column => column.type === "bigNumber");
  return Effect.fn("InventoryQuantity.project")(function* (value: Json) {
    const output: JsonObject[] = [];
    const projected = yield* projectExactNumericColumns(value, numeric, exact ? "exact" : "dto");
    for (const entry of Array.isArray(projected) ? projected : [projected]) {
      const row = { ...entry };
      const stored = row;
      if (Object.hasOwn(stored, "available_quantity") || Object.hasOwn(stored, "stocked_quantity") && Object.hasOwn(stored, "reserved_quantity")) {
        const stocked = yield* Effect.fromResult(raw(stored.raw_stocked_quantity));
        const reserved = yield* Effect.fromResult(raw(stored.raw_reserved_quantity));
        const available = yield* Effect.try({ try: () => inventoryLevelAvailableQuantity(stocked, reserved), catch: cause => commerceError("storedCorruption", cause) });
        if (!Number.isFinite(available.numeric) || available.raw === undefined) return yield* Effect.fail(commerceError("storedCorruption"));
        row.available_quantity = exact ? available.raw.value : available.numeric;
      }
      output.push(row);
    }
    return Array.isArray(value) ? output : output[0]!;
  });
}

/** Inventory's exact quantities extend shared scalar DAL mechanics. Native
 * services retain availability checks and reservation-to-level adjustments. */
export function prepareInventoryQuantityRepository(table: SchemaTable, model: "InventoryLevel" | "ReservationItem",
  profile: "read-only" | "stock-mutations" | "level-updates") {
  return Result.gen(function* () {
    if (!["read-only", "stock-mutations", "level-updates"].includes(profile) || profile === "level-updates" && model !== "InventoryLevel")
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const levelUpdates = profile === "level-updates", mutable = profile !== "read-only";
    const numeric = table.columns.filter(column => column.type === "bigNumber");
    const project = inventoryQuantityProjection(table.columns);
    const scalar = yield* prepareScalarRepository(table, model, model === "InventoryLevel" ? inventoryLevelWhere : scalarIdWhere,
      levelUpdates ? project : undefined);
    const exactProjection = inventoryQuantityProjection(table.columns, true);
    const updateNumeric = levelUpdates ? numeric.filter(column => ["stocked_quantity", "incoming_quantity"].includes(column.name)) : numeric;
    const updateFields = levelUpdates ? ["inventory_item_id", "location_id", ...updateNumeric.map(column => column.name)]
      : model === "InventoryLevel" ? numeric.map(column => column.name) : ["quantity"];
    const decodeUpdate = commerceRowDecoder(["id", ...updateFields, ...updateNumeric.map(column => "raw_" + column.name)], "unsupportedProfile");
    const pairs = levelUpdates ? commerceDecoder(Schema.Array(Schema.Struct({ entity: Schema.JsonObject, update: Schema.JsonObject }))
      .check(Schema.isMaxLength(4)), "unsupportedProfile") : decodePairs;
    const plan = compileKeyedUpdates({ keyColumn: "id", repeatedKeys: levelUpdates ? "reject" : "preserve", decodeEntries: pairs,
      readEntry: pair => Result.gen(function* () {
        const id = yield* decodeId(pair.entity.id);
        yield* decodeUpdate(pair.update);
        if (levelUpdates) yield* tuple({ inventory_item_id: pair.update.inventory_item_id, location_id: pair.update.location_id });
        return { key: id, update: pair.update };
      }) });
    const bind = (...args: Parameters<typeof scalar.bind>) => {
      const bound = scalar.bind(...args);
      const decodeRows = Effect.fn("InventoryQuantity.decodeRows")(function* (rows: readonly JsonObject[], exact = false) {
        const output = yield* (exact ? exactProjection(rows) : project(rows));
        const decoded = yield* Effect.fromResult(decodeObjects(output));
        return decoded.map(row => structuredClone({ ...row }));
      });
      const repository: DAL.RepositoryService = { ...bound.repository,
        create: levelUpdates ? bound.refuse : (input, shared) => bound.bridge.execute(shared, ctx => bound.bridge.checked(ctx, Effect.gen(function* () {
          if (!Array.isArray(input) || input.length > 8) return yield* ctx.refuse(commerceError("unsupportedProfile"));
          const rows: JsonObject[] = [];
          for (const row of input) rows.push(yield* captureExactNumericRow(row, numeric, true));
          return yield* decodeRows(yield* bound.createRows(ctx, rows, shared), true);
        }))),
        find: (input, shared) => bound.bridge.execute(shared, ctx => bound.bridge.checked(ctx, Effect.gen(function* () {
          const selected = yield* bound.find(ctx, input, false);
          if (levelUpdates && (selected.rows.length > 4 || selected.count !== undefined && selected.count > 4))
            return yield* ctx.refuse(commerceError("unsupportedProfile"));
          if (!levelUpdates) return yield* decodeRows(selected.rows, true);
          const query = yield* Effect.fromResult(envelope(yield* Effect.fromResult(captureCommerceInput(input, ctx.resources))));
          const filter = yield* Effect.fromResult(where(query.where ?? {}));
          const rows: Array<JsonObject & { id: string }> = [];
          for (const row of selected.rows) rows.push({ ...row, id: yield* Effect.fromResult(decodeId(row.id)) });
          return yield* decodeRows(orderNativeIdRows(rows, filter), true);
        }))),
        findAndCount: bound.refuse,
        update: mutable ? (input, shared) => bound.bridge.execute(shared, ctx => bound.bridge.checked(ctx, Effect.gen(function* () {
          if (!Array.isArray(input) || input.length > (levelUpdates ? 4 : 8)) return yield* ctx.refuse(commerceError("unsupportedProfile"));
          const normalized: JsonObject[] = [];
          for (const entry of input) normalized.push(yield* captureExactNumericUpdatePair(entry, updateNumeric));
          const updates = yield* Effect.fromResult(plan(normalized));
          const store = yield* ctx.table(table.name);
          const rows = yield* store.write(ctx.manager, "update", updates);
          if (shared === undefined || !bound.events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
          yield* bound.events.rows("afterUpdate", model, rows.map(row => ({ ...row })), shared);
          return yield* decodeRows(rows, true);
        }))) : bound.refuse,
        softDelete: mutable && model === "ReservationItem" ? (input, shared) => bound.bridge.execute(shared, ctx => bound.bridge.checked(ctx, Effect.gen(function* () {
          const selected = yield* Effect.fromResult(ids(yield* Effect.fromResult(captureCommerceInput(input))));
          const store = yield* ctx.table(table.name);
          const rows = yield* store.lifecycle(ctx.manager, "softDelete", selected.map(id => ({ id })));
          if (shared === undefined || !bound.events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
          const cascades = { [model]: rows.map(row => ({ ...row })) };
          yield* bound.events.cascades(cascades, shared, row => ({ entity: row, originalEntity: { deleted_at: null } }));
          return [yield* decodeRows(rows, true), cascades] satisfies [object[], Record<string, unknown[]>];
        }))) : bound.refuse,
      };
      return { ...bound, repository };
    };
    return { ...scalar, bind };
  });
}
