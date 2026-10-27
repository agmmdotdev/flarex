import type { FindConfig } from "@medusajs/framework/types"
import { deduplicate } from "@medusajs/framework/utils/portable"

/** Native Cart total selection shared with authenticated read receipts. */
export function cartTotalsFields(): string[] { return [
      "total",
      "subtotal",
      "tax_total",
      "discount_total",
      "discount_tax_total",
      "original_total",
      "original_tax_total",
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
    ] }

export function includeCartTotals(config: FindConfig<Record<string, unknown>>): boolean {
    const totalFields = cartTotalsFields()

    const includeTotals = (config?.select ?? []).some((field) =>
      totalFields.includes(field as string)
    )

    if (includeTotals) {
      addRelationsToCalculateTotals(config, totalFields)
    }

    return includeTotals
  }

function addRelationsToCalculateTotals(config: FindConfig<Record<string, unknown>>, totalFields: string[]) {
    config.relations ??= []
    config.select ??= []

    const requiredFieldsForTotals = [
      "items",
      "credit_lines",
      "items.tax_lines",
      "items.adjustments",
      "shipping_methods",
      "shipping_methods.tax_lines",
      "shipping_methods.adjustments",
    ]
    const requiredScalarFieldsForTotals = [
      ...requiredFieldsForTotals.map((relation) => `${relation}.*`),
      "items.id",
      "items.quantity",
      "items.unit_price",
      "items.title",
      "items.subtitle",
      "items.thumbnail",
      "items.product_id",
      "items.product_title",
      "items.product_description",
      "items.product_subtitle",
      "items.product_type",
      "items.product_type_id",
      "items.product_collection",
      "items.product_handle",
      "items.variant_id",
      "items.variant_sku",
      "items.variant_barcode",
      "items.variant_title",
      "items.variant_option_values",
      "items.requires_shipping",
      "items.is_discountable",
      "items.is_custom_price",
      "items.metadata",
      "items.is_tax_inclusive",
      "items.adjustments.amount",
      "items.tax_lines.rate",
      "shipping_methods.amount",
      "shipping_methods.is_tax_inclusive",
      "shipping_methods.adjustments.amount",
      "shipping_methods.tax_lines.rate",
    ]
    config.relations = deduplicate([
      ...config.relations,
      ...requiredFieldsForTotals,
    ])

    config.select = deduplicate([
      ...config.select.filter((field) => {
        return (
          !requiredFieldsForTotals.some((val) =>
            val.startsWith(field as string)
          ) && !totalFields.includes(field)
        )
      }),
      ...requiredScalarFieldsForTotals,
    ])
  }
