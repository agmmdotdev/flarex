import { ContainerRegistrationKeys } from "@medusajs/utils/common/container"
import { remoteQueryObjectFromString } from "@medusajs/utils/common/remote-query-object-from-string"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { HttpTypes, RemoteQueryFunction } from "@medusajs/framework/types"

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse<HttpTypes.StoreCurrencyListResponse>
) => {
  const remoteQuery = req.scope.resolve<RemoteQueryFunction>(ContainerRegistrationKeys.REMOTE_QUERY)

  const queryObject = remoteQueryObjectFromString({
    entryPoint: "currency",
    variables: {
      filters: req.filterableFields,
      ...req.queryConfig.pagination,
    },
    fields: req.queryConfig.fields,
  })

  const { rows: currencies, metadata } = await remoteQuery(queryObject)

  res.json({
    currencies,
    count: metadata.count,
    offset: metadata.skip,
    limit: metadata.take,
  })
}
