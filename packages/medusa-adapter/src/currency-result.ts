import { Result, Schema } from "effect";
import { commerceDecoder } from "./commerce-decoder";
import type { CurrencyTypes } from "@medusajs/framework/types";
import type { Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { currencyValueProfile } from "./currency-value-profile";

const decodeKeys = commerceDecoder(Schema.Array(Schema.StructWithRest(
  Schema.Struct({ code: Schema.String }), [Schema.Record(Schema.String, Schema.Json)],
)), "storedCorruption");
export const currencyKeys = (rows: readonly Json[]) => decodeKeys(rows).pipe(Result.map(values => values.map(row => row.code)));

// SAFETY: Medusa promises a full DTO even for selected projections. Validate
// each declared field when present, preserving additional serialized columns.
type Profile = Result.Result.Success<typeof currencyValueProfile>;
const asDto = (value: Result.Result.Success<ReturnType<Profile["decodeProjection"]>>): CurrencyTypes.CurrencyDTO => value as CurrencyTypes.CurrencyDTO;

export const currencyDto = (value: Json) => currencyValueProfile.pipe(Result.flatMap(profile => profile.decodeProjection(value)), Result.map(asDto));
export const currencyDtos = (value: Json) => currencyValueProfile.pipe(Result.flatMap(profile => profile.decodeProjections(value)), Result.map(rows => rows.map(asDto)));
export const currencyCountResult = (value: Json) => currencyValueProfile.pipe(Result.flatMap(profile => profile.decodeCountResult(value)), Result.map(([rows, count]) =>
  [rows.map(asDto), count] satisfies [CurrencyTypes.CurrencyDTO[], number]));
