import type { IProductModuleService } from "@medusajs/types"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

export const removeImageFromVariantsStepId = "remove-image-from-variants"

/**
 * This step removes an image from one or more product variants.
 *
 * @since 2.11.2
 *
 * @example
 * const data = removeImageFromVariantsStep({
 *   image_id: "img_123",
 *   remove: ["variant_123", "variant_456"]
 * })
 */
export const removeImageFromVariantsStep = createStep(
  { name: removeImageFromVariantsStepId, compensation: "transactionCovered" },
  async (input: { image_id: string; remove: string[]; product_id?: string }, { container }) => {
    if (!input.remove.length) {
      return new StepResponse([], { removed: [], image_id: input.image_id, ...(input.product_id === undefined ? {} : { product_id: input.product_id }) })
    }

    const productModuleService = container.resolve<IProductModuleService>(
      Modules.PRODUCT
    )

    const data = input.remove.map((variant_id) => ({
      image_id: input.image_id,
      ...(input.product_id === undefined ? {} : { product_id: input.product_id }),
      variant_id,
    }))

    await productModuleService.removeImageFromVariant(data)

    return new StepResponse(input.remove, {
      removed: input.remove,
      image_id: input.image_id,
      ...(input.product_id === undefined ? {} : { product_id: input.product_id }),
    })
  },
  async (
    compensationData: { removed: string[]; image_id: string; product_id?: string } | undefined,
    { container }
  ) => {
    if (!compensationData?.removed?.length || !compensationData?.image_id) {
      return
    }

    const productModuleService = container.resolve<IProductModuleService>(
      Modules.PRODUCT
    )

    const data = compensationData.removed.map((variant_id) => ({
      image_id: compensationData.image_id,
      ...(compensationData.product_id === undefined ? {} : { product_id: compensationData.product_id }),
      variant_id,
    }))

    await productModuleService.addImageToVariant(data)
  }
)
