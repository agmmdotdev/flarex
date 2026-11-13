import { Modules } from "@medusajs/utils/modules-sdk/definition"
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

export const GET = async (
  req: AuthenticatedMedusaRequest<unknown>,
  res: MedusaResponse<unknown>
) => {
  const variables = {
    filters: {
      ...req.filterableFields,
      is_draft_order: false,
      customer_id: req.auth_context.actor_id,
    },
    ...req.queryConfig.pagination,
  }

  const workflow = req.scope.resolve<{ run(id: string, options: { input: unknown }): Promise<{ result: unknown }> }>(Modules.WORKFLOW_ENGINE)
  const { result } = await workflow.run("get-orders-list", {
    input: {
      fields: req.queryConfig.fields,
      variables,
    },
  })

  const { rows, metadata } = result as {
    rows: unknown[]
    metadata: { count: number; skip: number; take: number }
  }

  res.json({
    orders: rows,
    count: metadata.count,
    offset: metadata.skip,
    limit: metadata.take,
  })
}
