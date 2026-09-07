import { Effect, Result } from "effect";
import { isNonArrayRecord } from "@flarex/utils/records";
import { BigNumber } from "@medusajs/utils/totals/big-number";
import { isJsonObject, capturePrivateJsonData, commerceError, commerceLimits, type CommerceTransactionError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { currencyColumns } from "./currency-query-model";

/** Medusa builds plain option objects with undefined members. Omit those members
 * at this foreign boundary, then use the core's strict captured JSON contract. */
export function captureCurrencyInput(input: unknown): Result.Result<Json, CommerceTransactionError> {
  let nodes = 0;
  const active = new Set<object>();
  const visit = (value: unknown, depth: number): Result.Result<unknown, CommerceTransactionError> => Result.gen(function* () {
    if (++nodes > 8192 || depth > 16) return yield* Result.fail(commerceError("limitExceeded"));
    if (value === null || typeof value !== "object") return value;
    const meta = yield* Result.try({ try: () => ({ array: Array.isArray(value), prototype: Object.getPrototypeOf(value), keys: Reflect.ownKeys(value) }), catch: cause => commerceError("invalidInput", cause) });
    if (active.has(value) || (meta.array ? meta.prototype !== Array.prototype : meta.prototype !== Object.prototype && meta.prototype !== null)) return yield* Result.fail(commerceError("invalidInput"));
    active.add(value);
    const entries: [string, unknown][] = [];
    if (meta.keys.length > 8192) return yield* Result.fail(commerceError("limitExceeded"));
    for (const key of meta.keys) {
      if (meta.array && key === "length") continue;
      if (typeof key !== "string") return yield* Result.fail(commerceError("invalidInput"));
      const property = yield* Result.try({ try: () => Object.getOwnPropertyDescriptor(value, key), catch: cause => commerceError("invalidInput", cause) });
      if (property === undefined || !("value" in property) || !property.enumerable) return yield* Result.fail(commerceError("invalidInput"));
      if (property.value === undefined && !meta.array) continue;
      entries.push([key, yield* visit(property.value, depth + 1)]);
    }
    active.delete(value);
    if (meta.array) {
      const length = yield* Result.try({ try: () => Object.getOwnPropertyDescriptor(value, "length"), catch: cause => commerceError("invalidInput", cause) });
      if (entries.length !== length?.value || entries.some(([key], index) => key !== String(index))) return yield* Result.fail(commerceError("invalidInput"));
      return entries.map(([, member]) => member);
    }
    return Object.fromEntries(entries);
  });
  return visit(input, 0).pipe(Result.flatMap(value => capturePrivateJsonData(value, commerceLimits.commandBytes, commerceError)), Result.map(value => value.value));
}

export const currencyWriteRows = Effect.fn("CurrencyAdapter.writeRows")(function* (input: unknown) {
  const captured = yield* Effect.fromResult(captureCurrencyInput(input));
  if (!Array.isArray(captured) || captured.length > commerceLimits.catalogRows) return yield* Effect.fail(commerceError("invalidInput"));
  const rows: JsonObject[] = [];
  for (const value of captured) {
    if (!isNonArrayRecord(value) || Object.keys(value).some(key => !["code", "symbol", "symbol_native", "name", "decimal_digits", "rounding"].includes(key)) ||
      typeof value.code !== "string" || value.code.length === 0 || value.code.length > 256) return yield* Effect.fail(commerceError("invalidInput"));
    const row: Record<string, Json> = { ...value, code: value.code.toLowerCase() };
    if (value.rounding !== undefined) {
      if (typeof value.rounding !== "string" && typeof value.rounding !== "number") return yield* Effect.fail(commerceError("invalidInput"));
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
    if (!isJsonObject(value) || Object.keys(value).some(key => !currencyColumns.some(column => column === key))) return yield* Effect.fail(commerceError("storedCorruption"));
    const row: Record<string, Json> = { ...value };
    if (value.rounding !== undefined) {
      if ((typeof value.rounding !== "string" && typeof value.rounding !== "number") || !isNonArrayRecord(value.raw_rounding) ||
        typeof value.raw_rounding.value !== "string" || typeof value.raw_rounding.precision !== "number" ||
        !Number.isSafeInteger(value.raw_rounding.precision) || value.raw_rounding.precision < 1 || value.raw_rounding.precision > 100) return yield* Effect.fail(commerceError("storedCorruption"));
      const raw = { value: value.raw_rounding.value, precision: value.raw_rounding.precision };
      const storedValue = value.rounding;
      const numeric = yield* Effect.try({ try: () => new BigNumber(raw), catch: cause => commerceError("storedCorruption", cause) });
      const stored = yield* Effect.try({ try: () => new BigNumber(storedValue), catch: cause => commerceError("storedCorruption", cause) });
      if (!Number.isFinite(numeric.numeric) || numeric.bigNumber === undefined || stored.bigNumber === undefined || !numeric.bigNumber.eq(stored.bigNumber)) return yield* Effect.fail(commerceError("storedCorruption"));
      row.rounding = numeric.numeric;
    }
    output.push(row);
  }
  return array ? output : output[0] ?? null;
});
