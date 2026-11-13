import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { storeCartShippingSeedRows } from "./cart-shipping-http-seeds";

type Row = Readonly<{ table: string; row: JsonObject }>;
const excluded = new Set(["cart", "payment", "cart_payment_collection_links", "promotion"]);

/** Existing commerce endpoints only. Every Cart, adjustment, Session, Order,
 * reservation and completion Link is produced by the actual HTTP workflows. */
export const storeCartCompletionSeedRows: Readonly<Record<string, readonly Row[]>> = {
  ...Object.fromEntries(Object.entries(storeCartShippingSeedRows).filter(([name]) => !excluded.has(name)).map(([name, rows]) => [name,
    rows.map(value => name === "inventory" && value.table === "inventory_level"
      ? { ...value, row: { ...value.row, stocked_quantity: "8", raw_stocked_quantity: { value: "8", precision: 20 } } } : value)])),
  promotion: [
    { table: "promotion", row: { id: "promo-http-completion-shipping", code: "HTTP-COMPLETION-SHIPPING", type: "standard", status: "active",
      is_automatic: true, limit: 100, used: 0 } },
    { table: "promotion_application_method", row: { id: "promomethod-http-completion-shipping", promotion_id: "promo-http-completion-shipping",
      value: "3", raw_value: { value: "3", precision: 20 }, currency_code: "usd", type: "fixed", target_type: "shipping_methods", allocation: "each" } },
  ],
};
