import { Effect } from "effect";
import type { Logger } from "@medusajs/framework/types";
import { capturePrivateCanonicalValue, commerceError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { compileStoreCartRequestCatalog } from "../../src/http/store-cart-request";
import { cartCreationCoreDefinitions } from "../../src/workflows/cart/creation-runtimes";
import { cartCreationModuleNames } from "../../src/workflows/cart/creation-graph";
import { cartCreateRootSeeds } from "./cart-create-root-seeds";
import { compileStoreRequestReadFixtureCatalog, storeRequestReadToken, storeRequestReadRevokedToken } from "./store-request-read-catalog";

export const storeCartRequestTarget = Object.freeze({ scopeUuid: "e1000000-0000-4000-8000-000000000001", epochUuid: "e1000000-0000-4000-8000-000000000002" });
export const storeCartToken = storeRequestReadToken;
export const storeCartRevokedToken = storeRequestReadRevokedToken;
export const storeCartMultiToken = `pk_${"d".repeat(64)}`;
export const storeCartLogger: Logger = { panic() {}, shouldLog: () => false, setLogLevel() {}, unsetLogLevel() {}, activity: message => message,
  progress() {}, error: (...args) => console.error("Native Cart HTTP proof", ...args), failure() {}, success: () => ({}),
  silly() {}, debug() {}, verbose() {}, http() {}, info() {}, warn() {}, log() {} };

type Row = Readonly<{ table: string; row: JsonObject }>;
const defaults: Readonly<Record<string, readonly Row[]>> = {
  region: [{ table: "region", row: { id: "reg-create-root", name: "Native Cart Region", currency_code: "usd" } },
    { table: "region_country", row: { iso_2: "us", iso_3: "usa", num_code: "840", name: "UNITED STATES", display_name: "United States", region_id: "reg-create-root" } }],
  store: [{ table: "store", row: { id: "store-create-root", name: "Native Cart Store", default_region_id: "reg-create-root", default_sales_channel_id: "sc-create-root" } }],
  sales_channel: [{ table: "sales_channel", row: { id: "sc-create-root", name: "Native Cart Channel", is_disabled: false } },
    { table: "sales_channel", row: { id: "sc-other", name: "Other Cart Channel", is_disabled: false } }],
};

/** Definition and seed production only, shared unchanged by Node and Workerd. */
export const compileStoreCartRequestFixtureCatalog = Effect.fn("StoreCartFixture.compileCatalog")(function* (
  target: Readonly<{ scopeUuid: string; epochUuid: string }> = storeCartRequestTarget,
) {
  const auth = yield* compileStoreRequestReadFixtureCatalog(target);
  const active = auth.rows.apiKey[0];
  if (active === undefined) return yield* Effect.die(new Error("Missing Cart auth key fixture"));
  const authRows = { currency: auth.rows.currency, apiKey: [...auth.rows.apiKey, { ...active, id: "apk_cart_multi", token: storeCartMultiToken }],
    apiKeySalesChannel: [{ table: "publishable_api_key_sales_channel", row: { id: "pksc_cart_active", publishable_key_id: "apk_active", sales_channel_id: "sc-create-root" } },
      { table: "publishable_api_key_sales_channel", row: { id: "pksc_cart_multi_a", publishable_key_id: "apk_cart_multi", sales_channel_id: "sc-create-root" } },
      { table: "publishable_api_key_sales_channel", row: { id: "pksc_cart_multi_b", publishable_key_id: "apk_cart_multi", sales_channel_id: "sc-other" } }],
  };
  const definitions = yield* cartCreationCoreDefinitions(target);
  const rows: Readonly<Record<string, readonly Row[]>> = Object.fromEntries([
    ...cartCreationModuleNames.map(name => [name, [...(defaults[name] ?? []), ...(cartCreateRootSeeds[name] ?? [])]]),
    ["currency", authRows.currency.map(row => ({ table: "currency", row }))],
    ["apiKey", authRows.apiKey.map(row => ({ table: "api_key", row }))], ["apiKeySalesChannel", authRows.apiKeySalesChannel],
  ]);
  const receipt = (name: string, value: Json, count: number) => Effect.gen(function* () {
    const captured = yield* capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: value }, 1_048_576,
      { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) });
    return { stepId: `${name.toLowerCase()}-initial`, datasetSha256: captured.sha256Hex, expectedRowCount: count };
  });
  const nativeReceipt = (name: typeof cartCreationModuleNames[number]) => {
    const selected = rows[name] ?? [];
    return receipt(name, definitions[name].tables.length === 1 ? selected.map(row => row.row) : selected, selected.length);
  };
  const native = yield* Effect.all({
    product: nativeReceipt("product"), pricing: nativeReceipt("pricing"), inventory: nativeReceipt("inventory"),
    stock_location: nativeReceipt("stock_location"), sales_channel: nativeReceipt("sales_channel"), fulfillment: nativeReceipt("fulfillment"),
    product_links: nativeReceipt("product_links"), variant_links: nativeReceipt("variant_links"), sales_channel_locations: nativeReceipt("sales_channel_locations"),
    cart: nativeReceipt("cart"), customer: nativeReceipt("customer"), region: nativeReceipt("region"), store: nativeReceipt("store"),
    promotion: nativeReceipt("promotion"), tax: nativeReceipt("tax"), payment: nativeReceipt("payment"),
    cart_promotion_links: nativeReceipt("cart_promotion_links"), cart_payment_collection_links: nativeReceipt("cart_payment_collection_links"),
  });
  const catalog = yield* compileStoreCartRequestCatalog(target, { native, auth: { currency: yield* receipt("currency", authRows.currency, authRows.currency.length),
    apiKey: yield* receipt("apiKey", authRows.apiKey, authRows.apiKey.length),
    apiKeySalesChannel: yield* receipt("apiKeySalesChannel", auth.catalog.apiKeySalesChannel.definition.tables.length === 1
      ? authRows.apiKeySalesChannel.map(row => row.row) : authRows.apiKeySalesChannel, authRows.apiKeySalesChannel.length) } }, storeCartLogger);
  return { catalog, rows, target };
});
