import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  Modules,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils"

import { refetchInventoryItem } from "./helpers"
import { HttpTypes } from "@medusajs/framework/types"

const createInventoryItemsWorkflowId = "create-inventory-items-workflow"

export const POST = async (
  req: AuthenticatedMedusaRequest<
    HttpTypes.AdminCreateInventoryItem,
    HttpTypes.SelectParams
  >,
  res: MedusaResponse<HttpTypes.AdminInventoryItemResponse>
) => {
  const workflowEngine = req.scope.resolve(Modules.WORKFLOW_ENGINE)

  const { result } = await workflowEngine.run(createInventoryItemsWorkflowId, {
    input: { items: [req.validatedBody] },
  })

  const inventoryItem = await refetchInventoryItem(
    result[0].id,
    req.scope,
    req.queryConfig.fields
  )

  res.status(200).json({ inventory_item: inventoryItem })
}

export const GET = async (
  req: AuthenticatedMedusaRequest<HttpTypes.AdminInventoryItemsParams>,
  res: MedusaResponse<HttpTypes.AdminInventoryItemListResponse>
) => {
  const remoteQuery = req.scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY)

  const query = remoteQueryObjectFromString({
    entryPoint: "inventory_items",
    variables: {
      filters: req.filterableFields,
      ...req.queryConfig.pagination,
    },
    fields: req.queryConfig.fields,
  })

  const { rows: inventory_items, metadata } = await remoteQuery({
    ...query,
  })

  res.status(200).json({
    inventory_items,
    count: metadata.count,
    offset: metadata.skip,
    limit: metadata.take,
  })
}
