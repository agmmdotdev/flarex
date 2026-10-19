import { WorkflowData, WorkflowResponse, createWorkflow } from "@medusajs/workflows-sdk"
import { cancelFulfillmentStep } from "../steps/cancel-fulfillment"

/**
 * The data to cancel a fulfillment.
 */
export type CancelFulfillmentWorkflowInput = {
  /**
   * The ID of the fulfillment to cancel.
   */
  id: string
}

export const cancelFulfillmentWorkflowId = "cancel-fulfillment-workflow"
/**
 * This workflow cancels a fulfillment. It's used by the
 * [Cancel Fulfillment Admin API Route](https://docs.medusajs.com/api/admin#fulfillments_postfulfillmentsidcancel).
 *
 * You can use this workflow within your own customizations or custom workflows, allowing you to
 * cancel a fulfillment within your custom flows.
 *
 * @example
 * const { result } = await cancelFulfillmentWorkflow(container)
 * .run({
 *   input: {
 *     id: "ful_123"
 *   }
 * })
 *
 * @summary
 *
 * Cancel a fulfillment.
 */
export const cancelFulfillmentWorkflow = createWorkflow(
  cancelFulfillmentWorkflowId,
  (input: WorkflowData<CancelFulfillmentWorkflowInput>) => {
    cancelFulfillmentStep(input.id)
    return new WorkflowResponse(void 0)
  }
)
