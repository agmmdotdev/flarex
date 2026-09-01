import type { PortableEntity } from "@medusajs/dml"
import type {
  BigNumberRawValue,
  CalculatedPriceSetDTO,
  Context,
  ModulePersistenceModel,
  PricingContext,
  PricingFilters,
  PricingRepositoryService,
} from "@medusajs/types"
import { and, eq, inArray, isNull } from "drizzle-orm"
import type { BaseSQLiteDatabase, SQLiteColumn } from "drizzle-orm/sqlite-core"
import { compileDmlSchema } from "./schema"
import { toDrizzleSqliteTable } from "./sqlite"

type DmlModel = PortableEntity & ModulePersistenceModel

type DrizzlePricingManager = {
  database: BaseSQLiteDatabase<"async", unknown>
  transactionMode: "atomic" | "statement"
  transaction<TResult>(
    task: (transactionManager: DrizzlePricingManager) => Promise<TResult>
  ): Promise<TResult>
  destroy(): Promise<void>
}

type DrizzleRepositoryInstance = {
  getActiveManager<TManager = unknown>(context?: Context): TManager
}

type DrizzleRepositoryConstructor = new (
  options: { manager: DrizzlePricingManager }
) => DrizzleRepositoryInstance

type PricingTables = {
  price: ReturnType<typeof toDrizzleSqliteTable>
  priceColumns: Record<string, SQLiteColumn>
  priceRule: ReturnType<typeof toDrizzleSqliteTable>
  priceRuleColumns: Record<string, SQLiteColumn>
  priceList: ReturnType<typeof toDrizzleSqliteTable>
  priceListColumns: Record<string, SQLiteColumn>
  priceListRule: ReturnType<typeof toDrizzleSqliteTable>
  priceListRuleColumns: Record<string, SQLiteColumn>
}

type PriceRow = {
  id: string
  price_set_id: string
  amount: number | string | null
  raw_amount: BigNumberRawValue | null
  min_quantity: number | string | null
  max_quantity: number | string | null
  currency_code: string
  price_list_id: string | null
  rules_count: number
}

type PriceRuleRow = {
  price_id: string
  attribute: string
  value: string
  operator: string
}

type PriceListRow = {
  id: string
  type: string | null
  status: string | null
  starts_at: Date | number | string | null
  ends_at: Date | number | string | null
  rules_count: number
}

type PriceListRuleRow = {
  price_list_id: string
  attribute: string
  value: unknown
}

type ContextEntry = [string, unknown]

