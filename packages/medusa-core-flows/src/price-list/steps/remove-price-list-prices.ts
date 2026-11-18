import type { IPricingModuleService } from "@medusajs/types"
import { Modules } from "@medusajs/framework/utils/portable"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

/**
 * The IDs of price lists to remove their prices.
 */
export type RemovePriceListPricesStepInput = string[]

export const removePriceListPricesStepId = "remove-price-list-prices"
/**
 * This step removes prices from a price list.
 */
export const removePriceListPricesStep = createStep(
  { name: removePriceListPricesStepId, compensation: "transactionCovered" },
  async (ids: RemovePriceListPricesStepInput, { container }) => {
    if (!ids.length) {
      return new StepResponse([], [])
    }

    const pricingModule = container.resolve<IPricingModuleService>(
      Modules.PRICING
    )

    const prices = await pricingModule.listPrices(
      { id: ids },
      { relations: ["price_list"] }
    )

    const priceIds = prices.map((price) => price.id)

    await pricingModule.softDeletePrices(priceIds)

    return new StepResponse(priceIds, priceIds)
  },
  async (ids, { container }) => {
    if (!ids?.length) {
      return
    }

    const pricingModule = container.resolve<IPricingModuleService>(
      Modules.PRICING
    )

    await pricingModule.restorePrices(ids)
  }
)
