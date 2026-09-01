import {
  cartModuleDefinition,
  cartModuleExports,
  cartStaticResources,
} from "@medusajs/cart/static-manifest"
import { CartModuleService } from "@medusajs/cart/services"
import type { DrizzleMedusaManager } from "@medusajs/drizzle/medusa"
import type { ICartModuleService } from "@medusajs/types"
import { createStaticModuleRuntime } from "./static-module-runtime"

export interface CartModuleRuntime {
  service: InstanceType<typeof CartModuleService> & ICartModuleService
  transactionMode: DrizzleMedusaManager["transactionMode"]
}

export async function createCartModuleRuntimeWithManager(
  manager: DrizzleMedusaManager
): Promise<CartModuleRuntime> {
  return await createStaticModuleRuntime<
    InstanceType<typeof CartModuleService> & ICartModuleService
  >({
    manager,
    manifest: {
      moduleDefinition: cartModuleDefinition,
      moduleExports: cartModuleExports,
      resources: cartStaticResources,
    },
  })
}
