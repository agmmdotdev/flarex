import {
  createWorkflow,
  WorkflowData,
  WorkflowResponse,
  WorkflowDefinitionError,
  transform,
} from "@medusajs/workflows-sdk"
import { Result, Schema } from "effect"
import { Modules } from "@medusajs/framework/utils/portable"

import { deleteInventoryItemStep, validateInventoryDeleteStep } from "../steps/delete-inventory-items"
import { removeRemoteLinkStep } from "../../common/steps/remove-remote-links"
import { useQueryGraphStep } from "../../common/steps/use-query-graph"

const decodeInventoryDeletionRows = Schema.decodeUnknownResult(Schema.Array(Schema.Struct({
  id: Schema.String.check(Schema.isLengthBetween(1, 256)), reserved_quantity: Schema.Number.check(Schema.isFinite()),
})).check(Schema.isMaxLength(8)), { onExcessProperty: "error" })

/**
 * The IDs of the inventory items to delete.
 */
export type DeleteInventoryItemWorkflowInput = string[]

/**
 * The IDs of deleted inventory items.
 */
export type DeleteInventoryItemWorkflowOutput = string[]

export const deleteInventoryItemWorkflowId = "delete-inventory-item-workflow"
/**
 * This workflow deletes one or more inventory items. It's used by the
 * [Delete Inventory Item Admin API Route](https://docs.medusajs.com/api/admin#inventory-items_deleteinventoryitemsid).
 *
 * You can use this workflow within your own customizations or custom workflows, allowing you
 * to delete inventory items in your custom flows.
 *
 * @example
 * const { result } = await deleteInventoryItemWorkflow(container)
 * .run({
 *   input: ["iitem_123"]
 * })
 *
 * @summary
 *
 * Delete one or more inventory items.
 */
export const deleteInventoryItemWorkflow = createWorkflow(
  deleteInventoryItemWorkflowId,
  (input: WorkflowData<DeleteInventoryItemWorkflowInput>): WorkflowResponse<
    DeleteInventoryItemWorkflowOutput
  > => {
    const { data: inventoryRows } = useQueryGraphStep({
      entity: "inventory",
      fields: ["id", "reserved_quantity"],
      filters: {
        id: input,
      },
    })
    // Dynamic Query fields are checked partial records, never a complete DTO.
    const inventoryItemsToDelete = transform(inventoryRows, (value) => Result.getOrThrow(decodeInventoryDeletionRows(value).pipe(
      Result.mapError(() => new WorkflowDefinitionError({ reason: "unsupportedProfile", detail: "Inventory deletion requires checked reserved quantities" })),
    )).map(row => ({ ...row })))

    validateInventoryDeleteStep({ inventory_items: inventoryItemsToDelete })

    deleteInventoryItemStep(input)
    removeRemoteLinkStep({
      [Modules.INVENTORY]: { inventory_item_id: input },
    })
    return new WorkflowResponse(input)
  }
)
