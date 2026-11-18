import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { defineJoinerConfigFromModels } from "@medusajs/utils/modules-sdk/portable-joiner-config-builder"
import {
  Customer,
  CustomerAddress,
  CustomerGroup,
  CustomerGroupCustomer,
} from "./models"

export const joinerConfig = defineJoinerConfigFromModels(Modules.CUSTOMER, {
  models: [Customer, CustomerAddress, CustomerGroup, CustomerGroupCustomer],
})
