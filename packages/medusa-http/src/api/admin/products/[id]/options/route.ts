import {
  type AuthenticatedMedusaRequest,
  type MedusaResponse,
  refetchEntities,
  refetchEntity,
} from "@medusajs/framework/http"
import type { ProductTypes } from "@medusajs/framework/types"
import { remapKeysForProduct, remapProductResponse } from "../../helpers"
import type { AdminCreateProductOptionBody } from "../../validators"
import { Modules } from "@medusajs/utils/modules-sdk/definition"

const createProductOptionsWorkflowId = "create-product-options"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse<{ product_options: ProductTypes.ProductOptionDTO[]; count?: number; offset?: number; limit?: number }>
) => {
  const productId = req.params.id
  const { data: product_options, metadata } = await refetchEntities<ProductTypes.ProductOptionDTO>({
    entity: "product_option",
    idOrFilter: { ...req.filterableFields, product_id: productId },
    scope: req.scope,
    fields: req.queryConfig.fields,
    pagination: req.queryConfig.pagination,
  })

  res.json({
    product_options,
    count: metadata.count,
    offset: metadata.skip,
    limit: metadata.take,
  })
}

type CreateProductOptionsWorkflowEngine = {
  run(id: typeof createProductOptionsWorkflowId, options: {
    input: {
      product_options: (Omit<AdminCreateProductOptionBody, "additional_data"> & { product_id: string })[]
      additional_data?: AdminCreateProductOptionBody["additional_data"]
    }
  }): Promise<unknown>
}

export const POST = async (
  req: AuthenticatedMedusaRequest<AdminCreateProductOptionBody>,
  res: MedusaResponse<{ product: ReturnType<typeof remapProductResponse> }>
) => {
  const productId = req.params.id
  const { additional_data, ...rest } = req.validatedBody
  const workflowEngine = req.scope.resolve<CreateProductOptionsWorkflowEngine>(Modules.WORKFLOW_ENGINE)

  await workflowEngine.run(createProductOptionsWorkflowId, {
    input: {
      product_options: [
        {
          ...rest,
          product_id: productId,
        },
      ],
      additional_data,
    },
  })

  const product = await refetchEntity<ProductTypes.ProductDTO>({
    entity: "product",
    idOrFilter: productId,
    scope: req.scope,
    fields: remapKeysForProduct(req.queryConfig.fields ?? []),
  })
  if (!product) throw new Error("Created Product option parent was not returned by native refetch")
  res.status(200).json({ product: remapProductResponse(product) })
}
