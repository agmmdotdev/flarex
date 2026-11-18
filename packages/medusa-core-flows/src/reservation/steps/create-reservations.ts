import type { IInventoryService, InventoryTypes } from "@medusajs/framework/types"
import { createStep, StepResponse } from "@medusajs/workflows-sdk"

import { Modules } from "@medusajs/framework/utils/portable"

/**
 * The data to create reservation items.
 */
export type CreateReservationsStepInput =
  InventoryTypes.CreateReservationItemInput[]

export const createReservationsStepId = "create-reservations-step"
/**
 * This step creates one or more reservations.
 *
 * @example
 * const data = createReservationsStep([
 *   {
 *     inventory_item_id: "iitem_123",
 *     location_id: "sloc_123",
 *     quantity: 1,
 *   }
 * ])
 */
export const createReservationsStep = createStep(
  { name: createReservationsStepId, compensation: "transactionCovered" },
  async (data: CreateReservationsStepInput, { container }) => {
    const service = container.resolve<IInventoryService>(Modules.INVENTORY)
    const locking = container.resolve<{ execute<T>(keys: string[], work: () => Promise<T>): Promise<T> }>(Modules.LOCKING)

    const inventoryItemIds = data.map((item) => item.inventory_item_id)

    const lockingKeys = Array.from(new Set(inventoryItemIds))

    const created = await locking.execute(lockingKeys, async () => {
      return await service.createReservationItems(data)
    })

    return new StepResponse(created, {
      reservations: created.map((reservation) => reservation.id),
      inventoryItemIds: inventoryItemIds,
    })
  },
  async (data, { container }) => {
    if (!data?.reservations?.length) {
      return
    }

    const service = container.resolve<IInventoryService>(Modules.INVENTORY)
    const locking = container.resolve<{ execute<T>(keys: string[], work: () => Promise<T>): Promise<T> }>(Modules.LOCKING)

    const inventoryItemIds = data.inventoryItemIds
    const lockingKeys = Array.from(new Set(inventoryItemIds))

    await locking.execute(lockingKeys, async () => {
      await service.deleteReservationItems(data.reservations)
    })
  }
)
