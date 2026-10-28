import type { CartDTO } from "@medusajs/types"

type Claimed<T> = T & { creation_claims?: unknown }

type CartAddressDTO = NonNullable<CartDTO["shipping_address"]>
function address(value: Claimed<CartAddressDTO>): CartAddressDTO {
  const { creation_claims: _claims, ...result } = value
  return result
}

/** The explicit creation capability returns the ordinary native Cart DTO.
 * Its private inverse relations are not part of that result. The default
 * nine-model module and its serializers remain unchanged. */
export function presentCartCreation(carts: Claimed<CartDTO>[]): CartDTO[] {
  return carts.map(({ creation_claims: _claims, ...cart }) => {
    if (cart.shipping_address != null) cart.shipping_address = address(cart.shipping_address)
    if (cart.billing_address != null) cart.billing_address = address(cart.billing_address)
    return cart
  })
}
