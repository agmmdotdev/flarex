import { Result } from "effect";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { cartCreationModels } from "@medusajs/cart/creation-models";
import { lineItemTotalsFields } from "@medusajs/cart/utils/totals-selection";
import { cartFieldsForCalculateShippingOptionsPrices } from "@medusajs/core-flows/cart/variant-pricing-fields";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";

/** The existing mutation allowance still bounds opaque Region, Customer and
 * metadata leaves. Only the native Shipping calculation's declared field family
 * receives separate capacity; arrays flatten to paths rather than row counts. */
export const cartShippingPricingContext = Result.try({ try: () => {
  const tables = compileDmlSchema(Object.values(cartCreationModels)).tables;
  const fields = new Set<string>();
  const selected = [...cartFieldsForCalculateShippingOptionsPrices, "sales_channel_id", "currency_code", "region_id", "item_total", "total"];
  for (const field of selected) {
    if (!field.endsWith(".*")) { fields.add(field); continue; }
    const prefix = field.slice(0, -2), tableName = prefix === "items" ? "cart_line_item" : prefix === "shipping_address" ? "cart_address" : undefined;
    const table = tables.find(table => table.name === tableName);
    if (table === undefined) throw commerceError("unsupportedProfile");
    for (const column of table.columns) {
      // JSON metadata has no finite path family and keeps the original budget.
      if (column.type === "json") continue;
      fields.add(`${prefix}.${column.name}`);
      if (column.type === "bigNumber") {
        fields.add(`${prefix}.raw_${column.name}.value`); fields.add(`${prefix}.raw_${column.name}.precision`);
      }
    }
    if (prefix === "items") for (const name of lineItemTotalsFields()) {
      if (table.columns.some(column => column.name === name)) continue;
      fields.add(`${prefix}.${name}`); fields.add(`${prefix}.raw_${name}.value`); fields.add(`${prefix}.raw_${name}.precision`);
    }
  }
  fields.delete("currency_code"); fields.delete("quantity");
  const opaqueMaximum = 64;
  return Object.freeze({ fields: Object.freeze([...fields].sort()), opaqueMaximum, maximum: opaqueMaximum + fields.size });
}, catch: cause => commerceError("unsupportedProfile", cause) });

export function admitCartShippingPricingContext(keys: readonly string[]) {
  return Result.gen(function* () {
    const policy = yield* cartShippingPricingContext;
    if (keys.length > policy.maximum || keys.filter(key => !policy.fields.includes(key)).length > policy.opaqueMaximum)
      return yield* Result.fail(commerceError("limitExceeded"));
  });
}
