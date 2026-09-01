import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { HttpTypes } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { refetchSalesChannel } from "../../helpers"

const linkProductsToSalesChannelWorkflowId = "link-products-to-sales-channel"

export const POST = async (
  req: AuthenticatedMedusaRequest<
    HttpTypes.AdminBatchLink,
    HttpTypes.SelectParams
  >,
  res: MedusaResponse<HttpTypes.AdminSalesChannelResponse>
) => {
  const { id } = req.params
  const { add, remove } = req.validatedBody
  const workflowEngine = req.scope.resolve(Modules.WORKFLOW_ENGINE)

  await workflowEngine.run(linkProductsToSalesChannelWorkflowId, {
    input: {
      id,
      add,
      remove,
    },
  })

  const salesChannel = await refetchSalesChannel(
    req.params.id,
    req.scope,
    req.queryConfig.fields
  )
  res.status(200).json({ sales_channel: salesChannel })
}
