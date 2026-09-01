import type { MedusaFetchHttpCreateRequestScope } from "@medusajs/medusa/static/fetch-http-handler"
import type { MedusaContainer } from "@medusajs/framework/types"
import { createMedusaRequestScope } from "@medusajs/framework/http/fetch"
import { asValue } from "@medusajs/deps/awilix"
import { ContainerRegistrationKeys } from "@medusajs/utils/common/container"
import type { ConfigModule } from "@medusajs/types"

export const MEDUSA_CLOUDFLARE_WORKER_PROOF_JWT_SECRET =
  "medusa-cloudflare-worker-proof-secret"

const cloudflareHttpConfigModule = {
  projectConfig: {
    http: {
      adminCors: "*",
      authCors: "*",
      jwtSecret: MEDUSA_CLOUDFLARE_WORKER_PROOF_JWT_SECRET,
      storeCors: "*",
      authMethodsPerActor: {
        user: ["emailpass"],
        customer: ["emailpass"],
      },
    },
  },
  admin: {
    disable: true,
    path: "/app",
  },
  plugins: [],
  modules: {},
  featureFlags: {},
} satisfies ConfigModule

export function createMedusaCloudflareRequestScopeFactory(
  container: MedusaContainer
): MedusaFetchHttpCreateRequestScope {
  return () => {
    const scope = createMedusaRequestScope(container)
    scope.register({
      [ContainerRegistrationKeys.CONFIG_MODULE]: asValue(
        cloudflareHttpConfigModule
      ),
    })

    return scope
  }
}
