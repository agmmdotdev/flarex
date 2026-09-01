import type { LinkDefinition } from "@medusajs/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/workflows-sdk"

type RemoteLinkService = {
  create(links: LinkDefinition[]): Promise<void>
  dismiss(links: LinkDefinition[]): Promise<void>
}

export const createLinksStepId = "create-remote-links"
/**
 * This step creates links between two records of linked data models.
 *
 * Learn more in the [Link documentation.](https://docs.medusajs.com/learn/fundamentals/module-links/link#create-link).
 *
 * @example
 * createRemoteLinkStep([{
 *   [Modules.PRODUCT]: {
 *     product_id: "prod_123",
 *   },
 *   blog: {
 *     post_id: "post_123",
 *   },
 * }])
 */
export const createRemoteLinkStep = createStep(
  createLinksStepId,
  async (data: LinkDefinition[], { container }) => {
    const link = container.resolve<RemoteLinkService>(
      ContainerRegistrationKeys.LINK
    )

    if (!data.length) {
      return new StepResponse([], [])
    }

    await link.create(data)

    return new StepResponse(data, data)
  },
  async (createdLinks, { container }) => {
    if (!createdLinks) {
      return
    }

    const link = container.resolve<RemoteLinkService>(
      ContainerRegistrationKeys.LINK
    )
    await link.dismiss(createdLinks)
  }
)
