import type { PortableEntity } from "@medusajs/dml"
import { applyModelDefaults, getPrimaryKeys } from "./metadata"
import type {
  DatabaseSession,
  FilterOperator,
  FilterQuery,
  FindOptions,
  RepositoryService,
} from "./types"

export function createMemoryRepository<T extends object>(
  entity: PortableEntity,
  initialRecords: T[] = []
): RepositoryService<T> {
  let records = initialRecords.map((record) => ({ ...record }))
  const primaryKeys = getPrimaryKeys(entity)
  const session: DatabaseSession = {
    dialect: "memory",
    transaction: async (operation) => operation(session),
  }

  return {
    entity,
    session,

    async find(options = {}) {
      return applyFindOptions(records, options)
    },

    async findAndCount(options = {}) {
      const all = records.filter((record) =>
        matches(record, options.where ?? {})
      )
      return [applyFindOptions(records, options), all.length]
    },

    async create(data) {
      const created = data.map((entry) => applyModelDefaults(entity, entry))
      records.push(...created)
      return created
    },

    async update(data) {
      return data.map(({ entity: current, update }) => {
        const index = records.findIndex((record) =>
          primaryKeys.every(
            (key) => getValue(record, key) === getValue(current, key)
          )
        )
        const updated = applyModelDefaults(entity, {
          ...current,
          ...update,
        })
        records[index] = updated
        return updated
      })
    },

    async delete(where) {
      const deleted = records.filter((record) => matches(record, where))
      records = records.filter((record) => !matches(record, where))
      return deleted
    },

    async softDelete(where) {
      return updateDeletedAt(where, new Date())
    },

    async restore(where) {
      return updateDeletedAt(where, null)
    },

    async upsert(data) {
      const output: T[] = []
      for (const entry of data) {
        const current = records.find((record) =>
          primaryKeys.every(
            (key) => getValue(record, key) === getValue(entry, key)
          )
        )
        if (current) {
          output.push(
            ...(await this.update([{ entity: current, update: entry }]))
          )
        } else {
          output.push(...(await this.create([entry])))
        }
      }
      return output
    },

    async serialize(data) {
      return data
    },
  }

  async function updateDeletedAt(where: FilterQuery<T>, deletedAt: Date | null) {
    const matching = records.filter((record) => matches(record, where))
    return await repositoryUpdate(
      matching,
      { deleted_at: deletedAt } as unknown as Partial<T>
    )
  }

  async function repositoryUpdate(matching: T[], update: Partial<T>) {
    const repository = createUpdateFacade()
    return repository.update(
      matching.map((record) => ({ entity: record, update }))
    )
  }

  function createUpdateFacade() {
    return {
      update: async (data: Array<{ entity: T; update: Partial<T> }>) =>
        data.map(({ entity: current, update }) => {
          const index = records.findIndex((record) =>
            primaryKeys.every(
              (key) => getValue(record, key) === getValue(current, key)
            )
          )
          const updated = applyModelDefaults(entity, { ...current, ...update })
          records[index] = updated
          return updated
        }),
    }
  }
}

function applyFindOptions<T extends object>(
  records: T[],
  options: FindOptions<T>
): T[] {
  let output = records.filter((record) => matches(record, options.where ?? {}))

  if (!options.withDeleted && output.some((record) => "deleted_at" in record)) {
    output = output.filter((record) => !getValue(record, "deleted_at"))
  }

  for (const [field, direction] of Object.entries(options.orderBy ?? {})) {
    output.sort((left, right) => {
      const leftValue = getValue(left, field)
      const rightValue = getValue(right, field)
      const result = leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0
      return direction === "DESC" ? -result : result
    })
  }

  return output.slice(options.skip ?? 0, (options.skip ?? 0) + (options.take ?? output.length))
}

function matches<T extends object>(record: T, where: FilterQuery<T>): boolean {
  return Object.entries(where).every(([field, value]) => {
    if (field === "$and") {
      return (value as FilterQuery<T>[]).every((entry) => matches(record, entry))
    }
    if (field === "$or") {
      return (value as FilterQuery<T>[]).some((entry) => matches(record, entry))
    }
    if (Array.isArray(value)) {
      return value.includes(getValue(record, field))
    }
    if (isOperator(value)) {
      return matchesOperator(getValue(record, field), value)
    }
    return getValue(record, field) === value
  })
}

function isOperator(value: unknown): value is FilterOperator {
  return Boolean(value && typeof value === "object" && Object.keys(value).some((key) => key.startsWith("$")))
}

function matchesOperator(value: unknown, operator: FilterOperator): boolean {
  return (
    (operator.$eq === undefined || value === operator.$eq) &&
    (operator.$ne === undefined || value !== operator.$ne) &&
    (operator.$gt === undefined ||
      operator.$gt === null ||
      (value as any) > operator.$gt) &&
    (operator.$gte === undefined ||
      operator.$gte === null ||
      (value as any) >= operator.$gte) &&
    (operator.$lt === undefined ||
      operator.$lt === null ||
      (value as any) < operator.$lt) &&
    (operator.$lte === undefined ||
      operator.$lte === null ||
      (value as any) <= operator.$lte) &&
    (operator.$in === undefined || operator.$in.includes(value as never)) &&
    (operator.$nin === undefined || !operator.$nin.includes(value as never))
  )
}

function getValue(record: object, field: string): any {
  return (record as Record<string, any>)[field]
}
