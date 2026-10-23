import { Result, Schema, type Effect } from "effect";
import { fillEmptyToManyRelations } from "@medusajs/drizzle/relation-query";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { decodeCompiledDml } from "../../schema/compiled";
import { compileCompleteRow } from "../../value/complete-row";
import { commerceDecoder } from "../../value/decoder";

/** Native creation initializes the inverse presentation without hydrating it.
 * Scalar reads and updates keep their independent native presentation. */
export function compileShippingProfileCreationOutput(table: Effect.Success<ReturnType<typeof decodeCompiledDml>>["tables"][number], maximum: number) {
  return Result.gen(function* () {
    if (table.name !== "shipping_profile" || table.relationships.length !== 1 ||
      table.relationships[0]?.name !== "shipping_options" || table.relationships[0].type !== "hasMany" ||
      table.relationships[0].cascadeDelete || table.foreignKeys.length || table.cascades.delete.length || table.cascades.detach.length)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const complete = yield* compileCompleteRow(table);
    const decodeShape = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(maximum)), "storedCorruption");
    const decodeEmpty = commerceDecoder(Schema.Array(Schema.Never), "storedCorruption");
    const decodeRow = (input: unknown) => Result.gen(function* () {
      const row = yield* complete(input);
      if (typeof row.id !== "string" || row.id.length === 0 || row.id.length > 256)
        return yield* Result.fail(commerceError("storedCorruption"));
      const identified: JsonObject & { readonly id: string } = { ...row, id: row.id };
      return identified;
    });
    const decodeRows = (input: unknown) => Result.gen(function* () {
      const output: Array<JsonObject & { readonly id: string; readonly shipping_options: readonly never[] }> = [];
      for (const value of yield* decodeShape(input)) {
        const { shipping_options, ...scalar } = value;
        const row = yield* decodeRow(scalar), options = yield* decodeEmpty(shipping_options);
        if (row.deleted_at !== null) return yield* Result.fail(commerceError("storedCorruption"));
        output.push({ ...row, shipping_options: options });
      }
      return output;
    });
    const descriptors = new Map(table.relationships.map(relationship => [relationship.name, { relationship }]));
    const initializeRows = (input: unknown) => Result.gen(function* () {
      const rows: JsonObject[] = [];
      for (const value of yield* decodeShape(input)) rows.push({ ...yield* decodeRow(value) });
      fillEmptyToManyRelations(rows, descriptors);
      return yield* decodeRows(rows);
    });
    const Output = Schema.Array(Schema.JsonObject).check(Schema.makeFilter(rows =>
      Result.isSuccess(decodeRows(rows)) || "Expected complete native ShippingProfile creation rows"));
    return { decodeRow, decodeRows, initializeRows, Output };
  });
}
