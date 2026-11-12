import { validateAndTransformQuery, type MiddlewareRoute } from "@medusajs/framework/http"
import { listTransformQueryConfig } from "./query-config"
import { StoreGetShippingOptions } from "./validators"

export const storeShippingOptionRoutesMiddlewares: MiddlewareRoute[] = [{
  method: ["GET"], matcher: "/store/shipping-options",
  middlewares: [validateAndTransformQuery(StoreGetShippingOptions, listTransformQueryConfig)],
}]
