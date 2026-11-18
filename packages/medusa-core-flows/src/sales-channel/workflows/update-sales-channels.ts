import type {
  FilterableSalesChannelProps,
  SalesChannelDTO,
  UpdateSalesChannelDTO,
} from "@medusajs/types"
import { SalesChannelWorkflowEvents } from "@medusajs/utils/core-flows/events"
import {
  type WorkflowData,
  type WorkflowDefinition,
  WorkflowResponse,
  createWorkflow,
  transform,
} from "@medusajs/workflows-sdk"
import { emitEventStep } from "../../common/steps/emit-event"
import { updateSalesChannelsStep } from "../steps/update-sales-channels"

/**
 * The data to update sales channels.
 */
export type UpdateSalesChannelsWorkflowInput = {
  /**
   * The filters to select the sales channels to update.
   */
  selector: FilterableSalesChannelProps
  /**
   * The data to update the sales channels.
   */
  update: UpdateSalesChannelDTO
}

/**
 * The native first updated sales channel, or undefined before the native
 * event transform fails for an empty match set.
 */
export type UpdateSalesChannelsWorkflowOutput = SalesChannelDTO | undefined

export const updateSalesChannelsWorkflowId = "update-sales-channels"
/**
 * This workflow updates sales channels matching the specified conditions. It's used by the
 * [Update Sales Channel Admin API Route](https://docs.medusajs.com/api/admin#sales-channels_postsaleschannelsid).
 *
 * You can use this workflow within your customizations or your own custom workflows, allowing you to
 * update sales channels within your custom flows.
 *
 * @example
 * const { result } = await updateSalesChannelsWorkflow(container)
 * .run({
 *   input: {
 *     selector: {
 *       id: "sc_123"
 *     },
 *     update: {
 *       name: "Webshop"
 *     }
 *   }
 * })
 *
 * @summary
 *
 * Update sales channels.
 */
export const updateSalesChannelsWorkflow: WorkflowDefinition<
  UpdateSalesChannelsWorkflowInput,
  WorkflowData<UpdateSalesChannelsWorkflowOutput>,
  readonly []
> = createWorkflow(
  updateSalesChannelsWorkflowId,
  (
    input: WorkflowData<UpdateSalesChannelsWorkflowInput>
  ): WorkflowResponse<WorkflowData<UpdateSalesChannelsWorkflowOutput>> => {
    const updatedSalesChannels = updateSalesChannelsStep(input)

    const salesChannelIdEvents = transform(
      { updatedSalesChannels },
      ({ updatedSalesChannels }) => {
        const arr = Array.isArray(updatedSalesChannels)
          ? updatedSalesChannels
          : [updatedSalesChannels]
        return arr?.map((salesChannel) => {
          return { id: salesChannel.id }
        })
      }
    )

    emitEventStep({
      eventName: SalesChannelWorkflowEvents.UPDATED,
      data: salesChannelIdEvents,
    })

    return new WorkflowResponse(updatedSalesChannels)
  }
)
