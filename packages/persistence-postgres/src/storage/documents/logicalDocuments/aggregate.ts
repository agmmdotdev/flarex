import { Result, Schema } from "effect";
import { decodeExactDecimal, MAX_EXACT_DECIMAL_DIGITS } from "flarex-protocol/internal/exact-decimal";
import type { JsonObject } from "flarex-protocol/json";
import type { LogicalDocumentFailure } from "./model";

export const decodeLogicalAggregate = Schema.decodeUnknownResult(Schema.Struct({
  predicate: Schema.Unknown, sum: Schema.optionalKey(Schema.String),
}), { onExcessProperty: "error" });

/** Bounded exact SUM over an already validated complete selection. Nulls are
 * ignored, an empty/all-null sum is null, and COUNT counts all matching rows. */
export function sumLogicalRows<Failure>(rows: readonly JsonObject[], field: string, error: LogicalDocumentFailure<Failure>) {
  return Result.gen(function* () {
    let coefficient = 0n, power = 0, present = false;
    for (const row of rows) {
      const value = row[field];
      if (value === null) continue;
      if (typeof value !== "number" && typeof value !== "string") return yield* Result.fail(error("storedCorruption"));
      const decimal = yield* decodeExactDecimal(String(value)).pipe(Result.mapError(cause => error("storedCorruption", cause)));
      present = true;
      if (decimal.sign === 0) continue;
      const nextPower = coefficient === 0n ? decimal.power : Math.min(power, decimal.power);
      const existingDigits = coefficient === 0n ? 1 : (coefficient < 0n ? -coefficient : coefficient).toString().length;
      if (existingDigits + (coefficient === 0n ? 0 : power - nextPower) > MAX_EXACT_DECIMAL_DIGITS ||
        decimal.digits.length + decimal.power - nextPower > MAX_EXACT_DECIMAL_DIGITS)
        return yield* Result.fail(error("limitExceeded"));
      coefficient = (coefficient === 0n ? 0n : coefficient * 10n ** BigInt(power - nextPower)) +
        BigInt(decimal.sign) * BigInt(decimal.digits) * 10n ** BigInt(decimal.power - nextPower);
      power = nextPower;
      if ((coefficient < 0n ? -coefficient : coefficient).toString().length > MAX_EXACT_DECIMAL_DIGITS)
        return yield* Result.fail(error("limitExceeded"));
    }
    if (!present) return null;
    return (yield* decodeExactDecimal(`${coefficient}e${power}`).pipe(Result.mapError(cause => error("limitExceeded", cause)))).canonical;
  });
}
