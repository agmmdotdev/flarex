import { HttpTypes, RefundReasonResponse } from "@medusajs/framework/types"
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
  refetchEntity,
} from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

const updateRefundReasonsWorkflowId = "update-refund-reasons"
const deleteRefundReasonsWorkflowId = "delete-refund-reasons-workflow"

export const GET = async (
  req: AuthenticatedMedusaRequest<HttpTypes.AdminRefundReasonParams>,
  res: MedusaResponse<RefundReasonResponse>
) => {
  const refund_reason = await refetchEntity({
    entity: "refund_reason",
    idOrFilter: req.params.id,
    scope: req.scope,
    fields: req.queryConfig.fields,
  })

  res.json({ refund_reason })
}

export const POST = async (
  req: AuthenticatedMedusaRequest<
    HttpTypes.AdminUpdateRefundReason,
    HttpTypes.AdminRefundReasonParams
  >,
  res: MedusaResponse<RefundReasonResponse>
) => {
  const { id } = req.params
  const workflowEngine = req.scope.resolve(Modules.WORKFLOW_ENGINE)

  await workflowEngine.run(updateRefundReasonsWorkflowId, {
    input: [
      {
        ...req.validatedBody,
        id,
      },
    ],
  })

  const refund_reason = await refetchEntity({
    entity: "refund_reason",
    idOrFilter: req.params.id,
    scope: req.scope,
    fields: req.queryConfig.fields,
  })

  res.json({ refund_reason })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse<HttpTypes.AdminRefundReasonDeleteResponse>
) => {
  const { id } = req.params
  const input = { ids: [id] }
  const workflowEngine = req.scope.resolve(Modules.WORKFLOW_ENGINE)

  await workflowEngine.run(deleteRefundReasonsWorkflowId, { input })

  res.json({
    id,
    object: "refund_reason",
    deleted: true,
  })
}
