import { Module, Modules } from "@medusajs/framework/utils"
import { StoreModuleService } from "./services"

export default Module(Modules.STORE, {
  service: StoreModuleService,
})
