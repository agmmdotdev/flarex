import type { Context, DAL } from "@medusajs/framework/types"
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query"
import { generateEntityId } from "@medusajs/utils/common/generate-entity-id"
import { MedusaError } from "@medusajs/utils/common/errors"
import { cartCreationSnapshotKey, decodeCartCreationSnapshot, decodeCartCreationHandle, decodeCartCreationRecord,
  decodeCartCreationClaims, decodeCartCreationAddressClaims, decodeCartCreationCartRows, decodeCartCreationAddressRows,
  type CartCreationHandle, type CartCreationSnapshot, type CartCreationCompensation } from "./contracts"

type Repository = Pick<DAL.RepositoryService, "find" | "create" | "update" | "serialize">
/** Implementations borrow the actual native transaction. Operation, Cart and
 * Address locks use that fixed table order and deterministic key order, with
 * true FOR UPDATE for physical Addresses. Reference reads are a separate fresh
 * READ COMMITTED statement after all locks, including soft-deleted Carts.
 * The logical implementation authenticates existing scope exclusion instead. */
export interface CartCreationOwnershipReads {
  require(context: Context): Promise<void>
  lockOperation(id: string, context: Context): Promise<void>
  lockCarts(ids: readonly string[], context: Context): Promise<unknown>
  lockAddresses(ids: readonly string[], context: Context): Promise<unknown>
  references(ids: readonly string[], context: Context): Promise<unknown>
}

function conflict(message: string): MedusaError { return new MedusaError(MedusaError.Types.CONFLICT, message) }
function unexpected(message: string): MedusaError { return new MedusaError(MedusaError.Types.UNEXPECTED_STATE, message) }

/** Native Cart owns generation evidence and the inverse. This store never
 * starts or settles a transaction; its module supplies the existing native
 * protected transaction and genuine internal Cart/Address deletion methods. */
export class CartCreationStore {
  readonly #operations: Repository
  readonly #carts: Repository
  readonly #addresses: Repository
  readonly #reads: CartCreationOwnershipReads
  constructor(input: { readonly operations: Repository; readonly carts: Repository; readonly addresses: Repository;
    readonly reads: CartCreationOwnershipReads }) {
    this.#operations = input.operations; this.#carts = input.carts; this.#addresses = input.addresses; this.#reads = input.reads
  }

  private async require(context: Context): Promise<void> {
    if (context.transactionManager == null) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Cart ownership requires its native transaction")
    await this.#reads.require(context)
  }

