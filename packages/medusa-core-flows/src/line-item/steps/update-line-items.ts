import {
  ICartModuleService,
  UpdateLineItemWithSelectorDTO,
} from "@medusajs/types"
import {
  Modules,
  getSelectsAndRelationsFromObjectArray,
  promiseAll,
  removeUndefined,
} from "@medusajs/framework/utils/portable"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"
import type { CartLineItemDTO, UpdateLineItemDTO } from "@medusajs/types/cart/index"
import type { NativeOptionalFields } from "../../common/utils/native-additional-data"

type NativeLineItemPatch = NativeOptionalFields<UpdateLineItemWithSelectorDTO["data"]>
type NativeLineItemUpdateInput = Omit<UpdateLineItemWithSelectorDTO, "data"> & { data: NativeLineItemPatch }
type LineItemUpdateStepService = Omit<ICartModuleService, "updateLineItems"> & {
  updateLineItems(selector: Partial<CartLineItemDTO>, data: NativeLineItemPatch): Promise<CartLineItemDTO[]>
  updateLineItems(id: string, data: NativeLineItemPatch): Promise<CartLineItemDTO>
}

export const updateLineItemsStepWithSelectorId =
  "update-line-items-with-selector"
/**
 * This step updates line items.
 *
 * @example
 * const data = updateLineItemsStepWithSelector({
 *   selector: {
 *     cart_id: "cart_123"
 *   },
 *   data: {
 *     quantity: 1
 *   }
 * })
 */
export const updateLineItemsStepWithSelector = createStep(
  { name: updateLineItemsStepWithSelectorId, compensation: "transactionCovered" },
  async (input: NativeLineItemUpdateInput, { container }) => {
    const service = container.resolve<LineItemUpdateStepService>(Modules.CART)

    const { selects, relations } = getSelectsAndRelationsFromObjectArray([
      input.data,
    ])

    const itemsBefore = await service.listLineItems(input.selector, {
      select: selects,
      relations,
    })

    const items = await service.updateLineItems(input.selector, input.data)

    return new StepResponse(items, itemsBefore)
  },
  async (itemsBefore, { container }) => {
    if (!itemsBefore) {
      return
    }

    const service = container.resolve<LineItemUpdateStepService>(Modules.CART)

    await promiseAll(
      itemsBefore.map(async (i) =>
        service.updateLineItems(
          i.id,
          removeUndefined({
            quantity: i.quantity,
            title: i.title,
            metadata: i.metadata,
            unit_price: i.unit_price,
            tax_lines: i.tax_lines,
            adjustments: i.adjustments,
          })
        )
      )
    )
  }
)
