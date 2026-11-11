import { validateAndTransformBody, validateAndTransformQuery, type MiddlewareFunction, type MiddlewareRoute } from "@medusajs/framework/http"
import { ensurePublishableKeyAndSalesChannelMatch } from "../../utils/middlewares/common/ensure-pub-key-sales-channel-match"
import { maybeAttachPublishableKeyScopes } from "../../utils/middlewares/common/maybe-attach-pub-key-scopes"
import * as QueryConfig from "./query-config"
import { StoreCreateCart, StoreGetCartsCart } from "./validators"

export const storeCartRoutesMiddlewares: MiddlewareRoute[] = [
  {
    method: ["GET"],
    matcher: "/store/carts/:id",
    middlewares: [
      validateAndTransformQuery(
        StoreGetCartsCart,
        QueryConfig.retrieveTransformQueryConfig
      ),
    ],
  },
  {
    method: ["POST"],
    matcher: "/store/carts",
    middlewares: [
      validateAndTransformBody(StoreCreateCart),
      validateAndTransformQuery(
        StoreGetCartsCart,
        QueryConfig.retrieveTransformQueryConfig
      ),
      maybeAttachPublishableKeyScopes,
      // The preceding native body validator supplies StoreCreateCartType here.
      ensurePublishableKeyAndSalesChannelMatch as MiddlewareFunction,
    ],
  },
]
