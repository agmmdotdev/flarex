import { model } from "@medusajs/framework/utils/portable"
import type { IDmlEntity } from "@medusajs/types"
import * as original from "../models"

/** Kept independently of the claimed Cart and Address rows. Physical deletion
 * must remove a generation claim without erasing the retained operation. */
const CartCreationOperation = model.define("CartCreationOperation", {
  id: model.id({ prefix: "ccop" }).primaryKey(),
  carts: model.json(),
  addresses: model.json(),
  state: model.enum(["applied", "compensated"]),
})

const CartCreationCart = model.define("CartCreationCart", {
  // The issuer supplies the target native ID. A primary key covers both live
  // and tombstoned claims; native DML unique indexes are active-only.
  id: model.id().primaryKey(),
  operation: model.belongsTo(() => CartCreationOperation, { mappedBy: undefined }),
  cart: model.belongsTo((): IDmlEntity<typeof original.Cart.schema, "Cart"> => Cart, { mappedBy: "creation_claims" }),
})

const CartCreationAddress = model.define("CartCreationAddress", {
  id: model.id().primaryKey(),
  operation: model.belongsTo(() => CartCreationOperation, { mappedBy: undefined }),
  address: model.belongsTo((): IDmlEntity<typeof original.Address.schema, "Address"> => Address, { mappedBy: "creation_claims" }),
})

const nativeCart = original.Cart.parse(), nativeAddress = original.Address.parse()
// Native define() supplies these fields itself. Every business property remains
// the original native DML object; the default module model set is untouched.
const { created_at: _cartCreated, updated_at: _cartUpdated, deleted_at: _cartDeleted, ...cartFields } = original.Cart.schema
const { created_at: _addressCreated, updated_at: _addressUpdated, deleted_at: _addressDeleted, ...addressFields } = original.Address.schema
const Cart = model.define({ name: nativeCart.name, tableName: nativeCart.tableName }, {
  ...cartFields,
  creation_claims: model.hasMany(() => CartCreationCart, { mappedBy: "cart" }),
})
const Address = model.define({ name: nativeAddress.name, tableName: nativeAddress.tableName }, {
  ...addressFields,
  creation_claims: model.hasMany(() => CartCreationAddress, { mappedBy: "address" }),
})
// SAFETY: parse() widens cascade names to strings. These native declarations
// refer only to fields retained verbatim above; the profile only adds a child.
const cartCascades = nativeCart.cascades as Parameters<typeof Cart.cascades>[0]
const addressCascades = nativeAddress.cascades as Parameters<typeof Address.cascades>[0]
Cart.cascades({ ...cartCascades, delete: [...(cartCascades.delete ?? []), "creation_claims"] })
  .indexes(nativeCart.indexes.map(index => ({ ...index }))).checks(nativeCart.checks)
Address.cascades({ ...addressCascades, delete: [...(addressCascades.delete ?? []), "creation_claims"] })
  .indexes(nativeAddress.indexes.map(index => ({ ...index }))).checks(nativeAddress.checks)

/** One explicit creation profile. Default Cart models and their existing
 * schemas retain their current identity and do not acquire receipt tables. */
export const cartCreationModels = {
  ...original, Cart, Address, CartCreationOperation, CartCreationCart, CartCreationAddress,
}
