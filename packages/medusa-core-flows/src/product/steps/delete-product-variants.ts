import type { IProductModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils/portable"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

/**
 * The IDs of the product variants to delete.
 */
export type DeleteProductVariantsStepInput = string[]

export const deleteProductVariantsStepId = "delete-product-variants"
/**
 * This step deletes one or more product variants.
 */
export const deleteProductVariantsStep = createStep(
  { name: deleteProductVariantsStepId, compensation: "transactionCovered" },
  async (ids: DeleteProductVariantsStepInput, { container }) => {
    const service = container.resolve<IProductModuleService>(Modules.PRODUCT)

    await service.softDeleteProductVariants(ids)
    return new StepResponse(void 0, ids)
  },
  async (prevIds, { container }) => {
    if (!prevIds?.length) {
      return
    }

    const service = container.resolve<IProductModuleService>(Modules.PRODUCT)

    await service.restoreProductVariants(prevIds)
  }
)
