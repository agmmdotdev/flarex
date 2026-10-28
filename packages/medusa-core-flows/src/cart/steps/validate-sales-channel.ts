import { MedusaError } from "@medusajs/framework/utils/portable"
import { createStep, StepResponse } from "@medusajs/workflows-sdk"

import type { SalesChannelDTO } from "@medusajs/types"

export const validateSalesChannelStep = createStep(
  "validate-sales-channel",
  async (data: { salesChannel: SalesChannelDTO | null | undefined }) => {
    const { salesChannel } = data

    if (!salesChannel?.id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Sales channel is required when creating a cart. Either provide a sales channel ID or set the default sales channel for the store."
      )
    }

    return new StepResponse(void 0)
  }
)
