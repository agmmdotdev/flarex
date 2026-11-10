import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import type { AdminBatchImageVariantType } from "../../../../../validators"

const batchImageVariantsWorkflowId = "batch-image-variants"

type BatchImageVariantsWorkflowEngine = {
  run(id: typeof batchImageVariantsWorkflowId, options: {
    input: AdminBatchImageVariantType & { image_id: string; product_id: string }
  }): Promise<{ result: { added: string[]; removed: string[] } }>
}

/** @since 2.11.2 */
export const POST = async (
  req: AuthenticatedMedusaRequest<AdminBatchImageVariantType>,
  res: MedusaResponse<{ added: string[]; removed: string[] }>
) => {
  const imageId = req.params.image_id

  const workflowEngine = req.scope.resolve<BatchImageVariantsWorkflowEngine>(Modules.WORKFLOW_ENGINE)

  const { result } = await workflowEngine.run(batchImageVariantsWorkflowId, {
    input: {
      image_id: imageId,
      product_id: req.params.id,
      add: req.validatedBody.add,
      remove: req.validatedBody.remove,
    },
  })

  res.status(200).json({
    added: result.added,
    removed: result.removed,
  })
}