export function createDrizzlePricingRepository(
  moduleModels: Record<string, ModulePersistenceModel>,
  BaseRepository: DrizzleRepositoryConstructor
) {
  const tables = createPricingTables(moduleModels)

  return class DrizzlePricingRepository
    extends BaseRepository
    implements PricingRepositoryService
  {
    #availableAttributes: Set<string> = new Set()

    clearAvailableAttributes(): void {
      this.#availableAttributes.clear()
    }

    async calculatePrices(
      pricingFilters: PricingFilters,
      pricingContext: PricingContext = { context: {} },
      sharedContext: Context = {}
    ): Promise<CalculatedPriceSetDTO[]> {
      const context: Record<string, unknown> = {
        ...(pricingContext.context ?? {}),
      }
      const quantity = context.quantity
      delete context.quantity

      const currencyCode = context.currency_code
      delete context.currency_code

      if (!currencyCode) {
        throw new Error(
          "Method calculatePrices requires currency_code in the pricing context"
        )
      }

      let flattenedContext = Object.entries(flattenObject(context)).filter(
        ([, value]) => isContextValuePresent(value)
      )

      if (flattenedContext.length > 10) {
        await this.#cacheAvailableAttributesIfNecessary(sharedContext)
        flattenedContext = flattenedContext.filter(([key]) =>
          this.#availableAttributes.has(key)
        )
      }

      const manager =
        this.getActiveManager<DrizzlePricingManager>(sharedContext)
      const database = manager.database
      const prices = await selectPrices(
        database,
        tables,
        pricingFilters.id,
        String(currencyCode)
      )
      const quantityFilteredPrices = prices.filter((price) =>
        matchesQuantity(price, quantity)
      )
      const priceListIds = uniqueStrings(
        quantityFilteredPrices.map((price) => price.price_list_id)
      )
      const priceIds = uniqueStrings(
        quantityFilteredPrices.map((price) => price.id)
      )
      const [priceLists, priceRules, priceListRules] = await Promise.all([
        selectPriceLists(database, tables, priceListIds),
        selectPriceRules(database, tables, priceIds),
        selectPriceListRules(database, tables, priceListIds),
      ])
      const priceListsById = new Map(priceLists.map((row) => [row.id, row]))
      const priceRulesByPriceId = groupBy(priceRules, "price_id")
      const priceListRulesByPriceListId = groupBy(
        priceListRules,
        "price_list_id"
      )
      const hasComplexContext = flattenedContext.length > 0

      return quantityFilteredPrices
        .filter((price) =>
          matchesActivePriceList(
            price,
            priceListsById.get(price.price_list_id ?? "")
          )
        )
        .filter((price) =>
          matchesRules(
            price,
            priceListsById.get(price.price_list_id ?? ""),
            priceRulesByPriceId.get(price.id) ?? [],
            price.price_list_id
              ? priceListRulesByPriceListId.get(price.price_list_id) ?? []
              : [],
            flattenedContext,
            hasComplexContext
          )
        )
        .sort((left, right) =>
          compareCalculatedPriceRows(
            left,
            right,
            priceListsById.get(left.price_list_id ?? ""),
            priceListsById.get(right.price_list_id ?? "")
          )
        )
        .map((price) =>
          toCalculatedPriceSet(
            price,
            priceListsById.get(price.price_list_id ?? "")
          )
        )
    }

    async #cacheAvailableAttributesIfNecessary(context: Context): Promise<void> {
      if (this.#availableAttributes.size === 0) {
        await this.#cacheAvailableAttributes(context)
      }
    }

    async #cacheAvailableAttributes(context: Context): Promise<void> {
      const manager = this.getActiveManager<DrizzlePricingManager>(context)
      const [priceRules, priceListRules] = await Promise.all([
        selectRuleAttributes(
          manager.database,
          tables.priceRule,
          tables.priceRuleColumns
        ),
        selectRuleAttributes(
          manager.database,
          tables.priceListRule,
          tables.priceListRuleColumns
        ),
      ])

      this.#availableAttributes.clear()
      for (const attribute of [...priceRules, ...priceListRules]) {
        this.#availableAttributes.add(attribute)
      }
    }
  }
}

function createPricingTables(
  moduleModels: Record<string, ModulePersistenceModel>
): PricingTables {
  const models = Object.values(moduleModels).filter(isDmlModel)
  const schema = compileDmlSchema(models)
  const tableByModel = new Map(
    models.map((model, index) => [model.name, schema.tables[index]])
  )

  const price = toDrizzleSqliteTable(requiredTable(tableByModel, "Price"))
  const priceRule = toDrizzleSqliteTable(
    requiredTable(tableByModel, "PriceRule")
  )
  const priceList = toDrizzleSqliteTable(
    requiredTable(tableByModel, "PriceList")
  )
  const priceListRule = toDrizzleSqliteTable(
    requiredTable(tableByModel, "PriceListRule")
  )

  return {
    price,
    priceColumns: price as unknown as Record<string, SQLiteColumn>,
    priceRule,
    priceRuleColumns: priceRule as unknown as Record<string, SQLiteColumn>,
    priceList,
    priceListColumns: priceList as unknown as Record<string, SQLiteColumn>,
    priceListRule,
    priceListRuleColumns: priceListRule as unknown as Record<
      string,
      SQLiteColumn
    >,
  }
}

async function selectPrices(
  database: BaseSQLiteDatabase<"async", unknown>,
  tables: PricingTables,
  priceSetIds: string[],
  currencyCode: string
): Promise<PriceRow[]> {
  if (!priceSetIds.length) {
    return []
  }

  const rows = await database
    .select()
    .from(tables.price)
    .where(
      and(
        inArray(tables.priceColumns.price_set_id, priceSetIds),
        eq(tables.priceColumns.currency_code, currencyCode),
        isNull(tables.priceColumns.deleted_at)
      )
    )

  return rows.map(toPriceRow)
}

