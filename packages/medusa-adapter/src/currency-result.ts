import { Result, Schema } from "effect";
import type { CurrencyTypes } from "@medusajs/framework/types";
import type { Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "./commerce-decoder";

const CurrencyProjection = Schema.StructWithRest(Schema.Struct({
  code: Schema.optionalKey(Schema.String),
  symbol: Schema.optionalKey(Schema.String),
  symbol_native: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
}), [Schema.Record(Schema.String, Schema.Json)]);
const decodeProjection = commerceDecoder(CurrencyProjection, "storedCorruption");
const decodeProjections = commerceDecoder(Schema.Array(CurrencyProjection), "storedCorruption");
const decodeCountResult = commerceDecoder(Schema.Tuple([Schema.Array(CurrencyProjection), Schema.Number]), "storedCorruption");

// SAFETY: Medusa promises a full DTO even for selected projections. Validate
// each declared field when present, preserving additional serialized columns.
const asDto = (value: typeof CurrencyProjection.Type): CurrencyTypes.CurrencyDTO => value as CurrencyTypes.CurrencyDTO;

export const currencyDto = (value: Json) => decodeProjection(value).pipe(Result.map(asDto));
export const currencyDtos = (value: Json) => decodeProjections(value).pipe(Result.map(rows => rows.map(asDto)));
export const currencyCountResult = (value: Json) => decodeCountResult(value).pipe(Result.map(([rows, count]) =>
  [rows.map(asDto), count] satisfies [CurrencyTypes.CurrencyDTO[], number]));
