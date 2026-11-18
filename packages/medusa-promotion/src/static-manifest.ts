import type { ModuleExports, StaticModuleResources } from "@medusajs/types"
import { ModulesDefinition } from "@medusajs/modules-sdk/definitions"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { defineJoinerConfigFromModels } from "@medusajs/utils/modules-sdk/portable-joiner-config-builder"
import {
  ApplicationMethod,
  Campaign,
  CampaignBudget,
  CampaignBudgetUsage,
  Promotion,
  PromotionRule,
  PromotionRuleValue,
} from "./models"
import PromotionModuleService from "./services/promotion-module"

export const promotionModuleDefinition = ModulesDefinition[Modules.PROMOTION]

export const promotionModuleModels = [
  Promotion,
  ApplicationMethod,
  Campaign,
  CampaignBudget,
  CampaignBudgetUsage,
  PromotionRule,
  PromotionRuleValue,
]

export const promotionModuleExports: ModuleExports = {
  service: PromotionModuleService,
  loaders: [],
}

export const promotionStaticResources: StaticModuleResources = {
  models: promotionModuleModels,
  services: [],
  repositories: [],
  loaders: [],
  moduleService: PromotionModuleService,
  joinerConfig: defineJoinerConfigFromModels(Modules.PROMOTION, {
    models: promotionModuleModels,
    linkableKeys: {
      campaign_id: "Campaign",
      promotion_id: "Promotion",
    },
  }),
}
