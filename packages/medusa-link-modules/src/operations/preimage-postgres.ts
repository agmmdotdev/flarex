import { Result, Schema } from "effect"
import type { EntityName } from "@medusajs/deps/mikro-orm/core"
import type { SqlEntityManager } from "@medusajs/deps/mikro-orm/postgresql"
import type { Context } from "@medusajs/framework/types"
import type { MikroOrmBase } from "@medusajs/utils/dal/mikro-orm/mikro-orm-repository"
import { MedusaError } from "@medusajs/utils/common/errors"
import type { LinkOperationPair } from "./contracts"
import { decodeLinkPreimageRows, linkPreimageRowKey, type LinkPreimageRow } from "./preimage-contracts"
import type { LinkPreimageStorage } from "./preimage-storage"

type Pair = typeof LinkOperationPair.Type
type Row = typeof LinkPreimageRow.Type
const isolation = Schema.decodeUnknownResult(Schema.Tuple([Schema.Struct({ transaction_isolation: Schema.Literal("serializable") })]))
const unsupported = () => new MedusaError(MedusaError.Types.NOT_ALLOWED, "Native Link preimages require their exact PostgreSQL profile")

/** Internal native PostgreSQL compatibility owner, outside portable exports.
 * Exact text reads/restoration deliberately bypass lossy Date DTOs and ordinary
 * update timestamp hooks. Original native mutations retain those hooks. Every
 * statement borrows the existing serialized Link transaction. */
export class LinkPreimagePostgresStorage implements LinkPreimageStorage {
  readonly #repository: Pick<MikroOrmBase, "getActiveManager">
  readonly #entity: EntityName<Record<string, unknown>>
  readonly #primary: string
  readonly #foreign: string
  constructor(input: { repository: Pick<MikroOrmBase, "getActiveManager">; entity: EntityName<Record<string, unknown>>;
    primaryKey: string; foreignKey: string }) {
    this.#repository = input.repository; this.#entity = input.entity; this.#primary = input.primaryKey; this.#foreign = input.foreignKey
  }
  private selected(context: Context) {
    const manager = this.#repository.getActiveManager<SqlEntityManager>(context), metadata = manager.getMetadata().get(this.#entity)
    const expected = ["id", this.#primary, this.#foreign, "created_at", "updated_at", "deleted_at"]
    if (context.transactionManager == null || manager.getTransactionContext() == null ||
      new Set(expected).size !== expected.length || metadata.primaryKeys.length !== 2 ||
      metadata.primaryKeys[0] !== this.#primary || metadata.primaryKeys[1] !== this.#foreign ||
      metadata.referencingProperties.length !== 0 || Object.keys(metadata.properties).length !== expected.length ||
      expected.some(name => metadata.properties[name]?.kind !== "scalar" || metadata.properties[name]?.fieldNames.length !== 1 ||
        metadata.properties[name]?.fieldNames[0] !== name)) throw unsupported()
    const quote = (name: string) => manager.getDriver().getPlatform().quoteIdentifier(name)
    const table = quote(metadata.schema ?? manager.config.get("schema") ?? "public") + "." + quote(metadata.tableName)
    const primary = quote(this.#primary), foreign = quote(this.#foreign)
    const timestamp = (name: string) => `CASE WHEN ${quote(name)} IS NULL THEN NULL ` +
      `WHEN isfinite(${quote(name)}) AND EXTRACT(YEAR FROM ${quote(name)} AT TIME ZONE 'UTC') BETWEEN 1 AND 9999 ` +
      `THEN to_char(${quote(name)} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') ELSE 'unsupported-native-timestamp' END AS ${quote(name)}`
    const projection = `${quote("id")},${primary} AS ${quote("primary")},${foreign} AS ${quote("foreign")},` +
      ["created_at", "updated_at", "deleted_at"].map(timestamp).join(",")
    return { manager, table, primary, foreign, projection, entityName: metadata.className }
  }
  private releaseRowState(pairs: readonly Pair[], manager: SqlEntityManager, entityName: string): void {
    // Native calls ordinarily leave their settled manager behind. Preserve
    // that clean boundary for these exact scalar-only Link rows while the
    // existing transaction, row locks and protocol entities remain live.
    const unit = manager.getUnitOfWork()
    for (const pair of pairs) {
      const entity = unit.getById<Record<string, unknown>>(entityName, [pair.primary, pair.foreign])
      if (entity !== undefined) unit.unsetIdentity(entity)
    }
  }
  async require(context: Context): Promise<void> {
    const { manager } = this.selected(context)
    Result.match(isolation(await manager.execute("SHOW transaction_isolation")), {
      onSuccess: () => undefined,
      onFailure: cause => { const error = unsupported(); Object.defineProperty(error, "cause", { value: cause }); throw error },
    })
  }
  async capture(pairs: readonly Pair[], context: Context): Promise<unknown> {
    const { manager, table, primary, foreign, projection, entityName } = this.selected(context)
    // Flush before observing: native dismiss/update DTOs can precede the real
    // flush-time timestamp hook. Later protocol-only writes cannot dirty this
    // now-clean Link state and change the captured result at settlement.
    await manager.flush()
    if (!pairs.length) return []
    const rows: unknown = await manager.execute(`SELECT ${projection} FROM ${table} WHERE ` + pairs.map(() => `(${primary}=? AND ${foreign}=?)`).join(" OR ") +
      ` ORDER BY ${primary},${foreign} FOR UPDATE`, pairs.flatMap(pair => [pair.primary, pair.foreign]))
    this.releaseRowState(pairs, manager, entityName)
    return rows
  }
  async restore(rows: readonly Row[], context: Context): Promise<unknown> {
    const { manager, table, primary, foreign, projection, entityName } = this.selected(context)
    await manager.flush()
    const restored: Row[] = []
    for (const row of rows) {
      const written: unknown = await manager.execute(`UPDATE ${table} SET "id"=?,"created_at"=?::timestamptz,"updated_at"=?::timestamptz,"deleted_at"=?::timestamptz ` +
        `WHERE ${primary}=? AND ${foreign}=? RETURNING ${projection}`,
        [row.id, row.created_at, row.updated_at, row.deleted_at, row.primary, row.foreign])
      const values = decodeLinkPreimageRows(written)
      if (values.length !== 1 || linkPreimageRowKey(values[0] ?? null) !== linkPreimageRowKey(row))
        throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Native Link exact restoration did not restore its retained row")
      restored.push(...values)
    }
    this.releaseRowState(rows, manager, entityName)
    return restored
  }
}
