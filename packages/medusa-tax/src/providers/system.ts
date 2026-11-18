import { ITaxProvider, TaxTypes } from "@medusajs/framework/types"

export default class SystemTaxService implements ITaxProvider {
  static identifier = "system"

  getIdentifier(): string {
    return SystemTaxService.identifier
  }

  async getTaxLines(
    itemLines: TaxTypes.ItemTaxCalculationLine[],
    shippingLines: TaxTypes.ShippingTaxCalculationLine[],
    _: TaxTypes.TaxCalculationContext
  ): Promise<(TaxTypes.ItemTaxLineDTO | TaxTypes.ShippingTaxLineDTO)[]> {
    return formatSystemTaxLines(itemLines, shippingLines, () => this.getIdentifier())
  }
}

/** Native field projection shared with the adapter's read receipt. The callback
 * preserves the native identifier lookup once per emitted line, including its
 * evaluation order and the absence of lookups for empty Rate sets. */
export function formatSystemTaxLines(
  itemLines: TaxTypes.ItemTaxCalculationLine[],
  shippingLines: TaxTypes.ShippingTaxCalculationLine[],
  getIdentifier: () => string
): (TaxTypes.ItemTaxLineDTO | TaxTypes.ShippingTaxLineDTO)[] {
  let taxLines: (TaxTypes.ItemTaxLineDTO | TaxTypes.ShippingTaxLineDTO)[] =
    itemLines.flatMap((l) => {
      return l.rates.map((r) => ({
        rate_id: r.id,
        rate: r.rate || 0,
        name: r.name,
        code: r.code,
        line_item_id: l.line_item.id,
        provider_id: getIdentifier(),
      }))
    })

  taxLines = taxLines.concat(
    shippingLines.flatMap((l) => {
      return l.rates.map((r) => ({
        rate_id: r.id,
        rate: r.rate || 0,
        name: r.name,
        code: r.code,
        shipping_line_id: l.shipping_line.id,
        provider_id: getIdentifier(),
      }))
    })
  )

  return taxLines
}
