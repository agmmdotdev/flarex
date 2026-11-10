import { maybeApplyLinkFilter, validateAndTransformBody, validateAndTransformQuery, type MiddlewareRoute } from "@medusajs/framework/http"
import { FeatureFlag } from "@medusajs/utils/feature-flags/flag-router"
import * as QueryConfig from "./query-config"
import { AdminCreateProduct, AdminCreateProductOption, AdminCreateProductVariant, AdminGetProductOptionParams, AdminGetProductOptionsParams, AdminGetProductParams, AdminGetProductVariantParams, AdminGetProductsParams, AdminUpdateProduct, AdminUpdateProductOption, AdminUpdateProductVariant } from "./validators"
import { AdminGetProductVariantsParams } from "../product-variants/validators"
import { maybeApplyPriceListsFilter } from "./utils/maybe-apply-price-lists-filter"

export const adminProductRoutesMiddlewares: MiddlewareRoute[] = [{
  matcher: "/admin/products/*",
  policies: [{ resource: "product", operation: "read" }],
}, {
  matcher: "/admin/products/*/variants/*",
  policies: [{ resource: "product_variant", operation: "read" }],
}, {
  matcher: "/admin/products/*/options/*",
  policies: [{ resource: "product_option", operation: "read" }],
}, {
  method: ["GET"],
  matcher: "/admin/products/:id/options",
  middlewares: [validateAndTransformQuery(AdminGetProductOptionsParams, QueryConfig.listOptionConfig)],
}, {
  method: ["GET"],
  matcher: "/admin/products/:id/options/:option_id",
  middlewares: [validateAndTransformQuery(AdminGetProductOptionParams, QueryConfig.retrieveOptionConfig)],
}, {
  method: ["POST"],
  matcher: "/admin/products/:id/options",
  middlewares: [
    validateAndTransformBody(AdminCreateProductOption),
    validateAndTransformQuery(AdminGetProductParams, QueryConfig.retrieveProductQueryConfig),
  ],
}, {
  method: ["POST"],
  matcher: "/admin/products/:id/options/:option_id",
  middlewares: [
    validateAndTransformBody(AdminUpdateProductOption),
    validateAndTransformQuery(AdminGetProductParams, QueryConfig.retrieveProductQueryConfig),
  ],
}, {
  method: ["GET"],
  matcher: "/admin/products/:id/variants",
  middlewares: [validateAndTransformQuery(AdminGetProductVariantsParams, QueryConfig.listVariantConfig)],
}, {
  method: ["GET"],
  matcher: "/admin/products/:id/variants/:variant_id",
  middlewares: [validateAndTransformQuery(AdminGetProductVariantParams, QueryConfig.retrieveVariantConfig)],
}, {
  method: ["POST"],
  matcher: "/admin/products/:id/variants",
  middlewares: [
    validateAndTransformBody(AdminCreateProductVariant),
    validateAndTransformQuery(AdminGetProductParams, QueryConfig.retrieveProductQueryConfig),
  ],
  policies: [{ resource: "product_variant", operation: "create" }],
}, {
  method: ["POST"],
  matcher: "/admin/products/:id/variants/:variant_id",
  middlewares: [
    validateAndTransformBody(AdminUpdateProductVariant),
    validateAndTransformQuery(AdminGetProductParams, QueryConfig.retrieveProductQueryConfig),
  ],
}, {
  method: ["DELETE"],
  matcher: "/admin/products/:id/variants/:variant_id",
  middlewares: [validateAndTransformQuery(AdminGetProductParams, QueryConfig.retrieveProductQueryConfig)],
  policies: [{ resource: "product_variant", operation: "delete" }],
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
}, {
  method: ["DELETE"],
  matcher: "/admin/products/:id",
  middlewares: [validateAndTransformQuery(AdminGetProductParams, QueryConfig.retrieveProductQueryConfig)],
  policies: [{ resource: "product", operation: "delete" }],
}]
