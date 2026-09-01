import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
  refetchEntities,
  refetchEntity,
} from "@medusajs/framework/http"
import {
  HttpTypes,
  PaginatedResponse,
  RefundReasonResponse,
  RefundReasonsResponse,
} from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

const createRefundReasonsWorkflowId = "create-refund-reasons-workflow"

export const GET = async (
  req: AuthenticatedMedusaRequest<HttpTypes.RefundReasonFilters>,
  res: MedusaResponse<PaginatedResponse<RefundReasonsResponse>>
) => {
  const { data: refund_reasons, metadata } = await refetchEntities({
    entity: "refund_reasons",
    idOrFilter: req.filterableFields,
    scope: req.scope,
    fields: req.queryConfig.fields,
    pagination: req.queryConfig.pagination,
  })

  res.json({
    refund_reasons,
    count: metadata.count,
    offset: metadata.skip,
    limit: metadata.take,
  })
}

export const POST = async (
  req: AuthenticatedMedusaRequest<
    HttpTypes.AdminCreateRefundReason,
    HttpTypes.AdminRefundReasonParams
  >,
  res: MedusaResponse<RefundReasonResponse>
) => {
  const workflowEngine = req.scope.resolve(Modules.WORKFLOW_ENGINE)
  const {
    result: [refundReason],
  } = await workflowEngine.run(createRefundReasonsWorkflowId, {
    input: { data: [req.validatedBody] },
  })

  const refund_reason = await refetchEntity({
    entity: "refund_reason",
    idOrFilter: refundReason.id,
    scope: req.scope,
    fields: req.queryConfig.fields,
  })

  res.status(200).json({ refund_reason })
}
