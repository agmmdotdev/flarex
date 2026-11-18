import {
  WorkflowData,
  WorkflowResponse,
  createHook,
  createWorkflow,
  type Hook,
} from "@medusajs/workflows-sdk"

import type { CreateStockLocationInput, StockLocationTypes } from "@medusajs/framework/types"
import { createStockLocations } from "../steps/create-stock-locations"

/**
 * The data to create the stock locations.
 */
export interface CreateStockLocationsWorkflowInput {
  /**
   * The stock locations to create.
   */
  locations: CreateStockLocationInput[]
}

export const createStockLocationsWorkflowId = "create-stock-locations-workflow"
/**
 * This workflow creates one or more stock locations. It's used by the
 * [Create Stock Location Admin API Route](https://docs.medusajs.com/api/admin#stock-locations_poststocklocations).
 *
 * You can use this workflow within your own customizations or custom workflows, allowing you
 * to create stock locations in your custom flows.
 *
 * @example
 * const { result } = await createStockLocationsWorkflow(container)
 * .run({
 *   input: {
 *     locations: [
 *       {
 *         name: "European Warehouse",
 *       }
 *     ]
 *   }
 * })
 *
 * @summary
 *
 * Create one or more stock locations.
 */
export const createStockLocationsWorkflow = createWorkflow(
  createStockLocationsWorkflowId,
  (input: WorkflowData<CreateStockLocationsWorkflowInput>): WorkflowResponse<
    StockLocationTypes.StockLocationDTO[],
    readonly [Hook<"stockLocationsCreated", { stockLocations: StockLocationTypes.StockLocationDTO[] }>]
  > => {
    const stockLocations = createStockLocations(input.locations)

    const stockLocationsCreated = createHook("stockLocationsCreated", {
      stockLocations,
    })

    return new WorkflowResponse(stockLocations, {
      hooks: [stockLocationsCreated],
    })
  }
)
