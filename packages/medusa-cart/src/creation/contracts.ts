import { Result, Schema } from "effect"
import { MedusaError } from "@medusajs/utils/common/errors"
export type { CartCreationCompensation } from "@medusajs/types/cart/creation"

const Id = Schema.String.check(Schema.isLengthBetween(1, 256))
export const CartCreationCartRow = Schema.Struct({
  id: Id, shipping_address_id: Schema.NullOr(Id), billing_address_id: Schema.NullOr(Id),
})
export const CartCreationSnapshot = Schema.Struct({
  carts: Schema.Array(CartCreationCartRow), addresses: Schema.Array(Id),
}).check(Schema.makeFilter(snapshot => {
  const carts = new Set(snapshot.carts.map(cart => cart.id)), addresses = new Set(snapshot.addresses)
  const referenced = new Set(snapshot.carts.flatMap(cart => [cart.shipping_address_id, cart.billing_address_id]))
  return carts.size === snapshot.carts.length && addresses.size === snapshot.addresses.length &&
    snapshot.addresses.every(address => referenced.has(address))
}))
export const CartCreationHandle = Schema.Struct({ operation_id: Id })
const isSnapshot = Schema.is(CartCreationSnapshot)
export const CartCreationRecord = Schema.Struct({ id: Id,
  carts: CartCreationSnapshot.fields.carts, addresses: CartCreationSnapshot.fields.addresses,
  state: Schema.Literals(["applied", "compensated"]),
}).check(Schema.makeFilter(record => record.carts.length > 0 && isSnapshot({ carts: record.carts, addresses: record.addresses })))
const CartClaim = Schema.Struct({ id: Id, operation_id: Id, cart_id: Id })
  .check(Schema.makeFilter(claim => claim.id === claim.cart_id))
const AddressClaim = Schema.Struct({ id: Id, operation_id: Id, address_id: Id })
  .check(Schema.makeFilter(claim => claim.id === claim.address_id))

function decoder<S extends Schema.ConstraintDecoder<unknown>>(schema: S, kind: "input" | "stored", excess: "error" | "ignore" = "error") {
  const decode = Schema.decodeUnknownResult(schema, { onExcessProperty: excess, propertyOrder: "original" })
  return (input: unknown): S["Type"] => Result.match(decode(input), {
    onSuccess: value => value,
    onFailure: cause => {
      const error = new MedusaError(kind === "input" ? MedusaError.Types.INVALID_DATA : MedusaError.Types.UNEXPECTED_STATE,
        kind === "input" ? "Invalid Cart creation ownership input" : "Invalid stored Cart creation ownership")
      Object.defineProperty(error, "cause", { value: cause })
      throw error
    },
  })
}

export const decodeCartCreationSnapshot = decoder(CartCreationSnapshot, "input")
export const decodeCartCreationHandle = decoder(CartCreationHandle, "input")
// Native DAL serialization may include managed timestamps and relation objects.
// Only these named protocol fields participate in ownership authorization.
export const decodeCartCreationRecord = decoder(CartCreationRecord, "stored", "ignore")
export const decodeCartCreationClaims = decoder(Schema.Array(CartClaim), "stored", "ignore")
export const decodeCartCreationAddressClaims = decoder(Schema.Array(AddressClaim), "stored", "ignore")
export const decodeCartCreationCartRows = decoder(Schema.Array(CartCreationCartRow), "stored")
export const decodeCartCreationCartProjection = decoder(Schema.Array(CartCreationCartRow), "stored", "ignore")
export const decodeCartCreationAddressRows = decoder(Schema.Array(Schema.Struct({ id: Id })), "stored")

/** Fixed strings/nulls only: incidental object key order carries no authority. */
export function cartCreationSnapshotKey(snapshot: typeof CartCreationSnapshot.Type): string {
  return JSON.stringify([snapshot.carts.map(cart => [cart.id, cart.shipping_address_id, cart.billing_address_id]), snapshot.addresses])
}
