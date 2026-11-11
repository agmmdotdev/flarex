import { validateAndTransformBody, validateAndTransformQuery, type MiddlewareRoute } from "@medusajs/framework/http"
import * as QueryConfig from "./query-config"
import { Entities } from "./query-config"
import { createLinkBody } from "../../utils/validators"
import { AdminGetSalesChannelParams } from "./validators"

export const adminSalesChannelRoutesMiddlewares: MiddlewareRoute[] = [
  {
    matcher: "/admin/sales-channels/*",
    policies: [
      {
        resource: Entities.sales_channel,
        operation: "read",
      },
    ],
  },
  {
    method: ["POST"],
    matcher: "/admin/sales-channels/:id/products",
    middlewares: [
      validateAndTransformBody(createLinkBody()),
      validateAndTransformQuery(
        AdminGetSalesChannelParams,
        QueryConfig.retrieveTransformQueryConfig
      ),
    ],
    policies: [
      {
        resource: Entities.sales_channel,
        operation: "update",
      },
    ],
  },
]
