import { Effect } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureNativeRecord } from "../../value/native-record";

/** Native creation inputs include calculated DTO values and ownership data
 * consumed by the public Order owner. Only stored scalar fields cross the DAL.
 * The creation receipt reuses this same named representation boundary. */
export const captureOrderCreationFields = Effect.fn("OrderCreation.captureFields")(function* (input: unknown, table: string) {
  const row = yield* captureNativeRecord(input);
  const emptyRelations = table === "order" ? ["shipping_methods", "promo_codes"]
    : table === "order_line_item" ? ["tax_lines", "adjustments"] : [];
  if (table === "order_line_item") for (const key of ["order_id", "version", "quantity", "cart_id", "subtotal", "total", "original_subtotal", "original_total",
    "discount_subtotal", "discount_tax_total", "discount_total", "tax_total", "original_tax_total"]) delete row[key];
  for (const key of emptyRelations) if (row[key] !== undefined) {
    if (!Array.isArray(row[key]) || row[key].length !== 0) return yield* Effect.fail(commerceError("unsupportedProfile"));
    delete row[key];
  }
  return row;
});
