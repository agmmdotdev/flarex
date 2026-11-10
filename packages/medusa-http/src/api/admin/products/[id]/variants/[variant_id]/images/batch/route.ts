import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import type { AdminBatchVariantImagesType } from "../../../../../validators"

const batchVariantImagesWorkflowId = "batch-variant-images"

type BatchVariantImagesWorkflowEngine = {
  run(id: typeof batchVariantImagesWorkflowId, options: {
    input: AdminBatchVariantImagesType & { variant_id: string; product_id: string }
  }): Promise<{ result: { added: string[]; removed: string[] } }>
}

/** @since 2.11.2 */
export const POST = async (
  req: AuthenticatedMedusaRequest<AdminBatchVariantImagesType>,
  res: MedusaResponse<{ added: string[]; removed: string[] }>
) => {
  const variantId = req.params.variant_id

  const workflowEngine = req.scope.resolve<BatchVariantImagesWorkflowEngine>(Modules.WORKFLOW_ENGINE)

  const { result } = await workflowEngine.run(batchVariantImagesWorkflowId, {
    input: {
      variant_id: variantId,
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
