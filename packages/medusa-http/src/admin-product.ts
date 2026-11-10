import { authenticate, getMedusaRequestAuthContext, setMedusaRequestAuthContext, type AuthContext, type MiddlewareRoute, type PolicyAction } from "@medusajs/framework/http"
import { createFetchHttpStaticHandler, type FetchHttpAdapterOptions, type FetchHttpStaticHandler } from "@medusajs/framework/http/fetch"
import { MedusaError } from "@medusajs/utils/common/errors"
import { adminProductHttpManifest } from "./admin-product-static-manifest.generated"
import { remapKeysForProduct, remapKeysForVariant } from "./api/admin/products/helpers"
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
  /** Variant read owner rejects unsupported response fields before inventory mutations. */
  admitVariantRefetchFields(fields: readonly string[]): void
  /** Catalog read owner admission runs before native writes and update existence reads. */
  admitCatalogRefetchFields(entity: "product_type" | "product_tag" | "product_category" | "product_collection", fields: readonly string[]): void
}

export function createAdminProductHttpHandler(options: AdminProductHttpOptions): FetchHttpStaticHandler {
  const native = createFetchHttpStaticHandler({
    allowedMethods: ["GET", "POST", "DELETE"],
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
        }, {
          method: ["POST"], matcher: "/admin/products/:id",
          middlewares: [(request, _response, next) => {
            options.admitProductRefetchFields(remapKeysForProduct(request.queryConfig.fields))
            next()
          }],
        }, {
          method: ["POST"], matcher: "/admin/products/:id/variants",
          middlewares: [(request, _response, next) => {
            options.admitProductRefetchFields(remapKeysForProduct(request.queryConfig.fields))
            next()
          }],
        }, {
          method: ["POST", "DELETE"], matcher: "/admin/products/:id/variants/:variant_id",
          middlewares: [(request, _response, next) => {
            options.admitProductRefetchFields(remapKeysForProduct(request.queryConfig.fields))
            next()
          }],
        }, {
          method: ["POST"], matcher: "/admin/products/:id/options",
          middlewares: [(request, _response, next) => {
            options.admitProductRefetchFields(remapKeysForProduct(request.queryConfig.fields))
            next()
          }],
        }, {
          method: ["POST", "DELETE"], matcher: "/admin/products/:id/options/:option_id",
          middlewares: [(request, _response, next) => {
            options.admitProductRefetchFields(remapKeysForProduct(request.queryConfig.fields))
            next()
          }],
        }, {
          method: ["POST"], matcher: "/admin/products/:id/variants/:variant_id/inventory-items",
          middlewares: [(request, _response, next) => {
            options.admitVariantRefetchFields(remapKeysForVariant(request.queryConfig.fields))
            next()
          }],
        }, {
          method: ["POST", "DELETE"], matcher: "/admin/products/:id/variants/:variant_id/inventory-items/:inventory_item_id",
          middlewares: [(request, _response, next) => {
            options.admitVariantRefetchFields(remapKeysForVariant(request.queryConfig.fields))
            next()
          }],
        }, ...(["product_type", "product_tag", "product_category", "product_collection"] as const).flatMap(entity => ["", "/:id", ...(entity === "product_category" || entity === "product_collection" ? ["/:id/products"] : [])].map(suffix => ({
          method: ["POST"], matcher: `/admin/${({ product_type: "product-types", product_tag: "product-tags", product_category: "product-categories", product_collection: "collections" } as const)[entity]}${suffix}`,
          middlewares: [(request, _response, next) => {
            options.admitCatalogRefetchFields(entity, request.queryConfig.fields)
            next()
          }],
        } satisfies MiddlewareRoute)))] } } },
      ],
    },
  })
  return withMedusaNamespaceCors(native, options.adminCors, ["GET", "POST", "DELETE"])
}

export { adminProductHttpManifest } from "./admin-product-static-manifest.generated"
