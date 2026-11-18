import type { FindConfig } from "@medusajs/framework/types"
import { deduplicate } from "@medusajs/framework/utils/portable"

/** Native Order total selection mutates the DAL request before formatting.
 * Keeping it with the native module lets call receipts derive that same read
 * closure without copying the selection algorithm into the adapter. */
export function includeOrderTotals(config: FindConfig<Record<string, unknown>>): boolean {
  const totalFields = [
    "total",
    "subtotal",
    "tax_total",
    "discount_total",
    "discount_tax_total",
    "original_total",
    "original_tax_total",
    "pending_difference",
    "item_total",
    "item_subtotal",
    "item_tax_total",
    "original_item_total",
    "original_item_subtotal",
    "original_item_tax_total",
    "shipping_total",
    "shipping_subtotal",
    "shipping_tax_total",
    "original_shipping_tax_total",
    "original_shipping_subtotal",
    "original_shipping_total",
    "original_total",
    "original_subtotal",
    "original_tax_total",
    "credit_line_total",
    "credit_line_tax_total",
    "credit_line_subtotal",
    "refundable_amount",
  ]

  const includeTotals = (config?.select ?? []).some((field) =>
    totalFields.includes(field as string)
  )

  if (includeTotals) {
    addOrderRelationsForTotals(config, totalFields)
  }

  return includeTotals
}

function addOrderRelationsForTotals(config: FindConfig<Record<string, unknown>>, totalFields: readonly string[]) {
  config.relations ??= []
  config.select ??= []

  const requiredRelationsForTotals = [
    "credit_lines",
    "items",
    "items.tax_lines",
    "items.adjustments",
    "shipping_methods",
    "shipping_methods.tax_lines",
    "shipping_methods.adjustments",
  ]

  config.relations = deduplicate([
    ...config.relations,
    ...requiredRelationsForTotals,
  ])

  config.select = config.select.filter((field) => {
    return (
      !requiredRelationsForTotals.some((val) =>
        val.startsWith(field as string)
      ) && !totalFields.includes(field)
    )
  })
}
