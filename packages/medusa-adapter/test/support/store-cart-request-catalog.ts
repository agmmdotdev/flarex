import { Effect } from "effect";
import type { Logger } from "@medusajs/framework/types";
import { capturePrivateCanonicalValue, commerceError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { compileStoreCartRequestCatalog } from "../../src/http/store-cart-request";
import { cartShippingModuleNames, cartShippingCoreDefinitions } from "../../src/workflows/cart/shipping-graph";
import { cartCreateRootSeeds } from "./cart-create-root-seeds";
import { storeCartShippingSeedRows, orderStoreCartSeedRows } from "./cart-shipping-http-seeds";
import { compileStoreRequestReadFixtureCatalog, storeRequestReadToken, storeRequestReadRevokedToken } from "./store-request-read-catalog";

export const storeCartRequestTarget = Object.freeze({ scopeUuid: "e1000000-0000-4000-8000-000000000001", epochUuid: "e1000000-0000-4000-8000-000000000002" });
export const storeCartToken = storeRequestReadToken;
export const storeCartRevokedToken = storeRequestReadRevokedToken;
export const storeCartMultiToken = `pk_${"d".repeat(64)}`;
export const storeCartLogger: Logger = { panic() {}, shouldLog: () => false, setLogLevel() {}, unsetLogLevel() {}, activity: message => message,
  progress() {}, error: (...args) => console.error("Native Cart HTTP proof", ...args), failure() {}, success: () => ({}),
  silly() {}, debug() {}, verbose() {}, http() {}, info() {}, warn() {}, log() {} };

type Row = Readonly<{ table: string; row: JsonObject }>;
const taxCartCases = ["manual", "failure", "replay", "completed"] as const;
/** Manual calculation endpoints shared unchanged by Node and Workerd. The
 * native Tax provider replaces the deliberately stale zero-rate Cart rows. */
export const storeCartTaxSeedRows: Readonly<Record<string, readonly Row[]>> = {
  region: [{ table: "region", row: { id: "reg-http-tax-manual", name: "Manual Cart Tax Region", currency_code: "usd", automatic_taxes: false } }],
  cart: [...taxCartCases.flatMap(name => [
    { table: "cart_address", row: { id: `addr-http-tax-${name}`, country_code: "us" } },
    { table: "cart", row: { id: `cart-http-tax-${name}`, currency_code: "usd", region_id: "reg-http-tax-manual", sales_channel_id: "sc-create-root",
      shipping_address_id: `addr-http-tax-${name}`, ...(name === "completed" ? { completed_at: "2026-01-01T00:00:00.000Z" } : {}) } },
    { table: "cart_line_item", row: { id: `line-http-tax-${name}`, cart_id: `cart-http-tax-${name}`, title: "Manual Tax item", variant_id: "variant-create-root",
      product_id: "prod-create-root", quantity: 1, unit_price: "12.5", raw_unit_price: { value: "12.5", precision: 20 } } },
    { table: "cart_line_item_tax_line", row: { id: `tax-http-stale-${name}`, item_id: `line-http-tax-${name}`, code: "STALE", rate: 0, provider_id: "tp_system" } },
  ]),
  { table: "cart_address", row: { id: "addr-http-tax-empty", country_code: "us" } },
  { table: "cart", row: { id: "cart-http-tax-empty", currency_code: "usd", region_id: "reg-http-tax-manual", sales_channel_id: "sc-create-root",
    shipping_address_id: "addr-http-tax-empty" } },
  { table: "cart", row: { id: "cart-http-tax-no-country", currency_code: "usd", region_id: "reg-http-tax-manual", sales_channel_id: "sc-create-root" } },
  { table: "cart", row: { id: "cart-http-tax-no-country-item", currency_code: "usd", region_id: "reg-http-tax-manual", sales_channel_id: "sc-create-root" } },
  { table: "cart_line_item", row: { id: "line-http-tax-no-country", cart_id: "cart-http-tax-no-country-item", title: "No country Tax item",
    quantity: 1, unit_price: "12.5", raw_unit_price: { value: "12.5", precision: 20 } } }],
  payment: [{ table: "payment_collection", row: { id: "paycol-http-tax-manual", currency_code: "usd", amount: "12.5", raw_amount: { value: "12.5", precision: 20 } } },
    { table: "payment_session", row: { id: "payses-http-tax-manual", payment_collection_id: "paycol-http-tax-manual", provider_id: "pp_system_default",
      currency_code: "usd", amount: "12.5", raw_amount: { value: "12.5", precision: 20 }, data: {}, context: {}, status: "pending" } }],
  cart_payment_collection_links: [{ table: "cart_payment_collection", row: { id: "link-http-tax-manual", cart_id: "cart-http-tax-manual", payment_collection_id: "paycol-http-tax-manual" } }],
};
const promotionPaymentCases = [
  { cart: "cart-http-promotion-payment", item: "line-http-promotion-payment", collection: "paycol-http-promotions", session: "payses-http-promotions", amount: "13.75", automatic: false },
  { cart: "cart-http-promotion-equal", item: "line-http-promotion-equal", collection: "paycol-http-promotions-equal", session: "payses-http-promotions-equal", amount: "12.65", automatic: true },
  { cart: "cart-http-promotion-failure", item: "line-http-promotion-failure", collection: "paycol-http-promotions-failure", session: "payses-http-promotions-failure", amount: "13.75", automatic: false },
] as const;
const rawPromotionAmount = (value: string) => ({ value, precision: 20 });
/** Existing business endpoints for promotion HTTP; requested adjustments and
 * Link transitions are produced by the actual native workflow under test. */
export const storeCartPromotionSeedRows: Readonly<Record<string, readonly Row[]>> = {
  promotion: [{ table: "promotion", row: { id: "promo-http-cart", code: "HTTP-CART", type: "standard", status: "active", is_automatic: false } },
    { table: "promotion_application_method", row: { id: "promomethod-http-cart", promotion_id: "promo-http-cart", value: "2", raw_value: rawPromotionAmount("2"),
      currency_code: "usd", type: "fixed", target_type: "items", allocation: "each" } }],
  cart: [{ table: "cart", row: { id: "cart-http-promotions-completed", currency_code: "usd", region_id: "reg-create-root", sales_channel_id: "sc-create-root",
    completed_at: "2026-01-01T00:00:00.000Z" } }, ...promotionPaymentCases.flatMap(value => [
    { table: "cart", row: { id: value.cart, currency_code: "usd", region_id: "reg-create-root", sales_channel_id: "sc-create-root" } },
    { table: "cart_line_item", row: { id: value.item, cart_id: value.cart, title: "Native promotion item", variant_id: "variant-create-root", product_id: "prod-create-root",
      quantity: 1, unit_price: "12.5", raw_unit_price: rawPromotionAmount("12.5") } },
    { table: "cart_line_item_tax_line", row: { id: `tax-${value.item}`, item_id: value.item, code: "NATIVE-US", rate: 10, provider_id: "tp_system" } },
    ...(value.automatic ? [{ table: "cart_line_item_adjustment", row: { id: `adj-${value.item}`, item_id: value.item, code: "NATIVE-CART", promotion_id: "promo-create-root",
      amount: "1", raw_amount: rawPromotionAmount("1") } }] : []),
  ])],
  payment: promotionPaymentCases.flatMap(value => [
    { table: "payment_collection", row: { id: value.collection, currency_code: "usd", amount: value.amount, raw_amount: rawPromotionAmount(value.amount) } },
    { table: "payment_session", row: { id: value.session, payment_collection_id: value.collection, provider_id: "pp_system_default", currency_code: "usd",
      amount: value.amount, raw_amount: rawPromotionAmount(value.amount), data: {}, context: {}, status: "pending" } },
  ]),
  cart_payment_collection_links: promotionPaymentCases.map(value => ({ table: "cart_payment_collection", row: {
    id: `link-${value.collection}`, cart_id: value.cart, payment_collection_id: value.collection } })),
  cart_promotion_links: [{ table: "cart_promotion", row: { id: "link-http-promotion-equal", cart_id: "cart-http-promotion-equal", promotion_id: "promo-create-root" } }],
};
/** The existing Workerd Cart proof exercises both native mutation slices. */
export const storeCartTaxProofSeedRows: Readonly<Record<string, readonly Row[]>> = Object.fromEntries(
  [...new Set([...Object.keys(storeCartPromotionSeedRows), ...Object.keys(storeCartTaxSeedRows)])]
    .map(name => [name, [...(storeCartPromotionSeedRows[name] ?? []), ...(storeCartTaxSeedRows[name] ?? [])]]));

export { storeCartShippingSeedRows };
export { installStoreCartShippingTaxFailure } from "./store-cart-shipping-tax-fault";
/** One endpoint dataset shared by the connected Node and Workerd proofs. */
export const storeCartShippingProofSeedRows: Readonly<Record<string, readonly Row[]>> = Object.fromEntries(
  [...new Set([...Object.keys(storeCartTaxProofSeedRows), ...Object.keys(storeCartShippingSeedRows)])]
    .map(name => {
      const rows = [...(storeCartTaxProofSeedRows[name] ?? []), ...(storeCartShippingSeedRows[name] ?? [])];
      return [name, name === "cart" ? orderStoreCartSeedRows(rows) : rows];
    }));

export const storeCartMutationSeedRows: Readonly<Record<string, readonly Row[]>> = {
  region: [{ table: "region", row: { id: "reg-cart-update", name: "Cart Update Region", currency_code: "usd" } },
    { table: "region_country", row: { iso_2: "gb", iso_3: "gbr", num_code: "826", name: "UNITED KINGDOM", display_name: "United Kingdom", region_id: "reg-cart-update" } }],
  tax: [{ table: "tax_region", row: { id: "txreg-cart-update", country_code: "gb", provider_id: "tp_system" } },
    { table: "tax_rate", row: { id: "txr-cart-update", tax_region_id: "txreg-cart-update", rate: 5, code: "NATIVE-GB", name: "Cart Update Tax", is_default: true } }],
  cart: [{ table: "cart", row: { id: "cart-http-completed", currency_code: "usd", region_id: "reg-create-root", sales_channel_id: "sc-create-root", completed_at: "2026-01-01T00:00:00.000Z" } },
    { table: "cart_line_item", row: { id: "line-http-completed", cart_id: "cart-http-completed", title: "Completed Cart item", variant_id: "variant-create-root",
      product_id: "prod-create-root", quantity: 1, unit_price: "12.5", raw_unit_price: { value: "12.5", precision: 20 } } }],
};
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
  additionalRows: Readonly<Record<string, readonly Row[]>> = {},
) {
  const auth = yield* compileStoreRequestReadFixtureCatalog(target);
  const active = auth.rows.apiKey[0];
  if (active === undefined) return yield* Effect.die(new Error("Missing Cart auth key fixture"));
  const authRows = { currency: auth.rows.currency, apiKey: [...auth.rows.apiKey, { ...active, id: "apk_cart_multi", token: storeCartMultiToken }],
    apiKeySalesChannel: [{ table: "publishable_api_key_sales_channel", row: { id: "pksc_cart_active", publishable_key_id: "apk_active", sales_channel_id: "sc-create-root" } },
      { table: "publishable_api_key_sales_channel", row: { id: "pksc_cart_multi_a", publishable_key_id: "apk_cart_multi", sales_channel_id: "sc-create-root" } },
      { table: "publishable_api_key_sales_channel", row: { id: "pksc_cart_multi_b", publishable_key_id: "apk_cart_multi", sales_channel_id: "sc-other" } }],
  };
  const definitions = yield* cartShippingCoreDefinitions(target);
  const rows: Readonly<Record<string, readonly Row[]>> = Object.fromEntries([
    ...cartShippingModuleNames.map(name => [name, [...(defaults[name] ?? []), ...(cartCreateRootSeeds[name] ?? []), ...(additionalRows[name] ?? [])]]),
    ["currency", authRows.currency.map(row => ({ table: "currency", row }))],
    ["apiKey", authRows.apiKey.map(row => ({ table: "api_key", row }))], ["apiKeySalesChannel", authRows.apiKeySalesChannel],
  ]);
  const receipt = (name: string, value: Json, count: number) => Effect.gen(function* () {
    const captured = yield* capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: value }, 1_048_576,
      { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) });
    return { stepId: `${name.toLowerCase()}-initial`, datasetSha256: captured.sha256Hex, expectedRowCount: count };
  });
  const nativeReceipt = (name: typeof cartShippingModuleNames[number]) => {
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
    location_fulfillment_set_links: nativeReceipt("location_fulfillment_set_links"), shipping_option_price_set_links: nativeReceipt("shipping_option_price_set_links"),
  });
  const catalog = yield* compileStoreCartRequestCatalog(target, { native, auth: { currency: yield* receipt("currency", authRows.currency, authRows.currency.length),
    apiKey: yield* receipt("apiKey", authRows.apiKey, authRows.apiKey.length),
    apiKeySalesChannel: yield* receipt("apiKeySalesChannel", auth.catalog.apiKeySalesChannel.definition.tables.length === 1
      ? authRows.apiKeySalesChannel.map(row => row.row) : authRows.apiKeySalesChannel, authRows.apiKeySalesChannel.length) } }, storeCartLogger);
  return { catalog, rows, target };
});
