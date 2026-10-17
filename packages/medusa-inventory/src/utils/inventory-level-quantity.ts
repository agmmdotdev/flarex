import { BigNumber, MathBN } from "@medusajs/framework/utils/portable"
import type { BigNumberInput } from "@medusajs/framework/types"

/** Portable extraction of the pinned InventoryLevel OnInit calculation. The
 * persistence adapter supplies checked raw companions instead of ORM entities. */
export function inventoryLevelAvailableQuantity(
  stocked: BigNumberInput,
  reserved: BigNumberInput
) {
  return new BigNumber(MathBN.sub(stocked, reserved))
}

/** The pinned Reservation lifecycle grouping and Level update projection.
 * Both the native service and its receipt use this one arithmetic owner. */
export function inventoryLevelReservationAdjustments(
  reservations: readonly { inventory_item_id: string; location_id: string; quantity: BigNumberInput }[],
  inventoryLevels: readonly { id: string; inventory_item_id: string; location_id: string; reserved_quantity: BigNumberInput }[],
  isDelete: boolean
) {
  const multiplier = isDelete ? -1 : 1
  const inventoryLevelAdjustments: Map<
    string,
    Map<string, ReturnType<typeof MathBN.mult>>
  > = reservations.reduce((acc, curr) => {
    const inventoryLevelMap = acc.get(curr.inventory_item_id) ?? new Map()

    const adjustment = inventoryLevelMap.has(curr.location_id)
      ? MathBN.add(
          inventoryLevelMap.get(curr.location_id),
          MathBN.mult(curr.quantity, multiplier)
        )
      : MathBN.mult(curr.quantity, multiplier)

    inventoryLevelMap.set(curr.location_id, adjustment)
    acc.set(curr.inventory_item_id, inventoryLevelMap)
    return acc
  }, new Map())

  return inventoryLevels.map((level) => {
    const adjustment = inventoryLevelAdjustments
      .get(level.inventory_item_id)
      ?.get(level.location_id)

    if (!adjustment) {
      return
    }

    return {
      id: level.id,
      reserved_quantity: MathBN.add(level.reserved_quantity, adjustment),
    }
  })

}
