import { ChangeActionType, MedusaError } from "@medusajs/framework/utils"
import { OrderChangeProcessing } from "../calculate-order-change"

OrderChangeProcessing.registerActionType(ChangeActionType.SHIPPING_REMOVE, {
  operation({ action, currentOrder, options }) {
    const shipping = Array.isArray(currentOrder.shipping_methods)
      ? currentOrder.shipping_methods
      : [currentOrder.shipping_methods]

    const existingIndex = shipping.findIndex((item) => {
      const detail = item.detail as
        | {
            id?: string
            shipping_method_id?: string
            return_id?: string
            claim_id?: string
            exchange_id?: string
          }
        | undefined

      return (
        item.id === action.reference_id ||
        detail?.id === action.reference_id ||
        detail?.shipping_method_id === action.reference_id ||
        (action.return_id && detail?.return_id === action.return_id) ||
        (action.claim_id && detail?.claim_id === action.claim_id) ||
        (action.exchange_id && detail?.exchange_id === action.exchange_id)
      )
    })

    if (existingIndex > -1) {
      shipping.splice(existingIndex, 1)
    }

    currentOrder.shipping_methods = shipping
  },
  validate({ action }) {
    if (!action.reference_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Reference ID is required."
      )
    }
  },
})
