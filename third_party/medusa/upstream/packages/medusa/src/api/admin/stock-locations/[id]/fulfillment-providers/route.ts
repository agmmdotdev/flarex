import { HttpTypes } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { refetchStockLocation } from "../../helpers"

type StockLocationFulfillmentProviderLink = {
  [Modules.STOCK_LOCATION]: { stock_location_id: string }
  [Modules.FULFILLMENT]: { fulfillment_provider_id: string }
}

const batchLinksWorkflowId = "batch-links"

const buildLinks = (
  id: string,
  fulfillmentProviderIds: string[]
): StockLocationFulfillmentProviderLink[] => {
  return fulfillmentProviderIds.map((fulfillmentProviderId) => ({
    [Modules.STOCK_LOCATION]: { stock_location_id: id },
    [Modules.FULFILLMENT]: {
      fulfillment_provider_id: fulfillmentProviderId,
    },
  }))
}

export const POST = async (
  req: AuthenticatedMedusaRequest<
    HttpTypes.AdminBatchLink,
    HttpTypes.SelectParams
  >,
  res: MedusaResponse<HttpTypes.AdminStockLocationResponse>
) => {
  const { id } = req.params
  const { add = [], remove = [] } = req.validatedBody
  const workflowEngine = req.scope.resolve(Modules.WORKFLOW_ENGINE)

  await workflowEngine.run(batchLinksWorkflowId, {
    input: {
      create: buildLinks(id, add),
      delete: buildLinks(id, remove),
    },
  })

  const stockLocation = await refetchStockLocation(
    req.params.id,
    req.scope,
    req.queryConfig.fields
  )

  res.status(200).json({ stock_location: stockLocation })
}
