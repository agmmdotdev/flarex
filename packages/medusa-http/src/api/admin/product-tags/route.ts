import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
  refetchEntities,
  refetchEntity,
} from "@medusajs/framework/http"

import type { ProductTypes } from "@medusajs/framework/types"
import type { AdminCreateProductTagType } from "./validators"
import { Modules } from "@medusajs/utils/modules-sdk/definition"

const createProductTagsWorkflowId = "create-product-tags"

type CreateProductTagsWorkflowEngine = {
  run(id: typeof createProductTagsWorkflowId, options: { input: { product_tags: AdminCreateProductTagType[] } }): Promise<{ result: { id: string }[] }>
}

export const GET = async (
  req: AuthenticatedMedusaRequest<unknown>,
  res: MedusaResponse<{ product_tags: ProductTypes.ProductTagDTO[]; count?: number; offset?: number; limit?: number }>
) => {
  const { data: product_tags, metadata } = await refetchEntities<ProductTypes.ProductTagDTO>({
    entity: "product_tag",
    idOrFilter: req.filterableFields,
    scope: req.scope,
    fields: req.queryConfig.fields,
    pagination: req.queryConfig.pagination,
  })

  res.json({
    product_tags: product_tags,
    count: metadata.count,
    offset: metadata.skip,
    limit: metadata.take,
  })
}

export const POST = async (
  req: AuthenticatedMedusaRequest<
    AdminCreateProductTagType,
    Record<string, unknown>
  >,
  res: MedusaResponse<{ product_tag: ProductTypes.ProductTagDTO | undefined }>
) => {
  const input = [req.validatedBody]

  const workflowEngine = req.scope.resolve<CreateProductTagsWorkflowEngine>(Modules.WORKFLOW_ENGINE)
  const { result } = await workflowEngine.run(createProductTagsWorkflowId, {
    input: { product_tags: input },
  })

  const productTag = await refetchEntity<ProductTypes.ProductTagDTO>({
    entity: "product_tag",
    idOrFilter: result[0].id,
    scope: req.scope,
    fields: req.queryConfig.fields,
  })

  res.status(200).json({ product_tag: productTag })
}
