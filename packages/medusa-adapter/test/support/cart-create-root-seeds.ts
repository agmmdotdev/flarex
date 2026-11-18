import type { CoreNativeWorkflowSource } from "./core-native-workflow-fixture";

/** Existing business endpoints only. Cart/Address/LineItem/TaxLine/Adjustment
 * rows are produced exclusively by the genuine Cart root under test. */
export const cartCreateRootSeeds: Readonly<Record<string, CoreNativeWorkflowSource["rows"]>> = {
  customer: [{ table: "customer", row: { id: "cus-create-root", email: "native-cart@example.com", has_account: true,
    first_name: "Native", last_name: "Cart" } },
  { table: "customer_group", row: { id: "cusgroup-create-root", name: "Cart group" } },
  { table: "customer_group_customer", row: { id: "cusgc-create-root", customer_id: "cus-create-root", customer_group_id: "cusgroup-create-root" } }],
  product: [{ table: "product", row: { id: "prod-create-root", title: "Native Cart Product", handle: "native-cart-product", status: "published" } },
  { table: "product_variant", row: { id: "variant-create-root", title: "Native Cart Variant", sku: "native-cart-sku", product_id: "prod-create-root",
    manage_inventory: true, allow_backorder: false } }],
  pricing: [{ table: "price_set", row: { id: "pset-create-root" } },
  { table: "price", row: { id: "price-create-root", price_set_id: "pset-create-root", currency_code: "usd", amount: "12.5",
    raw_amount: { value: "12.5", precision: 20 } } }],
  inventory: [{ table: "inventory_item", row: { id: "iitem-create-root", sku: "stock-cart-sku", title: "Native Cart stock", requires_shipping: false } },
  { table: "inventory_level", row: { id: "ilev-create-root", inventory_item_id: "iitem-create-root", location_id: "sloc-create-root",
    stocked_quantity: "3", raw_stocked_quantity: { value: "3", precision: 20 }, reserved_quantity: "0", raw_reserved_quantity: { value: "0", precision: 20 },
    incoming_quantity: "0", raw_incoming_quantity: { value: "0", precision: 20 } } }],
  stock_location: [{ table: "stock_location", row: { id: "sloc-create-root", name: "Native Cart location" } }],
  fulfillment: [{ table: "shipping_profile", row: { id: "sp-create-root", name: "Native Cart shipping", type: "default" } }],
  product_links: [{ table: "product_sales_channel", row: { id: "prodsc-create-root", product_id: "prod-create-root", sales_channel_id: "sc-create-root" } },
  { table: "product_shipping_profile", row: { id: "prodsp-create-root", product_id: "prod-create-root", shipping_profile_id: "sp-create-root" } }],
  variant_links: [{ table: "product_variant_price_set", row: { id: "varps-create-root", variant_id: "variant-create-root", price_set_id: "pset-create-root" } },
  { table: "product_variant_inventory_item", row: { id: "variitem-create-root", variant_id: "variant-create-root", inventory_item_id: "iitem-create-root", required_quantity: 1 } }],
  sales_channel_locations: [{ table: "sales_channel_stock_location", row: { id: "scloc-create-root", sales_channel_id: "sc-create-root", stock_location_id: "sloc-create-root" } }],
  tax: [{ table: "tax_provider", row: { id: "tp_system", is_enabled: true } },
  { table: "tax_region", row: { id: "txreg-create-root", country_code: "us", provider_id: "tp_system" } },
  { table: "tax_rate", row: { id: "txr-create-root", tax_region_id: "txreg-create-root", rate: 10, code: "NATIVE-US", name: "Native Cart tax", is_default: true } }],
  promotion: [{ table: "promotion", row: { id: "promo-create-root", code: "NATIVE-CART", type: "standard", status: "active", is_automatic: true } },
  { table: "promotion_application_method", row: { id: "promomethod-create-root", promotion_id: "promo-create-root", value: "1",
    raw_value: { value: "1", precision: 20 }, currency_code: "usd", type: "fixed", target_type: "items", allocation: "each" } }],
};
