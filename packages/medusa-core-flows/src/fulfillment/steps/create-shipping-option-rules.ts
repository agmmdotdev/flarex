import type {
  AddFulfillmentShippingOptionRulesWorkflowDTO,
  IFulfillmentModuleService,
} from "@medusajs/types/fulfillment/index"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

export const createShippingOptionRulesStepId = "create-shipping-option-rules"
/**
 * This step creates one or more shipping option rules.
 */
export const createShippingOptionRulesStep = createStep(
  { name: createShippingOptionRulesStepId, compensation: "transactionCovered" },
  async (
    input: AddFulfillmentShippingOptionRulesWorkflowDTO,
    { container }
  ) => {
    const { data } = input

    const fulfillmentModule = container.resolve<IFulfillmentModuleService>(
      Modules.FULFILLMENT
    )

    const createdShippingOptionRules =
      await fulfillmentModule.createShippingOptionRules(data)

    return new StepResponse(
      createdShippingOptionRules,
      createdShippingOptionRules.map((pr) => pr.id)
    )
  },
  async (ruleIds, { container }) => {
    if (!ruleIds?.length) {
      return
    }

    const fulfillmentModule = container.resolve<IFulfillmentModuleService>(
      Modules.FULFILLMENT
    )

    await fulfillmentModule.deleteShippingOptionRules(ruleIds)
  }
)