async function selectPriceRules(
  database: BaseSQLiteDatabase<"async", unknown>,
  tables: PricingTables,
  priceIds: string[]
): Promise<PriceRuleRow[]> {
  if (!priceIds.length) {
    return []
  }

  const rows = await database
    .select()
    .from(tables.priceRule)
    .where(
      and(
        inArray(tables.priceRuleColumns.price_id, priceIds),
        isNull(tables.priceRuleColumns.deleted_at)
      )
    )

  return rows.map(toPriceRuleRow)
}

async function selectPriceLists(
  database: BaseSQLiteDatabase<"async", unknown>,
  tables: PricingTables,
  priceListIds: string[]
): Promise<PriceListRow[]> {
  if (!priceListIds.length) {
    return []
  }

  const rows = await database
    .select()
    .from(tables.priceList)
    .where(
      and(
        inArray(tables.priceListColumns.id, priceListIds),
        isNull(tables.priceListColumns.deleted_at)
      )
    )

  return rows.map(toPriceListRow)
}

async function selectPriceListRules(
  database: BaseSQLiteDatabase<"async", unknown>,
  tables: PricingTables,
  priceListIds: string[]
): Promise<PriceListRuleRow[]> {
  if (!priceListIds.length) {
    return []
  }

  const rows = await database
    .select()
    .from(tables.priceListRule)
    .where(
      and(
        inArray(tables.priceListRuleColumns.price_list_id, priceListIds),
        isNull(tables.priceListRuleColumns.deleted_at)
      )
    )

  return rows.map(toPriceListRuleRow)
}

async function selectRuleAttributes(
  database: BaseSQLiteDatabase<"async", unknown>,
  table: ReturnType<typeof toDrizzleSqliteTable>,
  columns: Record<string, SQLiteColumn>
): Promise<string[]> {
  const rows = await database
    .select({ attribute: columns.attribute })
    .from(table)
    .where(isNull(columns.deleted_at))

  return rows
    .map((row) => row.attribute)
    .filter((attribute): attribute is string => typeof attribute === "string")
}

function matchesQuantity(price: PriceRow, quantity: unknown): boolean {
  if (quantity !== undefined) {
    const normalizedQuantity = toNumber(quantity)
    if (normalizedQuantity === undefined) {
      return false
    }

    const minQuantity = toNumber(price.min_quantity)
    const maxQuantity = toNumber(price.max_quantity)

    return (
      (minQuantity !== undefined &&
        minQuantity <= normalizedQuantity &&
        maxQuantity !== undefined &&
        maxQuantity >= normalizedQuantity) ||
      (minQuantity !== undefined &&
        minQuantity <= normalizedQuantity &&
        maxQuantity === undefined) ||
      (minQuantity === undefined && maxQuantity === undefined) ||
      (minQuantity === undefined &&
        maxQuantity !== undefined &&
        maxQuantity >= normalizedQuantity)
    )
  }

  const minQuantity = toNumber(price.min_quantity)
  return minQuantity === undefined || minQuantity <= 1
}

function matchesActivePriceList(
  price: PriceRow,
  priceList: PriceListRow | undefined
): boolean {
  if (!price.price_list_id) {
    return true
  }

  if (!priceList || priceList.status !== "active") {
    return false
  }

  const now = Date.now()
  const startsAt = toTimestamp(priceList.starts_at)
  const endsAt = toTimestamp(priceList.ends_at)

  return (
    (startsAt === undefined || startsAt <= now) &&
    (endsAt === undefined || endsAt >= now)
  )
}

