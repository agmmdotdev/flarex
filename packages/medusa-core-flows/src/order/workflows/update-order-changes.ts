import {
  OrderChangeDTO,
  UpdateOrderChangeDTO,
} from "@medusajs/framework/types"
import {
  WorkflowData,
  WorkflowResponse,
  createWorkflow,
} from "@medusajs/workflows-sdk"
import { updateOrderChangesStep } from "../steps/update-order-changes"

export const updateOrderChangesWorkflowId = "update-order-change"
/**
 * This workflow updates one or more order changes.
 *
 * You can use this workflow within your customizations or your own custom workflows, allowing you to wrap custom logic around
 * updating order changes.
 *
 * @summary
 *
 * Update one or more order changes.
 */
export const updateOrderChangesWorkflow = createWorkflow(
  updateOrderChangesWorkflowId,
  (
    input: WorkflowData<UpdateOrderChangeDTO[]>
  ): WorkflowResponse<OrderChangeDTO[]> => {
    return new WorkflowResponse(updateOrderChangesStep(input))
  }
)
