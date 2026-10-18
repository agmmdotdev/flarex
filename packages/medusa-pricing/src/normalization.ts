/** Storage-independent native Pricing normalization extracted unchanged from
 * packages/modules/pricing/src/services/pricing-module.ts at
 * 48d5cc675e4e8bc821e22c20c88a751acc66fb5f. */
import type { CreatePricesDTO, CreatePriceRuleDTO, PricingRuleOperatorValues, PricingTypes } from "@medusajs/framework/types"
import { isPresent, MedusaError, PricingRuleOperator, removeNullish } from "@medusajs/framework/utils/portable"
import type { ServiceTypes } from "./types"

export function normalizePrices(
  data: CreatePricesDTO[] | undefined,
  existingPrices: PricingTypes.PriceDTO[],
  priceListId?: string | undefined
) {
  const pricesToUpsert = new Map<
    string,
    CreatePricesDTO & { price_rules?: CreatePriceRuleDTO[] }
  >()
  const existingPricesMap = new Map<string, PricingTypes.PriceDTO>()
  Array.from(existingPrices ?? []).forEach((price) => {
    existingPricesMap.set(hashPrice(price), price)
  })

  const ruleOperatorsSet = new Set<PricingRuleOperatorValues>(
    Object.values(PricingRuleOperator)
  )
  const validOperatorsList = Array.from(ruleOperatorsSet).join(", ")
  const invalidOperatorError = `operator should be one of ${validOperatorsList}`

  data?.forEach((price) => {
    const cleanRules = price.rules ? removeNullish(price.rules) : {}

    const rules = Object.entries(cleanRules)
      .flatMap(([attribute, value]) => {
        if (Array.isArray(value)) {
          return value.map((customRule) => {
            if (!ruleOperatorsSet.has(customRule.operator)) {
              throw new MedusaError(
                MedusaError.Types.INVALID_DATA,
                invalidOperatorError
              )
            }

            if (typeof customRule.value !== "number") {
              throw new MedusaError(
                MedusaError.Types.INVALID_DATA,
                `value should be a number`
              )
            }

            return {
              attribute,
              operator: customRule.operator,
              // TODO: we throw above if value is not a number, but the model expect the value to be a string
              value: customRule.value.toString(),
            }
          })
        }

        return {
          attribute,
          value,
        }
      })
      .map((rule, priority) => ({ ...rule, priority }))

    const entry = price as ServiceTypes.UpsertPriceDTO

    const hasRulesInput = isPresent(price.rules)
    entry.price_list_id = priceListId
    if (hasRulesInput) {
      entry.price_rules = rules
      entry.rules_count = rules.length
      delete (entry as CreatePricesDTO).rules
    }

    const entryHash = hashPrice(entry)

    // We want to keep the existing rules as they might already have ids, but any other data should come from the updated input
    const existing = existingPricesMap.get(entryHash)

    if (existing) {
      entry.id = existing.id ?? entry.id
      entry.price_rules = existing.price_rules ?? entry.price_rules
    }

    pricesToUpsert.set(entryHash, entry)
  })

  return Array.from(pricesToUpsert.values())
}

const hashPrice = (
  price: PricingTypes.PriceDTO | PricingTypes.CreatePricesDTO
): string => {
  // Build hash using deterministic property order to avoid expensive sort operation
  // Using a direct string concatenation approach for better performance
  const parts: string[] = []

  if ("currency_code" in price) {
    parts.push(`cc:${price.currency_code ?? ""}`)
  }
  if ("price_set_id" in price) {
    parts.push(`ps:${price.price_set_id ?? ""}`)
  }
  if ("price_list_id" in price) {
    parts.push(`pl:${price.price_list_id ?? ""}`)
  }
  if ("min_quantity" in price) {
    parts.push(`min:${price.min_quantity ?? ""}`)
  }
  if ("max_quantity" in price) {
    parts.push(`max:${price.max_quantity ?? ""}`)
  }

  // Add price rules in a deterministic way if present
  if ("price_rules" in price && price.price_rules) {
    const sortedRules = price.price_rules.map(
      (pr) => `${pr.attribute}=${pr.value}`
    )
    if (sortedRules.length) {
      parts.push(`rules:${sortedRules.join(",")}`)
    }
  }

  return parts.sort().join("|")
}