function matchesRules(
  price: PriceRow,
  priceList: PriceListRow | undefined,
  priceRules: PriceRuleRow[],
  priceListRules: PriceListRuleRow[],
  flattenedContext: ContextEntry[],
  hasComplexContext: boolean
): boolean {
  if (!hasComplexContext) {
    return (
      price.rules_count === 0 ||
      Boolean(price.price_list_id && (priceList?.rules_count ?? 0) === 0)
    )
  }

  const matchedPriceRuleCount = priceRules.filter((rule) =>
    matchesPriceRule(rule, flattenedContext)
  ).length
  const matchesPriceRules =
    price.rules_count === 0 || matchedPriceRuleCount === price.rules_count

  if (!price.price_list_id) {
    return matchesPriceRules
  }

  const priceListRulesCount = priceList?.rules_count ?? 0
  const matchedPriceListRuleCount = priceListRules.filter((rule) =>
    matchesPriceListRule(rule, flattenedContext)
  ).length

  return (
    matchesPriceRules &&
    (priceListRulesCount === 0 ||
      matchedPriceListRuleCount === priceListRulesCount)
  )
}

function matchesPriceRule(
  rule: PriceRuleRow,
  flattenedContext: ContextEntry[]
): boolean {
  return flattenedContext.some(([key, value]) => {
    if (key !== rule.attribute) {
      return false
    }

    if (typeof value === "number") {
      const ruleValue = Number(rule.value)
      if (Number.isNaN(ruleValue)) {
        return false
      }

      switch (rule.operator) {
        case "gt":
          return value > ruleValue
        case "gte":
          return value >= ruleValue
        case "lt":
          return value < ruleValue
        case "lte":
          return value <= ruleValue
        default:
          return String(value) === rule.value
      }
    }

    return toValueArray(value).some((entry) => String(entry) === rule.value)
  })
}

function matchesPriceListRule(
  rule: PriceListRuleRow,
  flattenedContext: ContextEntry[]
): boolean {
  return flattenedContext.some(([key, value]) => {
    if (key !== rule.attribute) {
      return false
    }

    const ruleValues = toValueArray(parseJsonValue(rule.value))
    return toValueArray(value).some((entry) =>
      ruleValues.some((ruleValue) => String(ruleValue) === String(entry))
    )
  })
}

function compareCalculatedPriceRows(
  left: PriceRow,
  right: PriceRow,
  leftPriceList: PriceListRow | undefined,
  rightPriceList: PriceListRow | undefined
): number {
  const priceListRank =
    Number(Boolean(right.price_list_id)) - Number(Boolean(left.price_list_id))
  if (priceListRank) {
    return priceListRank
  }

  const leftRulesCount = left.rules_count + (leftPriceList?.rules_count ?? 0)
  const rightRulesCount = right.rules_count + (rightPriceList?.rules_count ?? 0)
  if (leftRulesCount !== rightRulesCount) {
    return rightRulesCount - leftRulesCount
  }

  return (toNumber(left.amount) ?? 0) - (toNumber(right.amount) ?? 0)
}

function toCalculatedPriceSet(
  price: PriceRow,
  priceList: PriceListRow | undefined
): CalculatedPriceSetDTO {
  return {
    id: price.id,
    price_set_id: price.price_set_id,
    amount: price.amount,
    raw_amount: price.raw_amount ?? rawAmount(price.amount),
    min_quantity: nullableNumberString(price.min_quantity),
    max_quantity: nullableNumberString(price.max_quantity),
    currency_code: price.currency_code,
    price_list_id: price.price_list_id,
    price_list_type: priceList?.type ?? null,
  }
}

function toPriceRow(row: Record<string, unknown>): PriceRow {
  return {
    id: stringField(row, "id"),
    price_set_id: stringField(row, "price_set_id"),
    amount: nullableNumberStringField(row, "amount"),
    raw_amount: rawAmountField(row.raw_amount),
    min_quantity: nullableNumberStringField(row, "min_quantity"),
    max_quantity: nullableNumberStringField(row, "max_quantity"),
    currency_code: stringField(row, "currency_code"),
    price_list_id: nullableString(row.price_list_id),
    rules_count: numberField(row, "rules_count"),
  }
}

function toPriceRuleRow(row: Record<string, unknown>): PriceRuleRow {
  return {
    price_id: stringField(row, "price_id"),
    attribute: stringField(row, "attribute"),
    value: stringField(row, "value"),
    operator: stringField(row, "operator"),
  }
}

function toPriceListRow(row: Record<string, unknown>): PriceListRow {
  return {
    id: stringField(row, "id"),
    type: nullableString(row.type),
    status: nullableString(row.status),
    starts_at: nullableDateLike(row.starts_at),
    ends_at: nullableDateLike(row.ends_at),
    rules_count: numberField(row, "rules_count"),
  }
}

