import { Result, Schema, type Effect } from "effect";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { compileCompleteRow, compileRowProjection } from "../../value/complete-row";
import type { capturePricingMetadata } from "./schema";
import { PricingId } from "./input";

const Text = Schema.String.check(Schema.isLengthBetween(1, 256));
export const StorePreferencePair = Schema.Struct({ attribute: Text, value: Text });
export const StorePreferenceFilters = Schema.Struct({ $or: Schema.Array(StorePreferencePair).pipe(Schema.mutable).check(Schema.isMaxLength(4)) });
const Create = Schema.Struct({ attribute: Text, value: Text, is_tax_inclusive: Schema.optionalKey(Schema.Boolean) });
const Update = Schema.Struct({ id: PricingId, attribute: Schema.optionalKey(Text),
  value: Schema.optionalKey(Schema.NullOr(Text)), is_tax_inclusive: Schema.optionalKey(Schema.Boolean) });
const Previous = Schema.Struct({ id: PricingId, attribute: Text, value: Schema.NullOr(Text), is_tax_inclusive: Schema.Boolean,
  created_at: Schema.String, updated_at: Schema.String, deleted_at: Schema.NullOr(Schema.String) });
export const StorePreferenceUpserts = Schema.Array(Schema.Union([Create, Update, Previous])).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const StorePreferenceIds = Schema.Array(PricingId).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const decodeStorePreferenceFilters = commerceDecoder(StorePreferenceFilters, "invalidInput");
export const decodeStorePreferenceIds = commerceDecoder(StorePreferenceIds, "invalidInput");
export const decodeStorePreferenceCreates = commerceDecoder(Schema.Array(Create).check(Schema.isMaxLength(4)), "unsupportedProfile");
export const decodeStorePreferenceUpsertShape = commerceDecoder(StorePreferenceUpserts, "invalidInput");
export const decodeStorePreferenceDeleteWhere = commerceDecoder(Schema.Struct({ $or: Schema.Array(Schema.Struct({ id: PricingId })).check(Schema.isMaxLength(4)) }), "unsupportedProfile");
export const decodeStorePreferenceFindWhere = commerceDecoder(Schema.Union([StorePreferenceFilters,
  Schema.Struct({ $or: Schema.Array(Schema.Struct({ id: PricingId })).check(Schema.isMaxLength(4)) })]), "unsupportedProfile");
const decodeOutputShape = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), "storedCorruption");
const decodeId = commerceDecoder(PricingId, "storedCorruption");

/** Profile grammar follows the checked native table; raw preference values are
 * independent of Store's lowercased StoreCurrency values. */
export function compileStorePreferenceContracts(metadata: Effect.Success<ReturnType<typeof capturePricingMetadata>>["frame"]) {
  return Result.gen(function* () {
    const table = metadata.tables.find(table => table.name === "price_preference");
    if (table === undefined || table.foreignKeys.length || table.relationships.length ||
      !table.columns.some(column => column.name === "attribute" && column.type === "text" && !column.nullable) ||
      !table.columns.some(column => column.name === "value" && column.type === "text" && column.nullable) ||
      !table.columns.some(column => column.name === "is_tax_inclusive" && column.type === "boolean" && !column.nullable))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const complete = yield* compileCompleteRow(table), projection = yield* compileRowProjection(table);
    const decodeRow = (input: unknown) => Result.gen(function* () {
      const row = yield* complete(input), id = yield* decodeId(row.id);
      const captured: JsonObject & Readonly<{ id: string }> = { ...row, id };
      return captured;
    });
    const decodeOutput = (input: unknown) => Result.gen(function* () {
      const rows = yield* decodeOutputShape(input), output = [];
      for (const row of rows) output.push(yield* decodeRow(row));
      return output;
    });
    const decodeUpsert = (input: unknown) => Result.gen(function* () {
      const rows = yield* decodeStorePreferenceUpsertShape(input);
      for (const row of rows) {
        yield* projection(row);
        if ("created_at" in row) yield* decodeRow(row);
      }
      return rows;
    });
    return { table, decodeRow, decodeOutput, decodeUpsert };
  });
}
