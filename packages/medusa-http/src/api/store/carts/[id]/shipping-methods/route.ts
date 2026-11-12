import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { AdditionalData, HttpTypes } from "@medusajs/framework/types"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { refetchCart } from "../../helpers"
import type { StoreAddCartShippingMethodsType } from "../../validators"

const addShippingMethodToCartWorkflowId = "add-shipping-method-to-cart"

export const POST = async (
  req: MedusaRequest<
    StoreAddCartShippingMethodsType & AdditionalData,
    HttpTypes.SelectParams
  >,
  res: MedusaResponse<unknown>
) => {
  const payload = req.validatedBody

  const we = req.scope.resolve<{ run(id: string, options: { input: unknown }): Promise<unknown> }>(Modules.WORKFLOW_ENGINE)
  await we.run(addShippingMethodToCartWorkflowId, {
    input: {
      options: [{ id: payload.option_id, data: payload.data }],
      cart_id: req.params.id,
      additional_data: payload.additional_data,
    },
  })

  const cart = await refetchCart(
    req.params.id,
    req.scope,
    req.queryConfig.fields
  )

  res.status(200).json({ cart })
}
