import { SqlEntityManager } from "@medusajs/framework/mikro-orm/postgresql"
import { createPrices, defaultPricesData } from "./price"
import { createPriceRules, defaultPriceRuleData } from "./price-rule"
import { createPriceSets, defaultPriceSetsData } from "./price-set"


export async function seedPriceData(
  testManager: SqlEntityManager,
  {
    priceSetsData = defaultPriceSetsData,
    priceRuleData = defaultPriceRuleData,
    pricesData = defaultPricesData,
  } = {}
) {
  await createPriceSets(testManager, priceSetsData)
  await createPrices(testManager, pricesData)
  await createPriceRules(testManager, priceRuleData)
}

