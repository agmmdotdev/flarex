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
