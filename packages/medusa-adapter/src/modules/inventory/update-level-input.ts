import { Effect, Result, Schema } from "effect";
import { commerceError, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { jsonEqual } from "flarex-protocol/json";
import type { SchemaTable } from "../../schema/model";
import { ScalarId } from "../../repository/scalar-id-read";
import { commerceDecoder } from "../../value/decoder";
import { compileCompleteRow } from "../../value/complete-row";
import { projectExactNumericColumns, ExactNumericRaw } from "../../value/exact-numeric";
import { inventoryQuantityProjection } from "./quantity-repository";

const Quantity = Schema.Number.check(Schema.isFinite());
export const InventoryLevelUpdate = Schema.Struct({ inventory_item_id: ScalarId, location_id: ScalarId,
  id: Schema.optionalKey(ScalarId), stocked_quantity: Schema.optionalKey(Quantity), incoming_quantity: Schema.optionalKey(Quantity) });
export const InventoryLevelUpdates = Schema.Array(InventoryLevelUpdate).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const InventoryLevelUpdateCommandInput = Schema.Union([InventoryLevelUpdate, InventoryLevelUpdates]);
export const InventoryLevelUpdateInput = Schema.Struct({ updates: InventoryLevelUpdates });
const Tuple = Schema.Struct({ inventory_item_id: ScalarId, location_id: ScalarId });
export const InventoryLevelUpdateReadInput = Schema.Struct({ filters: Schema.Struct({
  $or: Schema.Array(Tuple).pipe(Schema.mutable).check(Schema.isMaxLength(4)),
}), config: Schema.Struct({}) });
const StoredQuantity = Schema.Union([Schema.String, Quantity]);
const StoredLevel = Schema.Struct({ id: ScalarId, inventory_item_id: ScalarId, location_id: ScalarId,
  stocked_quantity: StoredQuantity, reserved_quantity: StoredQuantity, incoming_quantity: StoredQuantity,
  raw_stocked_quantity: ExactNumericRaw, raw_reserved_quantity: ExactNumericRaw, raw_incoming_quantity: ExactNumericRaw,
  metadata: Schema.Json, created_at: Schema.String, updated_at: Schema.String, deleted_at: Schema.NullOr(Schema.String) });
/** Native DTOs may omit raw companions. Present companions retain exact native
 * values; storage rows always require every checked DML column and companion. */
export const InventoryLevelUpdateRow = Schema.Struct({ ...StoredLevel.fields,
  stocked_quantity: Quantity, reserved_quantity: Quantity, incoming_quantity: Quantity, available_quantity: Quantity,
  raw_stocked_quantity: Schema.optionalKey(ExactNumericRaw), raw_reserved_quantity: Schema.optionalKey(ExactNumericRaw),
  raw_incoming_quantity: Schema.optionalKey(ExactNumericRaw) });
export const InventoryLevelUpdateOutput = Schema.Array(InventoryLevelUpdateRow).check(Schema.isMaxLength(4));
export const decodeInventoryLevelUpdates = commerceDecoder(InventoryLevelUpdates, "invalidInput");
export const decodeInventoryLevelUpdateCommandInput = commerceDecoder(InventoryLevelUpdateCommandInput, "invalidInput");
export const decodeInventoryLevelUpdateReadInput = commerceDecoder(InventoryLevelUpdateReadInput, "invalidInput");

export function compileInventoryLevelUpdateContracts(table: SchemaTable) {
  return Result.gen(function* () {
    if (table.name !== "inventory_level" || table.columns.length !== Object.keys(StoredLevel.fields).length ||
      table.columns.some(column => !Object.hasOwn(StoredLevel.fields, column.name)))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const numeric = table.columns.filter(column => column.type === "bigNumber");
    if (numeric.length !== 3 || numeric.some(column => !["stocked_quantity", "reserved_quantity", "incoming_quantity"].includes(column.name)))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const complete = yield* compileCompleteRow(table), shape = commerceDecoder(StoredLevel, "storedCorruption");
    const decodeStoredRow = Effect.fn("InventoryLevelUpdate.decodeStoredRow")(function* (input: unknown) {
      const row = yield* Effect.fromResult(complete(input).pipe(Result.flatMap(shape)));
      yield* projectExactNumericColumns(row, numeric, "exact");
      return row;
    });
    const decodeRow = commerceDecoder(InventoryLevelUpdateRow, "storedCorruption");
    const decodeRows = commerceDecoder(InventoryLevelUpdateOutput, "storedCorruption");
    const project = inventoryQuantityProjection(table.columns);
    const matchesResult = Effect.fn("InventoryLevelUpdate.matchesResult")(function* (stored: JsonObject, input: Json) {
      const actual: JsonObject = yield* Effect.fromResult(decodeRow(input));
      const expected = yield* project(stored);
      if (!isJsonObject(expected)) return false;
      for (const [field, value] of Object.entries(expected)) {
        const returned = actual[field];
        if (field.startsWith("raw_") && returned === undefined) continue;
        if (returned === undefined || !jsonEqual(returned, value)) return false;
      }
      return true;
    });
    return { numeric, decodeStoredRow, decodeRow, decodeRows, matchesResult };
  });
}
