import { createStep, StepResponse } from "@medusajs/workflows-sdk"
import { IProductModuleService } from "@medusajs/types"
import { Modules } from "@medusajs/utils/modules-sdk/definition"

export const removeImagesFromVariantStepId = "remove-images-from-variant"

/**
 * This step removes one or more images from a product variant.
 *
 * @since 2.11.2
 *
 * @example
 * const data = removeImagesFromVariantStep({
 *   variant_id: "variant_123",
 *   remove: ["img_123", "img_456"]
 * })
 */
export const removeImagesFromVariantStep = createStep(
  { name: removeImagesFromVariantStepId, compensation: "transactionCovered" },
  async (input: { variant_id: string; remove: string[]; product_id?: string }, { container }) => {
    if (!input.remove.length) {
      return new StepResponse([], { removed: [], variant_id: input.variant_id, ...(input.product_id === undefined ? {} : { product_id: input.product_id }) })
    }

    const productModuleService = container.resolve<IProductModuleService>(
      Modules.PRODUCT
    )

    const data = input.remove.map((image_id) => ({
      image_id,
      variant_id: input.variant_id,
      ...(input.product_id === undefined ? {} : { product_id: input.product_id }),
    }))

    await productModuleService.removeImageFromVariant(data)

    return new StepResponse(input.remove, {
      removed: input.remove,
      variant_id: input.variant_id,
      ...(input.product_id === undefined ? {} : { product_id: input.product_id }),
    })
  },
  async (
    compensationData: { removed: string[]; variant_id: string; product_id?: string } | undefined,
    { container }
  ) => {
    if (!compensationData?.removed?.length || !compensationData?.variant_id) {
      return
    }

    const productModuleService = container.resolve<IProductModuleService>(
      Modules.PRODUCT
    )

    const data = compensationData.removed.map((image_id) => ({
      image_id,
      variant_id: compensationData.variant_id,
      ...(compensationData.product_id === undefined ? {} : { product_id: compensationData.product_id }),
    }))

    await productModuleService.addImageToVariant(data)
  }
)
