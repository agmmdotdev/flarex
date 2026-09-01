import { HttpTypes } from "@medusajs/framework/types"

import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

const deleteFulfillmentSetsWorkflowId = "delete-fulfillment-sets-workflow"

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse<HttpTypes.AdminFulfillmentSetDeleteResponse>
) => {
  const { id } = req.params

  const workflowEngine = req.scope.resolve(Modules.WORKFLOW_ENGINE)
  await workflowEngine.run(deleteFulfillmentSetsWorkflowId, {
    input: { ids: [id] },
  })

  res.status(200).json({
    id,
    object: "fulfillment_set",
    deleted: true,
  })
}
