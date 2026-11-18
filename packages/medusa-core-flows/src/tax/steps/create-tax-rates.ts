import type {
  CreateTaxRateDTO,
  ITaxModuleService,
} from "@medusajs/types/tax/index"
import { Modules } from "@medusajs/framework/utils/portable"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

export const createTaxRatesStepId = "create-tax-rates"
/**
 * This step creates one or more tax rates.
 *
 * @example
 * const data = createTaxRatesStep([
 *   {
 *     name: "Default",
 *     tax_region_id: "txreg_123",
 *   }
 * ])
 */
export const createTaxRatesStep = createStep(
  { name: createTaxRatesStepId, compensation: "transactionCovered" },
  async (data: CreateTaxRateDTO[], { container }) => {
    const service = container.resolve<ITaxModuleService>(Modules.TAX)

    const created = await service.createTaxRates(data)

    return new StepResponse(
      created,
      created.map((rate) => rate.id)
    )
  },
  async (createdIds, { container }) => {
    if (!createdIds?.length) {
      return
    }

    const service = container.resolve<ITaxModuleService>(Modules.TAX)

    await service.deleteTaxRates(createdIds)
  }
)
