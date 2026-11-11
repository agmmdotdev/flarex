import {
  CalculateShippingOptionPriceDTO,
  IFulfillmentModuleService,
} from "@medusajs/types"
import { Modules } from "@medusajs/framework/utils/portable"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"
import { decodeNativeShippingPrices, type NativeShippingOptionPriceInput } from "../../common/steps/cart-mutation-shipping-query-views"

/**
 * The data to calculate the prices for one or more shipping options.
 */
export type CalculateShippingOptionsPriceStepInput =
  NativeShippingOptionPriceInput[]

export const calculateShippingOptionsPricesStepId =
  "calculate-shipping-options-prices"
/**
 * This step calculates the prices for one or more shipping options.
 *
 * @example
 * const data = calculateShippingOptionsPricesStep([{
 *   id: "so_123",
 *   provider_id: "provider_123",
 *   optionData: {
 *     // custom data relevant for the fulfillment provider
 *     carrier_code: "UPS",
 *   },
 *   data: {
 *     // custom data relevant for the fulfillment provider
 *     // specific to the cart using this shipping option
 *   },
 *   context: {
 *     from_location: {
 *       id: "sloc_123",
 *       // other location fields
 *     }
 *   }
 * }])
 */
export const calculateShippingOptionsPricesStep = createStep(
  calculateShippingOptionsPricesStepId,
  async (input: CalculateShippingOptionsPriceStepInput, { container }) => {
    const service = container.resolve<IFulfillmentModuleService>(
      Modules.FULFILLMENT
    )

    const prices = decodeNativeShippingPrices(await Reflect.apply(service.calculateShippingOptionsPrices, service, [input]))

    return new StepResponse(prices)
  }
)
