import { applyLocale, ensurePublishableApiKeyMiddleware, setMedusaRequestAuthContext, type AuthContext, type MiddlewareFunction } from "@medusajs/framework/http"
import { createFetchHttpStaticHandler, type FetchHttpAdapterOptions, type FetchHttpStaticHandler } from "@medusajs/framework/http/fetch"
import { MedusaError } from "@medusajs/utils/common/errors"
import { FeatureFlag } from "@medusajs/utils/feature-flags/flag-router"
import { withMedusaNamespaceCors } from "./cors"
import { storeCartHttpManifest } from "./store-cart-static-manifest.generated"

export type StoreCartHttpOptions = {
  storeCors: string
  createRequestScope: FetchHttpAdapterOptions["createRequestScope"]
  /** The host supplies verified customer identity; guest requests stay public. */
  resolveCustomerPrincipal?(request: Request): AuthContext | undefined | Promise<AuthContext | undefined>
  /** The graph owner admits the complete response before a native mutation. */
  admitCartRefetchFields(fields: readonly string[]): void
}

export function createStoreCartHttpHandler(options: StoreCartHttpOptions): FetchHttpStaticHandler {
  const admitProjection: MiddlewareFunction = (request, _response, next) => {
    options.admitCartRefetchFields(request.queryConfig.fields)
    next()
  }
  const native = createFetchHttpStaticHandler({
    allowedMethods: ["GET", "POST", "DELETE"],
    createRequestScope: options.createRequestScope,
    async prepareRequest(request, fetchRequest) {
      const principal = await options.resolveCustomerPrincipal?.(fetchRequest)
      if (principal?.actor_type === "customer" && principal.actor_id) setMedusaRequestAuthContext(request, principal)
    },
    manifest: {
      routes: storeCartHttpManifest.routes,
      middlewares: [
        { module: { default: { routes: [{ matcher: "/store", middlewares: [
          ensurePublishableApiKeyMiddleware, applyLocale, (_request, _response, next) => {
            if (FeatureFlag.isFeatureEnabled("translation")) {
              throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Store Cart translations are outside the admitted profile")
            }
            next()
          },
        ] }] } } },
        ...storeCartHttpManifest.middlewares,
        { module: { default: { routes: [
          { method: ["POST"], matcher: "/store/carts", middlewares: [admitProjection] },
          { method: ["POST"], matcher: "/store/carts/:id", middlewares: [admitProjection] },
          { method: ["POST"], matcher: "/store/carts/:id/line-items", middlewares: [admitProjection] },
          { method: ["POST", "DELETE"], matcher: "/store/carts/:id/line-items/:line_id", middlewares: [admitProjection] },
        ] } } },
      ],
    },
  })
  return withMedusaNamespaceCors(native, options.storeCors, ["GET", "POST", "DELETE"])
}

export { storeCartHttpManifest } from "./store-cart-static-manifest.generated"
