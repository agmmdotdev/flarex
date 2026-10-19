import type { LinkWorkflowInput } from "@medusajs/types"
import { type WorkflowData, createWorkflow, WorkflowResponse, transform } from "@medusajs/workflows-sdk"
import { associateProductsWithSalesChannelsStep } from "../steps/associate-products-with-channels"
import { detachProductsFromSalesChannelsStep } from "../steps/detach-products-from-sales-channels"

/**
 * The data to manage products available in a sales channel.
 *
 * @property id - The ID of the sales channel.
 * @property add - The products to add to the sales channel.
 * @property remove - The products to remove from the sales channel.
 */
export type LinkProductsToSalesChannelWorkflowInput = LinkWorkflowInput

export const linkProductsToSalesChannelWorkflowId =
  "link-products-to-sales-channel"
/**
 * This workflow manages the products available in a sales channel. It's used by the
 * [Manage Products Admin API Route](https://docs.medusajs.com/api/admin#sales-channels_postsaleschannelsidproducts).
 *
 * You can use this workflow within your customizations or your own custom workflows, allowing you to
 * manage the products available in a sales channel within your custom flows.
 *
 * @example
 * const { result } = await linkProductsToSalesChannelWorkflow(container)
 * .run({
 *   input: {
 *     id: "sc_123",
 *     add: ["prod_123"],
 *     remove: ["prod_321"]
 *   }
 * })
 *
 * @summary
 *
 * Manage the products available in a sales channel.
 */
export const linkProductsToSalesChannelWorkflow = createWorkflow(
  linkProductsToSalesChannelWorkflowId,
  (
    input: WorkflowData<LinkProductsToSalesChannelWorkflowInput>
  ) => {
    const toAdd = transform({ input }, (data) => {
      return { links: data.input.add?.map((productId) => ({
        sales_channel_id: data.input.id,
        product_id: productId,
      })) }
    })

    const toRemove = transform({ input }, (data) => {
      return { links: data.input.remove?.map((productId) => ({
        sales_channel_id: data.input.id,
        product_id: productId,
      })) }
    })

    associateProductsWithSalesChannelsStep(toAdd)
    detachProductsFromSalesChannelsStep(toRemove)
    return new WorkflowResponse(void 0)
  }
)
