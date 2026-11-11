import type { AdminBatchProductsBody } from "../validators"
import {
  type AuthenticatedMedusaRequest,
  type MedusaResponse,
} from "@medusajs/framework/http"
import { refetchBatchProducts, remapProductResponse } from "../helpers"
import type { BatchWorkflowOutput, ProductTypes } from "@medusajs/framework/types"
import { Modules } from "@medusajs/utils/modules-sdk/definition"

type BatchWorkflowEngine = {
  run(id: "batch-products", options: { input: AdminBatchProductsBody }): Promise<{ result: BatchWorkflowOutput<ProductTypes.ProductDTO> }>
}

const batchProductsWorkflowId = "batch-products"

export const POST = async (
  req: AuthenticatedMedusaRequest<
    AdminBatchProductsBody
  >,
  res: MedusaResponse<{ created: ProductTypes.ProductDTO[]; updated: ProductTypes.ProductDTO[]; deleted: { ids: string[]; object: string; deleted: boolean } }>
) => {
  const workflowEngine = req.scope.resolve<BatchWorkflowEngine>(Modules.WORKFLOW_ENGINE)

  const { result } = await workflowEngine.run(batchProductsWorkflowId, {
    input: req.validatedBody,
  })

  const batchResults = await refetchBatchProducts(
    result,
    req.scope,
    req.queryConfig.fields
  )

  res.status(200).json({
    created: batchResults.created.map(remapProductResponse),
    updated: batchResults.updated.map(remapProductResponse),
    deleted: batchResults.deleted,
  })
}
