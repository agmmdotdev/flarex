import { Effect, Schema } from "effect";
import { BigNumber } from "@medusajs/utils/totals/big-number";
import { capturePrivateJsonData, commerceError, commerceLimits, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "./commerce-decoder";
import { currencyColumns } from "./currency-query-model";

export { captureCommerceInput as captureCurrencyInput } from "./commerce-input";
import { captureCommerceInput as captureCurrencyInput } from "./commerce-input";

const NumericInput = Schema.Union([Schema.String, Schema.Number]);
const decodeWriteBatch = commerceDecoder(Schema.Array(Schema.Unknown).check(Schema.isMaxLength(commerceLimits.catalogRows)), "invalidInput");
// Persistence owns ordinary column validation. This boundary selects writable
// keys and normalizes the numeric representation before handing rows to it.
const decodeWriteRow = commerceDecoder(Schema.Struct({
  code: Schema.String.check(Schema.isLengthBetween(1, 256)),
  symbol: Schema.optionalKey(Schema.Json),
  symbol_native: Schema.optionalKey(Schema.Json),
  name: Schema.optionalKey(Schema.Json),
  decimal_digits: Schema.optionalKey(Schema.Json),
  rounding: Schema.optionalKey(NumericInput),
}), "invalidInput");
const decodeStoredRow = commerceDecoder(Schema.Record(
  Schema.Literals(currencyColumns), Schema.optionalKey(Schema.Json),
), "storedCorruption");
const decodeStoredNumeric = commerceDecoder(NumericInput, "storedCorruption");
const decodeRawNumeric = commerceDecoder(Schema.Struct({
  value: Schema.String,
  precision: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 100 })),
}).annotate({ parseOptions: { onExcessProperty: "ignore" } }), "storedCorruption");

export const currencyWriteRows = Effect.fn("CurrencyAdapter.writeRows")(function* (input: unknown) {
  const captured = yield* Effect.fromResult(captureCurrencyInput(input));
  const values = yield* Effect.fromResult(decodeWriteBatch(captured));
  const rows: JsonObject[] = [];
  for (const inputRow of values) {
    const value = yield* Effect.fromResult(decodeWriteRow(inputRow));
    const row: Record<string, Json> = { ...value, code: value.code.toLowerCase() };
    if (value.rounding !== undefined) {
      const roundingInput = value.rounding;
      const rounding = yield* Effect.try({ try: () => new BigNumber(roundingInput), catch: cause => commerceError("invalidInput", cause) });
      const raw = rounding.raw;
      if (raw === undefined || !Number.isFinite(rounding.numeric) || typeof raw.value !== "string") return yield* Effect.fail(commerceError("invalidInput"));
      row.rounding = raw.value;
      row.raw_rounding = (yield* Effect.fromResult(capturePrivateJsonData(raw, commerceLimits.rowBytes, commerceError))).value;
    }
    rows.push(row);
  }
  return rows;
});

/** The DAL serializes selected fields, including the exact numeric companion. */
export const serializeCurrency = Effect.fn("CurrencyAdapter.serialize")(function* (input: unknown) {
  const captured = yield* Effect.fromResult(capturePrivateJsonData(input, commerceLimits.commandBytes, commerceError));
  const array = Array.isArray(captured.value);
  const values: readonly Json[] = Array.isArray(captured.value) ? captured.value : [captured.value];
  const output: JsonObject[] = [];
  for (const value of values) {
    const decoded = yield* Effect.fromResult(decodeStoredRow(value));
    const row: Record<string, Json> = { ...decoded };
    if (decoded.rounding !== undefined) {
      const storedValue = yield* Effect.fromResult(decodeStoredNumeric(decoded.rounding));
      // Ignore extra raw metadata for conversion, but retain it in the row.
      const raw = yield* Effect.fromResult(decodeRawNumeric(decoded.raw_rounding));
      const numeric = yield* Effect.try({ try: () => new BigNumber(raw), catch: cause => commerceError("storedCorruption", cause) });
      const stored = yield* Effect.try({ try: () => new BigNumber(storedValue), catch: cause => commerceError("storedCorruption", cause) });
      if (!Number.isFinite(numeric.numeric) || numeric.bigNumber === undefined || stored.bigNumber === undefined || !numeric.bigNumber.eq(stored.bigNumber)) return yield* Effect.fail(commerceError("storedCorruption"));
      row.rounding = numeric.numeric;
    }
    output.push(row);
  }
  return array ? output : output[0] ?? null;
});
