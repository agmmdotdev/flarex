import type { z } from "@medusajs/framework/zod"
import type { AdminCreateProductCategory } from "./validators"
import type { ProductTypes } from "@medusajs/framework/types"
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
  refetchEntities,
} from "@medusajs/framework/http"
import { Modules } from "@medusajs/utils/modules-sdk/definition"

const createProductCategoriesWorkflowId = "create-product-categories"

export const GET = async (
  req: AuthenticatedMedusaRequest<unknown>,
  res: MedusaResponse<{ product_categories: ProductTypes.ProductCategoryDTO[]; count?: number; offset?: number; limit?: number }>
) => {
  const { data: product_categories, metadata } = await refetchEntities<ProductTypes.ProductCategoryDTO>({
    entity: "product_category",
    idOrFilter: req.filterableFields,
    scope: req.scope,
    fields: req.queryConfig.fields,
    pagination: req.queryConfig.pagination,
  })

  res.json({
    product_categories,
    count: metadata.count,
    offset: metadata.skip,
    limit: metadata.take,
  })
}

export const POST = async (
  req: AuthenticatedMedusaRequest<
    AdminCreateProductCategoryBody,
    Record<string, unknown>
  >,
  res: MedusaResponse<CategoryResponse>
) => {
  const workflowEngine = req.scope.resolve<CategoryWorkflowEngine>(Modules.WORKFLOW_ENGINE)
  const { result } = await workflowEngine.run(
    createProductCategoriesWorkflowId,
    {
      input: { product_categories: [req.validatedBody] },
    }
  )

  const {
    data: [category],
  } = await refetchEntities<ProductTypes.ProductCategoryDTO>({
    entity: "product_category",
    idOrFilter: { id: result[0].id, ...req.filterableFields },
    scope: req.scope,
    fields: req.queryConfig.fields,
    pagination: req.queryConfig.pagination,
  })

  res.status(200).json({ product_category: category })
}

type CategoryResponse = { product_category: ProductTypes.ProductCategoryDTO | undefined }

type AdminCreateProductCategoryBody = z.infer<ReturnType<typeof AdminCreateProductCategory>>
type CategoryWorkflowEngine = {
  run(id: typeof createProductCategoriesWorkflowId, options: { input: { product_categories: AdminCreateProductCategoryBody[] } }): Promise<{ result: { id: string }[] }>
}
