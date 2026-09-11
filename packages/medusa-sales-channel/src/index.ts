import { Module } from "@medusajs/framework/modules-sdk/module"
import { Modules } from "@medusajs/framework/modules-sdk/definition"
import { SalesChannelModuleService } from "./services"

export default Module(Modules.SALES_CHANNEL, {
  service: SalesChannelModuleService,
})
