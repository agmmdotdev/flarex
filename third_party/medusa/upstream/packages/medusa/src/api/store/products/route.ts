import type { MedusaResponse } from "@medusajs/framework/http"
import { HttpTypes } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  FeatureFlag,
  isPresent,
  QueryContext,
} from "@medusajs/framework/utils"
import IndexEngineFeatureFlag from "../../../feature-flags/index-engine"
import { wrapVariantsWithInventoryQuantityForSalesChannel } from "../../utils/middlewares"
import { RequestWithContext, wrapProductsWithTaxPrices } from "./helpers"

type ProductQueryMetadata = {
  count?: number
  estimate_count?: number
  skip: number
  take: number
}

type ProductQueryResult = {
  data?: HttpTypes.StoreProduct[]
  metadata?: ProductQueryMetadata
}

type ProductQueryInput = {
  entity: "product"
  fields: string[]
  filters: Record<string, unknown>
  pagination: RequestWithContext<HttpTypes.StoreProductListParams>["queryConfig"]["pagination"]
  context: Record<string, unknown>
}

type ProductQueryOptions = {
  cache: {
    enable: true
  }
  locale?: string
}

type ProductQueryService = {
  graph: (
    input: ProductQueryInput,
    options: ProductQueryOptions
  ) => Promise<ProductQueryResult>
  index: (
    input: ProductQueryInput,
    options: ProductQueryOptions
  ) => Promise<ProductQueryResult>
}

export const GET = async (
  req: RequestWithContext<HttpTypes.StoreProductListParams>,
  res: MedusaResponse<HttpTypes.StoreProductListResponse>
) => {
  if (FeatureFlag.isFeatureEnabled(IndexEngineFeatureFlag.key)) {
    return await getProductsWithIndexEngine(req, res)
  }

  return await getProducts(req, res)
}

async function getProductsWithIndexEngine(
  req: RequestWithContext<HttpTypes.StoreProductListParams>,
  res: MedusaResponse<HttpTypes.StoreProductListResponse>
) {
  const query = req.scope.resolve<ProductQueryService>(
    ContainerRegistrationKeys.QUERY
  )

  const context: Record<string, unknown> = {}
  const withInventoryQuantity = req.queryConfig.fields.some((field: string) =>
    field.includes("variants.inventory_quantity")
  )

  if (withInventoryQuantity) {
    req.queryConfig.fields = req.queryConfig.fields.filter(
      (field: string) => !field.includes("variants.inventory_quantity")
    )
  }

  if (isPresent(req.pricingContext)) {
    const variantsContext = getOrCreateRecord(context, "variants")
    variantsContext["calculated_price"] ??= QueryContext(
      req.pricingContext!
    )
  }

  const filters: Record<string, unknown> = req.filterableFields
  if (isPresent(filters.sales_channel_id)) {
    const salesChannelIds = filters.sales_channel_id

    const salesChannelsFilter = getOrCreateRecord(filters, "sales_channels")
    salesChannelsFilter["id"] = salesChannelIds

    delete filters.sales_channel_id
  }

  const { data: products = [], metadata } = await query.index(
    {
      entity: "product",
      fields: req.queryConfig.fields,
      filters,
      pagination: req.queryConfig.pagination,
      context,
    },
    {
      cache: {
        enable: true,
      },
      locale: req.locale,
    }
  )

  if (withInventoryQuantity) {
    await wrapVariantsWithInventoryQuantityForSalesChannel(
      req,
      products
        .map((product: HttpTypes.StoreProduct) => product.variants ?? [])
        .flat(1)
        .filter(
          (variant): variant is NonNullable<typeof variant> =>
            variant !== null
        )
    )
  }

  await wrapProductsWithTaxPrices(req, products)

  res.json({
    products,
    count: metadata?.estimate_count ?? 0,
    estimate_count: metadata?.estimate_count ?? 0,
    offset: metadata?.skip ?? 0,
    limit: metadata?.take ?? 0,
  })
}

async function getProducts(
  req: RequestWithContext<HttpTypes.StoreProductListParams>,
  res: MedusaResponse<HttpTypes.StoreProductListResponse>
) {
  const query = req.scope.resolve<ProductQueryService>(
    ContainerRegistrationKeys.QUERY
  )
  const context: Record<string, unknown> = {}
  const withInventoryQuantity = req.queryConfig.fields.some((field: string) =>
    field.includes("variants.inventory_quantity")
  )

  if (withInventoryQuantity) {
    req.queryConfig.fields = req.queryConfig.fields.filter(
      (field: string) => !field.includes("variants.inventory_quantity")
    )
  }

  if (isPresent(req.pricingContext)) {
    const variantsContext = getOrCreateRecord(context, "variants")
    variantsContext["calculated_price"] ??= QueryContext(
      req.pricingContext!
    )
  }

  const { data: products = [], metadata } = await query.graph(
    {
      entity: "product",
      fields: req.queryConfig.fields,
      filters: req.filterableFields,
      pagination: req.queryConfig.pagination,
      context,
    },
    {
      cache: {
        enable: true,
      },
      locale: req.locale,
    }
  )

  if (withInventoryQuantity) {
    await wrapVariantsWithInventoryQuantityForSalesChannel(
      req,
      products
        .map((product: HttpTypes.StoreProduct) => product.variants ?? [])
        .flat(1)
        .filter(
          (variant): variant is NonNullable<typeof variant> =>
            variant !== null
        )
    )
  }

  await wrapProductsWithTaxPrices(req, products)

  res.json({
    products,
    count: metadata?.count ?? 0,
    offset: metadata?.skip ?? 0,
    limit: metadata?.take ?? 0,
  })
}

function getOrCreateRecord(
  parent: Record<string, unknown>,
  key: string
): Record<string, unknown> {
  const existing = parent[key]
  if (
    typeof existing === "object" &&
    existing !== null &&
    !Array.isArray(existing)
  ) {
    return existing as Record<string, unknown>
  }

  const next: Record<string, unknown> = {}
  parent[key] = next
  return next
}
