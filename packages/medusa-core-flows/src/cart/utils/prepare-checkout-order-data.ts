import type { CheckoutCartView } from "../../common/steps/checkout-query-views"
import { decodeCheckoutPreparedLineItem, decodeCheckoutPreparedAdjustments } from "../../common/steps/checkout-order-view"
import { OrderStatus } from "@medusajs/framework/utils/portable"
import { prepareLineItemData, prepareTaxLinesData, prepareAdjustmentsData } from "./prepare-line-item-data"
export function prepareCheckoutOrderData(cart: CheckoutCartView) {
        const allItems = (cart.items ?? []).map((item) => {
          const input = {
            item,
            variant: item.variant,
            cartId: cart.id,
            unitPrice: item.raw_unit_price ?? item.unit_price,
            isTaxInclusive: item.is_tax_inclusive,
            taxLines: item.tax_lines ?? [],
            adjustments: item.adjustments ?? [],
          }

          const prepared: unknown = Reflect.apply(prepareLineItemData, undefined, [input])
          return decodeCheckoutPreparedLineItem(prepared)
        })

        const shippingMethods = (cart.shipping_methods ?? []).map((sm) => {
          const taxLines: unknown = Reflect.apply(prepareTaxLinesData, undefined, [sm.tax_lines ?? []])
          const preparedAdjustments: unknown = Reflect.apply(prepareAdjustmentsData, undefined, [sm.adjustments ?? []])
          const adjustments = decodeCheckoutPreparedAdjustments(preparedAdjustments)
          return {
            name: sm.name,
            description: sm.description,
            amount: sm.raw_amount ?? sm.amount,
            is_tax_inclusive: sm.is_tax_inclusive,
            shipping_option_id: sm.shipping_option_id,
            data: sm.data,
            metadata: sm.metadata,
            tax_lines: taxLines,
            adjustments: adjustments,
          }
        })

        const creditLines = (cart.credit_lines ?? []).map(
          (creditLine) => {
            return {
              amount: creditLine.amount,
              raw_amount: creditLine.raw_amount,
              reference: creditLine.reference,
              reference_id: creditLine.reference_id,
              metadata: creditLine.metadata,
            }
          }
        )

        const itemAdjustments = allItems
          .map((item) => item.adjustments ?? [])
          .flat(1)
        const shippingAdjustments = shippingMethods
          .map((sm) => sm.adjustments ?? [])
          .flat(1)

        const promoCodes = [...itemAdjustments, ...shippingAdjustments]
          .map((adjustment) => adjustment.code)
          .filter(Boolean)

        const shippingAddress = cart.shipping_address
          ? { ...cart.shipping_address }
          : null
        const billingAddress = cart.billing_address
          ? { ...cart.billing_address }
          : null

        if (shippingAddress) {
          delete shippingAddress.id
        }

        if (billingAddress) {
          delete billingAddress.id
        }

        return {
          region_id: cart.region?.id,
          customer_id: cart.customer?.id,
          sales_channel_id: cart.sales_channel_id,
          status: OrderStatus.PENDING,
          email: cart.email,
          currency_code: cart.currency_code,
          locale: cart.locale,
          shipping_address: shippingAddress,
          billing_address: billingAddress,
          no_notification: false,
          items: allItems,
          shipping_methods: shippingMethods,
          metadata: cart.metadata,
          promo_codes: promoCodes,
          credit_lines: creditLines,
        }
      }
