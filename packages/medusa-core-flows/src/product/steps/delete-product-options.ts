import type { IProductModuleService } from "@medusajs/types"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

/**
 * The IDs of the product options to delete.
 */
export type DeleteProductOptionsStepInput = string[] | { id: string[]; product_id: string }

export const deleteProductOptionsStepId = "delete-product-options"
/**
 * This step deletes one or more product options.
 */
export const deleteProductOptionsStep = createStep(
  { name: deleteProductOptionsStepId, compensation: "transactionCovered" },
  async (input: DeleteProductOptionsStepInput, { container }) => {
    const service = container.resolve<IProductModuleService>(Modules.PRODUCT)

    const ids = Array.isArray(input) ? input : input.id
    if (Array.isArray(input)) {
      await service.softDeleteProductOptions(input)
    } else {
      await service.softDeleteProductOptions(input)
    }
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
