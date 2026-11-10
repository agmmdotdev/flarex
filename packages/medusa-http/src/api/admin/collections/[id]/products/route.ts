import type { z } from "@medusajs/framework/zod"
import type { createLinkBody } from "../../../../utils/validators"
import type { ProductTypes } from "@medusajs/framework/types"
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { refetchCollection } from "../../helpers"

const batchLinkProductsToCollectionWorkflowId =
  "batch-link-products-collection"

export const POST = async (
  req: AuthenticatedMedusaRequest<
    AdminBatchLink,
    Record<string, unknown>
  >,
  res: MedusaResponse<CollectionResponse>
) => {
  const id = req.params.id
  const { add = [], remove = [] } = req.validatedBody
  const workflowEngine = req.scope.resolve<CollectionWorkflowEngine>(Modules.WORKFLOW_ENGINE)

  await workflowEngine.run(batchLinkProductsToCollectionWorkflowId, {
    input: {
      id,
      add,
      remove,
    },
  })

  const collection = await refetchCollection(
    req.params.id,
    req.scope,
    req.queryConfig.fields
  )

  res.status(200).json({
    collection,
  })
}

type CollectionResponse = { collection: ProductTypes.ProductCollectionDTO | undefined }

type AdminBatchLink = z.infer<ReturnType<typeof createLinkBody>>
type CollectionWorkflowEngine = {
  run(id: typeof batchLinkProductsToCollectionWorkflowId, options: { input: { id: string; add: string[]; remove: string[] } }): Promise<unknown>
}
