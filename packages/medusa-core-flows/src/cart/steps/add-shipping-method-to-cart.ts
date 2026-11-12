import type { ICartModuleService } from "@medusajs/types"
import type {
  CreateShippingMethodDTO,
  CartShippingMethodDTO,
} from "@medusajs/types/cart/index"
import { Modules } from "@medusajs/framework/utils/portable"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

/** Preserve the nullable amount forwarded by the native pricing workflow. */
type NativeShippingMethodInput = Omit<CreateShippingMethodDTO, "amount"> & {
  amount: CreateShippingMethodDTO["amount"] | null
}
type NativeCartShippingMethods = {
  addShippingMethods(data: NativeShippingMethodInput[]): Promise<CartShippingMethodDTO[]>
}

/**
 * The details of the shipping methods to add.
 */
export interface AddShippingMethodToCartStepInput {
  /**
   * The shipping methods to add.
   */
  shipping_methods: NativeShippingMethodInput[]
}

export const addShippingMethodToCartStepId = "add-shipping-method-to-cart-step"
/**
 * This step adds shipping methods to a cart.
 *
 * @example
 * const data = addShippingMethodToCartStep({
 *   shipping_methods: [
 *     {
 *       name: "Standard Shipping",
 *       cart_id: "cart_123",
 *       amount: 10,
 *     }
 *   ]
 * })
 */
export const addShippingMethodToCartStep = createStep(
  { name: addShippingMethodToCartStepId, compensation: "transactionCovered" },
  async (data: AddShippingMethodToCartStepInput, { container }) => {
    if (!data.shipping_methods?.length) {
      return new StepResponse([], [])
    }

    const cartService = container.resolve<NativeCartShippingMethods>(Modules.CART)
    const methods = await cartService.addShippingMethods(data.shipping_methods)

    return new StepResponse(methods, methods)
  },
  async (methods, { container }) => {
    const cartService: ICartModuleService = container.resolve(Modules.CART)
    if (!methods?.length) {
      return
    }

    await cartService.deleteShippingMethods(methods.map((m) => m.id))
  }
)
