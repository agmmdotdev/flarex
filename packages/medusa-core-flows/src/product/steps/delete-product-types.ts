import type { IProductModuleService } from "@medusajs/types"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

/**
 * The IDs of the product types to delete.
 */
export type DeleteProductTypesStepInput = string[]

export const deleteProductTypesStepId = "delete-product-types"
/**
 * This step deletes one or more product types.
 */
export const deleteProductTypesStep = createStep(
  { name: deleteProductTypesStepId, compensation: "transactionCovered" },
  async (ids: DeleteProductTypesStepInput, { container }) => {
    const service = container.resolve<IProductModuleService>(Modules.PRODUCT)

    await service.softDeleteProductTypes(ids)
    return new StepResponse(void 0, ids)
  },
  async (prevIds, { container }) => {
    if (!prevIds?.length) {
      return
    }

    const service = container.resolve<IProductModuleService>(Modules.PRODUCT)

    await service.restoreProductTypes(prevIds)
  }
)
