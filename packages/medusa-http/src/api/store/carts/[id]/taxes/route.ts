import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { HttpTypes } from "@medusajs/framework/types"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { refetchCart } from "../../helpers"

const updateTaxLinesWorkflowId = "update-tax-lines"

export const POST = async (
  req: MedusaRequest<{}, HttpTypes.SelectParams>,
  res: MedusaResponse<unknown>
) => {
  const we = req.scope.resolve<{ run(id: string, options: { input: unknown }): Promise<unknown> }>(Modules.WORKFLOW_ENGINE)
  await we.run(updateTaxLinesWorkflowId, {
    input: {
      cart_id: req.params.id,
      force_tax_calculation: true,
    },
  })

  const cart = await refetchCart(
    req.params.id,
    req.scope,
    req.queryConfig.fields
  )

  res.status(200).json({ cart })
}
