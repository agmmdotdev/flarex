import {
  ContainerRegistrationKeys,
  Modules,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { refetchInventoryItem } from "../../helpers"
import { HttpTypes } from "@medusajs/framework/types"

const createInventoryLevelsWorkflowId = "create-inventory-levels-workflow"

export const POST = async (
  req: MedusaRequest<
    HttpTypes.AdminBatchCreateInventoryItemLocationLevels,
    HttpTypes.SelectParams
  >,
  res: MedusaResponse<HttpTypes.AdminInventoryItemResponse>
) => {
  const { id } = req.params

  const workflowEngine = req.scope.resolve(Modules.WORKFLOW_ENGINE)
  await workflowEngine.run(createInventoryLevelsWorkflowId, {
    input: {
      inventory_levels: [
        {
          ...req.validatedBody,
          inventory_item_id: id,
        },
      ],
    },
  })

  const inventoryItem = await refetchInventoryItem(
    id,
    req.scope,
    req.queryConfig.fields
  )
  res.status(200).json({ inventory_item: inventoryItem })
}

export const GET = async (
  req: MedusaRequest<HttpTypes.AdminInventoryLevelFilters>,
  res: MedusaResponse<HttpTypes.AdminInventoryLevelListResponse>
) => {
  const { id } = req.params

  const remoteQuery = req.scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY)

  const query = remoteQueryObjectFromString({
    entryPoint: "inventory_levels",
    variables: {
      filters: { ...req.filterableFields, inventory_item_id: id },
      ...req.queryConfig.pagination,
    },
    fields: req.queryConfig.fields,
  })

  const { rows: inventory_levels, metadata } = await remoteQuery(query)

  res.status(200).json({
    inventory_levels,
    count: metadata.count,
    offset: metadata.skip,
    limit: metadata.take,
  })
}
