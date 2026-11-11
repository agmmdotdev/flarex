import { validateAndTransformBody, validateAndTransformQuery, type MiddlewareRoute } from "@medusajs/framework/http"
import * as QueryConfig from "./query-config"
import { Entities } from "./query-config"
import { AdminGetPriceListParams, AdminRemoveProductsPriceList } from "./validators"

export const adminPriceListsRoutesMiddlewares: MiddlewareRoute[] = [
  {
    matcher: "/admin/price-lists/*",
    policies: [
      {
        resource: Entities.price_list,
        operation: "read",
      },
    ],
  },
  {
    method: ["POST"],
    matcher: "/admin/price-lists/:id/products",
    middlewares: [
      validateAndTransformBody(AdminRemoveProductsPriceList),
      validateAndTransformQuery(
        AdminGetPriceListParams,
        QueryConfig.listPriceListQueryConfig
      ),
    ],
    policies: [
      {
        resource: Entities.price_list,
        operation: "update",
      },
    ],
  },
]
