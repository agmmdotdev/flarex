import type {
  IInventoryService,
  InventoryTypes,
} from "@medusajs/framework/types"
import { convertItemResponseToUpdateRequest } from "@medusajs/utils/common/convert-item-response-to-update-request"
import { getSelectsAndRelationsFromObjectArray } from "@medusajs/utils/common/get-selects-and-relations-from-object-array"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

import { Modules } from "@medusajs/framework/utils/portable"

/**
 * The data to update the inventory items.
 */
export type UpdateInventoryItemsStepInput =
  InventoryTypes.UpdateInventoryItemInput[]

export const updateInventoryItemsStepId = "update-inventory-items-step"
/**
 * This step updates one or more inventory items.
 */
export const updateInventoryItemsStep = createStep(
  { name: updateInventoryItemsStepId, compensation: "transactionCovered" },
  async (input: UpdateInventoryItemsStepInput, { container }) => {
    const inventoryService = container.resolve<IInventoryService>(
      Modules.INVENTORY
    )

    if (!input.length) {
      return new StepResponse([], {
        dataBeforeUpdate: [],
        selects: [],
        relations: [],
      })
    }

    const { selects, relations } = getSelectsAndRelationsFromObjectArray(input)

    const dataBeforeUpdate = await inventoryService.listInventoryItems(
      { id: input.map(({ id }) => id) },
      {}
    )

    const updatedInventoryItems = await inventoryService.updateInventoryItems(
      input
    )

    return new StepResponse(updatedInventoryItems, {
      dataBeforeUpdate,
      selects,
      relations,
    })
  },
  async (revertInput, { container }) => {
    if (!revertInput?.dataBeforeUpdate?.length) {
      return
    }

    const { dataBeforeUpdate, selects, relations } = revertInput

    const inventoryService = container.resolve<IInventoryService>(
      Modules.INVENTORY
    )

    await inventoryService.updateInventoryItems(
      dataBeforeUpdate.map((data) =>
        convertItemResponseToUpdateRequest(data, selects, relations)
      )
    )
  }
)
