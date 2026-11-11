import type { StoreAddCartLineItemType } from "../../validators"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { AdditionalData, HttpTypes } from "@medusajs/framework/types"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { refetchCart } from "../../helpers"

const addToCartWorkflowId = "add-to-cart"

export const POST = async (
  req: MedusaRequest<
    StoreAddCartLineItemType & AdditionalData,
    HttpTypes.SelectParams
  >,
  res: MedusaResponse<unknown>
) => {
  const we = req.scope.resolve<{ run(id: string, options: { input: unknown }): Promise<unknown> }>(Modules.WORKFLOW_ENGINE)
  await we.run(addToCartWorkflowId, {
    input: {
      cart_id: req.params.id,
      items: [req.validatedBody],
      additional_data: req.validatedBody.additional_data,
    },
  })

  const cart = await refetchCart(
    req.params.id,
    req.scope,
    req.queryConfig.fields
  )

  res.status(200).json({ cart })
}
