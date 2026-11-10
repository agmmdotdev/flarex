import type { z } from "@medusajs/framework/zod"
import type { createLinkBody } from "../../../../utils/validators"
import type { ProductTypes } from "@medusajs/framework/types"
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
  refetchEntity,
} from "@medusajs/framework/http"
import { Modules } from "@medusajs/utils/modules-sdk/definition"

const batchLinkProductsToCategoryWorkflowId =
  "batch-link-products-to-category"

export const POST = async (
  req: AuthenticatedMedusaRequest<
    AdminBatchLink,
    Record<string, unknown>
  >,
  res: MedusaResponse<CategoryResponse>
) => {
  const { id } = req.params
  const workflowEngine = req.scope.resolve<CategoryWorkflowEngine>(Modules.WORKFLOW_ENGINE)

  await workflowEngine.run(batchLinkProductsToCategoryWorkflowId, {
    input: { id, ...req.validatedBody },
  })

  const category = await refetchEntity<ProductTypes.ProductCategoryDTO>({
    entity: "product_category",
    idOrFilter: id,
    scope: req.scope,
    fields: req.queryConfig.fields,
  })

  res.status(200).json({ product_category: category })
}

type CategoryResponse = { product_category: ProductTypes.ProductCategoryDTO | undefined }

type AdminBatchLink = z.infer<ReturnType<typeof createLinkBody>>
type CategoryWorkflowEngine = {
  run(id: typeof batchLinkProductsToCategoryWorkflowId, options: { input: AdminBatchLink & { id: string } }): Promise<unknown>
}
