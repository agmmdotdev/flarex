import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";

type Row = Readonly<{ table: string; row: JsonObject }>;
const cartTableOrder = new Map(["cart_address", "cart", "cart_line_item", "cart_line_item_tax_line", "cart_line_item_adjustment"]
  .map((table, index) => [table, index]));
/** Keep the native initializer's adjacent table batches together. This changes
 * only the order of existing endpoints, retaining every row and all budgets. */
export const orderStoreCartSeedRows = (rows: readonly Row[]) => rows.toSorted((left, right) =>
  (cartTableOrder.get(left.table) ?? cartTableOrder.size) - (cartTableOrder.get(right.table) ?? cartTableOrder.size));
const raw = (value: string) => ({ value, precision: 20 });
const cases = ["cart-http-shipping", "cart-http-shipping-failure", "cart-http-shipping-replay", "cart-http-shipping-completed"];
const options = [
  { suffix: "standard", amount: "5", zone: "sz-http-shipping", isReturn: false, enabled: true },
  { suffix: "express", amount: "8", zone: "sz-http-shipping", isReturn: false, enabled: true },
  { suffix: "return", amount: "4", zone: "sz-http-shipping", isReturn: true, enabled: true },
  { suffix: "rule-mismatch", amount: "6", zone: "sz-http-shipping", isReturn: false, enabled: false },
  { suffix: "calculated", amount: "0", zone: "sz-http-shipping-gb", isReturn: false, enabled: true },
  { suffix: "other-channel", amount: "9", zone: "sz-http-shipping-other", isReturn: false, enabled: true },
];

/** Existing endpoints only. Requested Shipping Methods, Tax and adjustments
 * are produced by the genuine native workflows in both Node and Workerd. */
