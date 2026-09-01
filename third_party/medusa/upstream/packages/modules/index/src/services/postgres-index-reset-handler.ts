import { toMikroORMEntity } from "@medusajs/framework/utils"
import { IndexData, IndexMetadata, IndexRelation, IndexSync } from "@models"
import type {
  IndexResetHandler,
  IndexTransactionManager,
} from "./index-module-service"

type SqlExecutor = {
  execute(sql: string): Promise<unknown>
}

function isSqlExecutor(value: IndexTransactionManager): value is SqlExecutor {
  return (
    typeof value === "object" &&
    value !== null &&
    "execute" in value &&
    typeof value.execute === "function"
  )
}

export class PostgresIndexResetHandler implements IndexResetHandler {
  async reset(transactionManager: IndexTransactionManager): Promise<void> {
    if (!isSqlExecutor(transactionManager)) {
      throw new Error(
        "Postgres index reset requires a SQL transaction manager with execute"
      )
    }

    const truncableTables = [
      toMikroORMEntity(IndexData).prototype,
      toMikroORMEntity(IndexRelation).prototype,
      toMikroORMEntity(IndexMetadata).prototype,
      toMikroORMEntity(IndexSync).prototype,
    ].map((table) => table.__helper.__meta.collection)

    await transactionManager.execute(
      `TRUNCATE TABLE ${truncableTables.join(", ")} CASCADE`
    )
  }
}
