import {
  applyDefaultFilters,
  applyParamsAsFilters,
  authenticate,
  clearFiltersByKey,
  maybeApplyLinkFilter,
  validateAndTransformQuery,
  type MedusaNextFunction,
  type MedusaRequest,
  type MedusaResponse,
  type MiddlewareRoute,
} from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
} from "@medusajs/utils/common/container"
import { FeatureFlag } from "@medusajs/utils/feature-flags/flag-router"
import { isPresent } from "@medusajs/utils/common/is-present"
import { ProductStatus } from "@medusajs/utils/product/enums"
import { filterByValidSalesChannels } from "../../utils/middlewares/products/filter-by-valid-sales-channels"
import { normalizeDataForContext } from "../../utils/middlewares/products/normalize-data-for-context"
import { setPricingContext } from "../../utils/middlewares/products/set-pricing-context"
import { setTaxContext } from "../../utils/middlewares/products/set-tax-context"
import * as QueryConfig from "./query-config"
import { StoreGetProductParams, StoreGetProductsParams } from "./validators"

async function applyMaybeLinkFilterIfNecessary(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  if (FeatureFlag.isFeatureEnabled("index_engine")) {
    return next()
  }

  const query = req.scope.resolve<{ graph(input: { entity: "sales_channels"; fields: string[]; pagination: { skip: number; take: number } }): Promise<{ metadata?: { count?: number } }> }>(ContainerRegistrationKeys.QUERY)
  const salesChannelsQueryRes = await query.graph({
    entity: "sales_channels",
    fields: ["id"],
    pagination: {
      skip: 0,
      take: 1,
    },
  })

  const salesChannelCount = salesChannelsQueryRes.metadata?.count ?? 0
  if (!(salesChannelCount > 1)) {
    delete req.filterableFields.sales_channel_id
    return next()
  }

  return maybeApplyLinkFilter({
    entryPoint: "product_sales_channel",
    resourceId: "product_id",
    filterableField: "sales_channel_id",
  })(req, res, next)
}

export const storeProductRoutesMiddlewares: MiddlewareRoute[] = [
  {
    method: ["GET"],
    matcher: "/store/products",
    middlewares: [
      authenticate("customer", ["session", "bearer"], {
        allowUnauthenticated: true,
      }),
      validateAndTransformQuery(
        StoreGetProductsParams,
        QueryConfig.listProductQueryConfig
      ),
      filterByValidSalesChannels(),
      applyMaybeLinkFilterIfNecessary,
      applyDefaultFilters({
        status: ProductStatus.PUBLISHED,
        // TODO: the type here seems off and the implementation does not take into account $and and $or possible filters. Might be worth re working (original type used here was StoreGetProductsParamsType)
        categories: (
          filters: Record<string, unknown>,
          fields: string[]
        ) => {
          const categoryIds = filters.category_id
          delete filters.category_id

          if (!isPresent(categoryIds)) {
            return
          }

          return { id: categoryIds, is_internal: false, is_active: true }
        },
      }),
      normalizeDataForContext(),
      setPricingContext(),
      setTaxContext(),
      clearFiltersByKey(["region_id", "country_code", "province", "cart_id"]),
    ],
  },
  {
    method: ["GET"],
    matcher: "/store/products/:id",
    middlewares: [
      authenticate("customer", ["session", "bearer"], {
        allowUnauthenticated: true,
      }),
      validateAndTransformQuery(
        StoreGetProductParams,
        QueryConfig.retrieveProductQueryConfig
      ),
      applyParamsAsFilters({ id: "id" }),
      filterByValidSalesChannels(),
      maybeApplyLinkFilter({
        entryPoint: "product_sales_channel",
        resourceId: "product_id",
        filterableField: "sales_channel_id",
      }),
      applyDefaultFilters({
        status: ProductStatus.PUBLISHED,
      }),
      normalizeDataForContext(),
      setPricingContext(),
      setTaxContext(),
      clearFiltersByKey(["region_id", "country_code", "province", "cart_id"]),
    ],
  },
]
