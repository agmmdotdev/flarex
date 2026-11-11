import { Effect } from "effect";
import type { Logger } from "@medusajs/framework/types";
import { capturePrivateCanonicalValue, commerceError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { compileStoreProductRequestCatalog } from "../../src/http/store-product-request";
import { compileStoreProductContextReadCatalog, type StoreProductContextInitializations } from "../../src/http/store-product-context-reads";
import { compileStoreRequestReadFixtureCatalog, storeRequestReadToken } from "./store-request-read-catalog";

export const storeProductRequestTarget = Object.freeze({ scopeUuid: "d0000000-0000-4000-8000-000000000001", epochUuid: "d0000000-0000-4000-8000-000000000002" });
export const storeProductToken = storeRequestReadToken;
export const storeProductMultiToken = `pk_${"d".repeat(64)}`;
export const storeProductEmptyToken = `pk_${"e".repeat(64)}`;
export const storeProductLogger: Logger = { panic() {}, shouldLog: () => false, setLogLevel() {}, unsetLogLevel() {}, activity: message => message,
  progress() {}, error: (...args) => console.error("Native Store proof", ...args), failure() {}, success: () => ({}), silly() {}, debug() {}, verbose() {}, http() {}, info() {}, warn() {}, log() {} };

type Row = Readonly<{ table: string; row: JsonObject }>;
/** Existing context endpoints use the same trusted canonical initialization as
 * Cart/Tax fixtures. Product, Price, Inventory and membership lifecycle below
 * is produced by genuine native commands/workflows before HTTP activation. */
export const storeProductContextRows: Readonly<Record<keyof StoreProductContextInitializations, readonly Row[]>> = {
  store: [{ table: "store", row: { id: "store_products", name: "Native Store Products", default_region_id: "reg_store_us", default_sales_channel_id: "sc_active" } }],
  region: [
    { table: "region", row: { id: "reg_store_us", name: "US automatic", currency_code: "usd", automatic_taxes: true } },
    { table: "region", row: { id: "reg_store_inclusive", name: "US inclusive", currency_code: "usd", automatic_taxes: true } },
    { table: "region", row: { id: "reg_store_manual", name: "US manual", currency_code: "usd", automatic_taxes: false } },
    { table: "region", row: { id: "reg_store_eur", name: "EUR", currency_code: "eur", automatic_taxes: false } },
  ],
  cart: [{ table: "cart_address", row: { id: "ca_store_us", country_code: "us", province: "ca", address_1: "Native Store proof" } },
    { table: "cart", row: { id: "cart_store_us", currency_code: "usd", region_id: "reg_store_us", shipping_address_id: "ca_store_us", customer_id: "cus_other" } }],
  customer: [{ table: "customer", row: { id: "cus_store_verified", email: "store-verified@example.invalid", has_account: true } },
    { table: "customer", row: { id: "cus_store_overbound", email: "store-overbound@example.invalid", has_account: true } },
    { table: "customer", row: { id: "cus_store_deleted", email: "store-deleted@example.invalid", has_account: true, deleted_at: "2020-01-01T00:00:00.000Z" } },
    { table: "customer_group", row: { id: "cg_store_vip", name: "Native Store VIP" } },
    { table: "customer_group", row: { id: "cg_store_deleted", name: "Deleted VIP", deleted_at: "2020-01-01T00:00:00.000Z" } },
    { table: "customer_group_customer", row: { id: "cusgc_store_vip", customer_id: "cus_store_verified", customer_group_id: "cg_store_vip" } },
    { table: "customer_group_customer", row: { id: "cusgc_store_deleted_customer", customer_id: "cus_store_deleted", customer_group_id: "cg_store_vip" } },
    { table: "customer_group_customer", row: { id: "cusgc_store_deleted_group", customer_id: "cus_store_verified", customer_group_id: "cg_store_deleted" } },
    ...Array.from({ length: 5 }, (_, index) => ({ table: "customer_group", row: { id: `cg_store_overbound_${index}`, name: `Overbound group ${index}` } })),
    ...Array.from({ length: 5 }, (_, index) => ({ table: "customer_group_customer", row: { id: `cusgc_store_overbound_${index}`, customer_id: "cus_store_overbound", customer_group_id: `cg_store_overbound_${index}` } })),
  ],
  salesChannelLocation: [{ table: "sales_channel_stock_location", row: { id: "scloc_store_main", sales_channel_id: "sc_active", stock_location_id: "sloc_store_main" } },
    { table: "sales_channel_stock_location", row: { id: "scloc_store_other", sales_channel_id: "sc_other", stock_location_id: "sloc_store_other" } }],
  tax: [{ table: "tax_provider", row: { id: "tp_system", is_enabled: true } },
    { table: "tax_region", row: { id: "txreg_store_us", country_code: "us", provider_id: "tp_system" } },
    { table: "tax_rate", row: { id: "txrate_store_us", tax_region_id: "txreg_store_us", rate: 10, code: "STORE_US", name: "Native Store tax", is_default: true } }],
};

/** Pure deterministic definition/initialization production shared with Workerd. */
export const compileStoreProductRequestFixtureCatalog = Effect.fn("StoreProductFixture.compileCatalog")(function* (
  target: Readonly<{ scopeUuid: string; epochUuid: string }> = storeProductRequestTarget,
) {
  const auth = yield* compileStoreRequestReadFixtureCatalog(target);
  const active = auth.rows.apiKey[0];
  if (active === undefined) return yield* Effect.die(new Error("Missing native auth fixture key"));
  const authRows = { ...auth.rows, apiKey: [...auth.rows.apiKey,
    { ...active, id: "apk_multi", token: storeProductMultiToken }, { ...active, id: "apk_empty", token: storeProductEmptyToken }],
  apiKeySalesChannel: [...auth.rows.apiKeySalesChannel,
    { table: "publishable_api_key_sales_channel", row: { id: "pksc_multi_active", publishable_key_id: "apk_multi", sales_channel_id: "sc_active" } },
    { table: "publishable_api_key_sales_channel", row: { id: "pksc_multi_other", publishable_key_id: "apk_multi", sales_channel_id: "sc_other" } }],
  };
  const placeholder = { stepId: "temporary", datasetSha256: "0".repeat(64), expectedRowCount: 0 };
  const contexts = yield* compileStoreProductContextReadCatalog(target, { store: placeholder, region: placeholder, cart: placeholder,
    customer: placeholder, salesChannelLocation: placeholder, tax: placeholder }, storeProductLogger);
  const receipt = (name: string, rows: Json, count: number) => Effect.gen(function* () {
    const captured = yield* capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows }, 1_048_576,
      { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) });
    return { stepId: `${name.toLowerCase()}-initial`, datasetSha256: captured.sha256Hex, expectedRowCount: count };
  });
  const context = {
    store: yield* receipt("store", storeProductContextRows.store, storeProductContextRows.store.length),
    region: yield* receipt("region", storeProductContextRows.region, storeProductContextRows.region.length),
    cart: yield* receipt("cart", storeProductContextRows.cart, storeProductContextRows.cart.length),
    customer: yield* receipt("customer", storeProductContextRows.customer, storeProductContextRows.customer.length),
    salesChannelLocation: yield* receipt("salesChannelLocation", contexts.sources.salesChannelLocation.definition.tables.length === 1
      ? storeProductContextRows.salesChannelLocation.map(entry => entry.row) : storeProductContextRows.salesChannelLocation, storeProductContextRows.salesChannelLocation.length),
    tax: yield* receipt("tax", storeProductContextRows.tax, storeProductContextRows.tax.length),
  };
  const catalog = yield* compileStoreProductRequestCatalog(target, { auth: {
    currency: auth.catalog.currency.initialization,
    apiKey: yield* receipt("apiKey", authRows.apiKey, authRows.apiKey.length),
    apiKeySalesChannel: yield* receipt("apiKeySalesChannel", auth.catalog.apiKeySalesChannel.definition.tables.length === 1
      ? authRows.apiKeySalesChannel.map(entry => entry.row) : authRows.apiKeySalesChannel, authRows.apiKeySalesChannel.length),
  }, context }, storeProductLogger);
  const rows: Readonly<Record<string, readonly Row[]>> = { ...storeProductContextRows,
    currency: authRows.currency.map(row => ({ table: "currency", row })), apiKey: authRows.apiKey.map(row => ({ table: "api_key", row })),
    apiKeySalesChannel: authRows.apiKeySalesChannel };
  return { catalog, rows, target };
});
