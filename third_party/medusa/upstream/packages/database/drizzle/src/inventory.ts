import type { BigNumberInput, Context, ModulePersistenceModel } from "@medusajs/types"
import type { PortableEntity } from "@medusajs/dml"
import { and, eq, inArray, isNull } from "drizzle-orm"
import type { BaseSQLiteDatabase, SQLiteColumn } from "drizzle-orm/sqlite-core"
import { BigNumber } from "@medusajs/utils/totals/big-number"
import { relationshipTargets } from "./relation-metadata"
import { compileDmlSchema } from "./schema"
import { toDrizzleSqliteTable } from "./sqlite"

type DmlModel = PortableEntity & ModulePersistenceModel

type DrizzleInventoryManager = {
  database: BaseSQLiteDatabase<"async", unknown>
  transactionMode: "atomic" | "statement"
  transaction<TResult>(
    task: (transactionManager: DrizzleInventoryManager) => Promise<TResult>
  ): Promise<TResult>
  destroy(): Promise<void>
}

type DrizzleRepositoryInstance = {
  getActiveManager<TManager = unknown>(context?: Context): TManager
}

type DrizzleRepositoryConstructor = new (
  options: { manager: DrizzleInventoryManager }
) => DrizzleRepositoryInstance

type InventoryRelationDescriptor = {
  targetTable: ReturnType<typeof toDrizzleSqliteTable>
  targetColumns: Record<string, SQLiteColumn>
  ownerForeignKeys: string[]
  sourcePrimaryKeys: string[]
}

export function createDrizzleInventoryLevelRepository(
  model: DmlModel,
  BaseRepository: DrizzleRepositoryConstructor
) {
  const graphModels = [model, ...relationshipTargets(model)]
  const compiledSchema = compileDmlSchema(graphModels)
  const table = toDrizzleSqliteTable(compiledSchema.tables[0])
  const columns = table as unknown as Record<string, SQLiteColumn>

  return class DrizzleInventoryLevelRepository extends BaseRepository {
    async getReservedQuantity(
      inventoryItemId: string,
      locationIds: string[],
      context: Context = {}
    ): Promise<BigNumber> {
      return await this.sumQuantity(
        inventoryItemId,
        locationIds,
        "reserved_quantity",
        context
      )
    }

    async getAvailableQuantity(
      inventoryItemId: string,
      locationIds: string[],
      context: Context = {}
    ): Promise<BigNumber> {
      const database =
        this.getActiveManager<DrizzleInventoryManager>(context).database
      const rows = await selectInventoryLevelQuantities(
        database,
        table,
        columns,
        inventoryItemId,
        locationIds,
        ["stocked_quantity", "reserved_quantity"]
      )

      return rows.reduce(
        (total, row) =>
          sumQuantities(
            total,
            quantityDifference(
              row,
              "stocked_quantity",
              "reserved_quantity"
            )
          ),
        new BigNumber(0)
      )
    }

    async getStockedQuantity(
      inventoryItemId: string,
      locationIds: string[],
      context: Context = {}
    ): Promise<BigNumber> {
      return await this.sumQuantity(
        inventoryItemId,
        locationIds,
        "stocked_quantity",
        context
      )
    }

    async sumQuantity(
      inventoryItemId: string,
      locationIds: string[],
      field: "reserved_quantity" | "stocked_quantity",
      context: Context
    ): Promise<BigNumber> {
      const database =
        this.getActiveManager<DrizzleInventoryManager>(context).database
      const rows = await selectInventoryLevelQuantities(
        database,
        table,
        columns,
        inventoryItemId,
        locationIds,
        [field]
      )

      return rows.reduce(
        (total, row) => sumQuantities(total, quantityInput(row, field)),
        new BigNumber(0)
      )
    }
  }
}

