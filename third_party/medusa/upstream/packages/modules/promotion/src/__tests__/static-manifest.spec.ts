import promotionModule from "../index"
import { ModulesDefinition } from "@medusajs/modules-sdk"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import {
  ApplicationMethod,
  Campaign,
  CampaignBudget,
  CampaignBudgetUsage,
  Promotion,
  PromotionRule,
  PromotionRuleValue,
} from "../models"
import {
  promotionModuleDefinition,
  promotionModuleExports,
  promotionStaticResources,
} from "../static-manifest"

type JoinerConfigProvider = {
  __joinerConfig?: () => typeof promotionStaticResources.joinerConfig
}

describe("Promotion static manifest", () => {
  it("matches the normal Promotion module export and joiner config", () => {
    expect(promotionModuleDefinition).toEqual(
      ModulesDefinition[Modules.PROMOTION]
    )
    expect(promotionModuleExports.service).toBe(promotionModule.service)
    expect(promotionStaticResources.moduleService).toBe(
      promotionModule.service
    )
    expect(promotionStaticResources.models).toEqual([
      Promotion,
      ApplicationMethod,
      Campaign,
      CampaignBudget,
      CampaignBudgetUsage,
      PromotionRule,
      PromotionRuleValue,
    ])

    const servicePrototype = promotionModule.service
      .prototype as JoinerConfigProvider
    const nodeJoinerConfig = servicePrototype.__joinerConfig?.()
    const normalizeSchema = (schema?: string) =>
      schema?.replace(/\s+/g, " ").trim()

    expect({
      ...promotionStaticResources.joinerConfig,
      schema: normalizeSchema(promotionStaticResources.joinerConfig?.schema),
    }).toEqual({
      ...nodeJoinerConfig,
      schema: normalizeSchema(nodeJoinerConfig?.schema),
    })
  })
})
