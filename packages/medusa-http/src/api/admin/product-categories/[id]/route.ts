import type { z } from "@medusajs/framework/zod"
import type { AdminUpdateProductCategory } from "../validators"
import type { ProductTypes } from "@medusajs/framework/types"
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
  refetchEntities,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/utils/common/errors"
import { Modules } from "@medusajs/utils/modules-sdk/definition"

const updateProductCategoriesWorkflowId = "update-product-categories"
const deleteProductCategoriesWorkflowId = "delete-product-categories"

export const GET = async (
  req: AuthenticatedMedusaRequest<
    unknown
  >,
  res: MedusaResponse<CategoryResponse>
) => {
  const {
    data: [category],
  } = await refetchEntities<ProductTypes.ProductCategoryDTO>({
    entity: "product_category",
    idOrFilter: { id: req.params.id, ...req.filterableFields },
    scope: req.scope,
    fields: req.queryConfig.fields,
    pagination: req.queryConfig.pagination,
  })

  if (!category) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Product category with id: ${req.params.id} was not found`
    )
  }

  res.json({ product_category: category })
}

export const POST = async (
  req: AuthenticatedMedusaRequest<
    AdminUpdateProductCategoryBody,
    Record<string, unknown>
  >,
  res: MedusaResponse<CategoryResponse>
) => {
  const { id } = req.params

  const workflowEngine = req.scope.resolve<CategoryWorkflowEngine>(Modules.WORKFLOW_ENGINE)

  await workflowEngine.run(updateProductCategoriesWorkflowId, {
    input: { selector: { id }, update: req.validatedBody },
  })

  const {
    data: [category],
  } = await refetchEntities<ProductTypes.ProductCategoryDTO>({
    entity: "product_category",
    idOrFilter: { id, ...req.filterableFields },
    scope: req.scope,
    fields: req.queryConfig.fields,
    pagination: req.queryConfig.pagination,
  })

  res.status(200).json({ product_category: category })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse<{ id: string; object: "product_category"; deleted: true }>
) => {
  const id = req.params.id
  const workflowEngine = req.scope.resolve<CategoryWorkflowEngine>(Modules.WORKFLOW_ENGINE)

  await workflowEngine.run(deleteProductCategoriesWorkflowId, {
    input: [id],
  })

  res.status(200).json({
    id,
    object: "product_category",
    deleted: true,
  })
}

type CategoryResponse = { product_category: ProductTypes.ProductCategoryDTO | undefined }

type AdminUpdateProductCategoryBody = z.infer<ReturnType<typeof AdminUpdateProductCategory>>
type CategoryWorkflowEngine = {
  run(id: typeof updateProductCategoriesWorkflowId, options: { input: { selector: { id: string }; update: AdminUpdateProductCategoryBody } }): Promise<unknown>
  run(id: typeof deleteProductCategoriesWorkflowId, options: { input: string[] }): Promise<unknown>
}
