import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { StoreGetShippingOptionsType } from "./validators"
import { Modules } from "@medusajs/utils/modules-sdk/definition"

const listShippingOptionsForCartWorkflowId = "list-shipping-options-for-cart"

export const GET = async (
  req: MedusaRequest<{}, StoreGetShippingOptionsType>,
  res: MedusaResponse<unknown>
) => {
  const { cart_id, is_return } = req.filterableFields

  const workflowEngine = req.scope.resolve<{ run(id: string, options: { input: unknown }): Promise<{ result: unknown[] }> }>(Modules.WORKFLOW_ENGINE)
  const { result: shipping_options } = await workflowEngine.run(
    listShippingOptionsForCartWorkflowId,
    {
      input: {
        cart_id,
        is_return: !!is_return,
        fields: req.queryConfig.fields,
      },
    }
  )

  res.json({ shipping_options })
}
