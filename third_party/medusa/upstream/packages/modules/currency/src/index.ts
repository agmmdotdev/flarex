import { CurrencyModuleService } from "@services"
import initialDataLoader from "./loaders/initial-data"
import { Modules } from "@medusajs/framework/modules-sdk/definition"
import { Module } from "@medusajs/framework/modules-sdk/module"

const service = CurrencyModuleService
const loaders = [initialDataLoader]

export default Module(Modules.CURRENCY, {
  service,
  loaders,
})
