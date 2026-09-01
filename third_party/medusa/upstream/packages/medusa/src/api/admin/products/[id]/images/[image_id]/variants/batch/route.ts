import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { HttpTypes } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

const batchImageVariantsWorkflowId = "batch-image-variants"

/**
 * @since 2.11.2
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<HttpTypes.AdminBatchImageVariantRequest>,
  res: MedusaResponse<HttpTypes.AdminBatchImageVariantResponse>
) => {
  const imageId = req.params.image_id

  const workflowEngine = req.scope.resolve(Modules.WORKFLOW_ENGINE)

  const { result } = await workflowEngine.run(batchImageVariantsWorkflowId, {
    input: {
      image_id: imageId,
      add: req.validatedBody.add,
      remove: req.validatedBody.remove,
    },
  })

  res.status(200).json({
    added: result.added,
    removed: result.removed,
  })
}
