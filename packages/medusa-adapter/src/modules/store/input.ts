import { Schema } from "effect";
import { commerceDecoder } from "../../value/decoder";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
export const StoreGuardFilters = Schema.Struct({ default_sales_channel_id: Schema.Array(Id).check(Schema.isMaxLength(4)) });
export const StoreGuardConfig = Schema.Struct({ select: Schema.Tuple([Schema.Literal("default_sales_channel_id")]) });
export const StoreGuardReadInput = Schema.Struct({ filters: StoreGuardFilters, config: StoreGuardConfig });
export const decodeStoreGuardRead = commerceDecoder(StoreGuardReadInput, "invalidInput");
export const decodeStoreGuardArguments = commerceDecoder(Schema.Tuple([StoreGuardFilters, StoreGuardConfig]), "invalidInput");
// Native selection omits the primary key; do not fabricate a whole Store DTO.
export const decodeStoreGuardOutput = commerceDecoder(Schema.Array(Schema.Struct({
  default_sales_channel_id: Schema.NullOr(Schema.String),
})).check(Schema.isMaxLength(256)), "storedCorruption");

/** Exact native buildQuery output after primary-key default ordering. */
export const decodeStoreGuardQuery = commerceDecoder(Schema.Struct({
  where: StoreGuardFilters,
  options: Schema.Struct({
    fields: Schema.Tuple([Schema.Literal("default_sales_channel_id")]),
    populate: Schema.Tuple([]),
    orderBy: Schema.Struct({ id: Schema.Literal("ASC") }),
  }),
}), "unsupportedProfile");
