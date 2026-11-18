import type { CartTypes } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/utils/common/errors"
import { decodeCartCreationCartProjection, decodeCartCreationSnapshot, type CartCreationSnapshot } from "./contracts"

interface AddressPlan { readonly shipping: boolean; readonly billing: boolean }

/** The selected creation contract proves fresh no-ID inline Addresses. String
 * references remain ordinary native inputs and never receive a creation claim.
 * Explicit inline IDs and mixed relation/FK input need their own insertion
 * proof; they are refused before the native writer rather than guessed. */
export function prepareCartCreationAddresses(data: readonly CartTypes.CreateCartDTO[]): readonly AddressPlan[] {
  return data.map(cart => {
    const inline = (name: "shipping_address" | "billing_address") => {
      const descriptor = Object.getOwnPropertyDescriptor(cart, name)
      if (descriptor === undefined) return false
      if (!("value" in descriptor)) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Cart creation ownership refuses Address accessors")
      const address: unknown = descriptor.value
      if (address === undefined || address === null || typeof address === "string") return false
      if (typeof address !== "object" || Array.isArray(address) ||
        Object.getPrototypeOf(address) !== Object.prototype && Object.getPrototypeOf(address) !== null || "id" in address ||
        Object.getOwnPropertyDescriptor(cart, name + "_id") !== undefined || Reflect.ownKeys(Object.getOwnPropertyDescriptors(address)).some(key => {
          const property = Object.getOwnPropertyDescriptor(address, key)
          return property === undefined || !("value" in property)
        })) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Cart creation ownership requires a fresh plain inline Address")
      return true
    }
    return { shipping: inline("shipping_address"), billing: inline("billing_address") }
  })
}

/** Native serialization supplies the actual persisted FK scalars. Its DTO
 * declaration omits those scalars; the checked projection admits their real
 * values without inventing nulls or authorizing arbitrary serializer hooks. */
export function cartCreationSnapshot(carts: unknown, plans: readonly AddressPlan[]): typeof CartCreationSnapshot.Type {
  const rows = decodeCartCreationCartProjection(carts), addresses = new Set<string>()
  if (rows.length !== plans.length) throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Native Cart creation changed its result cardinality")
  for (const [index, plan] of plans.entries()) {
    const row = rows[index]
    if (row === undefined || plan.shipping && row.shipping_address_id === null || plan.billing && row.billing_address_id === null)
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Native Cart creation omitted an inline Address identity")
    if (plan.shipping && row.shipping_address_id !== null) addresses.add(row.shipping_address_id)
    if (plan.billing && row.billing_address_id !== null) addresses.add(row.billing_address_id)
  }
  return decodeCartCreationSnapshot({ carts: rows, addresses: [...addresses] })
}
