import type {
  IProductModuleService,
  ProductTypes,
} from "@medusajs/types"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

export const createProductsStepId = "create-products"
/**
 * This step creates one or more products.
 *
 * @example
 * const data = createProductsStep([{
 *   title: "Shirt",
 *   options: [
 *     {
 *       title: "Size",
 *       values: ["S", "M", "L"]
 *     }
 *   ],
 *   variants: [
 *     {
 *       title: "Small Shirt",
 *       options: {
 *         Size: "S"
 *       }
 *     }
 *   ]
 * }])
 */
export const createProductsStep = createStep(
  { name: createProductsStepId, compensation: "transactionCovered" },
  async (data: ProductTypes.CreateProductDTO[], { container }) => {
    const service = container.resolve<IProductModuleService>(Modules.PRODUCT)

    const created = await service.createProducts(data)
    return new StepResponse(
      created,
      created.map((product) => product.id)
    )
  },
  async (createdIds, { container }) => {
    if (!createdIds?.length) {
      return
    }

    const service = container.resolve<IProductModuleService>(Modules.PRODUCT)

    await service.deleteProducts(createdIds)
  }
)
