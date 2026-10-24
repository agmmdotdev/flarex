import type {
  CreateTaxRegionDTO,
  ITaxModuleService,
} from "@medusajs/types/tax/index"
import { Modules } from "@medusajs/framework/utils/portable"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

export const createTaxRegionsStepId = "create-tax-regions"
/**
 * This step creates one or more tax regions.
 *
 * @example
 * const data = createTaxRegionsStep([
 *   {
 *     country_code: "us",
 *   }
 * ])
 */
export const createTaxRegionsStep = createStep(
  { name: createTaxRegionsStepId, compensation: "transactionCovered" },
  async (data: CreateTaxRegionDTO[], { container }) => {
    const service = container.resolve<ITaxModuleService>(Modules.TAX)

    const created = await service.createTaxRegions(data)

    return new StepResponse(
      created,
      created.map((region) => region.id)
    )
  },
  async (createdIds, { container }) => {
    if (!createdIds?.length) {
      return
    }

    const service = container.resolve<ITaxModuleService>(Modules.TAX)

    await service.deleteTaxRegions(createdIds)
  }
)
