import { validateAndTransformBody, validateAndTransformQuery, type MiddlewareFunction, type MiddlewareRoute } from "@medusajs/framework/http"
import { ensurePublishableKeyAndSalesChannelMatch } from "../../utils/middlewares/common/ensure-pub-key-sales-channel-match"
import { maybeAttachPublishableKeyScopes } from "../../utils/middlewares/common/maybe-attach-pub-key-scopes"
import * as QueryConfig from "./query-config"
import { StoreCreateCart, StoreGetCartsCart, StoreUpdateCart, StoreAddCartLineItem, StoreUpdateCartLineItem, StoreAddCartPromotions, StoreRemoveCartPromotions } from "./validators"

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
  {
    method: ["POST"],
    matcher: "/store/carts/:id",
    middlewares: [
      validateAndTransformBody(StoreUpdateCart),
      validateAndTransformQuery(
        StoreGetCartsCart,
        QueryConfig.retrieveTransformQueryConfig
      ),
    ],
  },
  {
    method: ["POST"],
    matcher: "/store/carts/:id/line-items",
    middlewares: [
      validateAndTransformBody(StoreAddCartLineItem),
      validateAndTransformQuery(
        StoreGetCartsCart,
        QueryConfig.retrieveTransformQueryConfig
      ),
    ],
  },
  {
    method: ["POST"],
    matcher: "/store/carts/:id/line-items/:line_id",
    middlewares: [
      validateAndTransformBody(StoreUpdateCartLineItem),
      validateAndTransformQuery(
        StoreGetCartsCart,
        QueryConfig.retrieveTransformQueryConfig
      ),
    ],
  },
  {
    method: ["DELETE"],
    matcher: "/store/carts/:id/line-items/:line_id",
    middlewares: [
      validateAndTransformQuery(
        StoreGetCartsCart,
        QueryConfig.retrieveTransformQueryConfig
      ),
    ],
  },
  {
    method: ["POST"],
    matcher: "/store/carts/:id/promotions",
    middlewares: [
      validateAndTransformBody(StoreAddCartPromotions),
      validateAndTransformQuery(
        StoreGetCartsCart,
        QueryConfig.retrieveTransformQueryConfig
      ),
    ],
  },
  {
    method: ["DELETE"],
    matcher: "/store/carts/:id/promotions",
    middlewares: [
      validateAndTransformBody(StoreRemoveCartPromotions),
      validateAndTransformQuery(
        StoreGetCartsCart,
        QueryConfig.retrieveTransformQueryConfig
      ),
    ],
  }
]
