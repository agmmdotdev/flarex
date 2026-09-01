import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { refetchFulfillmentSet } from "../../helpers"
import { HttpTypes } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

const createServiceZonesWorkflowId = "create-service-zones-workflow"

export const POST = async (
  req: MedusaRequest<
    HttpTypes.AdminCreateFulfillmentSetServiceZone,
    HttpTypes.SelectParams
  >,
  res: MedusaResponse<HttpTypes.AdminFulfillmentSetResponse>
) => {
  const workflowInput = {
    data: [
      {
        fulfillment_set_id: req.params.id,
        name: req.validatedBody.name,
        geo_zones: req.validatedBody.geo_zones,
      },
    ],
  }

  const workflowEngine = req.scope.resolve(Modules.WORKFLOW_ENGINE)
  await workflowEngine.run(createServiceZonesWorkflowId, {
    input: workflowInput,
  })

  const fulfillmentSet = await refetchFulfillmentSet(
    req.params.id,
    req.scope,
    req.queryConfig.fields
  )

  res.status(200).json({ fulfillment_set: fulfillmentSet })
}
