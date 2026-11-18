import { Result, Schema, type Effect } from "effect";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { compileRowProjection } from "../../value/complete-row";
import { NativePreimageConfig } from "../../workflow/preimage";
import type { captureShippingProfileDeletionMetadata } from "./shipping-profile-schema";
import { compileShippingOptionTypeCreationContracts } from "./shipping-option-type-input";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
export const ShippingOptionTypeUpdateIds = Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const ShippingOptionTypeUpdateSelector = Schema.Struct({ id: Schema.Union([Id, ShippingOptionTypeUpdateIds]) });
/** Native public update.id retargets the internal update lookup. It does not
 * change the stored primary key or bind the target to the original selector. */
export const ShippingOptionTypeUpdateData = Schema.Struct({ id: Schema.optionalKey(Id), label: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.NullOr(Schema.String)), code: Schema.optionalKey(Schema.String) });
export const ShippingOptionTypeUpdateInput = Schema.Struct({ selector: ShippingOptionTypeUpdateSelector, update: ShippingOptionTypeUpdateData });
export const ShippingOptionTypeUpdateReadInput = Schema.Struct({ filters: ShippingOptionTypeUpdateSelector, config: Schema.optionalKey(NativePreimageConfig) });
/** Genuine retained inverse inputs need identity; complete missing rows may be
 * created, existing tombstones updated, and repeated IDs processed sequentially. */
export const ShippingOptionTypeUpdateUpserts = Schema.Array(Schema.Struct({ ...ShippingOptionTypeUpdateData.fields, id: Id }))
  .pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const ShippingOptionTypeUpsertRows = ShippingOptionTypeUpdateUpserts;
const decodeInputShape = commerceDecoder(ShippingOptionTypeUpdateInput, "invalidInput");
const decodeUpsertShape = commerceDecoder(ShippingOptionTypeUpdateUpserts, "invalidInput");
export const decodeShippingOptionTypeUpdateInput = (input: unknown) => captureCommerceInput(input).pipe(Result.flatMap(decodeInputShape));
export const decodeShippingOptionTypeUpdateUpserts = (input: unknown) => captureCommerceInput(input).pipe(Result.flatMap(decodeUpsertShape));
const decodeRowsShape = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), "storedCorruption");
type Metadata = Effect.Success<ReturnType<typeof captureShippingProfileDeletionMetadata>>["frame"];

/** Creation and update share checked scalar metadata, but native update/list/
 * upsert never initialize the creation-only empty shipping_options field. */
export function compileShippingOptionTypeUpdateContracts(metadata: Metadata) {
  return Result.gen(function* () {
    const creation = yield* compileShippingOptionTypeCreationContracts(metadata), { table, decodeRow, defaults } = creation;
    const projection = yield* compileRowProjection(table);
    const decodeProjectedRow = (input: unknown) => Result.gen(function* () {
      const row = yield* projection(input);
      if (typeof row.id !== "string" || row.id.length === 0 || row.id.length > 256)
        return yield* Result.fail(commerceError("storedCorruption"));
      const identified: JsonObject & { readonly id: string } = { ...row, id: row.id };
      return identified;
    });
    const decode = (input: unknown, full: boolean, activeUnique: boolean) => Result.gen(function* () {
      const rows = yield* decodeRowsShape(input), keys = new Set<string>();
      const output: Array<JsonObject & { readonly id: string }> = [];
      for (const value of rows) {
        const row = yield* (full ? decodeRow(value) : decodeProjectedRow(value));
        if (activeUnique && (keys.has(row.id) || row.deleted_at !== undefined && row.deleted_at !== null))
          return yield* Result.fail(commerceError("storedCorruption"));
        keys.add(row.id); output.push(row);
      }
      return output;
    });
    const decodeRows = (input: unknown) => decode(input, true, true);
    const decodeUpsertRows = (input: unknown) => decode(input, true, false);
    const decodePreimages = (input: unknown) => decode(input, false, true);
    // The native serializer is used by both projected list and physical upsert.
    const decodeSerializedRows = (input: unknown) => decode(input, false, false);
    const Output = Schema.Array(Schema.JsonObject).check(Schema.makeFilter(rows =>
      Result.isSuccess(decodeRows(rows)) || "Expected complete native ShippingOptionType update rows"));
    return { table, defaults, decodeRow, decodeRows, decodeUpsertRows, decodePreimages, decodeSerializedRows, Output };
  });
}
