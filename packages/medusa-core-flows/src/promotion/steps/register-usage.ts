import type { PromotionTypes } from "@medusajs/framework/types"
type CampaignBudgetUsageContext = PromotionTypes.CampaignBudgetUsageContext
type IPromotionModuleService = PromotionTypes.IPromotionModuleService
type UsageComputedActions = PromotionTypes.UsageComputedActions
import { Modules } from "@medusajs/framework/utils/portable"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

export const registerUsageStepId = "register-usage"

type RegisterUsageStepInput = {
  computedActions: UsageComputedActions[]
  registrationContext: CampaignBudgetUsageContext
}
/**
 * This step registers usage for a promotion.
 */
export const registerUsageStep = createStep(
  { name: registerUsageStepId, compensation: "transactionCovered" },
  async (data: RegisterUsageStepInput, { container }) => {
    if (!data.computedActions.length) {
      return new StepResponse(null, {
        computedActions: [],
        registrationContext: data.registrationContext,
      })
    }

    const promotionModule = container.resolve<IPromotionModuleService>(
      Modules.PROMOTION
    )

    await promotionModule.registerUsage(
      data.computedActions,
      data.registrationContext
    )

    return new StepResponse(null, data)
  },
  async (revertData, { container }) => {
    if (!revertData?.computedActions.length) {
      return
    }

    const promotionModule = container.resolve<IPromotionModuleService>(
      Modules.PROMOTION
    )

    await promotionModule.revertUsage(
      revertData.computedActions,
      revertData.registrationContext
    )
  }
)
