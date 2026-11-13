import { authenticate, validateAndTransformQuery, type MiddlewareRoute } from "@medusajs/framework/http"
import * as QueryConfig from "./query-config"
import { StoreGetOrdersParams, StoreGetOrderParams } from "./validators"
export const storeOrderRoutesMiddlewares: MiddlewareRoute[] = [{
    method: ["GET"],
    matcher: "/store/orders",
    middlewares: [
      authenticate("customer", ["session", "bearer"]),
      validateAndTransformQuery(
        StoreGetOrdersParams,
        QueryConfig.listTransformQueryConfig
      ),
    ],
  },{
    method: ["GET"],
    matcher: "/store/orders/:id",
    middlewares: [
      validateAndTransformQuery(
        StoreGetOrderParams,
        QueryConfig.retrieveTransformQueryConfig
      ),
    ],
  }]
