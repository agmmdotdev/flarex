import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { BatchMethodRequest, HttpTypes } from "@medusajs/framework/types"
import { refetchBatchRules } from "../../../helpers"
import { Modules } from "@medusajs/framework/utils"

const batchShippingOptionRulesWorkflowId = "batch-shipping-option-rules"

export const POST = async (
  req: AuthenticatedMedusaRequest<
    BatchMethodRequest<
      HttpTypes.AdminCreateShippingOptionRule,
      HttpTypes.AdminUpdateShippingOptionRule
    >,
    HttpTypes.SelectParams
  >,
  res: MedusaResponse<HttpTypes.AdminUpdateShippingOptionRulesResponse>
) => {
  const id = req.params.id
  const workflowEngine = req.scope.resolve(Modules.WORKFLOW_ENGINE)
  const { result } = await workflowEngine.run(batchShippingOptionRulesWorkflowId, {
    input: {
      create: req.validatedBody.create?.map((c) => ({
        ...c,
        shipping_option_id: id,
      })),
      update: req.validatedBody.update,
      delete: req.validatedBody.delete,
    },
  })

  const batchResults = await refetchBatchRules(
    result,
    req.scope,
    req.queryConfig.fields
  )

  res
    .status(200)
    .json(
      batchResults as unknown as HttpTypes.AdminUpdateShippingOptionRulesResponse
    )
}
