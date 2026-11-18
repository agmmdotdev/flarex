import { Result, Schema } from "effect"
import { LockMode, QueryOrder, type EntityName } from "@medusajs/deps/mikro-orm/core"
import type { SqlEntityManager } from "@medusajs/deps/mikro-orm/postgresql"
import type { Context } from "@medusajs/framework/types"
import type { MikroOrmBase } from "@medusajs/utils/dal/mikro-orm/mikro-orm-repository"
import { MedusaError } from "@medusajs/utils/common/errors"
import type { CartCreationOwnershipReads } from "./store"

interface CartKeys { id: string; shipping_address_id: string | null; billing_address_id: string | null }
interface Identity { id: string }
const readCommitted = Schema.decodeUnknownResult(Schema.Tuple([Schema.Struct({ transaction_isolation: Schema.Literal("read committed") })]))
const filters = { softDeletable: { withDeleted: true } }

/** Genuine native PostgreSQL compatibility owner. It is outside the portable
 * creation entrypoint; the Flarex adapter uses its existing logical owner.
 * All statements borrow the native protected transaction, without settling it. */
export class CartCreationPostgresReads implements CartCreationOwnershipReads {
  readonly #repository: Pick<MikroOrmBase, "getActiveManager">
  readonly #cart: EntityName<CartKeys>
  readonly #address: EntityName<Identity>
  readonly #operation: EntityName<Identity>
  constructor(input: { readonly repository: Pick<MikroOrmBase, "getActiveManager">;
    readonly cart: EntityName<CartKeys>; readonly address: EntityName<Identity>; readonly operation: EntityName<Identity> }) {
    this.#repository = input.repository; this.#cart = input.cart; this.#address = input.address; this.#operation = input.operation
  }
  private manager(context: Context): SqlEntityManager { return this.#repository.getActiveManager<SqlEntityManager>(context) }
  async require(context: Context): Promise<void> {
    const manager = this.manager(context)
    if (context.transactionManager == null || manager.getTransactionContext() == null)
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Cart ownership requires a live PostgreSQL transaction")
    Result.match(readCommitted(await manager.execute("SHOW transaction_isolation")), {
      onSuccess: () => undefined,
      onFailure: cause => {
        const error = new MedusaError(MedusaError.Types.NOT_ALLOWED, "Cart ownership requires READ COMMITTED")
        Object.defineProperty(error, "cause", { value: cause }); throw error
      },
    })
  }
  async lockOperation(id: string, context: Context): Promise<void> {
    // Refresh the full entity while locking it. A later DAL read must not use
    // a stale state value from an earlier identity-map observation.
    await this.manager(context).find(this.#operation, { id }, { filters, refresh: true,
      lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: QueryOrder.ASC }, populate: [] })
  }
  async lockCarts(ids: readonly string[], context: Context): Promise<unknown> {
    if (!ids.length) return []
    // Native entity initialization may turn a null FK formula into undefined.
    // Read the actual nullable columns, without invoking relation hooks. The
    // query builder borrows this manager's existing transaction and includes
    // soft-deleted rows, just like the operation's ownership/reference contract.
    return this.manager(context).createQueryBuilder(this.#cart)
      .select(["id", "shipping_address_id", "billing_address_id"])
      .where({ id: { $in: [...ids] } }).orderBy({ id: QueryOrder.ASC })
      .setLockMode(LockMode.PESSIMISTIC_WRITE).execute("all", false)
  }
  async lockAddresses(ids: readonly string[], context: Context): Promise<unknown> {
    if (!ids.length) return []
    return (await this.manager(context).find(this.#address, { id: { $in: [...ids] } }, {
      filters, refresh: true, lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: QueryOrder.ASC }, fields: ["id"], populate: [],
    })).map(row => ({ id: row.id }))
  }
  async references(ids: readonly string[], context: Context): Promise<unknown> {
    if (!ids.length) return []
    // This is deliberately a new statement after all Address locks. It sees a
    // reference writer that committed while lock acquisition was waiting.
    return this.manager(context).createQueryBuilder(this.#cart)
      .select(["id", "shipping_address_id", "billing_address_id"])
      .where({ $or: [{ shipping_address_id: { $in: [...ids] } }, { billing_address_id: { $in: [...ids] } }] })
      .orderBy({ id: QueryOrder.ASC }).execute("all", false)
  }
}
