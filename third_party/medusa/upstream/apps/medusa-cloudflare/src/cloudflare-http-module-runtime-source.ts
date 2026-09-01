import type { DrizzleMedusaManager } from "@medusajs/drizzle/medusa"
import type { MedusaFetchHttpRuntimeOptions } from "@medusajs/medusa/static/fetch-http-handler"
import {
  createCommerceModulesRuntimeWithManager,
  type CommerceModulesRuntimeOptions,
} from "./commerce-modules"
import {
  createMedusaCloudflareHttpRuntimeOptionsFromModuleRuntime,
  type MedusaCloudflareHttpModuleRuntime,
  type MedusaCloudflareHttpModuleRuntimeOptionsInput,
} from "./cloudflare-http-options"

export interface MedusaCloudflareHttpModuleRuntimeSource {
  getRuntime(): Promise<MedusaCloudflareHttpModuleRuntime>
  getHttpRuntimeOptions(): Promise<MedusaFetchHttpRuntimeOptions>
}

export interface CreateMedusaCloudflareHttpModuleRuntimeInput {
  manager: DrizzleMedusaManager
  moduleOptions?: CommerceModulesRuntimeOptions
}

export type CreateMedusaCloudflareHttpModuleRuntime = (
  input: CreateMedusaCloudflareHttpModuleRuntimeInput
) => Promise<MedusaCloudflareHttpModuleRuntime>

export type MedusaCloudflareHttpModuleRuntimeSourceInput = Omit<
  MedusaCloudflareHttpModuleRuntimeOptionsInput,
  "runtime"
> & {
  manager: DrizzleMedusaManager
  moduleOptions?: CommerceModulesRuntimeOptions
  createRuntime?: CreateMedusaCloudflareHttpModuleRuntime
}

export function createMedusaCloudflareHttpModuleRuntimeSource({
  manager,
  moduleOptions,
  createRuntime = createDefaultMedusaCloudflareHttpModuleRuntime,
  ...httpOptions
}: MedusaCloudflareHttpModuleRuntimeSourceInput): MedusaCloudflareHttpModuleRuntimeSource {
  let runtime: Promise<MedusaCloudflareHttpModuleRuntime> | undefined

  const getRuntime = () => {
    runtime ??= createRuntime({
      manager,
      moduleOptions,
    })

    return runtime
  }

  return {
    getRuntime,
    async getHttpRuntimeOptions() {
      return createMedusaCloudflareHttpRuntimeOptionsFromModuleRuntime({
        ...httpOptions,
        runtime: await getRuntime(),
      })
    },
  }
}

async function createDefaultMedusaCloudflareHttpModuleRuntime({
  manager,
  moduleOptions,
}: CreateMedusaCloudflareHttpModuleRuntimeInput): Promise<MedusaCloudflareHttpModuleRuntime> {
  return await createCommerceModulesRuntimeWithManager(manager, moduleOptions)
}
