import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { SalesChannelWorkflowEvents } from "@medusajs/utils/core-flows/events"
import {
  createWorkflow,
  WorkflowResponse,
  transform,
  WorkflowData,
} from "@medusajs/workflows-sdk"
import { emitEventStep } from "../../common/steps/emit-event"
import { removeRemoteLinkStep } from "../../common/steps/remove-remote-links"
import { deleteSalesChannelsStep } from "../steps/delete-sales-channels"
import { canDeleteSalesChannelsOrThrowStep } from "../steps/can-delete-sales-channels"

/**
 * The data to delete sales channels.
 */
export type DeleteSalesChannelsWorkflowInput = {
  /**
   * The IDs of the sales channels to delete.
   */
  ids: string[]
}

export const deleteSalesChannelsWorkflowId = "delete-sales-channels"
/**
 * This workflow deletes one or more sales channels. It's used by the
 * [Delete Sales Channel Admin API Route](https://docs.medusajs.com/api/admin#sales-channels_deletesaleschannelsid).
 *
 * You can use this workflow within your customizations or your own custom workflows, allowing you to
 * delete sales channels within your custom flows.
 *
 * @example
 * const { result } = await deleteSalesChannelsWorkflow(container)
 * .run({
 *   input: {
 *     ids: ["sc_123"],
 *   }
 * })
 *
 * @summary
 *
 * Delete sales channels.
 */
export const deleteSalesChannelsWorkflow = createWorkflow(
  deleteSalesChannelsWorkflowId,
  (
    input: WorkflowData<DeleteSalesChannelsWorkflowInput>
  ) => {
    canDeleteSalesChannelsOrThrowStep({ ids: input.ids })
    deleteSalesChannelsStep(input.ids)

    removeRemoteLinkStep({
      [Modules.SALES_CHANNEL]: { sales_channel_id: input.ids },
    })

    const salesChannelsIdEvents = transform({ input }, ({ input }) => {
      return input.ids?.map((id) => {
        return { id }
      })
    })

    emitEventStep({
      eventName: SalesChannelWorkflowEvents.DELETED,
      data: salesChannelsIdEvents,
    })

    return new WorkflowResponse(void 0)
  }
)
