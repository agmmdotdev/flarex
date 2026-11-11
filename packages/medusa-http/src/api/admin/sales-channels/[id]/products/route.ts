import {
  type AuthenticatedMedusaRequest,
  type MedusaResponse,
} from "@medusajs/framework/http"

import type { LinkWorkflowInput, SalesChannelDTO } from "@medusajs/framework/types"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { refetchSalesChannel } from "../../helpers"

type SalesChannelWorkflowEngine = {
  run(id: "link-products-to-sales-channel", options: { input: LinkWorkflowInput }): Promise<unknown>
}

const linkProductsToSalesChannelWorkflowId = "link-products-to-sales-channel"

export const POST = async (
  req: AuthenticatedMedusaRequest<
    Omit<LinkWorkflowInput, "id">
  >,
  res: MedusaResponse<{ sales_channel: SalesChannelDTO | undefined }>
) => {
  const { id } = req.params
  const { add, remove } = req.validatedBody
  const workflowEngine = req.scope.resolve<SalesChannelWorkflowEngine>(Modules.WORKFLOW_ENGINE)

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
