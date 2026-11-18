import type {
  IFulfillmentModuleService,
  UpdateFulfillmentShippingOptionRulesWorkflowDTO,
  UpdateShippingOptionRuleDTO,
} from "@medusajs/types/fulfillment/index"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

export const updateShippingOptionRulesStepId = "update-shipping-option-rules"
/**
 * This step updates one or more shipping option rules.
 *
 * @example
 * const data = updateShippingOptionRulesStep({
 *   data: [
 *     {
 *       id: "sor_123",
 *       operator: "in"
 *     }
 *   ]
 * })
 */
export const updateShippingOptionRulesStep = createStep(
  { name: updateShippingOptionRulesStepId, compensation: "transactionCovered" },
  async (
    input: UpdateFulfillmentShippingOptionRulesWorkflowDTO,
    { container }
  ) => {
    if (!input.data?.length) {
      return
    }

    const { data } = input

    const fulfillmentModule = container.resolve<IFulfillmentModuleService>(
      Modules.FULFILLMENT
    )

    const ids = data.map((d) => d.id)
    const shippingOptionRules = await fulfillmentModule.listShippingOptionRules(
      { id: ids },
      { select: ["id", "attribute", "operator", "value", "shipping_option_id"] }
    )

    const updatedPromotionRules =
      await fulfillmentModule.updateShippingOptionRules(data)

    return new StepResponse(
      updatedPromotionRules,
      shippingOptionRules as unknown as UpdateShippingOptionRuleDTO[]
    )
  },
  async (previousRulesData, { container }) => {
    if (!previousRulesData?.length) {
      return
    }

    const fulfillmentModule = container.resolve<IFulfillmentModuleService>(
      Modules.FULFILLMENT
    )

    await fulfillmentModule.updateShippingOptionRules(previousRulesData)
  }
)
