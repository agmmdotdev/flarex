import { ContainerRegistrationKeys } from "@medusajs/utils/common/container"
import { remoteQueryObjectFromString } from "@medusajs/utils/common/remote-query-object-from-string"
import type { HttpTypes, RemoteQueryFunction } from "@medusajs/framework/types"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

export const GET = async (
  req: MedusaRequest<HttpTypes.StoreRegionFilters>,
  res: MedusaResponse<HttpTypes.StoreRegionListResponse>
) => {
  const remoteQuery = req.scope.resolve<RemoteQueryFunction>(ContainerRegistrationKeys.REMOTE_QUERY)

  const queryObject = remoteQueryObjectFromString({
    entryPoint: "region",
    variables: {
      filters: req.filterableFields,
      ...req.queryConfig.pagination,
    },
    fields: req.queryConfig.fields,
  })

  const { rows: regions, metadata } = await remoteQuery(queryObject)

  res.json({
    regions,
    count: metadata.count,
    offset: metadata.skip,
    limit: metadata.take,
  })
}
