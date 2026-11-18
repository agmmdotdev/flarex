import {
  arrayDifference,
  MedusaError,
} from "@medusajs/framework/utils/portable"
import { createStep, WorkflowDefinitionError } from "@medusajs/workflows-sdk"
import type { WorkflowGraphResource } from "../../common/steps/use-query-graph"

/**
 * The IDs of the inventory items to validate.
 */
export type ValidateInventoryItemsStepInput = string[]

export const validateInventoryItemsId = "validate-inventory-items-step"
/**
 * This step ensures that the inventory items with the specified IDs exist.
 * If not valid, the step will throw an error.
 */
export const validateInventoryItems = createStep(
  validateInventoryItemsId,
  async (id: ValidateInventoryItemsStepInput, { container }) => {
    const query = container.resolve<WorkflowGraphResource>("query")

    const { data: items, metadata } = await query.graph({ entity: "inventory_item", filters: { id }, fields: ["id"], pagination: { take: query.maxPageSize } })
    if (metadata.count !== items.length || metadata.skip !== 0) throw new WorkflowDefinitionError({ reason: "unsupportedProfile", detail: "Inventory validation requires a complete bounded ID result" })
    const diff = arrayDifference(
      id,
      items.map(({ id }) => id)
    )

    if (diff.length > 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Inventory Items with ids: ${diff.join(", ")} was not found`
      )
    }
  }
)
