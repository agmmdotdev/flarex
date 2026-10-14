import type { Link } from "@medusajs/modules-sdk/link"
import { createStep, StepResponse } from "@medusajs/workflows-sdk"

import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils/portable"

/**
 * The data to detach stock locations from sales channels.
 */
export interface DetachLocationsFromSalesChannelsStepInput {
  /**
   * The links to dismiss between locations and sales channels.
   */
  links?: {
    /**
     * The ID of the sales channel.
     */
    sales_channel_id: string
    /**
     * The ID of the location.
     */
    location_id: string
  }[] | undefined
}

export const detachLocationsFromSalesChannelsStepId =
  "detach-locations-from-sales-channels"
/**
 * This step dismisses links between stock location and sales channel records.
 *
 * @example
 * const data = detachLocationsFromSalesChannelsStep({
 *   links: [
 *     {
 *       sales_channel_id: "sc_123",
 *       location_id: "sloc_123"
 *     }
 *   ]
 * })
 */
export const detachLocationsFromSalesChannelsStep = createStep(
  { name: detachLocationsFromSalesChannelsStepId, compensation: "transactionCovered" },
  async (data: DetachLocationsFromSalesChannelsStepInput, { container }) => {
    if (!data.links?.length) {
      return new StepResponse([], [])
    }

    const remoteLink = container.resolve<Pick<Link, "create" | "dismiss">>(ContainerRegistrationKeys.LINK)

    const links = data.links.map((link) => {
      return {
        [Modules.SALES_CHANNEL]: {
          sales_channel_id: link.sales_channel_id,
        },
        [Modules.STOCK_LOCATION]: {
          stock_location_id: link.location_id,
        },
      }
    })

    await remoteLink.dismiss(links)
    return new StepResponse(void 0, links)
  },
  async (links, { container }) => {
    if (!links?.length) {
      return
    }

    const remoteLink = container.resolve<Pick<Link, "create" | "dismiss">>(ContainerRegistrationKeys.LINK)
    await remoteLink.create(links)
  }
)
