import type { CreateProductVariantWorkflowInputDTO, UpdateProductVariantWorkflowInputDTO } from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils/portable"
import { createStep, StepResponse } from "@medusajs/workflows-sdk"

export interface ProductVariantBatchParentInput {
  product_id?: string
  create: CreateProductVariantWorkflowInputDTO[]
  update: (UpdateProductVariantWorkflowInputDTO & { product_id?: string })[]
  delete: string[]
}
type ProductVariantParentService = {
  listProductVariants(selector: { id: string[] }, config: { select: string[]; relations: string[] }): Promise<{ id: string; product_id: string }[]>
}

/** Check every existing mutation target before any batch child runs. Missing
 * deletion IDs retain native no-op behavior; update owns its missing-ID error. */
export const validateProductVariantBatchParentStep = createStep("validate-product-variant-batch-parent",
  async (input: ProductVariantBatchParentInput, { container }) => {
    if (input.product_id !== undefined) {
      const ids = [...new Set([...input.update.flatMap(row => row.id === undefined ? [] : [row.id]), ...input.delete])]
      if (ids.length) {
        const product = container.resolve<ProductVariantParentService>(Modules.PRODUCT)
        const variants = await product.listProductVariants({ id: ids }, { select: ["id", "product_id"], relations: [] })
        if (new Set(variants.map(row => row.id)).size !== variants.length ||
          variants.some(row => !ids.includes(row.id) || row.product_id !== input.product_id)) {
          throw new MedusaError(MedusaError.Types.NOT_FOUND, `Could not find all Product Variants for Product ${input.product_id}`)
        }
      }
    }
    return new StepResponse(input)
  }
)
