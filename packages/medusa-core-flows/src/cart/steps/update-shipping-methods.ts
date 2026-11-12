import type { ICartModuleService } from "@medusajs/types"
import type {
  CartShippingMethodDTO,
  UpdateShippingMethodDTO,
} from "@medusajs/types/cart/index"
import {
  Modules,
  getSelectsAndRelationsFromObjectArray,
} from "@medusajs/framework/utils/portable"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

/** Preserve the nullable amount forwarded by the native pricing workflow. */
type NativeShippingMethodInput = Omit<UpdateShippingMethodDTO, "amount"> & {
  amount?: Exclude<UpdateShippingMethodDTO["amount"], undefined> | null
}
type NativeCartShippingMethods = Pick<ICartModuleService, "listShippingMethods"> & {
  updateShippingMethods(data: NativeShippingMethodInput[]): Promise<CartShippingMethodDTO[]>
}

/**
 * The details of the shipping methods to update.
 */
export type UpdateShippingMethodsStepInput = NativeShippingMethodInput[]

export const updateShippingMethodsStepId = "update-shipping-methods-step"
/**
 * This step updates a cart's shipping methods.
 *
 * @example
 * const data = updateOrderShippingMethodsStep([
 *   {
 *     id: "sm_123",
 *     amount: 10
 *   }
 * ])
 */
export const updateShippingMethodsStep = createStep(
  { name: updateShippingMethodsStepId, compensation: "transactionCovered" },
  async (data: UpdateShippingMethodsStepInput, { container }) => {
    if (!data?.length) {
      return new StepResponse([], [])
    }

    const cartModule = container.resolve<NativeCartShippingMethods>(Modules.CART)
    const { selects, relations } = getSelectsAndRelationsFromObjectArray(data)

    const dataBeforeUpdate = await cartModule.listShippingMethods(
      { id: data.map((d) => d.id!) },
      { select: selects, relations }
    )

    const updatedItems = await cartModule.updateShippingMethods(data)

    return new StepResponse(updatedItems, dataBeforeUpdate)
  },
  async (dataBeforeUpdate, { container }) => {
    if (!dataBeforeUpdate?.length) {
      return
    }

    const cartModule: ICartModuleService = container.resolve(Modules.CART)

    await cartModule.updateShippingMethods(dataBeforeUpdate)
  }
)
