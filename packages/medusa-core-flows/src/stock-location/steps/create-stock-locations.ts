import {
  CreateStockLocationInput,
  IStockLocationService,
} from "@medusajs/framework/types"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

import { Modules } from "@medusajs/framework/utils/portable"

/**
 * The stock locations to create.
 */
export type CreateStockLocationsStepInput = CreateStockLocationInput[]

export const createStockLocationsStepId = "create-stock-locations"
/**
 * This step creates one or more stock locations.
 */
export const createStockLocations = createStep(
  { name: createStockLocationsStepId, compensation: "transactionCovered" },
  async (data: CreateStockLocationsStepInput, { container }) => {
    const stockLocationService = container.resolve<IStockLocationService>(
      Modules.STOCK_LOCATION
    )

    const created = await stockLocationService.createStockLocations(data)

    return new StepResponse(
      created,
      created.map((i) => i.id)
    )
  },
  async (createdStockLocationIds, { container }) => {
    if (!createdStockLocationIds?.length) {
      return
    }

    const stockLocationService = container.resolve<IStockLocationService>(Modules.STOCK_LOCATION)

    await stockLocationService.deleteStockLocations(createdStockLocationIds)
  }
)
