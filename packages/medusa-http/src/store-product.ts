import { applyLocale, ensurePublishableApiKeyMiddleware, setMedusaRequestAuthContext, type AuthContext } from "@medusajs/framework/http"
import { createFetchHttpStaticHandler, type FetchHttpAdapterOptions, type FetchHttpStaticHandler } from "@medusajs/framework/http/fetch"
import { MedusaError } from "@medusajs/utils/common/errors"
import { FeatureFlag } from "@medusajs/utils/feature-flags/flag-router"
import { withMedusaNamespaceCors } from "./cors"
import { storeProductHttpManifest } from "./store-product-static-manifest.generated"

export type StoreProductHttpOptions = {
  storeCors: string
  createRequestScope: FetchHttpAdapterOptions["createRequestScope"]
  /** Supplies cryptographically verified customer identity; absence stays public. */
  resolveCustomerPrincipal?(request: Request): AuthContext | undefined | Promise<AuthContext | undefined>
}

/** Native Store middleware owns key, customer, channel and pricing semantics. */
export function createStoreProductHttpHandler(options: StoreProductHttpOptions): FetchHttpStaticHandler {
  const native = createFetchHttpStaticHandler({
    allowedMethods: ["GET"],
    createRequestScope: options.createRequestScope,
    async prepareRequest(request, fetchRequest) {
      const principal = await options.resolveCustomerPrincipal?.(fetchRequest)
      if (principal?.actor_type === "customer" && principal.actor_id) {
        setMedusaRequestAuthContext(request, principal)
      }
    },
    manifest: {
      routes: storeProductHttpManifest.routes,
      middlewares: [
        { module: { default: { routes: [{
          matcher: "/store",
          middlewares: [ensurePublishableApiKeyMiddleware, applyLocale, (_request, _response, next) => {
            if (FeatureFlag.isFeatureEnabled("translation")) {
              throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Store Product translations are outside the admitted profile")
            }
            next()
          }],
        }] } } },
        ...storeProductHttpManifest.middlewares,
      ],
    },
  })
  return withMedusaNamespaceCors(native, options.storeCors, ["GET"])
}

export { storeProductHttpManifest } from "./store-product-static-manifest.generated"
