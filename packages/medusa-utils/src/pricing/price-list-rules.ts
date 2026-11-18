import type { PriceListRuleDTO } from "@medusajs/types"

export function buildPriceListRules(
  priceListRules?: PriceListRuleDTO[]
): Record<string, string[]> | undefined {
  return priceListRules?.reduce((acc, curr) => {
    const ruleAttribute = curr.attribute
    const ruleValues = curr.value || []

    acc[ruleAttribute] = ruleValues
    return acc
  }, {})
}
