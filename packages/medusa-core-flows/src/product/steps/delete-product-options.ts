import type { IProductModuleService } from "@medusajs/types"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

/**
 * The IDs of the product options to delete.
 */
export type DeleteProductOptionsStepInput = string[]

export const deleteProductOptionsStepId = "delete-product-options"
/**
 * This step deletes one or more product options.
 */
export const deleteProductOptionsStep = createStep(
  { name: deleteProductOptionsStepId, compensation: "transactionCovered" },
  async (ids: DeleteProductOptionsStepInput, { container }) => {
    const service = container.resolve<IProductModuleService>(Modules.PRODUCT)

    await service.softDeleteProductOptions(ids)
    return new StepResponse(void 0, ids)
  },
  async (prevIds, { container }) => {
    if (!prevIds?.length) {
      return
    }

    const service = container.resolve<IProductModuleService>(Modules.PRODUCT)

    await service.restoreProductOptions(prevIds)
  }
)
