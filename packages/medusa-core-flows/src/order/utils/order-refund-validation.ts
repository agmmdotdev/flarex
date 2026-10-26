import type { OrderDTO } from "@medusajs/framework/types"
import { MedusaError, OrderStatus } from "@medusajs/framework/utils/portable"

/** Exact native refund prerequisite from order/utils/order-validation.ts. */
export function throwIfOrderIsCancelled({ order }: { order: Pick<OrderDTO, "id" | "status"> }) {
  if (order.status === OrderStatus.CANCELED) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Order with id ${order.id} has been canceled.`
    )
  }
}
