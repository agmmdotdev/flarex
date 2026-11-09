import { validateAndTransformBody, validateAndTransformQuery, type MiddlewareRoute } from "@medusajs/framework/http"
import * as QueryConfig from "./query-config"
import { AdminCreateProduct, AdminGetProductParams } from "./validators"

export const adminProductRoutesMiddlewares: MiddlewareRoute[] = [{
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
}]
