import type { ISalesChannelModuleService } from "@medusajs/types"
import { Modules } from "@medusajs/framework/utils/portable"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

/**
 * The IDs of the sales channels to delete.
 */
export type DeleteSalesChannelsStepInput = string[]

export const deleteSalesChannelsStepId = "delete-sales-channels"
/**
 * This step deletes one or more sales channels.
 */
export const deleteSalesChannelsStep = createStep(
  { name: deleteSalesChannelsStepId, compensation: "transactionCovered" },
  async (ids: DeleteSalesChannelsStepInput, { container }) => {
    const service = container.resolve<ISalesChannelModuleService>(
      Modules.SALES_CHANNEL
    )

    await service.softDeleteSalesChannels(ids)

    return new StepResponse(void 0, ids)
  },
  async (prevSalesChannelIds, { container }) => {
    if (!prevSalesChannelIds?.length) {
      return
    }

    const service = container.resolve<ISalesChannelModuleService>(
      Modules.SALES_CHANNEL
    )

    await service.restoreSalesChannels(prevSalesChannelIds)
  }
)