  private async operation(id: string, context: Context) {
    const rows = await this.#operations.find(buildQuery<{ id: string }>({ id }, { take: 2, withDeleted: true }), context)
    if (rows.length !== 1) throw conflict("Cart creation ownership record is absent or ambiguous")
    const entity = rows[0], value = decodeCartCreationRecord(await this.#operations.serialize<object>(entity))
    if (value.id !== id) throw unexpected("Cart creation ownership record selected another operation")
    return { entity, value }
  }

  async record(input: typeof CartCreationSnapshot.Type, context: Context): Promise<typeof CartCreationHandle.Type> {
    await this.require(context)
    const snapshot = decodeCartCreationSnapshot(input)
    if (snapshot.carts.length === 0) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Cart ownership requires a created Cart")
    const id = generateEntityId(undefined, "ccop")
    await this.#operations.create([{ id, carts: snapshot.carts, addresses: snapshot.addresses, state: "applied" }], context)
    await this.#carts.create(snapshot.carts.map(cart => ({ id: cart.id, operation_id: id, cart_id: cart.id })), context)
    if (snapshot.addresses.length) await this.#addresses.create(snapshot.addresses.map(address => ({
      id: address, operation_id: id, address_id: address,
    })), context)
    const stored = await this.operation(id, context)
    if (stored.value.state !== "applied" || cartCreationSnapshotKey(stored.value) !== cartCreationSnapshotKey(snapshot))
      throw unexpected("Cart creation ownership was not stored")
    return { operation_id: id }
  }

  async compensate(input: unknown, context: Context, remove: {
    readonly carts: (ids: string[], context: Context) => Promise<unknown>
    readonly addresses: (ids: string[], context: Context) => Promise<unknown>
  }): Promise<CartCreationCompensation> {
    await this.require(context)
    const handle = decodeCartCreationHandle(input)
    await this.#reads.lockOperation(handle.operation_id, context)
    const operation = await this.operation(handle.operation_id, context)
    if (operation.value.state === "compensated") return {
      status: "alreadyCompensated", deletedCartIds: [], deletedAddressIds: [], retainedAddressIds: [],
    }
    const expected = operation.value, cartIds = expected.carts.map(cart => cart.id), addressIds = expected.addresses
    const carts = decodeCartCreationCartRows(await this.#reads.lockCarts(cartIds, context))
    const addresses = decodeCartCreationAddressRows(await this.#reads.lockAddresses(addressIds, context))
    if (new Set(carts.map(cart => cart.id)).size !== carts.length || carts.some(cart => !cartIds.includes(cart.id)) ||
      new Set(addresses.map(address => address.id)).size !== addresses.length || addresses.some(address => !addressIds.includes(address.id)))
      throw unexpected("Cart ownership lock selection changed its cohort")

    // Canonical target primary keys authenticate one claim even when a native
    // soft lifecycle has tombstoned it. Physical deletion cascades it away.
    if (carts.length) {
      const entities = await this.#carts.find(buildQuery<{ cart_id: string[] }>({ cart_id: carts.map(cart => cart.id) }, { take: carts.length + 1, withDeleted: true }), context)
      const claims = decodeCartCreationClaims(await this.#carts.serialize<object[]>(entities))
      if (claims.length !== carts.length || new Set(claims.map(claim => claim.cart_id)).size !== claims.length ||
        claims.some(claim => claim.operation_id !== handle.operation_id || !carts.some(cart => cart.id === claim.cart_id)))
        throw conflict("A recreated Cart superseded creation ownership")
    }
    for (const current of carts) {
      const before = expected.carts.find(cart => cart.id === current.id)
      if (before === undefined || current.shipping_address_id !== before.shipping_address_id || current.billing_address_id !== before.billing_address_id)
        throw conflict("A later Cart address assignment superseded creation ownership")
    }
    if (addresses.length) {
      const entities = await this.#addresses.find(buildQuery<{ address_id: string[] }>({ address_id: addresses.map(address => address.id) }, { take: addresses.length + 1, withDeleted: true }), context)
      const claims = decodeCartCreationAddressClaims(await this.#addresses.serialize<object[]>(entities))
      if (claims.length !== addresses.length || new Set(claims.map(claim => claim.address_id)).size !== claims.length ||
        claims.some(claim => claim.operation_id !== handle.operation_id || !addresses.some(address => address.id === claim.address_id)))
        throw conflict("A recreated Address superseded creation ownership")
    }
    // A missing original Cart is not in this set: a newly inserted Cart with
    // its old native ID remains an outside reference, never a deletion target.
    const owned = new Set(carts.map(cart => cart.id)), shared = new Set<string>()
    if (addresses.length) for (const reference of decodeCartCreationCartRows(await this.#reads.references(addresses.map(address => address.id), context))) {
      if (!addresses.some(address => address.id === reference.shipping_address_id || address.id === reference.billing_address_id))
        throw unexpected("Cart ownership reference query returned an unrelated row")
      if (owned.has(reference.id)) continue
      if (reference.shipping_address_id !== null) shared.add(reference.shipping_address_id)
      if (reference.billing_address_id !== null) shared.add(reference.billing_address_id)
    }
    const deletedCartIds = carts.map(cart => cart.id), deletedAddressIds = addresses.filter(address => !shared.has(address.id)).map(address => address.id)
    if (deletedCartIds.length) await remove.carts(deletedCartIds, context)
    if (deletedAddressIds.length) await remove.addresses(deletedAddressIds, context)
    if (deletedCartIds.length && decodeCartCreationCartRows(await this.#reads.lockCarts(deletedCartIds, context)).length ||
      deletedAddressIds.length && decodeCartCreationAddressRows(await this.#reads.lockAddresses(deletedAddressIds, context)).length)
      throw unexpected("Native Cart inverse did not remove its owned rows")
    await this.#operations.update([{ entity: operation.entity, update: { state: "compensated" } }], context)
    if ((await this.operation(handle.operation_id, context)).value.state !== "compensated")
      throw unexpected("Cart creation compensation outcome was not stored")
    return { status: "compensated", deletedCartIds, deletedAddressIds,
      retainedAddressIds: addresses.filter(address => shared.has(address.id)).map(address => address.id) }
  }
}