function toPriceListRuleRow(row: Record<string, unknown>): PriceListRuleRow {
  return {
    price_list_id: stringField(row, "price_list_id"),
    attribute: stringField(row, "attribute"),
    value: row.value,
  }
}

function flattenObject(
  value: Record<string, unknown>,
  prefix?: string
): Record<string, unknown> {
  const output: Record<string, unknown> = {}

  for (const [key, entry] of Object.entries(value)) {
    const nextKey = prefix ? `${prefix}.${key}` : key
    if (isRecord(entry)) {
      Object.assign(output, flattenObject(entry, nextKey))
    } else {
      output[nextKey] = entry
    }
  }

  return output
}

function isContextValuePresent(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.flat(1).length > 0
  }

  return value !== null && value !== undefined
}

function toValueArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value.flat(1) : [value]
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value
  }

  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function toTimestamp(value: Date | number | string | null): number | undefined {
  if (value === null) {
    return undefined
  }

  if (value instanceof Date) {
    return value.getTime()
  }

  if (typeof value === "number") {
    return value
  }

  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? undefined : timestamp
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return value
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    return Number.isNaN(parsed) ? undefined : parsed
  }

  if (
    isRecord(value) &&
    (typeof value.value === "number" || typeof value.value === "string")
  ) {
    return toNumber(value.value)
  }

  return undefined
}

function rawAmount(value: number | string | null): BigNumberRawValue | null {
  if (value === null) {
    return null
  }

  return {
    value: trimTrailingZeros(String(value)),
    precision: 20,
  }
}

function rawAmountField(value: unknown): BigNumberRawValue | null {
  if (
    isRecord(value) &&
    (typeof value.value === "string" || typeof value.value === "number")
  ) {
    return {
      value: String(value.value),
      precision:
        typeof value.precision === "number" ? value.precision : undefined,
    }
  }

  return null
}

function trimTrailingZeros(value: string): string {
  if (!value.includes(".")) {
    return value
  }

  return value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")
}

function uniqueStrings(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function groupBy<TRow extends Record<TKey, string>, TKey extends keyof TRow>(
  rows: TRow[],
  key: TKey
): Map<string, TRow[]> {
  const grouped = new Map<string, TRow[]>()
  for (const row of rows) {
    const value = row[key]
    const current = grouped.get(value) ?? []
    current.push(row)
    grouped.set(value, current)
  }

  return grouped
}

function requiredTable(
  tables: Map<string, ReturnType<typeof compileDmlSchema>["tables"][number]>,
  name: string
): ReturnType<typeof compileDmlSchema>["tables"][number] {
  const table = tables.get(name)
  if (!table) {
    throw new Error(`Pricing Drizzle repository requires ${name} model`)
  }

  return table
}

function stringField(row: Record<string, unknown>, field: string): string {
  const value = row[field]
  if (typeof value !== "string") {
    throw new Error(`Expected string field "${field}"`)
  }

  return value
}

function numberField(row: Record<string, unknown>, field: string): number {
  const value = row[field]
  if (typeof value === "number") {
    return value
  }

  if (value === null || value === undefined) {
    return 0
  }

  const parsed = Number(value)
  if (Number.isNaN(parsed)) {
    throw new Error(`Expected numeric field "${field}"`)
  }

  return parsed
}

function nullableNumberStringField(
  row: Record<string, unknown>,
  field: string
): number | string | null {
  const value = row[field]
  if (typeof value === "number" || typeof value === "string") {
    return value
  }

  return null
}

function nullableNumberString(value: number | string | null): string | null {
  return value === null ? null : String(value)
}

function nullableDateLike(value: unknown): Date | number | string | null {
  return value instanceof Date ||
    typeof value === "number" ||
    typeof value === "string"
    ? value
    : null
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function isDmlModel(model: ModulePersistenceModel): model is DmlModel {
  return Boolean(
    model &&
      typeof model === "object" &&
      "parse" in model &&
      typeof model.parse === "function" &&
      "schema" in model
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}
