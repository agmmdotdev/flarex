import { Effect } from "effect";
import { defaultCurrencies } from "@medusajs/utils/defaults/currencies";
import { BigNumber } from "@medusajs/utils/totals/big-number";
import { capturePrivateCanonicalValue } from "@flarex/persistence-postgres/internal/commerce-profile";
import { capturePrivateJsonData, commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";

/** Currency owns its initialization data/count; the core records an admitted step. */
export const currencyInitialization = Effect.fn("MedusaCurrency.initialization")(function* () {
  const rows: JsonObject[] = [];
  for (const value of Object.values(defaultCurrencies)) {
    const raw = new BigNumber(value.rounding).raw;
    if (raw === undefined) return yield* Effect.fail(commerceError("invalidInput"));
    const capturedRaw = yield* Effect.fromResult(capturePrivateJsonData(raw, 4096, commerceError));
    rows.push({ code: value.code.toLowerCase(), symbol: value.symbol, symbol_native: value.symbol_native,
      name: value.name, decimal_digits: value.decimal_digits, rounding: value.rounding, raw_rounding: capturedRaw.value });
  }
  rows.sort((a, b) => String(a.code).localeCompare(String(b.code)));
  if (rows.length !== 123 || new Set(rows.map(row => row.code)).size !== 123) return yield* Effect.fail(commerceError("seedMismatch"));
  const captured = yield* capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows }, 1_048_576,
    { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) });
  return { rows: captured.frame.rows, stepId: "currency.default-catalog", datasetSha256: captured.sha256Hex, expectedRowCount: 123 };
});
