import type { LinkDefinition } from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils/portable"
import { createStep, StepResponse } from "@medusajs/workflows-sdk"

export interface ProductVariantInventoryLinksInput {
  product_id: string
  links: LinkDefinition[]
}

export interface ProductVariantInventoryLinkBatchInput {
  product_id: string
  create: LinkDefinition[]
  update: LinkDefinition[]
  delete: LinkDefinition[]
}

type ProductInventoryLinkService = {
  listProductVariants(selector: { id: string[]; product_id: string }, config: {
    select: string[]; relations: string[]
  }): Promise<{ id: string; product_id: string }[]>
}

/** Product owns URL-parent authorization. The native query runs in the same
 * borrowed root as every Link arm, retaining the selected rows' OCC dependency. */
export const validateProductVariantInventoryLinksStep = createStep(
  "validate-product-variant-inventory-links",
  async (input: ProductVariantInventoryLinksInput, { container }) => {
    const ids = [...new Set(input.links.map(link => link[Modules.PRODUCT]?.variant_id))]
    if (ids.some(id => typeof id !== "string")) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Product Variant ID is required")
    }
    if (ids.length) {
      const product = container.resolve<ProductInventoryLinkService>(Modules.PRODUCT)
      const variants = await product.listProductVariants({ id: ids, product_id: input.product_id }, {
        select: ["id", "product_id"], relations: [],
      })
      if (variants.length !== ids.length || new Set(variants.map(row => row.id)).size !== ids.length ||
        variants.some(row => !ids.includes(row.id) || row.product_id !== input.product_id)) {
        throw new MedusaError(MedusaError.Types.NOT_FOUND,
          `Could not find all Product Variants for Product ${input.product_id}`)
      }
    }
    return new StepResponse(input)
  }
)
