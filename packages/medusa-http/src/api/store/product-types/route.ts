import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import type { HttpTypes, RemoteQueryFunction } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/utils/common/container"

export const GET = async (
  req: AuthenticatedMedusaRequest<HttpTypes.StoreProductTypeListParams>,
  res: MedusaResponse<HttpTypes.StoreProductTypeListResponse>
) => {
  const query = req.scope.resolve<Pick<RemoteQueryFunction, "graph">>(ContainerRegistrationKeys.QUERY)

  const { data: product_types, metadata } = await query.graph(
    {
      entity: "product_type",
      filters: req.filterableFields,
      pagination: req.queryConfig.pagination,
      fields: req.queryConfig.fields,
    },
    {
      locale: req.locale,
    }
  )

  res.json({
    product_types,
    count: metadata?.count ?? 0,
    offset: metadata?.skip ?? 0,
    limit: metadata?.take ?? 0,
  })
}
