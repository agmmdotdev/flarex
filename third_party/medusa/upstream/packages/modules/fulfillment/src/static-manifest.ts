import type { ModuleExports, StaticModuleResources } from "@medusajs/types"
import { ModulesDefinition } from "@medusajs/modules-sdk/definitions"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import {
  Fulfillment,
  FulfillmentAddress,
  FulfillmentItem,
  FulfillmentLabel,
  FulfillmentProvider,
  FulfillmentSet,
  GeoZone,
  ServiceZone,
  ShippingOption,
  ShippingOptionRule,
  ShippingOptionType,
  ShippingProfile,
} from "./models"
import { joinerConfig } from "./joiner-config"
import FulfillmentModuleService from "./services/fulfillment-module-service"
import FulfillmentProviderService from "./services/fulfillment-provider"

export const fulfillmentModuleDefinition =
  ModulesDefinition[Modules.FULFILLMENT]

export const fulfillmentModuleModels = [
  FulfillmentAddress,
  Fulfillment,
  FulfillmentItem,
  FulfillmentLabel,
  FulfillmentProvider,
  FulfillmentSet,
  GeoZone,
  ServiceZone,
  ShippingOption,
  ShippingOptionRule,
  ShippingOptionType,
  ShippingProfile,
]

export const fulfillmentModuleExports: ModuleExports = {
  service: FulfillmentModuleService,
  loaders: [],
}

export const fulfillmentStaticResources: StaticModuleResources = {
  models: fulfillmentModuleModels,
  services: [FulfillmentProviderService],
  repositories: [],
  loaders: [],
  moduleService: FulfillmentModuleService,
  joinerConfig,
}
