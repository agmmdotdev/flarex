import { StepResponse, createStep } from "@medusajs/workflows-sdk"

import type { IInventoryService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils/portable"

/**
 * The IDs of the line items to delete reservations for.
 */
export type DeleteReservationsByLineItemsStepInput = string[]

export const deleteReservationsByLineItemsStepId =
  "delete-reservations-by-line-items"
/**
 * This step deletes reservations by their associated line items.
 */
export const deleteReservationsByLineItemsStep = createStep(
  { name: deleteReservationsByLineItemsStepId, compensation: "transactionCovered" },
  async (ids: DeleteReservationsByLineItemsStepInput, { container }) => {
    const service = container.resolve<IInventoryService>(Modules.INVENTORY)

    await service.deleteReservationItemsByLineItem(ids)

    return new StepResponse(void 0, ids)
  },
  async (prevIds, { container }) => {
    if (!prevIds?.length) {
      return
    }

    const service = container.resolve<IInventoryService>(Modules.INVENTORY)

    await service.restoreReservationItemsByLineItem(prevIds)
  }
)
