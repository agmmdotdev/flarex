import type { Context, DAL } from "@medusajs/framework/types"
import { generateEntityId } from "@medusajs/utils/common/generate-entity-id"
import { MedusaError } from "@medusajs/utils/common/errors"
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query"
import { Result, Schema } from "effect"
import { decodeLinkOperationRecord, decodeLinkPairRevisionRows, linkPairRevisionId,
  type LinkOperationPair, type LinkOperationRecord, type LinkPairRevisionRecord } from "./contracts"

type Pair = typeof LinkOperationPair.Type
type Operation = typeof LinkOperationRecord.Type
type Revision = typeof LinkPairRevisionRecord.Type
type StoredRevision = { entity: unknown; value: Revision }
type ActiveTransaction = { publications: Array<() => Promise<void>>; revisions: Map<string, StoredRevision> }
type OperationWrite = Pick<Operation, "id" | "service_name" | "request" | "state" | "changes" | "events" | "compensation_events">
type NativeRepository = Pick<DAL.RepositoryService, "find" | "create" | "update" | "serialize">
export interface BorrowedLinkOperationOwner {
  /** The host must authenticate its existing exclusion capability before
   * invoking work. This hook never opens or settles a transaction. */
  run<T>(context: Context, work: (context: Context) => Promise<T>): Promise<T>
}

/** The native Link owner supplies both repositories from its selected model
 * set. Every call borrows its already authenticated transaction context. */
export class LinkOperationStore {
  readonly serviceName: string
  readonly primaryKey: string
  readonly foreignKey: string
  readonly #operations: NativeRepository
  readonly #revisions: NativeRepository
  readonly #transactionRepository: Pick<DAL.RepositoryService, "transaction">
  readonly #borrowedOwner: BorrowedLinkOperationOwner | undefined
  readonly #activeTransactions = new Map<unknown, ActiveTransaction>()
  readonly #decodePair: (value: unknown) => Pair

