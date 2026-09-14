import { Effect, Schema } from "effect";
import { capturePrivateJsonData, commerceError, commerceLimits, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "./commerce-decoder";
import { currencyValueProfile } from "./currency-value-profile";
import { decodeExactNumeric, encodeExactNumeric } from "./exact-numeric";

export { captureCommerceInput as captureCurrencyInput } from "./commerce-input";
import { captureCommerceInput as captureCurrencyInput } from "./commerce-input";

const decodeWriteBatch = commerceDecoder(Schema.Array(Schema.Unknown).check(Schema.isMaxLength(commerceLimits.catalogRows)), "invalidInput");

export const currencyWriteRows = Effect.fn("CurrencyAdapter.writeRows")(function* (input: unknown) {
  const captured = yield* Effect.fromResult(captureCurrencyInput(input));
  const values = yield* Effect.fromResult(decodeWriteBatch(captured));
  const { decodeWriteRow } = yield* Effect.fromResult(currencyValueProfile);
  const rows: JsonObject[] = [];
  for (const inputRow of values) {
    const value = yield* Effect.fromResult(decodeWriteRow(inputRow));
    const row: Record<string, Json> = { ...value, code: value.code.toLowerCase() };
    if (value.rounding !== undefined) {
      const { value: rounding, raw } = yield* encodeExactNumeric(value.rounding);
      row.rounding = rounding;
      row.raw_rounding = (yield* Effect.fromResult(capturePrivateJsonData(raw, commerceLimits.rowBytes, commerceError))).value;
    }
    rows.push(row);
  }
  return rows;
});

/** The DAL serializes selected fields, including the exact numeric companion. */
export const serializeCurrency = Effect.fn("CurrencyAdapter.serialize")(function* (input: unknown) {
  const captured = yield* Effect.fromResult(capturePrivateJsonData(input, commerceLimits.commandBytes, commerceError));
  const { decodeStoredRow } = yield* Effect.fromResult(currencyValueProfile);
  const array = Array.isArray(captured.value);
  const values: readonly Json[] = Array.isArray(captured.value) ? captured.value : [captured.value];
  const output: JsonObject[] = [];
  for (const value of values) {
    const decoded = yield* Effect.fromResult(decodeStoredRow(value));
    const row: Record<string, Json> = { ...decoded };
    if (decoded.rounding !== undefined) {
      // Ignore extra raw metadata for conversion, but retain it in the row.
      row.rounding = yield* decodeExactNumeric(decoded.rounding, decoded.raw_rounding);
    }
    output.push(row);
  }
  return array ? output : output[0] ?? null;
});
