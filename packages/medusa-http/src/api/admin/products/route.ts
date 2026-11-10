import { refetchEntities, refetchEntity, type AuthenticatedMedusaRequest, type MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { ContainerRegistrationKeys } from "@medusajs/utils/common/container"
import { FeatureFlag } from "@medusajs/utils/feature-flags/flag-router"
import { isPresent } from "@medusajs/utils/common/is-present"
import type { ProductTypes } from "@medusajs/framework/types"
import type { AdminCreateProductBody } from "./validators"
import { remapKeysForProduct, remapProductResponse } from "./helpers"

const createProductsWorkflowId = "create-products"

type ProductListResponse = {
  products: ProductTypes.ProductDTO[]
  count?: number
  estimate_count?: number
  offset?: number
  limit?: number
}
type ProductIndexQuery = {
  index(input: {
    entity: string
    fields: string[]
    filters: Record<string, unknown>
    pagination: AuthenticatedMedusaRequest["queryConfig"]["pagination"]
    withDeleted?: boolean
  }): Promise<{ data: ProductTypes.ProductDTO[]; metadata: { estimate_count: number; skip: number; take: number } }>
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse<ProductListResponse>
) => {
  if (FeatureFlag.isFeatureEnabled("index_engine")) {
    return await getProductsWithIndexEngine(req, res)
  }
  return await getProducts(req, res)
}

async function getProducts(req: AuthenticatedMedusaRequest, res: MedusaResponse<ProductListResponse>) {
  const selectFields = remapKeysForProduct(req.queryConfig.fields ?? [])
  const { data: products, metadata } = await refetchEntities<ProductTypes.ProductDTO>({
    entity: "product",
    idOrFilter: req.filterableFields,
    scope: req.scope,
    fields: selectFields,
    pagination: req.queryConfig.pagination,
    withDeleted: req.queryConfig.withDeleted,
  })
  res.json({ products: products.map(remapProductResponse), count: metadata.count, offset: metadata.skip, limit: metadata.take })
}

async function getProductsWithIndexEngine(req: AuthenticatedMedusaRequest, res: MedusaResponse<ProductListResponse>) {
  const query = req.scope.resolve<ProductIndexQuery>(ContainerRegistrationKeys.QUERY)
  const filters: Record<string, unknown> = req.filterableFields
  if (isPresent(filters.sales_channel_id)) {
    const salesChannelIds = filters.sales_channel_id
    const salesChannelsFilter = getOrCreateRecord(filters, "sales_channels")
    salesChannelsFilter.id = salesChannelIds
    delete filters.sales_channel_id
  }
  const { data: products, metadata } = await query.index({
    entity: "product", fields: req.queryConfig.fields ?? [], filters: filters,
    pagination: req.queryConfig.pagination, withDeleted: req.queryConfig.withDeleted,
  })
  res.json({
    products: products.map(remapProductResponse), count: metadata.estimate_count,
    estimate_count: metadata.estimate_count, offset: metadata.skip, limit: metadata.take,
  })
}

function getOrCreateRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = parent[key]
  if (typeof existing === "object" && existing !== null && !Array.isArray(existing)) {
    return existing as Record<string, unknown>
  }
  const next: Record<string, unknown> = {}
  parent[key] = next
  return next
}

type CreateProductsWorkflowEngine = {
  run(id: typeof createProductsWorkflowId, options: {
    input: { products: Omit<AdminCreateProductBody, "additional_data">[]; additional_data?: AdminCreateProductBody["additional_data"] }
  }): Promise<{ result: { id: string }[] }>
}

// Selected pinned Admin Products POST. Workflow settlement precedes refetch.
export const POST = async (
  req: AuthenticatedMedusaRequest<AdminCreateProductBody>,
  res: MedusaResponse<{ product: ReturnType<typeof remapProductResponse> }>
) => {
  const { additional_data, ...products } = req.validatedBody

  const workflowEngine = req.scope.resolve<CreateProductsWorkflowEngine>(Modules.WORKFLOW_ENGINE)

  const { result } = await workflowEngine.run(createProductsWorkflowId, {
    input: { products: [products], additional_data },
  })

  const product = await refetchEntity<ProductTypes.ProductDTO>({
    entity: "product",
    idOrFilter: result[0].id,
    scope: req.scope,
    fields: remapKeysForProduct(req.queryConfig.fields ?? []),
  })

  if (!product) throw new Error("Created Product was not returned by native refetch")

  res.status(200).json({ product: remapProductResponse(product) })
}