export async function applyInventoryComputedFields(
  database: BaseSQLiteDatabase<"async", unknown>,
  rows: Record<string, unknown>[],
  model: DmlModel,
  relationDescriptors: Map<string, InventoryRelationDescriptor>,
  hasExplicitFields: boolean,
  fields: string[] = []
): Promise<void> {
  if (!rows.length) {
    return
  }

  const selectedFields = new Set(fields)
  if (model.name === "InventoryLevel") {
    if (!hasExplicitFields || selectedFields.has("available_quantity")) {
      for (const row of rows) {
        row.available_quantity = quantityDifference(
          row,
          "stocked_quantity",
          "reserved_quantity"
        ).numeric
      }
    }

    return
  }

  if (
    model.name !== "InventoryItem" ||
    !hasExplicitFields ||
    (!selectedFields.has("stocked_quantity") &&
      !selectedFields.has("reserved_quantity"))
  ) {
    return
  }

  const locationLevels = relationDescriptors.get("location_levels")
  if (
    !locationLevels ||
    locationLevels.ownerForeignKeys.length !== 1 ||
    locationLevels.sourcePrimaryKeys.length !== 1
  ) {
    return
  }

  const sourceKey = locationLevels.sourcePrimaryKeys[0]
  const ownerKey = locationLevels.ownerForeignKeys[0]
  const itemIds = rows
    .map((row) => row[sourceKey])
    .filter((value): value is string => typeof value === "string")

  if (!itemIds.length) {
    return
  }

  const levelRows = await selectInventoryLevelQuantitiesForItems(
    database,
    locationLevels,
    ownerKey,
    itemIds,
    ["stocked_quantity", "reserved_quantity"]
  )
  const totalsByItemId = new Map<
    string,
    { stockedQuantity: BigNumber; reservedQuantity: BigNumber }
  >()

  for (const levelRow of levelRows) {
    const itemId = levelRow[ownerKey]
    if (typeof itemId !== "string") {
      continue
    }

    const current = totalsByItemId.get(itemId) ?? {
      stockedQuantity: new BigNumber(0),
      reservedQuantity: new BigNumber(0),
    }

    totalsByItemId.set(itemId, {
      stockedQuantity: sumQuantities(
        current.stockedQuantity,
        quantityInput(levelRow, "stocked_quantity")
      ),
      reservedQuantity: sumQuantities(
        current.reservedQuantity,
        quantityInput(levelRow, "reserved_quantity")
      ),
    })
  }

  for (const row of rows) {
    const itemId = row[sourceKey]
    if (typeof itemId !== "string") {
      continue
    }

    const totals = totalsByItemId.get(itemId) ?? {
      stockedQuantity: new BigNumber(0),
      reservedQuantity: new BigNumber(0),
    }

    if (selectedFields.has("stocked_quantity")) {
      row.stocked_quantity = totals.stockedQuantity.numeric
    }
    if (selectedFields.has("reserved_quantity")) {
      row.reserved_quantity = totals.reservedQuantity.numeric
    }
  }
}

async function selectInventoryLevelQuantities(
  database: BaseSQLiteDatabase<"async", unknown>,
  table: ReturnType<typeof toDrizzleSqliteTable>,
  columns: Record<string, SQLiteColumn>,
  inventoryItemId: string,
  locationIds: string[],
  fields: Array<"stocked_quantity" | "reserved_quantity">
): Promise<Record<string, unknown>[]> {
  if (!locationIds.length) {
    return []
  }

  const selection = inventoryQuantitySelection(columns, [
    "inventory_item_id",
    "location_id",
    ...fields,
  ])

  return await database
    .select(selection)
    .from(table)
    .where(
      and(
        eq(columns.inventory_item_id, inventoryItemId),
        inArray(columns.location_id, locationIds),
        "deleted_at" in table ? isNull(table.deleted_at) : undefined
      )
    )
}

async function selectInventoryLevelQuantitiesForItems(
  database: BaseSQLiteDatabase<"async", unknown>,
  descriptor: InventoryRelationDescriptor,
  ownerKey: string,
  itemIds: string[],
  fields: Array<"stocked_quantity" | "reserved_quantity">
): Promise<Record<string, unknown>[]> {
  if (!itemIds.length) {
    return []
  }

  const selection = inventoryQuantitySelection(descriptor.targetColumns, [
    ownerKey,
    ...fields,
  ])

  return await database
    .select(selection)
    .from(descriptor.targetTable)
    .where(
      and(
        inArray(descriptor.targetColumns[ownerKey], itemIds),
        "deleted_at" in descriptor.targetTable
          ? isNull(descriptor.targetTable.deleted_at)
          : undefined
      )
    )
}

function inventoryQuantitySelection(
  columns: Record<string, SQLiteColumn>,
  fields: string[]
): Record<string, SQLiteColumn> {
  const selection: Record<string, SQLiteColumn> = {}

  for (const field of fields) {
    const column = columns[field]
    if (!column) {
      throw new Error(`Inventory quantity column "${field}" is not available`)
    }

    selection[field] = column

    const rawField = `raw_${field}`
    if (rawField in columns) {
      selection[rawField] = columns[rawField]
    }
  }

  return selection
}

function quantityDifference(
  row: Record<string, unknown>,
  leftField: string,
  rightField: string
): BigNumber {
  const value = toBigNumberMath(quantityInput(row, leftField)).minus(
    toBigNumberMath(quantityInput(row, rightField))
  )

  return new BigNumber(value.toString())
}

function sumQuantities(
  left: BigNumber,
  right: BigNumberInput | BigNumber
): BigNumber {
  const value = toBigNumberMath(left).plus(toBigNumberMath(right))

  return new BigNumber(value.toString())
}

function toBigNumberMath(value: BigNumberInput | BigNumber) {
  const bigNumber = value instanceof BigNumber
    ? value.bigNumber
    : new BigNumber(value).bigNumber

  if (!bigNumber) {
    throw new Error("Unable to convert inventory quantity to BigNumber")
  }

  return bigNumber
}

function quantityInput(
  row: Record<string, unknown>,
  field: string
): BigNumberInput {
  const raw = row[`raw_${field}`]
  if (isBigNumberRawInput(raw)) {
    return raw
  }

  const value = row[field]
  if (typeof value === "number" || typeof value === "string") {
    return value
  }

  return 0
}

function isBigNumberRawInput(value: unknown): value is {
  value: string | number
  precision?: number
} {
  return (
    isRecord(value) &&
    (typeof value.value === "string" || typeof value.value === "number") &&
    (value.precision === undefined || typeof value.precision === "number")
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}
