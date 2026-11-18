import type {
  IPricingModuleService,
  PricingWorkflow,
} from "@medusajs/types"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

/**
 * The price preferences to create.
 */
export type CreatePricePreferencesStepInput = PricingWorkflow.CreatePricePreferencesWorkflowInput[]

export const createPricePreferencesStepId = "create-price-preferences"
/**
 * This step creates one or more price preferences.
 *
 * @example
 * const data = createPricePreferencesStep([{
 *   attribute: "region_id",
 *   value: "reg_123",
 *   is_tax_inclusive: true
 * }])
 */
export const createPricePreferencesStep = createStep(
  { name: createPricePreferencesStepId, compensation: "transactionCovered" },
  async (
    data: CreatePricePreferencesStepInput,
    { container }
  ) => {
    const pricingModule = container.resolve<IPricingModuleService>(
      Modules.PRICING
    )

    const pricePreferences = await pricingModule.createPricePreferences(data)

    return new StepResponse(
      pricePreferences,
      pricePreferences.map((pricePreference) => pricePreference.id)
    )
  },
  async (pricePreferences, { container }) => {
    if (!pricePreferences?.length) {
      return
    }

    const pricingModule = container.resolve<IPricingModuleService>(
      Modules.PRICING
    )

    await pricingModule.deletePricePreferences(pricePreferences)
  }
)
