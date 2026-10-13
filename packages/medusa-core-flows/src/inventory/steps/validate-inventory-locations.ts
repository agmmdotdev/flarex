import {
  arrayDifference,
  MedusaError,
} from "@medusajs/framework/utils/portable"

import type { InventoryTypes } from "@medusajs/framework/types"
import { createStep, WorkflowDefinitionError } from "@medusajs/workflows-sdk"
import type { WorkflowGraphResource } from "../../common/steps/use-query-graph"

/**
 * The data to validate the inventory levels.
 */
export type ValidateInventoryLocationsStepInput =
  InventoryTypes.CreateInventoryLevelInput[]

export const validateInventoryLocationsStepId = "validate-inventory-levels-step"
/**
 * This step ensures that the inventory levels exist for each
 * specified pair of inventory item and location. If not,
 * the step will throw an error.
 */
export const validateInventoryLocationsStep = createStep(
  validateInventoryLocationsStepId,
  async (data: ValidateInventoryLocationsStepInput, { container }) => {
    const query = container.resolve<WorkflowGraphResource>("query")

    const { data: stockLocations, metadata } = await query.graph({ entity: "stock_location", filters: { id: data.map((d) => d.location_id) }, fields: ["id"], pagination: { take: query.maxPageSize } })

    if (metadata.count !== stockLocations.length || metadata.skip !== 0) throw new WorkflowDefinitionError({ reason: "unsupportedProfile", detail: "Inventory validation requires a complete bounded ID result" })
    const diff = arrayDifference(
      data.map((d) => d.location_id),
      stockLocations.map((l) => l.id)
    )
    if (diff.length > 0) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Stock locations with ids: ${diff.join(", ")} was not found`
      )
    }
  }
)
