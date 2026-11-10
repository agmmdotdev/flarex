import { maybeApplyLinkFilter, validateAndTransformBody, validateAndTransformQuery, type MiddlewareRoute } from "@medusajs/framework/http"
import { FeatureFlag } from "@medusajs/utils/feature-flags/flag-router"
import * as QueryConfig from "./query-config"
import { AdminCreateProduct, AdminGetProductParams, AdminGetProductsParams, AdminUpdateProduct } from "./validators"
import { maybeApplyPriceListsFilter } from "./utils/maybe-apply-price-lists-filter"

export const adminProductRoutesMiddlewares: MiddlewareRoute[] = [{
  matcher: "/admin/products/*",
  policies: [{ resource: "product", operation: "read" }],
}, {
  method: ["GET"],
  matcher: "/admin/products",
  middlewares: [
    validateAndTransformQuery(AdminGetProductsParams, QueryConfig.listProductQueryConfig),
    (req, res, next) => {
      if (FeatureFlag.isFeatureEnabled("index_engine")) {
        return next()
      }
      return maybeApplyLinkFilter({ entryPoint: "product_sales_channel", resourceId: "product_id", filterableField: "sales_channel_id" })(req, res, next)
    },
    maybeApplyPriceListsFilter(),
  ],
  policies: [{ resource: "product", operation: "read" }],
}, {
  method: ["GET"],
  matcher: "/admin/products/:id",
  middlewares: [validateAndTransformQuery(AdminGetProductParams, QueryConfig.retrieveProductQueryConfig)],
}, {
  method: ["POST"],
  matcher: "/admin/products",
  middlewares: [
    validateAndTransformBody(AdminCreateProduct),
    validateAndTransformQuery(AdminGetProductParams, QueryConfig.retrieveProductQueryConfig),
  ],
  policies: [
    { resource: "product", operation: "create" },
    { resource: "inventory_item", operation: "create" },
    { resource: "price", operation: "create" },
  ],
}, {
  method: ["POST"],
  matcher: "/admin/products/:id",
  middlewares: [
    validateAndTransformBody(AdminUpdateProduct),
    validateAndTransformQuery(AdminGetProductParams, QueryConfig.retrieveProductQueryConfig),
  ],
}]
