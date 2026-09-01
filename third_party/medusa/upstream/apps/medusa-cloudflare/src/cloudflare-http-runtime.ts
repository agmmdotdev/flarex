import {
  createLazyMedusaFetchHttpHandler,
  type LazyMedusaFetchHttpHandler,
  type MedusaFetchHttpRuntimeOptions,
} from "@medusajs/medusa/static/fetch-http-handler"
export {
  createMedusaCloudflareHttpRuntimeOptionsFromModuleRuntime,
  createMedusaCloudflareHttpRuntimeOptions,
  type MedusaCloudflareHttpModuleRuntime,
  type MedusaCloudflareHttpModuleRuntimeOptionsInput,
  type MedusaCloudflareHttpRuntimeComposition,
  type MedusaCloudflareHttpRuntimeHooks,
  type MedusaCloudflareHttpRuntimeOptionsInput,
} from "./cloudflare-http-options"
export {
  createMedusaCloudflareHttpModuleRuntimeSource,
  type CreateMedusaCloudflareHttpModuleRuntime,
  type CreateMedusaCloudflareHttpModuleRuntimeInput,
  type MedusaCloudflareHttpModuleRuntimeSource,
  type MedusaCloudflareHttpModuleRuntimeSourceInput,
} from "./cloudflare-http-module-runtime-source"
export { createMedusaCloudflareRequestScopeFactory } from "./cloudflare-http-request-scope"
import { staticHttpProofRuntimeOptions } from "./http-proof/runtime-options"
import {
  boundedProductionHttpRouteOptInHeader,
  getBoundedProductionHttpRouteGroups,
  getUrlDerivedProductionHttpRouteGroups,
  type ProductionHttpRouteGroupStatus,
} from "./cloudflare-http-production-route-policy"

export interface MedusaCloudflareHttpRuntimeStatus {
  defaultRuntime: "static-proof"
  productionCandidate: {
    status: "blocked"
    provenBoundary: "cart-proof-durable-object"
    boundedDefaultRouteOptIn: {
      header: string
      routeGroups: readonly ProductionHttpRouteGroupStatus[]
    }
    urlDerivedRouteSelection: {
      routeGroups: readonly ProductionHttpRouteGroupStatus[]
    }
    provenProductionBindings: readonly string[]
    remainingDefaultWorkerBoundary: readonly string[]
  }
}

const defaultRuntimeStatus = {
  defaultRuntime: "static-proof",
  productionCandidate: {
    status: "blocked",
    provenBoundary: "cart-proof-durable-object",
    boundedDefaultRouteOptIn: {
      header: boundedProductionHttpRouteOptInHeader,
      routeGroups: getBoundedProductionHttpRouteGroups(),
    },
    urlDerivedRouteSelection: {
      routeGroups: getUrlDerivedProductionHttpRouteGroups(),
    },
    provenProductionBindings: [
      "Durable Object SQLite manager for commerce persistence",
      "Durable Object-backed HTTP auth session store",
      "Cloudflare HTTP configModule and proof bearer auth-context preparation hooks",
      "Remote Query and QUERY.graph bindings",
      "Workflow execution, schedule, delayed-action, and alarm recovery stores",
      "Cloudflare locking namespace and queue bindings wired into module options",
      "Explicit tenant-scoped partition routing for bounded Store read routes",
      "URL-derived Cart partition routing for Store cart retrieve",
    ],
    remainingDefaultWorkerBoundary: [
      "Most default Worker requests without x-medusa-partition-key still need production partition-selection policies before proof HTTP options can be removed globally",
    ],
  },
} as const satisfies MedusaCloudflareHttpRuntimeStatus

export function createMedusaCloudflareHttpRuntime(
  options: MedusaFetchHttpRuntimeOptions
): LazyMedusaFetchHttpHandler {
  return createLazyMedusaFetchHttpHandler(options)
}

const medusaCloudflareHttpHandler = createMedusaCloudflareHttpRuntime(
  staticHttpProofRuntimeOptions
)

export async function handleMedusaCloudflareHttp(
  request: Request
): Promise<Response> {
  return await medusaCloudflareHttpHandler.handle(request)
}

export async function tryHandleMedusaCloudflareHttp(
  request: Request
): Promise<Response | undefined> {
  return await medusaCloudflareHttpHandler.tryHandle(request)
}

export function isMedusaCloudflareHttpPath(pathname: string): boolean {
  return medusaCloudflareHttpHandler.isPathHandled(pathname)
}

export function getMedusaCloudflareHttpRuntimeStatus(): MedusaCloudflareHttpRuntimeStatus {
  return defaultRuntimeStatus
}
