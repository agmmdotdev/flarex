import type { ICartModuleService } from "@medusajs/framework/types"
import type { CreateAddressDTO } from "@medusajs/types/cart/mutations"
import type { UpdateCartWorkflowInputDTO } from "@medusajs/types/cart/workflows"
import type { NativeOptionalFields } from "../../common/utils/native-additional-data"
import type { CartDTO, CartAddressDTO } from "@medusajs/types/cart/index"
import {
  Modules,
  getSelectsAndRelationsFromObjectArray,
} from "@medusajs/framework/utils/portable"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

/**
 * The details of the carts to update.
 */
export type UpdateCartsStepInput = (Omit<NativeOptionalFields<UpdateCartWorkflowInputDTO>, "shipping_address" | "billing_address"> & {
  shipping_address?: NativeCartAddress | NativeCartAddressReference | null | undefined
  billing_address?: NativeCartAddress | NativeCartAddressReference | null | undefined
})[]

/** Store AddressPayload admits explicit null on every optional address member. */
type NativeCartAddress = { [Key in keyof CreateAddressDTO]?: CreateAddressDTO[Key] | null | undefined } & { id?: string | undefined }

/** The Store schema accepts primitive address references. Native property
 * access observes absent fields; its later `in` check still rejects a primitive
 * exactly as the pinned workflow does. */
type NativeCartAddressReference = string & { readonly length: number; readonly country_code?: never; readonly id?: never }
type CartUpdateStepService = Omit<ICartModuleService, "updateCarts"> & {
  updateCarts(data: UpdateCartsStepInput): Promise<CartDTO[]>
}

export const updateCartsStepId = "update-carts"
/**
 * This step updates a cart.
 *
 * @example
 * const data = updateCartsStep([{
 *   id: "cart_123",
 *   email: "customer@gmail.com",
 * }])
 */
export const updateCartsStep = createStep(
  { name: updateCartsStepId, compensation: "transactionCovered" },
  async (data: UpdateCartsStepInput, { container }): Promise<StepResponse<CartDTO[], { cartsBeforeUpdate: CartDTO[]; addressesBeforeUpdate: CartAddressDTO[] }>> => {
    const cartModule = container.resolve<CartUpdateStepService>(Modules.CART)

    if (!data.length) {
      return new StepResponse([], {
        cartsBeforeUpdate: [],
        addressesBeforeUpdate: [],
      })
    }

    const { selects, relations } = getSelectsAndRelationsFromObjectArray(data, {
      requiredFields: [
        "id",
        "region_id",
        "customer_id",
        "sales_channel_id",
        "email",
        "currency_code",
        "metadata",
        "completed_at",
      ],
    })
    const cartsBeforeUpdate = await cartModule.listCarts(
      { id: data.map((d) => d.id) },
      { select: selects, relations }
    )

    // Since service factory udpate method will correctly keep the reference to the addresses,
    // but won't update its fields, we do this separately
    const addressesInput = data
      .flatMap((cart) => [cart.shipping_address, cart.billing_address])
      .filter((address): address is NonNullable<typeof address> => !!address)
    let addressesToUpdateIds: string[] = []
    const addressesToUpdate = addressesInput.filter(
      (address): address is NativeCartAddress & { id: string } => {
        if ("id" in address && !!address.id) {
          addressesToUpdateIds.push(address.id as string)
          return true
        }
        return false
      }
    )
    const addressesBeforeUpdate = await cartModule.listAddresses({
      id: addressesToUpdate.map((address) => address.id),
    })
    if (addressesToUpdate.length) {
      await Reflect.apply(cartModule.updateAddresses, cartModule, [addressesToUpdate])
    }

    const updatedCart = await cartModule.updateCarts(data)

    return new StepResponse(updatedCart, {
      cartsBeforeUpdate,
      addressesBeforeUpdate,
    })
  },
  async (dataToCompensate, { container }) => {
    if (!dataToCompensate) {
      return
    }

    const { cartsBeforeUpdate, addressesBeforeUpdate } = dataToCompensate

    const cartModule = container.resolve<CartUpdateStepService>(Modules.CART)

    const addressesToUpdate = []
    for (const address of addressesBeforeUpdate) {
      addressesToUpdate.push({
        ...address,
        metadata: address.metadata ?? undefined,
      })
    }
    await Reflect.apply(cartModule.updateAddresses, cartModule, [addressesToUpdate])

    const dataToUpdate = []

    for (const cart of cartsBeforeUpdate) {
      dataToUpdate.push({
        id: cart.id,
        region_id: cart.region_id,
        customer_id: cart.customer_id,
        sales_channel_id: cart.sales_channel_id,
        email: cart.email,
        currency_code: cart.currency_code,
        metadata: cart.metadata,
        completed_at: cart.completed_at,
      })
    }

    const restored: unknown = await Reflect.apply(cartModule.updateCarts, cartModule, [dataToUpdate])
    return restored
  }
)
