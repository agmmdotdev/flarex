import type {
  IInventoryService,
  InventoryTypes,
} from "@medusajs/framework/types"
import { convertItemResponseToUpdateRequest } from "@medusajs/utils/common/convert-item-response-to-update-request"
import { getSelectsAndRelationsFromObjectArray } from "@medusajs/utils/common/get-selects-and-relations-from-object-array"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

import { Modules } from "@medusajs/framework/utils/portable"

/**
 * The data to update the inventory levels.
 */
export type UpdateInventoryLevelsStepInput =
  InventoryTypes.UpdateInventoryLevelInput[]

export const updateInventoryLevelsStepId = "update-inventory-levels-step"
/**
 * This step updates one or more inventory levels.
 */
export const updateInventoryLevelsStep = createStep(
  { name: updateInventoryLevelsStepId, compensation: "transactionCovered" },
  async (input: UpdateInventoryLevelsStepInput, { container }) => {
    const inventoryService: IInventoryService = container.resolve(
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

    const dataBeforeUpdate = await inventoryService.listInventoryLevels(
      {
        $or: input.map(({ inventory_item_id, location_id }) => ({
          inventory_item_id,
          location_id,
        })),
      },
      {}
    )

    const updatedLevels: InventoryTypes.InventoryLevelDTO[] =
      await inventoryService.updateInventoryLevels(input)

    return new StepResponse(updatedLevels, {
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

    const inventoryService = container.resolve<IInventoryService>(Modules.INVENTORY)

    await inventoryService.updateInventoryLevels(
      dataBeforeUpdate.map((data) =>
        convertItemResponseToUpdateRequest(data, selects, relations)
      ) as InventoryTypes.UpdateInventoryLevelInput[]
    )
  }
)
