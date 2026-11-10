import { validateAndTransformQuery } from "@medusajs/framework/http"
import type { MiddlewareRoute } from "@medusajs/framework/http"
import * as QueryConfig from "./query-config"
import { Entities } from "./query-config"
import { AdminGetProductVariantsParams } from "./validators"

export const adminProductVariantRoutesMiddlewares: MiddlewareRoute[] = [
  {
    matcher: "/admin/product-variants/*",
    policies: [
      {
        resource: Entities.product_variant,
        operation: "read",
      },
    ],
  },
  {
    method: ["GET"],
    matcher: "/admin/product-variants",
    middlewares: [
      validateAndTransformQuery(
        AdminGetProductVariantsParams,
        QueryConfig.listProductVariantQueryConfig
      ),
    ],
    policies: [
      {
        resource: Entities.product_variant,
        operation: "read",
      },
    ],
  },
]
