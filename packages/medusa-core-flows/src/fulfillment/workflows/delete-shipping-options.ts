import type { FulfillmentWorkflow } from "@medusajs/framework/types"
import {
  createWorkflow,
  parallelize,
  WorkflowData,
  WorkflowResponse,
} from "@medusajs/workflows-sdk"
import { deleteShippingOptionsStep } from "../steps/delete-shipping-options"
import { emitEventStep } from "../../common/steps/emit-event"
import { removeRemoteLinkStep, type DeleteEntityInput } from "../../common/steps/remove-remote-links"
import { ShippingOptionWorkflowEvents } from "@medusajs/framework/utils/portable"

export const deleteShippingOptionsWorkflowId =
  "delete-shipping-options-workflow"
/**
 * This workflow deletes one or more shipping options. It's used by the
 * [Delete Shipping Options Admin API Route](https://docs.medusajs.com/api/admin#shipping-options_deleteshippingoptionsid).
 *
 * You can use this workflow within your own customizations or custom workflows, allowing you to
 * delete shipping options within your custom flows.
 *
 * @example
 * const { result } = await deleteShippingOptionsWorkflow(container)
 * .run({
 *   input: {
 *     ids: ["so_123"]
 *   }
 * })
 *
 * @summary
 *
 * Delete one or more shipping options.
 */
export const deleteShippingOptionsWorkflow = createWorkflow(
  deleteShippingOptionsWorkflowId,
  (
    input: WorkflowData<FulfillmentWorkflow.DeleteShippingOptionsWorkflowInput>
  ) => {
    const softDeletedEntities = deleteShippingOptionsStep(input.ids)

    parallelize(
      // The genuine empty step supplies an SDK marker outside this DTO. The
      // selected private Link resource validates its exact grouped form.
      removeRemoteLinkStep(softDeletedEntities as WorkflowData<DeleteEntityInput>),
      emitEventStep({
        eventName: ShippingOptionWorkflowEvents.DELETED,
        data: input.ids,
      })
    )
    return new WorkflowResponse(void 0)
  }
)
