import type { IStockLocationService } from "@medusajs/types"
import type { DeleteEntityInput } from "../../common/steps/remove-remote-links"
import { Modules } from "@medusajs/framework/utils/portable"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

/**
 * The IDs of stock locations to delete.
 */
export type DeleteStockLocationsStepInput = string[]

export const deleteStockLocationsStepId = "delete-stock-locations-step"
/**
 * This step deletes one or more stock locations.
 */
export const deleteStockLocationsStep = createStep(
  { name: deleteStockLocationsStepId, compensation: "transactionCovered" },
  async (input: DeleteStockLocationsStepInput, { container }) => {
    const service = container.resolve<IStockLocationService>(Modules.STOCK_LOCATION)

    const softDeletedEntities = await service.softDeleteStockLocations(input)

    return new StepResponse(
      {
        [Modules.STOCK_LOCATION]: softDeletedEntities,
      } as DeleteEntityInput,
      input
    )
  },
  async (deletedLocationIds, { container }) => {
    if (!deletedLocationIds?.length) {
      return
    }
    const service = container.resolve<IStockLocationService>(Modules.STOCK_LOCATION)

    await service.restoreStockLocations(deletedLocationIds)
  }
)
