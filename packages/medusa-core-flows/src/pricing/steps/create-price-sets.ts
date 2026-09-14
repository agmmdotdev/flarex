import {
  CreatePriceSetDTO,
  IPricingModuleService,
} from "@medusajs/types"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

/**
 * The price sets to create.
 */
export type CreatePriceSetWorkflowInput = CreatePriceSetDTO[]

export const createPriceSetsStepId = "create-price-sets"
/**
 * This step creates one or more price sets.
 *
 * @example
 * const data = createPriceSetsStep([{
 *   prices: [
 *     {
 *       amount: 10,
 *       currency_code: "usd",
 *     }
 *   ]
 * }])
 */
export const createPriceSetsStep = createStep(
  { name: createPriceSetsStepId, compensation: "transactionCovered" },
  async (data: CreatePriceSetWorkflowInput, { container }) => {
    const pricingModule = container.resolve<IPricingModuleService>(
      Modules.PRICING
    )

    const priceSets = await pricingModule.createPriceSets(data)

    return new StepResponse(
      priceSets,
      priceSets.map((priceSet) => priceSet.id)
    )
  },
  async (priceSets, { container }) => {
    if (!priceSets?.length) {
      return
    }

    const pricingModule = container.resolve<IPricingModuleService>(
      Modules.PRICING
    )

    await pricingModule.deletePriceSets(priceSets)
  }
)
