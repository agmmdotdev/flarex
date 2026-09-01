import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { refetchBatchProducts, remapProductResponse } from "../helpers"
import { HttpTypes } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

const batchProductsWorkflowId = "batch-products"

export const POST = async (
  req: AuthenticatedMedusaRequest<
    HttpTypes.AdminBatchProductRequest,
    HttpTypes.SelectParams
  >,
  res: MedusaResponse<HttpTypes.AdminBatchProductResponse>
) => {
  const workflowEngine = req.scope.resolve(Modules.WORKFLOW_ENGINE)

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
