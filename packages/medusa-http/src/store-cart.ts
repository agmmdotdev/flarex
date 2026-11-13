import { applyLocale, ensurePublishableApiKeyMiddleware, prepareRetrieveQuery, setMedusaRequestAuthContext, type AuthContext, type MiddlewareFunction } from "@medusajs/framework/http"
import { createFetchHttpStaticHandler, type FetchHttpAdapterOptions, type FetchHttpStaticHandler } from "@medusajs/framework/http/fetch"
import { MedusaError } from "@medusajs/utils/common/errors"
import { FeatureFlag } from "@medusajs/utils/feature-flags/flag-router"
import { withMedusaNamespaceCors } from "./cors"
import { storeCartHttpManifest } from "./store-cart-static-manifest.generated"
import { defaultStoreCartFields } from "./api/store/carts/query-config"

export type StoreCartHttpOptions = {
  storeCors: string
  createRequestScope: FetchHttpAdapterOptions["createRequestScope"]
  /** The host supplies verified customer identity; guest requests stay public. */
  resolveCustomerPrincipal?(request: Request): AuthContext | undefined | Promise<AuthContext | undefined>
  /** The graph owner admits the complete response before a native mutation. */
  admitCartRefetchFields(fields: readonly string[]): void
  /** Cart-only hosts omit this capability and Shipping option reads refuse. */
  admitShippingOptionFields?(fields: readonly string[]): void
  /** Payment reads and mutations require their authenticated graph capability. */
  admitPaymentCollectionFields?(fields: readonly string[]): void
  /** Completion admits both the successful Order and native error Cart refetch. */
  admitOrderRefetchFields?(fields: readonly string[]): void
}

export function createStoreCartHttpHandler(options: StoreCartHttpOptions): FetchHttpStaticHandler {
  const admitProjection: MiddlewareFunction = (request, _response, next) => {
    options.admitCartRefetchFields(request.queryConfig.fields)
    next()
  }
  const admitShippingOptions: MiddlewareFunction = (request, _response, next) => {
    if (options.admitShippingOptionFields === undefined) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Shipping option reads are outside the admitted Store Cart profile")
    }
    options.admitShippingOptionFields(request.queryConfig.fields)
    next()
  }
  const admitPaymentCollection: MiddlewareFunction = (request, _response, next) => {
    if (options.admitPaymentCollectionFields === undefined) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Payment Collections are outside the admitted Store Cart profile")
    }
    options.admitPaymentCollectionFields(request.queryConfig.fields)
    next()
  }
  const admitCompletion: MiddlewareFunction = async (request, _response, next) => {
    if (options.admitOrderRefetchFields === undefined) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Cart completion is outside the admitted Store Cart profile")
    }
    options.admitOrderRefetchFields(request.queryConfig.fields)
    const cart = await prepareRetrieveQuery({}, { defaults: defaultStoreCartFields }, request)
    options.admitCartRefetchFields(cart.remoteQueryConfig.fields)
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
          { method: ["POST", "DELETE"], matcher: "/store/carts/:id/promotions", middlewares: [admitProjection] },
          { method: ["POST"], matcher: "/store/carts/:id/taxes", middlewares: [admitProjection] },
          { method: ["POST"], matcher: "/store/carts/:id/shipping-methods", middlewares: [admitProjection] },
          { method: ["GET"], matcher: "/store/shipping-options", middlewares: [admitShippingOptions] },
          { method: ["POST"], matcher: "/store/payment-collections", middlewares: [admitPaymentCollection] },
          { method: ["POST"], matcher: "/store/payment-collections/:id/payment-sessions", middlewares: [admitPaymentCollection] },
          { method: ["POST"], matcher: "/store/carts/:id/complete", middlewares: [admitCompletion] },
        ] } } },
      ],
    },
  })
  return withMedusaNamespaceCors(native, options.storeCors, ["GET", "POST", "DELETE"])
}

export { storeCartHttpManifest } from "./store-cart-static-manifest.generated"
