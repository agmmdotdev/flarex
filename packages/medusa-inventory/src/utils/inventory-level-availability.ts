import { BigNumber, MathBN } from "@medusajs/framework/utils/portable"
import type { BigNumberInput } from "@medusajs/framework/types"

/** The pinned InventoryLevelRepository.getAvailableQuantity arithmetic.
 * Persistence supplies the complete active Item/Location selection. */
export function inventoryLevelsAvailableQuantity(
  result: readonly {
    raw_stocked_quantity: BigNumberInput
    raw_reserved_quantity: BigNumberInput
  }[]
): BigNumber {
  return new BigNumber(
    MathBN.sum(
      ...result.map((r) => {
        return MathBN.sub(r.raw_stocked_quantity, r.raw_reserved_quantity)
      })
    )
  )
}
