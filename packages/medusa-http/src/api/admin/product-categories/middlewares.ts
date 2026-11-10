import {
  validateAndTransformBody,
  validateAndTransformQuery,
  MiddlewareRoute,
} from "@medusajs/framework/http"
import { createLinkBody } from "../../utils/validators"
import * as QueryConfig from "./query-config"
import { Entities } from "./query-config"
import {
  AdminCreateProductCategory,
  AdminProductCategoriesParams,
  AdminProductCategoryParams,
  AdminUpdateProductCategory,
} from "./validators"

export const adminProductCategoryRoutesMiddlewares: MiddlewareRoute[] = [
  {
    matcher: "/admin/product-categories/*",
    policies: [
      {
        resource: Entities.product_category,
        operation: "read",
      },
    ],
  },
  {
    method: ["GET"],
    matcher: "/admin/product-categories",
    middlewares: [
      validateAndTransformQuery(
        AdminProductCategoriesParams,
        QueryConfig.listProductCategoryConfig
      ),
    ],
    policies: [
      {
        resource: Entities.product_category,
        operation: "read",
      },
    ],
  },
  {
    method: ["GET"],
    matcher: "/admin/product-categories/:id",
    middlewares: [
      validateAndTransformQuery(
        AdminProductCategoryParams,
        QueryConfig.retrieveProductCategoryConfig
      ),
    ],
  },
  {
    method: ["POST"],
    matcher: "/admin/product-categories",
    middlewares: [
      validateAndTransformBody(AdminCreateProductCategory),
      validateAndTransformQuery(
        AdminProductCategoryParams,
        QueryConfig.retrieveProductCategoryConfig
      ),
    ],
    policies: [
      {
        resource: Entities.product_category,
        operation: "create",
      },
    ],
  },
  {
    method: ["POST"],
    matcher: "/admin/product-categories/:id",
    middlewares: [
      validateAndTransformBody(AdminUpdateProductCategory),
      validateAndTransformQuery(
        AdminProductCategoryParams,
        QueryConfig.retrieveProductCategoryConfig
      ),
    ],
    policies: [
      {
        resource: Entities.product_category,
        operation: "update",
      },
    ],
  },
  {
    method: ["DELETE"],
    matcher: "/admin/product-categories/:id",
    middlewares: [],
    policies: [
      {
        resource: Entities.product_category,
        operation: "delete",
      },
    ],
  },
  {
    method: ["POST"],
    matcher: "/admin/product-categories/:id/products",
    middlewares: [
      validateAndTransformBody(createLinkBody()),
      validateAndTransformQuery(
        AdminProductCategoryParams,
        QueryConfig.retrieveProductCategoryConfig
      ),
    ],
    policies: [
      {
        resource: Entities.product_category,
        operation: "update",
      },
    ],
  },
]
