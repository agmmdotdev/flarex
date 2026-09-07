import { Schema } from "effect";
import { commerceDecoder } from "./commerce-decoder";

export const decodeProductRead = commerceDecoder(Schema.Struct({
  id: Schema.optionalKey(Schema.String), filters: Schema.optionalKey(Schema.Json), config: Schema.optionalKey(Schema.Json),
}), "invalidInput");
export const decodeProductFindConfig = commerceDecoder(Schema.Struct({
  select: Schema.optionalKey(Schema.Json), relations: Schema.optionalKey(Schema.Json), order: Schema.optionalKey(Schema.Json),
  skip: Schema.optionalKey(Schema.Number.check(Schema.isInt())), take: Schema.optionalKey(Schema.Number.check(Schema.isInt())),
}), "unsupportedProfile");
// Bulk creation keeps the original service's per-product required-field checks.
export const decodeProductCreateInput = commerceDecoder(Schema.Union([
  Schema.Array(Schema.Json),
  Schema.StructWithRest(Schema.Struct({ title: Schema.String }), [Schema.Record(Schema.String, Schema.Json)]),
]), "invalidInput");
