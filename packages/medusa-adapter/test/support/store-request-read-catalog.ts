import { Effect } from "effect";
import { capturePrivateCanonicalValue, commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { currencyWriteRows } from "../../src/modules/currency/values";
import { compileStoreRequestReadCatalog } from "../../src/http/store-request-reads";

export const storeRequestReadTarget = Object.freeze({ scopeUuid: "e0000000-0000-4000-8000-000000000001", epochUuid: "e0000000-0000-4000-8000-000000000002" });
export const storeRequestReadToken = `pk_${"a".repeat(64)}`;
export const storeRequestReadRevokedToken = `pk_${"b".repeat(64)}`;
export const storeRequestReadSecretToken = `sk_${"c".repeat(64)}`;
const key = (id: string, token: string, type = "publishable", revoked_at: string | null = null): JsonObject => ({ id, token, type,
  title: id, salt: "", redacted: token.slice(0, 6) + "***" + token.slice(-3), created_by: "native-admin", revoked_at });
const currencyRows: readonly JsonObject[] = [
  { code: "usd", name: "United States Dollar", symbol: "$", symbol_native: "$", decimal_digits: 2, rounding: 0 },
  { code: "eur", name: "Euro", symbol: "€", symbol_native: "€", decimal_digits: 2, rounding: 0 },
  { code: "chf", name: "Français Franc", symbol: "CHF", symbol_native: "CHF", decimal_digits: 2, rounding: 0.05 },
];

/** Deterministic test-only native schema/seed producer. It acquires no database
 * or host resource, and is shared by Node setup and the Workerd witness. */
export const compileStoreRequestReadFixtureCatalog = Effect.fn("StoreRequestReadFixture.compileCatalog")(function* (
  target: Readonly<{ scopeUuid: string; epochUuid: string }> = storeRequestReadTarget,
) {
  const encodedCurrency = yield* currencyWriteRows(currencyRows);
  const firstCurrency = encodedCurrency[0];
  if (firstCurrency === undefined) return yield* Effect.die(new Error("Missing native fixture Currency"));
  const rows = { currency: [...encodedCurrency, { ...firstCurrency, code: "zzz", name: "Deleted Currency", deleted_at: "2020-01-01T00:00:00.000Z" }], apiKey: [key("apk_active", storeRequestReadToken),
    key("apk_revoked", storeRequestReadRevokedToken, "publishable", "2020-01-01T00:00:00.000Z"), key("apk_secret", storeRequestReadSecretToken, "secret")],
    apiKeySalesChannel: [
      { table: "publishable_api_key_sales_channel", row: { id: "pksc_active", publishable_key_id: "apk_active", sales_channel_id: "sc_active" } },
      { table: "publishable_api_key_sales_channel", row: { id: "pksc_removed", publishable_key_id: "apk_active", sales_channel_id: "sc_removed",
        deleted_at: "2020-01-01T00:00:00.000Z" } },
    ],
  };
  const initialization = (name: keyof typeof rows) => Effect.gen(function* () {
    const captured = yield* capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: rows[name] }, 1_048_576,
      { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) });
    return { stepId: `${name.toLowerCase()}-initial`, datasetSha256: captured.sha256Hex, expectedRowCount: rows[name].length };
  });
  const catalog = yield* compileStoreRequestReadCatalog(target, { currency: yield* initialization("currency"), apiKey: yield* initialization("apiKey"),
    apiKeySalesChannel: yield* initialization("apiKeySalesChannel") });
  return { catalog, rows, target };
});
