import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { HttpTypes } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

const batchVariantImagesWorkflowId = "batch-variant-images"

/**
 * @since 2.11.2
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<HttpTypes.AdminBatchVariantImagesRequest>,
  res: MedusaResponse<HttpTypes.AdminBatchVariantImagesResponse>
) => {
  const variantId = req.params.variant_id

  const workflowEngine = req.scope.resolve(Modules.WORKFLOW_ENGINE)

  const { result } = await workflowEngine.run(batchVariantImagesWorkflowId, {
    input: {
      variant_id: variantId,
      add: req.validatedBody.add,
      remove: req.validatedBody.remove,
    },
  })

  res.status(200).json({
    added: result.added,
    removed: result.removed,
  })
}
