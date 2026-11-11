import type { AdminBatchProductVariantsBody } from "../../../validators"
import {
  type AuthenticatedMedusaRequest,
  type MedusaResponse,
} from "@medusajs/framework/http"
import { refetchBatchVariants, remapVariantResponse } from "../../../helpers"
import type { BatchWorkflowOutput, ProductTypes } from "@medusajs/framework/types"
import { Modules } from "@medusajs/utils/modules-sdk/definition"

type BatchWorkflowEngine = {
  run(id: "batch-product-variants", options: { input: AdminBatchProductVariantsBody & { product_id: string } }): Promise<{ result: BatchWorkflowOutput<ProductTypes.ProductVariantDTO> }>
}

const batchProductVariantsWorkflowId = "batch-product-variants"

export const POST = async (
  req: AuthenticatedMedusaRequest<
    AdminBatchProductVariantsBody
  >,
  res: MedusaResponse<{ created: ProductTypes.ProductVariantDTO[]; updated: ProductTypes.ProductVariantDTO[]; deleted: { ids: string[]; object: string; deleted: boolean } }>
) => {
  const productId = req.params.id

  const normalizedInput = {
    product_id: productId,
    create: req.validatedBody.create?.map((c) => ({
      ...c,
      product_id: productId,
    })),
    update: req.validatedBody.update?.map((u) => ({
      ...u,
      product_id: productId,
    })),
    delete: req.validatedBody.delete,
  }

  const workflowEngine = req.scope.resolve<BatchWorkflowEngine>(Modules.WORKFLOW_ENGINE)

  const { result } = await workflowEngine.run(batchProductVariantsWorkflowId, {
    input: normalizedInput,
  })

  const batchResults = await refetchBatchVariants(
    result,
    req.scope,
    req.queryConfig.fields
  )

  res.status(200).json({
    created: batchResults.created.map<ProductTypes.ProductVariantDTO>(remapVariantResponse),
    updated: batchResults.updated.map<ProductTypes.ProductVariantDTO>(remapVariantResponse),
    deleted: batchResults.deleted,
  })
}
