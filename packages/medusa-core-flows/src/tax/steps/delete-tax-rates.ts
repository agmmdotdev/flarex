import type { ITaxModuleService } from "@medusajs/types/tax/index"
import { Modules } from "@medusajs/framework/utils/portable"
import { createStep, StepResponse } from "@medusajs/workflows-sdk"

/**
 * The IDs of the tax rates to delete.
 */
export type DeleteTaxRatesStepInput = string[]

export const deleteTaxRatesStepId = "delete-tax-rates"
/**
 * This step deletes one or more tax rates.
 */
export const deleteTaxRatesStep = createStep(
  { name: deleteTaxRatesStepId, compensation: "transactionCovered" },
  async (ids: DeleteTaxRatesStepInput, { container }) => {
    const service = container.resolve<ITaxModuleService>(Modules.TAX)

    await service.softDeleteTaxRates(ids)

    return new StepResponse(void 0, ids)
  },
  async (prevIds, { container }) => {
    if (!prevIds?.length) {
      return
    }

    const service = container.resolve<ITaxModuleService>(Modules.TAX)

    await service.restoreTaxRates(prevIds)
  }
)
