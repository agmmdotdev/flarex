import type { IProductModuleService } from "@medusajs/types"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

/**
 * The IDs of the product categories to delete.
 */
export type DeleteProductCategoriesStepInput = string[]

export const deleteProductCategoriesStepId = "delete-product-categories"
/**
 * This step deletes one or more product categories.
 */
export const deleteProductCategoriesStep = createStep(
  { name: deleteProductCategoriesStepId, compensation: "transactionCovered" },
  async (ids: DeleteProductCategoriesStepInput, { container }) => {
    const service = container.resolve<IProductModuleService>(Modules.PRODUCT)

    await service.softDeleteProductCategories(ids)
    return new StepResponse(void 0, ids)
  },
  async (prevIds, { container }) => {
    if (!prevIds?.length) {
      return
    }

    const service = container.resolve<IProductModuleService>(Modules.PRODUCT)

    await service.restoreProductCategories(prevIds)
  }
)
