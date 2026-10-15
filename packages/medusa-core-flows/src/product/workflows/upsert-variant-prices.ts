import {
  CreatePricesDTO,
  UpdatePricesDTO,
  CreatePriceSetDTO,
  PricingTypes,
} from "@medusajs/framework/types"
import { Modules, arrayDifference } from "@medusajs/framework/utils/portable"
import {
  WorkflowData,
  WorkflowResponse,
  createWorkflow,
  transform,
} from "@medusajs/workflows-sdk"
import { removeRemoteLinkStep } from "../../common/steps/remove-remote-links"
import { useRemoteQueryStep } from "../../common/steps/use-remote-query"
import { createPriceSetsStep } from "../../pricing/steps/create-price-sets"
import { updatePriceSetsStep } from "../../pricing/steps/update-price-sets"
import { createVariantPricingLinkStep } from "../steps/create-variant-pricing-link"
import { currentVariantPricingLinks } from "./product-update-query"

/**
 * The data to create, update, or remove variants' prices.
 */
export type UpsertVariantPricesWorkflowInput = {
  /**
   * The variants to create or update prices for.
   */
  variantPrices: {
    /**
     * The ID of the variant to create or update prices for.
     */
    variant_id: string
    /**
     * The ID of the product the variant belongs to.
     */
    product_id: string
    /**
     * The prices to create or update for the variant.
     */
    prices?: (CreatePricesDTO | UpdatePricesDTO)[] | undefined
  }[]
  /**
   * The IDs of the variants to remove all their prices.
   */
  previousVariantIds: string[]
}

export const upsertVariantPricesWorkflowId = "upsert-variant-prices"
/**
 * This workflow creates, updates, or removes variants' prices. It's used by the {@link updateProductsWorkflow}
 * when updating a variant's prices.
 *
 * You can use this workflow within your own customizations or custom workflows to manage the prices of a variant.
 *
 * @example
 * const { result } = await upsertVariantPricesWorkflow(container)
 * .run({
 *   input: {
 *     variantPrices: [
 *       {
 *         variant_id: "variant_123",
 *         product_id: "prod_123",
 *         prices: [
 *           {
 *             amount: 10,
 *             currency_code: "usd",
 *           },
 *           {
 *             id: "price_123",
 *             amount: 20,
 *           }
 *         ]
 *       }
 *     ],
 *     // these are variants to remove all their prices
 *     // typically used when a variant is deleted.
 *     previousVariantIds: ["variant_321"]
 *   }
 * })
 *
 * @summary
 *
 * Create, update, or remove variants' prices.
 */
export const upsertVariantPricesWorkflow = createWorkflow(
  upsertVariantPricesWorkflowId,
  (
    input: WorkflowData<UpsertVariantPricesWorkflowInput>
  ): WorkflowResponse<void> => {
    const removedVariantIds = transform({ input }, (data) => {
      return arrayDifference(
        data.input.previousVariantIds,
        data.input.variantPrices.map((v) => v.variant_id)
      )
    })

    removeRemoteLinkStep({
      [Modules.PRODUCT]: { variant_id: removedVariantIds },
    }).config({ name: "remove-variant-link-step" })

    const { newVariants, existingVariants } = transform({ input }, (data) => {
      const previousMap = new Set(data.input.previousVariantIds.map((v) => v))

      return {
        existingVariants: data.input.variantPrices.filter((v) =>
          previousMap.has(v.variant_id)
        ),
        newVariants: data.input.variantPrices.filter(
          (v) => !previousMap.has(v.variant_id)
        ),
      }
    })

    const existingVariantIds = transform({ existingVariants }, (data) =>
      data.existingVariants.map((v) => v.variant_id)
    )

    const existingLinks = transform(useRemoteQueryStep({
      entry_point: "product_variant_price_set",
      fields: ["variant_id", "price_set_id"],
      variables: { filters: { variant_id: existingVariantIds } },
    }), currentVariantPricingLinks)

    const pricesToUpdate = transform(
      { existingVariants, existingLinks },
      (data) => {
        const linksMap = new Map(
          data.existingLinks.map((l) => [l.variant_id, l.price_set_id])
        )

        return {
          price_sets: data.existingVariants
            .map((v) => {
              const priceSetId = linksMap.get(v.variant_id)

              if (!priceSetId || !v.prices) {
                return
              }

              // The named Pricing method decodes native create/partial-update
              // prices. The pinned DTO incorrectly narrows this upsert member
              // to create-only amounts; keep the native values unchanged.
              return {
                id: priceSetId,
                prices: v.prices,
              } as PricingTypes.UpsertPriceSetDTO
            })
            .filter((value): value is NonNullable<typeof value> => value !== undefined),
        }
      }
    )

    updatePriceSetsStep(pricesToUpdate)

    // Note: We rely on the same order of input and output when creating variants here, make sure that assumption holds
    const pricesToCreate = transform({ newVariants }, (data) =>
      data.newVariants.map((v) => {
        return {
          prices: v.prices,
        } as CreatePriceSetDTO
      })
    )

    const createdPriceSets = createPriceSetsStep(pricesToCreate)

    const variantAndPriceSetLinks = transform(
      { newVariants, createdPriceSets },
      (data) => {
        return {
          links: data.newVariants.map((variant, i) => ({
            variant_id: variant.variant_id,
            price_set_id: data.createdPriceSets[i]!.id,
          })),
        }
      }
    )

    createVariantPricingLinkStep(variantAndPriceSetLinks)
    return new WorkflowResponse(undefined)
  }
)
