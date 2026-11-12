import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { HttpTypes } from "@medusajs/framework/types"
import type { StoreAddCartPromotionsType, StoreRemoveCartPromotionsType } from "../../validators"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { refetchCart } from "../../helpers"

const updateCartPromotionsWorkflowId = "update-cart-promotions"
const PromotionActions = {
  ADD: "add",
  REMOVE: "remove",
  REPLACE: "replace",
} as const

export const POST = async (
  req: MedusaRequest<StoreAddCartPromotionsType, HttpTypes.SelectParams>,
  res: MedusaResponse<unknown>
) => {
  const we = req.scope.resolve<{ run(id: string, options: { input: unknown }): Promise<unknown> }>(Modules.WORKFLOW_ENGINE)
  const payload = req.validatedBody

  await we.run(updateCartPromotionsWorkflowId, {
    input: {
      promo_codes: payload.promo_codes,
      cart_id: req.params.id,
      action:
        payload.promo_codes.length > 0
          ? PromotionActions.ADD
          : PromotionActions.REPLACE,
      force_refresh_payment_collection: true,
    },
  })

  const cart = await refetchCart(
    req.params.id,
    req.scope,
    req.queryConfig.fields
  )

  res.status(200).json({ cart })
}

export const DELETE = async (
  req: MedusaRequest<StoreRemoveCartPromotionsType, HttpTypes.SelectParams>,
  res: MedusaResponse<unknown>
) => {
  const we = req.scope.resolve<{ run(id: string, options: { input: unknown }): Promise<unknown> }>(Modules.WORKFLOW_ENGINE)
  const payload = req.validatedBody

  await we.run(updateCartPromotionsWorkflowId, {
    input: {
      promo_codes: payload.promo_codes,
      cart_id: req.params.id,
      action: PromotionActions.REMOVE,
      force_refresh_payment_collection: true,
    },
  })

  const cart = await refetchCart(
    req.params.id,
    req.scope,
    req.queryConfig.fields
  )

  res.status(200).json({ cart })
}
