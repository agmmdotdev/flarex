import type {
  IProductModuleService,
  ProductTypes,
} from "@medusajs/types"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { getSelectsAndRelationsFromObjectArray } from "@medusajs/utils/common/get-selects-and-relations-from-object-array"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

/**
 * The data to identify and update the product options.
 */
export type UpdateProductOptionsStepInput = {
  /**
   * The filters to select the product options to update.
   */
  selector: ProductTypes.FilterableProductOptionProps
  /**
   * The data to update the product options with.
   */
  update: ProductTypes.UpdateProductOptionDTO
}

export const updateProductOptionsStepId = "update-product-options"
/**
 * This step updates product options matching the specified filters.
 *
 * @example
 * const data = updateProductOptionsStep({
 *   selector: {
 *     id: "popt_123"
 *   },
 *   update: {
 *     title: "Size"
 *   }
 * })
 */
export const updateProductOptionsStep = createStep(
  { name: updateProductOptionsStepId, compensation: "transactionCovered" },
  async (data: UpdateProductOptionsStepInput, { container }) => {
    const service = container.resolve<IProductModuleService>(Modules.PRODUCT)

    const { selects, relations } = getSelectsAndRelationsFromObjectArray([
      data.update,
    ])

    const prevData = await service.listProductOptions(data.selector, {
      select: selects,
      relations,
    })

    const productOptions = await service.updateProductOptions(
      data.selector,
      data.update
    )
    return new StepResponse(productOptions, prevData)
  },
  async (prevData, { container }) => {
    if (!prevData?.length) {
      return
    }

    const service = container.resolve<IProductModuleService>(Modules.PRODUCT)

    // SAFETY: this retained native compensation payload has existing IDs and
    // string Values. Its projected DTO preimages also retain read-only fields
    // and explicit undefined Product members that the narrower upsert type
    // omits. Transaction-covered execution settles through root rollback.
    await service.upsertProductOptions(
      prevData.map((o) => ({
        ...o,
        values: o.values?.map((v) => v.value),
        product: undefined,
        product_id: o.product_id ?? undefined,
      })) as ProductTypes.UpsertProductOptionDTO[]
    )
  }
)
