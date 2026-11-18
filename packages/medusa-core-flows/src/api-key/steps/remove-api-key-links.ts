import type { Link } from "@medusajs/modules-sdk/link"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils/portable"
import { createStep, StepResponse } from "@medusajs/workflows-sdk"

export const removeApiKeyLinksStepId = "remove-deleted-api-key-links"

/** API Key deletion is irreversible. The workflow must invoke this step only
 * after guarded key deletion succeeds; other modules keep their shared inverse. */
export const removeApiKeyLinksStep = createStep(
  { name: removeApiKeyLinksStepId },
  async (ids: string[], { container }) => {
    const link = container.resolve<Pick<Link, "delete">>(ContainerRegistrationKeys.LINK)
    const [errors] = await link.delete({
      [Modules.API_KEY]: { publishable_key_id: ids },
    })
    if (errors?.length) {
      throw new AggregateError(errors, "Failed to remove deleted API Key links")
    }
    return new StepResponse(void 0)
  }
)