  constructor(input: { serviceName: string; primaryKey: string; foreignKey: string;
    operations: NativeRepository; revisions: NativeRepository;
    transactionRepository: Pick<DAL.RepositoryService, "transaction">;
    borrowedOwner?: BorrowedLinkOperationOwner }) {
    if (input.primaryKey === input.foreignKey || input.primaryKey.includes(",") || input.foreignKey.includes(",")) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Link operations require two scalar endpoint keys")
    }
    this.serviceName = input.serviceName
    this.primaryKey = input.primaryKey
    this.foreignKey = input.foreignKey
    this.#operations = input.operations
    this.#revisions = input.revisions
    this.#transactionRepository = input.transactionRepository
    this.#borrowedOwner = input.borrowedOwner
    const decode = Schema.decodeUnknownResult(Schema.Struct({
      [input.primaryKey]: Schema.String.check(Schema.isLengthBetween(1, 256)),
      [input.foreignKey]: Schema.String.check(Schema.isLengthBetween(1, 256)),
    }))
    this.#decodePair = value => Result.match(decode(value), {
      onSuccess: row => {
        const primary = row[input.primaryKey], foreign = row[input.foreignKey]
        if (primary === undefined || foreign === undefined) {
          throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Native Link endpoint projection omitted a required key")
        }
        return { primary, foreign }
      },
      onFailure: cause => {
        const error = new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Invalid native Link endpoint row")
        Object.defineProperty(error, "cause", { value: cause })
        throw error
      },
    })
  }

  pairs(rows: readonly unknown[]): Pair[] { return rows.map(this.#decodePair) }

  deferPublication(context: Context, publish: () => Promise<void>): boolean {
    const active = this.#activeTransactions.get(context.transactionManager)
    if (active === undefined) return false
    active.publications.push(publish)
    return true
  }

  async withTransaction<T>(context: Context, work: (context: Context) => Promise<T>): Promise<T> {
    const manager = context.transactionManager
    if (manager != null && this.#activeTransactions.has(manager)) return await work(context)
    const publications: Array<() => Promise<void>> = []
    const enter = async (owned: Context): Promise<T> => {
      if (owned.transactionManager == null) {
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Native Link transaction owner supplied no transaction")
      }
      const key = owned.transactionManager
      this.#activeTransactions.set(key, { publications, revisions: new Map() })
      try { return await work(owned) }
      finally { this.#activeTransactions.delete(key) }
    }
    if (manager != null) {
      if (this.#borrowedOwner === undefined) {
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Native Link operations refuse externally supplied transactions")
      }
      const result = await this.#borrowedOwner.run(context, enter)
      for (const publish of publications) await publish()
      return result
    }
    if (this.#borrowedOwner !== undefined) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Borrowed Link operations require their existing transaction")
    }
    const result: T = await this.#transactionRepository.transaction<unknown>(
      transactionManager => enter({ ...context, transactionManager }),
      { isolationLevel: "serializable", enableNestedTransactions: false },
    )
    for (const publish of publications) await publish()
    return result
  }

  private requireTransaction(context: Context): ActiveTransaction {
    const active = context.transactionManager == null ? undefined : this.#activeTransactions.get(context.transactionManager)
    if (active === undefined) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Link operation storage requires its owning transaction")
    }
    return active
  }

  private async load<A>(repository: NativeRepository, id: string, decode: (value: unknown) => A,
    context: Context): Promise<{ entity: unknown; value: A } | undefined> {
    this.requireTransaction(context)
    const rows: unknown[] = await repository.find(buildQuery<{ id: string }>({ id }, { take: 2, withDeleted: true }), context)
    if (rows.length > 1) throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Duplicate native Link operation identity")
    const entity = rows[0]
    if (entity === undefined) return undefined
    const value = decode(await repository.serialize<object>(entity))
    return { entity, value }
  }

  async operation(id: string, context: Context) {
    const found = await this.load(this.#operations, id, decodeLinkOperationRecord, context)
    if (found !== undefined && (found.value.id !== id || found.value.service_name !== this.serviceName)) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Mismatched native Link operation owner")
    }
    return found
  }

  async insert(operation: OperationWrite, context: Context): Promise<void> {
    this.requireTransaction(context)
    const checked = decodeLinkOperationRecord(operation)
    if (checked.service_name !== this.serviceName) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Mismatched native Link operation owner")
    }
    await this.#operations.create([{ ...checked }], context)
    const stored = await this.operation(checked.id, context)
    if (stored === undefined) throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Native Link operation was not stored")
  }

  async complete(operation: NonNullable<Awaited<ReturnType<LinkOperationStore["operation"]>>>,
    events: Operation["compensation_events"], context: Context): Promise<void> {
    this.requireTransaction(context)
    if (operation.value.state !== "applied") {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Only an applied native Link operation may be compensated")
    }
    await this.#operations.update([{ entity: operation.entity, update: { state: "compensated", compensation_events: events } }], context)
    const stored = await this.operation(operation.value.id, context)
    if (stored?.value.state !== "compensated") {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Native Link compensation outcome was not stored")
    }
  }

  /** Batch reads retain one authoritative decoder and the selected DAL owner.
   * Individual head writes below still acquire locks in deterministic ID order. */
  async revisions(pairs: readonly Pair[], context: Context): Promise<Map<string, StoredRevision>> {
    const active = this.requireTransaction(context)
    const expected = new Map<string, Pair>()
    for (const pair of pairs) expected.set(await linkPairRevisionId(this.serviceName, pair), pair)
    const found = new Map<string, StoredRevision>()
    // Only rotate() populates this map, after writing and rereading a head.
    // Its write lock lasts through this owner, so reuse cannot hide another
    // committed writer. Absence and ordinary read-only observations are never cached.
    for (const id of [...expected.keys()]) {
      const cached = active.revisions.get(id)
      if (cached !== undefined) { found.set(id, cached); expected.delete(id) }
    }
    if (expected.size === 0) return found
    const entities: unknown[] = await this.#revisions.find(buildQuery<{ id: string }>(
      { id: [...expected.keys()] }, { take: expected.size + 1, withDeleted: true }), context)
    const values = decodeLinkPairRevisionRows(await this.#revisions.serialize<object[]>(entities))
    if (values.length !== entities.length) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Native Link revision serialization changed its row cohort")
    }
    for (const [index, value] of values.entries()) {
      const pair = expected.get(value.id), entity = entities[index]
      if (pair === undefined || entity === undefined || found.has(value.id) || value.service_name !== this.serviceName ||
        value.primary_value !== pair.primary || value.foreign_value !== pair.foreign) {
        throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Mismatched native Link pair revision owner")
      }
      found.set(value.id, { entity, value: structuredClone(value) })
    }
    return found
  }

  async revision(pair: Pair, context: Context) {
    return (await this.revisions([pair], context)).get(await linkPairRevisionId(this.serviceName, pair))
  }

  /** Write heads in deterministic key order before mutating Link rows. Heads
   * arbitrate missing pairs as well as existing and physically deleted pairs. */
  async rotate(pairs: readonly Pair[], context: Context): Promise<void> {
    const active = this.requireTransaction(context)
    const keyed = new Map<string, Pair>()
    for (const pair of pairs) keyed.set(await linkPairRevisionId(this.serviceName, pair), pair)
    const previous = await this.revisions([...keyed.values()], context)
    const ordered = [...keyed].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    // Only heads written and verified by this exact owner are cached. Their
    // row locks survive through settlement, so updating a wholly held cohort
    // in one native DAL call acquires no new locks. Cold or mixed cohorts keep
    // individual writes in the complete deterministic order below.
    const held = ordered.every(([id]) => previous.has(id) && active.revisions.get(id) === previous.get(id))
    const updates: Array<{ entity: unknown; update: { revision: string } }> = []
    const written = new Map<string, string>()
    for (const [id, pair] of ordered) {
      const found = previous.get(id), revision = generateEntityId(undefined, "lrv")
      if (found?.value.revision === revision) {
        throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Native Link revision generation repeated its current fence")
      }
      active.revisions.delete(id)
      if (found === undefined) {
        await this.#revisions.create([{ id, service_name: this.serviceName, primary_value: pair.primary,
          foreign_value: pair.foreign, revision }], context)
      } else if (held) {
        updates.push({ entity: found.entity, update: { revision } })
      } else {
        await this.#revisions.update([{ entity: found.entity, update: { revision } }], context)
      }
      written.set(id, revision)
    }
    // The entire hot cohort has been invalidated before this first await.
    if (updates.length !== 0) await this.#revisions.update(updates, context)
    const stored = await this.revisions([...keyed.values()], context)
    if (stored.size !== written.size) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Native Link pair revision verification changed its row cohort")
    }
    for (const [id, revision] of written) {
      const found = stored.get(id)
      if (found?.value.revision !== revision) {
        throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Native Link pair revision was not stored")
      }
    }
    for (const [id, found] of stored) active.revisions.set(id, found)
  }
}
