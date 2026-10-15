import {
  arrayDifference,
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils/portable"
import { createStep, StepResponse } from "@medusajs/workflows-sdk"

/**
 * The configurations to retrieve pricing links for product variants.
 */
export type GetVariantPricingLinkStepInput = {
  /**
   * The IDs of the product variants to retrieve pricing links for.
   */
  ids: string[]
}

export const getVariantPricingLinkStepId = "get-variant-pricing-link"
/**
 * This step retrieves links between a product variant and its linked price sets.
 */
export const getVariantPricingLinkStep = createStep(
  getVariantPricingLinkStepId,
  async (data: GetVariantPricingLinkStepInput, { container }) => {
    if (!data.ids.length) {
      return new StepResponse([])
    }

    // Portable capability seam: native service selection stays inside the
    // authenticated Link resource; its boundary returns JSON, not a service.
    const remoteLink = container.resolve<{
      listVariantPricing(filters: { variant_id: string[] }, config: { select: string[] }): Promise<{
        variant_id: string; price_set_id: string
      }[]>
    }>(ContainerRegistrationKeys.LINK)

    const existingItems = (await remoteLink.listVariantPricing(
      { variant_id: data.ids },
      { select: ["variant_id", "price_set_id"] }
    )) as {
      variant_id: string
      price_set_id: string
    }[]

    if (existingItems.length !== data.ids.length) {
      const missing = arrayDifference(
        data.ids,
        existingItems.map((i) => i.variant_id)
      )

      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Variants with IDs ${missing.join(", ")} do not have prices associated.`
      )
    }

    return new StepResponse(existingItems)
  }
)
