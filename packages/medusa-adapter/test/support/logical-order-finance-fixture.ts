import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";

export type OrderFinanceInitialRow = Readonly<{ table: string; row: JsonObject }>;

/** Existing Order with real item and shipping rows. No synthetic totals reader,
 * storage/default implementation or financial algorithm lives in this fixture. */
export const orderFinanceRows: readonly OrderFinanceInitialRow[] = [
  { table: "order", row: { id: "order-finance", display_id: 400, currency_code: "usd", version: 1, status: "pending" } },
  { table: "order_summary", row: { id: "ordsum-finance", order_id: "order-finance", version: 1,
    totals: { paid_total: 0, refunded_total: 0, transaction_total: 0, pending_difference: 15, original_order_total: 15,
      current_order_total: 15, accounting_total: 15, credit_line_total: 0 } } },
  { table: "order_line_item", row: { id: "ordli-finance", title: "Native financial item", unit_price: "12.500000000000000000",
    raw_unit_price: { value: "12.500000000000000000", precision: 20 } } },
  { table: "order_item", row: { id: "orditem-finance", order_id: "order-finance", item_id: "ordli-finance", version: 1,
    quantity: "1.0000000000000000000", raw_quantity: { value: "1.0000000000000000000", precision: 20 },
    unit_price: "12.500000000000000000", raw_unit_price: { value: "12.500000000000000000", precision: 20 } } },
  { table: "order_shipping_method", row: { id: "ordsm-finance", name: "Native financial shipping", amount: "2.5000000000000000000",
    raw_amount: { value: "2.5000000000000000000", precision: 20 }, shipping_option_id: "so-existing" } },
  { table: "order_shipping", row: { id: "ordspmv-finance", order_id: "order-finance", shipping_method_id: "ordsm-finance", version: 1 } },
];
