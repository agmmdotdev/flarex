import { Result } from "effect";
import type { CurrencyTypes } from "@medusajs/framework/types";
import type { Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { currencyValueProfile } from "./currency-value-profile";

// SAFETY: Medusa promises a full DTO even for selected projections. Validate
// each declared field when present, preserving additional serialized columns.
type Profile = Result.Result.Success<typeof currencyValueProfile>;
const asDto = (value: Result.Result.Success<ReturnType<Profile["decodeProjection"]>>): CurrencyTypes.CurrencyDTO => value as CurrencyTypes.CurrencyDTO;

export const currencyDto = (value: Json) => currencyValueProfile.pipe(Result.flatMap(profile => profile.decodeProjection(value)), Result.map(asDto));
export const currencyDtos = (value: Json) => currencyValueProfile.pipe(Result.flatMap(profile => profile.decodeProjections(value)), Result.map(rows => rows.map(asDto)));
export const currencyCountResult = (value: Json) => currencyValueProfile.pipe(Result.flatMap(profile => profile.decodeCountResult(value)), Result.map(([rows, count]) =>
  [rows.map(asDto), count] satisfies [CurrencyTypes.CurrencyDTO[], number]));
