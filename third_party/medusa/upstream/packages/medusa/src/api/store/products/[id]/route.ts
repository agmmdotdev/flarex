import type { MedusaResponse } from "@medusajs/framework/http"
import type { HttpTypes, QueryContextType } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
  QueryContext,
} from "@medusajs/framework/utils"
import { wrapVariantsWithInventoryQuantityForSalesChannel } from "../../../utils/middlewares"
import {
  filterOutInternalProductCategories,
  RequestWithContext,
  wrapProductsWithTaxPrices,
} from "../helpers"

type ProductQueryResult = {
  data?: HttpTypes.StoreProduct[]
}

type ProductQueryInput = {
  entity: "product"
  fields: string[]
  filters: Record<string, unknown>
  context: QueryContextType
}

type ProductQueryOptions = {
  locale?: string
}

type ProductQueryService = {
  graph: (
    input: ProductQueryInput,
    options: ProductQueryOptions
  ) => Promise<ProductQueryResult>
}

export const GET = async (
  req: RequestWithContext<HttpTypes.StoreProductParams>,
  res: MedusaResponse<HttpTypes.StoreProductResponse>
) => {
  const withInventoryQuantity = req.queryConfig.fields.some((field: string) =>
    field.includes("variants.inventory_quantity")
  )

  if (withInventoryQuantity) {
    req.queryConfig.fields = req.queryConfig.fields.filter(
      (field: string) => !field.includes("variants.inventory_quantity")
    )
  }

  const scopedProductIds = normalizeProductIdFilter(req.filterableFields.id)
  const filters: Record<string, unknown> = {
    ...req.filterableFields,
    id: scopedProductIds
      ? scopedProductIds.includes(req.params.id)
        ? req.params.id
        : []
      : req.params.id,
  }

  const context: QueryContextType = {}

  if (req.pricingContext) {
    context["variants"] ??= {}
    context["variants"]["calculated_price"] ??= QueryContext(req.pricingContext)
  }

  const includesCategoriesField = req.queryConfig.fields.some((field: string) =>
    field.startsWith("categories")
  )

  if (!req.queryConfig.fields.includes("categories.is_internal")) {
    req.queryConfig.fields.push("categories.is_internal")
  }

  const query = req.scope.resolve<ProductQueryService>(
    ContainerRegistrationKeys.QUERY
  )

  const { data: products = [] } = await query.graph(
    {
      entity: "product",
      filters,
      context,
      fields: req.queryConfig.fields,
    },
    {
      locale: req.locale,
    }
  )
  const product = products[0]

  if (!product) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Product with id: ${req.params.id} was not found`
    )
  }

  if (withInventoryQuantity) {
    await wrapVariantsWithInventoryQuantityForSalesChannel(
      req,
      product.variants || []
    )
  }

  if (includesCategoriesField) {
    filterOutInternalProductCategories([product])
  }

  await wrapProductsWithTaxPrices(req, [product])
  res.json({ product })
}

function normalizeProductIdFilter(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value === "string") {
    return [value]
  }

  if (Array.isArray(value)) {
    return value.filter((id): id is string => typeof id === "string")
  }

  return []
}
