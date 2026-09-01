import type { PortableEntity } from "@medusajs/dml"
import { getPrimaryKeys, toPrimaryKeyFilter } from "./metadata"
import type {
  InternalService,
  Primitive,
  RepositoryContext,
  RepositoryService,
} from "./types"

export function createInternalService<T extends object>(
  entity: PortableEntity,
  repository: RepositoryService<T>
): InternalService<T> {
  const primaryKeys = getPrimaryKeys(entity)

  async function emit(
    action: "created" | "updated" | "deleted" | "restored",
    records: T[],
    context?: RepositoryContext
  ) {
    await Promise.all(
      records.map((record) =>
        context?.mutationSink?.emit({
          action,
          entity: entity.parse().tableName,
          data: Object.fromEntries(
            primaryKeys.map((key) => [key, record[key as keyof T]])
          ),
        })
      )
    )
  }

  function inTransaction<TResult>(
    context: RepositoryContext | undefined,
    operation: (transactionContext: RepositoryContext) => Promise<TResult>
  ): Promise<TResult> {
    if (context?.session) {
      return operation(context)
    }

    return repository.session.transaction((session) =>
      operation({ ...context, session })
    )
  }

  return {
    async retrieve(primaryKey, options = {}, context) {
      const records = await repository.find(
        {
          ...options,
          where: toPrimaryKeyFilter<T>(entity, primaryKey),
          take: 1,
        },
        context
      )

      if (!records[0]) {
        throw new Error(`${entity.name} was not found`)
      }

      return records[0]
    },

    list(filters = {}, options = {}, context) {
      return repository.find({ ...options, where: filters }, context)
    },

    listAndCount(filters = {}, options = {}, context) {
      return repository.findAndCount({ ...options, where: filters }, context)
    },

    async create(data, context) {
      return await inTransaction(context, async (transactionContext) => {
        const isArray = Array.isArray(data)
        const records = await repository.create(
          isArray ? data : [data],
          transactionContext
        )
        await emit("created", records, transactionContext)
        return isArray ? records : records[0]
      })
    },

    async update(data, context) {
      return await inTransaction(context, async (transactionContext) => {
        const isArray = Array.isArray(data)
        const inputs = isArray ? data : [data]
        const updates: Array<{ entity: T; update: Partial<T> }> = []

        for (const input of inputs) {
          const selector = Object.fromEntries(
            primaryKeys.map((key) => [key, input[key as keyof T]])
          ) as Record<string, Primitive>
          const current = await this.retrieve(selector, {}, transactionContext)
          updates.push({ entity: current, update: input })
        }

        const records = await repository.update(updates, transactionContext)
        await emit("updated", records, transactionContext)
        return isArray ? records : records[0]
      })
    },

    async delete(primaryKey, context) {
      await inTransaction(context, async (transactionContext) => {
        const records = await repository.delete(
          toPrimaryKeyFilter<T>(entity, primaryKey),
          transactionContext
        )
        await emit("deleted", records, transactionContext)
      })
    },

    async softDelete(primaryKey, context) {
      await inTransaction(context, async (transactionContext) => {
        const records = await repository.softDelete(
          toPrimaryKeyFilter<T>(entity, primaryKey),
          transactionContext
        )
        await emit("deleted", records, transactionContext)
      })
    },

    async restore(primaryKey, context) {
      await inTransaction(context, async (transactionContext) => {
        const records = await repository.restore(
          toPrimaryKeyFilter<T>(entity, primaryKey),
          transactionContext
        )
        await emit("restored", records, transactionContext)
      })
    },

    async upsert(data, context) {
      return await inTransaction(context, async (transactionContext) => {
        const isArray = Array.isArray(data)
        const records = await repository.upsert(
          isArray ? data : [data],
          transactionContext
        )
        return isArray ? records : records[0]
      })
    },
  }
}
