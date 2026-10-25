import type { LinkWorkflowInput } from "@medusajs/framework/types"
import type { Link } from "@medusajs/modules-sdk/link"
import {
  ContainerRegistrationKeys,
} from "@medusajs/framework/utils/portable"
import { createStep } from "@medusajs/workflows-sdk"
import { applyApiKeyLinkOperation } from "../utils/link-operation"

/**
 * The data to manage the sales channels of a publishable API key.
 *
 * @property id - The ID of the publishable API key.
 * @property add - The sales channel IDs to add to the publishable API key.
 * @property remove - The sales channel IDs to remove from the publishable API key.
 */
export type LinkSalesChannelsToApiKeyStepInput = LinkWorkflowInput

export const linkSalesChannelsToApiKeyStepId = "link-sales-channels-to-api-key"
/**
 * This step manages the sales channels of a publishable API key.
 *
 * @example
 * const data = linkSalesChannelsToApiKeyStep({
 *   id: "apk_123",
 *   add: ["sc_123"],
 *   remove: ["sc_456"]
 * })
 */
export const linkSalesChannelsToApiKeyStep = createStep(
  { name: linkSalesChannelsToApiKeyStepId, compensation: "transactionCovered" },
  async (input: LinkSalesChannelsToApiKeyStepInput, { container, idempotencyKey }) => {
    const remoteLink = container.resolve<Pick<Link, "applyOperation">>(ContainerRegistrationKeys.LINK)
    if (!input || (!input.add?.length && !input.remove?.length)) {
      return
    }

    return await applyApiKeyLinkOperation(remoteLink, input, idempotencyKey)
  },
  async (prevData, { container }) => {
    if (!prevData) {
      return
    }

    const remoteLink = container.resolve<Pick<Link, "compensateOperation">>(ContainerRegistrationKeys.LINK)
    await remoteLink.compensateOperation(prevData)
  }
)
