import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";

type Row = Readonly<{ table: string; row: JsonObject }>;
const raw = (value: string) => ({ value, precision: 20 });
const stamp = "2026-11-01T00:00:00.000Z";
export const storeOrderIds = Object.freeze(Array.from({ length: 53 }, (_, index) => `order-store-${String(index).padStart(3, "0")}`));
export const storeOrderSpecialId = "order-store-000";
export const storeOrderEmptyId = "order-store-052";
export const storeOrderOtherId = "order-store-other";
export const storeOrderDraftId = "order-store-draft";
export const storeOrderDeletedId = "order-store-deleted";

const populated = storeOrderIds.filter(id => id !== storeOrderEmptyId);
const orders: Row[] = [
  ...storeOrderIds.map((id, index) => ({ table: "order", row: { id, currency_code: "usd", customer_id: "cus-create-root",
    email: "store-order@example.com", status: index % 2 === 0 ? "pending" : "completed", region_id: "reg-create-root", sales_channel_id: "sc-create-root" } })),
  { table: "order", row: { id: storeOrderOtherId, currency_code: "usd", customer_id: "cus-store-other", status: "pending" } },
  { table: "order", row: { id: storeOrderDraftId, currency_code: "usd", customer_id: "cus-create-root", is_draft_order: true, status: "draft" } },
  { table: "order", row: { id: storeOrderDeletedId, currency_code: "usd", customer_id: "cus-create-root", deleted_at: stamp, status: "pending" } },
  ...storeOrderIds.map(id => ({ table: "order_summary", row: { id: `summary-${id}`, order_id: id, totals: {} } })),
  ...populated.map(id => ({ table: "order_line_item", row: { id: `item-${id}`, title: "Native Store Order item", unit_price: "10", raw_unit_price: raw("10"),
    ...(id === storeOrderSpecialId ? { variant_id: "variant-create-root", product_id: "prod-create-root" } : {}) } })),
  ...populated.map(id => ({ table: "order_item", row: { id: `detail-${id}`, order_id: id, item_id: `item-${id}`, quantity: "1", raw_quantity: raw("1"),
    fulfilled_quantity: "1", raw_fulfilled_quantity: raw("1"), shipped_quantity: "1", raw_shipped_quantity: raw("1"),
    delivered_quantity: id === storeOrderSpecialId ? "1" : "0", raw_delivered_quantity: raw(id === storeOrderSpecialId ? "1" : "0") } })),
];

/** Existing committed records, installed through genuine source initializers.
 * Every default-page Order has real Payment and Fulfillment endpoints. */
export const storeOrderHttpSeedRows: Readonly<Record<string, readonly Row[]>> = {
  cart: [
    { table: "cart", row: { id: "cart-store-order-compat", currency_code: "usd", region_id: "reg-create-root", sales_channel_id: "sc-create-root", customer_id: "cus-create-root" } },
    { table: "cart_line_item", row: { id: "line-store-order-compat", cart_id: "cart-store-order-compat", title: "Existing Cart graph item", variant_id: "variant-create-root",
      product_id: "prod-create-root", quantity: 1, unit_price: "12.5", raw_unit_price: raw("12.5") } },
  ],
  customer: [{ table: "customer", row: { id: "cus-store-other", email: "other-store-order@example.com", has_account: true } }],
  order: orders,
  payment: [
    ...populated.map(id => ({ table: "payment_collection", row: { id: `paycol-${id}`, currency_code: "usd", amount: "10", raw_amount: raw("10"),
      authorized_amount: "10", raw_authorized_amount: raw("10"), captured_amount: id === storeOrderSpecialId ? "10" : "0",
      raw_captured_amount: raw(id === storeOrderSpecialId ? "10" : "0"), refunded_amount: "0", raw_refunded_amount: raw("0"),
      status: id === storeOrderSpecialId ? "completed" : "authorized" } })),
    { table: "payment_collection", row: { id: "paycol-store-canceled", currency_code: "usd", amount: "10", raw_amount: raw("10"),
      authorized_amount: "0", raw_authorized_amount: raw("0"), captured_amount: "0", raw_captured_amount: raw("0"), refunded_amount: "0", raw_refunded_amount: raw("0"), status: "canceled" } },
  ],
  order_payment_collection_links: [
    ...populated.map(id => ({ table: "order_payment_collection", row: { id: `opcl-${id}`, order_id: id, payment_collection_id: `paycol-${id}` } })),
    { table: "order_payment_collection", row: { id: "opcl-store-canceled", order_id: storeOrderSpecialId, payment_collection_id: "paycol-store-canceled" } },
  ],
  fulfillment: [
    { table: "fulfillment_address", row: { id: "fuladdr-store-rich", address_1: "10 Native delivery road", city: "Native delivery", country_code: "us" } },
    ...populated.map(id => ({ table: "fulfillment", row: { id: `ful-${id}`, location_id: "location-store-order", packed_at: stamp, shipped_at: stamp,
      ...(id === storeOrderSpecialId ? { delivered_at: stamp, delivery_address_id: "fuladdr-store-rich" } : {}), data: {} } })),
    { table: "fulfillment", row: { id: "ful-store-canceled", location_id: "location-store-order", packed_at: stamp, shipped_at: stamp, delivered_at: stamp,
      canceled_at: stamp, data: {} } },
    ...populated.map(id => ({ table: "fulfillment_item", row: { id: `fulit-${id}`, fulfillment_id: `ful-${id}`, title: "Native fulfilled item", sku: "store-order-sku",
      barcode: "store-order-barcode", quantity: "1", raw_quantity: raw("1"), line_item_id: `item-${id}` } })),
    { table: "fulfillment_label", row: { id: "fulla-store-rich", fulfillment_id: `ful-${storeOrderSpecialId}`, tracking_number: "STORE-NATIVE-1",
      tracking_url: "https://tracking.test/store-native-1", label_url: "https://labels.test/store-native-1" } },
  ],
  order_fulfillment_links: [
    ...populated.map(id => ({ table: "order_fulfillment", row: { id: `ofl-${id}`, order_id: id, fulfillment_id: `ful-${id}` } })),
    { table: "order_fulfillment", row: { id: "ofl-store-canceled", order_id: storeOrderSpecialId, fulfillment_id: "ful-store-canceled" } },
  ],
};
