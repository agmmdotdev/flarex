import type { OrderChangeDTO, IOrderModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils/portable"
import { createStep, StepResponse } from "@medusajs/workflows-sdk"

// These are the exact native step arguments before the finite resource
// boundary omits optional undefined fields. Published Order DTOs stay native.
type ConfirmationUpdate = { id: OrderChangeDTO["id"]; confirmed_by?: string | undefined }
type CurrentChange = ConfirmationUpdate & Pick<OrderChangeDTO, "order_id" | "status">
type ConfirmationPorts = {
  confirmOrderChange(data: ConfirmationUpdate[]): ReturnType<IOrderModuleService["confirmOrderChange"]>
  undoLastChange(orderId: string, previous?: CurrentChange): ReturnType<IOrderModuleService["undoLastChange"]>
}

/**
 * The input for the confirm order changes step.
 */
export type ConfirmOrderChangesInput = {
  /**
   * The ID of the order to confirm changes for.
   */
  orderId: string
  /**
   * The changes to confirm.
   */
  changes: Pick<OrderChangeDTO, "id" | "status">[]
  /**
   * The ID of the user confirming the changes.
   */
  confirmed_by?: string
}

/**
 * This step confirms changes of an order.
 */
export const confirmOrderChanges = createStep(
  { name: "confirm-order-changes", compensation: "transactionCovered" },
  async (input: ConfirmOrderChangesInput, { container }) => {
    const orderModuleService = container.resolve<ConfirmationPorts>(Modules.ORDER)

    const currentChanges: CurrentChange[] = []
    const orderChanges = await orderModuleService.confirmOrderChange(
      input.changes.map((action) => {
        const update = {
          id: action.id,
          confirmed_by: input.confirmed_by,
        }

        currentChanges.push({
          ...update,
          order_id: input.orderId,
          status: action.status,
        })

        return update
      })
    )

    return new StepResponse(orderChanges, currentChanges)
  },
  async (currentChanges, { container }) => {
    if (!currentChanges?.length) {
      return
    }

    const orderModuleService = container.resolve<ConfirmationPorts>(Modules.ORDER)
    await orderModuleService.undoLastChange(
      currentChanges[0]!.order_id,
      currentChanges[0]
    )
  }
)
