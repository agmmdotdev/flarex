import { Result, Schema, type Effect } from "effect";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { compileCompleteRow, compileRowProjection } from "../../value/complete-row";
import { NativePreimageConfig } from "../../workflow/preimage";
import type { captureShippingProfileMetadata } from "./shipping-profile-schema";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
export const ShippingProfileUpdateIds = Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const ShippingProfileUpdateSelector = Schema.Struct({ id: Schema.Union([Id, ShippingProfileUpdateIds]) });
export const ShippingProfileUpdateData = Schema.Struct({ name: Schema.optionalKey(Schema.String), type: Schema.optionalKey(Schema.String),
  metadata: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)) });
export const ShippingProfileUpdateInput = Schema.Struct({ selector: ShippingProfileUpdateSelector, update: ShippingProfileUpdateData });
export const ShippingProfileUpdateReadInput = Schema.Struct({ filters: ShippingProfileUpdateSelector, config: Schema.optionalKey(NativePreimageConfig) });
/** Native retained preimages require identity. No create or managed-field write
 * authority is admitted by this inverse method. */
export const ShippingProfileUpdateUpserts = Schema.Array(Schema.Struct({ id: Id, ...ShippingProfileUpdateData.fields }))
  .pipe(Schema.mutable).check(Schema.isMaxLength(4));
const decodeInputShape = commerceDecoder(ShippingProfileUpdateInput, "invalidInput");
const decodeUpsertShape = commerceDecoder(ShippingProfileUpdateUpserts, "invalidInput");
export const decodeShippingProfileUpdateInput = (input: unknown) => captureCommerceInput(input).pipe(Result.flatMap(decodeInputShape));
export const decodeShippingProfileUpdateUpserts = (input: unknown) => captureCommerceInput(input).pipe(Result.flatMap(decodeUpsertShape));
const decodeRowsShape = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), "storedCorruption");

type Metadata = Effect.Success<ReturnType<typeof captureShippingProfileMetadata>>["frame"];
export function compileShippingProfileUpdateContracts(metadata: Metadata) {
  return Result.gen(function* () {
    const table = metadata.tables[0];
    if (metadata.tables.length !== 1 || table?.name !== "shipping_profile" ||
      Object.keys(ShippingProfileUpdateData.fields).some(name => !table.columns.some(column => column.name === name)))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const complete = yield* compileCompleteRow(table), projection = yield* compileRowProjection(table);
    const identified = (input: unknown, full: boolean) => Result.gen(function* () {
      const row = yield* (full ? complete(input) : projection(input));
      if (typeof row.id !== "string" || row.id.length === 0 || row.id.length > 256)
        return yield* Result.fail(commerceError("storedCorruption"));
      const identified: JsonObject & { readonly id: string } = { ...row, id: row.id };
      return identified;
    });
    const decodeRow = (input: unknown) => identified(input, true);
    const decodeRows = (input: unknown) => Result.gen(function* () {
      const rows = yield* decodeRowsShape(input), keys = new Set<string>();
      const output: Array<JsonObject & { readonly id: string }> = [];
      for (const value of rows) {
        const row = yield* decodeRow(value);
        if (keys.has(row.id) || row.deleted_at !== null) return yield* Result.fail(commerceError("storedCorruption"));
        keys.add(row.id); output.push(row);
      }
      return output;
    });
    const decodePreimages = (input: unknown) => Result.gen(function* () {
      const rows = yield* decodeRowsShape(input), keys = new Set<string>();
      const output: Array<JsonObject & { readonly id: string }> = [];
      for (const value of rows) {
        const row = yield* identified(value, false);
        if (keys.has(row.id) || row.deleted_at !== undefined && row.deleted_at !== null)
          return yield* Result.fail(commerceError("storedCorruption"));
        keys.add(row.id); output.push(row);
      }
      return output;
    });
    const Output = Schema.Array(Schema.JsonObject).check(Schema.makeFilter(rows =>
      Result.isSuccess(decodeRows(rows)) || "Expected complete native ShippingProfile rows"));
    return { table, decodeRow, decodeRows, decodePreimages, Output };
  });
}
