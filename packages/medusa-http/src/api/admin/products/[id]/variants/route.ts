import type { ProductTypes } from "@medusajs/framework/types"
import type { z } from "@medusajs/framework/zod"
import type { AdminCreateProductVariant } from "../../validators"
import {
  type AuthenticatedMedusaRequest,
  type MedusaResponse,
} from "@medusajs/framework/http"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { wrapVariantsWithTotalInventoryQuantity } from "../../../../utils/middlewares/products/variant-inventory-quantity"
import { refetchEntities, refetchEntity } from "@medusajs/framework/http"
import {
  remapKeysForProduct,
  remapKeysForVariant,
  remapProductResponse,
  remapVariantResponse,
} from "../../helpers"

const createProductVariantsWorkflowId = "create-product-variants"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse<{ variants: ProductTypes.ProductVariantDTO[]; count?: number; offset?: number; limit?: number }>
) => {
  const productId = req.params.id

  const withInventoryQuantity = req.queryConfig.fields.some((field) =>
    field.includes("inventory_quantity")
  )

  if (withInventoryQuantity) {
    req.queryConfig.fields = req.queryConfig.fields.filter(
      (field) => !field.includes("inventory_quantity")
    )
  }

  const { data: variants, metadata } = await refetchEntities<ProductTypes.ProductVariantDTO>({
    entity: "variant",
    idOrFilter: { ...req.filterableFields, product_id: productId },
    scope: req.scope,
    fields: remapKeysForVariant(req.queryConfig.fields ?? []),
    pagination: req.queryConfig.pagination,
  })

  if (withInventoryQuantity) {
    await wrapVariantsWithTotalInventoryQuantity(req, variants || [])
  }

  res.json({
    variants: variants.map<ProductTypes.ProductVariantDTO>(remapVariantResponse),
    count: metadata.count,
    offset: metadata.skip,
    limit: metadata.take,
  })
}

type VariantBody = z.infer<ReturnType<typeof AdminCreateProductVariant>>
type CreateProductVariantsWorkflowEngine = {
  run(id: typeof createProductVariantsWorkflowId, options: {
    input: { product_variants: (Omit<VariantBody, "additional_data"> & { product_id: string })[]; additional_data?: VariantBody["additional_data"] }
  }): Promise<unknown>
}

export const POST = async (
  req: AuthenticatedMedusaRequest<z.infer<ReturnType<typeof AdminCreateProductVariant>>>,
  res: MedusaResponse<{ product: ReturnType<typeof remapProductResponse> }>
) => {
  const productId = req.params.id
  const { additional_data, ...rest } = req.validatedBody

  const input = [
    {
      ...rest,
      product_id: productId,
    },
  ]

  const workflowEngine = req.scope.resolve<CreateProductVariantsWorkflowEngine>(Modules.WORKFLOW_ENGINE)

  await workflowEngine.run(createProductVariantsWorkflowId, {
    input: { product_variants: input, additional_data },
  })

  const product = await refetchEntity<ProductTypes.ProductDTO>({
    entity: "product",
    idOrFilter: productId,
    scope: req.scope,
    fields: remapKeysForProduct(req.queryConfig.fields ?? []),
  })

  if (!product) throw new Error("Created Product variants parent was not returned by native refetch")
  res.status(200).json({ product: remapProductResponse(product) })
}
