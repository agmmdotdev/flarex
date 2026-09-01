import { createStep, StepResponse } from "@medusajs/workflows-sdk"

import { ContainerRegistrationKeys } from "@medusajs/utils/common/container"

export type DeleteEntityInput = {
  [moduleName: string]: Record<string, string | string[]>
}

type RemoveRemoteLinksStepInput = DeleteEntityInput | DeleteEntityInput[]

type RemoteLinkService = {
  delete(removedServices: DeleteEntityInput): Promise<unknown>
  restore(removedServices: DeleteEntityInput): Promise<unknown>
}

export const removeRemoteLinkStepId = "remove-remote-links"
/**
 * This step deletes linked records of a record if cascade deletion is enabled.
 *
 * Learn more in the [Link documentation](https://docs.medusajs.com/learn/fundamentals/module-links/link#cascade-delete-linked-records)
 *
 * @example
 * removeRemoteLinkStep([{
 *   [Modules.PRODUCT]: {
 *     product_id: "prod_123",
 *   },
 * }])
 */
export const removeRemoteLinkStep = createStep(
  removeRemoteLinkStepId,
  async (data: RemoveRemoteLinksStepInput, { container }) => {
    const entries = Array.isArray(data) ? data : [data]

    if (!entries.length) {
      return new StepResponse(void 0)
    }

    const grouped: DeleteEntityInput = {}

    for (const entry of entries) {
      for (const moduleName of Object.keys(entry)) {
        grouped[moduleName] ??= {}

        for (const linkableKey of Object.keys(entry[moduleName])) {
          grouped[moduleName][linkableKey] ??= []

          const incomingValue = entry[moduleName][linkableKey]
          const incomingKeys = Array.isArray(incomingValue)
            ? incomingValue
            : [incomingValue]
          const currentValue = grouped[moduleName][linkableKey]
          const currentKeys = Array.isArray(currentValue)
            ? currentValue
            : [currentValue]

          grouped[moduleName][linkableKey] = currentKeys.concat(incomingKeys)
        }
      }
    }

    const link = container.resolve<RemoteLinkService>(
      ContainerRegistrationKeys.LINK
    )
    await link.delete(grouped)

    return new StepResponse(grouped, grouped)
  },
  async (removedLinks, { container }) => {
    if (!removedLinks) {
      return
    }

    const link = container.resolve<RemoteLinkService>(
      ContainerRegistrationKeys.LINK
    )
    await link.restore(removedLinks)
  }
)
