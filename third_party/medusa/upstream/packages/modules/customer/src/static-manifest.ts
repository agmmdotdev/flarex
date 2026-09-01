import type { ModuleExports, StaticModuleResources } from "@medusajs/types"
import { ModulesDefinition } from "@medusajs/modules-sdk/definitions"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { defineJoinerConfigFromModels } from "@medusajs/utils/modules-sdk/portable-joiner-config-builder"
import {
  Customer,
  CustomerAddress,
  CustomerGroup,
  CustomerGroupCustomer,
} from "./models"
import { CustomerModuleService } from "./services"

export const customerModuleDefinition = ModulesDefinition[Modules.CUSTOMER]

export const customerModuleModels = [
  Customer,
  CustomerAddress,
  CustomerGroup,
  CustomerGroupCustomer,
]

export const customerModuleExports: ModuleExports = {
  service: CustomerModuleService,
  loaders: [],
}

export const customerStaticResources: StaticModuleResources = {
  models: customerModuleModels,
  services: [],
  repositories: [],
  loaders: [],
  moduleService: CustomerModuleService,
  joinerConfig: defineJoinerConfigFromModels(Modules.CUSTOMER, {
    models: customerModuleModels,
  }),
}
