import {
  FilterablePaymentCollectionProps,
  IPaymentModuleService,
  PaymentCollectionUpdatableFields,
} from "@medusajs/framework/types"
import {
  Modules,
  getSelectsAndRelationsFromObjectArray,
  isPresent,
} from "@medusajs/framework/utils/portable"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

/**
 * The data to update a payment collection.
 */
export interface UpdatePaymentCollectionStepInput {
  /**
   * The filters to select the payment collections to update.
   */
  selector: FilterablePaymentCollectionProps
  /**
   * The data to update in the selected payment collections.
   */
  update: PaymentCollectionUpdatableFields
}

export const updatePaymentCollectionStepId = "update-payment-collection"
/**
 * This step updates payment collections matching the specified filters.
 *
 * @example
 * const data = updatePaymentCollectionStep({
 *   selector: {
 *     id: "paycol_123",
 *   },
 *   update: {
 *     amount: 10,
 *   }
 * })
 */
export const updatePaymentCollectionStep = createStep(
  { name: updatePaymentCollectionStepId, compensation: "transactionCovered" },
  async (data: UpdatePaymentCollectionStepInput | undefined, { container }) => {
    if (data === undefined || !isPresent(data) || !isPresent(data.selector)) {
      return new StepResponse([], [])
    }

    const paymentModuleService = container.resolve<IPaymentModuleService>(
      Modules.PAYMENT
    )

    const { selects, relations } = getSelectsAndRelationsFromObjectArray([
      data.update,
    ], { objectFields: ["amount"] })

    const prevData = await paymentModuleService.listPaymentCollections(
      data.selector,
      {
        select: selects,
        relations,
      }
    )

    const updated = await paymentModuleService.updatePaymentCollections(
      data.selector,
      data.update
    )

    return new StepResponse(updated, prevData)
  },
  async (prevData, { container }) => {
    if (!prevData?.length) {
      return
    }
    const paymentModuleService = container.resolve<IPaymentModuleService>(
      Modules.PAYMENT
    )

    await Reflect.apply(paymentModuleService.upsertPaymentCollections, paymentModuleService, [
      prevData.map((pc) => ({
        id: pc.id,
        amount: pc.amount === undefined ? undefined : ("raw_amount" in pc ? pc.raw_amount : undefined) ?? pc.amount,
        currency_code: pc.currency_code,
        metadata: pc.metadata,
      }))
    ])
  }
)
