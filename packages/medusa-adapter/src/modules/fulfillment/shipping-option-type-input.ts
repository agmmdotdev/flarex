import { Result, Schema, type Effect } from "effect";
import { fillEmptyToManyRelations, describeToManyRelation } from "@medusajs/drizzle/relation-query";
import { commerceError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { compileCompleteRow } from "../../value/complete-row";
import type { captureShippingProfileDeletionMetadata } from "./shipping-profile-schema";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
/** Only scalar Type creation is admitted. Omission reaches native DML defaults;
 * business strings retain the native empty and case-sensitive values. */
export const ShippingOptionTypeCreate = Schema.Struct({ id: Schema.optionalKey(Id), label: Schema.String,
  description: Schema.optionalKey(Schema.NullOr(Schema.String)), code: Schema.String });
export const ShippingOptionTypeCreates = Schema.Array(ShippingOptionTypeCreate).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const ShippingOptionTypePhysicalDeletionIds = Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const decodeShippingOptionTypeCreates = commerceDecoder(ShippingOptionTypeCreates, "invalidInput");
export const decodeShippingOptionTypePhysicalDeletionIds = commerceDecoder(ShippingOptionTypePhysicalDeletionIds, "invalidInput");
export const decodeShippingOptionTypePhysicalSelection = commerceDecoder(Schema.Struct({
  $or: Schema.Array(Schema.Struct({ id: Id })).check(Schema.isMaxLength(4)),
}), "unsupportedProfile");
const decodeRowsShape = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), "storedCorruption");
const decodeEmptyOptions = commerceDecoder(Schema.Array(Schema.Never).check(Schema.isMaxLength(0)), "storedCorruption");
type Metadata = Effect.Success<ReturnType<typeof captureShippingProfileDeletionMetadata>>["frame"];

/** The existing six-table source remains the one authority for Type storage.
 * Complete scalar returns are DML-derived; generic native empty-to-many
 * initialization adds the selected inverse presentation without querying it. */
export function compileShippingOptionTypeCreationContracts(metadata: Metadata) {
  return Result.gen(function* () {
    const table = metadata.tables.find(table => table.name === "shipping_option_type");
    const option = metadata.tables.find(table => table.name === "shipping_option");
    if (metadata.tables.length !== 6 || table === undefined || option === undefined || table.foreignKeys.length ||
      table.cascades.delete.length || table.cascades.detach.length || table.relationships.length !== 1 ||
      table.relationships[0]?.name !== "shipping_options" || table.relationships[0].type !== "hasMany" ||
      table.relationships[0].cascadeDelete || Object.keys(ShippingOptionTypeCreate.fields).some(name => !table.columns.some(column => column.name === name)))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const relation = describeToManyRelation(table, "shipping_options", metadata.tables);
    if (relation?.targetTable !== option.name || relation.join.type !== "hasMany" ||
      relation.join.foreignKeys.length !== 1 || relation.join.foreignKeys[0] !== "shipping_option_type_id" ||
      relation.sourcePrimaryKeys.length !== 1 || relation.sourcePrimaryKeys[0] !== "id" ||
      relation.targetPrimaryKeys.length !== 1 || relation.targetPrimaryKeys[0] !== "id")
      return yield* Result.fail(commerceError("unsupportedProfile"));
    for (const [name, nullable] of [["id", false], ["label", false], ["description", true], ["code", false]] as const) {
      const column = table.columns.find(column => column.name === name);
      if (column === undefined || column.nullable !== nullable || column.type !== (name === "id" ? "id" : "text") ||
        name === "id" && (!column.primaryKey || column.options?.prefix !== "sotype"))
        return yield* Result.fail(commerceError("unsupportedProfile"));
    }
    const complete = yield* compileCompleteRow(table);
    const decodeRow = (input: unknown) => Result.gen(function* () {
      const row = yield* complete(input);
      if (typeof row.id !== "string" || row.id.length === 0 || row.id.length > 256)
        return yield* Result.fail(commerceError("storedCorruption"));
      const identified: JsonObject & { readonly id: string } = { ...row, id: row.id };
      return identified;
    });
    const descriptors = new Map(table.relationships.map(relationship => [relationship.name, { relationship }]));
    const decodeRows = (input: unknown) => Result.gen(function* () {
      const rows = yield* decodeRowsShape(input);
      const result: Array<JsonObject & { readonly id: string; readonly shipping_options: readonly never[] }> = [];
      for (const value of rows) {
        const { shipping_options, ...scalar } = value;
        const row = yield* decodeRow(scalar), options = yield* decodeEmptyOptions(shipping_options);
        if (row.deleted_at !== null) return yield* Result.fail(commerceError("storedCorruption"));
        result.push({ ...row, shipping_options: options });
      }
      return result;
    });
    const initializeRows = (input: unknown) => Result.gen(function* () {
      const rows: JsonObject[] = [];
      for (const row of yield* decodeRowsShape(input)) rows.push({ ...yield* decodeRow(row) });
      fillEmptyToManyRelations(rows, descriptors);
      return yield* decodeRows(rows);
    });
    const defaults: Record<string, Json> = {};
    for (const column of table.columns) if (!["id", "created_at", "updated_at", "deleted_at"].includes(column.name)) {
      if (column.defaultValue !== undefined) defaults[column.name] = column.defaultValue;
      else if (column.nullable) defaults[column.name] = null;
    }
    const Output = Schema.Array(Schema.JsonObject).check(Schema.makeFilter(rows =>
      Result.isSuccess(decodeRows(rows)) || "Expected complete native ShippingOptionType creation rows"));
    return { table, relation, defaults, decodeRow, decodeRows, initializeRows, Output };
  });
}
