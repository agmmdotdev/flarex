import {
  currencyModuleDefinition,
  currencyModuleExports,
  currencyStaticResources,
} from "@medusajs/currency/static-manifest"
import { CurrencyModuleService } from "@medusajs/currency/services"
import type { DrizzleMedusaManager } from "@medusajs/drizzle/medusa"
import type { ICurrencyModuleService } from "@medusajs/types"
import { drizzle } from "drizzle-orm/d1"
import { createStaticModuleRuntime } from "./static-module-runtime"

export interface CurrencyModuleRuntime {
  service: InstanceType<typeof CurrencyModuleService> & ICurrencyModuleService
  transactionMode: DrizzleMedusaManager["transactionMode"]
}

export async function createCurrencyModuleRuntime(
  database: D1Database
): Promise<CurrencyModuleRuntime> {
  const manager: DrizzleMedusaManager = {
    database: drizzle(database),
    transactionMode: "statement",
    async transaction(task) {
      return await task(manager)
    },
    async destroy() {},
  }

  return await createCurrencyModuleRuntimeWithManager(manager)
}

export async function createCurrencyModuleRuntimeWithManager(
  manager: DrizzleMedusaManager
): Promise<CurrencyModuleRuntime> {
  return await createStaticModuleRuntime<
    InstanceType<typeof CurrencyModuleService> & ICurrencyModuleService
  >({
    manager,
    manifest: {
      moduleDefinition: currencyModuleDefinition,
      moduleExports: currencyModuleExports,
      resources: currencyStaticResources,
    },
  })
}
