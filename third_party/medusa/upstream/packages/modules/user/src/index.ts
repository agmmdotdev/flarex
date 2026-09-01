import { Module, Modules } from "@medusajs/framework/utils"
import { UserModuleService } from "./services"

export default Module(Modules.USER, {
  service: UserModuleService,
})
