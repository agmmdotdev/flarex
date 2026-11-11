import { applyTranslations } from "@medusajs/utils/translations/apply-translations"
import { createStep, StepResponse } from "@medusajs/workflows-sdk"
import { decodeNativePricedShippingOptions } from "./cart-mutation-shipping-query-views"

export const getTranslatedShippingOptionsStepId =
  "get-translated-shipping-options"

export interface GetTranslatedShippingOptionsStepInput {
  /**
   * The shipping options to be translated.
   */
  shippingOptions: readonly Readonly<Record<string, unknown>>[]
  /**
   * The locale code following the [IETF BCP 47 standard](https://gist.github.com/typpo/b2b828a35e683b9bf8db91b5404f1bd1).
   */
  locale: string | null | undefined
}

/**
 * This step applies translations to a list of shipping options based on the provided locale.
 * It modifies the shipping options in place and returns them.
 *
 * @since 2.12.4
 *
 * @example
 * const translatedShippingOptions = getTranslatedShippingOptionsStep({
 *   shippingOptions: [
 *     {
 *       id: "so_123",
 *       name: "Standard Shipping",
 *       // ...
 *     }
 *   ],
 *   locale: "fr-FR"
 * })
 */
export const getTranslatedShippingOptionsStep = createStep(
  getTranslatedShippingOptionsStepId,
  async (data: GetTranslatedShippingOptionsStepInput, { container }) => {
    const shippingOptions = decodeNativePricedShippingOptions(data.shippingOptions)
    await applyTranslations({
      localeCode: data.locale,
      objects: shippingOptions,
      container,
    })

    return new StepResponse(shippingOptions)
  }
)
