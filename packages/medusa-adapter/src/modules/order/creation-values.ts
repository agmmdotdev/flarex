import { Effect } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureNativeRecord } from "../../value/native-record";

/** Native creation inputs include calculated DTO values and ownership data
 * consumed by the public Order owner. Only stored scalar fields cross the DAL.
 * The creation receipt reuses this same named representation boundary. */
export const captureOrderCreationFields = Effect.fn("OrderCreation.captureFields")(function* (input: unknown, table: string, profile: "creation" | "checkout" = "creation") {
  const row = yield* captureNativeRecord(input);
  const emptyRelations = table === "order" ? profile === "checkout" ? [] : ["shipping_methods", "promo_codes"]
    : table === "order_line_item" && profile === "creation" ? ["tax_lines", "adjustments"] : [];
  if (table === "order_line_item") for (const key of ["order_id", "version", "quantity", "cart_id", "subtotal", "total", "original_subtotal", "original_total",
    "discount_subtotal", "discount_tax_total", "discount_total", "tax_total", "original_tax_total"]) delete row[key];
  // Native tax/adjustment totals mutate the supplied children before the Order
  // create call. These four model families store rate/amount, not the native
  // calculated presentation values; input admission still rejects such fields.
  if (profile === "checkout" && ["order_line_item_tax_line", "order_line_item_adjustment",
    "order_shipping_method_tax_line", "order_shipping_method_adjustment"].includes(table))
    for (const key of ["subtotal", "total", "raw_subtotal", "raw_total"]) delete row[key];
  if (profile === "checkout" && table === "order" && row.promo_codes !== undefined) {
    // The native checkout transform carries promotion codes on CreateOrderDTO;
    // Order's mapped DAL has no such column. Actual links/usage remain with
    // their native owners, outside this creation projection.
    if (!Array.isArray(row.promo_codes) || row.promo_codes.length > 8 || row.promo_codes.some(value => typeof value !== "string"))
      return yield* Effect.fail(commerceError("unsupportedProfile"));
    delete row.promo_codes;
  }
  for (const key of emptyRelations) if (row[key] !== undefined) {
    if (!Array.isArray(row[key]) || row[key].length !== 0) return yield* Effect.fail(commerceError("unsupportedProfile"));
    delete row[key];
  }
  return row;
});
