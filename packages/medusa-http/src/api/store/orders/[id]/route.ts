import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HttpTypes } from "@medusajs/framework/types"

// TODO: Do we want to apply some sort of authentication here? My suggestion is that we do
export const GET = async (
  req: MedusaRequest<HttpTypes.SelectParams>,
  res: MedusaResponse<unknown>
) => {
  const workflow = req.scope.resolve<{ run(id: string, options: { input: unknown }): Promise<{ result: unknown }> }>(Modules.WORKFLOW_ENGINE)
  const { result } = await workflow.run("get-order-detail", {
    input: {
      fields: req.queryConfig.fields,
      order_id: req.params.id,
      filters: {
        is_draft_order: false,
      },
    },
  })

  res.status(200).json({ order: result })
}
