import type {
  PriceDTO,
  PriceListPriceUpdateCompensation,
  PriceListPriceUpdateModuleService,
  PriceListPriceUpdateWorkflowData,
  UpdatePriceListPriceDTO,
  UpdatePriceListPricesDTO,
} from "@medusajs/types"
import { Modules } from "@medusajs/framework/utils/portable"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

export const updatePriceListPricesStepId = "update-price-list-prices"

export interface UpdatePriceListPricesStepInput {
  data: PriceListPriceUpdateWorkflowData[]
  variant_price_map: Record<string, string> | undefined
}

/** Approved native compensation correction: retain complete detached graphs,
 * and restore through Pricing without re-normalizing old identities/rules. */
export const updatePriceListPricesStep = createStep(
  { name: updatePriceListPricesStepId, compensation: "transactionCovered" },
  async (stepInput: UpdatePriceListPricesStepInput, { container }) => {
    const { data = [], variant_price_map: variantPriceSetMap } = stepInput
    const priceListPricesToUpdate: UpdatePriceListPricesDTO[] = []
    const pricingModule = container.resolve<PriceListPriceUpdateModuleService>(
      Modules.PRICING
    )

    for (const priceListData of data) {
      const pricesToUpdate: UpdatePriceListPriceDTO[] = []
      const { prices = [], id } = priceListData
      for (const price of prices) {
        const toPush = {
          ...price,
          // As in the pinned callback, nonempty work requires the validator map.
          price_set_id: variantPriceSetMap![price.variant_id!],
        } as UpdatePriceListPriceDTO
        delete (toPush as Partial<typeof price>).variant_id
        pricesToUpdate.push(toPush)
      }
      priceListPricesToUpdate.push({ price_list_id: id, prices: pricesToUpdate })
    }

    const empty: PriceListPriceUpdateCompensation = { before: [], createdPriceIds: [] }
    if (!priceListPricesToUpdate.length) {
      return new StepResponse<PriceDTO[], PriceListPriceUpdateCompensation>([], empty)
    }

    const snapshot = await pricingModule.snapshotPriceListPricesForUpdate(
      priceListPricesToUpdate
    )
    const updatedPrices = await pricingModule.updatePriceListPrices(
      priceListPricesToUpdate
    )
    const affected = new Set(updatedPrices.map(price => price.id))
    const previous = new Map(snapshot.prices.map(price => [price.id, price]))
    const before = snapshot.prices.filter(price => affected.has(price.id))
    const createdPriceIds = [...affected].filter(id => !previous.has(id))
    return new StepResponse(updatedPrices, { before, createdPriceIds })
  },
  async (data: PriceListPriceUpdateCompensation | undefined, { container }) => {
    if (!data || !data.before.length && !data.createdPriceIds.length) return
    const pricingModule = container.resolve<PriceListPriceUpdateModuleService>(
      Modules.PRICING
    )
    await pricingModule.restorePriceListPrices(data)
  }
)
