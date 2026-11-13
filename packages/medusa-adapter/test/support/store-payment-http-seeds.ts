import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { orderStoreCartSeedRows } from "./cart-shipping-http-seeds";

type Row = Readonly<{ table: string; row: JsonObject }>;
const raw = (value: string) => ({ value, precision: 20 });

/** Existing endpoints only. Collection, Session, account and Link mutations in
 * the proof are produced by their genuine native workflows. */
export const storePaymentHttpSeedRows: Readonly<Record<string, readonly Row[]>> = {
  cart: orderStoreCartSeedRows([
    { table: "cart_address", row: { id: "addr-cart-http-payment", country_code: "us" } },
    { table: "cart", row: { id: "cart-http-payment", currency_code: "usd", region_id: "reg-create-root",
      sales_channel_id: "sc-create-root", shipping_address_id: "addr-cart-http-payment" } },
    { table: "cart", row: { id: "cart-http-payment-completed", currency_code: "usd", region_id: "reg-create-root",
      sales_channel_id: "sc-create-root", completed_at: "2026-01-01T00:00:00.000Z" } },
    { table: "cart", row: { id: "cart-http-payment-no-channel", currency_code: "usd", region_id: "reg-create-root", sales_channel_id: null } },
    { table: "cart", row: { id: "cart-http-payment-existing-completed", currency_code: "usd", region_id: "reg-create-root",
      sales_channel_id: null, completed_at: "2026-01-01T00:00:00.000Z" } },
    { table: "cart_line_item", row: { id: "line-cart-http-payment", cart_id: "cart-http-payment", title: "Native HTTP payment item",
      variant_id: "variant-create-root", product_id: "prod-create-root", quantity: 1, unit_price: "12.5", raw_unit_price: raw("12.5") } },
    { table: "cart_line_item_tax_line", row: { id: "tax-cart-http-payment", item_id: "line-cart-http-payment", code: "NATIVE-US",
      rate: 10, provider_id: "tp_system" } },
  ]),
  customer: [
    { table: "customer_address", row: { id: "cuaddr-http-payment-first", customer_id: "cus-create-root", city: "First saved address", country_code: "us" } },
    { table: "customer_address", row: { id: "cuaddr-http-payment-billing", customer_id: "cus-create-root", city: "Native billing address",
      country_code: "us", is_default_billing: true } },
  ],
  payment: [
    ...[
      { id: "paycol-http-payment-existing", amount: "31.25" },
      { id: "paycol-http-payment-customer", amount: "13.75" },
      { id: "paycol-http-payment-failure", amount: "9.5" },
      { id: "paycol-http-payment-replay", amount: "13.75" },
      { id: "paycol-http-payment-full", amount: "13.75" },
    ].map(value => ({ table: "payment_collection", row: { id: value.id, currency_code: "usd", amount: value.amount, raw_amount: raw(value.amount) } })),
    { table: "payment_session", row: { id: "payses-http-payment-failure", payment_collection_id: "paycol-http-payment-failure", provider_id: "pp_system_default",
      currency_code: "usd", amount: "9.5", raw_amount: raw("9.5"), data: { previous_session: true }, context: {}, status: "pending" } },
    ...[1, 2, 3, 4].map(index => ({ table: "payment_session", row: { id: `payses-http-payment-authorized-${index}`,
      payment_collection_id: "paycol-http-payment-full", provider_id: "pp_system_default", currency_code: "usd", amount: "13.75", raw_amount: raw("13.75"),
      data: {}, context: {}, status: "authorized", authorized_at: "2026-01-01T00:00:00.000Z" } })),
  ],
  cart_payment_collection_links: [
    { table: "cart_payment_collection", row: { id: "link-http-payment-existing", cart_id: "cart-http-payment-existing-completed",
      payment_collection_id: "paycol-http-payment-existing" } },
  ],
};
