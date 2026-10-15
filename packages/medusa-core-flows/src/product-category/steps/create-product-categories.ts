import type {
  ProductTypes,
  IProductModuleService,
} from "@medusajs/types"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

/**
 * The data to create product categories.
 */
export type CreateProductCategoriesStepInput = {
  /**
   * The product categories to create.
   */
  product_categories: ProductTypes.CreateProductCategoryDTO[]
}

export const createProductCategoriesStepId = "create-product-categories"
/**
 * This step creates one or more product categories.
 * 
 * @example
 * const data = createProductCategoriesStep({
 *   product_categories: [
 *     {
 *       name: "Shoes",
 *     }
 *   ]
 * })
 */
export const createProductCategoriesStep = createStep(
  { name: createProductCategoriesStepId, compensation: "transactionCovered" },
  async (data: CreateProductCategoriesStepInput, { container }) => {
    const service = container.resolve<IProductModuleService>(Modules.PRODUCT)

    const created = await service.createProductCategories(
      data.product_categories
    )

    return new StepResponse(
      created,
      created.map((c) => c.id)
    )
  },
  async (createdIds, { container }) => {
    if (!createdIds?.length) {
      return
    }

    const service = container.resolve<IProductModuleService>(Modules.PRODUCT)

    await service.deleteProductCategories(createdIds)
  }
)
