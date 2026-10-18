import { Result, Schema, type Effect } from "effect";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { compileShippingProfileCreationOutput } from "./shipping-profile-create-output";
import { compileShippingProfileDeletionContracts } from "./shipping-profile-delete-input";
import type { captureShippingProfileDeletionMetadata } from "./shipping-profile-schema";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
export const ShippingProfileCreate = Schema.Struct({ id: Schema.optionalKey(Id), name: Schema.String,
  type: Schema.String, metadata: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)) });
export const ShippingProfileCreates = Schema.Array(ShippingProfileCreate).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const ShippingProfilePhysicalDeletionIds = Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const ShippingProfileCreationInput = Schema.Struct({ data: ShippingProfileCreates });
export const decodeShippingProfileCreates = commerceDecoder(ShippingProfileCreates, "invalidInput");
export const decodeShippingProfilePhysicalDeletionIds = commerceDecoder(ShippingProfilePhysicalDeletionIds, "invalidInput");
export const decodeShippingProfilePhysicalSelection = commerceDecoder(Schema.Struct({
  $or: Schema.Array(Schema.Struct({ id: Id })).check(Schema.isMaxLength(4)),
}), "unsupportedProfile");
type Metadata = Effect.Success<ReturnType<typeof captureShippingProfileDeletionMetadata>>["frame"];

/** The installed six-table schema supplies the real Option validation and
 * nullable inverse reference. No Option write or sibling service is granted. */
export function compileShippingProfileCreationContracts(metadata: Metadata) {
  return Result.gen(function* () {
    const deletion = yield* compileShippingProfileDeletionContracts(metadata), { profile, option } = deletion;
    const foreignKey = option.foreignKeys.find(key => key.columns.length === 1 && key.columns[0] === "shipping_profile_id");
    if (foreignKey === undefined || foreignKey.referencedTable !== profile.name || foreignKey.referencedColumns.length !== 1 ||
      foreignKey.referencedColumns[0] !== "id" || foreignKey.onDelete !== undefined ||
      option.columns.find(column => column.name === "shipping_profile_id")?.nullable !== true)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    for (const [name, type, nullable] of [["id", "id", false], ["name", "text", false], ["type", "text", false], ["metadata", "json", true]] as const) {
      const column = profile.columns.find(column => column.name === name);
      if (column === undefined || column.type !== type || column.nullable !== nullable ||
        name === "id" && (!column.primaryKey || column.options?.prefix !== "sp"))
        return yield* Result.fail(commerceError("unsupportedProfile"));
    }
    const output = yield* compileShippingProfileCreationOutput(profile, 4), defaults: Record<string, Json> = {};
    for (const column of profile.columns) if (!["id", "created_at", "updated_at", "deleted_at"].includes(column.name)) {
      if (column.defaultValue !== undefined) defaults[column.name] = column.defaultValue;
      else if (column.nullable) defaults[column.name] = null;
    }
    return { ...deletion, ...output, defaults, foreignKey };
  });
}
