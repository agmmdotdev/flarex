import { Result, Schema } from "effect";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import type { SchemaTable } from "../../schema/model";
import { commerceDecoder } from "../../value/decoder";
import { compileCompleteRow } from "../../value/complete-row";
import { InventoryId } from "./item-input";

const Text = Schema.NullOr(Schema.String), Dimension = Schema.NullOr(Schema.Number.check(Schema.isFinite()));
export const InventoryItemRow = Schema.Struct({ id: InventoryId, sku: Text, origin_country: Text, hs_code: Text, mid_code: Text,
  material: Text, weight: Dimension, length: Dimension, height: Dimension, width: Dimension, requires_shipping: Schema.Boolean,
  description: Text, title: Text, thumbnail: Text, metadata: Schema.NullOr(Schema.JsonObject),
  created_at: Schema.String, updated_at: Schema.String, deleted_at: Schema.NullOr(Schema.String) });
export const InventoryItemRows = Schema.Array(InventoryItemRow).check(Schema.isMaxLength(4));

const decodeDefault = commerceDecoder(Schema.Json, "unsupportedProfile");

export function compileInventoryItemContracts(table: SchemaTable) {
  return Result.gen(function* () {
    if (table.name !== "inventory_item" || table.foreignKeys.length !== 0 ||
      table.columns.length !== Object.keys(InventoryItemRow.fields).length ||
      table.columns.some(column => !Object.hasOwn(InventoryItemRow.fields, column.name)))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const complete = yield* compileCompleteRow(table);
    const decodeRowShape = commerceDecoder(InventoryItemRow, "storedCorruption");
    const decodeRow = (input: unknown) => complete(input).pipe(Result.flatMap(decodeRowShape));
    const decodeShape = commerceDecoder(InventoryItemRows, "storedCorruption");
    const decodeRows = (input: unknown) => decodeShape(input).pipe(Result.flatMap(rows => Result.gen(function* () {
      for (const row of rows) yield* complete(row);
      return rows;
    })));
    const creationDefaults: Record<string, Json> = {};
    for (const column of table.columns) if (!["id", "created_at", "updated_at", "deleted_at"].includes(column.name)) {
      if (column.defaultValue !== undefined) creationDefaults[column.name] = yield* decodeDefault(column.defaultValue);
      else if (column.nullable) creationDefaults[column.name] = null;
      else return yield* Result.fail(commerceError("unsupportedProfile"));
    }
    return { decodeRow, decodeRows, creationDefaults: Object.freeze(creationDefaults) };
  });
}
