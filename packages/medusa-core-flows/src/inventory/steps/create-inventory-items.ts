import { StepResponse, createStep } from "@medusajs/workflows-sdk"

import type {
  IInventoryService,
  InventoryTypes,
} from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils/portable"

/**
 * The data to create the inventory items.
 */
export type CreateInventoryItemsStepInput =
  InventoryTypes.CreateInventoryItemInput[]

export const createInventoryItemsStepId = "create-inventory-items"
/**
 * This step creates one or more inventory items.
 */
export const createInventoryItemsStep = createStep(
  { name: createInventoryItemsStepId, compensation: "transactionCovered" },
  async (data: CreateInventoryItemsStepInput, { container }) => {
    const inventoryService: IInventoryService = container.resolve(
      Modules.INVENTORY
    )

    const createdItems: InventoryTypes.InventoryItemDTO[] =
      await inventoryService.createInventoryItems(data)

    return new StepResponse(
      createdItems,
      createdItems.map((i) => i.id)
    )
  },
  async (data: string[] | undefined, { container }) => {
    if (!data?.length) {
      return
    }

    const inventoryService = container.resolve<IInventoryService>(Modules.INVENTORY)

    await inventoryService.deleteInventoryItems(data)
  }
)
