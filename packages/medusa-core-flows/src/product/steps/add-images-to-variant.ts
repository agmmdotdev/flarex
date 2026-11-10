import { createStep, StepResponse } from "@medusajs/workflows-sdk"
import { IProductModuleService } from "@medusajs/types"
import { Modules } from "@medusajs/utils/modules-sdk/definition"

export const addImagesToVariantStepId = "add-images-to-variant"

/**
 * This step adds one or more images to a product variant.
 *
 * @since 2.11.2
 *
 * @example
 * const data = addImagesToVariantStep({
 *   variant_id: "variant_123",
 *   add: ["img_123", "img_456"]
 * })
 */
export const addImagesToVariantStep = createStep(
  { name: addImagesToVariantStepId, compensation: "transactionCovered" },
  async (input: { variant_id: string; add: string[]; product_id?: string }, { container }) => {
    if (!input.add.length) {
      return new StepResponse([], { added: [], variant_id: input.variant_id, ...(input.product_id === undefined ? {} : { product_id: input.product_id }) })
    }

    const productModuleService = container.resolve<IProductModuleService>(
      Modules.PRODUCT
    )

    const data = input.add.map((image_id) => ({
      image_id,
      variant_id: input.variant_id,
      ...(input.product_id === undefined ? {} : { product_id: input.product_id }),
    }))

    await productModuleService.addImageToVariant(data)

    return new StepResponse(input.add, {
      added: input.add,
      variant_id: input.variant_id,
      ...(input.product_id === undefined ? {} : { product_id: input.product_id }),
    })
  },
  async (
    compensationData: { added: string[]; variant_id: string; product_id?: string } | undefined,
    { container }
  ) => {
    if (!compensationData?.added?.length || !compensationData?.variant_id) {
      return
    }

    const productModuleService = container.resolve<IProductModuleService>(
      Modules.PRODUCT
    )

    const data = compensationData.added.map((image_id) => ({
      image_id,
      variant_id: compensationData.variant_id,
      ...(compensationData.product_id === undefined ? {} : { product_id: compensationData.product_id }),
    }))

    await productModuleService.removeImageFromVariant(data)
  }
)
