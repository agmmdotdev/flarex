import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HttpTypes } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

const listShippingOptionsForCartWorkflowId = "list-shipping-options-for-cart"

export const GET = async (
  req: MedusaRequest<{}, HttpTypes.StoreGetShippingOptionList>,
  res: MedusaResponse<HttpTypes.StoreShippingOptionListResponse>
) => {
  const { cart_id, is_return } = req.filterableFields

  const workflowEngine = req.scope.resolve(Modules.WORKFLOW_ENGINE)
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