export const storeCartShippingSeedRows: Readonly<Record<string, readonly Row[]>> = {
  product: [{ table: "product_variant", row: { id: "variant-http-shipping", title: "Shippable Cart variant", sku: "http-shipping-sku",
    product_id: "prod-create-root", manage_inventory: true, allow_backorder: false } }],
  variant_links: [
    { table: "product_variant_price_set", row: { id: "varps-http-shipping", variant_id: "variant-http-shipping", price_set_id: "pset-http-shipping-item" } },
    { table: "product_variant_inventory_item", row: { id: "variitem-http-shipping", variant_id: "variant-http-shipping", inventory_item_id: "iitem-http-shipping", required_quantity: 1 } },
  ],
  inventory: [
    { table: "inventory_item", row: { id: "iitem-http-shipping", sku: "http-shipping-stock", title: "Shippable Cart stock", requires_shipping: true } },
    { table: "inventory_level", row: { id: "ilev-http-shipping", inventory_item_id: "iitem-http-shipping", location_id: "sloc-http-shipping",
      stocked_quantity: "3", raw_stocked_quantity: raw("3"), reserved_quantity: "0", raw_reserved_quantity: raw("0"), incoming_quantity: "0", raw_incoming_quantity: raw("0") } },
  ],
  stock_location: [
    { table: "stock_location_address", row: { id: "laddr-http-shipping", address_1: "1 Native shipping road", city: "Shipping origin", country_code: "us" } },
    { table: "stock_location_address", row: { id: "laddr-http-shipping-other", address_1: "2 Native shipping road", city: "Other channel origin", country_code: "us" } },
    { table: "stock_location", row: { id: "sloc-http-shipping", name: "HTTP Shipping location", address_id: "laddr-http-shipping" } },
    { table: "stock_location", row: { id: "sloc-http-shipping-other", name: "Other channel Shipping location", address_id: "laddr-http-shipping-other" } },
  ],
  sales_channel_locations: [
    { table: "sales_channel_stock_location", row: { id: "scloc-http-shipping", sales_channel_id: "sc-create-root", stock_location_id: "sloc-http-shipping" } },
    { table: "sales_channel_stock_location", row: { id: "scloc-http-shipping-other", sales_channel_id: "sc-other", stock_location_id: "sloc-http-shipping-other" } },
  ],
  fulfillment: [
    { table: "fulfillment_set", row: { id: "fset-http-shipping", name: "HTTP Shipping set", type: "shipping" } },
    { table: "fulfillment_set", row: { id: "fset-http-shipping-other", name: "Other channel Shipping set", type: "shipping" } },
    { table: "fulfillment_provider", row: { id: "manual_manual", is_enabled: true } },
    { table: "shipping_option_type", row: { id: "sot-http-shipping", label: "Manual delivery", code: "manual-http" } },
    { table: "service_zone", row: { id: "sz-http-shipping", name: "HTTP Shipping US", fulfillment_set_id: "fset-http-shipping" } },
    { table: "service_zone", row: { id: "sz-http-shipping-gb", name: "HTTP Shipping GB", fulfillment_set_id: "fset-http-shipping" } },
    { table: "service_zone", row: { id: "sz-http-shipping-other", name: "HTTP Shipping other channel", fulfillment_set_id: "fset-http-shipping-other" } },
    { table: "geo_zone", row: { id: "gz-http-shipping", type: "country", country_code: "us", service_zone_id: "sz-http-shipping" } },
    { table: "geo_zone", row: { id: "gz-http-shipping-gb", type: "country", country_code: "gb", service_zone_id: "sz-http-shipping-gb" } },
    { table: "geo_zone", row: { id: "gz-http-shipping-other", type: "country", country_code: "us", service_zone_id: "sz-http-shipping-other" } },
    ...options.map(option => ({ table: "shipping_option", row: { id: `so-http-shipping-${option.suffix}`, name: `HTTP Shipping ${option.suffix}`,
      price_type: option.suffix === "calculated" ? "calculated" : "flat", service_zone_id: option.zone, shipping_profile_id: "sp-create-root", provider_id: "manual_manual", shipping_option_type_id: "sot-http-shipping",
      data: { id: option.isReturn ? "manual-fulfillment-return" : "manual-fulfillment" } } })),
    ...options.flatMap(option => [
      { table: "shipping_option_rule", row: { id: `sor-http-${option.suffix}-return`, shipping_option_id: `so-http-shipping-${option.suffix}`,
        attribute: "is_return", operator: "eq", value: option.isReturn ? "true" : "false" } },
      { table: "shipping_option_rule", row: { id: `sor-http-${option.suffix}-enabled`, shipping_option_id: `so-http-shipping-${option.suffix}`,
        attribute: "enabled_in_store", operator: "eq", value: option.enabled ? "true" : "false" } },
    ]),
  ],
  location_fulfillment_set_links: [
    { table: "location_fulfillment_set", row: { id: "locfs-http-shipping", stock_location_id: "sloc-http-shipping", fulfillment_set_id: "fset-http-shipping" } },
    { table: "location_fulfillment_set", row: { id: "locfs-http-shipping-other", stock_location_id: "sloc-http-shipping-other", fulfillment_set_id: "fset-http-shipping-other" } },
  ],
  pricing: [
    { table: "price_set", row: { id: "pset-http-shipping-item" } },
    { table: "price", row: { id: "price-http-shipping-item", price_set_id: "pset-http-shipping-item", currency_code: "usd", amount: "12.5", raw_amount: raw("12.5") } },
    ...options.filter(option => option.suffix !== "calculated").flatMap(option => [
      { table: "price_set", row: { id: `pset-http-shipping-${option.suffix}` } },
      { table: "price", row: { id: `price-http-shipping-${option.suffix}`, price_set_id: `pset-http-shipping-${option.suffix}`,
        currency_code: "usd", amount: option.amount, raw_amount: raw(option.amount) } },
    ]),
  ],
  shipping_option_price_set_links: options.filter(option => option.suffix !== "calculated").map(option => ({ table: "shipping_option_price_set", row: {
    id: `sops-http-shipping-${option.suffix}`, shipping_option_id: `so-http-shipping-${option.suffix}`, price_set_id: `pset-http-shipping-${option.suffix}`,
  } })),
  cart: orderStoreCartSeedRows([...[...cases, "cart-http-shipping-inventory", "cart-http-shipping-calculated"].flatMap(id => [
    { table: "cart_address", row: { id: `addr-${id}`, country_code: id === "cart-http-shipping-calculated" ? "gb" : "us", city: id === "cart-http-shipping-failure" ? "Workerd Shipping failure" : "Shipping destination" } },
    { table: "cart", row: { id, currency_code: "usd", region_id: "reg-create-root", sales_channel_id: "sc-create-root", shipping_address_id: `addr-${id}`,
      ...(id === "cart-http-shipping-completed" ? { completed_at: "2026-01-01T00:00:00.000Z" } : {}) } },
    { table: "cart_line_item", row: { id: `line-${id}`, cart_id: id, title: "Shippable Cart item", variant_id: "variant-http-shipping", product_id: "prod-create-root",
      quantity: id === "cart-http-shipping-inventory" ? 4 : 1, unit_price: "12.5", raw_unit_price: raw("12.5") } },
    { table: "cart_line_item_tax_line", row: { id: `tax-${id}`, item_id: `line-${id}`, code: "NATIVE-US", rate: 10, provider_id: "system" } },
  ]),
    { table: "cart", row: { id: "cart-http-shipping-no-channel", currency_code: "usd", region_id: "reg-create-root", sales_channel_id: null } },
    { table: "cart", row: { id: "cart-http-shipping-omitted-channel", currency_code: "usd", region_id: "reg-create-root" } },
  ]),
  promotion: [
    { table: "promotion", row: { id: "promo-http-shipping", code: "HTTP-SHIPPING", type: "standard", status: "active", is_automatic: true } },
    { table: "promotion_application_method", row: { id: "promomethod-http-shipping", promotion_id: "promo-http-shipping", value: "3", raw_value: raw("3"),
      currency_code: "usd", type: "fixed", target_type: "shipping_methods", allocation: "each" } },
    { table: "promotion_rule", row: { id: "prorul-http-shipping", attribute: "id", operator: "in" } },
    ...cases.map((id, index) => ({ table: "promotion_rule_value", row: { id: `prorulval-http-shipping-${index}`, promotion_rule_id: "prorul-http-shipping", value: id } })),
    { table: "promotion_promotion_rule", row: { promotion_id: "promo-http-shipping", promotion_rule_id: "prorul-http-shipping" } },
  ],
  payment: cases.filter(id => id !== "cart-http-shipping-completed").flatMap(id => [
    { table: "payment_collection", row: { id: id.replace("cart-", "paycol-"), currency_code: "usd", amount: "13.75", raw_amount: raw("13.75") } },
    { table: "payment_session", row: { id: id.replace("cart-", "payses-"), payment_collection_id: id.replace("cart-", "paycol-"), provider_id: "pp_system_default",
      currency_code: "usd", amount: "13.75", raw_amount: raw("13.75"), data: {}, context: {}, status: "pending" } },
  ]),
  cart_payment_collection_links: cases.filter(id => id !== "cart-http-shipping-completed").map(id => ({ table: "cart_payment_collection", row: {
    id: `link-${id}`, cart_id: id, payment_collection_id: id.replace("cart-", "paycol-"),
  } })),
};
