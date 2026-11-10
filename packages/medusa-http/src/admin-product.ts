import { authenticate, getMedusaRequestAuthContext, setMedusaRequestAuthContext, type AuthContext, type PolicyAction } from "@medusajs/framework/http"
import { createFetchHttpStaticHandler, type FetchHttpAdapterOptions, type FetchHttpStaticHandler } from "@medusajs/framework/http/fetch"
import { MedusaError } from "@medusajs/utils/common/errors"
import { adminProductHttpManifest } from "./admin-product-static-manifest.generated"
import { remapKeysForProduct } from "./api/admin/products/helpers"
import { withMedusaNamespaceCors } from "./cors"

export type AdminProductHttpOptions = {
  adminCors: string
  createRequestScope: FetchHttpAdapterOptions["createRequestScope"]
  /** Trusted host authentication; no executor credential or decoded payload grants access. */
  resolveAdminPrincipal(request: Request): AuthContext | undefined | Promise<AuthContext | undefined>
  /** Evaluate every pinned route policy against this verified user. */
  evaluateAdminPolicies(principal: AuthContext, policies: readonly PolicyAction[]): boolean | Promise<boolean>
  /** The actual read owner rejects unsupported projections before workflow execution. */
  admitProductRefetchFields(fields: readonly string[]): void
}

export function createAdminProductHttpHandler(options: AdminProductHttpOptions): FetchHttpStaticHandler {
  const native = createFetchHttpStaticHandler({
    allowedMethods: ["GET", "POST"],
    createRequestScope: options.createRequestScope,
    async prepareRequest(request, fetchRequest) {
      const principal = await options.resolveAdminPrincipal(fetchRequest)
      if (principal) setMedusaRequestAuthContext(request, principal)
    },
    async verifyPolicies(request, policies) {
      const principal = getMedusaRequestAuthContext(request)
      if (!principal || principal.actor_type !== "user" || !principal.actor_id) {
        throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Unauthorized")
      }
      if (!await options.evaluateAdminPolicies(principal, policies)) {
        throw new MedusaError(MedusaError.Types.FORBIDDEN, "Forbidden")
      }
    },
    manifest: {
      routes: adminProductHttpManifest.routes,
      middlewares: [
        { module: { default: { routes: [{
          matcher: "/admin",
          middlewares: [authenticate("user", "bearer")],
        }] } } },
        ...adminProductHttpManifest.middlewares,
        { module: { default: { routes: [{
          method: ["POST"], matcher: "/admin/products",
          middlewares: [(request, _response, next) => {
            options.admitProductRefetchFields(remapKeysForProduct(request.queryConfig.fields))
            next()
          }],
        }] } } },
      ],
    },
  })
  return withMedusaNamespaceCors(native, options.adminCors, ["GET", "POST"])
}

export { adminProductHttpManifest } from "./admin-product-static-manifest.generated"
