import type { IFulfillmentModuleService } from "@medusajs/types"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { createStep, StepResponse } from "@medusajs/workflows-sdk"

/**
 * The IDs of the shipping option types to delete.
 */
export type DeleteShippingOptionTypesStepInput = string[]

export const deleteShippingOptionTypesStepId = "delete-shipping-option-types"
/**
 * This step deletes one or more shipping option types.
 *
 * @since 2.10.0
 */
export const deleteShippingOptionTypesStep = createStep(
  { name: deleteShippingOptionTypesStepId, compensation: "transactionCovered" },
  async (ids: DeleteShippingOptionTypesStepInput, { container }) => {
    const service = container.resolve<IFulfillmentModuleService>(
      Modules.FULFILLMENT
    )

    await service.softDeleteShippingOptionTypes(ids)
    return new StepResponse(void 0, ids)
  },
  async (prevIds, { container }) => {
    if (!prevIds?.length) {
      return
    }

    const service = container.resolve<IFulfillmentModuleService>(
      Modules.FULFILLMENT
    )

    await service.restoreShippingOptionTypes(prevIds)
  }
)
