import {
  validateAndTransformBody,
  validateAndTransformQuery,
} from "@medusajs/framework/http"
import { MiddlewareRoute } from "@medusajs/framework/http"
import { createLinkBody } from "../../utils/validators"
import * as QueryConfig from "./query-config"
import { Entities } from "./query-config"
import {
  AdminCreateCollection,
  AdminGetCollectionParams,
  AdminGetCollectionsParams,
  AdminUpdateCollection,
} from "./validators"

export const adminCollectionRoutesMiddlewares: MiddlewareRoute[] = [
  {
    matcher: "/admin/collections/*",
    policies: [
      {
        resource: Entities.product_collection,
        operation: "read",
      },
    ],
  },
  {
    method: ["GET"],
    matcher: "/admin/collections",
    middlewares: [
      validateAndTransformQuery(
        AdminGetCollectionsParams,
        QueryConfig.listTransformQueryConfig
      ),
    ],
    policies: [
      {
        resource: Entities.product_collection,
        operation: "read",
      },
    ],
  },
  {
    method: ["GET"],
    matcher: "/admin/collections/:id",
    middlewares: [
      validateAndTransformQuery(
        AdminGetCollectionParams,
        QueryConfig.retrieveTransformQueryConfig
      ),
    ],
  },
  {
    method: ["POST"],
    matcher: "/admin/collections",
    middlewares: [
      validateAndTransformBody(AdminCreateCollection),
      validateAndTransformQuery(
        AdminGetCollectionParams,
        QueryConfig.retrieveTransformQueryConfig
      ),
    ],
    policies: [
      {
        resource: Entities.product_collection,
        operation: "create",
      },
    ],
  },
  {
    method: ["POST"],
    matcher: "/admin/collections/:id",
    middlewares: [
      validateAndTransformBody(AdminUpdateCollection),
      validateAndTransformQuery(
        AdminGetCollectionParams,
        QueryConfig.retrieveTransformQueryConfig
      ),
    ],
    policies: [
      {
        resource: Entities.product_collection,
        operation: "update",
      },
    ],
  },
  {
    method: ["DELETE"],
    matcher: "/admin/collections/:id",
    middlewares: [],
    policies: [
      {
        resource: Entities.product_collection,
        operation: "delete",
      },
    ],
  },
  {
    method: ["POST"],
    matcher: "/admin/collections/:id/products",
    middlewares: [
      validateAndTransformBody(createLinkBody()),
      validateAndTransformQuery(
        AdminGetCollectionParams,
        QueryConfig.retrieveTransformQueryConfig
      ),
    ],
    policies: [
      {
        resource: Entities.product_collection,
        operation: "update",
      },
    ],
  },
]
