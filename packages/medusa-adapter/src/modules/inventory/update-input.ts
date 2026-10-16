import { Result, Schema } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { SchemaTable } from "../../schema/model";
import { commerceDecoder } from "../../value/decoder";
import { compileCompleteRow } from "../../value/complete-row";
import { InventoryId, InventoryItemInput } from "./item-input";

/** Raw duplicates remain native service input; they still consume the bound. */
export const InventoryItemUpdate = Schema.Struct({ ...InventoryItemInput.fields, id: InventoryId });
export const InventoryItemUpdates = Schema.Array(InventoryItemUpdate).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const InventoryItemUpdateCommandInput = Schema.Union([InventoryItemUpdate, InventoryItemUpdates]);
export const InventoryItemUpdateInput = Schema.Struct({ updates: InventoryItemUpdates });
export const InventoryItemUpdateReadInput = Schema.Struct({ filters: Schema.Struct({ id: Schema.Array(InventoryId).check(Schema.isMaxLength(4)) }), config: Schema.Struct({}) });
const Text = Schema.NullOr(Schema.String), Dimension = Schema.NullOr(Schema.Number.check(Schema.isFinite()));
export const InventoryItemUpdateRow = Schema.Struct({ id: InventoryId, sku: Text, origin_country: Text, hs_code: Text, mid_code: Text,
  material: Text, weight: Dimension, length: Dimension, height: Dimension, width: Dimension, requires_shipping: Schema.Boolean,
  description: Text, title: Text, thumbnail: Text, metadata: Schema.NullOr(Schema.JsonObject),
  created_at: Schema.String, updated_at: Schema.String, deleted_at: Schema.NullOr(Schema.String) });
export const InventoryItemUpdateOutput = Schema.Array(InventoryItemUpdateRow).check(Schema.isMaxLength(4));
export const decodeInventoryItemUpdates = commerceDecoder(InventoryItemUpdates, "invalidInput");
export const decodeInventoryItemUpdateCommandInput = commerceDecoder(InventoryItemUpdateCommandInput, "invalidInput");
export const decodeInventoryItemUpdateReadInput = commerceDecoder(InventoryItemUpdateReadInput, "invalidInput");

export function compileInventoryItemUpdateContracts(table: SchemaTable) {
  return Result.gen(function* () {
    if (table.name !== "inventory_item" || table.foreignKeys.length !== 0 ||
      table.columns.length !== Object.keys(InventoryItemUpdateRow.fields).length ||
      table.columns.some(column => !Object.hasOwn(InventoryItemUpdateRow.fields, column.name)))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const complete = yield* compileCompleteRow(table);
    const decodeRowShape = commerceDecoder(InventoryItemUpdateRow, "storedCorruption");
    const decodeRow = (input: unknown) => complete(input).pipe(Result.flatMap(decodeRowShape));
    const decodeShape = commerceDecoder(InventoryItemUpdateOutput, "storedCorruption");
    const decodeRows = (input: unknown) => decodeShape(input).pipe(Result.flatMap(rows => Result.gen(function* () {
      for (const row of rows) yield* complete(row);
      return rows;
    })));
    return { decodeRow, decodeRows };
  });
}
