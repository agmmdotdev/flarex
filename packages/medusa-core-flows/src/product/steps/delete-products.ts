import type { IProductModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils/portable"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

/**
 * The IDs of the products to delete.
 */
export type DeleteProductsStepInput = string[]

export const deleteProductsStepId = "delete-products"
/**
 * This step deletes one or more products.
 */
export const deleteProductsStep = createStep(
  { name: deleteProductsStepId, compensation: "transactionCovered" },
  async (ids: DeleteProductsStepInput, { container }) => {
    const service = container.resolve<IProductModuleService>(Modules.PRODUCT)

    await service.softDeleteProducts(ids)
    return new StepResponse(void 0, ids)
  },
  async (prevIds, { container }) => {
    if (!prevIds?.length) {
      return
    }

    const service = container.resolve<IProductModuleService>(Modules.PRODUCT)

    await service.restoreProducts(prevIds)
  }
)
